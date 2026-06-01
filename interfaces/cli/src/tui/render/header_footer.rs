use ratatui::{
    layout::{Alignment, Rect},
    style::{Modifier, Style},
    text::{Line, Span},
    widgets::Paragraph,
    Frame,
};

use super::super::{
    input::display_workdir,
    App, ThemePalette,
};

pub(crate) fn render_header(frame: &mut Frame, area: Rect, theme: ThemePalette) {
    frame.render_widget(
        Paragraph::new(vec![Line::from(vec![Span::styled(
            "SACODE",
            Style::default()
                .fg(theme.accent_strong)
                .add_modifier(Modifier::BOLD),
        )])])
        .alignment(Alignment::Center),
        area,
    );
}

pub(crate) fn render_footer(frame: &mut Frame, app: &App, area: Rect) {
    let theme = app.theme;
    frame.render_widget(
        Paragraph::new(Line::from(vec![
            Span::styled(
                format!("v{}  ", env!("CARGO_PKG_VERSION")),
                Style::default().fg(theme.subtle),
            ),
            Span::styled(
                format!("{}  ", app.current_model_name()),
                Style::default().fg(theme.assistant),
            ),
            Span::styled(
                format!("{}  ", app.thinking_toggle_status_label()),
                Style::default().fg(theme.accent),
            ),
            Span::styled(
                format!("Mode:{}  ", app.execution_mode),
                Style::default().fg(theme.text),
            ),
            Span::styled(
                format!("cwd:{}", display_workdir(&app.workdir)),
                Style::default().fg(theme.subtle),
            ),
        ])),
        area,
    );
}
