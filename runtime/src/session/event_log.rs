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
//! 本期已补齐投影快照：会话结束/压缩时写入 `.sacode/checkpoints/<session_id>.json`，
//! `project_session_state_complete` 以快照为基底增量回放；损坏则全量扫描 events.log。

use std::{
    collections::VecDeque,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicU64, Ordering},
        Mutex as StdMutex, OnceLock,
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
    ///
    /// 随事件落盘（`#[serde(default)]` 兼容旧日志缺 seq 字段的场景：
    /// 反序列化得 seq=0，磁盘回放时按行序重分配）。
    #[serde(default)]
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
/// - 落盘 `.sacode/events.log`（按当前工作目录解析，或注入自定义路径）
/// - 落盘失败（如工作目录不可写）时降级为纯内存模式，不中断工具执行
pub struct SessionEventLog {
    seq: AtomicU64,
    buffer: StdMutex<VecDeque<SessionEvent>>,
    capacity: usize,
    /// 落盘路径；None 表示纯内存模式（落盘失败降级）
    log_path: StdMutex<Option<PathBuf>>,
    /// 因内存缓冲环状淘汰而丢弃的事件总数（用于 `truncated` 标志）
    evicted_total: AtomicU64,
}

impl SessionEventLog {
    const DEFAULT_CAPACITY: usize = 4096;

    fn new(capacity: usize) -> Self {
        let log_path = std::env::current_dir()
            .ok()
            .map(|dir| dir.join(".sacode").join("events.log"));

        // 预创建 .sacode 目录；失败则降级纯内存
        let resolved = log_path.filter(|path| {
            path.parent()
                .and_then(|p| std::fs::create_dir_all(p).ok())
                .is_some()
        });

        let log = Self {
            seq: AtomicU64::new(0),
            buffer: StdMutex::new(VecDeque::with_capacity(capacity)),
            capacity,
            log_path: StdMutex::new(resolved),
            evicted_total: AtomicU64::new(0),
        };
        log.restore_seq_from_disk();
        log
    }

    /// 带显式落盘路径的构造器（测试注入 tempdir 用，避免写真实 `.sacode/events.log`）
    ///
    /// `log_path: None` 等价纯内存模式（不落盘）；`Some(path)` 时自动创建父目录。
    pub fn new_with_path(capacity: usize, log_path: Option<PathBuf>) -> Self {
        let resolved = log_path.filter(|path| {
            path.parent()
                .and_then(|p| std::fs::create_dir_all(p).ok())
                .is_some()
        });

        let log = Self {
            seq: AtomicU64::new(0),
            buffer: StdMutex::new(VecDeque::with_capacity(capacity)),
            capacity,
            log_path: StdMutex::new(resolved),
            evicted_total: AtomicU64::new(0),
        };
        log.restore_seq_from_disk();
        log
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
    pub fn record(
        &self,
        session_id: &str,
        event_type: SessionEventType,
        data: serde_json::Value,
    ) -> u64 {
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
                self.evicted_total.fetch_add(1, Ordering::Relaxed);
            }
        }

        // 落盘（追加）。一次 lock 取 path clone 后立即释放，避免持锁期间打开文件
        // （double-lock / TOCTOU 窗口）；写失败再 lock 置 None 降级纯内存。
        let path = self.log_path.lock().expect("log path poisoned").clone();
        if let Some(path) = path {
            if let Ok(mut file) = std::fs::OpenOptions::new()
                .create(true)
                .append(true)
                .open(&path)
            {
                use std::io::Write;
                let _ = writeln!(
                    file,
                    "{}",
                    serde_json::to_string(&event).unwrap_or_default()
                );
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
        buf.iter().filter(|e| e.seq > last_seq).cloned().collect()
    }

    /// 磁盘回放：读取 events.log 中 seq > `last_seq` 的事件（升序）
    ///
    /// - 逐行解析 JSON；行序即序号序（append-only 保证）
    /// - 旧日志（无 seq 字段）反序列化得 seq=0，按行序重分配为 1..=N
    /// - O(文件大小)，按需调用（不在热路径）
    pub fn replay_disk_after(&self, last_seq: u64) -> Vec<SessionEvent> {
        let Some(path) = self.log_path.lock().expect("log path poisoned").clone() else {
            return Vec::new();
        };
        let Ok(content) = std::fs::read_to_string(&path) else {
            return Vec::new();
        };

        let mut events = Vec::new();
        // 行序重建计数器：仅在解析后 seq==0 的旧格式事件上使用
        let mut row_seq: u64 = 0;
        for line in content.lines() {
            let line = line.trim();
            if line.is_empty() {
                continue;
            }
            let Ok(mut event) = serde_json::from_str::<SessionEvent>(line) else {
                continue;
            };
            row_seq += 1;
            if event.seq == 0 {
                // 旧格式（无 seq 字段）：按行序重分配
                event.seq = row_seq;
            }
            if event.seq > last_seq {
                events.push(event);
            }
        }
        events
    }

    /// 当前最大 seq
    pub fn current_seq(&self) -> u64 {
        self.seq.load(Ordering::Relaxed)
    }

    /// 从已有 events.log 恢复 seq 游标，避免重启后序号回绕冲突。
    fn restore_seq_from_disk(&self) {
        let Some(path) = self.log_path.lock().ok().and_then(|guard| guard.clone()) else {
            return;
        };
        let max = max_seq_on_disk(&path);
        if max > 0 {
            self.seq.store(max, Ordering::Relaxed);
        }
    }

    /// 会话投影快照路径：与 events.log 同级的 `checkpoints/<session_id>.json`
    pub(crate) fn projection_checkpoint_path(&self, session_id: &str) -> Option<PathBuf> {
        let name = sanitize_session_id(session_id);
        if name.is_empty() {
            return None;
        }
        let log_path = self.log_path.lock().ok()?.clone()?;
        let parent = log_path.parent()?;
        Some(parent.join("checkpoints").join(format!("{name}.json")))
    }

    fn load_projection_checkpoint(&self, session_id: &str) -> Option<SessionProjectionCheckpoint> {
        let path = self.projection_checkpoint_path(session_id)?;
        let json = std::fs::read_to_string(path).ok()?;
        let snap: SessionProjectionCheckpoint = serde_json::from_str(&json).ok()?;
        if snap.session_id != session_id {
            return None;
        }
        Some(snap)
    }

    /// 将会话投影快照写入 `.sacode/checkpoints/<session_id>.json`。
    /// 空 session_id、纯内存模式或 IO 失败时静默跳过，不影响会话主路径。
    pub fn save_projection_checkpoint(&self, session_id: &str) {
        let Some(path) = self.projection_checkpoint_path(session_id) else {
            return;
        };
        if let Some(parent) = path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        let stats = self.project_session_state_complete(session_id);
        let snap = SessionProjectionCheckpoint {
            session_id: session_id.to_string(),
            last_seq: stats.last_seq,
            stats,
            ts: chrono::Utc::now().to_rfc3339(),
        };
        if let Ok(json) = serde_json::to_string_pretty(&snap) {
            let _ = std::fs::write(path, json);
        }
    }

    /// 全量投影：优先以会话 checkpoint 为基底，只重放 `last_seq` 之后的增量。
    ///
    /// - 快照损坏或缺失时退化为磁盘全量 + 内存增量（事件日志为最终真相）
    /// - 磁盘不可用（纯内存模式）：退化为内存投影，`truncated` 依据淘汰计数
    /// - 复杂度：有快照时 O(增量)，无快照时 O(文件大小 + 缓冲大小)
    pub fn project_session_state_complete(&self, session_id: &str) -> SessionStateProjection {
        if let Some(snap) = self.load_projection_checkpoint(session_id) {
            let mut projection = snap.stats;
            projection.session_id = session_id.to_string();
            self.apply_events_after(&mut projection, session_id, snap.last_seq);
            projection.truncated = false;
            return projection;
        }
        self.project_session_state_from_log(session_id)
    }

    fn project_session_state_from_log(&self, session_id: &str) -> SessionStateProjection {
        let mut projection = SessionStateProjection {
            session_id: session_id.to_string(),
            ..Default::default()
        };

        let disk_events = self.replay_disk_after(0);
        if !disk_events.is_empty() {
            let disk_max_seq = disk_events.iter().map(|e| e.seq).max().unwrap_or(0);
            for event in disk_events.iter().filter(|e| e.session_id == session_id) {
                apply_event(&mut projection, event);
            }
            let buf = self.buffer.lock().expect("session event buffer poisoned");
            for event in buf
                .iter()
                .filter(|e| e.session_id == session_id && e.seq > disk_max_seq)
            {
                apply_event(&mut projection, event);
            }
            projection.truncated = false;
        } else {
            let buf = self.buffer.lock().expect("session event buffer poisoned");
            for event in buf.iter().filter(|e| e.session_id == session_id) {
                apply_event(&mut projection, event);
            }
            let evicted = self.evicted_total.load(Ordering::Relaxed);
            projection.truncated = evicted > 0;
        }
        projection
    }

    fn apply_events_after(
        &self,
        projection: &mut SessionStateProjection,
        session_id: &str,
        last_seq: u64,
    ) {
        let disk_events = self.replay_disk_after(last_seq);
        let disk_max_seq = disk_events.iter().map(|e| e.seq).max().unwrap_or(last_seq);
        for event in disk_events.iter().filter(|e| e.session_id == session_id) {
            apply_event(projection, event);
        }
        let buf = self.buffer.lock().expect("session event buffer poisoned");
        for event in buf
            .iter()
            .filter(|e| e.session_id == session_id && e.seq > disk_max_seq)
        {
            apply_event(projection, event);
        }
    }

    /// 从事件流投影出会话级状态摘要
    ///
    /// **限制**（R7）：投影只扫描进程内共享内存缓冲（默认 [`Self::DEFAULT_CAPACITY`]
    /// = 4096 条，跨所有会话共享）。缓冲满后最旧事件被环状淘汰，**淘汰后的计数会
    /// 静默偏低**。`truncated` 标志暴露淘汰状态（内存模式且淘汰过 → true）。
    ///
    /// 需要全量精确投影时使用 [`Self::project_session_state_complete`]（磁盘合并）。
    pub fn project_session_state(&self, session_id: &str) -> SessionStateProjection {
        let buf = self.buffer.lock().expect("session event buffer poisoned");
        let mut projection = SessionStateProjection {
            session_id: session_id.to_string(),
            ..Default::default()
        };

        for event in buf.iter().filter(|e| e.session_id == session_id) {
            apply_event(&mut projection, event);
        }
        let evicted = self.evicted_total.load(Ordering::Relaxed);
        projection.truncated = evicted > 0;
        projection
    }
}

/// 把单条事件投影进状态摘要（磁盘回放与内存增量共用）
fn apply_event(projection: &mut SessionStateProjection, event: &SessionEvent) {
    projection.last_seq = event.seq;
    match event.event_type {
        SessionEventType::ToolCallStarted => {
            projection.total_calls += 1;
            if let Some(name) = event.data.get("tool").and_then(|v| v.as_str()) {
                projection.last_tool = Some(name.to_string());
            }
        }
        SessionEventType::ToolCallFinished => {
            let success = event
                .data
                .get("status")
                .and_then(|v| v.as_str())
                .is_some_and(|s| s == "success");
            if success {
                projection.completed += 1;
            } else {
                projection.failed += 1;
            }
        }
        SessionEventType::ToolCallDenied => {
            projection.denied += 1;
        }
    }
}

/// 会话级状态投影 — 从事件流重建的统计摘要
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct SessionStateProjection {
    pub session_id: String,
    pub total_calls: u32,
    pub completed: u32,
    pub failed: u32,
    pub denied: u32,
    pub last_tool: Option<String>,
    pub last_seq: u64,
    /// 投影是否因内存缓冲环状淘汰而不完整（磁盘不可用时内存投影置 true；
    /// 磁盘可用走全量投影时恒为 false）
    pub truncated: bool,
}

/// 会话级投影快照：作为 `project_session_state_complete` 的增量回放基底。
///
/// 损坏或缺失时忽略，退化为全量扫描 events.log。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionProjectionCheckpoint {
    pub session_id: String,
    pub stats: SessionStateProjection,
    pub last_seq: u64,
    pub ts: String,
}

fn sanitize_session_id(session_id: &str) -> String {
    session_id
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '-' || c == '_' {
                c
            } else {
                '_'
            }
        })
        .collect()
}

fn max_seq_on_disk(path: &Path) -> u64 {
    let Ok(content) = std::fs::read_to_string(path) else {
        return 0;
    };
    let mut row_seq = 0u64;
    let mut max_seq = 0u64;
    for line in content.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        let Ok(event) = serde_json::from_str::<SessionEvent>(line) else {
            continue;
        };
        row_seq += 1;
        let seq = if event.seq == 0 { row_seq } else { event.seq };
        if seq > max_seq {
            max_seq = seq;
        }
    }
    max_seq
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 测试日志：纯内存模式（无落盘路径，不写真实 `.sacode/events.log`）
    fn fresh_log() -> SessionEventLog {
        SessionEventLog::new_with_path(16, None)
    }

    /// 纯内存测试日志（无落盘路径，语义同 fresh_log，命名更明确）
    fn fresh_mem_log() -> SessionEventLog {
        SessionEventLog::new_with_path(16, None)
    }

    /// 磁盘测试日志：注入 tempdir 落盘路径
    /// 返回 (log, TempDir) —— 调用方需持有 TempDir 保活（drop 会删除目录）
    fn fresh_disk_log() -> (SessionEventLog, tempfile::TempDir) {
        let dir = tempfile::tempdir().expect("tempdir");
        let path = dir.path().join("events.log");
        let log = SessionEventLog::new_with_path(16, Some(path));
        (log, dir)
    }

    #[test]
    fn project_session_state_counts_total_completed_failed_denied() {
        let log = fresh_log();
        let sid = "sess-1";
        log.record(
            sid,
            SessionEventType::ToolCallStarted,
            serde_json::json!({"tool": "fs.read"}),
        );
        log.record(
            sid,
            SessionEventType::ToolCallFinished,
            serde_json::json!({"status": "success"}),
        );
        log.record(
            sid,
            SessionEventType::ToolCallStarted,
            serde_json::json!({"tool": "shell.exec"}),
        );
        log.record(
            sid,
            SessionEventType::ToolCallFinished,
            serde_json::json!({"status": "failure"}),
        );
        log.record(
            sid,
            SessionEventType::ToolCallStarted,
            serde_json::json!({"tool": "fs.write"}),
        );
        log.record(
            sid,
            SessionEventType::ToolCallDenied,
            serde_json::json!({"reason": "blocked"}),
        );

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
        log.record(
            "a",
            SessionEventType::ToolCallStarted,
            serde_json::json!({"tool": "tool"}),
        );
        log.record(
            "b",
            SessionEventType::ToolCallFinished,
            serde_json::json!({"status": "success"}),
        );
        let p = log.project_session_state("a");
        assert_eq!(p.total_calls, 1);
        assert_eq!(p.completed, 0);
    }

    #[test]
    fn seq_persists_to_disk_and_replays_in_order() {
        let (log, _dir) = fresh_disk_log();
        let sid = "seq-sess";
        for i in 0..5 {
            log.record(
                sid,
                SessionEventType::ToolCallStarted,
                serde_json::json!({"tool": format!("tool-{i}")}),
            );
        }

        // 磁盘回放：全部事件（last_seq=0），seq 连续 1..=5 且有序
        let disk = log.replay_disk_after(0);
        assert_eq!(disk.len(), 5);
        let seqs: Vec<u64> = disk.iter().map(|e| e.seq).collect();
        assert_eq!(seqs, vec![1, 2, 3, 4, 5]);

        // 增量回放：seq > 2 → 3 条
        let after2 = log.replay_disk_after(2);
        assert_eq!(after2.len(), 3);
        assert_eq!(after2[0].seq, 3);

        // 内存回放与磁盘回放 seq 一致（连续性）
        let mem = log.replay_after(0);
        assert_eq!(mem.len(), 5);
        assert_eq!(mem.iter().map(|e| e.seq).collect::<Vec<_>>(), seqs);
    }

    #[test]
    fn replay_disk_handles_legacy_log_without_seq() {
        // 模拟旧日志（无 seq 字段）：按行序重分配 seq
        let dir = tempfile::tempdir().expect("tempdir");
        let path = dir.path().join("legacy.log");
        std::fs::write(
            &path,
            concat!(
                "{\"session_id\":\"legacy\",\"type\":\"tool_call_started\",\"data\":{\"name\":\"fs.read\"},\"ts\":\"2026-01-01T00:00:00Z\"}\n",
                "{\"session_id\":\"legacy\",\"type\":\"tool_call_finished\",\"data\":{\"success\":true},\"ts\":\"2026-01-01T00:00:01Z\"}\n",
            ),
        )
        .expect("write legacy log");

        let log = SessionEventLog::new_with_path(16, Some(path));
        let disk = log.replay_disk_after(0);
        assert_eq!(disk.len(), 2);
        // 行序重建：第 1 行 seq=1，第 2 行 seq=2
        assert_eq!(disk[0].seq, 1);
        assert_eq!(disk[1].seq, 2);
        assert_eq!(log.current_seq(), 2);
        // event_type 正确解析
        assert_eq!(disk[0].event_type, SessionEventType::ToolCallStarted);
        assert_eq!(disk[1].event_type, SessionEventType::ToolCallFinished);
    }

    #[test]
    fn projection_idempotent_memory_and_disk() {
        // 内存路径幂等
        let log = fresh_mem_log();
        let sid = "idem";
        log.record(
            sid,
            SessionEventType::ToolCallStarted,
            serde_json::json!({"tool": "a"}),
        );
        log.record(
            sid,
            SessionEventType::ToolCallFinished,
            serde_json::json!({"status": "success"}),
        );
        log.record(
            sid,
            SessionEventType::ToolCallStarted,
            serde_json::json!({"tool": "b"}),
        );
        log.record(
            sid,
            SessionEventType::ToolCallDenied,
            serde_json::json!({"reason": "x"}),
        );

        let p1 = log.project_session_state(sid);
        let p2 = log.project_session_state(sid);
        assert_eq!(p1.total_calls, p2.total_calls);
        assert_eq!(p1.completed, p2.completed);
        assert_eq!(p1.denied, p2.denied);
        assert_eq!(p1.last_seq, p2.last_seq);
        assert_eq!(p1.truncated, p2.truncated);

        // 磁盘路径幂等：new 一个指向同文件的新实例，投影结果一致
        let dir = tempfile::tempdir().expect("tempdir");
        let path = dir.path().join("events.log");
        let log_disk = SessionEventLog::new_with_path(16, Some(path.clone()));
        let sid = "idem-disk";
        log_disk.record(
            sid,
            SessionEventType::ToolCallStarted,
            serde_json::json!({"tool": "a"}),
        );
        log_disk.record(
            sid,
            SessionEventType::ToolCallFinished,
            serde_json::json!({"status": "success"}),
        );
        log_disk.record(
            sid,
            SessionEventType::ToolCallDenied,
            serde_json::json!({"reason": "y"}),
        );

        let p1 = log_disk.project_session_state_complete(sid);
        let p2 = log_disk.project_session_state_complete(sid);
        assert_eq!(p1.total_calls, p2.total_calls);
        assert_eq!(p1.completed, p2.completed);
        assert_eq!(p1.denied, p2.denied);
        assert_eq!(p1.last_seq, p2.last_seq);

        // 磁盘全量投影与内存投影计数一致（无淘汰时）
        let mem_p = log_disk.project_session_state(sid);
        assert_eq!(p1.total_calls, mem_p.total_calls);
        assert_eq!(p1.completed, mem_p.completed);
        assert_eq!(p1.denied, mem_p.denied);
    }

    #[test]
    fn projection_complete_survives_buffer_eviction() {
        // 容量 2，写 5 条事件：内存缓冲只留最后 2 条，
        // 磁盘全量投影应恢复全部计数，且 truncated=false
        let dir = tempfile::tempdir().expect("tempdir");
        let path = dir.path().join("events.log");
        let log = SessionEventLog::new_with_path(2, Some(path));
        let sid = "evict";
        for i in 0..5 {
            log.record(
                sid,
                SessionEventType::ToolCallStarted,
                serde_json::json!({"tool": format!("t{i}")}),
            );
        }

        // 内存投影：被淘汰 3 条，truncated=true
        let mem = log.project_session_state(sid);
        assert_eq!(mem.total_calls, 2);
        assert!(mem.truncated);

        // 全量投影：磁盘恢复全部 5 条，truncated=false
        let complete = log.project_session_state_complete(sid);
        assert_eq!(complete.total_calls, 5);
        assert!(!complete.truncated);
        assert_eq!(complete.last_seq, 5);
    }

    #[test]
    fn checkpoint_incremental_replay_matches_full_replay() {
        let (log, _dir) = fresh_disk_log();
        let sid = "ckpt-inc";
        for tool in ["a", "b", "c"] {
            log.record(
                sid,
                SessionEventType::ToolCallStarted,
                serde_json::json!({"tool": tool}),
            );
            log.record(
                sid,
                SessionEventType::ToolCallFinished,
                serde_json::json!({"status": "success"}),
            );
        }
        log.save_projection_checkpoint(sid);
        let after_snap = log.project_session_state_complete(sid);
        assert_eq!(after_snap.total_calls, 3);
        assert_eq!(after_snap.completed, 3);

        log.record(
            sid,
            SessionEventType::ToolCallStarted,
            serde_json::json!({"tool": "d"}),
        );
        log.record(
            sid,
            SessionEventType::ToolCallDenied,
            serde_json::json!({"reason": "blocked"}),
        );

        let incremental = log.project_session_state_complete(sid);
        let path = log
            .projection_checkpoint_path(sid)
            .expect("checkpoint path");
        std::fs::remove_file(&path).expect("remove snapshot for full replay");
        let full = log.project_session_state_complete(sid);
        assert_eq!(incremental.total_calls, full.total_calls);
        assert_eq!(incremental.completed, full.completed);
        assert_eq!(incremental.denied, full.denied);
        assert_eq!(incremental.last_seq, full.last_seq);
        assert_eq!(incremental.last_tool, full.last_tool);
        assert_eq!(incremental.total_calls, 4);
        assert_eq!(incremental.denied, 1);
    }

    #[test]
    fn checkpoint_survives_restart_and_corrupt_snapshot_falls_back() {
        let dir = tempfile::tempdir().expect("tempdir");
        let path = dir.path().join("events.log");
        let sid = "ckpt-restart";
        let log = SessionEventLog::new_with_path(16, Some(path.clone()));
        log.record(
            sid,
            SessionEventType::ToolCallStarted,
            serde_json::json!({"tool": "fs.read"}),
        );
        log.record(
            sid,
            SessionEventType::ToolCallFinished,
            serde_json::json!({"status": "success"}),
        );
        log.save_projection_checkpoint(sid);
        let original = log.project_session_state_complete(sid);
        assert_eq!(log.current_seq(), 2);

        let restarted = SessionEventLog::new_with_path(16, Some(path.clone()));
        assert_eq!(restarted.current_seq(), 2);
        let restored = restarted.project_session_state_complete(sid);
        assert_eq!(restored.total_calls, original.total_calls);
        assert_eq!(restored.completed, original.completed);
        assert_eq!(restored.last_seq, original.last_seq);
        assert!(!restored.truncated);

        restarted.record(
            sid,
            SessionEventType::ToolCallStarted,
            serde_json::json!({"tool": "fs.write"}),
        );
        assert_eq!(restarted.current_seq(), 3);

        let ckpt = restarted
            .projection_checkpoint_path(sid)
            .expect("checkpoint path");
        std::fs::write(&ckpt, "{not-json").expect("corrupt snapshot");
        let fallback = restarted.project_session_state_complete(sid);
        assert_eq!(fallback.total_calls, 2);
        assert_eq!(fallback.last_seq, 3);
        assert!(!fallback.truncated);
    }
}
