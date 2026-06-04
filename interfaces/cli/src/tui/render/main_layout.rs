use ratatui::{
    style::{Modifier, Style},
    text::{Line, Span},
};
use unicode_width::UnicodeWidthChar;

use super::super::{Message, MessageRole, RenderedMessageLine, ThemePalette};

const PREFIX_THINKING: &str = "[思考]";
const PREFIX_TOOL: &str = "[工具]";
const PREFIX_ERROR: &str = "[错误]";
const PREFIX_SUCCESS: &str = "[成功]";
const PREFIX_WAITING: &str = "[等待用户回答]";
const PREFIX_QUEUE: &str = "[队列]";

pub(crate) fn render_message_lines(
    messages: &[Message],
    theme: ThemePalette,
    width: usize,
) -> Vec<RenderedMessageLine> {
    let mut lines = Vec::new();
    let wrap_width = width.max(1);

    for msg in messages {
        let body_style = body_style_for_message(msg, theme);

        match msg.role {
            MessageRole::User => {
                for content_line in msg.content.lines() {
                    if content_line.trim().is_empty() {
                        continue;
                    }
                    push_wrapped_text_lines(
                        &mut lines,
                        "> ",
                        "  ",
                        content_line,
                        Style::default().fg(theme.user).add_modifier(Modifier::BOLD),
                        body_style,
                        wrap_width,
                    );
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
                            wrap_width,
                        ));
                        first = false;
                        continue;
                    }
                    if content_line.starts_with(PREFIX_TOOL) {
                        lines.extend(render_tool_block(content_line, theme, first, wrap_width));
                        first = false;
                        continue;
                    }
                    if first {
                        push_wrapped_text_lines(
                            &mut lines,
                            "● ",
                            "  ",
                            content_line,
                            Style::default().fg(theme.assistant).add_modifier(Modifier::BOLD),
                            body_style,
                            wrap_width,
                        );
                        first = false;
                    } else {
                        push_wrapped_text_lines(
                            &mut lines,
                            "   ",
                            "   ",
                            content_line,
                            Style::default(),
                            body_style,
                            wrap_width,
                        );
                    }
                }
                lines.push(RenderedMessageLine {
                    line: Line::from(Span::styled("", Style::default())),
                });
            }
            MessageRole::System => {
                lines.extend(render_system_block(&msg.content, theme, wrap_width));
                lines.push(RenderedMessageLine {
                    line: Line::from(Span::styled("", Style::default())),
                });
            }
        }
    }

    lines
}

fn render_system_block(content: &str, theme: ThemePalette, width: usize) -> Vec<RenderedMessageLine> {
    let mut lines = Vec::new();

    for line in content.lines() {
        if line.trim().is_empty() {
            continue;
        }

        if line.starts_with(PREFIX_TOOL) {
            lines.extend(render_tool_block(line, theme, false, width));
            continue;
        }

        if line.starts_with(PREFIX_THINKING) {
            lines.extend(render_thinking_block(line, theme, false, false, width));
            continue;
        }

        let (prefix, style) = if line.starts_with(PREFIX_WAITING) {
            (
                "● ",
                Style::default().fg(theme.agent),
            )
        } else if line.starts_with(PREFIX_QUEUE) {
            (
                "● ",
                Style::default().fg(theme.info),
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
            .or_else(|| line.strip_prefix(PREFIX_QUEUE))
            .or_else(|| line.strip_prefix(PREFIX_SUCCESS))
            .or_else(|| line.strip_prefix(PREFIX_ERROR))
            .or_else(|| line.strip_prefix(PREFIX_THINKING))
            .unwrap_or(line)
            .trim_start();

        if text.is_empty() {
            continue;
        }

        push_wrapped_text_lines(
            &mut lines,
            prefix,
            "  ",
            text,
            style,
            style,
            width,
        );
    }

    lines
}

fn render_tool_block(content: &str, theme: ThemePalette, first_in_message: bool, width: usize) -> Vec<RenderedMessageLine> {
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
    push_wrapped_line_spans(&mut lines, first_spans, width);

    // Second line: status hint
    push_wrapped_text_lines(
        &mut lines,
        "   ",
        "   ",
        "└─ ...running (ctrl+b to background execution)",
        Style::default(),
        Style::default().fg(theme.muted).add_modifier(Modifier::DIM),
        width,
    );

    lines
}

fn render_thinking_block(
    content: &str,
    theme: ThemePalette,
    first_in_message: bool,
    collapsed: bool,
    width: usize,
) -> Vec<RenderedMessageLine> {
    let mut lines = Vec::new();
    let text = content
        .strip_prefix(PREFIX_THINKING)
        .unwrap_or(content)
        .trim_start();

    push_wrapped_line_spans(
        &mut lines,
        vec![
            Span::styled(
                if first_in_message { "● " } else { "  " },
                Style::default().fg(theme.accent),
            ),
            Span::styled(
                if collapsed { "思考 [已折叠]" } else { "思考" },
                Style::default().fg(theme.accent).add_modifier(Modifier::BOLD),
            ),
        ],
        width,
    );

    if !collapsed && !text.is_empty() {
        push_wrapped_text_lines(
            &mut lines,
            "   │ ",
            "   │ ",
            text,
            Style::default().fg(theme.border).add_modifier(Modifier::DIM),
            Style::default().fg(theme.text).add_modifier(Modifier::DIM),
            width,
        );
    }

    lines
}

fn push_wrapped_text_lines(
    lines: &mut Vec<RenderedMessageLine>,
    first_prefix: &str,
    continuation_prefix: &str,
    text: &str,
    prefix_style: Style,
    text_style: Style,
    width: usize,
) {
    let wrapped = wrap_text(text, width.saturating_sub(display_width(first_prefix)).max(1));

    for (index, segment) in wrapped.into_iter().enumerate() {
        let prefix = if index == 0 {
            first_prefix
        } else {
            continuation_prefix
        };
        lines.push(RenderedMessageLine {
            line: Line::from(vec![
                Span::styled(prefix.to_string(), prefix_style),
                Span::styled(segment, text_style),
            ]),
        });
    }
}

fn push_wrapped_line_spans(
    lines: &mut Vec<RenderedMessageLine>,
    spans: Vec<Span<'static>>,
    width: usize,
) {
    let mut current_spans = Vec::new();
    let mut current_width = 0usize;
    let max_width = width.max(1);

    for span in spans {
        let style = span.style;
        for segment in wrap_text(span.content.as_ref(), max_width.saturating_sub(current_width).max(1)) {
            let segment_width = display_width(&segment);
            if current_width + segment_width > max_width && !current_spans.is_empty() {
                lines.push(RenderedMessageLine {
                    line: Line::from(current_spans),
                });
                current_spans = Vec::new();
                current_width = 0;
            }
            current_width += segment_width;
            current_spans.push(Span::styled(segment, style));
        }
    }

    if !current_spans.is_empty() {
        lines.push(RenderedMessageLine {
            line: Line::from(current_spans),
        });
    }
}

fn wrap_text(text: &str, width: usize) -> Vec<String> {
    let width = width.max(1);
    let mut lines = Vec::new();
    let mut current = String::new();
    let mut current_width = 0usize;

    for ch in text.chars() {
        let ch_width = UnicodeWidthChar::width(ch).unwrap_or(1).max(1);
        if current_width + ch_width > width && !current.is_empty() {
            lines.push(current);
            current = String::new();
            current_width = 0;
        }
        current.push(ch);
        current_width += ch_width;
    }

    if !current.is_empty() {
        lines.push(current);
    }

    if lines.is_empty() {
        lines.push(String::new());
    }

    lines
}

fn display_width(text: &str) -> usize {
    text.chars()
        .map(|ch| UnicodeWidthChar::width(ch).unwrap_or(1).max(1))
        .sum()
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
