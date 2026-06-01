use std::{collections::HashMap, convert::Infallible, net::SocketAddr, sync::Arc};

use async_stream::stream;
use axum::{
    extract::{Path, State},
    response::sse::{Event, KeepAlive, Sse},
    routing::{get, post},
    Json, Router,
};
use tokio::sync::{broadcast, Mutex, RwLock};
use serde::{Deserialize, Serialize};
use sacode_kernel::{ExecutionMode, RetryPolicy, ScheduledTask, Task, TaskPriority, TaskQueueStatus, TaskRun};
use crate::tools::ToolRegistry;
use crate::queue::TaskQueue;
use crate::executor::TaskExecutor;
use crate::retry::RetryHandler;

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
    fn queued(task_id: String, queue_status: TaskQueueStatus, message: String) -> Self {
        Self {
            task_id,
            status: "queued".to_string(),
            message,
            queue_status: queue_status.to_string(),
        }
    }

    fn error(task_id: String, message: String) -> Self {
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
    fn new(task_id: String, prompt: String, mode: String, priority: String, max_attempts: u32) -> Self {
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

    fn derived_queue_status(&self) -> String {
        self.task_run
            .as_ref()
            .and_then(|run| run.state.as_ref())
            .map(task_run_state_to_queue_status)
            .unwrap_or_else(|| self.queue_status.clone())
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
    pub fn new() -> Self {
        let (tx, _) = broadcast::channel(100);
        let queue = Arc::new(TaskQueue::new(10));
        let tools = ToolRegistry::builtin();

        let executor = TaskExecutor::new(queue.clone(), tools.clone());
        let executor_event_bus = executor.event_bus();

        let retry_handler = RetryHandler::new(queue.clone(), executor_event_bus);

        Self {
            event_bus: tx,
            tasks: RwLock::new(HashMap::new()),
            queue,
            executor: Mutex::new(executor),
            retry_handler,
        }
    }
}

pub async fn create_daemon() -> Router {
    let state = Arc::new(DaemonState::new());
    spawn_executor_event_forwarder(state.clone());

    Router::new()
        .route("/health", get(health_check))
        .route("/task", post(create_task))
        .route("/task/:id/status", get(get_task_status))
        .route("/task/:id/result", get(get_task_result))
        .route("/task/:id/retry", post(retry_task))
        .route("/task/:id/cancel", post(cancel_task))
        .route("/events", get(stream_events))
        .route("/events/:id", get(stream_task_events))
        .route("/tools", get(list_tools))
        .route("/queue/status", get(get_queue_status))
        .route("/queue/pending", get(get_pending_tasks))
        .with_state(state)
}

async fn health_check() -> Json<serde_json::Value> {
    Json(serde_json::json!({
        "status": "healthy",
        "version": env!("CARGO_PKG_VERSION")
    }))
}

async fn create_task(
    State(state): State<Arc<DaemonState>>,
    Json(req): Json<TaskRequest>,
) -> Json<TaskResponse> {
    let task_id = format!("task-{}", chrono::Utc::now().timestamp_millis());
    let mode = parse_mode(&req.mode);
    let priority = parse_priority(&req.priority);
    let retry_policy = parse_retry_policy(&req.retry_policy);
    let task = Task::new(req.prompt.clone(), mode, None);

    let scheduled_task = ScheduledTask::new(task_id.clone(), task)
        .with_priority(priority)
        .with_dependencies(req.dependencies.clone())
        .with_retry_policy(retry_policy);

    {
        let mut tasks = state.tasks.write().await;
        tasks.insert(
            task_id.clone(),
            TaskStatus::new(
                task_id.clone(),
                req.prompt.clone(),
                req.mode.clone(),
                priority.to_string(),
                scheduled_task.retry_policy.max_attempts,
            ),
        );
    }

    emit_event(
        &state,
        &task_id,
        "task_created",
        serde_json::json!({ "prompt": req.prompt, "mode": req.mode, "priority": priority.to_string() }),
    );

    match state.queue.submit(scheduled_task).await {
        Ok(_) => {
            let mut executor = state.executor.lock().await;
            let spawned = executor.run_once().await;

            Json(TaskResponse::queued(
                task_id,
                if spawned > 0 {
                    TaskQueueStatus::Running
                } else {
                    TaskQueueStatus::Pending
                },
                "Task created and submitted to queue".to_string(),
            ))
        }
        Err(e) => Json(TaskResponse::error(task_id, format!("Failed to submit task: {}", e))),
    }
}

async fn get_task_status(
    State(state): State<Arc<DaemonState>>,
    Path(task_id): Path<String>,
) -> Json<serde_json::Value> {
    let tasks = state.tasks.read().await;

    if let Some(status) = tasks.get(&task_id) {
        let task_run = status.task_run.clone().or_else(|| {
            Some(task_run_for_queue_status(
                Some(status.task_id.clone()),
                parse_mode(&status.mode),
                status.prompt.clone(),
                parse_queue_status(&status.queue_status),
                status.output.clone().or_else(|| status.error.clone()),
            ))
        });
        let derived_status = status.derived_queue_status();
        return Json(serde_json::json!({
            "task_id": status.task_id,
            "prompt": status.prompt,
            "mode": status.mode,
            "status": derived_status,
            "queue_status": derived_status,
            "priority": status.priority,
            "progress": status.progress,
            "total_steps": status.total_steps,
            "current_event": status.current_event,
            "current_attempt": status.current_attempt,
            "max_attempts": status.max_attempts,
            "duration_ms": status.duration_ms,
            "error": status.error,
            "output": status.output,
            "task_run": task_run,
        }));
    }

    if let Some(queue_status) = state.queue.status(&task_id).await {
        if let Some(task) = state.queue.get_task(&task_id).await {
            let task_run = task_run_for_queue_status(
                Some(task.id.clone()),
                task.task.mode,
                task.task.prompt.clone(),
                queue_status,
                None,
            );
            let derived = task_run
                .state
                .as_ref()
                .map(task_run_state_to_queue_status)
                .unwrap_or_else(|| "pending".to_string());
            return Json(serde_json::json!({
                "task_id": task_id,
                "prompt": task.task.prompt,
                "mode": task.task.mode.to_string(),
                "status": derived.clone(),
                "queue_status": derived,
                "priority": task.priority.to_string(),
                "current_attempt": task.current_attempt,
                "max_attempts": task.retry_policy.max_attempts,
                "task_run": task_run,
            }));
        }
    }

    if let Some(result) = state.queue.get_result(&task_id).await {
        let task_run = state.queue.get_task_run(&task_id).await.unwrap_or_else(|| {
            task_run_for_queue_status(
                Some(result.task_id.clone()),
                ExecutionMode::Build,
                String::new(),
                result.status.clone(),
                result.output.clone().or_else(|| result.error.clone()),
            )
        });
        let derived = task_run
            .state
            .as_ref()
            .map(task_run_state_to_queue_status)
            .unwrap_or_else(|| "not_found".to_string());
        return Json(serde_json::json!({
            "task_id": task_id,
            "status": derived.clone(),
            "queue_status": derived,
            "duration_ms": result.duration_ms,
            "error": result.error,
            "output": result.output,
            "task_run": task_run,
        }));
    }

    Json(serde_json::json!({
        "task_id": task_id,
        "status": "not_found",
        "queue_status": "not_found",
    }))
}

async fn get_task_result(
    State(state): State<Arc<DaemonState>>,
    Path(task_id): Path<String>,
) -> Json<serde_json::Value> {
    {
        let tasks = state.tasks.read().await;
        if let Some(status) = tasks.get(&task_id) {
            let derived_status = status.derived_queue_status();
            return Json(serde_json::json!({
                "task_id": status.task_id.clone(),
                "status": derived_status.clone(),
                "queue_status": derived_status,
                "duration_ms": status.duration_ms,
                "error": status.error.clone(),
                "output": status.output.clone(),
                "task_run": status.task_run.clone(),
            }));
        }
    }

    if let Some(result) = state.queue.get_result(&task_id).await {
        let task_run = state.queue.get_task_run(&task_id).await.unwrap_or_else(|| {
            task_run_for_queue_status(
                Some(result.task_id.clone()),
                ExecutionMode::Build,
                String::new(),
                result.status.clone(),
                result.output.clone().or_else(|| result.error.clone()),
            )
        });
        let derived = task_run
            .state
            .as_ref()
            .map(task_run_state_to_queue_status)
            .unwrap_or_else(|| "not_found".to_string());
        return Json(serde_json::json!({
            "task_id": result.task_id,
            "status": derived,
            "queue_status": derived,
            "output": result.output,
            "error": result.error,
            "duration_ms": result.duration_ms,
            "completed_at": result.completed_at,
            "task_run": task_run,
        }));
    }

    Json(serde_json::json!({
        "task_id": task_id,
        "status": "not_found",
        "queue_status": "not_found",
        "message": "Task result not available yet",
    }))
}

async fn retry_task(
    State(state): State<Arc<DaemonState>>,
    Path(task_id): Path<String>,
) -> Json<serde_json::Value> {
    let queue_status = state.queue.status(&task_id).await;

    if queue_status != Some(TaskQueueStatus::Failed) {
        return Json(serde_json::json!({
            "task_id": task_id,
            "status": "error",
            "message": "Task is not in failed state, cannot retry",
        }));
    }

    if let Some(mut task) = state.queue.get_task(&task_id).await {
        if !task.can_retry() {
            return Json(serde_json::json!({
                "task_id": task_id,
                "status": "error",
                "message": "Task has exceeded max retry attempts",
            }));
        }

        task.increment_attempt();

        match state.queue.submit(task).await {
            Ok(_) => {
                let mut executor = state.executor.lock().await;
                executor.run_once().await;

                Json(serde_json::json!({
                    "task_id": task_id,
                    "status": "queued",
                    "message": "Task retry submitted",
                }))
            }
            Err(e) => {
                Json(serde_json::json!({
                    "task_id": task_id,
                    "status": "error",
                    "message": format!("Failed to submit retry: {}", e),
                }))
            }
        }
    } else {
        Json(serde_json::json!({
            "task_id": task_id,
            "status": "error",
            "message": "Task not found in queue",
        }))
    }
}

async fn cancel_task(
    State(state): State<Arc<DaemonState>>,
    Path(task_id): Path<String>,
) -> Json<serde_json::Value> {
    let cancelled = state.queue.cancel(&task_id).await;

    if cancelled {
        {
            let mut tasks = state.tasks.write().await;
            if let Some(status) = tasks.get_mut(&task_id) {
                status.task_run = Some(task_run_for_queue_status(
                    Some(status.task_id.clone()),
                    parse_mode(&status.mode),
                    status.prompt.clone(),
                    TaskQueueStatus::Failed,
                    Some("Task cancelled".to_string()),
                ));
                status.error = Some("Task cancelled".to_string());
                sync_task_status_from_task_run(status);
            }
        }
        emit_event(&state, &task_id, "task_cancelled", serde_json::json!({}));
        Json(serde_json::json!({
            "task_id": task_id,
            "status": "cancelled",
            "message": "Task cancelled successfully",
        }))
    } else {
        Json(serde_json::json!({
            "task_id": task_id,
            "status": "error",
            "message": "Task cannot be cancelled (not in pending/ready/running state)",
        }))
    }
}

async fn get_queue_status(
    State(state): State<Arc<DaemonState>>,
) -> Json<serde_json::Value> {
    let stats = state.queue.stats().await;
    Json(serde_json::to_value(stats).unwrap_or_else(|_| serde_json::json!({
        "error": "Failed to get queue stats"
    })))
}

async fn get_pending_tasks(
    State(state): State<Arc<DaemonState>>,
) -> Json<serde_json::Value> {
    let stats = state.queue.stats().await;
    Json(serde_json::json!({
        "pending_count": stats.pending_count,
        "ready_count": stats.ready_count,
        "running_count": stats.running_count,
        "total_queued": stats.pending_count + stats.ready_count + stats.running_count,
    }))
}

async fn stream_events(
    State(state): State<Arc<DaemonState>>,
) -> Sse<impl futures::Stream<Item = Result<Event, Infallible>>> {
    let mut receiver = state.event_bus.subscribe();

    let stream = stream! {
        loop {
            match receiver.recv().await {
                Ok(evt) => {
                    let payload = serde_json::to_string(&evt).unwrap_or_else(|_| "{}".to_string());
                    yield Ok(Event::default().event(evt.event_type.clone()).data(payload));
                }
                Err(broadcast::error::RecvError::Lagged(_)) => continue,
                Err(broadcast::error::RecvError::Closed) => break,
            }
        }
    };

    Sse::new(stream).keep_alive(KeepAlive::default())
}

async fn stream_task_events(
    State(state): State<Arc<DaemonState>>,
    Path(task_id): Path<String>,
) -> Sse<impl futures::Stream<Item = Result<Event, Infallible>>> {
    let mut receiver = state.event_bus.subscribe();

    let stream = stream! {
        loop {
            match receiver.recv().await {
                Ok(evt) if evt.task_id == task_id => {
                    let payload = serde_json::to_string(&evt).unwrap_or_else(|_| "{}".to_string());
                    yield Ok(Event::default().event(evt.event_type.clone()).data(payload));
                }
                Ok(_) => continue,
                Err(broadcast::error::RecvError::Lagged(_)) => continue,
                Err(broadcast::error::RecvError::Closed) => break,
            }
        }
    };

    Sse::new(stream).keep_alive(KeepAlive::default())
}

async fn list_tools() -> Json<serde_json::Value> {
    let registry = ToolRegistry::builtin();
    Json(serde_json::json!({
        "tools": registry.names(),
    }))
}

pub async fn run_daemon(addr: SocketAddr) {
    let app = create_daemon().await;

    let listener = tokio::net::TcpListener::bind(addr).await.unwrap();
    axum::serve(listener, app).await.unwrap();
}

fn parse_mode(mode: &str) -> ExecutionMode {
    match mode {
        "plan" => ExecutionMode::Plan,
        "yolo" => ExecutionMode::Yolo,
        _ => ExecutionMode::Build,
    }
}

fn parse_priority(priority: &str) -> TaskPriority {
    match priority {
        "low" => TaskPriority::Low,
        "high" => TaskPriority::High,
        "urgent" => TaskPriority::Urgent,
        _ => TaskPriority::Normal,
    }
}

fn parse_retry_policy(req: &Option<RetryPolicyRequest>) -> RetryPolicy {
    match req {
        Some(policy) => {
            let backoff = match policy.backoff_type.as_str() {
                "fixed" => sacode_kernel::BackoffStrategy::Fixed { delay_ms: policy.base_ms },
                "linear" => sacode_kernel::BackoffStrategy::Linear { increment_ms: policy.base_ms },
                _ => sacode_kernel::BackoffStrategy::Exponential {
                    base_ms: policy.base_ms,
                    max_ms: policy.max_ms,
                },
            };

            let retry_on = policy.retry_on.iter().filter_map(|s| {
                match s.as_str() {
                    "timeout" => Some(sacode_kernel::RetryCondition::Timeout),
                    "network_error" => Some(sacode_kernel::RetryCondition::NetworkError),
                    "rate_limit" => Some(sacode_kernel::RetryCondition::RateLimit),
                    "resource_exhausted" => Some(sacode_kernel::RetryCondition::ResourceExhausted),
                    "internal_error" => Some(sacode_kernel::RetryCondition::InternalError),
                    "any" => Some(sacode_kernel::RetryCondition::Any),
                    _ => None,
                }
            }).collect();

            RetryPolicy {
                max_attempts: policy.max_attempts,
                backoff,
                retry_on,
            }
        }
        None => RetryPolicy::default(),
    }
}

fn task_run_state_to_queue_status(state: &sacode_kernel::TaskRunState) -> String {
    match state {
        sacode_kernel::TaskRunState::Completed => TaskQueueStatus::Completed.to_string(),
        sacode_kernel::TaskRunState::Failed => TaskQueueStatus::Failed.to_string(),
        sacode_kernel::TaskRunState::WaitingForApproval | sacode_kernel::TaskRunState::WaitingForUser => {
            TaskQueueStatus::Running.to_string()
        }
    }
}

fn parse_queue_status(status: &str) -> TaskQueueStatus {
    match status {
        "ready" => TaskQueueStatus::Ready,
        "running" => TaskQueueStatus::Running,
        "completed" => TaskQueueStatus::Completed,
        "failed" => TaskQueueStatus::Failed,
        "retrying" => TaskQueueStatus::Retrying,
        "cancelled" => TaskQueueStatus::Cancelled,
        _ => TaskQueueStatus::Pending,
    }
}

fn task_run_state_for_queue_status(status: &TaskQueueStatus) -> sacode_kernel::TaskRunState {
    match status {
        TaskQueueStatus::Completed => sacode_kernel::TaskRunState::Completed,
        TaskQueueStatus::Failed => sacode_kernel::TaskRunState::Failed,
        TaskQueueStatus::Cancelled => sacode_kernel::TaskRunState::Failed,
        TaskQueueStatus::Pending
        | TaskQueueStatus::Ready
        | TaskQueueStatus::Running
        | TaskQueueStatus::Retrying => {
            sacode_kernel::TaskRunState::WaitingForUser
        }
    }
}

fn task_run_for_queue_status(
    task_id: Option<String>,
    mode: ExecutionMode,
    prompt: String,
    queue_status: TaskQueueStatus,
    output_text: Option<String>,
) -> TaskRun {
    crate::task_run_snapshot(
        task_id,
        mode,
        prompt,
        task_run_state_for_queue_status(&queue_status),
        output_text,
    )
}

fn sync_task_status_from_task_run(status: &mut TaskStatus) {
    let queue_status = status.derived_queue_status();
    status.queue_status = queue_status.clone();
    status.status = queue_status;
}

fn emit_event(state: &DaemonState, task_id: &str, event_type: &str, data: serde_json::Value) {
    let _ = state.event_bus.send(StreamEvent {
        task_id: task_id.to_string(),
        event_type: event_type.to_string(),
        data,
    });
}

fn spawn_executor_event_forwarder(state: Arc<DaemonState>) {
    tokio::spawn(async move {
        let mut receiver = {
            let executor = state.executor.lock().await;
            executor.subscribe()
        };

        loop {
            match receiver.recv().await {
                Ok(evt) => {
                    update_task_status_from_executor_event(&state, &evt).await;
                    let _ = state.event_bus.send(StreamEvent {
                        task_id: evt.task_id,
                        event_type: evt.event_type,
                        data: evt.data,
                    });
                }
                Err(broadcast::error::RecvError::Lagged(_)) => continue,
                Err(broadcast::error::RecvError::Closed) => break,
            }
        }
    });
}

async fn update_task_status_from_executor_event(state: &Arc<DaemonState>, evt: &crate::executor::ExecutorEvent) {
    let mut tasks = state.tasks.write().await;
    let Some(status) = tasks.get_mut(&evt.task_id) else {
        return;
    };

    status.current_event = Some(evt.event_type.clone());

    match evt.event_type.as_str() {
        "task_started" => {
            status.task_run = Some(task_run_for_queue_status(
                Some(status.task_id.clone()),
                parse_mode(&status.mode),
                status.prompt.clone(),
                TaskQueueStatus::Running,
                None,
            ));
            sync_task_status_from_task_run(status);
        }
        "task_completed" | "task_failed" => {
            if let Some(result_value) = evt.data.get("result") {
                if let Ok(result) = serde_json::from_value::<sacode_kernel::TaskResult>(result_value.clone()) {
                    status.duration_ms = Some(result.duration_ms);
                    status.output = result.output.clone();
                    status.error = result.error.clone();
                }
            }
            if let Some(task_run_value) = evt.data.get("task_run") {
                if let Ok(task_run) = serde_json::from_value::<TaskRun>(task_run_value.clone()) {
                    status.task_run = Some(task_run);
                }
            }
            sync_task_status_from_task_run(status);
        }
        _ => {}
    }
}
