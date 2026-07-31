pub mod task_runner;

use std::sync::Arc;
use std::time::{Duration, Instant};

use sacode_kernel::{Event, Supervisor, TaskQueueStatus, TaskResult, TaskRun};
use tokio::sync::broadcast;
use tokio::task::JoinSet;

use crate::tools::ToolRegistry;
use crate::{queue::TaskQueue, task_run_snapshot};

#[derive(Debug, Clone)]
pub struct ExecutorEvent {
    pub task_id: String,
    pub event_type: String,
    pub data: serde_json::Value,
}

pub struct TaskExecutor {
    queue: Arc<TaskQueue>,
    tools: ToolRegistry,
    event_bus: broadcast::Sender<ExecutorEvent>,
    active_tasks: JoinSet<ExecutorTaskResult>,
    poll_interval: Duration,
}

struct ExecutorTaskResult {
    task_id: String,
    result: TaskResult,
    task_run: TaskRun,
}

impl TaskExecutor {
    pub fn new(queue: Arc<TaskQueue>, tools: ToolRegistry) -> Self {
        let (event_bus, _) = broadcast::channel(100);
        Self {
            queue,
            tools,
            event_bus,
            active_tasks: JoinSet::new(),
            poll_interval: Duration::from_millis(100),
        }
    }

    pub fn with_event_bus(mut self, event_bus: broadcast::Sender<ExecutorEvent>) -> Self {
        self.event_bus = event_bus;
        self
    }

    pub fn subscribe(&self) -> broadcast::Receiver<ExecutorEvent> {
        self.event_bus.subscribe()
    }

    pub fn event_bus(&self) -> broadcast::Sender<ExecutorEvent> {
        self.event_bus.clone()
    }

    pub async fn run(&mut self) {
        loop {
            self.process_ready_tasks().await;
            self.process_completed_tasks().await;

            tokio::time::sleep(self.poll_interval).await;
        }
    }

    pub async fn run_once(&mut self) -> usize {
        let spawned = self.process_ready_tasks().await;
        self.process_completed_tasks().await;
        spawned
    }

    async fn process_ready_tasks(&mut self) -> usize {
        let mut spawned = 0;

        while let Some(task) = self.queue.next_ready().await {
            self.queue.mark_running(&task.id).await;
            self.emit_event(
                &task.id,
                "task_started",
                serde_json::json!({
                    "prompt": task.task.prompt,
                    "mode": task.task.mode.to_string(),
                }),
            );

            let task_id = task.id.clone();
            let event_bus = self.event_bus.clone();
            let _tools = self.tools.clone();

            self.active_tasks.spawn(async move {
                let started_at = Instant::now();
                // TODO: 迁移到 task_runner::execute_task_with_provider
                #[allow(deprecated)]
                let supervisor = Supervisor::new();
                #[allow(deprecated)]
                let execution = supervisor.execute(&task.task);

                let duration_ms = started_at.elapsed().as_millis() as u64;

                let has_error = execution
                    .output
                    .events
                    .iter()
                    .any(|e| matches!(e, Event::Error { .. }));
                let summary = execution
                    .output
                    .events
                    .iter()
                    .rev()
                    .find_map(|e| match e {
                        Event::Done { summary } => Some(summary.clone()),
                        Event::Error { message } => Some(message.clone()),
                        _ => None,
                    })
                    .unwrap_or_else(|| "completed".to_string());

                for event in &execution.output.events {
                    let event_name = executor_event_name(event);
                    emit_executor_event(
                        &event_bus,
                        &task_id,
                        event_name,
                        serde_json::to_value(event).unwrap_or_default(),
                    );
                }

                let result = if has_error {
                    TaskResult::failure(task_id.clone(), summary.clone(), duration_ms)
                } else {
                    TaskResult::success(task_id.clone(), summary.clone(), duration_ms)
                };

                let task_run = task_run_snapshot(
                    Some(task_id.clone()),
                    task.task.mode,
                    task.task.prompt.clone(),
                    if has_error {
                        sacode_kernel::TaskRunState::Failed
                    } else {
                        sacode_kernel::TaskRunState::Completed
                    },
                    result.output.clone().or_else(|| result.error.clone()),
                );

                ExecutorTaskResult {
                    task_id,
                    result,
                    task_run,
                }
            });

            spawned += 1;
        }

        spawned
    }

    async fn process_completed_tasks(&mut self) {
        while let Some(result) = self.active_tasks.try_join_next() {
            match result {
                Ok(exec_result) => {
                    let task_id = &exec_result.task_id;

                    match exec_result.result.status {
                        TaskQueueStatus::Completed => {
                            self.queue
                                .mark_completed(
                                    task_id,
                                    exec_result.result.clone(),
                                    exec_result.task_run.clone(),
                                )
                                .await;
                            self.emit_event(
                                task_id,
                                "task_completed",
                                serde_json::json!({
                                    "result": exec_result.result,
                                    "task_run": exec_result.task_run,
                                }),
                            );
                        }
                        TaskQueueStatus::Failed => {
                            self.queue
                                .mark_failed(
                                    task_id,
                                    exec_result.result.clone(),
                                    exec_result.task_run.clone(),
                                )
                                .await;
                            self.emit_event(
                                task_id,
                                "task_failed",
                                serde_json::json!({
                                    "result": exec_result.result,
                                    "task_run": exec_result.task_run,
                                }),
                            );
                        }
                        _ => {}
                    }
                }
                Err(e) => {
                    tracing::error!("Task join error: {}", e);
                }
            }
        }
    }

    fn emit_event(&self, task_id: &str, event_type: &str, data: serde_json::Value) {
        let _ = self.event_bus.send(ExecutorEvent {
            task_id: task_id.to_string(),
            event_type: event_type.to_string(),
            data,
        });
    }
}

fn emit_executor_event(
    event_bus: &broadcast::Sender<ExecutorEvent>,
    task_id: &str,
    event_type: &str,
    data: serde_json::Value,
) {
    let _ = event_bus.send(ExecutorEvent {
        task_id: task_id.to_string(),
        event_type: event_type.to_string(),
        data,
    });
}

fn executor_event_name(event: &Event) -> &'static str {
    match event {
        Event::Message { .. } => "message",
        Event::Thinking { .. } => "thinking",
        Event::PlanGenerated { .. } => "plan_generated",
        Event::ToolCallStarted { .. } => "tool_call_started",
        Event::ToolCallFinished { .. } => "tool_call_finished",
        Event::ApprovalRequested { .. } => "approval_requested",
        Event::ApprovalResolved { .. } => "approval_resolved",
        Event::FileChanged { .. } => "file_changed",
        Event::CommandOutput { .. } => "command_output",
        Event::Done { .. } => "done",
        Event::Error { .. } => "error",
    }
}
