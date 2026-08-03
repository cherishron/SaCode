use anyhow::Result;
use serde_json::Value;
use std::{
    cmp::Reverse,
    env, fs,
    path::{Path, PathBuf},
};

use crate::{load_memory_index, rebuild_memory_index, MemoryScope};

const USER_SACODE_DIR: &str = ".sacode";
const PROJECT_WIKI_DIR: &str = ".sacode/wiki";
const USER_WIKI_DIR: &str = "wiki";
const PROJECT_PROFILE_FILE: &str = ".sacode/profile.json";
const PROJECT_CONFIG_FILE: &str = ".sacode/project.json";
const PROJECT_MISTAKES_FILE: &str = ".sacode/mistakes.json";
const PROJECT_SESSIONS_DIR: &str = ".sacode/sessions";
const MAX_SECTION_LEN: usize = 1600;
const MAX_FILE_SNIPPET_LEN: usize = 600;
const MAX_WIKI_FILES_PER_SCOPE: usize = 5;
const MAX_SESSION_SUMMARIES: usize = 2;
const MEMORY_WIKI_FILES: &[(&str, &str)] = &[
    ("memory.md", "通用记忆"),
    ("preferences.md", "偏好记忆"),
    ("workflows.md", "工作流记忆"),
    ("decisions.md", "决策记忆"),
];

#[derive(Debug, Clone, Default)]
pub struct WikiContext {
    pub user_summary: Option<String>,
    pub project_summary: Option<String>,
    pub session_summary: Option<String>,
}

#[derive(Debug, Clone)]
pub struct WikiSourceStatus {
    pub label: String,
    pub path: String,
    pub exists: bool,
    pub detail: String,
}

#[derive(Debug, Clone, Default)]
pub struct WikiStatus {
    pub user_sources: Vec<WikiSourceStatus>,
    pub project_sources: Vec<WikiSourceStatus>,
    pub session_sources: Vec<WikiSourceStatus>,
    pub context: WikiContext,
}

pub fn load_wiki_context(workdir: &Path) -> Result<WikiContext> {
    Ok(WikiContext {
        user_summary: build_user_summary(workdir)?,
        project_summary: build_project_summary(workdir)?,
        session_summary: build_session_summary(workdir)?,
    })
}

pub fn inspect_wiki(workdir: &Path) -> Result<WikiStatus> {
    let user_root = user_sacode_dir();
    let user_wiki_dir = user_root.join(USER_WIKI_DIR);
    let project_wiki_dir = workdir.join(PROJECT_WIKI_DIR);
    let sessions_dir = workdir.join(PROJECT_SESSIONS_DIR);

    Ok(WikiStatus {
        user_sources: vec![
            file_status("用户级 profile", &user_root.join("profile.json"))?,
            dir_status("用户级 wiki", &user_wiki_dir)?,
            file_status("用户级 memory", &user_wiki_dir.join("memory.md"))?,
            file_status("用户级 preferences", &user_wiki_dir.join("preferences.md"))?,
            file_status("用户级 workflows", &user_wiki_dir.join("workflows.md"))?,
            file_status("用户级 decisions", &user_wiki_dir.join("decisions.md"))?,
        ],
        project_sources: vec![
            file_status("项目级 profile", &workdir.join(PROJECT_PROFILE_FILE))?,
            file_status("项目级 project", &workdir.join(PROJECT_CONFIG_FILE))?,
            file_status("项目级 mistakes", &workdir.join(PROJECT_MISTAKES_FILE))?,
            dir_status("项目级 wiki", &project_wiki_dir)?,
            file_status("项目级 memory", &project_wiki_dir.join("memory.md"))?,
            file_status(
                "项目级 preferences",
                &project_wiki_dir.join("preferences.md"),
            )?,
            file_status("项目级 workflows", &project_wiki_dir.join("workflows.md"))?,
            file_status("项目级 decisions", &project_wiki_dir.join("decisions.md"))?,
        ],
        session_sources: vec![dir_status("项目级 sessions", &sessions_dir)?],
        context: load_wiki_context(workdir)?,
    })
}

fn build_user_summary(_workdir: &Path) -> Result<Option<String>> {
    let user_root = user_sacode_dir();
    let mut sections = Vec::new();

    if let Some(profile_summary) =
        summarize_json_file(&user_root.join("profile.json"), "用户级 profile")?
    {
        sections.push(profile_summary);
    }
    if let Some(wiki_summary) =
        summarize_markdown_dir(&user_root.join(USER_WIKI_DIR), "用户级 wiki")?
    {
        sections.push(wiki_summary);
    }

    Ok(join_sections(sections, MAX_SECTION_LEN))
}

fn build_project_summary(workdir: &Path) -> Result<Option<String>> {
    let mut sections = Vec::new();

    if let Some(profile_summary) =
        summarize_json_file(&workdir.join(PROJECT_PROFILE_FILE), "项目级 profile")?
    {
        sections.push(profile_summary);
    }
    if let Some(project_summary) =
        summarize_json_file(&workdir.join(PROJECT_CONFIG_FILE), "项目级 project")?
    {
        sections.push(project_summary);
    }
    if let Some(mistakes_summary) = summarize_mistakes_file(&workdir.join(PROJECT_MISTAKES_FILE))? {
        sections.push(mistakes_summary);
    }
    if let Some(wiki_summary) =
        summarize_markdown_dir(&workdir.join(PROJECT_WIKI_DIR), "项目级 wiki")?
    {
        sections.push(wiki_summary);
    }

    Ok(join_sections(sections, MAX_SECTION_LEN))
}

fn build_session_summary(workdir: &Path) -> Result<Option<String>> {
    let sessions_dir = workdir.join(PROJECT_SESSIONS_DIR);
    if !sessions_dir.exists() {
        return Ok(None);
    }

    let mut session_files = fs::read_dir(&sessions_dir)?
        .filter_map(|entry| entry.ok())
        .map(|entry| entry.path())
        .filter(|path| path.extension().and_then(|value| value.to_str()) == Some("json"))
        .collect::<Vec<_>>();

    session_files.sort_by_key(|path| Reverse(file_modified_key(path)));

    let mut sections = Vec::new();
    for path in session_files.into_iter().take(MAX_SESSION_SUMMARIES) {
        let Some(name) = path.file_name().and_then(|value| value.to_str()) else {
            continue;
        };
        let content = fs::read_to_string(&path)?;
        let value: Value = serde_json::from_str(&content).unwrap_or(Value::Null);
        let summary = value
            .get("compressed_summary")
            .and_then(Value::as_str)
            .or_else(|| value.get("summary").and_then(Value::as_str))
            .map(|text| truncate_text(text.trim(), MAX_FILE_SNIPPET_LEN));
        if let Some(summary) = summary.filter(|text| !text.trim().is_empty()) {
            sections.push(format!("- {}: {}", name, summary));
        }
    }

    if sections.is_empty() {
        Ok(None)
    } else {
        Ok(Some(format!("最近会话摘要\n{}", sections.join("\n"))))
    }
}

fn summarize_markdown_dir(path: &Path, label: &str) -> Result<Option<String>> {
    if !path.exists() || !path.is_dir() {
        return Ok(None);
    }

    let mut sections = Vec::new();
    let scope = infer_scope(path);
    let index = load_memory_index(path)
        .ok()
        .filter(|index| !index.entries.is_empty())
        .or_else(|| rebuild_memory_index(path, scope).ok());

    if let Some(index) = index.as_ref() {
        for (name, section_label) in MEMORY_WIKI_FILES {
            let file_matches = index
                .entries
                .iter()
                .filter(|entry| entry.file_name == *name)
                .map(|entry| format!("- [{}] {}", entry.kind.scope_label(), entry.content))
                .take(3)
                .collect::<Vec<_>>();
            if file_matches.is_empty() {
                continue;
            }
            sections.push(format!(
                "### {} ({})\n{}",
                name,
                section_label,
                truncate_text(&file_matches.join("\n"), MAX_FILE_SNIPPET_LEN)
            ));
        }
    } else {
        for (name, section_label) in MEMORY_WIKI_FILES {
            let file = path.join(name);
            if !file.exists() {
                continue;
            }
            let content = fs::read_to_string(&file)?;
            let snippet = truncate_text(content.trim(), MAX_FILE_SNIPPET_LEN);
            if snippet.trim().is_empty() {
                continue;
            }
            sections.push(format!("### {} ({})\n{}", name, section_label, snippet));
        }
    }

    if sections.len() < MAX_WIKI_FILES_PER_SCOPE {
        let mut files = fs::read_dir(path)?
            .filter_map(|entry| entry.ok())
            .map(|entry| entry.path())
            .filter(|entry_path| {
                entry_path.extension().and_then(|value| value.to_str()) == Some("md")
            })
            .filter(|entry_path| {
                entry_path
                    .file_name()
                    .and_then(|value| value.to_str())
                    .map(|name| {
                        !MEMORY_WIKI_FILES
                            .iter()
                            .any(|(expected, _)| expected == &name)
                    })
                    .unwrap_or(true)
            })
            .collect::<Vec<_>>();
        files.sort();

        for file in files
            .into_iter()
            .take(MAX_WIKI_FILES_PER_SCOPE.saturating_sub(sections.len()))
        {
            let content = fs::read_to_string(&file)?;
            let snippet = truncate_text(content.trim(), MAX_FILE_SNIPPET_LEN);
            if snippet.trim().is_empty() {
                continue;
            }
            let name = file
                .file_name()
                .and_then(|value| value.to_str())
                .unwrap_or("unknown.md");
            sections.push(format!("### {}\n{}", name, snippet));
        }
    }

    if sections.is_empty() {
        Ok(None)
    } else {
        Ok(Some(format!("{}\n{}", label, sections.join("\n\n"))))
    }
}

fn infer_scope(path: &Path) -> MemoryScope {
    if path.to_string_lossy().contains("/.sacode/wiki") || path.ends_with(".sacode/wiki") {
        MemoryScope::Project
    } else {
        MemoryScope::User
    }
}

fn summarize_json_file(path: &Path, label: &str) -> Result<Option<String>> {
    if !path.exists() {
        return Ok(None);
    }
    let content = fs::read_to_string(path)?;
    let snippet = truncate_text(content.trim(), MAX_FILE_SNIPPET_LEN);
    if snippet.trim().is_empty() {
        Ok(None)
    } else {
        Ok(Some(format!("{}\n{}", label, snippet)))
    }
}

fn summarize_mistakes_file(path: &Path) -> Result<Option<String>> {
    if !path.exists() {
        return Ok(None);
    }
    let content = fs::read_to_string(path)?;
    let value: Value = serde_json::from_str(&content).unwrap_or(Value::Null);
    let entries = value
        .get("entries")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    if entries.is_empty() {
        return Ok(None);
    }

    let mut lines = vec![format!("项目级 mistakes\n共 {} 条", entries.len())];
    for entry in entries.iter().rev().take(3) {
        let summary = entry
            .get("summary")
            .and_then(Value::as_str)
            .unwrap_or("未命名错误");
        let scope = entry
            .get("scope")
            .and_then(Value::as_str)
            .unwrap_or("unknown");
        lines.push(format!("- [{}] {}", scope, summary));
    }
    Ok(Some(lines.join("\n")))
}

fn join_sections(sections: Vec<String>, limit: usize) -> Option<String> {
    let joined = sections
        .into_iter()
        .filter(|section| !section.trim().is_empty())
        .collect::<Vec<_>>()
        .join("\n\n");
    if joined.trim().is_empty() {
        None
    } else {
        Some(truncate_text(&joined, limit))
    }
}

fn truncate_text(content: &str, limit: usize) -> String {
    let mut chars = content.chars();
    let truncated: String = chars.by_ref().take(limit).collect();
    if chars.next().is_some() {
        format!("{}\n\n[truncated]", truncated)
    } else {
        truncated
    }
}

fn file_modified_key(path: &Path) -> u128 {
    fs::metadata(path)
        .and_then(|meta| meta.modified())
        .ok()
        .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|duration| duration.as_millis())
        .unwrap_or(0)
}

fn file_status(label: &str, path: &Path) -> Result<WikiSourceStatus> {
    let exists = path.exists();
    let detail = if exists {
        let bytes = fs::metadata(path).map(|meta| meta.len()).unwrap_or(0);
        format!("存在，{} bytes", bytes)
    } else {
        "缺失".to_string()
    };
    Ok(WikiSourceStatus {
        label: label.to_string(),
        path: path.display().to_string(),
        exists,
        detail,
    })
}

fn dir_status(label: &str, path: &Path) -> Result<WikiSourceStatus> {
    let exists = path.exists() && path.is_dir();
    let detail = if exists {
        let count = fs::read_dir(path)?.filter_map(|entry| entry.ok()).count();
        format!("存在，{} 个条目", count)
    } else {
        "缺失".to_string()
    };
    Ok(WikiSourceStatus {
        label: label.to_string(),
        path: path.display().to_string(),
        exists,
        detail,
    })
}

fn user_sacode_dir() -> PathBuf {
    // Windows 上 USERPROFILE 为用户主目录，Unix 上 HOME 为标准；二者均无时退化为当前目录。
    env::var_os("USERPROFILE")
        .or_else(|| env::var_os("HOME"))
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("."))
        .join(USER_SACODE_DIR)
}
