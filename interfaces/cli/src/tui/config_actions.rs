use anyhow::Result;

use super::{App, ConfigEntry, InputMode};
use crate::cmd::config;

impl App {
    pub(super) fn config_command(&mut self, input: &str) {
        let args = input
            .split_whitespace()
            .skip(1)
            .map(|value| value.to_string())
            .collect::<Vec<_>>();
        if args.is_empty() {
            self.open_config_selector();
            return;
        }
        match config::render_config(&self.workdir, &args) {
            Ok(output) => self.push_system_message(&output),
            Err(error) => self.push_error_message(&format!("读取配置失败: {}", error)),
        }
    }

    pub(super) fn open_config_selector(&mut self) {
        match self.reload_config_items() {
            Ok(()) => {
                self.input_mode = InputMode::ConfigSelect;
                self.input.clear();
                self.push_system_message(
                    "已打开配置管理，使用上下键导航，Enter 修改，Tab 切换用户/项目级，Esc 取消。",
                );
            }
            Err(error) => self.push_error_message(&format!("读取配置失败: {}", error)),
        }
    }

    pub(super) fn reload_config_items(&mut self) -> Result<()> {
        let effective = config::effective_config(&self.workdir)?;
        let scoped = config::scope_config(&self.workdir, self.config_scope)?;
        self.config_items = config::get_all_config_items()
            .into_iter()
            .map(|item| ConfigEntry {
                key: item.key.to_string(),
                name: item.display_name.to_string(),
                description: item.description.to_string(),
                category: match item.category {
                    config::ConfigCategory::General => "通用",
                    config::ConfigCategory::Context => "上下文",
                    config::ConfigCategory::Execution => "执行",
                    config::ConfigCategory::Editor => "编辑器",
                    config::ConfigCategory::Update => "更新",
                }
                .to_string(),
                value: config::current_value_text(&effective, item.key).unwrap_or_default(),
                scope_value: Self::config_scope_value_text(&scoped, item.key),
            })
            .collect();
        if self.selected_config_index >= self.config_items.len() {
            self.selected_config_index = self.config_items.len().saturating_sub(1);
        }
        Ok(())
    }

    pub(super) fn config_scope_value_text(scoped: &config::ConfigOverrides, key: &str) -> String {
        match key {
            "language" => scoped
                .language
                .clone()
                .unwrap_or_else(|| "未设置".to_string()),
            "auto_compress" => scoped
                .auto_compress
                .map(|value| if value { "true".to_string() } else { "false".to_string() })
                .unwrap_or_else(|| "未设置".to_string()),
            "compress_threshold" => scoped
                .compress_threshold
                .map(|value| value.to_string())
                .unwrap_or_else(|| "未设置".to_string()),
            "compress_tail_turns" => scoped
                .compress_tail_turns
                .map(|value| value.to_string())
                .unwrap_or_else(|| "未设置".to_string()),
            "max_iterations" => scoped
                .max_iterations
                .map(|value| value.to_string())
                .unwrap_or_else(|| "未设置".to_string()),
            "approval_policy" => scoped
                .approval_policy
                .clone()
                .unwrap_or_else(|| "未设置".to_string()),
            "output_style" => scoped
                .output_style
                .clone()
                .unwrap_or_else(|| "未设置".to_string()),
            "vim_mode" => scoped
                .vim_mode
                .map(|value| if value { "true".to_string() } else { "false".to_string() })
                .unwrap_or_else(|| "未设置".to_string()),
            "update.check_on_startup" => scoped
                .update_check_on_startup
                .map(|value| if value { "true".to_string() } else { "false".to_string() })
                .unwrap_or_else(|| "未设置".to_string()),
            "update.cache_duration_hours" => scoped
                .update_cache_duration_hours
                .map(|value| value.to_string())
                .unwrap_or_else(|| "未设置".to_string()),
            "update.channel" => scoped
                .update_channel
                .clone()
                .unwrap_or_else(|| "未设置".to_string()),
            _ => "未设置".to_string(),
        }
    }

    pub(super) fn toggle_config_scope(&mut self) {
        self.config_scope = match self.config_scope {
            config::ConfigScope::User => config::ConfigScope::Project,
            config::ConfigScope::Project => config::ConfigScope::User,
        };
        if let Err(error) = self.reload_config_items() {
            self.push_error_message(&format!("刷新配置失败: {}", error));
        }
    }

    pub(super) fn confirm_config_selection(&mut self) {
        let Some(entry) = self.config_items.get(self.selected_config_index).cloned() else {
            return;
        };
        let Some(meta) = config::config_item(&entry.key) else {
            return;
        };
        self.pending_config_key = Some(entry.key.clone());
        match meta.value_type {
            config::ConfigValueType::Bool => {
                match config::effective_config(&self.workdir).and_then(|effective| {
                    let current = config::current_raw_value(&effective, &entry.key)
                        .unwrap_or_else(|| "false".to_string());
                    let next = if current == "true" { "false" } else { "true" };
                    config::set_value(&self.workdir, self.config_scope, &entry.key, next)
                }) {
                    Ok(message) => {
                        let _ = self.reload_config_items();
                        self.push_success_message(&message);
                    }
                    Err(error) => self.push_error_message(&format!("更新配置失败: {}", error)),
                }
            }
            config::ConfigValueType::Enum { options, labels } => {
                self.config_enum_options = options
                    .into_iter()
                    .zip(labels.into_iter())
                    .map(|(value, label)| (value.to_string(), label.to_string()))
                    .collect();
                let current = config::effective_config(&self.workdir)
                    .ok()
                    .and_then(|effective| config::current_raw_value(&effective, &entry.key))
                    .unwrap_or_default();
                self.selected_config_enum_index = self
                    .config_enum_options
                    .iter()
                    .position(|(value, _)| *value == current)
                    .unwrap_or(0);
                self.input_mode = InputMode::ConfigEnumSelect;
            }
            config::ConfigValueType::Number { .. } => {
                self.input = config::effective_config(&self.workdir)
                    .ok()
                    .and_then(|effective| config::current_raw_value(&effective, &entry.key))
                    .unwrap_or_default();
                self.input_mode = InputMode::ConfigNumberInput;
            }
        }
    }

    pub(super) fn confirm_config_enum_selection(&mut self) {
        let Some(key) = self.pending_config_key.clone() else {
            self.input_mode = InputMode::ConfigSelect;
            return;
        };
        let Some((value, _)) = self
            .config_enum_options
            .get(self.selected_config_enum_index)
            .cloned()
        else {
            self.input_mode = InputMode::ConfigSelect;
            return;
        };
        match config::set_value(&self.workdir, self.config_scope, &key, &value) {
            Ok(message) => {
                self.input_mode = InputMode::ConfigSelect;
                self.config_enum_options.clear();
                self.pending_config_key = None;
                let _ = self.reload_config_items();
                self.push_success_message(&message);
            }
            Err(error) => self.push_error_message(&format!("更新配置失败: {}", error)),
        }
    }

    pub(super) fn finish_config_number_input(&mut self) {
        let Some(key) = self.pending_config_key.clone() else {
            self.input_mode = InputMode::ConfigSelect;
            return;
        };
        let value = self.input.trim().to_string();
        match config::set_value(&self.workdir, self.config_scope, &key, &value) {
            Ok(message) => {
                self.input.clear();
                self.input_mode = InputMode::ConfigSelect;
                self.pending_config_key = None;
                let _ = self.reload_config_items();
                self.push_success_message(&message);
            }
            Err(error) => self.push_error_message(&format!("更新配置失败: {}", error)),
        }
    }
}
