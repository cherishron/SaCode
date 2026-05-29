use std::{env, path::Path, time::{Duration, Instant}};

use anyhow::Result;
use sacode_kernel::{Event, ExecutionMode, ExecutionReport, Supervisor, Task};
use sacode_kernel::model::{ChatUsage, ToolDefinition};
use sacode_runtime::{
    build_runtime_system_prompt, maybe_expand_skill_prompt, McpConfigStore, PromptContext,
    ProviderClient, SideEffectLevel, ToolRegistry,
};
use serde::Serialize;

use crate::{cmd::{insight, outstyle, status, ApprovalPolicy}, learning, mistakes::MistakeBookStore, provider_runtime::resolve_provider};

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
    pub learned_facts: Vec<learning::LearnedFact>,
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
            learned_facts: Vec::new(),
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

    let tool_defs = build_tool_definitions(&tools, &tool_names, mode);

    let mut system_prompt = build_runtime_system_prompt(&PromptContext {
        workdir: &workdir,
        mode,
        tool_names: &tool_names,
    })?;

    if let Some(style_instruction) = outstyle::outstyle_instruction(&workdir) {
        system_prompt.push_str("\n\n[User Style]\n");
        system_prompt.push_str(&style_instruction);
    }

    if let Some(insight_instruction) = insight::insight_instruction(&workdir) {
        system_prompt.push_str("\n\n[User Insight]\n");
        system_prompt.push_str(&insight_instruction);
    }

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
    let plan = if pending_question.is_some() {
        sacode_kernel::Plan {
            task: expanded_prompt.clone(),
            steps: Vec::new(),
            mode: mode.to_string(),
        }
    } else {
        result.output.plan
    };

    let learned_facts = if pending_question.is_none() {
        if let Ok(response) = &provider_response {
            learning::learn_from_task(&workdir, &effective_prompt, response).unwrap_or_default()
        } else {
            Vec::new()
        }
    } else {
        Vec::new()
    };

    Ok(RunnerOutput {
        prompt: expanded_prompt,
        mode,
        max_iterations,
        tool_names,
        workspace: workdir.to_string_lossy().to_string(),
        plan,
        events: Vec::new(),
        tool_results: vec![],
        provider_response,
        learned_facts,
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
    let provider_for_tools = provider.clone();
    let tool_duration = std::sync::Arc::new(std::sync::atomic::AtomicU64::new(0));

    let tool_duration_for_executor = tool_duration.clone();
    let tool_executor = move |name: &str, args: &serde_json::Value| -> Result<serde_json::Value> {
        let tool_started_at = Instant::now();
        let spec = tools_clone.get(name);
        let side_effect_level = spec
            .map(|s| s.side_effect_level)
            .unwrap_or(SideEffectLevel::Execute);
        let needs_approval = spec.map(|s| s.needs_approval()).unwrap_or(false) || name.starts_with("mcp.");

        if needs_approval {
            match approval {
                ApprovalPolicy::AutoApprove => {}
                ApprovalPolicy::AutoDeny => return Ok(serde_json::json!({ "error": "denied by policy" })),
                ApprovalPolicy::Prompt => {
                    return Ok(serde_json::json!({
                        "pending": true,
                        "kind": "tool_approval",
                        "question": format!("工具 {} 需要修改工作区，是否允许继续执行？", name),
                        "options": [
                            {
                                "label": "拒绝",
                                "description": "取消这次修改操作"
                            },
                            {
                                "label": "允许一次",
                                "description": "仅本次执行允许该修改操作"
                            },
                            {
                                "label": "本会话总是允许",
                                "description": "本会话内后续修改操作都自动允许"
                            }
                        ],
                        "multiple": false,
                        "tool_name": name,
                        "side_effect_level": format_side_effect_level(side_effect_level),
                        "args": args,
                    }))
                }
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
            let tool_input = if name == "media.read" {
                enrich_media_read_args(args, &provider_for_tools)
            } else {
                args.clone()
            };
            let result = match tools_clone.execute(name, tool_input) {
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
            let final_text = result.final_text.trim().to_string();
            (
                Ok(final_text),
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

fn enrich_media_read_args(args: &serde_json::Value, provider: &sacode_kernel::model::ModelProvider) -> serde_json::Value {
    let mut enriched = args.clone();
    let Some(object) = enriched.as_object_mut() else {
        return enriched;
    };

    if !object.contains_key("model") {
        object.insert("model".to_string(), serde_json::Value::String(provider.model.clone()));
    }
    if !object.contains_key("base_url") {
        if let Some(base_url) = provider.base_url.as_ref().filter(|value| !value.is_empty()) {
            object.insert("base_url".to_string(), serde_json::Value::String(base_url.clone()));
        }
    }
    if !object.contains_key("api_key") {
        if let Some(api_key) = provider.api_key.as_ref().filter(|value| !value.is_empty()) {
            object.insert("api_key".to_string(), serde_json::Value::String(api_key.clone()));
        }
    }

    enriched
}

fn elapsed_ms(duration: Duration) -> u64 {
    duration.as_millis().min(u128::from(u64::MAX)) as u64
}

fn build_tool_definitions(
    registry: &ToolRegistry,
    tool_names: &[String],
    mode: ExecutionMode,
) -> Vec<ToolDefinition> {
    let mut defs = Vec::new();
    for name in tool_names {
        if let Some(spec) = registry.get(name) {
            if mode == ExecutionMode::Plan && spec.side_effect_level != SideEffectLevel::ReadOnly {
                continue;
            }
            defs.push(spec.to_tool_definition());
        }
    }
    defs
}

fn format_side_effect_level(level: SideEffectLevel) -> &'static str {
    match level {
        SideEffectLevel::ReadOnly => "read_only",
        SideEffectLevel::Modify => "modify",
        SideEffectLevel::Execute => "execute",
    }
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

    if !output.learned_facts.is_empty() {
        lines.push("Learned Facts:".to_string());
        for fact in &output.learned_facts {
            lines.push(format!("  - {:?}: {}", fact.kind, fact.content));
        }
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

pub fn format_learned_facts_summary(facts: &[learning::LearnedFact]) -> Option<String> {
    if facts.is_empty() {
        return None;
    }

    let preference_count = facts
        .iter()
        .filter(|fact| fact.kind == learning::LearnedKind::Preference)
        .count();
    let workflow_count = facts
        .iter()
        .filter(|fact| fact.kind == learning::LearnedKind::Workflow)
        .count();
    let decision_count = facts
        .iter()
        .filter(|fact| fact.kind == learning::LearnedKind::Decision)
        .count();

    let mut parts = Vec::new();
    if preference_count > 0 {
        parts.push(format!("偏好 {} 条", preference_count));
    }
    if workflow_count > 0 {
        parts.push(format!("流程 {} 条", workflow_count));
    }
    if decision_count > 0 {
        parts.push(format!("决策 {} 条", decision_count));
    }

    Some(format!("本轮已写入项目 wiki：{}", parts.join("，")))
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
    let source_prefix = output
        .get("source")
        .and_then(|value| value.as_str())
        .filter(|value| !value.is_empty())
        .map(|value| format!("[{}] ", value))
        .unwrap_or_default();
    if let Some(content) = output.get("content") {
        let text = serde_json::to_string(content).unwrap_or_else(|_| String::new());
        return format!("{}{}", source_prefix, preview(&text));
    }
    let text = serde_json::to_string(output).unwrap_or_else(|_| String::new());
    format!("{}{}", source_prefix, preview(&text))
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

#[cfg(test)]
mod tests {
    use super::enrich_media_read_args;
    use super::format_learned_facts_summary;
    use crate::learning::{LearnedFact, LearnedKind};
    use sacode_kernel::model::ModelProvider;

    #[test]
    fn enrich_media_read_args_injects_current_provider() {
        let provider = ModelProvider::openai("gpt-4o")
            .with_api_key("secret")
            .with_base_url("https://api.openai.com/v1");
        let input = serde_json::json!({
            "path": ".sacode/pasted/test.png",
            "mode": "describe"
        });

        let enriched = enrich_media_read_args(&input, &provider);
        assert_eq!(enriched.get("model").and_then(|value| value.as_str()), Some("gpt-4o"));
        assert_eq!(enriched.get("base_url").and_then(|value| value.as_str()), Some("https://api.openai.com/v1"));
        assert_eq!(enriched.get("api_key").and_then(|value| value.as_str()), Some("secret"));
    }

    #[test]
    fn enrich_media_read_args_preserves_explicit_values() {
        let provider = ModelProvider::openai("gpt-4o")
            .with_api_key("secret")
            .with_base_url("https://api.openai.com/v1");
        let input = serde_json::json!({
            "path": ".sacode/pasted/test.png",
            "mode": "ocr",
            "model": "mimo-v2.5-pro",
            "base_url": "https://custom.example/v1",
            "api_key": "custom-key"
        });

        let enriched = enrich_media_read_args(&input, &provider);
        assert_eq!(enriched.get("model").and_then(|value| value.as_str()), Some("mimo-v2.5-pro"));
        assert_eq!(enriched.get("base_url").and_then(|value| value.as_str()), Some("https://custom.example/v1"));
        assert_eq!(enriched.get("api_key").and_then(|value| value.as_str()), Some("custom-key"));
    }

    #[test]
    fn format_learned_facts_summary_groups_by_kind() {
        let facts = vec![
            LearnedFact {
                kind: LearnedKind::Preference,
                content: "以后回复保持简洁".to_string(),
                context: "test".to_string(),
            },
            LearnedFact {
                kind: LearnedKind::Workflow,
                content: "提交前先检查".to_string(),
                context: "test".to_string(),
            },
            LearnedFact {
                kind: LearnedKind::Workflow,
                content: "完成后再继续".to_string(),
                context: "test".to_string(),
            },
        ];

        let summary = format_learned_facts_summary(&facts).expect("summary");
        assert_eq!(summary, "本轮已写入项目 wiki：偏好 1 条，流程 2 条");
    }
}
