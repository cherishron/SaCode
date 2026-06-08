use std::{
    fs,
    path::{Path, PathBuf},
};

use anyhow::{bail, Result};
use sacode_kernel::ApprovalPolicy;
use serde::{Deserialize, Serialize};

use crate::provider_config::SaCodeConfigStore;

const CONFIG_FILE: &str = ".sacode/config.json";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ConfigScope {
    User,
    Project,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ConfigCategory {
    General,
    Context,
    Execution,
    Editor,
    Update,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ConfigValueType {
    Enum {
        options: Vec<&'static str>,
        labels: Vec<&'static str>,
    },
    Bool,
    Number {
        min: usize,
        max: usize,
        step: usize,
    },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ConfigItemMeta {
    pub key: &'static str,
    pub display_name: &'static str,
    pub description: &'static str,
    pub value_type: ConfigValueType,
    pub category: ConfigCategory,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct EffectiveConfig {
    pub language: String,
    pub auto_compress: bool,
    pub compress_threshold: usize,
    pub compress_tail_turns: usize,
    pub execution_mode: String,
    pub max_iterations: usize,
    pub loop_max_iterations: usize,
    pub approval_policy: String,
    pub output_style: String,
    pub vim_mode: bool,
    pub update_check_on_startup: bool,
    pub update_cache_duration_hours: usize,
    pub update_channel: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq, Eq)]
pub struct ConfigOverrides {
    #[serde(default)]
    pub language: Option<String>,
    #[serde(default)]
    pub auto_compress: Option<bool>,
    #[serde(default)]
    pub compress_threshold: Option<usize>,
    #[serde(default)]
    pub compress_tail_turns: Option<usize>,
    #[serde(default)]
    pub execution_mode: Option<String>,
    #[serde(default)]
    pub max_iterations: Option<usize>,
    #[serde(default)]
    pub loop_max_iterations: Option<usize>,
    #[serde(default)]
    pub approval_policy: Option<String>,
    #[serde(default)]
    pub output_style: Option<String>,
    #[serde(default)]
    pub vim_mode: Option<bool>,
    #[serde(default)]
    pub update_check_on_startup: Option<bool>,
    #[serde(default)]
    pub update_cache_duration_hours: Option<usize>,
    #[serde(default)]
    pub update_channel: Option<String>,
}

pub fn run(args: Vec<String>) -> Result<()> {
    let workdir = PathBuf::from(".");
    println!("{}", render_config(&workdir, &args)?);
    Ok(())
}

pub fn render_config(workdir: &Path, args: &[String]) -> Result<String> {
    let store = ConfigStore::new(workdir);

    match args.first().map(|value| value.as_str()) {
        None | Some("show") | Some("status") => render_status(&store),
        Some("path") => Ok(format_paths(&store)),
        Some("user") => render_scope(&store, ConfigScope::User, &args[1..]),
        Some("project") => render_scope(&store, ConfigScope::Project, &args[1..]),
        Some("set") => apply_set_args(&store, ConfigScope::User, &args[1..]),
        Some("clear") => clear_key_args(&store, ConfigScope::User, &args[1..]),
        Some(_) => Ok(
            "用法: /config [show|path|user ...|project ...|set <key> <value>|clear <key>]"
                .to_string(),
        ),
    }
}

pub fn get_all_config_items() -> Vec<ConfigItemMeta> {
    vec![
        ConfigItemMeta {
            key: "language",
            display_name: "交互语言",
            description: "AI 回复和系统提示的显示语言",
            value_type: ConfigValueType::Enum {
                options: vec!["zh-CN", "en-US"],
                labels: vec!["中文", "英文"],
            },
            category: ConfigCategory::General,
        },
        ConfigItemMeta {
            key: "output_style",
            display_name: "输出风格",
            description: "AI 输出内容的详细程度",
            value_type: ConfigValueType::Enum {
                options: vec!["concise", "explanatory", "teaching"],
                labels: vec!["简洁", "解释", "教学"],
            },
            category: ConfigCategory::General,
        },
        ConfigItemMeta {
            key: "auto_compress",
            display_name: "自动压缩",
            description: "对话达到阈值时自动压缩上下文",
            value_type: ConfigValueType::Bool,
            category: ConfigCategory::Context,
        },
        ConfigItemMeta {
            key: "compress_threshold",
            display_name: "压缩阈值",
            description: "触发自动压缩的对话轮数",
            value_type: ConfigValueType::Number {
                min: 5,
                max: 50,
                step: 1,
            },
            category: ConfigCategory::Context,
        },
        ConfigItemMeta {
            key: "compress_tail_turns",
            display_name: "保留轮数",
            description: "压缩后保留的最近对话轮数",
            value_type: ConfigValueType::Number {
                min: 5,
                max: 30,
                step: 1,
            },
            category: ConfigCategory::Context,
        },
        ConfigItemMeta {
            key: "execution_mode",
            display_name: "默认执行模式",
            description: "新任务默认使用的执行模式",
            value_type: ConfigValueType::Enum {
                options: vec!["plan", "build", "yolo"],
                labels: vec!["规划", "构建", "Yolo"],
            },
            category: ConfigCategory::Execution,
        },
        ConfigItemMeta {
            key: "max_iterations",
            display_name: "循环次数",
            description: "工具执行循环的最大迭代次数",
            value_type: ConfigValueType::Number {
                min: 1,
                max: 10,
                step: 1,
            },
            category: ConfigCategory::Execution,
        },
        ConfigItemMeta {
            key: "loop_max_iterations",
            display_name: "/loop 轮数",
            description: "/loop 自动续跑的最大轮数",
            value_type: ConfigValueType::Number {
                min: 1,
                max: 20,
                step: 1,
            },
            category: ConfigCategory::Execution,
        },
        ConfigItemMeta {
            key: "approval_policy",
            display_name: "审批策略",
            description: "工具执行的审批策略",
            value_type: ConfigValueType::Enum {
                options: vec!["auto", "prompt", "deny"],
                labels: vec!["自动批准", "询问确认", "自动拒绝"],
            },
            category: ConfigCategory::Execution,
        },
        ConfigItemMeta {
            key: "vim_mode",
            display_name: "Vim 模式",
            description: "输入框启用 Vim 编辑模式",
            value_type: ConfigValueType::Bool,
            category: ConfigCategory::Editor,
        },
        ConfigItemMeta {
            key: "update.check_on_startup",
            display_name: "启动检查更新",
            description: "启动 REPL 或 TUI 时自动检查新版本",
            value_type: ConfigValueType::Bool,
            category: ConfigCategory::Update,
        },
        ConfigItemMeta {
            key: "update.cache_duration_hours",
            display_name: "更新缓存时长",
            description: "版本检查缓存的有效小时数",
            value_type: ConfigValueType::Number {
                min: 1,
                max: 168,
                step: 1,
            },
            category: ConfigCategory::Update,
        },
        ConfigItemMeta {
            key: "update.channel",
            display_name: "更新通道",
            description: "版本检查使用的更新通道",
            value_type: ConfigValueType::Enum {
                options: vec!["stable", "beta"],
                labels: vec!["稳定版", "Beta"],
            },
            category: ConfigCategory::Update,
        },
    ]
}

pub fn config_item(key: &str) -> Option<ConfigItemMeta> {
    get_all_config_items()
        .into_iter()
        .find(|item| item.key == key)
}

pub fn effective_config(workdir: &Path) -> Result<EffectiveConfig> {
    ConfigStore::new(workdir).load_effective()
}

pub fn scope_config(workdir: &Path, scope: ConfigScope) -> Result<ConfigOverrides> {
    ConfigStore::new(workdir).load_scope(scope)
}

pub fn set_value(workdir: &Path, scope: ConfigScope, key: &str, value: &str) -> Result<String> {
    let store = ConfigStore::new(workdir);
    let mut config = store.load_scope(scope)?;
    set_override_value(&mut config, key, value)?;
    store.save_scope(scope, &config)?;
    Ok(format!(
        "{}级配置已更新: {} = {}",
        scope_label(scope),
        key,
        display_value(key, value)
    ))
}

pub fn clear_value(workdir: &Path, scope: ConfigScope, key: &str) -> Result<String> {
    let store = ConfigStore::new(workdir);
    let mut config = store.load_scope(scope)?;
    clear_override_value(&mut config, key)?;
    store.save_scope(scope, &config)?;
    Ok(format!("{}级配置已清除: {}", scope_label(scope), key))
}

pub fn current_value_text(config: &EffectiveConfig, key: &str) -> Option<String> {
    Some(match key {
        "language" => config.language.clone(),
        "auto_compress" => bool_text(config.auto_compress),
        "compress_threshold" => config.compress_threshold.to_string(),
        "compress_tail_turns" => config.compress_tail_turns.to_string(),
        "execution_mode" => config.execution_mode.clone(),
        "max_iterations" => config.max_iterations.to_string(),
        "loop_max_iterations" => config.loop_max_iterations.to_string(),
        "approval_policy" => config.approval_policy.clone(),
        "output_style" => config.output_style.clone(),
        "vim_mode" => bool_text(config.vim_mode),
        "update.check_on_startup" => bool_text(config.update_check_on_startup),
        "update.cache_duration_hours" => config.update_cache_duration_hours.to_string(),
        "update.channel" => config.update_channel.clone(),
        _ => return None,
    })
}

pub fn current_raw_value(config: &EffectiveConfig, key: &str) -> Option<String> {
    Some(match key {
        "language" => config.language.clone(),
        "auto_compress" => config.auto_compress.to_string(),
        "compress_threshold" => config.compress_threshold.to_string(),
        "compress_tail_turns" => config.compress_tail_turns.to_string(),
        "execution_mode" => config.execution_mode.clone(),
        "max_iterations" => config.max_iterations.to_string(),
        "loop_max_iterations" => config.loop_max_iterations.to_string(),
        "approval_policy" => config.approval_policy.clone(),
        "output_style" => config.output_style.clone(),
        "vim_mode" => config.vim_mode.to_string(),
        "update.check_on_startup" => config.update_check_on_startup.to_string(),
        "update.cache_duration_hours" => config.update_cache_duration_hours.to_string(),
        "update.channel" => config.update_channel.clone(),
        _ => return None,
    })
}

fn render_status(store: &ConfigStore) -> Result<String> {
    let effective = store.load_effective()?;
    let user = store.load_scope(ConfigScope::User)?;
    let project = store.load_scope(ConfigScope::Project)?;
    let mut lines = vec!["当前配置".to_string()];
    for item in get_all_config_items() {
        let effective_value = current_value_text(&effective, item.key).unwrap_or_default();
        let user_value = scope_value_text(&user, item.key);
        let project_value = scope_value_text(&project, item.key);
        lines.push(format!(
            "- {} ({})\n  生效: {}\n  用户级: {}\n  项目级: {}",
            item.display_name, item.key, effective_value, user_value, project_value,
        ));
    }
    lines.push("用法:".to_string());
    lines.push("- /config".to_string());
    lines.push("- /config user set output_style teaching".to_string());
    lines.push("- /config project set vim_mode true".to_string());
    lines.push("- /config project clear vim_mode".to_string());
    Ok(lines.join("\n"))
}

fn render_scope(store: &ConfigStore, scope: ConfigScope, args: &[String]) -> Result<String> {
    match args.first().map(|value| value.as_str()) {
        None | Some("show") | Some("status") => render_scope_status(store, scope),
        Some("path") => Ok(store.path_for(scope).display().to_string()),
        Some("set") => apply_set_args(store, scope, &args[1..]),
        Some("clear") => clear_key_args(store, scope, &args[1..]),
        Some(_) => Ok(format!(
            "用法: /config {} [show|path|set <key> <value>|clear <key>]",
            scope_name(scope)
        )),
    }
}

fn render_scope_status(store: &ConfigStore, scope: ConfigScope) -> Result<String> {
    let config = store.load_scope(scope)?;
    let mut lines = vec![format!("{}级配置", scope_label(scope))];
    for item in get_all_config_items() {
        lines.push(format!(
            "- {} ({}): {}",
            item.display_name,
            item.key,
            scope_value_text(&config, item.key)
        ));
    }
    Ok(lines.join("\n"))
}

fn apply_set_args(store: &ConfigStore, scope: ConfigScope, args: &[String]) -> Result<String> {
    let Some(key) = args.first() else {
        return Ok(format!(
            "用法: /config {} set <key> <value>",
            scope_name(scope)
        ));
    };
    let Some(value) = args.get(1) else {
        return Ok(format!(
            "用法: /config {} set <key> <value>",
            scope_name(scope)
        ));
    };
    let mut config = store.load_scope(scope)?;
    set_override_value(&mut config, key, value)?;
    store.save_scope(scope, &config)?;
    Ok(format!(
        "{}级配置已更新: {} = {}",
        scope_label(scope),
        key,
        display_value(key, value)
    ))
}

fn clear_key_args(store: &ConfigStore, scope: ConfigScope, args: &[String]) -> Result<String> {
    let Some(key) = args.first() else {
        return Ok(format!("用法: /config {} clear <key>", scope_name(scope)));
    };
    let mut config = store.load_scope(scope)?;
    clear_override_value(&mut config, key)?;
    store.save_scope(scope, &config)?;
    Ok(format!("{}级配置已清除: {}", scope_label(scope), key))
}

fn format_paths(store: &ConfigStore) -> String {
    format!(
        "用户级配置: {}\n项目级配置: {}",
        store.path_for(ConfigScope::User).display(),
        store.path_for(ConfigScope::Project).display(),
    )
}

fn scope_name(scope: ConfigScope) -> &'static str {
    match scope {
        ConfigScope::User => "user",
        ConfigScope::Project => "project",
    }
}

fn scope_label(scope: ConfigScope) -> &'static str {
    match scope {
        ConfigScope::User => "用户",
        ConfigScope::Project => "项目",
    }
}

fn scope_value_text(config: &ConfigOverrides, key: &str) -> String {
    match key {
        "language" => config
            .language
            .clone()
            .unwrap_or_else(|| "未设置".to_string()),
        "auto_compress" => config
            .auto_compress
            .map(bool_text)
            .unwrap_or_else(|| "未设置".to_string()),
        "compress_threshold" => config
            .compress_threshold
            .map(|value| value.to_string())
            .unwrap_or_else(|| "未设置".to_string()),
        "compress_tail_turns" => config
            .compress_tail_turns
            .map(|value| value.to_string())
            .unwrap_or_else(|| "未设置".to_string()),
        "execution_mode" => config
            .execution_mode
            .clone()
            .unwrap_or_else(|| "未设置".to_string()),
        "max_iterations" => config
            .max_iterations
            .map(|value| value.to_string())
            .unwrap_or_else(|| "未设置".to_string()),
        "loop_max_iterations" => config
            .loop_max_iterations
            .map(|value| value.to_string())
            .unwrap_or_else(|| "未设置".to_string()),
        "approval_policy" => config
            .approval_policy
            .clone()
            .unwrap_or_else(|| "未设置".to_string()),
        "output_style" => config
            .output_style
            .clone()
            .unwrap_or_else(|| "未设置".to_string()),
        "vim_mode" => config
            .vim_mode
            .map(bool_text)
            .unwrap_or_else(|| "未设置".to_string()),
        "update.check_on_startup" => config
            .update_check_on_startup
            .map(bool_text)
            .unwrap_or_else(|| "未设置".to_string()),
        "update.cache_duration_hours" => config
            .update_cache_duration_hours
            .map(|value| value.to_string())
            .unwrap_or_else(|| "未设置".to_string()),
        "update.channel" => config
            .update_channel
            .clone()
            .unwrap_or_else(|| "未设置".to_string()),
        _ => "未设置".to_string(),
    }
}

fn set_override_value(config: &mut ConfigOverrides, key: &str, value: &str) -> Result<()> {
    match key {
        "language" => {
            let value = normalize_language(value)?;
            config.language = Some(value);
        }
        "auto_compress" => config.auto_compress = Some(parse_bool(value)?),
        "compress_threshold" => config.compress_threshold = Some(parse_number(value, 5, 50)?),
        "compress_tail_turns" => config.compress_tail_turns = Some(parse_number(value, 5, 30)?),
        "execution_mode" => config.execution_mode = Some(normalize_execution_mode(value)?),
        "max_iterations" => config.max_iterations = Some(parse_number(value, 1, 10)?),
        "loop_max_iterations" => config.loop_max_iterations = Some(parse_number(value, 1, 20)?),
        "approval_policy" => config.approval_policy = Some(normalize_approval_policy(value)?),
        "output_style" => config.output_style = Some(normalize_output_style(value)?),
        "vim_mode" => config.vim_mode = Some(parse_bool(value)?),
        "update.check_on_startup" => config.update_check_on_startup = Some(parse_bool(value)?),
        "update.cache_duration_hours" => {
            config.update_cache_duration_hours = Some(parse_number(value, 1, 168)?)
        }
        "update.channel" => config.update_channel = Some(normalize_update_channel(value)?),
        _ => bail!("未知配置项: {}", key),
    }
    Ok(())
}

fn clear_override_value(config: &mut ConfigOverrides, key: &str) -> Result<()> {
    match key {
        "language" => config.language = None,
        "auto_compress" => config.auto_compress = None,
        "compress_threshold" => config.compress_threshold = None,
        "compress_tail_turns" => config.compress_tail_turns = None,
        "execution_mode" => config.execution_mode = None,
        "max_iterations" => config.max_iterations = None,
        "loop_max_iterations" => config.loop_max_iterations = None,
        "approval_policy" => config.approval_policy = None,
        "output_style" => config.output_style = None,
        "vim_mode" => config.vim_mode = None,
        "update.check_on_startup" => config.update_check_on_startup = None,
        "update.cache_duration_hours" => config.update_cache_duration_hours = None,
        "update.channel" => config.update_channel = None,
        _ => bail!("未知配置项: {}", key),
    }
    Ok(())
}

fn parse_bool(value: &str) -> Result<bool> {
    match value.trim().to_lowercase().as_str() {
        "true" | "on" | "yes" | "1" => Ok(true),
        "false" | "off" | "no" | "0" => Ok(false),
        _ => bail!("布尔值只支持 true/false、on/off、yes/no、1/0"),
    }
}

fn parse_number(value: &str, min: usize, max: usize) -> Result<usize> {
    let parsed = value.trim().parse::<usize>()?;
    if parsed < min || parsed > max {
        bail!("数值范围应为 {}-{}", min, max);
    }
    Ok(parsed)
}

fn normalize_language(value: &str) -> Result<String> {
    match value.trim() {
        "zh-CN" | "zh" | "cn" => Ok("zh-CN".to_string()),
        "en-US" | "en" | "us" => Ok("en-US".to_string()),
        _ => bail!("language 只支持 zh-CN 或 en-US"),
    }
}

fn normalize_output_style(value: &str) -> Result<String> {
    match value.trim().to_lowercase().as_str() {
        "concise" => Ok("concise".to_string()),
        "explain" | "explanatory" => Ok("explanatory".to_string()),
        "teach" | "teaching" => Ok("teaching".to_string()),
        _ => bail!("output_style 只支持 concise、explain、teach"),
    }
}

fn normalize_approval_policy(value: &str) -> Result<String> {
    match value.trim().to_lowercase().as_str() {
        "auto" | "approve" => Ok("auto".to_string()),
        "prompt" | "ask" => Ok("prompt".to_string()),
        "deny" | "reject" => Ok("deny".to_string()),
        _ => bail!("approval_policy 只支持 auto、prompt、deny"),
    }
}

fn normalize_update_channel(value: &str) -> Result<String> {
    match value.trim().to_lowercase().as_str() {
        "stable" => Ok("stable".to_string()),
        "beta" => Ok("beta".to_string()),
        _ => bail!("update.channel 只支持 stable、beta"),
    }
}

fn normalize_execution_mode(value: &str) -> Result<String> {
    match value.trim().to_lowercase().as_str() {
        "plan" => Ok("plan".to_string()),
        "build" => Ok("build".to_string()),
        "yolo" => Ok("yolo".to_string()),
        _ => bail!("execution_mode 只支持 plan、build、yolo"),
    }
}

fn bool_text(value: bool) -> String {
    if value {
        "ON".to_string()
    } else {
        "OFF".to_string()
    }
}

fn display_value(key: &str, value: &str) -> String {
    match key {
        "auto_compress" | "vim_mode" => parse_bool(value)
            .map(bool_text)
            .unwrap_or_else(|_| value.to_string()),
        _ => value.to_string(),
    }
}

#[derive(Debug, Clone)]
struct ConfigStore {
    sacode_store: SaCodeConfigStore,
    user_path: PathBuf,
    project_path: PathBuf,
}

impl ConfigStore {
    fn new(workdir: &Path) -> Self {
        let user_path = std::env::var_os("HOME")
            .map(PathBuf::from)
            .unwrap_or_else(|| PathBuf::from("."))
            .join(CONFIG_FILE);
        Self {
            sacode_store: SaCodeConfigStore::new(workdir),
            user_path,
            project_path: workdir.join(CONFIG_FILE),
        }
    }

    fn load_effective(&self) -> Result<EffectiveConfig> {
        let user = self.load_scope(ConfigScope::User)?;
        let project = self.load_scope(ConfigScope::Project)?;
        Ok(merge_effective(user, project))
    }

    fn load_scope(&self, scope: ConfigScope) -> Result<ConfigOverrides> {
        let path = self.path_for(scope);
        if !path.exists() {
            return Ok(ConfigOverrides::default());
        }
        let content = fs::read_to_string(path)?;
        let raw: serde_json::Value = serde_json::from_str(&content)?;
        Ok(extract_overrides(&raw))
    }

    fn save_scope(&self, scope: ConfigScope, overrides: &ConfigOverrides) -> Result<()> {
        let path = self.path_for(scope).to_path_buf();
        let mut base = self.load_raw_config(scope)?;
        write_overrides(&mut base, overrides)?;
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)?;
        }
        fs::write(path, serde_json::to_string_pretty(&base)?)?;
        self.sync_legacy_fields(scope, overrides)?;
        Ok(())
    }

    fn load_raw_config(&self, scope: ConfigScope) -> Result<serde_json::Value> {
        let path = self.path_for(scope);
        if !path.exists() {
            return Ok(serde_json::to_value(default_json_config())?);
        }
        let content = fs::read_to_string(path)?;
        Ok(serde_json::from_str(&content)?)
    }

    fn sync_legacy_fields(&self, scope: ConfigScope, overrides: &ConfigOverrides) -> Result<()> {
        let mut config = match scope {
            ConfigScope::User => self.sacode_store.load_user()?.unwrap_or_default(),
            ConfigScope::Project => self.sacode_store.load_or_default()?,
        };

        if let Some(style) = &overrides.output_style {
            config.outstyle = style.clone();
        } else {
            config.outstyle.clear();
        }

        config.vim_mode = overrides.vim_mode.unwrap_or(false);

        match scope {
            ConfigScope::User => self.sacode_store.save_user(&config),
            ConfigScope::Project => self.sacode_store.save(&config),
        }
    }

    fn path_for(&self, scope: ConfigScope) -> &Path {
        match scope {
            ConfigScope::User => &self.user_path,
            ConfigScope::Project => &self.project_path,
        }
    }
}

fn merge_effective(user: ConfigOverrides, project: ConfigOverrides) -> EffectiveConfig {
    let mut effective = EffectiveConfig {
        language: "zh-CN".to_string(),
        auto_compress: true,
        compress_threshold: 15,
        compress_tail_turns: 15,
        execution_mode: "yolo".to_string(),
        max_iterations: 3,
        loop_max_iterations: 10,
        approval_policy: "prompt".to_string(),
        output_style: "concise".to_string(),
        vim_mode: false,
        update_check_on_startup: true,
        update_cache_duration_hours: 24,
        update_channel: "stable".to_string(),
    };

    apply_overrides(&mut effective, &user);
    apply_overrides(&mut effective, &project);
    effective
}

fn apply_overrides(target: &mut EffectiveConfig, overrides: &ConfigOverrides) {
    if let Some(value) = &overrides.language {
        target.language = value.clone();
    }
    if let Some(value) = overrides.auto_compress {
        target.auto_compress = value;
    }
    if let Some(value) = overrides.compress_threshold {
        target.compress_threshold = value;
    }
    if let Some(value) = overrides.compress_tail_turns {
        target.compress_tail_turns = value;
    }
    if let Some(value) = &overrides.execution_mode {
        target.execution_mode = value.clone();
    }
    if let Some(value) = overrides.max_iterations {
        target.max_iterations = value;
    }
    if let Some(value) = overrides.loop_max_iterations {
        target.loop_max_iterations = value;
    }
    if let Some(value) = &overrides.approval_policy {
        target.approval_policy = value.clone();
    }
    if let Some(value) = &overrides.output_style {
        target.output_style = value.clone();
    }
    if let Some(value) = overrides.vim_mode {
        target.vim_mode = value;
    }
    if let Some(value) = overrides.update_check_on_startup {
        target.update_check_on_startup = value;
    }
    if let Some(value) = overrides.update_cache_duration_hours {
        target.update_cache_duration_hours = value;
    }
    if let Some(value) = &overrides.update_channel {
        target.update_channel = value.clone();
    }
}

fn extract_overrides(raw: &serde_json::Value) -> ConfigOverrides {
    ConfigOverrides {
        language: raw
            .get("language")
            .and_then(|value| value.as_str())
            .map(|value| value.to_string()),
        auto_compress: raw.get("auto_compress").and_then(|value| value.as_bool()),
        compress_threshold: raw
            .get("compress_threshold")
            .and_then(|value| value.as_u64())
            .map(|value| value as usize),
        compress_tail_turns: raw
            .get("compress_tail_turns")
            .and_then(|value| value.as_u64())
            .map(|value| value as usize),
        execution_mode: raw
            .get("execution_mode")
            .and_then(|value| value.as_str())
            .map(|value| value.to_string()),
        max_iterations: raw
            .get("max_iterations")
            .and_then(|value| value.as_u64())
            .map(|value| value as usize),
        loop_max_iterations: raw
            .get("loop_max_iterations")
            .and_then(|value| value.as_u64())
            .map(|value| value as usize),
        approval_policy: raw
            .get("approval_policy")
            .and_then(|value| value.as_str())
            .map(|value| value.to_string()),
        output_style: raw
            .get("outstyle")
            .or_else(|| raw.get("output_style"))
            .and_then(|value| value.as_str())
            .map(|value| value.to_string()),
        vim_mode: raw.get("vim_mode").and_then(|value| value.as_bool()),
        update_check_on_startup: raw
            .get("update")
            .and_then(|value| value.get("check_on_startup"))
            .and_then(|value| value.as_bool()),
        update_cache_duration_hours: raw
            .get("update")
            .and_then(|value| value.get("cache_duration_hours"))
            .and_then(|value| value.as_u64())
            .map(|value| value as usize),
        update_channel: raw
            .get("update")
            .and_then(|value| value.get("channel"))
            .and_then(|value| value.as_str())
            .map(|value| value.to_string()),
    }
}

fn write_overrides(raw: &mut serde_json::Value, overrides: &ConfigOverrides) -> Result<()> {
    let object = raw
        .as_object_mut()
        .ok_or_else(|| anyhow::anyhow!("配置文件格式错误"))?;

    set_optional_string(object, "language", overrides.language.clone());
    set_optional_bool(object, "auto_compress", overrides.auto_compress);
    set_optional_usize(object, "compress_threshold", overrides.compress_threshold);
    set_optional_usize(object, "compress_tail_turns", overrides.compress_tail_turns);
    set_optional_string(object, "execution_mode", overrides.execution_mode.clone());
    set_optional_usize(object, "max_iterations", overrides.max_iterations);
    set_optional_usize(object, "loop_max_iterations", overrides.loop_max_iterations);
    set_optional_string(object, "approval_policy", overrides.approval_policy.clone());
    set_optional_string(object, "outstyle", overrides.output_style.clone());
    object.remove("output_style");
    set_optional_bool(object, "vim_mode", overrides.vim_mode);
    set_optional_update(object, overrides);
    Ok(())
}

fn set_optional_update(
    map: &mut serde_json::Map<String, serde_json::Value>,
    overrides: &ConfigOverrides,
) {
    let has_any = overrides.update_check_on_startup.is_some()
        || overrides.update_cache_duration_hours.is_some()
        || overrides.update_channel.is_some();
    if !has_any {
        map.remove("update");
        return;
    }

    let mut update = map
        .get("update")
        .and_then(|value| value.as_object())
        .cloned()
        .unwrap_or_default();
    set_optional_bool(
        &mut update,
        "check_on_startup",
        overrides.update_check_on_startup,
    );
    set_optional_usize(
        &mut update,
        "cache_duration_hours",
        overrides.update_cache_duration_hours,
    );
    set_optional_string(&mut update, "channel", overrides.update_channel.clone());
    map.insert("update".to_string(), serde_json::Value::Object(update));
}

fn set_optional_string(
    map: &mut serde_json::Map<String, serde_json::Value>,
    key: &str,
    value: Option<String>,
) {
    if let Some(value) = value {
        map.insert(key.to_string(), serde_json::Value::String(value));
    } else {
        map.remove(key);
    }
}

fn set_optional_bool(
    map: &mut serde_json::Map<String, serde_json::Value>,
    key: &str,
    value: Option<bool>,
) {
    if let Some(value) = value {
        map.insert(key.to_string(), serde_json::Value::Bool(value));
    } else {
        map.remove(key);
    }
}

fn set_optional_usize(
    map: &mut serde_json::Map<String, serde_json::Value>,
    key: &str,
    value: Option<usize>,
) {
    if let Some(value) = value {
        map.insert(
            key.to_string(),
            serde_json::Value::Number(serde_json::Number::from(value)),
        );
    } else {
        map.remove(key);
    }
}

fn default_json_config() -> serde_json::Value {
    serde_json::json!({
        "model": "",
        "small_model": "",
        "outstyle": "",
        "vim_mode": false,
        "provider": {}
    })
}

pub fn effective_approval_policy(workdir: &Path) -> ApprovalPolicy {
    match effective_config(workdir)
        .ok()
        .map(|config| config.approval_policy)
        .unwrap_or_else(|| "prompt".to_string())
        .as_str()
    {
        "auto" => ApprovalPolicy::AutoApprove,
        "deny" => ApprovalPolicy::AutoDeny,
        _ => ApprovalPolicy::Prompt,
    }
}
