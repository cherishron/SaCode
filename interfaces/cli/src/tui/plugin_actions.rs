use std::path::Path;

use crate::plugin_config::PluginConfigStore;

use super::App;

impl App {
    pub(super) fn plugin_command(&mut self, input: &str) {
        let parts: Vec<&str> = input.split_whitespace().collect();
        let global = parts.iter().any(|part| *part == "--global" || *part == "-g");
        let plugin_file = if global {
            PluginConfigStore::new(&self.workdir).user_path().to_path_buf()
        } else {
            PluginConfigStore::new(&self.workdir)
                .project_path()
                .to_path_buf()
        };

        if parts.len() <= 1 || parts[1] == "list" {
            self.list_plugins(&plugin_file);
            return;
        }

        match parts.get(1).copied() {
            Some("install") => {
                if parts.len() > 2 {
                    self.install_plugin(&plugin_file, parts[2]);
                } else {
                    self.push_system_message("用法: /plugin install <name|url> [--global|-g]");
                }
            }
            Some("remove") => {
                if parts.len() > 2 {
                    self.remove_plugin(&plugin_file, parts[2]);
                } else {
                    self.push_system_message("用法: /plugin remove <name> [--global|-g]");
                }
            }
            Some("enable") => {
                if parts.len() > 2 {
                    self.enable_plugin(&plugin_file, parts[2], true);
                } else {
                    self.push_system_message("用法: /plugin enable <name> [--global|-g]");
                }
            }
            Some("disable") => {
                if parts.len() > 2 {
                    self.enable_plugin(&plugin_file, parts[2], false);
                } else {
                    self.push_system_message("用法: /plugin disable <name> [--global|-g]");
                }
            }
            _ => self.push_system_message(
                "用法: /plugin list|install|remove|enable|disable [--global|-g]",
            ),
        }
    }

    pub(super) fn list_plugins(&mut self, _plugin_file: &Path) {
        let store = PluginConfigStore::new(&self.workdir);
        let entries = match store.list_entries() {
            Ok(entries) => entries,
            Err(error) => {
                self.push_error_message(&format!("读取插件配置失败: {}", error));
                return;
            }
        };

        if entries.is_empty() {
            self.push_system_message("当前没有安装任何插件。\n\n可用内置功能:\n- Skills: /skills list\n- MCP: /mcps list\n\n安装插件: /plugin install <name>");
            return;
        }

        let summary = entries
            .iter()
            .map(|entry| {
                let version = if entry.plugin.version.trim().is_empty() {
                    "latest"
                } else {
                    entry.plugin.version.as_str()
                };
                let status = if entry.plugin.enabled { "[on]" } else { "[off]" };
                format!(
                    "- {} {} {} [{}]",
                    entry.plugin.name,
                    status,
                    version,
                    entry.source.label()
                )
            })
            .collect::<Vec<_>>()
            .join("\n");
        self.push_system_message(&format!(
            "已安装插件:\n{}\n\n管理命令:\n/plugin enable|disable <name>",
            summary
        ));
    }

    pub(super) fn install_plugin(&mut self, plugin_file: &Path, plugin_ref: &str) {
        if let Err(error) = std::fs::create_dir_all(plugin_file.parent().unwrap()) {
            self.push_error_message(&format!("创建配置目录失败: {}", error));
            return;
        }

        let existing = if plugin_file.exists() {
            std::fs::read_to_string(plugin_file)
                .ok()
                .and_then(|content| serde_json::from_str::<serde_json::Value>(&content).ok())
                .and_then(|data| data.get("plugins").and_then(|plugins| plugins.as_array()).cloned())
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
        if plugins
            .iter()
            .any(|plugin| plugin.get("name").and_then(|name| name.as_str()) == Some(plugin_ref))
        {
            self.push_system_message(&format!("插件 {} 已存在。", plugin_ref));
            return;
        }
        plugins.push(new_plugin);

        let config = serde_json::json!({ "plugins": plugins });
        match std::fs::write(plugin_file, config.to_string()) {
            Ok(()) => self.push_success_message(&format!("插件 {} 已安装", plugin_ref)),
            Err(error) => self.push_error_message(&format!("保存插件配置失败: {}", error)),
        }
    }

    pub(super) fn remove_plugin(&mut self, plugin_file: &Path, name: &str) {
        if !plugin_file.exists() {
            self.push_system_message("插件配置不存在。");
            return;
        }

        match std::fs::read_to_string(plugin_file) {
            Ok(content) => match serde_json::from_str::<serde_json::Value>(&content) {
                Ok(data) => {
                    if let Some(plugins) = data.get("plugins").and_then(|plugins| plugins.as_array()) {
                        let filtered: Vec<_> = plugins
                            .iter()
                            .filter(|plugin| {
                                plugin.get("name").and_then(|plugin_name| plugin_name.as_str())
                                    != Some(name)
                            })
                            .collect();

                        if filtered.len() == plugins.len() {
                            self.push_system_message(&format!("插件 {} 不存在。", name));
                            return;
                        }

                        let config = serde_json::json!({ "plugins": filtered });
                        match std::fs::write(plugin_file, config.to_string()) {
                            Ok(()) => self.push_success_message(&format!("插件 {} 已卸载", name)),
                            Err(error) => {
                                self.push_error_message(&format!("保存配置失败: {}", error))
                            }
                        }
                    }
                }
                Err(error) => self.push_error_message(&format!("解析配置失败: {}", error)),
            },
            Err(error) => self.push_error_message(&format!("读取配置失败: {}", error)),
        }
    }

    pub(super) fn enable_plugin(&mut self, plugin_file: &Path, name: &str, enable: bool) {
        if !plugin_file.exists() {
            self.push_system_message("插件配置不存在。");
            return;
        }

        match std::fs::read_to_string(plugin_file) {
            Ok(content) => match serde_json::from_str::<serde_json::Value>(&content) {
                Ok(data) => {
                    if let Some(plugins) = data
                        .get("plugins")
                        .and_then(|plugins| plugins.as_array())
                        .cloned()
                    {
                        let mut found = false;
                        let updated: Vec<_> = plugins
                            .iter()
                            .map(|plugin| {
                                if plugin.get("name").and_then(|plugin_name| plugin_name.as_str())
                                    == Some(name)
                                {
                                    found = true;
                                    let mut updated = plugin.clone();
                                    updated["enabled"] = serde_json::json!(enable);
                                    updated
                                } else {
                                    plugin.clone()
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
                            Err(error) => {
                                self.push_error_message(&format!("保存配置失败: {}", error))
                            }
                        }
                    }
                }
                Err(error) => self.push_error_message(&format!("解析配置失败: {}", error)),
            },
            Err(error) => self.push_error_message(&format!("读取配置失败: {}", error)),
        }
    }
}
