use std::io;

use anyhow::Result;
use crossterm::{
    event::{self, DisableMouseCapture, EnableMouseCapture, Event, KeyCode, KeyEvent, KeyEventKind},
    execute,
    terminal::{disable_raw_mode, enable_raw_mode, EnterAlternateScreen, LeaveAlternateScreen},
};
use ratatui::{
    backend:: CrosstermBackend,
    layout::{Constraint, Direction, Layout},
    style::{Color, Modifier, Style},
    text::{Line, Span},
    widgets::{Block, Borders, Paragraph, Scrollbar, ScrollbarOrientation, ScrollbarState},
    Frame, Terminal,
};
use sacode_kernel::{ExecutionMode, Supervisor, Task};

struct Message {
    role: MessageRole,
    content: String,
    timestamp: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum MessageRole {
    User,
    Assistant,
    System,
}

struct App {
    messages: Vec<Message>,
    input: String,
    should_quit: bool,
    scroll_offset: usize,
    processing: bool,
}

impl App {
    fn new() -> Self {
        let now = chrono::Local::now();
        let timestamp = now.format("%Y-%m-%d %H:%M").to_string();
        
        Self {
            messages: vec![
                Message {
                    role: MessageRole::System,
                    content: "SaCode - AI Coding Assistant\n\n输入你的编程任务，我会帮你完成。\n按 Ctrl+C 或 Esc 退出.".to_string(),
                    timestamp: timestamp.clone(),
                },
            ],
            input: String::new(),
            should_quit: false,
            scroll_offset: 0,
            processing: false,
        }
    }

    fn send_message(&mut self) {
        if self.input.is_empty() || self.processing {
            return;
        }

        let now = chrono::Local::now();
        let timestamp = now.format("%Y-%m-%d %H:%M").to_string();

        self.messages.push(Message {
            role: MessageRole::User,
            content: self.input.clone(),
            timestamp: timestamp.clone(),
        });

        let user_input = self.input.clone();
        self.input.clear();
        self.processing = true;

        let supervisor = Supervisor::new();
        let task = Task::new(user_input, ExecutionMode::Build, None);
        let result = supervisor.execute(&task);

        let response = if result.output.events.is_empty() {
            "任务已完成.".to_string()
        } else {
            let mut lines = Vec::new();
            for event in &result.output.events {
                match event {
                    sacode_kernel::Event::Message { content } => lines.push(content.clone()),
                    sacode_kernel::Event::Thinking { content } => lines.push(format!("💭 {}", content)),
                    sacode_kernel::Event::Done { summary } => lines.push(summary.clone()),
                    sacode_kernel::Event::Error { message } => lines.push(format!("❌ {}", message)),
                    _ => {}
                }
            }
            lines.join("\n")
        };

        let now = chrono::Local::now();
        let timestamp = now.format("%Y-%m-%d %H:%M").to_string();

        self.messages.push(Message {
            role: MessageRole::Assistant,
            content: response,
            timestamp,
        });

        self.processing = false;
        self.scroll_to_bottom();
    }

    fn scroll_to_bottom(&mut self) {
        self.scroll_offset = self.messages.len().saturating_sub(1);
    }

    fn scroll_up(&mut self) {
        self.scroll_offset = self.scroll_offset.saturating_sub(1);
    }

    fn scroll_down(&mut self) {
        if self.scroll_offset < self.messages.len().saturating_sub(1) {
            self.scroll_offset += 1;
        }
    }

    fn handle_key_event(&mut self, key: KeyEvent) {
        match key.code {
            KeyCode::Esc | KeyCode::Char('c') if key.modifiers.contains(crossterm::event::KeyModifiers::CONTROL) => {
                self.should_quit = true;
            }
            KeyCode::Enter => self.send_message(),
            KeyCode::Char(c) => self.input.push(c),
            KeyCode::Backspace => {
                self.input.pop();
            }
            KeyCode::Up => self.scroll_up(),
            KeyCode::Down => self.scroll_down(),
            KeyCode::PageUp => {
                for _ in 0..5 {
                    self.scroll_up();
                }
            }
            KeyCode::PageDown => {
                for _ in 0..5 {
                    self.scroll_down();
                }
            }
            _ => {}
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
        .margin(0)
        .constraints([
            Constraint::Min(5),
            Constraint::Length(3),
        ])
        .split(frame.area());

    let messages_block = Block::default()
        .borders(Borders::ALL)
        .border_style(Style::default().fg(Color::Rgb(100, 100, 120)))
        .title(Span::styled(
            " SaCode ",
            Style::default().fg(Color::Rgb(80, 200, 120)).add_modifier(Modifier::BOLD),
        ))
        .title_style(Style::default());

    let inner_area = messages_block.inner(chunks[0]);
    frame.render_widget(messages_block, chunks[0]);

    let mut lines: Vec<Line> = Vec::new();
    let mut current_y = 0;
    let max_y = inner_area.height as usize;

    for msg in app.messages.iter().skip(app.scroll_offset) {
        if current_y >= max_y {
            break;
        }

        let role_style = match msg.role {
            MessageRole::User => Style::default().fg(Color::Rgb(100, 149, 237)),
            MessageRole::Assistant => Style::default().fg(Color::Rgb(80, 200, 120)),
            MessageRole::System => Style::default().fg(Color::Rgb(150, 150, 150)),
        };

        let role_label = match msg.role {
            MessageRole::User => "你",
            MessageRole::Assistant => "SaCode",
            MessageRole::System => "系统",
        };

        lines.push(Line::from(vec![
            Span::styled(&msg.timestamp, Style::default().fg(Color::Rgb(120, 120, 140))),
            Span::raw(" "),
            Span::styled(role_label, role_style.add_modifier(Modifier::BOLD)),
        ]));

        current_y += 1;

        for content_line in msg.content.lines() {
            if current_y >= max_y {
                break;
            }
            lines.push(Line::from(Span::styled(
                content_line,
                Style::default().fg(Color::Rgb(200, 200, 210)),
            )));
            current_y += 1;
        }

        if current_y < max_y {
            lines.push(Line::from(""));
            current_y += 1;
        }
    }

    let messages_paragraph = Paragraph::new(lines);
    frame.render_widget(messages_paragraph, inner_area);

    if app.messages.len() > max_y {
        let scrollbar = Scrollbar::default()
            .orientation(ScrollbarOrientation::VerticalRight)
            .begin_symbol(None)
            .end_symbol(None)
            .track_style(Style::default().fg(Color::Rgb(60, 60, 80)))
            .thumb_style(Style::default().fg(Color::Rgb(100, 100, 120)));
        
        let mut scrollbar_state = ScrollbarState::new(app.messages.len())
            .position(app.scroll_offset);
        
        frame.render_stateful_widget(scrollbar, inner_area, &mut scrollbar_state);
    }

    let input_text = if app.processing {
        Span::styled("处理中...", Style::default().fg(Color::Rgb(200, 200, 100)))
    } else if app.input.is_empty() {
        Span::styled("输入你的编程任务...", Style::default().fg(Color::Rgb(100, 100, 120)))
    } else {
        Span::styled(&app.input, Style::default().fg(Color::Rgb(200, 200, 210)))
    };

    let input_block = Block::default()
        .borders(Borders::ALL)
        .border_style(Style::default().fg(Color::Rgb(100, 100, 120)));

    let input_paragraph = Paragraph::new(Line::from(input_text))
        .block(input_block);
    frame.render_widget(input_paragraph, chunks[1]);

    if !app.processing && !app.input.is_empty() {
        let cursor_x = chunks[1].x + 1 + app.input.len() as u16;
        let cursor_y = chunks[1].y + 1;
        frame.set_cursor_position((cursor_x, cursor_y));
    }
}
