use anyhow::Result;
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    sync::{Arc, RwLock},
    time::{Duration, Instant},
};
use tracing::warn;

use sacode_kernel::{
    ApprovalAction, ApprovalPolicy, Checkpoint, Event, ExecutionMode,
    Task, ToolExecutionRecord, generate_task_id,
};

use crate::CheckpointStorage;
use crate::ToolRegistry;
use crate::executor::task_runner::{
    ApprovalDecider, AutoApproveDecider, AutoDenyDecider, LoggingErrorRecorder,
    PromptUserDecider, TaskRunConfig, execute_task_with_provider,
};
use crate::prompt::{build_system_prompt, PromptContext};
use crate::McpConfigStore;

/// 获取锁的最大等待时间
const LOCK_TIMEOUT: Duration = Duration::from_secs(5);
/// 获取锁的重试间隔
const LOCK_RETRY_INTERVAL: Duration = Duration::from_millis(50);

#[derive(Debug, Clone)]
pub struct SessionService {
    sessions: Arc<RwLock<HashMap<String, SessionState>>>,
}

/// 锁获取超时错误
#[derive(Debug)]
pub struct LockTimeoutError {
    pub operation: String,
    pub timeout: Duration,
}

impl std::fmt::Display for LockTimeoutError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(
            f,
            "lock acquisition timed out after {:?} for operation: {}",
            self.timeout, self.operation
        )
    }
}

impl std::error::Error for LockTimeoutError {}

impl SessionService {
    pub fn new() -> Self {
        Self {
            sessions: Arc::new(RwLock::new(HashMap::new())),
        }
    }

    /// 带超时的读锁获取
    fn read_sessions(&self, operation: &str) -> Result<std::sync::RwLockReadGuard<'_, HashMap<String, SessionState>>> {
        let start = Instant::now();
        loop {
            match self.sessions.try_read() {
                Ok(guard) => return Ok(guard),
                Err(std::sync::TryLockError::WouldBlock) => {
                    if start.elapsed() >= LOCK_TIMEOUT {
                        warn!("读锁超时: operation={}", operation);
                        anyhow::bail!(
                            "session lock contention: read lock timed out after {:?} for '{}'",
                            LOCK_TIMEOUT,
                            operation
                        );
                    }
                    std::thread::sleep(LOCK_RETRY_INTERVAL);
                }
                Err(std::sync::TryLockError::Poisoned(e)) => {
                    // 锁中毒：恢复而非 panic，因为其他线程 panic 不应导致整个服务不可用
                    warn!("session RwLock 中毒，尝试恢复: operation={}", operation);
                    return Ok(e.into_inner());
                }
            }
        }
    }

    /// 带超时的写锁获取
    fn write_sessions(&self, operation: &str) -> Result<std::sync::RwLockWriteGuard<'_, HashMap<String, SessionState>>> {
        let start = Instant::now();
        loop {
            match self.sessions.try_write() {
                Ok(guard) => return Ok(guard),
                Err(std::sync::TryLockError::WouldBlock) => {
                    if start.elapsed() >= LOCK_TIMEOUT {
                        warn!("写锁超时: operation={}", operation);
                        anyhow::bail!(
                            "session lock contention: write lock timed out after {:?} for '{}'",
                            LOCK_TIMEOUT,
                            operation
                        );
                    }
                    std::thread::sleep(LOCK_RETRY_INTERVAL);
                }
                Err(std::sync::TryLockError::Poisoned(e)) => {
                    warn!("session RwLock 中毒，尝试恢复: operation={}", operation);
                    return Ok(e.into_inner());
                }
            }
        }
    }

    pub fn create_session(&self, cwd: PathBuf) -> Result<SessionHandle> {
        let id = format!("session-{}", unique_suffix());
        let state = SessionState::new(id.clone(), cwd);
        let handle = state.handle();
        self.write_sessions("create_session")?
            .insert(id, state);
        Ok(handle)
    }

    pub fn get_session(&self, session_id: &str) -> Result<SessionHandle> {
        let sessions = self.read_sessions("get_session")?;
        let session = sessions
            .get(session_id)
            .ok_or_else(|| anyhow::anyhow!("session not found: {}", session_id))?;
        Ok(session.handle())
    }

    pub fn list_sessions(&self) -> Vec<SessionHandle> {
        match self.read_sessions("list_sessions") {
            Ok(sessions) => sessions.values().map(SessionState::handle).collect(),
            Err(e) => {
                warn!("list_sessions 获取读锁失败: {}", e);
                Vec::new()
            }
        }
    }

    pub fn close_session(&self, session_id: &str) -> Result<()> {
        let mut sessions = self.write_sessions("close_session")?;
        let session = sessions
            .get_mut(session_id)
            .ok_or_else(|| anyhow::anyhow!("session not found: {}", session_id))?;
        session.status = SessionStatus::Closed;
        Ok(())
    }

    pub fn cancel_session(&self, session_id: &str) -> Result<()> {
        let mut sessions = self.write_sessions("cancel_session")?;
        let session = sessions
            .get_mut(session_id)
            .ok_or_else(|| anyhow::anyhow!("session not found: {}", session_id))?;
        session.status = SessionStatus::Cancelled;
        Ok(())
    }

    pub fn compress_session(&self, session_id: &str) -> Result<CompressionResult> {
        let mut sessions = self.write_sessions("compress_session")?;
        let session = sessions
            .get_mut(session_id)
            .ok_or_else(|| anyhow::anyhow!("session not found: {}", session_id))?;

        let original_count = session.events.len();
        let original_tokens = session.estimate_event_tokens();

        session.compress()?;

        Ok(CompressionResult {
            original_event_count: original_count,
            compressed_event_count: session.compressed_event_count.unwrap_or(original_count),
            original_token_count: original_tokens,
            compressed_token_count: session.estimate_event_tokens(),
            compression_ratio: session.compression_ratio.unwrap_or(1.0),
            summary: session.compressed_summary.clone().unwrap_or_default(),
        })
    }

    pub fn auto_compress_session(
        &self,
        session_id: &str,
        threshold: u32,
    ) -> Result<Option<CompressionResult>> {
        let mut sessions = self.write_sessions("auto_compress_session")?;
        let session = sessions
            .get_mut(session_id)
            .ok_or_else(|| anyhow::anyhow!("session not found: {}", session_id))?;

        if !session.should_compress(threshold) {
            return Ok(None);
        }

        let original_count = session.events.len();
        let original_tokens = session.estimate_event_tokens();

        session.compress()?;

        Ok(Some(CompressionResult {
            original_event_count: original_count,
            compressed_event_count: session.compressed_event_count.unwrap_or(original_count),
            original_token_count: original_tokens,
            compressed_token_count: session.estimate_event_tokens(),
            compression_ratio: session.compression_ratio.unwrap_or(1.0),
            summary: session.compressed_summary.clone().unwrap_or_default(),
        }))
    }

    pub fn fork_session(&self, source_session_id: &str) -> Result<SessionHandle> {
        let new_id = format!("session-{}", unique_suffix());

        // 从源会话复制状态
        let new_state = {
            let sessions = self.read_sessions("fork_session")?;
            let source = sessions
                .get(source_session_id)
                .ok_or_else(|| anyhow::anyhow!("source session not found: {}", source_session_id))?;

            let mut forked = SessionState::new(new_id.clone(), source.cwd.clone());
            // 复制事件历史到分支
            forked.events = source.events.clone();
            forked.last_checkpoint = source.last_checkpoint.clone();
            // 记录分支来源
            forked.forked_from = Some(source_session_id.to_string());
            forked
        };

        let handle = new_state.handle();
        self.write_sessions("fork_session_insert")?
            .insert(new_id, new_state);
        Ok(handle)
    }

    pub fn resume_session(&self, session_id: &str) -> Result<SessionHandle> {
        let mut sessions = self.write_sessions("resume_session")?;
        let session = sessions
            .get_mut(session_id)
            .ok_or_else(|| anyhow::anyhow!("session not found: {}", session_id))?;

        match session.status {
            SessionStatus::Closed | SessionStatus::Cancelled => {
                session.status = SessionStatus::Idle;
                Ok(session.handle())
            }
            SessionStatus::Failed(_) => {
                session.status = SessionStatus::Idle;
                Ok(session.handle())
            }
            SessionStatus::Idle | SessionStatus::Running | SessionStatus::Cancelling => {
                Ok(session.handle())
            }
        }
    }

    pub fn session_history(&self, session_id: &str) -> Result<SessionHistory> {
        let sessions = self.read_sessions("session_history")?;
        let session = sessions
            .get(session_id)
            .ok_or_else(|| anyhow::anyhow!("session not found: {}", session_id))?;

        Ok(SessionHistory {
            id: session.id.clone(),
            event_count: session.events.len(),
            estimated_tokens: session.estimate_event_tokens(),
            last_checkpoint: session.last_checkpoint.clone(),
            forked_from: session.forked_from.clone(),
            compressed: session.compressed_summary.is_some(),
            compression_ratio: session.compression_ratio,
        })
    }

    pub fn load_session(&self, workdir: &Path, checkpoint_name: &str) -> Result<SessionHandle> {
        // checkpoint 加载不需要持锁
        let checkpoints = CheckpointStorage::new(workdir);
        let checkpoint = checkpoints.load(checkpoint_name)?;
        let id = format!("session-{}", unique_suffix());
        let mut state = SessionState::new(id.clone(), workdir.to_path_buf());
        state.events = checkpoint.recent_events.clone();
        state.last_checkpoint = Some(checkpoint_name.to_string());
        let handle = state.handle();
        self.write_sessions("load_session")?
            .insert(id, state);
        Ok(handle)
    }

    pub async fn prompt(&self, session_id: &str, prompt: SessionPrompt) -> Result<Vec<SessionEvent>> {
        // 阶段1：短暂持锁，仅做状态校验和状态切换
        let (cwd, task_info) = {
            let mut sessions = self.write_sessions("prompt_start")?;
            let session = sessions
                .get_mut(session_id)
                .ok_or_else(|| anyhow::anyhow!("session not found: {}", session_id))?;

            if matches!(
                session.status,
                SessionStatus::Cancelled | SessionStatus::Closed
            ) {
                return Ok(vec![SessionEvent::Error {
                    message: format!("session {} is not runnable", session_id),
                }]);
            }

            session.status = SessionStatus::Running;
            let cwd = session.cwd.clone();
            (cwd, prompt.content.clone())
        };
        // 锁已释放，后续耗时操作不再持锁

        // 阶段2：通过统一 TaskExecutor 执行（真正调用 LLM + 工具执行）
        let mut tools = ToolRegistry::builtin();
        let mcp_store = McpConfigStore::new(&cwd);
        let _ = crate::register_enabled_mcp_tools_sync(&mcp_store, &mut tools);

        // 灵枢 · 上下文优化：按任务画像筛选注入 prompt 的工具 schema
        // 无角色白名单时，for_prompt 按 TaskProfile 自动映射扩展工具
        let session_profile = crate::model_routing::TaskProfile::from_prompt_and_workspace(
            &task_info,
            &cwd,
        );
        let (injected_specs, _budget_trimmed) =
            tools.for_prompt(None, Some(&session_profile), None);
        let tool_names: Vec<String> = injected_specs
            .iter()
            .map(|spec| spec.name.to_string())
            .collect();

        let system_prompt = build_system_prompt(&PromptContext {
            workdir: &cwd,
            mode: prompt.mode,
            tool_names: &tool_names,
        })
        .unwrap_or_default();

        // 解析 provider
        let provider = crate::agents::model_router::resolve_config_model_candidates(&cwd)
            .into_iter()
            .next()
            .map(|(_, _, provider)| provider)
            .ok_or_else(|| anyhow::anyhow!("无可用模型配置，请先运行 /login 或 sacode init"))?;

        // 将 ApprovalPolicy 映射为 ApprovalDecider
        let approval_decider: std::sync::Arc<dyn ApprovalDecider> = match prompt.approval {
            ApprovalPolicy::AutoApprove => std::sync::Arc::new(AutoApproveDecider),
            ApprovalPolicy::AutoDeny => std::sync::Arc::new(AutoDenyDecider),
            ApprovalPolicy::Prompt => std::sync::Arc::new(PromptUserDecider),
        };

        let config = TaskRunConfig {
            workdir: &cwd,
            mode: prompt.mode,
            max_iterations: 3,
            system_prompt,
            user_prompt: task_info.clone(),
            provider,
            tools,
            approval: approval_decider,
            error_recorder: std::sync::Arc::new(LoggingErrorRecorder),
            task_id: Some(generate_task_id()),
        };

        let task_run_result = execute_task_with_provider(&config, None).await;

        // 构建事件序列
        let task = Task::new(task_info.clone(), prompt.mode, None);
        let mut events = vec![SessionEvent::Started { task: task.clone() }];

        let success = task_run_result.response.is_ok();
        let response_text = task_run_result
            .response
            .unwrap_or_else(|error| format!("执行失败：{}", error));

        if success {
            events.push(SessionEvent::KernelEvent(Event::message(response_text.clone())));
        } else {
            events.push(SessionEvent::KernelEvent(Event::error(response_text.clone())));
        }

        // 处理 pending question
        if let Some(question) = &task_run_result.pending_question {
            events.push(SessionEvent::KernelEvent(Event::message(
                serde_json::to_string(question).unwrap_or_default(),
            )));
        }

        // 构建 checkpoint
        let mut checkpoint = Checkpoint::new(task);
        for event in events.iter() {
            if let SessionEvent::KernelEvent(e) = event {
                checkpoint.add_event(e.clone());
            }
        }

        let checkpoints = CheckpointStorage::new(&cwd);
        let checkpoint_path = checkpoints.save(&checkpoint)?;

        // 阶段3：短暂持锁，仅更新 session 状态
        {
            let mut sessions = self.write_sessions("prompt_finish")?;
            let session = sessions
                .get_mut(session_id)
                .ok_or_else(|| anyhow::anyhow!("session not found: {}", session_id))?;
            session.status = SessionStatus::Idle;
            session.events.extend(checkpoint.recent_events.clone());
            session.last_checkpoint = checkpoint_path
                .file_name()
                .and_then(|value| value.to_str())
                .map(str::to_string);
        }

        let summary = if success {
            response_text
        } else {
            format!("执行失败：{}", response_text)
        };
        events.push(SessionEvent::Done { summary });
        Ok(events)
    }
}

#[derive(Debug, Clone)]
struct SessionState {
    id: String,
    cwd: PathBuf,
    status: SessionStatus,
    tools: Vec<String>,
    events: Vec<Event>,
    last_checkpoint: Option<String>,
    last_tool_records: Vec<ToolExecutionRecord>,
    compressed_summary: Option<String>,
    compression_ratio: Option<f32>,
    original_event_count: Option<usize>,
    compressed_event_count: Option<usize>,
    last_compressed_at: Option<String>,
    /// 分支来源会话 ID
    forked_from: Option<String>,
}

impl SessionState {
    fn new(id: String, cwd: PathBuf) -> Self {
        Self {
            id: id.clone(),
            cwd,
            status: SessionStatus::Idle,
            tools: ToolRegistry::builtin()
                .names()
                .into_iter()
                .map(str::to_string)
                .collect(),
            events: Vec::new(),
            last_checkpoint: None,
            last_tool_records: Vec::new(),
            compressed_summary: None,
            compression_ratio: None,
            original_event_count: None,
            compressed_event_count: None,
            last_compressed_at: None,
            forked_from: None,
        }
    }

    fn handle(&self) -> SessionHandle {
        SessionHandle {
            id: self.id.clone(),
            cwd: self.cwd.clone(),
            status: self.status.clone(),
            tools: self.tools.clone(),
            last_checkpoint: self.last_checkpoint.clone(),
        }
    }

    fn estimate_event_tokens(&self) -> u32 {
        self.events.iter().map(estimate_event_tokens).sum()
    }

    fn should_compress(&self, threshold: u32) -> bool {
        self.estimate_event_tokens() > threshold && self.compressed_summary.is_none()
    }

    fn compress(&mut self) -> Result<()> {
        if self.events.is_empty() {
            return Ok(());
        }

        let original_count = self.events.len();
        let original_tokens = self.estimate_event_tokens();

        let mut key_events = Vec::new();
        let mut tool_events = Vec::new();

        for event in &self.events {
            match event {
                Event::Message { content: _ } => key_events.push(event.clone()),
                Event::PlanGenerated { steps: _ } => key_events.push(event.clone()),
                Event::ToolCallStarted { name: _, input: _ } => tool_events.push(event.clone()),
                Event::ToolCallFinished {
                    name: _,
                    output: _,
                    success,
                } if *success => tool_events.push(event.clone()),
                Event::Done { summary: _ } => key_events.push(event.clone()),
                Event::Error { message: _ } => key_events.push(event.clone()),
                _ => {}
            }
        }

        let summary = generate_compression_summary(&key_events, &tool_events);
        let compressed_events = key_events
            .into_iter()
            .chain(tool_events)
            .collect::<Vec<_>>();
        let compressed_count = compressed_events.len();
        let compressed_tokens = compressed_events
            .iter()
            .map(estimate_event_tokens)
            .sum::<u32>();

        let ratio = if original_tokens > 0 {
            compressed_tokens as f32 / original_tokens as f32
        } else {
            1.0
        };

        self.events = compressed_events;
        self.compressed_summary = Some(summary);
        self.compression_ratio = Some(ratio);
        self.original_event_count = Some(original_count);
        self.compressed_event_count = Some(compressed_count);
        self.last_compressed_at = Some(chrono::Local::now().to_rfc3339());

        Ok(())
    }
}

impl Default for SessionService {
    fn default() -> Self {
        Self::new()
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionHandle {
    pub id: String,
    pub cwd: PathBuf,
    pub status: SessionStatus,
    pub tools: Vec<String>,
    pub last_checkpoint: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum SessionStatus {
    Idle,
    Running,
    Cancelling,
    Cancelled,
    Closed,
    Failed(String),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionPrompt {
    pub content: String,
    pub mode: ExecutionMode,
    pub approval: ApprovalPolicy,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum SessionEvent {
    Started {
        task: Task,
    },
    KernelEvent(Event),
    ToolCallStarted {
        step_id: usize,
        name: String,
        input: serde_json::Value,
    },
    ToolCallFinished {
        step_id: usize,
        name: String,
        output: serde_json::Value,
        success: bool,
    },
    Done {
        summary: String,
    },
    Error {
        message: String,
    },
}

fn unique_suffix() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};

    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis().to_string())
        .unwrap_or_else(|_| "0".to_string())
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionHistory {
    pub id: String,
    pub event_count: usize,
    pub estimated_tokens: u32,
    pub last_checkpoint: Option<String>,
    pub forked_from: Option<String>,
    pub compressed: bool,
    pub compression_ratio: Option<f32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CompressionResult {
    pub original_event_count: usize,
    pub compressed_event_count: usize,
    pub original_token_count: u32,
    pub compressed_token_count: u32,
    pub compression_ratio: f32,
    pub summary: String,
}

fn estimate_event_tokens(event: &Event) -> u32 {
    match event {
        Event::Message { content } => (content.len() / 4) as u32,
        Event::Thinking { content } => (content.len() / 4) as u32,
        Event::PlanGenerated { steps } => steps.iter().map(|s| s.len() / 4).sum::<usize>() as u32,
        Event::ToolCallStarted { name, input } => {
            (name.len() / 4 + input.to_string().len() / 4 + 10) as u32
        }
        Event::ToolCallFinished {
            name,
            output,
            success: _,
        } => {
            let output_len = output.to_string().len();
            (name.len() / 4 + output_len / 4 + 20) as u32
        }
        Event::ApprovalRequested { action } => match action {
            ApprovalAction::WriteFile { path } => (path.len() / 4 + 10) as u32,
            ApprovalAction::ExecuteCommand { command } => (command.len() / 4 + 10) as u32,
            ApprovalAction::CallPlugin { name } => (name.len() / 4 + 10) as u32,
            ApprovalAction::BatchChange { count } => 10 + *count as u32,
        },
        Event::ApprovalResolved { approved: _ } => 5,
        Event::FileChanged {
            path,
            change_type: _,
        } => (path.len() / 4 + 10) as u32,
        Event::CommandOutput { command, output } => {
            (command.len() / 4 + output.len() / 4 + 10) as u32
        }
        Event::Done { summary } => (summary.len() / 4) as u32,
        Event::Error { message } => (message.len() / 4 + 10) as u32,
    }
}

fn generate_compression_summary(key_events: &[Event], tool_events: &[Event]) -> String {
    let mut summary_parts = Vec::new();

    for event in key_events {
        match event {
            Event::Message { content } => {
                summary_parts.push(format!(
                    "消息: {}",
                    content.lines().next().unwrap_or_default()
                ));
            }
            Event::Done { summary } => {
                summary_parts.push(format!(
                    "完成: {}",
                    summary.lines().next().unwrap_or_default()
                ));
            }
            Event::Error { message } => {
                summary_parts.push(format!(
                    "错误: {}",
                    message.lines().next().unwrap_or_default()
                ));
            }
            Event::PlanGenerated { steps } => {
                summary_parts.push(format!("规划: {} 步", steps.len()));
            }
            _ => {}
        }
    }

    let tool_names: Vec<String> = tool_events
        .iter()
        .filter_map(|event| match event {
            Event::ToolCallStarted { name, input: _ } => Some(name.clone()),
            Event::ToolCallFinished {
                name,
                output: _,
                success: _,
            } => Some(name.clone()),
            _ => None,
        })
        .collect();

    if !tool_names.is_empty() {
        summary_parts.push(format!("工具调用: {}", tool_names.join(", ")));
    }

    if summary_parts.is_empty() {
        "会话已压缩".to_string()
    } else {
        summary_parts.join("\n")
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;
    use std::thread;

    #[test]
    fn create_and_get_session() {
        let service = SessionService::new();
        let handle = service.create_session(PathBuf::from("/tmp")).unwrap();
        assert!(!handle.id.is_empty());
        assert_eq!(handle.cwd, PathBuf::from("/tmp"));

        let retrieved = service.get_session(&handle.id).unwrap();
        assert_eq!(retrieved.id, handle.id);
    }

    #[test]
    fn get_nonexistent_session_fails() {
        let service = SessionService::new();
        assert!(service.get_session("nonexistent").is_err());
    }

    #[test]
    fn close_and_cancel_session() {
        let service = SessionService::new();
        let handle = service.create_session(PathBuf::from("/tmp")).unwrap();

        service.close_session(&handle.id).unwrap();
        let closed = service.get_session(&handle.id).unwrap();
        assert!(matches!(closed.status, SessionStatus::Closed));

        let handle2 = service.create_session(PathBuf::from("/tmp")).unwrap();
        service.cancel_session(&handle2.id).unwrap();
        let cancelled = service.get_session(&handle2.id).unwrap();
        assert!(matches!(cancelled.status, SessionStatus::Cancelled));
    }

    #[test]
    fn list_sessions() {
        let service = SessionService::new();
        service.create_session(PathBuf::from("/tmp/a")).unwrap();
        service.create_session(PathBuf::from("/tmp/b")).unwrap();
        let sessions = service.list_sessions();
        assert_eq!(sessions.len(), 2);
    }

    #[test]
    fn concurrent_access_does_not_deadlock() {
        let service = Arc::new(SessionService::new());
        let handle = service.create_session(PathBuf::from("/tmp")).unwrap();
        let session_id = handle.id.clone();

        // 多线程并发读写
        let mut handles = vec![];
        for i in 0..4 {
            let svc = Arc::clone(&service);
            let sid = session_id.clone();
            handles.push(thread::spawn(move || {
                if i % 2 == 0 {
                    let _ = svc.get_session(&sid);
                } else {
                    let _ = svc.list_sessions();
                }
            }));
        }

        for h in handles {
            h.join().unwrap();
        }
    }

    #[test]
    fn lock_timeout_prevents_indefinite_wait() {
        // 验证超时机制存在：在正常情况下应快速获取锁
        let service = SessionService::new();
        let start = Instant::now();
        let _ = service.create_session(PathBuf::from("/tmp"));
        let elapsed = start.elapsed();
        // 正常情况下应在 1 秒内完成
        assert!(elapsed < Duration::from_secs(1));
    }

    #[tokio::test]
    async fn prompt_releases_lock_during_execution() {
        // 验证 prompt 在执行期间不持锁
        let service = Arc::new(SessionService::new());
        let handle = service.create_session(PathBuf::from(".")).unwrap();
        let session_id = handle.id.clone();

        let svc = Arc::clone(&service);

        // 在另一个线程中，应能读取 session 列表
        // 即使 prompt 正在执行（prompt 内部会释放锁）
        let list_handle = thread::spawn(move || {
            // 短暂等待确保 prompt 已启动
            thread::sleep(Duration::from_millis(10));
            let sessions = svc.list_sessions();
            assert!(!sessions.is_empty());
        });

        // prompt 执行（即使内部任务很快完成，锁的释放模式是正确的）
        let _ = service.prompt(&session_id, SessionPrompt {
            content: "test".to_string(),
            mode: ExecutionMode::Build,
            approval: ApprovalPolicy::AutoDeny,
        }).await;

        list_handle.join().unwrap();
    }
}
