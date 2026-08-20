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
            "memory" | "project" => Some(Self::General),
            "preference" | "preferences" => Some(Self::Preference),
            "workflow" | "workflows" | "experience" => Some(Self::Workflow),
            "decision" | "decisions" => Some(Self::Decision),
            _ => None,
        }
    }

    pub fn file_name(self) -> &'static str {
        match self {
            Self::General => "project.md",
            Self::Preference => "preferences.md",
            Self::Workflow => "experience.md",
            Self::Decision => "experience.md",
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
    Candidate,
    Active,
    Archived,
    Rejected,
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
    /// 最后访问时间（ISO 日期，用于衰减计算）
    #[serde(default)]
    pub last_accessed_at: Option<String>,
    /// 访问计数（用于衰减计算）
    #[serde(default)]
    pub access_count: u32,
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

/// 旧版（v1.0 之前）使用的文件名及其对应的新文件名与 MemoryKind。
///
/// | 旧文件名 | 新文件名 | MemoryKind |
/// |---|---|---|
/// | memory.md | project.md | General |
/// | workflows.md | experience.md | Workflow |
/// | decisions.md | experience.md | Decision |
const LEGACY_MEMORY_FILES: [(&str, MemoryKind); 3] = [
    ("memory.md", MemoryKind::General),
    ("workflows.md", MemoryKind::Workflow),
    ("decisions.md", MemoryKind::Decision),
];

/// 将旧版记忆文件自动迁移到新版命名。
///
/// 行为：
/// - 旧文件不存在 / 已备份 → 跳过。
/// - 新文件不存在 → 用对应 MemoryKind 的标题/描述初始化新文件，再将旧内容追加进去。
/// - 新文件已存在 → 将旧文件内容以 `---` 分隔追加到新文件末尾。
/// - 迁移后旧文件被重命名为 `<旧文件名>.bak`。
///
/// 幂等：同一个旧文件只会迁移一次（迁移后即被重命名为 .bak，再次调用会跳过）。
pub fn migrate_legacy_memory_files(root: &Path, scope: MemoryScope) -> Result<()> {
    // 确保父目录存在
    if let Some(parent) = root.parent() {
        fs::create_dir_all(parent)?;
    }
    for &(old_name, kind) in LEGACY_MEMORY_FILES.iter() {
        let old_path = root.join(old_name);
        if !old_path.exists() {
            continue;
        }
        let backup_path = root.join(format!("{}.bak", old_name));
        // 已存在 .bak → 已经迁移过，跳过
        if backup_path.exists() {
            continue;
        }
        let new_path = root.join(kind.file_name());
        let old_content = fs::read_to_string(&old_path)?;
        // 重命名旧文件为 .bak
        fs::rename(&old_path, &backup_path)?;

        let migrated_block = format!("---\n\n[从 {} 迁移]\n\n{}", old_name, old_content);

        if new_path.exists() {
            // 新文件已存在：追加旧内容
            let new_content = fs::read_to_string(&new_path)?;
            fs::write(&new_path, format!("{}\n\n{}", new_content, migrated_block))?;
        } else {
            // 新文件不存在：先按新命名初始化，再追加旧内容
            ensure_memory_file(&new_path, scope, kind)?;
            let new_content = fs::read_to_string(&new_path)?;
            fs::write(&new_path, format!("{}\n\n{}", new_content, migrated_block))?;
        }
    }
    Ok(())
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
    append_memory_entry_with_status(path, current, entry, MemoryStatus::Active)
}

pub fn append_candidate_memory_entry(
    path: &Path,
    current: &str,
    entry: &MemoryEntry,
) -> Result<bool> {
    append_memory_entry_with_status(path, current, entry, MemoryStatus::Candidate)
}

fn append_memory_entry_with_status(
    path: &Path,
    current: &str,
    entry: &MemoryEntry,
    status: MemoryStatus,
) -> Result<bool> {
    let Some(root) = path.parent() else {
        anyhow::bail!("memory file missing parent directory");
    };
    // 确保父目录存在（learner 等调用方可能尚未 ensure_memory_file）
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
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
        status,
        confidence: default_confidence(entry.source),
        content: entry.content.clone(),
        context: entry.context.clone(),
        file_name: entry.kind.file_name().to_string(),
        created_at: created_at.clone(),
        last_accessed_at: Some(created_at),
        access_count: 0,
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
                created_at: section.date.clone(),
                last_accessed_at: Some(section.date.clone()),
                access_count: 0,
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

    // 灵枢 · 学习型记忆（M3）：升级为 BM25 相关性排序
    // 复用 code/search.rs 的 BM25 参数（k1=1.5, b=0.75），对记忆条目打分后降序返回
    let query_terms: Vec<&str> = lowered.split_whitespace().collect();
    if query_terms.is_empty() {
        return Vec::new();
    }

    // 构建文档集合（仅 Active 状态）
    let docs: Vec<&MemoryIndexEntry> = index
        .entries
        .iter()
        .filter(|entry| entry.status == MemoryStatus::Active)
        .collect();
    let avg_dl = if docs.is_empty() {
        0.0
    } else {
        docs.iter()
            .map(|d| tokenize(&d.content).len() + tokenize(&d.context).len())
            .sum::<usize>() as f64
            / docs.len() as f64
    };
    let n_docs = docs.len() as f64;

    let mut scored: Vec<(f64, &MemoryIndexEntry)> = Vec::new();
    for doc in &docs {
        let doc_text = format!("{} {}", doc.content, doc.context).to_lowercase();
        let doc_tokens = tokenize(&doc_text);
        let doc_len = doc_tokens.len().max(1);
        let mut score = 0.0f64;
        for term in &query_terms {
            let tf = doc_tokens.iter().filter(|t| *t == term).count() as f64;
            if tf == 0.0 {
                continue;
            }
            // 文档频率：包含该 term 的文档数
            let df = docs
                .iter()
                .filter(|d| {
                    let text = format!("{} {}", d.content, d.context).to_lowercase();
                    tokenize(&text).iter().any(|t| t == term)
                })
                .count() as f64;
            // BM25 idf（Lucene 变体：+1 在 ln 内部，避免 df==n_docs 时 idf 变负）
            let idf = (1.0 + (n_docs - df + 0.5) / (df + 0.5)).ln();
            let tf_norm = (tf * (BM25_K1 + 1.0))
                / (tf + BM25_K1 * (1.0 - BM25_B + BM25_B * doc_len as f64 / avg_dl.max(1.0)));
            score += idf * tf_norm;
        }
        // 已有关键词子串匹配作为兜底（低权重）
        if score == 0.0
            && (doc.content.to_lowercase().contains(&lowered)
                || doc.context.to_lowercase().contains(&lowered)
                || doc.kind.scope_label().contains(&lowered)
                || doc.file_name.to_lowercase().contains(&lowered))
        {
            score = 0.01;
        }
        if score > 0.0 {
            scored.push((score, doc));
        }
    }

    scored.sort_by(|a, b| b.0.partial_cmp(&a.0).unwrap_or(std::cmp::Ordering::Equal));
    scored.into_iter().map(|(_, doc)| (*doc).clone()).collect()
}

/// 记录记忆条目访问（更新 last_accessed_at 和 access_count）
pub fn record_memory_access(root: &Path, entry_id: &str) -> Result<bool> {
    let mut index = load_memory_index(root)?;
    let Some(entry) = index.entries.iter_mut().find(|entry| entry.id == entry_id) else {
        return Ok(false);
    };
    entry.last_accessed_at = Some(Local::now().format("%Y-%m-%d").to_string());
    entry.access_count = entry.access_count.saturating_add(1);
    save_memory_index(root, &index)?;
    Ok(true)
}

/// 灵枢 · 学习型记忆（M3）：低频记忆自动衰减到 Archived
///
/// 基于 `created_at` + `access_count` 判断：超过 `max_age_days` 且访问次数低于
/// `min_access_count` 的 Active 条目衰减为 Archived，减少噪声记忆干扰。
pub fn decay_memory_entries(
    root: &Path,
    max_age_days: u32,
    min_access_count: u32,
) -> Result<usize> {
    let mut index = load_memory_index(root)?;
    let today = Local::now().format("%Y-%m-%d").to_string();
    let mut decayed = 0usize;

    for entry in index.entries.iter_mut() {
        if entry.status != MemoryStatus::Active {
            continue;
        }
        if entry.access_count >= min_access_count {
            continue;
        }
        if let Some(days) = days_between(&entry.created_at, &today) {
            if days > max_age_days as i64 {
                entry.status = MemoryStatus::Archived;
                decayed += 1;
            }
        }
    }

    if decayed > 0 {
        save_memory_index(root, &index)?;
    }
    Ok(decayed)
}

/// BM25 词频参数 k1
const BM25_K1: f64 = 1.5;
/// BM25 文档长度归一化参数 b
const BM25_B: f64 = 0.75;

/// 简单分词：按非字母数字边界切分并转小写
///
/// 注意：仅以 `!is_alphanumeric()` 作为分隔判定，保留 Unicode 字母；
/// 不可加入 `!is_ascii()` 否则 ASCII 空格/标点会被当作词内字符，导致无法分词。
fn tokenize(text: &str) -> Vec<String> {
    text.split(|ch: char| !ch.is_alphanumeric())
        .filter(|token| !token.is_empty())
        .map(|token| token.to_lowercase())
        .collect()
}

/// 计算两个 ISO 日期（YYYY-MM-DD）之间的天数差
fn days_between(start: &str, end: &str) -> Option<i64> {
    let start_date = chrono::NaiveDate::parse_from_str(start, "%Y-%m-%d").ok()?;
    let end_date = chrono::NaiveDate::parse_from_str(end, "%Y-%m-%d").ok()?;
    Some(end_date.signed_duration_since(start_date).num_days())
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

pub fn approve_memory_entry(root: &Path, entry_id: &str) -> Result<bool> {
    update_memory_entry_status(
        root,
        entry_id,
        MemoryStatus::Candidate,
        MemoryStatus::Active,
    )
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

pub fn reject_memory_entry(root: &Path, entry_id: &str) -> Result<bool> {
    update_memory_entry_status(
        root,
        entry_id,
        MemoryStatus::Candidate,
        MemoryStatus::Rejected,
    )
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

fn update_memory_entry_status(
    root: &Path,
    entry_id: &str,
    expected: MemoryStatus,
    target: MemoryStatus,
) -> Result<bool> {
    let mut index = load_memory_index(root)?;
    let Some(entry) = index.entries.iter_mut().find(|entry| entry.id == entry_id) else {
        return Ok(false);
    };
    if entry.status != expected {
        return Ok(false);
    }
    entry.status = target;
    save_memory_index(root, &index)?;
    Ok(true)
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

/// 灵枢 · 学习型记忆 — 自动学习回路（M3）
///
/// 从 session 事件自动提取 mistakes / preferences / code_patterns，
/// 沉淀为跨会话可复用的记忆。详见 `learner.rs`。
pub mod learner;

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn unique_suffix() -> String {
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_nanos().to_string())
            .unwrap_or_else(|_| "fallback".to_string())
    }

    fn make_entry(
        id: &str,
        kind: MemoryKind,
        content: &str,
        context: &str,
        status: MemoryStatus,
        created_at: &str,
        access_count: u32,
    ) -> MemoryIndexEntry {
        MemoryIndexEntry {
            id: id.to_string(),
            kind,
            scope: MemoryScope::Project,
            source: MemoryEntrySource::ManualAppend,
            status,
            confidence: Some(1.0),
            content: content.to_string(),
            context: context.to_string(),
            file_name: kind.file_name().to_string(),
            created_at: created_at.to_string(),
            last_accessed_at: Some(created_at.to_string()),
            access_count,
        }
    }

    #[test]
    fn bm25_ranks_relevant_entry_first() {
        let mut index = MemoryIndex::default();
        index.entries.push(make_entry(
            "gen-2026-01-01-a",
            MemoryKind::General,
            "rust error handling with Result and ?",
            "how to propagate errors",
            MemoryStatus::Active,
            "2026-01-01",
            1,
        ));
        index.entries.push(make_entry(
            "gen-2026-01-02-b",
            MemoryKind::General,
            "python list comprehension tricks",
            "functional style",
            MemoryStatus::Active,
            "2026-01-02",
            1,
        ));

        let results = search_memory_index(&index, "rust error handling Result");
        assert!(!results.is_empty(), "应返回至少一条匹配结果");
        assert_eq!(results[0].content, "rust error handling with Result and ?");
    }

    #[test]
    fn bm25_excludes_non_active_entries() {
        let mut index = MemoryIndex::default();
        index.entries.push(make_entry(
            "gen-2026-01-01-a",
            MemoryKind::General,
            "obsolete rust pattern",
            "old",
            MemoryStatus::Archived,
            "2026-01-01",
            0,
        ));
        index.entries.push(make_entry(
            "gen-2026-01-02-b",
            MemoryKind::General,
            "active rust pattern",
            "new",
            MemoryStatus::Active,
            "2026-01-02",
            1,
        ));

        let results = search_memory_index(&index, "rust pattern");
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].id, "gen-2026-01-02-b");
    }

    #[test]
    fn bm25_substring_fallback_matches_non_token() {
        let mut index = MemoryIndex::default();
        index.entries.push(make_entry(
            "gen-2026-01-01-a",
            MemoryKind::General,
            "特殊符号-连字符",
            "context",
            MemoryStatus::Active,
            "2026-01-01",
            1,
        ));
        let results = search_memory_index(&index, "连字符");
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].id, "gen-2026-01-01-a");
    }

    #[test]
    fn decay_moves_low_frequency_old_entries_to_archived() {
        let dir = std::env::temp_dir().join(format!("sacode_mem_decay_{}", unique_suffix()));
        fs::create_dir_all(&dir).unwrap();

        let mut index = MemoryIndex::default();
        index.entries.push(make_entry(
            "gen-2020-01-01-old",
            MemoryKind::General,
            "stale entry",
            "c",
            MemoryStatus::Active,
            "2020-01-01",
            0,
        ));
        index.entries.push(make_entry(
            "gen-2026-08-10-recent",
            MemoryKind::General,
            "fresh entry",
            "c",
            MemoryStatus::Active,
            "2026-08-10",
            0,
        ));
        save_memory_index(&dir, &index).unwrap();

        let decayed = decay_memory_entries(&dir, 30, 1).unwrap();
        assert_eq!(decayed, 1, "仅超过 30 天且访问<1 的陈旧条目应被衰减");

        let reloaded = load_memory_index(&dir).unwrap();
        let stale = reloaded
            .entries
            .iter()
            .find(|e| e.id == "gen-2020-01-01-old")
            .unwrap();
        assert_eq!(stale.status, MemoryStatus::Archived);
        let fresh = reloaded
            .entries
            .iter()
            .find(|e| e.id == "gen-2026-08-10-recent")
            .unwrap();
        assert_eq!(fresh.status, MemoryStatus::Active);

        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn record_access_updates_count_and_timestamp() {
        let dir = std::env::temp_dir().join(format!("sacode_mem_access_{}", unique_suffix()));
        fs::create_dir_all(&dir).unwrap();

        let mut index = MemoryIndex::default();
        index.entries.push(make_entry(
            "gen-2026-01-01-a",
            MemoryKind::General,
            "test entry",
            "c",
            MemoryStatus::Active,
            "2026-01-01",
            0,
        ));
        save_memory_index(&dir, &index).unwrap();

        let ok = record_memory_access(&dir, "gen-2026-01-01-a").unwrap();
        assert!(ok);
        let reloaded = load_memory_index(&dir).unwrap();
        let entry = reloaded
            .entries
            .iter()
            .find(|e| e.id == "gen-2026-01-01-a")
            .unwrap();
        assert_eq!(entry.access_count, 1);
        assert!(entry.last_accessed_at.is_some());

        let missing = record_memory_access(&dir, "does-not-exist").unwrap();
        assert!(!missing);

        fs::remove_dir_all(&dir).ok();
    }
}
