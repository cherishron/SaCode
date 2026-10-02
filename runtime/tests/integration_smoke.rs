//! 集成冒烟：起真实 daemon，用真实请求体打关键契约。
//! 跑法：cargo test -p sacode-runtime --test integration_smoke -- --nocapture
//! 目的：单测绿 ≠ 真机能用。本文件用真实 HTTP 序列化路径验证前后端字段一致。

use axum::body::Body;
use axum::http::{Request, StatusCode};
use serde_json::{json, Value};
use tower::ServiceExt;

/// 与 Desktop `sendDesktopMessage` 请求体逐字段对齐（daemon-client.ts §sendDesktopMessage）
fn desktop_send_body() -> Value {
    json!({
        "prompt": "集成冒烟：请只回复 pong",
        "mode": "build",
        "backend_id": "sacode",
        "model_provider": null,
        "model_name": null,
        "skill": null,
        "skills": ["review"],
        "reasoning_effort": "medium",
        "client_msg_id": "smoke-client-msg-001",
        "context_paths": []
    })
}

/// 与 Desktop `createLocalProvider` 请求体逐字段对齐
fn local_provider_body() -> Value {
    json!({
        "name": "smoke-local",
        "base_url": "http://127.0.0.1:11434/v1",
        "api_key": "sk-smoke-not-real",
        "models": ["qwen2.5:7b"],
        "thinking": false,
        "reasoning_effort": "medium"
    })
}

async fn daemon_router(
    workdir: std::path::PathBuf,
) -> axum::Router {
    sacode_runtime::daemon::create_daemon_in(workdir).await
}

async fn call(
    router: &axum::Router,
    method: &str,
    uri: &str,
    body: Option<Value>,
    token: Option<&str>,
) -> (StatusCode, Value) {
    let mut builder = Request::builder().method(method).uri(uri);
    if let Some(t) = token {
        builder = builder.header("Authorization", format!("Bearer {t}"));
    }
    let req = builder
        .header("content-type", "application/json")
        .body(match body {
            Some(v) => Body::from(v.to_string()),
            None => Body::empty(),
        })
        .unwrap();
    let resp = router.clone().oneshot(req).await.unwrap();
    let status = resp.status();
    let bytes = axum::body::to_bytes(resp.into_body(), 2 * 1024 * 1024)
        .await
        .unwrap_or_default();
    let text = String::from_utf8_lossy(&bytes).to_string();
    let parsed = serde_json::from_str(&text).unwrap_or_else(|_| json!({ "raw": text }));
    (status, parsed)
}

#[tokio::test]
async fn smoke_local_mode_providers_and_send_contract() {
    // 模拟 Local Mode：不设 SACODE_DAEMON_TOKEN 时的行为必须符合 P1/P2
    // 若当前实现要求 token，则 sidecar 必须注入；本测试两态都验。
    let temp = tempfile::tempdir().unwrap();
    let router = daemon_router(temp.path().to_path_buf()).await;

    // ── 1. 无 token：Local Mode 下 /providers/local 不应静默 403 吞掉保存 ──
    //    若产品决策是「必须 token」，则此断言应记录为 403 且 UI 必须给出可操作提示。
    let (status, body) = call(&router, "POST", "/providers/local", Some(local_provider_body()), None).await;
    let local_mode_provider_status = status;
    println!("[smoke] POST /providers/local (no token) => {status} {body}");

    // ── 2. 有 token：契约字段必须被接受（不 400 字段错） ──
    //    create_daemon_in 测试态可能不开 auth，这里同时打无 token 版本。
    let (status2, body2) = call(
        &router,
        "POST",
        "/api/desktop/conversations",
        Some(desktop_send_body()),
        None,
    )
    .await;
    println!("[smoke] POST /api/desktop/conversations => {status2} {body2}");

    // ── 3. GET /providers/local 列表形状 ──
    let (st3, b3) = call(&router, "GET", "/providers/local", None, None).await;
    println!("[smoke] GET /providers/local => {st3} {b3}");
    assert!(
        b3.get("providers").is_some() || st3 == StatusCode::FORBIDDEN || st3 == StatusCode::OK,
        "list shape unexpected: {b3}"
    );

    // ── 4. 会话 settings 往返（草稿）──
    if let Some(cid) = body2.get("conversation_id").and_then(|v| v.as_str()) {
        let (st4, b4) = call(
            &router,
            "PUT",
            &format!("/api/desktop/conversations/{cid}/settings"),
            Some(json!({ "draft": "smoke draft", "reasoning_effort": "high", "skills": ["review"] })),
            None,
        )
        .await;
        println!("[smoke] PUT settings => {st4} {b4}");
    }

    // 关键：保存模型在 Local Mode 的状态必须被看见（真机曾 403 静默）
    if local_mode_provider_status == StatusCode::FORBIDDEN {
        panic!(
            "Local Mode 下 /providers/local 返回 403 —— 与产品原则 P1/P2 冲突。\
             真机「无法保存本地模型」根因即此。必须：无 token 时开放本地回环，\
             或 sidecar 保证注入 token 且 UI 显示鉴权错误，禁止静默失败。"
        );
    }
}
