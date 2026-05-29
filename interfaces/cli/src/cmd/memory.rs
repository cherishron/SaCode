use std::{env, fs, path::{Path, PathBuf}};

use anyhow::Result;

const PROJECT_WIKI_DIR: &str = ".sacode/wiki";
const USER_WIKI_DIR: &str = ".sacode/wiki";
const MEMORY_KINDS: [MemoryKind; 4] = [
    MemoryKind::Memory,
    MemoryKind::Preference,
    MemoryKind::Workflow,
    MemoryKind::Decision,
];

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum MemoryKind {
    Memory,
    Preference,
    Workflow,
    Decision,
}

impl MemoryKind {
    fn all() -> &'static [MemoryKind] {
        &MEMORY_KINDS
    }

    fn from_flag(value: &str) -> Option<Self> {
        match value {
            "memory" => Some(Self::Memory),
            "preference" | "preferences" => Some(Self::Preference),
            "workflow" | "workflows" => Some(Self::Workflow),
            "decision" | "decisions" => Some(Self::Decision),
            _ => None,
        }
    }

    fn file_name(self) -> &'static str {
        match self {
            Self::Memory => "memory.md",
            Self::Preference => "preferences.md",
            Self::Workflow => "workflows.md",
            Self::Decision => "decisions.md",
        }
    }

    fn label(self) -> &'static str {
        match self {
            Self::Memory => "通用记忆",
            Self::Preference => "偏好记忆",
            Self::Workflow => "工作流记忆",
            Self::Decision => "决策记忆",
        }
    }

    fn scope_label(self) -> &'static str {
        match self {
            Self::Memory => "memory",
            Self::Preference => "preference",
            Self::Workflow => "workflow",
            Self::Decision => "decision",
        }
    }

    fn title(self, user_level: bool) -> &'static str {
        match (self, user_level) {
            (Self::Memory, true) => "# 用户级通用记忆",
            (Self::Memory, false) => "# 项目级通用记忆",
            (Self::Preference, true) => "# 用户级偏好记忆",
            (Self::Preference, false) => "# 项目级偏好记忆",
            (Self::Workflow, true) => "# 用户级工作流记忆",
            (Self::Workflow, false) => "# 项目级工作流记忆",
            (Self::Decision, true) => "# 用户级决策记忆",
            (Self::Decision, false) => "# 项目级决策记忆",
        }
    }

    fn description(self, user_level: bool) -> &'static str {
        match (self, user_level) {
            (Self::Memory, true) => "本文件记录跨项目长期生效的通用经验和补充说明。",
            (Self::Memory, false) => "本文件记录当前项目内的通用经验和上下文补充。",
            (Self::Preference, true) => "本文件记录跨项目长期生效的用户偏好。",
            (Self::Preference, false) => "本文件记录当前项目内需要持续遵循的偏好。",
            (Self::Workflow, true) => "本文件记录跨项目长期生效的协作和执行流程。",
            (Self::Workflow, false) => "本文件记录当前项目内的工作流和协作约定。",
            (Self::Decision, true) => "本文件记录跨项目长期生效的稳定决策。",
            (Self::Decision, false) => "本文件记录当前项目内的重要决策和约束。",
        }
    }
}

#[derive(Debug, Clone)]
struct MemoryFile {
    kind: MemoryKind,
    path: PathBuf,
    content: String,
}

pub fn run(args: Vec<String>) -> Result<()> {
    let workdir = PathBuf::from(".");
    let output = render_memory(&workdir, &args)?;
    println!("{}", output);
    Ok(())
}

pub fn render_memory(workdir: &Path, args: &[String]) -> Result<String> {
    let user_files = load_memory_files(&user_wiki_dir(), true)?;
    let project_files = load_memory_files(&workdir.join(PROJECT_WIKI_DIR), false)?;

    match args.first().map(|value| value.as_str()) {
        Some("path") => render_paths(&user_files, &project_files),
        None | Some("show") => Ok(render_show(&user_files, &project_files)),
        Some("summary") => Ok(render_summary(&user_files, &project_files)),
        Some("search") => render_search(args, &user_files, &project_files),
        Some("append") => render_append(args, &user_files, &project_files),
        _ => Ok(usage_text()),
    }
}

fn render_paths(user_files: &[MemoryFile], project_files: &[MemoryFile]) -> Result<String> {
    let mut lines = vec!["Memory Paths".to_string(), String::new(), "用户级:".to_string()];
    lines.extend(user_files.iter().map(|file| format!("- {}: {}", file.kind.scope_label(), file.path.display())));
    lines.push(String::new());
    lines.push("项目级:".to_string());
    lines.extend(project_files.iter().map(|file| format!("- {}: {}", file.kind.scope_label(), file.path.display())));
    Ok(lines.join("\n"))
}

fn render_show(user_files: &[MemoryFile], project_files: &[MemoryFile]) -> String {
    let mut lines = vec!["# 生效记忆".to_string(), String::new(), "## 用户级".to_string()];
    for file in user_files {
        lines.push(String::new());
        lines.push(format!("### {}", file.kind.label()));
        lines.push(file.content.trim().to_string());
    }
    lines.push(String::new());
    lines.push("## 项目级".to_string());
    for file in project_files {
        lines.push(String::new());
        lines.push(format!("### {}", file.kind.label()));
        lines.push(file.content.trim().to_string());
    }
    lines.join("\n")
}

fn render_summary(user_files: &[MemoryFile], project_files: &[MemoryFile]) -> String {
    let user_count: usize = user_files.iter().map(|file| collect_sections(&file.content).len()).sum();
    let project_count: usize = project_files.iter().map(|file| collect_sections(&file.content).len()).sum();
    let mut lines = vec![format!(
        "记忆摘要\n用户级条目: {}\n项目级条目: {}\n总条目: {}",
        user_count,
        project_count,
        user_count + project_count
    )];

    lines.push("用户级: ".to_string());
    for file in user_files {
        lines.push(format!("- {}: {} 条", file.kind.scope_label(), collect_sections(&file.content).len()));
    }
    lines.push("项目级: ".to_string());
    for file in project_files {
        lines.push(format!("- {}: {} 条", file.kind.scope_label(), collect_sections(&file.content).len()));
    }

    lines.join("\n")
}

fn render_search(args: &[String], user_files: &[MemoryFile], project_files: &[MemoryFile]) -> Result<String> {
    let query = args.get(1..).unwrap_or(&[]).join(" ").trim().to_string();
    if query.is_empty() {
        return Ok("用法: /memory search <关键词>".to_string());
    }

    let mut matched = Vec::new();
    for file in user_files.iter().chain(project_files.iter()) {
        let rendered = search_memory(&file.content, &query);
        if !rendered.starts_with("未找到与") {
            matched.push(format!("[{}] {}\n{}", file.kind.scope_label(), file.path.display(), rendered));
        }
    }

    if matched.is_empty() {
        Ok(format!("未找到与 `{}` 相关的记忆。", query))
    } else {
        Ok(matched.join("\n\n"))
    }
}

fn render_append(args: &[String], user_files: &[MemoryFile], project_files: &[MemoryFile]) -> Result<String> {
    let global = args.iter().any(|arg| arg == "--global" || arg == "-g");
    let mut kind = MemoryKind::Memory;
    let mut parts = Vec::new();

    let mut iter = args.iter().skip(1);
    while let Some(arg) = iter.next() {
        match arg.as_str() {
            "--global" | "-g" => {}
            "--type" | "-t" => {
                let Some(value) = iter.next() else {
                    return Ok("用法: /memory append <内容> [--type memory|preference|workflow|decision] [--global|-g]".to_string());
                };
                let Some(parsed) = MemoryKind::from_flag(value) else {
                    return Ok("支持的类型: memory, preference, workflow, decision".to_string());
                };
                kind = parsed;
            }
            value => parts.push(value.to_string()),
        }
    }

    let entry = parts.join(" ").trim().to_string();
    if entry.is_empty() {
        return Ok("用法: /memory append <内容> [--type memory|preference|workflow|decision] [--global|-g]".to_string());
    }

    let target = if global { user_files } else { project_files }
        .iter()
        .find(|file| file.kind == kind)
        .ok_or_else(|| anyhow::anyhow!("记忆文件未初始化"))?;
    let appended = append_memory(&target.path, &target.content, &entry, global, kind)?;
    Ok(if appended {
        format!(
            "已追加{}{}到 {}",
            if global { "用户级" } else { "项目级" },
            kind.label(),
            target.path.display()
        )
    } else {
        "检测到重复内容，已跳过追加。".to_string()
    })
}

fn load_memory_files(root: &Path, user_level: bool) -> Result<Vec<MemoryFile>> {
    let mut files = Vec::new();
    for kind in MemoryKind::all() {
        let path = root.join(kind.file_name());
        ensure_memory_file(&path, user_level, *kind)?;
        let content = fs::read_to_string(&path)?;
        files.push(MemoryFile {
            kind: *kind,
            path,
            content,
        });
    }
    Ok(files)
}

fn user_wiki_dir() -> PathBuf {
    env::var_os("HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("."))
        .join(USER_WIKI_DIR)
}

fn ensure_memory_file(path: &Path, user_level: bool, kind: MemoryKind) -> Result<()> {
    if path.exists() {
        return Ok(());
    }

    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }

    let body = format!(
        "{}\n\n{}\n\n## 条目\n",
        kind.title(user_level),
        kind.description(user_level)
    );
    fs::write(path, body)?;
    Ok(())
}

fn append_memory(path: &Path, current: &str, entry: &str, user_level: bool, kind: MemoryKind) -> Result<bool> {
    if current.to_lowercase().contains(&entry.to_lowercase()) {
        return Ok(false);
    }

    let needs_newline = !current.ends_with('\n');
    let mut updated = current.to_string();
    if needs_newline {
        updated.push('\n');
    }
    if !updated.ends_with("\n\n") {
        updated.push('\n');
    }
    updated.push_str(&format!(
        "[记忆条目]\n- Date: {}\n- Scope: {}\n- Kind: {}\n- Context: 用户通过 /memory append 手动追加\n- Content:\n  - {}\n",
        chrono::Local::now().format("%Y-%m-%d"),
        if user_level { "用户级" } else { "项目级" },
        kind.scope_label(),
        entry.replace('\n', "\n  - ")
    ));
    fs::write(path, updated)?;
    Ok(true)
}

fn collect_sections(content: &str) -> Vec<String> {
    content
        .lines()
        .filter(|line| line.starts_with('[') && line.ends_with(']'))
        .map(|line| line.to_string())
        .collect::<Vec<_>>()
}

fn search_memory(content: &str, query: &str) -> String {
    let lowered_query = query.to_lowercase();
    let sections: Vec<&str> = content.split("\n[").collect();
    let mut matched = Vec::new();

    for (index, section) in sections.iter().enumerate() {
        let normalized = if index == 0 {
            (*section).to_string()
        } else {
            format!("[{}", section)
        };
        if normalized.to_lowercase().contains(&lowered_query) {
            matched.push(highlight_query(normalized.trim(), query));
        }
    }

    if matched.is_empty() {
        format!("未找到与 `{}` 相关的记忆。", query)
    } else {
        matched.join("\n\n")
    }
}

fn highlight_query(text: &str, query: &str) -> String {
    let lowered_text = text.to_lowercase();
    let lowered_query = query.to_lowercase();
    let mut start = 0;
    let mut output = String::new();

    while let Some(relative) = lowered_text[start..].find(&lowered_query) {
        let matched_start = start + relative;
        let matched_end = matched_start + lowered_query.len();
        output.push_str(&text[start..matched_start]);
        output.push_str("<<");
        output.push_str(&text[matched_start..matched_end]);
        output.push_str(">>");
        start = matched_end;
    }

    output.push_str(&text[start..]);
    output
}

fn usage_text() -> String {
    "/memory [show|summary|path|search <关键词>|append <内容> [--type memory|preference|workflow|decision] [--global|-g]]".to_string()
}
