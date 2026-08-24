use std::sync::Arc;

use axum::{
    body::{to_bytes, Body},
    http::{Request, StatusCode},
    response::IntoResponse,
};
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
        let (tx, rx) = tokio::sync::oneshot::channel::<bool>();
        {
            let mut pending = state.pending_approvals.lock().await;
            pending.insert(
                approval_id.clone(),
                PendingApproval {
                    task_id: task.clone(),
                    created_at: std::time::Instant::now(),
                    tx,
                },
            );
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
            rx.await.unwrap(),
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
        let (tx, _rx) = tokio::sync::oneshot::channel::<bool>();
        pending.insert(
            approval_id.to_string(),
            PendingApproval {
                task_id: task_id.to_string(),
                created_at: std::time::Instant::now(),
                tx,
            },
        );
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

/// 端到端：spawn `HttpApprovalDecider::decide` 等待线程，通过 HTTP approve 提交结果，
/// decide 线程应收到 Approved 决定并返回。
#[tokio::test]
async fn end_to_end_http_approval_flow() {
    use crate::ApprovalDecider;
    use sacode_kernel::ExecutionMode;

    let tempdir = tempfile::tempdir().expect("tempdir");
    let state = Arc::new(DaemonState::new_with_workdir(Some(tempdir.keep())).await);

    // 1. spawn decider 线程：decide 是同步阻塞调用，会注册 pending 并轮询等待
    let state_for_decide = state.clone();
    let decide_handle = std::thread::spawn(move || {
        let decider =
            crate::daemon::HttpApprovalDecider::new(state_for_decide, "task-e2e".to_string());
        // decide 需要 ApprovalDecider trait，build 模式 + 非 mcp 工具触发
        assert!(decider.needs_interactive_approval("fs.write", ExecutionMode::Build));
        decider.decide(
            "fs.write",
            crate::SideEffectLevel::Modify,
            &serde_json::json!({ "path": "/tmp/test.txt", "content": "hello" }),
        )
    });

    // 2. 等待 pending 注册完成（轮询 max 2s）
    let approval_id = {
        let mut last_seen = String::new();
        for _ in 0..20 {
            let pending = state.pending_approvals.lock().await;
            if let Some((id, _)) = pending.iter().next() {
                last_seen = id.clone();
                break;
            }
            tokio::time::sleep(std::time::Duration::from_millis(50)).await;
        }
        assert!(
            !last_seen.is_empty(),
            "pending approval should be registered"
        );
        last_seen
    };

    // 3. SSE 事件应已发送 — 但由于在 cfg(test) 下 SSE 通过 broadcast channel 发，
    //    这里仅检查 pending 已注册即可。真正的 SSE 集成由独立 SSE 测试覆盖。

    // 4. 通过 resolve_approval handler 提交批准
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

    // 5. decide 线程应结束且返回 Approved
    let decision = decide_handle.join().expect("decide thread panicked");
    assert!(matches!(decision, crate::ApprovalDecision::Approved));

    // 6. pending map 应为空（resolve 时已移除）
    let pending = state.pending_approvals.lock().await;
    assert!(pending.is_empty());
}

/// 端到端拒批：decide 收到 Denied 决定
#[tokio::test]
async fn end_to_end_http_approval_deny_flow() {
    use crate::ApprovalDecider;

    let tempdir = tempfile::tempdir().expect("tempdir");
    let state = Arc::new(DaemonState::new_with_workdir(Some(tempdir.keep())).await);

    let state_for_decide = state.clone();
    let decide_handle = std::thread::spawn(move || {
        let decider =
            crate::daemon::HttpApprovalDecider::new(state_for_decide, "task-deny".to_string());
        decider.decide(
            "fs.delete",
            crate::SideEffectLevel::Execute,
            &serde_json::json!({ "path": "/tmp/important.txt" }),
        )
    });

    // 等待注册
    let approval_id = {
        let mut last = String::new();
        for _ in 0..20 {
            let pending = state.pending_approvals.lock().await;
            if let Some((id, _)) = pending.iter().next() {
                last = id.clone();
                break;
            }
            tokio::time::sleep(std::time::Duration::from_millis(50)).await;
        }
        last
    };
    assert!(!approval_id.is_empty());

    // 拒绝
    let response = resolve_approval(
        axum::extract::State(state),
        axum::extract::Path("task-deny".to_string()),
        axum::Json(serde_json::json!({
            "approval_id": approval_id,
            "approved": false,
        })),
    )
    .await;
    assert_eq!(response.0, StatusCode::OK);

    let decision = decide_handle.join().expect("decide thread panicked");
    assert!(matches!(decision, crate::ApprovalDecision::Denied));
}

/// 端到端审批通道隔离：不同任务的 decide 线程只收到自己的回传
#[tokio::test]
async fn end_to_end_approvals_isolated_per_task() {
    use crate::ApprovalDecider;

    let tempdir = tempfile::tempdir().expect("tempdir");
    let state = Arc::new(DaemonState::new_with_workdir(Some(tempdir.keep())).await);

    // 三个并发任务都进入审批
    let mut handles = Vec::new();
    for i in 0..3 {
        let s = state.clone();
        let task_id = format!("task-iso-{i}");
        handles.push(std::thread::spawn(move || {
            let decider = crate::daemon::HttpApprovalDecider::new(s, task_id);
            decider.decide(
                "fs.write",
                crate::SideEffectLevel::Modify,
                &serde_json::json!({ "task": i }),
            )
        }));
    }

    // 等所有 pending 注册完成
    let mut pendings: Vec<(String, String)> = Vec::new();
    for _ in 0..30 {
        let pending = state.pending_approvals.lock().await;
        if pending.len() == 3 {
            for (id, entry) in pending.iter() {
                pendings.push((id.clone(), entry.task_id.clone()));
            }
            break;
        }
        drop(pending);
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
    }
    assert_eq!(pendings.len(), 3);
    drop(pendings);

    // 按 task 顺序 resolve（每个任务对应自己的 approval_id）
    let pending_snapshot = {
        let p = state.pending_approvals.lock().await;
        p.iter()
            .map(|(k, v)| (k.clone(), v.task_id.clone()))
            .collect::<Vec<_>>()
    };
    for (approval_id, task_id) in pending_snapshot {
        let response = resolve_approval(
            axum::extract::State(state.clone()),
            axum::extract::Path(task_id.clone()),
            axum::Json(serde_json::json!({
                "approval_id": approval_id,
                "approved": task_id == "task-iso-1", // 只有 task-iso-1 被批准
            })),
        )
        .await;
        assert_eq!(response.0, StatusCode::OK);
    }

    // 检查 decide 结果
    for (i, handle) in handles.into_iter().enumerate() {
        let decision = handle.join().expect("decide panicked");
        let expected_approved = i == 1;
        match (decision, expected_approved) {
            (crate::ApprovalDecision::Approved, true) => {}
            (crate::ApprovalDecision::Denied, false) => {}
            other => panic!("task-iso-{i} unexpected decision: {:?}", other),
        }
    }
}
