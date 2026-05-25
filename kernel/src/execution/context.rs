use serde::{Deserialize, Serialize};

use crate::schema::{ExecutionMode, Task};
use super::ApprovalPolicy;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExecutionContext {
    pub task: Task,
    pub task_id: Option<String>,
    pub mode: ExecutionMode,
    pub iteration: usize,
    pub current_step: Option<StepContext>,
    pub approval: ApprovalPolicy,
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
}
