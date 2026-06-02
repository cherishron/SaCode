use ratatui::{
    layout::{Constraint, Direction, Layout, Rect},
    style::{Modifier, Style},
    text::{Line, Span},
    widgets::{Block, Borders, Paragraph, Wrap},
    Frame,
};

use super::super::{App, ThemePalette};

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
        summary_lines.push(Line::from(Span::styled(
            "暂无主裁决摘要".to_string(),
            Style::default().fg(theme.subtle),
        )));
    }
    if role_route_lines.is_empty() {
        role_route_lines.push(Line::from(Span::styled(
            "暂无角色与路由信息".to_string(),
            Style::default().fg(theme.subtle),
        )));
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
