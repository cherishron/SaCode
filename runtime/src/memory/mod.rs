use std::{
    fs,
    path::{Path, PathBuf},
};

use anyhow::Result;
use chrono::Local;
use serde::{Deserialize, Serialize};

pub const PROJECT_WIKI_DIR: &str = ".sacode/wiki";
pub const MEMORY_INDEX_FILE: &str = "index.json";

const MEMORY_KINDS: [MemoryKind; 4] = [
    MemoryKind::General,
    MemoryKind::Preference,
    MemoryKind::Workflow,
    MemoryKind::Decision,
];

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum MemoryKind {
    General,
    Preference,
    Workflow,
    Decision,
}

impl MemoryKind {
    pub fn all() -> &'static [MemoryKind] {
        &MEMORY_KINDS
    }

    pub fn from_flag(value: &str) -> Option<Self> {
        match value {
            "memory" => Some(Self::General),
            "preference" | "preferences" => Some(Self::Preference),
            "workflow" | "workflows" => Some(Self::Workflow),
            "decision" | "decisions" => Some(Self::Decision),
            _ => None,
        }
    }

    pub fn file_name(self) -> &'static str {
        match self {
            Self::General => "memory.md",
            Self::Preference => "preferences.md",
            Self::Workflow => "workflows.md",
            Self::Decision => "decisions.md",
        }
    }

    pub fn scope_label(self) -> &'static str {
        match self {
            Self::General => "memory",
            Self::Preference => "preference",
            Self::Workflow => "workflow",
            Self::Decision => "decision",
        }
    }

    pub fn label(self) -> &'static str {
        match self {
            Self::General => "通用记忆",
            Self::Preference => "偏好记忆",
            Self::Workflow => "工作流记忆",
            Self::Decision => "决策记忆",
        }
    }

    pub fn title(self, user_level: bool) -> &'static str {
        match (self, user_level) {
            (Self::General, true) => "# 用户级通用记忆",
            (Self::General, false) => "# 项目级通用记忆",
            (Self::Preference, true) => "# 用户级偏好记忆",
            (Self::Preference, false) => "# 项目级偏好记忆",
            (Self::Workflow, true) => "# 用户级工作流记忆",
            (Self::Workflow, false) => "# 项目级工作流记忆",
            (Self::Decision, true) => "# 用户级决策记忆",
            (Self::Decision, false) => "# 项目级决策记忆",
        }
    }

    pub fn description(self, user_level: bool) -> &'static str {
        match (self, user_level) {
            (Self::General, true) => "本文件记录跨项目长期生效的通用经验和补充说明。",
            (Self::General, false) => "本文件记录当前项目内的通用经验和上下文补充。",
            (Self::Preference, true) => "本文件记录跨项目长期生效的用户偏好。",
            (Self::Preference, false) => "本文件记录当前项目内需要持续遵循的偏好。",
            (Self::Workflow, true) => "本文件记录跨项目长期生效的协作和执行流程。",
            (Self::Workflow, false) => "本文件记录当前项目内的工作流和协作约定。",
            (Self::Decision, true) => "本文件记录跨项目长期生效的稳定决策。",
            (Self::Decision, false) => "本文件记录当前项目内的重要决策和约束。",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum MemoryScope {
    User,
    Project,
}

impl MemoryScope {
    pub fn is_user(self) -> bool {
        matches!(self, Self::User)
    }

    pub fn display_name(self) -> &'static str {
        match self {
            Self::User => "用户级",
            Self::Project => "项目级",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum MemoryEntrySource {
    ManualAppend,
    AutoLearned,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum MemoryStatus {
    Active,
    Archived,
}

impl MemoryEntrySource {
    fn section_title(self) -> &'static str {
        match self {
            Self::ManualAppend => "[记忆条目]",
            Self::AutoLearned => "[自动学习条目]",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MemoryEntry {
    pub kind: MemoryKind,
    pub scope: MemoryScope,
    pub source: MemoryEntrySource,
    pub content: String,
    pub context: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MemoryIndexEntry {
    pub id: String,
    pub kind: MemoryKind,
    pub scope: MemoryScope,
    pub source: MemoryEntrySource,
    pub status: MemoryStatus,
    pub confidence: Option<f32>,
    pub content: String,
    pub context: String,
    pub file_name: String,
    pub created_at: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct MemoryIndex {
    pub entries: Vec<MemoryIndexEntry>,
}

pub fn memory_file_path(root: &Path, kind: MemoryKind) -> PathBuf {
    root.join(kind.file_name())
}

pub fn memory_index_path(root: &Path) -> PathBuf {
    root.join(MEMORY_INDEX_FILE)
}

pub fn ensure_memory_file(path: &Path, scope: MemoryScope, kind: MemoryKind) -> Result<()> {
    if path.exists() {
        return Ok(());
    }

    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }

    let body = format!(
        "{}\n\n{}\n\n## 条目\n",
        kind.title(scope.is_user()),
        kind.description(scope.is_user())
    );
    fs::write(path, body)?;
    Ok(())
}

pub fn append_memory_entry(path: &Path, current: &str, entry: &MemoryEntry) -> Result<bool> {
    let Some(root) = path.parent() else {
        anyhow::bail!("memory file missing parent directory");
    };
    let mut index = load_memory_index(root)?;
    if index.entries.iter().any(|existing| {
        existing.kind == entry.kind
            && existing.scope == entry.scope
            && existing.content.eq_ignore_ascii_case(&entry.content)
    }) {
        return Ok(false);
    }
    if current
        .to_lowercase()
        .contains(&entry.content.to_lowercase())
    {
        return Ok(false);
    }

    let mut updated = current.to_string();
    if !updated.ends_with('\n') {
        updated.push('\n');
    }
    if !updated.ends_with("\n\n") {
        updated.push('\n');
    }
    updated.push_str(&format!(
        "{}\n- Date: {}\n- Scope: {}\n- Kind: {}\n- Context: {}\n- Content:\n  - {}\n",
        entry.source.section_title(),
        Local::now().format("%Y-%m-%d"),
        entry.scope.display_name(),
        entry.kind.scope_label(),
        entry.context,
        entry.content.replace('\n', "\n  - ")
    ));
    fs::write(path, updated)?;

    let created_at = Local::now().format("%Y-%m-%d").to_string();
    index.entries.push(MemoryIndexEntry {
        id: build_entry_id(entry, &created_at),
        kind: entry.kind,
        scope: entry.scope,
        source: entry.source,
        status: MemoryStatus::Active,
        confidence: default_confidence(entry.source),
        content: entry.content.clone(),
        context: entry.context.clone(),
        file_name: entry.kind.file_name().to_string(),
        created_at,
    });
    save_memory_index(root, &index)?;
    Ok(true)
}

pub fn load_memory_index(root: &Path) -> Result<MemoryIndex> {
    let path = memory_index_path(root);
    if !path.exists() {
        return Ok(MemoryIndex::default());
    }
    let content = fs::read_to_string(path)?;
    Ok(serde_json::from_str(&content).unwrap_or_default())
}

pub fn save_memory_index(root: &Path, index: &MemoryIndex) -> Result<()> {
    let path = memory_index_path(root);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    fs::write(path, serde_json::to_string_pretty(index)?)?;
    Ok(())
}

pub fn rebuild_memory_index(root: &Path, scope: MemoryScope) -> Result<MemoryIndex> {
    let mut index = MemoryIndex::default();

    for kind in MemoryKind::all() {
        let path = memory_file_path(root, *kind);
        if !path.exists() {
            continue;
        }
        let content = fs::read_to_string(&path)?;
        for section in parse_memory_sections(&content) {
            if section.content.trim().is_empty() {
                continue;
            }
            if index.entries.iter().any(|entry| {
                entry.kind == *kind
                    && entry.scope == scope
                    && entry.content.eq_ignore_ascii_case(&section.content)
            }) {
                continue;
            }
            let entry = MemoryEntry {
                kind: *kind,
                scope,
                source: section.source,
                content: section.content.clone(),
                context: section.context.clone(),
            };
            index.entries.push(MemoryIndexEntry {
                id: build_entry_id(&entry, &section.date),
                kind: *kind,
                scope,
                source: section.source,
                status: MemoryStatus::Active,
                confidence: default_confidence(section.source),
                content: section.content,
                context: section.context,
                file_name: kind.file_name().to_string(),
                created_at: section.date,
            });
        }
    }

    save_memory_index(root, &index)?;
    Ok(index)
}

pub fn search_memory_index(index: &MemoryIndex, query: &str) -> Vec<MemoryIndexEntry> {
    let lowered = query.trim().to_lowercase();
    if lowered.is_empty() {
        return Vec::new();
    }

    index
        .entries
        .iter()
        .filter(|entry| {
            entry.status == MemoryStatus::Active
                && (entry.content.to_lowercase().contains(&lowered)
                    || entry.context.to_lowercase().contains(&lowered)
                    || entry.kind.scope_label().contains(&lowered)
                    || entry.file_name.to_lowercase().contains(&lowered))
        })
        .cloned()
        .collect()
}

pub fn list_memory_entries(index: &MemoryIndex) -> Vec<MemoryIndexEntry> {
    let mut entries = index.entries.clone();
    entries.sort_by(|a, b| {
        b.created_at
            .cmp(&a.created_at)
            .then_with(|| a.id.cmp(&b.id))
    });
    entries
}

pub fn archive_memory_entry(root: &Path, entry_id: &str) -> Result<bool> {
    let mut index = load_memory_index(root)?;
    let Some(entry) = index.entries.iter_mut().find(|entry| entry.id == entry_id) else {
        return Ok(false);
    };
    if entry.status == MemoryStatus::Archived {
        return Ok(false);
    }
    entry.status = MemoryStatus::Archived;
    save_memory_index(root, &index)?;
    Ok(true)
}

pub fn promote_memory_entry(project_root: &Path, user_root: &Path, entry_id: &str) -> Result<bool> {
    let mut project_index = load_memory_index(project_root)?;
    let Some(entry) = project_index
        .entries
        .iter()
        .find(|entry| entry.id == entry_id)
        .cloned()
    else {
        return Ok(false);
    };
    let mut user_index = load_memory_index(user_root)?;
    if user_index.entries.iter().any(|existing| {
        existing.kind == entry.kind
            && existing.scope == MemoryScope::User
            && existing.content.eq_ignore_ascii_case(&entry.content)
    }) {
        return Ok(false);
    }

    let mut promoted = entry.clone();
    promoted.scope = MemoryScope::User;
    promoted.id = build_promoted_entry_id(&entry);
    promoted.confidence = Some(promoted.confidence.unwrap_or(0.7).max(0.95));
    user_index.entries.push(promoted);
    save_memory_index(user_root, &user_index)?;

    if let Some(existing) = project_index
        .entries
        .iter_mut()
        .find(|existing| existing.id == entry_id)
    {
        existing.confidence = Some(existing.confidence.unwrap_or(0.7).max(0.95));
    }
    save_memory_index(project_root, &project_index)?;
    Ok(true)
}

fn build_entry_id(entry: &MemoryEntry, created_at: &str) -> String {
    let normalized = entry
        .content
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() {
                ch.to_ascii_lowercase()
            } else {
                '-'
            }
        })
        .collect::<String>();
    let slug = normalized
        .split('-')
        .filter(|part| !part.is_empty())
        .take(8)
        .collect::<Vec<_>>()
        .join("-");
    format!(
        "{}-{}-{}",
        entry.kind.scope_label(),
        created_at,
        if slug.is_empty() { "entry" } else { &slug }
    )
}

fn build_promoted_entry_id(entry: &MemoryIndexEntry) -> String {
    format!("user-{}", entry.id)
}

fn default_confidence(source: MemoryEntrySource) -> Option<f32> {
    match source {
        MemoryEntrySource::ManualAppend => Some(1.0),
        MemoryEntrySource::AutoLearned => Some(0.7),
    }
}

#[derive(Debug, Clone)]
struct ParsedMemorySection {
    source: MemoryEntrySource,
    date: String,
    context: String,
    content: String,
}

fn parse_memory_sections(content: &str) -> Vec<ParsedMemorySection> {
    let mut sections = Vec::new();
    let mut current_source = None;
    let mut current_date = String::new();
    let mut current_context = String::new();
    let mut current_content: Vec<String> = Vec::new();

    fn push_section(
        sections: &mut Vec<ParsedMemorySection>,
        source: &Option<MemoryEntrySource>,
        date: &str,
        context: &str,
        content: &[String],
    ) {
        let Some(source) = source else {
            return;
        };
        let text = content
            .iter()
            .map(|line| line.trim())
            .filter(|line| !line.is_empty())
            .collect::<Vec<_>>()
            .join("\n");
        if text.trim().is_empty() {
            return;
        }
        sections.push(ParsedMemorySection {
            source: *source,
            date: if date.trim().is_empty() {
                "unknown".to_string()
            } else {
                date.trim().to_string()
            },
            context: context.trim().to_string(),
            content: text,
        });
    }

    for line in content.lines() {
        let trimmed = line.trim();
        let new_source = match trimmed {
            "[记忆条目]" => Some(MemoryEntrySource::ManualAppend),
            "[自动学习条目]" => Some(MemoryEntrySource::AutoLearned),
            _ => None,
        };

        if let Some(source) = new_source {
            push_section(
                &mut sections,
                &current_source,
                &current_date,
                &current_context,
                &current_content,
            );
            current_source = Some(source);
            current_date.clear();
            current_context.clear();
            current_content.clear();
            continue;
        }

        if let Some(value) = trimmed.strip_prefix("- Date:") {
            current_date = value.trim().to_string();
            continue;
        }
        if let Some(value) = trimmed.strip_prefix("- Context:") {
            current_context = value.trim().to_string();
            continue;
        }
        if trimmed == "- Content:" {
            continue;
        }
        if trimmed.starts_with("- ") && current_source.is_some() {
            current_content.push(trimmed.trim_start_matches('-').trim().to_string());
        }
    }

    push_section(
        &mut sections,
        &current_source,
        &current_date,
        &current_context,
        &current_content,
    );
    sections
}
