use ratatui::{
    layout::Rect,
    style::{Modifier, Style},
    text::{Line, Span},
    widgets::{Block, Borders, Clear, Paragraph},
    Frame,
};

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
    let max_visible = 8usize;
    let total_items = app.filtered_level1.len();
    let visible_count = max_visible.min(total_items);
    let popup_height = visible_count as u16 + 2; // +2 for padding

    // Position directly above the input area
    let popup_area = Rect {
        x: input_area.x,
        y: input_area.y.saturating_sub(popup_height),
        width: input_area.width,
        height: popup_height,
    };

    // Ensure we don't go above the screen
    let popup_area = if popup_area.y < 1 {
        Rect {
            y: 1,
            height: popup_area.y + popup_area.height - 1,
            ..popup_area
        }
    } else {
        popup_area
    };

    // Calculate visible window around selected item
    let start = if total_items <= max_visible {
        0
    } else {
        app.selected_level1_index.saturating_sub(max_visible / 2)
            .min(total_items.saturating_sub(max_visible))
    };
    let end = (start + visible_count).min(total_items);

    let cmd_name_width = app.filtered_level1[start..end]
        .iter()
        .map(|cmd| cmd.name.len())
        .max()
        .unwrap_or(20)
        .max(20);

    let lines: Vec<Line> = app.filtered_level1[start..end]
        .iter()
        .enumerate()
        .map(|(offset, cmd)| {
            let index = start + offset;
            let is_selected = index == app.selected_level1_index;
            let prefix = if is_selected { "> " } else { "  " };
            let style = if is_selected {
                Style::default().fg(theme.selected_fg).bg(theme.selected_bg)
            } else {
                Style::default().fg(theme.text)
            };
            let desc_style = if is_selected {
                Style::default().fg(theme.selected_fg).bg(theme.selected_bg).add_modifier(Modifier::DIM)
            } else {
                Style::default().fg(theme.subtle)
            };

            Line::from(vec![
                Span::styled(prefix, style),
                Span::styled(&cmd.name, style.add_modifier(Modifier::BOLD)),
                Span::styled(
                    format!("{:>width$}", "", width = cmd_name_width.saturating_sub(cmd.name.len()) + 2),
                    style,
                ),
                Span::styled(&cmd.description, desc_style),
            ])
        })
        .collect();

    let block = Block::default()
        .borders(Borders::TOP | Borders::LEFT | Borders::RIGHT)
        .border_style(Style::default().fg(theme.border));

    frame.render_widget(Clear, popup_area);
    frame.render_widget(
        Paragraph::new(lines).block(block).style(Style::default().bg(theme.bg_primary)),
        popup_area,
    );
}

fn render_level2_selector(frame: &mut Frame, app: &App, input_area: Rect) {
    let theme = app.theme;
    let max_visible = 6usize;
    let total_items = app.filtered_sub_commands.len();
    let visible_count = max_visible.min(total_items);
    let popup_height = visible_count as u16 + 2;

    let popup_area = Rect {
        x: input_area.x,
        y: input_area.y.saturating_sub(popup_height),
        width: input_area.width,
        height: popup_height,
    };

    let popup_area = if popup_area.y < 1 {
        Rect {
            y: 1,
            height: popup_area.y + popup_area.height - 1,
            ..popup_area
        }
    } else {
        popup_area
    };

    let start = if total_items <= max_visible {
        0
    } else {
        app.selected_sub_index.saturating_sub(max_visible / 2)
            .min(total_items.saturating_sub(max_visible))
    };
    let end = (start + visible_count).min(total_items);

    let sub_name_width = app.filtered_sub_commands[start..end]
        .iter()
        .map(|sub| sub.name.len())
        .max()
        .unwrap_or(20)
        .max(20);

    let lines: Vec<Line> = app.filtered_sub_commands[start..end]
        .iter()
        .enumerate()
        .map(|(offset, sub)| {
            let index = start + offset;
            let is_selected = index == app.selected_sub_index;
            let prefix = if is_selected { "> " } else { "  " };
            let style = if is_selected {
                Style::default().fg(theme.selected_fg).bg(theme.selected_bg)
            } else {
                Style::default().fg(theme.text)
            };
            let desc_style = if is_selected {
                Style::default().fg(theme.selected_fg).bg(theme.selected_bg).add_modifier(Modifier::DIM)
            } else {
                Style::default().fg(theme.subtle)
            };

            Line::from(vec![
                Span::styled(prefix, style),
                Span::styled(&sub.name, style.add_modifier(Modifier::BOLD)),
                Span::styled(
                    format!("{:>width$}", "", width = sub_name_width.saturating_sub(sub.name.len()) + 2),
                    style,
                ),
                Span::styled(&sub.description, desc_style),
            ])
        })
        .collect();

    let block = Block::default()
        .borders(Borders::TOP | Borders::LEFT | Borders::RIGHT)
        .border_style(Style::default().fg(theme.border));

    frame.render_widget(Clear, popup_area);
    frame.render_widget(
        Paragraph::new(lines).block(block).style(Style::default().bg(theme.bg_primary)),
        popup_area,
    );
}
