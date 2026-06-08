use std::{fs, path::PathBuf, process::Command};

use anyhow::Result;
use serde::{Deserialize, Serialize};

use crate::version_check::{update_prompt, user_home_dir, VersionChecker, VersionStatus};

const UPDATE_STATE_DIR: &str = "update";
const LAST_VERSION_FILE: &str = "last-version.json";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum UpdateCommandMode {
    CheckOnly,
    CheckAndInstall,
    ForceInstall,
    Rollback,
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

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
struct LastInstalledVersion {
    previous_version: String,
    updated_at: String,
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

    if mode == UpdateCommandMode::Rollback {
        return execute_rollback(&previous_version);
    }

    if !npm_available() {
        return Ok(UpdateResult {
            checked: false,
            updated: false,
            previous_version,
            target_version: None,
            restart_required: false,
            message:
                "当前环境缺少 npm，无法自动更新。请先安装 npm，或手动安装 @cherishron/sacode。"
                    .to_string(),
        });
    }

    let status = match mode {
        UpdateCommandMode::Rollback => unreachable!("rollback returns before status check"),
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

            let _ = write_last_installed_version(&current_version);
            let install_spec = install_package_spec(&checker);
            let install_output = Command::new("npm")
                .args(["install", "-g", install_spec.as_str()])
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
                        "自动更新失败。请检查 npm 全局安装权限或网络连接。\n错误输出: {}\n可手动执行: npm install -g {}",
                        stderr, install_spec
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
                    "更新成功。\n验证结果: {}\n请退出当前会话并重新启动 sacode 以使用新版本。\n如需回退到上一版本，可执行: /update rollback 或 sacode update --rollback",
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
    if args
        .iter()
        .any(|arg| arg == "--rollback" || arg.eq_ignore_ascii_case("rollback"))
    {
        UpdateCommandMode::Rollback
    } else if args.iter().any(|arg| arg == "--force") {
        UpdateCommandMode::ForceInstall
    } else if args.iter().any(|arg| arg == "--check") {
        UpdateCommandMode::CheckOnly
    } else {
        UpdateCommandMode::CheckAndInstall
    }
}

fn execute_rollback(current_version: &str) -> Result<UpdateResult> {
    let Some(record) = read_last_installed_version()? else {
        return Ok(UpdateResult {
            checked: false,
            updated: false,
            previous_version: current_version.to_string(),
            target_version: None,
            restart_required: false,
            message: "当前没有可回滚的上一版本记录。请先成功执行一次更新。".to_string(),
        });
    };

    let target_version = record.previous_version;
    let install_spec = format!("@cherishron/sacode@{}", target_version);
    let install_output = Command::new("npm")
        .args(["install", "-g", install_spec.as_str()])
        .output()?;

    if !install_output.status.success() {
        let stderr = String::from_utf8_lossy(&install_output.stderr)
            .trim()
            .to_string();
        return Ok(UpdateResult {
            checked: false,
            updated: false,
            previous_version: current_version.to_string(),
            target_version: Some(target_version.clone()),
            restart_required: false,
            message: format!(
                "回滚失败。请检查 npm 全局安装权限或网络连接。\n错误输出: {}\n可手动执行: npm install -g {}",
                stderr, install_spec
            ),
        });
    }

    Ok(UpdateResult {
        checked: false,
        updated: true,
        previous_version: current_version.to_string(),
        target_version: Some(target_version.clone()),
        restart_required: true,
        message: format!(
            "回滚成功，已恢复到版本 {}。\n请退出当前会话并重新启动 sacode。",
            target_version
        ),
    })
}

fn install_package_spec(checker: &VersionChecker) -> String {
    match checker.package_spec().as_str() {
        "@cherishron/sacode@beta" => "@cherishron/sacode@beta".to_string(),
        _ => "@cherishron/sacode@latest".to_string(),
    }
}

fn update_state_dir() -> PathBuf {
    user_home_dir().join(".sacode").join(UPDATE_STATE_DIR)
}

fn last_version_file_path() -> PathBuf {
    update_state_dir().join(LAST_VERSION_FILE)
}

fn write_last_installed_version(previous_version: &str) -> Result<()> {
    fs::create_dir_all(update_state_dir())?;
    let record = LastInstalledVersion {
        previous_version: previous_version.to_string(),
        updated_at: chrono::Local::now().to_rfc3339(),
    };
    fs::write(
        last_version_file_path(),
        serde_json::to_string_pretty(&record)?,
    )?;
    Ok(())
}

fn read_last_installed_version() -> Result<Option<LastInstalledVersion>> {
    let path = last_version_file_path();
    if !path.exists() {
        return Ok(None);
    }
    let content = fs::read_to_string(path)?;
    let record = serde_json::from_str::<LastInstalledVersion>(&content)?;
    Ok(Some(record))
}

fn npm_available() -> bool {
    Command::new("npm")
        .arg("--version")
        .output()
        .map(|output| output.status.success())
        .unwrap_or(false)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_mode_supports_rollback() {
        assert_eq!(
            parse_mode(&["--rollback".to_string()]),
            UpdateCommandMode::Rollback
        );
        assert_eq!(
            parse_mode(&["rollback".to_string()]),
            UpdateCommandMode::Rollback
        );
    }

    #[test]
    fn install_package_spec_uses_beta_channel_when_configured() {
        let checker = VersionChecker::with_config(crate::version_check::VersionCheckConfig {
            channel: "beta".to_string(),
            ..Default::default()
        });
        assert_eq!(install_package_spec(&checker), "@cherishron/sacode@beta");
    }

    #[test]
    fn install_package_spec_uses_latest_for_stable() {
        let checker = VersionChecker::new();
        assert_eq!(install_package_spec(&checker), "@cherishron/sacode@latest");
    }
}
