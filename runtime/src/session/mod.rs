use anyhow::Result;
use serde::{Deserialize, Serialize};
use std::{collections::HashMap, path::{Path, PathBuf}, sync::{Arc, Mutex}};

use sacode_kernel::{ApprovalPolicy, Checkpoint, Event, ExecutionContext, ExecutionMode, Supervisor, Task, ToolExecutionRecord};

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
