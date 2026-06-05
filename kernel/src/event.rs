use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum Event {
    Message {
        content: String,
    },
    Thinking {
        content: String,
    },
    PlanGenerated {
        steps: Vec<String>,
    },
    ToolCallStarted {
        name: String,
        input: serde_json::Value,
    },
    ToolCallFinished {
        name: String,
        output: serde_json::Value,
        success: bool,
    },
    ApprovalRequested {
        action: ApprovalAction,
    },
    ApprovalResolved {
        approved: bool,
    },
    FileChanged {
        path: String,
        change_type: FileChangeType,
    },
    CommandOutput {
        command: String,
        output: String,
    },
    Done {
        summary: String,
    },
    Error {
        message: String,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ApprovalAction {
    WriteFile { path: String },
    ExecuteCommand { command: String },
    CallPlugin { name: String },
    BatchChange { count: usize },
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum FileChangeType {
    Created,
    Modified,
    Deleted,
}

impl Event {
    pub fn is_terminal(&self) -> bool {
        matches!(self, Event::Done { .. } | Event::Error { .. })
    }

    pub fn requires_approval(&self) -> bool {
        matches!(self, Event::ApprovalRequested { .. })
    }

    pub fn message(content: impl Into<String>) -> Self {
        Event::Message {
            content: content.into(),
        }
    }

    pub fn thinking(content: impl Into<String>) -> Self {
        Event::Thinking {
            content: content.into(),
        }
    }

    pub fn done(summary: impl Into<String>) -> Self {
        Event::Done {
            summary: summary.into(),
        }
    }

    pub fn error(message: impl Into<String>) -> Self {
        Event::Error {
            message: message.into(),
        }
    }
}
