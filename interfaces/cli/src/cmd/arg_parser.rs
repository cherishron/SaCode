use sacode_kernel::ExecutionMode;

use super::{ApprovalPolicy, CliCommand, CliOptions};

pub(super) fn parse_args(args: Vec<String>) -> CliOptions {
    if args.is_empty() {
        return default_options(CliCommand::Tui);
    }

    let first = args[0].as_str();
    if let Some(command) = simple_subcommand(first) {
        return with_sub_args(command, args[1..].to_vec());
    }

    if first == "init-deep" {
        return with_sub_args(CliCommand::Init, vec!["deep".to_string()]);
    }

    if first == "repl" {
        return default_options(CliCommand::Repl);
    }

    if first == "tui" {
        return default_options(CliCommand::Tui);
    }

    if first == "orchestrator" {
        let mut options = default_options(CliCommand::Orchestrator);
        options.prompt = args[1..].join(" ");
        return options;
    }

    parse_run_args(args)
}

fn simple_subcommand(name: &str) -> Option<CliCommand> {
    Some(match name {
        "profile" => CliCommand::Profile,
        "plugin" => CliCommand::Plugin,
        "doctor" => CliCommand::Doctor,
        "diff" => CliCommand::Diff,
        "hooks" => CliCommand::Hooks,
        "ide" => CliCommand::Ide,
        "config" => CliCommand::Config,
        "keybindings" => CliCommand::Keybindings,
        "outstyle" => CliCommand::Outstyle,
        "prompt" => CliCommand::Prompt,
        "wiki" => CliCommand::Wiki,
        "vim" => CliCommand::Vim,
        "skill" => CliCommand::Skill,
        "sandbox" => CliCommand::Sandbox,
        "mcp" => CliCommand::Mcp,
        "memory" => CliCommand::Memory,
        "insight" => CliCommand::Insight,
        "acp" => CliCommand::Acp,
        "lsp" => CliCommand::Lsp,
        "serve" => CliCommand::Serve,
        "init" => CliCommand::Init,
        "mistakes" => CliCommand::Mistakes,
        "checkpoint" => CliCommand::Checkpoint,
        "status" => CliCommand::Status,
        "update" => CliCommand::Update,
        "session" => CliCommand::Session,
        _ => return None,
    })
}

fn parse_run_args(args: Vec<String>) -> CliOptions {
    let mut command = CliCommand::Run;
    let mut prompt = Vec::new();
    let mut mode = ExecutionMode::Build;
    let mut max_iterations = 3;
    let mut json = false;
    let mut json_stream = false;
    let mut approval = ApprovalPolicy::Prompt;

    let mut iter = args.into_iter();
    while let Some(arg) = iter.next() {
        match arg.as_str() {
            "-h" | "--help" => command = CliCommand::Help,
            "-V" | "--version" => command = CliCommand::Version,
            "--json" => json = true,
            "--json-stream" => json_stream = true,
            "--prompt" => approval = ApprovalPolicy::Prompt,
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
                    max_iterations = value
                        .parse::<usize>()
                        .ok()
                        .filter(|value| *value > 0)
                        .unwrap_or(3);
                }
            }
            value => prompt.push(value.to_string()),
        }
    }

    let prompt_text = prompt.join(" ");
    if prompt_text.trim_start().to_uppercase().starts_with("ULW") {
        command = CliCommand::Orchestrator;
    }

    CliOptions {
        command,
        prompt: prompt_text,
        mode,
        max_iterations,
        json,
        json_stream,
        approval,
        sub_args: Vec::new(),
    }
}

fn default_options(command: CliCommand) -> CliOptions {
    CliOptions {
        command,
        prompt: String::new(),
        mode: ExecutionMode::Build,
        max_iterations: 3,
        json: false,
        json_stream: false,
        approval: ApprovalPolicy::Prompt,
        sub_args: Vec::new(),
    }
}

fn with_sub_args(command: CliCommand, sub_args: Vec<String>) -> CliOptions {
    let mut options = default_options(command);
    options.sub_args = sub_args;
    options
}
