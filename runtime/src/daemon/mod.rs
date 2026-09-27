use std::sync::Arc;

use axum::{
    extract::{Request, State},
    middleware::{self, Next},
    response::{IntoResponse, Response},
    routing::{delete, get, post, put},
    Router,
};
use sacode_kernel::{ExecutionMode, TaskPriority};

mod account;
mod approval;
mod automation;
mod design;
mod design_patch;
mod desktop_conversations;
mod events;
mod git_auth_routes;
mod handlers;
mod hooks_import_routes;
mod knowledge;
mod providers;
mod scheduler;
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
    apply_ui_patch, cancel_extraction, check_session_ui, confirm_ui_document, create_extraction,
    create_session, download_design_system, generate_images, generate_session, get_design_context,
    get_extraction, get_session, get_ui_document, import_design_system, list_design_resources,
    list_extractions, list_sessions, plan_session, propose_ui_patch, update_implementation_profile,
    update_session, update_ui_document,
};
use events::{
    spawn_daemon_workers, spawn_executor_event_forwarder, stream_api_events, stream_events,
    stream_task_events,
};
use handlers::{
    cancel_task, create_task, delete_task, get_audit_report, get_pending_tasks, get_queue_status,
    get_task_changes, get_task_checkpoint, get_task_result, get_task_status,
    get_workspace_capabilities, health_check, list_agents, list_audit_reports, list_tasks,
    list_tools, retry_task, run_audit_scan,
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
    let path = request.uri().path().to_string();
    let sensitive = path.starts_with("/account/") || path.starts_with("/providers/");
    let Ok(token) = std::env::var("SACODE_DAEMON_TOKEN") else {
        if sensitive {
            return (
                axum::http::StatusCode::FORBIDDEN,
                "desktop account management requires daemon authentication",
            )
                .into_response();
        }
        return next.run(request).await;
    };
    let token = token.trim().to_string();
    if token.is_empty() {
        if sensitive {
            return (
                axum::http::StatusCode::FORBIDDEN,
                "desktop account management requires daemon authentication",
            )
                .into_response();
        }
        return next.run(request).await;
    }
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
    scheduler::spawn_automation_scheduler(state.clone());

    let auth_layer = middleware::from_fn_with_state(state.clone(), optional_auth_middleware);

    Router::new()
        .route("/health", get(health_check))
        .merge(
            Router::new()
                .route("/task", post(create_task))
                .route("/tasks", get(list_tasks))
                .route(
                    "/api/desktop/conversations",
                    get(desktop_conversations::list).post(desktop_conversations::create),
                )
                .route(
                    "/api/desktop/conversations/:id",
                    get(desktop_conversations::get)
                        .post(desktop_conversations::append)
                        .delete(desktop_conversations::delete),
                )
                .route("/task/:id/status", get(get_task_status))
                .route("/task/:id/result", get(get_task_result))
                .route("/task/:id/changes", get(get_task_changes))
                .route("/task/:id/checkpoint", get(get_task_checkpoint))
                .route("/task/:id/retry", post(retry_task))
                .route("/task/:id/cancel", post(cancel_task))
                .route("/task/:id", delete(delete_task))
                .route("/task/:id/approve", post(approval::resolve_approval))
                .route("/task/:id/approvals", get(approval::list_task_approvals))
                .route("/events", get(stream_events))
                .route("/events/:id", get(stream_task_events))
                .route("/api/stream", get(stream_api_events))
                .route("/tools", get(list_tools))
                .route("/agents", get(list_agents))
                .route("/workspace/capabilities", get(get_workspace_capabilities))
                .route("/account/status", get(account::status))
                .route("/account/login", post(account::login))
                .route("/account/logout", post(account::logout))
                .route("/account/sync-models", post(account::sync_models))
                .route("/account/connections", post(account::register_connection))
                .route(
                    "/providers/local",
                    get(providers::list).post(providers::create),
                )
                .route(
                    "/providers/local/:name",
                    axum::routing::delete(providers::delete),
                )
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
                .route(
                    "/api/design/sessions/:id/ui",
                    get(get_ui_document).patch(update_ui_document),
                )
                .route(
                    "/api/design/sessions/:id/ui/patch/propose",
                    post(propose_ui_patch),
                )
                .route(
                    "/api/design/sessions/:id/ui/patch/apply",
                    post(apply_ui_patch),
                )
                .route("/api/design/sessions/:id/ui/check", get(check_session_ui))
                .route(
                    "/api/design/sessions/:id/ui/confirm",
                    post(confirm_ui_document),
                )
                .route(
                    "/api/design/sessions/:id/implementation",
                    put(update_implementation_profile),
                )
                .route("/api/design/sessions/:id/plan", post(plan_session))
                .route("/api/design/sessions/:id/generate", post(generate_session))
                .route(
                    "/api/design/systems/:id/download",
                    get(download_design_system),
                )
                .route("/api/design/systems/:id/import", post(import_design_system))
                .route("/api/design/images/generate", post(generate_images))
                .route("/api/knowledge/entries", get(knowledge::list_entries))
                .route("/api/knowledge/notes", post(knowledge::create_note))
                .route(
                    "/api/knowledge/notes/:id",
                    get(knowledge::get_note)
                        .put(knowledge::update_note)
                        .delete(knowledge::delete_note),
                )
                .route("/api/knowledge/search", get(knowledge::search_notes))
                .route(
                    "/api/automation/rules",
                    get(automation::list_rules).post(automation::create_rule),
                )
                .route(
                    "/api/automation/rules/:id",
                    put(automation::update_rule).delete(automation::delete_rule),
                )
                .route(
                    "/api/automation/rules/:id/toggle",
                    post(automation::toggle_rule),
                )
                .route("/api/automation/rules/:id/run", post(automation::run_rule))
                .route("/api/automation/history", get(automation::list_history))
                .route("/api/git-auth/status", get(git_auth_routes::status))
                .route(
                    "/api/git-auth/github/device",
                    post(git_auth_routes::github_device),
                )
                .route(
                    "/api/git-auth/github/poll",
                    post(git_auth_routes::github_poll),
                )
                .route(
                    "/api/git-auth/gitee/authorize",
                    post(git_auth_routes::gitee_authorize),
                )
                .route(
                    "/api/git-auth/gitee/callback",
                    post(git_auth_routes::gitee_callback),
                )
                .route("/api/git-auth/logout", post(git_auth_routes::logout))
                .route("/api/hooks", get(hooks_import_routes::list_hooks))
                .route("/api/import/tools", get(hooks_import_routes::list_tools))
                .route(
                    "/api/import/tools/:id/providers",
                    get(hooks_import_routes::list_tool_providers),
                )
                .route("/api/import/apply", post(hooks_import_routes::apply_import))
                .route("/metrics", get(approval::get_metrics))
                .route("/audit", post(run_audit_scan).get(list_audit_reports))
                .route("/audit/:id", get(get_audit_report))
                .route("/queue/status", get(get_queue_status))
                .route("/queue/pending", get(get_pending_tasks))
                .route_layer(auth_layer),
        )
        .with_state(state)
}

#[cfg(test)]
mod knowledge_automation_route_tests {
    use super::*;
    use axum::{
        body::{to_bytes, Body},
        http::{Request, StatusCode},
    };
    use tower::ServiceExt;

    #[tokio::test]
    async fn unavailable_skill_is_rejected_without_creating_task() {
        let tmp = tempfile::tempdir().unwrap();
        let app = create_daemon_in(tmp.path().to_path_buf()).await;
        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/task")
                    .header("content-type", "application/json")
                    .body(Body::from(
                        serde_json::json!({
                            "prompt": "hello", "mode": "build", "skill": "missing-skill"
                        })
                        .to_string(),
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::BAD_REQUEST);
        let payload: serde_json::Value =
            serde_json::from_slice(&to_bytes(response.into_body(), usize::MAX).await.unwrap())
                .unwrap();
        assert_eq!(payload["status"], "error");
        assert_eq!(payload["message"], "skill not available: missing-skill");
        let tasks = app
            .oneshot(
                Request::builder()
                    .uri("/tasks")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(tasks.status(), StatusCode::OK);
        let listed: serde_json::Value =
            serde_json::from_slice(&to_bytes(tasks.into_body(), usize::MAX).await.unwrap())
                .unwrap();
        assert!(listed["tasks"].as_array().unwrap().is_empty());
    }

    #[tokio::test]
    async fn desktop_conversation_keeps_turns_and_survives_restart() {
        let tmp = tempfile::tempdir().unwrap();
        let app = create_daemon_in(tmp.path().to_path_buf()).await;
        let request = |uri: &str, prompt: &str| {
            Request::builder()
                .method("POST")
                .uri(uri)
                .header("content-type", "application/json")
                .body(Body::from(
                    serde_json::json!({"prompt": prompt, "mode": "build"}).to_string(),
                ))
                .unwrap()
        };
        let response = app
            .clone()
            .oneshot(request("/api/desktop/conversations", "first turn"))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let first: serde_json::Value =
            serde_json::from_slice(&to_bytes(response.into_body(), usize::MAX).await.unwrap())
                .unwrap();
        let id = first["conversation_id"].as_str().unwrap();
        let first_id = first["task_id"].as_str().unwrap();
        for _ in 0..40 {
            let status = app
                .clone()
                .oneshot(
                    Request::builder()
                        .uri(format!("/task/{first_id}/status"))
                        .body(Body::empty())
                        .unwrap(),
                )
                .await
                .unwrap();
            let status: serde_json::Value =
                serde_json::from_slice(&to_bytes(status.into_body(), usize::MAX).await.unwrap())
                    .unwrap();
            if matches!(
                status["status"].as_str(),
                Some("completed" | "failed" | "cancelled")
            ) {
                break;
            }
            tokio::time::sleep(std::time::Duration::from_millis(50)).await;
        }
        let response = app
            .clone()
            .oneshot(request(
                &format!("/api/desktop/conversations/{id}"),
                "second turn",
            ))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let second: serde_json::Value =
            serde_json::from_slice(&to_bytes(response.into_body(), usize::MAX).await.unwrap())
                .unwrap();
        assert_eq!(second["conversation_id"], id);
        assert_ne!(second["task_id"], first_id);
        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .uri(format!("/api/desktop/conversations/{id}"))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        let detail: serde_json::Value =
            serde_json::from_slice(&to_bytes(response.into_body(), usize::MAX).await.unwrap())
                .unwrap();
        assert_eq!(detail["turns"].as_array().unwrap().len(), 2);
        let response = app
            .oneshot(
                Request::builder()
                    .uri("/api/desktop/conversations")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        let list: serde_json::Value =
            serde_json::from_slice(&to_bytes(response.into_body(), usize::MAX).await.unwrap())
                .unwrap();
        assert_eq!(list["conversations"].as_array().unwrap().len(), 1);
        let restarted = create_daemon_in(tmp.path().to_path_buf()).await;
        let response = restarted
            .clone()
            .oneshot(
                Request::builder()
                    .uri(format!("/api/desktop/conversations/{id}"))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        let detail: serde_json::Value =
            serde_json::from_slice(&to_bytes(response.into_body(), usize::MAX).await.unwrap())
                .unwrap();
        assert_eq!(detail["turns"].as_array().unwrap().len(), 2);
        let response = restarted
            .clone()
            .oneshot(
                Request::builder()
                    .method("DELETE")
                    .uri(format!("/api/desktop/conversations/{id}"))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let response = restarted
            .clone()
            .oneshot(
                Request::builder()
                    .uri(format!("/task/{first_id}/status"))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        let status: serde_json::Value =
            serde_json::from_slice(&to_bytes(response.into_body(), usize::MAX).await.unwrap())
                .unwrap();
        assert_eq!(status["status"], "not_found");
        let response = restarted
            .oneshot(
                Request::builder()
                    .uri("/api/desktop/conversations")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        let list: serde_json::Value =
            serde_json::from_slice(&to_bytes(response.into_body(), usize::MAX).await.unwrap())
                .unwrap();
        assert!(list["conversations"].as_array().unwrap().is_empty());
        let restarted_again = create_daemon_in(tmp.path().to_path_buf()).await;
        let response = restarted_again
            .oneshot(
                Request::builder()
                    .uri("/tasks")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        let tasks: serde_json::Value =
            serde_json::from_slice(&to_bytes(response.into_body(), usize::MAX).await.unwrap())
                .unwrap();
        assert!(tasks["tasks"].as_array().unwrap().is_empty());
    }

    #[tokio::test]
    async fn desktop_conversation_rejects_invalid_skill_without_orphan() {
        let tmp = tempfile::tempdir().unwrap();
        let app = create_daemon_in(tmp.path().to_path_buf()).await;
        let request = Request::builder()
            .method("POST")
            .uri("/api/desktop/conversations")
            .header("content-type", "application/json")
            .body(Body::from(
                serde_json::json!({"prompt": "hello", "mode": "build", "skill": "missing-skill"})
                    .to_string(),
            ))
            .unwrap();
        let response = app.clone().oneshot(request).await.unwrap();
        assert_eq!(response.status(), StatusCode::BAD_REQUEST);
        let body: serde_json::Value =
            serde_json::from_slice(&to_bytes(response.into_body(), usize::MAX).await.unwrap())
                .unwrap();
        assert_eq!(body["message"], "skill not available: missing-skill");
        let response = app
            .oneshot(
                Request::builder()
                    .uri("/api/desktop/conversations")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        let list: serde_json::Value =
            serde_json::from_slice(&to_bytes(response.into_body(), usize::MAX).await.unwrap())
                .unwrap();
        assert!(list["conversations"].as_array().unwrap().is_empty());
    }

    #[tokio::test]
    async fn knowledge_crud_search_and_automation_history_over_http() {
        let tmp = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(tmp.path().join("docs")).unwrap();
        std::fs::write(tmp.path().join("docs/guide.md"), "# 使用指南\n知识库内容").unwrap();
        let app = create_daemon_in(tmp.path().to_path_buf()).await;
        let call = |method: &str, uri: &str, body: serde_json::Value| {
            Request::builder()
                .method(method)
                .uri(uri)
                .header("content-type", "application/json")
                .body(Body::from(body.to_string()))
                .unwrap()
        };
        let response = app
            .clone()
            .oneshot(call(
                "POST",
                "/api/knowledge/notes",
                serde_json::json!({
                    "scope": "project", "title": "接口笔记", "content": "知识库测试"
                }),
            ))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
        let created: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
        let id = created["note"]["id"].as_str().unwrap();
        let response = app
            .clone()
            .oneshot(call(
                "GET",
                "/api/knowledge/search?scope=project&q=%E7%9F%A5%E8%AF%86",
                serde_json::json!({}),
            ))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let search: serde_json::Value =
            serde_json::from_slice(&to_bytes(response.into_body(), usize::MAX).await.unwrap())
                .unwrap();
        assert!(search["results"]
            .as_array()
            .unwrap()
            .iter()
            .any(|hit| hit["id"] == id));
        let response = app
            .clone()
            .oneshot(call(
                "GET",
                "/api/knowledge/notes/docs%2Fguide.md?scope=project",
                serde_json::json!({}),
            ))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let response = app
            .clone()
            .oneshot(call(
                "DELETE",
                "/api/knowledge/notes/docs%2Fguide.md?scope=project",
                serde_json::json!({}),
            ))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::BAD_REQUEST);
        let response = app
            .clone()
            .oneshot(call(
                "POST",
                "/api/automation/rules",
                serde_json::json!({
                    "name": "错误规则", "prompt": "检查", "cron_expr": "0 9 * * *", "enabled": true
                }),
            ))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::BAD_REQUEST);
        let response = app.clone().oneshot(call("POST", "/api/automation/rules", serde_json::json!({
            "name": "定时检查", "prompt": "检查", "cron_expr": "0 0 9 * * *", "enabled": true
        }))).await.unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let rule: serde_json::Value =
            serde_json::from_slice(&to_bytes(response.into_body(), usize::MAX).await.unwrap())
                .unwrap();
        assert!(rule["rule"]["next_run"].is_string());
        let response = app
            .oneshot(call(
                "GET",
                "/api/automation/history",
                serde_json::json!({}),
            ))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
    }
}

#[cfg(test)]
mod sensitive_route_tests {
    use super::*;
    use axum::{body::Body, http::Request};
    use tower::util::ServiceExt;

    #[tokio::test]
    async fn account_and_provider_routes_require_daemon_token() {
        let temp = tempfile::tempdir().unwrap();
        let router = create_daemon_in(temp.path().to_path_buf()).await;
        for (method, path) in [
            ("GET", "/account/status"),
            ("POST", "/account/login"),
            ("GET", "/providers/local"),
            ("POST", "/providers/local"),
            ("DELETE", "/providers/local/unknown"),
        ] {
            let response = router
                .clone()
                .oneshot(
                    Request::builder()
                        .method(method)
                        .uri(path)
                        .body(Body::empty())
                        .unwrap(),
                )
                .await
                .unwrap();
            assert!(
                matches!(
                    response.status(),
                    axum::http::StatusCode::FORBIDDEN | axum::http::StatusCode::UNAUTHORIZED
                ),
                "{method} {path}: {}",
                response.status()
            );
        }
    }
}

#[cfg(test)]
mod settings_center_route_tests {
    use super::*;
    use axum::{
        body::{to_bytes, Body},
        http::{Request, StatusCode},
    };
    use tower::ServiceExt;

    #[tokio::test]
    async fn git_auth_hooks_and_import_routes_respond_and_are_guarded() {
        let tmp = tempfile::tempdir().unwrap();
        let app = create_daemon_in(tmp.path().to_path_buf()).await;
        let get = |uri: &str| Request::builder().uri(uri).body(Body::empty()).unwrap();
        let post = |uri: &str, body: serde_json::Value| {
            Request::builder()
                .method("POST")
                .uri(uri)
                .header("content-type", "application/json")
                .body(Body::from(body.to_string()))
                .unwrap()
        };

        // git-auth 状态：本机可能未配置任何平台，但路由必须返回 200 与数组。
        let response = app
            .clone()
            .oneshot(get("/api/git-auth/status"))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let status: serde_json::Value =
            serde_json::from_slice(&to_bytes(response.into_body(), usize::MAX).await.unwrap())
                .unwrap();
        assert!(status["platforms"].is_array());

        // hooks：本机无配置时为空列表，且绝不执行钩子。
        let response = app.clone().oneshot(get("/api/hooks")).await.unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let hooks: serde_json::Value =
            serde_json::from_slice(&to_bytes(response.into_body(), usize::MAX).await.unwrap())
                .unwrap();
        assert_eq!(hooks["executed"], false);
        assert!(hooks["hooks"].is_array());

        // import 工具探测：返回数组，未知工具 id 必须 404。
        let response = app.clone().oneshot(get("/api/import/tools")).await.unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let tools: serde_json::Value =
            serde_json::from_slice(&to_bytes(response.into_body(), usize::MAX).await.unwrap())
                .unwrap();
        assert!(tools["tools"].is_array());

        let response = app
            .clone()
            .oneshot(get("/api/import/tools/does-not-exist/providers"))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::NOT_FOUND);

        // 空选择导入被拒绝，不会写入 provider.json。
        let response = app
            .clone()
            .oneshot(post(
                "/api/import/apply",
                serde_json::json!({
                    "tool": "codebuddy", "providers": []
                }),
            ))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::BAD_REQUEST);
        assert!(!tmp.path().join(".sacode/provider.json").exists());

        // 导入 apply 对未知工具返回 400 而不是 panic。
        let response = app
            .oneshot(post(
                "/api/import/apply",
                serde_json::json!({
                    "tool": "not-a-tool", "providers": ["x"]
                }),
            ))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    }

    #[tokio::test]
    async fn audit_static_tier_returns_heuristic_only_report() {
        let tmp = tempfile::tempdir().unwrap();
        std::fs::write(
            tmp.path().join("leak.rs"),
            "fn main() { let api = \"sk-abcdef1234567890\"; }\n",
        )
        .unwrap();
        let app = create_daemon_in(tmp.path().to_path_buf()).await;
        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/audit")
                    .header("content-type", "application/json")
                    .body(Body::from(
                        serde_json::json!({"scan_tier": "static"}).to_string(),
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let body: serde_json::Value =
            serde_json::from_slice(&to_bytes(response.into_body(), usize::MAX).await.unwrap())
                .unwrap();
        assert_eq!(body["status"], "completed");
        assert_eq!(body["scan_tier"], "static");
        assert_eq!(body["report"]["ai_used"], false);
        assert!(body["findings"].as_array().unwrap().len() >= 1);

        let audit_id = body["audit_id"].as_str().unwrap().to_string();
        assert!(body["report_json_path"].as_str().is_some());

        // 静态档报告也应可从详情路由重新打开。
        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .uri(format!("/audit/{audit_id}"))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let detail: serde_json::Value =
            serde_json::from_slice(&to_bytes(response.into_body(), usize::MAX).await.unwrap())
                .unwrap();
        assert_eq!(detail["status"], "found");
        assert_eq!(detail["report"]["ai_used"], false);

        let response = app
            .oneshot(
                Request::builder()
                    .uri("/audit")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let list: serde_json::Value =
            serde_json::from_slice(&to_bytes(response.into_body(), usize::MAX).await.unwrap())
                .unwrap();
        let reports = list["reports"].as_array().unwrap();
        assert!(reports.iter().any(|report| report["audit_id"] == audit_id));
    }
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
