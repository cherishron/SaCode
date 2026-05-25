use std::{env, io, sync::mpsc::{self, Receiver, Sender}, thread};

use anyhow::Result;
use crossterm::{
    event::{self, DisableMouseCapture, EnableMouseCapture, Event, KeyCode, KeyEvent, KeyEventKind},
    execute,
    terminal::{disable_raw_mode, enable_raw_mode, EnterAlternateScreen, LeaveAlternateScreen},
};
use ratatui::{
    backend:: CrosstermBackend,
    layout::{Constraint, Direction, Layout},
    style::{Color, Modifier, Style},
    text::{Line, Span},
    widgets::{Block, Borders, Paragraph, Scrollbar, ScrollbarOrientation, ScrollbarState},
    Frame, Terminal,
};
use sacode_kernel::ExecutionMode;

use crate::provider_config::{NamedProviderConfig, ProviderConfig, ProviderConfigStore, SaCodeConfigStore, fallback_models, fetch_models};
use crate::provider_runtime::resolve_named_provider;
use crate::runner::{format_chat_output, run_task};
use sacode_runtime::{McpConfigStore, SkillRegistry};

const MODELS_HINT_LIMIT: usize = 8;

struct Message {
    role: MessageRole,
    content: String,
    timestamp: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum MessageRole {
    User,
    Assistant,
    System,
}

struct App {
    messages: Vec<Message>,
    input: String,
    should_quit: bool,
    scroll_offset: usize,
    processing: bool,
    input_mode: InputMode,
    provider_store: ProviderConfigStore,
    sacode_store: SaCodeConfigStore,
    current_provider: Option<NamedProviderConfig>,
    pending_base_url: Option<String>,
    pending_provider_name: Option<String>,
    provider_options: Vec<String>,
    selected_provider_index: usize,
    model_options: Vec<String>,
    selected_model_index: usize,
    connect_options: Vec<(String, String, bool)>,
    selected_connect_index: usize,
    pending_connect_provider: Option<(String, String)>,
    task_tx: Sender<AsyncResult>,
    task_rx: Receiver<AsyncResult>,
    busy_message: String,
    execution_mode: ExecutionMode,
    level1_commands: Vec<CommandDef>,
    filtered_level1: Vec<CommandDef>,
    selected_level1_index: usize,
    current_level1: Option<CommandDef>,
    filtered_sub_commands: Vec<SubCommandDef>,
    selected_sub_index: usize,
    skills_options: Vec<(String, String)>,
    selected_skills_index: usize,
    pending_skill_action: Option<String>,
    mcp_options: Vec<(String, String, bool)>,
    selected_mcp_index: usize,
    pending_mcp_action: Option<String>,
    checkpoint_options: Vec<String>,
    selected_checkpoint_index: usize,
    pending_checkpoint_action: Option<String>,
    mode_options: Vec<String>,
    selected_mode_index: usize,
}

#[derive(Debug, Clone, PartialEq, Eq)]
enum InputMode {
    Chat,
    LoginBaseUrl,
    LoginApiKey,
    ProviderSelect,
    ProviderRename,
    ModelSelect,
    ConnectSelect,
    ConnectApiKey,
    CommandLevel1,
    CommandLevel2,
    SkillsSelect,
    McpSelect,
    CheckpointSelect,
    SkillInput,
    McpInput,
    CheckpointInput,
    ModeSelect,
}

#[derive(Clone)]
struct CommandDef {
    name: String,
    description: String,
    sub_commands: Vec<SubCommandDef>,
    direct_execute: bool,
}

#[derive(Clone)]
struct SubCommandDef {
    name: String,
    description: String,
    needs_input: bool,
}

impl CommandDef {
    fn simple(name: &str, description: &str) -> Self {
        Self {
            name: name.to_string(),
            description: description.to_string(),
            sub_commands: Vec::new(),
            direct_execute: true,
        }
    }

    fn with_subs(name: &str, description: &str, subs: Vec<SubCommandDef>) -> Self {
        Self {
            name: name.to_string(),
            description: description.to_string(),
            sub_commands: subs,
            direct_execute: false,
        }
    }
}

impl SubCommandDef {
    fn new(name: &str, description: &str) -> Self {
        Self {
            name: name.to_string(),
            description: description.to_string(),
            needs_input: false,
        }
    }

    fn with_input(name: &str, description: &str) -> Self {
        Self {
            name: name.to_string(),
            description: description.to_string(),
            needs_input: true,
        }
    }
}

fn get_level1_commands() -> Vec<CommandDef> {
    vec![
        CommandDef::simple("/init", "初始化项目配置"),
        CommandDef::with_subs("/profile", "配置管理", vec![
            SubCommandDef::new("ls", "列出所有配置"),
            SubCommandDef::new("use", "切换当前配置"),
            SubCommandDef::new("show", "显示当前配置详情"),
        ]),
        CommandDef::with_subs("/plugin", "插件管理", vec![
            SubCommandDef::new("list", "列出已安装插件"),
            SubCommandDef::new("install", "安装插件"),
            SubCommandDef::new("remove", "删除插件"),
            SubCommandDef::new("enable", "启用插件"),
            SubCommandDef::new("disable", "禁用插件"),
        ]),
        CommandDef::with_subs("/checkpoint", "检查点管理", vec![
            SubCommandDef::new("list", "列出检查点"),
            SubCommandDef::with_input("save", "保存检查点"),
            SubCommandDef::new("restore", "恢复检查点"),
            SubCommandDef::new("delete", "删除检查点"),
        ]),
        CommandDef::with_subs("/mode", "执行模式", vec![
            SubCommandDef::new("plan", "规划模式"),
            SubCommandDef::new("build", "构建模式"),
            SubCommandDef::new("yolo", "自动执行模式"),
        ]),
        CommandDef::with_subs("/skills", "Skills 管理", vec![
            SubCommandDef::new("list", "列出可用 Skills"),
            SubCommandDef::with_input("show", "查看 Skill 详情"),
            SubCommandDef::with_input("run", "运行 Skill"),
            SubCommandDef::with_input("add", "添加 Skill"),
            SubCommandDef::with_input("remove", "删除 Skill"),
        ]),
        CommandDef::with_subs("/mcp", "MCP 管理", vec![
            SubCommandDef::new("list", "列出 MCP 服务"),
            SubCommandDef::with_input("show", "查看 MCP 详情"),
            SubCommandDef::with_input("remove", "删除 MCP 服务"),
        ]),
        CommandDef::simple("/providers", "管理 Provider"),
        CommandDef::simple("/models", "选择模型"),
        CommandDef::simple("/login", "配置 Provider 登录"),
        CommandDef::simple("/connect", "快速接入 Provider"),
        CommandDef::simple("/tools", "显示可用工具"),
        CommandDef::simple("/help", "显示帮助"),
        CommandDef::simple("/exit", "退出"),
    ]
}

fn fuzzy_match(query: &str, target: &str) -> bool {
    if query.is_empty() {
        return true;
    }
    let query_chars: Vec<char> = query.chars().collect();
    let target_chars: Vec<char> = target.chars().collect();
    
    let mut query_idx = 0;
    for target_char in target_chars.iter() {
        if query_idx < query_chars.len() && *target_char == query_chars[query_idx] {
            query_idx += 1;
        }
    }
    query_idx == query_chars.len()
}

enum AsyncResult {
    ChatCompleted(String),
    LoginCompleted {
        provider_name: String,
        config: ProviderConfig,
        models: Vec<String>,
    },
    ProvidersLoaded {
        providers: Vec<String>,
        current_provider: String,
    },
    ProviderSwitched {
        provider_name: String,
        config: ProviderConfig,
    },
    ModelsLoaded {
        models: Vec<String>,
        current_model: String,
    },
    ModelSaved {
        config: ProviderConfig,
        selected_model: String,
    },
    Failed {
        context: AsyncContext,
        message: String,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum AsyncContext {
    Login,
    LoadProviders,
    SaveProvider,
    LoadModels,
    SaveModel,
}

impl App {
    fn new() -> Self {
        let now = chrono::Local::now();
        let timestamp = now.format("%Y-%m-%d %H:%M").to_string();
        let workdir = env::current_dir().unwrap_or_else(|_| ".".into());
        let provider_store = ProviderConfigStore::new(&workdir);
        let sacode_store = SaCodeConfigStore::new(&workdir);
        let current_provider = resolve_named_provider(&workdir);
        let (task_tx, task_rx) = mpsc::channel();
        let level1_commands = get_level1_commands();
        
        Self {
            messages: vec![
                Message {
                    role: MessageRole::System,
                    content: "SaCode - AI Coding Assistant\n\n输入你的编程任务，我会帮你完成。\n按 Ctrl+Q 退出，按 Esc 清空输入.\n输入 / 可显示命令列表.".to_string(),
                    timestamp: timestamp.clone(),
                },
            ],
            input: String::new(),
            should_quit: false,
            scroll_offset: 0,
            processing: false,
            input_mode: InputMode::Chat,
            provider_store,
            sacode_store,
            current_provider,
            pending_base_url: None,
            pending_provider_name: None,
            provider_options: Vec::new(),
            selected_provider_index: 0,
            model_options: Vec::new(),
            selected_model_index: 0,
            connect_options: vec![
                ("ollama".to_string(), "http://127.0.0.1:11434/v1".to_string(), false),
                ("deepseek".to_string(), "https://api.deepseek.com/v1".to_string(), true),
                ("mimo".to_string(), "https://token-plan-cn.xiaomimimo.com/v1".to_string(), true),
                ("longcat".to_string(), "https://api.longcat.chat/openai/v1".to_string(), true),
                ("openai".to_string(), "https://api.openai.com/v1".to_string(), true),
            ],
            selected_connect_index: 0,
            pending_connect_provider: None,
            task_tx,
            task_rx,
            busy_message: String::new(),
            execution_mode: ExecutionMode::Build,
            level1_commands,
            filtered_level1: Vec::new(),
            selected_level1_index: 0,
            current_level1: None,
            filtered_sub_commands: Vec::new(),
            selected_sub_index: 0,
            skills_options: Vec::new(),
            selected_skills_index: 0,
            pending_skill_action: None,
            mcp_options: Vec::new(),
            selected_mcp_index: 0,
            pending_mcp_action: None,
            checkpoint_options: Vec::new(),
            selected_checkpoint_index: 0,
            pending_checkpoint_action: None,
            mode_options: vec![
                "plan".to_string(),
                "build".to_string(),
                "yolo".to_string(),
            ],
            selected_mode_index: 0,
        }
    }

    fn send_message(&mut self) {
        if self.input.is_empty() || self.processing {
            return;
        }

        match self.input_mode {
            InputMode::Chat => {}
            InputMode::LoginBaseUrl => {
                self.finish_login_base_url();
                return;
            }
            InputMode::LoginApiKey => {
                self.finish_login_api_key();
                return;
            }
            InputMode::ProviderSelect => {
                self.confirm_provider_selection();
                return;
            }
            InputMode::ProviderRename => {
                self.finish_provider_rename();
                return;
            }
            InputMode::ModelSelect => {
                self.confirm_model_selection();
                return;
            }
            InputMode::ConnectSelect | InputMode::ConnectApiKey => {
                return;
            }
            InputMode::CommandLevel1 | InputMode::CommandLevel2 => {
                return;
            }
            InputMode::SkillsSelect => {
                return;
            }
            InputMode::McpSelect => {
                return;
            }
            InputMode::CheckpointSelect => {
                return;
            }
            InputMode::SkillInput => {
                self.finish_skill_input();
                return;
            }
            InputMode::McpInput => {
                self.finish_mcp_input();
                return;
            }
            InputMode::CheckpointInput => {
                self.finish_checkpoint_input();
                return;
            }
            InputMode::ModeSelect => {
                return;
            }
        }

        if self.input == "/login" {
            self.start_login();
            return;
        }

        if self.input == "/models" {
            self.open_model_picker();
            return;
        }

        if self.input == "/providers" {
            self.open_provider_picker();
            return;
        }

        if self.input.starts_with("/provider-rename ") {
            self.rename_provider_command();
            return;
        }

        if self.input.starts_with("/provider-remove ") {
            self.remove_provider_command();
            return;
        }

        if self.handle_local_command() {
            return;
        }

        let now = chrono::Local::now();
        let timestamp = now.format("%Y-%m-%d %H:%M").to_string();

        self.messages.push(Message {
            role: MessageRole::User,
            content: self.input.clone(),
            timestamp: timestamp.clone(),
        });

        let user_input = self.input.clone();
        self.input.clear();
        self.processing = true;
        self.busy_message = format!("正在请求 {}...", self.current_model_name());
        self.spawn_chat_task(user_input);
        self.scroll_to_bottom();
    }

    fn spawn_chat_task(&self, user_input: String) {
        let sender = self.task_tx.clone();
        let workdir = env::current_dir().unwrap_or_else(|_| ".".into());
        let mode = self.execution_mode;
        thread::spawn(move || {
            let response = App::execute_user_message_in_background(&workdir, &user_input, mode);
            let _ = sender.send(AsyncResult::ChatCompleted(response));
        });
    }

    fn execute_user_message_in_background(workdir: &std::path::Path, user_input: &str, mode: ExecutionMode) -> String {
        let runtime = match tokio::runtime::Builder::new_current_thread().enable_all().build() {
            Ok(runtime) => runtime,
            Err(error) => return format!("后台运行时初始化失败: {}", error),
        };
        let _ = workdir;
        match runtime.block_on(run_task(user_input, mode, crate::cmd::ApprovalPolicy::AutoDeny, 1)) {
            Ok(output) => format_chat_output(&output),
            Err(error) => format!("任务执行失败: {}", error),
        }
    }

    fn start_login(&mut self) {
        self.input_mode = InputMode::LoginBaseUrl;
        self.pending_base_url = None;
        self.pending_provider_name = self.current_provider.as_ref().map(|provider| provider.name.clone());
        self.input = self
            .current_provider
            .as_ref()
            .map(|provider| provider.config.base_url.clone())
            .unwrap_or_default();
        self.push_system_message("请输入 provider 名称与 Base URL，格式为 name https://api.openai.com/v1；只输入 Base URL 时会复用当前 provider 名称。输入 /providers 可切换 provider。");
    }

    fn finish_login_base_url(&mut self) {
        let raw_input = self.input.trim().to_string();
        let (provider_name, base_url) = if let Some((name, url)) = raw_input.split_once(' ') {
            (name.trim().to_string(), url.trim().to_string())
        } else {
            (
                self.pending_provider_name.clone().unwrap_or_else(|| "default".to_string()),
                raw_input,
            )
        };
        if provider_name.is_empty() {
            self.push_system_message("Provider 名称不能为空。");
            return;
        }
        if base_url.is_empty() {
            self.push_system_message("Base URL 不能为空。");
            return;
        }

        self.pending_provider_name = Some(provider_name);
        self.pending_base_url = Some(base_url);
        self.input.clear();
        self.input_mode = InputMode::LoginApiKey;
        self.push_system_message("请输入 API Key，回车后会保存配置并拉取模型列表。");
    }

    fn finish_login_api_key(&mut self) {
        let api_key = self.input.trim().to_string();
        if api_key.is_empty() {
            self.push_system_message("API Key 不能为空。");
            return;
        }

        let config = ProviderConfig {
            base_url: self.pending_base_url.clone().unwrap_or_default(),
            api_key,
            model: self
                .current_provider
                .as_ref()
                .map(|value| value.config.model.clone())
                .unwrap_or_default(),
        };

        self.processing = true;
        self.busy_message = "正在验证 provider 并拉取模型列表...".to_string();
        self.spawn_login_task(
            self.pending_provider_name.clone().unwrap_or_else(|| "default".to_string()),
            config,
        );
        self.pending_base_url = None;
        self.pending_provider_name = None;
        self.input.clear();
        self.input_mode = InputMode::Chat;
    }

    fn open_provider_picker(&mut self) {
        self.processing = true;
        self.busy_message = "正在加载 provider 列表...".to_string();
        self.spawn_load_providers_task();
        self.input.clear();
    }

    fn confirm_provider_selection(&mut self) {
        let Some(provider_name) = self.provider_options.get(self.selected_provider_index).cloned() else {
            self.push_system_message("当前没有可选 provider。");
            self.input_mode = InputMode::Chat;
            return;
        };

        self.input_mode = InputMode::Chat;
        self.processing = true;
        self.busy_message = format!("正在切换 provider 到 {}...", provider_name);
        self.spawn_switch_provider_task(provider_name);
        self.input.clear();
    }

    fn start_provider_rename(&mut self) {
        let Some(provider_name) = self.provider_options.get(self.selected_provider_index).cloned() else {
            self.push_system_message("当前没有可重命名的 provider。");
            return;
        };

        self.pending_provider_name = Some(provider_name.clone());
        self.input.clear();
        self.input_mode = InputMode::ProviderRename;
        self.push_system_message(&format!("请输入 provider {} 的新名称，回车确认，Esc 取消。", provider_name));
    }

    fn finish_provider_rename(&mut self) {
        let Some(old_name) = self.pending_provider_name.clone() else {
            self.push_system_message("当前没有待重命名的 provider。");
            self.input_mode = InputMode::Chat;
            return;
        };

        let new_name = self.input.trim().to_string();
        if new_name.is_empty() {
            self.push_system_message("新 provider 名称不能为空。");
            return;
        }

        match self.provider_store.rename(&old_name, &new_name) {
            Ok(()) => {
                if let Some(current) = &mut self.current_provider {
                    if current.name == old_name {
                        current.name = new_name.clone();
                    }
                }
                if let Some(selected) = self.provider_options.get_mut(self.selected_provider_index) {
                    *selected = new_name.clone();
                }
                self.provider_options.sort();
                self.selected_provider_index = self
                    .provider_options
                    .iter()
                    .position(|provider| provider == &new_name)
                    .unwrap_or(0);
                self.push_system_message(&format!("Provider {} 已重命名为 {}。", old_name, new_name));
                self.input_mode = InputMode::ProviderSelect;
            }
            Err(error) => {
                self.push_system_message(&format!("重命名 provider 失败: {}", error));
            }
        }

        self.pending_provider_name = None;
        self.input.clear();
    }

    fn remove_selected_provider(&mut self) {
        let Some(provider_name) = self.provider_options.get(self.selected_provider_index).cloned() else {
            self.push_system_message("当前没有可删除的 provider。");
            return;
        };

        match self.provider_store.remove(&provider_name) {
            Ok(()) => {
                self.provider_options.retain(|provider| provider != &provider_name);
                if self.selected_provider_index >= self.provider_options.len() && !self.provider_options.is_empty() {
                    self.selected_provider_index = self.provider_options.len() - 1;
                }
                if self.provider_options.is_empty() {
                    self.input_mode = InputMode::Chat;
                }
                self.push_system_message(&format!("Provider {} 已删除。", provider_name));
            }
            Err(error) => {
                self.push_system_message(&format!("删除 provider 失败: {}", error));
            }
        }
    }

    fn open_model_picker(&mut self) {
        let Some(current_provider) = self.current_provider.clone() else {
            self.push_system_message("当前还没有 provider 配置，请先输入 /login。");
            self.input.clear();
            return;
        };

        self.processing = true;
        self.busy_message = format!("正在拉取 {} 的模型列表...", current_provider.name);
        self.spawn_load_models_task(current_provider.config);
        self.input.clear();
    }

    fn handle_local_command(&mut self) -> bool {
        let input = self.input.clone();
        let trimmed = input.trim();
        
        if trimmed == "/init" {
            self.init_command();
            self.input.clear();
            return true;
        }

        if trimmed.starts_with("/profile ") || trimmed == "/profile" {
            self.profile_command(&input);
            self.input.clear();
            return true;
        }

        if trimmed.starts_with("/plugin ") || trimmed == "/plugin" {
            self.plugin_command(&input);
            self.input.clear();
            return true;
        }

        if trimmed.starts_with("/checkpoint ") || trimmed == "/checkpoint" {
            self.checkpoint_command(&input);
            self.input.clear();
            return true;
        }

        if trimmed.starts_with("/mode ") || trimmed == "/mode" {
            self.mode_command(&input);
            self.input.clear();
            return true;
        }

        if trimmed.starts_with("/skills ") || trimmed == "/skills" || trimmed == "/skill" {
            self.skills_command(&input);
            self.input.clear();
            return true;
        }

        if trimmed.starts_with("/mcp ") || trimmed == "/mcp" {
            self.mcp_command(&input);
            self.input.clear();
            return true;
        }

        if trimmed == "/tools" {
            self.tools_command();
            self.input.clear();
            return true;
        }

        if trimmed == "/help" {
            self.help_command();
            self.input.clear();
            return true;
        }

        if trimmed == "/exit" {
            self.should_quit = true;
            self.input.clear();
            return true;
        }

        if trimmed == "/connect" {
            self.input_mode = InputMode::ConnectSelect;
            self.selected_connect_index = 0;
            self.input.clear();
            return true;
        }

        if trimmed.starts_with("/connect ") {
            self.connect_provider_command();
            return true;
        }

        false
    }

    fn init_command(&mut self) {
        let workdir = env::current_dir().unwrap_or_else(|_| ".".into());
        let sacode_dir = workdir.join(".sacode");
        
        if sacode_dir.exists() {
            self.push_system_message(".sacode 目录已存在。如需重新初始化，请先删除该目录。");
            return;
        }

        if let Err(e) = std::fs::create_dir_all(&sacode_dir) {
            self.push_system_message(&format!("创建 .sacode 目录失败: {}", e));
            return;
        }

        let config_path = sacode_dir.join("config.json");
        let default_config = serde_json::json!({
            "providers": {},
            "current": ""
        });
        
        if let Err(e) = std::fs::write(&config_path, default_config.to_string()) {
            self.push_system_message(&format!("创建 config.json 失败: {}", e));
            return;
        }

        self.push_system_message(&format!(
            "项目已初始化。\n配置文件: {}\n请使用 /login 配置 Provider。",
            config_path.display()
        ));
    }

    fn profile_command(&mut self, input: &str) {
        let parts: Vec<&str> = input.split_whitespace().collect();
        let sub = parts.get(1).copied().unwrap_or("ls");

        match sub {
            "ls" => {
                let providers = self.provider_store.load_catalog()
                    .ok()
                    .flatten()
                    .map(|c| c.providers.keys().cloned().collect::<Vec<_>>())
                    .unwrap_or_default();
                if providers.is_empty() {
                    self.push_system_message("当前没有配置任何 Provider。");
                } else {
                    let current = self.current_provider.as_ref().map(|p| p.name.clone()).unwrap_or_default();
                    let list = providers.iter()
                        .map(|name| {
                            if name == &current {
                                format!("* {}", name)
                            } else {
                                format!("  {}", name)
                            }
                        })
                        .collect::<Vec<_>>()
                        .join("\n");
                    self.push_system_message(&format!("Provider 配置列表:\n{}\n当前: {}", list, current));
                }
            }
            "use" => {
                if parts.len() > 2 {
                    let name = parts[2];
                    self.switch_provider_by_name(name);
                } else {
                    self.open_provider_switch_selector();
                }
            }
            "show" => {
                let default_name = self.current_provider.as_ref().map(|p| p.name.clone()).unwrap_or_default();
                let name = parts.get(2).copied().unwrap_or(&default_name);
                if name.is_empty() {
                    self.push_system_message("用法: /profile show [name]");
                    return;
                }
                self.show_provider_detail(name);
            }
            _ => self.push_system_message("用法: /profile ls|use|show"),
        }
    }

    fn plugin_command(&mut self, input: &str) {
        let parts: Vec<&str> = input.split_whitespace().collect();
        let workdir = env::current_dir().unwrap_or_else(|_| ".".into());
        let plugin_file = workdir.join(".sacode").join("plugins.json");

        if parts.len() <= 1 || parts[1] == "list" {
            self.list_plugins(&plugin_file);
            return;
        }

        match parts.get(1).copied() {
            Some("install") => {
                if parts.len() > 2 {
                    let plugin_ref = parts[2];
                    self.install_plugin(&plugin_file, plugin_ref);
                } else {
                    self.push_system_message("用法: /plugin install <name|url>");
                }
            }
            Some("remove") => {
                if parts.len() > 2 {
                    let name = parts[2];
                    self.remove_plugin(&plugin_file, name);
                } else {
                    self.push_system_message("用法: /plugin remove <name>");
                }
            }
            Some("enable") => {
                if parts.len() > 2 {
                    let name = parts[2];
                    self.enable_plugin(&plugin_file, name, true);
                } else {
                    self.push_system_message("用法: /plugin enable <name>");
                }
            }
            Some("disable") => {
                if parts.len() > 2 {
                    let name = parts[2];
                    self.enable_plugin(&plugin_file, name, false);
                } else {
                    self.push_system_message("用法: /plugin disable <name>");
                }
            }
            _ => self.push_system_message("用法: /plugin list|install|remove|enable|disable"),
        }
    }

    fn list_plugins(&mut self, plugin_file: &std::path::Path) {
        if !plugin_file.exists() {
            self.push_system_message("当前没有安装任何插件。\n\n可用内置功能:\n- Skills: /skills list\n- MCP: /mcp list\n\n安装插件: /plugin install <name>");
            return;
        }

        match std::fs::read_to_string(plugin_file) {
            Ok(content) => {
                match serde_json::from_str::<serde_json::Value>(&content) {
                    Ok(data) => {
                        if let Some(plugins) = data.get("plugins").and_then(|p| p.as_array()) {
                            if plugins.is_empty() {
                                self.push_system_message("当前没有安装任何插件。");
                            } else {
                                let summary = plugins.iter()
                                    .map(|p| {
                                        let name = p.get("name").and_then(|n| n.as_str()).unwrap_or("unknown");
                                        let enabled = p.get("enabled").and_then(|e| e.as_bool()).unwrap_or(true);
                                        let version = p.get("version").and_then(|v| v.as_str()).unwrap_or("");
                                        let status = if enabled { "[on]" } else { "[off]" };
                                        format!("- {} {} {}{}", name, status, version, if version.is_empty() { "" } else { "" })
                                    })
                                    .collect::<Vec<_>>()
                                    .join("\n");
                                self.push_system_message(&format!("已安装插件:\n{}\n\n管理命令:\n/plugin enable|disable <name>", summary));
                            }
                        } else {
                            self.push_system_message("插件配置格式错误。");
                        }
                    }
                    Err(e) => self.push_error_message(&format!("解析插件配置失败: {}", e)),
                }
            }
            Err(e) => self.push_error_message(&format!("读取插件配置失败: {}", e)),
        }
    }

    fn install_plugin(&mut self, plugin_file: &std::path::Path, plugin_ref: &str) {
        if let Err(e) = std::fs::create_dir_all(plugin_file.parent().unwrap()) {
            self.push_error_message(&format!("创建配置目录失败: {}", e));
            return;
        }

        let existing = if plugin_file.exists() {
            std::fs::read_to_string(plugin_file)
                .ok()
                .and_then(|c| serde_json::from_str::<serde_json::Value>(&c).ok())
                .and_then(|d| d.get("plugins").and_then(|p| p.as_array()).cloned())
                .unwrap_or_default()
        } else {
            Vec::new()
        };

        let new_plugin = serde_json::json!({
            "name": plugin_ref,
            "version": "latest",
            "enabled": true,
            "installed_at": chrono::Local::now().format("%Y-%m-%d %H:%M").to_string(),
        });

        let mut plugins = existing;
        if plugins.iter().any(|p| p.get("name").and_then(|n| n.as_str()) == Some(plugin_ref)) {
            self.push_system_message(&format!("插件 {} 已存在。", plugin_ref));
            return;
        }
        plugins.push(new_plugin);

        let config = serde_json::json!({ "plugins": plugins });
        match std::fs::write(plugin_file, config.to_string()) {
            Ok(()) => self.push_success_message(&format!("插件 {} 已安装", plugin_ref)),
            Err(e) => self.push_error_message(&format!("保存插件配置失败: {}", e)),
        }
    }

    fn remove_plugin(&mut self, plugin_file: &std::path::Path, name: &str) {
        if !plugin_file.exists() {
            self.push_system_message("插件配置不存在。");
            return;
        }

        match std::fs::read_to_string(plugin_file) {
            Ok(content) => {
                match serde_json::from_str::<serde_json::Value>(&content) {
                    Ok(data) => {
                        if let Some(plugins) = data.get("plugins").and_then(|p| p.as_array()) {
                            let filtered: Vec<_> = plugins.iter()
                                .filter(|p| p.get("name").and_then(|n| n.as_str()) != Some(name))
                                .collect();

                            if filtered.len() == plugins.len() {
                                self.push_system_message(&format!("插件 {} 不存在。", name));
                                return;
                            }

                            let config = serde_json::json!({ "plugins": filtered });
                            match std::fs::write(plugin_file, config.to_string()) {
                                Ok(()) => self.push_success_message(&format!("插件 {} 已卸载", name)),
                                Err(e) => self.push_error_message(&format!("保存配置失败: {}", e)),
                            }
                        }
                    }
                    Err(e) => self.push_error_message(&format!("解析配置失败: {}", e)),
                }
            }
            Err(e) => self.push_error_message(&format!("读取配置失败: {}", e)),
        }
    }

    fn enable_plugin(&mut self, plugin_file: &std::path::Path, name: &str, enable: bool) {
        if !plugin_file.exists() {
            self.push_system_message("插件配置不存在。");
            return;
        }

        match std::fs::read_to_string(plugin_file) {
            Ok(content) => {
                match serde_json::from_str::<serde_json::Value>(&content) {
                    Ok(data) => {
                        if let Some(plugins) = data.get("plugins").and_then(|p| p.as_array()).cloned() {
                            let mut found = false;
                            let updated: Vec<_> = plugins.iter()
                                .map(|p| {
                                    if p.get("name").and_then(|n| n.as_str()) == Some(name) {
                                        found = true;
                                        let mut updated = p.clone();
                                        updated["enabled"] = serde_json::json!(enable);
                                        updated
                                    } else {
                                        p.clone()
                                    }
                                })
                                .collect();

                            if !found {
                                self.push_system_message(&format!("插件 {} 不存在。", name));
                                return;
                            }

                            let config = serde_json::json!({ "plugins": updated });
                            match std::fs::write(plugin_file, config.to_string()) {
                                Ok(()) => self.push_success_message(&format!(
                                    "插件 {} 已{}",
                                    name,
                                    if enable { "启用" } else { "禁用" }
                                )),
                                Err(e) => self.push_error_message(&format!("保存配置失败: {}", e)),
                            }
                        }
                    }
                    Err(e) => self.push_error_message(&format!("解析配置失败: {}", e)),
                }
            }
            Err(e) => self.push_error_message(&format!("读取配置失败: {}", e)),
        }
    }

    fn checkpoint_command(&mut self, input: &str) {
        let parts: Vec<&str> = input.split_whitespace().collect();
        let workdir = env::current_dir().unwrap_or_else(|_| ".".into());
        let checkpoint_dir = workdir.join(".sacode").join("checkpoints");

        if parts.len() <= 1 || parts[1] == "list" {
            self.open_checkpoint_selector(&checkpoint_dir);
            return;
        }

        match parts.get(1).copied() {
            Some("restore") => {
                if parts.len() > 2 {
                    let name = parts[2];
                    self.restore_checkpoint(&checkpoint_dir, name);
                } else {
                    self.pending_checkpoint_action = Some("restore".to_string());
                    self.open_checkpoint_selector(&checkpoint_dir);
                }
            }
            Some("delete") => {
                if parts.len() > 2 {
                    let name = parts[2];
                    self.delete_checkpoint(&checkpoint_dir, name);
                } else {
                    self.pending_checkpoint_action = Some("delete".to_string());
                    self.open_checkpoint_selector(&checkpoint_dir);
                }
            }
            Some("save") => {
                if parts.len() > 2 {
                    let name = parts[2];
                    self.save_checkpoint(&checkpoint_dir, name);
                } else {
                    self.push_system_message("用法: /checkpoint save <name>");
                }
            }
            _ => self.push_system_message("用法: /checkpoint list|save|restore|delete"),
        }
    }

    fn open_checkpoint_selector(&mut self, checkpoint_dir: &std::path::Path) {
        if !checkpoint_dir.exists() {
            self.push_system_message("当前没有检查点。使用 /checkpoint save <name> 创建检查点。");
            return;
        }
        
        let checkpoints: Vec<String> = std::fs::read_dir(checkpoint_dir)
            .ok()
            .map(|entries| {
                entries
                    .filter_map(|e| e.ok())
                    .filter(|e| e.path().extension().map(|ext| ext == "json").unwrap_or(false))
                    .map(|e| e.path().file_stem().unwrap().to_string_lossy().to_string())
                    .collect()
            })
            .unwrap_or_default();

        if checkpoints.is_empty() {
            self.push_system_message("当前没有检查点。");
        } else {
            self.checkpoint_options = checkpoints;
            self.selected_checkpoint_index = 0;
            self.input_mode = InputMode::CheckpointSelect;
        }
    }

    fn confirm_checkpoint_selection(&mut self) {
        let selected_name = self.checkpoint_options.get(self.selected_checkpoint_index).cloned();
        if let Some(name) = selected_name {
            let action = self.pending_checkpoint_action.clone();
            let workdir = env::current_dir().unwrap_or_else(|_| ".".into());
            let checkpoint_dir = workdir.join(".sacode").join("checkpoints");
            
            self.input_mode = InputMode::Chat;
            self.checkpoint_options.clear();
            self.selected_checkpoint_index = 0;
            self.pending_checkpoint_action = None;
            
            match action.as_deref() {
                Some("restore") => self.restore_checkpoint(&checkpoint_dir, &name),
                Some("delete") => self.delete_checkpoint(&checkpoint_dir, &name),
                _ => self.push_system_message(&format!("检查点: {}", name)),
            }
        }
    }

    fn confirm_mode_selection(&mut self) {
        let mode_name = self.mode_options.get(self.selected_mode_index).cloned();
        if let Some(name) = mode_name {
            self.input_mode = InputMode::Chat;
            
            match name.as_str() {
                "plan" => {
                    self.execution_mode = ExecutionMode::Plan;
                    self.push_success_message("执行模式已切换为 Plan（规划模式）");
                }
                "build" => {
                    self.execution_mode = ExecutionMode::Build;
                    self.push_success_message("执行模式已切换为 Build（构建模式）");
                }
                "yolo" => {
                    self.execution_mode = ExecutionMode::Yolo;
                    self.push_success_message("执行模式已切换为 Yolo（自动执行模式）");
                }
                _ => {}
            }
        }
    }

    fn save_checkpoint(&mut self, checkpoint_dir: &std::path::Path, name: &str) {
        if let Err(e) = std::fs::create_dir_all(checkpoint_dir) {
            self.push_error_message(&format!("创建检查点目录失败: {}", e));
            return;
        }
        
        let checkpoint_file = checkpoint_dir.join(format!("{}.json", name));
        let checkpoint_data = serde_json::json!({
            "timestamp": chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string(),
            "messages": self.messages.iter().map(|m| serde_json::json!({
                "role": match m.role {
                    MessageRole::User => "user",
                    MessageRole::Assistant => "assistant",
                    MessageRole::System => "system",
                },
                "content": m.content,
                "timestamp": m.timestamp,
            })).collect::<Vec<_>>(),
        });
        
        match std::fs::write(&checkpoint_file, checkpoint_data.to_string()) {
            Ok(()) => self.push_success_message(&format!("检查点 {} 已保存", name)),
            Err(e) => self.push_error_message(&format!("保存检查点失败: {}", e)),
        }
    }

    fn restore_checkpoint(&mut self, checkpoint_dir: &std::path::Path, name: &str) {
        let checkpoint_file = checkpoint_dir.join(format!("{}.json", name));
        
        match std::fs::read_to_string(&checkpoint_file) {
            Ok(content) => {
                match serde_json::from_str::<serde_json::Value>(&content) {
                    Ok(data) => {
                        if let Some(msgs) = data.get("messages").and_then(|m| m.as_array()) {
                            self.messages = msgs.iter().filter_map(|m| {
                                let role = m.get("role").and_then(|r| r.as_str()).unwrap_or("system");
                                let content = m.get("content").and_then(|c| c.as_str()).unwrap_or("");
                                let timestamp = m.get("timestamp").and_then(|t| t.as_str()).unwrap_or("");
                                
                                Some(Message {
                                    role: match role {
                                        "user" => MessageRole::User,
                                        "assistant" => MessageRole::Assistant,
                                        _ => MessageRole::System,
                                    },
                                    content: content.to_string(),
                                    timestamp: timestamp.to_string(),
                                })
                            }).collect();
                            self.push_success_message(&format!("检查点 {} 已恢复", name));
                            self.scroll_to_bottom();
                        }
                    }
                    Err(e) => self.push_error_message(&format!("解析检查点失败: {}", e)),
                }
            }
            Err(e) => self.push_error_message(&format!("读取检查点失败: {}", e)),
        }
    }

    fn delete_checkpoint(&mut self, checkpoint_dir: &std::path::Path, name: &str) {
        let checkpoint_file = checkpoint_dir.join(format!("{}.json", name));
        
        match std::fs::remove_file(&checkpoint_file) {
            Ok(()) => self.push_success_message(&format!("检查点 {} 已删除", name)),
            Err(e) => self.push_error_message(&format!("删除检查点失败: {}", e)),
        }
    }

    fn finish_checkpoint_input(&mut self) {
        self.input_mode = InputMode::Chat;
        self.pending_checkpoint_action = None;
        self.send_message();
    }

    fn mode_command(&mut self, input: &str) {
        let parts: Vec<&str> = input.split_whitespace().collect();
        let sub = parts.get(1).copied().unwrap_or("");

        match sub {
            "plan" => {
                self.execution_mode = ExecutionMode::Plan;
                self.push_system_message("执行模式已切换为 Plan（规划模式）。\nAI 将先规划步骤，再逐步执行。");
            }
            "build" => {
                self.execution_mode = ExecutionMode::Build;
                self.push_system_message("执行模式已切换为 Build（构建模式）。\nAI 将直接执行任务。");
            }
            "yolo" => {
                self.execution_mode = ExecutionMode::Yolo;
                self.push_system_message("执行模式已切换为 Yolo（自动执行模式）。\nAI 将自动执行，减少确认步骤。");
            }
            "" => {
                self.open_mode_selector();
            }
            _ => self.push_system_message("用法: /mode plan|build|yolo"),
        }
    }

    fn open_mode_selector(&mut self) {
        let current_mode = match self.execution_mode {
            ExecutionMode::Plan => 0,
            ExecutionMode::Build => 1,
            ExecutionMode::Yolo => 2,
        };
        self.selected_mode_index = current_mode;
        self.input_mode = InputMode::ModeSelect;
        self.push_system_message("已打开模式选择器，使用上下键选择，Enter 切换，Esc 取消。");
    }

    fn skills_command(&mut self, input: &str) {
        let parts: Vec<&str> = input.split_whitespace().collect();
        let registry = SkillRegistry::new(std::path::Path::new("."));
        
        if parts.len() <= 1 || parts[1] == "list" {
            self.open_skills_selector();
            return;
        }

        match parts.get(1).copied() {
            Some("show") => {
                if parts.len() > 2 {
                    let name = parts[2];
                    match registry.get(name) {
                        Ok(skill) => self.push_system_message(&format!("Skill {}\n{}\n\n{}", skill.name, skill.description, skill.prompt)),
                        Err(error) => self.push_system_message(&format!("读取 skill 失败: {}", error)),
                    }
                } else {
                    self.open_skills_selector_for_action("show");
                }
            }
            Some("run") => {
                if parts.len() > 2 {
                    let name = parts[2];
                    match registry.render_prompt(name, &parts[3..].join(" "), std::path::Path::new(".")) {
                        Ok(rendered) => self.push_system_message(&rendered),
                        Err(error) => self.push_system_message(&format!("运行 skill 失败: {}", error)),
                    }
                } else {
                    self.open_skills_selector_for_action("run");
                }
            }
            Some("add") => {
                if parts.len() >= 5 {
                    match registry.save_project_skill(parts[2], parts[3], &parts[4..].join(" ")) {
                        Ok(path) => self.push_success_message(&format!("Skill 已保存到 {}", path.display())),
                        Err(error) => self.push_error_message(&format!("保存 skill 失败: {}", error)),
                    }
                } else {
                    self.push_system_message("用法: /skills add <name> <description> <prompt>");
                }
            }
            Some("remove") => {
                if parts.len() > 2 {
                    let name = parts[2];
                    match registry.remove_project_skill(name) {
                        Ok(()) => self.push_success_message(&format!("Skill {} 已删除", name)),
                        Err(error) => self.push_error_message(&format!("删除 skill 失败: {}", error)),
                    }
                } else {
                    self.open_skills_selector_for_action("remove");
                }
            }
            _ => self.push_system_message("用法: /skills list|show|run|add|remove"),
        }
    }

    fn open_skills_selector(&mut self) {
        let registry = SkillRegistry::new(std::path::Path::new("."));
        match registry.list() {
            Ok(skills) if skills.is_empty() => self.push_system_message("当前没有可用 skills"),
            Ok(skills) => {
                self.skills_options = skills
                    .into_iter()
                    .map(|s| (s.name, s.description))
                    .collect();
                self.selected_skills_index = 0;
                self.input_mode = InputMode::SkillsSelect;
            }
            Err(error) => self.push_error_message(&format!("读取 skills 失败: {}", error)),
        }
    }

    fn open_skills_selector_for_action(&mut self, action: &str) {
        self.pending_skill_action = Some(action.to_string());
        self.open_skills_selector();
    }

    fn confirm_skills_selection(&mut self) {
        let selected_skill = self.skills_options.get(self.selected_skills_index).cloned();
        if let Some((name, _desc)) = selected_skill {
            let action = self.pending_skill_action.clone();
            self.input_mode = InputMode::Chat;
            self.skills_options.clear();
            self.selected_skills_index = 0;
            self.pending_skill_action = None;
            
            match action.as_deref() {
                Some("show") => {
                    self.input = format!("/skills show {}", name);
                    self.send_message();
                }
                Some("run") => {
                    self.input = format!("/skills run {}", name);
                    self.push_system_message(&format!("已选择 skill: {}，请输入参数后回车执行", name));
                }
                Some("remove") => {
                    let registry = SkillRegistry::new(std::path::Path::new("."));
                    match registry.remove_project_skill(&name) {
                        Ok(()) => self.push_success_message(&format!("Skill {} 已删除", name)),
                        Err(error) => self.push_error_message(&format!("删除 skill 失败: {}", error)),
                    }
                }
                _ => {
                    self.input = format!("/skills show {}", name);
                    self.send_message();
                }
            }
        }
    }

    fn finish_skill_input(&mut self) {
        self.input_mode = InputMode::Chat;
        self.pending_skill_action = None;
        self.send_message();
    }

    fn mcp_command(&mut self, input: &str) {
        let parts: Vec<&str> = input.split_whitespace().collect();
        let store = McpConfigStore::new(std::path::Path::new("."));

        if parts.len() <= 1 || parts[1] == "list" {
            self.open_mcp_selector();
            return;
        }

        match parts.get(1).copied() {
            Some("show") => {
                if parts.len() > 2 {
                    let name = parts[2];
                    match store.get(name) {
                        Ok(server) => self.push_system_message(&format!(
                            "Name: {}\nType: {}\nEnabled: {}\nURL: {}",
                            name, server.server_type, server.enabled, server.url
                        )),
                        Err(error) => self.push_error_message(&format!("读取 MCP 服务失败: {}", error)),
                    }
                } else {
                    self.open_mcp_selector_for_action("show");
                }
            }
            Some("remove") => {
                if parts.len() > 2 {
                    let name = parts[2];
                    match store.remove(name) {
                        Ok(()) => self.push_success_message(&format!("MCP 服务 {} 已删除", name)),
                        Err(error) => self.push_error_message(&format!("删除 MCP 服务失败: {}", error)),
                    }
                } else {
                    self.open_mcp_selector_for_action("remove");
                }
            }
            _ => self.push_system_message("用法: /mcp list|show|remove"),
        }
    }

    fn open_mcp_selector(&mut self) {
        let store = McpConfigStore::new(std::path::Path::new("."));
        match store.load() {
            Ok(config) if config.mcp.is_empty() => self.push_system_message("当前没有配置 MCP 服务"),
            Ok(config) => {
                self.mcp_options = config.mcp
                    .into_iter()
                    .map(|(name, server)| (name, server.url, server.enabled))
                    .collect();
                self.selected_mcp_index = 0;
                self.input_mode = InputMode::McpSelect;
            }
            Err(error) => self.push_error_message(&format!("读取 MCP 配置失败: {}", error)),
        }
    }

    fn open_mcp_selector_for_action(&mut self, action: &str) {
        self.pending_mcp_action = Some(action.to_string());
        self.open_mcp_selector();
    }

    fn confirm_mcp_selection(&mut self) {
        let selected_mcp = self.mcp_options.get(self.selected_mcp_index).cloned();
        if let Some((name, url, enabled)) = selected_mcp {
            let action = self.pending_mcp_action.clone();
            self.input_mode = InputMode::Chat;
            self.mcp_options.clear();
            self.selected_mcp_index = 0;
            self.pending_mcp_action = None;
            
            match action.as_deref() {
                Some("show") => {
                    self.push_system_message(&format!(
                        "MCP 服务: {}\nURL: {}\n状态: {}",
                        name, url, if enabled { "启用" } else { "禁用" }
                    ));
                }
                Some("remove") => {
                    let store = McpConfigStore::new(std::path::Path::new("."));
                    match store.remove(&name) {
                        Ok(()) => self.push_success_message(&format!("MCP 服务 {} 已删除", name)),
                        Err(error) => self.push_error_message(&format!("删除失败: {}", error)),
                    }
                }
                _ => {
                    self.push_system_message(&format!(
                        "MCP 服务: {}\nURL: {}\n状态: {}",
                        name, url, if enabled { "启用" } else { "禁用" }
                    ));
                }
            }
        }
    }

    fn finish_mcp_input(&mut self) {
        self.input_mode = InputMode::Chat;
        self.pending_mcp_action = None;
        self.send_message();
    }

    fn tools_command(&mut self) {
        self.push_system_message(
            "可用工具类别:\n\
            - 文件操作: Read, Write, Edit, Glob, Grep\n\
            - 命令执行: Bash\n\
            - 任务管理: Task\n\
            - 交互式: Question\n\
            - 网络请求: WebFetch\n\
            - Skills: Skill\n\
            \n工具由 runtime 自动注册，根据配置动态可用。"
        );
    }

    fn help_command(&mut self) {
        self.push_system_message(
            "SaCode 帮助:\n\
            \n一级命令:\n\
            /init      - 初始化项目配置\n\
            /profile   - 配置管理 (ls/use/show)\n\
            /plugin    - 插件管理 (list/install/remove/enable/disable)\n\
            /checkpoint - 检查点管理 (list/save/restore/delete)\n\
            /mode      - 执行模式 (plan/build/yolo)\n\
            /skills    - Skills 管理 (list/show/run/add/remove)\n\
            /mcp       - MCP 管理 (list/show/remove)\n\
            /providers - 管理 Provider\n\
            /models    - 选择模型\n\
            /login     - 配置 Provider 登录\n\
            /connect   - 快速接入 Provider\n\
            /tools     - 显示可用工具\n\
            /help      - 显示帮助\n\
            /exit      - 退出\n\
            \n快捷键:\n\
            Ctrl+Q - 退出\n\
            Esc    - 清空输入/取消选择\n\
            输入 /  - 显示命令列表"
        );
    }

    fn open_provider_switch_selector(&mut self) {
        let providers = self.provider_store.load_catalog()
            .ok()
            .flatten()
            .map(|c| c.providers.keys().cloned().collect::<Vec<_>>())
            .unwrap_or_default();

        if providers.is_empty() {
            self.push_system_message("当前没有配置任何 Provider。请先使用 /login 添加。");
        } else {
            self.provider_options = providers;
            self.selected_provider_index = 0;
            self.input_mode = InputMode::ProviderSelect;
            self.push_system_message("已打开 Provider 选择器，使用上下键选择，Enter 切换，Esc 取消。");
        }
    }

    fn switch_provider_by_name(&mut self, name: &str) {
        let catalog = self.provider_store.load_catalog()
            .ok()
            .flatten();
        
        match catalog {
            Some(c) if c.providers.contains_key(name) => {
                let config = c.providers.get(name).cloned().unwrap();
                self.current_provider = Some(crate::provider_config::NamedProviderConfig {
                    name: name.to_string(),
                    config,
                });
                self.push_system_message(&format!("Provider 已切换为 {}。", name));
            }
            _ => self.push_system_message(&format!("Provider {} 不存在。", name)),
        }
    }

    fn show_provider_detail(&mut self, name: &str) {
        match self.sacode_store.provider(name) {
            Ok(Some(spec)) => {
                let current_model = self.current_provider
                    .as_ref()
                    .filter(|p| p.name == name)
                    .map(|p| p.config.model.clone())
                    .unwrap_or_else(|| spec.models.keys().next().cloned().unwrap_or_default());
                self.push_system_message(&format!(
                    "Provider: {}\nBase URL: {}\nAPI Key: {}\nModels: {}\n当前模型: {}",
                    name,
                    spec.base_url,
                    if spec.api_key.is_empty() { "未配置" } else { "已配置" },
                    spec.models.keys().cloned().collect::<Vec<_>>().join(", "),
                    current_model
                ));
            }
            _ => self.push_system_message(&format!("Provider {} 不存在或无法读取。", name)),
}
    }

    fn connect_provider_command(&mut self) {
        let parts: Vec<&str> = self.input.split_whitespace().collect();
        let Some(index_str) = parts.get(1) else {
            self.push_system_message("用法: /connect <编号> [api_key]");
            self.input.clear();
            return;
        };
        let index: usize = match index_str.parse() {
            Ok(n) => n,
            Err(_) => {
                self.push_system_message("编号必须是数字。");
                self.input.clear();
                return;
            }
        };

        let (name, base_url) = match index {
            1 => ("ollama", "http://127.0.0.1:11434/v1"),
            2 => ("deepseek", "https://api.deepseek.com"),
            3 => ("mimo", "https://token-plan-cn.xiaomimimo.com/v1"),
            4 => ("longcat", "https://api.longcat.chat/openai/v1"),
            5 => ("openai", "https://api.openai.com/v1"),
            _ => {
                self.push_system_message(&format!("无效编号: {}", index));
                self.input.clear();
                return;
            }
        };

        let api_key = parts.get(2).map(|s| s.to_string()).unwrap_or_default();

        let config = crate::provider_config::ProviderConfig {
            base_url: base_url.to_string(),
            api_key,
            model: String::new(),
        };

match self.provider_store.save_named(name, &config, true) {
            Ok(()) => {
                let models = fetch_models(&config).ok().unwrap_or_default();
                let (final_models, default_model) = if !models.is_empty() {
                    (models.clone(), models[0].clone())
                } else {
                    let fallbacks = fallback_models(name);
                    let default = fallbacks.first().cloned().unwrap_or_default();
                    (fallbacks, default)
                };

                let mut final_config = config;
                final_config.model = default_model.clone();
                if !default_model.is_empty() {
                    let _ = self.provider_store.save_named(name, &final_config, true);
                    let mut spec = self
                        .sacode_store
                        .provider(name)
                        .ok()
                        .flatten()
                        .unwrap_or_else(|| sacode_kernel::model::ProviderSpec {
                            name: name.to_string(),
                            base_url: base_url.to_string(),
                            api_key: String::new(),
                            models: std::collections::BTreeMap::new(),
                        });
                    spec.name = name.to_string();
                    spec.base_url = base_url.to_string();
                    spec.api_key = final_config.api_key.clone();
                    for model in &final_models {
                        spec.models.entry(model.clone()).or_insert_with(|| sacode_kernel::model::ModelRule {
                            name: model.clone(),
                            ..Default::default()
                        });
                    }
                    let _ = self.sacode_store.upsert_provider(name, spec);
                    let _ = self.sacode_store.set_model(name, &default_model);
                }

                self.current_provider = Some(crate::provider_config::NamedProviderConfig {
                    name: name.to_string(),
                    config: final_config,
                });

                let mut msg = format!("Provider {} 已连接。", name);
                if !final_models.is_empty() {
                    msg.push_str("\n可用模型:");
                    for m in &final_models {
                        msg.push_str(&format!("\n  - {}", m));
                    }
                    if !default_model.is_empty() {
                        msg.push_str(&format!("\n默认: {}", default_model));
                    }
                    msg.push_str("\n输入 /models 可切换模型。");
                } else {
                    msg.push_str("\n未能获取模型列表，请确认 API Key 正确后使用 /models 选择模型。");
                }
                self.push_system_message(&msg);
            }
            Err(error) => self.push_system_message(&format!("保存 provider 失败: {}", error)),
        }
        self.input.clear();
    }

    fn confirm_connect_selection(&mut self) {
        let Some((name, base_url, needs_key)) = self.connect_options.get(self.selected_connect_index).cloned() else {
            self.push_system_message("当前没有可选 provider。");
            self.input_mode = InputMode::Chat;
            return;
        };

        if needs_key {
            self.pending_connect_provider = Some((name.clone(), base_url));
            self.input_mode = InputMode::ConnectApiKey;
            self.push_system_message(&format!("请输入 {} 的 API Key (回车确认，Esc 取消)。", name));
        } else {
            self.save_connect_provider(&name, &base_url, String::new());
            self.input_mode = InputMode::Chat;
        }
        self.input.clear();
    }

    fn finish_connect(&mut self) {
        let Some((name, base_url)) = self.pending_connect_provider.clone() else {
            self.push_system_message("当前没有待连接的 provider。");
            self.input_mode = InputMode::Chat;
            return;
        };

        let api_key = self.input.trim().to_string();
        self.save_connect_provider(&name, &base_url, api_key);
        self.pending_connect_provider = None;
        self.input_mode = InputMode::Chat;
        self.input.clear();
    }

    fn save_connect_provider(&mut self, name: &str, base_url: &str, api_key: String) {
        let config = crate::provider_config::ProviderConfig {
            base_url: base_url.to_string(),
            api_key,
            model: String::new(),
        };

        match self.provider_store.save_named(name, &config, true) {
            Ok(()) => {
                let models = fetch_models(&config).ok().unwrap_or_default();
                let (final_models, default_model) = if !models.is_empty() {
                    (models.clone(), models[0].clone())
                } else {
                    let fallbacks = fallback_models(name);
                    let default = fallbacks.first().cloned().unwrap_or_default();
                    (fallbacks, default)
                };

                let mut final_config = config;
                final_config.model = default_model.clone();
                if !default_model.is_empty() {
                    let _ = self.provider_store.save_named(name, &final_config, true);
                    let mut spec = self
                        .sacode_store
                        .provider(name)
                        .ok()
                        .flatten()
                        .unwrap_or_else(|| sacode_kernel::model::ProviderSpec {
                            name: name.to_string(),
                            base_url: base_url.to_string(),
                            api_key: String::new(),
                            models: std::collections::BTreeMap::new(),
                        });
                    spec.name = name.to_string();
                    spec.base_url = base_url.to_string();
                    spec.api_key = final_config.api_key.clone();
                    for model in &final_models {
                        spec.models.entry(model.clone()).or_insert_with(|| sacode_kernel::model::ModelRule {
                            name: model.clone(),
                            ..Default::default()
                        });
                    }
                    let _ = self.sacode_store.upsert_provider(name, spec);
                    let _ = self.sacode_store.set_model(name, &default_model);
                }

                self.current_provider = Some(crate::provider_config::NamedProviderConfig {
                    name: name.to_string(),
                    config: final_config,
                });

                let mut msg = format!("Provider {} 已连接。", name);
                if !final_models.is_empty() {
                    msg.push_str("\n可用模型:");
                    for m in &final_models {
                        msg.push_str(&format!("\n  - {}", m));
                    }
                    if !default_model.is_empty() {
                        msg.push_str(&format!("\n默认: {}", default_model));
                    }
                    msg.push_str("\n输入 /models 可切换模型。");
                } else {
                    msg.push_str("\n未能获取模型列表，请确认 API Key 正确后使用 /models 选择模型。");
                }
                self.push_system_message(&msg);
            }
            Err(error) => self.push_system_message(&format!("保存 provider 失败: {}", error)),
        }
    }

    fn rename_provider_command(&mut self) {
        let parts: Vec<&str> = self.input.split_whitespace().collect();
        if parts.len() != 3 {
            self.push_system_message("用法: /provider-rename <old> <new>");
            self.input.clear();
            return;
        }

        match self.sacode_store.rename_provider(parts[1], parts[2]) {
            Ok(_) => {
                let _ = self.provider_store.rename(parts[1], parts[2]);
                if let Some(current) = &mut self.current_provider {
                    if current.name == parts[1] {
                        current.name = parts[2].to_string();
                    }
                }
                self.push_system_message(&format!("Provider {} 已重命名为 {}", parts[1], parts[2]));
            }
            Err(error) => self.push_system_message(&format!("重命名 provider 失败: {}", error)),
        }
        self.input.clear();
    }

    fn remove_provider_command(&mut self) {
        let parts: Vec<&str> = self.input.split_whitespace().collect();
        if parts.len() != 2 {
            self.push_system_message("用法: /provider-remove <name>");
            self.input.clear();
            return;
        }

        match self.sacode_store.remove_provider(parts[1]) {
            Ok(_) => {
                let _ = self.provider_store.remove(parts[1]);
                self.push_system_message(&format!("Provider {} 已删除。", parts[1]))
            }
            Err(error) => self.push_system_message(&format!("删除 provider 失败: {}", error)),
        }
        self.input.clear();
    }

    fn confirm_model_selection(&mut self) {
        let Some(selected_model) = self.model_options.get(self.selected_model_index).cloned() else {
            self.push_system_message("当前没有可选模型。");
            self.input_mode = InputMode::Chat;
            return;
        };

        let Some(current_provider) = self.current_provider.clone() else {
            self.push_system_message("当前还没有 provider 配置，请先输入 /login。");
            self.input_mode = InputMode::Chat;
            return;
        };

        self.input_mode = InputMode::Chat;
        self.processing = true;
        self.busy_message = format!("正在切换默认模型到 {}...", selected_model);
        self.spawn_save_model_task(current_provider.name, current_provider.config, selected_model);
        self.input.clear();
    }

    fn spawn_login_task(&self, provider_name: String, mut config: ProviderConfig) {
        let sender = self.task_tx.clone();
        let store = self.provider_store.clone();
        let sacode_store = self.sacode_store.clone();
        thread::spawn(move || match fetch_models(&config) {
            Ok(models) => {
                if let Some(first_model) = models.first() {
                    if config.model.is_empty() {
                        config.model = first_model.clone();
                    }
                }
                match store.save_named(&provider_name, &config, true) {
                    Ok(()) => {
                        let mut spec = sacode_store
                            .provider(&provider_name)
                            .ok()
                            .flatten()
                            .unwrap_or_else(|| sacode_kernel::model::ProviderSpec {
                                name: provider_name.clone(),
                                base_url: config.base_url.clone(),
                                api_key: String::new(),
                                models: std::collections::BTreeMap::new(),
                            });
                        spec.name = provider_name.clone();
                        spec.base_url = config.base_url.clone();
                        spec.api_key = config.api_key.clone();
                        for model in &models {
                            spec.models.entry(model.clone()).or_insert_with(|| sacode_kernel::model::ModelRule {
                                name: model.clone(),
                                ..Default::default()
                            });
                        }
                        if let Err(error) = sacode_store.upsert_provider(&provider_name, spec) {
                            let _ = sender.send(AsyncResult::Failed {
                                context: AsyncContext::Login,
                                message: format!("保存 config.json provider 失败: {}", error),
                            });
                            return;
                        }
                        if !config.model.is_empty() {
                            if let Err(error) = sacode_store.set_model(&provider_name, &config.model) {
                                let _ = sender.send(AsyncResult::Failed {
                                    context: AsyncContext::Login,
                                    message: format!("保存 config.json 默认模型失败: {}", error),
                                });
                                return;
                            }
                        }
                        let _ = sender.send(AsyncResult::LoginCompleted { provider_name, config, models });
                    }
                    Err(error) => {
                        let _ = sender.send(AsyncResult::Failed {
                            context: AsyncContext::Login,
                            message: format!("保存 provider 配置失败: {}", error),
                        });
                    }
                }
            }
            Err(error) => {
                let _ = sender.send(AsyncResult::Failed {
                    context: AsyncContext::Login,
                    message: format!("拉取模型列表失败: {}", error),
                });
            }
        });
    }

    fn spawn_load_providers_task(&self) {
        let sender = self.task_tx.clone();
        let sacode_store = self.sacode_store.clone();
        thread::spawn(move || {
            let current_provider = sacode_store
                .current_provider_name()
                .ok()
                .flatten()
                .unwrap_or_default();
            match sacode_store.list_names() {
                Ok(providers) => {
                    let _ = sender.send(AsyncResult::ProvidersLoaded {
                        providers,
                        current_provider,
                    });
                }
                Err(error) => {
                    let _ = sender.send(AsyncResult::Failed {
                        context: AsyncContext::LoadProviders,
                        message: format!("加载 provider 列表失败: {}", error),
                    });
                }
            }
        });
    }

    fn spawn_switch_provider_task(&self, provider_name: String) {
        let sender = self.task_tx.clone();
        let store = self.provider_store.clone();
        let sacode_store = self.sacode_store.clone();
        thread::spawn(move || {
            let config = match sacode_store.load_or_default() {
                Ok(config) => config,
                Err(error) => {
                    let _ = sender.send(AsyncResult::Failed {
                        context: AsyncContext::SaveProvider,
                        message: format!("读取 config.json 失败: {}", error),
                    });
                    return;
                }
            };
            let model_name = config
                .provider
                .get(&provider_name)
                .and_then(|spec| spec.models.keys().next().cloned())
                .unwrap_or_default();
            if let Err(error) = sacode_store.set_model(&provider_name, &model_name) {
                let _ = sender.send(AsyncResult::Failed {
                    context: AsyncContext::SaveProvider,
                    message: format!("切换 provider 失败: {}", error),
                });
                return;
            }
            let _ = store.set_current(&provider_name);
            match store.get(&provider_name) {
                Ok(Some(config)) => {
                    let _ = sender.send(AsyncResult::ProviderSwitched { provider_name, config });
                }
                Ok(None) => {
                    let _ = sender.send(AsyncResult::Failed {
                        context: AsyncContext::SaveProvider,
                        message: "切换 provider 后未找到 legacy 配置。".to_string(),
                    });
                }
                Err(error) => {
                    let _ = sender.send(AsyncResult::Failed {
                        context: AsyncContext::SaveProvider,
                        message: format!("读取 provider 配置失败: {}", error),
                    });
                }
            }
        });
    }

    fn spawn_load_models_task(&self, config: ProviderConfig) {
        let sender = self.task_tx.clone();
        thread::spawn(move || match fetch_models(&config) {
            Ok(models) => {
                let _ = sender.send(AsyncResult::ModelsLoaded {
                    models,
                    current_model: config.model,
                });
            }
            Err(error) => {
                let _ = sender.send(AsyncResult::Failed {
                    context: AsyncContext::LoadModels,
                    message: format!("拉取模型列表失败: {}", error),
                });
            }
        });
    }

    fn spawn_save_model_task(&self, provider_name: String, mut config: ProviderConfig, selected_model: String) {
        let sender = self.task_tx.clone();
        let store = self.provider_store.clone();
        let sacode_store = self.sacode_store.clone();
        thread::spawn(move || {
            config.model = selected_model.clone();
            match store.save_named(&provider_name, &config, true) {
                Ok(()) => {
                    if let Err(error) = sacode_store.set_model(&provider_name, &selected_model) {
                        let _ = sender.send(AsyncResult::Failed {
                            context: AsyncContext::SaveModel,
                            message: format!("保存 config.json 默认模型失败: {}", error),
                        });
                        return;
                    }
                    let _ = sender.send(AsyncResult::ModelSaved { config, selected_model });
                }
                Err(error) => {
                    let _ = sender.send(AsyncResult::Failed {
                        context: AsyncContext::SaveModel,
                        message: format!("保存默认模型失败: {}", error),
                    });
                }
            }
        });
    }

    fn poll_async_results(&mut self) {
        while let Ok(result) = self.task_rx.try_recv() {
            match result {
                AsyncResult::ChatCompleted(response) => {
                    let timestamp = chrono::Local::now().format("%Y-%m-%d %H:%M").to_string();
                    self.messages.push(Message {
                        role: MessageRole::Assistant,
                        content: response,
                        timestamp,
                    });
                    self.processing = false;
                    self.busy_message.clear();
                    self.scroll_to_bottom();
                }
                AsyncResult::LoginCompleted { provider_name, config, models } => {
                    self.current_provider = Some(NamedProviderConfig {
                        name: provider_name.clone(),
                        config: config.clone(),
                    });
                    self.model_options = models.clone();
                    self.selected_model_index = models
                        .iter()
                        .position(|model| model == &config.model)
                        .unwrap_or(0);
                    self.processing = false;
                    self.busy_message.clear();
                    self.push_system_message(&format!(
                        "Provider {} 已保存，已发现 {} 个模型。当前默认模型: {}。输入 /providers 可切换 provider，输入 /models 可重新选择模型。",
                        provider_name,
                        models.len(),
                        config.model
                    ));
                }
                AsyncResult::ProvidersLoaded { providers, current_provider } => {
                    self.processing = false;
                    self.busy_message.clear();
                    if providers.is_empty() {
                        self.push_system_message("当前没有可用 provider，请先输入 /login。");
                        continue;
                    }
                    self.selected_provider_index = providers
                        .iter()
                        .position(|provider| provider == &current_provider)
                        .unwrap_or(0);
                    self.provider_options = providers;
                    self.input_mode = InputMode::ProviderSelect;
                    self.push_system_message("已打开 provider 管理，使用上下方向键选择，Enter 切换，r 重命名，d 删除，Esc 取消。");
                }
                AsyncResult::ProviderSwitched { provider_name, config } => {
                    self.current_provider = Some(NamedProviderConfig {
                        name: provider_name.clone(),
                        config,
                    });
                    self.input_mode = InputMode::Chat;
                    self.processing = false;
                    self.busy_message.clear();
                    self.push_system_message(&format!("当前 provider 已切换为 {}。", provider_name));
                }
                AsyncResult::ModelsLoaded { models, current_model } => {
                    self.processing = false;
                    self.busy_message.clear();
                    if models.is_empty() {
                        self.push_system_message("Provider 返回了空模型列表。");
                        continue;
                    }
                    self.selected_model_index = models
                        .iter()
                        .position(|model| model == &current_model)
                        .unwrap_or(0);
                    self.model_options = models;
                    self.input_mode = InputMode::ModelSelect;
                    self.push_system_message("已打开模型选择，使用上下方向键选择，回车确认，Esc 取消。");
                }
                AsyncResult::ModelSaved { config, selected_model } => {
                    if let Some(current_provider) = &mut self.current_provider {
                        current_provider.config = config;
                    }
                    self.input_mode = InputMode::Chat;
                    self.processing = false;
                    self.busy_message.clear();
                    self.push_system_message(&format!("默认模型已切换为 {}。", selected_model));
                }
                AsyncResult::Failed { context, message } => {
                    self.processing = false;
                    self.busy_message.clear();
                    if matches!(
                        context,
                        AsyncContext::LoadProviders | AsyncContext::SaveProvider | AsyncContext::LoadModels | AsyncContext::SaveModel
                    ) {
                        self.input_mode = InputMode::Chat;
                    }
                    self.push_system_message(&message);
                }
            }
        }
    }

    fn current_model_name(&self) -> String {
        self.current_provider
            .as_ref()
            .map(|provider| format!("{}:{}", provider.name, provider.config.model))
            .filter(|model| !model.is_empty())
            .unwrap_or_else(|| "内置执行".to_string())
    }

    fn cancel_current_mode(&mut self) {
        self.input.clear();
        self.pending_base_url = None;
        self.pending_provider_name = None;
        self.pending_skill_action = None;
        self.pending_mcp_action = None;
        self.pending_checkpoint_action = None;
        if self.input_mode == InputMode::ProviderSelect {
            self.push_system_message("已取消 provider 选择");
        }
        if self.input_mode == InputMode::ProviderRename {
            self.push_system_message("已取消 provider 重命名");
        }
        if self.input_mode == InputMode::ModelSelect {
            self.push_system_message("已取消模型选择");
        }
        if matches!(self.input_mode, InputMode::LoginBaseUrl | InputMode::LoginApiKey) {
            self.push_system_message("已取消登录配置");
        }
        if self.input_mode == InputMode::SkillsSelect {
            self.push_system_message("已取消 skills 选择");
            self.skills_options.clear();
            self.selected_skills_index = 0;
        }
        if self.input_mode == InputMode::McpSelect {
            self.push_system_message("已取消 MCP 选择");
            self.mcp_options.clear();
            self.selected_mcp_index = 0;
        }
        if self.input_mode == InputMode::CheckpointSelect {
            self.push_system_message("已取消检查点选择");
            self.checkpoint_options.clear();
            self.selected_checkpoint_index = 0;
        }
        self.filtered_level1.clear();
        self.filtered_sub_commands.clear();
        self.selected_level1_index = 0;
        self.selected_sub_index = 0;
        self.current_level1 = None;
        self.input_mode = InputMode::Chat;
    }

    fn push_system_message(&mut self, content: &str) {
        let timestamp = chrono::Local::now().format("%Y-%m-%d %H:%M").to_string();
        self.messages.push(Message {
            role: MessageRole::System,
            content: content.to_string(),
            timestamp,
        });
        self.scroll_to_bottom();
    }

    fn push_success_message(&mut self, content: &str) {
        let timestamp = chrono::Local::now().format("%Y-%m-%d %H:%M").to_string();
        self.messages.push(Message {
            role: MessageRole::System,
            content: format!("[成功] {}", content),
            timestamp,
        });
        self.scroll_to_bottom();
    }

    fn push_error_message(&mut self, content: &str) {
        let timestamp = chrono::Local::now().format("%Y-%m-%d %H:%M").to_string();
        self.messages.push(Message {
            role: MessageRole::System,
            content: format!("[错误] {}", content),
            timestamp,
        });
        self.scroll_to_bottom();
    }

    fn scroll_to_bottom(&mut self) {
        self.scroll_offset = self.messages.len().saturating_sub(1);
    }

    fn scroll_up(&mut self) {
        self.scroll_offset = self.scroll_offset.saturating_sub(1);
    }

    fn scroll_down(&mut self) {
        if self.scroll_offset < self.messages.len().saturating_sub(1) {
            self.scroll_offset += 1;
        }
    }

    fn filter_level1_commands(&mut self) {
        let query = self.input.trim_start_matches('/').to_lowercase();
        if query.is_empty() {
            self.filtered_level1 = self.level1_commands.clone();
        } else {
            self.filtered_level1 = self.level1_commands
                .iter()
                .filter(|cmd| {
                    fuzzy_match(&query, &cmd.name.to_lowercase())
                        || fuzzy_match(&query, &cmd.description.to_lowercase())
                })
                .cloned()
                .collect();
        }
        self.selected_level1_index = 0;
    }

    fn filter_sub_commands(&mut self) {
        let query = self.input.split_whitespace().last().unwrap_or("").to_lowercase();
        if let Some(level1) = &self.current_level1 {
            if query.is_empty() {
                self.filtered_sub_commands = level1.sub_commands.clone();
            } else {
                self.filtered_sub_commands = level1.sub_commands
                    .iter()
                    .filter(|sub| {
                        fuzzy_match(&query, &sub.name.to_lowercase())
                            || fuzzy_match(&query, &sub.description.to_lowercase())
                    })
                    .cloned()
                    .collect();
            }
            self.selected_sub_index = 0;
        }
    }

    fn confirm_level1_selection(&mut self) {
        if let Some(cmd) = self.filtered_level1.get(self.selected_level1_index) {
            if cmd.direct_execute {
                self.input = cmd.name.clone();
                self.input_mode = InputMode::Chat;
                self.filtered_level1.clear();
                self.selected_level1_index = 0;
            } else {
                self.current_level1 = Some(cmd.clone());
                self.filtered_sub_commands = cmd.sub_commands.clone();
                self.selected_sub_index = 0;
                self.input = cmd.name.clone() + " ";
                self.input_mode = InputMode::CommandLevel2;
            }
        }
    }

    fn confirm_sub_selection(&mut self) {
        if let (Some(level1), Some(sub)) = (
            &self.current_level1,
            self.filtered_sub_commands.get(self.selected_sub_index),
        ) {
            self.input = format!("{} {}", level1.name, sub.name);
            if sub.needs_input {
                self.input.push(' ');
            }
            self.input_mode = InputMode::Chat;
            self.filtered_sub_commands.clear();
            self.selected_sub_index = 0;
            self.current_level1 = None;
        }
    }

    fn handle_key_event(&mut self, key: KeyEvent) {
        match key.code {
            KeyCode::Char('q') if key.modifiers.contains(crossterm::event::KeyModifiers::CONTROL) => {
                self.should_quit = true;
            }
            KeyCode::Esc => {
                if self.input_mode == InputMode::CommandLevel2 {
                    self.input_mode = InputMode::CommandLevel1;
                    self.filtered_sub_commands.clear();
                    self.selected_sub_index = 0;
                    if let Some(level1) = &self.current_level1 {
                        self.input = level1.name.clone();
                    }
                } else if self.input_mode == InputMode::CommandLevel1 {
                    self.input_mode = InputMode::Chat;
                    self.filtered_level1.clear();
                    self.selected_level1_index = 0;
                    self.current_level1 = None;
                    self.input.clear();
                } else {
                    self.cancel_current_mode();
                }
            }
            KeyCode::Enter => {
                match self.input_mode {
                    InputMode::ConnectSelect => self.confirm_connect_selection(),
                    InputMode::ConnectApiKey => self.finish_connect(),
                    InputMode::CommandLevel1 => self.confirm_level1_selection(),
                    InputMode::CommandLevel2 => self.confirm_sub_selection(),
                    InputMode::SkillsSelect => self.confirm_skills_selection(),
                    InputMode::McpSelect => self.confirm_mcp_selection(),
                    InputMode::CheckpointSelect => self.confirm_checkpoint_selection(),
                    InputMode::ModeSelect => self.confirm_mode_selection(),
                    InputMode::SkillInput => self.finish_skill_input(),
                    InputMode::McpInput => self.finish_mcp_input(),
                    InputMode::CheckpointInput => self.finish_checkpoint_input(),
                    _ => self.send_message(),
                }
            }
            KeyCode::Char('r') if self.input_mode == InputMode::ProviderSelect => {
                self.start_provider_rename();
            }
            KeyCode::Char('d') if self.input_mode == InputMode::ProviderSelect => {
                self.remove_selected_provider();
            }
            KeyCode::Up if self.input_mode == InputMode::ProviderSelect => {
                self.selected_provider_index = self.selected_provider_index.saturating_sub(1);
            }
            KeyCode::Down if self.input_mode == InputMode::ProviderSelect => {
                if self.selected_provider_index + 1 < self.provider_options.len() {
                    self.selected_provider_index += 1;
                }
            }
            KeyCode::Up if self.input_mode == InputMode::ModelSelect => {
                self.selected_model_index = self.selected_model_index.saturating_sub(1);
            }
            KeyCode::Down if self.input_mode == InputMode::ModelSelect => {
                if self.selected_model_index + 1 < self.model_options.len() {
                    self.selected_model_index += 1;
                }
            }
            KeyCode::Up if self.input_mode == InputMode::ConnectSelect => {
                self.selected_connect_index = self.selected_connect_index.saturating_sub(1);
            }
            KeyCode::Down if self.input_mode == InputMode::ConnectSelect => {
                if self.selected_connect_index + 1 < self.connect_options.len() {
                    self.selected_connect_index += 1;
                }
            }
            KeyCode::Up if self.input_mode == InputMode::CommandLevel1 => {
                self.selected_level1_index = self.selected_level1_index.saturating_sub(1);
            }
            KeyCode::Down if self.input_mode == InputMode::CommandLevel1 => {
                if self.selected_level1_index + 1 < self.filtered_level1.len() {
                    self.selected_level1_index += 1;
                }
            }
            KeyCode::Up if self.input_mode == InputMode::CommandLevel2 => {
                self.selected_sub_index = self.selected_sub_index.saturating_sub(1);
            }
            KeyCode::Down if self.input_mode == InputMode::CommandLevel2 => {
                if self.selected_sub_index + 1 < self.filtered_sub_commands.len() {
                    self.selected_sub_index += 1;
                }
            }
            KeyCode::Up if self.input_mode == InputMode::SkillsSelect => {
                self.selected_skills_index = self.selected_skills_index.saturating_sub(1);
            }
            KeyCode::Down if self.input_mode == InputMode::SkillsSelect => {
                if self.selected_skills_index + 1 < self.skills_options.len() {
                    self.selected_skills_index += 1;
                }
            }
            KeyCode::Up if self.input_mode == InputMode::McpSelect => {
                self.selected_mcp_index = self.selected_mcp_index.saturating_sub(1);
            }
            KeyCode::Down if self.input_mode == InputMode::McpSelect => {
                if self.selected_mcp_index + 1 < self.mcp_options.len() {
                    self.selected_mcp_index += 1;
                }
            }
            KeyCode::Up if self.input_mode == InputMode::CheckpointSelect => {
                self.selected_checkpoint_index = self.selected_checkpoint_index.saturating_sub(1);
            }
            KeyCode::Down if self.input_mode == InputMode::CheckpointSelect => {
                if self.selected_checkpoint_index + 1 < self.checkpoint_options.len() {
                    self.selected_checkpoint_index += 1;
                }
            }
            KeyCode::Up if self.input_mode == InputMode::ModeSelect => {
                self.selected_mode_index = self.selected_mode_index.saturating_sub(1);
            }
            KeyCode::Down if self.input_mode == InputMode::ModeSelect => {
                if self.selected_mode_index + 1 < self.mode_options.len() {
                    self.selected_mode_index += 1;
                }
            }
            KeyCode::Char('/') if self.input_mode == InputMode::Chat && self.input.is_empty() => {
                self.input_mode = InputMode::CommandLevel1;
                self.filtered_level1 = self.level1_commands.clone();
                self.selected_level1_index = 0;
                self.input.push('/');
            }
            KeyCode::Char(c) if !key.modifiers.contains(crossterm::event::KeyModifiers::CONTROL) => {
                if self.input_mode == InputMode::CommandLevel1 {
                    self.input.push(c);
                    self.filter_level1_commands();
                } else if self.input_mode == InputMode::CommandLevel2 {
                    self.input.push(c);
                    self.filter_sub_commands();
                } else {
                    self.input.push(c);
                }
            }
            KeyCode::Backspace if !matches!(self.input_mode, InputMode::ProviderSelect | InputMode::ModelSelect | InputMode::ConnectSelect | InputMode::SkillsSelect | InputMode::McpSelect | InputMode::CheckpointSelect) => {
                if self.input_mode == InputMode::CommandLevel1 {
                    self.input.pop();
                    if self.input.is_empty() || !self.input.starts_with('/') {
                        self.input_mode = InputMode::Chat;
                        self.filtered_level1.clear();
                        self.selected_level1_index = 0;
                    } else {
                        self.filter_level1_commands();
                    }
                } else if self.input_mode == InputMode::CommandLevel2 {
                    self.input.pop();
                    if let Some(level1) = &self.current_level1 {
                        if self.input == level1.name || !self.input.starts_with(&level1.name) {
                            self.input_mode = InputMode::CommandLevel1;
                            self.filtered_sub_commands.clear();
                            self.selected_sub_index = 0;
                            self.filter_level1_commands();
                        } else {
                            self.filter_sub_commands();
                        }
                    }
                } else {
                    self.input.pop();
                }
            }
            KeyCode::Up => self.scroll_up(),
            KeyCode::Down => self.scroll_down(),
            KeyCode::PageUp => {
                for _ in 0..5 {
                    self.scroll_up();
                }
            }
            KeyCode::PageDown => {
                for _ in 0..5 {
                    self.scroll_down();
                }
            }
            _ => {}
        }
    }
}

pub fn run_tui() -> Result<()> {
    enable_raw_mode()?;
    let mut stdout = io::stdout();
    execute!(stdout, EnterAlternateScreen, EnableMouseCapture)?;
    let backend = CrosstermBackend::new(stdout);
    let mut terminal = Terminal::new(backend)?;

    let mut app = App::new();
    let res = run_app(&mut terminal, &mut app);

    disable_raw_mode()?;
    execute!(
        terminal.backend_mut(),
        LeaveAlternateScreen,
        DisableMouseCapture
    )?;
    terminal.show_cursor()?;

    res
}

fn run_app(terminal: &mut Terminal<CrosstermBackend<io::Stdout>>, app: &mut App) -> Result<()> {
    while !app.should_quit {
        app.poll_async_results();
        terminal.draw(|frame| ui(frame, app))?;

        if event::poll(std::time::Duration::from_millis(100))? {
            if let Event::Key(key) = event::read()? {
                if key.kind == KeyEventKind::Press || key.kind == KeyEventKind::Repeat {
                    app.handle_key_event(key);
                }
            }
        }
    }
    Ok(())
}

fn ui(frame: &mut Frame, app: &App) {
    let chunks = Layout::default()
        .direction(Direction::Vertical)
        .margin(0)
        .constraints([
            Constraint::Min(5),
            Constraint::Length(3),
        ])
        .split(frame.area());

    let messages_block = Block::default()
        .borders(Borders::ALL)
        .border_style(Style::default().fg(Color::Rgb(100, 100, 120)))
        .title(Span::styled(
            format!(" SaCode [{}] ", app.current_model_name()),
            Style::default().fg(Color::Rgb(80, 200, 120)).add_modifier(Modifier::BOLD),
        ))
        .title_style(Style::default());

    let inner_area = messages_block.inner(chunks[0]);
    frame.render_widget(messages_block, chunks[0]);

    let mut lines: Vec<Line> = Vec::new();
    let mut current_y = 0;
    let max_y = inner_area.height as usize;

    for msg in app.messages.iter().skip(app.scroll_offset) {
        if current_y >= max_y {
            break;
        }

        let role_style = match msg.role {
            MessageRole::User => Style::default().fg(Color::Rgb(100, 149, 237)),
            MessageRole::Assistant => Style::default().fg(Color::Rgb(80, 200, 120)),
            MessageRole::System => Style::default().fg(Color::Rgb(150, 150, 150)),
        };

        let role_label = match msg.role {
            MessageRole::User => "你",
            MessageRole::Assistant => "SaCode",
            MessageRole::System => "系统",
        };

        lines.push(Line::from(vec![
            Span::styled(&msg.timestamp, Style::default().fg(Color::Rgb(120, 120, 140))),
            Span::raw(" "),
            Span::styled(role_label, role_style.add_modifier(Modifier::BOLD)),
        ]));

        current_y += 1;

        for content_line in msg.content.lines() {
            if current_y >= max_y {
                break;
            }
            lines.push(Line::from(Span::styled(
                content_line,
                Style::default().fg(Color::Rgb(200, 200, 210)),
            )));
            current_y += 1;
        }

        if current_y < max_y {
            lines.push(Line::from(""));
            current_y += 1;
        }
    }

    let messages_paragraph = Paragraph::new(lines);
    frame.render_widget(messages_paragraph, inner_area);

    if app.messages.len() > max_y {
        let scrollbar = Scrollbar::default()
            .orientation(ScrollbarOrientation::VerticalRight)
            .begin_symbol(None)
            .end_symbol(None)
            .track_style(Style::default().fg(Color::Rgb(60, 60, 80)))
            .thumb_style(Style::default().fg(Color::Rgb(100, 100, 120)));
        
        let mut scrollbar_state = ScrollbarState::new(app.messages.len())
            .position(app.scroll_offset);
        
        frame.render_stateful_widget(scrollbar, inner_area, &mut scrollbar_state);
    }

    let input_text = if app.processing {
        Span::styled(&app.busy_message, Style::default().fg(Color::Rgb(200, 200, 100)))
    } else if app.input_mode == InputMode::ProviderSelect {
        Span::styled("使用上下方向键选择 provider，Enter 切换，r 重命名，d 删除", Style::default().fg(Color::Rgb(120, 170, 220)))
    } else if app.input_mode == InputMode::ProviderRename {
        Span::styled(&app.input, Style::default().fg(Color::Rgb(200, 200, 210)))
    } else if app.input_mode == InputMode::ModelSelect {
        Span::styled("使用上下方向键选择模型，按 Enter 确认", Style::default().fg(Color::Rgb(120, 170, 220)))
    } else if matches!(app.input_mode, InputMode::CommandLevel1 | InputMode::CommandLevel2) {
        Span::styled(&app.input, Style::default().fg(Color::Rgb(200, 200, 210)))
    } else if app.input.is_empty() {
        let placeholder = match app.input_mode {
            InputMode::Chat => "输入你的编程任务，或输入 / 显示命令列表...",
            InputMode::LoginBaseUrl => "输入 provider 名称和 Base URL...",
            InputMode::LoginApiKey => "输入 API Key...",
            InputMode::ProviderSelect => "使用方向键选择 provider...",
            InputMode::ProviderRename => "输入新的 provider 名称...",
            InputMode::ModelSelect => "使用方向键选择模型...",
            InputMode::ConnectSelect => "使用方向键选择预设 provider...",
            InputMode::ConnectApiKey => "输入 API Key...",
            InputMode::CommandLevel1 => "输入命令名称进行搜索...",
            InputMode::CommandLevel2 => "输入子命令名称进行搜索...",
            InputMode::SkillsSelect => "使用方向键选择 Skill...",
            InputMode::McpSelect => "使用方向键选择 MCP 服务...",
            InputMode::CheckpointSelect => "使用方向键选择检查点...",
            InputMode::ModeSelect => "使用方向键选择执行模式...",
            InputMode::SkillInput => "输入 Skill 参数...",
            InputMode::McpInput => "输入 MCP 参数...",
            InputMode::CheckpointInput => "输入检查点名称...",
        };
        Span::styled(placeholder, Style::default().fg(Color::Rgb(100, 100, 120)))
    } else {
        Span::styled(&app.input, Style::default().fg(Color::Rgb(200, 200, 210)))
    };

    let input_block = Block::default()
        .borders(Borders::ALL)
        .border_style(Style::default().fg(Color::Rgb(100, 100, 120)));

    let input_paragraph = Paragraph::new(Line::from(input_text))
        .block(input_block);
    frame.render_widget(input_paragraph, chunks[1]);

    if !app.processing && !app.input.is_empty() && !matches!(app.input_mode, InputMode::ProviderSelect | InputMode::ModelSelect | InputMode::ConnectSelect | InputMode::CommandLevel1 | InputMode::CommandLevel2 | InputMode::SkillsSelect | InputMode::McpSelect | InputMode::CheckpointSelect) {
        let cursor_x = chunks[1].x + 1 + app.input.len() as u16;
        let cursor_y = chunks[1].y + 1;
        frame.set_cursor_position((cursor_x, cursor_y));
    }

    if matches!(app.input_mode, InputMode::ProviderSelect | InputMode::ModelSelect) {
        render_selector(frame, app);
    }

    if app.input_mode == InputMode::ConnectSelect {
        render_connect_selector(frame, app);
    }

    if matches!(app.input_mode, InputMode::CommandLevel1 | InputMode::CommandLevel2) {
        render_command_selector(frame, app, chunks[1]);
    }

    if app.input_mode == InputMode::SkillsSelect {
        render_skills_selector(frame, app);
    }

    if app.input_mode == InputMode::McpSelect {
        render_mcp_selector(frame, app);
    }

    if app.input_mode == InputMode::CheckpointSelect {
        render_checkpoint_selector(frame, app);
    }

    if app.input_mode == InputMode::ModeSelect {
        render_mode_selector(frame, app);
    }
}

fn render_selector(frame: &mut Frame, app: &App) {
    let area = centered_rect(frame.area(), 70, 50);
    let (title, options, selected_index) = match app.input_mode {
        InputMode::ProviderSelect => ("管理 Provider", &app.provider_options, app.selected_provider_index),
        _ => ("选择模型", &app.model_options, app.selected_model_index),
    };
    let block = Block::default()
        .title(title)
        .borders(Borders::ALL)
        .border_style(Style::default().fg(Color::Rgb(120, 170, 220)));
    let inner = block.inner(area);
    frame.render_widget(block, area);

    let content_areas = if app.input_mode == InputMode::ProviderSelect {
        Layout::default()
            .direction(Direction::Horizontal)
            .constraints([Constraint::Percentage(52), Constraint::Percentage(48)])
            .split(inner)
    } else {
        vec![inner].into()
    };

    let list_area = content_areas[0];

    let start = selected_index.saturating_sub(MODELS_HINT_LIMIT / 2);
    let end = (start + MODELS_HINT_LIMIT).min(options.len());
    let lines: Vec<Line> = options[start..end]
        .iter()
        .enumerate()
        .map(|(offset, option)| {
            let index = start + offset;
            let is_selected = index == selected_index;
            let prefix = if is_selected { "> " } else { "  " };
            let style = if is_selected {
                Style::default().fg(Color::Rgb(120, 170, 220)).add_modifier(Modifier::BOLD)
            } else {
                Style::default().fg(Color::Rgb(200, 200, 210))
            };
            Line::from(Span::styled(format!("{}{}", prefix, option), style))
        })
        .collect();

    frame.render_widget(Paragraph::new(lines), list_area);

    if app.input_mode == InputMode::ProviderSelect && content_areas.len() > 1 {
        render_provider_details(frame, app, content_areas[1]);
    }
}

fn render_connect_selector(frame: &mut Frame, app: &App) {
    let area = centered_rect(frame.area(), 70, 50);
    let block = Block::default()
        .title("快速接入 Provider")
        .borders(Borders::ALL)
        .border_style(Style::default().fg(Color::Rgb(120, 170, 220)));
    let inner = block.inner(area);
    frame.render_widget(block, area);

    let start = app.selected_connect_index.saturating_sub(MODELS_HINT_LIMIT / 2);
    let end = (start + MODELS_HINT_LIMIT).min(app.connect_options.len());
    let lines: Vec<Line> = app.connect_options[start..end]
        .iter()
        .enumerate()
        .map(|(offset, (name, base_url, needs_key))| {
            let label = if *needs_key {
                format!("{} - {} (需要 API Key)", name, base_url)
            } else {
                format!("{} - {} (本地)", name, base_url)
            };
            let is_selected = offset + start == app.selected_connect_index;
            let style = if is_selected {
                Style::default().fg(Color::Rgb(255, 255, 255)).bg(Color::Rgb(60, 120, 180))
            } else {
                Style::default().fg(Color::Rgb(180, 180, 190))
            };
            Line::styled(label, style)
        })
        .collect();

    let list = Paragraph::new(lines).block(Block::default());
    frame.render_widget(list, inner);
}

fn render_provider_details(frame: &mut Frame, app: &App, area: ratatui::layout::Rect) {
    let block = Block::default()
        .title("当前预览")
        .borders(Borders::LEFT)
        .border_style(Style::default().fg(Color::Rgb(80, 90, 110)));
    let inner = block.inner(area);
    frame.render_widget(block, area);

    let details = app
        .provider_options
        .get(app.selected_provider_index)
        .and_then(|provider_name| app.sacode_store.provider(provider_name).ok().flatten().map(|spec| (provider_name.clone(), spec)))
        .map(|(provider_name, spec)| {
            let current_model = app
                .sacode_store
                .load_or_default()
                .ok()
                .and_then(|config| config.resolve_model(&config.model))
                .and_then(|(current_provider, current_model)| if current_provider == provider_name { Some(current_model) } else { None })
                .unwrap_or_else(|| spec.models.keys().next().cloned().unwrap_or_default());
            let api_key_status = if spec.api_key.trim().is_empty() {
                "未配置"
            } else {
                "已配置"
            };
            vec![
                Line::from(Span::styled("Base URL", Style::default().fg(Color::Rgb(120, 170, 220)).add_modifier(Modifier::BOLD))),
                Line::from(Span::styled(spec.base_url, Style::default().fg(Color::Rgb(200, 200, 210)))),
                Line::from(""),
                Line::from(Span::styled("Model", Style::default().fg(Color::Rgb(120, 170, 220)).add_modifier(Modifier::BOLD))),
                Line::from(Span::styled(current_model, Style::default().fg(Color::Rgb(200, 200, 210)))),
                Line::from(""),
                Line::from(Span::styled("API Key", Style::default().fg(Color::Rgb(120, 170, 220)).add_modifier(Modifier::BOLD))),
                Line::from(Span::styled(api_key_status, Style::default().fg(Color::Rgb(200, 200, 210)))),
            ]
        })
        .unwrap_or_else(|| {
            vec![Line::from(Span::styled(
                "未找到 provider 详情",
                Style::default().fg(Color::Rgb(160, 160, 170)),
            ))]
        });

    frame.render_widget(Paragraph::new(details), inner);
}

fn centered_rect(area: ratatui::layout::Rect, width_percent: u16, height_percent: u16) -> ratatui::layout::Rect {
    let vertical = Layout::default()
        .direction(Direction::Vertical)
        .constraints([
            Constraint::Percentage((100 - height_percent) / 2),
            Constraint::Percentage(height_percent),
            Constraint::Percentage((100 - height_percent) / 2),
        ])
        .split(area);

    Layout::default()
        .direction(Direction::Horizontal)
        .constraints([
            Constraint::Percentage((100 - width_percent) / 2),
            Constraint::Percentage(width_percent),
            Constraint::Percentage((100 - width_percent) / 2),
        ])
        .split(vertical[1])[1]
}

fn render_command_selector(frame: &mut Frame, app: &App, input_area: ratatui::layout::Rect) {
    match app.input_mode {
        InputMode::CommandLevel1 => {
            if app.filtered_level1.is_empty() {
                return;
            }
            render_level1_selector(frame, app, input_area);
        }
        InputMode::CommandLevel2 => {
            if app.filtered_sub_commands.is_empty() {
                return;
            }
            render_level2_selector(frame, app, input_area);
        }
        _ => {}
    }
}

fn render_level1_selector(frame: &mut Frame, app: &App, input_area: ratatui::layout::Rect) {
    let max_height = 12u16;
    let popup_height = max_height.min(app.filtered_level1.len() as u16 + 2);
    
    let popup_area = ratatui::layout::Rect {
        x: input_area.x,
        y: input_area.y.saturating_sub(popup_height),
        width: input_area.width,
        height: popup_height,
    };

    let block = Block::default()
        .title(" 命令列表 ")
        .borders(Borders::ALL)
        .border_style(Style::default().fg(Color::Rgb(120, 170, 220)));
    let inner = block.inner(popup_area);
    frame.render_widget(block, popup_area);

    let visible_count = inner.height as usize;
    let start = app.selected_level1_index.saturating_sub(visible_count / 2);
    let end = (start + visible_count).min(app.filtered_level1.len());

    let lines: Vec<Line> = app.filtered_level1[start..end]
        .iter()
        .enumerate()
        .map(|(offset, cmd)| {
            let index = start + offset;
            let is_selected = index == app.selected_level1_index;
            let prefix = if is_selected { "> " } else { "  " };
            let has_subs = if cmd.sub_commands.is_empty() { "" } else { " +" };
            let style = if is_selected {
                Style::default().fg(Color::Rgb(255, 255, 255)).bg(Color::Rgb(60, 120, 180))
            } else {
                Style::default().fg(Color::Rgb(200, 200, 210))
            };
            Line::styled(format!("{}{}{} - {}", prefix, cmd.name, has_subs, cmd.description), style)
        })
        .collect();

    frame.render_widget(Paragraph::new(lines), inner);
}

fn render_level2_selector(frame: &mut Frame, app: &App, input_area: ratatui::layout::Rect) {
    let max_height = 8u16;
    let popup_height = max_height.min(app.filtered_sub_commands.len() as u16 + 2);
    
    let popup_area = ratatui::layout::Rect {
        x: input_area.x,
        y: input_area.y.saturating_sub(popup_height),
        width: input_area.width,
        height: popup_height,
    };

    let title = app.current_level1
        .as_ref()
        .map(|cmd| format!(" {} 子命令 ", cmd.name))
        .unwrap_or_else(|| " 子命令 ".to_string());

    let block = Block::default()
        .title(title)
        .borders(Borders::ALL)
        .border_style(Style::default().fg(Color::Rgb(80, 160, 200)));
    let inner = block.inner(popup_area);
    frame.render_widget(block, popup_area);

    let visible_count = inner.height as usize;
    let start = app.selected_sub_index.saturating_sub(visible_count / 2);
    let end = (start + visible_count).min(app.filtered_sub_commands.len());

    let lines: Vec<Line> = app.filtered_sub_commands[start..end]
        .iter()
        .enumerate()
        .map(|(offset, sub)| {
            let index = start + offset;
            let is_selected = index == app.selected_sub_index;
            let prefix = if is_selected { "> " } else { "  " };
            let input_hint = if sub.needs_input { " ..." } else { "" };
            let style = if is_selected {
                Style::default().fg(Color::Rgb(255, 255, 255)).bg(Color::Rgb(60, 120, 180))
            } else {
                Style::default().fg(Color::Rgb(200, 200, 210))
            };
            Line::styled(format!("{}{}{} - {}", prefix, sub.name, input_hint, sub.description), style)
        })
        .collect();

    frame.render_widget(Paragraph::new(lines), inner);
}

fn render_skills_selector(frame: &mut Frame, app: &App) {
    let area = centered_rect(frame.area(), 60, 40);
    let block = Block::default()
        .title(" Skills 列表 ")
        .borders(Borders::ALL)
        .border_style(Style::default().fg(Color::Rgb(80, 160, 200)));
    let inner = block.inner(area);
    frame.render_widget(block, area);

    let visible_count = inner.height as usize;
    let start = app.selected_skills_index.saturating_sub(visible_count / 2);
    let end = (start + visible_count).min(app.skills_options.len());

    let action = app.pending_skill_action.as_deref().unwrap_or("show");
    let hint = match action {
        "show" => "查看详情",
        "run" => "运行",
        "remove" => "删除",
        _ => "选择",
    };

    let lines: Vec<Line> = app.skills_options[start..end]
        .iter()
        .enumerate()
        .map(|(offset, (name, desc))| {
            let index = start + offset;
            let is_selected = index == app.selected_skills_index;
            let prefix = if is_selected { "> " } else { "  " };
            let style = if is_selected {
                Style::default().fg(Color::Rgb(255, 255, 255)).bg(Color::Rgb(60, 120, 180))
            } else {
                Style::default().fg(Color::Rgb(200, 200, 210))
            };
            Line::styled(format!("{}{} - {}", prefix, name, desc), style)
        })
        .collect();

    frame.render_widget(Paragraph::new(lines), inner);
    
    let hint_line = Line::styled(
        format!("Enter: {} | Esc: 取消", hint),
        Style::default().fg(Color::Rgb(120, 120, 140)),
    );
    let hint_area = ratatui::layout::Rect {
        x: area.x,
        y: area.y + area.height,
        width: area.width,
        height: 1,
    };
    frame.render_widget(Paragraph::new(hint_line), hint_area);
}

fn render_mcp_selector(frame: &mut Frame, app: &App) {
    let area = centered_rect(frame.area(), 60, 40);
    let block = Block::default()
        .title(" MCP 服务列表 ")
        .borders(Borders::ALL)
        .border_style(Style::default().fg(Color::Rgb(80, 160, 200)));
    let inner = block.inner(area);
    frame.render_widget(block, area);

    let visible_count = inner.height as usize;
    let start = app.selected_mcp_index.saturating_sub(visible_count / 2);
    let end = (start + visible_count).min(app.mcp_options.len());

    let lines: Vec<Line> = app.mcp_options[start..end]
        .iter()
        .enumerate()
        .map(|(offset, (name, url, enabled))| {
            let index = start + offset;
            let is_selected = index == app.selected_mcp_index;
            let prefix = if is_selected { "> " } else { "  " };
            let status = if *enabled { "[on]" } else { "[off]" };
            let style = if is_selected {
                Style::default().fg(Color::Rgb(255, 255, 255)).bg(Color::Rgb(60, 120, 180))
            } else {
                Style::default().fg(Color::Rgb(200, 200, 210))
            };
            Line::styled(format!("{}{} {} {}", prefix, name, status, url), style)
        })
        .collect();

    frame.render_widget(Paragraph::new(lines), inner);
}

fn render_checkpoint_selector(frame: &mut Frame, app: &App) {
    let area = centered_rect(frame.area(), 50, 35);
    let block = Block::default()
        .title(" 检查点列表 ")
        .borders(Borders::ALL)
        .border_style(Style::default().fg(Color::Rgb(100, 180, 160)));
    let inner = block.inner(area);
    frame.render_widget(block, area);

    let visible_count = inner.height as usize;
    let start = app.selected_checkpoint_index.saturating_sub(visible_count / 2);
    let end = (start + visible_count).min(app.checkpoint_options.len());

    let action = app.pending_checkpoint_action.as_deref().unwrap_or("show");
    let _hint = match action {
        "restore" => "恢复",
        "delete" => "删除",
        _ => "选择",
    };

    let lines: Vec<Line> = app.checkpoint_options[start..end]
        .iter()
        .enumerate()
        .map(|(offset, name)| {
            let index = start + offset;
            let is_selected = index == app.selected_checkpoint_index;
            let prefix = if is_selected { "> " } else { "  " };
            let style = if is_selected {
                Style::default().fg(Color::Rgb(255, 255, 255)).bg(Color::Rgb(60, 120, 180))
            } else {
                Style::default().fg(Color::Rgb(200, 200, 210))
            };
            Line::styled(format!("{}{}", prefix, name), style)
        })
        .collect();

    frame.render_widget(Paragraph::new(lines), inner);
}

fn render_mode_selector(frame: &mut Frame, app: &App) {
    let area = centered_rect(frame.area(), 40, 30);
    let block = Block::default()
        .title(" 执行模式 ")
        .borders(Borders::ALL)
        .border_style(Style::default().fg(Color::Rgb(180, 120, 200)));
    let inner = block.inner(area);
    frame.render_widget(block, area);

    let mode_desc = [
        ("plan", "Plan - 规划模式\nAI 将先规划步骤，再逐步执行"),
        ("build", "Build - 构建模式\nAI 将直接执行任务"),
        ("yolo", "Yolo - 自动执行模式\nAI 将自动执行，减少确认步骤"),
    ];

    let current_index = match app.execution_mode {
        ExecutionMode::Plan => 0,
        ExecutionMode::Build => 1,
        ExecutionMode::Yolo => 2,
    };

    let lines: Vec<Line> = app.mode_options
        .iter()
        .enumerate()
        .map(|(index, name)| {
            let is_selected = index == app.selected_mode_index;
            let is_current = index == current_index;
            let prefix = if is_selected { "> " } else { "  " };
            let current_mark = if is_current { " [当前]" } else { "" };
            let desc = mode_desc.iter().find(|(n, _)| *n == *name).map(|(_, d)| *d).unwrap_or("");
            let style = if is_selected {
                Style::default().fg(Color::Rgb(255, 255, 255)).bg(Color::Rgb(60, 120, 180))
            } else if is_current {
                Style::default().fg(Color::Rgb(180, 120, 200)).add_modifier(Modifier::BOLD)
            } else {
                Style::default().fg(Color::Rgb(200, 200, 210))
            };
            Line::styled(format!("{}{}{}\n{}", prefix, name, current_mark, desc), style)
        })
        .collect();

    frame.render_widget(Paragraph::new(lines), inner);
}
