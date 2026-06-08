use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "snake_case")]
pub enum LifecyclePoint {
    TaskStarted,
    TaskFinished,
    StepStarted,
    StepFinished,
    ToolStarted,
    ToolFinished,
    ApprovalRequested,
    ApprovalResolved,
    CheckpointSaved,
}
