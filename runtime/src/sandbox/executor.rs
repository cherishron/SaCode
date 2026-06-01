use anyhow::Result;
use std::process::Command;
use std::time::Duration;
use wait_timeout::ChildExt;
use tracing::{info, warn, debug};

use crate::sandbox::{install_global_policy, SandboxPolicy};

pub struct SandboxExecutor {
    policy: SandboxPolicy,
}

impl SandboxExecutor {
    pub fn new(policy: SandboxPolicy) -> Self {
        install_global_policy(policy.clone());
        Self { policy }
    }

    pub fn execute(&self, command: &str, args: &[String]) -> Result<String> {
        let cmd_name = command.split_whitespace().next().unwrap_or(command);
        
        if !self.policy.check_command(cmd_name) {
            warn!(
                "Sandbox blocked command: '{}' (policy: allowed_commands={:?})",
                cmd_name,
                self.policy.allowed_commands
            );
            anyhow::bail!("Command '{}' is not allowed by sandbox policy", cmd_name);
        }

        debug!(
            "Sandbox executing: command='{}', args={:?}, timeout_ms={}",
            cmd_name,
            args,
            self.policy.timeout_ms.unwrap_or(30000)
        );

        let timeout_ms = self.policy.timeout_ms.unwrap_or(30000);
        
        let mut child = Command::new(command)
            .args(args)
            .current_dir(std::env::current_dir()?)
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .spawn()?;

        let pid = child.id();
        info!(
            "Process spawned: command='{}', pid={}, timeout={}ms",
            cmd_name,
            pid,
            timeout_ms
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
                        cmd_name,
                        pid
                    );
                    Ok(stdout)
                } else {
                    warn!(
                        "Process failed: command='{}', pid={}, exit_code={}, stderr='{}'",
                        cmd_name,
                        pid,
                        exit_status.code().unwrap_or(-1),
                        stderr.trim()
                    );
                    anyhow::bail!("Command failed: {}", stderr)
                }
            }
            None => {
                warn!(
                    "Process timed out: command='{}', pid={}, timeout={}ms - killing process",
                    cmd_name,
                    pid,
                    timeout_ms
                );
                child.kill()?;
                anyhow::bail!("Command timed out after {}ms", timeout_ms)
            }
        }
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
