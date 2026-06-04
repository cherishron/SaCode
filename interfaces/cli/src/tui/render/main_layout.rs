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
        let body_style = body_style_for_message(msg, theme);

        match msg.role {
            MessageRole::User => {
                for content_line in msg.content.lines() {
                    if content_line.trim().is_empty() {
                        continue;
                    }
                    lines.push(RenderedMessageLine {
                        line: Line::from(vec![
                            Span::styled("> ",
                                Style::default().fg(theme.user).add_modifier(Modifier::BOLD),
                            ),
                            Span::styled(content_line.to_string(), body_style),
                        ]),
                    });
                }
                lines.push(RenderedMessageLine {
                    line: Line::from(Span::styled("", Style::default())),
                });
            }
            MessageRole::Assistant => {
                let mut first = true;
                for content_line in msg.content.lines() {
                    if content_line.trim().is_empty() {
                        continue;
                    }
                    if content_line.starts_with(PREFIX_THINKING) {
                        lines.extend(render_thinking_block(
                            content_line,
                            theme,
                            first,
                            msg.collapsed,
                        ));
                        first = false;
                        continue;
                    }
                    if content_line.starts_with(PREFIX_TOOL) {
                        lines.extend(render_tool_block(content_line, theme, first));
                        first = false;
                        continue;
                    }
                    if first {
                        lines.push(RenderedMessageLine {
                            line: Line::from(vec![
                                Span::styled(
                                    "● ",
                                    Style::default().fg(theme.assistant).add_modifier(Modifier::BOLD),
                                ),
                                Span::styled(content_line.to_string(), body_style),
                            ]),
                        });
                        first = false;
                    } else {
                        lines.push(RenderedMessageLine {
                            line: Line::from(vec![
                                Span::styled("   ", Style::default()),
                                Span::styled(content_line.to_string(), body_style),
                            ]),
                        });
                    }
                }
                lines.push(RenderedMessageLine {
                    line: Line::from(Span::styled("", Style::default())),
                });
            }
            MessageRole::System => {
                lines.extend(render_system_block(&msg.content, theme));
                lines.push(RenderedMessageLine {
                    line: Line::from(Span::styled("", Style::default())),
                });
            }
        }
    }

    lines
}

fn render_system_block(content: &str, theme: ThemePalette) -> Vec<RenderedMessageLine> {
    let mut lines = Vec::new();

    for line in content.lines() {
        if line.trim().is_empty() {
            continue;
        }

        if line.starts_with(PREFIX_TOOL) {
            lines.extend(render_tool_block(line, theme, false));
            continue;
        }

        if line.starts_with(PREFIX_THINKING) {
            lines.extend(render_thinking_block(line, theme, false, false));
            continue;
        }

        let (prefix, style) = if line.starts_with(PREFIX_WAITING) {
            (
                "● ",
                Style::default().fg(theme.agent),
            )
        } else if line.starts_with(PREFIX_SUCCESS) {
            (
                "● ",
                Style::default().fg(theme.build),
            )
        } else if line.starts_with(PREFIX_ERROR) {
            (
                "● ",
                Style::default().fg(theme.warning),
            )
        } else {
            (
                "● ",
                Style::default().fg(theme.muted),
            )
        };

        let text = line
            .strip_prefix(PREFIX_WAITING)
            .or_else(|| line.strip_prefix(PREFIX_SUCCESS))
            .or_else(|| line.strip_prefix(PREFIX_ERROR))
            .or_else(|| line.strip_prefix(PREFIX_THINKING))
            .unwrap_or(line)
            .trim_start();

        if text.is_empty() {
            continue;
        }

        lines.push(RenderedMessageLine {
            line: Line::from(vec![
                Span::styled(prefix.to_string(), style),
                Span::styled(text.to_string(), style),
            ]),
        });
    }

    lines
}

fn render_tool_block(content: &str, theme: ThemePalette, first_in_message: bool) -> Vec<RenderedMessageLine> {
    let mut lines = Vec::new();
    let text = content.strip_prefix(PREFIX_TOOL).unwrap_or(content).trim_start();

    // Try to parse "ToolName(args)" or "ToolName rest"
    let (tool_name, args) = if let Some(open_idx) = text.find('(') {
        if text.ends_with(')') {
            let name = &text[..open_idx];
            let args = &text[open_idx + 1..text.len() - 1];
            (name.trim(), Some(args.trim()))
        } else {
            (text, None)
        }
    } else {
        let parts: Vec<&str> = text.splitn(2, ' ').collect();
        if parts.len() == 2 {
            (parts[0], Some(parts[1]))
        } else {
            (text, None)
        }
    };

    // First line: ● ToolName(args)
    let mut first_spans = vec![
        Span::styled(
            if first_in_message { "● " } else { "  " },
            Style::default().fg(theme.info),
        ),
    ];
    if let Some(args) = args {
        first_spans.push(Span::styled(
            format!("{}(", tool_name),
            Style::default().fg(theme.info).add_modifier(Modifier::BOLD),
        ));
        first_spans.push(Span::styled(
            args.to_string(),
            Style::default().fg(theme.text),
        ));
        first_spans.push(Span::styled(
            ")",
            Style::default().fg(theme.info).add_modifier(Modifier::BOLD),
        ));
    } else {
        first_spans.push(Span::styled(
            tool_name.to_string(),
            Style::default().fg(theme.info).add_modifier(Modifier::BOLD),
        ));
    }
    lines.push(RenderedMessageLine {
        line: Line::from(first_spans),
    });

    // Second line: status hint
    lines.push(RenderedMessageLine {
        line: Line::from(vec![
            Span::styled("   ", Style::default()),
            Span::styled(
                "└─ ...running (ctrl+b to background execution)",
                Style::default().fg(theme.muted).add_modifier(Modifier::DIM),
            ),
        ]),
    });

    lines
}

fn render_thinking_block(
    content: &str,
    theme: ThemePalette,
    first_in_message: bool,
    collapsed: bool,
) -> Vec<RenderedMessageLine> {
    let mut lines = Vec::new();
    let text = content
        .strip_prefix(PREFIX_THINKING)
        .unwrap_or(content)
        .trim_start();

    lines.push(RenderedMessageLine {
        line: Line::from(vec![
            Span::styled(
                if first_in_message { "● " } else { "  " },
                Style::default().fg(theme.accent),
            ),
            Span::styled(
                if collapsed { "思考 [已折叠]" } else { "思考" },
                Style::default().fg(theme.accent).add_modifier(Modifier::BOLD),
            ),
        ]),
    });

    if !collapsed && !text.is_empty() {
        lines.push(RenderedMessageLine {
            line: Line::from(vec![
                Span::styled("   ", Style::default()),
                Span::styled(
                    "│ ",
                    Style::default().fg(theme.border).add_modifier(Modifier::DIM),
                ),
                Span::styled(
                    text.to_string(),
                    Style::default().fg(theme.text).add_modifier(Modifier::DIM),
                ),
            ]),
        });
    }

    lines
}

fn body_style_for_message(msg: &Message, theme: ThemePalette) -> Style {
    match msg.role {
        MessageRole::User => Style::default().fg(theme.text),
        MessageRole::Assistant => {
            if msg.content.lines().any(|line| line.starts_with(PREFIX_THINKING)) {
                Style::default().fg(theme.text)
            } else if msg.content.lines().any(|line| line.starts_with(PREFIX_TOOL)) {
                Style::default().fg(theme.text)
            } else {
                Style::default().fg(theme.text)
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
