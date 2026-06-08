use serde::{Deserialize, Serialize};

use super::ApprovalPolicy;
use crate::schema::{ExecutionMode, Task};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExecutionContext {
    pub task: Task,
    pub task_id: Option<String>,
    pub mode: ExecutionMode,
    pub iteration: usize,
    pub current_step: Option<StepContext>,
    pub approval: ApprovalPolicy,
    #[serde(default)]
    pub message_history: Vec<MessageHistoryEntry>,
    #[serde(default)]
    pub total_tokens: u32,
    #[serde(default)]
    pub compression_threshold: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MessageHistoryEntry {
    pub role: String,
    pub content: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub token_count: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub is_key_decision: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub timestamp: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StepContext {
    pub step_id: usize,
    pub description: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolExecutionContext {
    pub step_id: Option<usize>,
    pub tool_name: String,
    pub approval_required: bool,
}

impl ExecutionContext {
    pub fn new(task: Task) -> Self {
        let mode = task.mode;
        Self {
            task,
            task_id: None,
            mode,
            iteration: 0,
            current_step: None,
            approval: ApprovalPolicy::default(),
            message_history: Vec::new(),
            total_tokens: 0,
            compression_threshold: 8000,
        }
    }

    pub fn with_task_id(mut self, task_id: impl Into<String>) -> Self {
        self.task_id = Some(task_id.into());
        self
    }

    pub fn with_iteration(mut self, iteration: usize) -> Self {
        self.iteration = iteration;
        self
    }

    pub fn with_step(mut self, step_id: usize, description: impl Into<String>) -> Self {
        self.current_step = Some(StepContext {
            step_id,
            description: description.into(),
        });
        self
    }

    pub fn with_approval(mut self, approval: ApprovalPolicy) -> Self {
        self.approval = approval;
        self
    }

    pub fn with_compression_threshold(mut self, threshold: u32) -> Self {
        self.compression_threshold = threshold;
        self
    }

    pub fn add_message(
        mut self,
        role: impl Into<String>,
        content: impl Into<String>,
        token_count: Option<u32>,
        is_key_decision: Option<bool>,
        tool_name: Option<String>,
    ) -> Self {
        let timestamp = chrono::Local::now().to_rfc3339();
        self.message_history.push(MessageHistoryEntry {
            role: role.into(),
            content: content.into(),
            token_count,
            is_key_decision,
            tool_name,
            timestamp: Some(timestamp),
        });
        if let Some(tokens) = token_count {
            self.total_tokens += tokens;
        }
        self
    }

    pub fn should_compress(&self) -> bool {
        self.total_tokens > self.compression_threshold
    }

    pub fn key_decisions(&self) -> Vec<&MessageHistoryEntry> {
        self.message_history
            .iter()
            .filter(|entry| entry.is_key_decision == Some(true))
            .collect()
    }

    pub fn tool_calls(&self) -> Vec<&MessageHistoryEntry> {
        self.message_history
            .iter()
            .filter(|entry| entry.tool_name.is_some())
            .collect()
    }

    pub fn estimate_compressed_tokens(&self) -> u32 {
        let key_tokens = self
            .key_decisions()
            .iter()
            .filter_map(|entry| entry.token_count)
            .sum::<u32>();
        let tool_tokens = self
            .tool_calls()
            .iter()
            .filter_map(|entry| entry.token_count)
            .sum::<u32>();
        key_tokens + tool_tokens + 200
    }
}
