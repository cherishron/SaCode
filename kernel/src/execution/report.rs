use serde::{Deserialize, Serialize};

use crate::{event::Event, schema::Plan};

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ExecutionReport {
    pub plan: Option<Plan>,
    pub events: Vec<Event>,
    pub tool_records: Vec<ToolExecutionRecord>,
    pub hook_records: Vec<HookRecord>,
    pub checkpoint_refs: Vec<String>,
    pub final_output: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolExecutionRecord {
    pub step_id: Option<usize>,
    pub tool_name: String,
    pub success: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HookRecord {
    pub hook_name: String,
    pub point: crate::execution::LifecyclePoint,
    pub success: bool,
    pub message: Option<String>,
}
