use super::{App, FoldAction, InitMode, InputMode};

impl App {
    pub(super) fn handle_local_command(&mut self) -> bool {
        let input = self.input.clone();
        let trimmed = input.trim();

        if trimmed.starts_with("/answer") {
            let answer = trimmed.strip_prefix("/answer").unwrap_or("").trim();
            if self.interaction.pending_question.is_none() {
                self.push_system_message("当前没有等待回答的任务。");
            } else if answer.is_empty() {
                self.push_system_message("用法: /answer <你的回答>");
            } else {
                self.resume_pending_question_with_answer(answer);
            }
            self.input.clear();
            return true;
        }

        if trimmed == "/init" {
            self.init_command(InitMode::Basic);
            self.input.clear();
            return true;
        }

        if trimmed == "/init-deep" {
            self.init_command(InitMode::Deep);
            self.input.clear();
            return true;
        }

        if trimmed.starts_with("/loop ") || trimmed == "/loop" {
            self.loop_command(&input);
            self.input.clear();
            return true;
        }

        if trimmed == "/new" {
            self.new_session_command();
            self.input.clear();
            return true;
        }

        if trimmed == "/sessions" {
            self.open_session_selector();
            self.input.clear();
            return true;
        }

        if trimmed == "/clear" {
            self.clear_current_context();
            self.input.clear();
            return true;
        }

        if trimmed == "/compress" {
            self.compress_current_context();
            self.input.clear();
            return true;
        }

        if trimmed.starts_with("/profile ") || trimmed == "/profile" {
            self.profile_command(&input);
            self.input.clear();
            return true;
        }

        if trimmed.starts_with("/plugin ") || trimmed == "/plugin" {
            self.plugin_command(&input);
            self.input.clear();
            return true;
        }

        if trimmed.starts_with("/checkpoint ") || trimmed == "/checkpoint" {
            self.checkpoint_command(&input);
            self.input.clear();
            return true;
        }

        if trimmed.starts_with("/mode ") || trimmed == "/mode" {
            self.mode_command(&input);
            self.input.clear();
            return true;
        }

        if trimmed.starts_with("/skills ") || trimmed == "/skills" || trimmed == "/skill" {
            self.skills_command(&input);
            self.input.clear();
            return true;
        }

        if trimmed.starts_with("/mcps ") || trimmed == "/mcps" {
            self.mcp_command(&input);
            self.input.clear();
            return true;
        }

        if trimmed == "/tools" {
            self.tools_command();
            self.input.clear();
            return true;
        }

        if trimmed == "/status" {
            self.status_command();
            self.input.clear();
            return true;
        }

        if trimmed == "/doctor" {
            self.doctor_command();
            self.input.clear();
            return true;
        }

        if trimmed.starts_with("/prompt") {
            self.prompt_command(&input);
            self.input.clear();
            return true;
        }

        if trimmed.starts_with("/diff") {
            self.diff_command(&input);
            self.input.clear();
            return true;
        }

        if trimmed == "/hooks" {
            self.hooks_command();
            self.input.clear();
            return true;
        }

        if trimmed.starts_with("/ide ") || trimmed == "/ide" {
            self.ide_command(&input);
            self.input.clear();
            return true;
        }

        if trimmed.starts_with("/config ") || trimmed == "/config" {
            self.config_command(&input);
            self.input.clear();
            return true;
        }

        if trimmed == "/keybindings" {
            self.keybindings_command();
            self.input.clear();
            return true;
        }

        if trimmed.starts_with("/outstyle ") || trimmed == "/outstyle" {
            self.outstyle_command(&input);
            self.input.clear();
            return true;
        }

        if trimmed.starts_with("/vim ") || trimmed == "/vim" {
            self.vim_command(&input);
            self.input.clear();
            return true;
        }

        if trimmed.starts_with("/memory ") || trimmed == "/memory" {
            self.memory_command(&input);
            self.input.clear();
            return true;
        }

        if trimmed.starts_with("/wiki ") || trimmed == "/wiki" {
            self.wiki_command(&input);
            self.input.clear();
            return true;
        }

        if trimmed == "/insight" {
            self.insight_command();
            self.input.clear();
            return true;
        }

        if trimmed.starts_with("/add-dir ") || trimmed == "/add-dir" {
            self.add_dir_command(&input);
            self.input.clear();
            return true;
        }

        if trimmed == "/stats" {
            self.show_usage_stats();
            self.input.clear();
            return true;
        }

        if trimmed == "/copy last" {
            self.copy_last_assistant_message();
            self.input.clear();
            return true;
        }

        if trimmed == "/fold last" {
            self.fold_last_assistant_message(FoldAction::Collapse);
            self.input.clear();
            return true;
        }

        if trimmed == "/expand last" {
            self.fold_last_assistant_message(FoldAction::Expand);
            self.input.clear();
            return true;
        }

        if trimmed == "/fold all" {
            self.fold_all_assistant_messages(FoldAction::Collapse);
            self.input.clear();
            return true;
        }

        if trimmed == "/expand all" {
            self.fold_all_assistant_messages(FoldAction::Expand);
            self.input.clear();
            return true;
        }

        if trimmed.starts_with("/theme") {
            self.theme_command(&input);
            self.input.clear();
            return true;
        }

        if trimmed.starts_with("/todo ") || trimmed == "/todo" {
            self.todo_command(&input);
            self.input.clear();
            return true;
        }

        if trimmed.starts_with("/tasks ") || trimmed == "/tasks" {
            self.tasks_command(&input);
            self.input.clear();
            return true;
        }

        if trimmed.starts_with("/update ") || trimmed == "/update" {
            self.update_command(&input);
            self.input.clear();
            return true;
        }

        if trimmed == "/cancel" {
            self.cancel_command();
            self.input.clear();
            return true;
        }

        if trimmed == "/help" {
            self.help_command();
            self.input.clear();
            return true;
        }

        if trimmed == "/quit" || trimmed == "/exit" {
            self.should_quit = true;
            self.input.clear();
            return true;
        }

        if trimmed == "/connect" {
            self.input_mode = InputMode::ConnectSelect;
            self.selected_connect_index = 0;
            self.input.clear();
            return true;
        }

        if trimmed.starts_with("/connect ") {
            self.connect_provider_command();
            return true;
        }

        false
    }
}
