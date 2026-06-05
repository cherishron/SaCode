use ratatui::{
    layout::Rect,
    style::{Color, Modifier, Style},
    text::{Line, Span},
    widgets::{Block, Borders, Paragraph, Wrap},
    Frame,
};

use super::super::{input::clamp_cursor_col, App, ExecutionMode, InputMode};

fn mode_color(app: &App) -> Color {
    match app.execution_mode {
        ExecutionMode::Plan => app.theme.plan,
        ExecutionMode::Build => app.theme.build,
        ExecutionMode::Yolo => app.theme.yolo,
    }
}

pub(crate) fn render_input_panel(
    frame: &mut Frame,
    app: &mut App,
    area: Rect,
    input_inner_width: usize,
    input_is_editable: bool,
) {
    let theme = app.theme;
    let accent = mode_color(app);
    let prompt_prefix = if app.current_thinking_enabled() {
        "> [T] "
    } else {
        "> "
    };
    let input_block = Block::default()
        .borders(Borders::TOP)
        .border_style(Style::default().fg(theme.border));
    app.input_viewport = input_block.inner(area);
    let visible_input_height = app.input_viewport.height.max(1) as usize;
    let cached_input_layout = app.cached_input_layout(input_inner_width).clone();
    let max_scroll_offset = cached_input_layout
        .lines
        .len()
        .saturating_sub(visible_input_height);
    if input_is_editable {
        if app.input_scroll_follows_cursor {
            app.input_scroll_offset = cached_input_layout
                .cursor_line
                .saturating_sub(visible_input_height.saturating_sub(1));
        }
        app.input_scroll_offset = app.input_scroll_offset.min(max_scroll_offset);
    } else {
        app.input_scroll_offset = 0;
        app.input_scroll_follows_cursor = true;
    }
    let editable_window_start = if input_is_editable {
        app.input_scroll_offset
    } else {
        0
    };
    let editable_visible_lines = if input_is_editable {
        cached_input_layout
            .lines
            .iter()
            .skip(editable_window_start)
            .take(visible_input_height)
            .cloned()
            .collect::<Vec<_>>()
    } else {
        Vec::new()
    };

    let input_lines = if app.input_mode == InputMode::ProviderSelect {
        vec![Line::from(Span::styled(
            "使用上下方向键选择 provider，Enter 切换，r 重命名，d 删除，Esc 取消",
            Style::default().fg(theme.accent),
        ))]
    } else if app.input_mode == InputMode::ProviderRename {
        editable_visible_lines
            .clone()
            .into_iter()
            .map(|line| Line::from(Span::styled(line, Style::default().fg(theme.text))))
            .collect()
    } else if app.input_mode == InputMode::ModelSelect {
        vec![Line::from(Span::styled(
            "使用上下方向键选择模型，Enter 确认，Esc 取消",
            Style::default().fg(theme.accent),
        ))]
    } else if app.input_mode == InputMode::ThemeSelect {
        vec![Line::from(Span::styled(
            "使用上下方向键选择主题，Enter 确认，Esc 取消",
            Style::default().fg(theme.accent),
        ))]
    } else if app.input_mode == InputMode::ConnectSelect {
        vec![Line::from(Span::styled(
            "使用上下方向键选择预设 Provider，Enter 确认，Esc 取消",
            Style::default().fg(theme.accent),
        ))]
    } else if app.input_mode == InputMode::SkillsSelect {
        vec![Line::from(Span::styled(
            "使用上下方向键选择 Skill，Enter 执行操作，Esc 取消",
            Style::default().fg(theme.accent),
        ))]
    } else if app.input_mode == InputMode::McpSelect {
        vec![Line::from(Span::styled(
            "使用上下方向键选择 MCP 服务，Enter 执行操作，Esc 取消",
            Style::default().fg(theme.accent),
        ))]
    } else if app.input_mode == InputMode::CheckpointSelect {
        vec![Line::from(Span::styled(
            "使用上下方向键选择检查点，Enter 执行操作，Esc 取消",
            Style::default().fg(theme.accent),
        ))]
    } else if app.input_mode == InputMode::TasksSelect {
        vec![Line::from(Span::styled(
            "使用上下方向键选择任务，Enter 执行操作，Esc 取消",
            Style::default().fg(theme.accent),
        ))]
    } else if app.input_mode == InputMode::ModeSelect {
        vec![Line::from(Span::styled(
            "使用上下方向键选择执行模式，Enter 切换，Esc 取消",
            Style::default().fg(theme.accent),
        ))]
    } else if app.input_mode == InputMode::ConfigSelect {
        vec![Line::from(Span::styled(
            "使用上下方向键选择配置项，Enter 修改，Tab 切换用户/项目级，Esc 取消",
            Style::default().fg(theme.accent),
        ))]
    } else if app.input_mode == InputMode::ConfigEnumSelect {
        vec![Line::from(Span::styled(
            "使用上下方向键选择配置值，Enter 确认，Esc 取消",
            Style::default().fg(theme.accent),
        ))]
    } else if app.input_mode == InputMode::ConfigNumberInput {
        editable_visible_lines
            .clone()
            .into_iter()
            .map(|line| Line::from(Span::styled(line, Style::default().fg(theme.text))))
            .collect()
    } else if app.input_mode == InputMode::InputOptimizePreview {
        vec![Line::from(Span::styled(
            "查看输入优化预览，Enter 应用，Esc 取消",
            Style::default().fg(theme.accent),
        ))]
    } else if app.input_mode == InputMode::TodoConfirm {
        vec![Line::from(Span::styled(
            "待办计划等待确认，Enter 执行，Esc 退出确认态",
            Style::default().fg(theme.accent),
        ))]
    } else if app.input_mode == InputMode::PendingQuestion {
        let mut lines = editable_visible_lines
            .clone()
            .into_iter()
            .map(|line| Line::from(Span::styled(line, Style::default().fg(theme.text))))
            .collect::<Vec<_>>();
        if lines.is_empty() {
            let hint = if app.interaction.pending_confirm_submission {
                "当前处于最终确认态，按 Enter 提交全部回答。"
            } else {
                "输入当前问题的自定义回答，或使用方向键选择选项。"
            };
            lines.push(Line::from(Span::styled(
                hint,
                Style::default().fg(theme.muted),
            )));
        }
        lines
    } else if matches!(
        app.input_mode,
        InputMode::CommandLevel1 | InputMode::CommandLevel2
    ) {
        editable_visible_lines
            .clone()
            .into_iter()
            .map(|line| Line::from(Span::styled(line, Style::default().fg(theme.text))))
            .collect()
    } else if app.input.is_empty() {
        let placeholder = match app.input_mode {
            InputMode::Chat => "输入任务，/ 打开命令",
            InputMode::LoginBaseUrl => "输入 provider 名称和 Base URL...",
            InputMode::LoginApiKey => "输入 API Key...",
            InputMode::ProviderSelect => "使用方向键选择 provider...",
            InputMode::ProviderRename => "输入新的 provider 名称...",
            InputMode::ModelSelect => "使用方向键选择模型...",
            InputMode::ThemeSelect => "使用方向键选择主题...",
            InputMode::ConnectSelect => "使用方向键选择预设 provider...",
            InputMode::ConnectApiKey => "输入 API Key...",
            InputMode::CommandLevel1 => "输入命令名称进行搜索...",
            InputMode::CommandLevel2 => "输入子命令名称进行搜索...",
            InputMode::SkillsSelect => "使用方向键选择 Skill...",
            InputMode::McpSelect => "使用方向键选择 MCP 服务...",
            InputMode::CheckpointSelect => "使用方向键选择检查点...",
            InputMode::TasksSelect => "使用方向键选择任务...",
            InputMode::ModeSelect => "使用方向键选择执行模式...",
            InputMode::ConfigSelect => "使用方向键选择配置项...",
            InputMode::ConfigEnumSelect => "使用方向键选择配置值...",
            InputMode::ConfigNumberInput => "输入新的数字配置值...",
            InputMode::TaskInput => "输入任务描述...",
            InputMode::SessionSelect => "使用方向键选择历史会话...",
            InputMode::InputOptimizePreview => "查看输入优化预览...",
            InputMode::TodoConfirm => "待办计划等待确认...",
            InputMode::PendingQuestion => "输入当前问题的自定义回答，或用方向键选择选项...",
        };
        vec![Line::from(Span::styled(
            placeholder,
            Style::default().fg(theme.muted),
        ))]
    } else {
        editable_visible_lines
            .clone()
            .into_iter()
            .map(|line| Line::from(Span::styled(line, Style::default().fg(theme.text))))
            .collect()
    };

    let mut decorated_lines = Vec::with_capacity(input_lines.len().max(2));
    for (index, line) in input_lines.into_iter().enumerate() {
        if index == 0 {
            let mut spans = if app.current_thinking_enabled() {
                vec![
                    Span::styled(
                        "> ",
                        Style::default().fg(accent).add_modifier(Modifier::BOLD),
                    ),
                    Span::styled(
                        "[T]",
                        Style::default()
                            .fg(theme.accent)
                            .add_modifier(Modifier::BOLD),
                    ),
                    Span::styled(" ", Style::default()),
                ]
            } else {
                vec![Span::styled(
                    "> ",
                    Style::default().fg(accent).add_modifier(Modifier::BOLD),
                )]
            };
            if input_is_editable {
                spans.extend(line.spans);
            } else {
                spans.extend(line.spans);
            }
            decorated_lines.push(Line::from(spans));
        } else {
            decorated_lines.push(Line::from(vec![
                Span::raw("  "),
                Span::styled(
                    line.spans
                        .into_iter()
                        .map(|span| span.content)
                        .collect::<String>(),
                    Style::default().fg(theme.text),
                ),
            ]));
        }
    }

    frame.render_widget(
        Paragraph::new(decorated_lines)
            .block(input_block)
            .style(Style::default().bg(theme.bg_primary))
            .wrap(Wrap { trim: true }),
        area,
    );

    if input_is_editable {
        let visible_line = cached_input_layout
            .cursor_line
            .saturating_sub(editable_window_start)
            .min(app.input_viewport.height.saturating_sub(1) as usize);
        let prompt_width = prompt_prefix.chars().count() as u16;
        let cursor_x = app.input_viewport.x
            + prompt_width
            + clamp_cursor_col(cached_input_layout.cursor_col, input_inner_width) as u16;
        let cursor_y = app.input_viewport.y + visible_line as u16;
        frame.set_cursor_position((cursor_x, cursor_y));
    }
}
