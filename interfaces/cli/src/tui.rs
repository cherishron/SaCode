use std::io;

use anyhow::Result;
use crossterm::{
    event::{self, DisableMouseCapture, EnableMouseCapture, Event, KeyCode, KeyEvent, KeyEventKind},
    execute,
    terminal::{disable_raw_mode, enable_raw_mode, EnterAlternateScreen, LeaveAlternateScreen},
};
use ratatui::{
    backend::CrosstermBackend,
    layout::{Constraint, Direction, Layout},
    style::{Color, Modifier, Style},
    text::{Line, Span},
    widgets::{Block, Borders, List, ListItem, Paragraph},
    Frame, Terminal,
};
use sacode_kernel::{ExecutionMode, Supervisor, Task};

struct App {
    task: String,
    mode: ExecutionMode,
    events: Vec<String>,
    plan_steps: Vec<String>,
    tool_results: Vec<String>,
    should_quit: bool,
    input_mode: InputMode,
    input: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum InputMode {
    Normal,
    Editing,
}

impl App {
    fn new() -> Self {
        Self {
            task: String::new(),
            mode: ExecutionMode::Build,
            events: Vec::new(),
            plan_steps: Vec::new(),
            tool_results: Vec::new(),
            should_quit: false,
            input_mode: InputMode::Editing,
            input: String::new(),
        }
    }

    fn execute_task(&mut self) {
        if self.input.is_empty() {
            return;
        }

        self.task = self.input.clone();
        self.input.clear();
        self.input_mode = InputMode::Editing;

        let supervisor = Supervisor::new();
        let task = Task::new(self.task.clone(), self.mode, None);
        let result = supervisor.execute(&task);

        self.events.clear();
        self.plan_steps.clear();
        self.tool_results.clear();

        for event in &result.output.events {
            match event {
                sacode_kernel::Event::Message { content } => self.events.push(format!("MSG: {}", content)),
                sacode_kernel::Event::Thinking { content } => self.events.push(format!("THINK: {}", content)),
                sacode_kernel::Event::Done { summary } => self.events.push(format!("DONE: {}", summary)),
                sacode_kernel::Event::Error { message } => self.events.push(format!("ERROR: {}", message)),
                sacode_kernel::Event::ToolCallStarted { name, .. } => self.events.push(format!("TOOL_START: {}", name)),
                sacode_kernel::Event::ToolCallFinished { name, success, .. } => self.events.push(format!("TOOL_END: {} ({})", name, if *success { "ok" } else { "fail" })),
                _ => {}
            }
        }

        for step in &result.output.plan.steps {
            self.plan_steps.push(format!("{}. {} [{:?}]", step.id, step.description, step.status));
        }

        for (step_id, intents) in &result.tool_calls {
            for intent in intents {
                self.tool_results.push(format!("Step {} - {}", step_id, intent.name));
            }
        }
    }

    fn handle_key_event(&mut self, key: KeyEvent) {
        match self.input_mode {
            InputMode::Normal => match key.code {
                KeyCode::Char('q') => self.should_quit = true,
                KeyCode::Char('i') => self.input_mode = InputMode::Editing,
                KeyCode::Char('m') => {
                    self.mode = match self.mode {
                        ExecutionMode::Plan => ExecutionMode::Build,
                        ExecutionMode::Build => ExecutionMode::Yolo,
                        ExecutionMode::Yolo => ExecutionMode::Plan,
                    };
                }
                KeyCode::Enter => self.execute_task(),
                _ => {}
            },
            InputMode::Editing => match key.code {
                KeyCode::Enter => self.execute_task(),
                KeyCode::Char(c) => self.input.push(c),
                KeyCode::Backspace => {
                    self.input.pop();
                }
                KeyCode::Esc => self.input_mode = InputMode::Normal,
                _ => {}
            },
        }
    }
}

pub fn run_tui() -> Result<()> {
    enable_raw_mode()?;
    let mut stdout = io::stdout();
    execute!(stdout, EnterAlternateScreen, EnableMouseCapture)?;
    let backend = CrosstermBackend::new(stdout);
    let mut terminal = Terminal::new(backend)?;

    let mut app = App::new();
    let res = run_app(&mut terminal, &mut app);

    disable_raw_mode()?;
    execute!(
        terminal.backend_mut(),
        LeaveAlternateScreen,
        DisableMouseCapture
    )?;
    terminal.show_cursor()?;

    res
}

fn run_app(terminal: &mut Terminal<CrosstermBackend<io::Stdout>>, app: &mut App) -> Result<()> {
    while !app.should_quit {
        terminal.draw(|frame| ui(frame, app))?;

        if event::poll(std::time::Duration::from_millis(100))? {
            if let Event::Key(key) = event::read()? {
                if key.kind == KeyEventKind::Press {
                    app.handle_key_event(key);
                }
            }
        }
    }
    Ok(())
}

fn ui(frame: &mut Frame, app: &App) {
    let chunks = Layout::default()
        .direction(Direction::Vertical)
        .margin(1)
        .constraints([
            Constraint::Length(3),
            Constraint::Min(10),
            Constraint::Length(3),
        ])
        .split(frame.area());

    let header = Paragraph::new(Line::from(vec![
        Span::styled("SaCode TUI", Style::default().fg(Color::Cyan).add_modifier(Modifier::BOLD)),
        Span::raw(" | "),
        Span::styled(format!("Mode: {:?}", app.mode), Style::default().fg(Color::Yellow)),
        Span::raw(" | "),
        Span::styled("[q]quit [i]input [m]mode", Style::default().fg(Color::Gray)),
    ]))
    .block(Block::default().borders(Borders::ALL).title("Header"));
    frame.render_widget(header, chunks[0]);

    let main_chunks = Layout::default()
        .direction(Direction::Horizontal)
        .constraints([Constraint::Percentage(50), Constraint::Percentage(50)])
        .split(chunks[1]);

    let plan_items: Vec<ListItem> = app.plan_steps
        .iter()
        .map(|s| ListItem::new(Line::from(Span::raw(s))))
        .collect();
    let plan_list = List::new(plan_items)
        .block(Block::default().borders(Borders::ALL).title("Plan"));
    frame.render_widget(plan_list, main_chunks[0]);

    let event_items: Vec<ListItem> = app.events
        .iter()
        .take(20)
        .map(|s| ListItem::new(Line::from(Span::raw(s))))
        .collect();
    let event_list = List::new(event_items)
        .block(Block::default().borders(Borders::ALL).title("Events"));
    frame.render_widget(event_list, main_chunks[1]);

    let input_style = match app.input_mode {
        InputMode::Normal => Style::default().fg(Color::Gray),
        InputMode::Editing => Style::default().fg(Color::Yellow),
    };

    let input_text = if app.input.is_empty() {
        "Type your task and press Enter".to_string()
    } else {
        format!(">>> {}", app.input)
    };

    let input = Paragraph::new(Line::from(Span::styled(input_text, input_style)))
        .block(Block::default().borders(Borders::ALL).title("Input"));
    frame.render_widget(input, chunks[2]);
}
