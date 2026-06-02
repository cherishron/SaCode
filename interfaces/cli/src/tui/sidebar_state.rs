use ratatui::{
    style::Style,
    text::{Line, Span},
};

use super::{App, SidebarSection, TodoStatus};

impl App {
    pub(super) fn sidebar_section_lines(&self, section: SidebarSection) -> Vec<Line<'static>> {
        match section {
            SidebarSection::Todo => {
                let Some(plan) = &self.interaction.todo_plan else {
                    return vec![Line::from(Span::styled(
                        "当前没有 todo 计划",
                        Style::default().fg(self.theme.subtle),
                    ))];
                };

                let mut lines = vec![Line::from(Span::styled(
                    format!(
                        "来源: {}",
                        plan.source_task.chars().take(18).collect::<String>()
                    ),
                    Style::default().fg(self.theme.subtle),
                ))];
                lines.extend(plan.items.iter().map(|item| {
                    let marker = match item.status {
                        TodoStatus::Pending => "[ ]",
                        TodoStatus::Running => "[>]",
                        TodoStatus::Completed => "[x]",
                    };
                    let preview = item.description.chars().take(20).collect::<String>();
                    Line::from(Span::styled(
                        format!("{} {}. {}", marker, item.id, preview),
                        Style::default().fg(self.theme.text),
                    ))
                }));
                lines
            }
            SidebarSection::Task => {
                if self.task_options.is_empty() {
                    return vec![Line::from(Span::styled(
                        "当前没有 task",
                        Style::default().fg(self.theme.subtle),
                    ))];
                }

                self.task_options
                    .iter()
                    .take(8)
                    .map(|task| {
                        Line::from(Span::styled(
                            format!(
                                "#{} [{}] {}",
                                task.id,
                                task.status.label(),
                                task.description.chars().take(18).collect::<String>()
                            ),
                            Style::default().fg(self.theme.text),
                        ))
                    })
                    .collect()
            }
            SidebarSection::Git => {
                if self.git_changes.is_empty() {
                    return vec![Line::from(Span::styled(
                        "当前没有 Git 变更",
                        Style::default().fg(self.theme.subtle),
                    ))];
                }

                self.git_changes
                    .iter()
                    .filter(|entry| *entry != "?? .sacode/")
                    .take(8)
                    .map(|entry| {
                        let preview = entry.chars().take(30).collect::<String>();
                        Line::from(Span::styled(preview, Style::default().fg(self.theme.text)))
                    })
                    .collect()
            }
        }
    }
}
