use super::*;

#[test]
fn test_tool_registry() {
    let registry = ToolRegistry::builtin();
    let names = registry.names();

    assert!(names.contains(&"browser.open"));
    assert!(names.contains(&"browser.navigate"));
    assert!(names.contains(&"browser.snapshot"));
    assert!(names.contains(&"browser.extract"));
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
fn test_tool_registry_executes_registered_tool() {
    let registry = ToolRegistry::builtin();
    let output = registry
        .execute("interaction.ask", serde_json::json!({
            "question": "继续吗？",
            "options": [
                { "label": "是" },
                { "label": "否" }
            ]
        }))
        .expect("registered tool should execute");

    assert!(output.success);
    assert_eq!(output.data["question"], "继续吗？");
}

#[test]
fn test_tool_registry_exposes_registered_specs() {
    let registry = ToolRegistry::builtin();
    let spec_names: Vec<&str> = registry.specs().into_iter().map(|spec| spec.name.as_str()).collect();

    assert!(spec_names.contains(&"fs.read"));
    assert!(spec_names.contains(&"task.spawn"));
}

#[test]
fn test_browser_tools_validate_missing_session() {
    let registry = ToolRegistry::builtin();
    let output = registry
        .execute("browser.snapshot", serde_json::json!({
            "session_id": "missing-session"
        }))
        .expect_err("missing browser session should error");

    assert!(output.to_string().contains("browser session not found"));
}

#[test]
fn test_tool_spec_read_only() {
    let spec = crate::tools::fs::read::spec();
    assert!(spec.is_read_only());
    assert!(!spec.needs_approval());
}

#[test]
fn test_fs_write_respects_sandbox_denied_path() {
    let _guard = sandbox_test_lock();
    let temp_dir = tempfile::tempdir().expect("create temp dir");
    let workdir = temp_dir.path();

    let policy = crate::sandbox::SandboxPolicy::new()
        .allow_path(workdir.to_path_buf())
        .deny_path(workdir.join("blocked"));
    crate::sandbox::install_global_policy(policy);

    let blocked_path = workdir.join("blocked/file.txt");
    let registry = ToolRegistry::builtin();
    let output = registry
        .execute("fs.write", serde_json::json!({
            "path": blocked_path.display().to_string(),
            "content": "secret"
        }))
        .expect_err("sandbox should block denied path");

    assert!(output.to_string().contains("sandbox policy"));

    crate::sandbox::reset_global_policy();
}

#[test]
fn test_web_fetch_respects_sandbox_network_policy() {
    let _guard = sandbox_test_lock();
    let mut policy = crate::sandbox::SandboxPolicy::for_mode(ExecutionMode::Build);
    policy.network.fetch_allowed = false;
    crate::sandbox::install_global_policy(policy);

    let registry = ToolRegistry::builtin();
    let output = registry
        .execute("web.fetch", serde_json::json!({
            "url": "https://example.com"
        }))
        .expect_err("sandbox should block network access before execution");

    assert!(output.to_string().contains("network access blocked by sandbox policy"));

    crate::sandbox::reset_global_policy();
}

#[test]
fn test_web_search_allowed_in_plan_mode() {
    let _guard = sandbox_test_lock();
    crate::sandbox::install_global_policy(crate::sandbox::SandboxPolicy::for_mode(ExecutionMode::Plan));

    let policy = crate::sandbox::active_policy();
    assert!(policy.network.search_allowed);
    assert!(!policy.network.fetch_allowed);
    assert!(!policy.network.browser_allowed);

    crate::sandbox::reset_global_policy();
}

#[test]
fn test_shell_exec_respects_sandbox_allowed_commands() {
    let _guard = sandbox_test_lock();
    let mut policy = crate::sandbox::SandboxPolicy::for_mode(ExecutionMode::Build);
    policy.shell.allowed_commands = vec!["pwd".to_string()];
    crate::sandbox::install_global_policy(policy);

    let registry = ToolRegistry::builtin();
    let output = registry
        .execute("shell.exec", serde_json::json!({
            "command": "git status"
        }))
        .expect_err("sandbox should block disallowed command");

    assert!(output.to_string().contains("sandbox policy"));

    crate::sandbox::reset_global_policy();
}

#[test]
fn test_browser_open_respects_sandbox_network_policy() {
    let _guard = sandbox_test_lock();
    crate::sandbox::install_global_policy(
        crate::sandbox::SandboxPolicy::new().allow_path(std::path::PathBuf::from(".")),
    );

    let registry = ToolRegistry::builtin();
    let output = registry
        .execute("browser.open", serde_json::json!({
            "url": "https://example.com"
        }))
        .expect_err("sandbox should block browser network access");

    assert!(output.to_string().contains("network access blocked by sandbox policy"));

    crate::sandbox::reset_global_policy();
}

#[test]
fn test_git_diff_respects_sandbox_allowed_commands() {
    let _guard = sandbox_test_lock();
    let mut policy = crate::sandbox::SandboxPolicy::for_mode(ExecutionMode::Build);
    policy.shell.allowed_commands = vec!["pwd".to_string()];
    crate::sandbox::install_global_policy(policy);

    let registry = ToolRegistry::builtin();
    let output = registry
        .execute("git.diff", serde_json::json!({}))
        .expect_err("sandbox should block git command");

    assert!(output.to_string().contains("command 'git' is blocked by sandbox policy"));

    crate::sandbox::reset_global_policy();
}

#[test]
fn test_fs_read_multi_respects_sandbox_paths_array() {
    let _guard = sandbox_test_lock();
    let temp_dir = tempfile::tempdir().expect("create temp dir");
    let workdir = temp_dir.path();
    let allowed_file = workdir.join("allowed.txt");
    let blocked_file = workdir.join("blocked/secret.txt");
    std::fs::write(&allowed_file, "ok").expect("write allowed file");
    std::fs::create_dir_all(blocked_file.parent().expect("blocked parent")).expect("create blocked dir");
    std::fs::write(&blocked_file, "secret").expect("write blocked file");

    crate::sandbox::install_global_policy(
        crate::sandbox::SandboxPolicy::new()
            .allow_path(workdir.to_path_buf())
            .deny_path(workdir.join("blocked")),
    );

    let registry = ToolRegistry::builtin();
    let output = registry
        .execute("fs.read_multi", serde_json::json!({
            "paths": [
                allowed_file.display().to_string(),
                blocked_file.display().to_string()
            ]
        }))
        .expect_err("sandbox should block denied path inside paths array");

    assert!(output.to_string().contains("path is blocked by sandbox policy"));

    crate::sandbox::reset_global_policy();
}

#[test]
fn test_plan_mode_blocks_fs_write_by_default() {
    let _guard = sandbox_test_lock();
    let temp_dir = tempfile::tempdir().expect("create temp dir");
    let workdir = temp_dir.path();

    crate::sandbox::install_global_policy(crate::sandbox::SandboxPolicy::for_mode(ExecutionMode::Plan));

    let blocked_path = workdir.join("file.txt");
    let registry = ToolRegistry::builtin();
    let output = registry
        .execute("fs.write", serde_json::json!({
            "path": blocked_path.display().to_string(),
            "content": "blocked"
        }))
        .expect_err("plan mode should block writes by default");

    assert!(!blocked_path.exists());
    assert!(!output.to_string().is_empty());

    crate::sandbox::reset_global_policy();
}

#[test]
fn test_tool_registry_blocks_base_url_network_fields() {
    let _guard = sandbox_test_lock();
    crate::sandbox::install_global_policy(
        crate::sandbox::SandboxPolicy::new().allow_path(std::path::PathBuf::from(".")),
    );

    let mut registry = ToolRegistry::default();
    registry.register_fn(
        ToolSpec {
            name: "test.base_url_guard".to_string(),
            description: "test tool".to_string(),
            input_schema: serde_json::json!({
                "type": "object",
                "properties": {
                    "base_url": { "type": "string" }
                }
            }),
            output_schema: serde_json::json!({ "type": "object" }),
            side_effect_level: SideEffectLevel::ReadOnly,
            approval_required: false,
            timeout_ms: None,
            tags: vec!["test".to_string()],
        },
        |_| Ok(ToolOutput::success(serde_json::json!({ "ok": true }))),
    );

    let output = registry
        .execute("test.base_url_guard", serde_json::json!({
            "base_url": "https://example.com/api"
        }))
        .expect_err("sandbox should block base_url network access");

    assert!(output.to_string().contains("network access blocked by sandbox policy"));

    crate::sandbox::reset_global_policy();
}

#[test]
fn test_tool_registry_blocks_urls_array_network_fields() {
    let _guard = sandbox_test_lock();
    crate::sandbox::install_global_policy(
        crate::sandbox::SandboxPolicy::new().allow_path(std::path::PathBuf::from(".")),
    );

    let mut registry = ToolRegistry::default();
    registry.register_fn(
        ToolSpec {
            name: "test.urls_guard".to_string(),
            description: "test tool".to_string(),
            input_schema: serde_json::json!({
                "type": "object",
                "properties": {
                    "urls": {
                        "type": "array",
                        "items": { "type": "string" }
                    }
                }
            }),
            output_schema: serde_json::json!({ "type": "object" }),
            side_effect_level: SideEffectLevel::ReadOnly,
            approval_required: false,
            timeout_ms: None,
            tags: vec!["test".to_string()],
        },
        |_| Ok(ToolOutput::success(serde_json::json!({ "ok": true }))),
    );

    let output = registry
        .execute("test.urls_guard", serde_json::json!({
            "urls": ["https://example.com/a", "https://example.com/b"]
        }))
        .expect_err("sandbox should block urls array network access");

    assert!(output.to_string().contains("network access blocked by sandbox policy"));

    crate::sandbox::reset_global_policy();
}

#[test]
fn test_tool_spec_exec_needs_approval() {
    let spec = crate::tools::shell::exec::spec();
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
    let _guard = sandbox_test_lock();
    crate::sandbox::reset_global_policy();
    let temp_dir = tempfile::tempdir().expect("create temp dir");
    let _cwd = CurrentDirGuard::enter(temp_dir.path());

    let result = crate::tools::fs::write::execute(serde_json::json!({
        "path": "nested/output.txt",
        "content": "hello"
    }))
    .expect("tool execution should succeed");

    let written = fs::read_to_string(temp_dir.path().join("nested/output.txt"))
        .expect("written file should exist");
    crate::sandbox::reset_global_policy();

    assert!(result.success);
    assert_eq!(written, "hello");
}

#[test]
fn test_fs_write_rejects_parent_escape() {
    let _guard = sandbox_test_lock();
    crate::sandbox::reset_global_policy();
    let temp_dir = tempfile::tempdir().expect("create temp dir");
    let _cwd = CurrentDirGuard::enter(temp_dir.path());

    let error = crate::tools::fs::write::execute(serde_json::json!({
        "path": "../escape.txt",
        "content": "blocked"
    }))
    .expect_err("parent escape should fail");

    crate::sandbox::reset_global_policy();

    assert!(error.to_string().contains("outside workspace") || error.to_string().contains("blocked"));
}

#[test]
fn test_fs_edit_replace_single() {
    let _guard = sandbox_test_lock();
    let temp_dir = tempfile::tempdir().expect("create temp dir");
    let _cwd = CurrentDirGuard::enter(temp_dir.path());
    fs::write(temp_dir.path().join("edit.txt"), "hello world").expect("seed file");

    let result = crate::tools::fs::edit::execute(serde_json::json!({
        "path": "edit.txt",
        "old_string": "world",
        "new_string": "sacode"
    }))
    .expect("tool execution should succeed");

    let updated = fs::read_to_string(temp_dir.path().join("edit.txt")).expect("read updated file");

    assert!(result.success);
    assert_eq!(updated, "hello sacode");
}

#[test]
fn test_fs_edit_not_found() {
    let _guard = sandbox_test_lock();
    let temp_dir = tempfile::tempdir().expect("create temp dir");
    let _cwd = CurrentDirGuard::enter(temp_dir.path());
    fs::write(temp_dir.path().join("edit.txt"), "hello world").expect("seed file");

    let result = crate::tools::fs::edit::execute(serde_json::json!({
        "path": "edit.txt",
        "old_string": "missing",
        "new_string": "sacode"
    }))
    .expect("tool execution should succeed");

    assert!(!result.success);
    assert!(result.message.unwrap_or_default().contains("not found"));
}

#[test]
fn test_fs_read_multi_reads_multiple_files() {
    let _guard = sandbox_test_lock();
    let temp_dir = tempfile::tempdir().expect("create temp dir");
    let _cwd = CurrentDirGuard::enter(temp_dir.path());
    fs::write(temp_dir.path().join("a.txt"), "a1\na2").expect("write a");
    fs::write(temp_dir.path().join("b.txt"), "b1\nb2").expect("write b");

    let result = crate::tools::fs::read_multi::execute(serde_json::json!({
        "paths": ["a.txt", "b.txt"],
        "limit_per_file": 10
    }))
    .expect("tool execution should succeed");

    assert!(result.success);
    assert_eq!(result.data["success_count"], 2);
    assert_eq!(result.data["failed_count"], 0);
}

#[test]
fn test_fs_list_lists_directory_entries() {
    let _guard = sandbox_test_lock();
    let temp_dir = tempfile::tempdir().expect("create temp dir");
    let _cwd = CurrentDirGuard::enter(temp_dir.path());
    fs::create_dir_all(temp_dir.path().join("nested")).expect("create dir");
    fs::write(temp_dir.path().join("root.txt"), "x").expect("write file");

    let result = crate::tools::fs::list::execute(serde_json::json!({
        "path": ".",
        "recursive": false,
        "include_hidden": false
    }))
    .expect("tool execution should succeed");

    assert!(result.success);
    let entries = result.data["entries"].as_array().expect("entries array");
    assert!(entries.iter().any(|entry| entry["name"] == "root.txt"));
    assert!(entries.iter().any(|entry| entry["name"] == "nested"));
}

#[test]
fn test_media_read_base64_mode() {
    let _guard = sandbox_test_lock();
    let temp_dir = tempfile::tempdir().expect("create temp dir");
    let _cwd = CurrentDirGuard::enter(temp_dir.path());
    fs::write(temp_dir.path().join("image.png"), vec![0x48, 0x69]).expect("write binary file");

    let result = crate::tools::media::read::execute(serde_json::json!({
        "path": "image.png",
        "mode": "base64"
    }))
    .expect("tool execution should succeed");

    assert!(result.success);
    assert_eq!(result.data["mime_type"], "image/png");
    assert_eq!(result.data["data"], "SGk=");
    assert_eq!(result.data["source"], "base64");
}

#[test]
fn test_media_read_ppm_describe_mode_includes_dimensions() {
    let _guard = sandbox_test_lock();
    let temp_dir = tempfile::tempdir().expect("create temp dir");
    let _cwd = CurrentDirGuard::enter(temp_dir.path());
    fs::write(
        temp_dir.path().join("image.ppm"),
        b"P6\n2 1\n255\n\xff\x00\x00\x00\xff\x00",
    )
    .expect("write ppm file");

    let result = crate::tools::media::read::execute(serde_json::json!({
        "path": "image.ppm",
        "mode": "describe"
    }))
    .expect("tool execution should succeed");

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
    let _guard = sandbox_test_lock();
    let temp_dir = tempfile::tempdir().expect("create temp dir");
    let _cwd = CurrentDirGuard::enter(temp_dir.path());
    fs::write(
        temp_dir.path().join("image.png"),
        vec![0x89, b'P', b'N', b'G', b'\r', b'\n', 0x1a, b'\n', 0, 0, 0, 0, b'I', b'H', b'D', b'R', 0, 0, 0, 1, 0, 0, 0, 1],
    )
    .expect("write png header");

    let result = crate::tools::media::read::execute(serde_json::json!({
        "path": "image.png",
        "mode": "ocr"
    }))
    .expect("tool execution should succeed");

    assert!(result.success);
    assert_eq!(result.data["source"], "fallback");
    assert!(result.data["data"].as_str().unwrap_or("").contains("OCR 能力暂未接入"));
}

#[test]
fn test_interaction_ask_returns_pending_state() {
    let result = crate::tools::interaction::ask::execute(serde_json::json!({
        "question": "继续吗？",
        "options": [{ "label": "是", "description": "继续执行" }]
    }))
    .expect("tool execution should succeed");

    assert!(result.success);
    assert_eq!(result.data["pending"], true);
    assert_eq!(result.data["question"], "继续吗？");
}
