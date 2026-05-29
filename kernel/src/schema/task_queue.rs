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
        Self { dependencies, ..self }
    }

    pub fn with_retry_policy(self, retry_policy: RetryPolicy) -> Self {
        Self { retry_policy, ..self }
    }

    pub fn with_scheduled_at(self, scheduled_at: DateTime<Utc>) -> Self {
        Self { scheduled_at: Some(scheduled_at), ..self }
    }

    pub fn with_deadline(self, deadline: DateTime<Utc>) -> Self {
        Self { deadline: Some(deadline), ..self }
    }

    pub fn increment_attempt(&mut self) {
        self.current_attempt += 1;
    }

    pub fn is_ready(&self, completed_ids: &[String]) -> bool {
        self.dependencies.iter().all(|dep| completed_ids.contains(dep))
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
            BackoffStrategy::Linear { increment_ms } => {
                increment_ms.saturating_mul(attempt as u64)
            }
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