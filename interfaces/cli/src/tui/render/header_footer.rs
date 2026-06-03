use ratatui::{
    layout::{Alignment, Rect},
    style::{Modifier, Style},
    text::{Line, Span},
    widgets::Paragraph,
    Frame,
};

use super::super::App;

pub(crate) fn render_header(frame: &mut Frame, app: &App, area: Rect) {
    let theme = app.theme;
    let project_name = app
        .workdir
        .file_name()
        .map(|value| value.to_string_lossy().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| "SaCode".to_string());

    let line = Line::from(vec![
        Span::styled(
            format!("CodeBuddy Code v{} ", env!("CARGO_PKG_VERSION")),
            Style::default().fg(theme.text).add_modifier(Modifier::BOLD),
        ),
        Span::styled(
            project_name,
            Style::default().fg(theme.muted),
        ),
    ]);

    frame.render_widget(
        Paragraph::new(line).alignment(Alignment::Left),
        area,
    );
}

pub(crate) fn render_footer(frame: &mut Frame, app: &App, area: Rect) {
    let theme = app.theme;
    let hints = match app.input_mode {
        _ => "? for shortcuts",
    };

    frame.render_widget(
        Paragraph::new(Line::from(vec![
            Span::styled(
                hints,
                Style::default().fg(theme.subtle),
            ),
        ]))
        .alignment(Alignment::Left),
        area,
    );
}
