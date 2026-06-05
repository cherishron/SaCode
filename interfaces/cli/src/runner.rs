use std::{
    env,
    path::Path,
    time::{Duration, Instant},
};

use anyhow::Result;
use sacode_kernel::model::{ChatUsage, ToolDefinition};
use sacode_kernel::{
    Event, ExecutionMode, ExecutionReport, Supervisor, Task, TaskRun, TaskRunState,
};
use sacode_runtime::{
    build_runtime_system_prompt, infer_task_run_state, maybe_expand_skill_prompt,
    register_enabled_mcp_tools_sync, task_run_from_report, task_run_snapshot, FailoverContext,
    McpConfigStore, NodeScore, PromptContext, ProviderClient, SandboxConfigStore, SandboxPolicy,
    SideEffectLevel, TaskProfile, ToolRegistry,
};
use serde::Serialize;

use crate::{
    cmd::{insight, outstyle, status, ApprovalPolicy},
    learning,
    mistakes::MistakeBookStore,
    provider_runtime::{
        build_route_plan, record_model_health, resolve_model_candidates, resolve_provider,
    },
};

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
    pub task_run: TaskRun,
}

impl RunnerOutput {
    pub fn effective_state(&self) -> TaskRunState {
        self.task_run.state.clone().unwrap_or(TaskRunState::Failed)
    }

    pub fn from_execution_report(
        report: &ExecutionReport,
        prompt: String,
        mode: ExecutionMode,
        max_iterations: usize,
        workspace: String,
    ) -> Self {
        let task_prompt = prompt.clone();
        let task_run = task_run_from_report(
            None,
            mode,
            task_prompt,
            report,
            infer_task_run_state(report),
        );
        let tool_names: Vec<String> = report
            .tool_records
            .iter()
            .map(|r| r.tool_name.clone())
            .collect();

        let tool_results: Vec<ToolResult> = report
            .tool_records
            .iter()
            .map(|r| ToolResult {
                iteration: 0,
                step_id: r.step_id.unwrap_or(0),
                name: r.tool_name.clone(),
                success: r.success,
                summary: if r.success { "success" } else { "failed" }.to_string(),
            })
            .collect();

        let plan = report.plan.clone().unwrap_or_else(|| sacode_kernel::Plan {
            task: prompt.clone(),
            steps: Vec::new(),
            mode: mode.to_string(),
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
            task_run,
        }
    }
}

pub async fn run_task(
    prompt: &str,
    mode: ExecutionMode,
    approval: ApprovalPolicy,
    max_iterations: usize,
) -> Result<RunnerOutput> {
    run_task_with_stdin(prompt, mode, approval, max_iterations, None).await
}

pub async fn run_task_with_stdin(
    prompt: &str,
    mode: ExecutionMode,
    approval: ApprovalPolicy,
    max_iterations: usize,
    stdin: Option<String>,
) -> Result<RunnerOutput> {
    run_task_with_stdin_and_stream(
        prompt,
        mode,
        approval,
        max_iterations,
        stdin,
        None::<fn(&str)>,
    )
    .await
}

pub async fn run_task_with_stdin_and_stream<F>(
    prompt: &str,
    mode: ExecutionMode,
    approval: ApprovalPolicy,
    max_iterations: usize,
    stdin: Option<String>,
    stream_handler: Option<F>,
) -> Result<RunnerOutput>
where
    F: FnMut(&str),
{
    let total_started_at = Instant::now();
    let workdir = env::current_dir()?;
    let sandbox_policy = SandboxConfigStore::new(&workdir)
        .policy_for_mode(mode)
        .unwrap_or_else(|_| SandboxPolicy::for_mode(mode));
    sacode_runtime::install_current_mode(mode);
    sacode_runtime::install_global_policy(sandbox_policy);
    let _ = status::ensure_default_context7(&workdir).await;
    let expanded_prompt = maybe_expand_skill_prompt(prompt, &workdir)?;
    let effective_prompt = if let Some(ref stdin) = stdin {
        format!("{}\n\n--- stdin ---\n{}", expanded_prompt, stdin)
    } else {
        expanded_prompt.clone()
    };

    let profile = TaskProfile::from_prompt_and_workspace(&effective_prompt, &workdir);
    let candidates = resolve_model_candidates(&workdir);
    let route_plan = build_route_plan(&workdir, &candidates, &profile);

    let mut tools = ToolRegistry::builtin();
    let mcp_store = McpConfigStore::new(&workdir);
    let _ = register_enabled_mcp_tools_sync(&mcp_store, &mut tools);
    let mut tool_names: Vec<String> = tools.names().iter().map(|name| name.to_string()).collect();
    tool_names.sort();
    tool_names.dedup();

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

    let primary_provider = if let Some(ref plan) = route_plan {
        candidates
            .iter()
            .find(|(pn, mn, _)| pn == &plan.primary.provider_name && mn == &plan.primary.model_name)
            .map(|(_, _, provider)| provider.clone())
            .unwrap_or_else(|| resolve_provider(&workdir))
    } else {
        resolve_provider(&workdir)
    };

    let primary_provider_name = route_plan
        .as_ref()
        .map(|plan| plan.primary.provider_name.clone())
        .unwrap_or_else(|| "default".to_string());
    let primary_model_name = route_plan
        .as_ref()
        .map(|plan| plan.primary.model_name.clone())
        .unwrap_or_else(|| primary_provider.model.clone());

    let (
        mut provider_response,
        mut pending_question,
        mut usage,
        mut api_duration_ms,
        mut tool_duration_ms,
    ) = execute_with_provider(
        &primary_provider,
        &system_prompt,
        &effective_prompt,
        tool_defs.clone(),
        &tools,
        &workdir,
        mode,
        approval,
        max_iterations,
        stream_handler,
    )
    .await;

    record_model_health(
        &workdir,
        &primary_provider_name,
        &primary_model_name,
        provider_response.is_ok(),
        provider_response.as_ref().err().map(String::as_str),
    );

    let mut attempt_count = 0;
    let max_attempts = route_plan
        .as_ref()
        .map(|p| p.fallbacks.len() + 1)
        .unwrap_or(1);

    while attempt_count < max_attempts {
        let should_switch = if provider_response.is_err() {
            true
        } else if let Ok(ref response) = provider_response {
            let score = NodeScore::evaluate(None, response, &[], &profile);
            score.decision == sacode_runtime::NodeDecision::SwitchModel
        } else {
            false
        };

        if !should_switch || pending_question.is_some() {
            break;
        }

        attempt_count += 1;

        if let Some(ref plan) = route_plan {
            let fallback_index = attempt_count.saturating_sub(1);
            if let Some(fallback) = plan.fallbacks.get(fallback_index) {
                if let Some((_, _, fallback_provider)) = candidates
                    .iter()
                    .find(|(pn, mn, _)| pn == &fallback.provider_name && mn == &fallback.model_name)
                {
                    let failover_context = FailoverContext {
                        original_task: effective_prompt.clone(),
                        completed_steps: vec![],
                        tool_summary: vec![],
                        last_error: provider_response.clone().err(),
                        low_score_reasons: vec!["node scored low, switching model".to_string()],
                        workspace_summary: profile.evidence.clone(),
                        retained_facts: vec![],
                    };
                    let failover_section = failover_context.to_prompt_section();
                    let augmented_prompt = format!("{}\n\n{}", failover_section, effective_prompt);

                    let result = execute_with_provider(
                        fallback_provider,
                        &system_prompt,
                        &augmented_prompt,
                        tool_defs.clone(),
                        &tools,
                        &workdir,
                        mode,
                        approval,
                        max_iterations,
                        None::<F>,
                    )
                    .await;

                    provider_response = result.0;
                    pending_question = result.1;
                    usage = result.2;
                    api_duration_ms = result.3;
                    tool_duration_ms = result.4;

                    record_model_health(
                        &workdir,
                        &fallback.provider_name,
                        &fallback.model_name,
                        provider_response.is_ok(),
                        provider_response.as_ref().err().map(String::as_str),
                    );
                }
            }
        }
    }

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

    let state = match pending_question.as_ref() {
        Some(question)
            if question.get("kind").and_then(|value| value.as_str()) == Some("tool_approval") =>
        {
            TaskRunState::WaitingForApproval
        }
        Some(_) => TaskRunState::WaitingForUser,
        None if provider_response.is_ok() => TaskRunState::Completed,
        None => TaskRunState::Failed,
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

    let task_run = task_run_snapshot(
        None,
        mode,
        expanded_prompt.clone(),
        state.clone(),
        provider_response
            .as_ref()
            .ok()
            .cloned()
            .or_else(|| provider_response.as_ref().err().cloned()),
    );

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
        task_run,
    })
}

async fn execute_with_provider(
    provider: &sacode_kernel::model::ModelProvider,
    system_prompt: &str,
    user_prompt: &str,
    tool_defs: Vec<ToolDefinition>,
    tools: &ToolRegistry,
    workdir: &Path,
    mode: ExecutionMode,
    approval: ApprovalPolicy,
    max_iterations: usize,
    stream_handler: Option<impl FnMut(&str)>,
) -> (
    std::result::Result<String, String>,
    Option<serde_json::Value>,
    Option<ChatUsage>,
    u64,
    u64,
) {
    if provider.api_key.is_some()
        && provider
            .base_url
            .as_ref()
            .is_some_and(|value| !value.is_empty())
    {
        if tool_defs.is_empty() {
            let client = ProviderClient::new();
            let api_started_at = Instant::now();
            let result = if let Some(mut handler) = stream_handler {
                client
                    .simple_chat_streaming_with_usage(provider, user_prompt, |chunk| {
                        if !chunk.done {
                            handler(&chunk.content);
                        }
                    })
                    .await
            } else {
                client.simple_chat_with_usage(provider, user_prompt).await
            };
            match result {
                Ok((text, usage)) => (
                    Ok(text),
                    None,
                    usage,
                    elapsed_ms(api_started_at.elapsed()),
                    0,
                ),
                Err(error) => {
                    let _ = MistakeBookStore::new(workdir).append(
                        "provider:chat",
                        "主模型调用失败",
                        error.to_string(),
                    );
                    (
                        Err(error.to_string()),
                        None,
                        None,
                        elapsed_ms(api_started_at.elapsed()),
                        0,
                    )
                }
            }
        } else {
            run_tool_chat(
                provider,
                system_prompt,
                user_prompt,
                tool_defs,
                tools,
                workdir,
                mode,
                approval,
                max_iterations,
                stream_handler,
            )
            .await
        }
    } else {
        (
            Err("没有可用的 provider 配置，请先运行 /login 或 sacode init".to_string()),
            None,
            None,
            0,
            0,
        )
    }
}

async fn run_tool_chat(
    provider: &sacode_kernel::model::ModelProvider,
    system_prompt: &str,
    user_prompt: &str,
    tool_defs: Vec<ToolDefinition>,
    tools: &ToolRegistry,
    workdir: &Path,
    mode: ExecutionMode,
    approval: ApprovalPolicy,
    _max_iterations: usize,
    stream_handler: Option<impl FnMut(&str)>,
) -> (
    std::result::Result<String, String>,
    Option<serde_json::Value>,
    Option<ChatUsage>,
    u64,
    u64,
) {
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
        let needs_approval =
            spec.map(|s| s.needs_approval()).unwrap_or(false) || name.starts_with("mcp.");
        let requires_prompt_approval = needs_approval && mode == ExecutionMode::Build;

        if requires_prompt_approval {
            match approval {
                ApprovalPolicy::AutoApprove => {}
                ApprovalPolicy::AutoDeny => {
                    return Ok(serde_json::json!({ "error": "denied by policy" }))
                }
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

        if let Some(_spec) = spec {
            let tool_input = if name == "media.read" {
                enrich_media_read_args(args, &provider_for_tools)
            } else {
                args.clone()
            };
            let result = match tools_clone.execute(name, tool_input) {
                Ok(output) => Ok(if output.success {
                    output.data
                } else {
                    let _ = MistakeBookStore::new(&workdir_clone).append(
                        format!("tool:{}", name),
                        "工具执行失败",
                        output.message.clone().unwrap_or_default(),
                    );
                    serde_json::json!({ "error": output.message.unwrap_or_default() })
                }),
                Err(error) => {
                    if let Some(question) = build_permission_approval_question(
                        mode,
                        name,
                        args,
                        side_effect_level,
                        &error.to_string(),
                    ) {
                        tool_duration_for_executor.fetch_add(
                            elapsed_ms(tool_started_at.elapsed()),
                            std::sync::atomic::Ordering::Relaxed,
                        );
                        return Ok(question);
                    }
                    let _ = MistakeBookStore::new(&workdir_clone).append(
                        format!("tool:{}", name),
                        "工具执行异常",
                        error.to_string(),
                    );
                    Ok(serde_json::json!({ "error": error.to_string() }))
                }
            };
            tool_duration_for_executor.fetch_add(
                elapsed_ms(tool_started_at.elapsed()),
                std::sync::atomic::Ordering::Relaxed,
            );
            result
        } else {
            tool_duration_for_executor.fetch_add(
                elapsed_ms(tool_started_at.elapsed()),
                std::sync::atomic::Ordering::Relaxed,
            );
            Ok(serde_json::json!({ "error": format!("unknown tool: {}", name) }))
        }
    };

    let api_started_at = Instant::now();
    let result = if let Some(mut handler) = stream_handler {
        client
            .tool_chat_streaming(
                provider,
                system_prompt,
                user_prompt,
                tool_defs,
                tool_executor,
                &mut |chunk| {
                    if !chunk.done {
                        handler(&chunk.content);
                    }
                },
            )
            .await
    } else {
        client
            .tool_chat(
                provider,
                system_prompt,
                user_prompt,
                tool_defs,
                tool_executor,
            )
            .await
    };
    match result {
        Ok(result) => {
            let final_text = if result.final_text.trim().is_empty() {
                "工具调用已完成，但模型未生成总结，已返回工具结果摘要。".to_string()
            } else {
                result.final_text.trim().to_string()
            };
            (
                Ok(final_text),
                result.pending_question,
                result.usage,
                elapsed_ms(api_started_at.elapsed()),
                tool_duration.load(std::sync::atomic::Ordering::Relaxed),
            )
        }
        Err(error) => {
            let _ = MistakeBookStore::new(workdir).append(
                "provider:tool_chat",
                "模型 tool calling 循环失败",
                error.to_string(),
            );
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

fn build_permission_approval_question(
    mode: ExecutionMode,
    name: &str,
    args: &serde_json::Value,
    side_effect_level: SideEffectLevel,
    error: &str,
) -> Option<serde_json::Value> {
    if mode != ExecutionMode::Build {
        return None;
    }

    if !is_permission_restricted_error(error) {
        return None;
    }

    Some(serde_json::json!({
        "pending": true,
        "kind": "tool_approval",
        "question": format!("工具 {} 当前因权限受限无法继续，是否请求用户授权后重试？", name),
        "options": [
            {
                "label": "拒绝",
                "description": "保持当前权限范围并结束这次操作"
            },
            {
                "label": "允许一次",
                "description": "本次请求用户授权并继续执行当前操作"
            },
            {
                "label": "本会话总是允许",
                "description": "本会话内遇到同类权限申请时都继续请求授权"
            }
        ],
        "multiple": false,
        "tool_name": name,
        "side_effect_level": format_side_effect_level(side_effect_level),
        "args": args,
        "error": error,
    }))
}

fn is_permission_restricted_error(error: &str) -> bool {
    let lowered = error.to_lowercase();
    [
        "denied by policy",
        "permission denied",
        "blocked by sandbox policy",
        "network access blocked by sandbox policy",
        "path is blocked by sandbox policy",
        "working directory is blocked by sandbox policy",
        "outside workspace",
    ]
    .iter()
    .any(|needle| lowered.contains(needle))
}

fn enrich_media_read_args(
    args: &serde_json::Value,
    provider: &sacode_kernel::model::ModelProvider,
) -> serde_json::Value {
    let mut enriched = args.clone();
    let Some(object) = enriched.as_object_mut() else {
        return enriched;
    };

    if !object.contains_key("model") {
        object.insert(
            "model".to_string(),
            serde_json::Value::String(provider.model.clone()),
        );
    }
    if !object.contains_key("base_url") {
        if let Some(base_url) = provider.base_url.as_ref().filter(|value| !value.is_empty()) {
            object.insert(
                "base_url".to_string(),
                serde_json::Value::String(base_url.clone()),
            );
        }
    }
    if !object.contains_key("api_key") {
        if let Some(api_key) = provider.api_key.as_ref().filter(|value| !value.is_empty()) {
            object.insert(
                "api_key".to_string(),
                serde_json::Value::String(api_key.clone()),
            );
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
            if mode == ExecutionMode::Plan {
                let plan_allowed = spec.side_effect_level == SideEffectLevel::ReadOnly
                    || matches!(name.as_str(), "fs.search" | "web.search");
                if !plan_allowed {
                    continue;
                }
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

    lines.push(format!("State: {:?}", output.effective_state()));

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
        lines.push(format!(
            "  {}. {} [{:?}]",
            step.id, step.description, step.status
        ));
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
            Event::ToolCallFinished {
                name,
                success,
                output,
            } => {
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
            Event::ToolCallFinished {
                name,
                success,
                output,
            } => {
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

pub fn format_stream_tail(output: &RunnerOutput) -> String {
    let mut lines = vec![format!("State: {:?}", output.effective_state())];

    if let Some(question) = &output.pending_question {
        lines.push("Pending Question:".to_string());
        lines.push(summarize_tool_output(question));
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

    if !output.events.is_empty() {
        lines.push("Events:".to_string());
        for event in &output.events {
            match event {
                Event::ToolCallStarted { name, .. } => {
                    lines.push(format!("  TOOL_START: {}", name))
                }
                Event::ToolCallFinished {
                    name,
                    success,
                    output,
                } => {
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
    }

    lines.join("\n")
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
                payload.insert(
                    key.to_string(),
                    serde_json::Value::String(prompt.to_string()),
                );
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

fn preview(input: &str) -> String {
    let trimmed = input.trim();
    let mut chars = trimmed.chars();
    let preview: String = chars.by_ref().take(80).collect();
    if chars.next().is_some() {
        format!("{preview}...")
    } else {
        preview
    }
}

#[cfg(test)]
mod tests {
    use super::build_permission_approval_question;
    use super::build_tool_definitions;
    use super::enrich_media_read_args;
    use super::format_learned_facts_summary;
    use super::format_output;
    use super::format_stream_tail;
    use super::is_permission_restricted_error;
    use super::RunnerOutput;
    use super::TaskRunState;
    use crate::learning::{LearnedFact, LearnedKind};
    use sacode_kernel::model::ModelProvider;
    use sacode_kernel::{Event, ExecutionMode, ExecutionReport, Plan, TaskRun};
    use sacode_runtime::SideEffectLevel;
    use sacode_runtime::ToolRegistry;

    #[test]
    fn permission_restricted_error_detects_sandbox_failures() {
        assert!(is_permission_restricted_error(
            "path is blocked by sandbox policy"
        ));
        assert!(is_permission_restricted_error(
            "command 'git' is blocked by sandbox policy"
        ));
        assert!(is_permission_restricted_error("path is outside workspace"));
        assert!(!is_permission_restricted_error(
            "file not found: src/main.rs"
        ));
    }

    #[test]
    fn build_permission_approval_question_returns_tool_approval_payload() {
        let question = build_permission_approval_question(
            ExecutionMode::Build,
            "fs.read",
            &serde_json::json!({ "path": "/tmp/secret.txt" }),
            SideEffectLevel::ReadOnly,
            "path is blocked by sandbox policy",
        )
        .expect("should build approval payload");

        assert_eq!(
            question.get("kind").and_then(|value| value.as_str()),
            Some("tool_approval")
        );
        assert_eq!(
            question.get("tool_name").and_then(|value| value.as_str()),
            Some("fs.read")
        );
        assert_eq!(
            question
                .get("side_effect_level")
                .and_then(|value| value.as_str()),
            Some("read_only")
        );
        assert_eq!(
            question.get("error").and_then(|value| value.as_str()),
            Some("path is blocked by sandbox policy")
        );
    }

    #[test]
    fn build_permission_approval_question_skips_plan_mode() {
        let question = build_permission_approval_question(
            ExecutionMode::Plan,
            "fs.write",
            &serde_json::json!({ "path": "/tmp/out.txt" }),
            SideEffectLevel::Modify,
            "path is blocked by sandbox policy",
        );

        assert!(question.is_none());
    }

    #[test]
    fn build_tool_definitions_limits_plan_mode_to_read_and_search() {
        let registry = ToolRegistry::builtin();
        let tool_names = vec![
            "fs.read".to_string(),
            "fs.search".to_string(),
            "web.search".to_string(),
            "fs.write".to_string(),
            "shell.exec".to_string(),
        ];

        let defs = build_tool_definitions(&registry, &tool_names, ExecutionMode::Plan);
        let names = defs
            .iter()
            .map(|def| def.function.name.as_str())
            .collect::<Vec<_>>();

        assert!(names.contains(&"fs.read"));
        assert!(names.contains(&"fs.search"));
        assert!(names.contains(&"web.search"));
        assert!(!names.contains(&"fs.write"));
        assert!(!names.contains(&"shell.exec"));
    }

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
        assert_eq!(
            enriched.get("model").and_then(|value| value.as_str()),
            Some("gpt-4o")
        );
        assert_eq!(
            enriched.get("base_url").and_then(|value| value.as_str()),
            Some("https://api.openai.com/v1")
        );
        assert_eq!(
            enriched.get("api_key").and_then(|value| value.as_str()),
            Some("secret")
        );
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
        assert_eq!(
            enriched.get("model").and_then(|value| value.as_str()),
            Some("mimo-v2.5-pro")
        );
        assert_eq!(
            enriched.get("base_url").and_then(|value| value.as_str()),
            Some("https://custom.example/v1")
        );
        assert_eq!(
            enriched.get("api_key").and_then(|value| value.as_str()),
            Some("custom-key")
        );
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

    #[test]
    fn task_run_state_serializes_as_expected() {
        let value =
            serde_json::to_value(TaskRunState::WaitingForApproval).expect("serialize state");
        assert_eq!(value, serde_json::json!("WaitingForApproval"));
    }

    #[test]
    fn format_output_includes_explicit_task_state() {
        let output = RunnerOutput {
            prompt: "测试任务".to_string(),
            mode: ExecutionMode::Build,
            max_iterations: 1,
            tool_names: vec!["web.search".to_string()],
            workspace: "/workspace".to_string(),
            plan: Plan {
                task: "测试任务".to_string(),
                steps: Vec::new(),
                mode: "build".to_string(),
            },
            events: vec![Event::done("完成")],
            tool_results: Vec::new(),
            provider_response: Ok("已完成".to_string()),
            learned_facts: Vec::new(),
            pending_question: None,
            usage: None,
            api_duration_ms: 1,
            tool_duration_ms: 2,
            total_duration_ms: 3,
            task_run: TaskRun {
                mode: Some(ExecutionMode::Build),
                state: Some(TaskRunState::Completed),
                prompt: Some("测试任务".to_string()),
                ..TaskRun::default()
            },
        };

        let text = format_output(&output);
        assert!(text.contains("State: Completed"));
    }

    #[test]
    fn format_output_prefers_task_run_state_over_legacy_state() {
        let output = RunnerOutput {
            prompt: "测试任务".to_string(),
            mode: ExecutionMode::Build,
            max_iterations: 1,
            tool_names: vec!["web.search".to_string()],
            workspace: "/workspace".to_string(),
            plan: Plan {
                task: "测试任务".to_string(),
                steps: Vec::new(),
                mode: "build".to_string(),
            },
            events: vec![Event::done("完成")],
            tool_results: Vec::new(),
            provider_response: Ok("已完成".to_string()),
            learned_facts: Vec::new(),
            pending_question: None,
            usage: None,
            api_duration_ms: 1,
            tool_duration_ms: 2,
            total_duration_ms: 3,
            task_run: TaskRun {
                mode: Some(ExecutionMode::Build),
                state: Some(TaskRunState::Completed),
                prompt: Some("测试任务".to_string()),
                ..TaskRun::default()
            },
        };

        let text = format_output(&output);
        assert!(text.contains("State: Completed"));
    }

    #[test]
    fn format_stream_tail_omits_provider_response_body() {
        let output = RunnerOutput {
            prompt: "测试任务".to_string(),
            mode: ExecutionMode::Build,
            max_iterations: 1,
            tool_names: vec!["web.search".to_string()],
            workspace: "/workspace".to_string(),
            plan: Plan {
                task: "测试任务".to_string(),
                steps: Vec::new(),
                mode: "build".to_string(),
            },
            events: vec![Event::done("完成")],
            tool_results: Vec::new(),
            provider_response: Ok("这里是完整模型正文".to_string()),
            learned_facts: Vec::new(),
            pending_question: None,
            usage: None,
            api_duration_ms: 1,
            tool_duration_ms: 2,
            total_duration_ms: 3,
            task_run: TaskRun {
                mode: Some(ExecutionMode::Build),
                state: Some(TaskRunState::Completed),
                prompt: Some("测试任务".to_string()),
                ..TaskRun::default()
            },
        };

        let text = format_stream_tail(&output);
        assert!(text.contains("State: Completed"));
        assert!(!text.contains("Provider Response"));
        assert!(!text.contains("这里是完整模型正文"));
    }

    #[test]
    fn from_execution_report_populates_task_run_snapshot() {
        let report = ExecutionReport {
            final_output: Some("编排完成".to_string()),
            ..ExecutionReport::default()
        };

        let output = RunnerOutput::from_execution_report(
            &report,
            "测试任务".to_string(),
            ExecutionMode::Build,
            1,
            "/workspace".to_string(),
        );

        assert_eq!(output.task_run.state, Some(TaskRunState::Completed));
        assert_eq!(output.task_run.mode, Some(ExecutionMode::Build));
        assert_eq!(
            output
                .task_run
                .report
                .as_ref()
                .and_then(|r| r.final_output.clone()),
            Some("编排完成".to_string())
        );
    }
}
