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

use std::collections::HashMap;
use std::sync::Arc;

use tokio::sync::{broadcast, mpsc, RwLock};

/// Agent 间通信消息
#[derive(Debug, Clone, serde::Serialize)]
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
}

/// 消息类型
#[derive(Debug, Clone, serde::Serialize, PartialEq, Eq)]
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
            broadcast_rx: self.broadcast_tx.subscribe(),
            mailboxes: self.mailboxes.clone(),
            history: self.history.clone(),
            broadcast_tx: self.broadcast_tx.clone(),
        }
    }

    /// 广播消息给所有 Agent
    pub async fn broadcast(&self, from: &str, kind: AgentMessageKind, content: String) {
        let msg = AgentMessage {
            from: from.to_string(),
            to: None,
            kind,
            content,
            timestamp: current_timestamp_ms(),
        };

        // 记录到历史
        {
            let mut history = self.history.write().await;
            history.push(msg.clone());
        }

        // 广播
        let _ = self.broadcast_tx.send(msg);
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
    /// 发送直接消息给指定 Agent
    pub async fn send_to(&self, to: &str, kind: AgentMessageKind, content: String) -> bool {
        let msg = AgentMessage {
            from: self.agent_id.clone(),
            to: Some(to.to_string()),
            kind,
            content,
            timestamp: current_timestamp_ms(),
        };

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

    /// 广播消息给所有 Agent
    pub async fn broadcast(&self, kind: AgentMessageKind, content: String) {
        let msg = AgentMessage {
            from: self.agent_id.clone(),
            to: None,
            kind,
            content,
            timestamp: current_timestamp_ms(),
        };

        // 记录到历史
        {
            let mut history = self.history.write().await;
            history.push(msg.clone());
        }

        let _ = self.broadcast_tx.send(msg);
    }

    /// 尝试接收直接消息（非阻塞）
    pub async fn try_recv_direct(&self) -> Option<AgentMessage> {
        let mut receiver = self.receiver.lock().await;
        receiver.try_recv().ok()
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
            AgentMessage {
                from: "agent-a".to_string(),
                to: Some("agent-b".to_string()),
                kind: AgentMessageKind::Discovery,
                content: "found auth module".to_string(),
                timestamp: 1000,
            },
            AgentMessage {
                from: "agent-b".to_string(),
                to: Some("agent-a".to_string()),
                kind: AgentMessageKind::AssistResponse,
                content: "auth module is at src/auth.rs".to_string(),
                timestamp: 2000,
            },
            AgentMessage {
                from: "agent-a".to_string(),
                to: None,
                kind: AgentMessageKind::ProgressSync,
                content: "50% complete".to_string(),
                timestamp: 3000,
            },
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
}
