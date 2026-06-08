use std::{
    fs,
    path::{Path, PathBuf},
};

use anyhow::Result;
use sacode_kernel::ExecutionMode;
use sacode_runtime::{
    build_runtime_system_prompt, inspect_wiki, maybe_expand_skill_prompt, PromptContext,
    ToolRegistry,
};

use crate::cmd::{insight, outstyle};

pub fn run(args: Vec<String>) -> Result<()> {
    let workdir = PathBuf::from(".");
    println!("{}", render_prompt(&workdir, &args)?);
    Ok(())
}

pub fn render_prompt(workdir: &Path, args: &[String]) -> Result<String> {
    match args.first().map(|value| value.as_str()) {
        None | Some("show") | Some("status") => render_prompt_show(workdir, args),
        Some("doctor") => render_prompt_doctor(workdir),
        Some("edit") => render_prompt_edit(workdir, &args[1..]),
        _ => Ok("用法: /prompt [show [task...]|doctor|edit project]".to_string()),
    }
}

fn render_prompt_show(workdir: &Path, args: &[String]) -> Result<String> {
    let task = if args.len() > 1 {
        args[1..].join(" ")
    } else {
        "示例任务：检查当前项目提示词链路".to_string()
    };

    let expanded_prompt = maybe_expand_skill_prompt(&task, workdir)?;
    let tools = ToolRegistry::builtin();
    let mut tool_names: Vec<String> = tools.names().iter().map(|name| name.to_string()).collect();
    tool_names.sort();

    let mut system_prompt = build_runtime_system_prompt(&PromptContext {
        workdir,
        mode: ExecutionMode::Build,
        tool_names: &tool_names,
    })?;

    if let Some(style_instruction) = outstyle::outstyle_instruction(workdir) {
        system_prompt.push_str("\n\n[User Style]\n");
        system_prompt.push_str(&style_instruction);
    }
    if let Some(insight_instruction) = insight::insight_instruction(workdir) {
        system_prompt.push_str("\n\n[User Insight]\n");
        system_prompt.push_str(&insight_instruction);
    }

    Ok(format!(
        "Prompt Show\n工作目录: {}\n任务输入: {}\n\n--- System Prompt ---\n{}\n\n--- User Prompt ---\n{}",
        workdir.display(),
        task,
        system_prompt,
        expanded_prompt,
    ))
}

fn render_prompt_doctor(workdir: &Path) -> Result<String> {
    let agents_path = workdir.join("AGENTS.md");
    let project_prompt_path = workdir.join(".sacode/prompt.md");
    let sample_task = "/review src/main.rs";
    let sample_expanded = maybe_expand_skill_prompt(sample_task, workdir)?;
    let style = outstyle::outstyle_instruction(workdir);
    let insight_data = insight::insight_instruction(workdir);
    let tools = ToolRegistry::builtin();
    let mut tool_names: Vec<String> = tools.names().iter().map(|name| name.to_string()).collect();
    tool_names.sort();
    let system_prompt = build_runtime_system_prompt(&PromptContext {
        workdir,
        mode: ExecutionMode::Build,
        tool_names: &tool_names,
    })?;

    let mut lines = vec!["Prompt Doctor".to_string()];
    lines.push(format!("工作目录: {}", workdir.display()));
    lines.push(String::new());
    lines.push("检查项:".to_string());
    lines.push(format!("- AGENTS.md: {}", file_status(&agents_path)));
    lines.push(format!(
        "- .sacode/prompt.md: {}",
        file_status(&project_prompt_path)
    ));
    lines.push(format!(
        "- 输出风格指令: {}",
        if style.is_some() {
            "已加载"
        } else {
            "未设置"
        }
    ));
    lines.push(format!(
        "- 洞察指令: {}",
        if insight_data.is_some() {
            "已加载"
        } else {
            "未生成"
        }
    ));
    let wiki = inspect_wiki(workdir)?;
    lines.push(format!(
        "- 用户级知识库: {}",
        if wiki.context.user_summary.is_some() {
            "已加载"
        } else {
            "未加载"
        }
    ));
    lines.push(format!(
        "- 项目级知识库: {}",
        if wiki.context.project_summary.is_some() {
            "已加载"
        } else {
            "未加载"
        }
    ));
    lines.push(format!(
        "- 会话级知识库: {}",
        if wiki.context.session_summary.is_some() {
            "已加载"
        } else {
            "未加载"
        }
    ));
    lines.push(format!(
        "- Skill 展开: {}",
        if sample_expanded != sample_task {
            "可用"
        } else {
            "未命中示例 skill"
        }
    ));
    lines.push(format!(
        "- 基础 Prompt 组装: {}",
        if system_prompt.trim().is_empty() {
            "失败"
        } else {
            "正常"
        }
    ));
    lines.push(String::new());
    lines.push("建议:".to_string());
    if !agents_path.exists() {
        lines.push("- 运行 /init 或维护 AGENTS.md，补充仓库级规则。".to_string());
    }
    if !project_prompt_path.exists() {
        lines.push("- 新建 .sacode/prompt.md，补充项目级提示词。".to_string());
    }
    if style.is_none() {
        lines.push("- 运行 /outstyle concise|explain|teach 设置用户级输出风格。".to_string());
    }
    if insight_data.is_none() {
        lines.push("- 运行 /insight 生成用户级洞察指令。".to_string());
    }
    if wiki.context.user_summary.is_none() && wiki.context.project_summary.is_none() {
        lines.push(
            "- 运行 /wiki 查看知识源状态，并在 ~/.sacode/wiki 或 .sacode/wiki 中补充长期知识。"
                .to_string(),
        );
    }
    if sample_expanded == sample_task {
        lines.push(
            "- 当前示例 skill 未命中，按需在 .sacode/skills 或用户级 skills 中补充模板。"
                .to_string(),
        );
    }
    if agents_path.exists() && project_prompt_path.exists() && style.is_some() {
        lines
            .push("- 提示词基础链路完整，可以直接查看 /prompt show 验证最终拼装结果。".to_string());
    }

    Ok(lines.join("\n"))
}

fn render_prompt_edit(workdir: &Path, args: &[String]) -> Result<String> {
    match args.first().map(|value| value.as_str()) {
        Some("project") => ensure_project_prompt_template(workdir),
        _ => Ok("用法: /prompt edit project".to_string()),
    }
}

fn ensure_project_prompt_template(workdir: &Path) -> Result<String> {
    let path = workdir.join(".sacode/prompt.md");
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    if !path.exists() {
        fs::write(&path, default_project_prompt_template())?;
        Ok(format!(
            "已初始化项目提示词文件:\n{}\n\n可继续使用 /prompt show 查看拼装结果。",
            path.display()
        ))
    } else {
        Ok(format!(
            "项目提示词文件已存在:\n{}\n\n可继续使用 /prompt show 查看拼装结果。",
            path.display()
        ))
    }
}

fn default_project_prompt_template() -> &'static str {
    "# Project Prompt Rules\n\n## Coding Rules\n- 修改 CLI 参数时同步更新帮助文案\n- 修改发布链路时同步检查 README 和 npm-package 文档\n\n## Testing Rules\n- 涉及发布链路的改动按 CI 顺序验证\n- 涉及 TUI 行为的改动优先补充交互说明\n\n## Output Rules\n- 回复使用中文\n- 引用代码时附带文件路径和行号\n"
}

fn file_status(path: &Path) -> String {
    if !path.exists() {
        return format!("缺失 | {}", path.display());
    }
    let size = fs::metadata(path).map(|meta| meta.len()).unwrap_or(0);
    format!("存在 | {} | {} bytes", path.display(), size)
}
