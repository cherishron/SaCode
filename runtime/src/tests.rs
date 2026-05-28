use std::fs;
use std::time::Duration;

use axum::{
    body::{to_bytes, Body},
    http::{Request, StatusCode},
};
use http_body_util::BodyExt;
use tower::util::ServiceExt;

use crate::{
    create_daemon,
    config::SaCodeConfig,
    mcp::{McpConfig, McpConfigStore, McpServerConfig, McpSource},
    skills::SkillRegistry,
    tools::{self, ToolRegistry, ToolOutput},
};

#[test]
fn test_tool_registry() {
    let registry = ToolRegistry::builtin();
    let names = registry.names();
    
    assert!(names.contains(&"fs.read"));
    assert!(names.contains(&"fs.search"));
    assert!(names.contains(&"fs.edit"));
    assert!(names.contains(&"fs.read_multi"));
    assert!(names.contains(&"fs.list"));
    assert!(names.contains(&"git.diff"));
    assert!(names.contains(&"interaction.ask"));
    assert!(names.contains(&"media.read"));
    assert!(names.contains(&"shell.exec"));
    assert!(names.contains(&"task.spawn"));
    assert!(names.contains(&"web.fetch"));
    assert!(names.contains(&"web.search"));
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

#[test]
fn test_fs_edit_replace_single() {
    let temp_dir = tempfile::tempdir().expect("create temp dir");
    let original_dir = std::env::current_dir().expect("read current dir");
    std::env::set_current_dir(temp_dir.path()).expect("enter temp dir");
    fs::write(temp_dir.path().join("edit.txt"), "hello world").expect("seed file");

    let result = tools::fs::edit::execute(serde_json::json!({
        "path": "edit.txt",
        "old_string": "world",
        "new_string": "sacode"
    }))
    .expect("tool execution should succeed");

    let updated = fs::read_to_string(temp_dir.path().join("edit.txt")).expect("read updated file");
    std::env::set_current_dir(original_dir).expect("restore current dir");

    assert!(result.success);
    assert_eq!(updated, "hello sacode");
}

#[test]
fn test_fs_edit_not_found() {
    let temp_dir = tempfile::tempdir().expect("create temp dir");
    let original_dir = std::env::current_dir().expect("read current dir");
    std::env::set_current_dir(temp_dir.path()).expect("enter temp dir");
    fs::write(temp_dir.path().join("edit.txt"), "hello world").expect("seed file");

    let result = tools::fs::edit::execute(serde_json::json!({
        "path": "edit.txt",
        "old_string": "missing",
        "new_string": "sacode"
    }))
    .expect("tool execution should succeed");

    std::env::set_current_dir(original_dir).expect("restore current dir");

    assert!(!result.success);
    assert!(result.message.unwrap_or_default().contains("not found"));
}

#[test]
fn test_fs_read_multi_reads_multiple_files() {
    let temp_dir = tempfile::tempdir().expect("create temp dir");
    let original_dir = std::env::current_dir().expect("read current dir");
    std::env::set_current_dir(temp_dir.path()).expect("enter temp dir");
    fs::write(temp_dir.path().join("a.txt"), "a1\na2").expect("write a");
    fs::write(temp_dir.path().join("b.txt"), "b1\nb2").expect("write b");

    let result = tools::fs::read_multi::execute(serde_json::json!({
        "paths": ["a.txt", "b.txt"],
        "limit_per_file": 10
    }))
    .expect("tool execution should succeed");

    std::env::set_current_dir(original_dir).expect("restore current dir");

    assert!(result.success);
    assert_eq!(result.data["success_count"], 2);
    assert_eq!(result.data["failed_count"], 0);
}

#[test]
fn test_fs_list_lists_directory_entries() {
    let temp_dir = tempfile::tempdir().expect("create temp dir");
    let original_dir = std::env::current_dir().expect("read current dir");
    std::env::set_current_dir(temp_dir.path()).expect("enter temp dir");
    fs::create_dir_all(temp_dir.path().join("nested")).expect("create dir");
    fs::write(temp_dir.path().join("root.txt"), "x").expect("write file");

    let result = tools::fs::list::execute(serde_json::json!({
        "path": ".",
        "recursive": false,
        "include_hidden": false
    }))
    .expect("tool execution should succeed");

    std::env::set_current_dir(original_dir).expect("restore current dir");

    assert!(result.success);
    let entries = result.data["entries"].as_array().expect("entries array");
    assert!(entries.iter().any(|entry| entry["name"] == "root.txt"));
    assert!(entries.iter().any(|entry| entry["name"] == "nested"));
}

#[test]
fn test_media_read_base64_mode() {
    let temp_dir = tempfile::tempdir().expect("create temp dir");
    let original_dir = std::env::current_dir().expect("read current dir");
    std::env::set_current_dir(temp_dir.path()).expect("enter temp dir");
    fs::write(temp_dir.path().join("image.png"), vec![0x48, 0x69]).expect("write binary file");

    let result = tools::media::read::execute(serde_json::json!({
        "path": "image.png",
        "mode": "base64"
    }))
    .expect("tool execution should succeed");

    std::env::set_current_dir(original_dir).expect("restore current dir");

    assert!(result.success);
    assert_eq!(result.data["mime_type"], "image/png");
    assert_eq!(result.data["data"], "SGk=");
    assert_eq!(result.data["source"], "base64");
}

#[test]
fn test_media_read_ppm_describe_mode_includes_dimensions() {
    let temp_dir = tempfile::tempdir().expect("create temp dir");
    let original_dir = std::env::current_dir().expect("read current dir");
    std::env::set_current_dir(temp_dir.path()).expect("enter temp dir");
    fs::write(
        temp_dir.path().join("image.ppm"),
        b"P6\n2 1\n255\n\xff\x00\x00\x00\xff\x00",
    )
    .expect("write ppm file");

    let result = tools::media::read::execute(serde_json::json!({
        "path": "image.ppm",
        "mode": "describe"
    }))
    .expect("tool execution should succeed");

    std::env::set_current_dir(original_dir).expect("restore current dir");

    assert!(result.success);
    assert_eq!(result.data["mime_type"], "image/x-portable-pixmap");
    assert_eq!(result.data["source"], "fallback");
    assert_eq!(result.data["width"], 2);
    assert_eq!(result.data["height"], 1);
    assert!(result.data["summary"].as_str().unwrap_or("").contains("2x1"));
    assert!(result.data["data"].as_str().unwrap_or("").contains("图片描述能力暂未接入"));
}

#[test]
fn test_media_read_png_ocr_without_visual_provider_falls_back() {
    let temp_dir = tempfile::tempdir().expect("create temp dir");
    let original_dir = std::env::current_dir().expect("read current dir");
    std::env::set_current_dir(temp_dir.path()).expect("enter temp dir");
    fs::write(
        temp_dir.path().join("image.png"),
        vec![0x89, b'P', b'N', b'G', b'\r', b'\n', 0x1a, b'\n', 0, 0, 0, 0, b'I', b'H', b'D', b'R', 0, 0, 0, 1, 0, 0, 0, 1],
    )
    .expect("write png header");

    let result = tools::media::read::execute(serde_json::json!({
        "path": "image.png",
        "mode": "ocr"
    }))
    .expect("tool execution should succeed");

    std::env::set_current_dir(original_dir).expect("restore current dir");

    assert!(result.success);
    assert_eq!(result.data["source"], "fallback");
    assert!(result.data["data"].as_str().unwrap_or("").contains("OCR 能力暂未接入"));
}

#[test]
fn test_interaction_ask_returns_pending_state() {
    let result = tools::interaction::ask::execute(serde_json::json!({
        "question": "继续吗？",
        "options": [{ "label": "是", "description": "继续执行" }]
    }))
    .expect("tool execution should succeed");

    assert!(result.success);
    assert_eq!(result.data["pending"], true);
    assert_eq!(result.data["question"], "继续吗？");
}

#[test]
fn test_skill_registry_prefers_project_over_user_over_workspace() {
    let temp_dir = tempfile::tempdir().expect("create temp dir");
    let home_dir = temp_dir.path().join("home");
    let workdir = temp_dir.path().join("workspace");

    fs::create_dir_all(home_dir.join(".sacode/skills")).expect("create user skills dir");
    fs::create_dir_all(workdir.join("skills")).expect("create workspace skills dir");
    fs::create_dir_all(workdir.join(".sacode/skills")).expect("create project skills dir");

    fs::write(
        workdir.join("skills/deploy.md"),
        "# deploy\n\nDescription: workspace\n\n## Prompt\n\nworkspace prompt\n",
    )
    .expect("write workspace skill");
    fs::write(
        home_dir.join(".sacode/skills/deploy.md"),
        "# deploy\n\nDescription: user\n\n## Prompt\n\nuser prompt\n",
    )
    .expect("write user skill");
    fs::write(
        workdir.join(".sacode/skills/deploy.md"),
        "# deploy\n\nDescription: project\n\n## Prompt\n\nproject prompt\n",
    )
    .expect("write project skill");

    let previous_home = std::env::var_os("HOME");
    std::env::set_var("HOME", &home_dir);

    let registry = SkillRegistry::new(&workdir);
    let skill = registry.get("deploy").expect("load merged skill");

    match previous_home {
        Some(value) => std::env::set_var("HOME", value),
        None => std::env::remove_var("HOME"),
    }

    assert_eq!(skill.description, "project");
    assert_eq!(skill.prompt, "project prompt");
    assert_eq!(skill.source.label(), "project");
}

#[test]
fn test_mcp_store_prefers_project_over_user() {
    let temp_dir = tempfile::tempdir().expect("create temp dir");
    let home_dir = temp_dir.path().join("home");
    let workdir = temp_dir.path().join("workspace");

    fs::create_dir_all(&home_dir).expect("create home dir");
    fs::create_dir_all(&workdir).expect("create workspace dir");

    let previous_home = std::env::var_os("HOME");
    std::env::set_var("HOME", &home_dir);

    let config = SaCodeConfig::new(&workdir);
    let store = McpConfigStore::new_from_config(config.clone());

    store
        .save_to_source(
            &McpConfig {
                mcp: std::collections::BTreeMap::from([(
                    "github".to_string(),
                    McpServerConfig {
                        server_type: "remote".to_string(),
                        url: "https://user.example/mcp".to_string(),
                        enabled: true,
                    },
                )]),
            },
            McpSource::User,
        )
        .expect("save user mcp config");

    store
        .save_to_source(
            &McpConfig {
                mcp: std::collections::BTreeMap::from([(
                    "github".to_string(),
                    McpServerConfig {
                        server_type: "remote".to_string(),
                        url: "https://project.example/mcp".to_string(),
                        enabled: false,
                    },
                )]),
            },
            McpSource::Project,
        )
        .expect("save project mcp config");

    let merged = store.load().expect("load merged mcp config");
    let entries = store.list_entries().expect("list merged entries");

    match previous_home {
        Some(value) => std::env::set_var("HOME", value),
        None => std::env::remove_var("HOME"),
    }

    let github = merged.mcp.get("github").expect("merged github config");
    assert_eq!(github.url, "https://project.example/mcp");
    assert!(!github.enabled);
    assert_eq!(entries.len(), 1);
    assert_eq!(entries[0].source.label(), "project");
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
