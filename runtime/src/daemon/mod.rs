use std::sync::Arc;

use axum::{
    routing::{get, post},
    Router,
};
use sacode_kernel::{ExecutionMode, TaskPriority};

mod approval;
mod events;
mod handlers;
mod status;
mod types;

pub use approval::{resolve_approval, HttpApprovalDecider};
pub use handlers::run_daemon;
pub use types::{
    ApprovalResolution, DaemonState, EventHistory, PendingApproval, RetryPolicyRequest,
    StreamEvent, TaskRequest, TaskResponse, TaskStatus, DAEMON_EVENT_BUS_CAPACITY,
};

use events::{
    spawn_daemon_workers, spawn_executor_event_forwarder, stream_api_events, stream_events,
    stream_task_events,
};
use handlers::{
    cancel_task, create_task, get_pending_tasks, get_queue_status, get_task_checkpoint,
    get_task_result, get_task_status, health_check, list_tools, retry_task,
};

pub async fn create_daemon() -> Router {
    let state = Arc::new(DaemonState::new().await);
    build_router(state).await
}

/// 以显式工作目录构造 daemon（测试用独立临时目录，避免并行测试共享 SQLite store）
pub async fn create_daemon_in(dir: std::path::PathBuf) -> Router {
    let state = Arc::new(DaemonState::new_with_workdir(Some(dir)).await);
    build_router(state).await
}

/// 共享路由构建：注入审批工厂 + spawn worker + 注册端点
async fn build_router(state: Arc<DaemonState>) -> Router {
    // 注入 HTTP 审批决策器工厂（daemon 路径 build 模式下工具调用走 SSE→VSCode 审批）
    {
        let state_for_factory = state.clone();
        let mut executor = state.executor.lock().await;
        executor.set_approval_factory(Arc::new(move |task_id| {
            Arc::new(HttpApprovalDecider::new(
                state_for_factory.clone(),
                task_id.to_string(),
            ))
        }));
    }

    spawn_executor_event_forwarder(state.clone());
    spawn_daemon_workers(state.clone());

    Router::new()
        .route("/health", get(health_check))
        .route("/task", post(create_task))
        .route("/task/:id/status", get(get_task_status))
        .route("/task/:id/result", get(get_task_result))
        .route("/task/:id/checkpoint", get(get_task_checkpoint))
        .route("/task/:id/retry", post(retry_task))
        .route("/task/:id/cancel", post(cancel_task))
        .route("/task/:id/approve", post(approval::resolve_approval))
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
        "auto" | "yolo" => ExecutionMode::Yolo,
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
