//! 会话事件日志 — Event Sourcing 雏形（§3.1 第一步：事件日志持久化）
//!
//! 借鉴 deepseek-harness 的 "SessionEvent 日志是唯一真相源" 设计
//! （见 `docs/reference/comparison-with-deepseek-harness.md` §3.1）。
//!
//! SaCode 已有 `daemon::EventHistory`（内存 `VecDeque` + `replay_after`）
//! 与 SSE `stream_from_broadcast_with_replay`（Last-Event-ID 续传）——
//! 已有事件流重建的 80% 基础设施。本模块补齐**持久化**缺口：
//!
//! - 工具执行事件落盘到 `.sacode/events.log`（JSON 行，append-only）
//! - 进程内保留内存缓冲，支持 `replay_after(seq)` 回放
//! - 与 `daemon::StreamEvent` 共用 `seq` 单调递增序号语义
//!
//! 本期定位：**事件日志持久化**（第一步），不改变 `ExecutionReport.events`
//! 的状态对象地位（那是 v1.2 第二步：状态作为事件投影）。持久化事件流
//! 为后续"状态即投影"提供可回放真相源。

use std::{
    collections::VecDeque,
    path::PathBuf,
    sync::{
        atomic::{AtomicU64, Ordering},
        Mutex as StdMutex,
        OnceLock,
    },
};

use serde::{Deserialize, Serialize};

/// 会话事件类型
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum SessionEventType {
    /// 工具调用开始（对应 `Event::ToolCallStarted`）
    ToolCallStarted,
    /// 工具调用结束（对应 `Event::ToolCallFinished`）
    ToolCallFinished,
    /// 工具被拦截器拒绝（pre_execute 返回 Deny）
    ToolCallDenied,
}

/// 一条持久化会话事件
///
/// 字段对齐 `daemon::StreamEvent`（`task_id` / `event_type` / `data` / `seq`），
/// 以便后续 v1.2 阶段可直接投影为 SSE 事件流。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionEvent {
    /// 会话标识（空字符串表示独立调用，未关联会话）
    pub session_id: String,
    /// 事件类型
    #[serde(rename = "type")]
    pub event_type: SessionEventType,
    /// 事件载荷：工具名、input、output、success、error 等
    pub data: serde_json::Value,
    /// 单调递增序号（跨进程内所有会话共享，用于回放）
    #[serde(skip)]
    pub seq: u64,
    /// RFC3339 时间戳（非确定性字段，事件化存储以支持幂等回放）
    pub ts: String,
}

impl SessionEvent {
    /// 投影为 SSE 兼容的 `data` payload（不含 `seq`）
    pub fn to_sse_data(&self) -> serde_json::Value {
        let mut v = self.data.clone();
        v["session_id"] = serde_json::Value::String(self.session_id.clone());
        v["type"] = serde_json::Value::String(match self.event_type {
            SessionEventType::ToolCallStarted => "tool_call_started".to_string(),
            SessionEventType::ToolCallFinished => "tool_call_finished".to_string(),
            SessionEventType::ToolCallDenied => "tool_call_denied".to_string(),
        });
        v["ts"] = serde_json::Value::String(self.ts.clone());
        v
    }
}

/// 持久化会话事件日志（进程内单例）
///
/// - 内存 `VecDeque` 缓冲最近 `capacity` 条，支持 `replay_after`
/// - 落盘 `.sacode/events.log`（按当前工作目录解析）
/// - 落盘失败（如工作目录不可写）时降级为纯内存模式，不中断工具执行
pub struct SessionEventLog {
    seq: AtomicU64,
    buffer: StdMutex<VecDeque<SessionEvent>>,
    capacity: usize,
    /// 落盘路径；None 表示纯内存模式（落盘失败降级）
    log_path: StdMutex<Option<PathBuf>>,
}

impl SessionEventLog {
    const DEFAULT_CAPACITY: usize = 4096;

    fn new(capacity: usize) -> Self {
        let log_path = std::env::current_dir()
            .ok()
            .map(|dir| dir.join(".sacode").join("events.log"));

        // 预创建 .sacode 目录；失败则降级纯内存
        let resolved = match log_path {
            Some(path) => {
                if path.parent().map(|p| std::fs::create_dir_all(p)).is_some() {
                    Some(path)
                } else {
                    None
                }
            }
            None => None,
        };

        Self {
            seq: AtomicU64::new(0),
            buffer: StdMutex::new(VecDeque::with_capacity(capacity)),
            capacity,
            log_path: StdMutex::new(resolved),
        }
    }

    /// 全局单例（进程内共享，seq 单调递增）
    pub fn global() -> &'static SessionEventLog {
        static INSTANCE: OnceLock<SessionEventLog> = OnceLock::new();
        INSTANCE.get_or_init(|| SessionEventLog::new(Self::DEFAULT_CAPACITY))
    }

    /// 记录一条事件，返回分配的 seq
    ///
    /// 同时写入内存缓冲（供回放）与落盘（append-only）。
    /// 落盘失败仅打印 warn 并降级，不影响工具执行链路。
    pub fn record(&self, session_id: &str, event_type: SessionEventType, data: serde_json::Value) -> u64 {
        let seq = self.seq.fetch_add(1, Ordering::Relaxed) + 1;
        let ts = chrono::Utc::now().to_rfc3339();

        let event = SessionEvent {
            session_id: session_id.to_string(),
            event_type,
            data,
            seq,
            ts,
        };

        // 内存缓冲
        {
            let mut buf = self.buffer.lock().expect("session event buffer poisoned");
            buf.push_back(event.clone());
            while buf.len() > self.capacity {
                buf.pop_front();
            }
        }

        // 落盘（追加）
        if let Some(path) = self.log_path.lock().expect("log path poisoned").clone() {
            if let Ok(mut file) = std::fs::OpenOptions::new()
                .create(true)
                .append(true)
                .open(&path)
            {
                use std::io::Write;
                let _ = writeln!(file, "{}", serde_json::to_string(&event).unwrap_or_default());
            } else {
                // 落盘失败：降级纯内存（仅一次）
                *self.log_path.lock().expect("log path poisoned") = None;
            }
        }

        seq
    }

    /// 回放 seq > `last_seq` 的所有事件（升序）
    pub fn replay_after(&self, last_seq: u64) -> Vec<SessionEvent> {
        let buf = self.buffer.lock().expect("session event buffer poisoned");
        buf.iter()
            .filter(|e| e.seq > last_seq)
            .cloned()
            .collect()
    }

    /// 当前最大 seq
    pub fn current_seq(&self) -> u64 {
        self.seq.load(Ordering::Relaxed)
    }

    /// 从事件流投影出会话级状态摘要
    ///
    /// **限制**（R7）：投影只扫描进程内共享内存缓冲（默认 [`Self::DEFAULT_CAPACITY`]
    /// = 4096 条，跨所有会话共享）。缓冲满后最旧事件被环状淘汰，**淘汰后的计数会
    /// 静默偏低**，且本方法不暴露 `truncated` 标志——长会话/多会话并发下 `total_calls`
    /// 等字段是"缓冲窗口内"的下界，非全量精确值。
    ///
    /// 另：`seq` 字段标注 `#[serde(skip)]`，落盘事件回放时无法重建 seq，
    /// 故 `last_seq` 仅反映内存缓冲内的最大值，不代表持久化全量 seq。
    pub fn project_session_state(&self, session_id: &str) -> SessionStateProjection {
        let buf = self.buffer.lock().expect("session event buffer poisoned");
        let mut projection = SessionStateProjection::default();
        projection.session_id = session_id.to_string();

        for event in buf.iter().filter(|e| e.session_id == session_id) {
            projection.last_seq = event.seq;
            match event.event_type {
                SessionEventType::ToolCallStarted => {
                    projection.total_calls += 1;
                    if let Some(name) = event.data.get("name").and_then(|v| v.as_str()) {
                        projection.last_tool = Some(name.to_string());
                    }
                }
                SessionEventType::ToolCallFinished => {
                    let success = event.data.get("success").and_then(|v| v.as_bool()).unwrap_or(false);
                    if success { projection.completed += 1; } else { projection.failed += 1; }
                }
                SessionEventType::ToolCallDenied => {
                    projection.denied += 1;
                }
            }
        }
        projection
    }
}

/// 会话级状态投影 — 从事件流重建的统计摘要
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct SessionStateProjection {
    pub session_id: String,
    pub total_calls: u32,
    pub completed: u32,
    pub failed: u32,
    pub denied: u32,
    pub last_tool: Option<String>,
    pub last_seq: u64,
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fresh_log() -> SessionEventLog {
        SessionEventLog::new(16)
    }

    #[test]
    fn project_session_state_counts_total_completed_failed_denied() {
        let log = fresh_log();
        let sid = "sess-1";
        log.record(sid, SessionEventType::ToolCallStarted, serde_json::json!({"name": "fs.read"}));
        log.record(sid, SessionEventType::ToolCallFinished, serde_json::json!({"success": true}));
        log.record(sid, SessionEventType::ToolCallStarted, serde_json::json!({"name": "shell.exec"}));
        log.record(sid, SessionEventType::ToolCallFinished, serde_json::json!({"success": false}));
        log.record(sid, SessionEventType::ToolCallStarted, serde_json::json!({"name": "fs.write"}));
        log.record(sid, SessionEventType::ToolCallDenied, serde_json::json!({"reason": "blocked"}));

        let p = log.project_session_state(sid);
        assert_eq!(p.session_id, sid);
        assert_eq!(p.total_calls, 3);
        assert_eq!(p.completed, 1);
        assert_eq!(p.failed, 1);
        assert_eq!(p.denied, 1);
        assert_eq!(p.last_tool, Some("fs.write".to_string()));
    }

    #[test]
    fn project_session_state_filters_other_sessions() {
        let log = fresh_log();
        log.record("a", SessionEventType::ToolCallStarted, serde_json::json!({"name": "tool"}));
        log.record("b", SessionEventType::ToolCallFinished, serde_json::json!({"success": true}));
        let p = log.project_session_state("a");
        assert_eq!(p.total_calls, 1);
        assert_eq!(p.completed, 0);
    }
}
