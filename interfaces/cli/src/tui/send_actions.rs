use super::{App, InputMode};

impl App {
    pub(super) fn send_message(&mut self) {
        match self.input_mode {
            InputMode::Chat => {
                if self.input.is_empty() {
                    return;
                }
                // Slash commands are always executable, even before login.
                let trimmed = self.input.trim();
                if trimmed == "/login"
                    || trimmed == "/login browser"
                    || trimmed == "/login device"
                    || trimmed == "/connect"
                    || trimmed == "/config"
                    || trimmed.starts_with("/config ")
                    || trimmed == "/providers"
                    || trimmed == "/models"
                    || trimmed == "/status"
                    || trimmed == "/doctor"
                    || trimmed == "/help"
                    || trimmed == "/clear"
                    || trimmed == "/new"
                    || trimmed == "/sessions"
                    || trimmed == "/logout"
                    || trimmed.starts_with("/provider-")
                    || trimmed.starts_with("/add-dir")
                {
                    // Skip product_ready gate for infrastructure commands.
                } else if !crate::product_path::product_ready(&self.workdir) {
                    self.push_system_message(
                        "尚未接入 saai 模型。请 /login 登录 sa-idp（主路径）；本地/自定义 Provider 用 /connect。",
                    );
                    return;
                }
            }
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
            InputMode::ThemeSelect => {
                self.confirm_theme_selection();
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
            InputMode::TasksSelect => {
                return;
            }
            InputMode::CheckpointSelect => {
                return;
            }
            InputMode::ConfigSelect | InputMode::ConfigEnumSelect => {
                return;
            }
            InputMode::ConfigNumberInput => {
                self.finish_config_number_input();
                return;
            }
            InputMode::ConfigTextInput => {
                self.finish_config_text_input();
                return;
            }
            InputMode::TaskInput => {
                self.finish_task_input();
                return;
            }
            InputMode::SessionSelect => {
                return;
            }
            InputMode::ModeSelect => {
                return;
            }
            InputMode::InputOptimizePreview => {
                self.apply_pending_input_optimization();
                return;
            }
            InputMode::TodoConfirm => {
                self.confirm_todo_plan();
                return;
            }
            InputMode::PendingQuestion => {
                self.submit_pending_question_answer();
                return;
            }
            _ => {
                // Provider add flow and other modes are handled by handle_enter_key.
                return;
            }
        }

        if self.input == "/login" || self.input == "/login browser" {
            self.start_sa_idp_login(false);
            return;
        }

        if self.input == "/login device" {
            self.start_sa_idp_login(true);
            return;
        }

        if self.input == "/logout" {
            self.do_logout();
            return;
        }

        if self.input == "/models" {
            self.open_model_picker();
            return;
        }

        if self.input == "/providers" || self.input == "/providers list" {
            self.open_provider_picker();
            return;
        }

        if self.input == "/providers add" {
            self.start_provider_add();
            return;
        }

        if self.input.starts_with("/providers use ") {
            let name = self.input["/providers use ".len()..].trim().to_string();
            if !name.is_empty() {
                self.switch_provider_by_name(&name);
            }
            return;
        }

        if self.input.starts_with("/providers remove ") {
            let name = self.input["/providers remove ".len()..].trim().to_string();
            if !name.is_empty() {
                self.provider_store
                    .remove(&name)
                    .map(|_| {
                        self.push_system_message(&format!("Provider {} 已删除。", name));
                    })
                    .unwrap_or_else(|e| {
                        self.push_system_message(&format!("删除失败: {}", e));
                    });
            }
            return;
        }

        if self.input.starts_with("/providers rename ") {
            let rest = self.input["/providers rename ".len()..].trim();
            if let Some(space) = rest.find(' ') {
                let from = rest[..space].trim().to_string();
                let to = rest[space + 1..].trim().to_string();
                if !from.is_empty() && !to.is_empty() {
                    match self.provider_store.rename(&from, &to) {
                        Ok(()) => {
                            self.push_system_message(&format!(
                                "Provider {} 已重命名为 {}。",
                                from, to
                            ));
                        }
                        Err(e) => {
                            self.push_system_message(&format!("重命名失败: {}", e));
                        }
                    }
                }
            }
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

        let trimmed_input = self.input.trim().to_string();
        if !trimmed_input.is_empty() {
            self.sent_history.push(trimmed_input);
        }
        self.history_index = None;
        self.current_history_draft.clear();

        let user_input = self.decorate_pending_answer(&self.input.clone());
        self.input.clear();
        self.enqueue_or_start_message(user_input);
        self.save_current_session();
        self.scroll_to_bottom();
    }
}
