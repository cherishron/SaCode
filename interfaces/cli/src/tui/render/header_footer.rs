use ratatui::{
    layout::{Alignment, Rect},
    style::{Modifier, Style},
    text::{Line, Span},
    widgets::Paragraph,
    Frame,
};

use super::super::{App, TodoStatus};

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

fn git_summary(app: &App) -> String {
    if app
        .git_changes
        .iter()
        .any(|change| change.starts_with("未检测到") || change.starts_with("当前目录不是") || change.starts_with("读取 Git") || change.starts_with("git status"))
    {
        return String::new();
    }

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
        String::new()
    } else {
        format!("git +{} ~{} ?{}", staged, modified, untracked)
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

fn queue_summary(app: &App) -> Option<String> {
    if app.queue.processing {
        let elapsed = app.active_task_elapsed_seconds();
        Some(format!("运行中 {}s", elapsed))
    } else if !app.queue.queued_messages.is_empty() {
        Some(format!("排队 {}", app.queue.queued_messages.len()))
    } else {
        None
    }
}

fn context_summary(app: &App) -> String {
    format!(
        "上下文 {} chars ~{} tok",
        app.current_context_char_count(),
        app.current_context_token_estimate()
    )
}

pub(crate) fn render_header(frame: &mut Frame, app: &App, area: Rect) {
    let theme = app.theme;
    let project_path = app.workdir.display().to_string();
    let path_limit = area.width.saturating_sub(18) as usize;
    let visible_path = truncate_middle(&project_path, path_limit.max(12));

    let mut top_spans = vec![
        Span::styled(
            format!("SaCode v{} ", env!("CARGO_PKG_VERSION")),
            Style::default().fg(theme.text).add_modifier(Modifier::BOLD),
        ),
        Span::styled(visible_path, Style::default().fg(theme.muted)),
    ];

    let model_name = app.current_model_name();
    if !model_name.is_empty() {
        top_spans.push(Span::styled("  ", Style::default()));
        top_spans.push(Span::styled(
            format!("模型 {}", truncate_middle(&model_name, 28)),
            Style::default().fg(theme.info),
        ));
    }

    let mut bottom_spans = vec![Span::styled(
        format!("模式 {}", app.execution_mode_label()),
        Style::default().fg(match app.execution_mode {
            sacode_kernel::ExecutionMode::Plan => theme.plan,
            sacode_kernel::ExecutionMode::Build => theme.build,
            sacode_kernel::ExecutionMode::Yolo => theme.yolo,
        })
        .add_modifier(Modifier::BOLD),
    )];

    if let Some(branch) = app.current_git_branch() {
        bottom_spans.push(Span::styled("  ", Style::default()));
        bottom_spans.push(Span::styled(
            format!("git:{}", truncate_middle(&branch, 20)),
            Style::default().fg(theme.muted),
        ));
    }

    let git = git_summary(app);
    if !git.is_empty() {
        bottom_spans.push(Span::styled("  ", Style::default()));
        bottom_spans.push(Span::styled(git, Style::default().fg(theme.warning)));
    }

    if let Some(queue) = queue_summary(app) {
        bottom_spans.push(Span::styled("  ", Style::default()));
        bottom_spans.push(Span::styled(queue, Style::default().fg(theme.subtle)));
    }

    if let Some(todo) = todo_summary(app) {
        bottom_spans.push(Span::styled("  ", Style::default()));
        bottom_spans.push(Span::styled(todo, Style::default().fg(theme.accent)));
    }

    bottom_spans.push(Span::styled("  ", Style::default()));
    bottom_spans.push(Span::styled(
        context_summary(app),
        Style::default().fg(theme.info),
    ));

    let thinking_status = if app.current_thinking_enabled() {
        Span::styled("think:on", Style::default().fg(theme.accent).add_modifier(Modifier::BOLD))
    } else {
        Span::styled("think:off", Style::default().fg(theme.subtle))
    };
    bottom_spans.push(Span::styled("  ", Style::default()));
    bottom_spans.push(thinking_status);

    frame.render_widget(
        Paragraph::new(vec![Line::from(top_spans), Line::from(bottom_spans)]).alignment(Alignment::Left),
        area,
    );
}

pub(crate) fn render_footer(frame: &mut Frame, app: &App, area: Rect) {
    let theme = app.theme;
    let mut spans = Vec::new();
    
    if app.current_thinking_enabled() {
        spans.push(Span::styled("Ctrl+T: think:on  ", Style::default().fg(theme.accent)));
    } else {
        spans.push(Span::styled("Ctrl+T: think:off  ", Style::default().fg(theme.subtle)));
    }
    
    spans.push(Span::styled(
        "Alt+M: mode  ",
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
