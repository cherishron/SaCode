use std::{collections::HashMap, sync::Arc};

use serde::{Deserialize, Serialize};
use tokio::sync::{broadcast, Mutex, RwLock};

use crate::{executor::TaskExecutor, queue::TaskQueue, retry::RetryHandler, tools::ToolRegistry, StoreDb};
use sacode_kernel::{TaskQueueStatus, TaskRun};

use super::{parse_mode, status::sync_task_status_from_task_run, status::task_run_for_queue_status};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TaskRequest {
    pub prompt: String,
    pub mode: String,
    #[serde(default)]
    pub priority: String,
    #[serde(default)]
    pub dependencies: Vec<String>,
    #[serde(default)]
    pub retry_policy: Option<RetryPolicyRequest>,
    #[serde(default)]
    pub scheduled_at: Option<String>,
    #[serde(default)]
    pub deadline: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RetryPolicyRequest {
    #[serde(default = "default_max_attempts")]
    pub max_attempts: u32,
    #[serde(default = "default_backoff_type")]
    pub backoff_type: String,
    #[serde(default = "default_base_ms")]
    pub base_ms: u64,
    #[serde(default = "default_max_ms")]
    pub max_ms: u64,
    #[serde(default)]
    pub retry_on: Vec<String>,
}

fn default_max_attempts() -> u32 { 3 }
fn default_backoff_type() -> String { "exponential".to_string() }
fn default_base_ms() -> u64 { 1000 }
fn default_max_ms() -> u64 { 30000 }

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TaskResponse {
    pub task_id: String,
    pub status: String,
    pub message: String,
    pub queue_status: String,
}

impl TaskResponse {
    pub fn queued(task_id: String, queue_status: TaskQueueStatus, message: String) -> Self {
        Self {
            task_id,
            status: "queued".to_string(),
            message,
            queue_status: queue_status.to_string(),
        }
    }

    pub fn error(task_id: String, message: String) -> Self {
        Self {
            task_id,
            status: "error".to_string(),
            message,
            queue_status: "error".to_string(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TaskStatus {
    pub task_id: String,
    pub prompt: String,
    pub mode: String,
    pub status: String,
    pub queue_status: String,
    pub priority: String,
    pub progress: usize,
    pub total_steps: usize,
    pub current_event: Option<String>,
    pub current_attempt: u32,
    pub max_attempts: u32,
    pub duration_ms: Option<u64>,
    pub error: Option<String>,
    pub output: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub task_run: Option<TaskRun>,
}

impl TaskStatus {
    pub fn new(task_id: String, prompt: String, mode: String, priority: String, max_attempts: u32) -> Self {
        let task_run = task_run_for_queue_status(
            Some(task_id.clone()),
            parse_mode(&mode),
            prompt.clone(),
            TaskQueueStatus::Pending,
            None,
        );

        let mut status = Self {
            task_id,
            prompt,
            mode,
            status: String::new(),
            queue_status: String::new(),
            priority,
            progress: 0,
            total_steps: 0,
            current_event: None,
            current_attempt: 0,
            max_attempts,
            duration_ms: None,
            error: None,
            output: None,
            task_run: Some(task_run),
        };
        sync_task_status_from_task_run(&mut status);
        status
    }

    pub fn derived_queue_status(&self) -> String {
        self.task_run
            .as_ref()
            .and_then(|run| run.state.as_ref())
            .map(super::status::task_run_state_to_queue_status)
            .unwrap_or_else(|| self.queue_status.clone())
    }

    pub fn restored(task: &sacode_kernel::ScheduledTask, queue_status: TaskQueueStatus) -> Self {
        Self {
            task_id: task.id.clone(),
            prompt: task.task.prompt.clone(),
            mode: task.task.mode.to_string(),
            status: queue_status.to_string(),
            queue_status: queue_status.to_string(),
            priority: task.priority.to_string(),
            progress: 0,
            total_steps: 0,
            current_event: Some("task_restored".to_string()),
            current_attempt: task.current_attempt,
            max_attempts: task.retry_policy.max_attempts,
            duration_ms: None,
            error: None,
            output: None,
            task_run: None,
        }
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct StreamEvent {
    pub task_id: String,
    pub event_type: String,
    pub data: serde_json::Value,
}

pub struct DaemonState {
    pub event_bus: broadcast::Sender<StreamEvent>,
    pub tasks: RwLock<HashMap<String, TaskStatus>>,
    pub queue: Arc<TaskQueue>,
    pub executor: Mutex<TaskExecutor>,
    pub retry_handler: RetryHandler,
}

impl DaemonState {
    pub async fn new() -> Self {
        let (tx, _) = broadcast::channel(100);
        let mut queue_builder = TaskQueue::new(10);
        if let Ok(current_dir) = std::env::current_dir() {
            if let Ok(store) = StoreDb::from_workspace(&current_dir) {
                queue_builder = queue_builder.with_store(Arc::new(store));
            }
        }
        let queue = Arc::new(queue_builder);
        let restored_tasks = queue.restore_pending_tasks().await.unwrap_or_default();
        let tools = ToolRegistry::builtin();

        let executor = TaskExecutor::new(queue.clone(), tools.clone());
        let executor_event_bus = executor.event_bus();

        let retry_handler = RetryHandler::new(queue.clone(), executor_event_bus);

        let tasks = RwLock::new(HashMap::new());
        if restored_tasks > 0 {
            let mut restored_map = tasks.write().await;
            for task in queue.get_restorable_tasks().await {
                let queue_status = if task.dependencies.is_empty() {
                    TaskQueueStatus::Ready
                } else {
                    TaskQueueStatus::Pending
                };
                restored_map.insert(task.id.clone(), TaskStatus::restored(&task, queue_status));
            }
        }

        Self {
            event_bus: tx,
            tasks,
            queue,
            executor: Mutex::new(executor),
            retry_handler,
        }
    }
}
