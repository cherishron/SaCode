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
    let total_lines = app.total_rendered_message_line_count();
    let max_scroll = total_lines.saturating_sub(max_y);
    if app.follow_bottom {
        app.scroll_offset = max_scroll;
    } else {
        app.scroll_offset = app.scroll_offset.min(max_scroll);
    }
    let start = app.scroll_offset;
    let base_lines = app
        .visible_rendered_message_lines(start, max_y)
        .iter()
        .map(|line| line.line.clone())
        .collect::<Vec<_>>();
    let thinking_line = app.thinking_indicator_line().map(|line| line.line);
    let mut visible_lines = base_lines;

    if let Some(thinking_line) = thinking_line {
        let thinking_index = total_lines.saturating_sub(1);
        let end = start.saturating_add(max_y);
        if thinking_index >= start && thinking_index < end {
            if visible_lines.len() >= max_y && max_y > 0 {
                visible_lines.pop();
            }
            visible_lines.push(thinking_line);
        }
    }

    // Append inline pending question at the bottom
    if !app.interaction.pending_question_items.is_empty() && visible_lines.len() < max_y {
        visible_lines.extend(render_inline_pending_question(app));
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
    let label = if is_approval {
        "等待工具审批"
    } else {
        "等待用户回答"
    };

    // Header line
    lines.push(Line::from(vec![
        Span::styled("● ", Style::default().fg(theme.warning)),
        Span::styled(
            label,
            Style::default()
                .fg(theme.warning)
                .add_modifier(Modifier::BOLD),
        ),
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
        Span::styled(question.question.clone(), Style::default().fg(theme.text)),
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
                Style::default()
                    .fg(theme.accent)
                    .add_modifier(Modifier::BOLD)
            } else {
                Style::default().fg(theme.text)
            };
            let text = if option.description.is_empty() {
                format!("{} {} {}", prefix, mark, option.label)
            } else {
                format!(
                    "{} {} {} - {}",
                    prefix, mark, option.label, option.description
                )
            };
            lines.push(Line::from(vec![
                Span::styled("   ", Style::default()),
                Span::styled(text, style),
            ]));
        }
    }

    // Hint line
    let draft_answer = app.current_pending_custom_answer().unwrap_or_default();
    let hint = if app.interaction.pending_confirm_submission {
        "Enter: 确认提交 | Left: 返回上一题 | Esc: 返回"
    } else if app.input.is_empty() {
        if is_approval {
            "Up/Down: 选择 | Space: 勾选 | Enter: 提交 | Esc: 返回"
        } else {
            "Left/Right: 切题 | Up/Down: 选择 | Space: 勾选 | Enter: 下一题 | Esc: 返回"
        }
    } else {
        "Enter: 下一题 | Esc: 返回"
    };
    let answer_label = if app.interaction.pending_confirm_submission {
        "待提交回答"
    } else {
        "自定义回答"
    };
    lines.push(Line::from(vec![
        Span::styled("   ", Style::default()),
        Span::styled(
            format!("{}: {}", answer_label, draft_answer),
            Style::default().fg(theme.text),
        ),
    ]));
    lines.push(Line::from(vec![
        Span::styled("   ", Style::default()),
        Span::styled(
            hint,
            Style::default()
                .fg(theme.subtle)
                .add_modifier(Modifier::DIM),
        ),
    ]));

    lines
}

fn render_welcome_area(frame: &mut Frame, app: &App, area: Rect) {
    let theme = app.theme;

    let welcome_lines = vec![
        Line::from(""),
        Line::from(vec![
            Span::styled(
                "SaCode",
                Style::default()
                    .fg(theme.accent)
                    .add_modifier(Modifier::BOLD),
            ),
            Span::styled(
                format!("  v{}", env!("CARGO_PKG_VERSION")),
                Style::default().fg(theme.subtle),
            ),
        ]),
        Line::from(vec![Span::styled(
            "AI 编码工作区 · 直接描述你要做的事",
            Style::default().fg(theme.muted),
        )]),
        Line::from(""),
        Line::from(vec![
            Span::styled("› ", Style::default().fg(theme.accent)),
            Span::styled("输入任务，Enter 发送", Style::default().fg(theme.text)),
        ]),
        Line::from(vec![
            Span::styled("/ ", Style::default().fg(theme.tool)),
            Span::styled(
                "login 接入模型 · models 切换 · audit / design …",
                Style::default().fg(theme.text),
            ),
        ]),
        Line::from(vec![
            Span::styled("  ", Style::default()),
            Span::styled(
                "Alt+M 模式 · Ctrl+T 思考 · Ctrl+Q 退出",
                Style::default().fg(theme.subtle),
            ),
        ]),
    ];

    frame.render_widget(
        Paragraph::new(welcome_lines)
            .alignment(Alignment::Left)
            .style(Style::default().bg(theme.bg_primary)),
        area,
    );
}
