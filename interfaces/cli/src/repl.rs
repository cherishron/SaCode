use std::io::{self, BufRead, Write};

use anyhow::Result;
use sacode_kernel::{ExecutionMode, Supervisor, Task};
use sacode_runtime::ToolRegistry;

#[derive(Debug)]
pub struct ReplSession {
    mode: ExecutionMode,
}

impl ReplSession {
    pub fn new() -> Self {
        Self {
            mode: ExecutionMode::Build,
        }
    }

    pub async fn run(&mut self) -> Result<()> {
        let stdin = io::stdin();
        let mut lines = stdin.lock().lines();

        loop {
            print!(">>> ");
            io::stdout().flush()?;

            let line = match lines.next() {
                Some(Ok(l)) => l,
                Some(Err(_)) | None => break,
            };

            let trimmed = line.trim();
            if trimmed.is_empty() {
                continue;
            }

            if trimmed.starts_with('/') {
                if self.handle_command(trimmed) {
                    break;
                }
                continue;
            }

            self.handle_task(trimmed)?;
        }

        println!("Bye!");
        Ok(())
    }

    fn handle_command(&mut self, cmd: &str) -> bool {
        let parts: Vec<&str> = cmd.split_whitespace().collect();
        if parts.is_empty() {
            return false;
        }

        match parts[0] {
            "/exit" | "/quit" | "/q" => return true,
            "/help" | "/h" => self.show_help(),
            "/mode" => {
                if parts.len() > 1 {
                    self.set_mode(parts[1]);
                } else {
                    println!("Current mode: {:?}", self.mode);
                    println!("Available: plan, build, yolo");
                }
            }
            "/tools" => self.show_tools(),
            "/clear" => self.clear_screen(),
            cmd => println!("Unknown command: {}", cmd),
        }

        false
    }

    fn handle_task(&mut self, prompt: &str) -> Result<()> {
        let task = Task::new(prompt, self.mode, None);
        let supervisor = Supervisor::new();
        let result = supervisor.execute(&task);

        println!();
        println!("Task: {}", result.output.task);
        println!("Mode: {:?}", result.output.mode);
        println!("Plan:");
        for step in &result.output.plan.steps {
            println!("  {}. {} [{:?}]", step.id, step.description, step.status);
        }

        if !result.tool_calls.is_empty() {
            println!("Tool Calls:");
            for (step_id, intents) in &result.tool_calls {
                println!("  Step {}: {}", step_id, intents.iter().map(|i| i.name.as_str()).collect::<Vec<_>>().join(", "));
            }
        }

        println!("Events:");
        for event in &result.output.events {
            match event {
                sacode_kernel::Event::Message { content } => println!("  MSG: {}", content),
                sacode_kernel::Event::Done { summary } => println!("  DONE: {}", summary),
                _ => {}
            }
        }
        println!();

        Ok(())
    }

    fn show_help(&self) {
        println!();
        println!("Commands:");
        println!("  /help, /h        - Show this help");
        println!("  /mode [plan|build|yolo] - Set or show mode");
        println!("  /tools           - Show available tools");
        println!("  /clear           - Clear screen");
        println!("  /exit, /quit, /q - Exit REPL");
        println!();
        println!("Type a task description to run it.");
        println!();
    }

    fn set_mode(&mut self, mode: &str) {
        match mode {
            "plan" => self.mode = ExecutionMode::Plan,
            "build" => self.mode = ExecutionMode::Build,
            "yolo" => self.mode = ExecutionMode::Yolo,
            _ => {
                println!("Unknown mode: {}", mode);
                return;
            }
        }
        println!("Mode set to: {:?}", self.mode);
    }

    fn show_tools(&self) {
        let registry = ToolRegistry::builtin();
        println!();
        println!("Available tools:");
        for name in registry.names() {
            println!("  {}", name);
        }
        println!();
    }

    fn clear_screen(&self) {
        println!();
    }
}

impl Default for ReplSession {
    fn default() -> Self {
        Self::new()
    }
}
