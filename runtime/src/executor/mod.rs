pub mod task_runner;

use std::path::PathBuf;
use std::sync::Arc;
use std::time::{Duration, Instant};

use sacode_kernel::{Event, TaskQueueStatus, TaskResult, TaskRun};
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
    /// 未设置则走测试占位路径（仅 cfg(test) 启用，避免发起真实 LLM 调用）
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
    /// 调用 `execute_task_with_provider` 替代静态占位
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

                // 路径分发：workdir 设置走 task_runner（生产路径），
                // 未设置走 test_placeholder（仅 cfg(test)，避免发起真实 LLM 调用）
                let (result, task_run, intermediate_events) = match workdir {
                    Some(workdir) => {
                        execute_via_task_runner(
                            &workdir,
                            &task.task,
                            task_id.clone(),
                            tools,
                            started_at,
                            Some(&event_bus),
                        )
                        .await
                    }
                    None => execute_test_placeholder(&task.task, task_id.clone(), started_at),
                };

                // 发送中间事件（task_runner 路径仅 1 个 done/error；test_placeholder 路径全部）
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

/// 把 task_runner 内部的 token 级增量转发到 executor event_bus 的 StreamHandler。
///
/// 解决闭包实现 `FnMut(StreamEventKind, &str) + Send + 'static` 时遇到的
/// HRTB 推断失败问题：`&str` 生命周期无法泛化为任意生命周期，
/// 用具名结构体显式实现 trait 绕过。
struct EventBusStreamHandler {
    event_bus: broadcast::Sender<ExecutorEvent>,
    task_id: String,
}

impl task_runner::StreamHandler for EventBusStreamHandler {
    fn handle(&mut self, kind: task_runner::StreamEventKind, content: &str) {
        let event_name = match kind {
            task_runner::StreamEventKind::Message => "message",
            task_runner::StreamEventKind::Thinking => "thinking",
        };
        let _ = self.event_bus.send(ExecutorEvent {
            task_id: self.task_id.clone(),
            event_type: event_name.to_string(),
            data: serde_json::json!({ "content": content }),
        });
    }
}

/// task_runner 路径：通过 `execute_task_with_provider` 调用 LLM + 工具循环
///
/// 设计意图：替代静态占位，使 daemon 路径走真实灵枢路由 + 沙箱审计。
/// 当无可用 provider 时返回 Failed（与 sdk::execute_task 行为一致）。
///
/// `event_bus` 非空时注入 StreamHandler，把 task_runner 内部的 token 级增量
/// （message/thinking）实时转发到 daemon SSE，消除"daemon SSE 只能收到粗粒度
/// 事件"的体验差距。None 时退化为原行为（仅终点 done/error 事件）。
async fn execute_via_task_runner(
    workdir: &std::path::Path,
    task: &sacode_kernel::Task,
    task_id: String,
    tools: ToolRegistry,
    started_at: Instant,
    event_bus: Option<&broadcast::Sender<ExecutorEvent>>,
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
        task_id: Some(task_id.clone()),
    };

    // 注入 StreamHandler：把 task_runner 内部 token 级增量转发到 event_bus，
    // 再由 daemon 的 spawn_executor_event_forwarder 转发到 SSE 客户端。
    // event_bus 为 None 时退化为无流式（保留向后兼容）。
    let stream_handler: Option<Box<dyn task_runner::StreamHandler>> = event_bus.map(|bus| {
        Box::new(EventBusStreamHandler {
            event_bus: bus.clone(),
            task_id: task_id.clone(),
        }) as Box<dyn task_runner::StreamHandler>
    });

    let run_result = execute_task_with_provider(&config, stream_handler).await;
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

    // 终点事件：done/error 作为任务结束标记
    // （中间事件已在执行过程中通过 StreamHandler 实时转发到 event_bus）
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

/// 测试占位执行路径：不调用 LLM，直接返回占位消息
///
/// 仅 `workdir=None` 时调用，用于 daemon_queue 等集成测试避免发起真实 LLM 调用。
/// 生产路径必须通过 `TaskExecutor::with_workdir` 设置 workdir 走 task_runner，
/// 此函数在生产构建中虽被链接但永不执行（workdir 总是 Some）。
#[allow(dead_code)]
fn execute_test_placeholder(
    task: &sacode_kernel::Task,
    task_id: String,
    started_at: Instant,
) -> (TaskResult, TaskRun, Vec<Event>) {
    let duration_ms = started_at.elapsed().as_millis() as u64;

    // 生成简化的静态事件（不依赖 deprecated 结构）
    let events = vec![
        Event::message(format!("收到任务：{}", task.prompt)),
        Event::done(format!(
            "测试占位完成（mode={:?}，未调用 LLM，生产路径应通过 with_workdir 启用 task_runner）",
            task.mode
        )),
    ];

    let summary = events
        .iter()
        .rev()
        .find_map(|e| match e {
            Event::Done { summary } => Some(summary.clone()),
            Event::Error { message } => Some(message.clone()),
            _ => None,
        })
        .unwrap_or_else(|| "completed".to_string());

    let result = TaskResult::success(task_id.clone(), summary.clone(), duration_ms);

    let task_run = task_run_snapshot(
        Some(task_id.clone()),
        task.mode,
        task.prompt.clone(),
        TaskRunState::Completed,
        Some(result.output.clone().unwrap_or_default()),
    );

    (result, task_run, events)
}
