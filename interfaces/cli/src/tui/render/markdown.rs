use pulldown_cmark::{CodeBlockKind, Event, HeadingLevel, Options, Parser, Tag, TagEnd};
use ratatui::{
    style::{Modifier, Style},
    text::{Line, Span},
};

use super::main_layout::{display_width, push_wrapped_line_spans, push_wrapped_text_lines};
use crate::tui::{RenderedMessageLine, ThemePalette};

#[derive(Clone, Copy)]
enum ListKind {
    Bullet,
    Ordered,
}

#[derive(Default)]
struct TableState {
    alignments: Vec<pulldown_cmark::Alignment>,
    rows: Vec<Vec<String>>,
    current_row: Vec<String>,
    current_cell: String,
    in_head: bool,
    row_open: bool,
}

pub(crate) fn render_assistant_markdown(
    content: &str,
    theme: ThemePalette,
    first_in_message: bool,
    width: usize,
) -> Vec<RenderedMessageLine> {
    let mut lines = Vec::new();
    let parser = Parser::new_ext(content, Options::all());

    let mut current_spans: Vec<Span<'static>> = Vec::new();
    let mut prefix_first = if first_in_message { "● " } else { "   " };
    let mut prefix_rest = "   ";
    let mut prefix_style = Style::default()
        .fg(theme.assistant)
        .add_modifier(Modifier::BOLD);
    let mut current_style = Style::default().fg(theme.text);
    let mut style_stack: Vec<Style> = vec![current_style];
    let mut list_stack: Vec<ListKind> = Vec::new();
    let mut ordered_index_stack: Vec<usize> = Vec::new();
    let mut pending_item_prefix: Option<String> = None;
    let mut in_code_block = false;
    let mut table_state: Option<TableState> = None;

    for event in parser {
        if let Some(table) = table_state.as_mut() {
            match event {
                Event::Start(Tag::Table(alignments)) => {
                    table.alignments = alignments;
                }
                Event::Start(Tag::TableHead) => {
                    table.in_head = true;
                    table.current_row.clear();
                    table.row_open = true;
                }
                Event::End(TagEnd::TableHead) => {
                    if table.row_open && !table.current_row.is_empty() {
                        table.rows.push(table.current_row.clone());
                        table.current_row.clear();
                        table.row_open = false;
                    }
                    table.in_head = false;
                }
                Event::Start(Tag::TableRow) => {
                    table.current_row.clear();
                    table.row_open = true;
                }
                Event::End(TagEnd::TableRow) => {
                    if !table.current_cell.is_empty() {
                        table
                            .current_row
                            .push(table.current_cell.trim().to_string());
                        table.current_cell.clear();
                    }
                    if !table.current_row.is_empty() {
                        table.rows.push(table.current_row.clone());
                    }
                    table.current_row.clear();
                    table.row_open = false;
                }
                Event::Start(Tag::TableCell) => {
                    table.current_cell.clear();
                }
                Event::End(TagEnd::TableCell) => {
                    table
                        .current_row
                        .push(table.current_cell.trim().to_string());
                    table.current_cell.clear();
                }
                Event::Text(text) | Event::Code(text) => {
                    table.current_cell.push_str(&text);
                }
                Event::SoftBreak | Event::HardBreak => {
                    table.current_cell.push(' ');
                }
                Event::End(TagEnd::Table) => {
                    flush_spans(
                        &mut lines,
                        &mut current_spans,
                        prefix_first,
                        prefix_rest,
                        prefix_style,
                        width,
                    );
                    lines.extend(render_table(table, theme, prefix_first, prefix_rest, width));
                    table_state = None;
                    prefix_first = "   ";
                    prefix_rest = "   ";
                    prefix_style = Style::default();
                }
                _ => {}
            }
            continue;
        }

        match event {
            Event::Start(Tag::Paragraph) => {}
            Event::End(TagEnd::Paragraph) => {
                flush_spans(
                    &mut lines,
                    &mut current_spans,
                    prefix_first,
                    prefix_rest,
                    prefix_style,
                    width,
                );
                prefix_first = "   ";
                prefix_rest = "   ";
                prefix_style = Style::default();
            }
            Event::Start(Tag::Heading { level, .. }) => {
                flush_spans(
                    &mut lines,
                    &mut current_spans,
                    prefix_first,
                    prefix_rest,
                    prefix_style,
                    width,
                );
                let (marker, color) = heading_style(level, theme);
                prefix_first = if lines.is_empty() && first_in_message {
                    "● "
                } else {
                    "   "
                };
                prefix_rest = "   ";
                prefix_style = Style::default().fg(color).add_modifier(Modifier::BOLD);
                current_style = Style::default().fg(color).add_modifier(Modifier::BOLD);
                style_stack.push(current_style);
                current_spans.push(Span::styled(marker.to_string(), current_style));
            }
            Event::End(TagEnd::Heading(_)) => {
                flush_spans(
                    &mut lines,
                    &mut current_spans,
                    prefix_first,
                    prefix_rest,
                    prefix_style,
                    width,
                );
                style_stack.pop();
                current_style = *style_stack
                    .last()
                    .unwrap_or(&Style::default().fg(theme.text));
                prefix_first = "   ";
                prefix_rest = "   ";
                prefix_style = Style::default();
            }
            Event::Start(Tag::BlockQuote(_)) => {
                flush_spans(
                    &mut lines,
                    &mut current_spans,
                    prefix_first,
                    prefix_rest,
                    prefix_style,
                    width,
                );
                prefix_first = if lines.is_empty() && first_in_message {
                    "● │ "
                } else {
                    "   │ "
                };
                prefix_rest = "   │ ";
                prefix_style = Style::default().fg(theme.accent);
            }
            Event::End(TagEnd::BlockQuote(_)) => {
                flush_spans(
                    &mut lines,
                    &mut current_spans,
                    prefix_first,
                    prefix_rest,
                    prefix_style,
                    width,
                );
                prefix_first = "   ";
                prefix_rest = "   ";
                prefix_style = Style::default();
            }
            Event::Start(Tag::List(start)) => {
                if start.is_some() {
                    list_stack.push(ListKind::Ordered);
                    ordered_index_stack.push(start.unwrap_or(1) as usize);
                } else {
                    list_stack.push(ListKind::Bullet);
                    ordered_index_stack.push(1);
                }
            }
            Event::End(TagEnd::List(_)) => {
                flush_spans(
                    &mut lines,
                    &mut current_spans,
                    prefix_first,
                    prefix_rest,
                    prefix_style,
                    width,
                );
                list_stack.pop();
                ordered_index_stack.pop();
                prefix_first = "   ";
                prefix_rest = "   ";
                prefix_style = Style::default();
            }
            Event::Start(Tag::Item) => {
                flush_spans(
                    &mut lines,
                    &mut current_spans,
                    prefix_first,
                    prefix_rest,
                    prefix_style,
                    width,
                );
                let indent = "  ".repeat(list_stack.len().saturating_sub(1));
                let marker = match list_stack.last().copied().unwrap_or(ListKind::Bullet) {
                    ListKind::Bullet => "• ".to_string(),
                    ListKind::Ordered => {
                        let index = ordered_index_stack
                            .last_mut()
                            .expect("ordered index exists");
                        let marker = format!("{}. ", *index);
                        *index += 1;
                        marker
                    }
                };
                pending_item_prefix = Some(format!("{}{}", indent, marker));
            }
            Event::End(TagEnd::Item) => {
                flush_spans(
                    &mut lines,
                    &mut current_spans,
                    prefix_first,
                    prefix_rest,
                    prefix_style,
                    width,
                );
                pending_item_prefix = None;
                prefix_first = "   ";
                prefix_rest = "   ";
                prefix_style = Style::default();
            }
            Event::Start(Tag::Strong) => {
                current_style = current_style.add_modifier(Modifier::BOLD);
                style_stack.push(current_style);
            }
            Event::End(TagEnd::Strong) => {
                style_stack.pop();
                current_style = *style_stack
                    .last()
                    .unwrap_or(&Style::default().fg(theme.text));
            }
            Event::Start(Tag::Emphasis) => {
                current_style = current_style.add_modifier(Modifier::ITALIC);
                style_stack.push(current_style);
            }
            Event::End(TagEnd::Emphasis) => {
                style_stack.pop();
                current_style = *style_stack
                    .last()
                    .unwrap_or(&Style::default().fg(theme.text));
            }
            Event::Start(Tag::Strikethrough) => {
                current_style = current_style.add_modifier(Modifier::CROSSED_OUT);
                style_stack.push(current_style);
            }
            Event::End(TagEnd::Strikethrough) => {
                style_stack.pop();
                current_style = *style_stack
                    .last()
                    .unwrap_or(&Style::default().fg(theme.text));
            }
            Event::Start(Tag::CodeBlock(kind)) => {
                flush_spans(
                    &mut lines,
                    &mut current_spans,
                    prefix_first,
                    prefix_rest,
                    prefix_style,
                    width,
                );
                in_code_block = true;
                let code_block_lang = match kind {
                    CodeBlockKind::Fenced(lang) => Some(lang.to_string()),
                    CodeBlockKind::Indented => None,
                };
                let label = code_block_lang.as_deref().unwrap_or("text");
                let block_prefix = if lines.is_empty() && first_in_message {
                    "● "
                } else {
                    "   "
                };
                push_wrapped_text_lines(
                    &mut lines,
                    block_prefix,
                    "   ",
                    &format!("┌─ {}", label),
                    Style::default().fg(theme.muted),
                    Style::default().fg(theme.muted).add_modifier(Modifier::DIM),
                    width,
                );
            }
            Event::End(TagEnd::CodeBlock) => {
                in_code_block = false;
                push_wrapped_text_lines(
                    &mut lines,
                    "   ",
                    "   ",
                    "└─",
                    Style::default().fg(theme.muted),
                    Style::default().fg(theme.muted).add_modifier(Modifier::DIM),
                    width,
                );
            }
            Event::Start(Tag::Link { .. }) => {
                current_style = current_style
                    .fg(theme.info)
                    .add_modifier(Modifier::UNDERLINED);
                style_stack.push(current_style);
            }
            Event::End(TagEnd::Link) => {
                style_stack.pop();
                current_style = *style_stack
                    .last()
                    .unwrap_or(&Style::default().fg(theme.text));
            }
            Event::Start(Tag::Table(alignments)) => {
                flush_spans(
                    &mut lines,
                    &mut current_spans,
                    prefix_first,
                    prefix_rest,
                    prefix_style,
                    width,
                );
                table_state = Some(TableState {
                    alignments,
                    ..Default::default()
                });
            }
            Event::Text(text) => {
                if in_code_block {
                    for line in text.lines() {
                        push_wrapped_text_lines(
                            &mut lines,
                            "   │ ",
                            "   │ ",
                            &clean_code_line(line),
                            Style::default().fg(theme.border),
                            Style::default().fg(theme.info),
                            width,
                        );
                    }
                    continue;
                }

                if let Some(item_prefix) = pending_item_prefix.take() {
                    prefix_first = if lines.is_empty() && first_in_message {
                        Box::leak(format!("● {}", item_prefix).into_boxed_str())
                    } else {
                        Box::leak(format!("   {}", item_prefix).into_boxed_str())
                    };
                    prefix_rest = Box::leak(
                        " ".repeat(prefix_first.chars().count())
                            .to_string()
                            .into_boxed_str(),
                    );
                    prefix_style = Style::default()
                        .fg(theme.assistant)
                        .add_modifier(Modifier::BOLD);
                }
                current_spans.push(Span::styled(clean_text(&text), current_style));
            }
            Event::Code(text) => {
                if let Some(item_prefix) = pending_item_prefix.take() {
                    prefix_first = if lines.is_empty() && first_in_message {
                        Box::leak(format!("● {}", item_prefix).into_boxed_str())
                    } else {
                        Box::leak(format!("   {}", item_prefix).into_boxed_str())
                    };
                    prefix_rest = Box::leak(
                        " ".repeat(prefix_first.chars().count())
                            .to_string()
                            .into_boxed_str(),
                    );
                    prefix_style = Style::default()
                        .fg(theme.assistant)
                        .add_modifier(Modifier::BOLD);
                }
                current_spans.push(Span::styled(
                    clean_code_line(&text),
                    Style::default().fg(theme.info).add_modifier(Modifier::BOLD),
                ));
            }
            Event::SoftBreak => {
                flush_spans(
                    &mut lines,
                    &mut current_spans,
                    prefix_first,
                    prefix_rest,
                    prefix_style,
                    width,
                );
                prefix_first = prefix_rest;
            }
            Event::HardBreak => {
                flush_spans(
                    &mut lines,
                    &mut current_spans,
                    prefix_first,
                    prefix_rest,
                    prefix_style,
                    width,
                );
                lines.push(RenderedMessageLine {
                    line: Line::from(Span::raw("")),
                });
            }
            Event::Rule => {
                flush_spans(
                    &mut lines,
                    &mut current_spans,
                    prefix_first,
                    prefix_rest,
                    prefix_style,
                    width,
                );
                let rule_prefix = if lines.is_empty() && first_in_message {
                    "● "
                } else {
                    "   "
                };
                push_wrapped_text_lines(
                    &mut lines,
                    rule_prefix,
                    "   ",
                    &"─".repeat(width.saturating_sub(4).max(3)),
                    Style::default().fg(theme.border),
                    Style::default()
                        .fg(theme.border)
                        .add_modifier(Modifier::DIM),
                    width,
                );
            }
            Event::Html(text) | Event::InlineHtml(text) => {
                current_spans.push(Span::styled(clean_text(&text), current_style));
            }
            Event::InlineMath(text) | Event::DisplayMath(text) => {
                current_spans.push(Span::styled(
                    text.to_string(),
                    Style::default().fg(theme.info),
                ));
            }
            Event::TaskListMarker(checked) => {
                if pending_item_prefix.is_none() {
                    pending_item_prefix = Some(if checked {
                        "[x] ".to_string()
                    } else {
                        "[ ] ".to_string()
                    });
                }
            }
            Event::End(_) | Event::Start(_) => {}
            Event::FootnoteReference(text) => {
                current_spans.push(Span::styled(
                    format!("[{}]", text),
                    Style::default().fg(theme.muted),
                ));
            }
        }
    }

    flush_spans(
        &mut lines,
        &mut current_spans,
        prefix_first,
        prefix_rest,
        prefix_style,
        width,
    );
    lines
}

fn flush_spans(
    lines: &mut Vec<RenderedMessageLine>,
    spans: &mut Vec<Span<'static>>,
    first_prefix: &str,
    continuation_prefix: &str,
    prefix_style: Style,
    width: usize,
) {
    if spans.is_empty() {
        return;
    }
    let mut line_spans = vec![Span::styled(first_prefix.to_string(), prefix_style)];
    line_spans.append(spans);
    let first_width = display_width(first_prefix);
    let continuation_width = display_width(continuation_prefix);
    let max_width = width.max(1);
    let mut flattened: Vec<(String, Style)> = line_spans
        .into_iter()
        .map(|span| (span.content.into_owned(), span.style))
        .collect();

    let mut current: Vec<Span<'static>> = Vec::new();
    let mut used = 0usize;
    let mut is_first_line = true;
    let mut prefix_pending = true;

    for (text, style) in flattened.drain(..) {
        let mut remaining = text;
        while !remaining.is_empty() {
            if prefix_pending {
                let prefix = if is_first_line {
                    first_prefix
                } else {
                    continuation_prefix
                };
                let style = if is_first_line {
                    prefix_style
                } else {
                    Style::default()
                };
                current.push(Span::styled(prefix.to_string(), style));
                used = if is_first_line {
                    first_width
                } else {
                    continuation_width
                };
                prefix_pending = false;
            }

            let available = max_width.saturating_sub(used).max(1);
            let wrapped = wrap_text_by_width(&remaining, available);
            let segment = wrapped.0;
            current.push(Span::styled(segment.clone(), style));
            used += display_width(&segment);
            remaining = wrapped.1;

            if !remaining.is_empty() {
                lines.push(RenderedMessageLine {
                    line: Line::from(std::mem::take(&mut current)),
                });
                used = 0;
                is_first_line = false;
                prefix_pending = true;
            }
        }
    }

    if !current.is_empty() {
        lines.push(RenderedMessageLine {
            line: Line::from(current),
        });
    }
}

fn heading_style(
    level: HeadingLevel,
    theme: ThemePalette,
) -> (&'static str, ratatui::style::Color) {
    match level {
        HeadingLevel::H1 => ("# ", theme.accent),
        HeadingLevel::H2 => ("## ", theme.info),
        HeadingLevel::H3 => ("### ", theme.assistant),
        HeadingLevel::H4 => ("#### ", theme.assistant),
        HeadingLevel::H5 => ("##### ", theme.assistant),
        HeadingLevel::H6 => ("###### ", theme.assistant),
    }
}

fn render_table(
    table: &TableState,
    theme: ThemePalette,
    first_prefix: &str,
    continuation_prefix: &str,
    width: usize,
) -> Vec<RenderedMessageLine> {
    let mut lines = Vec::new();
    if table.rows.is_empty() {
        return lines;
    }

    let col_count = table.rows.iter().map(|row| row.len()).max().unwrap_or(0);
    if col_count == 0 {
        return lines;
    }

    let mut widths = vec![3usize; col_count];
    for row in &table.rows {
        for (idx, cell) in row.iter().enumerate() {
            widths[idx] = widths[idx].max(display_width(cell));
        }
    }

    let available = width
        .saturating_sub(display_width(first_prefix))
        .max(col_count * 4);
    let mut total = widths.iter().sum::<usize>() + col_count * 3 + 1;
    while total > available {
        if let Some((idx, _)) = widths.iter().enumerate().max_by_key(|(_, value)| **value) {
            if widths[idx] > 4 {
                widths[idx] -= 1;
                total -= 1;
            } else {
                break;
            }
        }
    }

    for (row_index, row) in table.rows.iter().enumerate() {
        let mut spans = vec![Span::styled(
            if row_index == 0 {
                first_prefix
            } else {
                continuation_prefix
            }
            .to_string(),
            if row_index == 0 {
                Style::default()
                    .fg(theme.assistant)
                    .add_modifier(Modifier::BOLD)
            } else {
                Style::default()
            },
        )];
        spans.push(Span::styled(
            "│".to_string(),
            Style::default().fg(theme.border),
        ));
        for (col, cell) in row.iter().enumerate() {
            let text = truncate_to_width(cell, widths[col]);
            let formatted = align_cell(&text, widths[col], table.alignments.get(col).copied());
            let style = if row_index == 0 {
                Style::default()
                    .fg(theme.accent)
                    .add_modifier(Modifier::BOLD)
            } else {
                Style::default().fg(theme.text)
            };
            spans.push(Span::styled(format!(" {} ", formatted), style));
            spans.push(Span::styled(
                "│".to_string(),
                Style::default().fg(theme.border),
            ));
        }
        push_wrapped_line_spans(&mut lines, spans, width);
        if row_index == 0 && table.rows.len() > 1 {
            let mut separator = vec![Span::styled(
                continuation_prefix.to_string(),
                Style::default(),
            )];
            separator.push(Span::styled(
                "├".to_string(),
                Style::default().fg(theme.border),
            ));
            for (index, col_width) in widths.iter().enumerate() {
                separator.push(Span::styled(
                    "─".repeat(col_width + 2),
                    Style::default().fg(theme.border),
                ));
                separator.push(Span::styled(
                    if index + 1 == widths.len() {
                        "┤"
                    } else {
                        "┼"
                    }
                    .to_string(),
                    Style::default().fg(theme.border),
                ));
            }
            push_wrapped_line_spans(&mut lines, separator, width);
        }
    }
    lines
}

fn align_cell(text: &str, width: usize, alignment: Option<pulldown_cmark::Alignment>) -> String {
    let text_width = display_width(text);
    let padding = width.saturating_sub(text_width);
    match alignment {
        Some(pulldown_cmark::Alignment::Right) => format!("{}{}", " ".repeat(padding), text),
        Some(pulldown_cmark::Alignment::Center) => {
            let left = padding / 2;
            let right = padding.saturating_sub(left);
            format!("{}{}{}", " ".repeat(left), text, " ".repeat(right))
        }
        _ => format!("{}{}", text, " ".repeat(padding)),
    }
}

fn truncate_to_width(text: &str, width: usize) -> String {
    let mut out = String::new();
    let mut used = 0usize;
    for ch in text.chars() {
        let ch_width = unicode_width::UnicodeWidthChar::width(ch)
            .unwrap_or(1)
            .max(1);
        if used + ch_width > width {
            break;
        }
        out.push(ch);
        used += ch_width;
    }
    out
}

fn wrap_text_by_width(text: &str, width: usize) -> (String, String) {
    let width = width.max(1);
    let mut used = 0usize;
    let mut split_index = text.len();
    for (index, ch) in text.char_indices() {
        let ch_width = unicode_width::UnicodeWidthChar::width(ch)
            .unwrap_or(1)
            .max(1);
        if used + ch_width > width {
            split_index = index;
            break;
        }
        used += ch_width;
    }
    if split_index == 0 {
        let next_index = text
            .char_indices()
            .nth(1)
            .map(|(index, _)| index)
            .unwrap_or(text.len());
        return (
            text[..next_index].to_string(),
            text[next_index..].to_string(),
        );
    }
    if split_index == text.len() {
        (text.to_string(), String::new())
    } else {
        (
            text[..split_index].to_string(),
            text[split_index..].to_string(),
        )
    }
}

fn clean_code_line(line: &str) -> String {
    line.trim_end_matches(|c: char| c.is_whitespace() || matches!(c, '║' | '█' | '▌' | '▐'))
        .to_string()
}

fn clean_text(text: &str) -> String {
    text.chars()
        .filter(|c| !matches!(c, '║' | '█' | '▌' | '▐'))
        .collect()
}
