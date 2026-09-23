use ratatui::{
    layout::{Alignment, Rect},
    style::{Modifier, Style},
    text::{Line, Span},
    widgets::Paragraph,
    Frame,
};

use super::super::{App, TodoStatus, SPINNER_FRAMES};

const CONTEXT_RING_STEPS: [&str; 9] = ["○", "◔", "◑", "◕", "◉", "◕", "◑", "◔", "○"];

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

fn context_ratio(app: &App) -> f32 {
    let used = app.current_context_used_tokens() as f32;
    let limit = app.current_context_limit_tokens() as f32;
    if limit <= 0.0 {
        0.0
    } else {
        (used / limit).clamp(0.0, 1.0)
    }
}

fn context_ring(app: &App) -> &'static str {
    let ratio = context_ratio(app);
    let index = (ratio * (CONTEXT_RING_STEPS.len().saturating_sub(1) as f32)).round() as usize;
    CONTEXT_RING_STEPS[index.min(CONTEXT_RING_STEPS.len().saturating_sub(1))]
}

fn status_separator(theme: super::super::ThemePalette) -> Span<'static> {
    Span::styled("  ", Style::default().fg(theme.subtle))
}

pub(crate) fn render_header(frame: &mut Frame, app: &App, area: Rect) {
    let theme = app.theme;
    let (mode_icon, mode_label, mode_color) = match app.execution_mode {
        sacode_kernel::ExecutionMode::Plan => ("●", "PLAN", theme.plan),
        sacode_kernel::ExecutionMode::Build => ("●", "BUILD", theme.build),
        sacode_kernel::ExecutionMode::Yolo => ("●", "AUTO", theme.yolo),
    };

    let mut spans = vec![
        Span::styled(
            "SaCode",
            Style::default()
                .fg(theme.accent)
                .add_modifier(Modifier::BOLD),
        ),
        Span::styled(
            format!(" v{}", env!("CARGO_PKG_VERSION")),
            Style::default().fg(theme.subtle),
        ),
        status_separator(theme),
        Span::styled(
            format!("{mode_icon} {mode_label}"),
            Style::default().fg(mode_color).add_modifier(Modifier::BOLD),
        ),
    ];

    if area.width >= 52 {
        spans.push(status_separator(theme));
        spans.push(Span::styled(
            truncate_middle(
                &app.current_model_name(),
                if area.width >= 96 { 28 } else { 16 },
            ),
            Style::default().fg(theme.info),
        ));
    }

    if area.width >= 72 {
        spans.push(status_separator(theme));
        spans.push(thinking_status_span(app, theme, false));
    }

    if area.width >= 96 {
        spans.push(status_separator(theme));
        spans.push(Span::styled(
            compact_path(
                &app.workdir.display().to_string(),
                if area.width >= 120 { 28 } else { 18 },
            ),
            Style::default().fg(theme.muted),
        ));
    }

    if area.width >= 112 {
        spans.push(status_separator(theme));
        spans.push(Span::styled(
            "Ctrl+Q quit",
            Style::default().fg(theme.subtle),
        ));
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
        spans.push(Span::styled(queue, Style::default().fg(theme.yolo)));
        spans.push(status_separator(theme));
    }

    if let Some(todo) = todo_summary(app) {
        spans.push(Span::styled(todo, Style::default().fg(theme.accent)));
        spans.push(status_separator(theme));
    }

    let context_percent = (context_ratio(app) * 100.0).round() as usize;
    spans.push(Span::styled(
        format!("{} {:>3}%", context_ring(app), context_percent),
        Style::default().fg(theme.info),
    ));

    if area.width >= 48 {
        spans.push(status_separator(theme));
        let shortcut_hint = if area.width >= 96 {
            "Alt+M mode  ·  / commands  ·  Ctrl+Q quit"
        } else if area.width >= 68 {
            "/ commands  ·  Ctrl+Q quit"
        } else {
            "/ commands"
        };
        spans.push(Span::styled(
            shortcut_hint,
            Style::default().fg(theme.subtle),
        ));
    }

    frame.render_widget(
        Paragraph::new(Line::from(spans)).alignment(Alignment::Left),
        area,
    );
    if let Some(phase_line) = phase_progress_bar(app) {
        let phase_area = Rect {
            x: area.x,
            y: area.y.saturating_add(1),
            width: area.width,
            height: 1,
        };
        frame.render_widget(
            Paragraph::new(phase_line).alignment(Alignment::Left),
            phase_area,
        );
    }
}

fn thinking_status_span(
    app: &App,
    theme: super::super::ThemePalette,
    include_shortcut: bool,
) -> Span<'static> {
    let label = match (include_shortcut, app.current_thinking_enabled()) {
        (true, true) => "Ctrl+T think:on",
        (true, false) => "Ctrl+T think:off",
        (false, true) => "think:on",
        (false, false) => "think:off",
    };
    if app.current_thinking_enabled() {
        Span::styled(
            label,
            Style::default()
                .fg(theme.accent)
                .add_modifier(Modifier::BOLD),
        )
    } else {
        Span::styled(label, Style::default().fg(theme.subtle))
    }
}
fn phase_progress_bar(app: &App) -> Option<Line<'_>> {
    let plan = app.loop_state.as_ref()?.plan.as_ref()?;
    let phases = &plan.phases;
    if phases.is_empty() {
        return None;
    }
    let theme = app.theme;
    let current = app.loop_state.as_ref()?.current_phase_index;
    let mut spans = vec![];
    for (i, phase) in phases.iter().enumerate() {
        if i > 0 {
            spans.push(Span::styled(" | ", Style::default().fg(theme.subtle)));
        }
        let (icon, style) = if i < current {
            ("●", Style::default().fg(theme.build))
        } else if i == current {
            (
                "◐",
                Style::default()
                    .fg(theme.accent)
                    .add_modifier(Modifier::BOLD),
            )
        } else {
            ("○", Style::default().fg(theme.subtle))
        };
        spans.push(Span::styled(format!("{} {}", icon, phase.title), style));
    }
    Some(Line::from(spans))
}
