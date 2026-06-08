use super::*;
use std::process::Command;

#[test]
fn test_tool_registry() {
    let registry = ToolRegistry::builtin();
    let names = registry.names();

    assert!(names.contains(&"browser.open"));
    assert!(names.contains(&"browser.navigate"));
    assert!(names.contains(&"browser.snapshot"));
    assert!(names.contains(&"browser.extract"));
    assert!(names.contains(&"code.deps"));
    assert!(names.contains(&"code.symbols"));
    assert!(names.contains(&"fs.read"));
    assert!(names.contains(&"fs.search"));
    assert!(names.contains(&"fs.edit"));
    assert!(names.contains(&"fs.patch"));
    assert!(names.contains(&"fs.read_multi"));
    assert!(names.contains(&"fs.list"));
    assert!(names.contains(&"git.commit"));
    assert!(names.contains(&"git.diff"));
    assert!(names.contains(&"interaction.ask"));
    assert!(names.contains(&"media.read"));
    assert!(names.contains(&"media.vision"));
    assert!(names.contains(&"shell.exec"));
    assert!(names.contains(&"task.spawn"));
    assert!(names.contains(&"test.run"));
    assert!(names.contains(&"web.fetch"));
    assert!(names.contains(&"web.search"));
}

#[test]
fn test_tool_registry_executes_registered_tool() {
    let registry = ToolRegistry::builtin();
    let output = registry
        .execute(
            "interaction.ask",
            serde_json::json!({
                "question": "继续吗？",
                "options": [
                    { "label": "是" },
                    { "label": "否" }
                ]
            }),
        )
        .expect("registered tool should execute");

    assert!(output.success);
    assert_eq!(output.data["question"], "继续吗？");
}

#[test]
fn test_tool_registry_exposes_registered_specs() {
    let registry = ToolRegistry::builtin();
    let spec_names: Vec<&str> = registry
        .specs()
        .into_iter()
        .map(|spec| spec.name.as_str())
        .collect();

    assert!(spec_names.contains(&"fs.read"));
    assert!(spec_names.contains(&"fs.patch"));
    assert!(spec_names.contains(&"code.deps"));
    assert!(spec_names.contains(&"code.symbols"));
    assert!(spec_names.contains(&"git.commit"));
    assert!(spec_names.contains(&"media.vision"));
    assert!(spec_names.contains(&"task.spawn"));
    assert!(spec_names.contains(&"test.run"));
}

#[test]
fn test_git_commit_spec_needs_approval() {
    let spec = crate::tools::git::commit::spec();
    assert!(!spec.is_read_only());
    assert!(spec.needs_approval());
}

#[test]
fn test_code_symbols_spec_is_read_only() {
    let spec = crate::tools::code::symbol::spec();
    assert!(spec.is_read_only());
    assert!(!spec.needs_approval());
}

#[test]
fn test_code_symbols_extracts_rust_symbols_from_file() {
    let _guard = sandbox_test_lock();
    crate::sandbox::reset_global_policy();
    let temp_dir = tempfile::tempdir().expect("create temp dir");
    let _cwd = CurrentDirGuard::enter(temp_dir.path());
    fs::write(
        temp_dir.path().join("lib.rs"),
        "pub struct Demo;\nasync fn run_task() {}\nimpl Demo {}\nmod inner {}\n",
    )
    .expect("write Rust file");

    let output = crate::tools::code::symbol::execute(serde_json::json!({
        "path": "lib.rs"
    }))
    .expect("tool execution should succeed");

    assert!(output.success);
    assert_eq!(output.data["language"], "rust");
    assert_eq!(output.data["count"], 4);
    let symbols = output.data["symbols"].as_array().expect("symbols array");
    assert_eq!(symbols[0]["name"], "Demo");
    assert_eq!(symbols[0]["kind"], "struct");
    assert_eq!(symbols[1]["name"], "run_task");
    assert_eq!(symbols[1]["kind"], "fn");
}

#[test]
fn test_code_symbols_extracts_rust_symbols_from_directory() {
    let _guard = sandbox_test_lock();
    crate::sandbox::reset_global_policy();
    let temp_dir = tempfile::tempdir().expect("create temp dir");
    let _cwd = CurrentDirGuard::enter(temp_dir.path());
    fs::create_dir_all(temp_dir.path().join("src/nested")).expect("create nested dir");
    fs::write(temp_dir.path().join("src/lib.rs"), "pub enum Mode { A }\n").expect("write lib");
    fs::write(
        temp_dir.path().join("src/nested/mod.rs"),
        "trait Worker {}\n",
    )
    .expect("write mod");

    let output = crate::tools::code::symbol::execute(serde_json::json!({
        "path": "src"
    }))
    .expect("tool execution should succeed");

    assert!(output.success);
    assert_eq!(output.data["count"], 2);
    let symbols = output.data["symbols"].as_array().expect("symbols array");
    assert!(symbols.iter().any(|entry| entry["name"] == "Mode"));
    assert!(symbols.iter().any(|entry| entry["name"] == "Worker"));
}

#[test]
fn test_code_symbols_extracts_python_symbols() {
    let _guard = sandbox_test_lock();
    crate::sandbox::reset_global_policy();
    let temp_dir = tempfile::tempdir().expect("create temp dir");
    let _cwd = CurrentDirGuard::enter(temp_dir.path());
    fs::write(
        temp_dir.path().join("app.py"),
        "class Worker:\n    pass\n\nasync def run_job():\n    pass\n",
    )
    .expect("write Python file");

    let output = crate::tools::code::symbol::execute(serde_json::json!({
        "path": "app.py",
        "language": "python"
    }))
    .expect("tool execution should succeed");

    assert!(output.success);
    assert_eq!(output.data["language"], "python");
    let symbols = output.data["symbols"].as_array().expect("symbols array");
    assert!(symbols.iter().any(|entry| entry["name"] == "Worker"));
    assert!(symbols.iter().any(|entry| entry["name"] == "run_job"));
}

#[test]
fn test_code_symbols_extracts_multiline_typescript_symbols() {
    let _guard = sandbox_test_lock();
    crate::sandbox::reset_global_policy();
    let temp_dir = tempfile::tempdir().expect("create temp dir");
    let _cwd = CurrentDirGuard::enter(temp_dir.path());
    fs::write(
        temp_dir.path().join("index.ts"),
        "export\nfunction startServer() {}\nconst runTask =\n  () => {}\n",
    )
    .expect("write TS file");

    let output = crate::tools::code::symbol::execute(serde_json::json!({
        "path": "index.ts",
        "language": "typescript"
    }))
    .expect("tool execution should succeed");

    assert!(output.success);
    let symbols = output.data["symbols"].as_array().expect("symbols array");
    assert!(symbols.iter().any(|entry| entry["name"] == "startServer"));
    assert!(symbols.iter().any(|entry| entry["name"] == "runTask"));
}

#[test]
fn test_code_symbols_extracts_typescript_symbols() {
    let _guard = sandbox_test_lock();
    crate::sandbox::reset_global_policy();
    let temp_dir = tempfile::tempdir().expect("create temp dir");
    let _cwd = CurrentDirGuard::enter(temp_dir.path());
    fs::write(
        temp_dir.path().join("index.ts"),
        "export interface User {}\nexport function start() {}\nconst runTask = () => {}\n",
    )
    .expect("write TS file");

    let output = crate::tools::code::symbol::execute(serde_json::json!({
        "path": "index.ts",
        "language": "typescript"
    }))
    .expect("tool execution should succeed");

    assert!(output.success);
    assert_eq!(output.data["language"], "typescript");
    let symbols = output.data["symbols"].as_array().expect("symbols array");
    assert!(symbols.iter().any(|entry| entry["name"] == "User"));
    assert!(symbols.iter().any(|entry| entry["name"] == "start"));
    assert!(symbols.iter().any(|entry| entry["name"] == "runTask"));
}

#[test]
fn test_code_symbols_extracts_go_symbols() {
    let _guard = sandbox_test_lock();
    crate::sandbox::reset_global_policy();
    let temp_dir = tempfile::tempdir().expect("create temp dir");
    let _cwd = CurrentDirGuard::enter(temp_dir.path());
    fs::write(
        temp_dir.path().join("main.go"),
        "type Worker struct {}\nfunc Run() {}\nvar globalValue = 1\n",
    )
    .expect("write Go file");

    let output = crate::tools::code::symbol::execute(serde_json::json!({
        "path": "main.go",
        "language": "go"
    }))
    .expect("tool execution should succeed");

    assert!(output.success);
    assert_eq!(output.data["language"], "go");
    let symbols = output.data["symbols"].as_array().expect("symbols array");
    assert!(symbols.iter().any(|entry| entry["name"] == "Worker"));
    assert!(symbols.iter().any(|entry| entry["name"] == "Run"));
    assert!(symbols.iter().any(|entry| entry["name"] == "globalValue"));
}

#[test]
fn test_code_deps_spec_is_read_only() {
    let spec = crate::tools::code::deps::spec();
    assert!(spec.is_read_only());
    assert!(!spec.needs_approval());
}

#[test]
fn test_code_deps_extracts_dependencies_from_multiple_languages() {
    let _guard = sandbox_test_lock();
    crate::sandbox::reset_global_policy();
    let temp_dir = tempfile::tempdir().expect("create temp dir");
    let _cwd = CurrentDirGuard::enter(temp_dir.path());
    fs::create_dir_all(temp_dir.path().join("src")).expect("create src");
    fs::write(
        temp_dir.path().join("src/lib.rs"),
        "use std::collections::HashMap;\npub use crate::inner::Thing;\n",
    )
    .expect("write rust file");
    fs::write(
        temp_dir.path().join("src/app.py"),
        "import os, sys\nfrom pkg.worker import run\n",
    )
    .expect("write python file");
    fs::write(
        temp_dir.path().join("src/index.ts"),
        "import foo from './foo'\nconst bar = require(\"./bar\")\n",
    )
    .expect("write ts file");

    let output = crate::tools::code::deps::execute(serde_json::json!({
        "path": "src"
    }))
    .expect("tool execution should succeed");

    assert!(output.success);
    assert_eq!(output.data["count"], 3);
    let files = output.data["files"].as_array().expect("files array");

    let rust_file = files
        .iter()
        .find(|entry| entry["path"] == "lib.rs")
        .expect("find rust file");
    assert!(rust_file["imports"]
        .as_array()
        .expect("imports array")
        .iter()
        .any(|item| item == "std::collections::HashMap"));

    let python_file = files
        .iter()
        .find(|entry| entry["path"] == "app.py")
        .expect("find python file");
    assert!(python_file["imports"]
        .as_array()
        .expect("imports array")
        .iter()
        .any(|item| item == "pkg.worker"));

    let ts_file = files
        .iter()
        .find(|entry| entry["path"] == "index.ts")
        .expect("find ts file");
    assert!(ts_file["imports"]
        .as_array()
        .expect("imports array")
        .iter()
        .any(|item| item == "./foo"));
    assert!(ts_file["imports"]
        .as_array()
        .expect("imports array")
        .iter()
        .any(|item| item == "./bar"));
}

#[test]
fn test_code_deps_populates_imported_by_for_workspace_paths() {
    let _guard = sandbox_test_lock();
    crate::sandbox::reset_global_policy();
    let temp_dir = tempfile::tempdir().expect("create temp dir");
    let _cwd = CurrentDirGuard::enter(temp_dir.path());
    fs::create_dir_all(temp_dir.path().join("src")).expect("create src");
    fs::write(
        temp_dir.path().join("src/a.ts"),
        "import helper from './b'\n",
    )
    .expect("write a.ts");
    fs::write(
        temp_dir.path().join("src/b.ts"),
        "export const helper = 1\n",
    )
    .expect("write b.ts");

    let output = crate::tools::code::deps::execute(serde_json::json!({
        "path": "src"
    }))
    .expect("tool execution should succeed");

    assert!(output.success);
    let files = output.data["files"].as_array().expect("files array");
    let b_file = files
        .iter()
        .find(|entry| entry["path"] == "b.ts")
        .expect("find b.ts");
    assert!(b_file["imported_by"]
        .as_array()
        .expect("imported_by array")
        .iter()
        .any(|item| item == "a.ts"));
}

#[test]
fn test_code_deps_extracts_multiline_go_import_block() {
    let _guard = sandbox_test_lock();
    crate::sandbox::reset_global_policy();
    let temp_dir = tempfile::tempdir().expect("create temp dir");
    let _cwd = CurrentDirGuard::enter(temp_dir.path());
    fs::write(
        temp_dir.path().join("main.go"),
        "package main\nimport (\n    \"fmt\"\n    \"net/http\"\n)\nfunc main() {}\n",
    )
    .expect("write Go file");

    let output = crate::tools::code::deps::execute(serde_json::json!({
        "path": "main.go"
    }))
    .expect("tool execution should succeed");

    assert!(output.success);
    let files = output.data["files"].as_array().expect("files array");
    let go_file = files.first().expect("go file entry");
    let imports = go_file["imports"].as_array().expect("imports array");
    assert!(imports.iter().any(|item| item == "fmt"));
    assert!(imports.iter().any(|item| item == "net/http"));
}

#[test]
fn test_git_commit_requires_staged_changes_without_add_all() {
    let _guard = sandbox_test_lock();
    crate::sandbox::reset_global_policy();
    let temp_dir = tempfile::tempdir().expect("create temp dir");
    let _cwd = CurrentDirGuard::enter(temp_dir.path());

    Command::new("git")
        .args(["init"])
        .output()
        .expect("git init");
    fs::write(temp_dir.path().join("file.txt"), "hello").expect("write file");

    let result = crate::tools::git::commit::execute(serde_json::json!({
        "message": "feat: test commit"
    }))
    .expect("tool execution should succeed");

    assert!(!result.success);
    assert!(result
        .message
        .unwrap_or_default()
        .contains("no staged changes"));
}

#[test]
fn test_git_commit_add_all_creates_commit() {
    let _guard = sandbox_test_lock();
    crate::sandbox::reset_global_policy();
    let temp_dir = tempfile::tempdir().expect("create temp dir");
    let _cwd = CurrentDirGuard::enter(temp_dir.path());

    Command::new("git")
        .args(["init"])
        .output()
        .expect("git init");
    Command::new("git")
        .args(["config", "user.name", "SaCode Test"])
        .output()
        .expect("set git user.name");
    Command::new("git")
        .args(["config", "user.email", "test@example.com"])
        .output()
        .expect("set git user.email");
    fs::write(temp_dir.path().join("file.txt"), "hello").expect("write file");

    let registry = ToolRegistry::builtin();
    let result = registry
        .execute(
            "git.commit",
            serde_json::json!({
                "message": "feat: test commit",
                "add_all": true
            }),
        )
        .expect("tool execution should succeed");

    assert!(result.success);
    assert_eq!(result.data["message"], "feat: test commit");
    assert!(result.data["commit_hash"].as_str().is_some());
    let audit_log =
        fs::read_to_string(temp_dir.path().join(".sacode/audit.log")).expect("read audit log");
    assert!(audit_log.contains("\"tool\":\"git.commit\""));
    assert!(audit_log.contains("\"status\":\"success\""));
}

#[test]
fn test_test_run_spec_is_read_only() {
    let spec = crate::tools::test::runner::spec();
    assert!(spec.is_read_only());
    assert!(!spec.needs_approval());
}

#[test]
fn test_test_run_detects_rust_workspace_and_returns_summary() {
    let _guard = sandbox_test_lock();
    crate::sandbox::reset_global_policy();
    let temp_dir = tempfile::tempdir().expect("create temp dir");
    let _cwd = CurrentDirGuard::enter(temp_dir.path());
    std::fs::write(
        temp_dir.path().join("Cargo.toml"),
        "[package]\nname = \"demo\"\nversion = \"0.1.0\"\nedition = \"2021\"\n",
    )
    .expect("write Cargo.toml");

    let output = crate::tools::test::runner::execute(serde_json::json!({
        "framework": "cargo",
        "filter": "--version"
    }))
    .expect("tool execution should succeed");

    assert!(output.success);
    assert_eq!(output.data["framework"], "cargo");
    assert!(output.data["summary"].as_str().is_some());
}

#[test]
fn test_browser_tools_validate_missing_session() {
    let registry = ToolRegistry::builtin();
    let output = registry
        .execute(
            "browser.snapshot",
            serde_json::json!({
                "session_id": "missing-session"
            }),
        )
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
        .execute(
            "fs.write",
            serde_json::json!({
                "path": blocked_path.display().to_string(),
                "content": "secret"
            }),
        )
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
        .execute(
            "web.fetch",
            serde_json::json!({
                "url": "https://example.com"
            }),
        )
        .expect_err("sandbox should block network access before execution");

    assert!(output
        .to_string()
        .contains("network access blocked by sandbox policy"));

    crate::sandbox::reset_global_policy();
}

#[test]
fn test_web_search_allowed_in_plan_mode() {
    let _guard = sandbox_test_lock();
    crate::sandbox::install_global_policy(crate::sandbox::SandboxPolicy::for_mode(
        ExecutionMode::Plan,
    ));

    let policy = crate::sandbox::active_policy();
    assert!(policy.network.search_allowed);
    assert!(!policy.network.fetch_allowed);
    assert!(!policy.network.browser_allowed);

    crate::sandbox::reset_global_policy();
}

#[test]
fn test_web_fetch_output_contains_final_text() {
    let output = crate::tools::web::fetch::spec().output_schema;
    let properties = output
        .get("properties")
        .and_then(|value| value.as_object())
        .expect("properties");

    assert!(properties.contains_key("text"));
    assert!(properties.contains_key("final_text"));
    assert!(properties.contains_key("content_type"));
}

#[test]
fn test_web_search_output_contains_final_text() {
    let output = crate::tools::web::search::spec().output_schema;
    let properties = output
        .get("properties")
        .and_then(|value| value.as_object())
        .expect("properties");

    assert!(properties.contains_key("results"));
    assert!(properties.contains_key("final_text"));
    assert!(properties.contains_key("providers_used"));
}

#[test]
fn test_web_search_spec_exposes_provider_input() {
    let input = crate::tools::web::search::spec().input_schema;
    let properties = input
        .get("properties")
        .and_then(|value| value.as_object())
        .expect("properties");

    assert!(properties.contains_key("provider"));
}

#[test]
fn test_shell_exec_respects_sandbox_allowed_commands() {
    let _guard = sandbox_test_lock();
    let mut policy = crate::sandbox::SandboxPolicy::for_mode(ExecutionMode::Build);
    policy.shell.allowed_commands = vec!["pwd".to_string()];
    crate::sandbox::install_global_policy(policy);

    let registry = ToolRegistry::builtin();
    let output = registry
        .execute(
            "shell.exec",
            serde_json::json!({
                "command": "git status"
            }),
        )
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
        .execute(
            "browser.open",
            serde_json::json!({
                "url": "https://example.com"
            }),
        )
        .expect_err("sandbox should block browser network access");

    assert!(output
        .to_string()
        .contains("network access blocked by sandbox policy"));

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

    assert!(output
        .to_string()
        .contains("command 'git' is blocked by sandbox policy"));

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
    std::fs::create_dir_all(blocked_file.parent().expect("blocked parent"))
        .expect("create blocked dir");
    std::fs::write(&blocked_file, "secret").expect("write blocked file");

    crate::sandbox::install_global_policy(
        crate::sandbox::SandboxPolicy::new()
            .allow_path(workdir.to_path_buf())
            .deny_path(workdir.join("blocked")),
    );

    let registry = ToolRegistry::builtin();
    let output = registry
        .execute(
            "fs.read_multi",
            serde_json::json!({
                "paths": [
                    allowed_file.display().to_string(),
                    blocked_file.display().to_string()
                ]
            }),
        )
        .expect_err("sandbox should block denied path inside paths array");

    assert!(output
        .to_string()
        .contains("path is blocked by sandbox policy"));

    crate::sandbox::reset_global_policy();
}

#[test]
fn test_plan_mode_blocks_fs_write_by_default() {
    let _guard = sandbox_test_lock();
    let temp_dir = tempfile::tempdir().expect("create temp dir");
    let workdir = temp_dir.path();

    crate::sandbox::install_global_policy(crate::sandbox::SandboxPolicy::for_mode(
        ExecutionMode::Plan,
    ));

    let blocked_path = workdir.join("file.txt");
    let registry = ToolRegistry::builtin();
    let output = registry
        .execute(
            "fs.write",
            serde_json::json!({
                "path": blocked_path.display().to_string(),
                "content": "blocked"
            }),
        )
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
        .execute(
            "test.base_url_guard",
            serde_json::json!({
                "base_url": "https://example.com/api"
            }),
        )
        .expect_err("sandbox should block base_url network access");

    assert!(output
        .to_string()
        .contains("network access blocked by sandbox policy"));

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
        .execute(
            "test.urls_guard",
            serde_json::json!({
                "urls": ["https://example.com/a", "https://example.com/b"]
            }),
        )
        .expect_err("sandbox should block urls array network access");

    assert!(output
        .to_string()
        .contains("network access blocked by sandbox policy"));

    crate::sandbox::reset_global_policy();
}

#[test]
fn test_tool_spec_exec_needs_approval() {
    let spec = crate::tools::shell::exec::spec();
    assert!(!spec.is_read_only());
    assert!(spec.needs_approval());
}

#[test]
fn test_shell_exec_blocks_kill_commands_via_sandbox_policy() {
    let _guard = sandbox_test_lock();
    crate::sandbox::reset_global_policy();

    let error = crate::tools::shell::exec::execute(serde_json::json!({
        "command": "kill 123"
    }))
    .expect_err("kill command should be blocked");

    assert!(error
        .to_string()
        .contains("command 'kill' is blocked by sandbox policy"));
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

    assert!(
        error.to_string().contains("outside workspace") || error.to_string().contains("blocked")
    );
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
fn test_fs_patch_applies_single_patch() {
    let _guard = sandbox_test_lock();
    crate::sandbox::reset_global_policy();
    let temp_dir = tempfile::tempdir().expect("create temp dir");
    let _cwd = CurrentDirGuard::enter(temp_dir.path());
    fs::write(temp_dir.path().join("note.txt"), "alpha\nbeta\n").expect("seed file");

    let result = crate::tools::fs::patch::execute(serde_json::json!({
        "patches": [{
            "path": "note.txt",
            "old_string": "beta\n",
            "new_string": "gamma\n"
        }]
    }))
    .expect("tool execution should succeed");

    assert!(result.success);
    assert_eq!(result.data["applied"], 1);
    assert_eq!(
        fs::read_to_string(temp_dir.path().join("note.txt")).expect("read file"),
        "alpha\ngamma\n"
    );
}

#[test]
fn test_fs_patch_applies_multiple_files() {
    let _guard = sandbox_test_lock();
    crate::sandbox::reset_global_policy();
    let temp_dir = tempfile::tempdir().expect("create temp dir");
    let _cwd = CurrentDirGuard::enter(temp_dir.path());
    fs::write(temp_dir.path().join("a.txt"), "one\n").expect("seed a");
    fs::write(temp_dir.path().join("b.txt"), "two\n").expect("seed b");

    let result = crate::tools::fs::patch::execute(serde_json::json!({
        "patches": [
            {
                "path": "a.txt",
                "old_string": "one\n",
                "new_string": "uno\n"
            },
            {
                "path": "b.txt",
                "old_string": "two\n",
                "new_string": "dos\n"
            }
        ]
    }))
    .expect("tool execution should succeed");

    assert!(result.success);
    assert_eq!(result.data["applied"], 2);
    assert_eq!(
        fs::read_to_string(temp_dir.path().join("a.txt")).expect("read a"),
        "uno\n"
    );
    assert_eq!(
        fs::read_to_string(temp_dir.path().join("b.txt")).expect("read b"),
        "dos\n"
    );
}

#[test]
fn test_fs_patch_matches_lf_patch_against_crlf_file() {
    let _guard = sandbox_test_lock();
    crate::sandbox::reset_global_policy();
    let temp_dir = tempfile::tempdir().expect("create temp dir");
    let _cwd = CurrentDirGuard::enter(temp_dir.path());
    fs::write(temp_dir.path().join("note.txt"), "alpha\r\nbeta\r\n").expect("seed file");

    let result = crate::tools::fs::patch::execute(serde_json::json!({
        "patches": [{
            "path": "note.txt",
            "old_string": "beta\n",
            "new_string": "gamma\n"
        }]
    }))
    .expect("tool execution should succeed");

    assert!(result.success);
    assert_eq!(
        fs::read_to_string(temp_dir.path().join("note.txt")).expect("read file"),
        "alpha\r\ngamma\r\n"
    );
}

#[test]
fn test_fs_patch_matches_crlf_patch_against_lf_file() {
    let _guard = sandbox_test_lock();
    crate::sandbox::reset_global_policy();
    let temp_dir = tempfile::tempdir().expect("create temp dir");
    let _cwd = CurrentDirGuard::enter(temp_dir.path());
    fs::write(temp_dir.path().join("note.txt"), "alpha\nbeta\n").expect("seed file");

    let result = crate::tools::fs::patch::execute(serde_json::json!({
        "patches": [{
            "path": "note.txt",
            "old_string": "beta\r\n",
            "new_string": "gamma\r\n"
        }]
    }))
    .expect("tool execution should succeed");

    assert!(result.success);
    assert_eq!(
        fs::read_to_string(temp_dir.path().join("note.txt")).expect("read file"),
        "alpha\ngamma\n"
    );
}

#[test]
fn test_fs_patch_reports_conflict_without_writing_files() {
    let _guard = sandbox_test_lock();
    crate::sandbox::reset_global_policy();
    let temp_dir = tempfile::tempdir().expect("create temp dir");
    let _cwd = CurrentDirGuard::enter(temp_dir.path());
    fs::write(temp_dir.path().join("a.txt"), "one\n").expect("seed a");
    fs::write(temp_dir.path().join("b.txt"), "two\n").expect("seed b");

    let result = crate::tools::fs::patch::execute(serde_json::json!({
        "patches": [
            {
                "path": "a.txt",
                "old_string": "one\n",
                "new_string": "uno\n"
            },
            {
                "path": "b.txt",
                "old_string": "missing\n",
                "new_string": "dos\n"
            }
        ]
    }))
    .expect("tool execution should succeed");

    assert!(!result.success);
    let message = result.message.expect("conflict payload");
    assert!(message.contains("old_string_not_found"));
    assert_eq!(
        fs::read_to_string(temp_dir.path().join("a.txt")).expect("read a"),
        "one\n"
    );
    assert_eq!(
        fs::read_to_string(temp_dir.path().join("b.txt")).expect("read b"),
        "two\n"
    );
}

#[test]
fn test_fs_patch_applies_fuzzy_context_match() {
    let _guard = sandbox_test_lock();
    crate::sandbox::reset_global_policy();
    let temp_dir = tempfile::tempdir().expect("create temp dir");
    let _cwd = CurrentDirGuard::enter(temp_dir.path());
    fs::write(
        temp_dir.path().join("note.txt"),
        "alpha\nbeta updated\ngamma\n",
    )
    .expect("seed file");

    let result = crate::tools::fs::patch::execute(serde_json::json!({
        "patches": [{
            "path": "note.txt",
            "old_string": "alpha\nbeta\ngamma\n",
            "new_string": "alpha\ndelta\ngamma\n"
        }]
    }))
    .expect("tool execution should succeed");

    assert!(result.success);
    assert_eq!(
        fs::read_to_string(temp_dir.path().join("note.txt")).expect("read file"),
        "alpha\ndelta\ngamma\n"
    );
}

#[test]
fn test_fs_patch_writes_audit_log_on_success() {
    let _guard = sandbox_test_lock();
    crate::sandbox::reset_global_policy();
    let temp_dir = tempfile::tempdir().expect("create temp dir");
    let _cwd = CurrentDirGuard::enter(temp_dir.path());
    fs::write(temp_dir.path().join("note.txt"), "hello world").expect("seed file");

    let registry = ToolRegistry::builtin();
    let result = registry
        .execute(
            "fs.patch",
            serde_json::json!({
                "patches": [{
                    "path": "note.txt",
                    "old_string": "world",
                    "new_string": "sacode"
                }]
            }),
        )
        .expect("fs.patch should succeed");

    assert!(result.success);
    let audit_log =
        fs::read_to_string(temp_dir.path().join(".sacode/audit.log")).expect("read audit log");
    assert!(audit_log.contains("\"tool\":\"fs.patch\""));
    assert!(audit_log.contains("\"status\":\"success\""));
}

#[test]
fn test_modify_tool_writes_audit_log_on_success() {
    let _guard = sandbox_test_lock();
    crate::sandbox::reset_global_policy();
    let temp_dir = tempfile::tempdir().expect("create temp dir");
    let _cwd = CurrentDirGuard::enter(temp_dir.path());

    let registry = ToolRegistry::builtin();
    let result = registry
        .execute(
            "fs.write",
            serde_json::json!({
                "path": "note.txt",
                "content": "hello"
            }),
        )
        .expect("fs.write should succeed");

    assert!(result.success);
    let audit_log =
        fs::read_to_string(temp_dir.path().join(".sacode/audit.log")).expect("read audit log");
    assert!(audit_log.contains("\"tool\":\"fs.write\""));
    assert!(audit_log.contains("\"phase\":\"preflight_allowed\""));
    assert!(audit_log.contains("\"phase\":\"execution\""));
    assert!(audit_log.contains("\"status\":\"success\""));
}

#[test]
fn test_modify_tool_writes_audit_log_on_blocked_preflight() {
    let _guard = sandbox_test_lock();
    let temp_dir = tempfile::tempdir().expect("create temp dir");
    let workdir = temp_dir.path();
    let _cwd = CurrentDirGuard::enter(workdir);

    crate::sandbox::install_global_policy(
        crate::sandbox::SandboxPolicy::new()
            .allow_path(workdir.to_path_buf())
            .deny_path(workdir.join("blocked")),
    );

    let registry = ToolRegistry::builtin();
    let error = registry
        .execute(
            "fs.write",
            serde_json::json!({
                "path": "blocked/file.txt",
                "content": "secret"
            }),
        )
        .expect_err("fs.write should be blocked");

    assert!(error.to_string().contains("sandbox policy"));
    let audit_log = fs::read_to_string(workdir.join(".sacode/audit.log")).expect("read audit log");
    assert!(audit_log.contains("\"tool\":\"fs.write\""));
    assert!(audit_log.contains("\"phase\":\"preflight_blocked\""));
    assert!(audit_log.contains("\"status\":\"path_blocked\""));

    crate::sandbox::reset_global_policy();
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
    assert!(result.data["summary"]
        .as_str()
        .unwrap_or("")
        .contains("read 2 of 2 files successfully"));
    assert!(result.data["files"][0]["summary"]
        .as_str()
        .unwrap_or("")
        .contains("read 2 lines from"));
}

#[test]
fn test_fs_read_includes_summary() {
    let _guard = sandbox_test_lock();
    let temp_dir = tempfile::tempdir().expect("create temp dir");
    let _cwd = CurrentDirGuard::enter(temp_dir.path());
    fs::write(temp_dir.path().join("viewer.vue"), "a\nb\nc").expect("write file");

    let result = crate::tools::fs::read::execute(serde_json::json!({
        "path": "viewer.vue",
        "offset": 1,
        "limit": 2
    }))
    .expect("tool execution should succeed");

    assert!(result.success);
    assert_eq!(result.data["lines"], 2);
    assert_eq!(result.data["total_lines"], 3);
    assert_eq!(
        result.data["summary"].as_str(),
        Some("read 2 lines from viewer.vue (3 lines total)")
    );
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
    assert!(result.data["summary"]
        .as_str()
        .unwrap_or("")
        .contains("2x1"));
    assert!(result.data["data"]
        .as_str()
        .unwrap_or("")
        .contains("图片描述能力暂未接入"));
}

#[test]
fn test_media_read_png_ocr_without_visual_provider_falls_back() {
    let _guard = sandbox_test_lock();
    let temp_dir = tempfile::tempdir().expect("create temp dir");
    let _cwd = CurrentDirGuard::enter(temp_dir.path());
    fs::write(
        temp_dir.path().join("image.png"),
        vec![
            0x89, b'P', b'N', b'G', b'\r', b'\n', 0x1a, b'\n', 0, 0, 0, 0, b'I', b'H', b'D', b'R',
            0, 0, 0, 1, 0, 0, 0, 1,
        ],
    )
    .expect("write png header");

    let result = crate::tools::media::read::execute(serde_json::json!({
        "path": "image.png",
        "mode": "ocr"
    }))
    .expect("tool execution should succeed");

    assert!(result.success);
    assert_eq!(result.data["source"], "fallback");
    assert!(result.data["data"]
        .as_str()
        .unwrap_or("")
        .contains("OCR 能力暂未接入"));
}

#[test]
fn test_media_vision_png_describe_without_visual_provider_falls_back() {
    let _guard = sandbox_test_lock();
    let temp_dir = tempfile::tempdir().expect("create temp dir");
    let _cwd = CurrentDirGuard::enter(temp_dir.path());
    fs::write(
        temp_dir.path().join("image.png"),
        vec![
            0x89, b'P', b'N', b'G', b'\r', b'\n', 0x1a, b'\n', 0, 0, 0, 0, b'I', b'H', b'D', b'R',
            0, 0, 0, 1, 0, 0, 0, 1,
        ],
    )
    .expect("write png header");

    let result = crate::tools::media::vision::execute(serde_json::json!({
        "path": "image.png",
        "mode": "describe"
    }))
    .expect("tool execution should succeed");

    assert!(result.success);
    assert_eq!(result.data["source"], "fallback");
    assert!(result.data["text"]
        .as_str()
        .unwrap_or("")
        .contains("图片描述能力暂未接入"));
}

#[test]
fn test_media_vision_png_ocr_without_visual_provider_falls_back() {
    let _guard = sandbox_test_lock();
    let temp_dir = tempfile::tempdir().expect("create temp dir");
    let _cwd = CurrentDirGuard::enter(temp_dir.path());
    fs::write(
        temp_dir.path().join("image.png"),
        vec![
            0x89, b'P', b'N', b'G', b'\r', b'\n', 0x1a, b'\n', 0, 0, 0, 0, b'I', b'H', b'D', b'R',
            0, 0, 0, 1, 0, 0, 0, 1,
        ],
    )
    .expect("write png header");

    let result = crate::tools::media::vision::execute(serde_json::json!({
        "path": "image.png",
        "mode": "ocr",
        "prompt": "请只提取按钮文本"
    }))
    .expect("tool execution should succeed");

    assert!(result.success);
    assert_eq!(result.data["source"], "fallback");
    assert!(result.data["text"]
        .as_str()
        .unwrap_or("")
        .contains("OCR 能力暂未接入"));
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

#[test]
fn test_yolo_mode_allows_reading_outside_workspace() {
    let _guard = sandbox_test_lock();
    crate::sandbox::reset_global_policy();
    let temp_dir = tempfile::tempdir().expect("create temp dir");
    let outside_dir = tempfile::tempdir().expect("create outside dir");
    let outside_file = outside_dir.path().join("secret.txt");
    fs::write(&outside_file, "ok").expect("write outside file");
    let _cwd = CurrentDirGuard::enter(temp_dir.path());

    crate::sandbox::install_current_mode(ExecutionMode::Yolo);
    crate::sandbox::install_global_policy(crate::sandbox::SandboxPolicy::for_mode(
        ExecutionMode::Yolo,
    ));

    let result = crate::tools::fs::read::execute(serde_json::json!({
        "path": outside_file.display().to_string()
    }))
    .expect("yolo mode should allow outside workspace read");

    assert!(result.success);
    crate::sandbox::reset_global_policy();
}
