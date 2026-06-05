use std::{path::PathBuf, process::Command};

use super::App;

impl App {
    pub(super) fn refresh_git_changes(&mut self) {
        let repo_root = Command::new("git")
            .arg("rev-parse")
            .arg("--show-toplevel")
            .current_dir(&self.workdir)
            .output();

        let repo_root = match repo_root {
            Ok(output) if output.status.success() => {
                let root = String::from_utf8_lossy(&output.stdout).trim().to_string();
                if root.is_empty() {
                    self.git_changes = vec!["未检测到 Git 仓库".to_string()];
                    return;
                }
                PathBuf::from(root)
            }
            Ok(_) => {
                self.git_changes = vec!["当前目录不是 Git 仓库".to_string()];
                return;
            }
            Err(error) => {
                self.git_changes = vec![format!("读取 Git 仓库失败: {}", error)];
                return;
            }
        };

        let output = Command::new("git")
            .arg("status")
            .arg("--short")
            .current_dir(repo_root)
            .output();

        self.git_changes = match output {
            Ok(output) if output.status.success() => String::from_utf8_lossy(&output.stdout)
                .lines()
                .map(|line| line.trim().to_string())
                .filter(|line| !line.is_empty())
                .filter(|line| line != "?? .sacode/")
                .collect(),
            Ok(output) => vec![format!(
                "git status 失败: {}",
                String::from_utf8_lossy(&output.stderr).trim()
            )],
            Err(error) => vec![format!("读取 Git 变更失败: {}", error)],
        };
    }
}
