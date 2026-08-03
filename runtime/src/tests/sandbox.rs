use super::*;
use crate::ProjectAccessConfigStore;

#[test]
fn test_sandbox_policy_for_plan_mode_is_read_only() {
    let policy = crate::sandbox::SandboxPolicy::for_mode(ExecutionMode::Plan);

    assert!(policy.network.search_allowed);
    assert!(!policy.network.fetch_allowed);
    assert!(!policy.network.browser_allowed);
    assert!(!policy.shell.enabled);
    assert!(policy
        .fs
        .read_paths
        .contains(&std::path::PathBuf::from(".")));
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
    assert!(!policy.check_command("kill"));
    assert!(!policy.check_command("pkill"));
    assert!(!policy.check_command("killall"));
    assert!(!policy.check_command("taskkill"));
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
    assert!(!policy.check_command("kill"));
    assert_eq!(policy.max_memory_mb(), Some(1024));
    assert_eq!(policy.timeout_ms(), Some(60_000));
}

#[test]
fn test_sandbox_policy_respects_project_access_store_dirs() {
    let _guard = sandbox_test_lock();
    let workdir = tempfile::tempdir().expect("create workdir");
    let outside = tempfile::tempdir().expect("create outside dir");
    let outside_file = outside.path().join("cache").join("pkg.txt");
    std::fs::create_dir_all(outside_file.parent().expect("parent dir")).expect("create nested");
    std::fs::write(&outside_file, "ok").expect("write file");

    let store = ProjectAccessConfigStore::new(workdir.path());
    store.add_dir(outside.path()).expect("add allowed dir");

    let _cwd = CurrentDirGuard::enter(workdir.path());
    crate::sandbox::install_current_mode(ExecutionMode::Build);
    let policy = crate::sandbox::SandboxPolicy::for_mode(ExecutionMode::Build);

    assert!(policy.check_path(&outside_file, crate::sandbox::FsAccess::Read));
    crate::sandbox::reset_global_policy();
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

    let policy = store
        .policy_for_mode(ExecutionMode::Plan)
        .expect("load plan sandbox policy");
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

    let policy = store
        .policy_for_mode(ExecutionMode::Build)
        .expect("load build sandbox policy");
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
    let _cwd = CurrentDirGuard::enter(temp_dir.path());

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
    let _cwd = CurrentDirGuard::enter(temp_dir.path());

    let backend = DockerSandboxBackend::new(DockerSandboxConfig {
        image: Some("ghcr.io/example/sacode-sandbox:latest".to_string()),
        workspace_mount: Some("/repo".to_string()),
        user: Some("1000:1000".to_string()),
        read_only_rootfs: Some(false),
        tmpfs: vec!["/run:rw,size=16m".to_string()],
        ..DockerSandboxConfig::default()
    });
    let policy =
        crate::sandbox::SandboxPolicy::new().allow_write_path(std::path::PathBuf::from("target"));

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
    // 跨平台兼容：Unix 上 docker 不存在时通常含 "No such file or directory" 或 "docker"，
    // Windows 上则是 "program not found" (os error 2) 或系统错误
    assert!(
        message.contains("No such file or directory")
            || message.contains("docker")
            || message.contains("program not found")
            || message.contains("os error 2")
            || message.contains("系统找不到"),
        "unexpected error message: {}",
        message
    );

    crate::sandbox::reset_global_policy();
}

#[test]
fn test_explicit_allowlist_cannot_enable_blocked_process_commands() {
    let policy = crate::sandbox::SandboxPolicy::new()
        .enable_shell()
        .allow_command("kill".to_string());

    assert!(!policy.check_command("kill"));
}
