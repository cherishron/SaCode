use std::path::PathBuf;

use anyhow::Result;

use crate::sandbox::{active_policy, FsAccess};

#[derive(Debug, Default, Clone)]
pub struct ShellSandbox;

impl ShellSandbox {
    pub fn validate(command: &str, cwd: Option<&str>) -> Result<()> {
        let policy = active_policy();
        let command_name = command
            .split_whitespace()
            .next()
            .unwrap_or(command)
            .trim();

        if command_name.is_empty() {
            anyhow::bail!("command is required");
        }

        if !policy.check_command(command_name) {
            anyhow::bail!("command '{}' is blocked by sandbox policy", command_name);
        }

        if let Some(cwd) = cwd {
            let path = PathBuf::from(cwd);
            let resolved = if path.is_absolute() {
                path
            } else {
                std::env::current_dir()?.join(path)
            };

            if !policy.check_path(&resolved, FsAccess::Read) {
                anyhow::bail!("working directory is blocked by sandbox policy");
            }
        }

        Ok(())
    }
}
