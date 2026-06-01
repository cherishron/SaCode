use ratatui::{
    layout::{Constraint, Direction, Layout, Rect},
    style::{Color, Modifier, Style},
    text::{Line, Span},
    widgets::{Block, Borders, Paragraph},
    Frame,
};


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




