use std::{env, path::Path};

use super::{App, InputMode, Message, MessageRole};

impl App {
    pub(super) fn checkpoint_command(&mut self, input: &str) {
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
                    self.restore_checkpoint(&checkpoint_dir, parts[2]);
                } else {
                    self.pending_checkpoint_action = Some("restore".to_string());
                    self.open_checkpoint_selector(&checkpoint_dir);
                }
            }
            Some("delete") => {
                if parts.len() > 2 {
                    self.delete_checkpoint(&checkpoint_dir, parts[2]);
                } else {
                    self.pending_checkpoint_action = Some("delete".to_string());
                    self.open_checkpoint_selector(&checkpoint_dir);
                }
            }
            Some("save") => {
                if parts.len() > 2 {
                    self.save_checkpoint(&checkpoint_dir, parts[2]);
                } else {
                    self.push_system_message("用法: /checkpoint save <name>");
                }
            }
            _ => self.push_system_message("用法: /checkpoint list|save|restore|delete"),
        }
    }

    pub(super) fn open_checkpoint_selector(&mut self, checkpoint_dir: &Path) {
        if !checkpoint_dir.exists() {
            self.push_system_message("当前没有检查点。使用 /checkpoint save <name> 创建检查点。");
            return;
        }

        let checkpoints: Vec<String> = std::fs::read_dir(checkpoint_dir)
            .ok()
            .map(|entries| {
                entries
                    .filter_map(|entry| entry.ok())
                    .filter(|entry| {
                        entry
                            .path()
                            .extension()
                            .map(|ext| ext == "json")
                            .unwrap_or(false)
                    })
                    .map(|entry| {
                        entry
                            .path()
                            .file_stem()
                            .unwrap()
                            .to_string_lossy()
                            .to_string()
                    })
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

    pub(super) fn confirm_checkpoint_selection(&mut self) {
        let selected_name = self
            .checkpoint_options
            .get(self.selected_checkpoint_index)
            .cloned();
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

    pub(super) fn save_checkpoint(&mut self, checkpoint_dir: &Path, name: &str) {
        if let Err(error) = std::fs::create_dir_all(checkpoint_dir) {
            self.push_error_message(&format!("创建检查点目录失败: {}", error));
            return;
        }

        let checkpoint_file = checkpoint_dir.join(format!("{}.json", name));
        let checkpoint_data = serde_json::json!({
            "timestamp": chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string(),
            "messages": self.messages.iter().map(|message| serde_json::json!({
                "role": match message.role {
                    MessageRole::User => "user",
                    MessageRole::Assistant => "assistant",
                    MessageRole::System => "system",
                },
                "content": message.content,
                "timestamp": message.timestamp,
            })).collect::<Vec<_>>(),
        });

        match std::fs::write(&checkpoint_file, checkpoint_data.to_string()) {
            Ok(()) => self.push_success_message(&format!("检查点 {} 已保存", name)),
            Err(error) => self.push_error_message(&format!("保存检查点失败: {}", error)),
        }
    }

    pub(super) fn restore_checkpoint(&mut self, checkpoint_dir: &Path, name: &str) {
        let checkpoint_file = checkpoint_dir.join(format!("{}.json", name));

        match std::fs::read_to_string(&checkpoint_file) {
            Ok(content) => match serde_json::from_str::<serde_json::Value>(&content) {
                Ok(data) => {
                    if let Some(messages) = data
                        .get("messages")
                        .and_then(|messages| messages.as_array())
                    {
                        self.replace_messages(
                            messages
                                .iter()
                                .filter_map(|message| {
                                    let role = message
                                        .get("role")
                                        .and_then(|role| role.as_str())
                                        .unwrap_or("system");
                                    let content = message
                                        .get("content")
                                        .and_then(|content| content.as_str())
                                        .unwrap_or("");
                                    let timestamp = message
                                        .get("timestamp")
                                        .and_then(|timestamp| timestamp.as_str())
                                        .unwrap_or("");

                                    Some(Message {
                                        role: match role {
                                            "user" => MessageRole::User,
                                            "assistant" => MessageRole::Assistant,
                                            _ => MessageRole::System,
                                        },
                                        content: content.to_string(),
                                        thinking: message
                                            .get("thinking")
                                            .and_then(|value| value.as_str())
                                            .unwrap_or("")
                                            .to_string(),
                                        timestamp: timestamp.to_string(),
                                        collapsed: message
                                            .get("collapsed")
                                            .and_then(|value| value.as_bool())
                                            .unwrap_or(false),
                                    })
                                })
                                .collect(),
                        );
                        self.push_success_message(&format!("检查点 {} 已恢复", name));
                        self.scroll_to_bottom();
                    }
                }
                Err(error) => self.push_error_message(&format!("解析检查点失败: {}", error)),
            },
            Err(error) => self.push_error_message(&format!("读取检查点失败: {}", error)),
        }
    }

    pub(super) fn delete_checkpoint(&mut self, checkpoint_dir: &Path, name: &str) {
        let checkpoint_file = checkpoint_dir.join(format!("{}.json", name));

        match std::fs::remove_file(&checkpoint_file) {
            Ok(()) => self.push_success_message(&format!("检查点 {} 已删除", name)),
            Err(error) => self.push_error_message(&format!("删除检查点失败: {}", error)),
        }
    }
}
