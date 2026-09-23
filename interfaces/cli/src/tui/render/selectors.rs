use ratatui::{layout::Rect, Frame};
use sacode_kernel::ExecutionMode;

use super::super::{App, InputMode};
use super::popup;

const MAX_VISIBLE: usize = 8;

pub(crate) fn render_selector(frame: &mut Frame, app: &App, input_area: Rect) {
    let (title, items, selected_index) = match app.input_mode {
        InputMode::ProviderSelect => (
            "providers",
            app.provider_options.clone(),
            app.selected_provider_index,
        ),
        InputMode::ThemeSelect => (
            "themes",
            app.theme_options.clone(),
            app.selected_theme_index,
        ),
        InputMode::ModelSelect => (
            "models",
            app.model_options
                .iter()
                .map(|o| o.label.clone())
                .collect::<Vec<_>>(),
            app.selected_model_index,
        ),
        _ => return,
    };

    render_list(frame, app, input_area, title, &items, selected_index);
}

pub(crate) fn render_connect_selector(frame: &mut Frame, app: &App, input_area: Rect) {
    let items: Vec<String> = app
        .connect_options
        .iter()
        .map(|(name, base_url, needs_key)| {
            if *needs_key {
                format!("{} - {} (需要 API Key)", name, base_url)
            } else {
                format!("{} - {} (本地)", name, base_url)
            }
        })
        .collect();

    render_list(
        frame,
        app,
        input_area,
        "connect",
        &items,
        app.selected_connect_index,
    );
}

pub(crate) fn render_mode_selector(frame: &mut Frame, app: &App, input_area: Rect) {
    let current = match app.execution_mode {
        ExecutionMode::Plan => 0,
        ExecutionMode::Build => 1,
        ExecutionMode::Yolo => 2,
    };

    let rows = app
        .mode_options
        .iter()
        .enumerate()
        .map(|(index, name)| {
            let selected = index == app.selected_mode_index;
            let marker = if index == current { " (当前)" } else { "" };
            let label = format!("{}{}", name, marker);
            popup::simple_row(app, &label, selected)
        })
        .collect::<Vec<_>>();

    let area = popup::compute_area(input_area, app.mode_options.len(), MAX_VISIBLE);
    popup::render(frame, app, area, rows, "mode");
    popup::render_hint(frame, app, area, "Enter: 切换 | Esc: 取消");
}

pub(crate) fn render_session_selector(frame: &mut Frame, app: &App, input_area: Rect) {
    let items: Vec<String> = app
        .session_options
        .iter()
        .map(|s| format!("{} [{}] {}", s.updated_at, s.id, s.title))
        .collect();

    render_list(
        frame,
        app,
        input_area,
        "sessions",
        &items,
        app.selected_session_index,
    );
}

pub(crate) fn render_task_selector(frame: &mut Frame, app: &App, input_area: Rect) {
    let items: Vec<String> = app
        .task_options
        .iter()
        .map(|task| {
            format!(
                "#{} {} {} {}",
                task.id,
                task.status.label(),
                task.priority.label(),
                task.description
            )
        })
        .collect();

    render_list(
        frame,
        app,
        input_area,
        "tasks",
        &items,
        app.selected_task_index,
    );
}

pub(crate) fn render_skills_selector(frame: &mut Frame, app: &App, input_area: Rect) {
    let items: Vec<String> = app
        .skills_options
        .iter()
        .map(|(name, desc)| format!("{} - {}", name, desc))
        .collect();
    let action = app.pending_skill_action.as_deref().unwrap_or("show");
    let hint = match action {
        "run" => "Enter: 运行 | Esc: 取消",
        "remove" => "Enter: 删除 | Esc: 取消",
        _ => "Enter: 选择 | Esc: 取消",
    };

    render_list_with_hint(
        frame,
        app,
        input_area,
        "skills",
        &items,
        app.selected_skills_index,
        hint,
    );
}

pub(crate) fn render_mcp_selector(frame: &mut Frame, app: &App, input_area: Rect) {
    let items: Vec<String> = app
        .mcp_options
        .iter()
        .map(|(name, url, enabled)| {
            let status = if *enabled { "[on]" } else { "[off]" };
            format!("{} {} {}", name, status, url)
        })
        .collect();
    let action = app.pending_mcp_action.as_deref().unwrap_or("show");
    let hint = match action {
        "remove" => "Enter: 删除 | Esc: 取消",
        _ => "Enter: 选择 | Esc: 取消",
    };

    render_list_with_hint(
        frame,
        app,
        input_area,
        "mcp",
        &items,
        app.selected_mcp_index,
        hint,
    );
}

pub(crate) fn render_checkpoint_selector(frame: &mut Frame, app: &App, input_area: Rect) {
    let action = app.pending_checkpoint_action.as_deref().unwrap_or("show");
    let hint = match action {
        "restore" => "Enter: 恢复 | Esc: 取消",
        "delete" => "Enter: 删除 | Esc: 取消",
        _ => "Enter: 选择 | Esc: 取消",
    };

    render_list_with_hint(
        frame,
        app,
        input_area,
        "checkpoints",
        &app.checkpoint_options,
        app.selected_checkpoint_index,
        hint,
    );
}

fn render_list(
    frame: &mut Frame,
    app: &App,
    input_area: Rect,
    title: &str,
    items: &[String],
    selected_index: usize,
) {
    if items.is_empty() {
        return;
    }

    let area = popup::compute_area(input_area, items.len(), MAX_VISIBLE);
    let (start, end) = popup::visible_range(items.len(), selected_index, MAX_VISIBLE, area.height);
    let rows = items[start..end]
        .iter()
        .enumerate()
        .map(|(offset, item)| {
            popup::simple_row(app, item.as_str(), start + offset == selected_index)
        })
        .collect::<Vec<_>>();
    popup::render(frame, app, area, rows, title);
}

fn render_list_with_hint(
    frame: &mut Frame,
    app: &App,
    input_area: Rect,
    title: &str,
    items: &[String],
    selected_index: usize,
    hint: &str,
) {
    if items.is_empty() {
        return;
    }

    let area = popup::compute_area(input_area, items.len(), MAX_VISIBLE);
    let (start, end) = popup::visible_range(items.len(), selected_index, MAX_VISIBLE, area.height);
    let rows = items[start..end]
        .iter()
        .enumerate()
        .map(|(offset, item)| {
            popup::simple_row(app, item.as_str(), start + offset == selected_index)
        })
        .collect::<Vec<_>>();
    popup::render(frame, app, area, rows, title);
    popup::render_hint(frame, app, area, hint);
}
