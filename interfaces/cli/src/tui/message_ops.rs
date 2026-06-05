use arboard::Clipboard;
use ratatui::text::Line;

use super::{
    input::layout_input_lines, render::render_message_lines, App, CachedInputLayout,
    CachedRenderedMessages, Message, MessageRole, RenderedMessageLine,
};

impl App {
    pub(super) fn thinking_indicator_line(&self) -> Option<RenderedMessageLine> {
        if !self.queue.processing || !self.assistant_pending_thinking {
            return None;
        }

        Some(RenderedMessageLine {
            line: Line::from(vec![
                ratatui::text::Span::styled(
                    "● ",
                    ratatui::style::Style::default().fg(self.theme.accent),
                ),
                ratatui::text::Span::styled(
                    format!(
                        "{} Thinking",
                        super::SPINNER_FRAMES[self.spinner_index % super::SPINNER_FRAMES.len()]
                    ),
                    ratatui::style::Style::default()
                        .fg(self.theme.accent)
                        .add_modifier(ratatui::style::Modifier::BOLD),
                ),
            ]),
        })
    }

    pub(super) fn total_rendered_message_line_count(&mut self) -> usize {
        self.rendered_message_lines().len() + usize::from(self.thinking_indicator_line().is_some())
    }

    pub(super) fn push_system_message(&mut self, content: &str) {
        let timestamp = chrono::Local::now().format("%Y-%m-%d %H:%M").to_string();
        self.append_message(Message {
            role: MessageRole::System,
            content: content.to_string(),
            timestamp,
            collapsed: false,
        });
        self.refresh_git_changes();
        self.save_current_session();
        self.scroll_to_bottom();
    }

    pub(super) fn push_success_message(&mut self, content: &str) {
        let timestamp = chrono::Local::now().format("%Y-%m-%d %H:%M").to_string();
        self.append_message(Message {
            role: MessageRole::System,
            content: format!("[成功] {}", content),
            timestamp,
            collapsed: false,
        });
        self.refresh_git_changes();
        self.save_current_session();
        self.scroll_to_bottom();
    }

    pub(super) fn push_error_message(&mut self, content: &str) {
        let timestamp = chrono::Local::now().format("%Y-%m-%d %H:%M").to_string();
        self.append_message(Message {
            role: MessageRole::System,
            content: format!("[错误] {}", content),
            timestamp,
            collapsed: false,
        });
        self.refresh_git_changes();
        self.save_current_session();
        self.scroll_to_bottom();
    }

    pub(super) fn scroll_to_bottom(&mut self) {
        self.follow_bottom = true;
        self.scroll_offset = self.message_scroll_max();
    }

    pub(super) fn pin_scroll_to_bottom_if_following(&mut self) {
        if self.follow_bottom {
            self.scroll_offset = self.message_scroll_max();
        }
    }

    pub(super) fn copy_last_assistant_message(&mut self) {
        let Some(last_message) = self
            .messages
            .iter()
            .rev()
            .find(|message| matches!(message.role, MessageRole::Assistant))
        else {
            self.push_system_message("当前没有可复制的助手回复。");
            return;
        };

        let mut clipboard = match Clipboard::new() {
            Ok(clipboard) => clipboard,
            Err(error) => {
                self.push_error_message(&format!("打开系统剪贴板失败: {}", error));
                return;
            }
        };

        match clipboard.set_text(last_message.content.clone()) {
            Ok(()) => {
                self.log_event("copy_last", &last_message.content);
                self.push_success_message("已复制最后一条助手回复到系统剪贴板。");
            }
            Err(error) => self.push_error_message(&format!("复制到系统剪贴板失败: {}", error)),
        }
    }

    pub(super) fn fold_last_thinking_details(&mut self, action: super::FoldAction) {
        let Some(index) = self
            .messages
            .iter()
            .rposition(|message| matches!(message.role, MessageRole::Assistant))
        else {
            self.push_system_message("当前没有可折叠的思考详情。");
            return;
        };

        let changed = self.apply_thinking_fold_action(index, action);
        if changed {
            self.save_current_session();
            self.scroll_to_bottom();
        }
    }

    pub(super) fn scroll_up(&mut self) {
        if self.follow_bottom {
            self.scroll_offset = self.message_scroll_max();
            self.follow_bottom = false;
        }
        self.scroll_offset = self.scroll_offset.saturating_sub(1);
    }

    pub(super) fn scroll_down(&mut self) {
        let max_scroll = self.message_scroll_max();
        if self.scroll_offset < max_scroll {
            self.scroll_offset += 1;
        } else {
            self.follow_bottom = true;
            self.scroll_offset = max_scroll;
        }
    }

    pub(super) fn message_scroll_max(&self) -> usize {
        let visible_height = self.message_viewport.height as usize;
        (self
            .message_lines_cache
            .as_ref()
            .map(|cache| cache.lines.len())
            .unwrap_or_else(|| {
                render_message_lines(
                    &self.messages,
                    self.theme,
                    self.message_viewport.width.saturating_sub(1) as usize,
                )
                .len()
            })
            + usize::from(self.queue.processing && self.assistant_pending_thinking))
        .saturating_sub(visible_height.max(1))
    }

    pub(super) fn invalidate_message_lines_cache(&mut self) {
        self.message_lines_cache = None;
        self.input_layout_cache = None;
    }

    pub(super) fn append_message(&mut self, message: Message) {
        self.messages.push(message);
        self.invalidate_message_lines_cache();
    }

    pub(super) fn update_last_message_content(&mut self, content: String) {
        if let Some(message) = self.messages.last_mut() {
            message.content = content;
            self.invalidate_message_lines_cache();
        }
    }

    pub(super) fn replace_messages(&mut self, messages: Vec<Message>) {
        self.messages = messages;
        self.invalidate_message_lines_cache();
    }

    pub(crate) fn rendered_message_lines(&mut self) -> &[RenderedMessageLine] {
        let width = self.message_viewport.width.saturating_sub(1).max(1) as usize;
        let needs_refresh = self
            .message_lines_cache
            .as_ref()
            .map(|cache| cache.width != width)
            .unwrap_or(true);

        if needs_refresh {
            self.message_lines_cache = Some(CachedRenderedMessages {
                width,
                lines: render_message_lines(&self.messages, self.theme, width),
            });
        }

        self.message_lines_cache
            .as_ref()
            .map(|cache| cache.lines.as_slice())
            .unwrap_or(&[])
    }

    pub(crate) fn visible_rendered_message_lines(
        &mut self,
        start: usize,
        height: usize,
    ) -> &[RenderedMessageLine] {
        let lines = self.rendered_message_lines();
        let start = start.min(lines.len());
        let end = start.saturating_add(height).min(lines.len());
        &lines[start..end]
    }

    pub(crate) fn cached_input_layout(&mut self, width: usize) -> &CachedInputLayout {
        let width = width.max(1);
        let needs_refresh = self
            .input_layout_cache
            .as_ref()
            .map(|cache| cache.width != width || cache.text != self.input)
            .unwrap_or(true);
        if needs_refresh {
            let (lines, cursor_line, cursor_col) = layout_input_lines(&self.input, width);
            self.input_layout_cache = Some(CachedInputLayout {
                text: self.input.clone(),
                width,
                lines,
                cursor_line,
                cursor_col,
            });
        }
        self.input_layout_cache
            .as_ref()
            .expect("input layout cache exists")
    }
}
