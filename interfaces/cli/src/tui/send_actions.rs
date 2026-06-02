use super::{App, InputMode, Message, MessageRole};

impl App {
    pub(super) fn send_message(&mut self) {
        match self.input_mode {
            InputMode::Chat => {
                if self.input.is_empty() {
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

        let trimmed_input = self.input.trim().to_string();
        if !trimmed_input.is_empty() {
            self.sent_history.push(trimmed_input);
        }
        self.history_index = None;
        self.current_history_draft.clear();

        let now = chrono::Local::now();
        let timestamp = now.format("%Y-%m-%d %H:%M").to_string();

        let display_input = self.input.clone();
        self.append_message(Message {
            role: MessageRole::User,
            content: display_input,
            timestamp: timestamp.clone(),
            collapsed: false,
        });
        self.log_event(
            "user_message",
            &self
                .messages
                .last()
                .map(|msg| msg.content.clone())
                .unwrap_or_default(),
        );

        let user_input = self.decorate_pending_answer(&self.input.clone());
        self.input.clear();
        self.enqueue_or_start_message(user_input);
        self.save_current_session();
        self.scroll_to_bottom();
    }
}
