use std::{fs, path::Path};

use anyhow::Result;
use sacode_runtime::{
    append_memory_entry, ensure_memory_file, memory_file_path, MemoryEntry, MemoryEntrySource,
    MemoryKind, MemoryScope, PROJECT_WIKI_DIR,
};
use serde::{Deserialize, Serialize};

pub type LearnedKind = MemoryKind;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct LearnedFact {
    pub kind: LearnedKind,
    pub content: String,
    pub context: String,
}

pub fn learn_from_task(
    workdir: &Path,
    user_prompt: &str,
    provider_response: &str,
) -> Result<Vec<LearnedFact>> {
    let facts = extract_learnings(user_prompt, provider_response);
    let mut appended = Vec::new();
    for fact in &facts {
        if append_learned_fact(workdir, fact)? {
            appended.push(fact.clone());
        }
    }
    Ok(appended)
}

pub fn extract_learnings(user_prompt: &str, provider_response: &str) -> Vec<LearnedFact> {
    let mut facts = Vec::new();

    for line in user_prompt
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
    {
        if let Some(content) = extract_preference(line) {
            facts.push(LearnedFact {
                kind: LearnedKind::Preference,
                content,
                context: "用户输入中出现明确长期偏好表达".to_string(),
            });
        }
        if let Some(content) = extract_workflow(line) {
            facts.push(LearnedFact {
                kind: LearnedKind::Workflow,
                content,
                context: "用户输入中出现明确流程约束表达".to_string(),
            });
        }
    }

    for line in provider_response
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
    {
        if should_skip_provider_decision_line(line) {
            continue;
        }
        if let Some(content) = extract_decision(line) {
            facts.push(LearnedFact {
                kind: LearnedKind::Decision,
                content,
                context: "模型输出中出现明确项目决策表达".to_string(),
            });
        }
    }

    dedup_facts(facts)
}

fn extract_preference(line: &str) -> Option<String> {
    let markers = ["以后", "每次", "默认", "统一", "优先", "请用", "请保持"];
    if should_skip_user_learning_line(line) {
        return None;
    }
    if markers.iter().any(|marker| line.contains(marker)) && !line.contains("/memory") {
        return Some(normalize_line(line));
    }
    None
}

fn extract_workflow(line: &str) -> Option<String> {
    let markers = ["流程", "步骤", "先", "再", "然后", "完成后", "提交前"];
    if should_skip_user_learning_line(line) {
        return None;
    }
    if markers
        .iter()
        .filter(|marker| line.contains(**marker))
        .count()
        >= 2
    {
        return Some(normalize_line(line));
    }
    None
}

fn extract_decision(line: &str) -> Option<String> {
    let markers = ["以", "为准", "采用", "使用", "落到", "保留", "切到"];
    if line.contains("为准") || line.contains("采用") || line.contains("落到") {
        return Some(normalize_line(line));
    }
    if markers
        .iter()
        .filter(|marker| line.contains(**marker))
        .count()
        >= 2
        && line.contains("项目")
    {
        return Some(normalize_line(line));
    }
    None
}

fn normalize_line(line: &str) -> String {
    line.trim().trim_start_matches('-').trim().to_string()
}

fn should_skip_user_learning_line(line: &str) -> bool {
    let trimmed = line.trim();
    if trimmed.is_empty() || trimmed.starts_with('/') {
        return true;
    }

    let durable_markers = [
        "以后",
        "每次",
        "默认",
        "统一",
        "优先",
        "请用",
        "请保持",
        "流程",
        "步骤",
        "提交前",
        "完成后",
    ];
    if durable_markers
        .iter()
        .any(|marker| trimmed.contains(marker))
    {
        return false;
    }

    let request_markers = [
        "帮我",
        "请帮我",
        "请你",
        "麻烦",
        "看一下",
        "看一眼",
        "处理一下",
        "解决一下",
    ];
    if request_markers
        .iter()
        .any(|marker| trimmed.contains(marker))
    {
        return true;
    }

    let task_markers = [
        "修复", "实现", "增加", "添加", "删除", "修改", "重构", "解释", "分析", "看看", "排查",
        "运行", "测试", "提交", "commit",
    ];
    if task_markers.iter().any(|marker| trimmed.contains(marker)) && !trimmed.contains("提交前")
    {
        return true;
    }

    let transient_markers = [
        "这次",
        "这一轮",
        "当前任务",
        "本次",
        "现在先",
        "先把",
        "先做",
    ];
    transient_markers
        .iter()
        .any(|marker| trimmed.contains(marker))
}

fn should_skip_provider_decision_line(line: &str) -> bool {
    let trimmed = line.trim();
    trimmed.is_empty()
        || trimmed.starts_with('/')
        || trimmed.contains("这次")
        || trimmed.contains("这一轮")
        || trimmed.contains("本次")
}

fn dedup_facts(facts: Vec<LearnedFact>) -> Vec<LearnedFact> {
    let mut unique = Vec::new();
    for fact in facts {
        if unique.iter().any(|existing: &LearnedFact| {
            existing.kind == fact.kind && existing.content.eq_ignore_ascii_case(&fact.content)
        }) {
            continue;
        }
        unique.push(fact);
    }
    unique
}

fn append_learned_fact(workdir: &Path, fact: &LearnedFact) -> Result<bool> {
    let path = memory_file_path(&workdir.join(PROJECT_WIKI_DIR), fact.kind);
    ensure_memory_file(&path, MemoryScope::Project, fact.kind)?;
    let current = fs::read_to_string(&path)?;
    append_memory_entry(
        &path,
        &current,
        &MemoryEntry {
            kind: fact.kind,
            scope: MemoryScope::Project,
            source: MemoryEntrySource::AutoLearned,
            content: fact.content.clone(),
            context: fact.context.clone(),
        },
    )
}

#[cfg(test)]
mod tests {
    use super::{extract_learnings, learn_from_task, LearnedKind};

    #[test]
    fn extract_learnings_detects_preference_workflow_and_decision() {
        let facts = extract_learnings(
            "以后回复保持简洁。\n提交前先运行检查再继续。",
            "当前项目以 Cargo.toml 和 workflow 为准。",
        );
        assert!(facts
            .iter()
            .any(|fact| fact.kind == LearnedKind::Preference));
        assert!(facts.iter().any(|fact| fact.kind == LearnedKind::Workflow));
        assert!(facts.iter().any(|fact| fact.kind == LearnedKind::Decision));
    }

    #[test]
    fn learn_from_task_writes_project_wiki_files() {
        let temp_dir = tempfile::tempdir().expect("create temp dir");
        let workdir = temp_dir.path();
        let facts = learn_from_task(
            workdir,
            "提交前先看 diff 再继续。",
            "当前项目以 .sacode/wiki 作为知识落点。",
        )
        .expect("learn from task");
        assert!(!facts.is_empty());
        let workflows = std::fs::read_to_string(workdir.join(".sacode/wiki/experience.md"))
            .expect("read workflows");
        assert!(workflows.contains("自动学习条目"));
    }

    #[test]
    fn learn_from_task_only_returns_newly_written_facts() {
        let temp_dir = tempfile::tempdir().expect("create temp dir");
        let workdir = temp_dir.path();

        let first = learn_from_task(
            workdir,
            "以后回复保持简洁。提交前先看 diff 再继续。",
            "当前项目以 .sacode/wiki 作为知识落点。",
        )
        .expect("first learn from task");
        assert!(!first.is_empty());

        let second = learn_from_task(
            workdir,
            "以后回复保持简洁。提交前先看 diff 再继续。",
            "当前项目以 .sacode/wiki 作为知识落点。",
        )
        .expect("second learn from task");
        assert!(second.is_empty());
    }

    #[test]
    fn extract_learnings_skips_one_off_task_requests() {
        let facts = extract_learnings(
            "帮我修复登录问题。请你先看报错再修改。",
            "这次先把接口跑通。",
        );
        assert!(facts.is_empty());
    }

    #[test]
    fn extract_learnings_only_takes_decision_from_provider_response() {
        let facts = extract_learnings(
            "以后统一使用 cargo test。提交前先检查 diff 再继续。当前项目以 Cargo.toml 为准。",
            "当前项目以 Cargo.toml 为准。以后回复保持简洁。提交前先检查 diff 再继续。",
        );

        assert!(facts
            .iter()
            .any(|fact| fact.kind == LearnedKind::Preference));
        assert!(facts.iter().any(|fact| fact.kind == LearnedKind::Workflow));
        assert!(facts.iter().any(|fact| fact.kind == LearnedKind::Decision));
        assert_eq!(
            facts
                .iter()
                .filter(|fact| fact.kind == LearnedKind::Preference)
                .count(),
            1
        );
        assert_eq!(
            facts
                .iter()
                .filter(|fact| fact.kind == LearnedKind::Workflow)
                .count(),
            1
        );
        assert_eq!(
            facts
                .iter()
                .filter(|fact| fact.kind == LearnedKind::Decision)
                .count(),
            1
        );
    }
}
