use serde::{Deserialize, Serialize};

use crate::schema::TaskState;
use crate::{ExecutionMode, ExecutionReport};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum TaskRunState {
    Completed,
    WaitingForUser,
    WaitingForApproval,
    Failed,
}

impl TaskRunState {
    /// 转换为统一 TaskState
    ///
    /// 注意：TaskRunState 仅表达执行结果语义，不包含队列态（Pending/Ready/Retrying），
    /// 因此转换结果要么是终态要么是执行态。
    pub fn to_task_state(self) -> TaskState {
        match self {
            Self::Completed => TaskState::Completed,
            Self::WaitingForUser => TaskState::WaitingForUser,
            Self::WaitingForApproval => TaskState::WaitingForApproval,
            Self::Failed => TaskState::Failed,
        }
    }
}

impl From<TaskRunState> for TaskState {
    fn from(state: TaskRunState) -> Self {
        state.to_task_state()
    }
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
