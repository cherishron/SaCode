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
                // User message: > content
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
                // Add blank line after user message
                lines.push(RenderedMessageLine {
                    line: Line::from(Span::styled("", Style::default())),
                });
            }
            MessageRole::Assistant => {
                // Assistant message: ● content
                let mut first = true;
                for content_line in msg.content.lines() {
                    if content_line.trim().is_empty() {
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
                // Add blank line after assistant message
                lines.push(RenderedMessageLine {
                    line: Line::from(Span::styled("", Style::default())),
                });
            }
            MessageRole::System => {
                // System messages rendered as inline blocks
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
        } else if line.starts_with(PREFIX_THINKING) {
            (
                "● ",
                Style::default().fg(theme.agent).add_modifier(Modifier::DIM),
            )
        } else if line.starts_with(PREFIX_TOOL) {
            (
                "● ",
                Style::default().fg(theme.info),
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
            .or_else(|| line.strip_prefix(PREFIX_TOOL))
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
