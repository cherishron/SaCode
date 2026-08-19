mod acp;
mod arg_parser;
mod bundle;
mod checkpoint;
#[cfg(test)]
mod command_tests;
pub mod config;
pub mod diff;
pub mod doctor;
mod help_text;
pub mod hooks;
pub mod ide;
pub mod init;
pub mod insight;
pub mod keybindings;
mod lsp;
mod mcp;
pub mod memory;
mod mistakes;
mod orchestrator_entry;
mod orchestrator_support;
pub mod outstyle;
mod plugin;
mod profile;
pub mod prompt;
mod repl_entry;
mod runtime_entry;
mod sandbox;
mod serve;
mod session;
mod skill;
pub mod status;
mod tracing_setup;
pub mod update;
pub mod vim;
pub mod wiki;

use std::env;
use std::path::PathBuf;

use crate::tui;
use anyhow::Result;
use arg_parser::parse_args;
use help_text::print_help;
use orchestrator_entry::run_with_orchestrator;
#[cfg(test)]
use orchestrator_support::{
    collect_tool_results, parse_mcp_tool_name, resolve_tool_events, should_retry_tool_call,
    ExecutedTool, RetryDecision, StepEventBatch, ToolResult,
};
use repl_entry::run_repl;
use runtime_entry::run_task;
pub use sacode_kernel::ApprovalPolicy;
use sacode_kernel::ExecutionMode;
use tracing_setup::init_tracing;

pub(crate) const JSON_STREAM_PREFIX: &str = "__SACODE_STREAM__";

/// 从子命令参数中提取 `--profile <name>` 的值（子命令路径下 --profile 进入 sub_args）
fn extract_profile_flag(args: &[String]) -> Option<String> {
    let mut iter = args.iter();
    while let Some(arg) = iter.next() {
        if arg == "--profile" {
            return iter.next().cloned();
        }
    }
    None
}

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
    Config,
    Keybindings,
    Outstyle,
    Prompt,
    Wiki,
    Vim,
    Skill,
    Sandbox,
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
    Update,
    Session,
    DumpConfig,
    Bundle,
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
    pub json_stream: bool,
    pub approval: ApprovalPolicy,
    pub profile: Option<String>,
    pub agent_loop: Option<String>,
    pub remote_prefix: Option<String>,
    pub sub_args: Vec<String>,
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
        CliCommand::Config => config::run(options.sub_args)?,
        CliCommand::Keybindings => keybindings::run()?,
        CliCommand::Outstyle => outstyle::run(options.sub_args)?,
        CliCommand::Prompt => prompt::run(options.sub_args)?,
        CliCommand::Wiki => wiki::run(options.sub_args)?,
        CliCommand::Skill => skill::run(options.sub_args).await?,
        CliCommand::Sandbox => sandbox::run(options.sub_args)?,
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
        CliCommand::Checkpoint => checkpoint::run(options.sub_args).await?,
        CliCommand::Status => status::run().await?,
        CliCommand::Update => update::run(options.sub_args)?,
        CliCommand::Bundle => bundle::run(options.sub_args)?,
        CliCommand::Session => session::run(options.sub_args)?,
        CliCommand::DumpConfig => {
            let workdir = PathBuf::from(".");
            let runtime_config = sacode_runtime::config::SaCodeConfig::new(&workdir);
            // --profile 可能来自 options.profile（run 路径）或 sub_args（子命令路径）
            let profile = options
                .profile
                .clone()
                .or_else(|| extract_profile_flag(&options.sub_args));
            println!(
                "{}",
                runtime_config.dump_effective_config(profile.as_deref())?
            );
        }
        CliCommand::Vim => vim::run(options.sub_args)?,
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{help_text::HELP_LINES, parse_args, CliCommand};
    use crate::runner::build_mcp_input;
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
        assert_eq!(options.max_iterations, 3);
        assert!(options.json);
        assert!(!options.json_stream);
        assert_eq!(options.approval, super::ApprovalPolicy::Prompt);
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
        let options = parse_args(vec!["执行任务".to_string(), "--approve".to_string()]);

        assert_eq!(options.approval, super::ApprovalPolicy::AutoApprove);
    }

    #[test]
    fn parse_args_parses_help_flag() {
        let options = parse_args(vec!["--help".to_string()]);

        assert_eq!(options.command, CliCommand::Help);
    }

    #[test]
    fn parse_args_parses_version_flag() {
        let options = parse_args(vec!["--version".to_string()]);

        assert_eq!(options.command, CliCommand::Version);
    }

    #[test]
    fn parse_args_parses_init_deep_alias() {
        let options = parse_args(vec!["init-deep".to_string()]);

        assert_eq!(options.command, CliCommand::Init);
        assert_eq!(options.sub_args, vec!["deep".to_string()]);
    }

    #[test]
    fn parse_args_parses_repl_command() {
        let options = parse_args(vec!["repl".to_string()]);

        assert_eq!(options.command, CliCommand::Repl);
    }

    #[test]
    fn parse_args_parses_tui_command() {
        let options = parse_args(vec!["tui".to_string()]);

        assert_eq!(options.command, CliCommand::Tui);
    }

    #[test]
    fn parse_args_parses_orchestrator_command() {
        let options = parse_args(vec!["orchestrator".to_string(), "分析仓库".to_string()]);

        assert_eq!(options.command, CliCommand::Orchestrator);
        assert_eq!(options.prompt, "分析仓库");
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
    fn parse_args_parses_prompt_subcommand() {
        let options = parse_args(vec!["prompt".to_string(), "doctor".to_string()]);

        assert_eq!(options.command, CliCommand::Prompt);
        assert_eq!(options.sub_args, vec!["doctor".to_string()]);
    }

    #[test]
    fn parse_args_parses_skill_subcommand() {
        let options = parse_args(vec!["skill".to_string(), "list".to_string()]);

        assert_eq!(options.command, CliCommand::Skill);
        assert_eq!(options.sub_args, vec!["list".to_string()]);
    }

    #[test]
    fn parse_args_parses_sandbox_subcommand() {
        let options = parse_args(vec![
            "sandbox".to_string(),
            "show".to_string(),
            "plan".to_string(),
        ]);

        assert_eq!(options.command, CliCommand::Sandbox);
        assert_eq!(
            options.sub_args,
            vec!["show".to_string(), "plan".to_string()]
        );
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
        let options = parse_args(vec![
            "serve".to_string(),
            "--acp".to_string(),
            "--lsp".to_string(),
        ]);

        assert_eq!(options.command, CliCommand::Serve);
        assert_eq!(
            options.sub_args,
            vec!["--acp".to_string(), "--lsp".to_string()]
        );
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
    fn parse_args_parses_update_subcommand() {
        let options = parse_args(vec!["update".to_string(), "--check".to_string()]);

        assert_eq!(options.command, CliCommand::Update);
        assert_eq!(options.sub_args, vec!["--check".to_string()]);
    }

    #[test]
    fn help_lines_cover_special_entrypoints() {
        assert!(HELP_LINES.contains(&"  sacode orchestrator \"<task>\""));
        assert!(HELP_LINES.contains(&"  sacode init       # 轻量初始化，识别技术栈和基础项目信息"));
        assert!(HELP_LINES.contains(&"  sacode init-deep  # 深度初始化，生成严格协作配置和工作流"));
        assert!(HELP_LINES.contains(&"  sacode repl"));
        assert!(HELP_LINES.contains(&"  sacode tui"));
        assert!(HELP_LINES.contains(&"  sacode --help"));
        assert!(HELP_LINES.contains(&"  sacode --version"));
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

        let input = build_mcp_input(&schema, "rust async");
        assert_eq!(input, serde_json::json!({ "query": "rust async" }));
    }

    #[test]
    fn preview_truncates_long_input() {
        let input = "a".repeat(100);
        let preview_text = super::runtime_entry::preview(&input);

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

        assert!(
            matches!(&resolved[0], Event::Message { content } if content.starts_with("步骤 2 开始第 1 轮"))
        );
        assert!(matches!(resolved[1], Event::ToolCallStarted { .. }));
        assert!(matches!(resolved[2], Event::ToolCallFinished { .. }));
        assert!(
            matches!(&resolved[3], Event::Message { content } if content.starts_with("步骤 2 第 1 轮结束"))
        );
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
        assert!(
            matches!(&resolved[1], Event::Message { content } if content.starts_with("步骤 2 开始第 1 轮"))
        );
        assert!(matches!(resolved[2], Event::ToolCallStarted { .. }));
        assert!(matches!(
            resolved[3],
            Event::ToolCallFinished { success: false, .. }
        ));
        assert!(
            matches!(&resolved[4], Event::Message { content } if content.starts_with("步骤 2 第 1 轮结束"))
        );
        assert!(
            matches!(&resolved[5], Event::Message { content } if content.starts_with("步骤 2 开始第 2 轮"))
        );
        assert!(matches!(resolved[6], Event::ToolCallStarted { .. }));
        assert!(matches!(
            resolved[7],
            Event::ToolCallFinished { success: true, .. }
        ));
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

        assert_eq!(
            tool_results,
            vec![super::ToolResult {
                iteration: 2,
                step_id: 2,
                name: "web.search".to_string(),
                success: false,
                summary: "network error".to_string(),
            }]
        );
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
