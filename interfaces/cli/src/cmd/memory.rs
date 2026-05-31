use std::{env, fs, path::{Path, PathBuf}};

use anyhow::Result;
use sacode_runtime::{append_memory_entry, archive_memory_entry, ensure_memory_file, list_memory_entries, load_memory_index, memory_file_path, promote_memory_entry, search_memory_index, MemoryEntry, MemoryEntrySource, MemoryIndexEntry, MemoryKind, MemoryScope, MemoryStatus, PROJECT_WIKI_DIR};

const USER_WIKI_DIR: &str = ".sacode/wiki";

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
    let user_files = load_memory_files(&user_wiki_dir(), MemoryScope::User)?;
    let project_files = load_memory_files(&workdir.join(PROJECT_WIKI_DIR), MemoryScope::Project)?;

    match args.first().map(|value| value.as_str()) {
        Some("list") => render_list(args, &user_files, &project_files),
        Some("path") => render_paths(&user_files, &project_files),
        None | Some("show") => Ok(render_show(&user_files, &project_files)),
        Some("summary") => Ok(render_summary(&user_files, &project_files)),
        Some("search") => render_search(args, &user_files, &project_files),
        Some("append") => render_append(args, &user_files, &project_files),
        Some("promote") => render_promote(args, &project_files),
        Some("archive") => render_archive(args, &user_files, &project_files),
        _ => Ok(usage_text()),
    }
}

fn render_list(args: &[String], _user_files: &[MemoryFile], project_files: &[MemoryFile]) -> Result<String> {
    let filters = parse_list_filters(args)?;
    let user_entries = filter_list_entries(
        list_memory_entries(&load_memory_index(&user_wiki_dir()).unwrap_or_default()),
        &filters,
    );
    let project_entries = filter_list_entries(
        list_memory_entries(&load_memory_index(&workdir_wiki_dir(project_files)).unwrap_or_default()),
        &filters,
    );
    let mut lines = vec!["记忆索引".to_string(), String::new(), "用户级:".to_string()];

    if user_entries.is_empty() {
        lines.push("- 无条目".to_string());
    } else {
        lines.extend(user_entries.iter().map(render_list_entry));
    }

    lines.push(String::new());
    lines.push("项目级:".to_string());
    if project_entries.is_empty() {
        lines.push("- 无条目".to_string());
    } else {
        lines.extend(project_entries.iter().map(render_list_entry));
    }

    Ok(lines.join("\n"))
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
    let user_index = load_memory_index(&user_wiki_dir()).unwrap_or_default();
    let project_index = load_memory_index(&workdir_wiki_dir(project_files)).unwrap_or_default();

    let user_matches = search_memory_index(&user_index, &query);
    let project_matches = search_memory_index(&project_index, &query);

    if !user_matches.is_empty() || !project_matches.is_empty() {
        matched.extend(user_matches.into_iter().map(|entry| render_index_match(&entry, &query)));
        matched.extend(project_matches.into_iter().map(|entry| render_index_match(&entry, &query)));
    } else {
        for file in user_files.iter().chain(project_files.iter()) {
            let rendered = search_memory(&file.content, &query);
            if !rendered.starts_with("未找到与") {
                matched.push(format!("[{}] {}\n{}", file.kind.scope_label(), file.path.display(), rendered));
            }
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
    let mut kind = MemoryKind::General;
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
    let appended = append_memory(
        &target.path,
        &target.content,
        MemoryEntry {
            kind,
            scope: if global { MemoryScope::User } else { MemoryScope::Project },
            source: MemoryEntrySource::ManualAppend,
            content: entry,
            context: "用户通过 /memory append 手动追加".to_string(),
        },
    )?;
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

fn render_promote(args: &[String], project_files: &[MemoryFile]) -> Result<String> {
    let Some(entry_id) = args.get(1).map(|value| value.trim()).filter(|value| !value.is_empty()) else {
        return Ok("用法: /memory promote <entry_id>".to_string());
    };
    let promoted = promote_memory_entry(&workdir_wiki_dir(project_files), &user_wiki_dir(), entry_id)?;
    Ok(if promoted {
        format!("已提升记忆条目到用户级: {}", entry_id)
    } else {
        format!("未找到可提升的记忆条目，或用户级中已存在相同内容: {}", entry_id)
    })
}

fn render_archive(args: &[String], _user_files: &[MemoryFile], project_files: &[MemoryFile]) -> Result<String> {
    let Some(entry_id) = args.get(1).map(|value| value.trim()).filter(|value| !value.is_empty()) else {
        return Ok("用法: /memory archive <entry_id>".to_string());
    };

    let user_root = user_wiki_dir();
    let project_root = workdir_wiki_dir(project_files);
    let archived = archive_memory_entry(&project_root, entry_id)? || archive_memory_entry(&user_root, entry_id)?;
    Ok(if archived {
        format!("已归档记忆条目: {}", entry_id)
    } else {
        format!("未找到可归档的记忆条目: {}", entry_id)
    })
}

#[derive(Debug, Clone, Copy, Default)]
struct ListFilters {
    kind: Option<MemoryKind>,
    scope: Option<MemoryScope>,
}

fn parse_list_filters(args: &[String]) -> Result<ListFilters> {
    let mut filters = ListFilters::default();
    let mut iter = args.iter().skip(1);

    while let Some(arg) = iter.next() {
        match arg.as_str() {
            "--type" | "-t" => {
                let Some(value) = iter.next() else {
                    anyhow::bail!("用法: /memory list [--type memory|preference|workflow|decision] [--scope user|project]");
                };
                let Some(kind) = MemoryKind::from_flag(value) else {
                    anyhow::bail!("支持的类型: memory, preference, workflow, decision");
                };
                filters.kind = Some(kind);
            }
            "--scope" | "-s" => {
                let Some(value) = iter.next() else {
                    anyhow::bail!("用法: /memory list [--type memory|preference|workflow|decision] [--scope user|project]");
                };
                filters.scope = Some(match value.as_str() {
                    "user" => MemoryScope::User,
                    "project" => MemoryScope::Project,
                    _ => anyhow::bail!("支持的范围: user, project"),
                });
            }
            value => anyhow::bail!("不支持的参数: {}", value),
        }
    }

    Ok(filters)
}

fn filter_list_entries(entries: Vec<MemoryIndexEntry>, filters: &ListFilters) -> Vec<MemoryIndexEntry> {
    entries
        .into_iter()
        .filter(|entry| filters.kind.is_none_or(|kind| entry.kind == kind))
        .filter(|entry| filters.scope.is_none_or(|scope| entry.scope == scope))
        .collect()
}

fn load_memory_files(root: &Path, scope: MemoryScope) -> Result<Vec<MemoryFile>> {
    let mut files = Vec::new();
    for kind in MemoryKind::all() {
        let path = memory_file_path(root, *kind);
        ensure_memory_file(&path, scope, *kind)?;
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

fn workdir_wiki_dir(project_files: &[MemoryFile]) -> PathBuf {
    project_files
        .first()
        .and_then(|file| file.path.parent().map(Path::to_path_buf))
        .unwrap_or_else(|| PathBuf::from(PROJECT_WIKI_DIR))
}

fn append_memory(path: &Path, current: &str, entry: MemoryEntry) -> Result<bool> {
    append_memory_entry(path, current, &entry)
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

fn render_index_match(entry: &MemoryIndexEntry, query: &str) -> String {
    format!(
        "[{}] {}\nKind: {}\nStatus: {}\nConfidence: {}\nContext: {}\nContent:\n{}",
        entry.scope.display_name(),
        entry.file_name,
        entry.kind.scope_label(),
        memory_status_label(entry.status),
        entry.confidence.map(|value| format!("{value:.2}")).unwrap_or_else(|| "n/a".to_string()),
        highlight_query(&entry.context, query),
        highlight_query(&entry.content, query)
    )
}

fn render_list_entry(entry: &MemoryIndexEntry) -> String {
    format!(
        "- {} [{}] {} | {} | confidence={} | {}",
        entry.id,
        entry.kind.scope_label(),
        memory_status_label(entry.status),
        entry.file_name,
        entry.confidence.map(|value| format!("{value:.2}")).unwrap_or_else(|| "n/a".to_string()),
        entry.content
    )
}

fn memory_status_label(status: MemoryStatus) -> &'static str {
    match status {
        MemoryStatus::Active => "active",
        MemoryStatus::Archived => "archived",
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
    "/memory [show|list [--type memory|preference|workflow|decision] [--scope user|project]|summary|path|search <关键词>|append <内容> [--type memory|preference|workflow|decision] [--global|-g]|promote <entry_id>|archive <entry_id>]".to_string()
}
