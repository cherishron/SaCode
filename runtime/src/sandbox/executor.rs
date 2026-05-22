use anyhow::Result;
use std::process::Command;
use std::time::Duration;
use wait_timeout::ChildExt;

use crate::sandbox::SandboxPolicy;

pub struct SandboxExecutor {
    policy: SandboxPolicy,
}

impl SandboxExecutor {
    pub fn new(policy: SandboxPolicy) -> Self {
        Self { policy }
    }

    pub fn execute(&self, command: &str, args: &[String]) -> Result<String> {
        let cmd_name = command.split_whitespace().next().unwrap_or(command);
        
        if !self.policy.check_command(cmd_name) {
            anyhow::bail!("Command '{}' is not allowed by sandbox policy", cmd_name);
        }

        let timeout_ms = self.policy.timeout_ms.unwrap_or(30000);
        
        let mut child = Command::new(command)
            .args(args)
            .current_dir(std::env::current_dir()?)
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .spawn()?;

        let timeout = Duration::from_millis(timeout_ms);
        let status = child.wait_timeout(timeout)?;

        match status {
            Some(exit_status) => {
                let output = child.wait_with_output()?;
                if exit_status.success() {
                    Ok(String::from_utf8_lossy(&output.stdout).to_string())
                } else {
                    anyhow::bail!("Command failed: {}", String::from_utf8_lossy(&output.stderr))
                }
            }
            None => {
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