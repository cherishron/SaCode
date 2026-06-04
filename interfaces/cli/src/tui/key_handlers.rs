use super::{App, InputMode};
use crossterm::event::{KeyCode, KeyEvent, KeyModifiers};

impl App {
    pub(super) fn handle_key_event(&mut self, key: KeyEvent) {
        let vim_mode = self
            .sacode_store
            .load_effective()
            .map(|config| config.vim_mode)
            .unwrap_or(false);

        if key.code == KeyCode::Char('q') && key.modifiers.contains(KeyModifiers::CONTROL) {
            self.should_quit = true;
            return;
        }

        if key.code == KeyCode::Esc && self.handle_escape_key() {
            return;
        }

        if key.code == KeyCode::Enter && self.handle_enter_key() {
            return;
        }

        if key.code == KeyCode::Tab && self.handle_tab_key() {
            return;
        }

        if self.handle_navigation_key(key, vim_mode) {
            return;
        }

        if self.handle_chat_control_key(key) {
            return;
        }

        if key.code == KeyCode::Backspace && self.handle_backspace_key() {
            return;
        }

        if self.handle_text_input_key(key) {
            return;
        }
    }

    pub(super) fn handle_escape_key(&mut self) -> bool {
        if self.queue.processing && self.input_mode == InputMode::Chat {
            self.cancel_active_task();
            return true;
        }
        if self.input_mode == InputMode::InputOptimizePreview {
            self.cancel_pending_input_optimization();
            return true;
        }
        if self.input_mode == InputMode::TodoConfirm {
            self.cancel_todo_confirmation();
            return true;
        }
        if self.input_mode == InputMode::PendingQuestion {
            self.input_mode = InputMode::Chat;
            self.input.clear();
            self.push_system_message("已返回聊天输入。使用 /answer <内容> 可继续当前等待问题。");
            return true;
        }
        if self.input_mode == InputMode::CommandLevel2 {
            self.input_mode = InputMode::CommandLevel1;
            self.filtered_sub_commands.clear();
            self.selected_sub_index = 0;
            if let Some(level1) = &self.current_level1 {
                self.input = level1.name.clone();
            }
        } else if self.input_mode == InputMode::CommandLevel1 {
            self.input_mode = InputMode::Chat;
            self.filtered_level1.clear();
            self.selected_level1_index = 0;
            self.current_level1 = None;
            self.input.clear();
        } else {
            self.cancel_current_mode();
        }
        true
    }

    pub(super) fn handle_enter_key(&mut self) -> bool {
        if self.should_resume_pending_question_on_enter() {
            self.resume_pending_question_with_answer("");
            return true;
        }
        match self.input_mode {
            InputMode::ConnectSelect => self.confirm_connect_selection(),
            InputMode::ThemeSelect => self.confirm_theme_selection(),
            InputMode::ConnectApiKey => self.finish_connect(),
            InputMode::CommandLevel1 => self.confirm_level1_selection(),
            InputMode::CommandLevel2 => self.confirm_sub_selection(),
            InputMode::SkillsSelect => self.confirm_skills_selection(),
            InputMode::McpSelect => self.confirm_mcp_selection(),
            InputMode::TasksSelect => self.confirm_task_selection(),
            InputMode::CheckpointSelect => self.confirm_checkpoint_selection(),
            InputMode::ModeSelect => self.confirm_mode_selection(),
            InputMode::SessionSelect => self.confirm_session_selection(),
            InputMode::ConfigSelect => self.confirm_config_selection(),
            InputMode::ConfigEnumSelect => self.confirm_config_enum_selection(),
            InputMode::ConfigNumberInput => self.finish_config_number_input(),
            InputMode::TaskInput => self.finish_task_input(),
            InputMode::InputOptimizePreview => self.apply_pending_input_optimization(),
            InputMode::TodoConfirm => self.confirm_todo_plan(),
            InputMode::PendingQuestion => self.submit_pending_question_answer(),
            _ => self.send_message(),
        }
        true
    }

    pub(super) fn handle_tab_key(&mut self) -> bool {
        if self.input_mode == InputMode::CommandLevel1 {
            if let Some(cmd) = self.filtered_level1.get(self.selected_level1_index) {
                self.input = cmd.name.clone();
                if cmd.direct_execute {
                    self.confirm_level1_selection();
                } else if !cmd.sub_commands.is_empty() {
                    self.input.push(' ');
                    self.input_mode = InputMode::CommandLevel2;
                    self.current_level1 = Some(cmd.clone());
                    self.filtered_sub_commands = cmd.sub_commands.clone();
                    self.selected_sub_index = 0;
                }
            }
        } else if self.input_mode == InputMode::ConfigSelect {
            self.toggle_config_scope();
        } else if self.input_mode == InputMode::CommandLevel2 {
            if let Some(sub) = self.filtered_sub_commands.get(self.selected_sub_index) {
                let current = self.input.split_whitespace().collect::<Vec<_>>();
                if current.len() >= 2 {
                    self.input = format!("{} {}", current[0], sub.name);
                    if sub.needs_input {
                        self.input.push(' ');
                    }
                }
            }
        }
        true
    }

    pub(super) fn handle_navigation_key(&mut self, key: KeyEvent, vim_mode: bool) -> bool {
        match key.code {
            KeyCode::Char('r') if self.input_mode == InputMode::ProviderSelect => {
                self.start_provider_rename();
            }
            KeyCode::Char('d') if self.input_mode == InputMode::ProviderSelect => {
                self.remove_selected_provider();
            }
            KeyCode::Char('h') if vim_mode => {
                if self.input_mode == InputMode::CommandLevel2 || self.input_mode != InputMode::Chat
                {
                    self.cancel_current_mode();
                }
            }
            KeyCode::Char('j') if vim_mode && self.input_mode == InputMode::ProviderSelect => {
                if self.selected_provider_index + 1 < self.provider_options.len() {
                    self.selected_provider_index += 1;
                }
            }
            KeyCode::Char('k') if vim_mode && self.input_mode == InputMode::ProviderSelect => {
                self.selected_provider_index = self.selected_provider_index.saturating_sub(1);
            }
            KeyCode::Up if self.input_mode == InputMode::ProviderSelect => {
                self.selected_provider_index = self.selected_provider_index.saturating_sub(1);
            }
            KeyCode::Down if self.input_mode == InputMode::ProviderSelect => {
                if self.selected_provider_index + 1 < self.provider_options.len() {
                    self.selected_provider_index += 1;
                }
            }
            KeyCode::Up if self.input_mode == InputMode::ModelSelect => {
                self.selected_model_index = self.selected_model_index.saturating_sub(1);
            }
            KeyCode::Down if self.input_mode == InputMode::ModelSelect => {
                if self.selected_model_index + 1 < self.model_options.len() {
                    self.selected_model_index += 1;
                }
            }
            KeyCode::Up if self.input_mode == InputMode::ThemeSelect => {
                self.selected_theme_index = self.selected_theme_index.saturating_sub(1);
            }
            KeyCode::Down if self.input_mode == InputMode::ThemeSelect => {
                if self.selected_theme_index + 1 < self.theme_options.len() {
                    self.selected_theme_index += 1;
                }
            }
            KeyCode::Up if self.input_mode == InputMode::ConnectSelect => {
                self.selected_connect_index = self.selected_connect_index.saturating_sub(1);
            }
            KeyCode::Down if self.input_mode == InputMode::ConnectSelect => {
                if self.selected_connect_index + 1 < self.connect_options.len() {
                    self.selected_connect_index += 1;
                }
            }
            KeyCode::Char('k') if vim_mode && self.input_mode == InputMode::CommandLevel1 => {
                self.selected_level1_index = self.selected_level1_index.saturating_sub(1);
            }
            KeyCode::Char('j') if vim_mode && self.input_mode == InputMode::CommandLevel1 => {
                if self.selected_level1_index + 1 < self.filtered_level1.len() {
                    self.selected_level1_index += 1;
                }
            }
            KeyCode::Char('l') if vim_mode && self.input_mode == InputMode::CommandLevel1 => {
                self.confirm_level1_selection();
            }
            KeyCode::Up if self.input_mode == InputMode::CommandLevel1 => {
                self.selected_level1_index = self.selected_level1_index.saturating_sub(1);
            }
            KeyCode::Down if self.input_mode == InputMode::CommandLevel1 => {
                if self.selected_level1_index + 1 < self.filtered_level1.len() {
                    self.selected_level1_index += 1;
                }
            }
            KeyCode::Up if self.input_mode == InputMode::CommandLevel2 => {
                self.selected_sub_index = self.selected_sub_index.saturating_sub(1);
            }
            KeyCode::Down if self.input_mode == InputMode::CommandLevel2 => {
                if self.selected_sub_index + 1 < self.filtered_sub_commands.len() {
                    self.selected_sub_index += 1;
                }
            }
            KeyCode::Char('k') if vim_mode && self.input_mode == InputMode::CommandLevel2 => {
                self.selected_sub_index = self.selected_sub_index.saturating_sub(1);
            }
            KeyCode::Char('j') if vim_mode && self.input_mode == InputMode::CommandLevel2 => {
                if self.selected_sub_index + 1 < self.filtered_sub_commands.len() {
                    self.selected_sub_index += 1;
                }
            }
            KeyCode::Char('l') if vim_mode && self.input_mode == InputMode::CommandLevel2 => {
                self.confirm_sub_selection();
            }
            KeyCode::Up if self.input_mode == InputMode::SkillsSelect => {
                self.selected_skills_index = self.selected_skills_index.saturating_sub(1);
            }
            KeyCode::Down if self.input_mode == InputMode::SkillsSelect => {
                if self.selected_skills_index + 1 < self.skills_options.len() {
                    self.selected_skills_index += 1;
                }
            }
            KeyCode::Up if self.input_mode == InputMode::McpSelect => {
                self.selected_mcp_index = self.selected_mcp_index.saturating_sub(1);
            }
            KeyCode::Down if self.input_mode == InputMode::McpSelect => {
                if self.selected_mcp_index + 1 < self.mcp_options.len() {
                    self.selected_mcp_index += 1;
                }
            }
            KeyCode::Up if self.input_mode == InputMode::CheckpointSelect => {
                self.selected_checkpoint_index = self.selected_checkpoint_index.saturating_sub(1);
            }
            KeyCode::Down if self.input_mode == InputMode::CheckpointSelect => {
                if self.selected_checkpoint_index + 1 < self.checkpoint_options.len() {
                    self.selected_checkpoint_index += 1;
                }
            }
            KeyCode::Up if self.input_mode == InputMode::TasksSelect => {
                self.selected_task_index = self.selected_task_index.saturating_sub(1);
            }
            KeyCode::Down if self.input_mode == InputMode::TasksSelect => {
                if self.selected_task_index + 1 < self.task_options.len() {
                    self.selected_task_index += 1;
                }
            }
            KeyCode::Up if self.input_mode == InputMode::ModeSelect => {
                self.selected_mode_index = self.selected_mode_index.saturating_sub(1);
            }
            KeyCode::Down if self.input_mode == InputMode::ModeSelect => {
                if self.selected_mode_index + 1 < self.mode_options.len() {
                    self.selected_mode_index += 1;
                }
            }
            KeyCode::Up if self.input_mode == InputMode::SessionSelect => {
                self.selected_session_index = self.selected_session_index.saturating_sub(1);
            }
            KeyCode::Down if self.input_mode == InputMode::SessionSelect => {
                if self.selected_session_index + 1 < self.session_options.len() {
                    self.selected_session_index += 1;
                }
            }
            KeyCode::Up if self.input_mode == InputMode::ConfigSelect => {
                self.selected_config_index = self.selected_config_index.saturating_sub(1);
            }
            KeyCode::Down if self.input_mode == InputMode::ConfigSelect => {
                if self.selected_config_index + 1 < self.config_items.len() {
                    self.selected_config_index += 1;
                }
            }
            KeyCode::Up if self.input_mode == InputMode::ConfigEnumSelect => {
                self.selected_config_enum_index = self.selected_config_enum_index.saturating_sub(1);
            }
            KeyCode::Down if self.input_mode == InputMode::ConfigEnumSelect => {
                if self.selected_config_enum_index + 1 < self.config_enum_options.len() {
                    self.selected_config_enum_index += 1;
                }
            }
            KeyCode::Left if self.input_mode == InputMode::PendingQuestion => {
                self.move_pending_question_tab(-1)
            }
            KeyCode::Right if self.input_mode == InputMode::PendingQuestion => {
                self.move_pending_question_tab(1)
            }
            KeyCode::Up if self.input_mode == InputMode::PendingQuestion => {
                self.move_pending_option(-1)
            }
            KeyCode::Down if self.input_mode == InputMode::PendingQuestion => {
                self.move_pending_option(1)
            }
            KeyCode::Char(' ') if self.input_mode == InputMode::PendingQuestion => {
                self.toggle_pending_option()
            }
            KeyCode::Char('k') if vim_mode && self.input_mode == InputMode::Chat => {
                if self.input_on_first_visible_line() {
                    self.navigate_history_up();
                } else {
                    self.scroll_input_up();
                }
            }
            KeyCode::Char('j') if vim_mode && self.input_mode == InputMode::Chat => {
                if self.input_on_last_visible_line() {
                    self.navigate_history_down();
                } else {
                    self.scroll_input_down();
                }
            }
            KeyCode::Up if self.input_mode == InputMode::Chat && !self.input.is_empty() => {
                if self.input_on_first_visible_line() {
                    self.navigate_history_up();
                } else {
                    self.scroll_input_up();
                }
            }
            KeyCode::Down if self.input_mode == InputMode::Chat && !self.input.is_empty() => {
                if self.input_on_last_visible_line() {
                    self.navigate_history_down();
                } else {
                    self.scroll_input_down();
                }
            }
            KeyCode::PageUp => {
                for _ in 0..5 {
                    self.scroll_up();
                }
            }
            KeyCode::PageDown => {
                for _ in 0..5 {
                    self.scroll_down();
                }
            }
            KeyCode::Up => return false,
            KeyCode::Down => return false,
            KeyCode::Char('k') if vim_mode => self.scroll_up(),
            KeyCode::Char('j') if vim_mode => self.scroll_down(),
            _ => return false,
        }
        true
    }

    pub(super) fn handle_chat_control_key(&mut self, key: KeyEvent) -> bool {
        match key.code {
            KeyCode::Char('a')
                if self.input_mode == InputMode::Chat
                    && key.modifiers.contains(KeyModifiers::CONTROL) =>
            {
                if !self.input.trim().is_empty() {
                    self.queue.busy_message = "正在使用当前模型优化输入...".to_string();
                    self.spawn_optimize_input_task(self.input.trim().to_string());
                    self.push_system_message("正在优化当前输入...");
                }
            }
            KeyCode::Char('s')
                if self.input_mode == InputMode::Chat
                    && key.modifiers.contains(KeyModifiers::CONTROL) =>
            {
                self.toggle_all_thinking_folds();
            }
            KeyCode::Char('t')
                if self.input_mode == InputMode::Chat
                    && key.modifiers.contains(KeyModifiers::CONTROL) =>
            {
                self.toggle_thinking_feature();
            }
            KeyCode::Char('m')
                if self.input_mode == InputMode::Chat
                    && key.modifiers.contains(KeyModifiers::ALT) =>
            {
                self.cycle_execution_mode();
            }
            KeyCode::Char('z')
                if self.input_mode == InputMode::Chat
                    && key.modifiers.contains(KeyModifiers::CONTROL) =>
            {
                if !self.queue.processing {
                    self.undo_last_input_optimization();
                }
            }
            KeyCode::Char('/') if self.input_mode == InputMode::Chat && self.input.is_empty() => {
                self.input_mode = InputMode::CommandLevel1;
                self.filtered_level1 = self.level1_commands.clone();
                self.selected_level1_index = 0;
                self.input.push('/');
            }
            _ => return false,
        }
        true
    }

    pub(super) fn handle_text_input_key(&mut self, key: KeyEvent) -> bool {
        match key.code {
            KeyCode::Char(c) if !key.modifiers.contains(KeyModifiers::CONTROL) => {
                if self.input_mode == InputMode::CommandLevel1 {
                    self.input.push(c);
                    self.filter_level1_commands();
                } else if self.input_mode == InputMode::CommandLevel2 {
                    self.input.push(c);
                    self.filter_sub_commands();
                } else {
                    self.input.push(c);
                }
            }
            _ => return false,
        }
        true
    }

    pub(super) fn handle_backspace_key(&mut self) -> bool {
        if matches!(
            self.input_mode,
            InputMode::ProviderSelect
                | InputMode::ModelSelect
                | InputMode::ThemeSelect
                | InputMode::ConnectSelect
                | InputMode::SkillsSelect
                | InputMode::McpSelect
                | InputMode::TasksSelect
                | InputMode::CheckpointSelect
                | InputMode::ConfigSelect
                | InputMode::ConfigEnumSelect
        ) {
            return false;
        }

        if self.input_mode == InputMode::CommandLevel1 {
            self.input.pop();
            if self.input.is_empty() || !self.input.starts_with('/') {
                self.input_mode = InputMode::Chat;
                self.filtered_level1.clear();
                self.selected_level1_index = 0;
            } else {
                self.filter_level1_commands();
            }
        } else if self.input_mode == InputMode::CommandLevel2 {
            self.input.pop();
            if let Some(level1) = &self.current_level1 {
                if self.input == level1.name || !self.input.starts_with(&level1.name) {
                    self.input_mode = InputMode::CommandLevel1;
                    self.filtered_sub_commands.clear();
                    self.selected_sub_index = 0;
                    self.filter_level1_commands();
                } else {
                    self.filter_sub_commands();
                }
            }
        } else {
            self.input.pop();
        }
        true
    }
}
