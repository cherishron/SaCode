use std::{
    collections::{HashMap, VecDeque},
    sync::atomic::{AtomicU64, Ordering},
    sync::{Arc, Mutex as StdMutex},
};

use serde::{Deserialize, Serialize};
use tokio::sync::{broadcast, Mutex, RwLock};
use tracing::warn;

use crate::{
    executor::TaskExecutor, queue::TaskQueue, retry::RetryHandler, tools::ToolRegistry, StoreDb,
};
use sacode_kernel::{TaskQueueStatus, TaskResult, TaskRun};

use super::{
    parse_mode, status::sync_task_status_from_task_run, status::task_run_for_queue_status,
};

/// daemon 侧 broadcast 容量：提升到 256 以容纳多并发任务的事件突发，
/// 与 agents::message_bus 的 256 容量对齐，减少慢消费方触发 Lagged 的概率
pub const DAEMON_EVENT_BUS_CAPACITY: usize = 256;

/// 事件历史缓冲容量：供客户端断线重连时通过 Last-Event-ID 续传，
/// 256 条通常覆盖一个完整任务的生命周期事件
const EVENT_HISTORY_CAPACITY: usize = 256;

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

fn default_max_attempts() -> u32 {
    3
}
fn default_backoff_type() -> String {
    "exponential".to_string()
}
fn default_base_ms() -> u64 {
    1000
}
fn default_max_ms() -> u64 {
    30000
}

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
    pub fn new(
        task_id: String,
        prompt: String,
        mode: String,
        priority: String,
        max_attempts: u32,
    ) -> Self {
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

    pub fn restored(task: &sacode_kernel::ScheduledTask, queue_status: TaskQueueStatus) -> Self {
        Self {
            task_id: task.id.clone(),
            prompt: task.task.prompt.clone(),
            mode: task.task.mode.to_string(),
            status: queue_status.to_string(),
            queue_status: queue_status.to_string(),
            priority: task.priority.to_string(),
            progress: 0,
            total_steps: 0,
            current_event: Some("task_restored".to_string()),
            current_attempt: task.current_attempt,
            max_attempts: task.retry_policy.max_attempts,
            duration_ms: None,
            error: None,
            output: None,
            task_run: None,
        }
    }

    /// 从历史结果恢复任务状态：填充 output/error/duration_ms，
    /// 用于 daemon 重启后 `/task/:id/status` 对历史任务返回完整信息
    /// （含 prompt/mode/priority），而非仅靠 `queue.get_result` 的降级路径
    pub fn restored_with_result(task: &sacode_kernel::ScheduledTask, result: &TaskResult) -> Self {
        Self {
            task_id: result.task_id.clone(),
            prompt: task.task.prompt.clone(),
            mode: task.task.mode.to_string(),
            status: result.status.to_string(),
            queue_status: result.status.to_string(),
            priority: task.priority.to_string(),
            progress: 0,
            total_steps: 0,
            current_event: Some("task_restored".to_string()),
            current_attempt: task.current_attempt,
            max_attempts: task.retry_policy.max_attempts,
            duration_ms: Some(result.duration_ms),
            error: result.error.clone(),
            output: result.output.clone(),
            task_run: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StreamEvent {
    pub task_id: String,
    pub event_type: String,
    pub data: serde_json::Value,
    /// SSE 协议层事件序号，用于 Last-Event-ID 断线重连续传
    /// `#[serde(skip)]` 确保不污染 SSE `data` payload，仅作为 SSE `id` 字段下发
    #[serde(skip)]
    pub seq: Option<u64>,
}

pub struct DaemonState {
    pub event_bus: broadcast::Sender<StreamEvent>,
    /// 事件历史缓冲：供 SSE 客户端断线重连时通过 Last-Event-ID 续传，
    /// 避免任务执行中网络抖动导致端到端流式任务永久丢事件
    pub event_history: Arc<EventHistory>,
    pub tasks: RwLock<HashMap<String, TaskStatus>>,
    pub queue: Arc<TaskQueue>,
    pub executor: Mutex<TaskExecutor>,
    pub retry_handler: RetryHandler,
    /// 工作目录（用于 CheckpointStorage 按 task_id 恢复 checkpoint）
    ///
    /// daemon 启动时从 current_dir 获取，用于跨进程 checkpoint 查询。
    /// None 表示工作目录不可用（极端情况），checkpoint 相关端点将返回 not_found。
    pub workdir: Option<std::path::PathBuf>,
    /// 待审批请求映射：approval_id → PendingApproval
    ///
    /// 当 task_runner 返回 `pending_question`（含 tool_approval）时，
    /// executor 创建 oneshot channel，把 sender 存入此 map，receiver 在执行循环中等待。
    /// VSCode 扩展通过 POST /task/:id/approve 回传审批结果，解除阻塞。
    ///
    /// 以 approval_id 为键（而非 task_id），保证同一任务连续/并发的多个审批
    /// 不会互相覆盖；每次审批都有唯一 ID，迟到或重复响应无法批准下一次审批。
    pub pending_approvals: Mutex<HashMap<String, PendingApproval>>,
    /// daemon 可观测性指标（审批计数与等待时间；P2-3 将扩展 SSE 指标）
    pub metrics: Arc<DaemonMetrics>,
}

/// 审批回传结果
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ApprovalResolution {
    pub approved: bool,
    pub reason: Option<String>,
}

/// 一条待审批请求
#[derive(Debug)]
pub struct PendingApproval {
    /// 所属任务 ID
    pub task_id: String,
    /// 创建时间（用于超时判定）
    pub created_at: std::time::Instant,
    /// 待执行工具名（供 `GET /task/:id/approvals` 恢复展示）
    pub tool_name: String,
    /// 工具副作用级别（`SideEffectLevel` 的 Debug 字符串表示）
    pub side_effect_level: String,
    /// 工具参数（UI 在批准前应展示关键操作与目标）
    pub args: serde_json::Value,
    /// 本次审批最大等待时长
    pub timeout: std::time::Duration,
    /// 审批结果回传通道
    pub tx: tokio::sync::oneshot::Sender<ApprovalResolution>,
}

impl PendingApproval {
    /// 序列化为 `/task/:id/approvals` 响应条目
    ///
    /// `created_at` 是 `Instant`（单调时钟），无法直接序列化为墙钟时间；
    /// 这里返回相对 daemon 启动的等待秒数 `waited_secs`，客户端据此展示“已等待 N 秒”。
    pub fn to_json(&self, approval_id: &str) -> serde_json::Value {
        let waited_secs = self.created_at.elapsed().as_secs();
        let timeout_secs = self.timeout.as_secs();
        serde_json::json!({
            "approval_id": approval_id,
            "task_id": self.task_id,
            "tool_name": self.tool_name,
            "side_effect_level": self.side_effect_level,
            "args": self.args,
            "waited_secs": waited_secs,
            "timeout_secs": timeout_secs,
            "expires_in_secs": timeout_secs.saturating_sub(waited_secs),
        })
    }
}

/// 审批指标：请求、批准、拒绝、超时、取消计数与累计等待时间
///
/// 全部使用原子计数器，daemon 生命周期内累计；`/metrics` 端点返回快照。
/// `total_wait_ms` 仅在审批“已解决”（批准/拒绝/超时/取消）时累加，
/// 因此 `avg_wait_ms = total_wait_ms / resolved_total`，resolved_total 为
/// approved + denied + timed_out + cancelled。
#[derive(Debug, Default)]
pub struct ApprovalMetrics {
    pub requested: AtomicU64,
    pub approved: AtomicU64,
    pub denied: AtomicU64,
    pub timed_out: AtomicU64,
    pub cancelled: AtomicU64,
    pub total_wait_ms: AtomicU64,
}

impl ApprovalMetrics {
    pub fn snapshot(&self) -> serde_json::Value {
        let requested = self.requested.load(Ordering::Relaxed);
        let approved = self.approved.load(Ordering::Relaxed);
        let denied = self.denied.load(Ordering::Relaxed);
        let timed_out = self.timed_out.load(Ordering::Relaxed);
        let cancelled = self.cancelled.load(Ordering::Relaxed);
        let total_wait_ms = self.total_wait_ms.load(Ordering::Relaxed);
        let resolved = approved + denied + timed_out + cancelled;
        let avg_wait_ms = total_wait_ms.checked_div(resolved).unwrap_or(0);
        serde_json::json!({
            "requested": requested,
            "approved": approved,
            "denied": denied,
            "timed_out": timed_out,
            "cancelled": cancelled,
            "resolved": resolved,
            "total_wait_ms": total_wait_ms,
            "avg_wait_ms": avg_wait_ms,
        })
    }
}

/// daemon 级指标聚合；当前仅含审批指标，P2-3 将补充 SSE 指标
#[derive(Debug, Default)]
pub struct DaemonMetrics {
    pub approval: ApprovalMetrics,
}

impl DaemonMetrics {
    pub fn snapshot(&self) -> serde_json::Value {
        serde_json::json!({
            "approval": self.approval.snapshot(),
        })
    }
}

impl DaemonState {
    pub async fn new() -> Self {
        Self::new_with_workdir(None).await
    }

    /// 以显式工作目录构造 DaemonState
    ///
    /// `Some(dir)`：store 与 executor 都基于该目录（测试用独立临时目录，
    /// 避免并行测试共享 `.sacode/task-store.sqlite3` 导致 SQLite 写锁冲突）。
    /// `None`：从 current_dir 取，生产默认行为。
    pub async fn new_with_workdir(base_dir: Option<std::path::PathBuf>) -> Self {
        let (tx, _) = broadcast::channel(DAEMON_EVENT_BUS_CAPACITY);
        let mut queue_builder = TaskQueue::new(10);
        if let Some(dir) = base_dir.clone().or_else(|| std::env::current_dir().ok()) {
            match StoreDb::from_workspace(&dir) {
                Ok(store) => {
                    queue_builder = queue_builder.with_store(Arc::new(store));
                }
                Err(error) => {
                    warn!(?error, "failed to open task store; persistence disabled");
                }
            }
        }
        let queue = Arc::new(queue_builder);

        // 恢复待执行任务（pending/ready/running/retrying）到队列
        let restored_tasks = match queue.restore_pending_tasks().await {
            Ok(count) => count,
            Err(error) => {
                warn!(?error, "failed to restore pending tasks from store");
                0
            }
        };

        // 恢复历史结果（completed/failed）到内存 HashMap，
        // 使 `/task/:id/result`、`/task/:id/status` 对历史任务可用
        let restored_results = match queue.restore_results().await {
            Ok(entries) => entries,
            Err(error) => {
                warn!(?error, "failed to restore task results from store");
                Vec::new()
            }
        };

        let tools = ToolRegistry::builtin();

        // 路径分发：
        // - cfg(test)：不设 workdir，走 execute_test_placeholder（避免发起真实 LLM 调用）
        // - 生产：强制设 workdir，current_dir 失败则 panic（启动期致命错误，不应继续）
        let executor = if cfg!(test) {
            TaskExecutor::new(queue.clone(), tools.clone())
        } else {
            let dir = base_dir
                .clone()
                .or_else(|| std::env::current_dir().ok())
                .expect(
                    "daemon 启动时无法获取 current_dir，task_runner 路径无法工作；请检查运行环境",
                );
            TaskExecutor::new(queue.clone(), tools.clone()).with_workdir(dir)
        };
        let executor_event_bus = executor.event_bus();

        let retry_handler = RetryHandler::new(queue.clone(), executor_event_bus);

        let tasks = RwLock::new(HashMap::new());
        if restored_tasks > 0 {
            let mut restored_map = tasks.write().await;
            for task in queue.get_restorable_tasks().await {
                let queue_status = if task.dependencies.is_empty() {
                    TaskQueueStatus::Ready
                } else {
                    TaskQueueStatus::Pending
                };
                restored_map.insert(task.id.clone(), TaskStatus::restored(&task, queue_status));
            }
        }

        // 历史结果填入 tasks 状态表，让 `/task/:id/status` 返回完整信息
        // （含 prompt/mode/priority），而非仅靠 queue.get_result 的降级路径
        if !restored_results.is_empty() {
            let mut restored_map = tasks.write().await;
            for (task, result) in restored_results {
                restored_map.insert(
                    result.task_id.clone(),
                    TaskStatus::restored_with_result(&task, &result),
                );
            }
        }

        Self {
            event_bus: tx,
            event_history: Arc::new(EventHistory::new(EVENT_HISTORY_CAPACITY)),
            tasks,
            queue,
            executor: Mutex::new(executor),
            retry_handler,
            workdir: base_dir.clone().or_else(|| std::env::current_dir().ok()),
            pending_approvals: Mutex::new(HashMap::new()),
            metrics: Arc::new(DaemonMetrics::default()),
        }
    }

    /// 列出指定任务当前待审批条目（用于 `GET /task/:id/approvals`）
    ///
    /// 返回按 approval_id 排序的 JSON 数组，保证输出稳定、便于测试与客户端去重。
    pub async fn list_pending_approvals(&self, task_id: &str) -> Vec<serde_json::Value> {
        let pending = self.pending_approvals.lock().await;
        let mut entries: Vec<(String, serde_json::Value)> = pending
            .iter()
            .filter(|(_, entry)| entry.task_id == task_id)
            .map(|(approval_id, entry)| (approval_id.clone(), entry.to_json(approval_id)))
            .collect();
        entries.sort_by(|a, b| a.0.cmp(&b.0));
        entries.into_iter().map(|(_, value)| value).collect()
    }

    /// 清理指定任务的待审批条目
    ///
    /// 返回清理数量。当前任务被 cancel 时调用：
    /// 条目被 drop → tx sender 关闭 → 异步等待中的 decider 立即返回 Denied，
    /// 并发出 reason=cancelled 的 approval_resolved 事件。
    pub async fn clear_pending_approvals_for_task(&self, task_id: &str) -> usize {
        let mut pending = self.pending_approvals.lock().await;
        let keys: Vec<String> = pending
            .iter()
            .filter(|(_, entry)| entry.task_id == task_id)
            .map(|(key, _)| key.clone())
            .collect();
        let count = keys.len();
        for key in keys {
            pending.remove(&key);
        }
        count
    }
}

/// 事件历史缓冲：环形缓冲最近 N 条 StreamEvent 及其递增 seq
///
/// 设计目标：让 SSE 客户端断线重连时能通过 Last-Event-ID 续传丢失的事件，
/// 而不是只能从头等待新事件。配合 broadcast Lagged 提示事件形成完整的端到端流式任务稳定性保障：
/// - 正常情况：客户端从 live broadcast 实时接收
/// - 网络抖动/重连：客户端携带 Last-Event-ID，服务端先回放 history 中 seq > last 的事件，再切到 live
/// - broadcast 溢出：lagged 提示事件让客户端知道需要补偿拉取
///
/// 线程安全：`AtomicU64` 提供无锁 seq 分配，`StdMutex` 保护 VecDeque，
/// 可在同步上下文（如 `emit_event`）中调用
pub struct EventHistory {
    seq: AtomicU64,
    buffer: StdMutex<VecDeque<(u64, StreamEvent)>>,
    capacity: usize,
}

impl EventHistory {
    pub fn new(capacity: usize) -> Self {
        Self {
            seq: AtomicU64::new(0),
            buffer: StdMutex::new(VecDeque::with_capacity(capacity)),
            capacity,
        }
    }

    /// 写入一条事件，返回分配的递增 seq；同时写入缓冲供后续重连回放
    /// 传入 `&mut` 以便调用方在 push 后保留 ownership 继续用于 broadcast send
    pub fn push(&self, evt: &mut StreamEvent) -> u64 {
        let seq = self.seq.fetch_add(1, Ordering::Relaxed) + 1;
        evt.seq = Some(seq);
        let mut buf = self.buffer.lock().expect("event history mutex poisoned");
        buf.push_back((seq, evt.clone()));
        while buf.len() > self.capacity {
            buf.pop_front();
        }
        seq
    }

    /// 回放 seq > `last_seq` 的所有历史事件（按 seq 升序）
    /// `last_seq` 来自客户端 Last-Event-ID header
    pub fn replay_after(&self, last_seq: u64) -> Vec<(u64, StreamEvent)> {
        let buf = self.buffer.lock().expect("event history mutex poisoned");
        buf.iter().filter(|(s, _)| *s > last_seq).cloned().collect()
    }

    /// 当前已分配的最大 seq，用于判断是否有可回放的历史
    pub fn current_seq(&self) -> u64 {
        self.seq.load(Ordering::Relaxed)
    }
}
