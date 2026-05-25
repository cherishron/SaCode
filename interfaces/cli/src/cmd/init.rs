use std::{env, fs, path::{Path, PathBuf}};

use anyhow::Result;
use sacode_kernel::model::{ChatMessage, ChatRequest};
use sacode_runtime::ProviderClient;
use serde::Serialize;

use crate::{mistakes::MistakeBookStore, project_profile::ProjectProfileStore, provider_runtime::{resolve_named_provider, resolve_provider}};

pub async fn run() -> Result<()> {
    let workdir = env::current_dir()?;
    let sacode_dir = workdir.join(".sacode");
    fs::create_dir_all(&sacode_dir)?;

    ProjectProfileStore::new(&workdir).ensure_exists()?;
    MistakeBookStore::new(&workdir).ensure_exists()?;

    let agents_content = generate_agents_md(&workdir).await;
    fs::write(workdir.join("AGENTS.md"), agents_content.content.as_bytes())?;
    write_init_metadata(&workdir, &agents_content.source)?;

    println!("SaCode Init complete");
    println!("Generated AGENTS.md");
    println!("Initialized .sacode/profile.json");
    println!("Initialized .sacode/mistakes.json");
    println!("Recorded init metadata in .sacode/project.json");
    Ok(())
}

#[derive(Debug)]
struct AgentsContent {
    content: String,
    source: String,
}

#[derive(Debug, Serialize)]
struct InitMetadata {
    initialized_at: String,
    generator: String,
    provider_name: Option<String>,
    model: String,
}

async fn generate_agents_md(workdir: &Path) -> AgentsContent {
    let provider = resolve_provider(workdir);
    let provider_name = resolve_named_provider(workdir).map(|named| named.name);
    let summary = summarize_project(workdir);
    let prompt = build_agents_prompt(&summary);
    let request = ChatRequest {
        model: provider.model.clone(),
        messages: vec![
            ChatMessage::system(
                "你要为当前代码仓库生成 AGENTS.md。输出纯 Markdown，不要使用代码块包裹整个文件。内容要直接、简洁、可执行。必须包含：项目概览、目录结构、常用命令、工作约定、修改边界、验证方式。"
            ),
            ChatMessage::user(prompt),
        ],
        tools: None,
        temperature: Some(0.2),
        top_p: None,
        max_tokens: None,
        stream: false,
        thinking: None,
        reasoning_effort: None,
    };

    let client = ProviderClient::new();
    match client.chat(&provider, request).await {
        Ok(response) => {
            let content = response
                .choices
                .first()
                .map(|choice| strip_code_fences(&choice.message.content.clone().unwrap_or_default()))
                .filter(|content| !content.trim().is_empty())
                .unwrap_or_else(|| fallback_agents_md(&summary));
            AgentsContent {
                content,
                source: format!("provider:{}", provider_name.unwrap_or_else(|| provider.model.clone())),
            }
        }
        Err(error) => {
            let _ = MistakeBookStore::new(workdir).append(
                "init:provider",
                "初始化时模型生成 AGENTS.md 失败",
                error.to_string(),
            );
            AgentsContent {
                content: fallback_agents_md(&summary),
                source: "fallback-template".to_string(),
            }
        }
    }
}

fn summarize_project(workdir: &Path) -> ProjectSummary {
    let root_entries = fs::read_dir(workdir)
        .ok()
        .into_iter()
        .flat_map(|entries| entries.filter_map(|entry| entry.ok()))
        .filter_map(|entry| entry.file_name().into_string().ok())
        .filter(|name| name != ".git" && name != "target")
        .take(20)
        .collect();

    ProjectSummary {
        workspace_name: workdir.file_name().and_then(|name| name.to_str()).unwrap_or("workspace").to_string(),
        root_entries,
        cargo_toml: read_if_exists(&workdir.join("Cargo.toml")),
        package_json: read_if_exists(&workdir.join("package.json")),
        readme: read_if_exists(&workdir.join("README.md")),
    }
}

#[derive(Debug)]
struct ProjectSummary {
    workspace_name: String,
    root_entries: Vec<String>,
    cargo_toml: Option<String>,
    package_json: Option<String>,
    readme: Option<String>,
}

fn build_agents_prompt(summary: &ProjectSummary) -> String {
    format!(
        "项目名：{}\n根目录条目：{}\n\nCargo.toml:\n{}\n\npackage.json:\n{}\n\nREADME.md:\n{}\n\n请基于这些信息直接输出当前项目可用的 AGENTS.md，要求聚焦开发协作、命令、目录职责、验证流程、避免误改边界。",
        summary.workspace_name,
        summary.root_entries.join(", "),
        summary.cargo_toml.as_deref().unwrap_or("<missing>"),
        summary.package_json.as_deref().unwrap_or("<missing>"),
        summary.readme.as_deref().unwrap_or("<missing>"),
    )
}

fn fallback_agents_md(summary: &ProjectSummary) -> String {
    let mut lines = vec![
        "# AGENTS.md".to_string(),
        "".to_string(),
        "## 项目概览".to_string(),
        format!("- 工作区：{}", summary.workspace_name),
        format!("- 根目录：{}", summary.root_entries.join(", ")),
        "".to_string(),
        "## 工作方式".to_string(),
        "- 优先阅读现有代码和文档，再做最小正确改动。".to_string(),
        "- 修改完成后执行相关构建和测试。".to_string(),
        "- 新增配置优先落到项目级 `.sacode/` 目录。".to_string(),
        "".to_string(),
        "## 验证建议".to_string(),
    ];

    if summary.cargo_toml.is_some() {
        lines.push("- `cargo test --workspace`".to_string());
        lines.push("- `cargo build --release`".to_string());
    }
    if summary.package_json.is_some() {
        lines.push("- `npm run build`".to_string());
        lines.push("- `npm test`".to_string());
    }
    if summary.cargo_toml.is_none() && summary.package_json.is_none() {
        lines.push("- 根据项目实际技术栈补充验证命令。".to_string());
    }

    lines.join("\n")
}

fn read_if_exists(path: &PathBuf) -> Option<String> {
    fs::read_to_string(path).ok().map(|content| truncate_text(&content, 4000))
}

fn truncate_text(content: &str, limit: usize) -> String {
    if content.len() <= limit {
        content.to_string()
    } else {
        content[..limit].to_string()
    }
}

fn strip_code_fences(content: &str) -> String {
    let trimmed = content.trim();
    if let Some(stripped) = trimmed.strip_prefix("```markdown") {
        return stripped.trim().trim_end_matches("```").trim().to_string();
    }
    if let Some(stripped) = trimmed.strip_prefix("```") {
        return stripped.trim().trim_end_matches("```").trim().to_string();
    }
    trimmed.to_string()
}

fn write_init_metadata(workdir: &Path, generator: &str) -> Result<()> {
    let provider = resolve_provider(workdir);
    let provider_name = resolve_named_provider(workdir).map(|named| named.name);
    let metadata = InitMetadata {
        initialized_at: current_timestamp(),
        generator: generator.to_string(),
        provider_name,
        model: provider.model,
    };
    fs::write(
        workdir.join(".sacode/project.json"),
        serde_json::to_string_pretty(&metadata)?,
    )?;
    Ok(())
}

fn current_timestamp() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};

    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs().to_string())
        .unwrap_or_else(|_| "0".to_string())
}
