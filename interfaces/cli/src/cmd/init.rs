use std::{
    collections::BTreeMap,
    env, fs,
    path::{Path, PathBuf},
};

use anyhow::Result;
use sacode_kernel::model::{ChatMessage, ChatRequest};
use sacode_runtime::{McpConfig, ProviderClient};
use serde::Serialize;

use crate::{
    cmd::status,
    mistakes::MistakeBookStore,
    project_profile::ProjectProfileStore,
    provider_runtime::{resolve_named_provider, resolve_provider},
};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum InitMode {
    Basic,
    Deep,
}

pub async fn run(mode: InitMode) -> Result<()> {
    let workdir = env::current_dir()?;
    let summary = initialize_project(&workdir, mode).await?;
    print_summary(&summary);
    Ok(())
}

pub async fn initialize_project(workdir: &Path, mode: InitMode) -> Result<InitSummary> {
    let sacode_dir = workdir.join(".sacode");
    fs::create_dir_all(&sacode_dir)?;

    ensure_config_json(&sacode_dir)?;
    ProjectProfileStore::new(workdir).ensure_exists()?;
    MistakeBookStore::new(workdir).ensure_exists()?;

    let project = summarize_project(workdir);
    let agents_content = generate_agents_md(workdir, &project, mode).await;
    fs::write(workdir.join("AGENTS.md"), agents_content.content.as_bytes())?;

    if mode == InitMode::Deep {
        write_workflows_json(&sacode_dir, &project)?;
        write_mcp_template(&sacode_dir)?;
    }

    let _ = status::ensure_default_context7(workdir).await;

    write_init_metadata(workdir, &project, &agents_content.source, mode)?;

    let stacks = stack_summary(&project);
    let commands = detected_commands(&project);

    Ok(InitSummary {
        mode,
        project_name: project.workspace_name,
        stack_summary: stacks,
        detected_commands: commands,
        generated_agents: true,
        generated_workflows: mode == InitMode::Deep,
        generated_mcp_template: mode == InitMode::Deep,
    })
}

#[derive(Debug)]
pub struct InitSummary {
    pub mode: InitMode,
    pub project_name: String,
    pub stack_summary: Vec<String>,
    pub detected_commands: Vec<String>,
    pub generated_agents: bool,
    pub generated_workflows: bool,
    pub generated_mcp_template: bool,
}

#[derive(Debug)]
struct AgentsContent {
    content: String,
    source: String,
}

#[derive(Debug, Serialize)]
struct InitMetadata {
    initialized_at: String,
    mode: String,
    generator: String,
    provider_name: Option<String>,
    model: String,
    project_name: String,
    stacks: Vec<String>,
    commands: BTreeMap<String, String>,
    root_entries: Vec<String>,
}

#[derive(Debug, Serialize)]
struct WorkflowFile {
    mode: String,
    commands: BTreeMap<String, String>,
}

#[derive(Debug)]
struct ProjectSummary {
    workspace_name: String,
    root_entries: Vec<String>,
    cargo_toml: Option<String>,
    package_json: Option<String>,
    readme: Option<String>,
    go_mod: Option<String>,
    pyproject_toml: Option<String>,
    requirements_txt: Option<String>,
}

pub fn mode_name(mode: InitMode) -> &'static str {
    match mode {
        InitMode::Basic => "init",
        InitMode::Deep => "init-deep",
    }
}

async fn generate_agents_md(workdir: &Path, summary: &ProjectSummary, mode: InitMode) -> AgentsContent {
    let provider = resolve_provider(workdir);
    let provider_name = resolve_named_provider(workdir).map(|named| named.name);
    let prompt = build_agents_prompt(summary, mode);
    let request = ChatRequest {
        model: provider.model.clone(),
        messages: vec![
            ChatMessage::system(
                if mode == InitMode::Deep {
                    "你要为当前代码仓库生成严格、可执行的 AGENTS.md。输出纯 Markdown，不要使用代码块包裹整个文件。必须包含：项目概览、目录结构、常用命令、模块职责、工作约定、修改边界、验证方式、风险目录。"
                } else {
                    "你要为当前代码仓库生成简洁、可执行的 AGENTS.md。输出纯 Markdown，不要使用代码块包裹整个文件。必须包含：项目概览、目录结构、常用命令、工作约定、修改边界、验证方式。"
                }
            ),
            ChatMessage::user(prompt),
        ],
        tools: None,
        temperature: Some(if mode == InitMode::Deep { 0.1 } else { 0.2 }),
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
                .map(|choice| strip_code_fences(choice.message.text().unwrap_or_default()))
                .filter(|content| !content.trim().is_empty())
                .unwrap_or_else(|| fallback_agents_md(summary, mode));
            AgentsContent {
                content,
                source: format!("provider:{}", provider_name.unwrap_or_else(|| provider.model.clone())),
            }
        }
        Err(error) => {
            let _ = MistakeBookStore::new(workdir).append(
                format!("{}:provider", mode_name(mode)),
                "初始化时模型生成 AGENTS.md 失败",
                error.to_string(),
            );
            AgentsContent {
                content: fallback_agents_md(summary, mode),
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
        .filter(|name| name != ".git" && name != "target" && name != "node_modules")
        .take(30)
        .collect();

    ProjectSummary {
        workspace_name: workdir.file_name().and_then(|name| name.to_str()).unwrap_or("workspace").to_string(),
        root_entries,
        cargo_toml: read_if_exists(&workdir.join("Cargo.toml")),
        package_json: read_if_exists(&workdir.join("package.json")),
        readme: read_if_exists(&workdir.join("README.md")),
        go_mod: read_if_exists(&workdir.join("go.mod")),
        pyproject_toml: read_if_exists(&workdir.join("pyproject.toml")),
        requirements_txt: read_if_exists(&workdir.join("requirements.txt")),
    }
}

fn build_agents_prompt(summary: &ProjectSummary, mode: InitMode) -> String {
    let focus = if mode == InitMode::Deep {
        "请输出适合 sacode cli 在该项目中长期协作的严格 AGENTS.md，重点覆盖目录职责、修改边界、验证流程、常见命令、风险目录和协作约束。"
    } else {
        "请输出适合 sacode cli 快速识别项目的 AGENTS.md，重点覆盖项目概览、目录结构、常用命令、基本工作约定和验证方式。"
    };

    format!(
        "项目名：{}\n根目录条目：{}\n\nCargo.toml:\n{}\n\npackage.json:\n{}\n\ngo.mod:\n{}\n\npyproject.toml:\n{}\n\nrequirements.txt:\n{}\n\nREADME.md:\n{}\n\n{}",
        summary.workspace_name,
        summary.root_entries.join(", "),
        summary.cargo_toml.as_deref().unwrap_or("<missing>"),
        summary.package_json.as_deref().unwrap_or("<missing>"),
        summary.go_mod.as_deref().unwrap_or("<missing>"),
        summary.pyproject_toml.as_deref().unwrap_or("<missing>"),
        summary.requirements_txt.as_deref().unwrap_or("<missing>"),
        summary.readme.as_deref().unwrap_or("<missing>"),
        focus,
    )
}

fn fallback_agents_md(summary: &ProjectSummary, mode: InitMode) -> String {
    let mut lines = vec![
        format!("# {} AGENTS", summary.workspace_name),
        String::new(),
        "## 项目概览".to_string(),
        format!("- 工作区：{}", summary.workspace_name),
        format!("- 技术栈：{}", stack_summary(summary).join("、")),
        format!("- 根目录：{}", summary.root_entries.join(", ")),
        String::new(),
        "## 常用命令".to_string(),
    ];

    for command in detected_commands(summary) {
        lines.push(format!("- `{}`", command));
    }

    lines.push(String::new());
    lines.push("## 工作约定".to_string());
    lines.push("- 先阅读现有代码与文档，再做最小正确改动。".to_string());
    lines.push("- 优先把 sacode 相关配置放到项目级 `.sacode/` 目录。".to_string());
    lines.push("- 修改后执行与当前技术栈对应的验证命令。".to_string());
    lines.push(String::new());
    lines.push("## 修改边界".to_string());
    lines.push("- 只在当前项目工作区内修改文件。".to_string());
    lines.push("- 优先更新项目配置、协作文档与本地工作流，避免直接改动无关源码。".to_string());
    lines.push(String::new());
    lines.push("## 验证方式".to_string());
    for command in detected_commands(summary) {
        if command.contains("test") || command.contains("build") || command.contains("check") || command.contains("lint") {
            lines.push(format!("- `{}`", command));
        }
    }

    if mode == InitMode::Deep {
        lines.push(String::new());
        lines.push("## 风险目录".to_string());
        lines.push("- 修改前先确认生成目录、发布目录、迁移目录和基础配置文件的用途。".to_string());
        lines.push(String::new());
        lines.push("## 深度协作说明".to_string());
        lines.push("- 本仓库已完成深度初始化，后续改动应优先遵循 `.sacode/project.json` 与 `.sacode/workflows.json`。".to_string());
    }

    lines.join("\n")
}

fn ensure_config_json(sacode_dir: &Path) -> Result<()> {
    let config_path = sacode_dir.join("config.json");
    if config_path.exists() {
        return Ok(());
    }

    let default_config = serde_json::json!({
        "providers": {},
        "current": ""
    });
    fs::write(config_path, serde_json::to_string_pretty(&default_config)?)?;
    Ok(())
}

fn write_init_metadata(workdir: &Path, summary: &ProjectSummary, generator: &str, mode: InitMode) -> Result<()> {
    let provider = resolve_provider(workdir);
    let provider_name = resolve_named_provider(workdir).map(|named| named.name);
    let metadata = InitMetadata {
        initialized_at: current_timestamp(),
        mode: mode_name(mode).to_string(),
        generator: generator.to_string(),
        provider_name,
        model: provider.model,
        project_name: summary.workspace_name.clone(),
        stacks: stack_summary(summary),
        commands: command_map(summary),
        root_entries: summary.root_entries.clone(),
    };
    fs::write(
        workdir.join(".sacode/project.json"),
        serde_json::to_string_pretty(&metadata)?,
    )?;
    Ok(())
}

fn write_workflows_json(sacode_dir: &Path, summary: &ProjectSummary) -> Result<()> {
    let workflow = WorkflowFile {
        mode: "deep".to_string(),
        commands: command_map(summary),
    };
    fs::write(
        sacode_dir.join("workflows.json"),
        serde_json::to_string_pretty(&workflow)?,
    )?;
    Ok(())
}

fn write_mcp_template(sacode_dir: &Path) -> Result<()> {
    let config = McpConfig::default();
    fs::write(
        sacode_dir.join("mcp.json"),
        serde_json::to_string_pretty(&config)?,
    )?;
    Ok(())
}

fn stack_summary(summary: &ProjectSummary) -> Vec<String> {
    let mut stacks = Vec::new();
    if summary.cargo_toml.is_some() {
        stacks.push("Rust".to_string());
    }
    if summary.package_json.is_some() {
        stacks.push("Node.js".to_string());
    }
    if summary.go_mod.is_some() {
        stacks.push("Go".to_string());
    }
    if summary.pyproject_toml.is_some() || summary.requirements_txt.is_some() {
        stacks.push("Python".to_string());
    }
    if stacks.is_empty() {
        stacks.push("Unknown".to_string());
    }
    stacks
}

fn detected_commands(summary: &ProjectSummary) -> Vec<String> {
    command_map(summary).into_values().collect()
}

fn command_map(summary: &ProjectSummary) -> BTreeMap<String, String> {
    let mut commands = BTreeMap::new();
    if summary.cargo_toml.is_some() {
        commands.insert("build".to_string(), "cargo build".to_string());
        commands.insert("test".to_string(), "cargo test".to_string());
        commands.insert("run".to_string(), "cargo run".to_string());
        commands.insert("check".to_string(), "cargo check".to_string());
    }
    if summary.package_json.is_some() {
        commands.entry("build".to_string()).or_insert_with(|| "npm run build".to_string());
        commands.entry("test".to_string()).or_insert_with(|| "npm test".to_string());
        commands.entry("run".to_string()).or_insert_with(|| "npm run dev".to_string());
        commands.entry("lint".to_string()).or_insert_with(|| "npm run lint".to_string());
    }
    if summary.go_mod.is_some() {
        commands.entry("build".to_string()).or_insert_with(|| "go build ./...".to_string());
        commands.entry("test".to_string()).or_insert_with(|| "go test ./...".to_string());
        commands.entry("run".to_string()).or_insert_with(|| "go run .".to_string());
    }
    if summary.pyproject_toml.is_some() || summary.requirements_txt.is_some() {
        commands.entry("run".to_string()).or_insert_with(|| "python -m <module>".to_string());
        commands.entry("test".to_string()).or_insert_with(|| "pytest".to_string());
    }
    if commands.is_empty() {
        commands.insert("inspect".to_string(), "补充项目构建与测试命令".to_string());
    }
    commands
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

fn current_timestamp() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};

    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs().to_string())
        .unwrap_or_else(|_| "0".to_string())
}

fn print_summary(summary: &InitSummary) {
    println!("SaCode {} complete", mode_name(summary.mode));
    println!("Project: {}", summary.project_name);
    println!("Detected stack: {}", summary.stack_summary.join(", "));
    if !summary.detected_commands.is_empty() {
        println!("Commands:");
        for command in &summary.detected_commands {
            println!("  - {}", command);
        }
    }
    if summary.generated_agents {
        println!("Generated AGENTS.md");
    }
    println!("Initialized .sacode/profile.json");
    println!("Initialized .sacode/mistakes.json");
    println!("Recorded init metadata in .sacode/project.json");
    if summary.generated_workflows {
        println!("Generated .sacode/workflows.json");
    }
    if summary.generated_mcp_template {
        println!("Generated .sacode/mcp.json");
    }
}
