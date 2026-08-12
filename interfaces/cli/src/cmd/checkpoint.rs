use anyhow::Result;
use sacode_kernel::ExecutionMode;
use sacode_runtime::CheckpointStorage;
use std::path::PathBuf;

pub async fn run(args: Vec<String>) -> Result<()> {
    let storage = CheckpointStorage::new(&PathBuf::from("."));

    if args.is_empty() {
        list_checkpoints(&storage)?;
        return Ok(());
    }

    let cmd = args[0].as_str();

    match cmd {
        "list" => list_checkpoints(&storage)?,
        "show" => {
            if args.len() < 2 {
                println!("Usage: checkpoint show <filename>");
                return Ok(());
            }
            show_checkpoint(&storage, &args[1])?;
        }
        "restore" => {
            if args.len() < 2 {
                println!("Usage: checkpoint restore <filename> [--dry-run] [--mode <mode>] [--max-iter <n>]");
                return Ok(());
            }
            restore_checkpoint(&storage, &args[1], &args[2..]).await?;
        }
        "diff" => {
            if args.len() < 3 {
                println!("Usage: checkpoint diff <file_a> <file_b>");
                return Ok(());
            }
            diff_checkpoints(&storage, &args[1], &args[2])?;
        }
        "clean" => {
            clean_checkpoints(&storage)?;
        }
        _ => {
            println!("Unknown checkpoint command: {}", cmd);
            println!("Available commands: list, show, restore, diff, clean");
        }
    }

    Ok(())
}

fn list_checkpoints(storage: &CheckpointStorage) -> Result<()> {
    let checkpoints = storage.list()?;

    if checkpoints.is_empty() {
        println!("No checkpoints found in {}", storage.path().display());
        return Ok(());
    }

    println!("Checkpoints in {}:", storage.path().display());
    for checkpoint in checkpoints {
        println!("  {}", checkpoint);
    }

    Ok(())
}

fn show_checkpoint(storage: &CheckpointStorage, filename: &str) -> Result<()> {
    let checkpoint = storage.load(filename)?;

    println!("Checkpoint: {}", filename);
    println!("Task: {}", checkpoint.task.prompt);
    println!("Mode: {:?}", checkpoint.task.mode);
    println!("Current Step: {}", checkpoint.current_step);
    println!("Created: {}", checkpoint.created_at);
    println!("Updated: {}", checkpoint.updated_at);

    if !checkpoint.executed_tools.is_empty() {
        println!("Executed Tools:");
        for tool in &checkpoint.executed_tools {
            println!(
                "  {} - {} ({})",
                tool.name,
                if tool.success { "OK" } else { "FAIL" },
                tool.timestamp
            );
        }
    }

    if let Some(pending) = &checkpoint.pending_approval {
        println!("Pending Approval: {}", pending);
    }

    Ok(())
}

async fn restore_checkpoint(
    storage: &CheckpointStorage,
    filename: &str,
    extra_args: &[String],
) -> Result<()> {
    let checkpoint = storage.load(filename)?;

    // 解析参数
    let dry_run = extra_args.iter().any(|a| a == "--dry-run");
    let mode_override = parse_mode_override(extra_args);
    let max_iter = parse_max_iter(extra_args).unwrap_or(3);
    let approval = parse_approval(extra_args);

    let mode = mode_override.unwrap_or(checkpoint.task.mode);

    // 显示恢复摘要
    println!("=== Checkpoint Restore ===");
    println!("Source: {}", filename);
    if let Some(task_id) = &checkpoint.task_id {
        println!("Task ID: {}", task_id);
    }
    println!("Task: {}", checkpoint.task.prompt);
    println!("Mode: {:?}", mode);
    println!("Approval: {:?}", approval);
    println!("Max iterations: {}", max_iter);
    println!("Status: {:?}", checkpoint.status);
    println!("Executed tools: {}", checkpoint.executed_tools.len());

    if !checkpoint.executed_tools.is_empty() {
        println!("\nPreviously executed tools:");
        for (i, tool) in checkpoint.executed_tools.iter().enumerate() {
            let status = if tool.success { "OK" } else { "FAIL" };
            println!("  {}. {} - {}", i + 1, tool.name, status);
        }
    }

    if dry_run {
        println!("\n--dry-run specified, not executing.");
        return Ok(());
    }

    // 构造增强 prompt — 把已执行工具历史作为上下文注入，让 LLM 从断点继续
    let enhanced_prompt = build_restore_prompt(&checkpoint);

    println!("\nResuming execution...\n");

    // 调用执行入口 — 真正恢复执行
    use crate::runner::{format_stream_tail, run_task_with_stdin};
    let output =
        run_task_with_stdin(&enhanced_prompt, mode, approval, max_iter, None).await?;

    println!();
    println!("{}", format_stream_tail(&output));

    Ok(())
}

/// 构造恢复执行的增强 prompt — 在原始 prompt 基础上附加 checkpoint 上下文
fn build_restore_prompt(checkpoint: &sacode_kernel::schema::Checkpoint) -> String {
    let mut prompt = checkpoint.task.prompt.clone();

    if !checkpoint.executed_tools.is_empty() {
        prompt.push_str("\n\n--- Checkpoint Context ---\n");
        prompt.push_str(&format!(
            "Restored from checkpoint (status: {:?}, {} tools previously executed).\n",
            checkpoint.status,
            checkpoint.executed_tools.len()
        ));
        prompt.push_str("Previous tool execution history:\n");
        for (i, tool) in checkpoint.executed_tools.iter().enumerate() {
            let status = if tool.success { "success" } else { "failed" };
            prompt.push_str(&format!(
                "{}. {} ({})\n",
                i + 1,
                tool.name,
                status
            ));
        }
        prompt.push_str("\nContinue from where the previous execution left off, avoiding repeating already-completed successful steps.");
    }

    prompt
}

fn parse_mode_override(args: &[String]) -> Option<ExecutionMode> {
    let mut iter = args.iter();
    while let Some(arg) = iter.next() {
        if arg == "--mode" {
            if let Some(value) = iter.next() {
                return match value.as_str() {
                    "build" | "Build" => Some(ExecutionMode::Build),
                    "plan" | "Plan" => Some(ExecutionMode::Plan),
                    "yolo" | "Yolo" => Some(ExecutionMode::Yolo),
                    _ => None,
                };
            }
        }
    }
    None
}

fn parse_max_iter(args: &[String]) -> Option<usize> {
    let mut iter = args.iter();
    while let Some(arg) = iter.next() {
        if arg == "--max-iter" {
            if let Some(value) = iter.next() {
                return value.parse().ok();
            }
        }
    }
    None
}

fn parse_approval(args: &[String]) -> sacode_kernel::ApprovalPolicy {
    for arg in args {
        match arg.as_str() {
            "--approve" | "--auto" => return sacode_kernel::ApprovalPolicy::AutoApprove,
            "--deny" => return sacode_kernel::ApprovalPolicy::AutoDeny,
            "--prompt" => return sacode_kernel::ApprovalPolicy::Prompt,
            _ => {}
        }
    }
    sacode_kernel::ApprovalPolicy::Prompt
}

/// 对比两个 checkpoint 的工具调用差异
///
/// 输出格式：
/// - 工具调用列表的增删改
/// - 工具执行结果（成功/失败）变化
/// - 汇总统计
fn diff_checkpoints(storage: &CheckpointStorage, file_a: &str, file_b: &str) -> Result<()> {
    let cp_a = storage.load(file_a)?;
    let cp_b = storage.load(file_b)?;

    println!("=== Checkpoint Diff ===");
    println!(
        "A: {} (task: {}, {} tools)",
        file_a,
        truncate_prompt(&cp_a.task.prompt, 50),
        cp_a.executed_tools.len()
    );
    println!(
        "B: {} (task: {}, {} tools)",
        file_b,
        truncate_prompt(&cp_b.task.prompt, 50),
        cp_b.executed_tools.len()
    );

    let tools_a: Vec<ToolSignature> = cp_a.executed_tools.iter().map(ToolSignature::from).collect();
    let tools_b: Vec<ToolSignature> = cp_b.executed_tools.iter().map(ToolSignature::from).collect();
    let diff = compute_tool_diff(&tools_a, &tools_b);

    println!("\nTool call differences:");
    for entry in &diff.entries {
        match entry.kind {
            DiffKind::Added => println!("  + {} (added in B, {} call(s))", entry.name, entry.count_b),
            DiffKind::Removed => println!("  - {} (only in A, {} call(s))", entry.name, entry.count_a),
            DiffKind::CountChanged => println!(
                "  ~ {} (count changed: A={}, B={})",
                entry.name, entry.count_a, entry.count_b
            ),
            DiffKind::ResultChanged => println!(
                "  ~ {} (result changed: A={}OK/{}FAIL, B={}OK/{}FAIL)",
                entry.name,
                entry.success_a,
                entry.count_a - entry.success_a,
                entry.success_b,
                entry.count_b - entry.success_b
            ),
            DiffKind::Unchanged => {}
        }
    }

    if diff.entries.iter().all(|e| e.kind == DiffKind::Unchanged) {
        println!("  (no differences)");
    }

    println!("\nSummary:");
    println!(
        "  A: {} tools ({} OK, {} FAIL)",
        diff.total_a,
        diff.ok_a,
        diff.fail_a
    );
    println!(
        "  B: {} tools ({} OK, {} FAIL)",
        diff.total_b,
        diff.ok_b,
        diff.fail_b
    );
    println!(
        "  Added: {}, Removed: {}, Changed: {}",
        diff.added, diff.removed, diff.changed
    );

    Ok(())
}

/// 单个工具的 diff 条目
#[derive(Debug, Clone, PartialEq, Eq)]
struct DiffEntry {
    name: String,
    kind: DiffKind,
    count_a: usize,
    count_b: usize,
    success_a: usize,
    success_b: usize,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum DiffKind {
    Added,
    Removed,
    CountChanged,
    ResultChanged,
    Unchanged,
}

/// diff 汇总结果
struct DiffSummary {
    entries: Vec<DiffEntry>,
    added: usize,
    removed: usize,
    changed: usize,
    total_a: usize,
    total_b: usize,
    ok_a: usize,
    fail_a: usize,
    ok_b: usize,
    fail_b: usize,
}

/// 纯函数：对比两个工具签名列表，返回结构化 diff 结果
fn compute_tool_diff(tools_a: &[ToolSignature], tools_b: &[ToolSignature]) -> DiffSummary {
    let mut names_a: std::collections::BTreeMap<&str, usize> = std::collections::BTreeMap::new();
    for t in tools_a {
        *names_a.entry(t.name.as_str()).or_default() += 1;
    }
    let mut names_b: std::collections::BTreeMap<&str, usize> = std::collections::BTreeMap::new();
    for t in tools_b {
        *names_b.entry(t.name.as_str()).or_default() += 1;
    }

    let all_names: std::collections::BTreeSet<&str> =
        names_a.keys().chain(names_b.keys()).copied().collect();

    let mut entries = Vec::new();
    let mut added = 0;
    let mut removed = 0;
    let mut changed = 0;

    for name in all_names {
        let count_a = names_a.get(name).copied().unwrap_or(0);
        let count_b = names_b.get(name).copied().unwrap_or(0);
        let success_a: usize = tools_a.iter().filter(|t| t.name == name && t.success).count();
        let success_b: usize = tools_b.iter().filter(|t| t.name == name && t.success).count();

        let kind = if count_a == 0 && count_b > 0 {
            added += count_b;
            DiffKind::Added
        } else if count_a > 0 && count_b == 0 {
            removed += count_a;
            DiffKind::Removed
        } else if count_a != count_b {
            changed += (count_a as i64 - count_b as i64).unsigned_abs() as usize;
            DiffKind::CountChanged
        } else if success_a != success_b {
            changed += 1;
            DiffKind::ResultChanged
        } else {
            DiffKind::Unchanged
        };

        entries.push(DiffEntry {
            name: name.to_string(),
            kind,
            count_a,
            count_b,
            success_a,
            success_b,
        });
    }

    let ok_a = tools_a.iter().filter(|t| t.success).count();
    let fail_a = tools_a.len() - ok_a;
    let ok_b = tools_b.iter().filter(|t| t.success).count();
    let fail_b = tools_b.len() - ok_b;

    DiffSummary {
        entries,
        added,
        removed,
        changed,
        total_a: tools_a.len(),
        total_b: tools_b.len(),
        ok_a,
        fail_a,
        ok_b,
        fail_b,
    }
}

/// 工具调用的签名摘要 — 用于 diff 对比
struct ToolSignature {
    name: String,
    success: bool,
}

impl From<&sacode_kernel::schema::ToolRecord> for ToolSignature {
    fn from(record: &sacode_kernel::schema::ToolRecord) -> Self {
        Self {
            name: record.name.clone(),
            success: record.success,
        }
    }
}

fn truncate_prompt(s: &str, max: usize) -> String {
    if s.len() <= max {
        s.to_string()
    } else {
        format!("{}...", &s[..max])
    }
}

fn clean_checkpoints(storage: &CheckpointStorage) -> Result<()> {
    let checkpoints = storage.list()?;

    if checkpoints.is_empty() {
        println!("No checkpoints to clean");
        return Ok(());
    }

    let path = storage.path();
    for checkpoint in &checkpoints {
        let file_path = path.join(checkpoint);
        std::fs::remove_file(&file_path)?;
        println!("Removed: {}", checkpoint);
    }

    println!("Cleaned {} checkpoint(s)", checkpoints.len());

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use sacode_kernel::schema::{Checkpoint, Task};
    use sacode_kernel::TaskState;

    #[test]
    fn parse_mode_override_recognizes_valid_modes() {
        let args = vec!["--mode".to_string(), "plan".to_string()];
        assert_eq!(parse_mode_override(&args), Some(ExecutionMode::Plan));

        let args = vec!["--mode".to_string(), "yolo".to_string()];
        assert_eq!(parse_mode_override(&args), Some(ExecutionMode::Yolo));

        let args = vec!["--mode".to_string(), "build".to_string()];
        assert_eq!(parse_mode_override(&args), Some(ExecutionMode::Build));
    }

    #[test]
    fn parse_mode_override_returns_none_for_missing_or_invalid() {
        assert_eq!(parse_mode_override(&[]), None);
        assert_eq!(
            parse_mode_override(&["--mode".to_string(), "invalid".to_string()]),
            None
        );
        // 缺值
        assert_eq!(parse_mode_override(&["--mode".to_string()]), None);
    }

    #[test]
    fn parse_max_iter_parses_positive_integers() {
        assert_eq!(parse_max_iter(&["--max-iter".to_string(), "10".to_string()]), Some(10));
        assert_eq!(parse_max_iter(&["--max-iter".to_string(), "1".to_string()]), Some(1));
        assert_eq!(parse_max_iter(&[]), None);
        // 无效整数
        assert_eq!(
            parse_max_iter(&["--max-iter".to_string(), "abc".to_string()]),
            None
        );
    }

    #[test]
    fn parse_approval_maps_flags_to_policy() {
        assert_eq!(
            parse_approval(&["--approve".to_string()]),
            sacode_kernel::ApprovalPolicy::AutoApprove
        );
        assert_eq!(
            parse_approval(&["--auto".to_string()]),
            sacode_kernel::ApprovalPolicy::AutoApprove
        );
        assert_eq!(
            parse_approval(&["--deny".to_string()]),
            sacode_kernel::ApprovalPolicy::AutoDeny
        );
        assert_eq!(
            parse_approval(&["--prompt".to_string()]),
            sacode_kernel::ApprovalPolicy::Prompt
        );
        // 默认
        assert_eq!(
            parse_approval(&[]),
            sacode_kernel::ApprovalPolicy::Prompt
        );
    }

    #[test]
    fn build_restore_prompt_includes_history() {
        let mut cp = Checkpoint::new(Task::new("test task", ExecutionMode::Build, None));
        cp.record_tool(
            "fs.read".to_string(),
            serde_json::json!({"path": "test.rs"}),
            serde_json::json!({"content": "ok"}),
            true,
        );
        cp.set_status(TaskState::Running);

        let prompt = build_restore_prompt(&cp);
        assert!(prompt.contains("test task"));
        assert!(prompt.contains("Checkpoint Context"));
        assert!(prompt.contains("fs.read"));
        assert!(prompt.contains("success"));
        assert!(prompt.contains("Continue from where"));
    }

    #[test]
    fn build_restore_prompt_without_history_keeps_original() {
        let cp = Checkpoint::new(Task::new("simple task", ExecutionMode::Plan, None));
        let prompt = build_restore_prompt(&cp);
        assert_eq!(prompt, "simple task");
        assert!(!prompt.contains("Checkpoint Context"));
    }

    #[test]
    fn compute_tool_diff_detects_added_tools() {
        let a = vec![
            ToolSignature { name: "fs.read".to_string(), success: true },
        ];
        let b = vec![
            ToolSignature { name: "fs.read".to_string(), success: true },
            ToolSignature { name: "shell.exec".to_string(), success: true },
        ];
        let diff = compute_tool_diff(&a, &b);
        assert_eq!(diff.added, 1);
        assert_eq!(diff.removed, 0);
        assert_eq!(diff.total_a, 1);
        assert_eq!(diff.total_b, 2);
        // shell.exec 应标记为 Added
        let shell_entry = diff.entries.iter().find(|e| e.name == "shell.exec").unwrap();
        assert_eq!(shell_entry.kind, DiffKind::Added);
    }

    #[test]
    fn compute_tool_diff_detects_removed_tools() {
        let a = vec![
            ToolSignature { name: "fs.read".to_string(), success: true },
            ToolSignature { name: "git.diff".to_string(), success: true },
        ];
        let b = vec![
            ToolSignature { name: "fs.read".to_string(), success: true },
        ];
        let diff = compute_tool_diff(&a, &b);
        assert_eq!(diff.added, 0);
        assert_eq!(diff.removed, 1);
        let git_entry = diff.entries.iter().find(|e| e.name == "git.diff").unwrap();
        assert_eq!(git_entry.kind, DiffKind::Removed);
    }

    #[test]
    fn compute_tool_diff_detects_count_change() {
        let a = vec![
            ToolSignature { name: "fs.read".to_string(), success: true },
        ];
        let b = vec![
            ToolSignature { name: "fs.read".to_string(), success: true },
            ToolSignature { name: "fs.read".to_string(), success: true },
        ];
        let diff = compute_tool_diff(&a, &b);
        assert_eq!(diff.changed, 1);
        let entry = diff.entries.iter().find(|e| e.name == "fs.read").unwrap();
        assert_eq!(entry.kind, DiffKind::CountChanged);
        assert_eq!(entry.count_a, 1);
        assert_eq!(entry.count_b, 2);
    }

    #[test]
    fn compute_tool_diff_detects_result_change() {
        let a = vec![
            ToolSignature { name: "shell.exec".to_string(), success: true },
            ToolSignature { name: "shell.exec".to_string(), success: true },
        ];
        let b = vec![
            ToolSignature { name: "shell.exec".to_string(), success: true },
            ToolSignature { name: "shell.exec".to_string(), success: false },
        ];
        let diff = compute_tool_diff(&a, &b);
        assert_eq!(diff.changed, 1);
        let entry = diff.entries.iter().find(|e| e.name == "shell.exec").unwrap();
        assert_eq!(entry.kind, DiffKind::ResultChanged);
        assert_eq!(entry.success_a, 2);
        assert_eq!(entry.success_b, 1);
    }

    #[test]
    fn compute_tool_diff_no_changes() {
        let a = vec![
            ToolSignature { name: "fs.read".to_string(), success: true },
            ToolSignature { name: "shell.exec".to_string(), success: false },
        ];
        let b = vec![
            ToolSignature { name: "fs.read".to_string(), success: true },
            ToolSignature { name: "shell.exec".to_string(), success: false },
        ];
        let diff = compute_tool_diff(&a, &b);
        assert_eq!(diff.added, 0);
        assert_eq!(diff.removed, 0);
        assert_eq!(diff.changed, 0);
        assert!(diff.entries.iter().all(|e| e.kind == DiffKind::Unchanged));
    }

    #[test]
    fn compute_tool_diff_empty_lists() {
        let diff = compute_tool_diff(&[], &[]);
        assert_eq!(diff.total_a, 0);
        assert_eq!(diff.total_b, 0);
        assert!(diff.entries.is_empty());
    }

    #[test]
    fn truncate_prompt_short_strings_unchanged() {
        assert_eq!(truncate_prompt("hello", 50), "hello");
        assert_eq!(truncate_prompt("exactly50chars_exactly50chars_exactly50char", 50), "exactly50chars_exactly50chars_exactly50char");
    }

    #[test]
    fn truncate_prompt_long_strings_truncated() {
        let long = "a".repeat(100);
        let result = truncate_prompt(&long, 50);
        assert_eq!(result.len(), 53); // 50 + "..."
        assert!(result.ends_with("..."));
    }
}
