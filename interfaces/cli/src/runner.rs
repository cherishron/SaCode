use std::{
    env,
    sync::Arc,
    time::{Duration, Instant},
};

use anyhow::Result;
use sacode_kernel::model::ChatUsage;
use sacode_kernel::{
    Event, ExecutionMode, ExecutionReport, TaskRun, TaskRunState,
};
use sacode_runtime::{
    build_runtime_system_prompt, infer_task_run_state, maybe_expand_skill_prompt,
    register_enabled_mcp_tools_sync, task_run_from_report, task_run_snapshot,
    ApprovalDecider, AutoApproveDecider, AutoDenyDecider, ErrorRecorder,
    McpConfigStore, PromptContext, PromptUserDecider, SandboxConfigStore, SandboxPolicy,
    SideEffectLevel, StreamEventKind as RuntimeStreamEventKind, StreamHandler,
    TaskProfile, TaskRunConfig, ToolRegistry,
    build_tool_definitions_filtered, enrich_media_provider_args, execute_task_with_failover,
    format_side_effect_level, is_permission_restricted_error,
};
use serde::Serialize;

/// CLI 层的流式事件类型，保持与原有接口兼容
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StreamEventKind {
    Message,
    Thinking,
}

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
    pub hit_round_limit: bool,
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
            hit_round_limit: false,
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
        None::<fn(StreamEventKind, &str)>,
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
    F: FnMut(StreamEventKind, &str) + Send + 'static,
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

    // 将 CLI 层 ApprovalPolicy 映射为 runtime 层 ApprovalDecider
    let approval_decider: Arc<dyn ApprovalDecider> = match approval {
        ApprovalPolicy::AutoApprove => Arc::new(AutoApproveDecider),
        ApprovalPolicy::AutoDeny => Arc::new(AutoDenyDecider),
        ApprovalPolicy::Prompt => Arc::new(PromptUserDecider),
    };

    // 将 MistakeBookStore 包装为 ErrorRecorder
    let error_recorder: Arc<dyn ErrorRecorder> = Arc::new(MistakeRecorder {
        workdir: workdir.clone(),
    });

    let config = TaskRunConfig {
        workdir: &workdir,
        mode,
        max_iterations,
        system_prompt,
        user_prompt: effective_prompt.clone(),
        provider: primary_provider,
        tools,
        approval: approval_decider,
        error_recorder,
    };

    // 构建流式输出适配器：将 CLI 层 StreamEventKind 转换为 runtime 层
    let runtime_stream_handler: Option<Box<dyn StreamHandler>> = stream_handler.map(|mut h| {
        Box::new(move |kind: RuntimeStreamEventKind, content: &str| {
            h(
                match kind {
                    RuntimeStreamEventKind::Message => StreamEventKind::Message,
                    RuntimeStreamEventKind::Thinking => StreamEventKind::Thinking,
                },
                content,
            );
        }) as Box<dyn StreamHandler>
    });

    // 模型健康记录回调
    let model_health_recorder = |workdir: &std::path::Path, provider_name: &str, model_name: &str, success: bool, error: Option<&str>| {
        record_model_health(workdir, provider_name, model_name, success, error);
    };

    // 使用统一的 TaskExecutor 执行（含 Failover）
    let task_run_result = execute_task_with_failover(
        &config,
        route_plan.as_ref(),
        &candidates,
        &profile,
        runtime_stream_handler,
        Some(&model_health_recorder),
    )
    .await;

    // 从 TaskRunResult 构建 RunnerOutput
    let plan = sacode_kernel::Plan {
        task: expanded_prompt.clone(),
        steps: Vec::new(),
        mode: mode.to_string(),
    };

    let learned_facts = if task_run_result.pending_question.is_none() {
        if let Ok(response) = &task_run_result.response {
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
        provider_response: task_run_result.response,
        learned_facts,
        pending_question: task_run_result.pending_question,
        usage: task_run_result.usage,
        hit_round_limit: task_run_result.hit_round_limit,
        api_duration_ms: task_run_result.api_duration_ms,
        tool_duration_ms: task_run_result.tool_duration_ms,
        total_duration_ms: elapsed_ms(total_started_at.elapsed()),
        task_run: task_run_result.task_run,
    })
}

// ── MistakeRecorder：将 MistakeBookStore 适配为 ErrorRecorder ──

/// CLI 层的 ErrorRecorder 实现，将错误记录到 MistakeBookStore
struct MistakeRecorder {
    workdir: std::path::PathBuf,
}

impl ErrorRecorder for MistakeRecorder {
    fn record_tool_error(&self, tool_name: &str, category: &str, detail: String) {
        let _ = MistakeBookStore::new(&self.workdir).append(tool_name, category, detail);
    }

    fn record_provider_error(&self, category: &str, detail: String) {
        let _ = MistakeBookStore::new(&self.workdir).append(category, "模型调用失败", detail);
    }
}

fn elapsed_ms(duration: Duration) -> u64 {
    duration.as_millis().min(u128::from(u64::MAX)) as u64
}

// ── 输出格式化 ──────────────────────────────────────────────────

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
    use super::format_learned_facts_summary;
    use super::format_output;
    use super::format_stream_tail;
    use super::RunnerOutput;
    use super::TaskRunState;
    use crate::learning::{LearnedFact, LearnedKind};
    use sacode_kernel::model::ModelProvider;
    use sacode_kernel::{Event, ExecutionMode, ExecutionReport, Plan, TaskRun};
    use sacode_runtime::SideEffectLevel;
    use sacode_runtime::ToolRegistry;
    use sacode_runtime::enrich_media_provider_args;
    use sacode_runtime::is_permission_restricted_error;
    use sacode_runtime::build_tool_definitions_filtered;

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
    fn build_tool_definitions_limits_plan_mode_to_read_and_search() {
        let registry = ToolRegistry::builtin();
        let tool_names = vec![
            "fs.read".to_string(),
            "fs.search".to_string(),
            "web.search".to_string(),
            "fs.write".to_string(),
            "shell.exec".to_string(),
        ];

        let defs = build_tool_definitions_filtered(&registry, Some(&tool_names), ExecutionMode::Plan);
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
    fn enrich_media_provider_args_injects_current_provider() {
        let provider = ModelProvider::openai("gpt-5.4")
            .with_api_key("secret")
            .with_base_url("https://api.openai.com/v1");
        let input = serde_json::json!({
            "path": ".sacode/pasted/test.png",
            "mode": "describe"
        });

        let enriched = enrich_media_provider_args(&input, &provider);
        assert_eq!(
            enriched.get("model").and_then(|value| value.as_str()),
            Some("gpt-5.4")
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
    fn enrich_media_provider_args_preserves_explicit_values() {
        let provider = ModelProvider::openai("gpt-5.4")
            .with_api_key("secret")
            .with_base_url("https://api.openai.com/v1");
        let input = serde_json::json!({
            "path": ".sacode/pasted/test.png",
            "mode": "ocr",
            "model": "mimo-v2.5-pro",
            "base_url": "https://custom.example/v1",
            "api_key": "custom-key"
        });

        let enriched = enrich_media_provider_args(&input, &provider);
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
    fn enrich_media_provider_args_works_for_media_vision() {
        let provider = ModelProvider::openai("gpt-5.4")
            .with_api_key("secret")
            .with_base_url("https://api.openai.com/v1");
        let input = serde_json::json!({
            "path": ".sacode/pasted/test.png",
            "mode": "describe",
            "prompt": "请描述图中报错"
        });

        let enriched = enrich_media_provider_args(&input, &provider);
        assert_eq!(
            enriched.get("model").and_then(|value| value.as_str()),
            Some("gpt-5.4")
        );
        assert_eq!(
            enriched.get("prompt").and_then(|value| value.as_str()),
            Some("请描述图中报错")
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
            hit_round_limit: false,
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
            hit_round_limit: false,
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
            hit_round_limit: false,
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
