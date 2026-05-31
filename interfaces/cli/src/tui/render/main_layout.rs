use ratatui::{
    layout::{Alignment, Constraint, Direction, Layout, Rect},
    style::{Modifier, Style},
    text::{Line, Span},
    widgets::{Block, Borders, Paragraph, Scrollbar, ScrollbarOrientation, ScrollbarState, Wrap},
    Frame,
};

use super::common::render_sidebar_section;
use super::super::{
    input::{clamp_cursor_col, display_workdir},
    App, InputMode, Message, MessageRole, RenderedMessageLine, SidebarSection, ThemePalette,
};

pub(crate) fn render_message_lines(messages: &[Message], theme: ThemePalette) -> Vec<RenderedMessageLine> {
    let mut lines = Vec::new();

    for msg in messages {
        let role_style = match msg.role {
            MessageRole::User => Style::default().fg(theme.user),
            MessageRole::Assistant => Style::default().fg(theme.assistant),
            MessageRole::System => Style::default().fg(theme.system),
        };

        let role_label = match msg.role {
            MessageRole::User => "你",
            MessageRole::Assistant => "SaCode",
            MessageRole::System => "系统",
        };

        lines.push(RenderedMessageLine {
            line: Line::from(vec![
                Span::styled(msg.timestamp.clone(), Style::default().fg(theme.subtle)),
                Span::raw(" "),
                Span::styled(role_label, role_style.add_modifier(Modifier::BOLD)),
                Span::raw(" "),
                Span::styled(
                    if msg.collapsed { "[折叠]" } else { "[展开]" },
                    Style::default().fg(theme.subtle),
                ),
            ]),
        });

        if msg.collapsed {
            let compact = msg.content.split_whitespace().collect::<Vec<_>>().join(" ");
            let mut chars = compact.chars();
            let preview: String = chars.by_ref().take(100).collect();
            let suffix = if chars.next().is_some() { "..." } else { "" };
            lines.push(RenderedMessageLine {
                line: Line::from(Span::styled(
                    format!("{}{}", preview, suffix),
                    Style::default().fg(theme.text),
                )),
            });
        } else {
            for content_line in msg.content.lines() {
                lines.push(RenderedMessageLine {
                    line: Line::from(Span::styled(
                        content_line.to_string(),
                        Style::default().fg(theme.text),
                    )),
                });
            }
        }

        lines.push(RenderedMessageLine {
            line: Line::from(""),
        });
    }

    lines
}

pub(crate) fn render_header(frame: &mut Frame, area: Rect, theme: ThemePalette) {
    frame.render_widget(
        Paragraph::new(vec![Line::from(vec![Span::styled(
            "SACODE",
            Style::default()
                .fg(theme.accent_strong)
                .add_modifier(Modifier::BOLD),
        )])])
        .alignment(Alignment::Center),
        area,
    );
}

pub(crate) fn render_messages_panel(frame: &mut Frame, app: &mut App, area: Rect) {
    let theme = app.theme;
    let messages_block = Block::default()
        .title("消息")
        .borders(Borders::ALL)
        .border_style(Style::default().fg(theme.border));
    let inner_area = messages_block.inner(area);
    app.message_viewport = inner_area;
    frame.render_widget(messages_block, area);

    let max_y = inner_area.height as usize;
    let total_lines = app.rendered_message_lines().len();
    let max_scroll = total_lines.saturating_sub(max_y);
    if app.follow_bottom {
        app.scroll_offset = max_scroll;
    } else {
        app.scroll_offset = app.scroll_offset.min(max_scroll);
    }
    let start = app.scroll_offset;
    let visible_lines = app
        .visible_rendered_message_lines(start, max_y)
        .iter()
        .map(|line| line.line.clone())
        .collect::<Vec<_>>();

    frame.render_widget(Paragraph::new(visible_lines), inner_area);

    if total_lines > max_y {
        let scrollbar = Scrollbar::default()
            .orientation(ScrollbarOrientation::VerticalRight)
            .begin_symbol(None)
            .end_symbol(None)
            .track_style(Style::default().fg(theme.panel_border))
            .thumb_style(Style::default().fg(theme.border));
        let mut scrollbar_state = ScrollbarState::new(total_lines).position(start);
        frame.render_stateful_widget(scrollbar, inner_area, &mut scrollbar_state);
    }
}

pub(crate) fn render_orchestration_panel(frame: &mut Frame, app: &App, area: Rect) {
    let theme = app.theme;
    let block = Block::default()
        .title("编排摘要")
        .borders(Borders::ALL)
        .border_style(Style::default().fg(theme.border));
    let inner_area = block.inner(area);
    frame.render_widget(block, area);

    let (summary_lines, role_route_lines, conflict_lines) = orchestration_sections(app);
    let has_conflicts = !conflict_lines.is_empty();
    let sections = if has_conflicts {
        Layout::default()
            .direction(Direction::Vertical)
            .constraints([
                Constraint::Percentage(34),
                Constraint::Percentage(38),
                Constraint::Percentage(28),
            ])
            .split(inner_area)
    } else {
        Layout::default()
            .direction(Direction::Vertical)
            .constraints([Constraint::Percentage(44), Constraint::Percentage(56)])
            .split(inner_area)
    };

    render_orchestration_section(frame, sections[0], "主裁决", summary_lines, theme);
    render_orchestration_section(frame, sections[1], "角色与路由", role_route_lines, theme);
    if has_conflicts {
        render_orchestration_section(frame, sections[2], "冲突", conflict_lines, theme);
    }
}

fn orchestration_sections(app: &App) -> (Vec<Line<'static>>, Vec<Line<'static>>, Vec<Line<'static>>) {
    let theme = app.theme;
    let mut summary_lines = Vec::new();
    let mut role_route_lines = Vec::new();
    let mut conflict_lines = Vec::new();
    let mut current_section = "";

    for line in app.orchestration_summary.as_deref().unwrap_or("").lines() {
        if line.starts_with('[') && line.ends_with(']') {
            current_section = line;
            continue;
        }
        if line.trim().is_empty() {
            continue;
        }

        let style = if line.starts_with("- [验证冲突]") {
            Style::default()
                .fg(theme.warning)
                .add_modifier(Modifier::BOLD)
        } else if line.starts_with("- [") {
            Style::default().fg(theme.warning)
        } else if line.starts_with("- reporter:") {
            Style::default().fg(theme.assistant)
        } else {
            Style::default().fg(theme.text)
        };
        let rendered = Line::from(Span::styled(line.to_string(), style));

        match current_section {
            "[主裁决摘要]" => summary_lines.push(rendered),
            "[编排角色]" | "[角色路由]" => role_route_lines.push(rendered),
            "[冲突]" => conflict_lines.push(rendered),
            _ => summary_lines.push(rendered),
        }
    }

    if summary_lines.is_empty() {
        summary_lines.push(Line::from(Span::styled("暂无主裁决摘要".to_string(), Style::default().fg(theme.subtle))));
    }
    if role_route_lines.is_empty() {
        role_route_lines.push(Line::from(Span::styled("暂无角色与路由信息".to_string(), Style::default().fg(theme.subtle))));
    }

    (summary_lines, role_route_lines, conflict_lines)
}

fn render_orchestration_section(
    frame: &mut Frame,
    area: Rect,
    title: &str,
    lines: Vec<Line<'static>>,
    theme: ThemePalette,
) {
    let section = Block::default()
        .title(title)
        .borders(Borders::ALL)
        .border_style(Style::default().fg(theme.panel_border));
    let inner = section.inner(area);
    frame.render_widget(section, area);
    frame.render_widget(Paragraph::new(lines).wrap(Wrap { trim: false }), inner);
}

pub(crate) fn render_sidebar(frame: &mut Frame, app: &App, area: Rect) {
    let theme = app.theme;
    let sidebar_chunks = Layout::default()
        .direction(Direction::Vertical)
        .constraints([
            Constraint::Percentage(36),
            Constraint::Percentage(34),
            Constraint::Percentage(30),
        ])
        .split(area);

    render_sidebar_section(
        frame,
        sidebar_chunks[0],
        "todo",
        app.sidebar_section_lines(SidebarSection::Todo),
        theme,
    );
    render_sidebar_section(
        frame,
        sidebar_chunks[1],
        "task",
        app.sidebar_section_lines(SidebarSection::Task),
        theme,
    );
    render_sidebar_section(
        frame,
        sidebar_chunks[2],
        "git",
        app.sidebar_section_lines(SidebarSection::Git),
        theme,
    );
}

pub(crate) fn render_queue_panel(frame: &mut Frame, app: &App, area: Rect) {
    frame.render_widget(Paragraph::new(app.queue_panel_lines()), area);
}

pub(crate) fn render_input_panel(
    frame: &mut Frame,
    app: &mut App,
    area: Rect,
    input_inner_width: usize,
    input_is_editable: bool,
) {
    let theme = app.theme;
    let cached_input_layout = app.cached_input_layout(input_inner_width).clone();
    let input_lines = if app.input_mode == InputMode::ProviderSelect {
        vec![Line::from(Span::styled(
            "使用上下方向键选择 provider，Enter 切换，r 重命名，d 删除，Esc 取消",
            Style::default().fg(theme.accent),
        ))]
    } else if app.input_mode == InputMode::ProviderRename {
        cached_input_layout
            .lines
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
        cached_input_layout
            .lines
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
        cached_input_layout
            .lines
            .clone()
            .into_iter()
            .map(|line| Line::from(Span::styled(line, Style::default().fg(theme.text))))
            .collect()
    } else if matches!(
        app.input_mode,
        InputMode::CommandLevel1 | InputMode::CommandLevel2
    ) {
        cached_input_layout
            .lines
            .clone()
            .into_iter()
            .map(|line| Line::from(Span::styled(line, Style::default().fg(theme.text))))
            .collect()
    } else if app.input.is_empty() {
        let placeholder = match app.input_mode {
            InputMode::Chat => "输入你的编程任务，或输入 / 显示命令列表；等待回答时用 /answer 或空输入回车继续当前任务...",
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
            InputMode::PendingQuestion => "输入自定义回答，或用方向键选择选项...",
        };
        vec![Line::from(Span::styled(
            placeholder,
            Style::default().fg(theme.subtle),
        ))]
    } else {
        cached_input_layout
            .lines
            .clone()
            .into_iter()
            .map(|line| Line::from(Span::styled(line, Style::default().fg(theme.text))))
            .collect()
    };

    let input_block = Block::default()
        .borders(Borders::ALL)
        .border_style(Style::default().fg(theme.border));
    app.input_viewport = input_block.inner(area);

    frame.render_widget(
        Paragraph::new(input_lines)
            .block(input_block)
            .wrap(Wrap { trim: false }),
        area,
    );

    if input_is_editable {
        let max_line = app.input_viewport.height.saturating_sub(1) as usize;
        let visible_line = cached_input_layout
            .cursor_line
            .min(max_line.min(cached_input_layout.lines.len().saturating_sub(1)));
        let cursor_x = app.input_viewport.x
            + clamp_cursor_col(cached_input_layout.cursor_col, input_inner_width) as u16;
        let cursor_y = app.input_viewport.y + visible_line as u16;
        frame.set_cursor_position((cursor_x, cursor_y));
    }
}

pub(crate) fn render_footer(frame: &mut Frame, app: &App, area: Rect) {
    let theme = app.theme;
    frame.render_widget(
        Paragraph::new(Line::from(vec![
            Span::styled(
                format!("v{}  ", env!("CARGO_PKG_VERSION")),
                Style::default().fg(theme.subtle),
            ),
            Span::styled(
                format!("{}  ", app.current_model_name()),
                Style::default().fg(theme.assistant),
            ),
            Span::styled(
                format!("{}  ", app.thinking_toggle_status_label()),
                Style::default().fg(theme.accent),
            ),
            Span::styled(
                format!("Mode:{}  ", app.execution_mode),
                Style::default().fg(theme.text),
            ),
            Span::styled(
                format!("cwd:{}", display_workdir(&app.workdir)),
                Style::default().fg(theme.subtle),
            ),
        ])),
        area,
    );
}
