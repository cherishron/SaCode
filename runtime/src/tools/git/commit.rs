use std::collections::HashMap;
use std::path::Path;
use std::process::Command;

use crate::tools::{SideEffectLevel, ToolOutput, ToolSpec};

/// git.commit 输入参数
#[derive(Debug, serde::Deserialize)]
struct GitCommitInput {
    /// 可选: 显式提交消息。为空且 auto_message=true 时走 LLM/启发式生成
    message: Option<String>,
    paths: Option<Vec<String>>,
    add_all: Option<bool>,
    /// 干运行模式：只返回将要提交的元数据（staged_files/branch/author），
    /// 不执行 add 与 commit，便于 LLM 预演
    dry_run: Option<bool>,
    /// 可选: message 为空时尝试自动生成（先 LLM，失败 fallback 启发式），默认 false
    auto_message: Option<bool>,
}

/// 错误分类枚举，序列化为 snake_case 字符串
#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "snake_case")]
enum GitErrorKind {
    /// 非法参数（如 message 为空且未启用 auto_message）
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
    /// 自动生成提交消息失败（LLM 与启发式均失败）
    AutoMessageFailed,
}

/// 提交消息来源 — 标注最终 message 的产生方式
#[derive(Debug, Clone, Copy, serde::Serialize)]
#[serde(rename_all = "snake_case")]
enum MessageSource {
    /// 用户显式提供
    User,
    /// LLM 自动生成
    Llm,
    /// 启发式 fallback 生成
    Heuristic,
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
        description: "提交当前仓库变更。行为：1) 默认仅提交已 staged 的变更；2) add_all=true 时先执行 git add -A；3) paths 非空时仅 add 指定路径（前置存在性校验）；4) add_all 与 paths 同时存在时，paths 优先；5) dry_run=true 时跳过 add 与 commit，只返回当前 staged 状态的元数据（staged_files/branch/author），用于预演；6) 不支持 --amend（避免历史改写风险）；7) message 为空且 auto_message=true 时，先调用 LLM 基于 staged diff 生成 Conventional Commits 消息，LLM 失败则 fallback 到启发式（按文件路径推断 type/scope）。返回 commit_hash/staged_files/branch/author_name/author_email/stats/message_source（user/llm/heuristic）；失败时返回 error_kind 分类（not_a_repo/path_not_found/nothing_to_commit/hook_failed/commit_failed/auto_message_failed 等）。".to_string(),
        input_schema: serde_json::json!({
            "type": "object",
            "properties": {
                "message": { "type": "string", "description": "可选: 显式提交信息（Conventional Commits 推荐格式：feat/fix/docs/chore/refactor 等）。为空时必须设置 auto_message=true" },
                "auto_message": {
                    "type": "boolean",
                    "description": "可选: message 为空时自动生成（先 LLM，失败 fallback 启发式），默认 false"
                },
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
            "required": []
        }),
        output_schema: serde_json::json!({
            "type": "object",
            "properties": {
                "success": { "type": "boolean" },
                "commit_hash": { "type": "string", "description": "提交哈希（短，8 位），dry_run 时为空" },
                "message": { "type": "string", "description": "提交信息" },
                "message_source": {
                    "type": "string",
                    "description": "提交消息来源: user（显式提供）/llm（LLM 生成）/heuristic（启发式 fallback）",
                    "enum": ["user", "llm", "heuristic"]
                },
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
                    "description": "失败分类: invalid_argument/not_a_repo/path_not_found/nothing_to_commit/add_failed/status_failed/hook_failed/commit_failed/hash_failed/auto_message_failed",
                    "enum": [
                        "invalid_argument",
                        "not_a_repo",
                        "path_not_found",
                        "nothing_to_commit",
                        "add_failed",
                        "status_failed",
                        "hook_failed",
                        "commit_failed",
                        "hash_failed",
                        "auto_message_failed"
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
    let user_message = payload
        .message
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string());
    let auto_message = payload.auto_message.unwrap_or(false);
    if user_message.is_none() && !auto_message {
        return Ok(git_error(
            GitErrorKind::InvalidArgument,
            "message is required (or set auto_message=true to generate)",
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

    // 解析最终 message：用户显式 > LLM 生成 > 启发式 fallback
    let (message, message_source) = match user_message {
        Some(msg) => (msg, MessageSource::User),
        None => {
            // auto_message=true 路径：先尝试 LLM，失败 fallback 启发式
            let staged_diff = collect_staged_diff_summary(&staged_files);
            match generate_message_via_llm(&staged_files, &staged_diff) {
                Some(msg) => (msg, MessageSource::Llm),
                None => match heuristic_commit_message(&staged_files) {
                    Some(msg) => (msg, MessageSource::Heuristic),
                    None => {
                        return Ok(git_error(
                            GitErrorKind::AutoMessageFailed,
                            "failed to generate commit message (LLM unavailable and heuristic exhausted)",
                        ));
                    }
                },
            }
        }
    };

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
            "message_source": message_source,
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
        .args(["commit", "-m", &message])
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
        "message_source": message_source,
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

/// 收集 staged diff 摘要供 LLM 生成提交消息使用
/// 截取前 8KB 避免超出 LLM 上下文窗口，并附文件路径列表
fn collect_staged_diff_summary(staged_files: &[String]) -> String {
    let diff_output = Command::new("git")
        .args(["diff", "--cached", "--stat"])
        .output()
        .ok();
    let stat_text = diff_output
        .filter(|o| o.status.success())
        .map(|o| String::from_utf8_lossy(&o.stdout).to_string())
        .unwrap_or_default();
    let files_list = staged_files.join("\n");
    // 限制总长度 8KB，避免 LLM 上下文爆炸
    let combined = format!("Files:\n{}\n\nStats:\n{}", files_list, stat_text);
    combined.chars().take(8 * 1024).collect()
}

/// 通过 LLM 生成 Conventional Commits 格式的提交消息
/// 在独立线程中创建 tokio Runtime 调用，避免与上层 async runtime 冲突
/// 失败返回 None，由调用方 fallback 到启发式
fn generate_message_via_llm(staged_files: &[String], staged_diff: &str) -> Option<String> {
    use std::sync::mpsc;
    use std::time::Duration;

    let files = staged_files.to_vec();
    let diff = staged_diff.to_string();
    let (tx, rx) = mpsc::channel();
    std::thread::spawn(move || {
        let result = (|| -> anyhow::Result<String> {
            // 独立 Runtime — 不依赖上层 async context
            let rt = tokio::runtime::Builder::new_current_thread()
                .enable_all()
                .build()?;
            let message = rt.block_on(async move {
                let cwd = std::env::current_dir()?;
                let provider =
                    crate::agents::model_router::resolve_config_model_candidates(&cwd)
                        .into_iter()
                        .next()
                        .map(|(_, _, p)| p)
                        .ok_or_else(|| anyhow::anyhow!("no provider configured"))?;
                let client = crate::provider::client::ProviderClient::new();
                let prompt = format!(
                    "你是一个提交消息生成器。根据以下 git staged 变更生成一条 Conventional Commits 格式的提交消息。\n\
                     要求：\n\
                     1. 仅返回消息正文一行，格式为 `<type>(<scope>): <subject>` 或 `<type>: <subject>`\n\
                     2. type 取值: feat/fix/docs/style/refactor/perf/test/build/ci/chore/revert\n\
                     3. subject 用中文描述，不超过 50 字\n\
                     4. 不要返回引号、代码块、解释或多余换行\n\n\
                     变更文件：\n{}\n\nDiff 摘要：\n{}",
                    files.join("\n"),
                    diff
                );
                let response = client.simple_chat(&provider, &prompt).await?;
                // 取首行非空文本，去除引号/代码块包裹
                let cleaned = response
                    .trim()
                    .trim_matches('"')
                    .trim_matches('`')
                    .lines()
                    .find(|l| !l.trim().is_empty())
                    .unwrap_or("chore: update")
                    .trim()
                    .to_string();
                Ok::<String, anyhow::Error>(cleaned)
            })?;
            Ok(message)
        })();
        let _ = tx.send(result);
    });

    // 30 秒超时 — LLM 调用不应阻塞 commit 过久
    match rx.recv_timeout(Duration::from_secs(30)) {
        Ok(Ok(message)) if !message.trim().is_empty() => Some(message),
        _ => None,
    }
}

/// 启发式生成提交消息 — 基于 staged 文件路径推断 type/scope/subject
/// 作为 LLM 不可用时的 fallback，确保 auto_message 始终能产出可用消息
fn heuristic_commit_message(staged_files: &[String]) -> Option<String> {
    if staged_files.is_empty() {
        return None;
    }
    let change_type = infer_change_type(staged_files);
    let scope = infer_scope(staged_files);
    // scope 与 type 同名时省略，避免 "docs(docs): ..." 这类冗余
    let scope = scope.filter(|s| s != change_type);
    let subject = infer_subject(staged_files);
    Some(match scope {
        Some(s) => format!("{}({}): {}", change_type, s, subject),
        None => format!("{}: {}", change_type, subject),
    })
}

/// 根据文件路径推断 Conventional Commits type
fn infer_change_type(files: &[String]) -> &'static str {
    let has_test = files
        .iter()
        .any(|f| f.contains("test") || f.contains("tests") || f.contains("/tests/"));
    let has_doc = files
        .iter()
        .any(|f| f.contains("/docs/") || f.ends_with(".md") || f.ends_with("README"));
    let has_src = files.iter().any(|f| f.contains("/src/"));
    let has_config = files.iter().any(|f| {
        f.ends_with("Cargo.toml")
            || f.ends_with("package.json")
            || f.ends_with(".toml")
            || f.ends_with(".yml")
            || f.ends_with(".yaml")
            || f.ends_with("Dockerfile")
    });

    // 文档类变更（无 src 改动）→ docs
    if has_doc && !has_src {
        return "docs";
    }
    // 仅测试变更 → test
    if has_test && !has_src {
        return "test";
    }
    // 仅配置/构建变更 → chore
    if has_config && !has_src {
        return "chore";
    }
    // 默认 feat — src 有改动视为功能变更
    "feat"
}

/// 取最常见的一级目录作为 scope
fn infer_scope(files: &[String]) -> Option<String> {
    let mut dir_counts: HashMap<String, usize> = HashMap::new();
    for f in files {
        // 取路径第一段作为 scope 候选
        if let Some(first) = f.split('/').next() {
            // 跳过文件名（无 / 的路径）
            if f.contains('/') {
                *dir_counts.entry(first.to_string()).or_insert(0) += 1;
            }
        }
    }
    dir_counts
        .into_iter()
        .max_by_key(|(_, c)| *c)
        .map(|(d, _)| d)
}

/// 生成 subject — 单文件取文件名，多文件取数量
fn infer_subject(files: &[String]) -> String {
    if files.len() == 1 {
        let f = &files[0];
        let name = f.rsplit('/').next().unwrap_or(f);
        // 去扩展名
        let stem = name.rsplit_once('.').map(|(n, _)| n).unwrap_or(name);
        format!("update {}", stem)
    } else {
        format!("update {} files", files.len())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_infer_change_type_docs() {
        assert_eq!(
            infer_change_type(&["docs/guide.md".to_string()]),
            "docs"
        );
    }

    #[test]
    fn test_infer_change_type_test() {
        assert_eq!(
            infer_change_type(&["tests/foo_test.rs".to_string()]),
            "test"
        );
    }

    #[test]
    fn test_infer_change_type_feat() {
        assert_eq!(
            infer_change_type(&["src/main.rs".to_string()]),
            "feat"
        );
    }

    #[test]
    fn test_infer_change_type_chore() {
        assert_eq!(
            infer_change_type(&["Cargo.toml".to_string()]),
            "chore"
        );
    }

    #[test]
    fn test_infer_scope_common_dir() {
        let scope = infer_scope(&[
            "src/tools/git/commit.rs".to_string(),
            "src/tools/git/push.rs".to_string(),
        ]);
        assert_eq!(scope.as_deref(), Some("src"));
    }

    #[test]
    fn test_infer_scope_no_dir() {
        // 无目录分隔的纯文件名不应产生 scope
        let scope = infer_scope(&["README.md".to_string()]);
        assert_eq!(scope, None);
    }

    #[test]
    fn test_infer_subject_single_file() {
        let subject = infer_subject(&["src/main.rs".to_string()]);
        assert_eq!(subject, "update main");
    }

    #[test]
    fn test_infer_subject_multi_files() {
        let subject = infer_subject(&[
            "src/a.rs".to_string(),
            "src/b.rs".to_string(),
        ]);
        assert_eq!(subject, "update 2 files");
    }

    #[test]
    fn test_heuristic_commit_message_single_file() {
        let msg = heuristic_commit_message(&["docs/guide.md".to_string()]);
        assert_eq!(msg.as_deref(), Some("docs: update guide"));
    }

    #[test]
    fn test_heuristic_commit_message_multi_files_with_scope() {
        let msg = heuristic_commit_message(&[
            "src/tools/git/commit.rs".to_string(),
            "src/tools/git/push.rs".to_string(),
        ]);
        assert_eq!(
            msg.as_deref(),
            Some("feat(src): update 2 files")
        );
    }

    #[test]
    fn test_heuristic_commit_message_empty() {
        let msg = heuristic_commit_message(&[]);
        assert_eq!(msg, None);
    }
}
