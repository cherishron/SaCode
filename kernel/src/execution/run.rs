use serde::{Deserialize, Serialize};

use crate::{ExecutionMode, ExecutionReport};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum TaskRunState {
    Completed,
    WaitingForUser,
    WaitingForApproval,
    Failed,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct SessionRun {
    pub session_id: Option<String>,
    #[serde(default)]
    pub task_runs: Vec<TaskRun>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct TaskRun {
    pub task_id: Option<String>,
    pub source: Option<String>,
    pub mode: Option<ExecutionMode>,
    pub state: Option<TaskRunState>,
    pub prompt: Option<String>,
    pub started_at: Option<String>,
    pub updated_at: Option<String>,
    pub report: Option<ExecutionReport>,
    pub output_text: Option<String>,
    #[serde(default)]
    pub worker_runs: Vec<WorkerRun>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct WorkerRun {
    pub worker_id: Option<String>,
    pub role_id: Option<String>,
    pub state: Option<TaskRunState>,
    pub output: Option<String>,
}
