use std::{collections::HashMap, sync::Arc};

use serde::{Deserialize, Serialize};
use tokio::sync::{broadcast, Mutex, RwLock};

use crate::{executor::TaskExecutor, queue::TaskQueue, retry::RetryHandler, tools::ToolRegistry};
use sacode_kernel::{TaskQueueStatus, TaskRun};

use super::{parse_mode, status::sync_task_status_from_task_run, status::task_run_for_queue_status};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TaskRequest {
    pub prompt: String,
    pub mode: String,
    #[serde(default)]
    pub priority: String,
    #[serde(default)]
    pub dependencies: Vec<String>,
    #[serde(default)]
    pub retry_policy: Option<RetryPolicyRequest>,
    #[serde(default)]
    pub scheduled_at: Option<String>,
    #[serde(default)]
    pub deadline: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RetryPolicyRequest {
    #[serde(default = "default_max_attempts")]
    pub max_attempts: u32,
    #[serde(default = "default_backoff_type")]
    pub backoff_type: String,
    #[serde(default = "default_base_ms")]
    pub base_ms: u64,
    #[serde(default = "default_max_ms")]
    pub max_ms: u64,
    #[serde(default)]
    pub retry_on: Vec<String>,
}

fn default_max_attempts() -> u32 { 3 }
fn default_backoff_type() -> String { "exponential".to_string() }
fn default_base_ms() -> u64 { 1000 }
fn default_max_ms() -> u64 { 30000 }

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TaskResponse {
    pub task_id: String,
    pub status: String,
    pub message: String,
    pub queue_status: String,
}

impl TaskResponse {
    pub fn queued(task_id: String, queue_status: TaskQueueStatus, message: String) -> Self {
        Self {
            task_id,
            status: "queued".to_string(),
            message,
            queue_status: queue_status.to_string(),
        }
    }

    pub fn error(task_id: String, message: String) -> Self {
        Self {
            task_id,
            status: "error".to_string(),
            message,
            queue_status: "error".to_string(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TaskStatus {
    pub task_id: String,
    pub prompt: String,
    pub mode: String,
    pub status: String,
    pub queue_status: String,
    pub priority: String,
    pub progress: usize,
    pub total_steps: usize,
    pub current_event: Option<String>,
    pub current_attempt: u32,
    pub max_attempts: u32,
    pub duration_ms: Option<u64>,
    pub error: Option<String>,
    pub output: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub task_run: Option<TaskRun>,
}

impl TaskStatus {
    pub fn new(task_id: String, prompt: String, mode: String, priority: String, max_attempts: u32) -> Self {
        let task_run = task_run_for_queue_status(
            Some(task_id.clone()),
            parse_mode(&mode),
            prompt.clone(),
            TaskQueueStatus::Pending,
            None,
        );

        let mut status = Self {
            task_id,
            prompt,
            mode,
            status: String::new(),
            queue_status: String::new(),
            priority,
            progress: 0,
            total_steps: 0,
            current_event: None,
            current_attempt: 0,
            max_attempts,
            duration_ms: None,
            error: None,
            output: None,
            task_run: Some(task_run),
        };
        sync_task_status_from_task_run(&mut status);
        status
    }

    pub fn derived_queue_status(&self) -> String {
        self.task_run
            .as_ref()
            .and_then(|run| run.state.as_ref())
            .map(super::status::task_run_state_to_queue_status)
            .unwrap_or_else(|| self.queue_status.clone())
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct StreamEvent {
    pub task_id: String,
    pub event_type: String,
    pub data: serde_json::Value,
}

pub struct DaemonState {
    pub event_bus: broadcast::Sender<StreamEvent>,
    pub tasks: RwLock<HashMap<String, TaskStatus>>,
    pub queue: Arc<TaskQueue>,
    pub executor: Mutex<TaskExecutor>,
    pub retry_handler: RetryHandler,
}

impl DaemonState {
    pub fn new() -> Self {
        let (tx, _) = broadcast::channel(100);
        let queue = Arc::new(TaskQueue::new(10));
        let tools = ToolRegistry::builtin();

        let executor = TaskExecutor::new(queue.clone(), tools.clone());
        let executor_event_bus = executor.event_bus();

        let retry_handler = RetryHandler::new(queue.clone(), executor_event_bus);

        Self {
            event_bus: tx,
            tasks: RwLock::new(HashMap::new()),
            queue,
            executor: Mutex::new(executor),
            retry_handler,
        }
    }
}
