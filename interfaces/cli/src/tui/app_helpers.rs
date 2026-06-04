use std::{fs, io::Write, time::Duration};

use super::{user_sacode_dir, App, ExecutionMode, FoldAction, MessageRole, SPINNER_FRAMES};

impl App {
    pub(super) fn active_task_elapsed_seconds(&self) -> u64 {
        let Some(started_at) = self.active_task_started_at else {
            return 0;
        };
        (chrono::Local::now() - started_at).num_seconds().max(0) as u64
    }

    pub(super) fn confirm_session_selection(&mut self) {
        let selected = self
            .session_options
            .get(self.selected_session_index)
            .cloned();
        self.input_mode = super::InputMode::Chat;
        if let Some(session) = selected {
            self.load_session_by_id(&session.id, true);
        }
    }

    pub(super) fn navigate_history_up(&mut self) {
        if self.sent_history.is_empty() {
            return;
        }
        match self.history_index {
            None => {
                self.current_history_draft = self.input.clone();
                self.history_index = Some(self.sent_history.len().saturating_sub(1));
            }
            Some(index) => {
                self.history_index = Some(index.saturating_sub(1));
            }
        }
        if let Some(index) = self.history_index {
            self.input = self.sent_history.get(index).cloned().unwrap_or_default();
            self.input_scroll_offset = 0;
            self.input_scroll_follows_cursor = true;
        }
    }

    pub(super) fn navigate_history_down(&mut self) {
        let Some(index) = self.history_index else {
            return;
        };
        if index + 1 < self.sent_history.len() {
            self.history_index = Some(index + 1);
            self.input = self
                .sent_history
                .get(index + 1)
                .cloned()
                .unwrap_or_default();
            self.input_scroll_offset = 0;
            self.input_scroll_follows_cursor = true;
        } else {
            self.history_index = None;
            self.input = self.current_history_draft.clone();
            self.current_history_draft.clear();
            self.input_scroll_offset = 0;
            self.input_scroll_follows_cursor = true;
        }
    }

    pub(super) fn scroll_input_up(&mut self) {
        self.input_scroll_follows_cursor = false;
        self.input_scroll_offset = self.input_scroll_offset.saturating_sub(1);
    }

    pub(super) fn scroll_input_down(&mut self) {
        self.input_scroll_follows_cursor = false;
        let visible_height = self.input_viewport.height.max(1) as usize;
        let width = self.input_viewport.width.saturating_sub(2).max(1) as usize;
        let max_scroll = self
            .cached_input_layout(width)
            .lines
            .len()
            .saturating_sub(visible_height);
        self.input_scroll_offset = (self.input_scroll_offset + 1).min(max_scroll);
    }

    pub(super) fn input_on_first_visible_line(&mut self) -> bool {
        let width = self.input_viewport.width.saturating_sub(2).max(1) as usize;
        let cursor_line = self.cached_input_layout(width).cursor_line;
        cursor_line == self.input_scroll_offset
    }

    pub(super) fn input_on_last_visible_line(&mut self) -> bool {
        let visible_height = self.input_viewport.height.max(1) as usize;
        let width = self.input_viewport.width.saturating_sub(2).max(1) as usize;
        let scroll_offset = self.input_scroll_offset;
        let layout = self.cached_input_layout(width);
        let last_visible_line = scroll_offset
            .saturating_add(visible_height.saturating_sub(1))
            .min(layout.lines.len().saturating_sub(1));
        layout.cursor_line == last_visible_line
    }

    pub(super) fn fold_all_thinking_details(&mut self, action: FoldAction) {
        let mut changed = 0usize;
        for index in 0..self.messages.len() {
            if matches!(self.messages[index].role, MessageRole::Assistant)
                && self.apply_thinking_fold_action(index, action)
            {
                changed += 1;
            }
        }

        if changed > 0 {
            self.save_current_session();
            self.push_success_message(&format!("已更新 {} 条思考详情的折叠状态。", changed));
        } else {
            self.push_system_message("当前没有需要更新折叠状态的思考详情。");
        }
    }

    pub(super) fn toggle_all_thinking_folds(&mut self) {
        let should_collapse = self
            .messages
            .iter()
            .filter(|message| matches!(message.role, MessageRole::Assistant))
            .any(|message| !message.collapsed);
        let action = if should_collapse {
            FoldAction::Collapse
        } else {
            FoldAction::Expand
        };
        self.fold_all_thinking_details(action);
    }

    pub(super) fn cycle_execution_mode(&mut self) {
        let next = match self.execution_mode {
            ExecutionMode::Plan => "build",
            ExecutionMode::Build => "yolo",
            ExecutionMode::Yolo => "plan",
        };
        self.apply_execution_mode(next, true);
    }

    pub(super) fn apply_thinking_fold_action(&mut self, index: usize, action: FoldAction) -> bool {
        let Some(message) = self.messages.get_mut(index) else {
            return false;
        };

        let target = match action {
            FoldAction::Collapse => true,
            FoldAction::Expand => false,
        };

        if message.collapsed == target {
            return false;
        }

        message.collapsed = target;
        let timestamp = message.timestamp.clone();
        let state = if target { "collapsed" } else { "expanded" };
        let log_content = format!("{} {}", state, timestamp);
        self.log_event("thinking_fold", &log_content);
        true
    }

    pub(super) fn tick(&mut self) -> bool {
        if self.queue.processing {
            self.spinner_index = (self.spinner_index + 1) % SPINNER_FRAMES.len();
            true
        } else {
            false
        }
    }

    pub(super) fn redraw_poll_interval(&self) -> Duration {
        if self.queue.processing {
            Duration::from_millis(100)
        } else {
            Duration::from_millis(300)
        }
    }

    pub(super) fn log_event(&self, kind: &str, content: &str) {
        if let Some(parent) = self.log_path.parent() {
            let _ = fs::create_dir_all(parent);
        }
        if let Ok(mut file) = fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&self.log_path)
        {
            let compact = content.split_whitespace().collect::<Vec<_>>().join(" ");
            let line = format!(
                "{} [{}] {}\n",
                chrono::Local::now().format("%Y-%m-%d %H:%M:%S%.3f"),
                kind,
                compact
            );
            let _ = file.write_all(line.as_bytes());
        }
    }

    pub(super) fn append_raw_log(kind: &str, content: &str) {
        let path = user_sacode_dir().join("logs/tui.log");
        if let Some(parent) = path.parent() {
            let _ = fs::create_dir_all(parent);
        }
        if let Ok(mut file) = fs::OpenOptions::new().create(true).append(true).open(path) {
            let line = format!(
                "{} [{}]\n{}\n---\n",
                chrono::Local::now().format("%Y-%m-%d %H:%M:%S%.3f"),
                kind,
                content.trim()
            );
            let _ = file.write_all(line.as_bytes());
        }
    }
}
