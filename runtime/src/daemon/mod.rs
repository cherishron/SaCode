use std::{collections::HashMap, convert::Infallible, net::SocketAddr, sync::Arc};

use async_stream::stream;
use axum::{
    extract::{Path, State},
    response::sse::{Event, KeepAlive, Sse},
    routing::{get, post},
    Json, Router,
};
use tokio::sync::{broadcast, RwLock};
use serde::{Deserialize, Serialize};
use sacode_kernel::{Event as KernelEvent, ExecutionMode, Supervisor, Task};
use crate::tools::ToolRegistry;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TaskRequest {
    pub prompt: String,
    pub mode: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TaskResponse {
    pub task_id: String,
    pub status: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TaskStatus {
    pub task_id: String,
    pub prompt: String,
    pub mode: String,
    pub status: String,
    pub progress: usize,
    pub total_steps: usize,
    pub current_event: Option<String>,
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
}

impl DaemonState {
    pub fn new() -> Self {
        let (tx, _) = broadcast::channel(100);
        Self {
            event_bus: tx,
            tasks: RwLock::new(HashMap::new()),
        }
    }
}

pub async fn create_daemon() -> Router {
    let state = Arc::new(DaemonState::new());

    Router::new()
        .route("/health", get(health_check))
        .route("/task", post(create_task))
        .route("/task/:id/status", get(get_task_status))
        .route("/events", get(stream_events))
        .route("/events/:id", get(stream_task_events))
        .route("/tools", get(list_tools))
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
    let task = Task::new(req.prompt.clone(), mode, None);

    {
        let mut tasks = state.tasks.write().await;
        tasks.insert(
            task_id.clone(),
            TaskStatus {
                task_id: task_id.clone(),
                prompt: req.prompt.clone(),
                mode: req.mode.clone(),
                status: "created".to_string(),
                progress: 0,
                total_steps: 0,
                current_event: None,
            },
        );
    }

    emit_event(
        &state,
        &task_id,
        "task_created",
        serde_json::json!({ "prompt": req.prompt, "mode": req.mode }),
    );

    let state_for_task = Arc::clone(&state);
    let task_id_for_task = task_id.clone();
    tokio::spawn(async move {
        run_task(state_for_task, task_id_for_task, task).await;
    });

    Json(TaskResponse {
        task_id,
        status: "queued".to_string(),
        message: format!("Task created: {}", req.prompt),
    })
}

async fn get_task_status(
    State(state): State<Arc<DaemonState>>,
    Path(task_id): Path<String>,
) -> Json<serde_json::Value> {
    let tasks = state.tasks.read().await;

    if let Some(status) = tasks.get(&task_id) {
        return Json(serde_json::to_value(status).unwrap_or_else(|_| serde_json::json!({
            "task_id": task_id,
            "status": "error"
        })));
    }

    Json(serde_json::json!({
        "task_id": task_id,
        "status": "not_found",
        "progress": 0,
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

fn emit_event(state: &DaemonState, task_id: &str, event_type: &str, data: serde_json::Value) {
    let _ = state.event_bus.send(StreamEvent {
        task_id: task_id.to_string(),
        event_type: event_type.to_string(),
        data,
    });
}

async fn run_task(state: Arc<DaemonState>, task_id: String, task: Task) {
    {
        let mut tasks = state.tasks.write().await;
        if let Some(status) = tasks.get_mut(&task_id) {
            status.status = "running".to_string();
        }
    }

    emit_event(&state, &task_id, "task_started", serde_json::json!({}));

    let supervisor = Supervisor::new();
    let result = supervisor.execute(&task);
    let total_steps = result.output.plan.steps.len();

    {
        let mut tasks = state.tasks.write().await;
        if let Some(status) = tasks.get_mut(&task_id) {
            status.total_steps = total_steps;
        }
    }

    for (index, event) in result.output.events.iter().enumerate() {
        let event_name = daemon_event_name(event);
        emit_event(
            &state,
            &task_id,
            event_name,
            serde_json::to_value(event).unwrap_or_else(|_| serde_json::json!({})),
        );

        let mut tasks = state.tasks.write().await;
        if let Some(status) = tasks.get_mut(&task_id) {
            status.progress = index + 1;
            status.total_steps = total_steps.max(result.output.events.len());
            status.current_event = Some(event_name.to_string());
        }
    }

    {
        let mut tasks = state.tasks.write().await;
        if let Some(status) = tasks.get_mut(&task_id) {
            status.status = if result.output.events.iter().any(|evt| matches!(evt, KernelEvent::Error { .. })) {
                "failed".to_string()
            } else {
                "completed".to_string()
            };
            status.progress = status.total_steps;
        }
    }

    emit_event(
        &state,
        &task_id,
        "task_finished",
        serde_json::json!({
            "tool_calls": result.tool_calls.len(),
            "steps": result.output.plan.steps.len()
        }),
    );
}

fn daemon_event_name(event: &KernelEvent) -> &'static str {
    match event {
        KernelEvent::Message { .. } => "message",
        KernelEvent::Thinking { .. } => "thinking",
        KernelEvent::PlanGenerated { .. } => "plan_generated",
        KernelEvent::ToolCallStarted { .. } => "tool_call_started",
        KernelEvent::ToolCallFinished { .. } => "tool_call_finished",
        KernelEvent::ApprovalRequested { .. } => "approval_requested",
        KernelEvent::ApprovalResolved { .. } => "approval_resolved",
        KernelEvent::FileChanged { .. } => "file_changed",
        KernelEvent::CommandOutput { .. } => "command_output",
        KernelEvent::Done { .. } => "done",
        KernelEvent::Error { .. } => "error",
    }
}
