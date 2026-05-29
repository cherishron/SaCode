use anyhow::Result;
use serde::{Deserialize, Serialize};
use std::{collections::HashMap, path::{Path, PathBuf}, sync::{Arc, Mutex}};

use sacode_kernel::{ApprovalAction, ApprovalPolicy, Checkpoint, Event, ExecutionContext, ExecutionMode, Supervisor, Task, ToolExecutionRecord};

use crate::CheckpointStorage;
use crate::ToolRegistry;

#[derive(Debug, Clone)]
pub struct SessionService {
    sessions: Arc<Mutex<HashMap<String, SessionState>>>,
}

impl SessionService {
    pub fn new() -> Self {
        Self {
            sessions: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    pub fn create_session(&self, cwd: PathBuf) -> Result<SessionHandle> {
        let id = format!("session-{}", unique_suffix());
        let state = SessionState::new(id.clone(), cwd);
        let handle = state.handle();
        self.sessions.lock().expect("session mutex poisoned").insert(id, state);
        Ok(handle)
    }

    pub fn get_session(&self, session_id: &str) -> Result<SessionHandle> {
        let sessions = self.sessions.lock().expect("session mutex poisoned");
        let session = sessions
            .get(session_id)
            .ok_or_else(|| anyhow::anyhow!("session not found: {}", session_id))?;
        Ok(session.handle())
    }

    pub fn list_sessions(&self) -> Vec<SessionHandle> {
        self.sessions
            .lock()
            .expect("session mutex poisoned")
            .values()
            .map(SessionState::handle)
            .collect()
    }

    pub fn close_session(&self, session_id: &str) -> Result<()> {
        let mut sessions = self.sessions.lock().expect("session mutex poisoned");
        let session = sessions
            .get_mut(session_id)
            .ok_or_else(|| anyhow::anyhow!("session not found: {}", session_id))?;
        session.status = SessionStatus::Closed;
        Ok(())
    }

    pub fn cancel_session(&self, session_id: &str) -> Result<()> {
        let mut sessions = self.sessions.lock().expect("session mutex poisoned");
        let session = sessions
            .get_mut(session_id)
            .ok_or_else(|| anyhow::anyhow!("session not found: {}", session_id))?;
        session.status = SessionStatus::Cancelled;
        Ok(())
    }

    pub fn compress_session(&self, session_id: &str) -> Result<CompressionResult> {
        let mut sessions = self.sessions.lock().expect("session mutex poisoned");
        let session = sessions
            .get_mut(session_id)
            .ok_or_else(|| anyhow::anyhow!("session not found: {}", session_id))?;

        let original_count = session.events.len();
        let original_tokens = session.estimate_event_tokens();

        session.compress()?;

        Ok(CompressionResult {
            original_event_count: original_count,
            compressed_event_count: session.compressed_event_count.unwrap_or(original_count),
            original_token_count: original_tokens,
            compressed_token_count: session.estimate_event_tokens(),
            compression_ratio: session.compression_ratio.unwrap_or(1.0),
            summary: session.compressed_summary.clone().unwrap_or_default(),
        })
    }

    pub fn auto_compress_session(&self, session_id: &str, threshold: u32) -> Result<Option<CompressionResult>> {
        let mut sessions = self.sessions.lock().expect("session mutex poisoned");
        let session = sessions
            .get_mut(session_id)
            .ok_or_else(|| anyhow::anyhow!("session not found: {}", session_id))?;

        if !session.should_compress(threshold) {
            return Ok(None);
        }

        let original_count = session.events.len();
        let original_tokens = session.estimate_event_tokens();

        session.compress()?;

        Ok(Some(CompressionResult {
            original_event_count: original_count,
            compressed_event_count: session.compressed_event_count.unwrap_or(original_count),
            original_token_count: original_tokens,
            compressed_token_count: session.estimate_event_tokens(),
            compression_ratio: session.compression_ratio.unwrap_or(1.0),
            summary: session.compressed_summary.clone().unwrap_or_default(),
        }))
    }

    pub fn load_session(&self, workdir: &Path, checkpoint_name: &str) -> Result<SessionHandle> {
        let checkpoints = CheckpointStorage::new(workdir);
        let checkpoint = checkpoints.load(checkpoint_name)?;
        let id = format!("session-{}", unique_suffix());
        let mut state = SessionState::new(id.clone(), workdir.to_path_buf());
        state.events = checkpoint.recent_events.clone();
        state.last_checkpoint = Some(checkpoint_name.to_string());
        let handle = state.handle();
        self.sessions
            .lock()
            .expect("session mutex poisoned")
            .insert(id, state);
        Ok(handle)
    }

    pub fn prompt(&self, session_id: &str, prompt: SessionPrompt) -> Result<Vec<SessionEvent>> {
        let mut sessions = self.sessions.lock().expect("session mutex poisoned");
        let session = sessions
            .get_mut(session_id)
            .ok_or_else(|| anyhow::anyhow!("session not found: {}", session_id))?;

        if matches!(session.status, SessionStatus::Cancelled | SessionStatus::Closed) {
            return Ok(vec![SessionEvent::Error {
                message: format!("session {} is not runnable", session_id),
            }]);
        }

        session.status = SessionStatus::Running;

        let task = Task::new(prompt.content.clone(), prompt.mode, None);
        let context = ExecutionContext::new(task.clone()).with_approval(prompt.approval);
        let supervisor = Supervisor::new();
        let tools = ToolRegistry::builtin();
        let execution = supervisor.execute(&task);
        let mut checkpoint = Checkpoint::new(task.clone());
        let mut events = vec![SessionEvent::Started { task }];
        let mut tool_records = Vec::new();

        for event in &execution.output.events {
            checkpoint.add_event(event.clone());
            events.push(SessionEvent::KernelEvent(event.clone()));
        }

        for (step_id, tool_calls) in execution.tool_calls {
            for tool_call in tool_calls {
                events.push(SessionEvent::ToolCallStarted {
                    step_id,
                    name: tool_call.name.clone(),
                    input: tool_call.input.clone(),
                });

                let (output, success) = execute_tool_call(&tools, &tool_call.name, &tool_call.input, context.approval);
                checkpoint.record_tool(tool_call.name.clone(), tool_call.input.clone(), output.clone(), success);
                tool_records.push(ToolExecutionRecord {
                    step_id: Some(step_id),
                    tool_name: tool_call.name.clone(),
                    success,
                });
                let finished = Event::ToolCallFinished {
                    name: tool_call.name.clone(),
                    output: output.clone(),
                    success,
                };
                checkpoint.add_event(finished.clone());
                events.push(SessionEvent::ToolCallFinished {
                    step_id,
                    name: tool_call.name,
                    output,
                    success,
                });
            }
        }

        let checkpoints = CheckpointStorage::new(&session.cwd);
        let checkpoint_path = checkpoints.save(&checkpoint)?;
        session.status = SessionStatus::Idle;
        session.events.extend(checkpoint.recent_events.clone());
        session.last_checkpoint = checkpoint_path.file_name().and_then(|value| value.to_str()).map(str::to_string);
        session.last_tool_records = tool_records;

        let summary = execution
            .output
            .events
            .iter()
            .rev()
            .find_map(|event| match event {
                Event::Done { summary } => Some(summary.clone()),
                Event::Error { message } => Some(message.clone()),
                _ => None,
            })
            .unwrap_or_else(|| "session completed".to_string());
        events.push(SessionEvent::Done { summary });
        Ok(events)
    }
}

#[derive(Debug, Clone)]
struct SessionState {
    id: String,
    cwd: PathBuf,
    status: SessionStatus,
    tools: Vec<String>,
    events: Vec<Event>,
    last_checkpoint: Option<String>,
    last_tool_records: Vec<ToolExecutionRecord>,
    compressed_summary: Option<String>,
    compression_ratio: Option<f32>,
    original_event_count: Option<usize>,
    compressed_event_count: Option<usize>,
    last_compressed_at: Option<String>,
}

impl SessionState {
    fn new(id: String, cwd: PathBuf) -> Self {
        Self {
            id: id.clone(),
            cwd,
            status: SessionStatus::Idle,
            tools: ToolRegistry::builtin().names().into_iter().map(str::to_string).collect(),
            events: Vec::new(),
            last_checkpoint: None,
            last_tool_records: Vec::new(),
            compressed_summary: None,
            compression_ratio: None,
            original_event_count: None,
            compressed_event_count: None,
            last_compressed_at: None,
        }
    }

    fn handle(&self) -> SessionHandle {
        SessionHandle {
            id: self.id.clone(),
            cwd: self.cwd.clone(),
            status: self.status.clone(),
            tools: self.tools.clone(),
            last_checkpoint: self.last_checkpoint.clone(),
        }
    }

    fn estimate_event_tokens(&self) -> u32 {
        self.events.iter().map(|event| estimate_event_tokens(event)).sum()
    }

    fn should_compress(&self, threshold: u32) -> bool {
        self.estimate_event_tokens() > threshold && self.compressed_summary.is_none()
    }

    fn compress(&mut self) -> Result<()> {
        if self.events.is_empty() {
            return Ok(())
        }

        let original_count = self.events.len();
        let original_tokens = self.estimate_event_tokens();

        let mut key_events = Vec::new();
        let mut tool_events = Vec::new();

        for event in &self.events {
            match event {
                Event::Message { content: _ } => key_events.push(event.clone()),
                Event::PlanGenerated { steps: _ } => key_events.push(event.clone()),
                Event::ToolCallStarted { name: _, input: _ } => tool_events.push(event.clone()),
                Event::ToolCallFinished { name: _, output: _, success } if *success => tool_events.push(event.clone()),
                Event::Done { summary: _ } => key_events.push(event.clone()),
                Event::Error { message: _ } => key_events.push(event.clone()),
                _ => {}
            }
        }

        let summary = generate_compression_summary(&key_events, &tool_events);
        let compressed_events = key_events.into_iter().chain(tool_events.into_iter()).collect::<Vec<_>>();
        let compressed_count = compressed_events.len();
        let compressed_tokens = compressed_events.iter().map(|event| estimate_event_tokens(event)).sum::<u32>();

        let ratio = if original_tokens > 0 {
            compressed_tokens as f32 / original_tokens as f32
        } else {
            1.0
        };

        self.events = compressed_events;
        self.compressed_summary = Some(summary);
        self.compression_ratio = Some(ratio);
        self.original_event_count = Some(original_count);
        self.compressed_event_count = Some(compressed_count);
        self.last_compressed_at = Some(chrono::Local::now().to_rfc3339());

        Ok(())
    }
}

impl Default for SessionService {
    fn default() -> Self {
        Self::new()
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionHandle {
    pub id: String,
    pub cwd: PathBuf,
    pub status: SessionStatus,
    pub tools: Vec<String>,
    pub last_checkpoint: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum SessionStatus {
    Idle,
    Running,
    Cancelling,
    Cancelled,
    Closed,
    Failed(String),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionPrompt {
    pub content: String,
    pub mode: ExecutionMode,
    pub approval: ApprovalPolicy,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum SessionEvent {
    Started { task: Task },
    KernelEvent(Event),
    ToolCallStarted { step_id: usize, name: String, input: serde_json::Value },
    ToolCallFinished { step_id: usize, name: String, output: serde_json::Value, success: bool },
    Done { summary: String },
    Error { message: String },
}

fn execute_tool_call(
    tools: &ToolRegistry,
    name: &str,
    input: &serde_json::Value,
    approval: ApprovalPolicy,
) -> (serde_json::Value, bool) {
    let spec = tools.get(name);
    let needs_approval = spec.map(|item| item.needs_approval()).unwrap_or(false);

    if needs_approval {
        match approval {
            ApprovalPolicy::AutoApprove => {}
            ApprovalPolicy::AutoDeny => return (serde_json::json!({ "error": "denied by policy" }), false),
            ApprovalPolicy::Prompt => return (serde_json::json!({ "error": "interactive approval unavailable" }), false),
        }
    }

    match tools.execute(name, input.clone()) {
        Ok(output) if output.success => (output.data, true),
        Ok(output) => (
            serde_json::json!({ "error": output.message.unwrap_or_else(|| "tool failed".to_string()) }),
            false,
        ),
        Err(error) => (serde_json::json!({ "error": error.to_string() }), false),
    }
}

fn unique_suffix() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};

    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis().to_string())
        .unwrap_or_else(|_| "0".to_string())
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CompressionResult {
    pub original_event_count: usize,
    pub compressed_event_count: usize,
    pub original_token_count: u32,
    pub compressed_token_count: u32,
    pub compression_ratio: f32,
    pub summary: String,
}

fn estimate_event_tokens(event: &Event) -> u32 {
    match event {
        Event::Message { content } => (content.len() / 4) as u32,
        Event::Thinking { content } => (content.len() / 4) as u32,
        Event::PlanGenerated { steps } => steps.iter().map(|s| s.len() / 4).sum::<usize>() as u32,
        Event::ToolCallStarted { name, input } => (name.len() / 4 + input.to_string().len() / 4 + 10) as u32,
        Event::ToolCallFinished { name, output, success: _ } => {
            let output_len = output.to_string().len();
            (name.len() / 4 + output_len / 4 + 20) as u32
        },
        Event::ApprovalRequested { action } => {
            match action {
                ApprovalAction::WriteFile { path } => (path.len() / 4 + 10) as u32,
                ApprovalAction::ExecuteCommand { command } => (command.len() / 4 + 10) as u32,
                ApprovalAction::CallPlugin { name } => (name.len() / 4 + 10) as u32,
                ApprovalAction::BatchChange { count } => 10 + *count as u32,
            }
        },
        Event::ApprovalResolved { approved: _ } => 5,
        Event::FileChanged { path, change_type: _ } => (path.len() / 4 + 10) as u32,
        Event::CommandOutput { command, output } => (command.len() / 4 + output.len() / 4 + 10) as u32,
        Event::Done { summary } => (summary.len() / 4) as u32,
        Event::Error { message } => (message.len() / 4 + 10) as u32,
    }
}

fn generate_compression_summary(key_events: &[Event], tool_events: &[Event]) -> String {
    let mut summary_parts = Vec::new();

    for event in key_events {
        match event {
            Event::Message { content } => {
                summary_parts.push(format!("消息: {}", content.lines().next().unwrap_or_default()));
            },
            Event::Done { summary } => {
                summary_parts.push(format!("完成: {}", summary.lines().next().unwrap_or_default()));
            },
            Event::Error { message } => {
                summary_parts.push(format!("错误: {}", message.lines().next().unwrap_or_default()));
            },
            Event::PlanGenerated { steps } => {
                summary_parts.push(format!("规划: {} 步", steps.len()));
            },
            _ => {}
        }
    }

    let tool_names: Vec<String> = tool_events
        .iter()
        .filter_map(|event| match event {
            Event::ToolCallStarted { name, input: _ } => Some(name.clone()),
            Event::ToolCallFinished { name, output: _, success: _ } => Some(name.clone()),
            _ => None,
        })
        .collect();

    if !tool_names.is_empty() {
        summary_parts.push(format!("工具调用: {}", tool_names.join(", ")));
    }

    if summary_parts.is_empty() {
        "会话已压缩".to_string()
    } else {
        summary_parts.join("\n")
    }
}
