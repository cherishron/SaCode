use ratatui::{
    layout::{Alignment, Constraint, Direction, Layout, Rect},
    style::{Modifier, Style},
    text::{Line, Span},
    widgets::{Block, Borders, Paragraph, Scrollbar, ScrollbarOrientation, ScrollbarState, Wrap},
    Frame,
};

use super::common::render_sidebar_section;
use super::super::{
    input::{clamp_cursor_col, display_workdir},
    App, InputMode, Message, MessageRole, RenderedMessageLine, SidebarSection, ThemePalette,
};

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


pub(crate) fn render_messages_panel(frame: &mut Frame, app: &mut App, area: Rect) {
    let theme = app.theme;
    let messages_block = Block::default()
        .title("消息")
        .borders(Borders::ALL)
        .border_style(Style::default().fg(theme.border));
    let inner_area = messages_block.inner(area);
    app.message_viewport = inner_area;
    frame.render_widget(messages_block, area);

    let max_y = inner_area.height as usize;
    let total_lines = app.rendered_message_lines().len();
    let max_scroll = total_lines.saturating_sub(max_y);
    if app.follow_bottom {
        app.scroll_offset = max_scroll;
    } else {
        app.scroll_offset = app.scroll_offset.min(max_scroll);
    }
    let start = app.scroll_offset;
    let visible_lines = app
        .visible_rendered_message_lines(start, max_y)
        .iter()
        .map(|line| line.line.clone())
        .collect::<Vec<_>>();

    frame.render_widget(Paragraph::new(visible_lines), inner_area);

    if total_lines > max_y {
        let scrollbar = Scrollbar::default()
            .orientation(ScrollbarOrientation::VerticalRight)
            .begin_symbol(None)
            .end_symbol(None)
            .track_style(Style::default().fg(theme.panel_border))
            .thumb_style(Style::default().fg(theme.border));
        let mut scrollbar_state = ScrollbarState::new(total_lines).position(start);
        frame.render_stateful_widget(scrollbar, inner_area, &mut scrollbar_state);
    }
}

pub(crate) fn render_orchestration_panel(frame: &mut Frame, app: &App, area: Rect) {
    let theme = app.theme;
    let block = Block::default()
        .title("编排摘要")
        .borders(Borders::ALL)
        .border_style(Style::default().fg(theme.border));
    let inner_area = block.inner(area);
    frame.render_widget(block, area);

    let (summary_lines, role_route_lines, conflict_lines) = orchestration_sections(app);
    let has_conflicts = !conflict_lines.is_empty();
    let sections = if has_conflicts {
        Layout::default()
            .direction(Direction::Vertical)
            .constraints([
                Constraint::Percentage(34),
                Constraint::Percentage(38),
                Constraint::Percentage(28),
            ])
            .split(inner_area)
    } else {
        Layout::default()
            .direction(Direction::Vertical)
            .constraints([Constraint::Percentage(44), Constraint::Percentage(56)])
            .split(inner_area)
    };

    render_orchestration_section(frame, sections[0], "主裁决", summary_lines, theme);
    render_orchestration_section(frame, sections[1], "角色与路由", role_route_lines, theme);
    if has_conflicts {
        render_orchestration_section(frame, sections[2], "冲突", conflict_lines, theme);
    }
}

fn orchestration_sections(app: &App) -> (Vec<Line<'static>>, Vec<Line<'static>>, Vec<Line<'static>>) {
    let theme = app.theme;
    let mut summary_lines = Vec::new();
    let mut role_route_lines = Vec::new();
    let mut conflict_lines = Vec::new();
    let mut current_section = "";

    for line in app.orchestration_summary.as_deref().unwrap_or("").lines() {
        if line.starts_with('[') && line.ends_with(']') {
            current_section = line;
            continue;
        }
        if line.trim().is_empty() {
            continue;
        }

        let style = if line.starts_with("- [验证冲突]") {
            Style::default()
                .fg(theme.warning)
                .add_modifier(Modifier::BOLD)
        } else if line.starts_with("- [") {
            Style::default().fg(theme.warning)
        } else if line.starts_with("- reporter:") {
            Style::default().fg(theme.assistant)
        } else {
            Style::default().fg(theme.text)
        };
        let rendered = Line::from(Span::styled(line.to_string(), style));

        match current_section {
            "[主裁决摘要]" => summary_lines.push(rendered),
            "[编排角色]" | "[角色路由]" => role_route_lines.push(rendered),
            "[冲突]" => conflict_lines.push(rendered),
            _ => summary_lines.push(rendered),
        }
    }

    if summary_lines.is_empty() {
        summary_lines.push(Line::from(Span::styled("暂无主裁决摘要".to_string(), Style::default().fg(theme.subtle))));
    }
    if role_route_lines.is_empty() {
        role_route_lines.push(Line::from(Span::styled("暂无角色与路由信息".to_string(), Style::default().fg(theme.subtle))));
    }

    (summary_lines, role_route_lines, conflict_lines)
}

fn render_orchestration_section(
    frame: &mut Frame,
    area: Rect,
    title: &str,
    lines: Vec<Line<'static>>,
    theme: ThemePalette,
) {
    let section = Block::default()
        .title(title)
        .borders(Borders::ALL)
        .border_style(Style::default().fg(theme.panel_border));
    let inner = section.inner(area);
    frame.render_widget(section, area);
    frame.render_widget(Paragraph::new(lines).wrap(Wrap { trim: false }), inner);
}

pub(crate) fn render_sidebar(frame: &mut Frame, app: &App, area: Rect) {
    let theme = app.theme;
    let sidebar_chunks = Layout::default()
        .direction(Direction::Vertical)
        .constraints([
            Constraint::Percentage(36),
            Constraint::Percentage(34),
            Constraint::Percentage(30),
        ])
        .split(area);

    render_sidebar_section(
        frame,
        sidebar_chunks[0],
        "todo",
        app.sidebar_section_lines(SidebarSection::Todo),
        theme,
    );
    render_sidebar_section(
        frame,
        sidebar_chunks[1],
        "task",
        app.sidebar_section_lines(SidebarSection::Task),
        theme,
    );
    render_sidebar_section(
        frame,
        sidebar_chunks[2],
        "git",
        app.sidebar_section_lines(SidebarSection::Git),
        theme,
    );
}

pub(crate) fn render_queue_panel(frame: &mut Frame, app: &App, area: Rect) {
    frame.render_widget(Paragraph::new(app.queue_panel_lines()), area);
}


