use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
pub enum LoopPhaseStatus {
    #[default]
    Pending,
    InProgress,
    Blocked,
    Completed,
    Failed,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
pub enum LoopNextAction {
    #[default]
    RetryCurrentPhase,
    AdvanceToNextPhase,
    StopSuccess,
    StopBlocked,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
pub struct LoopPhase {
    pub id: String,
    pub title: String,
    pub objective: String,
    #[serde(default)]
    pub acceptance: Vec<String>,
    pub status: LoopPhaseStatus,
    pub attempts: u32,
    #[serde(default)]
    pub summaries: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
pub struct LoopProjectPlan {
    pub goal: String,
    #[serde(default)]
    pub phases: Vec<LoopPhase>,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
pub struct LoopPhaseResult {
    pub phase_id: String,
    pub phase_completed: bool,
    pub verification_run: bool,
    pub verification_passed: bool,
    #[serde(default)]
    pub remaining_issues: Vec<String>,
    pub summary: String,
    pub next_action: LoopNextAction,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
pub struct LoopState {
    pub task: String,
    pub iteration: u32,
    pub max_iterations: u32,
    pub error_count: u32,
    pub last_summary: String,
    pub plan: Option<LoopProjectPlan>,
    pub current_phase_index: usize,
    pub last_phase_result: Option<LoopPhaseResult>,
}
