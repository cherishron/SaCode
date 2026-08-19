use ratatui::{
    style::{Modifier, Style},
    text::{Line, Span},
};
use unicode_width::UnicodeWidthChar;

use super::super::{Message, MessageRole, RenderedMessageLine, ThemePalette};
use super::markdown::render_assistant_markdown;

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
                if !msg.thinking.trim().is_empty() {
                    lines.extend(render_thinking_block(
                        &msg.thinking,
                        theme,
                        first,
                        msg.collapsed,
                        wrap_width,
                    ));
                    first = false;
                }
                let mut markdown_buffer = Vec::new();
                for content_line in msg.content.lines() {
                    if content_line.starts_with(PREFIX_TOOL) {
                        if !markdown_buffer.is_empty() {
                            lines.extend(render_assistant_markdown(
                                &markdown_buffer.join("\n"),
                                theme,
                                first,
                                wrap_width,
                            ));
                            markdown_buffer.clear();
                            first = false;
                        }
                        lines.extend(render_tool_block(content_line, theme, first, wrap_width));
                        first = false;
                        continue;
                    }
                    markdown_buffer.push(content_line.to_string());
                }
                if !markdown_buffer.is_empty() {
                    lines.extend(render_assistant_markdown(
                        &markdown_buffer.join("\n"),
                        theme,
                        first,
                        wrap_width,
                    ));
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

fn render_system_block(
    content: &str,
    theme: ThemePalette,
    width: usize,
) -> Vec<RenderedMessageLine> {
    let mut lines = Vec::new();

    for line in content.lines() {
        if line.trim().is_empty() {
            continue;
        }

        if line.starts_with(PREFIX_TOOL) {
            lines.extend(render_tool_block(line, theme, false, width));
            continue;
        }

        let (prefix, style) = if line.starts_with(PREFIX_WAITING) {
            ("● ", Style::default().fg(theme.agent))
        } else if line.starts_with(PREFIX_QUEUE) {
            ("● ", Style::default().fg(theme.info))
        } else if line.starts_with(PREFIX_SUCCESS) {
            ("● ", Style::default().fg(theme.build))
        } else if line.starts_with(PREFIX_ERROR) {
            ("● ", Style::default().fg(theme.warning))
        } else {
            ("● ", Style::default().fg(theme.muted))
        };

        let text = line
            .strip_prefix(PREFIX_WAITING)
            .or_else(|| line.strip_prefix(PREFIX_QUEUE))
            .or_else(|| line.strip_prefix(PREFIX_SUCCESS))
            .or_else(|| line.strip_prefix(PREFIX_ERROR))
            .unwrap_or(line)
            .trim_start();

        if text.is_empty() {
            continue;
        }

        push_wrapped_text_lines(&mut lines, prefix, "  ", text, style, style, width);
    }

    lines
}

fn render_tool_block(
    content: &str,
    theme: ThemePalette,
    first_in_message: bool,
    width: usize,
) -> Vec<RenderedMessageLine> {
    let mut lines = Vec::new();
    let text = content
        .strip_prefix(PREFIX_TOOL)
        .unwrap_or(content)
        .trim_start()
        .to_owned();

    // Parse "<ToolName> <status>" or "<ToolName> <status>: <summary>"
    let (tool_name, status, summary) = if let Some(col_idx) = text.find(':') {
        let before = &text[..col_idx];
        let after = text[col_idx + 1..].trim().to_owned();
        if let Some(space_idx) = before.rfind(' ') {
            let name = before[..space_idx].trim().to_owned();
            let s = before[space_idx + 1..].trim().to_owned();
            (name, s, Some(after))
        } else {
            (text.clone(), String::new(), None)
        }
    } else if let Some(space_idx) = text.rfind(' ') {
        let name = text[..space_idx].trim().to_owned();
        let s = text[space_idx + 1..].trim().to_owned();
        (name, s, None)
    } else {
        (text.clone(), String::new(), None)
    };

    let (icon, status_color, status_label_owned) = if status == "开始执行" || status == "...running" {
        ("▶", theme.info, "运行中".to_string())
    } else if status == "完成" || status == "完成 ✓" {
        ("✓", theme.build, "完成".to_string())
    } else if status == "失败" || status == "失败 ✗" {
        ("✗", theme.warning, "失败".to_string())
    } else {
        ("●", theme.info, status.clone())
    };

    // First line: icon ToolName
    let mut first_spans = vec![
        Span::styled(
            if first_in_message { "● " } else { "  " },
            Style::default().fg(theme.info),
        ),
        Span::styled(
            icon,
            Style::default().fg(status_color).add_modifier(Modifier::BOLD),
        ),
        Span::raw(" "),
        Span::styled(
            tool_name,
            Style::default().fg(theme.info).add_modifier(Modifier::BOLD),
        ),
    ];
    push_wrapped_line_spans(&mut lines, first_spans, width);

    // Second line: └─ status
    let mut status_spans = vec![Span::styled(
        "  └─ ",
        Style::default().fg(theme.muted).add_modifier(Modifier::DIM),
    )];
    status_spans.push(Span::styled(
        status_label_owned,
        Style::default().fg(status_color).add_modifier(Modifier::BOLD),
    ));
    if let Some(ref summary) = summary {
        status_spans.push(Span::styled(
            format!(": {}", summary),
            Style::default().fg(theme.text),
        ));
    }
    if status == "...running" || status == "开始执行" {
        status_spans.push(Span::styled(
            " (ctrl+b to background execution)",
            Style::default().fg(theme.muted).add_modifier(Modifier::DIM),
        ));
    }
    push_wrapped_line_spans(&mut lines, status_spans, width);

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
    let text = content.trim();

    push_wrapped_line_spans(
        &mut lines,
        vec![
            Span::styled(
                if first_in_message { "● " } else { "  " },
                Style::default().fg(theme.accent),
            ),
            Span::styled(
                if collapsed {
                    "思考 [已折叠]"
                } else {
                    "思考"
                },
                Style::default()
                    .fg(theme.accent)
                    .add_modifier(Modifier::BOLD),
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
            Style::default()
                .fg(theme.border)
                .add_modifier(Modifier::DIM),
            Style::default().fg(theme.text).add_modifier(Modifier::DIM),
            width,
        );
    }

    lines
}

pub(super) fn push_wrapped_text_lines(
    lines: &mut Vec<RenderedMessageLine>,
    first_prefix: &str,
    continuation_prefix: &str,
    text: &str,
    prefix_style: Style,
    text_style: Style,
    width: usize,
) {
    let wrapped = wrap_text(
        text,
        width.saturating_sub(display_width(first_prefix)).max(1),
    );

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

pub(super) fn push_wrapped_line_spans(
    lines: &mut Vec<RenderedMessageLine>,
    spans: Vec<Span<'static>>,
    width: usize,
) {
    let mut current_spans = Vec::new();
    let mut current_width = 0usize;
    let max_width = width.max(1);

    for span in spans {
        let style = span.style;
        for segment in wrap_text(
            span.content.as_ref(),
            max_width.saturating_sub(current_width).max(1),
        ) {
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

pub(super) fn display_width(text: &str) -> usize {
    text.chars()
        .map(|ch| UnicodeWidthChar::width(ch).unwrap_or(1).max(1))
        .sum()
}

fn body_style_for_message(msg: &Message, theme: ThemePalette) -> Style {
    match msg.role {
        MessageRole::User => Style::default().fg(theme.text),
        MessageRole::Assistant => Style::default().fg(theme.text),
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
