use std::{env, path::Path, time::{Duration, Instant}};

use anyhow::Result;
use sacode_kernel::{Event, ExecutionMode, ExecutionReport, Supervisor, Task};
use sacode_kernel::model::{ChatUsage, ToolDefinition};
use sacode_runtime::{McpConfigStore, ProviderClient, ToolRegistry};
use serde::Serialize;

use crate::{cmd::{insight, outstyle, status, ApprovalPolicy}, mistakes::MistakeBookStore, provider_runtime::resolve_provider};

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct ToolResult {
    pub iteration: usize,
    pub step_id: usize,
    pub name: String,
    pub success: bool,
    pub summary: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct RunnerOutput {
    pub prompt: String,
    pub mode: ExecutionMode,
    pub max_iterations: usize,
    pub tool_names: Vec<String>,
    pub workspace: String,
    pub plan: sacode_kernel::Plan,
    pub events: Vec<Event>,
    pub tool_results: Vec<ToolResult>,
    pub provider_response: std::result::Result<String, String>,
    pub pending_question: Option<serde_json::Value>,
    pub usage: Option<ChatUsage>,
    pub api_duration_ms: u64,
    pub tool_duration_ms: u64,
    pub total_duration_ms: u64,
}

impl RunnerOutput {
    pub fn from_execution_report(
        report: &ExecutionReport,
        prompt: String,
        mode: ExecutionMode,
        max_iterations: usize,
        workspace: String,
    ) -> Self {
        let tool_names: Vec<String> = report.tool_records.iter()
            .map(|r| r.tool_name.clone())
            .collect();
        
        let tool_results: Vec<ToolResult> = report.tool_records.iter()
            .map(|r| ToolResult {
                iteration: 0,
                step_id: r.step_id.unwrap_or(0),
                name: r.tool_name.clone(),
                success: r.success,
                summary: if r.success { "success" } else { "failed" }.to_string(),
            })
            .collect();
        
        let plan = report.plan.clone().unwrap_or_else(|| {
            sacode_kernel::Plan {
                task: prompt.clone(),
                steps: Vec::new(),
                mode: mode.to_string(),
            }
        });
        
        Self {
            prompt,
            mode,
            max_iterations,
            tool_names,
            workspace,
            plan,
            events: report.events.clone(),
            tool_results,
            provider_response: Err("orchestrator mode does not call provider".to_string()),
            pending_question: None,
            usage: None,
            api_duration_ms: 0,
            tool_duration_ms: 0,
            total_duration_ms: 0,
        }
    }
}

pub async fn run_task(prompt: &str, mode: ExecutionMode, approval: ApprovalPolicy, max_iterations: usize) -> Result<RunnerOutput> {
    run_task_with_stdin(prompt, mode, approval, max_iterations, None).await
}

pub async fn run_task_with_stdin(
    prompt: &str,
    mode: ExecutionMode,
    approval: ApprovalPolicy,
    max_iterations: usize,
    stdin: Option<String>,
) -> Result<RunnerOutput> {
    let total_started_at = Instant::now();
    let workdir = env::current_dir()?;
    let _ = status::ensure_default_context7(&workdir).await;
    let expanded_prompt = maybe_expand_skill_prompt(prompt, &workdir)?;
    let effective_prompt = if let Some(ref stdin) = stdin {
        format!("{}\n\n--- stdin ---\n{}", expanded_prompt, stdin)
    } else {
        expanded_prompt.clone()
    };

    let tools = ToolRegistry::builtin();
    let mut tool_names: Vec<String> = tools.names().iter().map(|name| name.to_string()).collect();
    let mcp_store = McpConfigStore::new(&workdir);
    if let Ok(specs) = sacode_runtime::list_enabled_mcp_tool_specs(&mcp_store).await {
        tool_names.extend(specs.into_iter().map(|spec| spec.name));
        tool_names.sort();
        tool_names.dedup();
    }

    let tool_defs = build_tool_definitions(&tools, &tool_names);

    let system_prompt = build_system_prompt(&workdir, mode, &tool_names);

    let provider = resolve_provider(&workdir);
    let (provider_response, pending_question, usage, api_duration_ms, tool_duration_ms) = if provider.api_key.is_some() && provider.base_url.as_ref().is_some_and(|value| !value.is_empty()) {
        if tool_defs.is_empty() {
            let client = ProviderClient::new();
            let api_started_at = Instant::now();
            match client.simple_chat_with_usage(&provider, &effective_prompt).await {
                Ok((text, usage)) => (Ok(text), None, usage, elapsed_ms(api_started_at.elapsed()), 0),
                Err(error) => {
                    let _ = MistakeBookStore::new(&workdir).append("provider:chat", "主模型调用失败", error.to_string());
                    (Err(error.to_string()), None, None, elapsed_ms(api_started_at.elapsed()), 0)
                }
            }
        } else {
            run_tool_chat(&provider, &system_prompt, &effective_prompt, tool_defs, &tools, &workdir, approval, max_iterations).await
        }
    } else {
        (Err("没有可用的 provider 配置，请先运行 /login 或 sacode init".to_string()), None, None, 0, 0)
    };

    let task = Task::new(expanded_prompt.clone(), mode, stdin);
    let supervisor = Supervisor::new();
    let result = supervisor.execute(&task);

    Ok(RunnerOutput {
        prompt: expanded_prompt,
        mode,
        max_iterations,
        tool_names,
        workspace: workdir.to_string_lossy().to_string(),
        plan: result.output.plan,
        events: vec![Event::message(format!("任务通过模型 tool calling 模式执行"))],
        tool_results: vec![],
        provider_response,
        pending_question,
        usage,
        api_duration_ms,
        tool_duration_ms,
        total_duration_ms: elapsed_ms(total_started_at.elapsed()),
    })
}

async fn run_tool_chat(
    provider: &sacode_kernel::model::ModelProvider,
    system_prompt: &str,
    user_prompt: &str,
    tool_defs: Vec<ToolDefinition>,
    tools: &ToolRegistry,
    workdir: &Path,
    approval: ApprovalPolicy,
    _max_iterations: usize,
) -> (std::result::Result<String, String>, Option<serde_json::Value>, Option<ChatUsage>, u64, u64) {
    let client = ProviderClient::new();
    let tools_clone = tools.clone();
    let workdir_clone = workdir.to_path_buf();
    let tool_duration = std::sync::Arc::new(std::sync::atomic::AtomicU64::new(0));

    let tool_duration_for_executor = tool_duration.clone();
    let tool_executor = move |name: &str, args: &serde_json::Value| -> Result<serde_json::Value> {
        let tool_started_at = Instant::now();
        let spec = tools_clone.get(name);
        let needs_approval = spec.map(|s| s.needs_approval()).unwrap_or(false) || name.starts_with("mcp.");

        if needs_approval {
            match approval {
                ApprovalPolicy::AutoApprove => {}
                ApprovalPolicy::AutoDeny => return Ok(serde_json::json!({ "error": "denied by policy" })),
                ApprovalPolicy::Prompt => return Ok(serde_json::json!({ "error": "interactive approval unavailable in tool calling mode" })),
            }
        }

        if name == "web.search" {
            let store = McpConfigStore::new(&workdir_clone);
            if let Ok(Some((server_name, tool_name))) = sacode_runtime::find_enabled_search_tool_sync(&store) {
                if let Ok(server) = store.get(&server_name) {
                    if let Ok(mcp_result) = sacode_runtime::call_mcp_tool_sync(&server, &tool_name, args.clone()) {
                        tool_duration_for_executor.fetch_add(elapsed_ms(tool_started_at.elapsed()), std::sync::atomic::Ordering::Relaxed);
                        return Ok(serde_json::json!({
                            "content": mcp_result.content,
                            "server": server_name,
                            "tool": tool_name,
                            "source": "mcp",
                        }));
                    }
                }
            }
        }

        if let Some((server_name, tool_name_suffix)) = parse_mcp_tool_name(name) {
            let store = McpConfigStore::new(&workdir_clone);
            if let Ok(server) = store.get(server_name) {
                if let Ok(mcp_result) = sacode_runtime::call_mcp_tool_sync(&server, tool_name_suffix, args.clone()) {
                    tool_duration_for_executor.fetch_add(elapsed_ms(tool_started_at.elapsed()), std::sync::atomic::Ordering::Relaxed);
                    return Ok(serde_json::json!({
                        "content": mcp_result.content,
                        "server": server_name,
                        "tool": tool_name_suffix,
                    }));
                }
            }
            tool_duration_for_executor.fetch_add(elapsed_ms(tool_started_at.elapsed()), std::sync::atomic::Ordering::Relaxed);
            return Ok(serde_json::json!({ "error": format!("MCP server {} not found or call failed", server_name) }));
        }

        if let Some(_spec) = spec {
            let result = match tools_clone.execute(name, args.clone()) {
                Ok(output) => Ok(if output.success { output.data } else {
                    let _ = MistakeBookStore::new(&workdir_clone).append(
                        format!("tool:{}", name),
                        "工具执行失败",
                        output.message.clone().unwrap_or_default(),
                    );
                    serde_json::json!({ "error": output.message.unwrap_or_default() })
                }),
                Err(error) => {
                    let _ = MistakeBookStore::new(&workdir_clone).append(
                        format!("tool:{}", name),
                        "工具执行异常",
                        error.to_string(),
                    );
                    Ok(serde_json::json!({ "error": error.to_string() }))
                }
            };
            tool_duration_for_executor.fetch_add(elapsed_ms(tool_started_at.elapsed()), std::sync::atomic::Ordering::Relaxed);
            result
        } else {
            tool_duration_for_executor.fetch_add(elapsed_ms(tool_started_at.elapsed()), std::sync::atomic::Ordering::Relaxed);
            Ok(serde_json::json!({ "error": format!("unknown tool: {}", name) }))
        }
    };

    let api_started_at = Instant::now();
    match client.tool_chat(provider, system_prompt, user_prompt, tool_defs, tool_executor).await {
        Ok(result) => {
            let mut lines = Vec::new();
            if let Some(reasoning) = &result.reasoning_content {
                if !reasoning.is_empty() {
                    lines.push(format!("[思考] {}", preview(reasoning)));
                    lines.push(String::new());
                }
            }
            lines.push(result.final_text);
            if result.tool_calls_made > 0 {
                lines.push(format!("\n[执行了 {} 次工具调用，共 {} 轮对话]", result.tool_calls_made, result.rounds));
            }
            (
                Ok(lines.join("\n")),
                result.pending_question,
                result.usage,
                elapsed_ms(api_started_at.elapsed()),
                tool_duration.load(std::sync::atomic::Ordering::Relaxed),
            )
        }
        Err(error) => {
            let _ = MistakeBookStore::new(workdir).append("provider:tool_chat", "模型 tool calling 循环失败", error.to_string());
            (
                Err(error.to_string()),
                None,
                None,
                elapsed_ms(api_started_at.elapsed()),
                tool_duration.load(std::sync::atomic::Ordering::Relaxed),
            )
        }
    }
}

fn elapsed_ms(duration: Duration) -> u64 {
    duration.as_millis().min(u128::from(u64::MAX)) as u64
}

fn build_system_prompt(workdir: &Path, mode: ExecutionMode, tool_names: &[String]) -> String {
    let workspace = workdir.to_string_lossy();
    let mode_hint = match mode {
        ExecutionMode::Plan => "只规划不执行，使用只读工具了解项目状态后给出方案",
        ExecutionMode::Build => "正常构建模式，可以执行修改操作但需要谨慎",
        ExecutionMode::Yolo => "全自动执行模式，大胆使用所有工具完成任务",
    };
    let tools_list = tool_names.join(", ");

    let mut prompt = format!(
        "你是 SaCode AI 编程助手。工作目录: {}\n执行模式: {}\n可用工具: {}\n\n\
        你可以调用工具来完成任务。每次回复你可以选择：\n\
        1. 直接回复文本给用户\n\
        2. 调用一个或多个工具（通过 tool_calls）\n\n\
        工具调用后会返回结果，你可以基于结果继续推理或调用更多工具。\n\
        请尽量高效完成任务，避免冗余调用。\
        如果任务超出你的能力范围，请如实告知用户。",
        workspace, mode_hint, tools_list
    );

    if let Some(style_instruction) = outstyle::outstyle_instruction(workdir) {
        prompt.push_str("\n\n");
        prompt.push_str(&style_instruction);
    }

    if let Some(insight_instruction) = insight::insight_instruction(workdir) {
        prompt.push_str("\n\n");
        prompt.push_str(&insight_instruction);
    }

    prompt
}

fn build_tool_definitions(registry: &ToolRegistry, tool_names: &[String]) -> Vec<ToolDefinition> {
    let mut defs = Vec::new();
    for name in tool_names {
        if let Some(spec) = registry.get(name) {
            defs.push(spec.to_tool_definition());
        }
    }
    defs
}

pub fn format_output(output: &RunnerOutput) -> String {
    let mut lines = vec![
        "SaCode".to_string(),
        format!("Mode: {:?}", output.mode),
        format!("Max Iterations: {}", output.max_iterations),
        format!("Task: {}", output.prompt),
        format!("Workspace: {}", output.workspace),
        format!("Tools: {}", output.tool_names.join(", ")),
    ];

    match &output.provider_response {
        Ok(response) => {
            lines.push("Provider Response:".to_string());
            lines.push(response.clone());
        }
        Err(error) => lines.push(format!("Provider: {}", error)),
    }

    if let Some(question) = &output.pending_question {
        lines.push("Pending Question:".to_string());
        lines.push(summarize_tool_output(question));
    }

    lines.push("Plan:".to_string());
    for step in &output.plan.steps {
        lines.push(format!("  {}. {} [{:?}]", step.id, step.description, step.status));
    }

    if !output.tool_results.is_empty() {
        lines.push("Tool Results:".to_string());
        for tool_result in &output.tool_results {
            lines.push(format!(
                "  Step {} - {}: {} - {}",
                tool_result.step_id,
                tool_result.name,
                if tool_result.success { "OK" } else { "FAIL" },
                tool_result.summary
            ));
        }
    }

    lines.push("Events:".to_string());
    for event in &output.events {
        match event {
            Event::Message { content } => lines.push(format!("  MSG: {}", content)),
            Event::Thinking { content } => lines.push(format!("  THINK: {}", content)),
            Event::ToolCallStarted { name, .. } => lines.push(format!("  TOOL_START: {}", name)),
            Event::ToolCallFinished { name, success, output } => {
                lines.push(format!(
                    "  TOOL_END: {} ({}) {}",
                    name,
                    if *success { "ok" } else { "fail" },
                    summarize_tool_output(output)
                ));
            }
            Event::Done { summary } => lines.push(format!("  DONE: {}", summary)),
            Event::Error { message } => lines.push(format!("  ERROR: {}", message)),
            _ => {}
        }
    }

    lines.join("\n")
}

pub fn format_chat_output(output: &RunnerOutput) -> String {
    if let Ok(response) = &output.provider_response {
        return response.clone();
    }

    let mut lines = Vec::new();
    for event in &output.events {
        match event {
            Event::Message { content } => lines.push(content.clone()),
            Event::Thinking { content } => lines.push(format!("[思考] {}", content)),
            Event::ToolCallFinished { name, success, output } => {
                let summary = summarize_tool_output(output);
                let status = if *success { "完成" } else { "失败" };
                if summary.is_empty() {
                    lines.push(format!("[工具] {} {}", name, status));
                } else {
                    lines.push(format!("[工具] {} {}: {}", name, status, summary));
                }
            }
            Event::Done { summary } => lines.push(summary.clone()),
            Event::Error { message } => lines.push(format!("[错误] {}", message)),
            _ => {}
        }
    }

    if lines.is_empty() {
        "任务已完成。".to_string()
    } else {
        lines.join("\n")
    }
}

pub fn build_mcp_input(schema: &serde_json::Value, prompt: &str) -> serde_json::Value {
    let properties = schema.get("properties").and_then(|value| value.as_object());
    let mut payload = serde_json::Map::new();
    if let Some(properties) = properties {
        for key in ["query", "prompt", "input", "text", "task", "keyword"] {
            if properties.contains_key(key) {
                payload.insert(key.to_string(), serde_json::Value::String(prompt.to_string()));
            }
        }
    }
    if payload.is_empty() {
        serde_json::json!({ "query": prompt })
    } else {
        serde_json::Value::Object(payload)
    }
}

pub fn summarize_tool_output(output: &serde_json::Value) -> String {
    if output.is_null() {
        return String::new();
    }
    if let Some(content) = output.get("content") {
        let text = serde_json::to_string(content).unwrap_or_else(|_| String::new());
        return preview(&text);
    }
    let text = serde_json::to_string(output).unwrap_or_else(|_| String::new());
    preview(&text)
}

fn maybe_expand_skill_prompt(prompt: &str, workdir: &Path) -> Result<String> {
    let trimmed = prompt.trim();
    let Some(skill_call) = trimmed.strip_prefix('/') else {
        return Ok(prompt.to_string());
    };
    let mut parts = skill_call.split_whitespace();
    let Some(skill_name) = parts.next() else {
        return Ok(prompt.to_string());
    };
    let args = parts.collect::<Vec<_>>().join(" ");
    let registry = sacode_runtime::SkillRegistry::new(workdir);
    match registry.render_prompt(skill_name, &args, workdir) {
        Ok(rendered) => Ok(rendered),
        Err(_) => Ok(prompt.to_string()),
    }
}

fn parse_mcp_tool_name(name: &str) -> Option<(&str, &str)> {
    let rest = name.strip_prefix("mcp.")?;
    let (server, tool) = rest.split_once('.')?;
    Some((server, tool))
}

fn preview(input: &str) -> String {
    let trimmed = input.trim();
    let mut chars = trimmed.chars();
    let preview: String = chars.by_ref().take(80).collect();
    if chars.next().is_some() { format!("{preview}...") } else { preview }
}
