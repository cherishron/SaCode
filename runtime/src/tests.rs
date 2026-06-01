use std::fs;
use std::sync::{Mutex, OnceLock};
use std::sync::Arc;
use std::time::Duration;

use axum::{
    body::{to_bytes, Body},
    http::{Request, StatusCode},
};
use http_body_util::BodyExt;
use tower::util::ServiceExt;

use crate::{
    sandbox::{DockerSandboxBackend, SandboxCommand},
    build_runtime_system_prompt,
    create_daemon,
    config::{DockerSandboxConfig, SaCodeConfig, SandboxBackendConfig, SandboxBackendKind, SandboxConfig, SandboxConfigStore, SandboxModeConfig},
    load_memory_index,
    mcp::{McpConfig, McpConfigStore, McpServerConfig, McpSource},
    queue::{InMemoryStore, TaskQueue, TaskStore},
    register_enabled_mcp_tools_sync,
    rebuild_memory_index,
    skills::SkillRegistry,
    tools::{self, ToolRegistry, ToolOutput},
    MemoryScope,
    load_wiki_context,
    PromptContext,
};
use sacode_kernel::{ExecutionMode, RetryPolicy, ScheduledTask, Task, TaskPriority, TaskQueueStatus};

#[test]
fn test_run_task_once_builds_task_run_snapshot() {
    let task = Task::new("生成一个简单计划", ExecutionMode::Plan, None);
    let context = sacode_kernel::ExecutionContext::new(task).with_task_id("task-1");

    let run = crate::run_task_once(&context);

    assert_eq!(run.task_id.as_deref(), Some("task-1"));
    assert_eq!(run.mode, Some(ExecutionMode::Plan));
    assert_eq!(run.state, Some(sacode_kernel::TaskRunState::Completed));
    assert_eq!(run.prompt.as_deref(), Some("生成一个简单计划"));
    assert_eq!(run.source.as_deref(), Some("report"));
    assert!(run.started_at.is_some());
    assert!(run.updated_at.is_some());
    assert!(run.report.is_some());
}

#[test]
fn test_task_run_snapshot_preserves_waiting_state_and_output() {
    let run = crate::task_run_snapshot(
        Some("pending-1".to_string()),
        ExecutionMode::Build,
        "等待用户确认".to_string(),
        sacode_kernel::TaskRunState::WaitingForApproval,
        Some("工具需要授权".to_string()),
    );

    assert_eq!(run.task_id.as_deref(), Some("pending-1"));
    assert_eq!(run.mode, Some(ExecutionMode::Build));
    assert_eq!(run.state, Some(sacode_kernel::TaskRunState::WaitingForApproval));
    assert_eq!(run.prompt.as_deref(), Some("等待用户确认"));
    assert_eq!(run.source.as_deref(), Some("snapshot"));
    assert!(run.started_at.is_some());
    assert!(run.updated_at.is_some());
    assert_eq!(run.output_text.as_deref(), Some("工具需要授权"));
}

#[test]
fn test_runtime_orchestrator_execute_task_run_returns_snapshot() {
    let _guard = sandbox_test_lock();
    let temp_dir = tempfile::tempdir().expect("create temp dir");
    let workdir = temp_dir.path();

    let task = Task::new("生成一个简单计划", ExecutionMode::Plan, None);
    let context = sacode_kernel::ExecutionContext::new(task).with_task_id("orch-1");
    let orchestrator = crate::RuntimeOrchestrator::new(
        sacode_kernel::Supervisor::new(),
        ToolRegistry::builtin(),
        crate::SandboxExecutor::new(crate::SandboxPolicy::for_mode(ExecutionMode::Plan)),
        crate::CheckpointStorage::new(workdir),
    );

    let run = orchestrator.execute_task_run(&context).expect("execute task run");

    assert_eq!(run.task_id.as_deref(), Some("orch-1"));
    assert_eq!(run.mode, Some(ExecutionMode::Plan));
    assert_eq!(run.state, Some(sacode_kernel::TaskRunState::Completed));
    assert_eq!(run.prompt.as_deref(), Some("生成一个简单计划"));
    assert!(run.report.is_some());
}

#[tokio::test]
async fn test_role_driven_task_run_returns_snapshot() {
    let _guard = sandbox_test_lock();
    let temp_dir = tempfile::tempdir().expect("create temp dir");
    let workdir = temp_dir.path();

    let task = Task::new("生成一个简单计划", ExecutionMode::Plan, None);
    let context = sacode_kernel::ExecutionContext::new(task).with_task_id("role-1");

    let (run, _plan) = crate::execute_role_driven_task_run(
        &context,
        &crate::CheckpointStorage::new(workdir),
    )
    .await
    .expect("execute role driven task run");

    assert_eq!(run.task_id.as_deref(), Some("role-1"));
    assert_eq!(run.mode, Some(ExecutionMode::Plan));
    assert_eq!(run.state, Some(sacode_kernel::TaskRunState::Completed));
    assert_eq!(run.prompt.as_deref(), Some("生成一个简单计划"));
    assert!(run.report.is_some());
}

fn sandbox_test_lock() -> std::sync::MutexGuard<'static, ()> {
    static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
    LOCK
        .get_or_init(|| Mutex::new(()))
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

#[test]
fn test_runtime_system_prompt_loads_agents_and_project_prompt() {
    let temp_dir = tempfile::tempdir().expect("create temp dir");
    let workdir = temp_dir.path();
    fs::create_dir_all(workdir.join(".sacode")).expect("create .sacode");
    fs::write(
        workdir.join("AGENTS.md"),
        "# Repo\n\n## Workspace 边界\n- kernel only logic\n\n## 开发命令\n- cargo test --workspace\n\n## 其他\n- ignored",
    )
    .expect("write agents");
    fs::write(
        workdir.join(".sacode/prompt.md"),
        "# Project Prompt\n\n- 回答使用中文\n- 修改后同步文档",
    )
    .expect("write project prompt");

    let tool_names = vec!["fs.read".to_string(), "apply_patch".to_string()];
    let prompt = build_runtime_system_prompt(&PromptContext {
        workdir,
        mode: ExecutionMode::Build,
        tool_names: &tool_names,
    })
    .expect("build prompt");

    assert!(prompt.contains("[Platform Rules]"));
    assert!(prompt.contains("[Repository Rules]"));
    assert!(prompt.contains("kernel only logic"));
    assert!(prompt.contains("cargo test --workspace"));
    assert!(prompt.contains("[Project Prompt]"));
    assert!(prompt.contains("回答使用中文"));
}

#[test]
fn test_runtime_system_prompt_loads_layered_wiki_context() {
    let temp_dir = tempfile::tempdir().expect("create temp dir");
    let workdir = temp_dir.path();
    fs::create_dir_all(workdir.join(".sacode/wiki")).expect("create project wiki");
    fs::write(
        workdir.join(".sacode/wiki/project.md"),
        "# Project Wiki\n\n- 使用 cargo test -p sacode-cli",
    )
    .expect("write project wiki");
    fs::write(
        workdir.join(".sacode/mistakes.json"),
        r#"{"entries":[{"timestamp":"1","scope":"tui","summary":"光标错位","details":"多行输入时出现偏移"}]}"#,
    )
    .expect("write mistakes");

    let tool_names = vec!["fs.read".to_string()];
    let prompt = build_runtime_system_prompt(&PromptContext {
        workdir,
        mode: ExecutionMode::Build,
        tool_names: &tool_names,
    })
    .expect("build prompt");

    assert!(prompt.contains("[Project Knowledge]"));
    assert!(prompt.contains("Project Wiki"));
    assert!(prompt.contains("光标错位"));
}

#[test]
fn test_rebuild_memory_index_from_markdown_entries() {
    let temp_dir = tempfile::tempdir().expect("create temp dir");
    let root = temp_dir.path().join(".sacode/wiki");
    fs::create_dir_all(&root).expect("create wiki root");
    fs::write(
        root.join("preferences.md"),
        "# 项目级偏好记忆\n\n## 条目\n\n[记忆条目]\n- Date: 2026-05-29\n- Scope: 项目级\n- Kind: preference\n- Context: 手工录入\n- Content:\n  - 以后统一使用 cargo test\n",
    )
    .expect("write preferences");

    let index = rebuild_memory_index(&root, MemoryScope::Project).expect("rebuild memory index");
    assert_eq!(index.entries.len(), 1);
    assert!(index.entries[0].content.contains("cargo test"));

    let loaded = load_memory_index(&root).expect("load rebuilt index");
    assert_eq!(loaded.entries.len(), 1);
}

#[test]
fn test_load_wiki_context_uses_rebuilt_memory_index_summary() {
    let temp_dir = tempfile::tempdir().expect("create temp dir");
    let workdir = temp_dir.path();
    fs::create_dir_all(workdir.join(".sacode/wiki")).expect("create project wiki");
    fs::write(
        workdir.join(".sacode/wiki/workflows.md"),
        "# 项目级工作流记忆\n\n## 条目\n\n[自动学习条目]\n- Date: 2026-05-29\n- Scope: 项目级\n- Kind: workflow\n- Context: 自动学习\n- Content:\n  - 提交前先检查 diff 再继续\n",
    )
    .expect("write workflows");

    let wiki = load_wiki_context(workdir).expect("load wiki context");
    let project_summary = wiki.project_summary.expect("project summary should exist");
    assert!(project_summary.contains("提交前先检查 diff 再继续"));
    assert!(workdir.join(".sacode/wiki/index.json").exists());
}

#[test]
fn test_load_wiki_context_reads_project_sources() {
    let temp_dir = tempfile::tempdir().expect("create temp dir");
    let workdir = temp_dir.path();
    fs::create_dir_all(workdir.join(".sacode/wiki")).expect("create project wiki");
    fs::write(
        workdir.join(".sacode/project.json"),
        r#"{"name":"demo","stack":["rust"]}"#,
    )
    .expect("write project config");
    fs::write(
        workdir.join(".sacode/wiki/architecture.md"),
        "# Architecture\n\n- interfaces -> runtime -> kernel",
    )
    .expect("write architecture wiki");

    let wiki = load_wiki_context(workdir).expect("load wiki context");
    let project_summary = wiki.project_summary.expect("project summary should exist");
    assert!(project_summary.contains("demo"));
    assert!(project_summary.contains("interfaces -> runtime -> kernel"));
}

#[test]
fn test_runtime_skill_prompt_expansion() {
    let temp_dir = tempfile::tempdir().expect("create temp dir");
    let workdir = temp_dir.path();
    let registry = SkillRegistry::new(workdir);
    registry
        .save_project_skill("review", "代码审查", "请审查 {{args}} in {{cwd}}")
        .expect("save skill");

    let rendered = crate::maybe_expand_skill_prompt("/review src/main.rs", workdir)
        .expect("expand skill");

    assert!(rendered.contains("src/main.rs"));
    assert!(rendered.contains(&workdir.display().to_string()));
}

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
fn test_register_enabled_mcp_tools_sync_keeps_registry_stable_without_servers() {
    let temp_dir = tempfile::tempdir().expect("create temp dir");
    let workdir = temp_dir.path();
    let config = SaCodeConfig::new(workdir);
    let store = McpConfigStore::new_from_config(config.clone());
    store
        .save_to_source(
            &McpConfig {
                mcp: [(
                    "offline".to_string(),
                    McpServerConfig {
                        server_type: "remote".to_string(),
                        url: "https://127.0.0.1:9/mcp".to_string(),
                        enabled: true,
                    },
                )]
                .into_iter()
                .collect(),
            },
            McpSource::Project,
        )
        .expect("save mcp config");

    let mut registry = ToolRegistry::builtin();
    let names = register_enabled_mcp_tools_sync(&store, &mut registry).expect("register mcp tools");

    assert!(names.is_empty());
    assert!(registry.get("fs.read").is_some());
}

#[test]
fn test_tool_spec_read_only() {
    let spec = tools::fs::read::spec();
    assert!(spec.is_read_only());
    assert!(!spec.needs_approval());
}

#[test]
fn test_sandbox_policy_for_plan_mode_is_read_only() {
    let policy = crate::sandbox::SandboxPolicy::for_mode(ExecutionMode::Plan);

    assert!(policy.network.search_allowed);
    assert!(!policy.network.fetch_allowed);
    assert!(!policy.network.browser_allowed);
    assert!(!policy.shell.enabled);
    assert!(policy.fs.read_paths.contains(&std::path::PathBuf::from(".")));
    assert!(policy.fs.write_paths.is_empty());
    assert!(!policy.check_command("git"));
    assert_eq!(policy.max_memory_mb(), Some(256));
    assert_eq!(policy.timeout_ms(), Some(15_000));
}

#[test]
fn test_sandbox_policy_for_build_mode_allows_network_without_command_whitelist() {
    let policy = crate::sandbox::SandboxPolicy::for_mode(ExecutionMode::Build);

    assert!(policy.network.search_allowed);
    assert!(policy.network.fetch_allowed);
    assert!(policy.shell.enabled);
    assert!(policy.shell.allowed_commands.is_empty());
    assert!(policy.check_command("git"));
    assert_eq!(policy.max_memory_mb(), Some(512));
    assert_eq!(policy.timeout_ms(), Some(30_000));
}

#[test]
fn test_sandbox_policy_for_yolo_mode_is_most_permissive() {
    let policy = crate::sandbox::SandboxPolicy::for_mode(ExecutionMode::Yolo);

    assert!(policy.network.search_allowed);
    assert!(policy.network.fetch_allowed);
    assert!(policy.network.browser_allowed);
    assert!(policy.shell.allowed_commands.is_empty());
    assert!(policy.check_command("cargo"));
    assert_eq!(policy.max_memory_mb(), Some(1024));
    assert_eq!(policy.timeout_ms(), Some(60_000));
}

#[test]
fn test_sandbox_config_store_overrides_plan_network_policy() {
    let _guard = sandbox_test_lock();
    let temp_dir = tempfile::tempdir().expect("create temp dir");
    let workdir = temp_dir.path();
    let store = SandboxConfigStore::new(workdir);
    store
        .save(&SandboxConfig {
            plan: SandboxModeConfig {
                network: crate::config::SandboxNetworkConfig {
                    fetch_allowed: Some(true),
                    ..crate::config::SandboxNetworkConfig::default()
                },
                ..SandboxModeConfig::default()
            },
            ..SandboxConfig::default()
        })
        .expect("save sandbox config");

    let policy = store.policy_for_mode(ExecutionMode::Plan).expect("load plan sandbox policy");
    assert!(policy.network.fetch_allowed);
}

#[test]
fn test_sandbox_config_store_overrides_build_allowed_commands() {
    let _guard = sandbox_test_lock();
    let temp_dir = tempfile::tempdir().expect("create temp dir");
    let workdir = temp_dir.path();
    let store = SandboxConfigStore::new(workdir);
    store
        .save(&SandboxConfig {
            build: SandboxModeConfig {
                shell: crate::config::SandboxShellConfig {
                    enabled: Some(true),
                    allowed_commands: vec!["git".to_string()],
                },
                ..SandboxModeConfig::default()
            },
            ..SandboxConfig::default()
        })
        .expect("save sandbox config");

    let policy = store.policy_for_mode(ExecutionMode::Build).expect("load build sandbox policy");
    assert_eq!(policy.shell.allowed_commands, vec!["git".to_string()]);
    assert!(policy.check_command("git"));
    assert!(!policy.check_command("cargo"));
}

#[test]
fn test_sandbox_config_store_creates_docker_executor() {
    let _guard = sandbox_test_lock();
    let temp_dir = tempfile::tempdir().expect("create temp dir");
    let workdir = temp_dir.path();
    let store = SandboxConfigStore::new(workdir);

    store
        .save(&SandboxConfig {
            backend: SandboxBackendConfig {
                kind: SandboxBackendKind::Docker,
                docker: DockerSandboxConfig {
                    image: Some("ghcr.io/example/sacode-sandbox:latest".to_string()),
                    ..DockerSandboxConfig::default()
                },
            },
            ..SandboxConfig::default()
        })
        .expect("save docker sandbox config");

    let executor = store
        .executor_for_mode(ExecutionMode::Build)
        .expect("build sandbox executor");
    let result = executor.execute("pwd", &[]);
    if let Err(error) = result {
        assert!(
            error.to_string().contains("docker")
                || error.to_string().contains("No such file or directory")
                || error.to_string().contains("not found")
        );
    }
}

#[test]
fn test_docker_backend_builds_mounts_from_fs_policy() {
    let _guard = sandbox_test_lock();
    let temp_dir = tempfile::tempdir().expect("create temp dir");
    let workdir = temp_dir.path();
    let original_dir = std::env::current_dir().expect("read current dir");
    std::env::set_current_dir(workdir).expect("enter temp dir");

    let backend = DockerSandboxBackend::new(DockerSandboxConfig {
        image: Some("ghcr.io/example/sacode-sandbox:latest".to_string()),
        workspace_mount: Some("/repo".to_string()),
        ..DockerSandboxConfig::default()
    });
    let policy = crate::sandbox::SandboxPolicy::new()
        .allow_read_path(std::path::PathBuf::from("src"))
        .allow_write_path(std::path::PathBuf::from("target"))
        .deny_path(std::path::PathBuf::from("src/private"));

    let command = backend
        .build_docker_command(
            &policy,
            &SandboxCommand {
                program: "git".to_string(),
                args: vec!["status".to_string()],
                cwd: Some("src".to_string()),
                timeout_ms: 30_000,
            },
        )
        .expect("build docker command");

    std::env::set_current_dir(original_dir).expect("restore current dir");

    assert_eq!(command.program, "docker");
    let joined = command.args.join(" ");
    assert!(joined.contains("-v"));
    assert!(joined.contains("--user"));
    assert!(joined.contains("--read-only"));
    assert!(joined.contains("--tmpfs /tmp:rw,noexec,nosuid,size=64m"));
    assert!(joined.contains("/repo/src:ro"));
    assert!(joined.contains("/repo/target"));
    assert!(!joined.contains("/repo/src/private"));
}

#[test]
fn test_docker_backend_respects_security_overrides() {
    let _guard = sandbox_test_lock();
    let temp_dir = tempfile::tempdir().expect("create temp dir");
    let workdir = temp_dir.path();
    let original_dir = std::env::current_dir().expect("read current dir");
    std::env::set_current_dir(workdir).expect("enter temp dir");

    let backend = DockerSandboxBackend::new(DockerSandboxConfig {
        image: Some("ghcr.io/example/sacode-sandbox:latest".to_string()),
        workspace_mount: Some("/repo".to_string()),
        user: Some("1000:1000".to_string()),
        read_only_rootfs: Some(false),
        tmpfs: vec!["/run:rw,size=16m".to_string()],
        ..DockerSandboxConfig::default()
    });
    let policy = crate::sandbox::SandboxPolicy::new().allow_write_path(std::path::PathBuf::from("target"));

    let command = backend
        .build_docker_command(
            &policy,
            &SandboxCommand {
                program: "git".to_string(),
                args: vec!["status".to_string()],
                cwd: None,
                timeout_ms: 30_000,
            },
        )
        .expect("build docker command");

    std::env::set_current_dir(original_dir).expect("restore current dir");

    let joined = command.args.join(" ");
    assert!(joined.contains("--user 1000:1000"));
    assert!(!joined.contains("--read-only"));
    assert!(joined.contains("--tmpfs /run:rw,size=16m"));
}

#[test]
fn test_shell_exec_uses_docker_backend_when_installed() {
    let _guard = sandbox_test_lock();
    let temp_dir = tempfile::tempdir().expect("create temp dir");
    let workdir = temp_dir.path();
    let store = SandboxConfigStore::new(workdir);

    store
        .save(&SandboxConfig {
            backend: SandboxBackendConfig {
                kind: SandboxBackendKind::Docker,
                docker: DockerSandboxConfig {
                    image: Some("ghcr.io/example/sacode-sandbox:latest".to_string()),
                    ..DockerSandboxConfig::default()
                },
            },
            ..SandboxConfig::default()
        })
        .expect("save docker sandbox config");

    let _executor = store
        .executor_for_mode(ExecutionMode::Build)
        .expect("install docker executor");
    let error = crate::tools::shell::exec::execute(serde_json::json!({
        "command": "pwd"
    }))
    .expect_err("shell exec should attempt docker backend execution");

    let message = error.to_string();
    assert!(message.contains("No such file or directory") || message.contains("docker"));

    crate::sandbox::reset_global_policy();
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
        tools::ToolSpec {
            name: "test.base_url_guard".to_string(),
            description: "test tool".to_string(),
            input_schema: serde_json::json!({
                "type": "object",
                "properties": {
                    "base_url": { "type": "string" }
                }
            }),
            output_schema: serde_json::json!({ "type": "object" }),
            side_effect_level: tools::SideEffectLevel::ReadOnly,
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
        tools::ToolSpec {
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
            side_effect_level: tools::SideEffectLevel::ReadOnly,
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
    let _guard = sandbox_test_lock();
    crate::sandbox::reset_global_policy();
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
    crate::sandbox::reset_global_policy();

    assert!(result.success);
    assert_eq!(written, "hello");
}

#[test]
fn test_fs_write_rejects_parent_escape() {
    let _guard = sandbox_test_lock();
    crate::sandbox::reset_global_policy();
    let temp_dir = tempfile::tempdir().expect("create temp dir");
    let original_dir = std::env::current_dir().expect("read current dir");
    std::env::set_current_dir(temp_dir.path()).expect("enter temp dir");

    let error = tools::fs::write::execute(serde_json::json!({
        "path": "../escape.txt",
        "content": "blocked"
    }))
    .expect_err("parent escape should fail");

    std::env::set_current_dir(original_dir).expect("restore current dir");
    crate::sandbox::reset_global_policy();

    assert!(error.to_string().contains("outside workspace") || error.to_string().contains("blocked"));
}

#[test]
fn test_fs_edit_replace_single() {
    let _guard = sandbox_test_lock();
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
    let _guard = sandbox_test_lock();
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
    let _guard = sandbox_test_lock();
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
    let _guard = sandbox_test_lock();
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
    let _guard = sandbox_test_lock();
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
    let _guard = sandbox_test_lock();
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
    let _guard = sandbox_test_lock();
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
    assert!(matches!(payload["queue_status"].as_str(), Some("pending") | Some("ready") | Some("running") | Some("completed") | Some("failed")));
    assert!(payload.get("task_run").is_some());
    if let Some(task_run) = payload.get("task_run") {
        assert_eq!(task_run["source"].as_str(), Some("snapshot"));
    }
    if let Some(task_run_state) = payload
        .get("task_run")
        .and_then(|value| value.get("state"))
        .and_then(|value| value.as_str())
    {
        let expected_queue_status = match task_run_state {
            "Completed" => "completed",
            "Failed" => "failed",
            "WaitingForUser" | "WaitingForApproval" => "running",
            other => panic!("unexpected task_run state: {}", other),
        };
        assert_eq!(payload["queue_status"].as_str(), Some(expected_queue_status));
    }
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

#[tokio::test]
async fn test_daemon_status_and_result_include_task_run() {
    let app = create_daemon().await;

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/task")
                .header("content-type", "application/json")
                .body(Body::from(r#"{"prompt":"分析代码结构","mode":"plan"}"#))
                .expect("build request"),
        )
        .await
        .expect("daemon should create task");

    let body = to_bytes(response.into_body(), usize::MAX)
        .await
        .expect("read body");
    let payload: serde_json::Value = serde_json::from_slice(&body).expect("valid json");
    let task_id = payload["task_id"].as_str().expect("task id").to_string();

    let mut status_payload = serde_json::Value::Null;
    for _ in 0..10 {
        let status_response = app
            .clone()
            .oneshot(
                Request::builder()
                    .uri(format!("/task/{}/status", task_id))
                    .body(Body::empty())
                    .expect("build request"),
            )
            .await
            .expect("daemon should return status");
        let status_body = to_bytes(status_response.into_body(), usize::MAX)
            .await
            .expect("read status body");
        status_payload = serde_json::from_slice(&status_body).expect("valid status json");
        if status_payload.get("task_run").is_some() {
            break;
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
    assert!(status_payload.get("task_run").is_some());

    let mut result_payload = serde_json::Value::Null;
    for _ in 0..10 {
        let result_response = app
            .clone()
            .oneshot(
                Request::builder()
                    .uri(format!("/task/{}/result", task_id))
                    .body(Body::empty())
                    .expect("build request"),
            )
            .await
            .expect("daemon should return result");
        let result_body = to_bytes(result_response.into_body(), usize::MAX)
            .await
            .expect("read result body");
        result_payload = serde_json::from_slice(&result_body).expect("valid result json");
        if result_payload.get("task_run").is_some() {
            break;
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
    assert!(result_payload.get("task_run").is_some());
}

#[tokio::test]
async fn test_task_queue_submit_and_status() {
    let queue = Arc::new(TaskQueue::new(2));

    let task = ScheduledTask::new("test-1".to_string(), Task::new("test prompt", ExecutionMode::Build, None));
    let task_id = queue.submit(task).await.expect("submit task");

    let status = queue.status(&task_id).await;
    assert_eq!(status, Some(TaskQueueStatus::Ready));

    let stats = queue.stats().await;
    assert_eq!(stats.ready_count, 1);
}

#[tokio::test]
async fn test_task_executor_emits_task_run_in_completion_event() {
    let queue = Arc::new(TaskQueue::new(1));
    queue
        .submit(ScheduledTask::new(
            "exec-1".to_string(),
            Task::new("生成一个简单计划", ExecutionMode::Plan, None),
        ))
        .await
        .expect("submit task");

    let mut executor = crate::executor::TaskExecutor::new(queue, ToolRegistry::builtin());
    let mut receiver = executor.subscribe();

    executor.run_once().await;
    tokio::time::sleep(Duration::from_millis(50)).await;
    executor.run_once().await;

    let mut saw_completion = false;
    while let Ok(evt) = receiver.try_recv() {
        if evt.event_type == "task_completed" {
            saw_completion = true;
            let task_run = evt.data.get("task_run").expect("task_run payload");
            assert_eq!(task_run.get("state"), Some(&serde_json::json!("Completed")));
            assert!(task_run.get("output_text").is_some());
        }
    }

    assert!(saw_completion);
}

#[tokio::test]
async fn test_task_queue_priority_ordering() {
    let queue = Arc::new(TaskQueue::new(1));

    let blocker = ScheduledTask::new("blocker".to_string(), Task::new("blocker", ExecutionMode::Build, None));
    let blocker_id = queue.submit(blocker).await.expect("submit blocker");

    let low_task = ScheduledTask::new("low-1".to_string(), Task::new("low priority", ExecutionMode::Build, None))
        .with_priority(TaskPriority::Low)
        .with_dependencies(vec![blocker_id.clone()]);
    let normal_task = ScheduledTask::new("normal-1".to_string(), Task::new("normal priority", ExecutionMode::Build, None))
        .with_priority(TaskPriority::Normal)
        .with_dependencies(vec![blocker_id.clone()]);
    let high_task = ScheduledTask::new("high-1".to_string(), Task::new("high priority", ExecutionMode::Build, None))
        .with_priority(TaskPriority::High)
        .with_dependencies(vec![blocker_id.clone()]);
    let urgent_task = ScheduledTask::new("urgent-1".to_string(), Task::new("urgent priority", ExecutionMode::Build, None))
        .with_priority(TaskPriority::Urgent)
        .with_dependencies(vec![blocker_id.clone()]);

    queue.submit(low_task.clone()).await.expect("submit low");
    queue.submit(normal_task.clone()).await.expect("submit normal");
    queue.submit(high_task.clone()).await.expect("submit high");
    queue.submit(urgent_task.clone()).await.expect("submit urgent");

    let stats = queue.stats().await;
    assert_eq!(stats.pending_count, 4);
    assert_eq!(stats.ready_count, 1);

    let next = queue.next_ready().await;
    assert!(next.is_some());
    assert_eq!(next.unwrap().id, "blocker");

    queue
        .mark_completed(
            "blocker",
            sacode_kernel::TaskResult::success("blocker".to_string(), "done".to_string(), 0),
            sacode_kernel::TaskRun {
                task_id: Some("blocker".to_string()),
                state: Some(sacode_kernel::TaskRunState::Completed),
                output_text: Some("done".to_string()),
                ..sacode_kernel::TaskRun::default()
            },
        )
        .await;

    let stats_after = queue.stats().await;
    assert_eq!(stats_after.pending_count, 4);

    let next_ready = queue.next_ready().await;
    assert!(next_ready.is_some());
    assert_eq!(next_ready.unwrap().priority, TaskPriority::Urgent);
}

#[tokio::test]
async fn test_task_queue_stats() {
    let queue = Arc::new(TaskQueue::new(5));

    let stats_before = queue.stats().await;
    assert_eq!(stats_before.ready_count, 0);

    for i in 0..3 {
        let task = ScheduledTask::new(format!("task-{}", i), Task::new("test", ExecutionMode::Build, None));
        queue.submit(task).await.expect("submit task");
    }

    let stats_after = queue.stats().await;
    assert_eq!(stats_after.ready_count, 3);
}

#[tokio::test]
async fn test_task_queue_preserves_task_run_for_completed_result() {
    let queue = Arc::new(TaskQueue::new(1));
    queue
        .submit(ScheduledTask::new(
            "queue-run-1".to_string(),
            Task::new("queue run test", ExecutionMode::Build, None),
        ))
        .await
        .expect("submit task");

    let _ = queue.next_ready().await.expect("ready task");
    queue.mark_running("queue-run-1").await;

    queue
        .mark_completed(
            "queue-run-1",
            sacode_kernel::TaskResult::success("queue-run-1".to_string(), "done".to_string(), 1),
            sacode_kernel::TaskRun {
                task_id: Some("queue-run-1".to_string()),
                state: Some(sacode_kernel::TaskRunState::Completed),
                output_text: Some("done".to_string()),
                ..sacode_kernel::TaskRun::default()
            },
        )
        .await;

    let task_run = queue.get_task_run("queue-run-1").await.expect("task run");
    assert_eq!(task_run.state, Some(sacode_kernel::TaskRunState::Completed));
    assert_eq!(task_run.output_text.as_deref(), Some("done"));
}

#[tokio::test]
async fn test_task_queue_cancel() {
    let queue = Arc::new(TaskQueue::new(1));

    let task = ScheduledTask::new("cancel-1".to_string(), Task::new("cancel test", ExecutionMode::Build, None));
    let task_id = queue.submit(task).await.expect("submit task");

    let cancelled = queue.cancel(&task_id).await;
    assert!(cancelled);

    let status = queue.status(&task_id).await;
    assert_eq!(status, Some(TaskQueueStatus::Cancelled));
}

#[tokio::test]
async fn test_task_queue_dependency() {
    let queue = Arc::new(TaskQueue::new(2));

    let parent_task = ScheduledTask::new("parent-1".to_string(), Task::new("parent", ExecutionMode::Build, None));
    let parent_id = queue.submit(parent_task).await.expect("submit parent");

    let child_task = ScheduledTask::new("child-1".to_string(), Task::new("child", ExecutionMode::Build, None))
        .with_dependencies(vec![parent_id.clone()]);
    let child_id = queue.submit(child_task).await.expect("submit child");

    let child_status = queue.status(&child_id).await;
    assert_eq!(child_status, Some(TaskQueueStatus::Pending));

    let completed_ids = queue.get_completed_ids().await;
    assert!(!completed_ids.contains(&child_id));
}

#[tokio::test]
async fn test_retry_policy() {
    let policy = RetryPolicy::exponential(1000, 10000, 3);

    assert_eq!(policy.max_attempts, 3);
    assert_eq!(policy.compute_delay_ms(0), 1000);
    assert_eq!(policy.compute_delay_ms(1), 2000);
    assert_eq!(policy.compute_delay_ms(2), 4000);
    assert_eq!(policy.compute_delay_ms(10), 10000);
}

#[tokio::test]
async fn test_scheduled_task_retry_logic() {
    let mut task = ScheduledTask::new("retry-1".to_string(), Task::new("retry test", ExecutionMode::Build, None))
        .with_retry_policy(RetryPolicy::fixed(100, 2));

    assert_eq!(task.current_attempt, 0);
    assert!(task.can_retry());

    task.increment_attempt();
    assert_eq!(task.current_attempt, 1);
    assert!(task.can_retry());

    task.increment_attempt();
    assert_eq!(task.current_attempt, 2);
    assert!(!task.can_retry());
}

#[tokio::test]
async fn test_in_memory_store() {
    let store = Arc::new(InMemoryStore::new());

    let task = ScheduledTask::new("store-1".to_string(), Task::new("store test", ExecutionMode::Build, None));

    store.save(&task).await.expect("save task");

    let loaded = store.load("store-1").await.expect("load task");
    assert!(loaded.is_some());
    assert_eq!(loaded.unwrap().id, "store-1");

    let pending = store.load_pending().await.expect("load pending");
    assert_eq!(pending.len(), 1);
}

#[tokio::test]
async fn test_daemon_queue_status_endpoint() {
    let app = create_daemon().await;

    let response = app
        .oneshot(Request::builder().uri("/queue/status").body(Body::empty()).expect("build request"))
        .await
        .expect("daemon should respond");

    assert_eq!(response.status(), StatusCode::OK);

    let body = to_bytes(response.into_body(), usize::MAX)
        .await
        .expect("read body");
    let payload: serde_json::Value = serde_json::from_slice(&body).expect("valid json");

    assert!(payload["pending_count"].is_number());
    assert!(payload["running_count"].is_number());
}

#[tokio::test]
async fn test_daemon_task_with_priority() {
    let app = create_daemon().await;

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/task")
                .header("content-type", "application/json")
                .body(Body::from(r#"{"prompt":"test","mode":"build","priority":"high"}"#))
                .expect("build request"),
        )
        .await
        .expect("daemon should create task");

    assert_eq!(response.status(), StatusCode::OK);

    let body = to_bytes(response.into_body(), usize::MAX)
        .await
        .expect("read body");
    let payload: serde_json::Value = serde_json::from_slice(&body).expect("valid json");

    assert_eq!(payload["status"], "queued");
}

#[tokio::test]
async fn test_daemon_task_cancel_endpoint() {
    let app = create_daemon().await;

    let create_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/task")
                .header("content-type", "application/json")
                .body(Body::from(r#"{"prompt":"test","mode":"build"}"#))
                .expect("build request"),
        )
        .await
        .expect("daemon should create task");

    let body = to_bytes(create_response.into_body(), usize::MAX)
        .await
        .expect("read body");
    let payload: serde_json::Value = serde_json::from_slice(&body).expect("valid json");
    let task_id = payload["task_id"].as_str().expect("task id");

    tokio::time::sleep(Duration::from_millis(10)).await;

    let cancel_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri(format!("/task/{}/cancel", task_id))
                .body(Body::empty())
                .expect("build request"),
        )
        .await;

    let resp = cancel_response.expect("cancel response");
    assert_eq!(resp.status(), StatusCode::OK);

    let status_response = app
        .oneshot(
            Request::builder()
                .uri(format!("/task/{}/status", task_id))
                .body(Body::empty())
                .expect("build request"),
        )
        .await
        .expect("status response");

    let status_body = to_bytes(status_response.into_body(), usize::MAX)
        .await
        .expect("read status body");
    let status_payload: serde_json::Value =
        serde_json::from_slice(&status_body).expect("valid status json");

    assert_eq!(status_payload["status"], "failed");
    assert_eq!(status_payload["queue_status"], "failed");
    assert_eq!(
        status_payload["task_run"]["state"].as_str(),
        Some("Failed")
    );
    assert_eq!(
        status_payload["task_run"]["output_text"].as_str(),
        Some("Task cancelled")
    );
}

#[tokio::test]
async fn test_daemon_task_with_retry_policy() {
    let app = create_daemon().await;

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/task")
                .header("content-type", "application/json")
                .body(Body::from(r#"{"prompt":"test","mode":"build","retry_policy":{"max_attempts":3,"backoff_type":"exponential","base_ms":1000,"max_ms":10000}}"#))
                .expect("build request"),
        )
        .await
        .expect("daemon should create task");

    assert_eq!(response.status(), StatusCode::OK);

    let body = to_bytes(response.into_body(), usize::MAX)
        .await
        .expect("read body");
    let payload: serde_json::Value = serde_json::from_slice(&body).expect("valid json");

    assert_eq!(payload["status"], "queued");
}
