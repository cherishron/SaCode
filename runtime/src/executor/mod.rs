pub mod task_runner;

use std::path::PathBuf;
use std::sync::Arc;
use std::time::{Duration, Instant};

// Supervisor 已废弃，仅作为无 workdir 时的 fallback 占位（保留向后兼容老测试）
#[allow(deprecated)]
use sacode_kernel::{Event, Supervisor, TaskQueueStatus, TaskResult, TaskRun};
use tokio::sync::broadcast;
use tokio::task::JoinSet;

use crate::executor::task_runner::{
    AutoApproveDecider, LoggingErrorRecorder, TaskRunConfig, execute_task_with_provider,
};
use crate::tools::ToolRegistry;
use crate::{queue::TaskQueue, resolve_config_model_candidates, task_run_snapshot};
use sacode_kernel::TaskRunState;

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
    /// 工作目录：设置后 spawn 任务体走 task_runner 路径，
    /// 未设置则走 Supervisor 占位 fallback（保留向后兼容老测试）
    workdir: Option<PathBuf>,
}

/// executor 侧 broadcast 容量：提升到 256 以容纳单任务多事件突发，
/// 与 daemon::DAEMON_EVENT_BUS_CAPACITY 对齐，减少 forwarder Lagged 丢事件概率
const EXECUTOR_EVENT_BUS_CAPACITY: usize = 256;

struct ExecutorTaskResult {
    task_id: String,
    result: TaskResult,
    task_run: TaskRun,
}

impl TaskExecutor {
    pub fn new(queue: Arc<TaskQueue>, tools: ToolRegistry) -> Self {
        let (event_bus, _) = broadcast::channel(EXECUTOR_EVENT_BUS_CAPACITY);
        Self {
            queue,
            tools,
            event_bus,
            active_tasks: JoinSet::new(),
            poll_interval: Duration::from_millis(100),
            workdir: None,
        }
    }

    /// 设置工作目录：启用后 spawn 任务体走 task_runner 路径，
    /// 调用 `execute_task_with_provider` 替代占位 Supervisor
    pub fn with_workdir(mut self, workdir: PathBuf) -> Self {
        self.workdir = Some(workdir);
        self
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
            let tools = self.tools.clone();
            let workdir = self.workdir.clone();

            self.active_tasks.spawn(async move {
                let started_at = Instant::now();

                // 双路径分发：workdir 设置则走 task_runner，否则走 Supervisor 占位 fallback
                let (result, task_run, intermediate_events) = match workdir {
                    Some(workdir) => {
                        execute_via_task_runner(
                            &workdir,
                            &task.task,
                            task_id.clone(),
                            tools,
                            started_at,
                        )
                        .await
                    }
                    None => {
                        execute_via_supervisor_fallback(&task.task, task_id.clone(), started_at)
                    }
                };

                // 发送中间事件（task_runner 路径仅 1 个 done/error；Supervisor 路径全部）
                for event in &intermediate_events {
                    let event_name = executor_event_name(event);
                    emit_executor_event(
                        &event_bus,
                        &task_id,
                        event_name,
                        serde_json::to_value(event).unwrap_or_default(),
                    );
                }

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

// ── spawn 任务体执行路径 ──────────────────────────────────────────

/// task_runner 路径：通过 `execute_task_with_provider` 调用 LLM + 工具循环
///
/// 设计意图：替代占位 Supervisor，使 daemon 路径走真实灵枢路由 + 沙箱审计。
/// 当无可用 provider 时返回 Failed（与 sdk::execute_task 行为一致）。
async fn execute_via_task_runner(
    workdir: &std::path::Path,
    task: &sacode_kernel::Task,
    task_id: String,
    tools: ToolRegistry,
    started_at: Instant,
) -> (TaskResult, TaskRun, Vec<Event>) {
    let candidates = resolve_config_model_candidates(workdir);
    let provider = candidates.first().map(|(_, _, p)| p.clone());

    let Some(provider) = provider else {
        // 无可用 provider → 失败
        let error_msg = "无可用 provider，请先运行 sacode init 或 /login 配置";
        let duration_ms = started_at.elapsed().as_millis() as u64;
        let result = TaskResult::failure(task_id.clone(), error_msg.to_string(), duration_ms);
        let task_run = task_run_snapshot(
            Some(task_id.clone()),
            task.mode,
            task.prompt.clone(),
            TaskRunState::Failed,
            Some(error_msg.to_string()),
        );
        let events = vec![Event::Error {
            message: error_msg.to_string(),
        }];
        return (result, task_run, events);
    };

    // 构建 TaskRunConfig：使用 AutoApproveDecider + LoggingErrorRecorder
    // （daemon 路径无交互式审批，错误仅记日志）
    let config = TaskRunConfig {
        workdir,
        mode: task.mode,
        max_iterations: 3,
        system_prompt: String::new(),
        user_prompt: task.prompt.clone(),
        provider,
        tools,
        approval: Arc::new(AutoApproveDecider),
        error_recorder: Arc::new(LoggingErrorRecorder),
    };

    let run_result = execute_task_with_provider(&config, None).await;
    let duration_ms = started_at.elapsed().as_millis() as u64;

    // 提取摘要：成功取 response.ok，失败取 response.err
    let summary = run_result
        .response
        .as_ref()
        .ok()
        .cloned()
        .or_else(|| run_result.response.as_ref().err().cloned())
        .unwrap_or_else(|| "completed".to_string());
    let has_error = run_result.response.is_err();

    // 转换 TaskRunResult → TaskResult
    let result = if has_error {
        TaskResult::failure(task_id.clone(), summary.clone(), duration_ms)
    } else {
        TaskResult::success(task_id.clone(), summary.clone(), duration_ms)
    };

    // 复用 task_runner 内部生成的 task_run，仅覆盖 task_id（task_runner 内传 None）
    let mut task_run = run_result.task_run;
    task_run.task_id = Some(task_id.clone());

    // 中间事件：仅发送一个 done/error 作为终点标记
    // （task_runner 的中间 message/thinking/tool_call 事件未在 TaskExecutor 层暴露，
    //  这是 4.3 最小破坏下的取舍；后续如需细粒度事件可接入 stream_handler）
    let events = vec![if has_error {
        Event::Error {
            message: summary.clone(),
        }
    } else {
        Event::Done {
            summary: summary.clone(),
        }
    }];

    (result, task_run, events)
}

/// Supervisor 占位 fallback：保留向后兼容老测试（无 workdir 时使用）
///
/// 新代码应通过 `TaskExecutor::with_workdir` 启用 task_runner 路径。
#[allow(deprecated)]
fn execute_via_supervisor_fallback(
    task: &sacode_kernel::Task,
    task_id: String,
    started_at: Instant,
) -> (TaskResult, TaskRun, Vec<Event>) {
    let supervisor = Supervisor::new();
    let execution = supervisor.execute(task);

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

    let events = execution.output.events.clone();

    let result = if has_error {
        TaskResult::failure(task_id.clone(), summary.clone(), duration_ms)
    } else {
        TaskResult::success(task_id.clone(), summary.clone(), duration_ms)
    };

    let task_run = task_run_snapshot(
        Some(task_id.clone()),
        task.mode,
        task.prompt.clone(),
        if has_error {
            TaskRunState::Failed
        } else {
            TaskRunState::Completed
        },
        result.output.clone().or_else(|| result.error.clone()),
    );

    (result, task_run, events)
}
