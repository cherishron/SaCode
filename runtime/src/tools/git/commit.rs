use std::path::Path;
use std::process::Command;

use crate::tools::{SideEffectLevel, ToolOutput, ToolSpec};

/// git.commit 输入参数
#[derive(Debug, serde::Deserialize)]
struct GitCommitInput {
    message: String,
    paths: Option<Vec<String>>,
    add_all: Option<bool>,
    /// 干运行模式：只返回将要提交的元数据（staged_files/branch/author），
    /// 不执行 add 与 commit，便于 LLM 预演
    dry_run: Option<bool>,
}

/// 错误分类枚举，序列化为 snake_case 字符串
#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "snake_case")]
enum GitErrorKind {
    /// 非法参数（如 message 为空）
    InvalidArgument,
    /// 当前目录不在 git 工作树内
    NotARepo,
    /// 指定路径不存在
    PathNotFound,
    /// 没有可提交的 staged 变更
    NothingToCommit,
    /// git add 失败（非 hook 原因）
    AddFailed,
    /// git status / diff --cached 失败
    StatusFailed,
    /// git hook（pre-commit/commit-msg/husky 等）拦截
    HookFailed,
    /// git commit 失败（非 hook 原因）
    CommitFailed,
    /// git rev-parse 失败（无法取 commit hash）
    HashFailed,
}

/// 构造结构化失败输出：data 中含 error_kind + message
fn git_error(kind: GitErrorKind, message: impl Into<String>) -> ToolOutput {
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

/// 从 git stderr 中识别 hook 名称（pre-commit / commit-msg / husky / pre-receive）
/// 用于 C8 hook 失败诊断
fn extract_hook_name(stderr: &str) -> Option<String> {
    let lower = stderr.to_lowercase();
    // husky 优先级最高（常见框架，会包装其他 hook）
    if lower.contains("husky") {
        return Some("husky".to_string());
    }
    if lower.contains("pre-commit") || lower.contains("pre_commit") {
        return Some("pre-commit".to_string());
    }
    if lower.contains("commit-msg") {
        return Some("commit-msg".to_string());
    }
    if lower.contains("pre-receive") {
        return Some("pre-receive".to_string());
    }
    None
}

/// 检查当前目录是否在 git 工作树内
fn is_inside_work_tree() -> bool {
    Command::new("git")
        .args(["rev-parse", "--is-inside-work-tree"])
        .output()
        .map(|o| o.status.success() && String::from_utf8_lossy(&o.stdout).trim() == "true")
        .unwrap_or(false)
}

pub fn spec() -> ToolSpec {
    ToolSpec {
        name: "git.commit".to_string(),
        description: "提交当前仓库变更。行为：1) 默认仅提交已 staged 的变更；2) add_all=true 时先执行 git add -A；3) paths 非空时仅 add 指定路径（前置存在性校验）；4) add_all 与 paths 同时存在时，paths 优先；5) dry_run=true 时跳过 add 与 commit，只返回当前 staged 状态的元数据（staged_files/branch/author），用于预演；6) 不支持 --amend（避免历史改写风险）。返回 commit_hash/staged_files/branch/author_name/author_email/stats；失败时返回 error_kind 分类（not_a_repo/path_not_found/nothing_to_commit/hook_failed/commit_failed 等）。".to_string(),
        input_schema: serde_json::json!({
            "type": "object",
            "properties": {
                "message": { "type": "string", "description": "提交信息（Conventional Commits 推荐格式：feat/fix/docs/chore/refactor 等）" },
                "paths": {
                    "type": "array",
                    "items": { "type": "string" },
                    "description": "可选: 仅提交指定路径（与 add_all 同时存在时优先）"
                },
                "add_all": {
                    "type": "boolean",
                    "description": "可选: 是否执行 git add -A，默认 false"
                },
                "dry_run": {
                    "type": "boolean",
                    "description": "可选: 干运行模式，跳过 add 与 commit，仅返回当前 staged 状态的元数据，默认 false"
                }
            },
            "required": ["message"]
        }),
        output_schema: serde_json::json!({
            "type": "object",
            "properties": {
                "success": { "type": "boolean" },
                "commit_hash": { "type": "string", "description": "提交哈希（短，8 位），dry_run 时为空" },
                "message": { "type": "string", "description": "提交信息" },
                "staged_files": {
                    "type": "array",
                    "items": { "type": "string" },
                    "description": "本次提交包含的文件列表"
                },
                "branch": { "type": "string", "description": "当前分支名（detached HEAD 时为 HEAD）" },
                "author_name": { "type": "string", "description": "提交作者名（来自 git config user.name）" },
                "author_email": { "type": "string", "description": "提交作者邮箱（来自 git config user.email）" },
                "dry_run": { "type": "boolean", "description": "是否为干运行模式" },
                "stats": {
                    "type": "object",
                    "description": "提交统计（仅非 dry_run 成功时返回）",
                    "properties": {
                        "files_changed": { "type": "integer" },
                        "insertions": { "type": "integer" },
                        "deletions": { "type": "integer" }
                    }
                },
                "summary": { "type": "string" },
                "error_kind": {
                    "type": "string",
                    "description": "失败分类: invalid_argument/not_a_repo/path_not_found/nothing_to_commit/add_failed/status_failed/hook_failed/commit_failed/hash_failed",
                    "enum": [
                        "invalid_argument",
                        "not_a_repo",
                        "path_not_found",
                        "nothing_to_commit",
                        "add_failed",
                        "status_failed",
                        "hook_failed",
                        "commit_failed",
                        "hash_failed"
                    ]
                }
            }
        }),
        side_effect_level: SideEffectLevel::Modify,
        approval_required: true,
        timeout_ms: Some(15_000),
        tags: vec!["git".to_string(), "commit".to_string()],
    }
}

pub fn execute(input: serde_json::Value) -> anyhow::Result<ToolOutput> {
    let payload: GitCommitInput = serde_json::from_value(input)?;
    let message = payload.message.trim();
    if message.is_empty() {
        return Ok(git_error(
            GitErrorKind::InvalidArgument,
            "message is required",
        ));
    }

    // C3: 前置仓库检查 — 在执行任何 git 命令前确认处于工作树内
    if !is_inside_work_tree() {
        return Ok(git_error(
            GitErrorKind::NotARepo,
            "not inside a git work tree",
        ));
    }

    let dry_run = payload.dry_run.unwrap_or(false);

    // C6: 路径存在性校验（dry_run 模式下也校验，便于预演阶段发现问题）
    if let Some(paths) = payload.paths.as_ref().filter(|items| !items.is_empty()) {
        for p in paths {
            if !Path::new(p).exists() {
                return Ok(git_error(
                    GitErrorKind::PathNotFound,
                    format!("path not found: {}", p),
                ));
            }
        }
        if !dry_run {
            let mut cmd = Command::new("git");
            cmd.arg("add").arg("--");
            for path in paths {
                cmd.arg(path);
            }
            let add_output = cmd.output()?;
            if !add_output.status.success() {
                let stderr = String::from_utf8_lossy(&add_output.stderr)
                    .trim()
                    .to_string();
                if let Some(hook) = extract_hook_name(&stderr) {
                    return Ok(git_error(
                        GitErrorKind::HookFailed,
                        format!("git add blocked by {} hook: {}", hook, stderr),
                    ));
                }
                return Ok(git_error(
                    GitErrorKind::AddFailed,
                    if stderr.is_empty() {
                        "git add for selected paths failed".to_string()
                    } else {
                        stderr
                    },
                ));
            }
        }
    } else if payload.add_all.unwrap_or(false) && !dry_run {
        let add_output = Command::new("git").args(["add", "-A"]).output()?;
        if !add_output.status.success() {
            let stderr = String::from_utf8_lossy(&add_output.stderr)
                .trim()
                .to_string();
            if let Some(hook) = extract_hook_name(&stderr) {
                return Ok(git_error(
                    GitErrorKind::HookFailed,
                    format!("git add -A blocked by {} hook: {}", hook, stderr),
                ));
            }
            return Ok(git_error(
                GitErrorKind::AddFailed,
                if stderr.is_empty() {
                    "git add -A failed".to_string()
                } else {
                    stderr
                },
            ));
        }
    }

    // C1: 收集 staged_files（始终执行，dry_run 也需要返回此信息）
    let staged_output = Command::new("git")
        .args(["diff", "--cached", "--name-only"])
        .output()?;
    if !staged_output.status.success() {
        let stderr = String::from_utf8_lossy(&staged_output.stderr)
            .trim()
            .to_string();
        return Ok(git_error(
            GitErrorKind::StatusFailed,
            if stderr.is_empty() {
                "git diff --cached failed".to_string()
            } else {
                stderr
            },
        ));
    }
    let staged_files: Vec<String> = String::from_utf8_lossy(&staged_output.stdout)
        .lines()
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string())
        .collect();
    if staged_files.is_empty() {
        return Ok(git_error(
            GitErrorKind::NothingToCommit,
            "no staged changes to commit; provide paths or set add_all=true",
        ));
    }

    // C2: 当前分支名 — 用 symbolic-ref --short 而非 rev-parse --abbrev-ref，
    // 因为 rev-parse --abbrev-ref 在 unborn 分支（git init 后未 commit）上返回字面 "HEAD"，
    // 而 symbolic-ref --short 在 unborn 分支上仍能返回分支名（master/main）。
    // detached HEAD 时 symbolic-ref 失败，unwrap_or 兜底为 "HEAD"。
    let branch = Command::new("git")
        .args(["symbolic-ref", "--short", "HEAD"])
        .output()
        .ok()
        .filter(|o| o.status.success())
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "HEAD".to_string());

    // C9: 作者信息（验证提交归属，缺失时返回空字符串而非报错）
    let author_name = Command::new("git")
        .args(["config", "user.name"])
        .output()
        .ok()
        .filter(|o| o.status.success())
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
        .unwrap_or_default();
    let author_email = Command::new("git")
        .args(["config", "user.email"])
        .output()
        .ok()
        .filter(|o| o.status.success())
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
        .unwrap_or_default();

    // C7: dry_run 预演模式 — 不实际 commit
    if dry_run {
        return Ok(ToolOutput::success(serde_json::json!({
            "success": true,
            "dry_run": true,
            "staged_files": staged_files,
            "branch": branch,
            "author_name": author_name,
            "author_email": author_email,
            "message": message,
            "summary": format!("dry-run: {} files staged on branch {}", staged_files.len(), branch)
        }))
        .with_message(format!(
            "dry-run: {} files staged on branch {}",
            staged_files.len(),
            branch
        )));
    }

    // 实际提交
    let commit_output = Command::new("git")
        .args(["commit", "-m", message])
        .output()?;
    if !commit_output.status.success() {
        let stderr = String::from_utf8_lossy(&commit_output.stderr)
            .trim()
            .to_string();
        if let Some(hook) = extract_hook_name(&stderr) {
            return Ok(git_error(
                GitErrorKind::HookFailed,
                format!("git commit blocked by {} hook: {}", hook, stderr),
            ));
        }
        return Ok(git_error(
            GitErrorKind::CommitFailed,
            if stderr.is_empty() {
                "git commit failed".to_string()
            } else {
                stderr
            },
        ));
    }

    // 取 commit hash（短，8 位）
    let hash_output = Command::new("git")
        .args(["rev-parse", "--short=8", "HEAD"])
        .output()?;
    if !hash_output.status.success() {
        let stderr = String::from_utf8_lossy(&hash_output.stderr)
            .trim()
            .to_string();
        return Ok(git_error(
            GitErrorKind::HashFailed,
            if stderr.is_empty() {
                "git rev-parse failed".to_string()
            } else {
                stderr
            },
        ));
    }
    let commit_hash = String::from_utf8_lossy(&hash_output.stdout)
        .trim()
        .to_string();

    // C10: 提交统计（files_changed / insertions / deletions）
    let stats = Command::new("git")
        .args(["show", "--stat", "--oneline", "HEAD"])
        .output()
        .ok()
        .filter(|o| o.status.success())
        .map(|o| parse_commit_stats(&String::from_utf8_lossy(&o.stdout)))
        .unwrap_or_else(|| serde_json::json!({}));

    Ok(ToolOutput::success(serde_json::json!({
        "success": true,
        "commit_hash": commit_hash,
        "message": message,
        "staged_files": staged_files,
        "branch": branch,
        "author_name": author_name,
        "author_email": author_email,
        "stats": stats,
        "summary": format!("created commit {} on {}: {}", commit_hash, branch, message)
    }))
    .with_message(format!("created commit {} on {}", commit_hash, branch)))
}

/// 从 `git show --stat --oneline HEAD` 输出中解析变更统计
/// 目标行形如：` 2 files changed, 10 insertions(+), 3 deletions(-)`
fn parse_commit_stats(output: &str) -> serde_json::Value {
    let stat_line = output
        .lines()
        .find(|l| l.contains("changed") || l.contains("insertion") || l.contains("deletion"));
    match stat_line {
        Some(line) => serde_json::json!({
            "files_changed": extract_number_before(line, "file"),
            "insertions": extract_number_before(line, "insertion"),
            "deletions": extract_number_before(line, "deletion"),
        }),
        None => serde_json::json!({}),
    }
}

/// 从文本行中提取 "<n> <word>" 模式中的数字
/// 例如 "2 files changed" 提取 files_changed=2
fn extract_number_before(line: &str, word: &str) -> u64 {
    let parts: Vec<&str> = line.split_whitespace().collect();
    for (i, p) in parts.iter().enumerate() {
        // 处理 "files" / "file" / "insertions(+)" / "deletion(-)" 等变体
        if p.starts_with(word) || p.starts_with(&format!("{}(", word)) {
            if i > 0 {
                if let Ok(n) = parts[i - 1].parse::<u64>() {
                    return n;
                }
            }
        }
    }
    0
}
