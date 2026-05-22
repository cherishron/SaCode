mod models;
mod runtime;

use std::{
    env, fs,
    io::{self, Write},
    net::SocketAddr,
    path::PathBuf,
    sync::Arc,
};

use axum::{
    Router,
    extract::State,
    http::{Method, StatusCode, header},
    response::{IntoResponse, Json},
    routing::{delete, get, patch, post},
};
use serde::{Deserialize, Serialize};
use sqlx::{Pool, Sqlite};
use tokio::runtime::Handle;
use tokio::task::block_in_place;
use tower_http::{
    cors::{Any, CorsLayer},
    trace::TraceLayer,
};
use tracing::{info, warn};
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};
use models::*;
use runtime::*;

#[tokio::main]
async fn main() {
    init_tracing();

    match parse_cli_args(env::args().skip(1).collect()) {
        Ok(AppCommand::Help) => print_help(),
        Ok(AppCommand::Version) => print_version(),
        Ok(AppCommand::Shell) => {
            if let Err(error) = run_shell().await {
                eprintln!("shell error: {error}");
                std::process::exit(1);
            }
        }
        Ok(AppCommand::Serve { host, port }) => {
            if let Err(error) = run_server(host, port).await {
                eprintln!("server error: {error}");
                std::process::exit(1);
            }
        }
        Ok(AppCommand::Start {
            host,
            port,
            api_only,
            web_only,
        }) => {
            if let Err(error) = run_start_command(host, port, api_only, web_only).await {
                eprintln!("start error: {error}");
                std::process::exit(1);
            }
        }
        Ok(AppCommand::Chat) => {
            if let Err(error) = run_chat_mode().await {
                eprintln!("chat error: {error}");
                std::process::exit(1);
            }
        }
        Ok(AppCommand::Code) => {
            if let Err(error) = run_code_mode().await {
                eprintln!("code error: {error}");
                std::process::exit(1);
            }
        }
        Ok(AppCommand::Cron) => {
            if let Err(error) = run_cron_mode().await {
                eprintln!("cron error: {error}");
                std::process::exit(1);
            }
        }
        Ok(AppCommand::Plugin) => {
            if let Err(error) = run_plugin_mode().await {
                eprintln!("plugin error: {error}");
                std::process::exit(1);
            }
        }
        Err(error) => {
            eprintln!("{error}");
            eprintln!();
            print_help();
            std::process::exit(1);
        }
    }
}

async fn run_server(
    host_override: Option<String>,
    port_override: Option<u16>,
) -> Result<(), String> {
    let state = build_app_state().await;
    let app = build_router(state);
    let port = port_override
        .or_else(|| {
            env::var("PORT")
                .ok()
                .and_then(|value| value.parse::<u16>().ok())
        })
        .unwrap_or(3001);
    let host = host_override
        .or_else(|| env::var("HOST").ok())
        .unwrap_or_else(|| "0.0.0.0".to_string());
    let address: SocketAddr = format!("{}:{}", host, port)
        .parse()
        .map_err(|error| format!("invalid host or port: {error}"))?;

    info!(%address, "starting sacode rust api mvp");

    let listener = tokio::net::TcpListener::bind(address)
        .await
        .map_err(|error| format!("failed to bind tcp listener: {error}"))?;

    axum::serve(listener, app)
        .await
        .map_err(|error| format!("server exited with error: {error}"))
}

async fn build_app_state() -> AppState {
    let db_path = resolve_database_path();
    let db_pool = match db_path.as_deref() {
        Some(path) => match connect_sqlite(path).await {
            Ok(pool) => {
                info!(database_path = %path, "connected rust api mvp to sqlite database");
                Some(pool)
            }
            Err(error) => {
                warn!(database_path = %path, error = %error, "failed to connect sqlite database, fallback to empty stats");
                None
            }
        },
        None => {
            warn!("no sqlite database file found, fallback to empty stats");
            None
        }
    };

    AppState {
        app_name: Arc::from("SACODE API"),
        app_version: Arc::from(env!("CARGO_PKG_VERSION")),
        default_model: Arc::from(
            env::var("DEFAULT_MODEL")
                .unwrap_or_else(|_| "gpt-4o-mini".to_string())
                .into_boxed_str(),
        ),
        db_pool,
        db_path: db_path.map(|value| Arc::from(value.into_boxed_str())),
        notifications: Arc::new(RwLock::new(default_notifications())),
        session_model_map: Arc::new(RwLock::new(HashMap::new())),
    }
}

fn build_router(state: AppState) -> Router {
    Router::new()
        .route("/", get(root))
        .route("/api", get(api_info))
        .route("/api/health", get(health))
        .route("/api/stats", get(stats))
        .route("/api/models", get(models))
        .route("/api/models/default", get(default_model))
        .route("/api/models/session/:session_id", get(session_model))
        .route("/api/models/switch", post(switch_model))
        .route("/api/settings/providers", get(settings_providers))
        .route("/api/settings/keys", get(settings_keys))
        .route("/api/settings/keys", post(save_settings_key))
        .route("/api/settings/keys/:provider", patch(update_settings_key))
        .route("/api/settings/keys/:provider", delete(delete_settings_key))
        .route(
            "/api/settings/oauth/providers",
            get(settings_oauth_providers),
        )
        .route("/api/settings/oauth", get(settings_oauth))
        .route("/api/settings/oauth", post(save_oauth_config))
        .route("/api/settings/oauth/:provider", delete(delete_oauth_config))
        .route(
            "/api/settings/oauth/:provider/toggle",
            patch(toggle_oauth_config),
        )
        .route("/api/notifications", get(notifications))
        .route(
            "/api/notifications/unread-count",
            get(notifications_unread_count),
        )
        .route("/api/notifications/read-all", post(notifications_read_all))
        .route("/api/notifications/clear", delete(notifications_clear))
        .route("/api/notifications/:id/read", post(notification_mark_read))
        .route("/api/notifications/:id", delete(notification_delete))
        .with_state(state)
        .layer(
            CorsLayer::new()
                .allow_methods([
                    Method::GET,
                    Method::POST,
                    Method::PATCH,
                    Method::DELETE,
                    Method::OPTIONS,
                ])
                .allow_headers([header::CONTENT_TYPE, header::AUTHORIZATION])
                .allow_origin(Any),
        )
        .layer(TraceLayer::new_for_http())
}

async fn run_shell() -> Result<(), String> {
    print_shell_banner();
    let mut input = String::new();

    loop {
        print!("sacode> ");
        io::stdout()
            .flush()
            .map_err(|error| format!("failed to flush stdout: {error}"))?;
        input.clear();

        let bytes = io::stdin()
            .read_line(&mut input)
            .map_err(|error| format!("failed to read stdin: {error}"))?;
        if bytes == 0 {
            println!();
            break;
        }

        let command = input.trim();
        if command.is_empty() {
            continue;
        }

        match command {
            "/help" => print_shell_help(),
            "/models" => print_models(),
            "/chat" => {
                println!("进入 Chat 模式。可直接输入自然语言任务，输入 /exit 退出。");
            }
            "/code" => {
                println!("进入 Code 模式。可直接输入代码任务，输入 /exit 退出。");
            }
            "/providers" => print_providers(),
            "/agents" => print_agents(),
            "/prefs" => print_prefs(),
            "/status" => print_status().await,
            "/doctor" => print_doctor(),
            "/config" => print_config_help(),
            "/workspace" => print_workspace_help(),
            "/memory" => print_memory_help(),
            "/cron" => print_cron_help(),
            "/plugin" => print_plugin_help(),
            "/serve" => {
                println!("starting http api on 0.0.0.0:3001");
                return run_server(None, None).await;
            }
            "/exit" | "/quit" | "/q" => break,
            _ if command.starts_with("/model ") => handle_model_command(command),
            _ if command.starts_with("/chat") => handle_chat_command(command),
            _ if command.starts_with("/code") => handle_code_command(command),
            _ if command.starts_with("/cron") => handle_cron_command(command),
            _ if command.starts_with("/plugin") => handle_plugin_command(command),
            _ if command.starts_with("/provider ") => handle_provider_command(command),
            _ if command.starts_with("/agent ") => handle_agent_command(command),
            _ if command.starts_with("/auth ") => handle_auth_command(command),
            _ if command.starts_with("/settings ") => handle_settings_command(command),
            _ if command.starts_with("/lang") => handle_lang_command(command),
            _ if command.starts_with("/session") => handle_session_command(command),
            _ if command.starts_with("/memory") => handle_memory_command(command),
            _ if command.starts_with("/config") => handle_config_command(command),
            _ if command.starts_with("/workspace") => handle_workspace_command(command),
            _ if command.starts_with("/remember") => handle_remember_command(command),
            _ if command.starts_with("/recall") => handle_recall_command(command),
            _ if !command.starts_with('/') => {
                println!(
                    "rust shell 已接管入口。当前先支持 slash commands，输入 /help 查看可用命令。"
                );
            }
            _ => println!("未知命令: {command}\n输入 /help 查看可用命令。"),
        }
    }

    Ok(())
}

fn print_shell_banner() {
    println!("sacode rust shell");
    println!("输入 /help 查看命令，输入 /serve 启动 http api，输入 /exit 退出。\n");
}

fn print_shell_help() {
    println!(
        "可用命令:\n  /help               - 显示帮助\n  /models             - 查看默认模型列表\n  /model use          - 切换默认模型\n  /model test         - 检查模型配置\n  /providers          - 查看 ~/.sacode/providers.json\n  /agents             - 查看 ~/.sacode/agents.json\n  /agent list         - 列出 Agent\n  /agent show         - 查看单个 Agent\n  /agent add          - 添加 Agent\n  /agent use          - 切换默认 Agent\n  /agent collab       - 开关多 Agent 协作\n  /agent dispatch     - 开关子 Agent 调度\n  /auth list          - 列出认证账户\n  /auth current       - 查看当前认证账户\n  /auth providers     - 查看支持厂商\n  /auth env           - 查看认证环境\n  /auth validate      - 验证当前账户\n  /settings providers - 查看内置设置厂商\n  /settings keys      - 查看 API Key 配置\n  /settings oauth     - 查看 OAuth 配置\n  /config             - 查看配置命令帮助\n  /workspace          - 查看工作空间命令帮助\n  /cron               - 查看定时任务命令帮助\n  /plugin             - 查看插件命令帮助\n  /lang               - 设置 shell 语言\n  /prefs              - 查看 CLI 偏好设置\n  /doctor             - 运行 Rust 版本地诊断\n  /session            - 查看会话信息\n  /session list       - 列出会话\n  /session info       - 查看单个会话\n  /memory             - 查看记忆命令帮助\n  /remember           - 写入记忆\n  /recall             - 检索记忆\n  /status             - 查看当前 Rust 入口状态\n  /serve              - 启动 HTTP API 服务\n  /exit               - 退出 shell"
    );
}

fn print_models() {
    println!("已知模型:");
    for model in default_models() {
        println!(
            "- {} ({}/{}){}",
            model.name,
            model.provider,
            model.model_id,
            if model.is_default { " [default]" } else { "" }
        );
    }
}

fn print_providers() {
    match load_provider_store() {
        Ok(store) => {
            println!("providers:");
            if let Some(default_model) = &store.default_model {
                println!("defaultModel: {default_model}");
            }
            for provider in store.providers {
                println!("- {} ({})", provider.name, provider.id);
                println!("  adapter: {}", provider.adapter);
                println!("  apiKeyEnv: {}", provider.api_key_env);
                if let Some(base_url) = provider.base_url {
                    println!("  baseUrl: {base_url}");
                }
                for model in provider.models {
                    let label = model.label.unwrap_or_else(|| model.id.clone());
                    println!("  model: {} [{}]", label, model.capabilities.join(", "));
                }
            }
        }
        Err(error) => println!("provider store unavailable: {error}"),
    }
}

fn print_agents() {
    match load_agent_store() {
        Ok(store) => {
            println!("agents:");
            println!(
                "defaultAgent: {}",
                store.default_agent.unwrap_or_else(|| "none".to_string())
            );
            println!(
                "collaboration: {}",
                if store.collaboration_enabled {
                    "enabled"
                } else {
                    "disabled"
                }
            );
            println!(
                "subAgentDispatch: {}",
                if store.sub_agent_dispatch_enabled {
                    "enabled"
                } else {
                    "disabled"
                }
            );
            for agent in store.agents {
                println!(
                    "- {} ({}){}",
                    agent.name,
                    agent.id,
                    if agent.enabled { "" } else { " [disabled]" }
                );
                println!("  model: {}", agent.model);
                println!(
                    "  tools: {}",
                    if agent.tools.is_empty() {
                        "none".to_string()
                    } else {
                        agent.tools.join(", ")
                    }
                );
                println!("  permission: {}", agent.permission_profile);
                println!(
                    "  subAgents: {}",
                    if agent.sub_agents.is_empty() {
                        "none".to_string()
                    } else {
                        agent.sub_agents.join(", ")
                    }
                );
                if let Some(description) = agent.description {
                    println!("  description: {description}");
                }
            }
        }
        Err(error) => println!("agent store unavailable: {error}"),
    }
}

fn print_prefs() {
    match load_cli_config() {
        Ok(config) => match serde_json::to_string_pretty(&config) {
            Ok(content) => println!("偏好设置:\n{content}"),
            Err(error) => println!("failed to render prefs: {error}"),
        },
        Err(error) => println!("prefs unavailable: {error}"),
    }
}

fn print_auth_list() {
    match load_auth_store() {
        Ok(store) => {
            if store.accounts.is_empty() {
                println!("暂无认证账户。");
                return;
            }
            println!("认证账户:");
            for account in store.accounts {
                let active = if account.is_active { "*" } else { "-" };
                println!(
                    "{active} {} ({}) [{}]",
                    account.alias, account.id, account.provider
                );
            }
        }
        Err(error) => println!("auth store unavailable: {error}"),
    }
}

fn print_auth_current() {
    match load_auth_store() {
        Ok(store) => {
            if let Some(account) = store.accounts.iter().find(|item| item.is_active) {
                println!("当前账户: {} ({})", account.alias, account.provider);
                println!("protocol: {}", account.protocol);
                println!("baseUrl: {}", account.base_url);
                println!(
                    "defaultModel: {}",
                    account
                        .default_model
                        .clone()
                        .unwrap_or_else(|| "none".to_string())
                );
                return;
            }
            println!("暂无激活账户。");
        }
        Err(error) => println!("auth store unavailable: {error}"),
    }
}

fn print_auth_providers() {
    println!("支持厂商:");
    for provider in OAUTH_PROVIDERS {
        println!("- {} ({})", provider.name, provider.id);
    }
}

fn print_auth_env() {
    match load_auth_store() {
        Ok(store) => {
            println!("认证环境:");
            println!("activeAccountId: {}", store.active_account_id.as_str());
            println!("accounts: {}", store.accounts.len());
        }
        Err(error) => println!("auth store unavailable: {error}"),
    }
}

fn print_auth_validate() {
    match load_auth_store() {
        Ok(store) => {
            if let Some(account) = store.accounts.iter().find(|item| item.is_active) {
                println!("当前账户有效性检查:");
                println!("- account: {}", account.alias);
                println!("- provider: {}", account.provider);
                println!("- baseUrl: {}", account.base_url);
                println!("- status: pending remote validation");
                return;
            }
            println!("暂无激活账户。");
        }
        Err(error) => println!("auth store unavailable: {error}"),
    }
}

fn print_settings_providers() {
    println!("内置设置厂商:");
    for provider in AI_PROVIDERS {
        println!("- {} ({})", provider.name, provider.id);
    }
}

fn print_settings_keys() {
    match load_settings_keys() {
        Ok(keys) => {
            if keys.is_empty() {
                println!("暂无 API Key 配置。");
                return;
            }
            println!("API Key 配置:");
            for key in keys {
                println!("- {} [{}]", key.name, key.provider);
            }
        }
        Err(error) => println!("settings keys unavailable: {error}"),
    }
}

fn print_settings_oauth() {
    match load_oauth_configs_for_shell() {
        Ok(configs) => {
            if configs.is_empty() {
                println!("暂无 OAuth 配置。");
                return;
            }
            println!("OAuth 配置:");
            for config in configs {
                println!("- {} [{}]", config.name, config.provider);
            }
        }
        Err(error) => println!("settings oauth unavailable: {error}"),
    }
}

fn print_config_help() {
    println!(
        "配置管理:\n  /config list            - 查看配置\n  /config get <key>       - 读取配置项\n  /config set <key> <value> - 写入配置项\n  /config reset [preferences|extended] - 重置配置"
    );
}

fn print_config_list() {
    match load_cli_config() {
        Ok(config) => {
            println!("CLI 配置:");
            println!(
                "- language: {}",
                config.language.unwrap_or_else(|| "zh-CN".to_string())
            );
            println!("- agentMode: {}", config.agent_mode);
            println!("- maxAgentIterations: {}", config.max_agent_iterations);
            println!(
                "- autoApproveTools: {}",
                config.auto_approve_tools.join(", ")
            );
            println!("- workMode: {}", config.work_mode);
            println!("- uiStyle: {}", config.ui_style);
            println!(
                "- codingplanDefaultAccount: {}",
                config
                    .codingplan_default_account
                    .unwrap_or_else(|| "(未设置)".to_string())
            );
            println!(
                "配置文件: {}",
                sacode_config_dir().join("cli-config.json").display()
            );
        }
        Err(error) => println!("config unavailable: {error}"),
    }
}

fn print_config_value(key: &str) {
    match load_cli_config() {
        Ok(config) => match resolve_config_value(&config, key) {
            Some(value) => println!("{key}: {value}"),
            None => println!("未找到配置项: {key}"),
        },
        Err(error) => println!("config unavailable: {error}"),
    }
}

fn set_config_value(key: &str, value: &str) -> Result<String, String> {
    let mut config = load_cli_config()?;
    match key {
        "language" | "lang" => config.language = Some(value.to_string()),
        "agentMode" | "agent-mode" => config.agent_mode = value.to_string(),
        "maxAgentIterations" | "max-agent-iterations" => {
            config.max_agent_iterations = value
                .parse::<u32>()
                .map_err(|error| format!("maxAgentIterations 无效: {error}"))?
        }
        "autoApproveTools" | "auto-approve-tools" => config.auto_approve_tools = split_csv(value),
        "workMode" | "work-mode" => config.work_mode = value.to_string(),
        "uiStyle" | "ui-style" => config.ui_style = value.to_string(),
        "codingplanDefaultAccount" | "codingplan-default-account" => {
            config.codingplan_default_account = Some(value.to_string())
        }
        _ => {
            return Err(
                "支持的配置项: language, agentMode, maxAgentIterations, autoApproveTools, workMode, uiStyle, codingplanDefaultAccount".to_string(),
            )
        }
    }
    save_cli_config(&config)?;
    Ok(format!("配置已更新: {key} = {value}"))
}

fn reset_config(scope: Option<&str>) -> Result<String, String> {
    let config = default_cli_config();
    match scope {
        None | Some("preferences") | Some("extended") => {
            save_cli_config(&config)?;
            Ok("CLI 配置已重置为默认值".to_string())
        }
        Some(_) => Err("用法: /config reset [preferences|extended]".to_string()),
    }
}

fn resolve_config_value(config: &CliConfigData, key: &str) -> Option<String> {
    match key {
        "language" | "lang" => Some(
            config
                .language
                .clone()
                .unwrap_or_else(|| "zh-CN".to_string()),
        ),
        "agentMode" | "agent-mode" => Some(config.agent_mode.clone()),
        "maxAgentIterations" | "max-agent-iterations" => {
            Some(config.max_agent_iterations.to_string())
        }
        "autoApproveTools" | "auto-approve-tools" => Some(config.auto_approve_tools.join(", ")),
        "workMode" | "work-mode" => Some(config.work_mode.clone()),
        "uiStyle" | "ui-style" => Some(config.ui_style.clone()),
        "codingplanDefaultAccount" | "codingplan-default-account" => Some(
            config
                .codingplan_default_account
                .clone()
                .unwrap_or_else(|| "(未设置)".to_string()),
        ),
        _ => None,
    }
}

fn print_workspace_help() {
    println!(
        "工作空间管理:\n  /workspace show         - 查看工作空间\n  /workspace templates    - 查看可用模板\n  /workspace init [template] - 初始化工作空间\n  /workspace edit <filename> - 查看工作空间文件路径"
    );
}

fn print_workspace_show() {
    let workspace = workspace_root();
    println!("工作空间:");
    println!("- path: {}", workspace.display());
    if !workspace.exists() {
        println!("- status: 未初始化");
        return;
    }

    println!("- status: 已初始化");
    let settings_path = workspace.join(".SACODE").join("settings.json");
    if let Ok(raw) = fs::read_to_string(&settings_path) {
        println!("- settings: {}", settings_path.display());
        println!("- config: {}", raw.replace('\n', " ").trim());
    }
}

fn print_workspace_templates() {
    println!("工作空间模板:");
    println!("- default: 基础工作空间，包含 SOUL.md / USER.md / AGENTS.md / TOOLS.md / MEMORY.md");
    println!("- developer: 开发工作空间，额外包含 PROJECT.md");
    println!("- assistant: 助手工作空间，额外包含 CALENDAR.md");
}

fn print_cron_help() {
    println!(
        "定时任务管理:\n  /cron help              - 显示帮助\n  /cron list              - 列出定时任务\n  /cron add               - 添加定时任务\n  /cron remove <jobId>    - 删除定时任务\n  /cron enable <jobId>    - 启用定时任务\n  /cron disable <jobId>   - 禁用定时任务\n  /cron run <jobId>       - 立即运行定时任务\n  /cron stats             - 显示统计"
    );
}

fn print_plugin_help() {
    println!(
        "插件管理:\n  /plugin help            - 显示帮助\n  /plugin list            - 列出插件\n  /plugin install         - 安装插件\n  /plugin uninstall       - 卸载插件\n  /plugin enable <name>   - 启用插件\n  /plugin disable <name>  - 禁用插件\n  /plugin info <name>     - 查看插件详情"
    );
}

fn init_workspace(template: Option<&str>) -> Result<String, String> {
    let template_id = template.unwrap_or("default");
    let files = match template_id {
        "default" => vec!["SOUL.md", "USER.md", "AGENTS.md", "TOOLS.md", "MEMORY.md"],
        "developer" => vec![
            "SOUL.md",
            "USER.md",
            "AGENTS.md",
            "TOOLS.md",
            "MEMORY.md",
            "PROJECT.md",
        ],
        "assistant" => vec![
            "SOUL.md",
            "USER.md",
            "AGENTS.md",
            "TOOLS.md",
            "MEMORY.md",
            "CALENDAR.md",
        ],
        _ => return Err("template 仅支持 default、developer、assistant".to_string()),
    };

    let workspace = workspace_root();
    let settings_dir = workspace.join(".SACODE");
    fs::create_dir_all(&settings_dir)
        .map_err(|error| format!("failed to create {}: {error}", settings_dir.display()))?;

    for file in files {
        let path = workspace.join(file);
        if !path.exists() {
            fs::write(&path, workspace_template_content(file))
                .map_err(|error| format!("failed to write {}: {error}", path.display()))?;
        }
    }

    let settings_path = settings_dir.join("settings.json");
    let settings = format!(
        "{{\n  \"template\": \"{}\",\n  \"language\": \"zh-CN\",\n  \"defaultModel\": \"minimax-m2.5\",\n  \"thinking\": false\n}}\n",
        template_id
    );
    fs::write(&settings_path, settings)
        .map_err(|error| format!("failed to write {}: {error}", settings_path.display()))?;

    Ok(format!(
        "工作空间已初始化: {} ({})",
        workspace.display(),
        template_id
    ))
}

fn workspace_file_path(filename: &str) -> Result<PathBuf, String> {
    let path = workspace_root().join(filename);
    if path.exists() {
        Ok(path)
    } else {
        Err(format!("工作空间文件不存在: {filename}"))
    }
}

fn workspace_root() -> PathBuf {
    env::var_os("SACODE_WORKSPACE")
        .map(PathBuf::from)
        .unwrap_or_else(|| {
            env::var_os("HOME")
                .map(PathBuf::from)
                .unwrap_or_else(|| PathBuf::from("."))
                .join(".SACODE")
                .join("workspace")
        })
}

fn workspace_template_content(filename: &str) -> &'static str {
    match filename {
        "SOUL.md" => "# SOUL.md\n\n你是 sacode，一个基于项目上下文工作的 AI 助手。\n",
        "USER.md" => "# USER.md\n\n## 用户信息\n- 用户名: [待填写]\n",
        "AGENTS.md" => "# AGENTS.md\n\n## 工作方式\n- 使用中文交流\n- 保持直接、专业\n",
        "TOOLS.md" => "# TOOLS.md\n\n## 工具策略\n- 优先安全\n- 先读后改\n",
        "MEMORY.md" => "# MEMORY.md\n\n记录长期有效的用户偏好和项目知识。\n",
        "PROJECT.md" => "# PROJECT.md\n\n记录项目背景、目标和关键约束。\n",
        "CALENDAR.md" => "# CALENDAR.md\n\n记录日程、提醒和时间安排。\n",
        _ => "",
    }
}

fn handle_model_command(command: &str) {
    let args = split_command_args(command);
    if args.len() < 2 {
        println!(
            "用法: /model list、/model show <provider/model>、/model add <provider-id> <model-id> [label] [capabilities]、/model edit <provider/model> label|capabilities <value>、/model remove <provider/model>、/model use <provider/model> 或 /model test [provider/model]"
        );
        return;
    }

    match args[1].as_str() {
        "list" => print_models(),
        "show" => {
            let Some(model_ref) = args.get(2) else {
                println!("用法: /model show <provider/model>");
                return;
            };
            match show_model(model_ref) {
                Ok(message) => println!("{message}"),
                Err(error) => println!("{error}"),
            }
        }
        "add" => {
            let Some(provider_id) = args.get(2) else {
                println!("用法: /model add <provider-id> <model-id> [label] [capabilities]");
                return;
            };
            let Some(model_id) = args.get(3) else {
                println!("用法: /model add <provider-id> <model-id> [label] [capabilities]");
                return;
            };
            let label = args.get(4).cloned();
            let capabilities = args.get(5).map(|value| split_csv(value));
            match add_provider_model(provider_id, model_id, label, capabilities) {
                Ok(message) => println!("{message}"),
                Err(error) => println!("{error}"),
            }
        }
        "edit" => {
            let Some(model_ref) = args.get(2) else {
                println!("用法: /model edit <provider/model> label|capabilities <value>");
                return;
            };
            let Some(field) = args.get(3) else {
                println!("用法: /model edit <provider/model> label|capabilities <value>");
                return;
            };
            let raw_value = args.iter().skip(4).cloned().collect::<Vec<_>>().join(" ");
            if raw_value.is_empty() {
                println!("用法: /model edit <provider/model> label|capabilities <value>");
                return;
            }
            match edit_model(model_ref, field, &raw_value) {
                Ok(message) => println!("{message}"),
                Err(error) => println!("{error}"),
            }
        }
        "remove" => {
            let Some(model_ref) = args.get(2) else {
                println!("用法: /model remove <provider/model>");
                return;
            };
            match remove_model(model_ref) {
                Ok(message) => println!("{message}"),
                Err(error) => println!("{error}"),
            }
        }
        "use" => {
            let Some(model_ref) = args.get(2) else {
                println!("用法: /model use <provider/model>");
                return;
            };

            match set_default_model(model_ref) {
                Ok(message) => println!("{message}"),
                Err(error) => println!("{error}"),
            }
        }
        "test" => {
            let model_ref = args.get(2).cloned();
            match test_model_command(model_ref) {
                Ok(message) => println!("{message}"),
                Err(error) => println!("{error}"),
            }
        }
        _ => println!(
            "用法: /model list、/model show <provider/model>、/model add <provider-id> <model-id> [label] [capabilities]、/model edit <provider/model> label|capabilities <value>、/model remove <provider/model>、/model use <provider/model> 或 /model test [provider/model]"
        ),
    }
}

fn handle_provider_command(command: &str) {
    let args = split_command_args(command);
    if args.len() < 2 {
        println!(
            "用法: /provider list、/provider show <provider-id>、/provider add <provider-id> <adapter> [name] [model-id]、/provider edit <provider-id> name|adapter|baseUrl|apiKeyEnv <value>、/provider remove <provider-id>、/provider model list <provider-id>、/provider model show <provider-id> <model-id>、/provider model add <provider-id> <model-id> [label] [capabilities]、/provider model edit <provider-id> <model-id> label|capabilities <value>、/provider model remove <provider-id> <model-id>、/provider set-default <provider/model>"
        );
        return;
    }

    match args[1].as_str() {
        "list" => print_providers(),
        "show" => {
            let Some(provider_id) = args.get(2) else {
                println!("用法: /provider show <provider-id>");
                return;
            };
            match show_provider(provider_id) {
                Ok(message) => println!("{message}"),
                Err(error) => println!("{error}"),
            }
        }
        "add" => {
            let Some(provider_id) = args.get(2) else {
                println!("用法: /provider add <provider-id> <adapter> [name] [model-id]");
                return;
            };
            let Some(adapter) = args.get(3) else {
                println!("用法: /provider add <provider-id> <adapter> [name] [model-id]");
                return;
            };
            let name = args.get(4).cloned();
            let model_id = args.get(5).cloned();
            match add_provider(provider_id, adapter, name, model_id) {
                Ok(message) => println!("{message}"),
                Err(error) => println!("{error}"),
            }
        }
        "edit" => {
            let Some(provider_id) = args.get(2) else {
                println!(
                    "用法: /provider edit <provider-id> name|adapter|baseUrl|apiKeyEnv <value>"
                );
                return;
            };
            let Some(field) = args.get(3) else {
                println!(
                    "用法: /provider edit <provider-id> name|adapter|baseUrl|apiKeyEnv <value>"
                );
                return;
            };
            let raw_value = args.iter().skip(4).cloned().collect::<Vec<_>>().join(" ");
            if raw_value.is_empty() {
                println!(
                    "用法: /provider edit <provider-id> name|adapter|baseUrl|apiKeyEnv <value>"
                );
                return;
            }

            match edit_provider(provider_id, field, &raw_value) {
                Ok(message) => println!("{message}"),
                Err(error) => println!("{error}"),
            }
        }
        "remove" => {
            let Some(provider_id) = args.get(2) else {
                println!("用法: /provider remove <provider-id>");
                return;
            };
            match remove_provider(provider_id) {
                Ok(message) => println!("{message}"),
                Err(error) => println!("{error}"),
            }
        }
        "set-default" => {
            let Some(model_ref) = args.get(2) else {
                println!("用法: /provider set-default <provider/model>");
                return;
            };
            match set_default_model(model_ref) {
                Ok(message) => println!("{message}"),
                Err(error) => println!("{error}"),
            }
        }
        "model" => handle_provider_model_command(&args),
        _ => println!(
            "用法: /provider list、/provider show <provider-id>、/provider add <provider-id> <adapter> [name] [model-id]、/provider edit <provider-id> name|adapter|baseUrl|apiKeyEnv <value>、/provider remove <provider-id>、/provider model list <provider-id>、/provider model show <provider-id> <model-id>、/provider model add <provider-id> <model-id> [label] [capabilities]、/provider model edit <provider-id> <model-id> label|capabilities <value>、/provider model remove <provider-id> <model-id>、/provider set-default <provider/model>"
        ),
    }
}

fn handle_provider_model_command(args: &[String]) {
    if args.len() < 4 {
        println!(
            "用法: /provider model list <provider-id>、/provider model show <provider-id> <model-id>、/provider model add <provider-id> <model-id> [label] [capabilities]、/provider model edit <provider-id> <model-id> label|capabilities <value>、/provider model remove <provider-id> <model-id>"
        );
        return;
    }

    match args[2].as_str() {
        "list" => {
            let Some(provider_id) = args.get(3) else {
                println!("用法: /provider model list <provider-id>");
                return;
            };
            match list_provider_models(provider_id) {
                Ok(message) => println!("{message}"),
                Err(error) => println!("{error}"),
            }
        }
        "show" => {
            let Some(provider_id) = args.get(3) else {
                println!("用法: /provider model show <provider-id> <model-id>");
                return;
            };
            let Some(model_id) = args.get(4) else {
                println!("用法: /provider model show <provider-id> <model-id>");
                return;
            };
            match show_provider_model(provider_id, model_id) {
                Ok(message) => println!("{message}"),
                Err(error) => println!("{error}"),
            }
        }
        "add" => {
            let Some(provider_id) = args.get(3) else {
                println!(
                    "用法: /provider model add <provider-id> <model-id> [label] [capabilities]"
                );
                return;
            };
            let Some(model_id) = args.get(4) else {
                println!(
                    "用法: /provider model add <provider-id> <model-id> [label] [capabilities]"
                );
                return;
            };
            let label = args.get(5).cloned();
            let capabilities = args.get(6).map(|value| split_csv(value));
            match add_provider_model(provider_id, model_id, label, capabilities) {
                Ok(message) => println!("{message}"),
                Err(error) => println!("{error}"),
            }
        }
        "edit" => {
            let Some(provider_id) = args.get(3) else {
                println!(
                    "用法: /provider model edit <provider-id> <model-id> label|capabilities <value>"
                );
                return;
            };
            let Some(model_id) = args.get(4) else {
                println!(
                    "用法: /provider model edit <provider-id> <model-id> label|capabilities <value>"
                );
                return;
            };
            let Some(field) = args.get(5) else {
                println!(
                    "用法: /provider model edit <provider-id> <model-id> label|capabilities <value>"
                );
                return;
            };
            let raw_value = args.iter().skip(6).cloned().collect::<Vec<_>>().join(" ");
            if raw_value.is_empty() {
                println!(
                    "用法: /provider model edit <provider-id> <model-id> label|capabilities <value>"
                );
                return;
            }
            match edit_provider_model(provider_id, model_id, field, &raw_value) {
                Ok(message) => println!("{message}"),
                Err(error) => println!("{error}"),
            }
        }
        "remove" => {
            let Some(provider_id) = args.get(3) else {
                println!("用法: /provider model remove <provider-id> <model-id>");
                return;
            };
            let Some(model_id) = args.get(4) else {
                println!("用法: /provider model remove <provider-id> <model-id>");
                return;
            };
            match remove_provider_model(provider_id, model_id) {
                Ok(message) => println!("{message}"),
                Err(error) => println!("{error}"),
            }
        }
        _ => println!(
            "用法: /provider model list <provider-id>、/provider model show <provider-id> <model-id>、/provider model add <provider-id> <model-id> [label] [capabilities]、/provider model edit <provider-id> <model-id> label|capabilities <value>、/provider model remove <provider-id> <model-id>"
        ),
    }
}

fn handle_agent_command(command: &str) {
    let args = split_command_args(command);
    if args.len() < 2 {
        println!(
            "用法: /agent list [--json]、/agent show <agent-id>、/agent add <agent-id> <provider/model>、/agent edit <agent-id> <field> <value>、/agent clone <source-id> <target-id>、/agent enable <agent-id>、/agent disable <agent-id>、/agent remove <agent-id>、/agent use <agent-id>、/agent collab on|off、/agent dispatch on|off"
        );
        return;
    }

    match args[1].as_str() {
        "list" => {
            let json_mode = args.get(2).is_some_and(|value| value == "--json");
            print_agent_list(json_mode);
        }
        "show" => {
            let Some(agent_id) = args.get(2) else {
                println!("用法: /agent show <agent-id>");
                return;
            };
            print_agent_detail(agent_id);
        }
        "add" => {
            let Some(agent_id) = args.get(2) else {
                println!("用法: /agent add <agent-id> <provider/model>");
                return;
            };
            let Some(model_ref) = args.get(3) else {
                println!("用法: /agent add <agent-id> <provider/model>");
                return;
            };

            match add_agent(agent_id, model_ref) {
                Ok(message) => println!("{message}"),
                Err(error) => println!("{error}"),
            }
        }
        "edit" => {
            let Some(agent_id) = args.get(2) else {
                println!("用法: /agent edit <agent-id> <field> <value>");
                return;
            };
            let Some(field) = args.get(3) else {
                println!("用法: /agent edit <agent-id> <field> <value>");
                return;
            };
            let raw_value = args.iter().skip(4).cloned().collect::<Vec<_>>().join(" ");
            if raw_value.is_empty() {
                println!("用法: /agent edit <agent-id> <field> <value>");
                return;
            }

            match edit_agent(agent_id, field, &raw_value) {
                Ok(message) => println!("{message}"),
                Err(error) => println!("{error}"),
            }
        }
        "clone" => {
            let Some(source_id) = args.get(2) else {
                println!("用法: /agent clone <source-id> <target-id>");
                return;
            };
            let Some(target_id) = args.get(3) else {
                println!("用法: /agent clone <source-id> <target-id>");
                return;
            };

            match clone_agent(source_id, target_id) {
                Ok(message) => println!("{message}"),
                Err(error) => println!("{error}"),
            }
        }
        "enable" | "disable" => {
            let Some(agent_id) = args.get(2) else {
                println!("用法: /agent {} <agent-id>", args[1]);
                return;
            };

            match set_agent_enabled(agent_id, args[1] == "enable") {
                Ok(message) => println!("{message}"),
                Err(error) => println!("{error}"),
            }
        }
        "remove" => {
            let Some(agent_id) = args.get(2) else {
                println!("用法: /agent remove <agent-id>");
                return;
            };

            match remove_agent(agent_id) {
                Ok(message) => println!("{message}"),
                Err(error) => println!("{error}"),
            }
        }
        "use" => {
            let Some(agent_id) = args.get(2) else {
                println!("用法: /agent use <agent-id>");
                return;
            };

            match set_default_agent(agent_id) {
                Ok(message) => println!("{message}"),
                Err(error) => println!("{error}"),
            }
        }
        "collab" => {
            let Some(value) = args.get(2) else {
                println!("用法: /agent collab on|off");
                return;
            };

            match set_agent_collaboration(value) {
                Ok(message) => println!("{message}"),
                Err(error) => println!("{error}"),
            }
        }
        "dispatch" => {
            let Some(value) = args.get(2) else {
                println!("用法: /agent dispatch on|off");
                return;
            };

            match set_agent_dispatch(value) {
                Ok(message) => println!("{message}"),
                Err(error) => println!("{error}"),
            }
        }
        _ => println!(
            "用法: /agent list [--json]、/agent show <agent-id>、/agent add <agent-id> <provider/model>、/agent edit <agent-id> <field> <value>、/agent clone <source-id> <target-id>、/agent enable <agent-id>、/agent disable <agent-id>、/agent remove <agent-id>、/agent use <agent-id>、/agent collab on|off、/agent dispatch on|off"
        ),
    }
}

fn handle_lang_command(command: &str) {
    let args = split_command_args(command);
    let Some(language) = args.get(1) else {
        println!("用法: /lang <language-code>");
        return;
    };

    match set_language(language) {
        Ok(message) => println!("{message}"),
        Err(error) => println!("{error}"),
    }
}

fn handle_auth_command(command: &str) {
    let args = split_command_args(command);
    if args.len() < 2 {
        println!(
            "用法: /auth add <provider> <api-key> [alias] [protocol] [base-url] [default-model]、/auth list、/auth current、/auth providers、/auth env、/auth validate、/auth switch <account-id>、/auth remove <account-id>"
        );
        return;
    }

    match args[1].as_str() {
        "add" => {
            let Some(provider) = args.get(2) else {
                println!(
                    "用法: /auth add <provider> <api-key> [alias] [protocol] [base-url] [default-model]"
                );
                return;
            };
            let Some(api_key) = args.get(3) else {
                println!(
                    "用法: /auth add <provider> <api-key> [alias] [protocol] [base-url] [default-model]"
                );
                return;
            };
            let alias = args.get(4).cloned();
            let protocol = args.get(5).cloned();
            let base_url = args.get(6).cloned();
            let default_model = args.get(7).cloned();
            match add_auth_account(provider, api_key, alias, protocol, base_url, default_model) {
                Ok(message) => println!("{message}"),
                Err(error) => println!("{error}"),
            }
        }
        "list" => print_auth_list(),
        "current" => print_auth_current(),
        "providers" => print_auth_providers(),
        "env" => print_auth_env(),
        "validate" => print_auth_validate(),
        "switch" => {
            let Some(account_id) = args.get(2) else {
                println!("用法: /auth switch <account-id>");
                return;
            };
            match switch_auth_account(account_id) {
                Ok(message) => println!("{message}"),
                Err(error) => println!("{error}"),
            }
        }
        "remove" => {
            let Some(account_id) = args.get(2) else {
                println!("用法: /auth remove <account-id>");
                return;
            };
            match remove_auth_account(account_id) {
                Ok(message) => println!("{message}"),
                Err(error) => println!("{error}"),
            }
        }
        _ => {
            println!(
                "用法: /auth add <provider> <api-key> [alias] [protocol] [base-url] [default-model]、/auth list、/auth current、/auth providers、/auth env、/auth validate、/auth switch <account-id>、/auth remove <account-id>"
            )
        }
    }
}

fn handle_settings_command(command: &str) {
    let args = split_command_args(command);
    if args.len() < 2 {
        println!(
            "用法: /settings providers、/settings keys [list|add|update|remove]、/settings oauth [list|add|remove|toggle]"
        );
        return;
    }

    match args[1].as_str() {
        "providers" => print_settings_providers(),
        "keys" => handle_settings_keys_command(&args),
        "oauth" => handle_settings_oauth_command(&args),
        _ => println!(
            "用法: /settings providers、/settings keys [list|add|update|remove]、/settings oauth [list|add|remove|toggle]"
        ),
    }
}

fn handle_settings_keys_command(args: &[String]) {
    let action = args.get(2).map(String::as_str).unwrap_or("list");
    match action {
        "list" => print_settings_keys(),
        "add" => {
            let Some(provider) = args.get(3) else {
                println!("用法: /settings keys add <provider> <name> <enabled:on|off> [base-url]");
                return;
            };
            let Some(name) = args.get(4) else {
                println!("用法: /settings keys add <provider> <name> <enabled:on|off> [base-url]");
                return;
            };
            let Some(enabled_raw) = args.get(5) else {
                println!("用法: /settings keys add <provider> <name> <enabled:on|off> [base-url]");
                return;
            };
            let base_url = args.get(6).cloned();
            match save_settings_key_shell(provider, name, enabled_raw, base_url) {
                Ok(message) => println!("{message}"),
                Err(error) => println!("{error}"),
            }
        }
        "update" => {
            let Some(provider) = args.get(3) else {
                println!(
                    "用法: /settings keys update <provider> <name> <enabled:on|off> [base-url]"
                );
                return;
            };
            let Some(name) = args.get(4) else {
                println!(
                    "用法: /settings keys update <provider> <name> <enabled:on|off> [base-url]"
                );
                return;
            };
            let Some(enabled_raw) = args.get(5) else {
                println!(
                    "用法: /settings keys update <provider> <name> <enabled:on|off> [base-url]"
                );
                return;
            };
            let base_url = args.get(6).cloned();
            match update_settings_key_shell(provider, name, enabled_raw, base_url) {
                Ok(message) => println!("{message}"),
                Err(error) => println!("{error}"),
            }
        }
        "remove" => {
            let Some(provider) = args.get(3) else {
                println!("用法: /settings keys remove <provider>");
                return;
            };
            match delete_settings_key_shell(provider) {
                Ok(message) => println!("{message}"),
                Err(error) => println!("{error}"),
            }
        }
        _ => println!("用法: /settings keys [list|add|update|remove]"),
    }
}

fn handle_settings_oauth_command(args: &[String]) {
    let action = args.get(2).map(String::as_str).unwrap_or("list");
    match action {
        "list" => print_settings_oauth(),
        "add" => {
            let Some(provider) = args.get(3) else {
                println!(
                    "用法: /settings oauth add <provider> <name> <client-id> <client-secret> <callback-url>"
                );
                return;
            };
            let Some(name) = args.get(4) else {
                println!(
                    "用法: /settings oauth add <provider> <name> <client-id> <client-secret> <callback-url>"
                );
                return;
            };
            let Some(client_id) = args.get(5) else {
                println!(
                    "用法: /settings oauth add <provider> <name> <client-id> <client-secret> <callback-url>"
                );
                return;
            };
            let Some(client_secret) = args.get(6) else {
                println!(
                    "用法: /settings oauth add <provider> <name> <client-id> <client-secret> <callback-url>"
                );
                return;
            };
            let Some(callback_url) = args.get(7) else {
                println!(
                    "用法: /settings oauth add <provider> <name> <client-id> <client-secret> <callback-url>"
                );
                return;
            };
            match save_oauth_config_shell(provider, name, client_id, client_secret, callback_url) {
                Ok(message) => println!("{message}"),
                Err(error) => println!("{error}"),
            }
        }
        "remove" => {
            let Some(provider) = args.get(3) else {
                println!("用法: /settings oauth remove <provider>");
                return;
            };
            match delete_oauth_config_shell(provider) {
                Ok(message) => println!("{message}"),
                Err(error) => println!("{error}"),
            }
        }
        "toggle" => {
            let Some(provider) = args.get(3) else {
                println!("用法: /settings oauth toggle <provider> <on|off>");
                return;
            };
            let Some(enabled_raw) = args.get(4) else {
                println!("用法: /settings oauth toggle <provider> <on|off>");
                return;
            };
            match toggle_oauth_config_shell(provider, enabled_raw) {
                Ok(message) => println!("{message}"),
                Err(error) => println!("{error}"),
            }
        }
        _ => println!("用法: /settings oauth [list|add|remove|toggle]"),
    }
}

fn handle_session_command(command: &str) {
    let args = split_command_args(command);
    let action = args.get(1).map(String::as_str);

    match action {
        None => print_session_help(),
        Some("list") => print_session_list(),
        Some("info") => {
            let Some(session_id) = args.get(2) else {
                println!("用法: /session info <sessionId>");
                return;
            };
            print_session_info(session_id);
        }
        Some("clear") => match clear_session_history() {
            Ok(message) => println!("{message}"),
            Err(error) => println!("{error}"),
        },
        Some(_) => println!("用法: /session [list|info|clear]"),
    }
}

fn handle_chat_command(command: &str) {
    let args = split_command_args(command);
    if args.len() == 1 {
        println!("Chat 模式当前可直接输入自然语言任务。可用 /exit 退出。");
        return;
    }

    let message = args.iter().skip(1).cloned().collect::<Vec<_>>().join(" ");
    println!("Chat 模式收到消息: {message}");
    println!("当前版本先提供入口外壳，后续会接入完整对话执行链路。\n");
}

fn handle_code_command(command: &str) {
    let args = split_command_args(command);
    if args.len() == 1 {
        println!("Code 模式当前可直接输入代码任务。可用 /exit 退出。");
        return;
    }

    let prompt = args.iter().skip(1).cloned().collect::<Vec<_>>().join(" ");
    println!("Code 模式收到任务: {prompt}");
    println!("当前版本先提供入口外壳，后续会接入完整 agentic 执行链路。\n");
}

fn handle_cron_command(command: &str) {
    let args = split_command_args(command);
    match args.get(1).map(String::as_str) {
        None | Some("help") => print_cron_help(),
        Some("list") => println!("Cron 入口当前只提供壳子，后续会接入定时任务管理器。"),
        Some("add") => println!("Cron 入口当前只提供壳子，后续会接入定时任务创建。"),
        Some("remove") => println!("Cron 入口当前只提供壳子，后续会接入定时任务删除。"),
        Some("enable") => println!("Cron 入口当前只提供壳子，后续会接入定时任务启用。"),
        Some("disable") => println!("Cron 入口当前只提供壳子，后续会接入定时任务禁用。"),
        Some("run") => println!("Cron 入口当前只提供壳子，后续会接入定时任务立即运行。"),
        Some("stats") => println!("Cron 入口当前只提供壳子，后续会接入定时任务统计。"),
        Some(_) => println!("用法: /cron [help|list|add|remove|enable|disable|run|stats]"),
    }
}

fn handle_plugin_command(command: &str) {
    let args = split_command_args(command);
    match args.get(1).map(String::as_str) {
        None | Some("help") => print_plugin_help(),
        Some("list") => println!("Plugin 入口当前只提供壳子，后续会接入插件列表。"),
        Some("install") => println!("Plugin 入口当前只提供壳子，后续会接入插件安装。"),
        Some("uninstall") => println!("Plugin 入口当前只提供壳子，后续会接入插件卸载。"),
        Some("enable") => println!("Plugin 入口当前只提供壳子，后续会接入插件启用。"),
        Some("disable") => println!("Plugin 入口当前只提供壳子，后续会接入插件禁用。"),
        Some("info") => println!("Plugin 入口当前只提供壳子，后续会接入插件详情。"),
        Some(_) => println!("用法: /plugin [help|list|install|uninstall|enable|disable|info]"),
    }
}

fn handle_memory_command(command: &str) {
    let args = split_command_args(command);
    let action = args.get(1).map(String::as_str);

    match action {
        None | Some("help") => print_memory_help(),
        Some("list") => print_memory_list(),
        Some("show") => {
            let Some(session_id) = args.get(2) else {
                println!("用法: /memory show <sessionId>");
                return;
            };
            print_memory_show(session_id);
        }
        Some("search") => {
            let query = args.iter().skip(2).cloned().collect::<Vec<_>>().join(" ");
            if query.is_empty() {
                println!("用法: /memory search <query>");
                return;
            }
            match recall_memory(&query) {
                Ok(message) => println!("{message}"),
                Err(error) => println!("{error}"),
            }
        }
        Some("append") => {
            let Some(session_id) = args.get(2) else {
                println!("用法: /memory append <sessionId> <content>");
                return;
            };
            let content = args.iter().skip(3).cloned().collect::<Vec<_>>().join(" ");
            if content.is_empty() {
                println!("用法: /memory append <sessionId> <content>");
                return;
            }
            match append_memory(session_id, &content) {
                Ok(message) => println!("{message}"),
                Err(error) => println!("{error}"),
            }
        }
        Some("compact") => {
            let Some(session_id) = args.get(2) else {
                println!("用法: /memory compact <sessionId>");
                return;
            };
            match compact_memory(session_id) {
                Ok(message) => println!("{message}"),
                Err(error) => println!("{error}"),
            }
        }
        Some("delete") => {
            let Some(session_id) = args.get(2) else {
                println!("用法: /memory delete <sessionId>");
                return;
            };
            match mark_memory_deleted(session_id) {
                Ok(message) => println!("{message}"),
                Err(error) => println!("{error}"),
            }
        }
        Some(_) => println!("用法: /memory [list|show|search|append|compact|delete]"),
    }
}

fn handle_config_command(command: &str) {
    let args = split_command_args(command);
    let action = args.get(1).map(String::as_str);

    match action {
        None => print_config_help(),
        Some("list") => print_config_list(),
        Some("get") => {
            let Some(key) = args.get(2) else {
                println!("用法: /config get <key>");
                return;
            };
            print_config_value(key);
        }
        Some("set") => {
            let Some(key) = args.get(2) else {
                println!("用法: /config set <key> <value>");
                return;
            };
            let raw_value = args.iter().skip(3).cloned().collect::<Vec<_>>().join(" ");
            if raw_value.is_empty() {
                println!("用法: /config set <key> <value>");
                return;
            }
            match set_config_value(key, &raw_value) {
                Ok(message) => println!("{message}"),
                Err(error) => println!("{error}"),
            }
        }
        Some("reset") => {
            let scope = args.get(2).map(String::as_str);
            match reset_config(scope) {
                Ok(message) => println!("{message}"),
                Err(error) => println!("{error}"),
            }
        }
        Some(_) => println!("用法: /config [list|get|set|reset]"),
    }
}

fn handle_workspace_command(command: &str) {
    let args = split_command_args(command);
    let action = args.get(1).map(String::as_str);

    match action {
        None => print_workspace_help(),
        Some("show") => print_workspace_show(),
        Some("templates") => print_workspace_templates(),
        Some("init") => {
            let template = args.get(2).map(String::as_str);
            match init_workspace(template) {
                Ok(message) => println!("{message}"),
                Err(error) => println!("{error}"),
            }
        }
        Some("edit") => {
            let Some(filename) = args.get(2) else {
                println!("用法: /workspace edit <filename>");
                return;
            };
            match workspace_file_path(filename) {
                Ok(path) => println!("工作空间文件路径: {}", path.display()),
                Err(error) => println!("{error}"),
            }
        }
        Some(_) => println!("用法: /workspace [init|show|templates|edit]"),
    }
}

fn handle_remember_command(command: &str) {
    let content = command.trim_start_matches("/remember").trim();
    if content.is_empty() {
        println!("用法: /remember <记忆内容>");
        return;
    }

    match remember_memory(content) {
        Ok(message) => println!("{message}"),
        Err(error) => println!("{error}"),
    }
}

fn handle_recall_command(command: &str) {
    let query = command.trim_start_matches("/recall").trim();
    if query.is_empty() {
        println!("用法: /recall <搜索关键词>");
        return;
    }

    match recall_memory(query) {
        Ok(message) => println!("{message}"),
        Err(error) => println!("{error}"),
    }
}

async fn print_status() {
    let db_path = resolve_database_path();
    println!("runtime: rust");
    println!("version: {}", env!("CARGO_PKG_VERSION"));
    println!("entry: shell");
    println!(
        "database: {}",
        db_path.unwrap_or_else(|| "not found".to_string())
    );
    println!("api mode: use `serve` subcommand or /serve to start server");
}

fn print_doctor() {
    let provider_status = match load_provider_store() {
        Ok(store) => {
            let default_model = store.default_model.unwrap_or_else(|| "none".to_string());
            format!("PASS provider store loaded (defaultModel: {default_model})")
        }
        Err(error) => format!("FAIL provider store unavailable: {error}"),
    };

    let agent_status = match load_agent_store() {
        Ok(store) => {
            let default_agent = store.default_agent.unwrap_or_else(|| "none".to_string());
            format!("PASS agent store loaded (defaultAgent: {default_agent})")
        }
        Err(error) => format!("FAIL agent store unavailable: {error}"),
    };

    let cwd_status = match env::current_dir() {
        Ok(path) => {
            if path.join("package.json").exists() {
                format!("PASS workspace detected ({})", path.display())
            } else {
                format!("WARN no package.json found ({})", path.display())
            }
        }
        Err(error) => format!("FAIL unable to resolve cwd: {error}"),
    };

    println!("SaCode Doctor\n\nChecks\n- {provider_status}\n- {agent_status}\n- {cwd_status}\n");
}

fn load_provider_store() -> Result<ProviderStoreData, String> {
    let path = sacode_config_dir().join("providers.json");
    let raw = fs::read_to_string(&path)
        .map_err(|error| format!("failed to read {}: {error}", path.display()))?;
    serde_json::from_str(&raw)
        .map_err(|error| format!("failed to parse {}: {error}", path.display()))
}

fn load_cli_config() -> Result<CliConfigData, String> {
    let path = sacode_config_dir().join("cli-config.json");
    if !path.exists() {
        let config = default_cli_config();
        save_cli_config(&config)?;
        return Ok(config);
    }

    let raw = fs::read_to_string(&path)
        .map_err(|error| format!("failed to read {}: {error}", path.display()))?;
    serde_json::from_str(&raw)
        .map_err(|error| format!("failed to parse {}: {error}", path.display()))
}

fn save_cli_config(config: &CliConfigData) -> Result<(), String> {
    let path = sacode_config_dir().join("cli-config.json");
    fs::create_dir_all(sacode_config_dir()).map_err(|error| {
        format!(
            "failed to create {}: {error}",
            sacode_config_dir().display()
        )
    })?;
    let content = serde_json::to_string_pretty(config)
        .map_err(|error| format!("failed to serialize cli config: {error}"))?;
    fs::write(&path, format!("{content}\n"))
        .map_err(|error| format!("failed to write {}: {error}", path.display()))
}

fn save_provider_store(store: &ProviderStoreData) -> Result<(), String> {
    let path = sacode_config_dir().join("providers.json");
    fs::create_dir_all(sacode_config_dir()).map_err(|error| {
        format!(
            "failed to create {}: {error}",
            sacode_config_dir().display()
        )
    })?;

    let payload = ProviderStoreWriteData {
        providers: store
            .providers
            .iter()
            .map(|provider| ProviderStoreWriteEntry {
                id: provider.id.clone(),
                name: provider.name.clone(),
                adapter: provider.adapter.clone(),
                base_url: provider.base_url.clone(),
                api_key_env: provider.api_key_env.clone(),
                models: provider
                    .models
                    .iter()
                    .map(|model| ProviderModelWriteEntry {
                        id: model.id.clone(),
                        label: model.label.clone(),
                        capabilities: model.capabilities.clone(),
                    })
                    .collect(),
            })
            .collect(),
        default_model: store.default_model.clone(),
    };

    let content = serde_json::to_string_pretty(&payload)
        .map_err(|error| format!("failed to serialize provider store: {error}"))?;
    fs::write(&path, format!("{content}\n"))
        .map_err(|error| format!("failed to write {}: {error}", path.display()))
}

fn load_auth_store() -> Result<AuthStoreData, String> {
    let path = sacode_config_dir().join("codingplan.json");
    if !path.exists() {
        let store = default_auth_store();
        save_auth_store(&store)?;
        return Ok(store);
    }
    let raw = fs::read_to_string(&path)
        .map_err(|error| format!("failed to read {}: {error}", path.display()))?;
    serde_json::from_str(&raw)
        .map_err(|error| format!("failed to parse {}: {error}", path.display()))
}

fn save_auth_store(store: &AuthStoreData) -> Result<(), String> {
    let path = sacode_config_dir().join("codingplan.json");
    fs::create_dir_all(sacode_config_dir()).map_err(|error| {
        format!(
            "failed to create {}: {error}",
            sacode_config_dir().display()
        )
    })?;
    let content = serde_json::to_string_pretty(store)
        .map_err(|error| format!("failed to serialize auth store: {error}"))?;
    fs::write(&path, format!("{content}\n"))
        .map_err(|error| format!("failed to write {}: {error}", path.display()))
}

fn default_auth_store() -> AuthStoreData {
    AuthStoreData {
        accounts: Vec::new(),
        active_account_id: String::new(),
        global_defaults: AuthGlobalDefaults {
            max_tokens: 4096,
            temperature: 0.7,
            preferred_protocol: "openai".to_string(),
        },
    }
}

fn add_auth_account(
    provider: &str,
    api_key: &str,
    alias: Option<String>,
    protocol: Option<String>,
    base_url: Option<String>,
    default_model: Option<String>,
) -> Result<String, String> {
    let mut store = load_auth_store()?;
    let protocol = protocol.unwrap_or_else(|| store.global_defaults.preferred_protocol.clone());
    let provider = provider.to_string();
    let account_id = format!("acc-{}", iso_id_suffix());
    let is_first = store.accounts.is_empty();
    let account = AuthAccountEntry {
        id: account_id.clone(),
        alias: alias.unwrap_or_else(|| format!("{}-{}", provider, &account_id[4..8])),
        provider,
        api_key: api_key.to_string(),
        base_url: base_url.unwrap_or_else(|| default_auth_base_url(&protocol)),
        protocol,
        default_model,
        is_active: is_first,
        created_at: iso_timestamp_now(),
        last_used_at: None,
    };
    if account.is_active {
        store.active_account_id = account.id.clone();
    }
    store.accounts.push(account.clone());
    save_auth_store(&store)?;
    Ok(format!(
        "认证账户已添加: {} ({})",
        account.alias, account.id
    ))
}

fn switch_auth_account(account_id: &str) -> Result<String, String> {
    let mut store = load_auth_store()?;
    let Some(index) = store
        .accounts
        .iter()
        .position(|account| account.id == account_id)
    else {
        return Err(format!("Account 不存在: {account_id}"));
    };
    for account in &mut store.accounts {
        account.is_active = false;
    }
    store.accounts[index].is_active = true;
    store.accounts[index].last_used_at = Some(iso_timestamp_now());
    store.active_account_id = account_id.to_string();
    let alias = store.accounts[index].alias.clone();
    save_auth_store(&store)?;
    Ok(format!("已切换到认证账户: {alias} ({account_id})"))
}

fn remove_auth_account(account_id: &str) -> Result<String, String> {
    let mut store = load_auth_store()?;
    let before = store.accounts.len();
    store.accounts.retain(|account| account.id != account_id);
    if store.accounts.len() == before {
        return Err(format!("Account 不存在: {account_id}"));
    }
    if store.active_account_id == account_id {
        if let Some(first) = store.accounts.first_mut() {
            first.is_active = true;
            store.active_account_id = first.id.clone();
        } else {
            store.active_account_id.clear();
        }
    }
    save_auth_store(&store)?;
    Ok(format!("认证账户已删除: {account_id}"))
}

fn default_auth_base_url(protocol: &str) -> String {
    match protocol {
        "anthropic" => "https://api.anthropic.com".to_string(),
        _ => "https://api.openai.com/v1".to_string(),
    }
}

fn load_settings_keys() -> Result<Vec<SettingsKeyEntry>, String> {
    let path = resolve_database_path().ok_or_else(database_unavailable_message)?;
    run_async_blocking(async {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect(&format!("sqlite://{path}"))
            .await
            .map_err(|error| format!("failed to connect database: {error}"))?;
        load_api_keys(&pool)
            .await
            .map(|keys| {
                keys.into_iter()
                    .map(|key| SettingsKeyEntry {
                        name: key.name,
                        provider: key.provider,
                    })
                    .collect::<Vec<_>>()
            })
            .map_err(|error| error.to_string())
    })
}

fn load_oauth_configs_for_shell() -> Result<Vec<OAuthConfigResponse>, String> {
    let path = resolve_database_path().ok_or_else(database_unavailable_message)?;
    run_async_blocking(async {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect(&format!("sqlite://{path}"))
            .await
            .map_err(|error| format!("failed to connect database: {error}"))?;
        load_oauth_configs(&pool)
            .await
            .map_err(|error| error.to_string())
    })
}

fn save_settings_key_shell(
    provider: &str,
    name: &str,
    enabled_raw: &str,
    base_url: Option<String>,
) -> Result<String, String> {
    let enabled = parse_on_off(enabled_raw).ok_or_else(|| "enabled 仅支持 on|off".to_string())?;
    with_shell_db(|pool| async move {
        let now = iso_timestamp_now();
        let id = format!("api-key-{}", iso_id_suffix());
        let _ = sqlx::query(
            "INSERT INTO api_keys (id, provider, name, api_key, base_url, enabled, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(&id)
        .bind(provider)
        .bind(name)
        .bind("managed-by-rust-shell")
        .bind(base_url)
        .bind(bool_to_sqlite_int(enabled))
        .bind(&now)
        .bind(&now)
        .execute(&pool)
        .await
        .map_err(|error| error.to_string())?;
        Ok(format!("API Key 配置已新增: {provider}"))
    })
}

fn update_settings_key_shell(
    provider: &str,
    name: &str,
    enabled_raw: &str,
    base_url: Option<String>,
) -> Result<String, String> {
    let enabled = parse_on_off(enabled_raw).ok_or_else(|| "enabled 仅支持 on|off".to_string())?;
    with_shell_db(|pool| async move {
        let now = iso_timestamp_now();
        let _ = sqlx::query(
            "UPDATE api_keys SET name = ?, base_url = ?, enabled = ?, updated_at = ? WHERE provider = ?",
        )
        .bind(name)
        .bind(base_url)
        .bind(bool_to_sqlite_int(enabled))
        .bind(&now)
        .bind(provider)
        .execute(&pool)
        .await
        .map_err(|error| error.to_string())?;
        Ok(format!("API Key 配置已更新: {provider}"))
    })
}

fn delete_settings_key_shell(provider: &str) -> Result<String, String> {
    with_shell_db(|pool| async move {
        let _ = sqlx::query("DELETE FROM api_keys WHERE provider = ?")
            .bind(provider)
            .execute(&pool)
            .await
            .map_err(|error| error.to_string())?;
        Ok(format!("API Key 配置已删除: {provider}"))
    })
}

fn save_oauth_config_shell(
    provider: &str,
    name: &str,
    client_id: &str,
    client_secret: &str,
    callback_url: &str,
) -> Result<String, String> {
    with_shell_db(|pool| async move {
        let now = iso_timestamp_now();
        let id = format!("oauth-{}", iso_id_suffix());
        let _ = sqlx::query(
            "INSERT INTO oauth_configs (id, provider, name, client_id, client_secret, callback_url, corp_id, agent_id, enabled, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(&id)
        .bind(provider)
        .bind(name)
        .bind(client_id)
        .bind(client_secret)
        .bind(callback_url)
        .bind(Option::<String>::None)
        .bind(Option::<String>::None)
        .bind(1)
        .bind(&now)
        .bind(&now)
        .execute(&pool)
        .await
        .map_err(|error| error.to_string())?;
        Ok(format!("OAuth 配置已新增: {provider}"))
    })
}

fn delete_oauth_config_shell(provider: &str) -> Result<String, String> {
    with_shell_db(|pool| async move {
        let _ = sqlx::query("DELETE FROM oauth_configs WHERE provider = ?")
            .bind(provider)
            .execute(&pool)
            .await
            .map_err(|error| error.to_string())?;
        Ok(format!("OAuth 配置已删除: {provider}"))
    })
}

fn toggle_oauth_config_shell(provider: &str, enabled_raw: &str) -> Result<String, String> {
    let enabled = parse_on_off(enabled_raw).ok_or_else(|| "enabled 仅支持 on|off".to_string())?;
    with_shell_db(|pool| async move {
        let now = iso_timestamp_now();
        let _ =
            sqlx::query("UPDATE oauth_configs SET enabled = ?, updated_at = ? WHERE provider = ?")
                .bind(bool_to_sqlite_int(enabled))
                .bind(&now)
                .bind(provider)
                .execute(&pool)
                .await
                .map_err(|error| error.to_string())?;
        Ok(format!(
            "OAuth 配置已{}: {provider}",
            if enabled { "启用" } else { "禁用" }
        ))
    })
}

fn with_shell_db<F, Fut, T>(operation: F) -> Result<T, String>
where
    F: FnOnce(Pool<Sqlite>) -> Fut,
    Fut: std::future::Future<Output = Result<T, String>>,
{
    let path = resolve_database_path().ok_or_else(database_unavailable_message)?;
    run_async_blocking(async move {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect(&format!("sqlite://{path}"))
            .await
            .map_err(|error| format!("failed to connect database: {error}"))?;
        operation(pool).await
    })
}

fn load_agent_store() -> Result<AgentStoreData, String> {
    let path = sacode_config_dir().join("agents.json");
    let raw = fs::read_to_string(&path)
        .map_err(|error| format!("failed to read {}: {error}", path.display()))?;
    serde_json::from_str(&raw)
        .map_err(|error| format!("failed to parse {}: {error}", path.display()))
}

fn save_agent_store(store: &AgentStoreData) -> Result<(), String> {
    let path = sacode_config_dir().join("agents.json");
    fs::create_dir_all(sacode_config_dir()).map_err(|error| {
        format!(
            "failed to create {}: {error}",
            sacode_config_dir().display()
        )
    })?;

    let payload = AgentStoreWriteData {
        agents: store
            .agents
            .iter()
            .map(|agent| AgentStoreWriteEntry {
                id: agent.id.clone(),
                name: agent.name.clone(),
                model: agent.model.clone(),
                tools: agent.tools.clone(),
                permission_profile: agent.permission_profile.clone(),
                enabled: agent.enabled,
                sub_agents: agent.sub_agents.clone(),
                description: agent.description.clone(),
            })
            .collect(),
        default_agent: store.default_agent.clone(),
        collaboration_enabled: store.collaboration_enabled,
        sub_agent_dispatch_enabled: store.sub_agent_dispatch_enabled,
    };

    let content = serde_json::to_string_pretty(&payload)
        .map_err(|error| format!("failed to serialize agent store: {error}"))?;
    fs::write(&path, format!("{content}\n"))
        .map_err(|error| format!("failed to write {}: {error}", path.display()))
}

fn set_language(language: &str) -> Result<String, String> {
    let mut config = load_cli_config()?;
    config.language = Some(language.to_string());
    save_cli_config(&config)?;
    Ok(format!("语言已切换为: {language}"))
}

fn set_default_model(model_ref: &str) -> Result<String, String> {
    let mut store = load_provider_store()?;
    let Some((provider, model)) = find_model(&store, model_ref) else {
        return Err(format!("模型不存在: {model_ref}"));
    };

    if provider.adapter == "openai-compatible" && provider.base_url.is_none() {
        return Err(format!("模型配置不完整: {model_ref} 缺少 baseUrl"));
    }
    if provider.api_key_env.is_empty() {
        return Err(format!("模型配置不完整: {model_ref} 缺少 apiKeyEnv"));
    }

    store.default_model = Some(format!("{}/{}", provider.id, model.id));
    save_provider_store(&store)?;
    Ok(format!("默认模型已切换为: {model_ref}"))
}

fn show_provider(provider_id: &str) -> Result<String, String> {
    let store = load_provider_store()?;
    let Some(provider) = store.providers.iter().find(|item| item.id == provider_id) else {
        return Err(format!("Provider 不存在: {provider_id}"));
    };

    let mut lines = vec![
        format!("Provider: {}", provider.id),
        format!("name: {}", provider.name),
        format!("adapter: {}", provider.adapter),
        format!("apiKeyEnv: {}", provider.api_key_env),
    ];
    if let Some(base_url) = &provider.base_url {
        lines.push(format!("baseUrl: {base_url}"));
    }
    let models = if provider.models.is_empty() {
        "none".to_string()
    } else {
        provider
            .models
            .iter()
            .map(|model| {
                let label = model.label.clone().unwrap_or_else(|| model.id.clone());
                format!("{} ({})", model.id, label)
            })
            .collect::<Vec<_>>()
            .join(", ")
    };
    lines.push(format!("models: {models}"));
    Ok(lines.join("\n"))
}

fn add_provider(
    provider_id: &str,
    adapter: &str,
    name: Option<String>,
    model_id: Option<String>,
) -> Result<String, String> {
    let mut store = load_provider_store()?;
    let provider_id = normalize_provider_id(provider_id);
    if provider_id.is_empty() {
        return Err("Provider id 不能为空".to_string());
    }
    if !is_supported_adapter(adapter) {
        return Err("adapter 仅支持 openai-compatible、anthropic、custom-http".to_string());
    }

    let model_id = model_id.unwrap_or_else(|| "default".to_string());

    let entry = ProviderStoreEntry {
        id: provider_id.clone(),
        name: name.unwrap_or_else(|| to_title_case(&provider_id)),
        adapter: adapter.to_string(),
        base_url: Some(default_base_url_for_adapter(adapter).to_string()),
        api_key_env: default_api_key_env(&provider_id),
        models: vec![ProviderModelEntry {
            id: model_id.clone(),
            label: None,
            capabilities: vec!["chat".to_string()],
        }],
    };

    if let Some(index) = store
        .providers
        .iter()
        .position(|item| item.id == provider_id)
    {
        store.providers[index] = entry;
    } else {
        store.providers.push(entry);
    }

    if store.default_model.is_none() {
        store.default_model = Some(format!("{provider_id}/{model_id}"));
    }

    save_provider_store(&store)?;
    Ok(format!("Provider 已保存: {provider_id}"))
}

fn edit_provider(provider_id: &str, field: &str, raw_value: &str) -> Result<String, String> {
    let mut store = load_provider_store()?;
    let Some(index) = store
        .providers
        .iter()
        .position(|item| item.id == provider_id)
    else {
        return Err(format!("Provider 不存在: {provider_id}"));
    };

    let provider = &mut store.providers[index];
    match field {
        "name" => provider.name = raw_value.to_string(),
        "adapter" => {
            if !is_supported_adapter(raw_value) {
                return Err("adapter 仅支持 openai-compatible、anthropic、custom-http".to_string());
            }
            provider.adapter = raw_value.to_string();
        }
        "baseUrl" => provider.base_url = Some(raw_value.to_string()),
        "apiKeyEnv" => provider.api_key_env = raw_value.to_string(),
        _ => return Err("可编辑字段: name, adapter, baseUrl, apiKeyEnv".to_string()),
    }

    save_provider_store(&store)?;
    Ok(format!("Provider 已更新: {provider_id} ({field})"))
}

fn remove_provider(provider_id: &str) -> Result<String, String> {
    let mut store = load_provider_store()?;
    let Some(index) = store
        .providers
        .iter()
        .position(|item| item.id == provider_id)
    else {
        return Err(format!("Provider 不存在: {provider_id}"));
    };

    let removed = store.providers.remove(index);
    let removed_model_refs: Vec<String> = removed
        .models
        .iter()
        .map(|model| format!("{provider_id}/{}", model.id))
        .collect();
    if let Some(default_model) = &store.default_model {
        if removed_model_refs
            .iter()
            .any(|model_ref| model_ref == default_model)
        {
            store.default_model = store
                .providers
                .iter()
                .flat_map(|provider| {
                    provider
                        .models
                        .iter()
                        .map(move |model| format!("{}/{}", provider.id, model.id))
                })
                .next();
        }
    }

    save_provider_store(&store)?;
    Ok(format!("Provider 已删除: {provider_id}"))
}

fn list_provider_models(provider_id: &str) -> Result<String, String> {
    let store = load_provider_store()?;
    let Some(provider) = store.providers.iter().find(|item| item.id == provider_id) else {
        return Err(format!("Provider 不存在: {provider_id}"));
    };

    let mut lines = vec![format!("Provider models: {provider_id}")];
    for model in &provider.models {
        let label = model.label.clone().unwrap_or_else(|| model.id.clone());
        lines.push(format!(
            "- {} ({}) [{}]",
            model.id,
            label,
            model.capabilities.join(", ")
        ));
    }
    Ok(lines.join("\n"))
}

fn show_provider_model(provider_id: &str, model_id: &str) -> Result<String, String> {
    let store = load_provider_store()?;
    let Some(provider) = store.providers.iter().find(|item| item.id == provider_id) else {
        return Err(format!("Provider 不存在: {provider_id}"));
    };
    let Some(model) = provider.models.iter().find(|item| item.id == model_id) else {
        return Err(format!("Model 不存在: {provider_id}/{model_id}"));
    };

    Ok([
        format!("Model: {provider_id}/{model_id}"),
        format!(
            "label: {}",
            model.label.clone().unwrap_or_else(|| "none".to_string())
        ),
        format!("capabilities: {}", model.capabilities.join(", ")),
    ]
    .join("\n"))
}

fn add_provider_model(
    provider_id: &str,
    model_id: &str,
    label: Option<String>,
    capabilities: Option<Vec<String>>,
) -> Result<String, String> {
    let mut store = load_provider_store()?;
    let Some(provider) = store
        .providers
        .iter_mut()
        .find(|item| item.id == provider_id)
    else {
        return Err(format!("Provider 不存在: {provider_id}"));
    };

    if provider.models.iter().any(|model| model.id == model_id) {
        return Err(format!("Model 已存在: {provider_id}/{model_id}"));
    }

    provider.models.push(ProviderModelEntry {
        id: model_id.to_string(),
        label,
        capabilities: capabilities.unwrap_or_else(|| vec!["chat".to_string()]),
    });
    save_provider_store(&store)?;
    Ok(format!("Model 已保存: {provider_id}/{model_id}"))
}

fn edit_provider_model(
    provider_id: &str,
    model_id: &str,
    field: &str,
    raw_value: &str,
) -> Result<String, String> {
    let mut store = load_provider_store()?;
    let Some(provider) = store
        .providers
        .iter_mut()
        .find(|item| item.id == provider_id)
    else {
        return Err(format!("Provider 不存在: {provider_id}"));
    };
    let Some(model) = provider.models.iter_mut().find(|item| item.id == model_id) else {
        return Err(format!("Model 不存在: {provider_id}/{model_id}"));
    };

    match field {
        "label" => model.label = Some(raw_value.to_string()),
        "capabilities" => model.capabilities = split_csv(raw_value),
        _ => return Err("可编辑字段: label, capabilities".to_string()),
    }

    save_provider_store(&store)?;
    Ok(format!("Model 已更新: {provider_id}/{model_id} ({field})"))
}

fn remove_provider_model(provider_id: &str, model_id: &str) -> Result<String, String> {
    let mut store = load_provider_store()?;
    let Some(provider) = store
        .providers
        .iter_mut()
        .find(|item| item.id == provider_id)
    else {
        return Err(format!("Provider 不存在: {provider_id}"));
    };

    let before = provider.models.len();
    provider.models.retain(|model| model.id != model_id);
    if provider.models.len() == before {
        return Err(format!("Model 不存在: {provider_id}/{model_id}"));
    }

    if store.default_model.as_deref() == Some(&format!("{provider_id}/{model_id}")) {
        store.default_model = store
            .providers
            .iter()
            .flat_map(|provider| {
                provider
                    .models
                    .iter()
                    .map(move |model| format!("{}/{}", provider.id, model.id))
            })
            .next();
    }

    save_provider_store(&store)?;
    Ok(format!("Model 已删除: {provider_id}/{model_id}"))
}

fn show_model(model_ref: &str) -> Result<String, String> {
    let store = load_provider_store()?;
    let Some((provider, model)) = find_model(&store, model_ref) else {
        return Err(format!("模型不存在: {model_ref}"));
    };

    Ok([
        format!("Model: {}/{}", provider.id, model.id),
        format!("provider: {}", provider.name),
        format!("adapter: {}", provider.adapter),
        format!(
            "label: {}",
            model.label.clone().unwrap_or_else(|| "none".to_string())
        ),
        format!("capabilities: {}", model.capabilities.join(", ")),
        format!(
            "default: {}",
            store.default_model.as_deref() == Some(model_ref)
        ),
    ]
    .join("\n"))
}

fn edit_model(model_ref: &str, field: &str, raw_value: &str) -> Result<String, String> {
    let mut store = load_provider_store()?;
    let Some((provider_id, model_id)) = model_ref.split_once('/') else {
        return Err(format!("模型不存在: {model_ref}"));
    };
    let Some(provider) = store
        .providers
        .iter_mut()
        .find(|item| item.id == provider_id)
    else {
        return Err(format!("模型不存在: {model_ref}"));
    };
    let Some(model) = provider.models.iter_mut().find(|item| item.id == model_id) else {
        return Err(format!("模型不存在: {model_ref}"));
    };

    match field {
        "label" => model.label = Some(raw_value.to_string()),
        "capabilities" => model.capabilities = split_csv(raw_value),
        _ => return Err("可编辑字段: label, capabilities".to_string()),
    }

    save_provider_store(&store)?;
    Ok(format!("Model 已更新: {model_ref} ({field})"))
}

fn remove_model(model_ref: &str) -> Result<String, String> {
    let mut store = load_provider_store()?;
    let Some((provider_id, model_id)) = model_ref.split_once('/') else {
        return Err(format!("模型不存在: {model_ref}"));
    };
    let Some(provider) = store
        .providers
        .iter_mut()
        .find(|item| item.id == provider_id)
    else {
        return Err(format!("模型不存在: {model_ref}"));
    };

    let before = provider.models.len();
    provider.models.retain(|model| model.id != model_id);
    if provider.models.len() == before {
        return Err(format!("模型不存在: {model_ref}"));
    }

    if store.default_model.as_deref() == Some(model_ref) {
        store.default_model = store
            .providers
            .iter()
            .flat_map(|provider| {
                provider
                    .models
                    .iter()
                    .map(move |model| format!("{}/{}", provider.id, model.id))
            })
            .next();
    }

    save_provider_store(&store)?;
    Ok(format!("Model 已删除: {model_ref}"))
}

fn test_model_command(model_ref: Option<String>) -> Result<String, String> {
    let store = load_provider_store()?;
    let target = model_ref
        .or(store.default_model.clone())
        .ok_or_else(|| "没有默认模型。用法: /model test <provider/model>".to_string())?;
    let Some((provider, model)) = find_model(&store, &target) else {
        return Err(format!("模型不存在: {target}"));
    };

    let mut missing = Vec::new();
    if provider.adapter.is_empty() {
        missing.push("adapter");
    }
    if provider.api_key_env.is_empty() {
        missing.push("apiKeyEnv");
    }
    if provider.adapter == "openai-compatible" && provider.base_url.is_none() {
        missing.push("baseUrl");
    }
    if !missing.is_empty() {
        return Ok(format!("模型配置不完整: {}", missing.join(", ")));
    }

    Ok(format!(
        "模型配置可用: {}/{}\nadapter: {}\napiKeyEnv: {}{}",
        provider.id,
        model.id,
        provider.adapter,
        provider.api_key_env,
        provider
            .base_url
            .as_ref()
            .map(|base_url| format!("\nbaseUrl: {base_url}"))
            .unwrap_or_default()
    ))
}

fn set_default_agent(agent_id: &str) -> Result<String, String> {
    let mut store = load_agent_store()?;
    let enabled = store
        .agents
        .iter()
        .any(|agent| agent.id == agent_id && agent.enabled);
    if !enabled {
        return Err(format!("Agent 不存在或未启用: {agent_id}"));
    }

    store.default_agent = Some(agent_id.to_string());
    save_agent_store(&store)?;
    Ok(format!("默认 Agent 已切换为: {agent_id}"))
}

fn add_agent(agent_id: &str, model_ref: &str) -> Result<String, String> {
    let provider_store = load_provider_store()?;
    let Some(_) = find_model(&provider_store, model_ref) else {
        return Err(format!("模型不存在: {model_ref}"));
    };

    let mut store = load_agent_store()?;
    let next_agent = AgentStoreEntry {
        id: agent_id.to_string(),
        name: to_title_case(agent_id),
        model: model_ref.to_string(),
        tools: Vec::new(),
        permission_profile: "local-safe".to_string(),
        enabled: true,
        sub_agents: Vec::new(),
        description: None,
    };

    if let Some(index) = store.agents.iter().position(|agent| agent.id == agent_id) {
        store.agents[index] = next_agent;
    } else {
        store.agents.push(next_agent);
    }
    if store.default_agent.is_none() {
        store.default_agent = Some(agent_id.to_string());
    }

    save_agent_store(&store)?;
    Ok(format!("Agent 已保存: {agent_id} -> {model_ref}"))
}

fn edit_agent(agent_id: &str, field: &str, raw_value: &str) -> Result<String, String> {
    let provider_store = load_provider_store()?;
    let mut store = load_agent_store()?;
    let Some(index) = store.agents.iter().position(|agent| agent.id == agent_id) else {
        return Err(format!("Agent 不存在: {agent_id}"));
    };

    let updated = apply_agent_edit(&store.agents[index], field, raw_value, &provider_store)?;
    store.agents[index] = updated;
    save_agent_store(&store)?;
    Ok(format!("Agent 已更新: {agent_id} ({field})"))
}

fn clone_agent(source_id: &str, target_id: &str) -> Result<String, String> {
    let mut store = load_agent_store()?;
    let Some(source) = store
        .agents
        .iter()
        .find(|agent| agent.id == source_id)
        .cloned()
    else {
        return Err(format!("Agent 不存在: {source_id}"));
    };
    if store.agents.iter().any(|agent| agent.id == target_id) {
        return Err(format!("Agent 已存在: {target_id}"));
    }

    let cloned = AgentStoreEntry {
        id: target_id.to_string(),
        name: format!("{} Copy", source.name),
        model: source.model,
        tools: source.tools,
        permission_profile: source.permission_profile,
        enabled: source.enabled,
        sub_agents: source.sub_agents,
        description: source.description,
    };

    store.agents.push(cloned);
    if store.default_agent.is_none() {
        store.default_agent = Some(target_id.to_string());
    }

    save_agent_store(&store)?;
    Ok(format!("Agent 已复制: {source_id} -> {target_id}"))
}

fn set_agent_enabled(agent_id: &str, enabled: bool) -> Result<String, String> {
    let mut store = load_agent_store()?;
    let Some(index) = store.agents.iter().position(|agent| agent.id == agent_id) else {
        return Err(format!("Agent 不存在: {agent_id}"));
    };

    if !enabled {
        let referenced_by = find_agent_references(&store.agents, agent_id);
        if !referenced_by.is_empty() {
            return Err(format!(
                "Agent 仍被以下 Agent 引用: {}",
                referenced_by.join(", ")
            ));
        }
    }

    store.agents[index].enabled = enabled;
    if !enabled && store.default_agent.as_deref() == Some(agent_id) {
        store.default_agent = store
            .agents
            .iter()
            .find(|agent| agent.id != agent_id && agent.enabled)
            .map(|agent| agent.id.clone());
    }

    save_agent_store(&store)?;
    Ok(format!(
        "Agent 已{}: {agent_id}",
        if enabled { "启用" } else { "禁用" }
    ))
}

fn apply_agent_edit(
    agent: &AgentStoreEntry,
    field: &str,
    raw_value: &str,
    provider_store: &ProviderStoreData,
) -> Result<AgentStoreEntry, String> {
    match field {
        "model" => {
            let Some(_) = find_model(provider_store, raw_value) else {
                return Err(format!("模型不存在: {raw_value}"));
            };
            let mut updated = agent.clone();
            updated.model = raw_value.to_string();
            Ok(updated)
        }
        "tools" => {
            let mut updated = agent.clone();
            updated.tools = split_csv(raw_value);
            Ok(updated)
        }
        "subagents" => {
            let mut updated = agent.clone();
            updated.sub_agents = split_csv(raw_value);
            Ok(updated)
        }
        "description" => {
            let mut updated = agent.clone();
            updated.description = Some(raw_value.to_string());
            Ok(updated)
        }
        "permission" => {
            let mut updated = agent.clone();
            updated.permission_profile = raw_value.to_string();
            Ok(updated)
        }
        "enabled" => {
            let Some(enabled) = parse_on_off(raw_value) else {
                return Err("enabled 仅支持 on|off".to_string());
            };
            let mut updated = agent.clone();
            updated.enabled = enabled;
            Ok(updated)
        }
        "name" => {
            let mut updated = agent.clone();
            updated.name = raw_value.to_string();
            Ok(updated)
        }
        _ => Err(
            "可编辑字段: model, tools, subagents, description, permission, enabled, name"
                .to_string(),
        ),
    }
}

fn remove_agent(agent_id: &str) -> Result<String, String> {
    let mut store = load_agent_store()?;
    let Some(index) = store.agents.iter().position(|agent| agent.id == agent_id) else {
        return Err(format!("Agent 不存在: {agent_id}"));
    };

    let referenced_by = find_agent_references(&store.agents, agent_id);
    if !referenced_by.is_empty() {
        return Err(format!(
            "Agent 仍被以下 Agent 引用: {}",
            referenced_by.join(", ")
        ));
    }

    store.agents.remove(index);
    if store.default_agent.as_deref() == Some(agent_id) {
        store.default_agent = store
            .agents
            .iter()
            .find(|agent| agent.enabled)
            .map(|agent| agent.id.clone());
    }

    save_agent_store(&store)?;
    Ok(format!("Agent 已删除: {agent_id}"))
}

fn set_agent_collaboration(value: &str) -> Result<String, String> {
    let enabled = parse_on_off(value).ok_or_else(|| "用法: /agent collab on|off".to_string())?;
    let mut store = load_agent_store()?;
    store.collaboration_enabled = enabled;
    save_agent_store(&store)?;
    Ok(format!(
        "多 Agent 协作已{}",
        if enabled { "开启" } else { "关闭" }
    ))
}

fn set_agent_dispatch(value: &str) -> Result<String, String> {
    let enabled = parse_on_off(value).ok_or_else(|| "用法: /agent dispatch on|off".to_string())?;
    let mut store = load_agent_store()?;
    store.sub_agent_dispatch_enabled = enabled;
    save_agent_store(&store)?;
    Ok(format!(
        "子 Agent 调度已{}",
        if enabled { "开启" } else { "关闭" }
    ))
}

fn find_model<'a>(
    store: &'a ProviderStoreData,
    model_ref: &str,
) -> Option<(&'a ProviderStoreEntry, &'a ProviderModelEntry)> {
    let mut parts = model_ref.split('/');
    let provider_id = parts.next()?;
    let model_id = parts.next()?;
    if parts.next().is_some() || provider_id.is_empty() || model_id.is_empty() {
        return None;
    }

    let provider = store.providers.iter().find(|item| item.id == provider_id)?;
    let model = provider.models.iter().find(|item| item.id == model_id)?;
    Some((provider, model))
}

fn parse_on_off(value: &str) -> Option<bool> {
    match value {
        "on" | "true" | "1" | "yes" | "enable" | "enabled" => Some(true),
        "off" | "false" | "0" | "no" | "disable" | "disabled" => Some(false),
        _ => None,
    }
}

fn split_csv(value: &str) -> Vec<String> {
    value
        .split(',')
        .map(str::trim)
        .filter(|item| !item.is_empty())
        .map(ToString::to_string)
        .collect()
}

fn normalize_provider_id(value: &str) -> String {
    value.trim().to_lowercase().replace(
        |c: char| !c.is_ascii_alphanumeric() && c != '-' && c != '_',
        "-",
    )
}

fn default_api_key_env(provider_id: &str) -> String {
    format!(
        "{}_API_KEY",
        provider_id
            .to_uppercase()
            .replace(|c: char| !c.is_ascii_alphanumeric(), "_")
    )
}

fn default_base_url_for_adapter(adapter: &str) -> &'static str {
    match adapter {
        "anthropic" => "https://api.anthropic.com",
        "custom-http" => "https://example.com/v1",
        _ => "https://api.openai.com/v1",
    }
}

fn is_supported_adapter(value: &str) -> bool {
    matches!(value, "openai-compatible" | "anthropic" | "custom-http")
}

fn print_agent_list(json_mode: bool) {
    match load_agent_store() {
        Ok(store) => {
            if json_mode {
                match serde_json::to_string_pretty(&AgentStoreWriteData {
                    agents: store
                        .agents
                        .iter()
                        .map(|agent| AgentStoreWriteEntry {
                            id: agent.id.clone(),
                            name: agent.name.clone(),
                            model: agent.model.clone(),
                            tools: agent.tools.clone(),
                            permission_profile: agent.permission_profile.clone(),
                            enabled: agent.enabled,
                            sub_agents: agent.sub_agents.clone(),
                            description: agent.description.clone(),
                        })
                        .collect(),
                    default_agent: store.default_agent.clone(),
                    collaboration_enabled: store.collaboration_enabled,
                    sub_agent_dispatch_enabled: store.sub_agent_dispatch_enabled,
                }) {
                    Ok(content) => println!("{content}"),
                    Err(error) => println!("failed to render agent json: {error}"),
                }
                return;
            }

            println!("已配置 Agent:");
            println!(
                "collaboration: {}",
                if store.collaboration_enabled {
                    "enabled"
                } else {
                    "disabled"
                }
            );
            println!(
                "sub-agent dispatch: {}",
                if store.sub_agent_dispatch_enabled {
                    "enabled"
                } else {
                    "disabled"
                }
            );
            for agent in &store.agents {
                let marker = if store.default_agent.as_deref() == Some(agent.id.as_str()) {
                    "*"
                } else {
                    "-"
                };
                let status = if agent.enabled { "enabled" } else { "disabled" };
                println!("{marker} {} ({})", agent.id, agent.name);
                println!("  status: {status}");
                println!("  model: {}", agent.model);
                println!(
                    "  tools: {}",
                    if agent.tools.is_empty() {
                        "none".to_string()
                    } else {
                        agent.tools.join(", ")
                    }
                );
                println!("  permission: {}", agent.permission_profile);
                println!(
                    "  subAgents: {}",
                    if agent.sub_agents.is_empty() {
                        "none".to_string()
                    } else {
                        agent.sub_agents.join(", ")
                    }
                );
                let referenced_by = find_agent_references(&store.agents, &agent.id);
                println!(
                    "  referencedBy: {}",
                    if referenced_by.is_empty() {
                        "none".to_string()
                    } else {
                        referenced_by.join(", ")
                    }
                );
                if let Some(description) = &agent.description {
                    println!("  description: {description}");
                }
            }
        }
        Err(error) => println!("agent store unavailable: {error}"),
    }
}

fn print_agent_detail(agent_id: &str) {
    match load_agent_store() {
        Ok(store) => {
            let Some(agent) = store.agents.iter().find(|agent| agent.id == agent_id) else {
                println!("Agent 不存在: {agent_id}");
                return;
            };
            let referenced_by = find_agent_references(&store.agents, &agent.id);
            println!("Agent: {}", agent.id);
            println!("name: {}", agent.name);
            println!(
                "status: {}",
                if agent.enabled { "enabled" } else { "disabled" }
            );
            println!(
                "default: {}",
                if store.default_agent.as_deref() == Some(agent.id.as_str()) {
                    "yes"
                } else {
                    "no"
                }
            );
            println!("model: {}", agent.model);
            println!(
                "tools: {}",
                if agent.tools.is_empty() {
                    "none".to_string()
                } else {
                    agent.tools.join(", ")
                }
            );
            println!("permission: {}", agent.permission_profile);
            println!(
                "subAgents: {}",
                if agent.sub_agents.is_empty() {
                    "none".to_string()
                } else {
                    agent.sub_agents.join(", ")
                }
            );
            println!(
                "referencedBy: {}",
                if referenced_by.is_empty() {
                    "none".to_string()
                } else {
                    referenced_by.join(", ")
                }
            );
            if let Some(description) = &agent.description {
                println!("description: {description}");
            }
        }
        Err(error) => println!("agent store unavailable: {error}"),
    }
}

fn find_agent_references(agents: &[AgentStoreEntry], target_id: &str) -> Vec<String> {
    agents
        .iter()
        .filter(|agent| {
            agent
                .sub_agents
                .iter()
                .any(|sub_agent| sub_agent == target_id)
        })
        .map(|agent| agent.id.clone())
        .collect()
}

fn to_title_case(value: &str) -> String {
    value
        .split(['-', '_', ' '])
        .filter(|part| !part.is_empty())
        .map(|part| {
            let mut chars = part.chars();
            match chars.next() {
                Some(first) => format!("{}{}", first.to_uppercase(), chars.as_str()),
                None => String::new(),
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}

fn split_command_args(command: &str) -> Vec<String> {
    command
        .trim()
        .split_whitespace()
        .map(ToString::to_string)
        .collect()
}

fn print_session_help() {
    println!(
        "会话管理:\n  /session list             - 查看历史会话\n  /session info <sessionId> - 查看指定会话详情\n  /session clear            - 清空全部会话历史"
    );
}

fn print_session_list() {
    let sessions = list_session_infos();
    if sessions.is_empty() {
        println!("暂无会话历史。");
        return;
    }

    println!("会话列表\n");
    for session in &sessions {
        println!("- {}", session.id);
        println!("  Channel: {}", session.channel);
        println!("  Chat ID: {}", session.chat_id);
        println!(
            "  Model: {}",
            if session.model.is_empty() {
                "default"
            } else {
                &session.model
            }
        );
        println!("  Messages: {}", session.message_count);
        println!("  Tokens: ~{}", session.token_count);
        println!(
            "  Last Active: {}",
            format_session_date(&session.last_active_at)
        );
        println!();
    }
    println!("总计: {} 个会话", sessions.len());
}

fn print_session_info(session_id: &str) {
    match load_session_info(session_id) {
        Some(session) => {
            println!("Session: {}", session.id);
            println!("Channel: {}", session.channel);
            println!("Chat ID: {}", session.chat_id);
            println!(
                "Model: {}",
                if session.model.is_empty() {
                    "default"
                } else {
                    &session.model
                }
            );
            println!(
                "Last Active: {}",
                format_session_date(&session.last_active_at)
            );
            println!("Messages: {}", session.message_count);
            println!("Token Count: ~{}", session.token_count);
        }
        None => println!("未找到会话: {session_id}"),
    }
}

fn list_session_infos() -> Vec<SessionInfo> {
    let sessions_dir = sacode_config_dir().join("sessions");
    let Ok(entries) = fs::read_dir(sessions_dir) else {
        return Vec::new();
    };

    entries
        .filter_map(Result::ok)
        .filter(|entry| entry.path().is_dir())
        .filter_map(|entry| load_session_info(&entry.file_name().to_string_lossy()))
        .collect()
}

fn load_session_info(session_id: &str) -> Option<SessionInfo> {
    let session_file = sacode_config_dir()
        .join("sessions")
        .join(session_id)
        .join("session.json");
    let raw = fs::read_to_string(session_file).ok()?;
    serde_json::from_str(&raw).ok()
}

fn format_session_date(date_str: &str) -> String {
    date_str.to_string()
}

fn clear_session_history() -> Result<String, String> {
    let sessions_dir = sacode_config_dir().join("sessions");
    let cleared = fs::read_dir(&sessions_dir)
        .map(|entries| {
            entries
                .filter_map(Result::ok)
                .filter(|entry| entry.path().is_dir())
                .count()
        })
        .unwrap_or(0);

    if sessions_dir.exists() {
        fs::remove_dir_all(&sessions_dir)
            .map_err(|error| format!("failed to clear {}: {error}", sessions_dir.display()))?;
    }

    fs::create_dir_all(&sessions_dir)
        .map_err(|error| format!("failed to recreate {}: {error}", sessions_dir.display()))?;

    Ok(format!("已清空会话历史: {cleared} 个会话"))
}

fn print_memory_help() {
    println!(
        "记忆管理:\n  /memory list                 - 列出记忆\n  /memory show <sessionId>     - 查看记忆内容\n  /memory search <query>       - 搜索记忆\n  /memory append <sessionId> <content> - 追加记忆\n  /memory compact <sessionId>  - 压缩记忆\n  /memory delete <sessionId>   - 标记记忆为删除"
    );
}

fn print_memory_list() {
    let memory_dir = sacode_config_dir().join("memory");
    match load_memory_index(&memory_dir) {
        Ok(index) => {
            if index.entries.is_empty() {
                println!("暂无记忆。");
                return;
            }
            println!("记忆列表:");
            for entry in index.entries {
                println!("- {} [{}]", entry.file, entry.summary);
            }
        }
        Err(error) => println!("memory unavailable: {error}"),
    }
}

fn print_memory_show(session_id: &str) {
    match read_memory_entry(session_id) {
        Ok((entry, content)) => {
            println!("Memory: {}", entry.file);
            println!("Summary: {}", entry.summary);
            println!("Type: {}", entry.r#type);
            println!();
            println!("{}", content.trim());
        }
        Err(error) => println!("{error}"),
    }
}

fn append_memory(session_id: &str, content: &str) -> Result<String, String> {
    let memory_dir = sacode_config_dir().join("memory");
    fs::create_dir_all(&memory_dir)
        .map_err(|error| format!("failed to create {}: {error}", memory_dir.display()))?;

    let mut index = load_memory_index(&memory_dir)?;
    let file_name = memory_file_name(session_id);
    let file_path = memory_dir.join(&file_name);
    let previous = fs::read_to_string(&file_path).unwrap_or_default();
    let next_content = if previous.trim().is_empty() {
        format!("{content}\n")
    } else {
        format!("{}\n{}\n", previous.trim_end(), content)
    };
    fs::write(&file_path, next_content)
        .map_err(|error| format!("failed to write {}: {error}", file_path.display()))?;

    upsert_memory_index_entry(&mut index, &file_name, content, "session");
    index.last_updated = iso_timestamp_now();
    save_memory_index(&memory_dir, &index)?;
    Ok(format!("记忆已追加: {session_id}"))
}

fn compact_memory(session_id: &str) -> Result<String, String> {
    let (entry, content) = read_memory_entry(session_id)?;
    let compacted = compact_text(&content);
    let memory_dir = sacode_config_dir().join("memory");
    let file_path = memory_dir.join(&entry.file);
    fs::write(&file_path, format!("{compacted}\n"))
        .map_err(|error| format!("failed to write {}: {error}", file_path.display()))?;

    let mut index = load_memory_index(&memory_dir)?;
    upsert_memory_index_entry(&mut index, &entry.file, &compacted, "compacted");
    index.last_updated = iso_timestamp_now();
    save_memory_index(&memory_dir, &index)?;
    Ok(format!(
        "记忆已压缩: {session_id} ({} -> {} chars)",
        content.len(),
        compacted.len()
    ))
}

fn mark_memory_deleted(session_id: &str) -> Result<String, String> {
    let memory_dir = sacode_config_dir().join("memory");
    let mut index = load_memory_index(&memory_dir)?;
    let file_name = memory_file_name(session_id);
    let Some(entry) = index
        .entries
        .iter_mut()
        .find(|entry| entry.file == file_name || entry.summary == session_id)
    else {
        return Err(format!("未找到记忆: {session_id}"));
    };
    entry.r#type = "deleted".to_string();
    entry.summary = format!("deleted:{session_id}");
    index.last_updated = iso_timestamp_now();
    save_memory_index(&memory_dir, &index)?;
    Ok(format!("记忆已标记删除: {session_id}"))
}

fn remember_memory(content: &str) -> Result<String, String> {
    let memory_dir = sacode_config_dir().join("memory");
    fs::create_dir_all(&memory_dir)
        .map_err(|error| format!("failed to create {}: {error}", memory_dir.display()))?;

    let mut index = load_memory_index(&memory_dir)?;
    let summary = build_memory_summary(content);
    let file_name = format!("session-{}.md", iso_id_suffix());
    let file_path = memory_dir.join(&file_name);
    fs::write(&file_path, format!("{content}\n"))
        .map_err(|error| format!("failed to write {}: {error}", file_path.display()))?;

    upsert_memory_index_entry(&mut index, &file_name, &summary, "session");
    index.last_updated = iso_timestamp_now();
    save_memory_index(&memory_dir, &index)?;
    Ok(format!("已保存到记忆: {summary}"))
}

fn recall_memory(query: &str) -> Result<String, String> {
    let memory_dir = sacode_config_dir().join("memory");
    let index = load_memory_index(&memory_dir)?;
    let query_lower = query.to_lowercase();
    let mut matches = Vec::new();

    for entry in index.entries {
        let file_path = memory_dir.join(&entry.file);
        let content = fs::read_to_string(&file_path).unwrap_or_default();
        let haystack = format!("{}\n{}", entry.summary, content).to_lowercase();
        if haystack.contains(&query_lower) {
            matches.push((entry, content));
        }
    }

    if matches.is_empty() {
        return Ok(format!("未找到与 \"{query}\" 相关的记忆"));
    }

    let rendered = matches
        .into_iter()
        .take(5)
        .map(|(entry, content)| format!("{}\n{}", entry.summary, content.trim()))
        .collect::<Vec<_>>()
        .join("\n\n---\n\n");
    Ok(format!("找到相关记忆:\n\n{rendered}"))
}

fn load_memory_index(memory_dir: &Path) -> Result<MemoryIndexData, String> {
    let path = memory_dir.join("MEMORY.json");
    if !path.exists() {
        return Ok(MemoryIndexData {
            version: "1.0.0".to_string(),
            last_updated: iso_timestamp_now(),
            entries: Vec::new(),
        });
    }

    let raw = fs::read_to_string(&path)
        .map_err(|error| format!("failed to read {}: {error}", path.display()))?;
    serde_json::from_str(&raw)
        .map_err(|error| format!("failed to parse {}: {error}", path.display()))
}

fn save_memory_index(memory_dir: &Path, index: &MemoryIndexData) -> Result<(), String> {
    let path = memory_dir.join("MEMORY.json");
    let content = serde_json::to_string_pretty(index)
        .map_err(|error| format!("failed to serialize memory index: {error}"))?;
    fs::write(&path, format!("{content}\n"))
        .map_err(|error| format!("failed to write {}: {error}", path.display()))
}

fn build_memory_summary(content: &str) -> String {
    content.chars().take(50).collect()
}

fn memory_file_name(session_id: &str) -> String {
    if session_id.ends_with(".md") {
        session_id.to_string()
    } else if session_id.starts_with("session-") {
        format!("{session_id}.md")
    } else {
        format!("session-{session_id}.md")
    }
}

fn read_memory_entry(session_id: &str) -> Result<(MemoryIndexEntry, String), String> {
    let memory_dir = sacode_config_dir().join("memory");
    let index = load_memory_index(&memory_dir)?;
    let file_name = memory_file_name(session_id);
    let Some(entry) = index.entries.into_iter().find(|entry| {
        entry.file == file_name || entry.file == session_id || entry.summary == session_id
    }) else {
        return Err(format!("未找到记忆: {session_id}"));
    };

    let file_path = memory_dir.join(&entry.file);
    let content = fs::read_to_string(&file_path)
        .map_err(|error| format!("failed to read {}: {error}", file_path.display()))?;
    Ok((entry, content))
}

fn upsert_memory_index_entry(
    index: &mut MemoryIndexData,
    file_name: &str,
    content: &str,
    entry_type: &str,
) {
    let summary = build_memory_summary(content);
    if let Some(entry) = index
        .entries
        .iter_mut()
        .find(|entry| entry.file == file_name)
    {
        entry.summary = summary;
        entry.r#type = entry_type.to_string();
    } else {
        index.entries.push(MemoryIndexEntry {
            file: file_name.to_string(),
            summary,
            r#type: entry_type.to_string(),
        });
    }
}

fn compact_text(content: &str) -> String {
    let mut seen = Vec::<String>::new();
    for line in content
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
    {
        if !seen.iter().any(|item| item == line) {
            seen.push(line.to_string());
        }
    }
    seen.join("\n")
}

fn default_cli_config() -> CliConfigData {
    CliConfigData {
        language: Some("zh-CN".to_string()),
        agent_mode: "auto".to_string(),
        max_agent_iterations: 25,
        auto_approve_tools: vec![
            "file_read".to_string(),
            "file_search".to_string(),
            "code_search".to_string(),
        ],
        work_mode: "smart".to_string(),
        ui_style: "gemini".to_string(),
        codingplan_default_account: None,
    }
}

fn sacode_config_dir() -> PathBuf {
    env::var_os("HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("."))
        .join(".sacode")
}

fn parse_cli_args(args: Vec<String>) -> Result<AppCommand, String> {
    if args.is_empty() {
        return Ok(AppCommand::Shell);
    }

    match args[0].as_str() {
        "serve" => parse_serve_args(&args[1..]),
        "start" => parse_start_args(&args[1..]),
        "chat" => Ok(AppCommand::Chat),
        "code" => Ok(AppCommand::Code),
        "cron" => Ok(AppCommand::Cron),
        "plugin" => Ok(AppCommand::Plugin),
        "help" | "--help" | "-h" => Ok(AppCommand::Help),
        "version" | "--version" | "-V" => Ok(AppCommand::Version),
        other => Err(format!("unknown command: {other}")),
    }
}

fn parse_start_args(args: &[String]) -> Result<AppCommand, String> {
    let mut host = None;
    let mut port = None;
    let mut api_only = false;
    let mut web_only = false;
    let mut index = 0usize;

    while index < args.len() {
        match args[index].as_str() {
            "--host" | "-H" => {
                let value = args
                    .get(index + 1)
                    .ok_or_else(|| "missing value for --host".to_string())?;
                host = Some(value.clone());
                index += 2;
            }
            "--port" | "-p" => {
                let value = args
                    .get(index + 1)
                    .ok_or_else(|| "missing value for --port".to_string())?;
                port = Some(
                    value
                        .parse::<u16>()
                        .map_err(|error| format!("invalid port: {error}"))?,
                );
                index += 2;
            }
            "--api" => {
                api_only = true;
                index += 1;
            }
            "--web" => {
                web_only = true;
                index += 1;
            }
            other => return Err(format!("未知 start 参数: {other}")),
        }
    }

    Ok(AppCommand::Start {
        host,
        port,
        api_only,
        web_only,
    })
}

fn parse_serve_args(args: &[String]) -> Result<AppCommand, String> {
    let mut host = None;
    let mut port = None;
    let mut index = 0usize;

    while index < args.len() {
        match args[index].as_str() {
            "--host" | "-H" => {
                let value = args
                    .get(index + 1)
                    .ok_or_else(|| "missing value for --host".to_string())?;
                host = Some(value.clone());
                index += 2;
            }
            "--port" | "-p" => {
                let value = args
                    .get(index + 1)
                    .ok_or_else(|| "missing value for --port".to_string())?;
                port = Some(
                    value
                        .parse::<u16>()
                        .map_err(|error| format!("invalid port: {error}"))?,
                );
                index += 2;
            }
            other => return Err(format!("未知 serve 参数: {other}")),
        }
    }

    Ok(AppCommand::Serve { host, port })
}

fn print_help() {
    println!(
        "sacode\n\n统一 Rust 入口。\n\n用法:\n  sacode              进入交互式 shell\n  sacode chat         进入 Chat 模式\n  sacode code         进入 Code 模式\n  sacode cron         进入 Cron 模式\n  sacode plugin       进入 Plugin 模式\n  sacode serve        启动 HTTP API 服务\n  sacode start        启动控制面服务兼容入口\n  sacode help         显示帮助\n  sacode version      显示版本\n\nserve 选项:\n  -H, --host <host>   服务监听地址\n  -p, --port <port>   服务监听端口\n\nstart 选项:\n  -H, --host <host>   服务监听地址\n  -p, --port <port>   API 服务端口\n  --api               仅启动 API 服务\n  --web               仅输出 Web 提示"
    );
}

async fn run_chat_mode() -> Result<(), String> {
    println!("sacode chat");
    println!("输入自然语言任务即可，当前版本复用 Rust shell。输入 /exit 退出。\n");
    run_shell().await
}

async fn run_code_mode() -> Result<(), String> {
    println!("sacode code");
    println!("输入代码任务即可，当前版本复用 Rust shell。输入 /exit 退出。\n");
    run_shell().await
}

async fn run_cron_mode() -> Result<(), String> {
    println!("sacode cron");
    println!("当前版本提供定时任务入口外壳。输入 /help 查看命令，输入 /exit 退出。\n");
    run_shell().await
}

async fn run_plugin_mode() -> Result<(), String> {
    println!("sacode plugin");
    println!("当前版本提供插件入口外壳。输入 /help 查看命令，输入 /exit 退出。\n");
    run_shell().await
}

async fn run_start_command(
    host: Option<String>,
    port: Option<u16>,
    api_only: bool,
    web_only: bool,
) -> Result<(), String> {
    let host_value = host.clone().unwrap_or_else(|| "127.0.0.1".to_string());
    let port_value = port.unwrap_or(3001);

    println!("[sacode] start");
    println!("host: {host_value}");
    println!("port: {port_value}");

    if web_only {
        println!(
            "Rust 入口当前只提供 Web 启动提示。建议单独启动前端开发服务器。\nWeb 预期地址: http://{host_value}:5173"
        );
        return Ok(());
    }

    if !api_only {
        println!("Web 预期地址: http://{host_value}:5173");
    }

    run_server(host, port).await
}

fn print_version() {
    println!("sacode {}", env!("CARGO_PKG_VERSION"));
}

async fn root() -> Json<serde_json::Value> {
    Json(serde_json::json!({
        "service": "sacode-rust-api-mvp",
        "message": "SaCode Rust API MVP is running"
    }))
}

async fn health() -> Json<HealthResponse> {
    Json(HealthResponse {
        status: "ok",
        timestamp: iso_timestamp_now(),
    })
}

async fn api_info(State(state): State<AppState>) -> Json<ApiInfoResponse> {
    Json(ApiInfoResponse {
        name: state.app_name.to_string(),
        version: state.app_version.to_string(),
        runtime: "rust-axum",
        endpoints: vec![
            "/",
            "/api",
            "/api/health",
            "/api/stats",
            "/api/models",
            "/api/settings/providers",
            "/api/notifications",
        ],
        default_model: state.default_model.to_string(),
        database: DatabaseStatus {
            connected: state.db_pool.is_some(),
            path: state.db_path.as_ref().map(|value| value.to_string()),
        },
    })
}

async fn stats(State(state): State<AppState>) -> impl IntoResponse {
    match build_stats(&state).await {
        Ok(response) => (StatusCode::OK, Json(response)).into_response(),
        Err(error) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse {
                message: format!("failed to build stats: {error}"),
            }),
        )
            .into_response(),
    }
}

async fn models() -> Json<Vec<ModelResponse>> {
    Json(default_models())
}

async fn default_model() -> Json<ModelResponse> {
    let models = default_models();
    Json(
        models
            .into_iter()
            .find(|item| item.is_default)
            .unwrap_or_else(|| ModelResponse {
                id: "gpt-4o-mini".to_string(),
                name: "GPT-4o Mini".to_string(),
                provider: "openai".to_string(),
                model_id: "gpt-4o-mini".to_string(),
                capabilities: vec!["streaming", "vision", "functionCalling", "longContext"],
                is_default: true,
                enabled: true,
            }),
    )
}

async fn session_model(
    State(state): State<AppState>,
    axum::extract::Path(session_id): axum::extract::Path<String>,
) -> impl IntoResponse {
    let current = state.session_model_map.read().await;
    let model_id = current
        .get(&session_id)
        .cloned()
        .unwrap_or_else(|| "gpt-4o-mini".to_string());
    let model = default_models()
        .into_iter()
        .find(|item| item.id == model_id)
        .unwrap_or_else(|| {
            default_models()
                .into_iter()
                .next()
                .expect("default model list is empty")
        });

    (StatusCode::OK, Json(model)).into_response()
}

async fn switch_model(
    State(state): State<AppState>,
    Json(payload): Json<ModelSwitchRequest>,
) -> impl IntoResponse {
    let models = default_models();
    let Some(model) = models
        .into_iter()
        .find(|item| item.id == payload.model_id && item.enabled)
    else {
        return (
            StatusCode::NOT_FOUND,
            Json(ErrorResponse {
                message: "Model not found or disabled".to_string(),
            }),
        )
            .into_response();
    };

    if let Some(session_id) = payload.session_id {
        state
            .session_model_map
            .write()
            .await
            .insert(session_id, model.id.clone());
    }

    let _reason = payload.reason;

    (
        StatusCode::OK,
        Json(ModelSwitchResponse {
            success: true,
            model,
        }),
    )
        .into_response()
}

async fn settings_providers() -> Json<SettingsProvidersResponse> {
    Json(SettingsProvidersResponse {
        providers: AI_PROVIDERS.to_vec(),
    })
}

async fn settings_keys(State(state): State<AppState>) -> Json<SettingsKeysResponse> {
    let keys = if let Some(pool) = &state.db_pool {
        load_api_keys(pool).await.unwrap_or_default()
    } else {
        Vec::new()
    };

    Json(SettingsKeysResponse { keys })
}

async fn save_settings_key(
    State(state): State<AppState>,
    Json(payload): Json<SaveApiKeyRequest>,
) -> impl IntoResponse {
    let Some(pool) = &state.db_pool else {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(ErrorResponse {
                message: "database unavailable".to_string(),
            }),
        )
            .into_response();
    };

    let now = iso_timestamp_now();
    let id = format!("api-key-{}", iso_id_suffix());
    let base_url = payload.base_url.or_else(|| {
        AI_PROVIDERS
            .iter()
            .find(|provider| provider.id == payload.provider)
            .map(|provider| provider.default_base_url.to_string())
    });

    let _ = payload.api_key;

    let existing = sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM api_keys WHERE provider = ?")
        .bind(&payload.provider)
        .fetch_one(pool)
        .await;

    match existing {
        Ok(count) if count > 0 => {
            let _ = sqlx::query(
                "UPDATE api_keys SET name = ?, base_url = ?, enabled = ?, updated_at = ? WHERE provider = ?",
            )
            .bind(&payload.name)
            .bind(base_url.clone())
            .bind(bool_to_sqlite_int(payload.enabled))
            .bind(&now)
            .bind(&payload.provider)
            .execute(pool)
            .await;
        }
        _ => {
            let _ = sqlx::query(
                "INSERT INTO api_keys (id, provider, name, api_key, base_url, enabled, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            )
            .bind(&id)
            .bind(&payload.provider)
            .bind(&payload.name)
            .bind("managed-by-rust-mvp")
            .bind(base_url.clone())
            .bind(bool_to_sqlite_int(payload.enabled))
            .bind(&now)
            .bind(&now)
            .execute(pool)
            .await;
        }
    }

    let key = load_api_keys(pool)
        .await
        .unwrap_or_default()
        .into_iter()
        .find(|item| item.provider == payload.provider)
        .unwrap_or(ApiKeyConfigResponse {
            id,
            provider: payload.provider,
            name: payload.name,
            masked_key: "已配置".to_string(),
            base_url,
            enabled: payload.enabled,
            last_used_at: None,
            created_at: now.clone(),
            updated_at: now,
        });

    (
        StatusCode::OK,
        Json(SaveApiKeyResponse { success: true, key }),
    )
        .into_response()
}

async fn update_settings_key(
    State(state): State<AppState>,
    axum::extract::Path(provider): axum::extract::Path<String>,
    Json(payload): Json<PatchApiKeyRequest>,
) -> impl IntoResponse {
    let Some(pool) = &state.db_pool else {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(ErrorResponse {
                message: "database unavailable".to_string(),
            }),
        )
            .into_response();
    };

    let now = iso_timestamp_now();
    let current = load_api_keys(pool).await.unwrap_or_default();
    let Some(existing) = current.iter().find(|item| item.provider == provider) else {
        return (
            StatusCode::NOT_FOUND,
            Json(ErrorResponse {
                message: "key config not found".to_string(),
            }),
        )
            .into_response();
    };

    let name = payload.name.unwrap_or_else(|| existing.name.clone());
    let base_url = payload.base_url.or_else(|| existing.base_url.clone());
    let enabled = payload.enabled.unwrap_or(existing.enabled);
    let _ = payload.api_key;

    let _ = sqlx::query(
        "UPDATE api_keys SET name = ?, base_url = ?, enabled = ?, updated_at = ? WHERE provider = ?",
    )
    .bind(&name)
    .bind(base_url.clone())
    .bind(bool_to_sqlite_int(enabled))
    .bind(&now)
    .bind(&provider)
    .execute(pool)
    .await;

    let key = load_api_keys(pool)
        .await
        .unwrap_or_default()
        .into_iter()
        .find(|item| item.provider == provider)
        .unwrap_or(ApiKeyConfigResponse {
            id: existing.id.clone(),
            provider,
            name,
            masked_key: existing.masked_key.clone(),
            base_url,
            enabled,
            last_used_at: existing.last_used_at.clone(),
            created_at: existing.created_at.clone(),
            updated_at: now,
        });

    (
        StatusCode::OK,
        Json(SaveApiKeyResponse { success: true, key }),
    )
        .into_response()
}

async fn delete_settings_key(
    State(state): State<AppState>,
    axum::extract::Path(provider): axum::extract::Path<String>,
) -> impl IntoResponse {
    let Some(pool) = &state.db_pool else {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(ErrorResponse {
                message: "database unavailable".to_string(),
            }),
        )
            .into_response();
    };

    let _ = sqlx::query("DELETE FROM api_keys WHERE provider = ?")
        .bind(&provider)
        .execute(pool)
        .await;

    (
        StatusCode::OK,
        Json(SuccessMessageResponse {
            success: true,
            message: "api key deleted".to_string(),
        }),
    )
        .into_response()
}

async fn settings_oauth_providers() -> Json<OAuthProvidersResponse> {
    Json(OAuthProvidersResponse {
        providers: OAUTH_PROVIDERS.to_vec(),
    })
}

async fn settings_oauth(State(state): State<AppState>) -> Json<OAuthConfigsResponse> {
    let configs = if let Some(pool) = &state.db_pool {
        load_oauth_configs(pool).await.unwrap_or_default()
    } else {
        Vec::new()
    };

    Json(OAuthConfigsResponse { configs })
}

async fn save_oauth_config(
    State(state): State<AppState>,
    Json(payload): Json<SaveOAuthConfigRequest>,
) -> impl IntoResponse {
    let Some(pool) = &state.db_pool else {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(ErrorResponse {
                message: "database unavailable".to_string(),
            }),
        )
            .into_response();
    };

    let now = iso_timestamp_now();
    let id = format!("oauth-{}", iso_id_suffix());

    let existing =
        sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM oauth_configs WHERE provider = ?")
            .bind(&payload.provider)
            .fetch_one(pool)
            .await;

    match existing {
        Ok(count) if count > 0 => {
            let _ = sqlx::query(
                "UPDATE oauth_configs SET name = ?, callback_url = ?, corp_id = ?, agent_id = ?, enabled = ?, updated_at = ? WHERE provider = ?",
            )
            .bind(&payload.name)
            .bind(payload.callback_url.clone())
            .bind(payload.corp_id.clone())
            .bind(payload.agent_id.clone())
            .bind(bool_to_sqlite_int(payload.enabled))
            .bind(&now)
            .bind(&payload.provider)
            .execute(pool)
            .await;
        }
        _ => {
            let _ = sqlx::query(
                "INSERT INTO oauth_configs (id, provider, name, client_id, client_secret, callback_url, corp_id, agent_id, enabled, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            )
            .bind(&id)
            .bind(&payload.provider)
            .bind(&payload.name)
            .bind(&payload.client_id)
            .bind(&payload.client_secret)
            .bind(payload.callback_url.clone())
            .bind(payload.corp_id.clone())
            .bind(payload.agent_id.clone())
            .bind(bool_to_sqlite_int(payload.enabled))
            .bind(&now)
            .bind(&now)
            .execute(pool)
            .await;
        }
    }

    let config = load_oauth_configs(pool)
        .await
        .unwrap_or_default()
        .into_iter()
        .find(|item| item.provider == payload.provider)
        .unwrap_or(OAuthConfigResponse {
            id,
            provider: payload.provider,
            name: payload.name,
            masked_client_id: "已配置".to_string(),
            masked_client_secret: "***".to_string(),
            callback_url: payload.callback_url,
            corp_id: payload.corp_id,
            agent_id: payload.agent_id,
            enabled: payload.enabled,
            created_at: now.clone(),
            updated_at: now,
        });

    (
        StatusCode::OK,
        Json(SaveOAuthConfigResponse {
            success: true,
            config,
        }),
    )
        .into_response()
}

async fn delete_oauth_config(
    State(state): State<AppState>,
    axum::extract::Path(provider): axum::extract::Path<String>,
) -> impl IntoResponse {
    let Some(pool) = &state.db_pool else {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(ErrorResponse {
                message: "database unavailable".to_string(),
            }),
        )
            .into_response();
    };

    let _ = sqlx::query("DELETE FROM oauth_configs WHERE provider = ?")
        .bind(&provider)
        .execute(pool)
        .await;

    (
        StatusCode::OK,
        Json(SuccessMessageResponse {
            success: true,
            message: "oauth config deleted".to_string(),
        }),
    )
        .into_response()
}

async fn toggle_oauth_config(
    State(state): State<AppState>,
    axum::extract::Path(provider): axum::extract::Path<String>,
) -> impl IntoResponse {
    let Some(pool) = &state.db_pool else {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(ErrorResponse {
                message: "database unavailable".to_string(),
            }),
        )
            .into_response();
    };

    let current = load_oauth_configs(pool).await.unwrap_or_default();
    let Some(existing) = current.into_iter().find(|item| item.provider == provider) else {
        return (
            StatusCode::NOT_FOUND,
            Json(ErrorResponse {
                message: "oauth config not found".to_string(),
            }),
        )
            .into_response();
    };

    let enabled = !existing.enabled;
    let _ = sqlx::query("UPDATE oauth_configs SET enabled = ?, updated_at = ? WHERE provider = ?")
        .bind(bool_to_sqlite_int(enabled))
        .bind(iso_timestamp_now())
        .bind(&provider)
        .execute(pool)
        .await;

    (
        StatusCode::OK,
        Json(ToggleOAuthResponse {
            success: true,
            enabled,
        }),
    )
        .into_response()
}

async fn notifications(State(state): State<AppState>) -> Json<NotificationsResponse> {
    let notifications = state.notifications.read().await.clone();
    let unread_count = notifications.iter().filter(|item| !item.read).count();

    Json(NotificationsResponse {
        total: notifications.len(),
        notifications,
        unread_count,
    })
}

async fn notifications_unread_count(State(state): State<AppState>) -> Json<UnreadCountResponse> {
    let notifications = state.notifications.read().await;
    Json(UnreadCountResponse {
        unread_count: notifications.iter().filter(|item| !item.read).count(),
    })
}

async fn notification_mark_read(
    State(state): State<AppState>,
    axum::extract::Path(id): axum::extract::Path<String>,
) -> impl IntoResponse {
    let mut notifications = state.notifications.write().await;
    let Some(notification) = notifications.iter_mut().find(|item| item.id == id) else {
        return (
            StatusCode::NOT_FOUND,
            Json(ErrorResponse {
                message: "notification not found".to_string(),
            }),
        )
            .into_response();
    };

    notification.read = true;

    (
        StatusCode::OK,
        Json(MarkReadResponse {
            success: true,
            notification: notification.clone(),
        }),
    )
        .into_response()
}

async fn notifications_read_all(
    State(state): State<AppState>,
    Json(payload): Json<NotificationReadAllRequest>,
) -> Json<MarkAllReadResponse> {
    let mut notifications = state.notifications.write().await;
    let mut marked_read = 0usize;

    for notification in notifications.iter_mut() {
        if payload
            .r#type
            .as_ref()
            .is_none_or(|kind| kind == notification.r#type)
        {
            if !notification.read {
                notification.read = true;
                marked_read += 1;
            }
        }
    }

    Json(MarkAllReadResponse {
        success: true,
        marked_read,
    })
}

async fn notification_delete(
    State(state): State<AppState>,
    axum::extract::Path(id): axum::extract::Path<String>,
) -> impl IntoResponse {
    let mut notifications = state.notifications.write().await;
    let original_len = notifications.len();
    notifications.retain(|item| item.id != id);

    if notifications.len() == original_len {
        return (
            StatusCode::NOT_FOUND,
            Json(ErrorResponse {
                message: "notification not found".to_string(),
            }),
        )
            .into_response();
    }

    StatusCode::NO_CONTENT.into_response()
}

async fn notifications_clear(
    State(state): State<AppState>,
    axum::extract::Query(query): axum::extract::Query<HashMap<String, String>>,
) -> Json<SuccessMessageResponse> {
    let mut notifications = state.notifications.write().await;
    let kind = query.get("type").cloned();
    let read_only = query.get("readOnly").is_some_and(|value| value == "true");

    if let Some(kind) = kind {
        notifications.retain(|item| item.r#type != kind);
    } else if read_only {
        notifications.retain(|item| !item.read);
    } else {
        notifications.clear();
    }

    Json(SuccessMessageResponse {
        success: true,
        message: "notifications cleared".to_string(),
    })
}

async fn build_stats(state: &AppState) -> Result<StatsResponse, sqlx::Error> {
    let Some(pool) = &state.db_pool else {
        return Ok(empty_stats_response(state));
    };

    let total_sessions = scalar_count(pool, "SELECT COUNT(*) FROM chat_sessions").await?;
    let total_messages = scalar_count(pool, "SELECT COUNT(*) FROM chat_messages").await?;
    let active_connections = scalar_count(
        pool,
        "SELECT COUNT(*) FROM im_connections WHERE status = 'connected'",
    )
    .await?;
    let plugins_count =
        scalar_count(pool, "SELECT COUNT(*) FROM plugins WHERE enabled = 1").await?;

    let sessions_last_week = scalar_count(
        pool,
        "SELECT COUNT(*) FROM chat_sessions WHERE created_at >= datetime('now', '-7 day')",
    )
    .await?;
    let sessions_previous_week = scalar_count(
        pool,
        "SELECT COUNT(*) FROM chat_sessions WHERE created_at < datetime('now', '-7 day') AND created_at >= datetime('now', '-14 day')",
    )
    .await?;
    let messages_last_week = scalar_count(
        pool,
        "SELECT COUNT(*) FROM chat_messages WHERE created_at >= datetime('now', '-7 day')",
    )
    .await?;
    let messages_previous_week = scalar_count(
        pool,
        "SELECT COUNT(*) FROM chat_messages WHERE created_at < datetime('now', '-7 day') AND created_at >= datetime('now', '-14 day')",
    )
    .await?;

    let recent_sessions_rows = sqlx::query_as::<_, RecentSessionRow>(
        r#"
        SELECT
          cs.id AS id,
          COALESCE(cs.title, '新对话') AS title,
          cs.platform AS platform,
          COALESCE(COUNT(cm.id), 0) AS message_count,
          cs.updated_at AS updated_at
        FROM chat_sessions cs
        LEFT JOIN chat_messages cm ON cm.session_id = cs.id
        GROUP BY cs.id, cs.title, cs.platform, cs.updated_at
        ORDER BY cs.updated_at DESC
        LIMIT 5
        "#,
    )
    .fetch_all(pool)
    .await?;

    let connection_rows = sqlx::query_as::<_, ConnectionActivityRow>(
        r#"
        SELECT id, platform, name, status, updated_at
        FROM im_connections
        ORDER BY updated_at DESC
        LIMIT 3
        "#,
    )
    .fetch_all(pool)
    .await?;

    let task_rows = sqlx::query_as::<_, TaskActivityRow>(
        r#"
        SELECT id, name, enabled, last_run_at, updated_at
        FROM cron_tasks
        ORDER BY updated_at DESC
        LIMIT 3
        "#,
    )
    .fetch_all(pool)
    .await?;

    let session_activity_rows = sqlx::query_as::<_, SessionActivityRow>(
        r#"
        SELECT id, COALESCE(title, '新对话') AS title, platform, updated_at
        FROM chat_sessions
        ORDER BY updated_at DESC
        LIMIT 3
        "#,
    )
    .fetch_all(pool)
    .await?;

    let mut activities = Vec::new();

    for row in session_activity_rows {
        activities.push(ActivitySortable {
            timestamp_key: row.updated_at.clone(),
            item: Activity {
                id: format!("session-{}", row.id),
                r#type: "session",
                title: row.title,
                description: row
                    .platform
                    .map(|platform| format!("在 {platform} 平台"))
                    .unwrap_or_else(|| "Web 端对话".to_string()),
                timestamp: row.updated_at,
                icon: "chat",
            },
        });
    }

    for row in connection_rows {
        activities.push(ActivitySortable {
            timestamp_key: row.updated_at.clone(),
            item: Activity {
                id: format!("connection-{}", row.id),
                r#type: "connection",
                title: row.name.unwrap_or(row.platform),
                description: if row.status == "connected" {
                    "已连接".to_string()
                } else {
                    "已断开".to_string()
                },
                timestamp: row.updated_at,
                icon: "link",
            },
        });
    }

    for row in task_rows {
        let timestamp = row.last_run_at.unwrap_or(row.updated_at.clone());
        activities.push(ActivitySortable {
            timestamp_key: timestamp.clone(),
            item: Activity {
                id: format!("task-{}", row.id),
                r#type: "task",
                title: row.name,
                description: if row.enabled == 1 {
                    "定时任务运行中".to_string()
                } else {
                    "定时任务已暂停".to_string()
                },
                timestamp,
                icon: "time",
            },
        });
    }

    activities.sort_by(|a, b| b.timestamp_key.cmp(&a.timestamp_key));

    Ok(StatsResponse {
        total_sessions,
        total_messages,
        active_connections,
        plugins_count,
        trends: Trends {
            sessions: build_trend(sessions_last_week, sessions_previous_week),
            messages: build_trend(messages_last_week, messages_previous_week),
        },
        recent_sessions: recent_sessions_rows
            .into_iter()
            .map(|row| RecentSession {
                id: row.id,
                title: row.title,
                platform: row.platform,
                message_count: row.message_count,
                updated_at: row.updated_at,
            })
            .collect(),
        activities: activities
            .into_iter()
            .take(10)
            .map(|entry| entry.item)
            .collect(),
        ai_status: AiStatus {
            status: "online",
            model: state.default_model.to_string(),
            latency: 50,
        },
        data_source: "sqlite",
    })
}

fn empty_stats_response(state: &AppState) -> StatsResponse {
    StatsResponse {
        total_sessions: 0,
        total_messages: 0,
        active_connections: 0,
        plugins_count: 0,
        trends: Trends {
            sessions: build_trend(0, 0),
            messages: build_trend(0, 0),
        },
        recent_sessions: Vec::new(),
        activities: Vec::new(),
        ai_status: AiStatus {
            status: "online",
            model: state.default_model.to_string(),
            latency: 0,
        },
        data_source: "empty",
    }
}

fn build_trend(last_week: i64, previous_week: i64) -> TrendData {
    let value = if previous_week > 0 {
        (((last_week - previous_week) as f64 / previous_week as f64) * 100.0).round() as i32
    } else if last_week > 0 {
        100
    } else {
        0
    };

    TrendData {
        value,
        direction: if value >= 0 { "up" } else { "down" },
        last_week,
        previous_week,
    }
}

async fn scalar_count(pool: &Pool<Sqlite>, sql: &str) -> Result<i64, sqlx::Error> {
    sqlx::query_scalar::<_, i64>(sql).fetch_one(pool).await
}

async fn load_api_keys(pool: &Pool<Sqlite>) -> Result<Vec<ApiKeyConfigResponse>, sqlx::Error> {
    let rows = sqlx::query_as::<_, ApiKeyRow>(
        r#"
        SELECT id, provider, name, base_url, enabled, last_used_at, created_at, updated_at
        FROM api_keys
        ORDER BY created_at ASC
        "#,
    )
    .fetch_all(pool)
    .await?;

    Ok(rows
        .into_iter()
        .map(|row| ApiKeyConfigResponse {
            id: row.id,
            provider: row.provider,
            name: row.name,
            masked_key: "已配置".to_string(),
            base_url: row.base_url,
            enabled: row.enabled == 1,
            last_used_at: row.last_used_at,
            created_at: row.created_at,
            updated_at: row.updated_at,
        })
        .collect())
}

async fn load_oauth_configs(pool: &Pool<Sqlite>) -> Result<Vec<OAuthConfigResponse>, sqlx::Error> {
    let rows = sqlx::query_as::<_, OAuthConfigRow>(
        r#"
        SELECT id, provider, name, callback_url, corp_id, agent_id, enabled, created_at, updated_at
        FROM oauth_configs
        ORDER BY created_at ASC
        "#,
    )
    .fetch_all(pool)
    .await?;

    Ok(rows
        .into_iter()
        .map(|row| OAuthConfigResponse {
            id: row.id,
            provider: row.provider,
            name: row.name,
            masked_client_id: "已配置".to_string(),
            masked_client_secret: "***".to_string(),
            callback_url: row.callback_url,
            corp_id: row.corp_id,
            agent_id: row.agent_id,
            enabled: row.enabled == 1,
            created_at: row.created_at,
            updated_at: row.updated_at,
        })
        .collect())
}

fn default_models() -> Vec<ModelResponse> {
    vec![
        ModelResponse {
            id: "gpt-4o-mini".to_string(),
            name: "GPT-4o Mini".to_string(),
            provider: "openai".to_string(),
            model_id: "gpt-4o-mini".to_string(),
            capabilities: vec!["streaming", "vision", "functionCalling", "longContext"],
            is_default: true,
            enabled: true,
        },
        ModelResponse {
            id: "claude-3-5-sonnet".to_string(),
            name: "Claude 3.5 Sonnet".to_string(),
            provider: "anthropic".to_string(),
            model_id: "claude-3-5-sonnet-latest".to_string(),
            capabilities: vec!["streaming", "vision", "functionCalling", "longContext"],
            is_default: false,
            enabled: true,
        },
        ModelResponse {
            id: "deepseek-chat".to_string(),
            name: "DeepSeek Chat".to_string(),
            provider: "deepseek".to_string(),
            model_id: "deepseek-chat".to_string(),
            capabilities: vec!["streaming", "functionCalling"],
            is_default: false,
            enabled: true,
        },
    ]
}

fn bool_to_sqlite_int(value: bool) -> i64 {
    if value { 1 } else { 0 }
}

fn database_unavailable_message() -> String {
    "database unavailable: set DATABASE_PATH or place SACODE.db under /workspace/data or /workspace/packages/database/data".to_string()
}

fn run_async_blocking<F, T>(future: F) -> Result<T, String>
where
    F: std::future::Future<Output = Result<T, String>>,
{
    match Handle::try_current() {
        Ok(handle) => block_in_place(|| handle.block_on(future)),
        Err(_) => {
            let rt = tokio::runtime::Runtime::new()
                .map_err(|error| format!("failed to create runtime: {error}"))?;
            rt.block_on(future)
        }
    }
}

fn init_tracing() {
    tracing_subscriber::registry()
        .with(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "sacode_rust_api_mvp=debug,tower_http=info".into()),
        )
        .with(tracing_subscriber::fmt::layer())
        .init();
}
