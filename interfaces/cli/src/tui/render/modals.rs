use ratatui::{
    layout::{Constraint, Direction, Layout},
    style::Style,
    text::{Line, Span},
    widgets::Paragraph,
    Frame,
};

use crate::cmd::config;

use super::common::{centered_rect, render_modal_block};
use super::super::App;

pub(crate) fn render_input_optimization_preview(frame: &mut Frame, app: &App) {
    let theme = app.theme;
    let Some(preview) = &app.pending_input_optimization else {
        return;
    };

    let area = centered_rect(frame.area(), 78, 62);
    let inner = render_modal_block(
        frame,
        area,
        format!("输入优化预览 [{}]", preview.model_name),
        theme,
    );

    let sections = Layout::default()
        .direction(Direction::Vertical)
        .constraints([
            Constraint::Length(1),
            Constraint::Percentage(44),
            Constraint::Length(1),
            Constraint::Percentage(44),
            Constraint::Length(1),
        ])
        .split(inner);

    let original_lines = preview
        .original
        .lines()
        .map(|line| Line::from(Span::styled(line, Style::default().fg(theme.user))))
        .collect::<Vec<_>>();
    let optimized_lines = preview
        .optimized
        .lines()
        .map(|line| Line::from(Span::styled(line, Style::default().fg(theme.assistant))))
        .collect::<Vec<_>>();

    frame.render_widget(
        Paragraph::new(Line::from(vec![
            Span::styled("原始输入", Style::default().fg(theme.subtle)),
            Span::raw("  "),
            Span::styled(
                format!("长度 {}", preview.original.chars().count()),
                Style::default().fg(theme.warning),
            ),
        ])),
        sections[0],
    );
    frame.render_widget(Paragraph::new(original_lines), sections[1]);

    frame.render_widget(
        Paragraph::new(Line::from(vec![
            Span::styled("优化建议", Style::default().fg(theme.subtle)),
            Span::raw("  "),
            Span::styled(
                format!("长度 {}", preview.optimized.chars().count()),
                Style::default().fg(theme.warning),
            ),
        ])),
        sections[2],
    );
    frame.render_widget(Paragraph::new(optimized_lines), sections[3]);

    frame.render_widget(
        Paragraph::new(Line::from(vec![
            Span::styled("Enter", Style::default().fg(theme.accent)),
            Span::styled(" 应用优化  ", Style::default().fg(theme.subtle)),
            Span::styled("Esc", Style::default().fg(theme.accent)),
            Span::styled(" 取消", Style::default().fg(theme.subtle)),
        ])),
        sections[4],
    );
}

#[cfg(test)]
pub(crate) fn render_pending_question_panel(frame: &mut Frame, app: &App) {
    use ratatui::style::Modifier;

    let theme = app.theme;
    if app.interaction.pending_question_items.is_empty() {
        return;
    }

    let is_approval = app.interaction.pending_approval_request.is_some();
    let title = if is_approval {
        "等待工具审批"
    } else {
        "等待用户回答"
    };

    let area = centered_rect(frame.area(), 78, 62);
    let inner = render_modal_block(frame, area, title, theme);

    let sections = Layout::default()
        .direction(Direction::Vertical)
        .constraints([
            Constraint::Length(1),
            Constraint::Length(3),
            Constraint::Min(6),
            Constraint::Length(2),
        ])
        .split(inner);

    let tab_spans = app
        .interaction
        .pending_question_items
        .iter()
        .enumerate()
        .flat_map(|(index, _)| {
            let style = if index == app.interaction.selected_pending_question_index {
                Style::default()
                    .fg(theme.selected_fg)
                    .bg(theme.selected_bg)
                    .add_modifier(Modifier::BOLD)
            } else {
                Style::default().fg(theme.text)
            };
            vec![
                Span::styled(format!(" Q{} ", index + 1), style),
                Span::raw(" "),
            ]
        })
        .collect::<Vec<_>>();
    frame.render_widget(Paragraph::new(Line::from(tab_spans)), sections[0]);

    let Some(question) = app.current_pending_question() else {
        return;
    };

    let question_lines = if let Some(request) = &app.interaction.pending_approval_request {
        vec![
            Line::from(vec![
                Span::styled(
                    "审批工具",
                    Style::default().fg(theme.warning).add_modifier(Modifier::BOLD),
                ),
                Span::raw("  "),
                Span::styled(&request.tool_name, Style::default().fg(theme.info)),
            ]),
            Line::from(Span::styled(
                &question.question,
                Style::default()
                    .fg(theme.assistant)
                    .add_modifier(Modifier::BOLD),
            )),
            Line::from(Span::styled(
                "提交后会按当前执行模式继续任务。",
                Style::default().fg(theme.subtle),
            )),
        ]
    } else {
        vec![
            Line::from(Span::styled(
                &question.question,
                Style::default()
                    .fg(theme.assistant)
                    .add_modifier(Modifier::BOLD),
            )),
            Line::from(Span::styled(
                if question.allow_multiple {
                    "多选：Space 勾选，Enter 提交"
                } else {
                    "单选：方向键选择，Space 勾选，Enter 提交"
                },
                Style::default().fg(theme.subtle),
            )),
        ]
    };
    frame.render_widget(Paragraph::new(question_lines), sections[1]);

    let selected_answers = app
        .interaction
        .selected_pending_answers
        .get(app.interaction.selected_pending_question_index)
        .cloned()
        .unwrap_or_default();
    let option_lines = if question.options.is_empty() {
        vec![Line::from(Span::styled(
            "没有预设选项，请在底部输入自定义回答。",
            Style::default().fg(theme.warning),
        ))]
    } else {
        question
            .options
            .iter()
            .enumerate()
            .map(|(index, option)| {
                let selected = selected_answers.contains(&index);
                let cursor = index == app.interaction.selected_pending_option_index;
                let mark = if selected { "[x]" } else { "[ ]" };
                let prefix = if cursor { ">" } else { " " };
                let text = if option.description.is_empty() {
                    format!("{} {} {}", prefix, mark, option.label)
                } else {
                    format!(
                        "{} {} {} - {}",
                        prefix, mark, option.label, option.description
                    )
                };
                let style = if cursor {
                    Style::default().fg(theme.selected_fg).bg(theme.selected_bg)
                } else if selected {
                    Style::default()
                        .fg(theme.accent)
                        .add_modifier(Modifier::BOLD)
                } else {
                    Style::default().fg(theme.text)
                };
                Line::styled(text, style)
            })
            .collect::<Vec<_>>()
    };
    frame.render_widget(Paragraph::new(option_lines), sections[2]);

    let hint = if app.input.is_empty() {
        if is_approval {
            "Up/Down: 选择审批结果 | Space: 勾选 | Enter: 提交 | Esc: 返回聊天"
        } else {
            "Left/Right: 切换问题 | Up/Down: 选择 | Space: 勾选 | Enter: 提交 | Esc: 返回聊天 | 直接输入可自定义回答"
        }
    } else {
        "Enter: 提交自定义回答 | Esc: 返回聊天"
    };
    frame.render_widget(
        Paragraph::new(vec![
            Line::from(Span::styled(
                format!("自定义回答: {}", app.input),
                Style::default().fg(theme.text),
            )),
            Line::from(Span::styled(hint, Style::default().fg(theme.subtle))),
        ]),
        sections[3],
    );
}

pub(crate) fn render_config_selector(frame: &mut Frame, app: &App) {
    let theme = app.theme;
    let area = centered_rect(frame.area(), 78, 68);
    let title = format!(
        "配置管理 [{}级]",
        match app.config_scope {
            config::ConfigScope::User => "用户",
            config::ConfigScope::Project => "项目",
        }
    );
    let inner = render_modal_block(frame, area, title, theme);

    let start = app.selected_config_index.saturating_sub(5);
    let end = (start + 10).min(app.config_items.len());
    let lines: Vec<Line> = app.config_items[start..end]
        .iter()
        .enumerate()
        .flat_map(|(offset, item)| {
            let index = start + offset;
            let is_selected = index == app.selected_config_index;
            let style = if is_selected {
                Style::default().fg(theme.selected_fg).bg(theme.selected_bg)
            } else {
                Style::default().fg(theme.text)
            };
            vec![
                Line::styled(
                    format!(
                        "[{}] {:<16} 生效:{:<12} 当前:{:<12} {}",
                        item.category, item.name, item.value, item.scope_value, item.key
                    ),
                    style,
                ),
                Line::styled(
                    format!("    {}", item.description),
                    Style::default().fg(theme.subtle),
                ),
            ]
        })
        .collect();

    frame.render_widget(Paragraph::new(lines), inner);
}

pub(crate) fn render_config_enum_selector(frame: &mut Frame, app: &App) {
    let theme = app.theme;
    let title = app
        .pending_config_key
        .as_deref()
        .and_then(config::config_item)
        .map(|item| format!("选择: {}", item.display_name))
        .unwrap_or_else(|| "选择配置值".to_string());
    let area = centered_rect(frame.area(), 56, 38);
    let inner = render_modal_block(frame, area, title, theme);

    let lines: Vec<Line> = app
        .config_enum_options
        .iter()
        .enumerate()
        .map(|(index, (value, label))| {
            let is_selected = index == app.selected_config_enum_index;
            let style = if is_selected {
                Style::default().fg(theme.selected_fg).bg(theme.selected_bg)
            } else {
                Style::default().fg(theme.text)
            };
            Line::styled(format!("{} ({})", label, value), style)
        })
        .collect();

    frame.render_widget(Paragraph::new(lines), inner);
}
