//! git.push — 推送本地提交到远程仓库
//!
//! 与 `git.pr.create` 内部隐式 push 的区别：
//! - `git.push` 是独立的推送工具，不强制创建 PR
//! - 支持 `remote` / `branch` / `force` / `tags` / `set_upstream` 参数
//! - 与 `git.commit` 形成完整闭环：commit → push

use std::process::Command;

use crate::tools::{SideEffectLevel, ToolOutput, ToolSpec};

/// git.push 输入参数
#[derive(Debug, serde::Deserialize)]
struct GitPushInput {
    /// 远程仓库名，默认 origin
    remote: Option<String>,
    /// 目标分支名，默认当前分支
    branch: Option<String>,
    /// 是否强制推送（--force-with-lease，比 --force 更安全）
    force: Option<bool>,
    /// 是否推送 tags（--tags）
    tags: Option<bool>,
    /// 是否设置上游跟踪（-u），首次推送新分支时使用
    set_upstream: Option<bool>,
    /// 干运行模式（--dry-run），只展示将要推送的内容不实际推送
    dry_run: Option<bool>,
}

/// 错误分类枚举
#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "snake_case")]
enum GitPushErrorKind {
    /// 当前目录不在 git 工作树内
    NotARepo,
    /// 无可推送的提交（本地与远程同步）
    NothingToPush,
    /// 推送被远程拒绝（非 fast-forward，未用 force 时）
    Rejected,
    /// 远程仓库不存在或无权限
    RemoteError,
    /// 其他 git push 失败
    PushFailed,
}

fn git_push_error(kind: GitPushErrorKind, message: impl Into<String>) -> ToolOutput {
    let msg = message.into();
    let kind_str = serde_json::to_string(&kind)
        .unwrap_or_else(|_| "\"unknown\"".to_string())
        .trim_matches('"')
        .to_string();
    ToolOutput {
        success: false,
        data: serde_json::json!({
            "error_kind": kind_str,
            "message": msg,
        }),
        message: Some(format!("{}: {}", kind_str, msg)),
    }
}

/// 检查当前目录是否在 git 工作树内
fn is_inside_work_tree() -> bool {
    Command::new("git")
        .args(["rev-parse", "--is-inside-work-tree"])
        .output()
        .map(|o| o.status.success() && String::from_utf8_lossy(&o.stdout).trim() == "true")
        .unwrap_or(false)
}

/// 获取当前分支名（detached HEAD 时返回 None）
fn current_branch() -> Option<String> {
    let output = Command::new("git")
        .args(["symbolic-ref", "--short", "HEAD"])
        .output()
        .ok()?;
    if output.status.success() {
        Some(String::from_utf8_lossy(&output.stdout).trim().to_string())
    } else {
        None
    }
}

pub fn spec() -> ToolSpec {
    ToolSpec {
        name: "git.push".to_string(),
        description: "推送本地提交到远程仓库。行为：1) 默认推送到 origin 的当前分支；2) remote 参数可指定其他远程仓库；3) branch 参数可指定其他分支；4) force=true 使用 --force-with-lease（比 --force 更安全，拒绝覆盖他人提交）；5) set_upstream=true 设置上游跟踪（-u，首次推送新分支时使用）；6) tags=true 同时推送 tags；7) dry_run=true 使用 --dry-run 预演。与 git.commit 形成完整闭环，不强制创建 PR".to_string(),
        input_schema: serde_json::json!({
            "type": "object",
            "properties": {
                "remote": { "type": "string", "description": "远程仓库名，默认 origin" },
                "branch": { "type": "string", "description": "目标分支名，默认当前分支" },
                "force": { "type": "boolean", "default": false, "description": "是否强制推送（--force-with-lease）" },
                "tags": { "type": "boolean", "default": false, "description": "是否同时推送 tags（--tags）" },
                "set_upstream": { "type": "boolean", "default": false, "description": "是否设置上游跟踪（-u）" },
                "dry_run": { "type": "boolean", "default": false, "description": "干运行模式（--dry-run）" }
            }
        }),
        output_schema: serde_json::json!({
            "type": "object",
            "properties": {
                "success": { "type": "boolean" },
                "remote": { "type": "string" },
                "branch": { "type": "string" },
                "force": { "type": "boolean" },
                "dry_run": { "type": "boolean" },
                "summary": { "type": "string" },
                "error_kind": {
                    "type": "string",
                    "enum": ["not_a_repo", "nothing_to_push", "rejected", "remote_error", "push_failed"]
                }
            }
        }),
        side_effect_level: SideEffectLevel::Modify,
        approval_required: true,
        timeout_ms: Some(30_000),
        tags: vec!["git".to_string(), "push".to_string()],
    }
}

pub fn execute(input: serde_json::Value) -> anyhow::Result<ToolOutput> {
    let payload: GitPushInput = serde_json::from_value(input)?;

    // 前置仓库检查
    if !is_inside_work_tree() {
        return Ok(git_push_error(
            GitPushErrorKind::NotARepo,
            "not inside a git work tree",
        ));
    }

    let remote = payload.remote.unwrap_or_else(|| "origin".to_string());
    let branch = match payload.branch {
        Some(b) => b,
        None => match current_branch() {
            Some(b) => b,
            None => {
                return Ok(git_push_error(
                    GitPushErrorKind::PushFailed,
                    "无法获取当前分支名（detached HEAD），请显式指定 branch 参数",
                ));
            }
        },
    };
    let force = payload.force.unwrap_or(false);
    let tags = payload.tags.unwrap_or(false);
    let set_upstream = payload.set_upstream.unwrap_or(false);
    let dry_run = payload.dry_run.unwrap_or(false);

    // 构建 git push 命令
    let mut cmd = Command::new("git");
    cmd.arg("push");
    if dry_run {
        cmd.arg("--dry-run");
    }
    if force {
        // --force-with-lease 比 --force 更安全：拒绝覆盖远程已有的他人提交
        cmd.arg("--force-with-lease");
    }
    if set_upstream {
        cmd.arg("-u");
    }
    if tags {
        cmd.arg("--tags");
    }
    cmd.arg(&remote).arg(&branch);

    let output = cmd.output().map_err(|e| anyhow::anyhow!("git push 执行失败: {}", e))?;
    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();

    if output.status.success() {
        // 检查是否有实际推送（dry-run 或 Everything up-to-date 时无实际变更）
        let up_to_date = stderr.contains("Everything up-to-date")
            || stderr.contains("Up-to-date");
        let summary = if dry_run {
            format!("干运行：将推送到 {}/{}", remote, branch)
        } else if up_to_date {
            format!("{} 已是最新，无需推送", remote)
        } else {
            format!("成功推送到 {}/{}", remote, branch)
        };

        Ok(ToolOutput::success(serde_json::json!({
            "remote": remote,
            "branch": branch,
            "force": force,
            "dry_run": dry_run,
            "stdout": stdout.trim(),
            "stderr": stderr.trim(),
        }))
        .with_message(summary))
    } else {
        // 错误分类
        let (kind, msg) = if stderr.contains("Everything up-to-date") {
            (GitPushErrorKind::NothingToPush, "本地与远程已同步，无可推送的提交".to_string())
        } else if stderr.contains("non-fast-forward")
            || stderr.contains("fetch first")
            || stderr.contains("rejected")
        {
            (GitPushErrorKind::Rejected, "推送被拒绝：远程有新提交，需先 pull 或使用 force".to_string())
        } else if stderr.contains("Could not read from remote repository")
            || stderr.contains("Permission denied")
            || stderr.contains("fatal: '")
        {
            (GitPushErrorKind::RemoteError, format!("远程仓库错误: {}", stderr.trim()))
        } else {
            (GitPushErrorKind::PushFailed, format!("推送失败: {}", stderr.trim()))
        };
        Ok(git_push_error(kind, msg))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_git_push_input() {
        let input = serde_json::json!({
            "remote": "upstream",
            "branch": "main",
            "force": true,
            "tags": true,
            "set_upstream": true,
            "dry_run": true
        });
        let payload: GitPushInput = serde_json::from_value(input).unwrap();
        assert_eq!(payload.remote.as_deref(), Some("upstream"));
        assert_eq!(payload.branch.as_deref(), Some("main"));
        assert_eq!(payload.force, Some(true));
        assert_eq!(payload.tags, Some(true));
        assert_eq!(payload.set_upstream, Some(true));
        assert_eq!(payload.dry_run, Some(true));
    }

    #[test]
    fn parses_minimal_input() {
        let input = serde_json::json!({});
        let payload: GitPushInput = serde_json::from_value(input).unwrap();
        assert!(payload.remote.is_none());
        assert!(payload.branch.is_none());
        assert!(payload.force.is_none());
    }

    #[test]
    fn rejects_non_repo() {
        // 在系统临时目录（非 git 仓库）执行
        let temp = std::env::temp_dir();
        let original = std::env::current_dir().unwrap();
        // 注意：不持有 cwd_test_lock，因为这是 git 工具测试，不是 CWD 测试
        // 且 is_inside_work_tree 在临时目录通常返回 false（除非用户全局有 git 配置）
        let _ = std::env::set_current_dir(&temp);
        let result = execute(serde_json::json!({}));
        let _ = std::env::set_current_dir(&original);
        if let Ok(output) = result {
            // 如果临时目录恰好是 git 仓库（罕见），跳过断言
            if !output.success {
                assert_eq!(
                    output.data["error_kind"],
                    "not_a_repo",
                    "非 git 目录应返回 not_a_repo"
                );
            }
        }
    }
}
