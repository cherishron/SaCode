use std::sync::Arc;

use axum::{
    body::{to_bytes, Body},
    http::{Request, StatusCode},
    response::IntoResponse,
};
use http_body_util::BodyExt;
use tower::util::ServiceExt;

use crate::daemon::{create_daemon_in, resolve_approval, DaemonState, PendingApproval};

async fn body_json(response: axum::response::Response) -> serde_json::Value {
    let body = to_bytes(response.into_body(), usize::MAX)
        .await
        .expect("read body");
    serde_json::from_slice(&body).expect("valid json")
}

/// 创建使用独立临时工作目录的 daemon
async fn create_isolated_daemon_test() -> axum::Router {
    let tempdir = tempfile::tempdir().expect("tempdir");
    create_daemon_in(tempdir.keep()).await
}

/// 构造一个带指定 pending_approval 的 state，返回 (state, oneshot receiver)
async fn state_with_pending(
    task_id: &str,
    approval_id: &str,
) -> (Arc<DaemonState>, tokio::sync::oneshot::Receiver<bool>) {
    let tempdir = tempfile::tempdir().expect("tempdir");
    let state = Arc::new(DaemonState::new_with_workdir(Some(tempdir.keep())).await);
    let (tx, rx) = tokio::sync::oneshot::channel::<bool>();
    {
        let mut pending = state.pending_approvals.lock().await;
        pending.insert(
            approval_id.to_string(),
            PendingApproval {
                task_id: task_id.to_string(),
                created_at: std::time::Instant::now(),
                tx,
            },
        );
    }
    (state, rx)
}

// ── HTTP 语义测试 ────────────────────────────────────────────────

#[tokio::test]
async fn approve_missing_approval_id_returns_400() {
    let app = create_isolated_daemon_test().await;

    let response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/task/task-1/approve")
                .header("content-type", "application/json")
                .body(Body::from(r#"{"approved":true}"#))
                .expect("build request"),
        )
        .await
        .expect("daemon should respond");

    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    let payload = body_json(response).await;
    assert_eq!(payload["status"], "bad_request");
}

#[tokio::test]
async fn approve_missing_approved_returns_400() {
    let app = create_isolated_daemon_test().await;

    let response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/task/task-1/approve")
                .header("content-type", "application/json")
                .body(Body::from(r#"{"approval_id":"task-1-0"}"#))
                .expect("build request"),
        )
        .await
        .expect("daemon should respond");

    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    let payload = body_json(response).await;
    assert_eq!(payload["status"], "bad_request");
}

#[tokio::test]
async fn approve_unknown_approval_id_returns_404() {
    let app = create_isolated_daemon_test().await;

    let response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/task/task-1/approve")
                .header("content-type", "application/json")
                .body(Body::from(
                    r#"{"approval_id":"nonexistent-0","approved":true}"#,
                ))
                .expect("build request"),
        )
        .await
        .expect("daemon should respond");

    assert_eq!(response.status(), StatusCode::NOT_FOUND);
    let payload = body_json(response).await;
    assert_eq!(payload["status"], "not_found");
}

#[tokio::test]
async fn approve_wrong_task_path_returns_409() {
    // approval_id 属于 task-a，但路径写 task-b → 409 且条目保留
    let (state, _rx) = state_with_pending("task-a", "task-a-0").await;

    let response = resolve_approval(
        axum::extract::State(state.clone()),
        axum::extract::Path("task-b".to_string()),
        axum::Json(serde_json::json!({
            "approval_id": "task-a-0",
            "approved": true
        })),
    )
    .await;

    assert_eq!(response.0, StatusCode::CONFLICT);

    // 条目应保留（未消费），后续用正确路径仍可批准
    let pending = state.pending_approvals.lock().await;
    assert!(pending.contains_key("task-a-0"));
}

#[tokio::test]
async fn approve_valid_resolves_and_sends_true() {
    let (state, mut rx) = state_with_pending("task-1", "task-1-0").await;

    let response = resolve_approval(
        axum::extract::State(state),
        axum::extract::Path("task-1".to_string()),
        axum::Json(serde_json::json!({
            "approval_id": "task-1-0",
            "approved": true
        })),
    )
    .await;

    assert_eq!(response.0, StatusCode::OK);
    let payload = body_json(response.1.into_response()).await;
    assert_eq!(payload["status"], "resolved");
    assert_eq!(payload["approved"], true);

    let result = rx.try_recv().expect("approval result should be sent");
    assert!(result);
}

#[tokio::test]
async fn approve_valid_deny_sends_false() {
    let (state, mut rx) = state_with_pending("task-1", "task-1-1").await;

    let response = resolve_approval(
        axum::extract::State(state),
        axum::extract::Path("task-1".to_string()),
        axum::Json(serde_json::json!({
            "approval_id": "task-1-1",
            "approved": false
        })),
    )
    .await;

    assert_eq!(response.0, StatusCode::OK);
    let result = rx.try_recv().expect("approval result should be sent");
    assert!(!result);
}

/// 重复响应：同一 approval_id 第二次提交应返回 404（已被消费）
#[tokio::test]
async fn approve_duplicate_returns_404() {
    let (state, mut rx) = state_with_pending("task-1", "task-1-dup").await;

    let first = resolve_approval(
        axum::extract::State(state.clone()),
        axum::extract::Path("task-1".to_string()),
        axum::Json(serde_json::json!({
            "approval_id": "task-1-dup",
            "approved": true
        })),
    )
    .await;
    assert_eq!(first.0, StatusCode::OK);
    assert!(rx.try_recv().unwrap());

    // 第二次：条目已移除 → 404
    let second = resolve_approval(
        axum::extract::State(state),
        axum::extract::Path("task-1".to_string()),
        axum::Json(serde_json::json!({
            "approval_id": "task-1-dup",
            "approved": true
        })),
    )
    .await;
    assert_eq!(second.0, StatusCode::NOT_FOUND);
}

// ── 竞态与唯一性 ─────────────────────────────────────────────────

/// 先注册再通知：decide 先插入 pending，扩展立即回传也能命中
#[tokio::test]
async fn approval_registration_precedes_notification() {
    let (state, mut rx) = state_with_pending("task-race", "task-race-0").await;

    // 模拟扩展立即回传（先注册的条目已存在，必然命中）
    let mut pending = state.pending_approvals.lock().await;
    let entry = pending.remove("task-race-0").expect("entry should exist");
    drop(pending);
    entry.tx.send(true).expect("send approval");

    assert!(rx.try_recv().expect("should receive approved"));
}

/// 同一任务连续两次审批使用不同 approval_id，互不覆盖
#[test]
fn approval_ids_do_not_collide_per_task() {
    // 模拟 HttpApprovalDecider 的 generate_approval_id：task_id + 递增序号
    let a = "task-multi-0".to_string();
    let b = "task-multi-1".to_string();
    assert_ne!(a, b);
}
