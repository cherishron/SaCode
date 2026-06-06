use std::path::Path;

use sacode_runtime::{PluginLoader, PluginRegistry, SkillHubClient};

use crate::plugin_config::{PluginConfigStore, PluginEntry, PluginSource};

use super::{block_on_cli_future, App};

impl App {
    pub(super) fn plugin_command(&mut self, input: &str) {
        let parts: Vec<&str> = input.split_whitespace().collect();
        let global = parts
            .iter()
            .any(|part| *part == "--global" || *part == "-g");
        let plugin_file = if global {
            PluginConfigStore::new(&self.workdir)
                .user_path()
                .to_path_buf()
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
                    self.push_system_message("用法: /plugin install <name> [--global|-g]");
                }
            }
            Some("search") => {
                if parts.len() > 2 {
                    self.search_plugins(parts[2]);
                } else {
                    self.push_system_message("用法: /plugin search <keyword>");
                }
            }
            Some("show") => {
                if parts.len() > 2 {
                    self.show_plugin(parts[2]);
                } else {
                    self.push_system_message("用法: /plugin show <name>");
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
                "用法: /plugin list|search|show|install|remove|enable|disable [--global|-g]",
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
                let status = if entry.plugin.enabled {
                    "[on]"
                } else {
                    "[off]"
                };
                format!(
                    "- {} {} {} [{}:{}]",
                    entry.plugin.name,
                    status,
                    version,
                    if entry.plugin.kind.trim().is_empty() {
                        "configured"
                    } else {
                        entry.plugin.kind.as_str()
                    },
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
        let store = PluginConfigStore::new(&self.workdir);
        let source = source_from_plugin_path(&store, plugin_file);
        match store.upsert(
            PluginEntry {
                name: plugin_ref.to_string(),
                version: "latest".to_string(),
                enabled: true,
                description: "Configured plugin entry".to_string(),
                kind: "configured".to_string(),
                source_ref: source.label().to_string(),
            },
            source,
        ) {
            Ok(()) => self.push_success_message(&format!("插件 {} 已安装", plugin_ref)),
            Err(error) => self.push_error_message(&format!("保存插件配置失败: {}", error)),
        }
    }

    pub(super) fn remove_plugin(&mut self, plugin_file: &Path, name: &str) {
        let store = PluginConfigStore::new(&self.workdir);
        match store.remove(name, source_from_plugin_path(&store, plugin_file)) {
            Ok(()) => self.push_success_message(&format!("插件 {} 已卸载", name)),
            Err(error) => self.push_error_message(&format!("保存配置失败: {}", error)),
        }
    }

    pub(super) fn enable_plugin(&mut self, plugin_file: &Path, name: &str, enable: bool) {
        let store = PluginConfigStore::new(&self.workdir);
        match store.set_enabled(name, enable, source_from_plugin_path(&store, plugin_file)) {
            Ok(()) => self.push_success_message(&format!(
                "插件 {} 已{}",
                name,
                if enable { "启用" } else { "禁用" }
            )),
            Err(error) => self.push_error_message(&format!("保存配置失败: {}", error)),
        }
    }

    fn search_plugins(&mut self, query: &str) {
        let store = PluginConfigStore::new(&self.workdir);
        let local_entries = match block_on_cli_future(discover_plugin_entries(&self.workdir, &store)) {
            Ok(entries) => entries,
            Err(error) => {
                self.push_error_message(&format!("读取插件列表失败: {}", error));
                return;
            }
        };
        let local_matches: Vec<_> = local_entries
            .iter()
            .filter(|entry| plugin_matches(entry, query))
            .cloned()
            .collect();

        let remote_matches = match block_on_cli_future(SkillHubClient::new().search_plugins(query)) {
            Ok(entries) => entries,
            Err(_) => Vec::new(),
        };

        if local_matches.is_empty() && remote_matches.is_empty() {
            self.push_system_message("未找到匹配的插件。");
            return;
        }

        let mut lines = Vec::new();
        lines.push("插件搜索结果:".to_string());
        for entry in local_matches {
            lines.push(format!(
                "- {} [{}:{}]\n  {}",
                entry.name, entry.kind, entry.source, entry.description
            ));
        }
        for entry in remote_matches {
            lines.push(format!(
                "- {} [remote:skillhub]\n  {}\n  {} / v{}",
                entry.name, entry.description, entry.author, entry.version
            ));
        }
        self.push_system_message(&lines.join("\n"));
    }

    fn show_plugin(&mut self, name: &str) {
        let store = PluginConfigStore::new(&self.workdir);
        let local_entries = match block_on_cli_future(discover_plugin_entries(&self.workdir, &store)) {
            Ok(entries) => entries,
            Err(error) => {
                self.push_error_message(&format!("读取插件详情失败: {}", error));
                return;
            }
        };

        if let Some(entry) = local_entries.iter().find(|entry| entry.name == name) {
            let mut lines = Vec::new();
            lines.push(format!("Name: {}", entry.name));
            lines.push(format!("Description: {}", entry.description));
            lines.push(format!("Kind: {}", entry.kind));
            lines.push(format!("Source: {}", entry.source));
            lines.push(format!("Enabled: {}", if entry.enabled { "yes" } else { "no" }));
            if let Some(version) = &entry.version {
                lines.push(format!("Version: {}", version));
            }
            if let Some(tags) = &entry.tags {
                if !tags.is_empty() {
                    lines.push(format!("Tags: {}", tags.join(", ")));
                }
            }
            self.push_system_message(&lines.join("\n"));
            return;
        }

        match block_on_cli_future(SkillHubClient::new().get_plugin_info(name)) {
            Ok(entry) => {
                let mut lines = Vec::new();
                lines.push(format!("Name: {}", entry.name));
                lines.push(format!("Description: {}", entry.description));
                lines.push("Kind: remote".to_string());
                lines.push("Source: skillhub".to_string());
                lines.push(format!("Author: {}", entry.author));
                lines.push(format!("Version: {}", entry.version));
                if !entry.tags.is_empty() {
                    lines.push(format!("Tags: {}", entry.tags.join(", ")));
                }
                if !entry.download_url.trim().is_empty() {
                    lines.push(format!("Download URL: {}", entry.download_url));
                }
                self.push_system_message(&lines.join("\n"));
            }
            Err(error) => self.push_error_message(&format!("读取插件详情失败: {}", error)),
        }
    }
}

#[derive(Clone)]
struct TuiPluginEntry {
    name: String,
    description: String,
    kind: String,
    source: String,
    enabled: bool,
    version: Option<String>,
    tags: Option<Vec<String>>,
}

async fn discover_plugin_entries(
    workdir: &Path,
    store: &PluginConfigStore,
) -> anyhow::Result<Vec<TuiPluginEntry>> {
    let mut entries = Vec::new();
    let registry = PluginRegistry::discover(workdir).await;

    for entry in registry.list() {
        entries.push(TuiPluginEntry {
            name: entry.name.clone(),
            description: entry.description.clone(),
            kind: entry.kind.label().to_string(),
            source: entry.source_label.clone(),
            enabled: entry.enabled,
            version: entry.version.clone(),
            tags: Some(entry.tags.clone()),
        });
    }

    for entry in store.list_entries()? {
        entries.push(TuiPluginEntry {
            name: entry.plugin.name.clone(),
            description: if entry.plugin.description.trim().is_empty() {
                "Configured plugin entry".to_string()
            } else {
                entry.plugin.description.clone()
            },
            kind: if entry.plugin.kind.trim().is_empty() {
                "configured".to_string()
            } else {
                entry.plugin.kind.clone()
            },
            source: entry.source.label().to_string(),
            enabled: entry.plugin.enabled,
            version: if entry.plugin.version.trim().is_empty() {
                None
            } else {
                Some(entry.plugin.version.clone())
            },
            tags: None,
        });
    }

    entries.sort_by(|a, b| a.name.cmp(&b.name));
    entries.dedup_by(|a, b| a.name == b.name && a.kind == b.kind && a.source == b.source);
    Ok(entries)
}

fn plugin_matches(entry: &TuiPluginEntry, query: &str) -> bool {
    let needle = query.to_lowercase();
    entry.name.to_lowercase().contains(&needle)
        || entry.description.to_lowercase().contains(&needle)
        || entry.kind.to_lowercase().contains(&needle)
        || entry.source.to_lowercase().contains(&needle)
        || entry
            .tags
            .as_ref()
            .map(|tags| tags.iter().any(|tag| tag.to_lowercase().contains(&needle)))
            .unwrap_or(false)
}

fn source_from_plugin_path(store: &PluginConfigStore, plugin_file: &Path) -> PluginSource {
    if plugin_file == store.user_path() {
        PluginSource::User
    } else {
        PluginSource::Project
    }
}
