use std::{io, process::Command};

use anyhow::Result;
use crossterm::{
    event::{DisableBracketedPaste, EnableBracketedPaste},
    execute,
    terminal::{disable_raw_mode, enable_raw_mode, EnterAlternateScreen, LeaveAlternateScreen},
};
use ratatui::{
    backend::CrosstermBackend,
    layout::{Constraint, Direction, Layout},
    Terminal,
};

use super::{
    event_loop::run_app,
    input::is_editable_input_mode,
    render::{
        render_checkpoint_selector, render_command_selector, render_config_enum_selector,
        render_config_selector, render_connect_selector, render_footer, render_header,
        render_input_optimization_preview, render_input_panel, render_mcp_selector,
        render_messages_panel, render_mode_selector, render_selector,
        render_session_selector, render_skills_selector, render_task_selector,
    },
    App, InputMode,
};

pub fn run_tui() -> Result<()> {
    let _flow_control_guard = TerminalFlowControlGuard::new();
    enable_raw_mode()?;
    let mut stdout = io::stdout();
    execute!(stdout, EnterAlternateScreen, EnableBracketedPaste)?;
    let backend = CrosstermBackend::new(stdout);
    let mut terminal = Terminal::new(backend)?;

    let mut app = App::new();
    let res = run_app(&mut terminal, &mut app);

    disable_raw_mode()?;
    execute!(
        terminal.backend_mut(),
        LeaveAlternateScreen,
        DisableBracketedPaste
    )?;
    terminal.show_cursor()?;
    println!("{}", app.shutdown_summary());

    res
}

struct TerminalFlowControlGuard {
    previous: Option<String>,
}

impl TerminalFlowControlGuard {
    fn new() -> Self {
        let previous = Command::new("stty")
            .arg("-g")
            .output()
            .ok()
            .and_then(|output| {
                if output.status.success() {
                    Some(String::from_utf8_lossy(&output.stdout).trim().to_string())
                } else {
                    None
                }
            })
            .filter(|value| !value.is_empty());

        let _ = Command::new("stty").args(["-ixon", "-ixoff"]).status();

        Self { previous }
    }
}

impl Drop for TerminalFlowControlGuard {
    fn drop(&mut self) {
        if let Some(previous) = self.previous.as_deref() {
            let _ = Command::new("stty").arg(previous).status();
        }
    }
}

pub(super) fn ui(frame: &mut ratatui::Frame, app: &mut App) {
    let input_is_editable = is_editable_input_mode(app.input_mode);

    // First pass to calculate input height
    let first_pass = Layout::default()
        .direction(Direction::Vertical)
        .margin(1)
        .constraints([
            Constraint::Length(1),  // header
            Constraint::Min(10),    // messages
            Constraint::Length(3),  // input
            Constraint::Length(1),  // footer
        ])
        .split(frame.area());

    let input_inner_width = first_pass[2].width.saturating_sub(2).max(1) as usize;
    let input_line_count = if input_is_editable && !app.input.is_empty() {
        app.cached_input_layout(input_inner_width).lines.len().max(1)
    } else {
        1
    };
    let input_height = (input_line_count as u16 + 2).clamp(3, 6);

    let chunks = Layout::default()
        .direction(Direction::Vertical)
        .margin(1)
        .constraints([
            Constraint::Length(1),  // header
            Constraint::Min(10),    // messages
            Constraint::Length(input_height), // input
            Constraint::Length(1),  // footer
        ])
        .split(frame.area());

    let input_inner_width = chunks[2].width.saturating_sub(2).max(1) as usize;

    render_header(frame, app, chunks[0]);
    render_messages_panel(frame, app, chunks[1]);
    render_input_panel(frame, app, chunks[2], input_inner_width, input_is_editable);
    render_footer(frame, app, chunks[3]);

    if matches!(
        app.input_mode,
        InputMode::ProviderSelect | InputMode::ModelSelect | InputMode::ThemeSelect
    ) {
        render_selector(frame, app, chunks[2]);
    }

    if app.input_mode == InputMode::ConnectSelect {
        render_connect_selector(frame, app, chunks[2]);
    }

    if matches!(
        app.input_mode,
        InputMode::CommandLevel1 | InputMode::CommandLevel2
    ) {
        render_command_selector(frame, app, chunks[2]);
    }

    if app.input_mode == InputMode::SkillsSelect {
        render_skills_selector(frame, app, chunks[2]);
    }

    if app.input_mode == InputMode::McpSelect {
        render_mcp_selector(frame, app, chunks[2]);
    }

    if app.input_mode == InputMode::TasksSelect {
        render_task_selector(frame, app, chunks[2]);
    }

    if app.input_mode == InputMode::CheckpointSelect {
        render_checkpoint_selector(frame, app, chunks[2]);
    }

    if app.input_mode == InputMode::ModeSelect {
        render_mode_selector(frame, app, chunks[2]);
    }

    if app.input_mode == InputMode::ConfigSelect {
        render_config_selector(frame, app);
    }

    if app.input_mode == InputMode::ConfigEnumSelect {
        render_config_enum_selector(frame, app);
    }

    if app.input_mode == InputMode::SessionSelect {
        render_session_selector(frame, app, chunks[2]);
    }

    if app.input_mode == InputMode::ConfigSelect {
        render_config_selector(frame, app);
    }

    if app.input_mode == InputMode::ConfigEnumSelect {
        render_config_enum_selector(frame, app);
    }

    if app.input_mode == InputMode::InputOptimizePreview {
        render_input_optimization_preview(frame, app);
    }
}
