use std::process::Command;

use anyhow::Result;

use crate::version_check::{update_prompt, VersionChecker, VersionStatus};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum UpdateCommandMode {
    CheckOnly,
    CheckAndInstall,
    ForceInstall,
}

#[derive(Debug, Clone)]
pub struct UpdateResult {
    pub checked: bool,
    pub updated: bool,
    pub previous_version: String,
    pub target_version: Option<String>,
    pub restart_required: bool,
    pub message: String,
}

pub fn run(args: Vec<String>) -> Result<()> {
    let result = execute(args)?;
    println!();
    println!("{}", result.message);
    println!();
    Ok(())
}

pub fn execute(args: Vec<String>) -> Result<UpdateResult> {
    let checker = VersionChecker::new();
    let mode = parse_mode(&args);
    let previous_version = checker.current_version().to_string();

    if !npm_available() {
        return Ok(UpdateResult {
            checked: false,
            updated: false,
            previous_version,
            target_version: None,
            restart_required: false,
            message: "当前环境缺少 npm，无法自动更新。请先安装 npm，或手动安装 @cherishron/sacode。".to_string(),
        });
    }

    let status = match mode {
        UpdateCommandMode::CheckOnly | UpdateCommandMode::ForceInstall => checker.force_check()?,
        UpdateCommandMode::CheckAndInstall => checker.check_for_update()?,
    };

    match status {
        VersionStatus::UpdateAvailable {
            current_version,
            remote_version,
        } => {
            if mode == UpdateCommandMode::CheckOnly {
                return Ok(UpdateResult {
                    checked: true,
                    updated: false,
                    previous_version: current_version.clone(),
                    target_version: Some(remote_version.clone()),
                    restart_required: false,
                    message: update_prompt(&current_version, &remote_version),
                });
            }

            let install_output = Command::new("npm")
                .args(["install", "-g", "@cherishron/sacode@latest"])
                .output()?;

            if !install_output.status.success() {
                let stderr = String::from_utf8_lossy(&install_output.stderr).trim().to_string();
                return Ok(UpdateResult {
                    checked: true,
                    updated: false,
                    previous_version: current_version,
                    target_version: Some(remote_version),
                    restart_required: false,
                    message: format!(
                        "自动更新失败。请检查 npm 全局安装权限或网络连接。\n错误输出: {}\n可手动执行: npm install -g @cherishron/sacode@latest",
                        stderr
                    ),
                });
            }

            let verified_version = Command::new("sacode")
                .arg("--version")
                .output()
                .ok()
                .filter(|output| output.status.success())
                .map(|output| String::from_utf8_lossy(&output.stdout).trim().to_string())
                .unwrap_or_else(|| format!("sacode {}", remote_version));

            Ok(UpdateResult {
                checked: true,
                updated: true,
                previous_version: current_version,
                target_version: Some(remote_version),
                restart_required: true,
                message: format!(
                    "更新成功。\n验证结果: {}\n请退出当前会话并重新启动 sacode 以使用新版本。",
                    verified_version
                ),
            })
        }
        VersionStatus::UpToDate { current_version } => Ok(UpdateResult {
            checked: true,
            updated: false,
            previous_version: current_version.clone(),
            target_version: Some(current_version.clone()),
            restart_required: false,
            message: format!("已是最新版本: {}", current_version),
        }),
        VersionStatus::Unknown => Ok(UpdateResult {
            checked: false,
            updated: false,
            previous_version,
            target_version: None,
            restart_required: false,
            message: "无法从 npm registry 获取版本信息，稍后再试，或手动执行 npm install -g @cherishron/sacode@latest。".to_string(),
        }),
    }
}

fn parse_mode(args: &[String]) -> UpdateCommandMode {
    if args.iter().any(|arg| arg == "--force") {
        UpdateCommandMode::ForceInstall
    } else if args.iter().any(|arg| arg == "--check") {
        UpdateCommandMode::CheckOnly
    } else {
        UpdateCommandMode::CheckAndInstall
    }
}

fn npm_available() -> bool {
    Command::new("npm")
        .arg("--version")
        .output()
        .map(|output| output.status.success())
        .unwrap_or(false)
}
