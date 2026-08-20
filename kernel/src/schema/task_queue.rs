use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::fmt;

use super::task::Task;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScheduledTask {
    pub id: String,
    pub task: Task,
    pub priority: TaskPriority,
    pub dependencies: Vec<String>,
    pub retry_policy: RetryPolicy,
    pub scheduled_at: Option<DateTime<Utc>>,
    pub deadline: Option<DateTime<Utc>>,
    pub current_attempt: u32,
    pub created_at: DateTime<Utc>,
}

impl ScheduledTask {
    pub fn new(id: String, task: Task) -> Self {
        Self {
            id,
            task,
            priority: TaskPriority::Normal,
            dependencies: Vec::new(),
            retry_policy: RetryPolicy::default(),
            scheduled_at: None,
            deadline: None,
            current_attempt: 0,
            created_at: Utc::now(),
        }
    }

    pub fn with_priority(self, priority: TaskPriority) -> Self {
        Self { priority, ..self }
    }

    pub fn with_dependencies(self, dependencies: Vec<String>) -> Self {
        Self {
            dependencies,
            ..self
        }
    }

    pub fn with_retry_policy(self, retry_policy: RetryPolicy) -> Self {
        Self {
            retry_policy,
            ..self
        }
    }

    pub fn with_scheduled_at(self, scheduled_at: DateTime<Utc>) -> Self {
        Self {
            scheduled_at: Some(scheduled_at),
            ..self
        }
    }

    pub fn with_deadline(self, deadline: DateTime<Utc>) -> Self {
        Self {
            deadline: Some(deadline),
            ..self
        }
    }

    pub fn increment_attempt(&mut self) {
        self.current_attempt += 1;
    }

    pub fn is_ready(&self, completed_ids: &[String]) -> bool {
        self.dependencies
            .iter()
            .all(|dep| completed_ids.contains(dep))
    }

    pub fn can_retry(&self) -> bool {
        self.current_attempt < self.retry_policy.max_attempts
    }

    pub fn next_backoff_delay_ms(&self) -> u64 {
        self.retry_policy.compute_delay_ms(self.current_attempt)
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, PartialOrd, Ord, Default)]
#[serde(rename_all = "snake_case")]
pub enum TaskPriority {
    #[default]
    Normal = 1,
    Low = 0,
    High = 2,
    Urgent = 3,
}

impl fmt::Display for TaskPriority {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            TaskPriority::Low => write!(f, "low"),
            TaskPriority::Normal => write!(f, "normal"),
            TaskPriority::High => write!(f, "high"),
            TaskPriority::Urgent => write!(f, "urgent"),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RetryPolicy {
    pub max_attempts: u32,
    pub backoff: BackoffStrategy,
    pub retry_on: Vec<RetryCondition>,
}

impl Default for RetryPolicy {
    fn default() -> Self {
        Self {
            max_attempts: 3,
            backoff: BackoffStrategy::Exponential {
                base_ms: 1000,
                max_ms: 30000,
            },
            retry_on: vec![RetryCondition::Timeout, RetryCondition::NetworkError],
        }
    }
}

impl RetryPolicy {
    pub fn no_retry() -> Self {
        Self {
            max_attempts: 0,
            backoff: BackoffStrategy::Fixed { delay_ms: 0 },
            retry_on: Vec::new(),
        }
    }

    pub fn fixed(delay_ms: u64, max_attempts: u32) -> Self {
        Self {
            max_attempts,
            backoff: BackoffStrategy::Fixed { delay_ms },
            retry_on: vec![RetryCondition::Timeout, RetryCondition::NetworkError],
        }
    }

    pub fn exponential(base_ms: u64, max_ms: u64, max_attempts: u32) -> Self {
        Self {
            max_attempts,
            backoff: BackoffStrategy::Exponential { base_ms, max_ms },
            retry_on: vec![RetryCondition::Timeout, RetryCondition::NetworkError],
        }
    }

    pub fn compute_delay_ms(&self, attempt: u32) -> u64 {
        match &self.backoff {
            BackoffStrategy::Fixed { delay_ms } => *delay_ms,
            BackoffStrategy::Exponential { base_ms, max_ms } => {
                let exp = base_ms.saturating_mul(2u64.pow(attempt));
                exp.min(*max_ms)
            }
            BackoffStrategy::Linear { increment_ms } => increment_ms.saturating_mul(attempt as u64),
        }
    }

    pub fn should_retry_on(&self, condition: &RetryCondition) -> bool {
        self.retry_on.contains(condition)
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum BackoffStrategy {
    Fixed { delay_ms: u64 },
    Exponential { base_ms: u64, max_ms: u64 },
    Linear { increment_ms: u64 },
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum RetryCondition {
    Timeout,
    NetworkError,
    RateLimit,
    ResourceExhausted,
    InternalError,
    Any,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "snake_case")]
pub enum TaskQueueStatus {
    #[default]
    Pending,
    Ready,
    Running,
    Completed,
    Failed,
    Retrying,
    Cancelled,
}

impl fmt::Display for TaskQueueStatus {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            TaskQueueStatus::Pending => write!(f, "pending"),
            TaskQueueStatus::Ready => write!(f, "ready"),
            TaskQueueStatus::Running => write!(f, "running"),
            TaskQueueStatus::Completed => write!(f, "completed"),
            TaskQueueStatus::Failed => write!(f, "failed"),
            TaskQueueStatus::Retrying => write!(f, "retrying"),
            TaskQueueStatus::Cancelled => write!(f, "cancelled"),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TaskResult {
    pub task_id: String,
    pub status: TaskQueueStatus,
    pub output: Option<String>,
    pub error: Option<String>,
    pub duration_ms: u64,
    pub completed_at: DateTime<Utc>,
}

impl TaskResult {
    pub fn success(task_id: String, output: String, duration_ms: u64) -> Self {
        Self {
            task_id,
            status: TaskQueueStatus::Completed,
            output: Some(output),
            error: None,
            duration_ms,
            completed_at: Utc::now(),
        }
    }

    pub fn failure(task_id: String, error: String, duration_ms: u64) -> Self {
        Self {
            task_id,
            status: TaskQueueStatus::Failed,
            output: None,
            error: Some(error),
            duration_ms,
            completed_at: Utc::now(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QueueStats {
    pub pending_count: usize,
    pub ready_count: usize,
    pub running_count: usize,
    pub completed_count: usize,
    pub failed_count: usize,
    pub retrying_count: usize,
    pub cancelled_count: usize,
}

/// 统一任务状态 — 合并 TaskQueueStatus（队列态）与 TaskRunState（执行态）的单一真相源
///
/// 语义覆盖：
/// - 队列态：Pending / Ready / Retrying
/// - 执行态：Running / WaitingForUser / WaitingForApproval / Cancelling
/// - 终态：Completed / Failed / Cancelled
///
/// 设计目标：消除四套独立状态枚举互转有损的问题，
/// 作为所有入口（CLI/TUI/daemon/SDK/session）的状态管理唯一来源。
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "snake_case")]
pub enum TaskState {
    /// 已提交，等待依赖满足
    #[default]
    Pending,
    /// 依赖满足，等待执行
    Ready,
    /// 失败后重试中
    Retrying,
    /// 执行中
    Running,
    /// 等待用户输入
    WaitingForUser,
    /// 等待审批
    WaitingForApproval,
    /// 取消中（过渡态）
    Cancelling,
    /// 完成
    Completed,
    /// 失败
    Failed,
    /// 已取消
    Cancelled,
}

impl TaskState {
    /// 判断从当前状态到目标状态的转移是否合法
    ///
    /// 合法转移图：
    /// ```text
    /// Pending → Ready | Cancelled
    /// Ready → Running | Cancelled
    /// Retrying → Ready | Cancelled
    /// Running → Completed | Failed | WaitingForUser | WaitingForApproval | Cancelling
    /// WaitingForUser → Running | Cancelled
    /// WaitingForApproval → Running | Cancelled
    /// Cancelling → Cancelled
    /// Failed → Retrying（重试）
    /// Completed / Cancelled → 终态不可转移
    /// ```
    pub fn can_transition_to(self, target: TaskState) -> bool {
        matches!(
            (self, target),
            // 队列态转移
            (Self::Pending, Self::Ready | Self::Cancelled)
                | (Self::Ready, Self::Running | Self::Cancelled)
                | (Self::Retrying, Self::Ready | Self::Cancelled)
                // 执行态转移
                | (Self::Running, Self::Completed | Self::Failed | Self::WaitingForUser | Self::WaitingForApproval | Self::Cancelling)
                | (Self::WaitingForUser, Self::Running | Self::Cancelled)
                | (Self::WaitingForApproval, Self::Running | Self::Cancelled)
                | (Self::Cancelling, Self::Cancelled)
                // 失败可重试
                | (Self::Failed, Self::Retrying)
        )
    }

    /// 执行状态转移，非法转移返回错误
    pub fn transition(self, target: TaskState) -> Result<TaskState, StateTransitionError> {
        if self.can_transition_to(target) {
            Ok(target)
        } else {
            Err(StateTransitionError {
                from: self,
                to: target,
            })
        }
    }

    /// 是否终态（不可再转移）
    pub fn is_terminal(self) -> bool {
        matches!(self, Self::Completed | Self::Failed | Self::Cancelled)
    }

    /// 是否队列态（等待执行）
    pub fn is_queued(self) -> bool {
        matches!(self, Self::Pending | Self::Ready | Self::Retrying)
    }

    /// 是否执行态（正在执行或等待交互）
    pub fn is_active(self) -> bool {
        matches!(
            self,
            Self::Running | Self::WaitingForUser | Self::WaitingForApproval | Self::Cancelling
        )
    }

    /// 从 TaskQueueStatus 无损转换
    pub fn from_queue_status(status: TaskQueueStatus) -> Self {
        match status {
            TaskQueueStatus::Pending => Self::Pending,
            TaskQueueStatus::Ready => Self::Ready,
            TaskQueueStatus::Running => Self::Running,
            TaskQueueStatus::Completed => Self::Completed,
            TaskQueueStatus::Failed => Self::Failed,
            TaskQueueStatus::Retrying => Self::Retrying,
            TaskQueueStatus::Cancelled => Self::Cancelled,
        }
    }

    /// 转换回 TaskQueueStatus
    ///
    /// 注意：WaitingForUser / WaitingForApproval / Cancelling 映射为 Running，
    /// 因为 TaskQueueStatus 不表达交互中间态。这是有损转换。
    pub fn to_queue_status(self) -> TaskQueueStatus {
        match self {
            Self::Pending => TaskQueueStatus::Pending,
            Self::Ready => TaskQueueStatus::Ready,
            Self::Retrying => TaskQueueStatus::Retrying,
            Self::Running | Self::WaitingForUser | Self::WaitingForApproval | Self::Cancelling => {
                TaskQueueStatus::Running
            }
            Self::Completed => TaskQueueStatus::Completed,
            Self::Failed => TaskQueueStatus::Failed,
            Self::Cancelled => TaskQueueStatus::Cancelled,
        }
    }
}

impl fmt::Display for TaskState {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Pending => write!(f, "pending"),
            Self::Ready => write!(f, "ready"),
            Self::Retrying => write!(f, "retrying"),
            Self::Running => write!(f, "running"),
            Self::WaitingForUser => write!(f, "waiting_for_user"),
            Self::WaitingForApproval => write!(f, "waiting_for_approval"),
            Self::Cancelling => write!(f, "cancelling"),
            Self::Completed => write!(f, "completed"),
            Self::Failed => write!(f, "failed"),
            Self::Cancelled => write!(f, "cancelled"),
        }
    }
}

impl std::str::FromStr for TaskState {
    type Err = String;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s {
            "pending" => Ok(Self::Pending),
            "ready" => Ok(Self::Ready),
            "retrying" => Ok(Self::Retrying),
            "running" => Ok(Self::Running),
            "waiting_for_user" => Ok(Self::WaitingForUser),
            "waiting_for_approval" => Ok(Self::WaitingForApproval),
            "cancelling" => Ok(Self::Cancelling),
            "completed" => Ok(Self::Completed),
            "failed" => Ok(Self::Failed),
            "cancelled" => Ok(Self::Cancelled),
            _ => Err(format!("unknown task state: {s}")),
        }
    }
}

impl From<TaskQueueStatus> for TaskState {
    fn from(status: TaskQueueStatus) -> Self {
        Self::from_queue_status(status)
    }
}

impl From<TaskState> for TaskQueueStatus {
    fn from(state: TaskState) -> Self {
        state.to_queue_status()
    }
}

/// 非法状态转移错误
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StateTransitionError {
    pub from: TaskState,
    pub to: TaskState,
}

impl fmt::Display for StateTransitionError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "非法状态转移: {} → {}", self.from, self.to)
    }
}

impl std::error::Error for StateTransitionError {}

/// 生成统一格式的 task_id
///
/// 格式：`task-{timestamp_ms}`，与 daemon 现有逻辑一致。
/// 所有入口（CLI/TUI/daemon/SDK）应使用此函数生成 task_id，
/// 确保跨入口的 task_id 格式统一、可关联。
///
/// 注意：同一毫秒内并发调用可能生成相同 ID。
/// daemon 路径的 HTTP handler 串行执行，实际冲突概率极低；
/// 若后续高并发场景出现冲突，可追加原子计数器后缀。
pub fn generate_task_id() -> String {
    format!("task-{}", Utc::now().timestamp_millis())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn task_state_default_is_pending() {
        assert_eq!(TaskState::default(), TaskState::Pending);
    }

    #[test]
    fn task_state_is_terminal() {
        assert!(TaskState::Completed.is_terminal());
        assert!(TaskState::Failed.is_terminal());
        assert!(TaskState::Cancelled.is_terminal());
        assert!(!TaskState::Running.is_terminal());
        assert!(!TaskState::Pending.is_terminal());
    }

    #[test]
    fn task_state_is_queued() {
        assert!(TaskState::Pending.is_queued());
        assert!(TaskState::Ready.is_queued());
        assert!(TaskState::Retrying.is_queued());
        assert!(!TaskState::Running.is_queued());
    }

    #[test]
    fn task_state_is_active() {
        assert!(TaskState::Running.is_active());
        assert!(TaskState::WaitingForUser.is_active());
        assert!(TaskState::WaitingForApproval.is_active());
        assert!(TaskState::Cancelling.is_active());
        assert!(!TaskState::Pending.is_active());
        assert!(!TaskState::Completed.is_active());
    }

    #[test]
    fn can_transition_to_valid_paths() {
        // 队列态
        assert!(TaskState::Pending.can_transition_to(TaskState::Ready));
        assert!(TaskState::Ready.can_transition_to(TaskState::Running));
        assert!(TaskState::Retrying.can_transition_to(TaskState::Ready));
        // 执行态
        assert!(TaskState::Running.can_transition_to(TaskState::Completed));
        assert!(TaskState::Running.can_transition_to(TaskState::Failed));
        assert!(TaskState::Running.can_transition_to(TaskState::WaitingForUser));
        assert!(TaskState::Running.can_transition_to(TaskState::WaitingForApproval));
        assert!(TaskState::Running.can_transition_to(TaskState::Cancelling));
        // 交互态恢复
        assert!(TaskState::WaitingForUser.can_transition_to(TaskState::Running));
        assert!(TaskState::WaitingForApproval.can_transition_to(TaskState::Running));
        // 取消
        assert!(TaskState::Cancelling.can_transition_to(TaskState::Cancelled));
        assert!(TaskState::Pending.can_transition_to(TaskState::Cancelled));
        assert!(TaskState::Ready.can_transition_to(TaskState::Cancelled));
        // 失败重试
        assert!(TaskState::Failed.can_transition_to(TaskState::Retrying));
    }

    #[test]
    fn cannot_transition_invalid_paths() {
        // 终态不可转移
        assert!(!TaskState::Completed.can_transition_to(TaskState::Running));
        assert!(!TaskState::Cancelled.can_transition_to(TaskState::Running));
        // 不能跳过 Ready 直接 Running
        assert!(!TaskState::Pending.can_transition_to(TaskState::Running));
        // 不能从交互态直接到终态（需先回 Running）
        assert!(!TaskState::WaitingForUser.can_transition_to(TaskState::Completed));
        // 不能从 Cancelling 回到 Running
        assert!(!TaskState::Cancelling.can_transition_to(TaskState::Running));
    }

    #[test]
    fn transition_ok_returns_target() {
        let result = TaskState::Pending.transition(TaskState::Ready);
        assert_eq!(result, Ok(TaskState::Ready));
    }

    #[test]
    fn transition_err_returns_error() {
        let result = TaskState::Completed.transition(TaskState::Running);
        assert!(result.is_err());
        let err = result.unwrap_err();
        assert_eq!(err.from, TaskState::Completed);
        assert_eq!(err.to, TaskState::Running);
    }

    #[test]
    fn from_queue_status_lossless() {
        assert_eq!(
            TaskState::from_queue_status(TaskQueueStatus::Pending),
            TaskState::Pending
        );
        assert_eq!(
            TaskState::from_queue_status(TaskQueueStatus::Retrying),
            TaskState::Retrying
        );
        assert_eq!(
            TaskState::from_queue_status(TaskQueueStatus::Cancelled),
            TaskState::Cancelled
        );
    }

    #[test]
    fn to_queue_status_maps_interaction_states_to_running() {
        // 有损转换：交互态映射为 Running
        assert_eq!(
            TaskState::WaitingForUser.to_queue_status(),
            TaskQueueStatus::Running
        );
        assert_eq!(
            TaskState::WaitingForApproval.to_queue_status(),
            TaskQueueStatus::Running
        );
        assert_eq!(
            TaskState::Cancelling.to_queue_status(),
            TaskQueueStatus::Running
        );
        // 队列态和终态无损
        assert_eq!(
            TaskState::Pending.to_queue_status(),
            TaskQueueStatus::Pending
        );
        assert_eq!(
            TaskState::Completed.to_queue_status(),
            TaskQueueStatus::Completed
        );
    }

    #[test]
    fn roundtrip_queue_status_preserves_core_states() {
        // 核心状态（非交互态）往返无损
        for status in [
            TaskQueueStatus::Pending,
            TaskQueueStatus::Ready,
            TaskQueueStatus::Retrying,
            TaskQueueStatus::Completed,
            TaskQueueStatus::Failed,
            TaskQueueStatus::Cancelled,
        ] {
            let state = TaskState::from(status);
            assert_eq!(state.to_queue_status(), status);
        }
    }

    #[test]
    fn display_and_from_str_roundtrip() {
        for state in [
            TaskState::Pending,
            TaskState::Running,
            TaskState::WaitingForUser,
            TaskState::WaitingForApproval,
            TaskState::Cancelling,
            TaskState::Completed,
            TaskState::Failed,
            TaskState::Cancelled,
        ] {
            let s = state.to_string();
            let parsed: TaskState = s.parse().expect("parse");
            assert_eq!(parsed, state);
        }
    }

    #[test]
    fn from_str_rejects_unknown() {
        let result: Result<TaskState, _> = "unknown_state".parse();
        assert!(result.is_err());
    }

    #[test]
    fn state_transition_error_display() {
        let err = StateTransitionError {
            from: TaskState::Completed,
            to: TaskState::Running,
        };
        let msg = format!("{err}");
        assert!(msg.contains("completed"));
        assert!(msg.contains("running"));
    }
}
