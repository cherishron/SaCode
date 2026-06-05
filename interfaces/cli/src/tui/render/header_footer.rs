use ratatui::{
    layout::{Alignment, Rect},
    style::{Modifier, Style},
    text::{Line, Span},
    widgets::Paragraph,
    Frame,
};

use super::super::{App, TodoStatus, SPINNER_FRAMES};

fn truncate_middle(text: &str, max_chars: usize) -> String {
    let chars: Vec<char> = text.chars().collect();
    if chars.len() <= max_chars {
        return text.to_string();
    }
    if max_chars <= 3 {
        return chars.into_iter().take(max_chars).collect();
    }
    let head = (max_chars - 1) / 2;
    let tail = max_chars.saturating_sub(head + 1);
    let mut result = String::new();
    result.extend(chars.iter().take(head));
    result.push('…');
    result.extend(chars.iter().skip(chars.len().saturating_sub(tail)));
    result
}

fn compact_path(path: &str, max_chars: usize) -> String {
    let normalized = path.replace('\\', "/");
    let normalized = normalized.trim_end_matches('/');
    let windows_drive_prefix = normalized
        .chars()
        .nth(1)
        .map(|ch| ch == ':')
        .unwrap_or(false);
    let parts = normalized
        .split('/')
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>();

    if parts.is_empty() {
        return truncate_middle(normalized, max_chars);
    }

    let mut visible = Vec::new();
    let mut current_len = 1usize;
    for part in parts.iter().rev() {
        let extra = if visible.is_empty() {
            part.len()
        } else {
            part.len() + 1
        };
        if current_len + extra > max_chars.saturating_sub(2) && !visible.is_empty() {
            break;
        }
        visible.push(*part);
        current_len += extra;
    }
    visible.reverse();

    let compact = if windows_drive_prefix {
        format!("~{}", visible.join("/"))
    } else {
        format!("~/{}", visible.join("/"))
    };
    truncate_middle(&compact, max_chars)
}

fn todo_summary(app: &App) -> Option<String> {
    app.interaction.todo_plan.as_ref().map(|plan| {
        let running = plan
            .items
            .iter()
            .filter(|i| matches!(i.status, TodoStatus::Running))
            .count();
        let pending = plan
            .items
            .iter()
            .filter(|i| matches!(i.status, TodoStatus::Pending))
            .count();
        let completed = plan
            .items
            .iter()
            .filter(|i| matches!(i.status, TodoStatus::Completed))
            .count();
        format!("todo {}/{}/{}", running, pending, completed)
    })
}

fn queue_summary(app: &App) -> Option<String> {
    if !app.queue.processing && !app.queue.queued_messages.is_empty() {
        Some(format!("queue {}", app.queue.queued_messages.len()))
    } else {
        None
    }
}

fn status_separator(theme: super::super::ThemePalette) -> Span<'static> {
    Span::styled(" | ", Style::default().fg(theme.subtle))
}

pub(crate) fn render_header(frame: &mut Frame, app: &App, area: Rect) {
    let theme = app.theme;
    let visible_path = compact_path(&app.workdir.display().to_string(), 24);
    let model_name = truncate_middle(&app.current_model_name(), 32);
    let thinking_status = if app.current_thinking_enabled() {
        Span::styled(
            "think:on",
            Style::default()
                .fg(theme.accent)
                .add_modifier(Modifier::BOLD),
        )
    } else {
        Span::styled("think:off", Style::default().fg(theme.subtle))
    };

    let mut spans = vec![
        Span::styled(
            format!("SaCode v{}", env!("CARGO_PKG_VERSION")),
            Style::default().fg(theme.text).add_modifier(Modifier::BOLD),
        ),
        status_separator(theme),
        Span::styled(
            format!("主模型 {}", model_name),
            Style::default().fg(theme.info),
        ),
        status_separator(theme),
        Span::styled("Ctrl+Q: quit", Style::default().fg(theme.subtle)),
        status_separator(theme),
        Span::styled(
            format!("模式 {}", app.execution_mode_label()),
            Style::default()
                .fg(match app.execution_mode {
                    sacode_kernel::ExecutionMode::Plan => theme.plan,
                    sacode_kernel::ExecutionMode::Build => theme.build,
                    sacode_kernel::ExecutionMode::Yolo => theme.yolo,
                })
                .add_modifier(Modifier::BOLD),
        ),
        status_separator(theme),
        thinking_status,
        status_separator(theme),
        Span::styled(visible_path, Style::default().fg(theme.muted)),
    ];

    if area.width < 80 {
        spans.truncate(7);
    }

    frame.render_widget(
        Paragraph::new(Line::from(spans)).alignment(Alignment::Left),
        area,
    );
}

pub(crate) fn render_footer(frame: &mut Frame, app: &App, area: Rect) {
    let theme = app.theme;
    let mut spans = Vec::new();

    if app.queue.processing {
        let frame_text = SPINNER_FRAMES[app.spinner_index % SPINNER_FRAMES.len()];
        spans.push(Span::styled(
            format!(
                "{} Running {}s",
                frame_text,
                app.active_task_elapsed_seconds()
            ),
            Style::default()
                .fg(theme.accent)
                .add_modifier(Modifier::BOLD),
        ));
        spans.push(status_separator(theme));
    }

    if let Some(queue) = queue_summary(app) {
        spans.push(Span::styled(queue, Style::default().fg(theme.warning)));
        spans.push(status_separator(theme));
    }

    if let Some(todo) = todo_summary(app) {
        spans.push(Span::styled(todo, Style::default().fg(theme.accent)));
        spans.push(status_separator(theme));
    }

    if app.current_thinking_enabled() {
        spans.push(Span::styled(
            "Ctrl+T: think:on",
            Style::default().fg(theme.accent),
        ));
    } else {
        spans.push(Span::styled(
            "Ctrl+T: think:off",
            Style::default().fg(theme.subtle),
        ));
    }

    spans.push(status_separator(theme));
    spans.push(Span::styled(
        "Alt+M: mode",
        Style::default().fg(theme.subtle),
    ));
    spans.push(status_separator(theme));
    spans.push(Span::styled(
        "Ctrl+Q: quit",
        Style::default().fg(theme.subtle),
    ));

    frame.render_widget(
        Paragraph::new(Line::from(spans)).alignment(Alignment::Left),
        area,
    );
}
