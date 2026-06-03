use ratatui::{
    layout::{Alignment, Rect},
    style::{Modifier, Style},
    text::{Line, Span},
    widgets::Paragraph,
    Frame,
};

use super::super::{App, TodoStatus};

fn git_summary(app: &App) -> String {
    let mut staged = 0usize;
    let mut modified = 0usize;
    let mut untracked = 0usize;

    for change in &app.git_changes {
        if change.starts_with("??") {
            untracked += 1;
            continue;
        }
        let chars: Vec<char> = change.chars().collect();
        if chars.first().copied().unwrap_or(' ') != ' ' {
            staged += 1;
        }
        if chars.get(1).copied().unwrap_or(' ') != ' ' {
            modified += 1;
        }
    }

    if staged == 0 && modified == 0 && untracked == 0 {
        "clean".to_string()
    } else {
        format!("+{} ~{} ?{}", staged, modified, untracked)
    }
}

fn todo_summary(app: &App) -> Option<String> {
    app.interaction.todo_plan.as_ref().map(|plan| {
        let running = plan.items.iter().filter(|i| matches!(i.status, TodoStatus::Running)).count();
        let pending = plan.items.iter().filter(|i| matches!(i.status, TodoStatus::Pending)).count();
        let completed = plan.items.iter().filter(|i| matches!(i.status, TodoStatus::Completed)).count();
        format!("todo {}/{}/{}", running, pending, completed)
    })
}

fn queue_summary(app: &App) -> String {
    if app.queue.processing {
        let elapsed = app.active_task_elapsed_seconds();
        format!("queue active {}s", elapsed)
    } else if !app.queue.queued_messages.is_empty() {
        format!("queue {} pending", app.queue.queued_messages.len())
    } else {
        "queue idle".to_string()
    }
}

pub(crate) fn render_header(frame: &mut Frame, app: &App, area: Rect) {
    let theme = app.theme;
    let project_name = app
        .workdir
        .file_name()
        .map(|value| value.to_string_lossy().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| "SaCode".to_string());

    let mut spans = vec![
        Span::styled(
            format!("CodeBuddy Code v{} ", env!("CARGO_PKG_VERSION")),
            Style::default().fg(theme.text).add_modifier(Modifier::BOLD),
        ),
        Span::styled(project_name, Style::default().fg(theme.muted)),
    ];

    // Git status
    let git = git_summary(app);
    if git != "clean" {
        spans.push(Span::styled("  ", Style::default().fg(theme.text)));
        spans.push(Span::styled(git, Style::default().fg(theme.warning)));
    }

    // Queue status
    spans.push(Span::styled("  ", Style::default().fg(theme.text)));
    spans.push(Span::styled(queue_summary(app), Style::default().fg(theme.subtle)));

    // Todo status
    if let Some(todo) = todo_summary(app) {
        spans.push(Span::styled("  ", Style::default().fg(theme.text)));
        spans.push(Span::styled(todo, Style::default().fg(theme.accent)));
    }

    // Thinking status
    let thinking_status = if app.current_thinking_enabled() {
        Span::styled("think:on", Style::default().fg(theme.accent).add_modifier(Modifier::BOLD))
    } else {
        Span::styled("think:off", Style::default().fg(theme.subtle))
    };
    spans.push(Span::styled("  ", Style::default().fg(theme.text)));
    spans.push(thinking_status);

    frame.render_widget(
        Paragraph::new(Line::from(spans)).alignment(Alignment::Left),
        area,
    );
}

pub(crate) fn render_footer(frame: &mut Frame, app: &App, area: Rect) {
    let theme = app.theme;
    let mut spans = vec![
        Span::styled("? for shortcuts  ", Style::default().fg(theme.subtle)),
    ];
    
    if app.current_thinking_enabled() {
        spans.push(Span::styled("Ctrl+T: think:on  ", Style::default().fg(theme.accent)));
    } else {
        spans.push(Span::styled("Ctrl+T: think:off  ", Style::default().fg(theme.subtle)));
    }
    
    spans.push(Span::styled(
        "Ctrl+M: mode  ",
        Style::default().fg(theme.subtle),
    ));
    spans.push(Span::styled(
        "Ctrl+Q: quit",
        Style::default().fg(theme.subtle),
    ));

    frame.render_widget(
        Paragraph::new(Line::from(spans)).alignment(Alignment::Left),
        area,
    );
}
