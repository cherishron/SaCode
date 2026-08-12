//! 灵枢 · 自组织 — 子 Agent 间通信机制
//!
//! 设计目标：
//! - 支持子 Agent 间通过消息传递进行协同
//! - 广播消息：一个 Agent 向同组所有 Agent 发送
//! - 直接消息：一个 Agent 向指定 Agent 发送
//! - 消息持久化：在 WorkerRunResult 中记录通信历史
//!
//! 与竞品对比：
//! - Claude Code Agent Teams：子Agent间通过共享任务列表 + 双向消息通信
//! - Codex CLI：spawn_agent/wait_agent/send_input/close_agent 四原语
//! - SaCode：MessageBus + 广播/直接消息 + 编排器集成
//!
//! 架构设计：
//! - MessageBus：全局消息总线，基于 tokio broadcast + mpsc
//! - AgentMailboxHandle：每个子Agent的邮箱句柄，接收定向消息
//! - 编排器集成：在 execute_parallel_groups 中注入 MessageBus

use std::collections::{HashMap, VecDeque};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

use tokio::sync::{broadcast, mpsc, RwLock};

/// 全局消息序号：避免同一 Agent 在 1ms 内并发发送多条消息时 `message_id` 撞车
/// （毫秒级时间戳不足以唯一定位，撞车会导致 `request_and_wait` 的 reply_to 引用链
/// 错配）。进程内单调递增，配合 `from` + `timestamp` 构成全局唯一消息 ID。
static MESSAGE_SEQ: AtomicU64 = AtomicU64::new(0);

/// 反序列化兜底：为旧版持久化历史（`.sacode/agent-messages.json`）中缺 `id`
/// 字段的消息分配一个进程内唯一的占位 ID，保证 [`AgentMessage::id`] 始终可定位。
fn default_message_id() -> String {
    let seq = MESSAGE_SEQ.fetch_add(1, Ordering::Relaxed);
    format!("loaded-{}", seq)
}

/// 任务状态 — 用于结构化消息协议中的任务生命周期追踪
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TaskState {
    /// 待处理
    Pending,
    /// 执行中
    Running,
    /// 阻塞（等待外部输入/协助）
    Blocked,
    /// 完成
    Done,
    /// 失败
    Failed,
}

impl Default for TaskState {
    fn default() -> Self {
        TaskState::Pending
    }
}

/// 消息优先级
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MessagePriority {
    /// 低优先级
    Low,
    /// 普通优先级
    Normal,
    /// 高优先级（如冲突干预、修复请求）
    High,
}

impl Default for MessagePriority {
    fn default() -> Self {
        MessagePriority::Normal
    }
}

/// Agent 间通信消息
///
/// 灵枢 · Agent 协作协议升级（M2）：扩展结构化字段支持双向协作
/// - `task_state`：任务生命周期状态枚举
/// - `priority`：消息优先级（高优先级用于冲突干预/修复请求）
/// - `reply_to`：引用链，指向被回复的消息 ID（None 表示新消息）
/// - `deadline`：消息处理截止时间（毫秒级 Unix 时间，None 表示无期限）
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct AgentMessage {
    /// 发送者 Agent ID
    pub from: String,
    /// 接收者 Agent ID（None 表示广播）
    pub to: Option<String>,
    /// 消息类型
    pub kind: AgentMessageKind,
    /// 消息内容
    pub content: String,
    /// 时间戳（毫秒级 Unix 时间）
    pub timestamp: u64,
    /// 消息唯一 ID（构造时一次性分配，用于 reply_to 引用链）
    #[serde(default = "default_message_id")]
    pub id: String,
    /// 任务状态（新增）
    #[serde(default)]
    pub task_state: TaskState,
    /// 消息优先级（新增）
    #[serde(default)]
    pub priority: MessagePriority,
    /// 引用链：指向被回复的消息 ID（新增）
    #[serde(default)]
    pub reply_to: Option<String>,
    /// 处理截止时间（毫秒级 Unix 时间，None 表示无期限）（新增）
    #[serde(default)]
    pub deadline: Option<u64>,
}

impl AgentMessage {
    /// 分配一个全局唯一消息 ID：格式 `{from}-{timestamp}-{seq}`，
    /// `seq` 取自进程内单调递增原子计数器（见 [`MESSAGE_SEQ`]），保证同一
    /// Agent 在任意时刻发送的消息 ID 不撞车（毫秒级时间戳单独不足以唯一定位）。
    fn alloc_message_id(from: &str, timestamp: u64) -> String {
        let seq = MESSAGE_SEQ.fetch_add(1, Ordering::Relaxed);
        format!("{}-{}-{}", from, timestamp, seq)
    }

    /// 构造基础消息（含向后兼容的默认协议字段）
    pub fn new(from: String, to: Option<String>, kind: AgentMessageKind, content: String) -> Self {
        let timestamp = current_timestamp_ms();
        let id = Self::alloc_message_id(&from, timestamp);
        Self {
            from,
            to,
            kind,
            content,
            timestamp,
            id,
            task_state: TaskState::Pending,
            priority: MessagePriority::Normal,
            reply_to: None,
            deadline: None,
        }
    }

    /// 返回消息唯一 ID（用于 reply_to 引用链）
    ///
    /// 直接返回构造时一次性分配的 [`AgentMessage::id`]，保证对同一条消息
    /// 多次调用返回值稳定（reply_to 引用链依赖此稳定性，不可每次调用重算）。
    pub fn message_id(&self) -> String {
        self.id.clone()
    }
}

/// 消息类型
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq, Eq)]
pub enum AgentMessageKind {
    /// 发现共享：Agent 发现了其他 Agent 可能需要的信息
    Discovery,
    /// 请求协助：Agent 需要其他 Agent 的输入
    RequestAssist,
    /// 协助响应：对请求协助的回复
    AssistResponse,
    /// 冲突预警：Agent 检测到潜在的冲突
    ConflictWarning,
    /// 进度同步：Agent 同步自己的执行进度
    ProgressSync,
    /// 子任务委派：将子任务交给目标 Agent 处理
    TaskDelegate,
    /// 任务结果回报：子任务处理完成的结果回传
    TaskResult,
    /// 冲突干预请求：请求编排器/其他 Agent 介入处置冲突
    InterventionRequest,
    /// 自定义消息
    Custom(String),
}

impl AgentMessageKind {
    pub fn as_str(&self) -> &str {
        match self {
            Self::Discovery => "discovery",
            Self::RequestAssist => "request_assist",
            Self::AssistResponse => "assist_response",
            Self::ConflictWarning => "conflict_warning",
            Self::ProgressSync => "progress_sync",
            Self::TaskDelegate => "task_delegate",
            Self::TaskResult => "task_result",
            Self::InterventionRequest => "intervention_request",
            Self::Custom(name) => name,
        }
    }
}

/// Agent 邮箱句柄：用于接收和发送消息
///
/// 设计说明：原本设计的 `AgentMailbox` 直接持有 `mpsc::UnboundedReceiver`，
/// 但 `UnboundedReceiver` 不实现 `Clone`，无法满足多消费者场景。
/// 当前实现改用 `Arc<tokio::sync::Mutex<UnboundedReceiver>>` 包装的
/// [`AgentMailboxHandle`]，提供安全的共享访问。
///
/// 消息总线：支持广播和直接消息
pub struct MessageBus {
    /// 广播通道发送端
    broadcast_tx: broadcast::Sender<AgentMessage>,
    /// 各 Agent 的直接消息通道
    mailboxes: Arc<RwLock<HashMap<String, mpsc::UnboundedSender<AgentMessage>>>>,
    /// 消息历史（用于审计和结果记录）
    history: Arc<RwLock<Vec<AgentMessage>>>,
    /// 已注册的 Agent ID 列表
    registered_agents: Arc<RwLock<Vec<String>>>,
}

impl MessageBus {
    /// 创建新的消息总线
    pub fn new() -> Self {
        let (broadcast_tx, _) = broadcast::channel(256);
        Self {
            broadcast_tx,
            mailboxes: Arc::new(RwLock::new(HashMap::new())),
            history: Arc::new(RwLock::new(Vec::new())),
            registered_agents: Arc::new(RwLock::new(Vec::new())),
        }
    }

    /// 注册 Agent 到消息总线，返回邮箱
    pub async fn register(&self, agent_id: String) -> AgentMailboxHandle {
        let (tx, rx) = mpsc::unbounded_channel();

        {
            let mut mailboxes = self.mailboxes.write().await;
            mailboxes.insert(agent_id.clone(), tx);
        }
        {
            let mut agents = self.registered_agents.write().await;
            if !agents.contains(&agent_id) {
                agents.push(agent_id.clone());
            }
        }

        AgentMailboxHandle {
            agent_id: agent_id.clone(),
            receiver: Arc::new(tokio::sync::Mutex::new(rx)),
            pending: Arc::new(tokio::sync::Mutex::new(VecDeque::new())),
            broadcast_rx: self.broadcast_tx.subscribe(),
            mailboxes: self.mailboxes.clone(),
            history: self.history.clone(),
            broadcast_tx: self.broadcast_tx.clone(),
        }
    }

    /// 广播消息给所有 Agent
    pub async fn broadcast(&self, from: &str, kind: AgentMessageKind, content: String) {
        let msg = AgentMessage::new(from.to_string(), None, kind, content);

        // 记录到历史
        {
            let mut history = self.history.write().await;
            history.push(msg.clone());
        }

        // 广播
        let _ = self.broadcast_tx.send(msg);
    }

    /// 将消息历史持久化到 .sacode/agent-messages.json
    ///
    /// 支持跨编排轮次复用通信上下文（M2 持久化要求）
    pub async fn persist_history(&self, workdir: &std::path::Path) {
        let history = self.history.read().await;
        if history.is_empty() {
            return;
        }
        let sacode_dir = workdir.join(".sacode");
        if let Err(error) = std::fs::create_dir_all(&sacode_dir) {
            tracing::warn!("创建 .sacode 目录失败：{}", error);
            return;
        }
        let path = sacode_dir.join("agent-messages.json");
        match serde_json::to_string_pretty(&*history) {
            Ok(json) => {
                if let Err(error) = std::fs::write(&path, json) {
                    tracing::warn!("持久化 agent-messages.json 失败：{}", error);
                }
            }
            Err(error) => tracing::warn!("序列化 agent-messages.json 失败：{}", error),
        }
    }

    /// 从 .sacode/agent-messages.json 加载历史消息并追加（跨编排轮次复用）
    pub async fn load_history(&self, workdir: &std::path::Path) {
        let path = workdir.join(".sacode").join("agent-messages.json");
        if !path.exists() {
            return;
        }
        let content = match std::fs::read_to_string(&path) {
            Ok(content) => content,
            Err(_) => return,
        };
        let loaded: Vec<AgentMessage> = match serde_json::from_str(&content) {
            Ok(loaded) => loaded,
            Err(error) => {
                tracing::warn!("解析 agent-messages.json 失败：{}", error);
                return;
            }
        };
        let mut history = self.history.write().await;
        history.extend(loaded);
    }

    /// 获取所有已注册的 Agent ID
    pub async fn registered_agents(&self) -> Vec<String> {
        self.registered_agents.read().await.clone()
    }

    /// 获取消息历史
    pub async fn message_history(&self) -> Vec<AgentMessage> {
        self.history.read().await.clone()
    }

    /// 获取指定 Agent 的消息历史
    pub async fn messages_for(&self, agent_id: &str) -> Vec<AgentMessage> {
        let history = self.history.read().await;
        history
            .iter()
            .filter(|msg| msg.to.as_deref() == Some(agent_id) || msg.to.is_none())
            .cloned()
            .collect()
    }
}

impl Default for MessageBus {
    fn default() -> Self {
        Self::new()
    }
}

/// Agent 邮箱句柄：用于接收和发送消息
pub struct AgentMailboxHandle {
    /// Agent ID
    pub agent_id: String,
    /// 直接消息接收端
    receiver: Arc<tokio::sync::Mutex<mpsc::UnboundedReceiver<AgentMessage>>>,
    /// 本地 pending 队列：在 `request_and_wait` 中被取出但不匹配当前请求、
    /// 且不属于本 Agent 入站的消息，留待下次 `try_recv_direct` / `request_and_wait`
    /// 优先消费（避免被错误 re-send 给目标 Agent 造成错投或丢失）。
    pending: Arc<tokio::sync::Mutex<VecDeque<AgentMessage>>>,
    /// 广播消息接收端
    broadcast_rx: broadcast::Receiver<AgentMessage>,
    /// 其他 Agent 的邮箱（用于直接发送）
    mailboxes: Arc<RwLock<HashMap<String, mpsc::UnboundedSender<AgentMessage>>>>,
    /// 消息历史
    history: Arc<RwLock<Vec<AgentMessage>>>,
    /// 广播发送端
    broadcast_tx: broadcast::Sender<AgentMessage>,
}

impl AgentMailboxHandle {
    /// 发送直接消息给指定 Agent（使用默认协议字段）
    pub async fn send_to(&self, to: &str, kind: AgentMessageKind, content: String) -> bool {
        let msg = AgentMessage::new(self.agent_id.clone(), Some(to.to_string()), kind, content);

        // 记录到历史
        {
            let mut history = self.history.write().await;
            history.push(msg.clone());
        }

        // 发送到目标邮箱
        let mailboxes = self.mailboxes.read().await;
        if let Some(sender) = mailboxes.get(to) {
            sender.send(msg).is_ok()
        } else {
            false
        }
    }

    /// 发送结构化直接消息（携带任务状态/优先级/引用链/截止时间）
    pub async fn send_structured(
        &self,
        to: &str,
        kind: AgentMessageKind,
        content: String,
        task_state: TaskState,
        priority: MessagePriority,
        reply_to: Option<String>,
        deadline: Option<u64>,
    ) -> bool {
        let mut msg = AgentMessage::new(self.agent_id.clone(), Some(to.to_string()), kind, content);
        msg.task_state = task_state;
        msg.priority = priority;
        msg.reply_to = reply_to;
        msg.deadline = deadline;

        {
            let mut history = self.history.write().await;
            history.push(msg.clone());
        }

        let mailboxes = self.mailboxes.read().await;
        if let Some(sender) = mailboxes.get(to) {
            sender.send(msg).is_ok()
        } else {
            false
        }
    }

    /// 广播消息给所有 Agent
    pub async fn broadcast(&self, kind: AgentMessageKind, content: String) {
        let msg = AgentMessage::new(self.agent_id.clone(), None, kind, content);

        // 记录到历史
        {
            let mut history = self.history.write().await;
            history.push(msg.clone());
        }

        let _ = self.broadcast_tx.send(msg);
    }

    /// 尝试接收直接消息（非阻塞）
    ///
    /// 优先消费本地 `pending` 队列中的消息（由 `request_and_wait` 取出但不匹配
    /// 当前请求的入站消息），再尝试从 receiver 直接取。
    pub async fn try_recv_direct(&self) -> Option<AgentMessage> {
        {
            let mut pending = self.pending.lock().await;
            if let Some(msg) = pending.pop_front() {
                return Some(msg);
            }
        }
        let mut receiver = self.receiver.lock().await;
        receiver.try_recv().ok()
    }

    /// 双向通信：发送协助请求并阻塞等待响应（带超时）
    ///
    /// 灵枢 · Agent 协作协议升级（M2）：将单向 fire-and-forget 升级为
    /// 请求-响应模型。发送方发送 `RequestAssist` 消息后，阻塞等待目标 Agent
    /// 通过 `send_structured(..., reply_to=msg_id)` 回应的消息。
    ///
    /// 死锁防护：由调用方保证请求图无环（worker.rs 中 DAG 检测），
    /// 本方法仅提供基于超时的等待兜底（默认 30s）。
    pub async fn request_and_wait(
        &self,
        target: &str,
        content: &str,
        timeout: Duration,
    ) -> Result<AgentMessage, WaitTimeoutError> {
        // 发送请求（标记 Blocked 状态 + High 优先级）
        let request_msg = AgentMessage::new(
            self.agent_id.clone(),
            Some(target.to_string()),
            AgentMessageKind::RequestAssist,
            content.to_string(),
        );
        let request_id = request_msg.message_id();

        {
            let mut history = self.history.write().await;
            history.push(request_msg.clone());
        }

        let mailboxes = self.mailboxes.read().await;
        let target_sender = mailboxes.get(target).cloned();
        drop(mailboxes);
        let Some(sender) = target_sender else {
            return Err(WaitTimeoutError::TargetUnavailable(target.to_string()));
        };
        if sender.send(request_msg).is_err() {
            return Err(WaitTimeoutError::TargetUnavailable(target.to_string()));
        }

        // 阻塞等待响应：循环检查 receiver 中是否有 reply_to == request_id 的消息
        let deadline = Instant::now() + timeout;
        const MAX_BATCH: usize = 64; // 单次持锁最多处理的消息数，避免长持锁饿死其他接收者
        loop {
            if Instant::now() >= deadline {
                return Err(WaitTimeoutError::Timeout(request_id));
            }
            // 短暂让出，避免忙等
            tokio::time::sleep(Duration::from_millis(50)).await;

            // 优先消费上一轮缓冲到本地 pending 队列的入站消息（其余请求的响应或广播）
            {
                let mut pending = self.pending.lock().await;
                while let Some(msg) = pending.pop_front() {
                    if msg.reply_to.as_deref() == Some(request_id.as_str()) {
                        return Ok(msg);
                    }
                    // 仍不匹配本请求：放回尾部，下一轮继续检查
                    pending.push_back(msg);
                    break;
                }
            }

            let mut receiver = self.receiver.lock().await;
            let mut unmatched: VecDeque<AgentMessage> = VecDeque::new();
            let mut matched: Option<AgentMessage> = None;
            for _ in 0..MAX_BATCH {
                match receiver.try_recv() {
                    Ok(msg) => {
                        if msg.reply_to.as_deref() == Some(request_id.as_str()) {
                            matched = Some(msg);
                            break;
                        }
                        unmatched.push_back(msg);
                    }
                    Err(_) => break,
                }
            }
            drop(receiver);

            if let Some(response) = matched {
                // 把本轮未匹配的消息并入本地 pending（下次 try_recv_direct /
                // request_and_wait 优先消费），不再错误地 re-send 给目标 Agent。
                if !unmatched.is_empty() {
                    let mut pending = self.pending.lock().await;
                    pending.extend(unmatched);
                }
                return Ok(response);
            }

            // 未匹配的消息缓冲到本地 pending，并在循环末尾让出，避免长持锁
            if !unmatched.is_empty() {
                let mut pending = self.pending.lock().await;
                pending.extend(unmatched);
            }
            tokio::task::yield_now().await;
        }
    }

    /// 接收所有待处理的广播消息（非阻塞）
    pub async fn try_recv_broadcast(&mut self) -> Vec<AgentMessage> {
        let mut messages = Vec::new();
        loop {
            match self.broadcast_rx.try_recv() {
                Ok(msg) => {
                    // 过滤掉自己发出的广播
                    if msg.from != self.agent_id {
                        messages.push(msg);
                    }
                }
                Err(broadcast::error::TryRecvError::Empty) => break,
                Err(broadcast::error::TryRecvError::Lagged(n)) => {
                    tracing::warn!(
                        "Agent [{}] 广播消息落后 {} 条",
                        self.agent_id,
                        n
                    );
                    continue;
                }
                Err(broadcast::error::TryRecvError::Closed) => break,
            }
        }
        messages
    }

    /// 接收所有待处理消息（直接 + 广播）
    pub async fn try_recv_all(&mut self) -> Vec<AgentMessage> {
        let mut messages = Vec::new();

        // 直接消息
        while let Some(msg) = self.try_recv_direct().await {
            messages.push(msg);
        }

        // 广播消息
        messages.extend(self.try_recv_broadcast().await);

        // 按时间戳排序
        messages.sort_by_key(|msg| msg.timestamp);

        messages
    }
}

/// 等待响应超时/错误类型
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum WaitTimeoutError {
    /// 目标 Agent 不可用（邮箱未注册）
    TargetUnavailable(String),
    /// 等待响应超时（携带请求消息 ID）
    Timeout(String),
}

impl std::fmt::Display for WaitTimeoutError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::TargetUnavailable(target) => {
                write!(f, "目标 Agent [{}] 不可用，无法发送协助请求", target)
            }
            Self::Timeout(request_id) => {
                write!(f, "等待协助响应超时（请求 ID: {}）", request_id)
            }
        }
    }
}

impl std::error::Error for WaitTimeoutError {}

/// 获取当前毫秒级时间戳
fn current_timestamp_ms() -> u64 {
    use std::time::SystemTime;
    use std::time::UNIX_EPOCH;

    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// 通信摘要：用于在 WorkerRunResult 中记录通信历史
#[derive(Debug, Clone, serde::Serialize)]
pub struct CommunicationSummary {
    /// 该 Agent 发送的消息数
    pub sent_count: usize,
    /// 该 Agent 接收的消息数
    pub received_count: usize,
    /// 消息摘要列表
    pub messages: Vec<CommunicationEntry>,
}

/// 通信条目摘要
#[derive(Debug, Clone, serde::Serialize)]
pub struct CommunicationEntry {
    pub from: String,
    pub to: Option<String>,
    pub kind: String,
    pub content_preview: String,
}

/// 从消息历史构建通信摘要
pub fn build_communication_summary(
    history: &[AgentMessage],
    agent_id: &str,
) -> CommunicationSummary {
    let mut sent_count = 0usize;
    let mut received_count = 0usize;
    let mut messages = Vec::new();

    for msg in history {
        let is_sender = msg.from == agent_id;
        let is_receiver = msg.to.as_deref() == Some(agent_id) || msg.to.is_none();

        if is_sender {
            sent_count += 1;
        }
        if is_receiver && !is_sender {
            received_count += 1;
        }

        // 只记录与该 Agent 相关的消息
        if is_sender || is_receiver {
            messages.push(CommunicationEntry {
                from: msg.from.clone(),
                to: msg.to.clone(),
                kind: msg.kind.as_str().to_string(),
                content_preview: truncate_str(&msg.content, 100),
            });
        }
    }

    CommunicationSummary {
        sent_count,
        received_count,
        messages,
    }
}

fn truncate_str(s: &str, max: usize) -> String {
    if s.len() <= max {
        s.to_string()
    } else {
        let end = s.char_indices().take(max).last().map(|(i, _)| i).unwrap_or(s.len());
        format!("{}...", &s[..end])
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn message_bus_register_and_broadcast() {
        let bus = MessageBus::new();
        let mut handle_a = bus.register("agent-a".to_string()).await;
        let _handle_b = bus.register("agent-b".to_string()).await;

        bus.broadcast("agent-a", AgentMessageKind::Discovery, "found auth module".to_string())
            .await;

        let messages = handle_a.try_recv_broadcast().await;
        // agent-a 不应收到自己发出的广播
        assert!(messages.is_empty(), "不应收到自己发出的广播");

        let agents = bus.registered_agents().await;
        assert!(agents.contains(&"agent-a".to_string()));
        assert!(agents.contains(&"agent-b".to_string()));
    }

    #[tokio::test]
    async fn message_bus_direct_message() {
        let bus = MessageBus::new();
        let handle_a = bus.register("agent-a".to_string()).await;
        let handle_b = bus.register("agent-b".to_string()).await;

        // agent-a 向 agent-b 发送直接消息
        let sent = handle_a
            .send_to(
                "agent-b",
                AgentMessageKind::RequestAssist,
                "need help with auth".to_string(),
            )
            .await;
        assert!(sent, "直接消息应发送成功");

        // agent-b 应收到消息
        let messages = handle_b.try_recv_direct().await;
        assert!(messages.is_some(), "应收到一条直接消息");
        let msg = messages.unwrap();
        assert_eq!(msg.from, "agent-a");
        assert_eq!(msg.kind, AgentMessageKind::RequestAssist);
    }

    #[tokio::test]
    async fn message_bus_history() {
        let bus = MessageBus::new();
        let handle_a = bus.register("agent-a".to_string()).await;
        let _handle_b = bus.register("agent-b".to_string()).await;

        handle_a
            .send_to(
                "agent-b",
                AgentMessageKind::Discovery,
                "found database module".to_string(),
            )
            .await;

        handle_a
            .broadcast(
                AgentMessageKind::ProgressSync,
                "50% complete".to_string(),
            )
            .await;

        let history = bus.message_history().await;
        assert_eq!(history.len(), 2);
    }

    #[test]
    fn communication_summary_builds_correctly() {
        let history = vec![
            AgentMessage::new(
                "agent-a".to_string(),
                Some("agent-b".to_string()),
                AgentMessageKind::Discovery,
                "found auth module".to_string(),
            ),
            AgentMessage::new(
                "agent-b".to_string(),
                Some("agent-a".to_string()),
                AgentMessageKind::AssistResponse,
                "auth module is at src/auth.rs".to_string(),
            ),
            AgentMessage::new(
                "agent-a".to_string(),
                None,
                AgentMessageKind::ProgressSync,
                "50% complete".to_string(),
            ),
        ];

        let summary = build_communication_summary(&history, "agent-a");
        assert_eq!(summary.sent_count, 2); // 发出 discovery + progress
        assert_eq!(summary.received_count, 1); // 收到 assist_response
        assert_eq!(summary.messages.len(), 3);
    }

    #[test]
    fn agent_message_kind_as_str() {
        assert_eq!(AgentMessageKind::Discovery.as_str(), "discovery");
        assert_eq!(AgentMessageKind::RequestAssist.as_str(), "request_assist");
        assert_eq!(AgentMessageKind::Custom("review".to_string()).as_str(), "review");
    }

    // ── M2 协议升级测试 ──────────────────────────────────

    #[test]
    fn agent_message_new_sets_default_protocol_fields() {
        // 新增协议字段应有合理默认值（向后兼容）
        let msg = AgentMessage::new(
            "agent-a".to_string(),
            Some("agent-b".to_string()),
            AgentMessageKind::RequestAssist,
            "help".to_string(),
        );
        assert_eq!(msg.task_state, TaskState::Pending);
        assert_eq!(msg.priority, MessagePriority::Normal);
        assert!(msg.reply_to.is_none());
        assert!(msg.deadline.is_none());
        // message_id 由 from + timestamp 构成引用链
        assert!(msg.message_id().starts_with("agent-a-"));
    }

    #[test]
    fn task_state_and_priority_serialization_roundtrip() {
        let msg = AgentMessage {
            from: "a".to_string(),
            to: Some("b".to_string()),
            kind: AgentMessageKind::InterventionRequest,
            content: "conflict detected".to_string(),
            timestamp: 12345,
            id: "a-12345-0".to_string(),
            task_state: TaskState::Blocked,
            priority: MessagePriority::High,
            reply_to: Some("a-111".to_string()),
            deadline: Some(99999),
        };
        let json = serde_json::to_string(&msg).expect("应可序列化");
        let back: AgentMessage = serde_json::from_str(&json).expect("应可反序列化");
        assert_eq!(back.task_state, TaskState::Blocked);
        assert_eq!(back.priority, MessagePriority::High);
        assert_eq!(back.reply_to, Some("a-111".to_string()));
        assert_eq!(back.deadline, Some(99999));
        assert_eq!(back.kind, AgentMessageKind::InterventionRequest);
    }

    #[tokio::test]
    async fn request_and_wait_receives_response_with_reply_to() {
        // 验证双向通信：sender 发送请求后等待 receiver 通过 reply_to 回应的消息
        let bus = MessageBus::new();
        let sender = bus.register("sender".to_string()).await;
        let mut responder = bus.register("responder".to_string()).await;

        // responder 在后台接收请求并回复（带 reply_to 引用）
        let responder_task = tokio::spawn(async move {
            // 等待收到请求
            let req = loop {
                if let Some(msg) = responder.try_recv_direct().await {
                    break msg;
                }
                tokio::time::sleep(std::time::Duration::from_millis(10)).await;
            };
            let req_id = req.message_id();
            // 回复，携带 reply_to 引用链
            responder
                .send_structured(
                    "sender",
                    AgentMessageKind::AssistResponse,
                    "here is the answer".to_string(),
                    TaskState::Done,
                    MessagePriority::High,
                    Some(req_id),
                    None,
                )
                .await;
        });

        // sender 发送请求并等待响应（超时 5s）
        let result = sender
            .request_and_wait("responder", "need help", std::time::Duration::from_secs(5))
            .await;
        responder_task.await.unwrap();

        assert!(result.is_ok(), "应收到响应");
        let response = result.unwrap();
        assert_eq!(response.content, "here is the answer");
        assert_eq!(response.kind, AgentMessageKind::AssistResponse);
        assert!(response.reply_to.is_some(), "响应应携带 reply_to 引用");
    }

    #[tokio::test]
    async fn request_and_wait_times_out_when_no_response() {
        // 验证超时兜底：目标不回应时返回 Timeout 错误
        let bus = MessageBus::new();
        let sender = bus.register("sender".to_string()).await;
        let _responder = bus.register("responder".to_string()).await;

        let result = sender
            .request_and_wait(
                "responder",
                "need help",
                std::time::Duration::from_millis(200),
            )
            .await;
        assert!(result.is_err(), "无响应时应超时");
        assert!(matches!(result, Err(WaitTimeoutError::Timeout(_))));
    }

    #[tokio::test]
    async fn message_history_persists_and_loads() {
        // 验证消息历史持久化到 .sacode/agent-messages.json 并可跨实例加载
        let temp = tempfile::tempdir().expect("tempdir");
        let workdir = temp.path();

        let bus = MessageBus::new();
        let handle = bus.register("agent-a".to_string()).await;
        handle
            .send_to(
                "agent-b",
                AgentMessageKind::Discovery,
                "found module".to_string(),
            )
            .await;

        bus.persist_history(workdir).await;

        let path = workdir.join(".sacode").join("agent-messages.json");
        assert!(path.exists(), "agent-messages.json 应已生成");

        // 新总线实例加载历史
        let bus2 = MessageBus::new();
        bus2.load_history(workdir).await;
        let history = bus2.message_history().await;
        assert_eq!(history.len(), 1, "应加载 1 条历史消息");
        assert_eq!(history[0].kind, AgentMessageKind::Discovery);
    }

    #[test]
    fn message_id_is_unique_across_concurrent_sends() {
        // 回归：message_id 必须全局唯一，否则 request_and_wait 的
        // reply_to 引用链会在毫秒内并发发送时错配。
        let ids: std::collections::HashSet<String> = (0..10_000)
            .map(|_| {
                AgentMessage::new(
                    "agent-a".to_string(),
                    Some("agent-b".to_string()),
                    AgentMessageKind::RequestAssist,
                    "req".to_string(),
                )
                .message_id()
            })
            .collect();
        assert_eq!(ids.len(), 10_000, "同一 Agent 连续发送 1w 条消息不应有重复 ID");
    }

    #[tokio::test]
    async fn request_and_wait_buffers_unrelated_inbound_messages() {
        // 回归：等待响应期间收到的无关入站消息不应被错投给目标 Agent，
        // 而应缓冲到本地 pending 队列，供 try_recv_direct 后续消费。
        let bus = MessageBus::new();
        let mut sender = bus.register("sender".to_string()).await;
        let mut responder = bus.register("responder".to_string()).await;

        // 后台：responder 先给 sender 发一条无关广播式直接消息，再回复协助请求
        let resp_task = tokio::spawn(async move {
            // 先发一条不相关的 Discovery 给 sender
            responder
                .send_structured(
                    "sender",
                    AgentMessageKind::Discovery,
                    "无关上下文".to_string(),
                    TaskState::Pending,
                    MessagePriority::Normal,
                    None,
                    None,
                )
                .await;
            // 等待协助请求并回复
            while let Some(msg) = responder.try_recv_direct().await {
                if msg.kind == AgentMessageKind::RequestAssist {
                    responder
                        .send_structured(
                            "sender",
                            AgentMessageKind::AssistResponse,
                            "已协助".to_string(),
                            TaskState::Done,
                            MessagePriority::High,
                            Some(msg.message_id()),
                            None,
                        )
                        .await;
                    break;
                }
            }
        });

        let resp = sender
            .request_and_wait("responder", "需要协助", Duration::from_secs(5))
            .await
            .expect("应收到协助响应");
        assert_eq!(resp.content, "已协助");

        // 等待后台任务把无关消息送达本地 pending
        tokio::time::sleep(Duration::from_millis(200)).await;
        let unrelated = sender.try_recv_direct().await;
        assert!(
            unrelated.is_some_and(|m| m.content == "无关上下文"),
            "无关入站消息应保留在 sender 本地 pending，未被错投"
        );
        resp_task.abort();
    }
}
