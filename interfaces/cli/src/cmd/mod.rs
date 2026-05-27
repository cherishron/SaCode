mod acp;
mod checkpoint;
pub mod doctor;
pub mod diff;
pub mod hooks;
pub mod ide;
pub mod init;
pub mod insight;
pub mod keybindings;
mod lsp;
pub mod memory;
mod mistakes;
mod mcp;
mod plugin;
mod profile;
pub mod outstyle;
mod serve;
mod skill;
pub mod status;
pub mod vim;

use std::{env, io::IsTerminal};
#[cfg(test)]
use std::path::PathBuf;

use anyhow::Result;
use sacode_kernel::{ExecutionMode, ExecutionContext, Task, Supervisor};
pub use sacode_kernel::ApprovalPolicy;
use sacode_runtime::{RuntimeOrchestrator, CheckpointStorage, ToolRegistry, SandboxExecutor, SandboxPolicy};
#[cfg(test)]
use sacode_kernel::{Event, ToolCallIntent};
#[cfg(test)]
use sacode_runtime::{call_mcp_tool, ProviderClient};
use serde::Serialize;
use tokio::io::{self, AsyncReadExt};
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

#[cfg(test)]
use crate::mistakes::MistakeBookStore;
#[cfg(test)]
use crate::provider_runtime::resolve_provider;
use crate::repl::ReplSession;
use crate::runner::{format_output, run_task_with_stdin, RunnerOutput};
use crate::tui;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CliCommand {
    Run,
    Orchestrator,
    Profile,
    Plugin,
    Doctor,
    Diff,
    Hooks,
    Ide,
    Keybindings,
    Outstyle,
    Vim,
    Skill,
    Mcp,
    Acp,
    Lsp,
    Memory,
    Insight,
    Serve,
    Init,
    Mistakes,
    Repl,
    Tui,
    Checkpoint,
    Status,
    Help,
    Version,
}

#[derive(Debug, Clone)]
pub struct CliOptions {
    pub command: CliCommand,
    pub prompt: String,
    pub mode: ExecutionMode,
    pub max_iterations: usize,
    pub json: bool,
    pub approval: ApprovalPolicy,
    pub sub_args: Vec<String>,
}

#[derive(Debug, Serialize)]
struct CliResponse {
    prompt: String,
    mode: ExecutionMode,
    max_iterations: usize,
    tools: Vec<String>,
    workspace: String,
    plan: serde_json::Value,
    events: serde_json::Value,
    tool_results: serde_json::Value,
    stdin_preview: Option<String>,
    provider_response: Option<String>,
    usage: Option<sacode_kernel::model::ChatUsage>,
    api_duration_ms: u64,
    tool_duration_ms: u64,
    total_duration_ms: u64,
}

#[cfg(test)]
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
struct ToolResult {
    iteration: usize,
    step_id: usize,
    name: String,
    success: bool,
    summary: String,
}

#[cfg(test)]
#[derive(Debug, Clone)]
struct ExecutedTool {
    iteration: usize,
    step_id: usize,
    name: String,
    summary: String,
}

#[cfg(test)]
#[derive(Debug, Clone)]
struct LoopExecutionResult {
    final_events: Vec<Event>,
    tool_results: Vec<ToolResult>,
}

#[cfg(test)]
#[derive(Debug, Clone)]
struct StepEventBatch {
    events: Vec<Event>,
}

#[cfg(test)]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum RetryDecision {
    Retry,
    Stop,
}

pub async fn run() -> Result<()> {
    init_tracing();
    let options = parse_args(env::args().skip(1).collect());

    match options.command {
        CliCommand::Help => print_help(),
        CliCommand::Version => println!("sacode {}", env!("CARGO_PKG_VERSION")),
        CliCommand::Run => run_task(options).await?,
        CliCommand::Orchestrator => run_with_orchestrator(options).await?,
        CliCommand::Profile => profile::run(options.sub_args)?,
        CliCommand::Plugin => plugin::run(options.sub_args).await?,
        CliCommand::Doctor => doctor::run().await?,
        CliCommand::Diff => diff::run(options.sub_args)?,
        CliCommand::Hooks => hooks::run()?,
        CliCommand::Ide => ide::run(options.sub_args)?,
        CliCommand::Keybindings => keybindings::run()?,
        CliCommand::Outstyle => outstyle::run(options.sub_args)?,
        CliCommand::Skill => skill::run(options.sub_args).await?,
        CliCommand::Mcp => mcp::run(options.sub_args).await?,
        CliCommand::Acp => acp::run(options.sub_args).await?,
        CliCommand::Lsp => lsp::run(options.sub_args).await?,
        CliCommand::Memory => memory::run(options.sub_args)?,
        CliCommand::Insight => insight::run()?,
        CliCommand::Serve => serve::run(options.sub_args).await?,
        CliCommand::Init => {
            let mode = if options.sub_args.first().map(|value| value.as_str()) == Some("deep") {
                init::InitMode::Deep
            } else {
                init::InitMode::Basic
            };
            init::run(mode).await?
        }
        CliCommand::Mistakes => mistakes::run(options.sub_args)?,
        CliCommand::Repl => run_repl().await?,
        CliCommand::Tui => tui::run_tui()?,
        CliCommand::Checkpoint => checkpoint::run(options.sub_args)?,
        CliCommand::Status => status::run().await?,
        CliCommand::Vim => vim::run(options.sub_args)?,
    }

    Ok(())
}

async fn run_task(options: CliOptions) -> Result<()> {
    let stdin = read_stdin_if_needed().await?;
    let output = run_task_with_stdin(
        &options.prompt,
        options.mode,
        options.approval,
        options.max_iterations,
        stdin.clone(),
    ).await?;

    if options.json {
        let response = CliResponse {
            prompt: output.prompt.clone(),
            mode: output.mode,
            max_iterations: options.max_iterations,
            tools: output.tool_names.clone(),
            workspace: output.workspace.clone(),
            plan: serde_json::to_value(&output.plan)?,
            events: serde_json::to_value(&output.events)?,
            tool_results: serde_json::to_value(&output.tool_results)?,
            stdin_preview: stdin.map(|value| preview(&value)),
            provider_response: output.provider_response.clone().ok(),
            usage: output.usage.clone(),
            api_duration_ms: output.api_duration_ms,
            tool_duration_ms: output.tool_duration_ms,
            total_duration_ms: output.total_duration_ms,
        };
        println!("{}", serde_json::to_string_pretty(&response)?);
        return Ok(());
    }

    println!("{}", format_output(&output));

    if let Some(stdin) = stdin {
        println!("Stdin: {}", preview(&stdin));
    }

    Ok(())
}

async fn run_with_orchestrator(options: CliOptions) -> Result<()> {
    let workdir = env::current_dir()?;
    
    let task = Task::new(options.prompt.clone(), options.mode, None);
    let context = ExecutionContext::new(task).with_approval(options.approval);
    
    let supervisor = Supervisor::new();
    let tools = ToolRegistry::builtin();
    let sandbox = SandboxExecutor::new(SandboxPolicy::build());
    let checkpoints = CheckpointStorage::new(&workdir);
    
    let orchestrator = RuntimeOrchestrator::new(supervisor, tools, sandbox, checkpoints);
    let report = orchestrator.execute(&context)?;
    
    let output = RunnerOutput::from_execution_report(
        &report,
        options.prompt.clone(),
        options.mode,
        options.max_iterations,
        workdir.to_string_lossy().to_string(),
    );
    
    println!("{}", format_output(&output));
    
    Ok(())
}

#[cfg(test)]
fn maybe_expand_skill_prompt(prompt: &str, workdir: &std::path::Path) -> Result<String> {
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

#[cfg(test)]
async fn execute_tool(registry: &ToolRegistry, intent: &ToolCallIntent, approval: ApprovalPolicy) -> Result<sacode_runtime::tools::ToolOutput> {
    if intent.requires_approval {
        if matches!(intent.name.as_str(), "shell.exec") || intent.name.starts_with("mcp.") {
            match approval {
                ApprovalPolicy::AutoApprove => {}
                ApprovalPolicy::AutoDeny => {
                    return Ok(sacode_runtime::tools::ToolOutput::failure("denied by policy"));
                }
                ApprovalPolicy::Prompt => {
                    println!("Approval required for: {}", intent.name);
                    println!("Press 'y' to approve, 'n' to deny: ");
                    use std::io::{stdin, BufRead};
                    let mut lines = stdin().lock().lines();
                    if let Some(Ok(line)) = lines.next() {
                        if line.trim() != "y" {
                            return Ok(sacode_runtime::tools::ToolOutput::failure("denied by user"));
                        }
                    } else {
                        return Ok(sacode_runtime::tools::ToolOutput::failure("no approval input"));
                    }
                }
            }
        }
    }

    if intent.name == "web.search" {
        let store = sacode_runtime::McpConfigStore::new(&PathBuf::from("."));
        if let Ok(Some((server_name, tool_name))) = sacode_runtime::find_enabled_search_tool(&store).await {
            let server = store.get(&server_name)?;
            let result = call_mcp_tool(&server, &tool_name, intent.input.clone()).await?;
            return Ok(sacode_runtime::tools::ToolOutput {
                success: !result.is_error,
                data: serde_json::json!({
                    "content": result.content,
                    "server": server_name,
                    "tool": tool_name,
                    "source": "mcp",
                }),
                message: Some(if result.is_error {
                    "mcp search returned error".to_string()
                } else {
                    "mcp search executed".to_string()
                }),
            });
        }
    }

    if let Some((server_name, tool_name)) = parse_mcp_tool_name(&intent.name) {
        let store = sacode_runtime::McpConfigStore::new(&PathBuf::from("."));
        let server = store.get(server_name)?;
        let result = call_mcp_tool(&server, tool_name, intent.input.clone()).await?;
        return Ok(sacode_runtime::tools::ToolOutput {
            success: !result.is_error,
            data: serde_json::json!({
                "content": result.content,
                "server": server_name,
                "tool": tool_name,
            }),
            message: Some(if result.is_error {
                "mcp tool returned error".to_string()
            } else {
                "mcp tool executed".to_string()
            }),
        });
    }

    let registry = registry.clone();
    let tool_name = intent.name.clone();
    let tool_input = intent.input.clone();

    tokio::task::spawn_blocking(move || registry.execute(&tool_name, tool_input)).await?
}

#[cfg(test)]
async fn execute_tool_loop(
    tools: &ToolRegistry,
    workdir: &std::path::Path,
    checkpoint: &mut sacode_kernel::Checkpoint,
    base_events: &[Event],
    tool_calls: &[(usize, Vec<ToolCallIntent>)],
    approval: ApprovalPolicy,
    max_iterations: usize,
) -> LoopExecutionResult {
    let mut executed_tools = Vec::new();
    let mut step_event_batches = Vec::new();

    for (step_id, intents) in tool_calls {
        if intents.is_empty() {
            continue;
        }

        let mut iteration = 1;
        let mut pending = intents.clone();
        let mut step_events = Vec::new();

        while !pending.is_empty() && iteration <= max_iterations {
            checkpoint.set_iteration(iteration);
            step_events.push(Event::message(format!(
                "步骤 {} 开始第 {} 轮执行，待处理 {} 个工具调用",
                step_id,
                iteration,
                pending.len()
            )));

            let current_batch = std::mem::take(&mut pending);
            let mut retry_batch = Vec::new();

            for intent in current_batch {
                step_events.push(Event::ToolCallStarted {
                    name: intent.name.clone(),
                    input: intent.input.clone(),
                });

                let tool_result = execute_tool(tools, &intent, approval).await;
                let (success, summary, output_data) = match tool_result {
                    Ok(output) => (
                        output.success,
                        output.message.clone().unwrap_or_else(|| "ok".to_string()),
                        output.data.clone(),
                    ),
                    Err(e) => (false, e.to_string(), serde_json::json!(null)),
                };
                let retry_decision = should_retry_tool_call(&intent, &summary);

                step_events.push(Event::ToolCallFinished {
                    name: intent.name.clone(),
                    output: output_data.clone(),
                    success,
                });
                checkpoint.record_tool(intent.name.clone(), intent.input.clone(), output_data, success);
                executed_tools.push(ExecutedTool {
                    iteration,
                    step_id: *step_id,
                    name: intent.name.clone(),
                    summary,
                });

                if !success {
                    let _ = MistakeBookStore::new(workdir).append(
                        format!("tool:{}", intent.name),
                        format!("步骤 {} 第 {} 轮工具执行失败", step_id, iteration),
                        executed_tools.last().map(|tool| tool.summary.clone()).unwrap_or_default(),
                    );
                }

                if success {
                    checkpoint.advance_step();
                } else if iteration < max_iterations && retry_decision == RetryDecision::Retry {
                    retry_batch.push(intent);
                }
            }

            if !retry_batch.is_empty() {
                step_events.push(Event::message(format!(
                    "步骤 {} 第 {} 轮结束，{} 个工具调用将进入下一轮重试",
                    step_id,
                    iteration,
                    retry_batch.len()
                )));
            }

            pending = retry_batch;
            iteration += 1;
        }

        if !pending.is_empty() {
            step_events.push(Event::error(format!(
                "步骤 {} 达到最大迭代次数 {}，仍有 {} 个工具调用失败",
                step_id,
                max_iterations,
                pending.len()
            )));
        }

        step_event_batches.push(StepEventBatch { events: step_events });
    }

    let final_events = resolve_tool_events(base_events, &step_event_batches);
    let tool_results = collect_tool_results(&final_events, &executed_tools);

    LoopExecutionResult {
        final_events,
        tool_results,
    }
}

#[cfg(test)]
fn parse_mcp_tool_name(name: &str) -> Option<(&str, &str)> {
    let rest = name.strip_prefix("mcp.")?;
    let (server, tool) = rest.split_once('.')?;
    Some((server, tool))
}

#[cfg(test)]
async fn inject_matching_mcp_tools(
    workdir: &std::path::Path,
    prompt: &str,
    result: &mut sacode_kernel::agent::ExecutionResult,
) {
    let store = sacode_runtime::McpConfigStore::new(workdir);
    let specs = match sacode_runtime::list_enabled_mcp_tool_specs(&store).await {
        Ok(specs) => specs,
        Err(_) => return,
    };

    let matched = select_relevant_mcp_specs(prompt, &specs);
    if matched.is_empty() {
        return;
    }

    let Some(step_id) = result
        .output
        .plan
        .steps
        .iter()
        .find(|step| step.tools.iter().any(|tool| tool == "shell.exec" || tool == "git.diff"))
        .map(|step| step.id)
        .or_else(|| result.output.plan.steps.last().map(|step| step.id))
    else {
        return;
    };

    let Some(step) = result.output.plan.steps.iter_mut().find(|step| step.id == step_id) else {
        return;
    };

    let existing: std::collections::BTreeSet<String> = step.tools.iter().cloned().collect();
    let mut inserted_intents = Vec::new();
    for spec in matched {
        if existing.contains(&spec.name) {
            continue;
        }
        step.tools.push(spec.name.clone());
        inserted_intents.push(ToolCallIntent {
            name: spec.name.clone(),
            input: build_mcp_input(&spec.input_schema, prompt),
            requires_approval: true,
        });
    }

    if inserted_intents.is_empty() {
        return;
    }

    if let Some((_, intents)) = result.tool_calls.iter_mut().find(|(id, _)| *id == step_id) {
        intents.extend(inserted_intents.clone());
    } else {
        result.tool_calls.push((step_id, inserted_intents.clone()));
    }

    let mut placeholder_events = Vec::new();
    placeholder_events.push(Event::message(format!(
        "为步骤 {} 自动注入 {} 个已启用 MCP 工具",
        step_id,
        inserted_intents.len()
    )));
    for intent in inserted_intents {
        placeholder_events.push(Event::ToolCallStarted {
            name: intent.name,
            input: intent.input,
        });
    }
    insert_events_before_done(&mut result.output.events, placeholder_events);
}

#[cfg(test)]
fn insert_events_before_done(events: &mut Vec<Event>, extra: Vec<Event>) {
    if let Some(index) = events.iter().rposition(|event| matches!(event, Event::Done { .. })) {
        events.splice(index..index, extra);
    } else {
        events.extend(extra);
    }
}

#[cfg(test)]
fn select_relevant_mcp_specs(prompt: &str, specs: &[sacode_runtime::tools::ToolSpec]) -> Vec<sacode_runtime::tools::ToolSpec> {
    let lower_prompt = prompt.to_lowercase();
    let mut matched = Vec::new();

    for spec in specs {
        let tool_tail = spec.name.split('.').next_back().unwrap_or_default().to_lowercase();
        let desc = spec.description.to_lowercase();
        let looks_relevant = lower_prompt.contains(&tool_tail)
            || tool_tail.contains("search") && ["搜索", "联网", "web", "search", "docs", "文档"].iter().any(|needle| lower_prompt.contains(&needle.to_lowercase()))
            || desc.contains("search") && ["搜索", "联网", "web", "search", "docs", "文档"].iter().any(|needle| lower_prompt.contains(&needle.to_lowercase()));
        if looks_relevant {
            matched.push(spec.clone());
        }
    }

    matched.truncate(3);
    matched
}

#[cfg(test)]
fn build_mcp_input(schema: &serde_json::Value, prompt: &str) -> serde_json::Value {
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

#[cfg(test)]
fn should_retry_tool_call(intent: &ToolCallIntent, summary: &str) -> RetryDecision {
    let retryable_tool = intent.name == "web.search" || intent.name.starts_with("mcp.");
    if !retryable_tool {
        return RetryDecision::Stop;
    }

    let summary = summary.to_lowercase();
    let non_retryable = [
        "denied by policy",
        "denied by user",
        "no approval input",
        "not found",
        "unsupported",
        "invalid",
    ];
    if non_retryable.iter().any(|needle| summary.contains(needle)) {
        return RetryDecision::Stop;
    }

    RetryDecision::Retry
}

#[cfg(test)]
fn summarize_tool_output(output: &serde_json::Value) -> String {
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

#[cfg(test)]
fn resolve_tool_events(
    events: &[Event],
    step_event_batches: &[StepEventBatch],
) -> Vec<Event> {
    let mut step_batches = step_event_batches.iter();
    let mut final_events = Vec::new();
    let mut index = 0;

    while index < events.len() {
        let event = &events[index];

        if matches!(event, Event::ToolCallStarted { .. }) {
            while index < events.len() && matches!(events[index], Event::ToolCallStarted { .. }) {
                index += 1;
            }

            if let Some(batch) = step_batches.next() {
                final_events.extend(batch.events.iter().cloned());
            }

            continue;
        }

        final_events.push(event.clone());
        index += 1;
    }

    final_events
}

#[cfg(test)]
fn collect_tool_results(
    final_events: &[Event],
    executed_tools: &[ExecutedTool],
) -> Vec<ToolResult> {
    let completed_tools: Vec<(String, bool)> = final_events
        .iter()
        .filter_map(|event| match event {
            Event::ToolCallFinished { name, success, .. } => Some((name.clone(), *success)),
            _ => None,
        })
        .collect();

    executed_tools
        .iter()
        .zip(completed_tools)
        .map(|(executed_tool, (actual_name, success))| {
            let name = if actual_name == executed_tool.name {
                actual_name
            } else {
                executed_tool.name.clone()
            };
            ToolResult {
                iteration: executed_tool.iteration,
                step_id: executed_tool.step_id,
                name,
                success,
                summary: executed_tool.summary.clone(),
            }
        })
        .collect()
}

#[cfg(test)]
async fn call_provider(prompt: &str) -> Result<String> {
    let provider = resolve_provider(&env::current_dir()?);

    let client = ProviderClient::new();

    match client.simple_chat(&provider, prompt).await {
        Ok(response) => Ok(response),
        Err(e) => {
            Ok(format!("(Provider call failed: {})", e))
        }
    }
}

async fn run_repl() -> Result<()> {
    println!("SaCode REPL");
    println!("Type '/help' for commands, '/exit' to quit.");
    println!();

    let mut session = ReplSession::new();
    session.run().await?;

    Ok(())
}

fn parse_args(args: Vec<String>) -> CliOptions {
    if args.is_empty() {
        return CliOptions {
            command: CliCommand::Tui,
            prompt: String::new(),
            mode: ExecutionMode::Build,
            max_iterations: 1,
            json: false,
            approval: ApprovalPolicy::Prompt,
            sub_args: Vec::new(),
        };
    }

    let first = args[0].as_str();
    if first == "profile" {
        return CliOptions {
            command: CliCommand::Profile,
            prompt: String::new(),
            mode: ExecutionMode::Build,
            max_iterations: 1,
            json: false,
            approval: ApprovalPolicy::Prompt,
            sub_args: args[1..].to_vec(),
        };
    }

    if first == "plugin" {
        return CliOptions {
            command: CliCommand::Plugin,
            prompt: String::new(),
            mode: ExecutionMode::Build,
            max_iterations: 1,
            json: false,
            approval: ApprovalPolicy::Prompt,
            sub_args: args[1..].to_vec(),
        };
    }

    if first == "doctor" {
        return CliOptions {
            command: CliCommand::Doctor,
            prompt: String::new(),
            mode: ExecutionMode::Build,
            max_iterations: 1,
            json: false,
            approval: ApprovalPolicy::Prompt,
            sub_args: args[1..].to_vec(),
        };
    }

    if first == "diff" {
        return CliOptions {
            command: CliCommand::Diff,
            prompt: String::new(),
            mode: ExecutionMode::Build,
            max_iterations: 1,
            json: false,
            approval: ApprovalPolicy::Prompt,
            sub_args: args[1..].to_vec(),
        };
    }

    if first == "hooks" {
        return CliOptions {
            command: CliCommand::Hooks,
            prompt: String::new(),
            mode: ExecutionMode::Build,
            max_iterations: 1,
            json: false,
            approval: ApprovalPolicy::Prompt,
            sub_args: args[1..].to_vec(),
        };
    }

    if first == "ide" {
        return CliOptions {
            command: CliCommand::Ide,
            prompt: String::new(),
            mode: ExecutionMode::Build,
            max_iterations: 1,
            json: false,
            approval: ApprovalPolicy::Prompt,
            sub_args: args[1..].to_vec(),
        };
    }

    if first == "keybindings" {
        return CliOptions {
            command: CliCommand::Keybindings,
            prompt: String::new(),
            mode: ExecutionMode::Build,
            max_iterations: 1,
            json: false,
            approval: ApprovalPolicy::Prompt,
            sub_args: args[1..].to_vec(),
        };
    }

    if first == "outstyle" {
        return CliOptions {
            command: CliCommand::Outstyle,
            prompt: String::new(),
            mode: ExecutionMode::Build,
            max_iterations: 1,
            json: false,
            approval: ApprovalPolicy::Prompt,
            sub_args: args[1..].to_vec(),
        };
    }

    if first == "vim" {
        return CliOptions {
            command: CliCommand::Vim,
            prompt: String::new(),
            mode: ExecutionMode::Build,
            max_iterations: 1,
            json: false,
            approval: ApprovalPolicy::Prompt,
            sub_args: args[1..].to_vec(),
        };
    }

    if first == "skill" {
        return CliOptions {
            command: CliCommand::Skill,
            prompt: String::new(),
            mode: ExecutionMode::Build,
            max_iterations: 1,
            json: false,
            approval: ApprovalPolicy::Prompt,
            sub_args: args[1..].to_vec(),
        };
    }

    if first == "mcp" {
        return CliOptions {
            command: CliCommand::Mcp,
            prompt: String::new(),
            mode: ExecutionMode::Build,
            max_iterations: 1,
            json: false,
            approval: ApprovalPolicy::Prompt,
            sub_args: args[1..].to_vec(),
        };
    }

    if first == "memory" {
        return CliOptions {
            command: CliCommand::Memory,
            prompt: String::new(),
            mode: ExecutionMode::Build,
            max_iterations: 1,
            json: false,
            approval: ApprovalPolicy::Prompt,
            sub_args: args[1..].to_vec(),
        };
    }

    if first == "insight" {
        return CliOptions {
            command: CliCommand::Insight,
            prompt: String::new(),
            mode: ExecutionMode::Build,
            max_iterations: 1,
            json: false,
            approval: ApprovalPolicy::Prompt,
            sub_args: args[1..].to_vec(),
        };
    }

    if first == "acp" {
        return CliOptions {
            command: CliCommand::Acp,
            prompt: String::new(),
            mode: ExecutionMode::Build,
            max_iterations: 1,
            json: false,
            approval: ApprovalPolicy::Prompt,
            sub_args: args[1..].to_vec(),
        };
    }

    if first == "lsp" {
        return CliOptions {
            command: CliCommand::Lsp,
            prompt: String::new(),
            mode: ExecutionMode::Build,
            max_iterations: 1,
            json: false,
            approval: ApprovalPolicy::Prompt,
            sub_args: args[1..].to_vec(),
        };
    }

    if first == "serve" {
        return CliOptions {
            command: CliCommand::Serve,
            prompt: String::new(),
            mode: ExecutionMode::Build,
            max_iterations: 1,
            json: false,
            approval: ApprovalPolicy::Prompt,
            sub_args: args[1..].to_vec(),
        };
    }

    if first == "init" {
        return CliOptions {
            command: CliCommand::Init,
            prompt: String::new(),
            mode: ExecutionMode::Build,
            max_iterations: 1,
            json: false,
            approval: ApprovalPolicy::Prompt,
            sub_args: args[1..].to_vec(),
        };
    }

    if first == "init-deep" {
        return CliOptions {
            command: CliCommand::Init,
            prompt: String::new(),
            mode: ExecutionMode::Build,
            max_iterations: 1,
            json: false,
            approval: ApprovalPolicy::Prompt,
            sub_args: vec!["deep".to_string()],
        };
    }

    if first == "mistakes" {
        return CliOptions {
            command: CliCommand::Mistakes,
            prompt: String::new(),
            mode: ExecutionMode::Build,
            max_iterations: 1,
            json: false,
            approval: ApprovalPolicy::Prompt,
            sub_args: args[1..].to_vec(),
        };
    }

    if first == "repl" {
        return CliOptions {
            command: CliCommand::Repl,
            prompt: String::new(),
            mode: ExecutionMode::Build,
            max_iterations: 1,
            json: false,
            approval: ApprovalPolicy::Prompt,
            sub_args: Vec::new(),
        };
    }

    if first == "tui" {
        return CliOptions {
            command: CliCommand::Tui,
            prompt: String::new(),
            mode: ExecutionMode::Build,
            max_iterations: 1,
            json: false,
            approval: ApprovalPolicy::Prompt,
            sub_args: Vec::new(),
        };
    }

    if first == "checkpoint" {
        return CliOptions {
            command: CliCommand::Checkpoint,
            prompt: String::new(),
            mode: ExecutionMode::Build,
            max_iterations: 1,
            json: false,
            approval: ApprovalPolicy::Prompt,
            sub_args: args[1..].to_vec(),
        };
    }

    if first == "status" {
        return CliOptions {
            command: CliCommand::Status,
            prompt: String::new(),
            mode: ExecutionMode::Build,
            max_iterations: 1,
            json: false,
            approval: ApprovalPolicy::Prompt,
            sub_args: args[1..].to_vec(),
        };
    }

    if first == "orchestrator" {
        return CliOptions {
            command: CliCommand::Orchestrator,
            prompt: args[1..].join(" "),
            mode: ExecutionMode::Build,
            max_iterations: 1,
            json: false,
            approval: ApprovalPolicy::Prompt,
            sub_args: Vec::new(),
        };
    }

    let mut command = CliCommand::Run;
    let mut prompt = Vec::new();
    let mut mode = ExecutionMode::Build;
    let mut max_iterations = 1;
    let mut json = false;
    let mut approval = ApprovalPolicy::Prompt;

    let mut iter = args.into_iter();
    while let Some(arg) = iter.next() {
        match arg.as_str() {
            "-h" | "--help" => command = CliCommand::Help,
            "-V" | "--version" => command = CliCommand::Version,
            "--json" => json = true,
            "--approve" => approval = ApprovalPolicy::AutoApprove,
            "--deny" => approval = ApprovalPolicy::AutoDeny,
            "--mode" => {
                if let Some(value) = iter.next() {
                    mode = match value.as_str() {
                        "plan" => ExecutionMode::Plan,
                        "yolo" => ExecutionMode::Yolo,
                        _ => ExecutionMode::Build,
                    };
                }
            }
            "--max-iterations" => {
                if let Some(value) = iter.next() {
                    max_iterations = value.parse::<usize>().ok().filter(|value| *value > 0).unwrap_or(1);
                }
            }
            value => prompt.push(value.to_string()),
        }
    }

    CliOptions {
        command,
        prompt: prompt.join(" "),
        mode,
        max_iterations,
        json,
        approval: if json && approval == ApprovalPolicy::Prompt {
            ApprovalPolicy::AutoDeny
        } else {
            approval
        },
        sub_args: Vec::new(),
    }
}

async fn read_stdin_if_needed() -> Result<Option<String>> {
    if std::io::stdin().is_terminal() {
        return Ok(None);
    }

    let mut buffer = String::new();
    io::stdin().read_to_string(&mut buffer).await?;
    if buffer.trim().is_empty() {
        return Ok(None);
    }

    Ok(Some(buffer))
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

fn print_help() {
    println!("SaCode");
    println!();
    println!("Usage:");
    println!("  sacode \"<task>\" [--mode plan|build|yolo] [--max-iterations N] [--json] [--approve|--deny]");
    println!("  sacode orchestrator \"<task>\"");
    println!("  sacode profile [ls|use <name>|show]");
    println!("  sacode plugin [list]");
    println!("  sacode doctor");
    println!("  sacode diff [--cached]");
    println!("  sacode hooks");
    println!("  sacode ide [status|vscode|cursor|jetbrains|config show|path|set acp|lsp --host HOST --port PORT]");
    println!("  sacode keybindings");
    println!("  sacode outstyle [show|concise|explain|teach|clear|path|project ...]");
    println!("  sacode vim [show|on|off|project show|on|off]");
    println!("  sacode skill [search|install|list|show|update|remove|run]");
    println!("  sacode mcp [search|install|list|show|enable|disable|remove|inspect|tools|call]");
    println!("  sacode memory [show|search <query>|append <content>|path|summary]");
    println!("  sacode insight");
    println!("  sacode acp [serve|status] [--host HOST] [--port PORT]");
    println!("  sacode lsp [serve|status] [--tcp] [--host HOST] [--port PORT]");
    println!("  sacode serve [--acp] [--lsp]");
    println!("  sacode init       # 轻量初始化，识别技术栈和基础项目信息");
    println!("  sacode init-deep  # 深度初始化，生成严格协作配置和工作流");
    println!("  sacode mistakes [list|show <index>]");
    println!("  sacode status");
    println!("  sacode repl");
    println!("  sacode tui");
    println!("  sacode --help");
    println!("  sacode --version");
}

fn init_tracing() {
    let _ = tracing_subscriber::registry()
        .with(tracing_subscriber::EnvFilter::from_default_env())
        .with(tracing_subscriber::fmt::layer().without_time())
        .try_init();
}

#[cfg(test)]
mod tests {
    use super::{parse_args, preview, CliCommand};
    use sacode_kernel::{Event, ExecutionMode};

    #[test]
    fn parse_args_returns_tui_when_empty() {
        let options = parse_args(Vec::new());

        assert_eq!(options.command, CliCommand::Tui);
        assert!(options.prompt.is_empty());
        assert_eq!(options.mode, ExecutionMode::Build);
        assert!(!options.json);
    }

    #[test]
    fn parse_args_parses_run_mode_and_json() {
        let options = parse_args(vec![
            "分析代码结构".to_string(),
            "--mode".to_string(),
            "plan".to_string(),
            "--json".to_string(),
        ]);

        assert_eq!(options.command, CliCommand::Run);
        assert_eq!(options.prompt, "分析代码结构");
        assert_eq!(options.mode, ExecutionMode::Plan);
        assert_eq!(options.max_iterations, 1);
        assert!(options.json);
        assert_eq!(options.approval, super::ApprovalPolicy::AutoDeny);
    }

    #[test]
    fn parse_args_supports_max_iterations() {
        let options = parse_args(vec![
            "执行任务".to_string(),
            "--max-iterations".to_string(),
            "3".to_string(),
        ]);

        assert_eq!(options.max_iterations, 3);
    }

    #[test]
    fn parse_args_supports_auto_approve() {
        let options = parse_args(vec![
            "执行任务".to_string(),
            "--approve".to_string(),
        ]);

        assert_eq!(options.approval, super::ApprovalPolicy::AutoApprove);
    }

    #[test]
    fn parse_args_parses_subcommands() {
        let options = parse_args(vec!["checkpoint".to_string(), "list".to_string()]);

        assert_eq!(options.command, CliCommand::Checkpoint);
        assert_eq!(options.sub_args, vec!["list".to_string()]);
    }

    #[test]
    fn parse_args_parses_doctor_subcommand() {
        let options = parse_args(vec!["doctor".to_string()]);

        assert_eq!(options.command, CliCommand::Doctor);
        assert!(options.sub_args.is_empty());
    }

    #[test]
    fn parse_args_parses_diff_subcommand() {
        let options = parse_args(vec!["diff".to_string(), "--cached".to_string()]);

        assert_eq!(options.command, CliCommand::Diff);
        assert_eq!(options.sub_args, vec!["--cached".to_string()]);
    }

    #[test]
    fn parse_args_parses_hooks_subcommand() {
        let options = parse_args(vec!["hooks".to_string()]);

        assert_eq!(options.command, CliCommand::Hooks);
    }

    #[test]
    fn parse_args_parses_ide_subcommand() {
        let options = parse_args(vec!["ide".to_string(), "status".to_string()]);

        assert_eq!(options.command, CliCommand::Ide);
        assert_eq!(options.sub_args, vec!["status".to_string()]);
    }

    #[test]
    fn parse_args_parses_outstyle_subcommand() {
        let options = parse_args(vec!["outstyle".to_string(), "teach".to_string()]);

        assert_eq!(options.command, CliCommand::Outstyle);
        assert_eq!(options.sub_args, vec!["teach".to_string()]);
    }

    #[test]
    fn parse_args_parses_skill_subcommand() {
        let options = parse_args(vec!["skill".to_string(), "list".to_string()]);

        assert_eq!(options.command, CliCommand::Skill);
        assert_eq!(options.sub_args, vec!["list".to_string()]);
    }

    #[test]
    fn parse_args_parses_mcp_subcommand() {
        let options = parse_args(vec!["mcp".to_string(), "list".to_string()]);

        assert_eq!(options.command, CliCommand::Mcp);
        assert_eq!(options.sub_args, vec!["list".to_string()]);
    }

    #[test]
    fn parse_args_parses_memory_subcommand() {
        let options = parse_args(vec!["memory".to_string(), "show".to_string()]);

        assert_eq!(options.command, CliCommand::Memory);
        assert_eq!(options.sub_args, vec!["show".to_string()]);
    }

    #[test]
    fn parse_args_parses_insight_subcommand() {
        let options = parse_args(vec!["insight".to_string()]);

        assert_eq!(options.command, CliCommand::Insight);
        assert!(options.sub_args.is_empty());
    }

    #[test]
    fn parse_args_parses_acp_subcommand() {
        let options = parse_args(vec!["acp".to_string(), "serve".to_string()]);

        assert_eq!(options.command, CliCommand::Acp);
        assert_eq!(options.sub_args, vec!["serve".to_string()]);
    }

    #[test]
    fn parse_args_parses_lsp_subcommand() {
        let options = parse_args(vec!["lsp".to_string(), "serve".to_string()]);

        assert_eq!(options.command, CliCommand::Lsp);
        assert_eq!(options.sub_args, vec!["serve".to_string()]);
    }

    #[test]
    fn parse_args_parses_serve_subcommand() {
        let options = parse_args(vec!["serve".to_string(), "--acp".to_string(), "--lsp".to_string()]);

        assert_eq!(options.command, CliCommand::Serve);
        assert_eq!(options.sub_args, vec!["--acp".to_string(), "--lsp".to_string()]);
    }

    #[test]
    fn parse_args_parses_mistakes_subcommand() {
        let options = parse_args(vec!["mistakes".to_string(), "list".to_string()]);

        assert_eq!(options.command, CliCommand::Mistakes);
        assert_eq!(options.sub_args, vec!["list".to_string()]);
    }

    #[test]
    fn parse_args_parses_status_subcommand() {
        let options = parse_args(vec!["status".to_string()]);

        assert_eq!(options.command, CliCommand::Status);
        assert!(options.sub_args.is_empty());
    }

    #[test]
    fn build_mcp_input_prefers_query_like_fields() {
        let schema = serde_json::json!({
            "type": "object",
            "properties": {
                "query": { "type": "string" },
                "limit": { "type": "integer" }
            }
        });

        let input = super::build_mcp_input(&schema, "rust async");
        assert_eq!(input, serde_json::json!({ "query": "rust async" }));
    }

    #[test]
    fn preview_truncates_long_input() {
        let input = "a".repeat(100);
        let preview_text = preview(&input);

        assert_eq!(preview_text.len(), 83);
        assert!(preview_text.ends_with("..."));
    }

    #[test]
    fn parse_mcp_tool_name_extracts_server_and_tool() {
        let parsed = super::parse_mcp_tool_name("mcp.exa.search");
        assert_eq!(parsed, Some(("exa", "search")));
    }

    #[test]
    fn parse_mcp_tool_name_rejects_non_mcp_name() {
        let parsed = super::parse_mcp_tool_name("web.search");
        assert_eq!(parsed, None);
    }

    #[test]
    fn resolve_tool_events_inserts_finished_after_started() {
        let events = vec![
            Event::thinking("准备执行步骤 1"),
            Event::ToolCallStarted {
                name: "web.search".to_string(),
                input: serde_json::json!({ "query": "rust async" }),
            },
            Event::message("步骤 1 已记录"),
        ];

        let resolved = super::resolve_tool_events(
            &events,
            &[super::StepEventBatch {
                events: vec![
                    Event::ToolCallStarted {
                        name: "web.search".to_string(),
                        input: serde_json::json!({ "query": "rust async" }),
                    },
                    Event::ToolCallFinished {
                        name: "web.search".to_string(),
                        output: serde_json::json!({ "items": ["doc"] }),
                        success: true,
                    },
                ],
            }],
        );

        assert!(matches!(resolved[0], Event::Thinking { .. }));
        assert!(matches!(resolved[1], Event::ToolCallStarted { .. }));
        assert!(matches!(
            &resolved[2],
            Event::ToolCallFinished { name, success, .. }
                if name == "web.search" && *success
        ));
        assert!(matches!(resolved[3], Event::Message { .. }));
    }

    #[test]
    fn resolve_tool_events_keeps_done_after_tool_completion() {
        let events = vec![
            Event::ToolCallStarted {
                name: "shell.exec".to_string(),
                input: serde_json::json!({ "command": "pwd" }),
            },
            Event::done("任务完成"),
        ];

        let resolved = super::resolve_tool_events(
            &events,
            &[super::StepEventBatch {
                events: vec![
                    Event::ToolCallStarted {
                        name: "shell.exec".to_string(),
                        input: serde_json::json!({ "command": "pwd" }),
                    },
                    Event::ToolCallFinished {
                        name: "shell.exec".to_string(),
                        output: serde_json::Value::Null,
                        success: false,
                    },
                ],
            }],
        );

        assert!(matches!(resolved[0], Event::ToolCallStarted { .. }));
        assert!(matches!(resolved[1], Event::ToolCallFinished { .. }));
        assert!(matches!(resolved[2], Event::Done { .. }));
    }

    #[test]
    fn resolve_tool_events_inlines_step_retry_timeline_before_following_events() {
        let events = vec![
            Event::ToolCallStarted {
                name: "web.search".to_string(),
                input: serde_json::json!({ "query": "rust" }),
            },
            Event::done("任务完成"),
        ];

        let resolved = super::resolve_tool_events(
            &events,
            &[super::StepEventBatch {
                events: vec![
                    Event::message("步骤 2 开始第 1 轮执行，待处理 1 个工具调用"),
                    Event::ToolCallStarted {
                        name: "web.search".to_string(),
                        input: serde_json::json!({ "query": "rust" }),
                    },
                    Event::ToolCallFinished {
                        name: "web.search".to_string(),
                        output: serde_json::Value::Null,
                        success: false,
                    },
                    Event::message("步骤 2 第 1 轮结束，1 个工具调用将进入下一轮重试"),
                ],
            }],
        );

        assert!(matches!(&resolved[0], Event::Message { content } if content.starts_with("步骤 2 开始第 1 轮")));
        assert!(matches!(resolved[1], Event::ToolCallStarted { .. }));
        assert!(matches!(resolved[2], Event::ToolCallFinished { .. }));
        assert!(matches!(&resolved[3], Event::Message { content } if content.starts_with("步骤 2 第 1 轮结束")));
        assert!(matches!(resolved[4], Event::Done { .. }));
    }

    #[test]
    fn resolve_tool_events_keeps_multi_iteration_step_timeline_in_order() {
        let events = vec![
            Event::Thinking {
                content: "准备执行步骤 2: 扫描工作区上下文".to_string(),
            },
            Event::ToolCallStarted {
                name: "web.search".to_string(),
                input: serde_json::json!({ "query": "rust" }),
            },
            Event::message("步骤 2 通过审查"),
        ];

        let resolved = super::resolve_tool_events(
            &events,
            &[super::StepEventBatch {
                events: vec![
                    Event::message("步骤 2 开始第 1 轮执行，待处理 1 个工具调用"),
                    Event::ToolCallStarted {
                        name: "web.search".to_string(),
                        input: serde_json::json!({ "query": "rust" }),
                    },
                    Event::ToolCallFinished {
                        name: "web.search".to_string(),
                        output: serde_json::Value::Null,
                        success: false,
                    },
                    Event::message("步骤 2 第 1 轮结束，1 个工具调用将进入下一轮重试"),
                    Event::message("步骤 2 开始第 2 轮执行，待处理 1 个工具调用"),
                    Event::ToolCallStarted {
                        name: "web.search".to_string(),
                        input: serde_json::json!({ "query": "rust" }),
                    },
                    Event::ToolCallFinished {
                        name: "web.search".to_string(),
                        output: serde_json::json!({ "count": 1, "results": [] }),
                        success: true,
                    },
                ],
            }],
        );

        assert!(matches!(resolved[0], Event::Thinking { .. }));
        assert!(matches!(&resolved[1], Event::Message { content } if content.starts_with("步骤 2 开始第 1 轮")));
        assert!(matches!(resolved[2], Event::ToolCallStarted { .. }));
        assert!(matches!(resolved[3], Event::ToolCallFinished { success: false, .. }));
        assert!(matches!(&resolved[4], Event::Message { content } if content.starts_with("步骤 2 第 1 轮结束")));
        assert!(matches!(&resolved[5], Event::Message { content } if content.starts_with("步骤 2 开始第 2 轮")));
        assert!(matches!(resolved[6], Event::ToolCallStarted { .. }));
        assert!(matches!(resolved[7], Event::ToolCallFinished { success: true, .. }));
        assert!(matches!(resolved[8], Event::Message { .. }));
    }

    #[test]
    fn collect_tool_results_uses_finished_events_as_status_source() {
        let final_events = vec![
            Event::ToolCallStarted {
                name: "web.search".to_string(),
                input: serde_json::json!({ "query": "rust" }),
            },
            Event::ToolCallFinished {
                name: "web.search".to_string(),
                output: serde_json::json!({ "items": [] }),
                success: false,
            },
        ];

        let tool_results = super::collect_tool_results(
            &final_events,
            &[super::ExecutedTool {
                iteration: 2,
                step_id: 2,
                name: "web.search".to_string(),
                summary: "network error".to_string(),
            }],
        );

        assert_eq!(tool_results, vec![super::ToolResult {
            iteration: 2,
            step_id: 2,
            name: "web.search".to_string(),
            success: false,
            summary: "network error".to_string(),
        }]);
    }

    #[test]
    fn should_retry_tool_call_retries_web_search_network_errors() {
        let intent = sacode_kernel::ToolCallIntent {
            name: "web.search".to_string(),
            input: serde_json::json!({ "query": "rust async" }),
            requires_approval: false,
        };

        assert_eq!(
            super::should_retry_tool_call(&intent, "error sending request for url (...)"),
            super::RetryDecision::Retry
        );
    }

    #[test]
    fn should_retry_tool_call_stops_on_policy_denial() {
        let intent = sacode_kernel::ToolCallIntent {
            name: "mcp.exa.search".to_string(),
            input: serde_json::json!({ "query": "rust async" }),
            requires_approval: true,
        };

        assert_eq!(
            super::should_retry_tool_call(&intent, "denied by policy"),
            super::RetryDecision::Stop
        );
    }
}
