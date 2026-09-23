use ratatui::{layout::Rect, Frame};

use super::super::{App, InputMode};
use super::popup;

const LEVEL1_MAX_VISIBLE: usize = 8;
const LEVEL2_MAX_VISIBLE: usize = 6;

pub(crate) fn render_command_selector(frame: &mut Frame, app: &App, input_area: Rect) {
    match app.input_mode {
        InputMode::CommandLevel1 if !app.filtered_level1.is_empty() => {
            render_level1_selector(frame, app, input_area);
        }
        InputMode::CommandLevel2 if !app.filtered_sub_commands.is_empty() => {
            render_level2_selector(frame, app, input_area);
        }
        _ => {}
    }
}

fn render_level1_selector(frame: &mut Frame, app: &App, input_area: Rect) {
    let total = app.filtered_level1.len();
    let area = popup::compute_area(input_area, total, LEVEL1_MAX_VISIBLE);
    let (start, end) = popup::visible_range(
        total,
        app.selected_level1_index,
        LEVEL1_MAX_VISIBLE,
        area.height,
    );
    let rows = app.filtered_level1[start..end]
        .iter()
        .enumerate()
        .map(|(offset, cmd)| {
            popup::row(
                app,
                area.width,
                &cmd.name,
                &cmd.description,
                start + offset == app.selected_level1_index,
            )
        })
        .collect::<Vec<_>>();
    popup::render(frame, app, area, rows, "commands");
}

fn render_level2_selector(frame: &mut Frame, app: &App, input_area: Rect) {
    let total = app.filtered_sub_commands.len();
    let area = popup::compute_area(input_area, total, LEVEL2_MAX_VISIBLE);
    let (start, end) = popup::visible_range(
        total,
        app.selected_sub_index,
        LEVEL2_MAX_VISIBLE,
        area.height,
    );
    let title = app
        .current_level1
        .as_ref()
        .map(|c| c.name.as_str())
        .unwrap_or("command");
    let rows = app.filtered_sub_commands[start..end]
        .iter()
        .enumerate()
        .map(|(offset, sub)| {
            popup::row(
                app,
                area.width,
                &sub.name,
                &sub.description,
                start + offset == app.selected_sub_index,
            )
        })
        .collect::<Vec<_>>();
    popup::render(frame, app, area, rows, title);
}
