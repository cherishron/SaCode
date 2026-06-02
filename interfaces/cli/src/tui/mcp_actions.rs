use std::path::Path;

use sacode_runtime::{McpConfigStore, McpSource};

use super::{App, InputMode};

impl App {
    pub(super) fn mcp_command(&mut self, input: &str) {
        let parts: Vec<&str> = input.split_whitespace().collect();
        let store = McpConfigStore::new(Path::new("."));

        if parts.len() <= 1 || parts[1] == "list" {
            self.open_mcp_selector();
            return;
        }

        match parts.get(1).copied() {
            Some("show") => {
                if parts.len() > 2 {
                    match store.get(parts[2]) {
                        Ok(server) => self.push_system_message(&format!(
                            "Name: {}\nType: {}\nEnabled: {}\nURL: {}",
                            parts[2], server.server_type, server.enabled, server.url
                        )),
                        Err(error) => {
                            self.push_error_message(&format!("读取 MCP 服务失败: {}", error))
                        }
                    }
                } else {
                    self.open_mcp_selector_for_action("show");
                }
            }
            Some("remove") => {
                if parts.len() > 2 {
                    match store.remove(parts[2], McpSource::Project) {
                        Ok(()) => {
                            self.push_success_message(&format!("MCP 服务 {} 已删除", parts[2]))
                        }
                        Err(error) => {
                            self.push_error_message(&format!("删除 MCP 服务失败: {}", error))
                        }
                    }
                } else {
                    self.open_mcp_selector_for_action("remove");
                }
            }
            _ => self.push_system_message("用法: /mcps list|show|remove"),
        }
    }

    pub(super) fn open_mcp_selector(&mut self) {
        let store = McpConfigStore::new(Path::new("."));
        match store.list_entries() {
            Ok(entries) if entries.is_empty() => self.push_system_message("当前没有配置 MCP 服务"),
            Ok(entries) => {
                self.mcp_options = entries
                    .into_iter()
                    .map(|entry| {
                        (
                            entry.name,
                            format!("{} [{}]", entry.server.url, entry.source.label()),
                            entry.server.enabled,
                        )
                    })
                    .collect();
                self.selected_mcp_index = 0;
                self.input_mode = InputMode::McpSelect;
            }
            Err(error) => self.push_error_message(&format!("读取 MCP 配置失败: {}", error)),
        }
    }

    pub(super) fn open_mcp_selector_for_action(&mut self, action: &str) {
        self.pending_mcp_action = Some(action.to_string());
        self.open_mcp_selector();
    }

    pub(super) fn confirm_mcp_selection(&mut self) {
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
                        name,
                        url,
                        if enabled { "启用" } else { "禁用" }
                    ));
                }
                Some("remove") => {
                    let store = McpConfigStore::new(Path::new("."));
                    match store.remove(&name, McpSource::Project) {
                        Ok(()) => self.push_success_message(&format!("MCP 服务 {} 已删除", name)),
                        Err(error) => self.push_error_message(&format!("删除失败: {}", error)),
                    }
                }
                _ => {
                    self.push_system_message(&format!(
                        "MCP 服务: {}\nURL: {}\n状态: {}",
                        name,
                        url,
                        if enabled { "启用" } else { "禁用" }
                    ));
                }
            }
        }
    }
}
