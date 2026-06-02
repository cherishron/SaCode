use ratatui::{
    style::{Modifier, Style},
    text::{Line, Span},
};

use super::super::{Message, MessageRole, RenderedMessageLine, ThemePalette};

pub(crate) fn render_message_lines(messages: &[Message], theme: ThemePalette) -> Vec<RenderedMessageLine> {
    let mut lines = Vec::new();

    for msg in messages {
        let role_style = match msg.role {
            MessageRole::User => Style::default().fg(theme.user),
            MessageRole::Assistant => Style::default().fg(theme.assistant),
            MessageRole::System => Style::default().fg(theme.system),
        };

        let role_label = match msg.role {
            MessageRole::User => "你",
            MessageRole::Assistant => "SaCode",
            MessageRole::System => "系统",
        };

        lines.push(RenderedMessageLine {
            line: Line::from(vec![
                Span::styled(msg.timestamp.clone(), Style::default().fg(theme.subtle)),
                Span::raw(" "),
                Span::styled(role_label, role_style.add_modifier(Modifier::BOLD)),
                Span::raw(" "),
                Span::styled(
                    if msg.collapsed { "[折叠]" } else { "[展开]" },
                    Style::default().fg(theme.subtle),
                ),
            ]),
        });

        if msg.collapsed {
            let compact = msg.content.split_whitespace().collect::<Vec<_>>().join(" ");
            let mut chars = compact.chars();
            let preview: String = chars.by_ref().take(100).collect();
            let suffix = if chars.next().is_some() { "..." } else { "" };
            lines.push(RenderedMessageLine {
                line: Line::from(Span::styled(
                    format!("{}{}", preview, suffix),
                    Style::default().fg(theme.text),
                )),
            });
        } else {
            for content_line in msg.content.lines() {
                lines.push(RenderedMessageLine {
                    line: Line::from(Span::styled(
                        content_line.to_string(),
                        Style::default().fg(theme.text),
                    )),
                });
            }
        }

        lines.push(RenderedMessageLine {
            line: Line::from(""),
        });
    }

    lines
}
