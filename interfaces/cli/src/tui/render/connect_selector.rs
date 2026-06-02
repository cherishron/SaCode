use ratatui::{
    style::Style,
    text::Line,
    widgets::{Block, Paragraph},
    Frame,
};

use super::common::{centered_rect, render_modal_block};
use super::super::{App, MODELS_HINT_LIMIT};

pub(crate) fn render_connect_selector(frame: &mut Frame, app: &App) {
    let theme = app.theme;
    let area = centered_rect(frame.area(), 70, 50);
    let inner = render_modal_block(frame, area, "快速接入 Provider", theme);

    let start = app
        .selected_connect_index
        .saturating_sub(MODELS_HINT_LIMIT / 2);
    let end = (start + MODELS_HINT_LIMIT).min(app.connect_options.len());
    let lines: Vec<Line> = app.connect_options[start..end]
        .iter()
        .enumerate()
        .map(|(offset, (name, base_url, needs_key))| {
            let label = if *needs_key {
                format!("{} - {} (需要 API Key)", name, base_url)
            } else {
                format!("{} - {} (本地)", name, base_url)
            };
            let is_selected = offset + start == app.selected_connect_index;
            let style = if is_selected {
                Style::default().fg(theme.selected_fg).bg(theme.selected_bg)
            } else {
                Style::default().fg(theme.text)
            };
            Line::styled(label, style)
        })
        .collect();

    let list = Paragraph::new(lines).block(Block::default());
    frame.render_widget(list, inner);
}
