use ratatui::{
    style::{Modifier, Style},
    text::{Line, Span},
};

use super::super::{Message, MessageRole, RenderedMessageLine, ThemePalette};

const PREFIX_THINKING: &str = "[思考]";
const PREFIX_TOOL: &str = "[工具]";
const PREFIX_ERROR: &str = "[错误]";
const PREFIX_SUCCESS: &str = "[成功]";
const PREFIX_WAITING: &str = "[等待用户回答]";

pub(crate) fn render_message_lines(
    messages: &[Message],
    theme: ThemePalette,
) -> Vec<RenderedMessageLine> {
    let mut lines = Vec::new();

    for msg in messages {
        let header_style = header_style_for_message(msg, theme);
        let body_style = body_style_for_message(msg, theme);
        let role_label = role_label_for_message(msg);
        let lane_label = lane_label_for_message(msg);
        let collapsed_label = if msg.collapsed { "fold" } else { "open" };

        lines.push(RenderedMessageLine {
            line: Line::from(vec![
                Span::styled("● ", header_style),
                Span::styled(msg.timestamp.clone(), Style::default().fg(theme.subtle)),
                Span::raw("  "),
                Span::styled(role_label, header_style.add_modifier(Modifier::BOLD)),
                Span::raw("  "),
                Span::styled(
                    lane_label,
                    Style::default()
                        .fg(header_style.fg.unwrap_or(theme.text))
                        .bg(theme.bg_surface)
                        .add_modifier(Modifier::BOLD),
                ),
                Span::raw("  "),
                Span::styled(collapsed_label, Style::default().fg(theme.muted)),
            ]),
        });

        if msg.collapsed {
            let compact = msg.content.split_whitespace().collect::<Vec<_>>().join(" ");
            let mut chars = compact.chars();
            let preview: String = chars.by_ref().take(100).collect();
            let suffix = if chars.next().is_some() { "..." } else { "" };
            lines.push(indented_line(
                format!("│ {}{}", preview, suffix),
                body_style,
            ));
        } else {
            if matches!(msg.role, MessageRole::System) {
                lines.extend(render_system_block(&msg.content, theme));
                lines.push(RenderedMessageLine {
                    line: Line::from(Span::styled("", Style::default().bg(theme.bg_primary))),
                });
                continue;
            }

            for content_line in msg.content.lines() {
                if let Some(stripped) = content_line.strip_prefix(PREFIX_TOOL) {
                    lines.extend(render_tool_block(stripped.trim_start(), theme));
                    continue;
                }

                let rendered_line = if content_line.trim().is_empty() {
                    "│".to_string()
                } else if let Some(stripped) = content_line.strip_prefix(PREFIX_THINKING) {
                    format!("│ thinking {}", stripped.trim_start())
                } else if let Some(stripped) = content_line.strip_prefix(PREFIX_ERROR) {
                    format!("│ error {}", stripped.trim_start())
                } else if let Some(stripped) = content_line.strip_prefix(PREFIX_SUCCESS) {
                    format!("│ success {}", stripped.trim_start())
                } else {
                    format!("│ {}", content_line)
                };
                lines.push(indented_line(rendered_line, body_style));
            }
        }

        lines.push(RenderedMessageLine {
            line: Line::from(Span::styled("", Style::default().bg(theme.bg_primary))),
        });
    }

    lines
}

fn render_system_block(content: &str, theme: ThemePalette) -> Vec<RenderedMessageLine> {
    let (label, style, body_prefix) = if content.starts_with(PREFIX_WAITING) {
        (
            "wait",
            Style::default().fg(theme.agent).bg(theme.bg_surface),
            PREFIX_WAITING,
        )
    } else if content.starts_with(PREFIX_SUCCESS) {
        (
            "success",
            Style::default().fg(theme.build).bg(theme.bg_surface),
            PREFIX_SUCCESS,
        )
    } else if content.starts_with(PREFIX_ERROR) {
        (
            "error",
            Style::default().fg(theme.warning).bg(theme.bg_surface),
            PREFIX_ERROR,
        )
    } else {
        (
            "info",
            Style::default().fg(theme.muted).bg(theme.bg_surface),
            "",
        )
    };

    let mut body_lines = Vec::new();
    for line in content.lines() {
        let text = if body_prefix.is_empty() {
            line.trim()
        } else {
            line.strip_prefix(body_prefix).unwrap_or(line).trim()
        };
        if text.is_empty() {
            continue;
        }
        body_lines.push(indented_line(format!("││ {}", text), style));
    }
    if body_lines.is_empty() {
        body_lines.push(indented_line("││".to_string(), style));
    }

    let mut lines = vec![indented_line(
        format!("│╭ {}", label),
        style.add_modifier(Modifier::BOLD),
    )];
    lines.extend(body_lines);
    lines.push(indented_line(
        "│╰ status".to_string(),
        style.add_modifier(Modifier::DIM),
    ));
    lines
}

fn render_tool_block(content: &str, theme: ThemePalette) -> Vec<RenderedMessageLine> {
    let tool_style = Style::default().fg(theme.info).bg(theme.bg_surface);
    vec![
        indented_line("│╭ tool".to_string(), tool_style.add_modifier(Modifier::BOLD)),
        indented_line(format!("││ {}", content), tool_style),
        indented_line("│╰ done".to_string(), tool_style.add_modifier(Modifier::DIM)),
    ]
}

fn indented_line(text: String, style: Style) -> RenderedMessageLine {
    RenderedMessageLine {
        line: Line::from(Span::styled(text, style)),
    }
}

fn role_label_for_message(msg: &Message) -> &'static str {
    match msg.role {
        MessageRole::User => "你",
        MessageRole::Assistant => "SaCode",
        MessageRole::System => "系统",
    }
}

fn lane_label_for_message(msg: &Message) -> &'static str {
    if matches!(msg.role, MessageRole::System) {
        if msg.content.starts_with(PREFIX_WAITING) {
            "wait"
        } else if msg.content.starts_with(PREFIX_ERROR) {
            "error"
        } else if msg.content.starts_with(PREFIX_SUCCESS) {
            "success"
        } else {
            "info"
        }
    } else if msg.content.lines().any(|line| line.starts_with(PREFIX_THINKING)) {
        "thinking"
    } else if msg.content.lines().any(|line| line.starts_with(PREFIX_TOOL)) {
        "tools"
    } else {
        "reply"
    }
}

fn header_style_for_message(msg: &Message, theme: ThemePalette) -> Style {
    match msg.role {
        MessageRole::User => Style::default().fg(theme.user),
        MessageRole::Assistant => {
            if msg.content.lines().any(|line| line.starts_with(PREFIX_THINKING)) {
                Style::default().fg(theme.agent)
            } else if msg.content.lines().any(|line| line.starts_with(PREFIX_TOOL)) {
                Style::default().fg(theme.info)
            } else {
                Style::default().fg(theme.assistant)
            }
        }
        MessageRole::System => {
            if msg.content.starts_with(PREFIX_WAITING) {
                Style::default().fg(theme.agent)
            } else if msg.content.starts_with(PREFIX_ERROR) {
                Style::default().fg(theme.warning)
            } else if msg.content.starts_with(PREFIX_SUCCESS) {
                Style::default().fg(theme.build)
            } else {
                Style::default().fg(theme.muted)
            }
        }
    }
}

fn body_style_for_message(msg: &Message, theme: ThemePalette) -> Style {
    match msg.role {
        MessageRole::User => Style::default().fg(theme.text).bg(theme.bg_elevated),
        MessageRole::Assistant => {
            if msg.content.lines().any(|line| line.starts_with(PREFIX_THINKING)) {
                Style::default().fg(theme.text).bg(theme.bg_surface)
            } else if msg.content.lines().any(|line| line.starts_with(PREFIX_TOOL)) {
                Style::default().fg(theme.text).bg(theme.bg_surface)
            } else {
                Style::default().fg(theme.text).bg(theme.bg_primary)
            }
        }
        MessageRole::System => {
            if msg.content.starts_with(PREFIX_WAITING) {
                Style::default().fg(theme.agent).bg(theme.bg_surface)
            } else if msg.content.starts_with(PREFIX_ERROR) {
                Style::default().fg(theme.warning).bg(theme.bg_surface)
            } else if msg.content.starts_with(PREFIX_SUCCESS) {
                Style::default().fg(theme.build).bg(theme.bg_surface)
            } else {
                Style::default().fg(theme.muted).bg(theme.bg_surface)
            }
        }
    }
}
