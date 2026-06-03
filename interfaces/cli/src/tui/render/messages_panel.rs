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
    if app.is_messages_empty() && app.interaction.pending_question_items.is_empty() {
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
    let mut visible_lines = app
        .visible_rendered_message_lines(start, max_y)
        .iter()
        .map(|line| line.line.clone())
        .collect::<Vec<_>>();

    // Append inline pending question at the bottom
    if !app.interaction.pending_question_items.is_empty() {
        if visible_lines.len() < max_y {
            visible_lines.extend(render_inline_pending_question(app));
        }
    }

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

fn render_inline_pending_question(app: &App) -> Vec<Line<'static>> {
    let theme = app.theme;
    let mut lines = Vec::new();

    let is_approval = app.interaction.pending_approval_request.is_some();
    let label = if is_approval { "等待工具审批" } else { "等待用户回答" };

    // Header line
    lines.push(Line::from(vec![
        Span::styled("● ", Style::default().fg(theme.warning)),
        Span::styled(label, Style::default().fg(theme.warning).add_modifier(Modifier::BOLD)),
    ]));

    let Some(question) = app.current_pending_question() else {
        return lines;
    };

    // Approval tool info
    if let Some(request) = &app.interaction.pending_approval_request {
        lines.push(Line::from(vec![
            Span::styled("   ", Style::default()),
            Span::styled(
                format!("{}({})", request.tool_name, request.task_prompt),
                Style::default().fg(theme.info).add_modifier(Modifier::BOLD),
            ),
        ]));
    }

    // Question text
    lines.push(Line::from(vec![
        Span::styled("   ", Style::default()),
        Span::styled(
            question.question.clone(),
            Style::default().fg(theme.text),
        ),
    ]));

    // Options
    let selected_answers = app
        .interaction
        .selected_pending_answers
        .get(app.interaction.selected_pending_question_index)
        .cloned()
        .unwrap_or_default();

    if question.options.is_empty() {
        lines.push(Line::from(vec![
            Span::styled("   ", Style::default()),
            Span::styled(
                "没有预设选项，请在底部输入自定义回答。",
                Style::default().fg(theme.muted),
            ),
        ]));
    } else {
        for (index, option) in question.options.iter().enumerate() {
            let selected = selected_answers.contains(&index);
            let cursor = index == app.interaction.selected_pending_option_index;
            let mark = if selected { "[x]" } else { "[ ]" };
            let prefix = if cursor { ">" } else { " " };
            let style = if cursor {
                Style::default().fg(theme.selected_fg).bg(theme.selected_bg)
            } else if selected {
                Style::default().fg(theme.accent).add_modifier(Modifier::BOLD)
            } else {
                Style::default().fg(theme.text)
            };
            let text = if option.description.is_empty() {
                format!("{} {} {}", prefix, mark, option.label)
            } else {
                format!("{} {} {} - {}", prefix, mark, option.label, option.description)
            };
            lines.push(Line::from(vec![
                Span::styled("   ", Style::default()),
                Span::styled(text, style),
            ]));
        }
    }

    // Hint line
    let hint = if app.input.is_empty() {
        if is_approval {
            "Up/Down: 选择 | Space: 勾选 | Enter: 提交 | Esc: 返回"
        } else {
            "Up/Down: 选择 | Space: 勾选 | Enter: 提交 | Esc: 返回"
        }
    } else {
        "Enter: 提交自定义回答 | Esc: 返回"
    };
    lines.push(Line::from(vec![
        Span::styled("   ", Style::default()),
        Span::styled(hint, Style::default().fg(theme.subtle).add_modifier(Modifier::DIM)),
    ]));

    lines
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
