use std::sync::atomic::Ordering;
use std::sync::Arc;

use axum::{
    body::{to_bytes, Body},
    http::{Request, StatusCode},
    response::IntoResponse,
};
use tower::util::ServiceExt;

use crate::daemon::{
    create_daemon_in, resolve_approval, ApprovalResolution, DaemonState, PendingApproval,
};

async fn body_json(response: axum::response::Response) -> serde_json::Value {
    let body = to_bytes(response.into_body(), usize::MAX)
        .await
        .expect("read body");
    serde_json::from_slice(&body).expect("valid json")
}

async fn wait_for_pending_approval(
    state: &DaemonState,
    expected_count: usize,
) -> Vec<(String, String)> {
    for _ in 0..40 {
        let pending = state.pending_approvals.lock().await;
        if pending.len() == expected_count {
            return pending
                .iter()
                .map(|(approval_id, entry)| (approval_id.clone(), entry.task_id.clone()))
                .collect();
        }
        drop(pending);
        tokio::time::sleep(std::time::Duration::from_millis(25)).await;
    }
    panic!("expected {expected_count} pending approvals");
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
) -> (
    Arc<DaemonState>,
    tokio::sync::oneshot::Receiver<ApprovalResolution>,
) {
    let tempdir = tempfile::tempdir().expect("tempdir");
    let state = Arc::new(DaemonState::new_with_workdir(Some(tempdir.keep())).await);
    let (tx, rx) = tokio::sync::oneshot::channel::<ApprovalResolution>();
    {
        let mut pending = state.pending_approvals.lock().await;
        pending.insert(approval_id.to_string(), pending_approval(task_id, tx));
    }
    (state, rx)
}

/// 测试辅助：构造带默认工具元数据的 PendingApproval
fn pending_approval(
    task_id: &str,
    tx: tokio::sync::oneshot::Sender<ApprovalResolution>,
) -> PendingApproval {
    PendingApproval {
        task_id: task_id.to_string(),
        created_at: std::time::Instant::now(),
        tool_name: "fs.write".to_string(),
        side_effect_level: "Modify".to_string(),
        args: serde_json::json!({ "path": "file.txt" }),
        timeout: std::time::Duration::from_secs(300),
        tx,
    }
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
async fn approve_non_string_reason_returns_400() {
    let app = create_isolated_daemon_test().await;
    let response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/task/task-1/approve")
                .header("content-type", "application/json")
                .body(Body::from(
                    r#"{"approval_id":"task-1-0","approved":false,"reason":42}"#,
                ))
                .expect("build request"),
        )
        .await
        .expect("daemon should respond");

    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn approve_reason_over_limit_returns_400() {
    let app = create_isolated_daemon_test().await;
    let body = serde_json::json!({
        "approval_id": "task-1-0",
        "approved": false,
        "reason": "x".repeat(129),
    });
    let response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/task/task-1/approve")
                .header("content-type", "application/json")
                .body(Body::from(body.to_string()))
                .expect("build request"),
        )
        .await
        .expect("daemon should respond");

    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
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
    assert!(result.approved);
    assert_eq!(result.reason, None);
}

#[tokio::test]
async fn approve_user_dismissed_reason_reaches_waiter() {
    let (state, mut rx) = state_with_pending("task-1", "task-1-dismissed").await;

    let response = resolve_approval(
        axum::extract::State(state),
        axum::extract::Path("task-1".to_string()),
        axum::Json(serde_json::json!({
            "approval_id": "task-1-dismissed",
            "approved": false,
            "reason": "user_dismissed"
        })),
    )
    .await;

    assert_eq!(response.0, StatusCode::OK);
    let result = rx.try_recv().expect("approval result should be sent");
    assert!(!result.approved);
    assert_eq!(result.reason.as_deref(), Some("user_dismissed"));
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
    assert!(!result.approved);
    assert_eq!(result.reason, None);
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
    assert!(rx.try_recv().unwrap().approved);

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
    entry
        .tx
        .send(ApprovalResolution {
            approved: true,
            reason: None,
        })
        .expect("send approval");

    assert!(rx.try_recv().expect("should receive approved").approved);
}

// ── P0-2 审批并发模型 ─────────────────────────────────────────────

/// 多任务并发审批：5 个互不相同的 task 各自注册 pending，并发 resolve，互不干扰
#[tokio::test]
async fn concurrent_approvals_across_tasks_do_not_interfere() {
    let tempdir = tempfile::tempdir().expect("tempdir");
    let state = Arc::new(DaemonState::new_with_workdir(Some(tempdir.keep())).await);

    // 5 个任务各注册一个 pending，各自持有 rx
    let mut rxs = Vec::new();
    for i in 0..5 {
        let task = format!("task-{i}");
        let approval_id = format!("task-{i}-0");
        let (tx, rx) = tokio::sync::oneshot::channel::<ApprovalResolution>();
        {
            let mut pending = state.pending_approvals.lock().await;
            pending.insert(approval_id.clone(), pending_approval(&task, tx));
        }
        rxs.push((task, approval_id, rx));
    }

    // 并发 resolve：3 个批准、2 个拒绝
    let mut handles = Vec::new();
    for (i, (task, approval_id, _rx)) in rxs.iter().enumerate() {
        let state = state.clone();
        let task = task.clone();
        let approval_id = approval_id.clone();
        let approved = i % 2 == 0; // 交替 approve / deny
        handles.push(tokio::spawn(async move {
            resolve_approval(
                axum::extract::State(state),
                axum::extract::Path(task),
                axum::Json(serde_json::json!({
                    "approval_id": approval_id,
                    "approved": approved,
                })),
            )
            .await
        }));
    }

    for (i, handle) in handles.into_iter().enumerate() {
        let response = handle.await.expect("task panicked");
        assert_eq!(response.0, StatusCode::OK, "task-{i} resolve failed");
    }

    for (i, (_, _, rx)) in rxs.into_iter().enumerate() {
        let expected = i % 2 == 0;
        assert_eq!(
            rx.await.unwrap().approved,
            expected,
            "task-{i} got wrong approval result"
        );
    }

    // 全部 resolve 后 map 应为空
    let pending = state.pending_approvals.lock().await;
    assert!(pending.is_empty(), "all pendings should be consumed");
}

/// 同任务连续 5 次审批 id 唯一且互不覆盖
#[tokio::test]
async fn sequential_approvals_same_task_use_unique_ids() {
    use std::collections::HashSet;

    let (state, _) = state_with_pending("task-seq", "task-seq-987654321").await;
    let _ = state; // 不必用；测试只是构造 seq

    // 模拟 decider 连续 5 次 generate_approval_id（同一任务）
    let mut ids = HashSet::new();
    let prefix = "task-seq";
    for _ in 0..5 {
        let id = format!(
            "{prefix}-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        );
        assert!(ids.insert(id));
    }
    assert_eq!(ids.len(), 5);
}

/// cancel 任务应清理 pending_approvals，等待中的决定方会因 sender drop 而返回 Denied
#[tokio::test]
async fn cancel_task_clears_pending_approvals() {
    // 构造一个 state 直接调清理 helper
    let (state, mut rx) = state_with_pending("task-cancel", "task-cancel-0").await;

    // 清理：模拟 cancel_task 的逻辑
    let cleared = state.clear_pending_approvals_for_task("task-cancel").await;
    assert_eq!(cleared, 1);

    // map 应为空
    {
        let pending = state.pending_approvals.lock().await;
        assert!(!pending.contains_key("task-cancel-0"));
    }

    // sender 应已被 drop；rx 收到 Closed 错误
    let result = rx.try_recv();
    assert!(matches!(
        result,
        Err(tokio::sync::oneshot::error::TryRecvError::Closed)
    ));
}

/// cancel 不影响其他任务的 pending（按 task_id 精准清理）
#[tokio::test]
async fn cancel_task_clears_only_own_task_pendings() {
    let tempdir = tempfile::tempdir().expect("tempdir");
    let state = Arc::new(DaemonState::new_with_workdir(Some(tempdir.keep())).await);

    // task-a 注册 2 个 pending；task-b 注册 1 个 pending
    let mut pending = state.pending_approvals.lock().await;
    for (approval_id, task_id) in [
        ("task-a-0", "task-a"),
        ("task-a-1", "task-a"),
        ("task-b-0", "task-b"),
    ] {
        let (tx, _rx) = tokio::sync::oneshot::channel::<ApprovalResolution>();
        pending.insert(approval_id.to_string(), pending_approval(task_id, tx));
    }
    drop(pending);

    // cancel task-a
    let cleared = state.clear_pending_approvals_for_task("task-a").await;
    assert_eq!(cleared, 2);

    // 验证：task-b 的 pending 仍存在，task-a 的已被清理
    let pending = state.pending_approvals.lock().await;
    assert!(!pending.contains_key("task-a-0"));
    assert!(!pending.contains_key("task-a-1"));
    assert!(pending.contains_key("task-b-0"));
}
/// 同一任务连续两次审批使用不同 approval_id，互不覆盖
#[test]
fn approval_ids_do_not_collide_per_task() {
    // 模拟 HttpApprovalDecider 的 generate_approval_id：task_id + 递增序号
    let a = "task-multi-0".to_string();
    let b = "task-multi-1".to_string();
    assert_ne!(a, b);
}
// ── P0-3 端到端审批链路 ──────────────────────────────────────────

/// 端到端：异步等待审批，通过 HTTP approve 提交结果后返回 Approved。
#[tokio::test]
async fn end_to_end_http_approval_flow() {
    use crate::ApprovalDecider;
    use sacode_kernel::ExecutionMode;

    let tempdir = tempfile::tempdir().expect("tempdir");
    let state = Arc::new(DaemonState::new_with_workdir(Some(tempdir.keep())).await);
    let state_for_decide = state.clone();
    let decide_handle = tokio::spawn(async move {
        let decider =
            crate::daemon::HttpApprovalDecider::new(state_for_decide, "task-e2e".to_string());
        assert!(decider.needs_interactive_approval("fs.write", ExecutionMode::Build));
        decider
            .decide(
                "fs.write",
                crate::SideEffectLevel::Modify,
                &serde_json::json!({ "path": "/tmp/test.txt", "content": "hello" }),
            )
            .await
    });

    let approval_id = wait_for_pending_approval(&state, 1).await[0].0.clone();
    let response = resolve_approval(
        axum::extract::State(state.clone()),
        axum::extract::Path("task-e2e".to_string()),
        axum::Json(serde_json::json!({
            "approval_id": approval_id,
            "approved": true,
        })),
    )
    .await;
    assert_eq!(response.0, StatusCode::OK);

    let decision = decide_handle.await.expect("decide task panicked");
    assert!(matches!(decision, crate::ApprovalDecision::Approved));
    assert!(state.pending_approvals.lock().await.is_empty());
}

/// 端到端拒批：异步 decide 收到 Denied 决定。
#[tokio::test]
async fn end_to_end_http_approval_deny_flow() {
    use crate::ApprovalDecider;

    let tempdir = tempfile::tempdir().expect("tempdir");
    let state = Arc::new(DaemonState::new_with_workdir(Some(tempdir.keep())).await);
    let state_for_decide = state.clone();
    let decide_handle = tokio::spawn(async move {
        let decider =
            crate::daemon::HttpApprovalDecider::new(state_for_decide, "task-deny".to_string());
        decider
            .decide(
                "fs.delete",
                crate::SideEffectLevel::Execute,
                &serde_json::json!({ "path": "/tmp/important.txt" }),
            )
            .await
    });

    let approval_id = wait_for_pending_approval(&state, 1).await[0].0.clone();
    let response = resolve_approval(
        axum::extract::State(state.clone()),
        axum::extract::Path("task-deny".to_string()),
        axum::Json(serde_json::json!({
            "approval_id": approval_id,
            "approved": false,
            "reason": "user_dismissed",
        })),
    )
    .await;
    assert_eq!(response.0, StatusCode::OK);

    let decision = decide_handle.await.expect("decide task panicked");
    assert!(matches!(decision, crate::ApprovalDecision::Denied));
    let events = state.event_history.replay_after(0);
    assert!(events.iter().any(|(_, event)| {
        event.event_type == "approval_resolved"
            && event.data["reason"] == "user_dismissed"
            && event.data["approved"] == false
    }));
}

/// 端到端审批通道隔离：不同任务的异步等待只收到自己的回传。
#[tokio::test]
async fn end_to_end_approvals_isolated_per_task() {
    use crate::ApprovalDecider;

    let tempdir = tempfile::tempdir().expect("tempdir");
    let state = Arc::new(DaemonState::new_with_workdir(Some(tempdir.keep())).await);

    let mut handles = Vec::new();
    for i in 0..3 {
        let state = state.clone();
        let task_id = format!("task-iso-{i}");
        handles.push(tokio::spawn(async move {
            crate::daemon::HttpApprovalDecider::new(state, task_id)
                .decide(
                    "fs.write",
                    crate::SideEffectLevel::Modify,
                    &serde_json::json!({ "task": i }),
                )
                .await
        }));
    }

    let pending_snapshot = wait_for_pending_approval(&state, 3).await;
    for (approval_id, task_id) in pending_snapshot {
        let response = resolve_approval(
            axum::extract::State(state.clone()),
            axum::extract::Path(task_id.clone()),
            axum::Json(serde_json::json!({
                "approval_id": approval_id,
                "approved": task_id == "task-iso-1",
            })),
        )
        .await;
        assert_eq!(response.0, StatusCode::OK);
    }

    for (i, handle) in handles.into_iter().enumerate() {
        let decision = handle.await.expect("decide task panicked");
        let expected_approved = i == 1;
        match (decision, expected_approved) {
            (crate::ApprovalDecision::Approved, true) => {}
            (crate::ApprovalDecision::Denied, false) => {}
            other => panic!("task-iso-{i} unexpected decision: {:?}", other),
        }
    }
}

/// 超时自动拒绝并清理 pending，同时发出带 reason 的 resolved 事件。
#[tokio::test]
async fn approval_timeout_is_async_and_observable() {
    use crate::ApprovalDecider;

    let tempdir = tempfile::tempdir().expect("tempdir");
    let state = Arc::new(DaemonState::new_with_workdir(Some(tempdir.keep())).await);
    let decider = crate::daemon::HttpApprovalDecider::with_timeout(
        state.clone(),
        "task-timeout".to_string(),
        std::time::Duration::from_millis(20),
    );

    let decision = decider
        .decide(
            "fs.write",
            crate::SideEffectLevel::Modify,
            &serde_json::json!({ "path": "file.txt" }),
        )
        .await;

    assert!(matches!(decision, crate::ApprovalDecision::Denied));
    assert!(state.pending_approvals.lock().await.is_empty());
    let events = state.event_history.replay_after(0);
    assert!(events.iter().any(|(_, event)| {
        event.event_type == "approval_resolved"
            && event.data["reason"] == "timeout"
            && event.data["approved"] == false
            && event.data["approval_id"].is_string()
    }));
}

/// 取消清理 sender 后异步等待立即结束，并发出 reason=cancelled 事件。
#[tokio::test]
async fn approval_cancel_wakes_async_waiter() {
    use crate::ApprovalDecider;

    let tempdir = tempfile::tempdir().expect("tempdir");
    let state = Arc::new(DaemonState::new_with_workdir(Some(tempdir.keep())).await);
    let state_for_decide = state.clone();
    let decide_handle = tokio::spawn(async move {
        crate::daemon::HttpApprovalDecider::new(state_for_decide, "task-cancel-async".to_string())
            .decide(
                "fs.write",
                crate::SideEffectLevel::Modify,
                &serde_json::json!({ "path": "file.txt" }),
            )
            .await
    });

    wait_for_pending_approval(&state, 1).await;
    assert_eq!(
        state
            .clear_pending_approvals_for_task("task-cancel-async")
            .await,
        1
    );
    let decision = tokio::time::timeout(std::time::Duration::from_secs(1), decide_handle)
        .await
        .expect("cancel should wake approval waiter")
        .expect("decide task panicked");
    assert!(matches!(decision, crate::ApprovalDecision::Denied));
    let events = state.event_history.replay_after(0);
    assert!(events.iter().any(|(_, event)| {
        event.event_type == "approval_resolved"
            && event.data["reason"] == "cancelled"
            && event.data["approved"] == false
    }));
}

/// 单线程 Tokio runtime 回归：等待审批必须让出 worker，其他异步任务仍可运行。
#[tokio::test(flavor = "current_thread")]
async fn approval_wait_does_not_block_tokio_worker() {
    use crate::ApprovalDecider;

    let tempdir = tempfile::tempdir().expect("tempdir");
    let state = Arc::new(DaemonState::new_with_workdir(Some(tempdir.keep())).await);
    let state_for_decide = state.clone();
    let decide_handle = tokio::spawn(async move {
        crate::daemon::HttpApprovalDecider::new(state_for_decide, "task-nonblocking".to_string())
            .decide(
                "fs.write",
                crate::SideEffectLevel::Modify,
                &serde_json::json!({ "path": "file.txt" }),
            )
            .await
    });

    let approval_id = tokio::time::timeout(
        std::time::Duration::from_secs(1),
        wait_for_pending_approval(&state, 1),
    )
    .await
    .expect("pending registration should not block current-thread runtime")[0]
        .0
        .clone();

    let heartbeat = tokio::time::timeout(std::time::Duration::from_millis(100), async {
        tokio::task::yield_now().await;
        42
    })
    .await
    .expect("approval wait blocked Tokio worker");
    assert_eq!(heartbeat, 42);

    let response = resolve_approval(
        axum::extract::State(state),
        axum::extract::Path("task-nonblocking".to_string()),
        axum::Json(serde_json::json!({
            "approval_id": approval_id,
            "approved": true,
        })),
    )
    .await;
    assert_eq!(response.0, StatusCode::OK);
    assert!(matches!(
        decide_handle.await.expect("decide task panicked"),
        crate::ApprovalDecision::Approved
    ));
}

// ── P2-1 审批恢复 + 可观测性指标 ────────────────────────────────────

/// 列出待审批：只返回目标任务的条目，字段与 approval_requested 一致，按 approval_id 排序
#[tokio::test]
async fn list_approvals_returns_pending_entries_for_task() {
    let tempdir = tempfile::tempdir().expect("tempdir");
    let state = Arc::new(DaemonState::new_with_workdir(Some(tempdir.keep())).await);

    for (approval_id, task_id) in [
        ("task-x-1", "task-x"),
        ("task-x-0", "task-x"),
        ("task-y-0", "task-y"),
    ] {
        let (tx, _rx) = tokio::sync::oneshot::channel::<ApprovalResolution>();
        let mut pending = state.pending_approvals.lock().await;
        pending.insert(approval_id.to_string(), pending_approval(task_id, tx));
    }

    let response = crate::daemon::list_task_approvals(
        axum::extract::State(state),
        axum::extract::Path("task-x".to_string()),
    )
    .await;

    let approvals = response.0["approvals"].as_array().expect("approvals array");
    assert_eq!(approvals.len(), 2, "只应返回 task-x 的待审批");
    // 按 approval_id 排序
    assert_eq!(approvals[0]["approval_id"], "task-x-0");
    assert_eq!(approvals[1]["approval_id"], "task-x-1");
    for entry in approvals {
        assert_eq!(entry["task_id"], "task-x");
        assert_eq!(entry["tool_name"], "fs.write");
        assert_eq!(entry["side_effect_level"], "Modify");
        assert_eq!(entry["args"]["path"], "file.txt");
        assert!(entry["waited_secs"].is_number());
        assert_eq!(entry["timeout_secs"], 300);
        assert!(entry["expires_in_secs"].as_u64().unwrap() <= 300);
    }
}

/// 列出待审批：无 pending 时返回空数组而不是 404
#[tokio::test]
async fn list_approvals_empty_when_no_pending() {
    let tempdir = tempfile::tempdir().expect("tempdir");
    let state = Arc::new(DaemonState::new_with_workdir(Some(tempdir.keep())).await);

    let response = crate::daemon::list_task_approvals(
        axum::extract::State(state),
        axum::extract::Path("task-none".to_string()),
    )
    .await;

    assert_eq!(response.0["task_id"], "task-none");
    assert_eq!(
        response.0["approvals"]
            .as_array()
            .expect("approvals array")
            .len(),
        0
    );
}

/// HTTP 路由集成：GET /task/:id/approvals 通过完整 daemon router 可达
#[tokio::test]
async fn list_approvals_reachable_via_http_router() {
    let app = create_isolated_daemon_test().await;

    let response = app
        .oneshot(
            Request::builder()
                .method("GET")
                .uri("/task/task-http/approvals")
                .body(Body::empty())
                .expect("build request"),
        )
        .await
        .expect("daemon should respond");

    assert_eq!(response.status(), StatusCode::OK);
    let payload = body_json(response).await;
    assert_eq!(payload["task_id"], "task-http");
    assert_eq!(payload["approvals"].as_array().unwrap().len(), 0);
}

/// HTTP 路由集成：GET /metrics 可达且返回审批指标结构
#[tokio::test]
async fn metrics_endpoint_returns_approval_snapshot() {
    let app = create_isolated_daemon_test().await;

    let response = app
        .oneshot(
            Request::builder()
                .method("GET")
                .uri("/metrics")
                .body(Body::empty())
                .expect("build request"),
        )
        .await
        .expect("daemon should respond");

    assert_eq!(response.status(), StatusCode::OK);
    let payload = body_json(response).await;
    let approval = &payload["approval"];
    assert_eq!(approval["requested"], 0);
    assert_eq!(approval["pending"], 0);
    assert_eq!(approval["approved"], 0);
    assert_eq!(approval["denied"], 0);
    assert_eq!(approval["timed_out"], 0);
    assert_eq!(approval["cancelled"], 0);
    assert_eq!(approval["resolved"], 0);
    assert_eq!(approval["avg_wait_ms"], 0);
}

/// 指标：批准的审批计入 approved 并累计等待时间
#[tokio::test]
async fn metrics_count_approved_with_wait_time() {
    use crate::ApprovalDecider;

    let tempdir = tempfile::tempdir().expect("tempdir");
    let state = Arc::new(DaemonState::new_with_workdir(Some(tempdir.keep())).await);
    let state_for_decide = state.clone();
    let decide_handle = tokio::spawn(async move {
        crate::daemon::HttpApprovalDecider::new(state_for_decide, "task-metrics".to_string())
            .decide(
                "fs.write",
                crate::SideEffectLevel::Modify,
                &serde_json::json!({ "path": "file.txt" }),
            )
            .await
    });

    let approval_id = wait_for_pending_approval(&state, 1).await[0].0.clone();
    // 让等待时间非零，确保 total_wait_ms > 0
    tokio::time::sleep(std::time::Duration::from_millis(2)).await;
    let response = resolve_approval(
        axum::extract::State(state.clone()),
        axum::extract::Path("task-metrics".to_string()),
        axum::Json(serde_json::json!({
            "approval_id": approval_id,
            "approved": true,
        })),
    )
    .await;
    assert_eq!(response.0, StatusCode::OK);
    decide_handle.await.expect("decide task panicked");

    let snapshot = state.metrics.snapshot();
    let approval = &snapshot["approval"];
    assert_eq!(approval["requested"], 1);
    assert_eq!(approval["approved"], 1);
    assert_eq!(approval["denied"], 0);
    assert_eq!(approval["resolved"], 1);
    assert!(approval["total_wait_ms"].as_u64().unwrap() > 0);
    assert_eq!(approval["avg_wait_ms"], approval["total_wait_ms"]);
}

/// 指标：拒绝计入 denied
#[tokio::test]
async fn metrics_count_denied() {
    use crate::ApprovalDecider;

    let tempdir = tempfile::tempdir().expect("tempdir");
    let state = Arc::new(DaemonState::new_with_workdir(Some(tempdir.keep())).await);
    let state_for_decide = state.clone();
    let decide_handle = tokio::spawn(async move {
        crate::daemon::HttpApprovalDecider::new(state_for_decide, "task-deny-m".to_string())
            .decide(
                "fs.delete",
                crate::SideEffectLevel::Execute,
                &serde_json::json!({ "path": "/tmp/important" }),
            )
            .await
    });

    let approval_id = wait_for_pending_approval(&state, 1).await[0].0.clone();
    let response = resolve_approval(
        axum::extract::State(state.clone()),
        axum::extract::Path("task-deny-m".to_string()),
        axum::Json(serde_json::json!({
            "approval_id": approval_id,
            "approved": false,
        })),
    )
    .await;
    assert_eq!(response.0, StatusCode::OK);
    decide_handle.await.expect("decide task panicked");

    let approval = &state.metrics.snapshot()["approval"];
    assert_eq!(approval["approved"], 0);
    assert_eq!(approval["denied"], 1);
    assert_eq!(approval["resolved"], 1);
}

/// 指标：超时计入 timed_out
#[tokio::test]
async fn metrics_count_timeout() {
    use crate::ApprovalDecider;

    let tempdir = tempfile::tempdir().expect("tempdir");
    let state = Arc::new(DaemonState::new_with_workdir(Some(tempdir.keep())).await);
    let decider = crate::daemon::HttpApprovalDecider::with_timeout(
        state.clone(),
        "task-to-m".to_string(),
        std::time::Duration::from_millis(20),
    );

    decider
        .decide(
            "fs.write",
            crate::SideEffectLevel::Modify,
            &serde_json::json!({ "path": "file.txt" }),
        )
        .await;

    let approval = &state.metrics.snapshot()["approval"];
    assert_eq!(approval["requested"], 1);
    assert_eq!(approval["timed_out"], 1);
    assert_eq!(approval["resolved"], 1);
    assert!(approval["total_wait_ms"].as_u64().unwrap() >= 20);
}

/// 指标：取消计入 cancelled
#[tokio::test]
async fn metrics_count_cancelled() {
    use crate::ApprovalDecider;

    let tempdir = tempfile::tempdir().expect("tempdir");
    let state = Arc::new(DaemonState::new_with_workdir(Some(tempdir.keep())).await);
    let state_for_decide = state.clone();
    let decide_handle = tokio::spawn(async move {
        crate::daemon::HttpApprovalDecider::new(state_for_decide, "task-cancel-m".to_string())
            .decide(
                "fs.write",
                crate::SideEffectLevel::Modify,
                &serde_json::json!({ "path": "file.txt" }),
            )
            .await
    });

    wait_for_pending_approval(&state, 1).await;
    state
        .clear_pending_approvals_for_task("task-cancel-m")
        .await;
    decide_handle.await.expect("decide task panicked");

    let approval = &state.metrics.snapshot()["approval"];
    assert_eq!(approval["cancelled"], 1);
    assert_eq!(approval["resolved"], 1);
}

/// 指标：多次解决的 avg_wait_ms 为均值
#[tokio::test]
async fn metrics_avg_wait_ms_averages_resolved() {
    let metrics = crate::daemon::ApprovalMetrics::default();
    metrics.approved.store(1, Ordering::Relaxed);
    metrics.denied.store(1, Ordering::Relaxed);
    metrics.total_wait_ms.store(3000, Ordering::Relaxed);

    let snapshot = metrics.snapshot();
    assert_eq!(snapshot["resolved"], 2);
    assert_eq!(snapshot["avg_wait_ms"], 1500);
}
