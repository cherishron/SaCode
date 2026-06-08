use anyhow::Result;
use sacode_kernel::ExecutionMode;
use std::{fs, path::Path};

use crate::wiki::load_wiki_context;

const PROJECT_PROMPT_FILE: &str = ".sacode/prompt.md";
const AGENTS_FILE: &str = "AGENTS.md";
const MAX_EXTERNAL_SECTION_LEN: usize = 4000;
const USER_SKILLS_DIR_HINT: &str = "~/.sacode/skills/";
const AGENTS_HEADINGS: &[&str] = &[
    "## Workspace 边界",
    "## 真实入口",
    "## 开发命令",
    "## CI 对齐",
    "## 发布与版本",
    "## Init 相关",
    "## 改动时容易猜错的点",
];

pub struct PromptContext<'a> {
    pub workdir: &'a Path,
    pub mode: ExecutionMode,
    pub tool_names: &'a [String],
}

pub fn build_system_prompt(ctx: &PromptContext<'_>) -> Result<String> {
    let mut sections = vec![
        "[Platform Rules]\n你是 SaCode AI 编程助手。优先理解现有代码与项目约束，再做最小正确修改。使用工具获取事实，避免猜测。任务超出能力范围时如实说明。".to_string(),
        format!(
            "[Execution Mode]\n{}",
            mode_instruction(ctx.mode)
        ),
        format!(
            "[Available Tools]\n当前可用工具: {}\n工具使用原则: 搜索文件优先用 Glob，搜索内容优先用 Grep，读文件优先用 Read，修改文件优先用 apply_patch，并在可并行时并行查询。",
            join_or_fallback(ctx.tool_names, "无")
        ),
        format!(
            "[Skill Usage]\nSaCode 用户级 skill 目录: {}\n当任务适合复用 skill 时，优先查看该目录下已有 skill。skill 调用格式使用 `/skill-name 参数`。安装或生成新 skill 时，默认写入这个目录，避免写入 SkillHub 下载缓存或临时目录。",
            USER_SKILLS_DIR_HINT
        ),
    ];

    if let Some(agents) = load_agents_summary(ctx.workdir)? {
        sections.push(format!("[Repository Rules]\n{}", agents));
    }

    if let Some(project_prompt) = load_project_prompt(ctx.workdir)? {
        sections.push(format!("[Project Prompt]\n{}", project_prompt));
    }

    let wiki = load_wiki_context(ctx.workdir)?;
    if let Some(user_summary) = wiki.user_summary {
        sections.push(format!("[User Knowledge]\n{}", user_summary));
    }
    if let Some(project_summary) = wiki.project_summary {
        sections.push(format!("[Project Knowledge]\n{}", project_summary));
    }
    if let Some(session_summary) = wiki.session_summary {
        sections.push(format!("[Session Knowledge]\n{}", session_summary));
    }

    Ok(sections.join("\n\n"))
}

pub fn maybe_expand_skill_prompt(prompt: &str, workdir: &Path) -> Result<String> {
    let trimmed = prompt.trim();
    let Some(skill_call) = trimmed.strip_prefix('/') else {
        return Ok(prompt.to_string());
    };
    let mut parts = skill_call.split_whitespace();
    let Some(skill_name) = parts.next() else {
        return Ok(prompt.to_string());
    };
    let args = parts.collect::<Vec<_>>().join(" ");
    let registry = crate::SkillRegistry::new(workdir);
    match registry.render_prompt(skill_name, &args, workdir) {
        Ok(rendered) => Ok(rendered),
        Err(_) => Ok(prompt.to_string()),
    }
}

fn mode_instruction(mode: ExecutionMode) -> &'static str {
    match mode {
        ExecutionMode::Plan => {
            "当前是 plan 模式。只规划不执行，只使用只读工具了解项目状态并产出方案。"
        }
        ExecutionMode::Build => {
            "当前是 build 模式。可以执行修改操作，但保持谨慎，优先最小改动并尊重现有实现。"
        }
        ExecutionMode::Yolo => {
            "当前是 yolo 模式。可以全自动推进任务，但依然要保持结果正确、步骤清晰和变更克制。"
        }
    }
}

fn load_agents_summary(workdir: &Path) -> Result<Option<String>> {
    let path = workdir.join(AGENTS_FILE);
    if !path.exists() {
        return Ok(None);
    }
    let content = fs::read_to_string(path)?;
    let extracted = extract_markdown_sections(&content, AGENTS_HEADINGS);
    let final_text = if extracted.trim().is_empty() {
        truncate_text(&content, MAX_EXTERNAL_SECTION_LEN)
    } else {
        truncate_text(&extracted, MAX_EXTERNAL_SECTION_LEN)
    };
    if final_text.trim().is_empty() {
        Ok(None)
    } else {
        Ok(Some(final_text))
    }
}

fn load_project_prompt(workdir: &Path) -> Result<Option<String>> {
    let path = workdir.join(PROJECT_PROMPT_FILE);
    if !path.exists() {
        return Ok(None);
    }
    let content = fs::read_to_string(path)?;
    let trimmed = truncate_text(content.trim(), MAX_EXTERNAL_SECTION_LEN);
    if trimmed.trim().is_empty() {
        Ok(None)
    } else {
        Ok(Some(trimmed))
    }
}

fn extract_markdown_sections(content: &str, headings: &[&str]) -> String {
    let lines: Vec<&str> = content.lines().collect();
    let mut sections = Vec::new();
    for heading in headings {
        if let Some(start) = lines.iter().position(|line| line.trim() == *heading) {
            let end = lines
                .iter()
                .enumerate()
                .skip(start + 1)
                .find(|(_, line)| line.starts_with("## "))
                .map(|(index, _)| index)
                .unwrap_or(lines.len());
            let chunk = lines[start..end].join("\n").trim().to_string();
            if !chunk.is_empty() {
                sections.push(chunk);
            }
        }
    }
    sections.join("\n\n")
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

fn join_or_fallback(values: &[String], fallback: &str) -> String {
    if values.is_empty() {
        fallback.to_string()
    } else {
        values.join(", ")
    }
}
