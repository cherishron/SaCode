use std::sync::Arc;
use std::time::Duration;

use sacode_kernel::{RetryCondition, ScheduledTask, TaskResult};
use tokio::sync::broadcast;
use tokio::time::sleep;

use crate::executor::ExecutorEvent;
use crate::queue::TaskQueue;

pub struct RetryHandler {
    queue: Arc<TaskQueue>,
    event_bus: broadcast::Sender<ExecutorEvent>,
    max_concurrent_retries: usize,
}

impl RetryHandler {
    pub fn new(queue: Arc<TaskQueue>, event_bus: broadcast::Sender<ExecutorEvent>) -> Self {
        Self {
            queue,
            event_bus,
            max_concurrent_retries: 5,
        }
    }

    pub fn with_max_concurrent_retries(mut self, max: usize) -> Self {
        self.max_concurrent_retries = max;
        self
    }

    pub async fn run(&self) {
        loop {
            self.process_retries().await;
            sleep(Duration::from_secs(1)).await;
        }
    }

    pub async fn run_once(&self) -> usize {
        self.process_retries().await
    }

    async fn process_retries(&self) -> usize {
        let retry_tasks = self.queue.get_retry_tasks().await;
        let mut processed = 0;

        for task in retry_tasks.iter().take(self.max_concurrent_retries) {
            let delay_ms = task.next_backoff_delay_ms();
            self.emit_event(
                &task.id,
                "retry_scheduled",
                serde_json::json!({
                    "attempt": task.current_attempt + 1,
                    "delay_ms": delay_ms,
                    "max_attempts": task.retry_policy.max_attempts,
                }),
            );

            sleep(Duration::from_millis(delay_ms)).await;

            self.queue.mark_retrying(&task.id).await;
            self.emit_event(
                &task.id,
                "retry_started",
                serde_json::json!({
                    "attempt": task.current_attempt + 1,
                }),
            );

            processed += 1;
        }

        processed
    }

    pub fn should_retry(&self, task: &ScheduledTask, result: &TaskResult) -> bool {
        if !task.can_retry() {
            return false;
        }

        if let Some(error) = &result.error {
            let condition = classify_error(error);
            return task.retry_policy.should_retry_on(&condition);
        }

        task.retry_policy
            .should_retry_on(&RetryCondition::InternalError)
    }

    pub fn compute_backoff_delay(&self, task: &ScheduledTask) -> Duration {
        Duration::from_millis(task.next_backoff_delay_ms())
    }

    fn emit_event(&self, task_id: &str, event_type: &str, data: serde_json::Value) {
        let _ = self.event_bus.send(ExecutorEvent {
            task_id: task_id.to_string(),
            event_type: event_type.to_string(),
            data,
        });
    }
}

fn classify_error(error: &str) -> RetryCondition {
    let error_lower = error.to_lowercase();

    if error_lower.contains("timeout") || error_lower.contains("timed out") {
        return RetryCondition::Timeout;
    }

    if error_lower.contains("network")
        || error_lower.contains("connection")
        || error_lower.contains("socket")
    {
        return RetryCondition::NetworkError;
    }

    if error_lower.contains("rate limit")
        || error_lower.contains("too many requests")
        || error_lower.contains("429")
    {
        return RetryCondition::RateLimit;
    }

    if error_lower.contains("resource")
        || error_lower.contains("exhausted")
        || error_lower.contains("memory")
    {
        return RetryCondition::ResourceExhausted;
    }

    RetryCondition::InternalError
}
