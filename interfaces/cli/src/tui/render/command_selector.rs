use ratatui::{
    layout::Rect,
    style::Style,
    text::Line,
    widgets::Paragraph,
    Frame,
};

use super::common::{clear_area, render_relative_modal_block};
use super::super::{App, InputMode};

pub(crate) fn render_command_selector(frame: &mut Frame, app: &App, input_area: Rect) {
    match app.input_mode {
        InputMode::CommandLevel1 => {
            if app.filtered_level1.is_empty() {
                return;
            }
            render_level1_selector(frame, app, input_area);
        }
        InputMode::CommandLevel2 => {
            if app.filtered_sub_commands.is_empty() {
                return;
            }
            render_level2_selector(frame, app, input_area);
        }
        _ => {}
    }
}

fn render_level1_selector(frame: &mut Frame, app: &App, input_area: Rect) {
    let theme = app.theme;
    let max_height = 12u16;
    let popup_height = max_height.min(app.filtered_level1.len() as u16 + 2);

    let popup_area = Rect {
        x: input_area.x,
        y: input_area.y.saturating_sub(popup_height),
        width: input_area.width,
        height: popup_height,
    };
    let inner = render_relative_modal_block(frame, popup_area, "命令列表", theme);

    let visible_count = inner.height as usize;
    let start = app.selected_level1_index.saturating_sub(visible_count / 2);
    let end = (start + visible_count).min(app.filtered_level1.len());

    let lines: Vec<Line> = app.filtered_level1[start..end]
        .iter()
        .enumerate()
        .map(|(offset, cmd)| {
            let index = start + offset;
            let is_selected = index == app.selected_level1_index;
            let prefix = if is_selected { "> " } else { "  " };
            let has_subs = if cmd.sub_commands.is_empty() { "" } else { " +" };
            let style = if is_selected {
                Style::default().fg(theme.selected_fg).bg(theme.selected_bg)
            } else {
                Style::default().fg(theme.text)
            };
            Line::styled(
                format!("{}{}{} - {}", prefix, cmd.name, has_subs, cmd.description),
                style,
            )
        })
        .collect();

    frame.render_widget(Paragraph::new(lines), inner);

    let hint_line = Line::styled(
        "Enter: 选择 | Tab: 补全 | Esc: 取消",
        Style::default().fg(theme.subtle),
    );
    let hint_area = Rect {
        x: popup_area.x,
        y: popup_area.y + popup_area.height,
        width: popup_area.width,
        height: 1,
    };
    clear_area(frame, hint_area);
    frame.render_widget(Paragraph::new(hint_line), hint_area);
}

fn render_level2_selector(frame: &mut Frame, app: &App, input_area: Rect) {
    let theme = app.theme;
    let max_height = 8u16;
    let popup_height = max_height.min(app.filtered_sub_commands.len() as u16 + 2);

    let popup_area = Rect {
        x: input_area.x,
        y: input_area.y.saturating_sub(popup_height),
        width: input_area.width,
        height: popup_height,
    };

    let title = app
        .current_level1
        .as_ref()
        .map(|cmd| format!("{} 子命令", cmd.name))
        .unwrap_or_else(|| "子命令".to_string());

    let inner = render_relative_modal_block(frame, popup_area, title, theme);

    let visible_count = inner.height as usize;
    let start = app.selected_sub_index.saturating_sub(visible_count / 2);
    let end = (start + visible_count).min(app.filtered_sub_commands.len());

    let lines: Vec<Line> = app.filtered_sub_commands[start..end]
        .iter()
        .enumerate()
        .map(|(offset, sub)| {
            let index = start + offset;
            let is_selected = index == app.selected_sub_index;
            let prefix = if is_selected { "> " } else { "  " };
            let input_hint = if sub.needs_input { " ..." } else { "" };
            let style = if is_selected {
                Style::default().fg(theme.selected_fg).bg(theme.selected_bg)
            } else {
                Style::default().fg(theme.text)
            };
            Line::styled(
                format!("{}{}{} - {}", prefix, sub.name, input_hint, sub.description),
                style,
            )
        })
        .collect();

    frame.render_widget(Paragraph::new(lines), inner);

    let hint_line = Line::styled(
        "Enter: 执行 | Tab: 补全 | Esc: 返回",
        Style::default().fg(theme.subtle),
    );
    let hint_area = Rect {
        x: popup_area.x,
        y: popup_area.y + popup_area.height,
        width: popup_area.width,
        height: 1,
    };
    clear_area(frame, hint_area);
    frame.render_widget(Paragraph::new(hint_line), hint_area);
}
