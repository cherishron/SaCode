use anyhow::Result;
use std::ffi::OsStr;
#[cfg(unix)]
use std::os::unix::process::CommandExt;
use std::process::Command;
use std::sync::Arc;
use std::time::Duration;
use tracing::{debug, info, warn};
use wait_timeout::ChildExt;

use crate::config::DockerSandboxConfig;
use crate::sandbox::{install_global_backend, install_global_policy, SandboxPolicy};

pub trait SandboxBackend: Send + Sync {
    fn execute_command(
        &self,
        policy: &SandboxPolicy,
        command: &SandboxCommand,
    ) -> Result<BackendCommandOutput>;
}

#[derive(Debug, Clone)]
pub struct SandboxCommand {
    pub program: String,
    pub args: Vec<String>,
    pub cwd: Option<String>,
    pub timeout_ms: u64,
}

#[derive(Debug, Clone)]
pub struct BackendCommandOutput {
    pub stdout: String,
    pub stderr: String,
    pub exit_code: i32,
    pub timed_out: bool,
}

#[derive(Default)]
pub struct LocalSandboxBackend;

pub struct DockerSandboxBackend {
    config: DockerSandboxConfig,
}

impl DockerSandboxBackend {
    pub fn new(config: DockerSandboxConfig) -> Self {
        Self { config }
    }

    pub fn config(&self) -> &DockerSandboxConfig {
        &self.config
    }

    pub(crate) fn build_docker_command(
        &self,
        policy: &SandboxPolicy,
        command: &SandboxCommand,
    ) -> Result<SandboxCommand> {
        let image = self
            .config
            .image
            .clone()
            .ok_or_else(|| anyhow::anyhow!("docker sandbox image is required"))?;
        let workspace = std::env::current_dir()?;
        let mount_target = self
            .config
            .workspace_mount
            .clone()
            .unwrap_or_else(|| "/workspace".to_string());

        let mut docker_args = vec!["run".to_string(), "--rm".to_string()];

        let container_user = self
            .config
            .user
            .clone()
            .unwrap_or_else(default_container_user);
        docker_args.push("--user".to_string());
        docker_args.push(container_user);

        if self.config.read_only_rootfs.unwrap_or(true) {
            docker_args.push("--read-only".to_string());
        }

        for tmpfs_mount in docker_tmpfs_mounts(&self.config) {
            docker_args.push("--tmpfs".to_string());
            docker_args.push(tmpfs_mount);
        }

        for mount in docker_mounts(policy, &workspace, &mount_target) {
            docker_args.extend(mount);
        }

        docker_args.push("-w".to_string());
        docker_args.push(container_cwd(
            command.cwd.as_deref(),
            &workspace,
            &mount_target,
        ));

        let network_mode = self
            .config
            .network_mode
            .clone()
            .unwrap_or_else(|| docker_network_mode(policy).to_string());
        docker_args.push("--network".to_string());
        docker_args.push(network_mode);

        if let Some(memory) = self
            .config
            .memory
            .clone()
            .or_else(|| policy.max_memory_mb().map(|mb| format!("{}m", mb)))
        {
            docker_args.push("--memory".to_string());
            docker_args.push(memory);
        }

        if let Some(cpus) = &self.config.cpus {
            docker_args.push("--cpus".to_string());
            docker_args.push(cpus.clone());
        }

        docker_args.push(image);
        docker_args.push(container_program(&command.program)?);
        docker_args.extend(command.args.iter().cloned());

        Ok(SandboxCommand {
            program: "docker".to_string(),
            args: docker_args,
            cwd: None,
            timeout_ms: command.timeout_ms,
        })
    }
}

impl SandboxBackend for LocalSandboxBackend {
    fn execute_command(
        &self,
        policy: &SandboxPolicy,
        command: &SandboxCommand,
    ) -> Result<BackendCommandOutput> {
        let cmd_name = command
            .program
            .split_whitespace()
            .next()
            .unwrap_or(&command.program);

        if !policy.check_command(cmd_name) {
            warn!(
                "Sandbox blocked command: '{}' (policy: allowed_commands={:?})",
                cmd_name, policy.shell.allowed_commands
            );
            anyhow::bail!("Command '{}' is not allowed by sandbox policy", cmd_name);
        }

        debug!(
            "Sandbox executing: command='{}', args={:?}, timeout_ms={}",
            cmd_name, command.args, command.timeout_ms
        );

        let timeout_ms = command.timeout_ms;

        let mut child = Command::new(&command.program);
        child
            .args(&command.args)
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped());

        if let Some(cwd) = &command.cwd {
            child.current_dir(cwd);
        } else {
            child.current_dir(std::env::current_dir()?);
        }

        configure_process_isolation(&mut child);

        let mut child = child.spawn()?;

        let pid = child.id();
        info!(
            "Process spawned: command='{}', pid={}, timeout={}ms",
            cmd_name, pid, timeout_ms
        );

        let timeout = Duration::from_millis(timeout_ms);
        let status = child.wait_timeout(timeout)?;

        match status {
            Some(exit_status) => {
                let output = child.wait_with_output()?;
                let stdout = String::from_utf8_lossy(&output.stdout).to_string();
                let stderr = String::from_utf8_lossy(&output.stderr).to_string();

                if exit_status.success() {
                    info!(
                        "Process completed successfully: command='{}', pid={}, exit_code=0",
                        cmd_name, pid
                    );
                    Ok(BackendCommandOutput {
                        stdout,
                        stderr,
                        exit_code: 0,
                        timed_out: false,
                    })
                } else {
                    warn!(
                        "Process failed: command='{}', pid={}, exit_code={}, stderr='{}'",
                        cmd_name,
                        pid,
                        exit_status.code().unwrap_or(-1),
                        stderr.trim()
                    );
                    Ok(BackendCommandOutput {
                        stdout,
                        stderr,
                        exit_code: exit_status.code().unwrap_or(-1),
                        timed_out: false,
                    })
                }
            }
            None => {
                warn!(
                    "Process timed out: command='{}', pid={}, timeout={}ms - killing process group",
                    cmd_name, pid, timeout_ms
                );
                terminate_process_tree(&mut child)?;
                Ok(BackendCommandOutput {
                    stdout: String::new(),
                    stderr: String::new(),
                    exit_code: -1,
                    timed_out: true,
                })
            }
        }
    }
}

impl SandboxBackend for DockerSandboxBackend {
    fn execute_command(
        &self,
        policy: &SandboxPolicy,
        command: &SandboxCommand,
    ) -> Result<BackendCommandOutput> {
        let docker_command = self.build_docker_command(policy, command)?;
        let backend = LocalSandboxBackend;
        backend.execute_command(policy, &docker_command)
    }
}

fn container_program(program: &str) -> Result<String> {
    if let Ok(current_exe) = std::env::current_exe() {
        let current_exe_name = current_exe
            .file_name()
            .and_then(OsStr::to_str)
            .unwrap_or_default();
        if program == current_exe.to_string_lossy() || program.ends_with(current_exe_name) {
            return Ok("sacode".to_string());
        }
    }
    Ok(program.to_string())
}

fn container_cwd(cwd: Option<&str>, workspace: &std::path::Path, mount_target: &str) -> String {
    let Some(cwd) = cwd else {
        return mount_target.to_string();
    };
    let cwd_path = std::path::PathBuf::from(cwd);
    let absolute = if cwd_path.is_absolute() {
        cwd_path
    } else {
        workspace.join(cwd_path)
    };
    match absolute.strip_prefix(workspace) {
        Ok(relative) if !relative.as_os_str().is_empty() => format!(
            "{}/{}",
            mount_target.trim_end_matches('/'),
            relative.display()
        ),
        _ => mount_target.to_string(),
    }
}

fn docker_mounts(
    policy: &SandboxPolicy,
    workspace: &std::path::Path,
    mount_target: &str,
) -> Vec<Vec<String>> {
    let denied = policy
        .fs
        .denied_paths
        .iter()
        .map(resolve_policy_mount_path)
        .collect::<Vec<_>>();
    let mut mounts = Vec::new();

    for path in &policy.fs.read_paths {
        let resolved = resolve_policy_mount_path(path);
        if denied.iter().any(|deny| resolved.starts_with(deny)) {
            continue;
        }
        if policy
            .fs
            .write_paths
            .iter()
            .map(resolve_policy_mount_path)
            .any(|write| write == resolved)
        {
            continue;
        }
        mounts.push(build_mount_arg(&resolved, workspace, mount_target, true));
    }

    for path in &policy.fs.write_paths {
        let resolved = resolve_policy_mount_path(path);
        if denied.iter().any(|deny| resolved.starts_with(deny)) {
            continue;
        }
        mounts.push(build_mount_arg(&resolved, workspace, mount_target, false));
    }

    mounts.sort();
    mounts.dedup();
    mounts
}

fn docker_tmpfs_mounts(config: &DockerSandboxConfig) -> Vec<String> {
    if config.tmpfs.is_empty() {
        return vec!["/tmp:rw,noexec,nosuid,size=64m".to_string()];
    }

    config.tmpfs.clone()
}

fn default_container_user() -> String {
    let uid = read_id_output("id", "-u").unwrap_or_else(|| "65534".to_string());
    let gid = read_id_output("id", "-g").unwrap_or_else(|| "65534".to_string());
    format!("{}:{}", uid.trim(), gid.trim())
}

fn read_id_output(program: &str, arg: &str) -> Option<String> {
    Command::new(program)
        .arg(arg)
        .output()
        .ok()
        .filter(|output| output.status.success())
        .map(|output| String::from_utf8_lossy(&output.stdout).trim().to_string())
        .filter(|value| !value.is_empty())
}

fn build_mount_arg(
    host_path: &std::path::Path,
    workspace: &std::path::Path,
    mount_target: &str,
    readonly: bool,
) -> Vec<String> {
    let relative = host_path.strip_prefix(workspace).ok();
    let container_path = match relative {
        Some(path) if !path.as_os_str().is_empty() => {
            format!("{}/{}", mount_target.trim_end_matches('/'), path.display())
        }
        _ => mount_target.to_string(),
    };
    let suffix = if readonly { ":ro" } else { "" };
    vec![
        "-v".to_string(),
        format!("{}:{}{}", host_path.display(), container_path, suffix),
    ]
}

fn resolve_policy_mount_path(path: &std::path::PathBuf) -> std::path::PathBuf {
    if path.is_absolute() {
        return path.clone();
    }
    std::env::current_dir()
        .map(|cwd| cwd.join(path))
        .unwrap_or_else(|_| path.clone())
}

fn docker_network_mode(policy: &SandboxPolicy) -> &'static str {
    if policy.network.fetch_allowed
        || policy.network.browser_allowed
        || policy.network.search_allowed
    {
        "bridge"
    } else {
        "none"
    }
}

fn configure_process_isolation(command: &mut Command) {
    #[cfg(unix)]
    {
        unsafe {
            command.pre_exec(|| {
                if libc::setpgid(0, 0) == 0 {
                    Ok(())
                } else {
                    Err(std::io::Error::last_os_error())
                }
            });
        }
    }

    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        // CREATE_NEW_PROCESS_GROUP = 0x00000200
        // CREATE_BREAKAWAY_FROM_JOB = 0x01000000
        const CREATE_NEW_PROCESS_GROUP: u32 = 0x00000200;
        command.creation_flags(CREATE_NEW_PROCESS_GROUP);
    }
}

fn terminate_process_tree(child: &mut std::process::Child) -> Result<()> {
    #[cfg(unix)]
    {
        let process_group = -(child.id() as i32);
        if unsafe { libc::kill(process_group, libc::SIGKILL) } != 0 {
            let error = std::io::Error::last_os_error();
            if error.raw_os_error() != Some(libc::ESRCH) {
                return Err(error.into());
            }
        }
    }

    #[cfg(target_os = "windows")]
    {
        // 使用 taskkill /T /PID 杀掉整个进程树
        let pid = child.id();
        let _ = std::process::Command::new("taskkill")
            .args(["/T", "/F", "/PID", &pid.to_string()])
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .spawn();

        // Fallback: 直接 kill 子进程
        let _ = child.kill();
    }

    let _ = child.wait();
    Ok(())
}

pub struct SandboxExecutor {
    policy: SandboxPolicy,
    backend: Arc<dyn SandboxBackend>,
}

impl SandboxExecutor {
    pub fn new(policy: SandboxPolicy) -> Self {
        Self::with_backend(policy, Arc::new(LocalSandboxBackend))
    }

    pub fn with_backend(policy: SandboxPolicy, backend: Arc<dyn SandboxBackend>) -> Self {
        install_global_policy(policy.clone());
        install_global_backend(backend.clone());
        Self { policy, backend }
    }

    pub fn execute(&self, command: &str, args: &[String]) -> Result<String> {
        let output = self.backend.execute_command(
            &self.policy,
            &SandboxCommand {
                program: command.to_string(),
                args: args.to_vec(),
                cwd: None,
                timeout_ms: self.policy.timeout_ms().unwrap_or(30000),
            },
        )?;
        if output.timed_out {
            anyhow::bail!(
                "Command timed out after {}ms",
                self.policy.timeout_ms().unwrap_or(30000)
            );
        }
        if output.exit_code != 0 {
            anyhow::bail!("Command failed: {}", output.stderr);
        }
        Ok(output.stdout)
    }

    pub fn policy(&self) -> &SandboxPolicy {
        &self.policy
    }
}

impl Default for SandboxExecutor {
    fn default() -> Self {
        Self::new(SandboxPolicy::default())
    }
}
