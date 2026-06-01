use ratatui::{
    layout::Rect,
    style::{Color, Modifier, Style},
    text::Line,
    widgets::Paragraph,
    Frame,
};

use sacode_kernel::ExecutionMode;

use super::common::{centered_rect, clear_area, render_modal_block};
use super::super::App;

pub(crate) fn render_mode_selector(frame: &mut Frame, app: &App) {
    let area = centered_rect(frame.area(), 40, 30);
    let inner = render_modal_block(frame, area, "执行模式", app.theme);

    let mode_desc = [
        ("plan", "Plan - 规划模式\nAI 将先规划步骤，再逐步执行"),
        ("build", "Build - 构建模式\nAI 将直接执行任务"),
        ("yolo", "Yolo - 自动执行模式\nAI 将自动执行，减少确认步骤"),
    ];

    let current_index = match app.execution_mode {
        ExecutionMode::Plan => 0,
        ExecutionMode::Build => 1,
        ExecutionMode::Yolo => 2,
    };

    let lines: Vec<Line> = app
        .mode_options
        .iter()
        .enumerate()
        .map(|(index, name)| {
            let is_selected = index == app.selected_mode_index;
            let is_current = index == current_index;
            let prefix = if is_selected { "> " } else { "  " };
            let current_mark = if is_current { " [当前]" } else { "" };
            let desc = mode_desc
                .iter()
                .find(|(n, _)| *n == *name)
                .map(|(_, d)| *d)
                .unwrap_or("");
            let style = if is_selected {
                Style::default()
                    .fg(Color::Rgb(255, 255, 255))
                    .bg(Color::Rgb(60, 120, 180))
            } else if is_current {
                Style::default()
                    .fg(Color::Rgb(180, 120, 200))
                    .add_modifier(Modifier::BOLD)
            } else {
                Style::default().fg(Color::Rgb(200, 200, 210))
            };
            Line::styled(format!("{}{}{}\n{}", prefix, name, current_mark, desc), style)
        })
        .collect();

    frame.render_widget(Paragraph::new(lines), inner);

    let hint_line = Line::styled(
        "Enter: 切换模式 | Esc: 取消",
        Style::default().fg(Color::Rgb(120, 120, 140)),
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
