use std::process::Command;

use crate::tools::{SideEffectLevel, ToolOutput, ToolSpec};

#[derive(Debug, serde::Deserialize)]
struct GitPrInput {
    /// 操作类型: create / status / merge / close / reopen / list
    action: Option<String>,
    /// PR 标题（create 时必填）
    title: Option<String>,
    /// PR 正文（create 时可选）
    body: Option<String>,
    /// 目标分支（create 时可选，默认仓库默认分支）
    base: Option<String>,
    /// 源分支（create 时可选，默认当前分支）
    head: Option<String>,
    /// PR 编号（status/merge/close/reopen 时必填）
    number: Option<u64>,
    /// 是否以草稿模式创建（create 时可选）
    draft: Option<bool>,
    /// 关闭/重开时的可选评论（close/reopen 时可选）
    comment: Option<String>,
}

pub fn spec() -> ToolSpec {
    ToolSpec {
        name: "git.pr".to_string(),
        description: "管理 GitHub Pull Request（创建/查看/合并/关闭/重开/列表）".to_string(),
        input_schema: serde_json::json!({
            "type": "object",
            "properties": {
                "action": {
                    "type": "string",
                    "description": "操作类型: create|status|merge|close|reopen|list，默认 list",
                    "enum": ["create", "status", "merge", "close", "reopen", "list"]
                },
                "title": { "type": "string", "description": "PR 标题（create 时必填）" },
                "body": { "type": "string", "description": "PR 正文（create 时可选）" },
                "base": { "type": "string", "description": "目标分支（create 时可选）" },
                "head": { "type": "string", "description": "源分支（create 时可选）" },
                "number": { "type": "integer", "description": "PR 编号（status/merge/close/reopen 时必填）" },
                "draft": { "type": "boolean", "description": "是否以草稿模式创建（默认 false）" },
                "comment": { "type": "string", "description": "关闭/重开时的可选评论（close/reopen 时可选）" }
            }
        }),
        output_schema: serde_json::json!({
            "type": "object",
            "properties": {
                "success": { "type": "boolean" },
                "action": { "type": "string" },
                "summary": { "type": "string" },
                "pr": {
                    "type": "object",
                    "properties": {
                        "number": { "type": "integer" },
                        "title": { "type": "string" },
                        "state": { "type": "string" },
                        "url": { "type": "string" },
                        "head": { "type": "string" },
                        "base": { "type": "string" },
                        "mergeable": { "type": "boolean" },
                        "draft": { "type": "boolean" }
                    }
                },
                "prs": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "number": { "type": "integer" },
                            "title": { "type": "string" },
                            "state": { "type": "string" },
                            "url": { "type": "string" }
                        }
                    }
                }
            }
        }),
        side_effect_level: SideEffectLevel::Modify,
        approval_required: true,
        timeout_ms: Some(30_000),
        tags: vec!["git".to_string(), "pr".to_string()],
    }
}

pub fn execute(input: serde_json::Value) -> anyhow::Result<ToolOutput> {
    let payload: GitPrInput = serde_json::from_value(input)?;

    // 检查 gh CLI 是否可用
    if !is_gh_available() {
        return Ok(ToolOutput::failure(
            "GitHub CLI (gh) is not installed or not available in PATH. \
             Install it from https://cli.github.com/",
        ));
    }

    // 检查是否在 Git 仓库中
    if !is_git_repo() {
        return Ok(ToolOutput::failure("not inside a git repository"));
    }

    let action = payload
        .action
        .as_deref()
        .unwrap_or("list")
        .trim()
        .to_lowercase();

    match action.as_str() {
        "create" => execute_create(&payload),
        "status" => execute_status(&payload),
        "merge" => execute_merge(&payload),
        "close" => execute_close(&payload),
        "reopen" => execute_reopen(&payload),
        "list" => execute_list(&payload),
        _ => Ok(ToolOutput::failure(format!(
            "unknown action '{}'; supported: create, status, merge, close, reopen, list",
            action
        ))),
    }
}

fn execute_create(payload: &GitPrInput) -> anyhow::Result<ToolOutput> {
    let title = match &payload.title {
        Some(t) if !t.trim().is_empty() => t.trim().to_string(),
        _ => return Ok(ToolOutput::failure("title is required for create action")),
    };

    // 先推送当前分支到远程
    let current_branch = get_current_branch()?;
    let push_output = Command::new("git")
        .args(["push", "-u", "origin", &current_branch])
        .output()?;

    // 推送失败不阻断，可能分支已存在远程
    let push_warn = if !push_output.status.success() {
        let stderr = String::from_utf8_lossy(&push_output.stderr).trim().to_string();
        Some(format!("git push warning: {}", truncate_str(&stderr, 200)))
    } else {
        None
    };

    // 构建 gh pr create 命令
    let mut cmd = Command::new("gh");
    cmd.args(["pr", "create", "--title", &title]);

    if let Some(body) = &payload.body {
        if !body.trim().is_empty() {
            cmd.args(["--body", body.trim()]);
        }
    } else {
        // 无 body 时使用空白占位，避免打开编辑器
        cmd.args(["--body", ""]);
    }

    if let Some(base) = &payload.base {
        if !base.trim().is_empty() {
            cmd.args(["--base", base.trim()]);
        }
    }

    if let Some(head) = &payload.head {
        if !head.trim().is_empty() {
            cmd.args(["--head", head.trim()]);
        }
    }

    if payload.draft.unwrap_or(false) {
        cmd.arg("--draft");
    }

    // 使用 --json 输出结构化数据
    cmd.args(["--json", "number,title,state,url,headRefName,baseRefName,isDraft"]);

    let output = cmd.output()?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Ok(ToolOutput::failure(if stderr.is_empty() {
            "gh pr create failed".to_string()
        } else {
            stderr
        }));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let pr_data = parse_pr_json(&stdout);

    let mut summary = format!(
        "created PR #{}: {} ({})",
        pr_data.get("number").and_then(|v| v.as_u64()).unwrap_or(0),
        pr_data
            .get("title")
            .and_then(|v| v.as_str())
            .unwrap_or(""),
        pr_data.get("url").and_then(|v| v.as_str()).unwrap_or("")
    );
    if let Some(warn) = push_warn {
        summary = format!("{}; {}", summary, warn);
    }

    Ok(ToolOutput::success(serde_json::json!({
        "success": true,
        "action": "create",
        "summary": summary,
        "pr": pr_data,
    }))
    .with_message(summary))
}

fn execute_status(payload: &GitPrInput) -> anyhow::Result<ToolOutput> {
    let number = match payload.number {
        Some(n) => n,
        None => return Ok(ToolOutput::failure("number is required for status action")),
    };

    let output = Command::new("gh")
        .args([
            "pr",
            "view",
            &number.to_string(),
            "--json",
            "number,title,state,url,headRefName,baseRefName,mergeable,isDraft",
        ])
        .output()?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Ok(ToolOutput::failure(if stderr.is_empty() {
            format!("PR #{} not found", number)
        } else {
            stderr
        }));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let pr_data = parse_pr_json(&stdout);

    let state = pr_data
        .get("state")
        .and_then(|v| v.as_str())
        .unwrap_or("unknown");
    let title = pr_data
        .get("title")
        .and_then(|v| v.as_str())
        .unwrap_or("");

    Ok(ToolOutput::success(serde_json::json!({
        "success": true,
        "action": "status",
        "summary": format!("PR #{} [{}]: {}", number, state, title),
        "pr": pr_data,
    })))
}

fn execute_merge(payload: &GitPrInput) -> anyhow::Result<ToolOutput> {
    let number = match payload.number {
        Some(n) => n,
        None => return Ok(ToolOutput::failure("number is required for merge action")),
    };

    let output = Command::new("gh")
        .args(["pr", "merge", &number.to_string(), "--merge", "--delete-branch"])
        .output()?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Ok(ToolOutput::failure(if stderr.is_empty() {
            format!("failed to merge PR #{}", number)
        } else {
            stderr
        }));
    }

    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();

    Ok(ToolOutput::success(serde_json::json!({
        "success": true,
        "action": "merge",
        "summary": format!("merged PR #{}", number),
        "pr": {
            "number": number,
            "state": "merged",
        },
    }))
    .with_message(if stdout.is_empty() {
        format!("merged PR #{}", number)
    } else {
        stdout
    }))
}

fn execute_close(payload: &GitPrInput) -> anyhow::Result<ToolOutput> {
    let number = match payload.number {
        Some(n) => n,
        None => return Ok(ToolOutput::failure("number is required for close action")),
    };

    // 可选评论：先发评论再关闭，确保评论归属到关闭前的 PR 状态
    if let Some(comment) = &payload.comment {
        if !comment.trim().is_empty() {
            let comment_output = Command::new("gh")
                .args(["pr", "comment", &number.to_string(), "--body", comment.trim()])
                .output()?;
            if !comment_output.status.success() {
                let stderr = String::from_utf8_lossy(&comment_output.stderr).trim().to_string();
                // 评论失败不阻断关闭，记录警告继续
                tracing::warn!("failed to comment on PR #{} before close: {}", number, stderr);
            }
        }
    }

    let output = Command::new("gh")
        .args(["pr", "close", &number.to_string()])
        .output()?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Ok(ToolOutput::failure(if stderr.is_empty() {
            format!("failed to close PR #{}", number)
        } else {
            stderr
        }));
    }

    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let has_comment = payload
        .comment
        .as_deref()
        .map(|c| !c.trim().is_empty())
        .unwrap_or(false);
    let summary = if has_comment {
        format!("closed PR #{} (with comment)", number)
    } else {
        format!("closed PR #{}", number)
    };

    Ok(ToolOutput::success(serde_json::json!({
        "success": true,
        "action": "close",
        "summary": summary,
        "pr": {
            "number": number,
            "state": "closed",
        },
    }))
    .with_message(if stdout.is_empty() { summary } else { stdout }))
}

fn execute_reopen(payload: &GitPrInput) -> anyhow::Result<ToolOutput> {
    let number = match payload.number {
        Some(n) => n,
        None => return Ok(ToolOutput::failure("number is required for reopen action")),
    };

    // 可选评论：先发评论再重开
    if let Some(comment) = &payload.comment {
        if !comment.trim().is_empty() {
            let comment_output = Command::new("gh")
                .args(["pr", "comment", &number.to_string(), "--body", comment.trim()])
                .output()?;
            if !comment_output.status.success() {
                let stderr = String::from_utf8_lossy(&comment_output.stderr).trim().to_string();
                tracing::warn!("failed to comment on PR #{} before reopen: {}", number, stderr);
            }
        }
    }

    let output = Command::new("gh")
        .args(["pr", "reopen", &number.to_string()])
        .output()?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Ok(ToolOutput::failure(if stderr.is_empty() {
            format!("failed to reopen PR #{}", number)
        } else {
            stderr
        }));
    }

    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let has_comment = payload
        .comment
        .as_deref()
        .map(|c| !c.trim().is_empty())
        .unwrap_or(false);
    let summary = if has_comment {
        format!("reopened PR #{} (with comment)", number)
    } else {
        format!("reopened PR #{}", number)
    };

    Ok(ToolOutput::success(serde_json::json!({
        "success": true,
        "action": "reopen",
        "summary": summary,
        "pr": {
            "number": number,
            "state": "open",
        },
    }))
    .with_message(if stdout.is_empty() { summary } else { stdout }))
}

fn execute_list(payload: &GitPrInput) -> anyhow::Result<ToolOutput> {
    let mut cmd = Command::new("gh");
    cmd.args([
        "pr",
        "list",
        "--json",
        "number,title,state,url",
        "--limit",
        "20",
    ]);

    // 默认只列出当前用户相关的 PR
    cmd.args(["--author", "@me"]);

    let output = cmd.output()?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Ok(ToolOutput::failure(if stderr.is_empty() {
            "failed to list PRs".to_string()
        } else {
            stderr
        }));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let prs = parse_pr_list_json(&stdout);
    let count = prs.len();

    Ok(ToolOutput::success(serde_json::json!({
        "success": true,
        "action": "list",
        "summary": format!("found {} pull request(s)", count),
        "prs": prs,
    })))
}

fn is_gh_available() -> bool {
    Command::new("gh")
        .arg("--version")
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

fn is_git_repo() -> bool {
    Command::new("git")
        .args(["rev-parse", "--git-dir"])
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

fn get_current_branch() -> anyhow::Result<String> {
    let output = Command::new("git")
        .args(["rev-parse", "--abbrev-ref", "HEAD"])
        .output()?;

    if !output.status.success() {
        anyhow::bail!("failed to get current branch");
    }

    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

fn parse_pr_json(json_str: &str) -> serde_json::Value {
    match serde_json::from_str::<serde_json::Value>(json_str.trim()) {
        Ok(value) if value.is_object() => value,
        _ => serde_json::json!({}),
    }
}

fn parse_pr_list_json(json_str: &str) -> Vec<serde_json::Value> {
    match serde_json::from_str::<serde_json::Value>(json_str.trim()) {
        Ok(serde_json::Value::Array(items)) => items,
        _ => Vec::new(),
    }
}

fn truncate_str(s: &str, max: usize) -> String {
    if s.len() <= max {
        s.to_string()
    } else {
        format!("{}...", &s[..max])
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_pr_json_valid() {
        let json = r#"{"number": 42, "title": "Fix bug", "state": "OPEN", "url": "https://github.com/org/repo/pull/42"}"#;
        let result = parse_pr_json(json);
        assert_eq!(result["number"], 42);
        assert_eq!(result["title"], "Fix bug");
    }

    #[test]
    fn parse_pr_json_invalid() {
        let result = parse_pr_json("not json");
        assert!(result.is_object());
        assert!(result.as_object().unwrap().is_empty());
    }

    #[test]
    fn parse_pr_list_json_valid() {
        let json = r#"[{"number": 1, "title": "A"}, {"number": 2, "title": "B"}]"#;
        let result = parse_pr_list_json(json);
        assert_eq!(result.len(), 2);
    }

    #[test]
    fn parse_pr_list_json_empty() {
        let result = parse_pr_list_json("[]");
        assert!(result.is_empty());
    }

    #[test]
    fn truncate_str_short() {
        assert_eq!(truncate_str("hello", 10), "hello");
    }

    #[test]
    fn truncate_str_long() {
        // max=10 按字节切片，"a very long" 前 10 字节为 "a very lon"（含末尾 n）
        let result = truncate_str("a very long string that exceeds the limit", 10);
        assert_eq!(result, "a very lon...");
    }
}
