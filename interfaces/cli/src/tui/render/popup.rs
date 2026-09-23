use ratatui::{
    layout::Rect,
    style::{Modifier, Style},
    text::{Line, Span},
    widgets::{Block, BorderType, Borders, Clear, Paragraph},
    Frame,
};
use unicode_width::UnicodeWidthStr;

use super::super::App;

const MAX_POPUP_WIDTH: u16 = 88;

pub(super) fn compute_area(input_area: Rect, item_count: usize, max_visible: usize) -> Rect {
    let max = max_visible.max(1);
    let visible = item_count.min(max).max(1);
    let desired_height = visible as u16 + 2;
    let available_above = input_area.y.saturating_sub(1);
    let height = desired_height.min(available_above.max(1));
    let width = input_area.width.min(MAX_POPUP_WIDTH).max(1);

    Rect {
        x: input_area.x,
        y: input_area.y.saturating_sub(height),
        width,
        height,
    }
}

pub(super) fn visible_range(
    total: usize,
    selected: usize,
    max_visible: usize,
    area_height: u16,
) -> (usize, usize) {
    let capacity = area_height.saturating_sub(2) as usize;
    let visible = total.min(max_visible).min(capacity.max(1));
    let start = if total <= visible {
        0
    } else {
        selected
            .saturating_sub(visible / 2)
            .min(total.saturating_sub(visible))
    };
    (start, (start + visible).min(total))
}

pub(super) fn row<'a>(
    app: &App,
    popup_width: u16,
    name: &'a str,
    description: &'a str,
    selected: bool,
) -> Line<'a> {
    let theme = app.theme;
    let row_style = if selected {
        Style::default().fg(theme.selected_fg).bg(theme.selected_bg)
    } else {
        Style::default().fg(theme.text).bg(theme.card_bg)
    };
    let desc_style = if selected {
        row_style.add_modifier(Modifier::DIM)
    } else {
        Style::default().fg(theme.subtle).bg(theme.card_bg)
    };
    let marker = if selected { "❯ " } else { "  " };
    let available = popup_width.saturating_sub(4) as usize;
    let name_width = UnicodeWidthStr::width(name);
    let show_desc = available >= 44 && name_width + 4 < available;

    let mut spans = vec![
        Span::styled(marker, row_style),
        Span::styled(name, row_style.add_modifier(Modifier::BOLD)),
    ];
    if show_desc {
        let gap = 18usize.saturating_sub(name_width).max(2);
        spans.push(Span::styled(" ".repeat(gap), row_style));
        spans.push(Span::styled(description, desc_style));
    }
    Line::from(spans)
}

pub(super) fn simple_row(app: &App, text: &str, selected: bool) -> Line<'static> {
    let theme = app.theme;
    let marker = if selected { "❯ " } else { "  " };
    let style = if selected {
        Style::default().fg(theme.selected_fg).bg(theme.selected_bg)
    } else {
        Style::default().fg(theme.text).bg(theme.card_bg)
    };
    Line::from(vec![
        Span::styled(marker.to_string(), style),
        Span::styled(text.to_string(), style),
    ])
}

pub(super) fn render(frame: &mut Frame, app: &App, area: Rect, rows: Vec<Line<'_>>, title: &str) {
    let theme = app.theme;
    let block = Block::default()
        .title(Span::styled(
            format!(" {title} "),
            Style::default().fg(theme.subtle),
        ))
        .borders(Borders::ALL)
        .border_type(BorderType::Rounded)
        .border_style(Style::default().fg(theme.border))
        .style(Style::default().bg(theme.card_bg));

    frame.render_widget(Clear, area);
    frame.render_widget(
        Paragraph::new(rows)
            .block(block)
            .style(Style::default().bg(theme.card_bg)),
        area,
    );
}

pub(super) fn render_hint(frame: &mut Frame, app: &App, area: Rect, hint: &str) {
    let theme = app.theme;
    let hint_area = Rect {
        x: area.x,
        y: area.y + area.height,
        width: area.width,
        height: 1,
    };
    frame.render_widget(
        Paragraph::new(Line::from(Span::styled(
            hint,
            Style::default().fg(theme.subtle),
        ))),
        hint_area,
    );
}
