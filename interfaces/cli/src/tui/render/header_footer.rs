use ratatui::{
    layout::{Alignment, Rect},
    style::{Color, Modifier, Style},
    text::{Line, Span},
    widgets::{Block, Borders, Paragraph},
    Frame,
};

use super::super::{
    input::display_workdir,
    App, ExecutionMode, ThemePalette,
};

fn mode_color(theme: ThemePalette, mode: ExecutionMode) -> Color {
    match mode {
        ExecutionMode::Plan => theme.plan,
        ExecutionMode::Build => theme.build,
        ExecutionMode::Yolo => theme.yolo,
    }
}

fn mode_label(mode: ExecutionMode) -> &'static str {
    match mode {
        ExecutionMode::Plan => "PLAN",
        ExecutionMode::Build => "BUILD",
        ExecutionMode::Yolo => "YOLO",
    }
}

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

fn compact_model_label(app: &App) -> (String, String) {
    if let Some(provider) = app.current_provider.as_ref() {
        let model = if provider.config.model.trim().is_empty() {
            "未选择模型".to_string()
        } else {
            provider.config.model.clone()
        };
        (model, provider.name.clone())
    } else {
        ("内置执行".to_string(), "local".to_string())
    }
}

pub(crate) fn render_header(frame: &mut Frame, app: &App, area: Rect) {
    let theme = app.theme;
    let accent = mode_color(theme, app.execution_mode);
    let project_name = app
        .workdir
        .file_name()
        .map(|value| value.to_string_lossy().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| display_workdir(&app.workdir));
    let git = git_summary(app);
    let queue_label = if app.queue.processing {
        format!("queue {} [active]", app.queue.queued_messages.len())
    } else {
        format!("queue {} [idle]", app.queue.queued_messages.len())
    };
    let (model_name, provider_name) = compact_model_label(app);

    frame.render_widget(
        Block::default()
            .style(Style::default().bg(theme.bg_surface))
            .borders(Borders::BOTTOM)
            .border_style(Style::default().fg(theme.border)),
        area,
    );

    let line = Line::from(vec![
        Span::styled("● ", Style::default().fg(accent).bg(theme.bg_surface)),
        Span::styled(
            format!(" {} ", mode_label(app.execution_mode)),
            Style::default()
                .fg(theme.bg_primary)
                .bg(accent)
                .add_modifier(Modifier::BOLD),
        ),
        Span::styled(" │ ", Style::default().fg(theme.border_strong).bg(theme.bg_surface)),
        Span::styled(project_name, Style::default().fg(theme.muted).bg(theme.bg_surface)),
        Span::styled(" │ ", Style::default().fg(theme.border_strong).bg(theme.bg_surface)),
        Span::styled("git ", Style::default().fg(theme.git_branch).bg(theme.bg_surface)),
        Span::styled(git, Style::default().fg(theme.warning).bg(theme.bg_surface)),
        Span::styled(" │ ", Style::default().fg(theme.border_strong).bg(theme.bg_surface)),
        Span::styled(queue_label, Style::default().fg(theme.subtle).bg(theme.bg_surface)),
        Span::styled(" │ ", Style::default().fg(theme.border_strong).bg(theme.bg_surface)),
        Span::styled(model_name, Style::default().fg(theme.text).bg(theme.bg_surface)),
        Span::styled(" @", Style::default().fg(theme.subtle).bg(theme.bg_surface)),
        Span::styled(provider_name, Style::default().fg(accent).bg(theme.bg_surface)),
        Span::styled("  |  ", Style::default().fg(theme.border_strong).bg(theme.bg_surface)),
        Span::styled(app.thinking_toggle_status_label(), Style::default().fg(theme.agent).bg(theme.bg_surface)),
    ]);

    frame.render_widget(
        Paragraph::new(line)
            .alignment(Alignment::Left)
            .style(Style::default().bg(theme.bg_surface)),
        area,
    );
}

pub(crate) fn render_footer(frame: &mut Frame, app: &App, area: Rect) {
    let theme = app.theme;
    let hints = match app.execution_mode {
        ExecutionMode::Plan => "Enter send | Ctrl+T thinking | / commands",
        ExecutionMode::Build => "Enter send | Ctrl+T thinking | Esc cancel",
        ExecutionMode::Yolo => "Enter send | Ctrl+T thinking",
    };

    frame.render_widget(
        Paragraph::new(Line::from(vec![
            Span::styled(
                format!("v{}  ", env!("CARGO_PKG_VERSION")),
                Style::default().fg(theme.subtle).bg(theme.bg_surface),
            ),
            Span::styled(
                app.thinking_toggle_status_label(),
                Style::default().fg(theme.agent).bg(theme.bg_surface),
            ),
            Span::styled("  |  ", Style::default().fg(theme.border_strong).bg(theme.bg_surface)),
            Span::styled(hints, Style::default().fg(theme.subtle).bg(theme.bg_surface)),
            Span::styled(
                format!("  |  {}", display_workdir(&app.workdir)),
                Style::default().fg(theme.muted).bg(theme.bg_surface),
            ),
        ]))
        .alignment(Alignment::Left)
        .style(Style::default().bg(theme.bg_surface)),
        area,
    );
}
