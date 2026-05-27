use std::{env, fs, path::{Path, PathBuf}};

use anyhow::Result;

const PROJECT_MEMORY_PATH: &str = ".monkeycode/MEMORY.md";
const USER_MEMORY_PATH: &str = ".sacode/MEMORY.md";

pub fn run(args: Vec<String>) -> Result<()> {
    let workdir = PathBuf::from(".");
    let output = render_memory(&workdir, &args)?;
    println!("{}", output);
    Ok(())
}

pub fn render_memory(workdir: &Path, args: &[String]) -> Result<String> {
    let user_path = user_memory_path();
    let project_path = workdir.join(PROJECT_MEMORY_PATH);

    if args.first().map(|value| value.as_str()) == Some("path") {
        return Ok(format!(
            "用户级: {}\n项目级: {}",
            user_path.display(),
            project_path.display()
        ));
    }

    ensure_memory_file(&user_path, true)?;
    ensure_memory_file(&project_path, false)?;

    let user_content = fs::read_to_string(&user_path)?;
    let project_content = fs::read_to_string(&project_path)?;
    let merged_content = merge_memory(&user_content, &project_content);

    if args.is_empty() || args[0] == "show" {
        return Ok(merged_content);
    }

    if args[0] == "summary" {
        return Ok(summarize_memory(&user_content, &project_content));
    }

    if args[0] == "search" {
        let query = args.get(1..).unwrap_or(&[]).join(" ").trim().to_string();
        if query.is_empty() {
            return Ok("用法: /memory search <关键词>".to_string());
        }
        return Ok(search_memory(&merged_content, &query));
    }

    if args[0] == "append" {
        let global = args.iter().any(|arg| arg == "--global" || arg == "-g");
        let entry_parts = args.iter().skip(1).filter(|arg| arg.as_str() != "--global" && arg.as_str() != "-g").cloned().collect::<Vec<_>>();
        let entry = entry_parts.join(" ").trim().to_string();
        if entry.is_empty() {
            return Ok("用法: /memory append <内容> [--global|-g]".to_string());
        }
        let target_path = if global { &user_path } else { &project_path };
        let target_content = if global { &user_content } else { &project_content };
        let appended = append_memory(target_path, target_content, &entry, global)?;
        return Ok(if appended {
            format!(
                "已追加{}记忆到 {}",
                if global { "用户级" } else { "项目级" },
                target_path.display()
            )
        } else {
            "检测到重复内容，已跳过追加。".to_string()
        });
    }

    Ok("用法: /memory [show|search <关键词>|append <内容> [--global|-g]|path|summary]".to_string())
}

fn user_memory_path() -> PathBuf {
    env::var_os("HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("."))
        .join(USER_MEMORY_PATH)
}

fn ensure_memory_file(path: &Path, user_level: bool) -> Result<()> {
    if path.exists() {
        return Ok(());
    }

    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }

    let body = if user_level {
        "# 用户级记忆\n\n本文件记录跨项目长期生效的用户偏好、协作习惯和经验。\n\n## 条目\n"
    } else {
        "# 项目级记忆\n\n本文件记录当前项目内的协作约束、经验和上下文。\n\n## 条目\n"
    };
    fs::write(path, body)?;
    Ok(())
}

fn merge_memory(user_content: &str, project_content: &str) -> String {
    format!(
        "# 生效记忆\n\n## 用户级\n\n{}\n\n## 项目级\n\n{}",
        user_content.trim(),
        project_content.trim()
    )
}

fn append_memory(path: &Path, current: &str, entry: &str, user_level: bool) -> Result<bool> {
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
        "[手动追加记忆]\n- Date: {}\n- Context: 用户通过 /memory append 手动追加到{}记忆\n- Instructions:\n  - {}\n",
        chrono::Local::now().format("%Y-%m-%d"),
        if user_level { "用户级" } else { "项目级" },
        entry.replace('\n', "\n  - ")
    ));
    fs::write(path, updated)?;
    Ok(true)
}

fn summarize_memory(user_content: &str, project_content: &str) -> String {
    let user_sections = collect_sections(user_content);
    let project_sections = collect_sections(project_content);
    let mut lines = vec![format!(
        "记忆摘要\n用户级条目: {}\n项目级条目: {}\n总条目: {}",
        user_sections.len(),
        project_sections.len(),
        user_sections.len() + project_sections.len()
    )];

    if !user_sections.is_empty() {
        lines.push("用户级: ".to_string());
        lines.extend(user_sections.into_iter().map(|line| format!("- {}", line)));
    }
    if !project_sections.is_empty() {
        lines.push("项目级: ".to_string());
        lines.extend(project_sections.into_iter().map(|line| format!("- {}", line)));
    }

    lines.join("\n")
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
