use ratatui::{
    style::Style,
    text::Line,
    widgets::Paragraph,
    Frame,
};

use super::common::{centered_rect, render_modal_block};
use super::super::{App, MODELS_HINT_LIMIT};

pub(crate) fn render_session_selector(frame: &mut Frame, app: &App) {
    let theme = app.theme;
    let area = centered_rect(frame.area(), 72, 55);
    let inner = render_modal_block(frame, area, "历史会话", theme);

    let start = app
        .selected_session_index
        .saturating_sub(MODELS_HINT_LIMIT / 2);
    let end = (start + MODELS_HINT_LIMIT).min(app.session_options.len());
    let lines: Vec<Line> = app.session_options[start..end]
        .iter()
        .enumerate()
        .map(|(offset, session)| {
            let index = start + offset;
            let is_selected = index == app.selected_session_index;
            let style = if is_selected {
                Style::default().fg(theme.selected_fg).bg(theme.selected_bg)
            } else {
                Style::default().fg(theme.text)
            };
            Line::styled(
                format!("{} [{}] {}", session.updated_at, session.id, session.title),
                style,
            )
        })
        .collect();

    frame.render_widget(Paragraph::new(lines), inner);
}

pub(crate) fn render_task_selector(frame: &mut Frame, app: &App) {
    let theme = app.theme;
    let area = centered_rect(frame.area(), 72, 55);
    let inner = render_modal_block(frame, area, "持久任务", theme);

    let start = app.selected_task_index.saturating_sub(MODELS_HINT_LIMIT / 2);
    let end = (start + MODELS_HINT_LIMIT).min(app.task_options.len());
    let lines: Vec<Line> = app.task_options[start..end]
        .iter()
        .enumerate()
        .map(|(offset, task)| {
            let index = start + offset;
            let is_selected = index == app.selected_task_index;
            let style = if is_selected {
                Style::default().fg(theme.selected_fg).bg(theme.selected_bg)
            } else {
                Style::default().fg(theme.text)
            };
            Line::styled(
                format!(
                    "#{} {:<11} {:<6} {}",
                    task.id,
                    task.status.label(),
                    task.priority.label(),
                    task.description,
                ),
                style,
            )
        })
        .collect();

    frame.render_widget(Paragraph::new(lines), inner);
}
