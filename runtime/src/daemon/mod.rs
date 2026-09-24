use std::sync::Arc;

use axum::{
    extract::{Request, State},
    middleware::{self, Next},
    response::{IntoResponse, Response},
    routing::{get, post},
    Router,
};
use sacode_kernel::{ExecutionMode, TaskPriority};

mod approval;
mod design;
mod events;
mod handlers;
mod sidecar;
mod status;
mod types;

pub use approval::{get_metrics, list_task_approvals, resolve_approval, HttpApprovalDecider};
pub use handlers::run_daemon;
pub use sidecar::{run_daemon_with_options, DaemonBindOptions, DaemonReadyInfo};
pub use types::{
    ApprovalMetrics, ApprovalResolution, AuditReportSummary, AuditRequest, DaemonMetrics,
    DaemonState, EventHistory, PendingApproval, RetryPolicyRequest, SseMetrics, StreamEvent,
    TaskRequest, TaskResponse, TaskStatus, DAEMON_EVENT_BUS_CAPACITY,
};

use design::{
    cancel_extraction, create_extraction, create_session, download_design_system, generate_images,
    generate_session, get_design_context, get_extraction, get_session, import_design_system,
    list_design_resources, list_extractions, list_sessions, plan_session, update_session,
};
use events::{
    spawn_daemon_workers, spawn_executor_event_forwarder, stream_api_events, stream_events,
    stream_task_events,
};
use handlers::{
    cancel_task, create_task, get_audit_report, get_pending_tasks, get_queue_status,
    get_task_changes, get_task_checkpoint, get_task_result, get_task_status, health_check,
    list_agents, list_audit_reports, list_tasks, list_tools, retry_task, run_audit_scan,
};

pub async fn create_daemon() -> Router {
    let state = Arc::new(DaemonState::new().await);
    maybe_register_opencode_from_env(&state).await;
    build_router(state).await
}

/// 以显式工作目录构造 daemon（测试用独立临时目录，避免并行测试共享 SQLite store）
pub async fn create_daemon_in(dir: std::path::PathBuf) -> Router {
    let state = Arc::new(DaemonState::new_with_workdir(Some(dir)).await);
    build_router(state).await
}

/// Auto-register OpenCode ACP backend when SACODE_OPENCODE_EXECUTABLE is set (M4).
///
/// Optional `SACODE_OPENCODE_ARGS` (space-separated) is prepended to ACP args.
/// Example (bun-resolved CLI):
///   SACODE_OPENCODE_EXECUTABLE=C:\\...\\bun.exe
///   SACODE_OPENCODE_ARGS=x opencode-ai acp
async fn maybe_register_opencode_from_env(state: &Arc<DaemonState>) {
    let Ok(path) = std::env::var("SACODE_OPENCODE_EXECUTABLE") else {
        return;
    };
    if path.trim().is_empty() {
        return;
    }
    let mut cfg = crate::agent_backends::AcpBackendConfig::opencode(path.trim());
    if let Ok(args) = std::env::var("SACODE_OPENCODE_ARGS") {
        let args: Vec<String> = args
            .split_whitespace()
            .map(|s| s.to_string())
            .filter(|s| !s.is_empty())
            .collect();
        if !args.is_empty() {
            cfg.args = args;
            cfg.display_name = "OpenCode".to_string();
        }
    }
    if let Ok(cwd) = std::env::var("SACODE_OPENCODE_CWD") {
        if !cwd.trim().is_empty() {
            cfg.cwd = Some(std::path::PathBuf::from(cwd.trim()));
        }
    }
    state
        .agent_backends
        .register(cfg.descriptor(sacode_kernel::AgentBackendHealth::Unknown));
    {
        let executor = state.executor.lock().await;
        executor.set_acp_backend(cfg).await;
    }
    tracing::info!("registered opencode ACP backend from SACODE_OPENCODE_EXECUTABLE");
}

/// Optional bearer auth for daemon when SACODE_DAEMON_TOKEN is set.
/// `/health` stays open for liveness probes.
async fn optional_auth_middleware(
    State(_state): State<Arc<DaemonState>>,
    request: Request,
    next: Next,
) -> Response {
    let Ok(token) = std::env::var("SACODE_DAEMON_TOKEN") else {
        return next.run(request).await;
    };
    let token = token.trim().to_string();
    if token.is_empty() {
        return next.run(request).await;
    }
    let path = request.uri().path().to_string();
    if path == "/health" {
        return next.run(request).await;
    }
    let authorized = request
        .headers()
        .get(axum::http::header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "))
        .map(|provided| subtle_eq(provided.trim(), token.as_str()))
        .unwrap_or(false);
    if authorized {
        next.run(request).await
    } else {
        (axum::http::StatusCode::UNAUTHORIZED, "unauthorized").into_response()
    }
}

fn subtle_eq(a: &str, b: &str) -> bool {
    if a.len() != b.len() {
        return false;
    }
    a.bytes()
        .zip(b.bytes())
        .fold(0u8, |acc, (x, y)| acc | (x ^ y))
        == 0
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

    let auth_layer = middleware::from_fn_with_state(state.clone(), optional_auth_middleware);

    Router::new()
        .route("/health", get(health_check))
        .merge(
            Router::new()
                .route("/task", post(create_task))
                .route("/tasks", get(list_tasks))
                .route("/task/:id/status", get(get_task_status))
                .route("/task/:id/result", get(get_task_result))
                .route("/task/:id/changes", get(get_task_changes))
                .route("/task/:id/checkpoint", get(get_task_checkpoint))
                .route("/task/:id/retry", post(retry_task))
                .route("/task/:id/cancel", post(cancel_task))
                .route("/task/:id/approve", post(approval::resolve_approval))
                .route("/task/:id/approvals", get(approval::list_task_approvals))
                .route("/events", get(stream_events))
                .route("/events/:id", get(stream_task_events))
                .route("/api/stream", get(stream_api_events))
                .route("/tools", get(list_tools))
                .route("/agents", get(list_agents))
                .route("/api/design/context", get(get_design_context))
                .route("/api/design/resources", get(list_design_resources))
                .route(
                    "/api/design/extractions",
                    post(create_extraction).get(list_extractions),
                )
                .route("/api/design/extractions/:id", get(get_extraction))
                .route(
                    "/api/design/extractions/:id/cancel",
                    post(cancel_extraction),
                )
                .route(
                    "/api/design/sessions",
                    post(create_session).get(list_sessions),
                )
                .route(
                    "/api/design/sessions/:id",
                    get(get_session).post(update_session),
                )
                .route("/api/design/sessions/:id/plan", post(plan_session))
                .route("/api/design/sessions/:id/generate", post(generate_session))
                .route(
                    "/api/design/systems/:id/download",
                    get(download_design_system),
                )
                .route("/api/design/systems/:id/import", post(import_design_system))
                .route("/api/design/images/generate", post(generate_images))
                .route("/metrics", get(approval::get_metrics))
                .route("/audit", post(run_audit_scan).get(list_audit_reports))
                .route("/audit/:id", get(get_audit_report))
                .route("/queue/status", get(get_queue_status))
                .route("/queue/pending", get(get_pending_tasks))
                .route_layer(auth_layer),
        )
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
