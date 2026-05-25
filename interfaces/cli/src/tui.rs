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
    task_tx: Sender<AsyncResult>,
    task_rx: Receiver<AsyncResult>,
    busy_message: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
enum InputMode {
    Chat,
    LoginBaseUrl,
    LoginApiKey,
    ProviderSelect,
    ProviderRename,
    ModelSelect,
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
        
        Self {
            messages: vec![
                Message {
                    role: MessageRole::System,
                    content: "SaCode - AI Coding Assistant\n\n输入你的编程任务，我会帮你完成。\n按 Ctrl+Q 退出，按 Esc 清空输入.".to_string(),
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
            task_tx,
            task_rx,
            busy_message: String::new(),
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
        thread::spawn(move || {
            let response = App::execute_user_message_in_background(&workdir, &user_input);
            let _ = sender.send(AsyncResult::ChatCompleted(response));
        });
    }

    fn execute_user_message_in_background(workdir: &std::path::Path, user_input: &str) -> String {
        let runtime = match tokio::runtime::Builder::new_current_thread().enable_all().build() {
            Ok(runtime) => runtime,
            Err(error) => return format!("后台运行时初始化失败: {}", error),
        };
        let _ = workdir;
        match runtime.block_on(run_task(user_input, ExecutionMode::Build, crate::cmd::ApprovalPolicy::AutoDeny, 1)) {
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
        if self.input == "/skills" {
            self.show_skills_command();
            self.input.clear();
            return true;
        }

        if self.input.starts_with("/skill ") {
            self.skill_command();
            return true;
        }

        if self.input == "/mcp" {
            self.show_mcp_command();
            self.input.clear();
            return true;
        }

        if self.input.starts_with("/mcp-show ") {
            self.show_single_mcp_command();
            return true;
        }

        if self.input.starts_with("/mcp-remove ") {
            self.remove_mcp_command();
            return true;
        }

        if self.input == "/connect" {
            self.push_system_message(
                "快速接入预设 Provider:\n\n\
                1. Ollama (本地)\n   URL: http://127.0.0.1:11434/v1\n\n\
                2. DeepSeek\n   URL: https://api.deepseek.com/v1\n\n\
                3. Xiaomi MiMo (Token Plan)\n   URL: https://token-plan-cn.xiaomimimo.com/v1\n\n\
                4. LongCat\n   URL: https://api.longcat.chat/openai\n\n\
                5. OpenAI\n   URL: https://api.openai.com/v1\n\n\
                输入 /connect <编号> <api_key> 即可接入。\n\
                例如: /connect 3 tp-xxxx\n\
                例如: /connect 4 ak-xxxx\n\
                或者: /connect 1 (ollama 不需要 key)\n\
                接入后会自动拉取可用模型，用 /models 切换。"
            );
            self.input.clear();
            return true;
        }

        if self.input.starts_with("/connect ") {
            self.connect_provider_command();
            return true;
        }

        false
    }

    fn show_skills_command(&mut self) {
        let registry = SkillRegistry::new(std::path::Path::new("."));
        match registry.list() {
            Ok(skills) if skills.is_empty() => self.push_system_message("当前没有可用 skills。"),
            Ok(skills) => {
                let summary = skills
                    .into_iter()
                    .map(|skill| format!("- {}: {} ({})", skill.name, skill.description, skill.path.display()))
                    .collect::<Vec<_>>()
                    .join("\n");
                self.push_system_message(&format!("可用 skills:\n{}", summary));
            }
            Err(error) => self.push_system_message(&format!("读取 skills 失败: {}", error)),
        }
    }

    fn skill_command(&mut self) {
        let parts: Vec<&str> = self.input.split_whitespace().collect();
        let registry = SkillRegistry::new(std::path::Path::new("."));
        match parts.get(1).copied() {
            Some("show") => {
                let Some(name) = parts.get(2) else {
                    self.push_system_message("用法: /skill show <name>");
                    self.input.clear();
                    return;
                };
                match registry.get(name) {
                    Ok(skill) => self.push_system_message(&format!("Skill {}\n{}\n\n{}", skill.name, skill.description, skill.prompt)),
                    Err(error) => self.push_system_message(&format!("读取 skill 失败: {}", error)),
                }
            }
            Some("run") => {
                let Some(name) = parts.get(2) else {
                    self.push_system_message("用法: /skill run <name> [args...]");
                    self.input.clear();
                    return;
                };
                match registry.render_prompt(name, &parts[3..].join(" "), std::path::Path::new(".")) {
                    Ok(rendered) => self.push_system_message(&rendered),
                    Err(error) => self.push_system_message(&format!("运行 skill 失败: {}", error)),
                }
            }
            Some("add") => {
                if parts.len() < 5 {
                    self.push_system_message("用法: /skill add <name> <description> <prompt>");
                    self.input.clear();
                    return;
                }
                match registry.save_project_skill(parts[2], parts[3], &parts[4..].join(" ")) {
                    Ok(path) => self.push_system_message(&format!("项目 skill 已保存到 {}", path.display())),
                    Err(error) => self.push_system_message(&format!("保存 skill 失败: {}", error)),
                }
            }
            Some("remove") => {
                let Some(name) = parts.get(2) else {
                    self.push_system_message("用法: /skill remove <name>");
                    self.input.clear();
                    return;
                };
                match registry.remove_project_skill(name) {
                    Ok(()) => self.push_system_message(&format!("项目 skill {} 已删除。", name)),
                    Err(error) => self.push_system_message(&format!("删除 skill 失败: {}", error)),
                }
            }
            _ => self.push_system_message("可用命令: /skill show|run|add|remove ..."),
        }
        self.input.clear();
    }

    fn show_mcp_command(&mut self) {
        let store = McpConfigStore::new(std::path::Path::new("."));
        match store.load() {
            Ok(config) if config.mcp.is_empty() => self.push_system_message("当前没有配置 MCP 服务。"),
            Ok(config) => {
                let summary = config
                    .mcp
                    .into_iter()
                    .map(|(name, server)| format!("- {}: {} {}", name, if server.enabled { "enabled" } else { "disabled" }, server.url))
                    .collect::<Vec<_>>()
                    .join("\n");
                self.push_system_message(&format!("MCP 服务:\n{}", summary));
            }
            Err(error) => self.push_system_message(&format!("读取 MCP 配置失败: {}", error)),
        }
    }

    fn show_single_mcp_command(&mut self) {
        let parts: Vec<&str> = self.input.split_whitespace().collect();
        let Some(name) = parts.get(1) else {
            self.push_system_message("用法: /mcp-show <name>");
            self.input.clear();
            return;
        };
        let store = McpConfigStore::new(std::path::Path::new("."));
        match store.get(name) {
            Ok(server) => self.push_system_message(&format!(
                "Name: {}\nType: {}\nEnabled: {}\nURL: {}",
                name, server.server_type, server.enabled, server.url
            )),
            Err(error) => self.push_system_message(&format!("读取 MCP 服务失败: {}", error)),
        }
        self.input.clear();
    }

    fn remove_mcp_command(&mut self) {
        let parts: Vec<&str> = self.input.split_whitespace().collect();
        let Some(name) = parts.get(1) else {
            self.push_system_message("用法: /mcp-remove <name>");
            self.input.clear();
            return;
        };
        let store = McpConfigStore::new(std::path::Path::new("."));
        match store.remove(name) {
            Ok(()) => self.push_system_message(&format!("MCP 服务 {} 已删除。", name)),
            Err(error) => self.push_system_message(&format!("删除 MCP 服务失败: {}", error)),
        }
        self.input.clear();
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
        if self.input_mode == InputMode::ProviderSelect {
            self.push_system_message("已取消 provider 选择。");
        }
        if self.input_mode == InputMode::ProviderRename {
            self.push_system_message("已取消 provider 重命名。");
        }
        if self.input_mode == InputMode::ModelSelect {
            self.push_system_message("已取消模型选择。");
        }
        if matches!(self.input_mode, InputMode::LoginBaseUrl | InputMode::LoginApiKey) {
            self.push_system_message("已取消登录配置。");
        }
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

    fn handle_key_event(&mut self, key: KeyEvent) {
        match key.code {
            KeyCode::Char('q') if key.modifiers.contains(crossterm::event::KeyModifiers::CONTROL) => {
                self.should_quit = true;
            }
            KeyCode::Esc => {
                self.cancel_current_mode();
            }
            KeyCode::Enter => self.send_message(),
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
            KeyCode::Char(c) if !key.modifiers.contains(crossterm::event::KeyModifiers::CONTROL) => {
                self.input.push(c);
            }
            KeyCode::Backspace if !matches!(self.input_mode, InputMode::ProviderSelect | InputMode::ModelSelect) => {
                self.input.pop();
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
                if key.kind == KeyEventKind::Press {
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
    } else if app.input.is_empty() {
        let placeholder = match app.input_mode {
            InputMode::Chat => "输入你的编程任务，或使用 /login /providers /models...",
            InputMode::LoginBaseUrl => "输入 provider 名称和 Base URL...",
            InputMode::LoginApiKey => "输入 API Key...",
            InputMode::ProviderSelect => "使用方向键选择 provider...",
            InputMode::ProviderRename => "输入新的 provider 名称...",
            InputMode::ModelSelect => "使用方向键选择模型...",
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

    if !app.processing && !app.input.is_empty() && !matches!(app.input_mode, InputMode::ProviderSelect | InputMode::ModelSelect) {
        let cursor_x = chunks[1].x + 1 + app.input.len() as u16;
        let cursor_y = chunks[1].y + 1;
        frame.set_cursor_position((cursor_x, cursor_y));
    }

    if matches!(app.input_mode, InputMode::ProviderSelect | InputMode::ModelSelect) {
        render_selector(frame, app);
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
