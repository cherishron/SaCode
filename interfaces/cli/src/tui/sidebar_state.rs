use ratatui::{
    style::{Modifier, Style},
    text::{Line, Span},
};

use super::{App, SidebarSection, TodoStatus};

impl App {
    pub(super) fn sidebar_section_lines(&self, section: SidebarSection) -> Vec<Line<'static>> {
        match section {
            SidebarSection::Todo => {
                let Some(plan) = &self.interaction.todo_plan else {
                    return vec![Line::from(Span::styled(
                        "todo │ 当前没有计划",
                        Style::default().fg(self.theme.subtle),
                    ))];
                };

                let mut lines = vec![Line::from(vec![
                    Span::styled("todo ", Style::default().fg(self.theme.accent).add_modifier(Modifier::BOLD)),
                    Span::styled(
                        format!(
                            "source {}",
                            plan.source_task.chars().take(18).collect::<String>()
                        ),
                        Style::default().fg(self.theme.subtle),
                    ),
                ])];
                lines.extend(plan.items.iter().map(|item| {
                    let (marker, color) = match item.status {
                        TodoStatus::Pending => ("todo", self.theme.warning),
                        TodoStatus::Running => ("run", self.theme.agent),
                        TodoStatus::Completed => ("done", self.theme.build),
                    };
                    let preview = item.description.chars().take(20).collect::<String>();
                    Line::from(vec![
                        Span::styled(
                            format!("{} ", marker),
                            Style::default().fg(color).add_modifier(Modifier::BOLD),
                        ),
                        Span::styled(
                            format!("#{} {}", item.id, preview),
                            Style::default().fg(self.theme.text),
                        ),
                    ])
                }));
                lines
            }
            SidebarSection::Task => {
                if self.task_options.is_empty() {
                    return vec![Line::from(Span::styled(
                        "task │ 当前没有任务",
                        Style::default().fg(self.theme.subtle),
                    ))];
                }

                self.task_options
                    .iter()
                    .take(8)
                    .map(|task| {
                        let status = task.status.label();
                        let color = if matches!(status, "running" | "in_progress") {
                            self.theme.agent
                        } else if matches!(status, "done" | "completed") {
                            self.theme.build
                        } else {
                            self.theme.info
                        };
                        Line::from(vec![
                            Span::styled(
                                format!("{} ", status),
                                Style::default().fg(color).add_modifier(Modifier::BOLD),
                            ),
                            Span::styled(
                                format!(
                                    "#{} {}",
                                    task.id,
                                    task.description.chars().take(18).collect::<String>()
                                ),
                                Style::default().fg(self.theme.text),
                            ),
                        ])
                    })
                    .collect()
            }
            SidebarSection::Git => {
                if self.git_changes.is_empty() {
                    return vec![Line::from(Span::styled(
                        "git │ 当前没有变更",
                        Style::default().fg(self.theme.subtle),
                    ))];
                }

                self.git_changes
                    .iter()
                    .filter(|entry| *entry != "?? .sacode/")
                    .take(8)
                    .map(|entry| {
                        let preview = entry.chars().take(30).collect::<String>();
                        let color = if entry.starts_with("??") {
                            self.theme.warning
                        } else if entry.starts_with('M') || entry.chars().nth(1) == Some('M') {
                            self.theme.info
                        } else {
                            self.theme.build
                        };
                        Line::from(vec![
                            Span::styled("git ", Style::default().fg(color).add_modifier(Modifier::BOLD)),
                            Span::styled(preview, Style::default().fg(self.theme.text)),
                        ])
                    })
                    .collect()
            }
        }
    }
}
