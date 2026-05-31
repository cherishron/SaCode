use ratatui::{
    layout::{Constraint, Direction, Layout, Rect},
    style::{Color, Modifier, Style},
    text::{Line, Span},
    widgets::{Block, Borders, Paragraph},
    Frame,
};

use sacode_kernel::ExecutionMode;

use super::common::{
    centered_rect, clear_area, render_modal_block, render_relative_modal_block,
};
use super::super::{App, InputMode, MODELS_HINT_LIMIT};

pub(crate) fn render_provider_details(frame: &mut Frame, app: &App, area: Rect) {
    let block = Block::default()
        .title("当前预览")
        .borders(Borders::LEFT)
        .border_style(Style::default().fg(Color::Rgb(80, 90, 110)));
    let inner = block.inner(area);
    frame.render_widget(block, area);

    let details = app
        .provider_options
        .get(app.selected_provider_index)
        .and_then(|provider_name| {
            app.sacode_store
                .provider(provider_name)
                .ok()
                .flatten()
                .map(|spec| (provider_name.clone(), spec))
        })
        .map(|(provider_name, spec)| {
            let current_model = app
                .sacode_store
                .load_or_default()
                .ok()
                .and_then(|config| config.resolve_model(&config.model))
                .and_then(|(current_provider, current_model)| {
                    if current_provider == provider_name {
                        Some(current_model)
                    } else {
                        None
                    }
                })
                .unwrap_or_else(|| spec.models.keys().next().cloned().unwrap_or_default());
            let api_key_status = if spec.api_key.trim().is_empty() {
                "未配置"
            } else {
                "已配置"
            };
            vec![
                Line::from(Span::styled(
                    "Base URL",
                    Style::default()
                        .fg(Color::Rgb(120, 170, 220))
                        .add_modifier(Modifier::BOLD),
                )),
                Line::from(Span::styled(
                    spec.base_url,
                    Style::default().fg(Color::Rgb(200, 200, 210)),
                )),
                Line::from(""),
                Line::from(Span::styled(
                    "Model",
                    Style::default()
                        .fg(Color::Rgb(120, 170, 220))
                        .add_modifier(Modifier::BOLD),
                )),
                Line::from(Span::styled(
                    current_model,
                    Style::default().fg(Color::Rgb(200, 200, 210)),
                )),
                Line::from(""),
                Line::from(Span::styled(
                    "API Key",
                    Style::default()
                        .fg(Color::Rgb(120, 170, 220))
                        .add_modifier(Modifier::BOLD),
                )),
                Line::from(Span::styled(
                    api_key_status,
                    Style::default().fg(Color::Rgb(200, 200, 210)),
                )),
            ]
        })
        .unwrap_or_else(|| {
            vec![Line::from(Span::styled(
                "未找到 provider 详情",
                Style::default().fg(Color::Rgb(160, 160, 170)),
            ))]
        });

    frame.render_widget(Paragraph::new(details), inner);
}

pub(crate) fn render_selector(frame: &mut Frame, app: &App) {
    let theme = app.theme;
    let area = centered_rect(frame.area(), 70, 50);
    let (title, options, selected_index) = match app.input_mode {
        InputMode::ProviderSelect => (
            "管理 Provider",
            app.provider_options.clone(),
            app.selected_provider_index,
        ),
        InputMode::ThemeSelect => (
            "选择主题",
            app.theme_options.clone(),
            app.selected_theme_index,
        ),
        _ => (
            "选择模型",
            app.model_options
                .iter()
                .map(|option| option.label.clone())
                .collect::<Vec<_>>(),
            app.selected_model_index,
        ),
    };
    let inner = render_modal_block(frame, area, title, theme);

    let content_areas = if app.input_mode == InputMode::ProviderSelect {
        Layout::default()
            .direction(Direction::Horizontal)
            .constraints([Constraint::Percentage(52), Constraint::Percentage(48)])
            .split(inner)
    } else {
        vec![inner].into()
    };

    let list_area = content_areas[0];

    let start = selected_index.saturating_sub(MODELS_HINT_LIMIT / 2);
    let end = (start + MODELS_HINT_LIMIT).min(options.len());
    let lines: Vec<Line> = options[start..end]
        .iter()
        .enumerate()
        .map(|(offset, option)| {
            let index = start + offset;
            let is_selected = index == selected_index;
            let prefix = if is_selected { "> " } else { "  " };
            let style = if is_selected {
                Style::default()
                    .fg(theme.selected_fg)
                    .bg(theme.selected_bg)
                    .add_modifier(Modifier::BOLD)
            } else {
                Style::default().fg(theme.text)
            };
            Line::from(Span::styled(format!("{}{}", prefix, option), style))
        })
        .collect();

    frame.render_widget(Paragraph::new(lines), list_area);

    if app.input_mode == InputMode::ProviderSelect && content_areas.len() > 1 {
        render_provider_details(frame, app, content_areas[1]);
    }

    let hint_text = match app.input_mode {
        InputMode::ProviderSelect => Some("Enter: 切换 | r: 重命名 | d: 删除 | Esc: 取消"),
        InputMode::ThemeSelect => Some("Enter: 应用主题 | Esc: 取消"),
        InputMode::ModelSelect => Some("Enter: 应用模型 | Esc: 取消"),
        _ => None,
    };

    if let Some(text) = hint_text {
        let hint_line = Line::styled(text, Style::default().fg(theme.subtle));
        let hint_area = Rect {
            x: area.x,
            y: area.y + area.height,
            width: area.width,
            height: 1,
        };
        clear_area(frame, hint_area);
        frame.render_widget(Paragraph::new(hint_line), hint_area);
    }
}

pub(crate) fn render_connect_selector(frame: &mut Frame, app: &App) {
    let theme = app.theme;
    let area = centered_rect(frame.area(), 70, 50);
    let inner = render_modal_block(frame, area, "快速接入 Provider", theme);

    let start = app
        .selected_connect_index
        .saturating_sub(MODELS_HINT_LIMIT / 2);
    let end = (start + MODELS_HINT_LIMIT).min(app.connect_options.len());
    let lines: Vec<Line> = app.connect_options[start..end]
        .iter()
        .enumerate()
        .map(|(offset, (name, base_url, needs_key))| {
            let label = if *needs_key {
                format!("{} - {} (需要 API Key)", name, base_url)
            } else {
                format!("{} - {} (本地)", name, base_url)
            };
            let is_selected = offset + start == app.selected_connect_index;
            let style = if is_selected {
                Style::default().fg(theme.selected_fg).bg(theme.selected_bg)
            } else {
                Style::default().fg(theme.text)
            };
            Line::styled(label, style)
        })
        .collect();

    let list = Paragraph::new(lines).block(Block::default());
    frame.render_widget(list, inner);
}

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

pub(crate) fn render_level1_selector(frame: &mut Frame, app: &App, input_area: Rect) {
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

pub(crate) fn render_level2_selector(frame: &mut Frame, app: &App, input_area: Rect) {
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

pub(crate) fn render_session_selector(frame: &mut Frame, app: &App) {
    let theme = app.theme;
    let area = centered_rect(frame.area(), 72, 55);
    let inner = render_modal_block(frame, area, "历史会话", theme);

    let start = app
        .selected_session_index
        .saturating_sub(MODELS_HINT_LIMIT / 2);
    let end = (start + MODELS_HINT_LIMIT).min(app.session_options.len());
    let lines: Vec<Line> = app.session_options[start..end]
        .iter()
        .enumerate()
        .map(|(offset, session)| {
            let index = start + offset;
            let is_selected = index == app.selected_session_index;
            let style = if is_selected {
                Style::default().fg(theme.selected_fg).bg(theme.selected_bg)
            } else {
                Style::default().fg(theme.text)
            };
            Line::styled(
                format!("{} [{}] {}", session.updated_at, session.id, session.title),
                style,
            )
        })
        .collect();

    frame.render_widget(Paragraph::new(lines), inner);
}

pub(crate) fn render_task_selector(frame: &mut Frame, app: &App) {
    let theme = app.theme;
    let area = centered_rect(frame.area(), 72, 55);
    let inner = render_modal_block(frame, area, "持久任务", theme);

    let start = app.selected_task_index.saturating_sub(MODELS_HINT_LIMIT / 2);
    let end = (start + MODELS_HINT_LIMIT).min(app.task_options.len());
    let lines: Vec<Line> = app.task_options[start..end]
        .iter()
        .enumerate()
        .map(|(offset, task)| {
            let index = start + offset;
            let is_selected = index == app.selected_task_index;
            let style = if is_selected {
                Style::default().fg(theme.selected_fg).bg(theme.selected_bg)
            } else {
                Style::default().fg(theme.text)
            };
            Line::styled(
                format!(
                    "#{} {:<11} {:<6} {}",
                    task.id,
                    task.status.label(),
                    task.priority.label(),
                    task.description,
                ),
                style,
            )
        })
        .collect();

    frame.render_widget(Paragraph::new(lines), inner);
}

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
