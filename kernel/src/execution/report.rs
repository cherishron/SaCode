use serde::{Deserialize, Serialize};

use crate::{event::Event, schema::Plan};

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ExecutionReport {
    pub plan: Option<Plan>,
    pub events: Vec<Event>,
    pub tool_records: Vec<ToolExecutionRecord>,
    #[serde(default)]
    pub route_records: Vec<RouteRecord>,
    #[serde(default)]
    pub conflicts: Vec<String>,
    #[serde(default)]
    pub conflict_records: Vec<ConflictRecord>,
    #[serde(default)]
    pub summary_record: Option<SummaryRecord>,
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

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct RouteRecord {
    pub task_id: String,
    pub role_id: String,
    pub primary: RoutedModelRecord,
    #[serde(default)]
    pub fallbacks: Vec<RoutedModelRecord>,
    pub route_reason: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct RoutedModelRecord {
    pub provider_name: String,
    pub model_name: String,
    pub route_score: i32,
    pub needs_thinking: bool,
    #[serde(default)]
    pub reasons: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ConflictRecord {
    pub kind: String,
    pub summary: String,
    #[serde(default)]
    pub details: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct SummaryRecord {
    pub task: String,
    #[serde(default)]
    pub roles: Vec<String>,
    pub reporter_summary: Option<String>,
    pub overall_conclusion: Option<String>,
    #[serde(default)]
    pub key_risks: Vec<String>,
    pub recommended_next_action: Option<String>,
    #[serde(default)]
    pub conflicts: Vec<String>,
    #[serde(default)]
    pub items: Vec<SummaryItemRecord>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct SummaryItemRecord {
    pub role_id: String,
    pub route: String,
    pub output: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HookRecord {
    pub hook_name: String,
    pub point: crate::execution::LifecyclePoint,
    pub success: bool,
    pub message: Option<String>,
}
