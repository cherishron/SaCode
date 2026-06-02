use super::{App, InputMode};

impl App {
    pub(super) fn cancel_current_mode(&mut self) {
        self.input.clear();
        self.pending_base_url = None;
        self.pending_provider_name = None;
        self.pending_skill_action = None;
        self.pending_mcp_action = None;
        self.pending_checkpoint_action = None;
        if self.input_mode == InputMode::ProviderSelect {
            self.push_system_message("已取消 provider 选择");
        }
        if self.input_mode == InputMode::ProviderRename {
            self.push_system_message("已取消 provider 重命名");
        }
        if self.input_mode == InputMode::ModelSelect {
            self.push_system_message("已取消模型选择");
        }
        if self.input_mode == InputMode::ThemeSelect {
            self.push_system_message("已取消主题选择");
            self.selected_theme_index = 0;
        }
        if matches!(
            self.input_mode,
            InputMode::LoginBaseUrl | InputMode::LoginApiKey
        ) {
            self.push_system_message("已取消登录配置");
        }
        if self.input_mode == InputMode::SkillsSelect {
            self.push_system_message("已取消 skills 选择");
            self.skills_options.clear();
            self.selected_skills_index = 0;
        }
        if self.input_mode == InputMode::McpSelect {
            self.push_system_message("已取消 MCP 选择");
            self.mcp_options.clear();
            self.selected_mcp_index = 0;
        }
        if self.input_mode == InputMode::TasksSelect {
            self.push_system_message("已取消任务选择");
            self.task_options.clear();
            self.selected_task_index = 0;
            self.pending_task_action = None;
            self.pending_task_edit_id = None;
        }
        if self.input_mode == InputMode::CheckpointSelect {
            self.push_system_message("已取消检查点选择");
            self.checkpoint_options.clear();
            self.selected_checkpoint_index = 0;
        }
        if self.input_mode == InputMode::SessionSelect {
            self.push_system_message("已取消会话切换");
            self.session_options.clear();
            self.selected_session_index = 0;
        }
        if self.input_mode == InputMode::ConfigSelect {
            self.push_system_message("已取消配置管理");
            self.config_items.clear();
            self.selected_config_index = 0;
        }
        if self.input_mode == InputMode::ConfigEnumSelect {
            self.config_enum_options.clear();
        }
        if self.input_mode == InputMode::ConfigNumberInput {
            self.input.clear();
        }
        if self.input_mode == InputMode::InputOptimizePreview {
            self.pending_input_optimization = None;
        }
        self.pending_config_key = None;
        self.filtered_level1.clear();
        self.filtered_sub_commands.clear();
        self.selected_level1_index = 0;
        self.selected_sub_index = 0;
        self.current_level1 = None;
        self.input_mode = InputMode::Chat;
    }
}
