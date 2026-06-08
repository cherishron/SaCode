use std::sync::Arc;

use axum::{
    routing::{get, post},
    Router,
};
use sacode_kernel::{ExecutionMode, TaskPriority};

mod events;
mod handlers;
mod status;
mod types;

pub use handlers::run_daemon;
pub use types::{
    DaemonState, RetryPolicyRequest, StreamEvent, TaskRequest, TaskResponse, TaskStatus,
};

use events::{
    spawn_daemon_workers, spawn_executor_event_forwarder, stream_api_events, stream_events,
    stream_task_events,
};
use handlers::{
    cancel_task, create_task, get_pending_tasks, get_queue_status, get_task_result,
    get_task_status, health_check, list_tools, retry_task,
};

pub async fn create_daemon() -> Router {
    let state = Arc::new(DaemonState::new().await);
    spawn_executor_event_forwarder(state.clone());
    spawn_daemon_workers(state.clone());

    Router::new()
        .route("/health", get(health_check))
        .route("/task", post(create_task))
        .route("/task/:id/status", get(get_task_status))
        .route("/task/:id/result", get(get_task_result))
        .route("/task/:id/retry", post(retry_task))
        .route("/task/:id/cancel", post(cancel_task))
        .route("/events", get(stream_events))
        .route("/events/:id", get(stream_task_events))
        .route("/api/stream", get(stream_api_events))
        .route("/tools", get(list_tools))
        .route("/queue/status", get(get_queue_status))
        .route("/queue/pending", get(get_pending_tasks))
        .with_state(state)
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
