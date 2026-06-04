use ratatui::{
    layout::Rect,
    style::{Modifier, Style},
    text::{Line, Span},
    widgets::{Block, Borders, Clear, Paragraph},
    Frame,
};

use super::super::{App, InputMode};

/// Generic dropdown list renderer positioned above the input area
fn render_dropdown_list<'a>(
    frame: &mut Frame,
    app: &App,
    area: Rect,
    items: &[impl AsRef<str>],
    selected_index: usize,
    hint: Option<&str>,
) {
    let theme = app.theme;
    let max_visible = 8usize.min(items.len());
    let popup_height = max_visible as u16 + 2;

    let popup_area = Rect {
        x: area.x,
        y: area.y.saturating_sub(popup_height),
        width: area.width,
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

    let start = if items.len() <= max_visible {
        0
    } else {
        selected_index.saturating_sub(max_visible / 2)
            .min(items.len().saturating_sub(max_visible))
    };
    let end = (start + max_visible).min(items.len());

    let lines: Vec<Line> = items[start..end]
        .iter()
        .enumerate()
        .map(|(offset, item)| {
            let index = start + offset;
            let is_selected = index == selected_index;
            let prefix = if is_selected { "> " } else { "  " };
            let style = if is_selected {
                Style::default().fg(theme.selected_fg).bg(theme.selected_bg)
            } else {
                Style::default().fg(theme.text)
            };
            Line::styled(format!("{}{}", prefix, item.as_ref()), style)
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

    if let Some(hint_text) = hint {
        let hint_area = Rect {
            x: popup_area.x,
            y: popup_area.y + popup_area.height,
            width: popup_area.width,
            height: 1,
        };
        frame.render_widget(
            Paragraph::new(Line::from(Span::styled(hint_text, Style::default().fg(theme.subtle)))),
            hint_area,
        );
    }
}

pub(crate) fn render_selector(frame: &mut Frame, app: &App, input_area: Rect) {
    let (options, selected_index, hint) = match app.input_mode {
        InputMode::ProviderSelect => (
            app.provider_options.clone(),
            app.selected_provider_index,
            "Enter: 切换 | r: 重命名 | d: 删除 | Esc: 取消",
        ),
        InputMode::ThemeSelect => (
            app.theme_options.clone(),
            app.selected_theme_index,
            "Enter: 应用主题 | Esc: 取消",
        ),
        InputMode::ModelSelect => (
            app.model_options.iter().map(|o| o.label.clone()).collect::<Vec<_>>(),
            app.selected_model_index,
            "Enter: 应用模型 | Esc: 取消",
        ),
        _ => return,
    };

    render_dropdown_list(frame, app, input_area, &options, selected_index, Some(hint));
}

pub(crate) fn render_connect_selector(frame: &mut Frame, app: &App, input_area: Rect) {
    let items: Vec<String> = app.connect_options.iter().map(|(name, base_url, needs_key)| {
        if *needs_key {
            format!("{} - {} (需要 API Key)", name, base_url)
        } else {
            format!("{} - {} (本地)", name, base_url)
        }
    }).collect();

    let theme = app.theme;
    let max_visible = 8usize.min(items.len());
    let popup_height = max_visible as u16 + 2;

    let popup_area = Rect {
        x: input_area.x,
        y: input_area.y.saturating_sub(popup_height),
        width: input_area.width,
        height: popup_height,
    };

    let start = if items.len() <= max_visible {
        0
    } else {
        app.selected_connect_index.saturating_sub(max_visible / 2)
            .min(items.len().saturating_sub(max_visible))
    };
    let end = (start + max_visible).min(items.len());

    let lines: Vec<Line> = items[start..end]
        .iter()
        .enumerate()
        .map(|(offset, item)| {
            let index = start + offset;
            let is_selected = index == app.selected_connect_index;
            let prefix = if is_selected { "> " } else { "  " };
            let style = if is_selected {
                Style::default().fg(theme.selected_fg).bg(theme.selected_bg)
            } else {
                Style::default().fg(theme.text)
            };
            Line::styled(format!("{}{}", prefix, item), style)
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

    let hint_area = Rect {
        x: popup_area.x,
        y: popup_area.y + popup_area.height,
        width: popup_area.width,
        height: 1,
    };
    frame.render_widget(
        Paragraph::new(Line::from(Span::styled("Enter: 确认连接 | Esc: 取消", Style::default().fg(theme.subtle)))),
        hint_area,
    );
}

pub(crate) fn render_mode_selector(frame: &mut Frame, app: &App, input_area: Rect) {
    use sacode_kernel::ExecutionMode;

    let theme = app.theme;
    let mode_desc = [
        ("plan", "Plan - 规划模式"),
        ("build", "Build - 构建模式"),
        ("yolo", "Yolo - 自动执行模式"),
    ];

    let current_index = match app.execution_mode {
        ExecutionMode::Plan => 0,
        ExecutionMode::Build => 1,
        ExecutionMode::Yolo => 2,
    };

    let max_visible = 6usize.min(app.mode_options.len());
    let popup_height = max_visible as u16 + 2;

    let popup_area = Rect {
        x: input_area.x,
        y: input_area.y.saturating_sub(popup_height),
        width: input_area.width,
        height: popup_height,
    };

    let lines: Vec<Line> = app.mode_options.iter().enumerate().map(|(index, name)| {
        let is_selected = index == app.selected_mode_index;
        let is_current = index == current_index;
        let prefix = if is_selected { "> " } else { "  " };
        let current_mark = if is_current { " [当前]" } else { "" };
        let desc = mode_desc.iter().find(|(n, _)| *n == *name).map(|(_, d)| *d).unwrap_or("");
        let style = if is_selected {
            Style::default().fg(theme.selected_fg).bg(theme.selected_bg)
        } else if is_current {
            Style::default().fg(theme.accent).add_modifier(Modifier::BOLD)
        } else {
            Style::default().fg(theme.text)
        };
        Line::styled(format!("{}{}{} - {}", prefix, name, current_mark, desc), style)
    }).collect();

    let block = Block::default()
        .borders(Borders::TOP | Borders::LEFT | Borders::RIGHT)
        .border_style(Style::default().fg(theme.border));

    frame.render_widget(Clear, popup_area);
    frame.render_widget(
        Paragraph::new(lines).block(block).style(Style::default().bg(theme.bg_primary)),
        popup_area,
    );
}

pub(crate) fn render_session_selector(frame: &mut Frame, app: &App, input_area: Rect) {
    let items: Vec<String> = app.session_options.iter().map(|s| {
        format!("{} [{}] {}", s.updated_at, s.id, s.title)
    }).collect();
    render_dropdown_list(frame, app, input_area, &items, app.selected_session_index, Some("Enter: 切换会话 | Esc: 取消"));
}

pub(crate) fn render_task_selector(frame: &mut Frame, app: &App, input_area: Rect) {
    let items: Vec<String> = app.task_options.iter().map(|task| {
        format!("#{} {:<11} {:<6} {}", task.id, task.status.label(), task.priority.label(), task.description)
    }).collect();
    render_dropdown_list(frame, app, input_area, &items, app.selected_task_index, Some("Enter: 执行操作 | Esc: 取消"));
}

pub(crate) fn render_skills_selector(frame: &mut Frame, app: &App, input_area: Rect) {
    let items: Vec<String> = app.skills_options.iter().map(|(name, desc)| {
        format!("{} - {}", name, desc)
    }).collect();
    let action = app.pending_skill_action.as_deref().unwrap_or("show");
    let hint = match action {
        "show" => "Enter: 查看详情 | Esc: 取消",
        "run" => "Enter: 运行 | Esc: 取消",
        "remove" => "Enter: 删除 | Esc: 取消",
        _ => "Enter: 选择 | Esc: 取消",
    };
    render_dropdown_list(frame, app, input_area, &items, app.selected_skills_index, Some(hint));
}

pub(crate) fn render_mcp_selector(frame: &mut Frame, app: &App, input_area: Rect) {
    let items: Vec<String> = app.mcp_options.iter().map(|(name, url, enabled)| {
        let status = if *enabled { "[on]" } else { "[off]" };
        format!("{} {} {}", name, status, url)
    }).collect();
    let action = app.pending_mcp_action.as_deref().unwrap_or("show");
    let hint = match action {
        "show" => "Enter: 查看详情 | Esc: 取消",
        "remove" => "Enter: 删除 | Esc: 取消",
        _ => "Enter: 选择 | Esc: 取消",
    };
    render_dropdown_list(frame, app, input_area, &items, app.selected_mcp_index, Some(hint));
}

pub(crate) fn render_checkpoint_selector(frame: &mut Frame, app: &App, input_area: Rect) {
    let action = app.pending_checkpoint_action.as_deref().unwrap_or("show");
    let hint = match action {
        "restore" => "Enter: 恢复 | Esc: 取消",
        "delete" => "Enter: 删除 | Esc: 取消",
        _ => "Enter: 选择 | Esc: 取消",
    };
    render_dropdown_list(frame, app, input_area, &app.checkpoint_options, app.selected_checkpoint_index, Some(hint));
}
