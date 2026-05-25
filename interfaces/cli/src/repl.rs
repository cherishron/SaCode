use std::{env, io::{self, BufRead, Write}};

use anyhow::Result;
use sacode_kernel::ExecutionMode;
use sacode_runtime::{McpConfigStore, SkillRegistry, ToolRegistry};

use crate::{
    cmd::ApprovalPolicy,
    provider_config::{fetch_models, fallback_models, ProviderConfig, ProviderConfigStore, SaCodeConfigStore},
    runner::{format_output, run_task},
};

#[derive(Debug)]
pub struct ReplSession {
    mode: ExecutionMode,
    provider_store: ProviderConfigStore,
    sacode_store: SaCodeConfigStore,
}

impl ReplSession {
    pub fn new() -> Self {
        Self {
            mode: ExecutionMode::Build,
            provider_store: ProviderConfigStore::new(&env::current_dir().unwrap_or_else(|_| ".".into())),
            sacode_store: SaCodeConfigStore::new(&env::current_dir().unwrap_or_else(|_| ".".into())),
        }
    }

    pub async fn run(&mut self) -> Result<()> {
        let stdin = io::stdin();
        let mut lines = stdin.lock().lines();

        loop {
            print!(">>> ");
            io::stdout().flush()?;

            let line = match lines.next() {
                Some(Ok(l)) => l,
                Some(Err(_)) | None => break,
            };

            let trimmed = line.trim();
            if trimmed.is_empty() {
                continue;
            }

            if trimmed.starts_with('/') {
                if self.handle_command(trimmed)? {
                    break;
                }
                continue;
            }

            self.handle_task(trimmed).await?;
        }

        println!("Bye!");
        Ok(())
    }

    fn handle_command(&mut self, cmd: &str) -> Result<bool> {
        let parts: Vec<&str> = cmd.split_whitespace().collect();
        if parts.is_empty() {
            return Ok(false);
        }

        match parts[0] {
            "/exit" | "/quit" | "/q" => return Ok(true),
            "/help" | "/h" => self.show_help(),
            "/connect" => self.connect_provider()?,
            "/mode" => {
                if parts.len() > 1 {
                    self.set_mode(parts[1]);
                } else {
                    println!("Current mode: {:?}", self.mode);
                    println!("Available: plan, build, yolo");
                }
            }
            "/tools" => self.show_tools(),
            "/skills" => self.show_skills(),
            "/skill" => self.handle_skill_command(&parts[1..])?,
            "/mcp" => self.show_mcp(),
            "/mcp-show" => self.show_single_mcp(&parts[1..])?,
            "/mcp-remove" => self.remove_mcp(&parts[1..])?,
            "/login" => self.login_provider()?,
            "/providers" => self.select_provider()?,
            "/provider-rename" => self.rename_provider()?,
            "/provider-remove" => self.remove_provider()?,
            "/models" => self.select_model()?,
            "/clear" => self.clear_screen(),
            cmd => println!("Unknown command: {}", cmd),
        }

        Ok(false)
    }

    async fn handle_task(&mut self, prompt: &str) -> Result<()> {
        let output = run_task(prompt, self.mode, ApprovalPolicy::Prompt, 1).await?;
        println!();
        println!("{}", format_output(&output));
        println!();

        Ok(())
    }

    fn show_help(&self) {
        println!();
        println!("Commands:");
        println!("  /help, /h        - Show this help");
        println!("  /mode [plan|build|yolo] - Set or show mode");
        println!("  /login           - Configure OpenAI-compatible provider");
        println!("  /connect         - Quick connect to a preset provider");
        println!("  /providers       - List and switch provider");
        println!("  /provider-rename - Rename a provider");
        println!("  /provider-remove - Remove a non-current provider");
        println!("  /models          - Fetch and select default model");
        println!("  /tools           - Show available tools");
        println!("  /skills          - Show available skills");
        println!("  /skill <subcommand> - Manage or run skills");
        println!("  /mcp             - Show configured MCP servers");
        println!("  /mcp-show <name> - Show one MCP server");
        println!("  /mcp-remove <name> - Remove one MCP server");
        println!("  /clear           - Clear screen");
        println!("  /exit, /quit, /q - Exit REPL");
        println!();
        println!("Type a task description to run it.");
        println!();
    }

    fn set_mode(&mut self, mode: &str) {
        match mode {
            "plan" => self.mode = ExecutionMode::Plan,
            "build" => self.mode = ExecutionMode::Build,
            "yolo" => self.mode = ExecutionMode::Yolo,
            _ => {
                println!("Unknown mode: {}", mode);
                return;
            }
        }
        println!("Mode set to: {:?}", self.mode);
    }

    fn show_tools(&self) {
        let registry = ToolRegistry::builtin();
        println!();
        println!("Available tools:");
        for name in registry.names() {
            println!("  {}", name);
        }
        println!();
    }

    fn clear_screen(&self) {
        println!();
    }

    fn show_skills(&self) {
        let registry = SkillRegistry::new(std::path::Path::new("."));
        println!();
        println!("Available skills:");
        match registry.list() {
            Ok(skills) => {
                for skill in skills {
                    println!("  {} - {}", skill.name, skill.description);
                }
            }
            Err(error) => println!("  failed to load skills: {}", error),
        }
        println!();
    }

    fn show_mcp(&self) {
        let store = McpConfigStore::new(std::path::Path::new("."));
        println!();
        println!("Configured MCP servers:");
        match store.load() {
            Ok(config) if config.mcp.is_empty() => println!("  none"),
            Ok(config) => {
                for (name, server) in config.mcp {
                    println!(
                        "  {} - {} - {}",
                        name,
                        if server.enabled { "enabled" } else { "disabled" },
                        server.url
                    );
                }
            }
            Err(error) => println!("  failed to load MCP config: {}", error),
        }
        println!();
    }

    fn handle_skill_command(&self, parts: &[&str]) -> Result<()> {
        let registry = SkillRegistry::new(std::path::Path::new("."));
        match parts.first().copied() {
            None | Some("list") => self.show_skills(),
            Some("show") => {
                let Some(name) = parts.get(1) else {
                    println!("Usage: /skill show <name>");
                    return Ok(());
                };
                let skill = registry.get(name)?;
                println!();
                println!("Name: {}", skill.name);
                println!("Description: {}", skill.description);
                println!("Path: {}", skill.path.display());
                println!();
                println!("Prompt:");
                println!("{}", skill.prompt);
                println!();
            }
            Some("run") => {
                let Some(name) = parts.get(1) else {
                    println!("Usage: /skill run <name> [args...]");
                    return Ok(());
                };
                let rendered = registry.render_prompt(name, &parts[2..].join(" "), std::path::Path::new("."))?;
                println!();
                println!("{}", rendered);
                println!();
            }
            Some("add") => {
                if parts.len() < 4 {
                    println!("Usage: /skill add <name> <description> <prompt>");
                    return Ok(());
                }
                let path = registry.save_project_skill(parts[1], parts[2], &parts[3..].join(" "))?;
                println!("Saved project skill to {}", path.display());
                println!();
            }
            Some("remove") => {
                let Some(name) = parts.get(1) else {
                    println!("Usage: /skill remove <name>");
                    return Ok(());
                };
                registry.remove_project_skill(name)?;
                println!("Removed project skill {}", name);
                println!();
            }
            Some(cmd) => println!("Unknown /skill command: {}", cmd),
        }
        Ok(())
    }

    fn show_single_mcp(&self, parts: &[&str]) -> Result<()> {
        let Some(name) = parts.first() else {
            println!("Usage: /mcp-show <name>");
            println!();
            return Ok(());
        };
        let store = McpConfigStore::new(std::path::Path::new("."));
        let server = store.get(name)?;
        println!();
        println!("Name: {}", name);
        println!("Type: {}", server.server_type);
        println!("Enabled: {}", server.enabled);
        println!("URL: {}", server.url);
        println!();
        Ok(())
    }

    fn remove_mcp(&self, parts: &[&str]) -> Result<()> {
        let Some(name) = parts.first() else {
            println!("Usage: /mcp-remove <name>");
            println!();
            return Ok(());
        };
        let store = McpConfigStore::new(std::path::Path::new("."));
        store.remove(name)?;
        println!("Removed MCP server {}", name);
        println!();
        Ok(())
    }

    fn login_provider(&mut self) -> Result<()> {
        println!();
        let current_name = self.sacode_store.current_provider_name()?.unwrap_or_else(|| "default".to_string());
        let existing_spec = self.sacode_store.provider(&current_name)?;
        let existing = existing_spec.as_ref().map(|spec| ProviderConfig {
            base_url: spec.base_url.clone(),
            api_key: spec.api_key.clone(),
            model: self
                .sacode_store
                .load_or_default()
                .ok()
                .and_then(|config| config.resolve_model(&config.model).map(|(_, model)| model))
                .unwrap_or_default(),
        }).unwrap_or_default();
        let provider_name = prompt_input("Provider name", Some(current_name.as_str()))?;
        let base_url = prompt_input(
            "Base URL",
            if existing.base_url.is_empty() { None } else { Some(existing.base_url.as_str()) },
        )?;
        let api_key = prompt_input("API Key", None)?;

        let mut config = ProviderConfig {
            base_url,
            api_key,
            model: existing.model,
        };

        let models = fetch_models(&config)?;
        if config.model.is_empty() {
            if let Some(first_model) = models.first() {
                config.model = first_model.clone();
            }
        }

        self.provider_store.save_named(&provider_name, &config, true)?;
        let mut spec = self
            .sacode_store
            .provider(&provider_name)?
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
        self.sacode_store.upsert_provider(&provider_name, spec)?;
        if !config.model.is_empty() {
            self.sacode_store.set_model(&provider_name, &config.model)?;
        }

        println!("Saved provider {} to .sacode/config.json", provider_name);
        println!("Discovered {} models.", models.len());
        if !config.model.is_empty() {
            println!("Current model: {}", config.model);
        }
        println!();
        Ok(())
    }

    fn select_provider(&mut self) -> Result<()> {
        println!();
        let current = self.sacode_store.current_provider_name()?.unwrap_or_default();
        let providers = self.sacode_store.list_names()?;
        if providers.is_empty() {
            println!("No providers configured. Run /login first.");
            println!();
            return Ok(());
        }

        println!("Providers:");
        for (index, provider) in providers.iter().enumerate() {
            let marker = if provider == &current { "*" } else { " " };
            println!("  {} {}. {}", marker, index + 1, provider);
        }

        let selection = prompt_input("Select provider number", None)?;
        let index: usize = selection.parse()?;
        let selected_provider = providers
            .get(index.saturating_sub(1))
            .cloned()
            .ok_or_else(|| anyhow::anyhow!("Invalid provider index"))?;
        let config = self.sacode_store.load_or_default()?;
        let model_name = config
            .provider
            .get(&selected_provider)
            .and_then(|spec| spec.models.keys().next().cloned())
            .unwrap_or_default();
        self.sacode_store.set_model(&selected_provider, &model_name)?;
        let _ = self.provider_store.set_current(&selected_provider);
        println!("Current provider set to {}", selected_provider);
        println!();
        Ok(())
    }

    fn rename_provider(&mut self) -> Result<()> {
        println!();
        let current = self.sacode_store.current_provider_name()?.unwrap_or_else(|| "default".to_string());
        let from = prompt_input("Current provider name", Some(current.as_str()))?;
        let to = prompt_input("New provider name", None)?;
        self.sacode_store.rename_provider(&from, &to)?;
        let _ = self.provider_store.rename(&from, &to);
        println!("Provider {} renamed to {}", from, to);
        println!();
        Ok(())
    }

    fn remove_provider(&mut self) -> Result<()> {
        println!();
        let current = self.sacode_store.current_provider_name()?.unwrap_or_default();
        let providers = self.sacode_store.list_names()?;
        let removable: Vec<String> = providers.into_iter().filter(|name| name != &current).collect();
        if removable.is_empty() {
            println!("No removable providers. Keep one current provider configured.");
            println!();
            return Ok(());
        }

        println!("Removable providers:");
        for (index, provider) in removable.iter().enumerate() {
            println!("  {}. {}", index + 1, provider);
        }

        let selection = prompt_input("Select provider number to remove", None)?;
        let index: usize = selection.parse()?;
        let provider_name = removable
            .get(index.saturating_sub(1))
            .cloned()
            .ok_or_else(|| anyhow::anyhow!("Invalid provider index"))?;
        self.sacode_store.remove_provider(&provider_name)?;
        let _ = self.provider_store.remove(&provider_name);
        println!("Removed provider {}", provider_name);
        println!();
        Ok(())
    }

    fn select_model(&mut self) -> Result<()> {
        println!();
        let config = self.sacode_store.load_or_default()?;
        let Some((provider_name, current_model)) = config.resolve_model(&config.model) else {
            println!("Provider is not configured. Run /connect first.");
            println!();
            return Ok(());
        };
        let Some(provider) = config.provider.get(&provider_name) else {
            println!("Provider is not configured. Run /connect first.");
            println!();
            return Ok(());
        };

        let provider_config = ProviderConfig {
            base_url: provider.base_url.clone(),
            api_key: provider.api_key.clone(),
            model: current_model.clone(),
        };
        let models = fetch_models(&provider_config).unwrap_or_else(|_| config.model_names_for_provider(&provider_name));
        if models.is_empty() {
            println!("Provider returned no models.");
            println!();
            return Ok(());
        }

        println!("Models:");
        for (index, model) in models.iter().enumerate() {
            let marker = if model == &current_model { "*" } else { " " };
            println!("  {} {}. {}", marker, index + 1, model);
        }

        let selection = prompt_input("Select model number", None)?;
        let index: usize = selection.parse()?;
        let selected_model = models
            .get(index.saturating_sub(1))
            .cloned()
            .ok_or_else(|| anyhow::anyhow!("Invalid model index"))?;
        self.sacode_store.set_model(&provider_name, &selected_model)?;

        if let Some(mut legacy_provider) = self.provider_store.get(&provider_name)? {
            legacy_provider.model = selected_model.clone();
            self.provider_store.save_named(&provider_name, &legacy_provider, true)?;
        }

        println!("Default model set to {}", selected_model);
        println!();
        Ok(())
    }

    fn connect_provider(&mut self) -> Result<()> {
        println!();
        println!("Quick Connect - Preset Providers:");
        println!();
        println!("  1. Ollama (Local)");
        println!("     URL: http://127.0.0.1:11434/v1");
        println!();
        println!("  2. DeepSeek");
        println!("     URL: https://api.deepseek.com/v1");
        println!();
        println!("  3. Xiaomi MiMo (Token Plan)");
        println!("     URL: https://token-plan-cn.xiaomimimo.com/v1");
        println!();
        println!("  4. LongCat");
        println!("     URL: https://api.longcat.chat/openai");
        println!();
        println!("  5. OpenAI");
        println!("     URL: https://api.openai.com/v1");
        println!();

        let selection = prompt_input("Select provider number", None)?;
        let index: usize = selection.parse().map_err(|_| anyhow::anyhow!("Invalid number"))?;

        let (name, base_url) = match index {
            1 => ("ollama", "http://127.0.0.1:11434/v1"),
            2 => ("deepseek", "https://api.deepseek.com"),
            3 => ("mimo", "https://token-plan-cn.xiaomimimo.com/v1"),
            4 => ("longcat", "https://api.longcat.chat/openai/v1"),
            5 => ("openai", "https://api.openai.com/v1"),
            _ => anyhow::bail!("Invalid selection: {}", index),
        };

        let api_key = prompt_input("API Key (ollama 留空即可)", None)?;

        let config = ProviderConfig {
            base_url: base_url.to_string(),
            api_key,
            model: String::new(),
        };

        self.provider_store.save_named(name, &config, true)?;

        println!();
        match fetch_models(&config) {
            Ok(models) if !models.is_empty() => {
                println!("可用模型:");
                for (i, m) in models.iter().enumerate() {
                    println!("  {}. {}", i + 1, m);
                }
                let default = models[0].clone();
                let mut config = config;
                config.model = default.clone();
                self.provider_store.save_named(name, &config, true)?;
                let mut spec = self
                    .sacode_store
                    .provider(name)?
                    .unwrap_or_else(|| sacode_kernel::model::ProviderSpec {
                        name: name.to_string(),
                        base_url: base_url.to_string(),
                        api_key: String::new(),
                        models: std::collections::BTreeMap::new(),
                    });
                spec.name = name.to_string();
                spec.base_url = base_url.to_string();
                spec.api_key = config.api_key.clone();
                for model in &models {
                    spec.models.entry(model.clone()).or_insert_with(|| sacode_kernel::model::ModelRule {
                        name: model.clone(),
                        ..Default::default()
                    });
                }
                self.sacode_store.upsert_provider(name, spec)?;
                self.sacode_store.set_model(name, &default)?;
                println!();
                println!("Provider {} 已连接，默认模型: {}", name, default);
                println!("输入 /models 可切换模型。");
            }
            Ok(_) | Err(_) => {
                let fallbacks = fallback_models(name);
                if !fallbacks.is_empty() {
                    println!("可用模型 (fallback):");
                    for (i, m) in fallbacks.iter().enumerate() {
                        println!("  {}. {}", i + 1, m);
                    }
                    let mut config = config;
                    config.model = fallbacks[0].clone();
                    self.provider_store.save_named(name, &config, true)?;
                    let mut spec = self
                        .sacode_store
                        .provider(name)?
                        .unwrap_or_else(|| sacode_kernel::model::ProviderSpec {
                            name: name.to_string(),
                            base_url: base_url.to_string(),
                            api_key: String::new(),
                            models: std::collections::BTreeMap::new(),
                        });
                    spec.name = name.to_string();
                    spec.base_url = base_url.to_string();
                    spec.api_key = config.api_key.clone();
                    for model in &fallbacks {
                        spec.models.entry(model.clone()).or_insert_with(|| sacode_kernel::model::ModelRule {
                            name: model.clone(),
                            ..Default::default()
                        });
                    }
                    self.sacode_store.upsert_provider(name, spec)?;
                    self.sacode_store.set_model(name, &fallbacks[0])?;
                    println!();
                    println!("Provider {} 已连接，默认模型: {}", name, fallbacks[0]);
                    println!("输入 /models 可切换模型。");
                } else {
                    println!("Provider {} 已连接，但无法获取模型列表。请手动输入 /models 设置模型。", name);
                }
            }
        }
        println!();
        Ok(())
    }
}

impl Default for ReplSession {
    fn default() -> Self {
        Self::new()
    }
}

fn prompt_input(label: &str, default: Option<&str>) -> Result<String> {
    let mut stdout = io::stdout();
    match default {
        Some(value) => write!(stdout, "{} [{}]: ", label, value)?,
        None => write!(stdout, "{}: ", label)?,
    }
    stdout.flush()?;

    let mut line = String::new();
    io::stdin().read_line(&mut line)?;
    let trimmed = line.trim();
    if trimmed.is_empty() {
        if let Some(value) = default {
            return Ok(value.to_string());
        }
    }

    if trimmed.is_empty() {
        anyhow::bail!("{} is required", label);
    }

    Ok(trimmed.to_string())
}
