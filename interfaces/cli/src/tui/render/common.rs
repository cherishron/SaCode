use std::path::PathBuf;

use ratatui::{
    layout::{Constraint, Direction, Layout, Rect},
    style::{Color, Modifier, Style},
    text::{Line, Span},
    widgets::{Block, Borders, Clear, Paragraph},
    Frame,
};

use super::super::ThemePalette;

pub(crate) fn centered_rect(area: Rect, width_percent: u16, height_percent: u16) -> Rect {
    let vertical = Layout::default()
        .direction(Direction::Vertical)
        .constraints([
            Constraint::Percentage((100 - height_percent) / 2),
            Constraint::Percentage(height_percent),
            Constraint::Percentage((100 - height_percent) / 2),
        ])
        .split(area);

    Layout::default()
        .direction(Direction::Horizontal)
        .constraints([
            Constraint::Percentage((100 - width_percent) / 2),
            Constraint::Percentage(width_percent),
            Constraint::Percentage((100 - width_percent) / 2),
        ])
        .split(vertical[1])[1]
}

pub(crate) fn clear_area(frame: &mut Frame, area: Rect) {
    frame.render_widget(Clear, area);
}

pub(crate) fn render_modal_block(
    frame: &mut Frame,
    area: Rect,
    title: impl Into<String>,
    theme: ThemePalette,
) -> Rect {
    clear_area(frame, area);
    frame.render_widget(
        Block::default().style(Style::default().bg(Color::Black)),
        area,
    );
    let block = Block::default()
        .title(title.into())
        .borders(Borders::ALL)
        .border_style(Style::default().fg(theme.accent));
    let inner = block.inner(area);
    frame.render_widget(block, area);
    inner
}

pub(crate) fn render_relative_modal_block(
    frame: &mut Frame,
    area: Rect,
    title: impl Into<String>,
    theme: ThemePalette,
) -> Rect {
    clear_area(frame, area);
    frame.render_widget(
        Block::default().style(Style::default().bg(Color::Black)),
        area,
    );
    let block = Block::default()
        .title(title.into())
        .borders(Borders::ALL)
        .border_style(Style::default().fg(theme.accent_strong));
    let inner = block.inner(area);
    frame.render_widget(block, area);
    inner
}

pub(crate) fn render_sidebar_section(
    frame: &mut Frame,
    area: Rect,
    title: &str,
    lines: Vec<Line<'static>>,
    theme: ThemePalette,
) {
    let chunks = Layout::default()
        .direction(Direction::Vertical)
        .constraints([Constraint::Length(1), Constraint::Min(1)])
        .split(area);

    frame.render_widget(
        Paragraph::new(Line::from(vec![
            Span::styled(
                title,
                Style::default()
                    .fg(theme.accent)
                    .add_modifier(Modifier::BOLD),
            ),
            Span::styled(" ", Style::default()),
            Span::styled("----------------", Style::default().fg(theme.panel_border)),
        ])),
        chunks[0],
    );

    frame.render_widget(Paragraph::new(lines), chunks[1]);
}

pub(crate) fn relative_to_workdir(workdir: &std::path::Path, path: &std::path::Path) -> PathBuf {
    path.strip_prefix(workdir)
        .map(|value| value.to_path_buf())
        .unwrap_or_else(|_| path.to_path_buf())
}
