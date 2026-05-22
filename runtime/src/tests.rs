use std::fs;
use std::time::Duration;

use axum::{
    body::{to_bytes, Body},
    http::{Request, StatusCode},
};
use http_body_util::BodyExt;
use tower::util::ServiceExt;

use crate::{create_daemon, tools::{self, ToolRegistry, ToolOutput}};

#[test]
fn test_tool_registry() {
    let registry = ToolRegistry::builtin();
    let names = registry.names();
    
    assert!(names.contains(&"fs.read"));
    assert!(names.contains(&"fs.search"));
    assert!(names.contains(&"git.diff"));
    assert!(names.contains(&"shell.exec"));
}

#[test]
fn test_tool_spec_read_only() {
    let spec = tools::fs::read::spec();
    assert!(spec.is_read_only());
    assert!(!spec.needs_approval());
}

#[test]
fn test_tool_spec_exec_needs_approval() {
    let spec = tools::shell::exec::spec();
    assert!(!spec.is_read_only());
    assert!(spec.needs_approval());
}

#[test]
fn test_tool_output_success() {
    let output = ToolOutput::success(serde_json::json!({ "data": "test" }));
    assert!(output.success);
}

#[test]
fn test_tool_output_failure() {
    let output = ToolOutput::failure("error");
    assert!(!output.success);
    assert!(output.message.is_some());
}

#[test]
fn test_fs_write_stays_in_workspace() {
    let temp_dir = tempfile::tempdir().expect("create temp dir");
    let original_dir = std::env::current_dir().expect("read current dir");
    std::env::set_current_dir(temp_dir.path()).expect("enter temp dir");

    let result = tools::fs::write::execute(serde_json::json!({
        "path": "nested/output.txt",
        "content": "hello"
    }))
    .expect("tool execution should succeed");

    let written = fs::read_to_string(temp_dir.path().join("nested/output.txt"))
        .expect("written file should exist");
    std::env::set_current_dir(original_dir).expect("restore current dir");

    assert!(result.success);
    assert_eq!(written, "hello");
}

#[test]
fn test_fs_write_rejects_parent_escape() {
    let temp_dir = tempfile::tempdir().expect("create temp dir");
    let original_dir = std::env::current_dir().expect("read current dir");
    std::env::set_current_dir(temp_dir.path()).expect("enter temp dir");

    let error = tools::fs::write::execute(serde_json::json!({
        "path": "../escape.txt",
        "content": "blocked"
    }))
    .expect_err("parent escape should fail");

    std::env::set_current_dir(original_dir).expect("restore current dir");

    assert!(error.to_string().contains("outside workspace"));
}

#[tokio::test]
async fn test_daemon_health_endpoint() {
    let app = create_daemon().await;

    let response = app
        .oneshot(Request::builder().uri("/health").body(Body::empty()).expect("build request"))
        .await
        .expect("daemon should respond");

    assert_eq!(response.status(), StatusCode::OK);

    let body = to_bytes(response.into_body(), usize::MAX)
        .await
        .expect("read body");
    let payload: serde_json::Value = serde_json::from_slice(&body).expect("valid json");

    assert_eq!(payload["status"], "healthy");
    assert_eq!(payload["version"], env!("CARGO_PKG_VERSION"));
}

#[tokio::test]
async fn test_daemon_tools_endpoint_lists_builtin_tools() {
    let app = create_daemon().await;

    let response = app
        .oneshot(Request::builder().uri("/tools").body(Body::empty()).expect("build request"))
        .await
        .expect("daemon should respond");

    assert_eq!(response.status(), StatusCode::OK);

    let body = to_bytes(response.into_body(), usize::MAX)
        .await
        .expect("read body");
    let payload: serde_json::Value = serde_json::from_slice(&body).expect("valid json");
    let tools = payload["tools"].as_array().expect("tools array");

    assert!(tools.iter().any(|tool| tool == "fs.read"));
    assert!(tools.iter().any(|tool| tool == "fs.write"));
    assert!(tools.iter().any(|tool| tool == "shell.exec"));
}

#[tokio::test]
async fn test_daemon_task_lifecycle() {
    let app = create_daemon().await;

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/task")
                .header("content-type", "application/json")
                .body(Body::from(r#"{"prompt":"分析代码结构","mode":"build"}"#))
                .expect("build request"),
        )
        .await
        .expect("daemon should create task");

    assert_eq!(response.status(), StatusCode::OK);

    let body = to_bytes(response.into_body(), usize::MAX)
        .await
        .expect("read body");
    let payload: serde_json::Value = serde_json::from_slice(&body).expect("valid json");
    let task_id = payload["task_id"].as_str().expect("task id").to_string();

    assert_eq!(payload["status"], "queued");

    tokio::time::sleep(Duration::from_millis(50)).await;

    let response = app
        .oneshot(
            Request::builder()
                .uri(format!("/task/{}/status", task_id))
                .body(Body::empty())
                .expect("build request"),
        )
        .await
        .expect("daemon should return task status");

    assert_eq!(response.status(), StatusCode::OK);

    let body = to_bytes(response.into_body(), usize::MAX)
        .await
        .expect("read body");
    let payload: serde_json::Value = serde_json::from_slice(&body).expect("valid json");

    assert_eq!(payload["task_id"], task_id);
    assert!(matches!(payload["status"].as_str(), Some("running") | Some("completed") | Some("failed")));
}

#[tokio::test]
async fn test_daemon_events_endpoint_streams_sse() {
    let app = create_daemon().await;

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/events")
                .body(Body::empty())
                .expect("build request"),
        )
        .await
        .expect("daemon should open event stream");

    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(
        response.headers().get("content-type").and_then(|value| value.to_str().ok()),
        Some("text/event-stream")
    );

    let mut body = response.into_body();

    let create_task = app.oneshot(
        Request::builder()
            .method("POST")
            .uri("/task")
            .header("content-type", "application/json")
            .body(Body::from(r#"{"prompt":"分析代码结构","mode":"build"}"#))
            .expect("build request"),
    );

    let next_frame = tokio::time::timeout(Duration::from_secs(1), body.frame());
    let (_, frame_result) = tokio::join!(create_task, next_frame);

    let frame = frame_result
        .expect("sse frame should arrive")
        .expect("body should yield a frame")
        .expect("frame should be readable");
    let bytes = frame.into_data().expect("sse frame should contain data");
    let text = String::from_utf8_lossy(&bytes);

    assert!(text.contains("event: task_created") || text.contains("event: task_started"));
}

#[tokio::test]
async fn test_daemon_task_events_endpoint_filters_by_task_id() {
    let app = create_daemon().await;

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/task")
                .header("content-type", "application/json")
                .body(Body::from(r#"{"prompt":"分析代码结构","mode":"build"}"#))
                .expect("build request"),
        )
        .await
        .expect("daemon should create task");

    let body = to_bytes(response.into_body(), usize::MAX)
        .await
        .expect("read body");
    let payload: serde_json::Value = serde_json::from_slice(&body).expect("valid json");
    let task_id = payload["task_id"].as_str().expect("task id").to_string();

    let response = app
        .oneshot(
            Request::builder()
                .uri(format!("/events/{}", task_id))
                .body(Body::empty())
                .expect("build request"),
        )
        .await
        .expect("daemon should open task event stream");

    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(
        response.headers().get("content-type").and_then(|value| value.to_str().ok()),
        Some("text/event-stream")
    );
}
