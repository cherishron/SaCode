use ratatui::{
    layout::Rect,
    style::Style,
    text::Line,
    widgets::Paragraph,
    Frame,
};

use super::common::{centered_rect, clear_area, render_modal_block};
use super::super::App;

pub(crate) fn render_skills_selector(frame: &mut Frame, app: &App) {
    let theme = app.theme;
    let area = centered_rect(frame.area(), 60, 40);
    let inner = render_modal_block(frame, area, "Skills 列表", theme);

    let visible_count = inner.height as usize;
    let start = app.selected_skills_index.saturating_sub(visible_count / 2);
    let end = (start + visible_count).min(app.skills_options.len());

    let action = app.pending_skill_action.as_deref().unwrap_or("show");
    let hint = match action {
        "show" => "查看详情",
        "run" => "运行",
        "remove" => "删除",
        _ => "选择",
    };

    let lines: Vec<Line> = app.skills_options[start..end]
        .iter()
        .enumerate()
        .map(|(offset, (name, desc))| {
            let index = start + offset;
            let is_selected = index == app.selected_skills_index;
            let prefix = if is_selected { "> " } else { "  " };
            let style = if is_selected {
                Style::default().fg(theme.selected_fg).bg(theme.selected_bg)
            } else {
                Style::default().fg(theme.text)
            };
            Line::styled(format!("{}{} - {}", prefix, name, desc), style)
        })
        .collect();

    frame.render_widget(Paragraph::new(lines), inner);

    let hint_line = Line::styled(
        format!("Enter: {} | Esc: 取消", hint),
        Style::default().fg(theme.subtle),
    );
    let hint_area = Rect {
        x: area.x,
        y: area.y + area.height,
        width: area.width,
        height: 1,
    };
    clear_area(frame, hint_area);
    frame.render_widget(Paragraph::new(hint_line), hint_area);
}

pub(crate) fn render_mcp_selector(frame: &mut Frame, app: &App) {
    let theme = app.theme;
    let area = centered_rect(frame.area(), 60, 40);
    let inner = render_modal_block(frame, area, "MCP 服务列表", theme);

    let visible_count = inner.height as usize;
    let start = app.selected_mcp_index.saturating_sub(visible_count / 2);
    let end = (start + visible_count).min(app.mcp_options.len());

    let lines: Vec<Line> = app.mcp_options[start..end]
        .iter()
        .enumerate()
        .map(|(offset, (name, url, enabled))| {
            let index = start + offset;
            let is_selected = index == app.selected_mcp_index;
            let prefix = if is_selected { "> " } else { "  " };
            let status = if *enabled { "[on]" } else { "[off]" };
            let style = if is_selected {
                Style::default().fg(theme.selected_fg).bg(theme.selected_bg)
            } else {
                Style::default().fg(theme.text)
            };
            Line::styled(format!("{}{} {} {}", prefix, name, status, url), style)
        })
        .collect();

    frame.render_widget(Paragraph::new(lines), inner);

    let action = app.pending_mcp_action.as_deref().unwrap_or("show");
    let hint = match action {
        "show" => "查看详情",
        "remove" => "删除",
        _ => "选择",
    };
    let hint_line = Line::styled(
        format!("Enter: {} | Esc: 取消", hint),
        Style::default().fg(theme.subtle),
    );
    let hint_area = Rect {
        x: area.x,
        y: area.y + area.height,
        width: area.width,
        height: 1,
    };
    clear_area(frame, hint_area);
    frame.render_widget(Paragraph::new(hint_line), hint_area);
}

pub(crate) fn render_checkpoint_selector(frame: &mut Frame, app: &App) {
    let theme = app.theme;
    let area = centered_rect(frame.area(), 50, 35);
    let inner = render_modal_block(frame, area, "检查点列表", theme);

    let visible_count = inner.height as usize;
    let start = app
        .selected_checkpoint_index
        .saturating_sub(visible_count / 2);
    let end = (start + visible_count).min(app.checkpoint_options.len());

    let action = app.pending_checkpoint_action.as_deref().unwrap_or("show");
    let hint = match action {
        "restore" => "恢复",
        "delete" => "删除",
        _ => "选择",
    };

    let lines: Vec<Line> = app.checkpoint_options[start..end]
        .iter()
        .enumerate()
        .map(|(offset, name)| {
            let index = start + offset;
            let is_selected = index == app.selected_checkpoint_index;
            let prefix = if is_selected { "> " } else { "  " };
            let style = if is_selected {
                Style::default().fg(theme.selected_fg).bg(theme.selected_bg)
            } else {
                Style::default().fg(theme.text)
            };
            Line::styled(format!("{}{}", prefix, name), style)
        })
        .collect();

    frame.render_widget(Paragraph::new(lines), inner);

    let hint_line = Line::styled(
        format!("Enter: {} | Esc: 取消", hint),
        Style::default().fg(theme.subtle),
    );
    let hint_area = Rect {
        x: area.x,
        y: area.y + area.height,
        width: area.width,
        height: 1,
    };
    clear_area(frame, hint_area);
    frame.render_widget(Paragraph::new(hint_line), hint_area);
}
