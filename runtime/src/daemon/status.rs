use sacode_kernel::{ExecutionMode, RetryPolicy, TaskQueueStatus, TaskRun};

use super::{RetryPolicyRequest, TaskStatus};

pub fn parse_retry_policy(req: &Option<RetryPolicyRequest>) -> RetryPolicy {
    match req {
        Some(policy) => {
            let backoff = match policy.backoff_type.as_str() {
                "fixed" => sacode_kernel::BackoffStrategy::Fixed {
                    delay_ms: policy.base_ms,
                },
                "linear" => sacode_kernel::BackoffStrategy::Linear {
                    increment_ms: policy.base_ms,
                },
                _ => sacode_kernel::BackoffStrategy::Exponential {
                    base_ms: policy.base_ms,
                    max_ms: policy.max_ms,
                },
            };

            let retry_on = policy
                .retry_on
                .iter()
                .filter_map(|s| match s.as_str() {
                    "timeout" => Some(sacode_kernel::RetryCondition::Timeout),
                    "network_error" => Some(sacode_kernel::RetryCondition::NetworkError),
                    "rate_limit" => Some(sacode_kernel::RetryCondition::RateLimit),
                    "resource_exhausted" => Some(sacode_kernel::RetryCondition::ResourceExhausted),
                    "internal_error" => Some(sacode_kernel::RetryCondition::InternalError),
                    "any" => Some(sacode_kernel::RetryCondition::Any),
                    _ => None,
                })
                .collect();

            RetryPolicy {
                max_attempts: policy.max_attempts,
                backoff,
                retry_on,
            }
        }
        None => RetryPolicy::default(),
    }
}

pub fn task_run_state_to_queue_status(state: &sacode_kernel::TaskRunState) -> String {
    match state {
        sacode_kernel::TaskRunState::Completed => TaskQueueStatus::Completed.to_string(),
        sacode_kernel::TaskRunState::Failed => TaskQueueStatus::Failed.to_string(),
        sacode_kernel::TaskRunState::WaitingForApproval
        | sacode_kernel::TaskRunState::WaitingForUser => TaskQueueStatus::Running.to_string(),
    }
}

pub fn parse_queue_status(status: &str) -> TaskQueueStatus {
    match status {
        "ready" => TaskQueueStatus::Ready,
        "running" => TaskQueueStatus::Running,
        "completed" => TaskQueueStatus::Completed,
        "failed" => TaskQueueStatus::Failed,
        "retrying" => TaskQueueStatus::Retrying,
        "cancelled" => TaskQueueStatus::Cancelled,
        _ => TaskQueueStatus::Pending,
    }
}

pub fn task_run_state_for_queue_status(status: &TaskQueueStatus) -> sacode_kernel::TaskRunState {
    match status {
        TaskQueueStatus::Completed => sacode_kernel::TaskRunState::Completed,
        TaskQueueStatus::Failed => sacode_kernel::TaskRunState::Failed,
        TaskQueueStatus::Cancelled => sacode_kernel::TaskRunState::Failed,
        TaskQueueStatus::Pending
        | TaskQueueStatus::Ready
        | TaskQueueStatus::Running
        | TaskQueueStatus::Retrying => sacode_kernel::TaskRunState::WaitingForUser,
    }
}

pub fn task_run_for_queue_status(
    task_id: Option<String>,
    mode: ExecutionMode,
    prompt: String,
    queue_status: TaskQueueStatus,
    output_text: Option<String>,
) -> TaskRun {
    crate::task_run_snapshot(
        task_id,
        mode,
        prompt,
        task_run_state_for_queue_status(&queue_status),
        output_text,
    )
}

pub fn sync_task_status_from_task_run(status: &mut TaskStatus) {
    let queue_status = status.derived_queue_status();
    status.queue_status = queue_status.clone();
    status.status = queue_status;
}
