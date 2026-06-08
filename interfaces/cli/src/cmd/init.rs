use std::{
    collections::{BTreeMap, BTreeSet},
    env, fs,
    path::Path,
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

#[derive(Debug, Clone)]
pub struct InitDraft {
    pub mode: InitMode,
    pub project_name: String,
    pub stack_summary: Vec<String>,
    pub detected_commands: Vec<String>,
    pub agents_files: Vec<AgentsDraftFile>,
    pub generated_workflows: bool,
    pub generated_mcp_template: bool,
    pub summary_message: String,
    pub metadata: InitMetadata,
}

#[derive(Debug, Clone)]
pub struct AgentsDraftFile {
    pub relative_path: String,
    pub content: String,
    pub action: DraftAction,
    pub summary: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DraftAction {
    Create,
    Update,
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

#[derive(Debug, Clone, Serialize)]
pub struct InitMetadata {
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

#[derive(Debug, Clone, Default)]
struct ProjectSummary {
    workspace_name: String,
    project_types: Vec<String>,
    root_entries: Vec<String>,
    important_files: BTreeMap<String, String>,
    source_dirs: Vec<String>,
    test_dirs: Vec<String>,
    route_dirs: Vec<String>,
    component_dirs: Vec<String>,
    util_dirs: Vec<String>,
    entry_files: Vec<String>,
    format_tools: Vec<String>,
    dependency_hints: Vec<String>,
    scripts: BTreeMap<String, String>,
}

#[derive(Debug, Clone)]
struct AgentsContent {
    root_content: String,
    local_files: Vec<(String, String, String)>,
    source: String,
}

pub async fn run(mode: InitMode) -> Result<()> {
    let workdir = env::current_dir()?;
    let draft = build_init_draft(&workdir, mode).await?;
    let _summary = apply_init_draft(&workdir, &draft).await?;
    Ok(())
}

pub async fn initialize_project(workdir: &Path, mode: InitMode) -> Result<InitSummary> {
    let draft = build_init_draft(workdir, mode).await?;
    apply_init_draft(workdir, &draft).await
}

pub async fn build_init_draft(workdir: &Path, mode: InitMode) -> Result<InitDraft> {
    let project = summarize_project(workdir)?;
    let agents_content = generate_agents_md(workdir, &project, mode).await;
    let metadata = build_init_metadata(workdir, &project, &agents_content.source, mode);

    let mut agents_files = vec![AgentsDraftFile {
        relative_path: "AGENTS.md".to_string(),
        action: if workdir.join("AGENTS.md").exists() {
            DraftAction::Update
        } else {
            DraftAction::Create
        },
        summary: if mode == InitMode::Deep {
            "根目录全局规则与技术栈总览".to_string()
        } else {
            "项目全局 AGENTS 草稿".to_string()
        },
        content: agents_content.root_content,
    }];

    for (relative_path, summary, content) in agents_content.local_files {
        agents_files.push(AgentsDraftFile {
            action: if workdir.join(&relative_path).exists() {
                DraftAction::Update
            } else {
                DraftAction::Create
            },
            relative_path,
            summary,
            content,
        });
    }

    let stacks = stack_summary(&project);
    let commands = detected_commands(&project);
    let summary_message = render_draft_summary(mode, &project, &agents_files, &commands);

    Ok(InitDraft {
        mode,
        project_name: project.workspace_name.clone(),
        stack_summary: stacks,
        detected_commands: commands,
        agents_files,
        generated_workflows: mode == InitMode::Deep,
        generated_mcp_template: mode == InitMode::Deep,
        summary_message,
        metadata,
    })
}

pub async fn apply_init_draft(workdir: &Path, draft: &InitDraft) -> Result<InitSummary> {
    let sacode_dir = workdir.join(".sacode");
    fs::create_dir_all(&sacode_dir)?;

    ensure_config_json(&sacode_dir)?;
    ProjectProfileStore::new(workdir).ensure_exists()?;
    MistakeBookStore::new(workdir).ensure_exists()?;

    for file in &draft.agents_files {
        let path = workdir.join(&file.relative_path);
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)?;
        }

        if path.exists() && file.relative_path == "AGENTS.md" {
            let existing = fs::read_to_string(&path)?;
            let merged = merge_agents_content(&existing, &file.content);
            fs::write(path, merged.as_bytes())?;
        } else {
            fs::write(path, file.content.as_bytes())?;
        }
    }

    if draft.generated_workflows {
        write_workflows_json(&sacode_dir, &draft.metadata.commands)?;
        write_mcp_template(&sacode_dir)?;
    }

    let _ = status::ensure_default_context7(workdir).await;
    write_init_metadata(workdir, &draft.metadata)?;

    Ok(InitSummary {
        mode: draft.mode,
        project_name: draft.project_name.clone(),
        stack_summary: draft.stack_summary.clone(),
        detected_commands: draft.detected_commands.clone(),
        generated_agents: !draft.agents_files.is_empty(),
        generated_workflows: draft.generated_workflows,
        generated_mcp_template: draft.generated_mcp_template,
    })
}

pub fn mode_name(mode: InitMode) -> &'static str {
    match mode {
        InitMode::Basic => "init",
        InitMode::Deep => "init-deep",
    }
}

fn summarize_project(workdir: &Path) -> Result<ProjectSummary> {
    let gitignore = build_gitignore_matcher(workdir);
    let mut summary = ProjectSummary {
        workspace_name: workdir
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("workspace")
            .to_string(),
        ..ProjectSummary::default()
    };

    let root_entries = fs::read_dir(workdir)?
        .filter_map(|entry| entry.ok())
        .filter_map(|entry| entry.file_name().into_string().ok())
        .filter(|name| !should_skip_name(name, &gitignore))
        .take(60)
        .collect::<Vec<_>>();
    summary.root_entries = root_entries;

    let scan_targets = vec![
        "package.json",
        "tsconfig.json",
        "pyproject.toml",
        "requirements.txt",
        "Cargo.toml",
        "go.mod",
        "vite.config.ts",
        "vite.config.js",
        "vite.config.mts",
        "vite.config.mjs",
        ".eslintrc",
        ".eslintrc.json",
        ".eslintrc.js",
        ".prettierrc",
        ".prettierrc.json",
        "pytest.ini",
        "README.md",
    ];

    for relative in scan_targets {
        let path = workdir.join(relative);
        if path.exists() {
            if let Ok(content) = fs::read_to_string(&path) {
                summary
                    .important_files
                    .insert(relative.to_string(), truncate_text(&content, 4000));
            }
        }
    }

    let mut discovered_dirs = Vec::new();
    scan_project_tree(
        workdir,
        workdir,
        &gitignore,
        0,
        &mut discovered_dirs,
        &mut summary,
    )?;
    apply_type_inference(&mut summary);
    summary.project_types.sort();
    summary.project_types.dedup();
    summary.source_dirs.sort();
    summary.source_dirs.dedup();
    summary.test_dirs.sort();
    summary.test_dirs.dedup();
    summary.route_dirs.sort();
    summary.route_dirs.dedup();
    summary.component_dirs.sort();
    summary.component_dirs.dedup();
    summary.util_dirs.sort();
    summary.util_dirs.dedup();
    summary.entry_files.sort();
    summary.entry_files.dedup();
    summary.format_tools.sort();
    summary.format_tools.dedup();
    summary.dependency_hints.sort();
    summary.dependency_hints.dedup();

    Ok(summary)
}

fn scan_project_tree(
    root: &Path,
    current: &Path,
    gitignore: &Gitignore,
    depth: usize,
    discovered_dirs: &mut Vec<String>,
    summary: &mut ProjectSummary,
) -> Result<()> {
    if depth > 4 {
        return Ok(());
    }

    let entries = match fs::read_dir(current) {
        Ok(entries) => entries,
        Err(_) => return Ok(()),
    };

    for entry in entries.filter_map(|entry| entry.ok()) {
        let path = entry.path();
        let relative = relative_display(root, &path);
        if should_skip_path(&relative, gitignore) {
            continue;
        }

        if path.is_dir() {
            discovered_dirs.push(relative.clone());
            classify_directory(&relative, summary);
            scan_project_tree(root, &path, gitignore, depth + 1, discovered_dirs, summary)?;
            continue;
        }

        classify_file(&relative, &path, summary);
    }

    Ok(())
}

fn classify_directory(relative: &str, summary: &mut ProjectSummary) {
    let lower = relative.to_lowercase();
    if is_named_segment(&lower, "src") || lower.ends_with("/src") || lower.contains("/src/") {
        summary.source_dirs.push(relative.to_string());
    }
    if is_named_segment(&lower, "test")
        || is_named_segment(&lower, "tests")
        || lower.contains("/__tests__")
    {
        summary.test_dirs.push(relative.to_string());
    }
    if is_named_segment(&lower, "api") || lower.contains("/api/") {
        summary.route_dirs.push(relative.to_string());
    }
    if lower.contains("component") {
        summary.component_dirs.push(relative.to_string());
    }
    if lower.contains("utils") || lower.contains("helpers") || lower.ends_with("/lib") {
        summary.util_dirs.push(relative.to_string());
    }
}

fn classify_file(relative: &str, path: &Path, summary: &mut ProjectSummary) {
    let file_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or_default();
    match file_name {
        "package.json" => {
            if let Ok(content) = fs::read_to_string(path) {
                if let Ok(json) = serde_json::from_str::<serde_json::Value>(&content) {
                    if let Some(scripts) = json.get("scripts").and_then(|value| value.as_object()) {
                        for (name, value) in scripts {
                            if let Some(command) = value.as_str() {
                                summary.scripts.insert(name.clone(), command.to_string());
                            }
                        }
                    }
                    if let Some(deps) = json.get("dependencies").and_then(|value| value.as_object())
                    {
                        for name in deps.keys().take(12) {
                            summary.dependency_hints.push(name.clone());
                        }
                    }
                    if let Some(dev_deps) = json
                        .get("devDependencies")
                        .and_then(|value| value.as_object())
                    {
                        for name in dev_deps.keys().take(12) {
                            summary.dependency_hints.push(name.clone());
                        }
                    }
                }
            }
        }
        "Cargo.toml" => {
            summary.project_types.push("Rust".to_string());
        }
        "pyproject.toml" | "requirements.txt" => {
            summary.project_types.push("Python".to_string());
        }
        "go.mod" => {
            summary.project_types.push("Go".to_string());
        }
        ".eslintrc" | ".eslintrc.js" | ".eslintrc.json" => {
            summary.format_tools.push("ESLint".to_string());
        }
        ".prettierrc" | ".prettierrc.json" => {
            summary.format_tools.push("Prettier".to_string());
        }
        _ => {}
    }

    let lower = relative.to_lowercase();
    if matches!(
        file_name,
        "main.rs"
            | "lib.rs"
            | "main.ts"
            | "main.tsx"
            | "index.ts"
            | "index.tsx"
            | "app.ts"
            | "app.tsx"
            | "server.ts"
            | "server.js"
            | "main.py"
    ) {
        summary.entry_files.push(relative.to_string());
    }
    if lower.contains("route")
        || lower.contains("router")
        || lower.contains("pages/")
        || lower.contains("app/")
    {
        summary.route_dirs.push(parent_relative(relative));
    }
}

fn apply_type_inference(summary: &mut ProjectSummary) {
    if summary.important_files.contains_key("package.json") {
        summary.project_types.push("Node.js".to_string());
    }
    if summary.important_files.contains_key("vite.config.ts")
        || summary.important_files.contains_key("vite.config.js")
        || summary.important_files.contains_key("vite.config.mts")
        || summary.important_files.contains_key("vite.config.mjs")
    {
        summary.project_types.push("Vite".to_string());
    }
    if summary
        .dependency_hints
        .iter()
        .any(|dep| dep == "next" || dep == "nextjs")
    {
        summary.project_types.push("Next.js".to_string());
    }
    if summary.dependency_hints.iter().any(|dep| dep == "express") {
        summary.project_types.push("Express".to_string());
    }
    if summary.source_dirs.len() > 1
        && summary
            .root_entries
            .iter()
            .any(|entry| entry == "packages" || entry == "apps")
    {
        summary.project_types.push("Monorepo".to_string());
    }
}

async fn generate_agents_md(
    workdir: &Path,
    summary: &ProjectSummary,
    mode: InitMode,
) -> AgentsContent {
    let provider = resolve_provider(workdir);
    let provider_name = resolve_named_provider(workdir).map(|named| named.name);
    let prompt = build_agents_prompt(summary, mode);
    let request = ChatRequest {
        model: provider.model.clone(),
        messages: vec![
            ChatMessage::system(match mode {
                InitMode::Basic => "你要为当前代码仓库生成一个 AGENTS.md 草稿。输出纯 Markdown，不要使用代码块包裹整个文件。重点覆盖项目概览、目录结构、常用命令、工作约定、修改边界、验证方式。",
                InitMode::Deep => "你要为当前代码仓库生成分层 AGENTS.md 草稿。输出纯 Markdown，不要使用代码块包裹整个文件。根目录 AGENTS.md 需要极简，关键子目录的 AGENTS.md 只写该层独有约定。",
            }),
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
    let root_content = match client.chat(&provider, request).await {
        Ok(response) => response
            .choices
            .first()
            .map(|choice| strip_code_fences(choice.message.text().unwrap_or_default()))
            .filter(|content| !content.trim().is_empty())
            .unwrap_or_else(|| fallback_root_agents_md(summary, mode)),
        Err(error) => {
            let _ = MistakeBookStore::new(workdir).append(
                format!("{}:provider", mode_name(mode)),
                "初始化时模型生成 AGENTS.md 失败",
                error.to_string(),
            );
            fallback_root_agents_md(summary, mode)
        }
    };

    let local_files = if mode == InitMode::Deep {
        build_deep_agents_files(summary)
    } else {
        Vec::new()
    };

    AgentsContent {
        root_content,
        local_files,
        source: format!(
            "provider:{}",
            provider_name.unwrap_or_else(|| provider.model.clone())
        ),
    }
}

fn build_agents_prompt(summary: &ProjectSummary, mode: InitMode) -> String {
    let focus = match mode {
        InitMode::Basic => "请根据项目扫描结果生成单个 AGENTS.md 草稿。",
        InitMode::Deep => {
            "请根据项目扫描结果生成根级极简 AGENTS.md 草稿，并为目录级 AGENTS 保留空间。"
        }
    };

    format!(
        "项目名：{}\n项目类型：{}\n根目录条目：{}\n源码目录：{}\n测试目录：{}\n路由目录：{}\n组件目录：{}\n工具目录：{}\n入口文件：{}\n格式化工具：{}\n依赖提示：{}\n脚本：{}\n关键配置：{}\n\n{}",
        summary.workspace_name,
        join_or_dash(&summary.project_types),
        join_or_dash(&summary.root_entries),
        join_or_dash(&summary.source_dirs),
        join_or_dash(&summary.test_dirs),
        join_or_dash(&summary.route_dirs),
        join_or_dash(&summary.component_dirs),
        join_or_dash(&summary.util_dirs),
        join_or_dash(&summary.entry_files),
        join_or_dash(&summary.format_tools),
        join_or_dash(&summary.dependency_hints),
        summary
            .scripts
            .iter()
            .map(|(name, cmd)| format!("{}={}", name, cmd))
            .collect::<Vec<_>>()
            .join(", "),
        summary
            .important_files
            .keys()
            .cloned()
            .collect::<Vec<_>>()
            .join(", "),
        focus,
    )
}

fn build_deep_agents_files(summary: &ProjectSummary) -> Vec<(String, String, String)> {
    let mut files = Vec::new();
    for dir in select_deep_agent_dirs(summary) {
        let content = fallback_local_agents_md(summary, &dir);
        let summary_line = match dir.as_str() {
            "src" => "源码层职责、导入规范与模块边界",
            "src/api" => "API 层路由、错误处理与鉴权约定",
            "src/components" => "组件层 UI 与状态管理约定",
            "tests" => "测试目录结构与命名约定",
            _ => "目录级局部约定",
        };
        files.push((
            format!("{}/AGENTS.md", dir),
            summary_line.to_string(),
            content,
        ));
    }
    files
}

fn select_deep_agent_dirs(summary: &ProjectSummary) -> Vec<String> {
    let mut dirs = BTreeSet::new();

    let is_python = summary.project_types.iter().any(|t| t == "Python");
    let is_go = summary.project_types.iter().any(|t| t == "Go");
    let is_nodejs = summary
        .project_types
        .iter()
        .any(|t| t == "Node.js" || t == "TypeScript");

    if is_nodejs || (!is_python && !is_go) {
        if summary.source_dirs.iter().any(|dir| dir == "src") {
            dirs.insert("src".to_string());
        }
        if summary.route_dirs.iter().any(|dir| dir == "src/api") {
            dirs.insert("src/api".to_string());
        }
        if summary
            .component_dirs
            .iter()
            .any(|dir| dir == "src/components")
        {
            dirs.insert("src/components".to_string());
        }
        if summary.test_dirs.iter().any(|dir| dir == "tests") {
            dirs.insert("tests".to_string());
        }
    }

    if is_python {
        if summary
            .source_dirs
            .iter()
            .any(|dir| dir == "src" || dir == "app")
        {
            let src_dir = summary
                .source_dirs
                .iter()
                .find(|dir| *dir == "src" || *dir == "app")
                .unwrap();
            dirs.insert(src_dir.clone());
        }
        if summary
            .route_dirs
            .iter()
            .any(|dir| dir == "api" || dir == "routes" || dir == "src/api")
        {
            let api_dir = summary
                .route_dirs
                .iter()
                .find(|dir| *dir == "api" || *dir == "routes" || *dir == "src/api")
                .unwrap();
            dirs.insert(api_dir.clone());
        }
        if summary
            .source_dirs
            .iter()
            .any(|dir| dir.contains("models") || dir.contains("services"))
        {
            for dir in summary
                .source_dirs
                .iter()
                .filter(|d| d.contains("models") || d.contains("services"))
            {
                dirs.insert(dir.clone());
            }
        }
        if summary
            .test_dirs
            .iter()
            .any(|dir| dir == "tests" || dir == "test")
        {
            let test_dir = summary
                .test_dirs
                .iter()
                .find(|dir| *dir == "tests" || *dir == "test")
                .unwrap();
            dirs.insert(test_dir.clone());
        }
    }

    if is_go {
        if summary
            .source_dirs
            .iter()
            .any(|dir| dir == "pkg" || dir == "internal")
        {
            for dir in summary
                .source_dirs
                .iter()
                .filter(|d| *d == "pkg" || *d == "internal")
            {
                dirs.insert(dir.clone());
            }
        }
        if summary.source_dirs.iter().any(|dir| dir == "cmd") {
            dirs.insert("cmd".to_string());
        }
        if summary.route_dirs.iter().any(|dir| dir == "api") {
            dirs.insert("api".to_string());
        }
        if summary.test_dirs.iter().any(|dir| dir == "test") {
            dirs.insert("test".to_string());
        }
    }

    dirs.into_iter().collect()
}

fn fallback_root_agents_md(summary: &ProjectSummary, mode: InitMode) -> String {
    let mut lines = vec![
        format!("# {} AGENTS", summary.workspace_name),
        String::new(),
        "## 项目概览".to_string(),
        format!("- 工作区：{}", summary.workspace_name),
        format!("- 技术栈：{}", stack_summary(summary).join("、")),
        format!("- 项目类型：{}", join_or_dash(&summary.project_types)),
        String::new(),
        "## 常用命令".to_string(),
    ];

    for command in detected_commands(summary) {
        lines.push(format!("- `{}`", command));
    }

    lines.push(String::new());
    lines.push("## 全局约定".to_string());
    lines.push("- 先阅读现有代码与文档，再做最小正确改动。".to_string());
    lines.push("- 优先遵循目录就近的 `AGENTS.md`，全局规则只写一次。".to_string());
    lines.push("- 修改后执行与当前技术栈对应的验证命令。".to_string());
    lines.push(String::new());
    lines.push("## 修改边界".to_string());
    lines.push("- 只修改与当前任务直接相关的文件。".to_string());
    lines.push("- 优先保留既有目录结构和模块边界。".to_string());

    if mode == InitMode::Deep {
        lines.push(String::new());
        lines.push("## 分层上下文".to_string());
        lines.push("- 进入关键目录时，优先读取该目录下的 `AGENTS.md`。".to_string());
        lines.push("- 根文件只保留全局规则，局部约定写在对应目录。".to_string());
    }

    lines.join("\n")
}

fn fallback_local_agents_md(summary: &ProjectSummary, dir: &str) -> String {
    let mut lines = vec![format!("# {} AGENTS", dir), String::new()];

    let is_python = summary.project_types.iter().any(|t| t == "Python");
    let is_go = summary.project_types.iter().any(|t| t == "Go");

    match dir {
        "src" | "app" if is_python => {
            lines.push("## Python 源码约定".to_string());
            lines.push("- 使用 type hints，函数签名清晰。".to_string());
            lines.push("- 异步优先使用 `asyncio`，避免混用 `threading`。".to_string());
            lines.push(String::new());
            lines.push("## 导入规范".to_string());
            lines.push("- 绝对导入优先，避免相对导入。".to_string());
            lines.push("- 第三方库、标准库、本地模块按顺序分组。".to_string());
        }
        "src" => {
            lines.push("## 目录职责".to_string());
            lines.push("- `src/` 放业务源码，公共抽象优先集中管理。".to_string());
            lines.push("- 跨层依赖保持单向，避免循环导入。".to_string());
            lines.push(String::new());
            lines.push("## 导入约定".to_string());
            lines.push("- 优先复用现有模块，新增抽象保持最小。".to_string());
        }
        "api" | "routes" | "src/api" if is_python => {
            lines.push("## Python API 约定".to_string());
            lines.push("- 使用 FastAPI/Flask 装饰器统一路由风格。".to_string());
            lines.push("- Pydantic 模型校验请求，统一错误返回结构。".to_string());
            lines.push("- 异步路由优先，数据库操作使用 async session。".to_string());
        }
        "api" if is_go => {
            lines.push("## Go API 约定".to_string());
            lines.push("- 使用标准 `net/http` 或 `gin`/`echo` 框架。".to_string());
            lines.push("- Handler 返回 `(Response, error)`，统一错误处理。".to_string());
            lines.push("- 路由组按版本或模块划分。".to_string());
        }
        "src/api" => {
            lines.push("## API 约定".to_string());
            lines.push("- 路由命名保持一致，错误处理统一。".to_string());
            lines.push("- 鉴权、校验和错误返回风格保持同层一致。".to_string());
        }
        "pkg" | "internal" => {
            lines.push("## Go 包约定".to_string());
            lines.push("- `pkg/` 放可导出的公共包，`internal/` 仅本项目使用。".to_string());
            lines.push("- 包名简洁、清晰，避免 `util`/`common` 等泛化命名。".to_string());
            lines.push(String::new());
            lines.push("## 代码风格".to_string());
            lines.push("- 遵循 `gofmt` 和 `goimports`。".to_string());
            lines.push("- 错误处理显式，不忽略 `err` 返回值。".to_string());
        }
        "cmd" => {
            lines.push("## Go 命令工具约定".to_string());
            lines.push("- `cmd/` 每个子目录对应一个可执行程序。".to_string());
            lines.push("- 入口简洁，主逻辑放 `pkg/` 或 `internal/`。".to_string());
        }
        "models" | "services" => {
            lines.push("## Python 分层约定".to_string());
            if dir == "models" {
                lines.push("- ORM 模型集中定义，字段类型明确。".to_string());
                lines.push("- 关联关系清晰，避免隐式 lazy loading。".to_string());
            } else {
                lines.push("- 业务逻辑封装，避免 Controller 直接操作数据库。".to_string());
                lines.push("- Service 方法粒度适中，便于复用和测试。".to_string());
            }
        }
        "src/components" => {
            lines.push("## 组件约定".to_string());
            lines.push("- 优先保持组件职责单一，状态与展示分离。".to_string());
            lines.push("- 组件 API 保持简洁，避免重复封装。".to_string());
        }
        "tests" | "test" if is_python => {
            lines.push("## Python 测试约定".to_string());
            lines.push("- 使用 `pytest`，fixture 集中管理。".to_string());
            lines.push("- 测试文件命名 `test_*.py`，类命名 `Test*`。".to_string());
            lines.push("- Mock 使用 `unittest.mock` 或 `pytest-mock`。".to_string());
        }
        "tests" | "test" if is_go => {
            lines.push("## Go 测试约定".to_string());
            lines.push("- 测试文件与源文件同目录，命名 `*_test.go`。".to_string());
            lines.push("- 表驱动测试优先，覆盖边界情况。".to_string());
            lines.push("- Benchmark 测试命名 `Benchmark*`。".to_string());
        }
        "tests" => {
            lines.push("## 测试约定".to_string());
            lines.push("- 测试名称应表达行为，fixture 与 mock 复用已有模式。".to_string());
            lines.push("- 新增测试尽量贴近对应模块目录结构。".to_string());
        }
        _ => {
            lines.push("## 局部约定".to_string());
            lines.push(format!(
                "- `{}` 目录具有独立职责，修改前先确认既有模式。",
                dir
            ));
        }
    }

    if !summary.format_tools.is_empty() {
        lines.push(String::new());
        lines.push("## 风格工具".to_string());
        lines.push(format!(
            "- 当前项目检测到：{}",
            join_or_dash(&summary.format_tools)
        ));
    }

    lines.join("\n")
}
fn render_draft_summary(
    mode: InitMode,
    summary: &ProjectSummary,
    agents_files: &[AgentsDraftFile],
    commands: &[String],
) -> String {
    let mut lines = vec![format!("{} 草稿已生成。", mode_name(mode))];
    lines.push(format!("项目: {}", summary.workspace_name));
    lines.push(format!(
        "项目类型: {}",
        join_or_dash(&summary.project_types)
    ));
    lines.push(format!("技术栈: {}", stack_summary(summary).join("、")));
    if !commands.is_empty() {
        lines.push("识别命令:".to_string());
        for command in commands.iter().take(8) {
            lines.push(format!("- {}", command));
        }
    }
    lines.push("草稿文件:".to_string());
    for file in agents_files {
        let action = match file.action {
            DraftAction::Create => "新增",
            DraftAction::Update => "更新",
        };
        lines.push(format!(
            "- [{}] {}: {}",
            action, file.relative_path, file.summary
        ));
    }
    lines.push("请先预览草稿，确认后再写入。".to_string());
    lines.join("\n")
}

fn build_init_metadata(
    workdir: &Path,
    summary: &ProjectSummary,
    generator: &str,
    mode: InitMode,
) -> InitMetadata {
    let provider = resolve_provider(workdir);
    let provider_name = resolve_named_provider(workdir).map(|named| named.name);
    InitMetadata {
        initialized_at: current_timestamp(),
        mode: mode_name(mode).to_string(),
        generator: generator.to_string(),
        provider_name,
        model: provider.model,
        project_name: summary.workspace_name.clone(),
        stacks: stack_summary(summary),
        commands: command_map(summary),
        root_entries: summary.root_entries.clone(),
    }
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

fn write_init_metadata(workdir: &Path, metadata: &InitMetadata) -> Result<()> {
    fs::write(
        workdir.join(".sacode/project.json"),
        serde_json::to_string_pretty(metadata)?,
    )?;
    Ok(())
}

fn write_workflows_json(sacode_dir: &Path, commands: &BTreeMap<String, String>) -> Result<()> {
    let workflow = WorkflowFile {
        mode: "deep".to_string(),
        commands: commands.clone(),
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
    let mut stacks = summary.project_types.clone();
    if stacks.is_empty() {
        stacks.push("Unknown".to_string());
    }
    stacks.sort();
    stacks.dedup();
    stacks
}

fn detected_commands(summary: &ProjectSummary) -> Vec<String> {
    command_map(summary).into_values().collect()
}

fn command_map(summary: &ProjectSummary) -> BTreeMap<String, String> {
    let mut commands = BTreeMap::new();
    for name in summary.scripts.keys() {
        commands.insert(name.clone(), format!("npm run {}", name));
        if matches!(name.as_str(), "dev" | "start") {
            commands
                .entry("run".to_string())
                .or_insert_with(|| format!("npm run {}", name));
        }
    }
    if summary.important_files.contains_key("Cargo.toml") {
        commands
            .entry("build".to_string())
            .or_insert_with(|| "cargo build".to_string());
        commands
            .entry("test".to_string())
            .or_insert_with(|| "cargo test".to_string());
        commands
            .entry("check".to_string())
            .or_insert_with(|| "cargo check".to_string());
    }
    if summary.important_files.contains_key("go.mod") {
        commands
            .entry("build".to_string())
            .or_insert_with(|| "go build ./...".to_string());
        commands
            .entry("test".to_string())
            .or_insert_with(|| "go test ./...".to_string());
    }
    if summary.important_files.contains_key("pyproject.toml")
        || summary.important_files.contains_key("requirements.txt")
    {
        commands
            .entry("test".to_string())
            .or_insert_with(|| "pytest".to_string());
    }
    if commands.is_empty() {
        commands.insert("inspect".to_string(), "补充项目构建与测试命令".to_string());
    }
    commands
}

use ignore::gitignore::{Gitignore, GitignoreBuilder};

fn build_gitignore_matcher(workdir: &Path) -> Gitignore {
    let mut builder = GitignoreBuilder::new(workdir);
    let gitignore_path = workdir.join(".gitignore");
    if gitignore_path.exists() {
        let _ = builder.add(gitignore_path);
    }
    builder.build().unwrap_or_else(|_| Gitignore::empty())
}

fn should_skip_name(name: &str, gitignore: &Gitignore) -> bool {
    should_skip_path(name, gitignore)
}

fn should_skip_path(relative: &str, gitignore: &Gitignore) -> bool {
    let path = Path::new(relative);
    gitignore.matched(path, false).is_ignore()
}

fn relative_display(root: &Path, path: &Path) -> String {
    path.strip_prefix(root)
        .ok()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .replace('\\', "/")
}

fn parent_relative(relative: &str) -> String {
    relative
        .rsplit_once('/')
        .map(|(parent, _)| parent.to_string())
        .unwrap_or_default()
}

fn is_named_segment(path: &str, segment: &str) -> bool {
    path == segment
        || path.starts_with(&format!("{}/", segment))
        || path.ends_with(&format!("/{}", segment))
}

fn join_or_dash(values: &[String]) -> String {
    if values.is_empty() {
        "-".to_string()
    } else {
        values.join(", ")
    }
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

fn merge_agents_content(existing: &str, new_content: &str) -> String {
    let separator = "\n\n---\n\n## Auto-generated updates\n\n";

    if existing.contains("## Auto-generated updates") {
        let parts: Vec<&str> = existing.splitn(2, "## Auto-generated updates").collect();
        let user_content = parts.first().map_or("", |v| *v);
        let old_auto_content = parts.get(1).map_or("", |v| *v);

        let marker_line = "\n\n---\n\n";
        let timestamp_line = format!("\n### Update at {}\n", current_timestamp());

        let merged_auto = if old_auto_content.trim().is_empty() {
            format!("{}{}", marker_line, new_content)
        } else {
            format!(
                "{}{}{}",
                old_auto_content.trim_end(),
                timestamp_line,
                new_content
            )
        };

        format!("{}{}{}", user_content.trim_end(), separator, merged_auto)
    } else {
        format!("{}{}{}", existing.trim_end(), separator, new_content)
    }
}
