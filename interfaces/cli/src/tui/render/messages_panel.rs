use ratatui::{
    layout::{Alignment, Rect},
    style::{Modifier, Style},
    text::{Line, Span},
    widgets::{Paragraph, Scrollbar, ScrollbarOrientation, ScrollbarState},
    Frame,
};

use super::super::App;

pub(crate) fn render_messages_panel(frame: &mut Frame, app: &mut App, area: Rect) {
    let theme = app.theme;
    app.message_viewport = area;

    // Show welcome area when no messages
    if app.is_messages_empty() {
        render_welcome_area(frame, app, area);
        return;
    }

    let max_y = area.height as usize;
    let total_lines = app.rendered_message_lines().len();
    let max_scroll = total_lines.saturating_sub(max_y);
    if app.follow_bottom {
        app.scroll_offset = max_scroll;
    } else {
        app.scroll_offset = app.scroll_offset.min(max_scroll);
    }
    let start = app.scroll_offset;
    let visible_lines = app
        .visible_rendered_message_lines(start, max_y)
        .iter()
        .map(|line| line.line.clone())
        .collect::<Vec<_>>();

    frame.render_widget(
        Paragraph::new(visible_lines).style(Style::default().bg(theme.bg_primary)),
        area,
    );

    if total_lines > max_y {
        let scrollbar = Scrollbar::default()
            .orientation(ScrollbarOrientation::VerticalRight)
            .begin_symbol(None)
            .end_symbol(None)
            .track_style(Style::default().fg(theme.panel_border))
            .thumb_style(Style::default().fg(theme.border));
        let mut scrollbar_state = ScrollbarState::new(total_lines).position(start);
        frame.render_stateful_widget(scrollbar, area, &mut scrollbar_state);
    }
}

fn render_welcome_area(frame: &mut Frame, app: &App, area: Rect) {
    let theme = app.theme;

    let welcome_lines = vec![
        Line::from(""),
        Line::from(vec![
            Span::styled("SaCode", Style::default().fg(theme.accent).add_modifier(Modifier::BOLD)),
            Span::styled(" - AI Coding Assistant", Style::default().fg(theme.muted)),
        ]),
        Line::from(""),
        Line::from(vec![
            Span::styled("Tips for getting started", Style::default().fg(theme.text).add_modifier(Modifier::BOLD)),
        ]),
        Line::from(vec![
            Span::styled("• ", Style::default().fg(theme.subtle)),
            Span::styled("输入你的编程任务，我会帮你完成。", Style::default().fg(theme.text)),
        ]),
        Line::from(vec![
            Span::styled("• ", Style::default().fg(theme.subtle)),
            Span::styled("按 Ctrl+Q 或 /quit 退出，执行中按 Esc 或 /cancel 取消当前任务。", Style::default().fg(theme.text)),
        ]),
        Line::from(vec![
            Span::styled("• ", Style::default().fg(theme.subtle)),
            Span::styled("输入 / 可显示命令列表。", Style::default().fg(theme.text)),
        ]),
        Line::from(""),
        Line::from(vec![
            Span::styled("Ready to code? Just start typing!", Style::default().fg(theme.muted).add_modifier(Modifier::ITALIC)),
        ]),
    ];

    frame.render_widget(
        Paragraph::new(welcome_lines)
            .alignment(Alignment::Left)
            .style(Style::default().bg(theme.bg_primary)),
        area,
    );
}
