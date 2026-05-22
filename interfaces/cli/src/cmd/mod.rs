mod checkpoint;
mod init;
mod plugin;
mod profile;

use std::{env, io::IsTerminal, path::PathBuf};

use anyhow::Result;
use sacode_kernel::{ExecutionMode, Supervisor, Task, ToolCallIntent, model::ModelProvider};
use sacode_runtime::{CheckpointStorage, ProviderClient, ToolRegistry};
use serde::Serialize;
use tokio::io::{self, AsyncReadExt};
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

use crate::repl::ReplSession;
use crate::tui;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CliCommand {
    Run,
    Profile,
    Plugin,
    Init,
    Repl,
    Tui,
    Checkpoint,
    Help,
    Version,
}

#[derive(Debug, Clone)]
pub struct CliOptions {
    pub command: CliCommand,
    pub prompt: String,
    pub mode: ExecutionMode,
    pub json: bool,
    pub sub_args: Vec<String>,
}

#[derive(Debug, Serialize)]
struct CliResponse {
    prompt: String,
    mode: ExecutionMode,
    tools: Vec<String>,
    workspace: String,
    plan: serde_json::Value,
    events: serde_json::Value,
    tool_results: serde_json::Value,
    stdin_preview: Option<String>,
    provider_response: Option<String>,
}

pub async fn run() -> Result<()> {
    init_tracing();
    let options = parse_args(env::args().skip(1).collect());

    match options.command {
        CliCommand::Help => print_help(),
        CliCommand::Version => println!("sacode {}", env!("CARGO_PKG_VERSION")),
        CliCommand::Run => run_task(options).await?,
        CliCommand::Profile => profile::run(options.sub_args)?,
        CliCommand::Plugin => plugin::run(options.sub_args)?,
        CliCommand::Init => init::run()?,
        CliCommand::Repl => run_repl().await?,
        CliCommand::Tui => tui::run_tui()?,
        CliCommand::Checkpoint => checkpoint::run(options.sub_args)?,
    }

    Ok(())
}

async fn run_task(options: CliOptions) -> Result<()> {
    let stdin = read_stdin_if_needed().await?;
    let task = Task::new(options.prompt.clone(), options.mode, stdin.clone());
    let supervisor = Supervisor::new();
    let result = supervisor.execute(&task);
    let tools = ToolRegistry::builtin();

    let checkpoint_storage = CheckpointStorage::new(&PathBuf::from("."));
    let checkpoint = checkpoint_storage.create_from_task(task.clone());

    let mut tool_results: Vec<(usize, String, bool, String)> = Vec::new();
    for (step_id, intents) in &result.tool_calls {
        for intent in intents {
            let tool_result = execute_tool(&tools, intent).await;
            let (success, summary) = match tool_result {
                Ok(output) => (output.success, output.message.clone().unwrap_or_else(|| "ok".to_string())),
                Err(e) => (false, e.to_string()),
            };
            tool_results.push((*step_id, intent.name.clone(), success, summary));
        }
    }

    checkpoint_storage.save(&checkpoint)?;

    let provider_response = call_provider(&options.prompt).await;

    if options.json {
        let response = CliResponse {
            prompt: options.prompt,
            mode: options.mode,
            tools: tools.names().iter().map(|name| name.to_string()).collect(),
            workspace: env::current_dir().unwrap_or_default().to_string_lossy().to_string(),
            plan: serde_json::to_value(&result.output.plan)?,
            events: serde_json::to_value(&result.output.events)?,
            tool_results: serde_json::to_value(&tool_results)?,
            stdin_preview: stdin.map(|value| preview(&value)),
            provider_response: provider_response.ok(),
        };
        println!("{}", serde_json::to_string_pretty(&response)?);
        return Ok(());
    }

    println!("SaCode");
    println!("Mode: {:?}", options.mode);
    println!("Task: {}", result.output.task);
    println!("Workspace: {}", env::current_dir().unwrap_or_default().display());
    println!("Tools: {}", tools.names().join(", "));

    match provider_response {
        Ok(response) => {
            println!("Provider Response:");
            println!("{}", response);
        }
        Err(e) => {
            println!("Provider: {}", e);
        }
    }

    println!("Plan:");
    for step in &result.output.plan.steps {
        println!("  {}. {} [{:?}]", step.id, step.description, step.status);
    }

    if !tool_results.is_empty() {
        println!("Tool Results:");
        for (step_id, name, success, summary) in &tool_results {
            println!("  Step {} - {}: {} - {}", step_id, name, if *success { "OK" } else { "FAIL" }, summary);
        }
    }

    println!("Events:");
    for event in &result.output.events {
        match event {
            sacode_kernel::Event::Message { content } => println!("  MSG: {}", content),
            sacode_kernel::Event::Thinking { content } => println!("  THINK: {}", content),
            sacode_kernel::Event::ToolCallStarted { name, .. } => println!("  TOOL_START: {}", name),
            sacode_kernel::Event::ToolCallFinished { name, success, .. } => println!("  TOOL_END: {} ({})", name, if *success { "ok" } else { "fail" }),
            sacode_kernel::Event::Done { summary } => println!("  DONE: {}", summary),
            sacode_kernel::Event::Error { message } => println!("  ERROR: {}", message),
            _ => {}
        }
    }

    if let Some(stdin) = stdin {
        println!("Stdin: {}", preview(&stdin));
    }

    Ok(())
}

async fn execute_tool(registry: &ToolRegistry, intent: &ToolCallIntent) -> Result<sacode_runtime::tools::ToolOutput> {
    if intent.requires_approval {
        if matches!(intent.name.as_str(), "shell.exec") {
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

    registry.execute(&intent.name, intent.input.clone())
}

async fn call_provider(prompt: &str) -> Result<String> {
    let model = env::var("SACODE_MODEL")
        .or_else(|_| env::var("DEFAULT_MODEL"))
        .unwrap_or_else(|_| "gpt-4o-mini".to_string());

    let provider = if model.starts_with("deepseek") {
        ModelProvider::deepseek(&model)
    } else if model.starts_with("ollama") || model.contains("qwen") {
        ModelProvider::ollama(&model)
    } else {
        ModelProvider::openai(&model)
    };

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
            json: false,
            sub_args: Vec::new(),
        };
    }

    let first = args[0].as_str();
    if first == "profile" {
        return CliOptions {
            command: CliCommand::Profile,
            prompt: String::new(),
            mode: ExecutionMode::Build,
            json: false,
            sub_args: args[1..].to_vec(),
        };
    }

    if first == "plugin" {
        return CliOptions {
            command: CliCommand::Plugin,
            prompt: String::new(),
            mode: ExecutionMode::Build,
            json: false,
            sub_args: args[1..].to_vec(),
        };
    }

    if first == "init" {
        return CliOptions {
            command: CliCommand::Init,
            prompt: String::new(),
            mode: ExecutionMode::Build,
            json: false,
            sub_args: Vec::new(),
        };
    }

    if first == "repl" {
        return CliOptions {
            command: CliCommand::Repl,
            prompt: String::new(),
            mode: ExecutionMode::Build,
            json: false,
            sub_args: Vec::new(),
        };
    }

    if first == "tui" {
        return CliOptions {
            command: CliCommand::Tui,
            prompt: String::new(),
            mode: ExecutionMode::Build,
            json: false,
            sub_args: Vec::new(),
        };
    }

    if first == "checkpoint" {
        return CliOptions {
            command: CliCommand::Checkpoint,
            prompt: String::new(),
            mode: ExecutionMode::Build,
            json: false,
            sub_args: args[1..].to_vec(),
        };
    }

    let mut command = CliCommand::Run;
    let mut prompt = Vec::new();
    let mut mode = ExecutionMode::Build;
    let mut json = false;

    let mut iter = args.into_iter();
    while let Some(arg) = iter.next() {
        match arg.as_str() {
            "-h" | "--help" => command = CliCommand::Help,
            "-V" | "--version" => command = CliCommand::Version,
            "--json" => json = true,
            "--mode" => {
                if let Some(value) = iter.next() {
                    mode = match value.as_str() {
                        "plan" => ExecutionMode::Plan,
                        "yolo" => ExecutionMode::Yolo,
                        _ => ExecutionMode::Build,
                    };
                }
            }
            value => prompt.push(value.to_string()),
        }
    }

    CliOptions {
        command,
        prompt: prompt.join(" "),
        mode,
        json,
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
    println!("  sacode \"<task>\" [--mode plan|build|yolo] [--json]");
    println!("  sacode profile [ls|use <name>|show]");
    println!("  sacode plugin [list]");
    println!("  sacode init");
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
    use sacode_kernel::ExecutionMode;

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
        assert!(options.json);
    }

    #[test]
    fn parse_args_parses_subcommands() {
        let options = parse_args(vec!["checkpoint".to_string(), "list".to_string()]);

        assert_eq!(options.command, CliCommand::Checkpoint);
        assert_eq!(options.sub_args, vec!["list".to_string()]);
    }

    #[test]
    fn preview_truncates_long_input() {
        let input = "a".repeat(100);
        let preview_text = preview(&input);

        assert_eq!(preview_text.len(), 83);
        assert!(preview_text.ends_with("..."));
    }
}
