use std::collections::{BTreeMap, HashMap, VecDeque};
use std::sync::Arc;

use async_trait::async_trait;
use sacode_kernel::{QueueStats, ScheduledTask, TaskPriority, TaskQueueStatus, TaskResult, TaskRun};
use tokio::sync::{Mutex, OwnedSemaphorePermit, RwLock, Semaphore};
use tracing::warn;

pub struct TaskQueue {
    pending: RwLock<BTreeMap<TaskPriority, VecDeque<ScheduledTask>>>,
    ready: RwLock<VecDeque<ScheduledTask>>,
    running: RwLock<HashMap<String, ScheduledTask>>,
    completed: RwLock<HashMap<String, TaskResult>>,
    failed: RwLock<HashMap<String, TaskResult>>,
    completed_runs: RwLock<HashMap<String, TaskRun>>,
    failed_runs: RwLock<HashMap<String, TaskRun>>,
    retrying: RwLock<HashMap<String, ScheduledTask>>,
    cancelled: RwLock<HashMap<String, ScheduledTask>>,
    concurrency_semaphore: Arc<Semaphore>,
    running_permits: RwLock<HashMap<String, OwnedSemaphorePermit>>,
    store: Option<Arc<dyn TaskStore>>,
}

impl TaskQueue {
    pub fn new(max_concurrency: usize) -> Self {
        Self {
            pending: RwLock::new(BTreeMap::new()),
            ready: RwLock::new(VecDeque::new()),
            running: RwLock::new(HashMap::new()),
            completed: RwLock::new(HashMap::new()),
            failed: RwLock::new(HashMap::new()),
            completed_runs: RwLock::new(HashMap::new()),
            failed_runs: RwLock::new(HashMap::new()),
            retrying: RwLock::new(HashMap::new()),
            cancelled: RwLock::new(HashMap::new()),
            concurrency_semaphore: Arc::new(Semaphore::new(max_concurrency)),
            running_permits: RwLock::new(HashMap::new()),
            store: None,
        }
    }

    pub fn with_store(mut self, store: Arc<dyn TaskStore>) -> Self {
        self.store = Some(store);
        self
    }

    pub async fn submit(&self, task: ScheduledTask) -> anyhow::Result<String> {
        let task_id = task.id.clone();

        if let Some(store) = self.store.as_ref() {
            store.save(&task).await?;
        }

        if task.dependencies.is_empty() {
            let mut ready = self.ready.write().await;
            ready.push_back(task);
            if let Some(store) = self.store.as_ref() {
                store
                    .update_status(&task_id, TaskQueueStatus::Ready)
                    .await?;
            }
        } else {
            let mut pending = self.pending.write().await;
            pending
                .entry(task.priority)
                .or_insert_with(VecDeque::new)
                .push_back(task);
            if let Some(store) = self.store.as_ref() {
                store
                    .update_status(&task_id, TaskQueueStatus::Pending)
                    .await?;
            }
        }

        Ok(task_id)
    }

    pub async fn next_ready(&self) -> Option<ScheduledTask> {
        let permit = self.concurrency_semaphore.clone().try_acquire_owned();
        let Ok(permit) = permit else {
            return None;
        };

        let mut ready = self.ready.write().await;
        if let Some(task) = ready.pop_front() {
            let mut running = self.running.write().await;
            running.insert(task.id.clone(), task.clone());
            let mut running_permits = self.running_permits.write().await;
            running_permits.insert(task.id.clone(), permit);
            return Some(task);
        }

        drop(ready);

        let mut pending = self.pending.write().await;
        for priority in [TaskPriority::Urgent, TaskPriority::High, TaskPriority::Normal, TaskPriority::Low] {
            if let Some(queue) = pending.get_mut(&priority) {
                let completed_ids = self.get_completed_ids().await;
                while let Some(task) = queue.pop_front() {
                    if task.is_ready(&completed_ids) {
                        let mut running = self.running.write().await;
                        running.insert(task.id.clone(), task.clone());
                        let mut running_permits = self.running_permits.write().await;
                        running_permits.insert(task.id.clone(), permit);
                        return Some(task);
                    } else {
                        queue.push_back(task);
                        break;
                    }
                }
            }
        }

        None
    }

    async fn release_running_permit(&self, task_id: &str) {
        let mut running_permits = self.running_permits.write().await;
        running_permits.remove(task_id);
    }

    pub async fn mark_running(&self, task_id: &str) {
        let mut running = self.running.write().await;
        if let Some(_task) = running.get_mut(task_id) {
            if let Some(store) = self.store.as_ref() {
                if let Err(error) = store.update_status(task_id, TaskQueueStatus::Running).await {
                    warn!(task_id, ?error, "failed to persist running task status");
                }
            }
        }
    }

    pub async fn mark_completed(&self, task_id: &str, result: TaskResult, task_run: TaskRun) {
        let mut running = self.running.write().await;
        running.remove(task_id);
        drop(running);
        self.release_running_permit(task_id).await;

        let mut completed = self.completed.write().await;
        completed.insert(task_id.to_string(), result.clone());

        let mut completed_runs = self.completed_runs.write().await;
        completed_runs.insert(task_id.to_string(), task_run);

        if let Some(store) = self.store.as_ref() {
            if let Err(error) = store.save_result(&result).await {
                warn!(task_id, ?error, "failed to persist completed task result");
            }
        }
    }

    pub async fn mark_failed(&self, task_id: &str, result: TaskResult, task_run: TaskRun) {
        let mut running = self.running.write().await;
        if let Some(task) = running.remove(task_id) {
            drop(running);
            self.release_running_permit(task_id).await;
            if task.can_retry() && self.should_retry(&task, &result) {
                let mut retrying = self.retrying.write().await;
                retrying.insert(task_id.to_string(), task);
                if let Some(store) = self.store.as_ref() {
                    if let Err(error) = store.update_status(task_id, TaskQueueStatus::Retrying).await {
                        warn!(task_id, ?error, "failed to persist retrying task status");
                    }
                }
            } else {
                let mut failed = self.failed.write().await;
                failed.insert(task_id.to_string(), result.clone());

                let mut failed_runs = self.failed_runs.write().await;
                failed_runs.insert(task_id.to_string(), task_run);

                if let Some(store) = self.store.as_ref() {
                    if let Err(error) = store.save_result(&result).await {
                        warn!(task_id, ?error, "failed to persist failed task result");
                    }
                }
            }
        }
    }

    pub async fn mark_retrying(&self, task_id: &str) {
        let mut retrying = self.retrying.write().await;
        if let Some(mut task) = retrying.remove(task_id) {
            task.increment_attempt();
            let status = if task.dependencies.is_empty() {
                TaskQueueStatus::Ready
            } else {
                TaskQueueStatus::Pending
            };

            if status == TaskQueueStatus::Ready {
                let mut ready = self.ready.write().await;
                ready.push_back(task);
            } else {
                let mut pending = self.pending.write().await;
                pending
                    .entry(task.priority)
                    .or_insert_with(VecDeque::new)
                    .push_back(task);
            }

            if let Some(store) = self.store.as_ref() {
                if let Err(error) = store.update_status(task_id, status).await {
                    warn!(task_id, ?error, "failed to persist retried task status");
                }
            }
        }
    }

    pub async fn cancel(&self, task_id: &str) -> bool {
        let mut running = self.running.write().await;
        if let Some(task) = running.remove(task_id) {
            drop(running);
            self.release_running_permit(task_id).await;
            let mut cancelled = self.cancelled.write().await;
            cancelled.insert(task_id.to_string(), task);

            if let Some(store) = self.store.as_ref() {
                if let Err(error) = store.update_status(task_id, TaskQueueStatus::Cancelled).await {
                    warn!(task_id, ?error, "failed to persist cancelled running task status");
                }
            }
            return true;
        }
        drop(running);

        let mut ready = self.ready.write().await;
        if let Some(pos) = ready.iter().position(|t| t.id == task_id) {
            if let Some(task) = ready.remove(pos) {
                let mut cancelled = self.cancelled.write().await;
                cancelled.insert(task_id.to_string(), task);

                if let Some(store) = self.store.as_ref() {
                    if let Err(error) = store.update_status(task_id, TaskQueueStatus::Cancelled).await {
                        warn!(task_id, ?error, "failed to persist cancelled ready task status");
                    }
                }
                return true;
            }
        }

        let mut pending = self.pending.write().await;
        for queue in pending.values_mut() {
            if let Some(pos) = queue.iter().position(|t| t.id == task_id) {
                if let Some(task) = queue.remove(pos) {
                    let mut cancelled = self.cancelled.write().await;
                    cancelled.insert(task_id.to_string(), task);

                    if let Some(store) = self.store.as_ref() {
                        if let Err(error) = store.update_status(task_id, TaskQueueStatus::Cancelled).await {
                            warn!(task_id, ?error, "failed to persist cancelled pending task status");
                        }
                    }
                    return true;
                }
            }
        }

        false
    }

    pub async fn status(&self, task_id: &str) -> Option<TaskQueueStatus> {
        let running = self.running.read().await;
        if running.contains_key(task_id) {
            return Some(TaskQueueStatus::Running);
        }

        let ready = self.ready.read().await;
        if ready.iter().any(|t| t.id == task_id) {
            return Some(TaskQueueStatus::Ready);
        }

        let completed = self.completed.read().await;
        if completed.contains_key(task_id) {
            return Some(TaskQueueStatus::Completed);
        }

        let failed = self.failed.read().await;
        if failed.contains_key(task_id) {
            return Some(TaskQueueStatus::Failed);
        }

        let retrying = self.retrying.read().await;
        if retrying.contains_key(task_id) {
            return Some(TaskQueueStatus::Retrying);
        }

        let cancelled = self.cancelled.read().await;
        if cancelled.contains_key(task_id) {
            return Some(TaskQueueStatus::Cancelled);
        }

        let pending = self.pending.read().await;
        for queue in pending.values() {
            if queue.iter().any(|t| t.id == task_id) {
                return Some(TaskQueueStatus::Pending);
            }
        }

        None
    }

    pub async fn get_task(&self, task_id: &str) -> Option<ScheduledTask> {
        let running = self.running.read().await;
        if let Some(task) = running.get(task_id) {
            return Some(task.clone());
        }

        let ready = self.ready.read().await;
        if let Some(task) = ready.iter().find(|t| t.id == task_id) {
            return Some(task.clone());
        }

        let pending = self.pending.read().await;
        for queue in pending.values() {
            if let Some(task) = queue.iter().find(|t| t.id == task_id) {
                return Some(task.clone());
            }
        }

        None
    }

    pub async fn get_result(&self, task_id: &str) -> Option<TaskResult> {
        let completed = self.completed.read().await;
        if let Some(result) = completed.get(task_id) {
            return Some(result.clone());
        }

        let failed = self.failed.read().await;
        if let Some(result) = failed.get(task_id) {
            return Some(result.clone());
        }

        None
    }

    pub async fn get_task_run(&self, task_id: &str) -> Option<TaskRun> {
        let completed_runs = self.completed_runs.read().await;
        if let Some(run) = completed_runs.get(task_id) {
            return Some(run.clone());
        }

        let failed_runs = self.failed_runs.read().await;
        if let Some(run) = failed_runs.get(task_id) {
            return Some(run.clone());
        }

        None
    }

    pub async fn stats(&self) -> QueueStats {
        let pending = self.pending.read().await;
        let pending_count: usize = pending.values().map(|q| q.len()).sum();

        let ready = self.ready.read().await;
        let ready_count = ready.len();

        let running = self.running.read().await;
        let running_count = running.len();

        let completed = self.completed.read().await;
        let completed_count = completed.len();

        let failed = self.failed.read().await;
        let failed_count = failed.len();

        let retrying = self.retrying.read().await;
        let retrying_count = retrying.len();

        let cancelled = self.cancelled.read().await;
        let cancelled_count = cancelled.len();

        QueueStats {
            pending_count,
            ready_count,
            running_count,
            completed_count,
            failed_count,
            retrying_count,
            cancelled_count,
        }
    }

    pub async fn get_completed_ids(&self) -> Vec<String> {
        let completed = self.completed.read().await;
        completed.keys().cloned().collect()
    }

    pub async fn get_ready_count(&self) -> usize {
        self.ready.read().await.len()
    }

    pub async fn restore_pending_tasks(&self) -> anyhow::Result<usize> {
        let Some(store) = self.store.as_ref() else {
            return Ok(0);
        };

        let tasks = store.load_pending().await?;
        let mut restored = 0usize;

        for task in tasks {
            let task_id = task.id.clone();
            let status = if task.dependencies.is_empty() {
                TaskQueueStatus::Ready
            } else {
                TaskQueueStatus::Pending
            };

            if status == TaskQueueStatus::Ready {
                let mut ready = self.ready.write().await;
                if ready.iter().any(|existing| existing.id == task_id) {
                    continue;
                }
                ready.push_back(task);
            } else {
                let mut pending = self.pending.write().await;
                let queue = pending.entry(task.priority).or_insert_with(VecDeque::new);
                if queue.iter().any(|existing| existing.id == task_id) {
                    continue;
                }
                queue.push_back(task);
            }

            store.update_status(&task_id, status).await?;
            restored += 1;
        }

        Ok(restored)
    }

    pub async fn get_restorable_tasks(&self) -> Vec<ScheduledTask> {
        let mut tasks = Vec::new();

        {
            let ready = self.ready.read().await;
            tasks.extend(ready.iter().cloned());
        }

        let pending = self.pending.read().await;
        for queue in pending.values() {
            tasks.extend(queue.iter().cloned());
        }

        tasks
    }

    pub async fn get_retry_tasks(&self) -> Vec<ScheduledTask> {
        let retrying = self.retrying.read().await;
        retrying.values().cloned().collect()
    }

    fn should_retry(&self, task: &ScheduledTask, result: &TaskResult) -> bool {
        if !task.can_retry() {
            return false;
        }

        if let Some(error) = &result.error {
            if error.contains("timeout") || error.contains("Timeout") {
                return task.retry_policy.should_retry_on(&sacode_kernel::RetryCondition::Timeout);
            }
            if error.contains("network") || error.contains("Network") {
                return task.retry_policy.should_retry_on(&sacode_kernel::RetryCondition::NetworkError);
            }
        }

        task.retry_policy.should_retry_on(&sacode_kernel::RetryCondition::InternalError)
    }
}

impl Default for TaskQueue {
    fn default() -> Self {
        Self::new(10)
    }
}

#[async_trait]
pub trait TaskStore: Send + Sync {
    async fn save(&self, task: &ScheduledTask) -> anyhow::Result<()>;
    async fn update_status(&self, task_id: &str, status: TaskQueueStatus) -> anyhow::Result<()>;
    async fn save_result(&self, result: &TaskResult) -> anyhow::Result<()>;
    async fn load(&self, task_id: &str) -> anyhow::Result<Option<ScheduledTask>>;
    async fn load_pending(&self) -> anyhow::Result<Vec<ScheduledTask>>;
}

pub struct InMemoryStore {
    tasks: Mutex<HashMap<String, ScheduledTask>>,
    results: Mutex<HashMap<String, TaskResult>>,
    statuses: Mutex<HashMap<String, TaskQueueStatus>>,
}

impl InMemoryStore {
    pub fn new() -> Self {
        Self {
            tasks: Mutex::new(HashMap::new()),
            results: Mutex::new(HashMap::new()),
            statuses: Mutex::new(HashMap::new()),
        }
    }
}

impl Default for InMemoryStore {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait]
impl TaskStore for InMemoryStore {
    async fn save(&self, task: &ScheduledTask) -> anyhow::Result<()> {
        let mut tasks = self.tasks.lock().await;
        tasks.insert(task.id.clone(), task.clone());
        drop(tasks);

        let mut statuses = self.statuses.lock().await;
        statuses.insert(
            task.id.clone(),
            if task.dependencies.is_empty() {
                TaskQueueStatus::Ready
            } else {
                TaskQueueStatus::Pending
            },
        );
        Ok(())
    }

    async fn update_status(&self, task_id: &str, status: TaskQueueStatus) -> anyhow::Result<()> {
        let tasks = self.tasks.lock().await;
        if !tasks.contains_key(task_id) {
            return Ok(());
        }
        drop(tasks);

        let mut statuses = self.statuses.lock().await;
        statuses.insert(task_id.to_string(), status);
        Ok(())
    }

    async fn save_result(&self, result: &TaskResult) -> anyhow::Result<()> {
        let mut results = self.results.lock().await;
        results.insert(result.task_id.clone(), result.clone());
        drop(results);

        let mut statuses = self.statuses.lock().await;
        statuses.insert(result.task_id.clone(), result.status);
        Ok(())
    }

    async fn load(&self, task_id: &str) -> anyhow::Result<Option<ScheduledTask>> {
        let tasks = self.tasks.lock().await;
        Ok(tasks.get(task_id).cloned())
    }

    async fn load_pending(&self) -> anyhow::Result<Vec<ScheduledTask>> {
        let tasks = self.tasks.lock().await;
        let statuses = self.statuses.lock().await;
        Ok(tasks
            .values()
            .filter(|task| {
                matches!(
                    statuses.get(&task.id),
                    Some(
                        TaskQueueStatus::Pending
                            | TaskQueueStatus::Ready
                            | TaskQueueStatus::Running
                            | TaskQueueStatus::Retrying
                    )
                )
            })
            .cloned()
            .collect())
    }
}
