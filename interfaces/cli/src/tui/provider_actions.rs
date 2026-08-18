use super::{
    agent_harness, App, AsyncContext, AsyncResult, InputMode, ModelOptionEntry, NamedProviderConfig,
};
use crate::provider_config::ProviderConfig;
use sacode_kernel::model::OLLAMA_DEFAULT_BASE_URL;
use std::thread;

impl App {
    pub(super) fn start_login(&mut self) {
        self.input_mode = InputMode::LoginBaseUrl;
        self.pending_base_url = None;
        self.pending_provider_name = self
            .current_provider
            .as_ref()
            .map(|provider| provider.name.clone());
        self.input = self
            .current_provider
            .as_ref()
            .map(|provider| provider.config.base_url.clone())
            .unwrap_or_default();
        self.push_system_message("请输入 provider 名称与 Base URL，格式为 name https://api.openai.com/v1；只输入 Base URL 时会复用当前 provider 名称。输入 /providers 可切换 provider。");
    }

    pub(super) fn finish_login_base_url(&mut self) {
        let raw_input = self.input.trim().to_string();
        let (provider_name, base_url) = if let Some((name, url)) = raw_input.split_once(' ') {
            (name.trim().to_string(), url.trim().to_string())
        } else {
            (
                self.pending_provider_name
                    .clone()
                    .unwrap_or_else(|| "default".to_string()),
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

    pub(super) fn finish_login_api_key(&mut self) {
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

        self.queue.processing = true;
        self.queue.active_task_id = None;
        self.active_task_started_at = Some(chrono::Local::now());
        self.spinner_index = 0;
        self.queue.busy_message = "正在验证 provider 并拉取模型列表...".to_string();
        self.spawn_login_task(
            self.pending_provider_name
                .clone()
                .unwrap_or_else(|| "default".to_string()),
            config,
        );
        self.pending_base_url = None;
        self.pending_provider_name = None;
        self.input.clear();
        self.input_mode = InputMode::Chat;
    }

    pub(super) fn open_provider_picker(&mut self) {
        self.queue.processing = true;
        self.queue.active_task_id = None;
        self.active_task_started_at = Some(chrono::Local::now());
        self.spinner_index = 0;
        self.queue.busy_message = "正在加载 provider 列表...".to_string();
        self.spawn_load_providers_task();
        self.input.clear();
    }

    pub(super) fn confirm_provider_selection(&mut self) {
        let Some(provider_name) = self
            .provider_options
            .get(self.selected_provider_index)
            .cloned()
        else {
            self.push_system_message("当前没有可选 provider。");
            self.input_mode = InputMode::Chat;
            return;
        };

        self.input_mode = InputMode::Chat;
        self.queue.processing = true;
        self.queue.active_task_id = None;
        self.active_task_started_at = Some(chrono::Local::now());
        self.spinner_index = 0;
        self.queue.busy_message = format!("正在切换 provider 到 {}...", provider_name);
        self.spawn_switch_provider_task(provider_name);
        self.input.clear();
    }

    pub(super) fn start_provider_rename(&mut self) {
        let Some(provider_name) = self
            .provider_options
            .get(self.selected_provider_index)
            .cloned()
        else {
            self.push_system_message("当前没有可重命名的 provider。");
            return;
        };

        self.pending_provider_name = Some(provider_name.clone());
        self.input.clear();
        self.input_mode = InputMode::ProviderRename;
        self.push_system_message(&format!(
            "请输入 provider {} 的新名称，回车确认，Esc 取消。",
            provider_name
        ));
    }

    pub(super) fn finish_provider_rename(&mut self) {
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
                if let Some(selected) = self.provider_options.get_mut(self.selected_provider_index)
                {
                    *selected = new_name.clone();
                }
                self.provider_options.sort();
                self.selected_provider_index = self
                    .provider_options
                    .iter()
                    .position(|provider| provider == &new_name)
                    .unwrap_or(0);
                self.push_system_message(&format!(
                    "Provider {} 已重命名为 {}。",
                    old_name, new_name
                ));
                self.input_mode = InputMode::ProviderSelect;
            }
            Err(error) => {
                self.push_system_message(&format!("重命名 provider 失败: {}", error));
            }
        }

        self.pending_provider_name = None;
        self.input.clear();
    }

    pub(super) fn remove_selected_provider(&mut self) {
        let Some(provider_name) = self
            .provider_options
            .get(self.selected_provider_index)
            .cloned()
        else {
            self.push_system_message("当前没有可删除的 provider。");
            return;
        };

        match self.provider_store.remove(&provider_name) {
            Ok(()) => {
                self.provider_options
                    .retain(|provider| provider != &provider_name);
                if self.selected_provider_index >= self.provider_options.len()
                    && !self.provider_options.is_empty()
                {
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

    pub(super) fn open_model_picker(&mut self) {
        let catalog = match self.provider_store.load_catalog() {
            Ok(Some(catalog)) => catalog,
            Ok(None) => {
                self.push_system_message("当前还没有 provider 配置，请先输入 /login 或 /connect。");
                self.input.clear();
                return;
            }
            Err(error) => {
                self.push_error_message(&format!("读取 provider 配置失败: {}", error));
                self.input.clear();
                return;
            }
        };

        if catalog.providers.is_empty() {
            self.push_system_message("当前还没有 provider 配置，请先输入 /login 或 /connect。");
            self.input.clear();
            return;
        }

        self.queue.processing = true;
        self.queue.active_task_id = None;
        self.active_task_started_at = Some(chrono::Local::now());
        self.spinner_index = 0;
        self.queue.busy_message = "正在加载所有 provider 的模型列表...".to_string();
        self.spawn_load_models_task();
        self.input.clear();
    }

    pub(super) fn open_provider_switch_selector(&mut self) {
        let providers = self
            .provider_store
            .load_catalog()
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
            self.push_system_message(
                "已打开 Provider 选择器，使用上下键选择，Enter 切换，Esc 取消。",
            );
        }
    }

    pub(super) fn switch_provider_by_name(&mut self, name: &str) {
        let catalog = self.provider_store.load_catalog().ok().flatten();

        match catalog {
            Some(c) if c.providers.contains_key(name) => {
                self.queue.processing = true;
                self.queue.active_task_id = None;
                self.active_task_started_at = Some(chrono::Local::now());
                self.spinner_index = 0;
                self.queue.busy_message = format!("正在切换 provider 到 {}...", name);
                self.spawn_switch_provider_task(name.to_string());
            }
            _ => self.push_system_message(&format!("Provider {} 不存在。", name)),
        }
    }

    pub(super) fn show_provider_detail(&mut self, name: &str) {
        match self.sacode_store.provider(name) {
            Ok(Some(spec)) => {
                let current_model = self
                    .current_provider
                    .as_ref()
                    .filter(|p| p.name == name)
                    .map(|p| p.config.model.clone())
                    .unwrap_or_else(|| spec.models.keys().next().cloned().unwrap_or_default());
                self.push_system_message(&format!(
                    "Provider: {}\nBase URL: {}\nAPI Key: {}\nModels: {}\n当前模型: {}",
                    name,
                    spec.base_url,
                    if spec.api_key.is_empty() {
                        "未配置"
                    } else {
                        "已配置"
                    },
                    spec.models.keys().cloned().collect::<Vec<_>>().join(", "),
                    current_model
                ));
            }
            _ => self.push_system_message(&format!("Provider {} 不存在或无法读取。", name)),
        }
    }

    pub(super) fn connect_provider_command(&mut self) {
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

        let mut options: Vec<(String, String, bool)> = vec![(
            "ollama".to_string(),
            OLLAMA_DEFAULT_BASE_URL.to_string(),
            false,
        )];
        options.extend(crate::provider_config::preset_connect_options());

        let Some((name, base_url, _)) = options.get(index.saturating_sub(1)).cloned() else {
            self.push_system_message(&format!("无效编号: {}", index));
            self.input.clear();
            return;
        };

        let api_key = parts.get(2).map(|s| s.to_string()).unwrap_or_default();

        match agent_harness::connect_provider(
            &self.provider_store,
            &self.sacode_store,
            &name,
            &base_url,
            api_key,
        ) {
            Ok(result) => {
                self.current_provider = Some(result.current_provider);
                self.open_model_picker();
            }
            Err(error) => self.push_system_message(&format!("保存 provider 失败: {}", error)),
        }
        self.input.clear();
    }

    pub(super) fn confirm_connect_selection(&mut self) {
        let Some((name, base_url, needs_key)) = self
            .connect_options
            .get(self.selected_connect_index)
            .cloned()
        else {
            self.push_system_message("当前没有可选 provider。");
            self.input_mode = InputMode::Chat;
            return;
        };

        if needs_key {
            self.pending_connect_provider = Some((name.clone(), base_url));
            self.input_mode = InputMode::ConnectApiKey;
            self.push_system_message(&format!(
                "请输入 {} 的 API Key (回车确认，Esc 取消)。",
                name
            ));
        } else {
            self.save_connect_provider(&name, &base_url, String::new());
            self.input_mode = InputMode::Chat;
        }
        self.input.clear();
    }

    pub(super) fn finish_connect(&mut self) {
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

    pub(super) fn save_connect_provider(&mut self, name: &str, base_url: &str, api_key: String) {
        match agent_harness::connect_provider(
            &self.provider_store,
            &self.sacode_store,
            &name,
            &base_url,
            api_key,
        ) {
            Ok(result) => {
                self.current_provider = Some(result.current_provider);
                self.open_model_picker();
            }
            Err(error) => self.push_system_message(&format!("保存 provider 失败: {}", error)),
        }
    }

    pub(super) fn rename_provider_command(&mut self) {
        let parts: Vec<&str> = self.input.split_whitespace().collect();
        if parts.len() != 3 {
            self.push_system_message("用法: /provider-rename <old> <new>");
            self.input.clear();
            return;
        }

        match self.sacode_store.rename_provider(parts[1], parts[2]) {
            Ok(_) => {
                if let Err(error) = self.provider_store.rename(parts[1], parts[2]) {
                    eprintln!("同步 provider.json 重命名失败: {error}");
                }
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

    pub(super) fn remove_provider_command(&mut self) {
        let parts: Vec<&str> = self.input.split_whitespace().collect();
        if parts.len() != 2 {
            self.push_system_message("用法: /provider-remove <name>");
            self.input.clear();
            return;
        }

        match self.sacode_store.remove_provider(parts[1]) {
            Ok(_) => {
                if let Err(error) = self.provider_store.remove(parts[1]) {
                    eprintln!("同步 provider.json 删除失败: {error}");
                }
                self.push_system_message(&format!("Provider {} 已删除。", parts[1]))
            }
            Err(error) => self.push_system_message(&format!("删除 provider 失败: {}", error)),
        }
        self.input.clear();
    }

    pub(super) fn confirm_model_selection(&mut self) {
        let Some(selected_model) = self.model_options.get(self.selected_model_index).cloned()
        else {
            self.push_system_message("当前没有可选模型。");
            self.input_mode = InputMode::Chat;
            return;
        };

        let provider_name = selected_model.provider_name.clone();
        self.input_mode = InputMode::Chat;
        self.queue.processing = true;
        self.queue.active_task_id = None;
        self.active_task_started_at = Some(chrono::Local::now());
        self.spinner_index = 0;
        self.queue.busy_message = format!(
            "正在切换到 {} / {}...",
            provider_name, selected_model.model_name
        );
        self.spawn_save_model_task(provider_name, selected_model.model_name);
        self.input.clear();
    }

    pub(super) fn spawn_login_task(&self, provider_name: String, config: ProviderConfig) {
        let sender = self.task_tx.clone();
        let store = self.provider_store.clone();
        let sacode_store = self.sacode_store.clone();
        thread::spawn(move || {
            match agent_harness::connect_provider(
                &store,
                &sacode_store,
                &provider_name,
                &config.base_url,
                config.api_key,
            ) {
                Ok(result) => {
                    let _ = sender.send(AsyncResult::LoginCompleted {
                        provider_name: result.current_provider.name,
                        config: result.current_provider.config,
                    });
                }
                Err(error) => {
                    let _ = sender.send(AsyncResult::Failed {
                        context: AsyncContext::Login,
                        message: format!("保存 provider 配置失败: {}", error),
                    });
                }
            }
        });
    }

    pub(super) fn spawn_load_providers_task(&self) {
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

    pub(super) fn spawn_switch_provider_task(&self, provider_name: String) {
        let sender = self.task_tx.clone();
        let store = self.provider_store.clone();
        let sacode_store = self.sacode_store.clone();
        thread::spawn(move || {
            match agent_harness::switch_provider(&store, &sacode_store, &provider_name) {
                Ok(current_provider) => {
                    let _ = sender.send(AsyncResult::ProviderSwitched { current_provider });
                }
                Err(error) => {
                    let _ = sender.send(AsyncResult::Failed {
                        context: AsyncContext::SaveProvider,
                        message: format!("切换 provider 失败: {}", error),
                    });
                }
            }
        });
    }

    pub(super) fn spawn_load_models_task(&self) {
        let sender = self.task_tx.clone();
        let provider_store = self.provider_store.clone();
        let sacode_store = self.sacode_store.clone();
        let current_provider = self.current_provider.clone();
        thread::spawn(move || {
            match provider_store.load_catalog() {
                Ok(Some(_)) => {}
                Ok(None) => {
                    let _ = sender.send(AsyncResult::ModelsLoaded {
                        models: Vec::new(),
                        current_provider: String::new(),
                        current_model: String::new(),
                    });
                    return;
                }
                Err(error) => {
                    let _ = sender.send(AsyncResult::Failed {
                        context: AsyncContext::LoadModels,
                        message: format!("读取 provider 目录失败: {}", error),
                    });
                    return;
                }
            }

            let current_provider_name = current_provider
                .as_ref()
                .map(|provider| provider.name.clone())
                .unwrap_or_default();
            let current_model_name = current_provider
                .as_ref()
                .map(|provider| provider.config.model.clone())
                .unwrap_or_default();

            let options = agent_harness::collect_model_options(&provider_store, &sacode_store)
                .unwrap_or_default()
                .into_iter()
                .map(ModelOptionEntry::from)
                .collect::<Vec<_>>();
            let _ = sender.send(AsyncResult::ModelsLoaded {
                models: options,
                current_provider: current_provider_name,
                current_model: current_model_name,
            });
        });
    }

    pub(super) fn spawn_save_model_task(&self, provider_name: String, selected_model: String) {
        let sender = self.task_tx.clone();
        let store = self.provider_store.clone();
        let sacode_store = self.sacode_store.clone();
        thread::spawn(move || {
            match agent_harness::switch_model(
                &store,
                &sacode_store,
                &provider_name,
                &selected_model,
            ) {
                Ok(result) => {
                    let _ = sender.send(AsyncResult::ModelSaved {
                        config: result.config,
                        selected_model,
                    });
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

    pub(super) fn handle_login_completed(&mut self, provider_name: String, config: ProviderConfig) {
        self.current_provider = Some(NamedProviderConfig {
            name: provider_name,
            config,
        });
        self.clear_busy_state();
        self.open_model_picker();
    }

    pub(super) fn handle_providers_loaded(
        &mut self,
        providers: Vec<String>,
        current_provider: String,
    ) {
        self.clear_busy_state();
        if providers.is_empty() {
            self.push_system_message("当前没有可用 provider，请先输入 /login。");
            return;
        }
        self.selected_provider_index = providers
            .iter()
            .position(|provider| provider == &current_provider)
            .unwrap_or(0);
        self.provider_options = providers;
        self.input_mode = InputMode::ProviderSelect;
        self.push_system_message(
            "已打开 provider 管理，使用上下方向键选择，Enter 切换，r 重命名，d 删除，Esc 取消。",
        );
    }

    pub(super) fn handle_provider_switched(&mut self, current_provider: NamedProviderConfig) {
        let provider_name = current_provider.name.clone();
        self.current_provider = Some(current_provider);
        self.input_mode = InputMode::Chat;
        self.clear_busy_state();
        self.push_system_message(&format!("当前 provider 已切换为 {}。", provider_name));
    }

    pub(super) fn handle_models_loaded(
        &mut self,
        models: Vec<ModelOptionEntry>,
        current_provider: String,
        current_model: String,
    ) {
        self.clear_busy_state();
        if models.is_empty() {
            self.push_system_message(
                "当前没有可切换的模型，请先配置 provider 或检查模型拉取结果。",
            );
            return;
        }
        self.selected_model_index = models
            .iter()
            .position(|model| {
                model.provider_name == current_provider && model.model_name == current_model
            })
            .unwrap_or(0);
        self.model_options = models;
        self.input_mode = InputMode::ModelSelect;
    }

    pub(super) fn handle_model_saved(&mut self, config: ProviderConfig, selected_model: String) {
        let provider_name = self
            .model_options
            .get(self.selected_model_index)
            .map(|entry| entry.provider_name.clone())
            .or_else(|| {
                self.current_provider
                    .as_ref()
                    .map(|provider| provider.name.clone())
            })
            .unwrap_or_default();
        self.current_provider = Some(NamedProviderConfig {
            name: provider_name,
            config,
        });
        self.input_mode = InputMode::Chat;
        self.clear_busy_state();
        self.push_system_message(&format!("默认模型已切换为 {}。", selected_model));
    }

    pub(super) fn profile_command(&mut self, input: &str) {
        let parts: Vec<&str> = input.split_whitespace().collect();
        let sub = parts.get(1).copied().unwrap_or("ls");

        match sub {
            "ls" => {
                let providers = self
                    .provider_store
                    .load_catalog()
                    .ok()
                    .flatten()
                    .map(|c| c.providers.keys().cloned().collect::<Vec<_>>())
                    .unwrap_or_default();
                if providers.is_empty() {
                    self.push_system_message("当前没有配置任何 Provider。");
                } else {
                    let current = self
                        .current_provider
                        .as_ref()
                        .map(|p| p.name.clone())
                        .unwrap_or_default();
                    let list = providers
                        .iter()
                        .map(|name| {
                            if name == &current {
                                format!("* {}", name)
                            } else {
                                format!("  {}", name)
                            }
                        })
                        .collect::<Vec<_>>()
                        .join("\n");
                    self.push_system_message(&format!(
                        "Provider 配置列表:\n{}\n当前: {}",
                        list, current
                    ));
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
                let default_name = self
                    .current_provider
                    .as_ref()
                    .map(|p| p.name.clone())
                    .unwrap_or_default();
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
}
