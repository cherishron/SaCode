#[cfg(test)]
use ratatui::{
    layout::{Constraint, Direction, Layout, Rect},
    style::{Modifier, Style},
    text::{Line, Span},
    widgets::{Block, Borders, Paragraph, Wrap},
    Frame,
};

#[cfg(test)]
use super::super::{App, ThemePalette};

#[cfg(test)]
pub(crate) fn render_orchestration_panel(frame: &mut Frame, app: &App, area: Rect) {
    let theme = app.theme;
    let block = Block::default()
        .title("编排摘要")
        .borders(Borders::ALL)
        .border_style(Style::default().fg(theme.border));
    let inner_area = block.inner(area);
    frame.render_widget(block, area);

    let sections_data = orchestration_sections(app, theme);
    let has_conflicts = !sections_data.conflict_lines.is_empty();
    let chunks = if has_conflicts {
        Layout::default()
            .direction(Direction::Vertical)
            .constraints([
                Constraint::Percentage(28),
                Constraint::Percentage(30),
                Constraint::Percentage(24),
                Constraint::Percentage(18),
            ])
            .split(inner_area)
    } else {
        Layout::default()
            .direction(Direction::Vertical)
            .constraints([
                Constraint::Percentage(34),
                Constraint::Percentage(38),
                Constraint::Percentage(28),
            ])
            .split(inner_area)
    };

    render_orchestration_section(
        frame,
        chunks[0],
        "summary",
        sections_data.summary_lines,
        theme,
        theme.assistant,
    );
    render_orchestration_section(
        frame,
        chunks[1],
        "route",
        sections_data.route_lines,
        theme,
        theme.info,
    );
    if has_conflicts {
        render_orchestration_section(
            frame,
            chunks[2],
            "conflict",
            sections_data.conflict_lines,
            theme,
            theme.warning,
        );
        render_orchestration_section(
            frame,
            chunks[3],
            "next",
            sections_data.next_lines,
            theme,
            theme.build,
        );
    } else {
        render_orchestration_section(
            frame,
            chunks[2],
            "next",
            sections_data.next_lines,
            theme,
            theme.build,
        );
    }
}

#[cfg(test)]
struct OrchestrationSections {
    summary_lines: Vec<Line<'static>>,
    route_lines: Vec<Line<'static>>,
    conflict_lines: Vec<Line<'static>>,
    next_lines: Vec<Line<'static>>,
}

#[cfg(test)]
fn orchestration_sections(app: &App, theme: ThemePalette) -> OrchestrationSections {
    let mut summary_lines = Vec::new();
    let mut route_lines = Vec::new();
    let mut conflict_lines = Vec::new();
    let mut next_lines = Vec::new();
    let mut current_section = "";

    for line in app.orchestration_summary.as_deref().unwrap_or("").lines() {
        if line.starts_with('[') && line.ends_with(']') {
            current_section = line;
            continue;
        }
        if line.trim().is_empty() {
            continue;
        }

        match current_section {
            "[主裁决摘要]" => {
                if line.starts_with("- reporter:") {
                    summary_lines.push(render_block_line("summary", line, theme.assistant, true));
                } else if line.starts_with("- overall:") {
                    summary_lines.push(render_block_line("overall", line, theme.build, true));
                } else if line.starts_with("- next:") {
                    next_lines.push(render_block_line("next", line, theme.build, true));
                } else if line.contains("risk:") {
                    summary_lines.push(render_block_line("risk", line, theme.warning, false));
                } else {
                    summary_lines.push(render_block_line("detail", line, theme.text, false));
                }
            }
            "[编排角色]" | "[角色路由]" => {
                route_lines.push(render_block_line("route", line, theme.info, false));
            }
            "[冲突]" => {
                conflict_lines.push(render_block_line("conflict", line, theme.warning, true));
            }
            _ => {
                next_lines.push(render_block_line("next", line, theme.build, false));
            }
        }
    }

    if summary_lines.is_empty() {
        summary_lines.push(render_block_line("summary", "暂无主裁决摘要", theme.subtle, false));
    }
    if route_lines.is_empty() {
        route_lines.push(render_block_line("route", "暂无角色与路由信息", theme.subtle, false));
    }
    if next_lines.is_empty() {
        next_lines.push(render_block_line("next", "暂无后续动作建议", theme.subtle, false));
    }

    OrchestrationSections {
        summary_lines,
        route_lines,
        conflict_lines,
        next_lines,
    }
}

#[cfg(test)]
fn render_block_line(label: &str, text: &str, color: ratatui::style::Color, bold: bool) -> Line<'static> {
    let mut style = Style::default().fg(color);
    if bold {
        style = style.add_modifier(Modifier::BOLD);
    }
    Line::from(vec![
        Span::styled(format!("{} ", label), style),
        Span::styled(text.to_string(), Style::default().fg(color)),
    ])
}

#[cfg(test)]
fn render_orchestration_section(
    frame: &mut Frame,
    area: Rect,
    title: &str,
    lines: Vec<Line<'static>>,
    _theme: ThemePalette,
    accent: ratatui::style::Color,
) {
    let section = Block::default()
        .title(title)
        .borders(Borders::ALL)
        .border_style(Style::default().fg(accent));
    let inner = section.inner(area);
    frame.render_widget(section, area);
    frame.render_widget(Paragraph::new(lines).wrap(Wrap { trim: false }), inner);
}
