use ratatui::{
    style::{Modifier, Style},
    text::{Line, Span},
};

use super::{App, QueuePanelMode};

impl App {
    pub(super) fn active_task_elapsed_seconds(&self) -> u64 {
        let Some(started_at) = self.active_task_started_at else {
            return 0;
        };
        (chrono::Local::now() - started_at).num_seconds().max(0) as u64
    }

    pub(super) fn queue_panel_mode(&self) -> QueuePanelMode {
        if self.queue.processing && self.queue.active_task_id.is_some() {
            QueuePanelMode::Running
        } else if self.queue.queued_messages.is_empty() {
            QueuePanelMode::Idle
        } else {
            QueuePanelMode::PendingOnly
        }
    }

    pub(super) fn queue_panel_height(&self) -> u16 {
        match self.queue_panel_mode() {
            QueuePanelMode::Idle => 0,
            QueuePanelMode::Running => {
                if self.queue.queued_messages.len() > 2 {
                    4
                } else if self.queue.queued_messages.is_empty() {
                    1
                } else {
                    1 + self.queue.queued_messages.len() as u16
                }
            }
            QueuePanelMode::PendingOnly => {
                if self.queue.queued_messages.len() > 2 {
                    3
                } else {
                    1 + self.queue.queued_messages.len() as u16
                }
            }
        }
    }

    pub(super) fn queue_panel_lines(&self) -> Vec<Line<'static>> {
        let mut lines = Vec::new();
        if self.queue.processing {
            let elapsed = self.active_task_elapsed_seconds();
            lines.push(Line::from(vec![
                Span::styled(
                    format!("{} ", self.spinner_frame()),
                    Style::default()
                        .fg(self.theme.warning)
                        .add_modifier(Modifier::BOLD),
                ),
                Span::styled(
                    "生成中 ",
                    Style::default()
                        .fg(self.theme.warning)
                        .add_modifier(Modifier::BOLD),
                ),
                Span::styled(
                    format!("{}s", elapsed),
                    Style::default().fg(self.theme.warning),
                ),
                Span::styled(" ... ", Style::default().fg(self.theme.warning)),
                Span::styled("(按esc取消)", Style::default().fg(self.theme.subtle)),
            ]));
        } else if !self.queue.queued_messages.is_empty() {
            lines.push(Line::from(vec![
                Span::styled(
                    "待执行",
                    Style::default()
                        .fg(self.theme.accent)
                        .add_modifier(Modifier::BOLD),
                ),
                Span::styled(
                    format!(" {} 项", self.queue.queued_messages.len()),
                    Style::default().fg(self.theme.subtle),
                ),
            ]));
        }

        if !self.queue.queued_messages.is_empty() {
            let previews = self
                .queue
                .queued_messages
                .iter()
                .take(2)
                .map(|queued| {
                    let preview = queued.content.lines().next().unwrap_or("").trim();
                    let compact: String = preview.chars().take(28).collect();
                    let suffix = if preview.chars().count() > 28 {
                        "..."
                    } else {
                        ""
                    };
                    Line::from(vec![
                        Span::styled(
                            format!("#{} ", queued.id),
                            Style::default().fg(self.theme.subtle),
                        ),
                        Span::styled(
                            format!("{}{}", compact, suffix),
                            Style::default().fg(self.theme.muted),
                        ),
                    ])
                })
                .collect::<Vec<_>>();
            lines.extend(previews);
            if self.queue.queued_messages.len() > 2 {
                lines.push(Line::from(Span::styled(
                    format!("... 还有 {} 项待执行", self.queue.queued_messages.len() - 2),
                    Style::default().fg(self.theme.subtle),
                )));
            }
        }

        lines
    }
}
