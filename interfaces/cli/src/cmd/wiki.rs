use std::path::{Path, PathBuf};

use anyhow::Result;
use sacode_runtime::{inspect_wiki, WikiSourceStatus};

pub fn run(args: Vec<String>) -> Result<()> {
    let workdir = PathBuf::from(".");
    println!("{}", render_wiki(&workdir, &args)?);
    Ok(())
}

pub fn render_wiki(workdir: &Path, _args: &[String]) -> Result<String> {
    let status = inspect_wiki(workdir)?;
    let mut lines = vec!["Wiki Status".to_string(), format!("工作目录: {}", workdir.display()), String::new()];

    lines.push("用户级知识源:".to_string());
    lines.extend(status.user_sources.iter().map(render_source_status));
    lines.push(String::new());

    lines.push("项目级知识源:".to_string());
    lines.extend(status.project_sources.iter().map(render_source_status));
    lines.push(String::new());

    lines.push("会话级知识源:".to_string());
    lines.extend(status.session_sources.iter().map(render_source_status));
    lines.push(String::new());

    lines.push("加载结果:".to_string());
    lines.push(format!(
        "- 用户级知识: {}",
        summarize_loaded(status.context.user_summary.as_deref())
    ));
    lines.push(format!(
        "- 项目级知识: {}",
        summarize_loaded(status.context.project_summary.as_deref())
    ));
    lines.push(format!(
        "- 会话级知识: {}",
        summarize_loaded(status.context.session_summary.as_deref())
    ));
    lines.push("- 自动学习回写: 任务完成后会把高置信度偏好、流程和决策写入项目级 wiki 分类文件。".to_string());

    if let Some(user_summary) = status.context.user_summary.as_deref() {
        lines.push(String::new());
        lines.push("--- User Knowledge Preview ---".to_string());
        lines.push(user_summary.to_string());
    }
    if let Some(project_summary) = status.context.project_summary.as_deref() {
        lines.push(String::new());
        lines.push("--- Project Knowledge Preview ---".to_string());
        lines.push(project_summary.to_string());
    }
    if let Some(session_summary) = status.context.session_summary.as_deref() {
        lines.push(String::new());
        lines.push("--- Session Knowledge Preview ---".to_string());
        lines.push(session_summary.to_string());
    }

    Ok(lines.join("\n"))
}

fn render_source_status(source: &WikiSourceStatus) -> String {
    format!(
        "- {}: {} | {} | {}",
        source.label,
        if source.exists { "已加载" } else { "缺失" },
        source.path,
        source.detail
    )
}

fn summarize_loaded(content: Option<&str>) -> String {
    match content {
        Some(text) if !text.trim().is_empty() => format!("已加载，{} 字符", text.chars().count()),
        _ => "未加载".to_string(),
    }
}
