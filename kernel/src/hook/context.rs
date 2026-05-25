use serde::{Deserialize, Serialize};

use crate::{execution::{ExecutionContext, LifecyclePoint, ToolExecutionContext}, event::ApprovalAction};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HookContext {
    pub point: LifecyclePoint,
    pub execution: ExecutionContext,
    pub tool: Option<ToolExecutionContext>,
    pub approval: Option<ApprovalAction>,
    pub checkpoint_ref: Option<String>,
}

impl HookContext {
    pub fn new(point: LifecyclePoint, execution: ExecutionContext) -> Self {
        Self {
            point,
            execution,
            tool: None,
            approval: None,
            checkpoint_ref: None,
        }
    }

    pub fn with_tool(mut self, tool: ToolExecutionContext) -> Self {
        self.tool = Some(tool);
        self
    }

    pub fn with_approval(mut self, approval: ApprovalAction) -> Self {
        self.approval = Some(approval);
        self
    }

    pub fn with_checkpoint_ref(mut self, checkpoint_ref: impl Into<String>) -> Self {
        self.checkpoint_ref = Some(checkpoint_ref.into());
        self
    }
}
