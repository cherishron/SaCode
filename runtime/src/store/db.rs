use std::{
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};

use anyhow::{Context, Result};
use async_trait::async_trait;
use rusqlite::{params, Connection, OptionalExtension};
use sacode_kernel::{ScheduledTask, TaskQueueStatus, TaskResult};
use tracing::warn;

use crate::queue::TaskStore;

/// 获取锁的最大等待时间（对齐 SessionService 的 LOCK_TIMEOUT）
const LOCK_TIMEOUT: Duration = Duration::from_secs(5);
/// 获取锁的重试间隔
const LOCK_RETRY_INTERVAL: Duration = Duration::from_millis(50);

pub struct StoreDb {
    path: PathBuf,
    // Arc 包装：允许未来在 spawn_blocking 中共享连接所有权；
    // 当前仍由本结构独占持有，但 Arc 让 lock helper 的签名更清晰
    connection: Arc<Mutex<Connection>>,
}

impl StoreDb {
    pub fn new(path: impl AsRef<Path>) -> Result<Self> {
        let path = path.as_ref().to_path_buf();
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).with_context(|| {
                format!(
                    "failed to create task store directory: {}",
                    parent.display()
                )
            })?;
        }

        let connection = Connection::open(&path)
            .with_context(|| format!("failed to open task store db: {}", path.display()))?;

        let db = Self {
            path,
            connection: Arc::new(Mutex::new(connection)),
        };
        db.init_schema()?;
        Ok(db)
    }

    pub fn from_workspace(workspace_root: impl AsRef<Path>) -> Result<Self> {
        let path = workspace_root
            .as_ref()
            .join(".sacode")
            .join("task-store.sqlite3");
        Self::new(path)
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    /// 带超时的锁获取 — 对齐 SessionService 的 try_lock + retry 模式
    ///
    /// 满足项目硬约束：所有 Mutex 获取必须用 timeout 包装，禁止直接 .lock()。
    /// 中毒时恢复而非 panic，避免其他线程 panic 导致整个存储不可用。
    fn acquire_lock(&self, operation: &str) -> Result<std::sync::MutexGuard<'_, Connection>> {
        let start = Instant::now();
        loop {
            match self.connection.try_lock() {
                Ok(guard) => return Ok(guard),
                Err(std::sync::TryLockError::WouldBlock) => {
                    if start.elapsed() >= LOCK_TIMEOUT {
                        warn!("StoreDb 锁超时: operation={}", operation);
                        anyhow::bail!(
                            "store db lock timed out after {:?} for '{}'",
                            LOCK_TIMEOUT,
                            operation
                        );
                    }
                    std::thread::sleep(LOCK_RETRY_INTERVAL);
                }
                Err(std::sync::TryLockError::Poisoned(e)) => {
                    warn!("StoreDb Mutex 中毒，尝试恢复: operation={}", operation);
                    return Ok(e.into_inner());
                }
            }
        }
    }

    fn init_schema(&self) -> Result<()> {
        let connection = self.acquire_lock("init_schema")?;
        connection.execute_batch(
            "
            CREATE TABLE IF NOT EXISTS tasks (
                task_id TEXT PRIMARY KEY,
                status TEXT NOT NULL,
                task_json TEXT NOT NULL,
                result_json TEXT,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );

            CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);

            CREATE TABLE IF NOT EXISTS sessions (
                id TEXT PRIMARY KEY,
                state_json TEXT NOT NULL,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );

            CREATE INDEX IF NOT EXISTS idx_sessions_updated ON sessions(updated_at);

            CREATE TABLE IF NOT EXISTS memory_entries (
                entry_id TEXT PRIMARY KEY,
                kind TEXT NOT NULL,
                scope TEXT NOT NULL,
                source TEXT NOT NULL,
                status TEXT NOT NULL,
                confidence REAL,
                content TEXT NOT NULL,
                context TEXT NOT NULL,
                file_name TEXT NOT NULL,
                created_at TEXT NOT NULL,
                last_accessed_at TEXT,
                access_count INTEGER NOT NULL DEFAULT 0,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );

            CREATE INDEX IF NOT EXISTS idx_memory_entries_kind ON memory_entries(kind);
            CREATE INDEX IF NOT EXISTS idx_memory_entries_status ON memory_entries(status);

            CREATE TABLE IF NOT EXISTS mistake_entries (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                summary TEXT NOT NULL,
                scope TEXT NOT NULL,
                detail TEXT NOT NULL,
                auto_learned INTEGER NOT NULL DEFAULT 1,
                created_at TEXT NOT NULL,
                UNIQUE(summary, scope)
            );
            ",
        )?;
        Ok(())
    }

    fn serialize_task(task: &ScheduledTask) -> Result<String> {
        serde_json::to_string(task).context("failed to serialize scheduled task")
    }

    fn serialize_result(result: &TaskResult) -> Result<String> {
        serde_json::to_string(result).context("failed to serialize task result")
    }

    fn deserialize_task(raw: &str) -> Result<ScheduledTask> {
        serde_json::from_str(raw).context("failed to deserialize scheduled task")
    }

    fn deserialize_result(raw: &str) -> Result<TaskResult> {
        serde_json::from_str(raw).context("failed to deserialize task result")
    }
}

#[async_trait]
impl TaskStore for StoreDb {
    async fn save(&self, task: &ScheduledTask) -> Result<()> {
        let task_json = Self::serialize_task(task)?;
        let status = if task.dependencies.is_empty() {
            TaskQueueStatus::Ready
        } else {
            TaskQueueStatus::Pending
        };
        let connection = self.acquire_lock("save")?;
        connection.execute(
            "
            INSERT INTO tasks(task_id, status, task_json, result_json, updated_at)
            VALUES (?1, ?2, ?3, NULL, CURRENT_TIMESTAMP)
            ON CONFLICT(task_id) DO UPDATE SET
                status = excluded.status,
                task_json = excluded.task_json,
                updated_at = CURRENT_TIMESTAMP
            ",
            params![task.id, status.to_string(), task_json],
        )?;
        Ok(())
    }

    async fn update_status(&self, task_id: &str, status: TaskQueueStatus) -> Result<()> {
        let connection = self.acquire_lock("update_status")?;
        connection.execute(
            "UPDATE tasks SET status = ?2, updated_at = CURRENT_TIMESTAMP WHERE task_id = ?1",
            params![task_id, status.to_string()],
        )?;
        Ok(())
    }

    async fn save_result(&self, result: &TaskResult) -> Result<()> {
        let result_json = Self::serialize_result(result)?;
        let connection = self.acquire_lock("save_result")?;
        connection.execute(
            "
            UPDATE tasks
            SET status = ?2, result_json = ?3, updated_at = CURRENT_TIMESTAMP
            WHERE task_id = ?1
            ",
            params![result.task_id, result.status.to_string(), result_json],
        )?;
        Ok(())
    }

    async fn load(&self, task_id: &str) -> Result<Option<ScheduledTask>> {
        let connection = self.acquire_lock("load")?;
        let raw = connection
            .query_row(
                "SELECT task_json FROM tasks WHERE task_id = ?1",
                params![task_id],
                |row| row.get::<_, String>(0),
            )
            .optional()?;

        raw.map(|value| Self::deserialize_task(&value)).transpose()
    }

    async fn load_pending(&self) -> Result<Vec<ScheduledTask>> {
        let connection = self.acquire_lock("load_pending")?;
        let mut statement = connection.prepare(
            "
            SELECT task_json
            FROM tasks
            WHERE status IN ('pending', 'ready', 'running', 'retrying')
            ORDER BY updated_at ASC, task_id ASC
            ",
        )?;
        let rows = statement.query_map([], |row| row.get::<_, String>(0))?;

        let mut tasks = Vec::new();
        for row in rows {
            tasks.push(Self::deserialize_task(&row?)?);
        }
        Ok(tasks)
    }

    /// 加载已记录结果的任务（completed/failed），返回 (任务, 结果) 列表
    ///
    /// 用于 daemon 重启后恢复历史结果到内存，使 `/task/:id/result`、
    /// `/task/:id/status` 等查询对历史任务可用，而非返回 not_found
    async fn load_results(&self) -> Result<Vec<(ScheduledTask, TaskResult)>> {
        let connection = self.acquire_lock("load_results")?;
        let mut statement = connection.prepare(
            "
            SELECT task_json, result_json
            FROM tasks
            WHERE result_json IS NOT NULL
            ORDER BY updated_at ASC, task_id ASC
            ",
        )?;
        let rows = statement.query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
            ))
        })?;

        let mut out = Vec::new();
        for row in rows {
            let (task_json, result_json) = row?;
            let task = Self::deserialize_task(&task_json)?;
            let result = Self::deserialize_result(&result_json)?;
            out.push((task, result));
        }
        Ok(out)
    }
}

impl StoreDb {
    pub async fn load_result(&self, task_id: &str) -> Result<Option<TaskResult>> {
        let connection = self.acquire_lock("load_result")?;
        let raw = connection
            .query_row(
                "SELECT result_json FROM tasks WHERE task_id = ?1",
                params![task_id],
                |row| row.get::<_, Option<String>>(0),
            )
            .optional()?;

        raw.flatten()
            .map(|value| Self::deserialize_result(&value))
            .transpose()
    }
}

// ============================================================================
// Session 持久化 — SessionService 通过这些方法把 SessionState 写入 SQLite
// ============================================================================

use crate::session::SessionState;

impl StoreDb {
    /// 保存或更新 session（upsert 语义）
    pub(crate) fn save_session(&self, state: &SessionState) -> Result<()> {
        let state_json = serde_json::to_string(state)
            .context("failed to serialize session state")?;
        let connection = self.acquire_lock("save_session")?;
        connection.execute(
            "
            INSERT INTO sessions(id, state_json, updated_at)
            VALUES (?1, ?2, CURRENT_TIMESTAMP)
            ON CONFLICT(id) DO UPDATE SET
                state_json = excluded.state_json,
                updated_at = CURRENT_TIMESTAMP
            ",
            params![state.id, state_json],
        )?;
        Ok(())
    }

    /// 按 id 加载单个 session
    pub(crate) fn load_session(&self, session_id: &str) -> Result<Option<SessionState>> {
        let connection = self.acquire_lock("load_session")?;
        let raw = connection
            .query_row(
                "SELECT state_json FROM sessions WHERE id = ?1",
                params![session_id],
                |row| row.get::<_, String>(0),
            )
            .optional()?;
        raw.map(|value| serde_json::from_str(&value).context("failed to deserialize session state"))
            .transpose()
    }

    /// 列出所有 session（按 updated_at 降序，最近的在前）
    pub(crate) fn list_sessions(&self) -> Result<Vec<SessionState>> {
        let connection = self.acquire_lock("list_sessions")?;
        let mut statement = connection.prepare(
            "SELECT state_json FROM sessions ORDER BY updated_at DESC, id ASC",
        )?;
        let rows = statement.query_map([], |row| row.get::<_, String>(0))?;
        let mut sessions = Vec::new();
        for row in rows {
            let json = row?;
            if let Ok(state) = serde_json::from_str::<SessionState>(&json) {
                sessions.push(state);
            }
            // 反序列化失败的行跳过，不阻塞其他 session 加载
        }
        Ok(sessions)
    }

    /// 删除指定 session
    pub fn delete_session(&self, session_id: &str) -> Result<()> {
        let connection = self.acquire_lock("delete_session")?;
        connection.execute("DELETE FROM sessions WHERE id = ?1", params![session_id])?;
        Ok(())
    }
}

// ============================================================================
// 灵枢 · 学习型记忆（M3）：SQLite 双写
//
// 记忆条目在写入 `.sacode/wiki/*.md`（文件，供人类阅读）的同时，同步写入
// `memory_entries` / `mistake_entries` 表（SQLite，供高效查询）。
// 写入顺序：先文件后 SQLite；SQLite 写入失败时回滚文件写入，保证双写一致性。
// ============================================================================

use crate::memory::{MemoryEntrySource, MemoryIndexEntry, MemoryKind, MemoryScope, MemoryStatus};

impl StoreDb {
    /// 保存记忆条目到 SQLite（与文件写入的原子性由调用方保证：先文件后 SQLite）
    pub fn save_memory_entry(&self, entry: &MemoryIndexEntry) -> Result<bool> {
        let connection = self.acquire_lock("save_memory_entry")?;
        let status = match entry.status {
            MemoryStatus::Candidate => "candidate",
            MemoryStatus::Active => "active",
            MemoryStatus::Archived => "archived",
            MemoryStatus::Rejected => "rejected",
        };
        let source = match entry.source {
            MemoryEntrySource::ManualAppend => "manual",
            MemoryEntrySource::AutoLearned => "auto",
        };
        let exists: bool = connection
            .query_row(
                "SELECT 1 FROM memory_entries WHERE entry_id = ?1",
                params![entry.id],
                |_| Ok(true),
            )
            .unwrap_or(false);
        if exists {
            connection.execute(
                "
                UPDATE memory_entries SET
                    kind = ?2, scope = ?3, source = ?4, status = ?5,
                    confidence = ?6, content = ?7, context = ?8, file_name = ?9,
                    last_accessed_at = ?10, access_count = ?11,
                    updated_at = CURRENT_TIMESTAMP
                WHERE entry_id = ?1
                ",
                params![
                    entry.id,
                    entry.kind.scope_label(),
                    if entry.scope.is_user() { "user" } else { "project" },
                    source,
                    status,
                    entry.confidence,
                    entry.content,
                    entry.context,
                    entry.file_name,
                    entry.last_accessed_at,
                    entry.access_count,
                ],
            )?;
        } else {
            connection.execute(
                "
                INSERT INTO memory_entries(
                    entry_id, kind, scope, source, status, confidence,
                    content, context, file_name, created_at,
                    last_accessed_at, access_count
                )
                VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)
                ",
                params![
                    entry.id,
                    entry.kind.scope_label(),
                    if entry.scope.is_user() { "user" } else { "project" },
                    source,
                    status,
                    entry.confidence,
                    entry.content,
                    entry.context,
                    entry.file_name,
                    entry.created_at,
                    entry.last_accessed_at,
                    entry.access_count,
                ],
            )?;
        }
        Ok(true)
    }

    /// 按状态查询记忆条目（用于高频/相关度查询，避免全量扫描文件）
    pub fn list_memory_entries_by_status(
        &self,
        status: MemoryStatus,
    ) -> Result<Vec<MemoryIndexEntry>> {
        let status_str = match status {
            MemoryStatus::Candidate => "candidate",
            MemoryStatus::Active => "active",
            MemoryStatus::Archived => "archived",
            MemoryStatus::Rejected => "rejected",
        };
        let connection = self.acquire_lock("list_memory_entries_by_status")?;
        let mut statement = connection.prepare(
            "SELECT entry_id, kind, scope, source, status, confidence, content, context, \
             file_name, created_at, last_accessed_at, access_count \
             FROM memory_entries WHERE status = ?1 ORDER BY created_at DESC, entry_id ASC",
        )?;
        let rows = statement.query_map(params![status_str], |row| {
            Ok((
                row.get::<_, String>(0)?,  // entry_id
                row.get::<_, String>(1)?,  // kind
                row.get::<_, String>(2)?,  // scope
                row.get::<_, String>(3)?,  // source
                row.get::<_, String>(4)?,  // status
                row.get::<_, Option<f32>>(5)?, // confidence
                row.get::<_, String>(6)?,  // content
                row.get::<_, String>(7)?,  // context
                row.get::<_, String>(8)?,  // file_name
                row.get::<_, String>(9)?,  // created_at
                row.get::<_, Option<String>>(10)?, // last_accessed_at
                row.get::<_, u32>(11)?,    // access_count
            ))
        })?;

        let mut out = Vec::new();
        for row in rows {
            let (
                id,
                kind,
                scope,
                source,
                status,
                confidence,
                content,
                context,
                file_name,
                created_at,
                last_accessed_at,
                access_count,
            ) = row?;
            out.push(MemoryIndexEntry {
                id,
                kind: kind_from_label(&kind),
                scope: if scope == "user" {
                    MemoryScope::User
                } else {
                    MemoryScope::Project
                },
                source: if source == "auto" {
                    MemoryEntrySource::AutoLearned
                } else {
                    MemoryEntrySource::ManualAppend
                },
                status: status_from_str(&status),
                confidence,
                content,
                context,
                file_name,
                created_at,
                last_accessed_at,
                access_count,
            });
        }
        Ok(out)
    }

    /// 保存 mistake 到 SQLite（与 mistakes.json 文件双写）
    pub fn save_mistake_entry(
        &self,
        summary: &str,
        scope: &str,
        detail: &str,
        auto_learned: bool,
        created_at: &str,
    ) -> Result<bool> {
        let connection = self.acquire_lock("save_mistake_entry")?;
        let result = connection.execute(
            "
            INSERT INTO mistake_entries(summary, scope, detail, auto_learned, created_at)
            VALUES (?1, ?2, ?3, ?4, ?5)
            ON CONFLICT(summary, scope) DO UPDATE SET
                detail = excluded.detail,
                auto_learned = excluded.auto_learned
            ",
            params![summary, scope, detail, auto_learned as i32, created_at],
        )?;
        Ok(result > 0)
    }

    /// 按频率/时间查询 mistakes（用于 Wiki 相关性加权）
    pub fn list_mistake_entries(&self) -> Result<Vec<(String, String, String)>> {
        let connection = self.acquire_lock("list_mistake_entries")?;
        let mut statement = connection.prepare(
            "SELECT summary, scope, detail FROM mistake_entries ORDER BY created_at DESC",
        )?;
        let rows = statement.query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
            ))
        })?;
        let mut out = Vec::new();
        for row in rows {
            out.push(row?);
        }
        Ok(out)
    }
}

fn kind_from_label(label: &str) -> MemoryKind {
    match label {
        "preference" => MemoryKind::Preference,
        "workflow" => MemoryKind::Workflow,
        "decision" => MemoryKind::Decision,
        _ => MemoryKind::General,
    }
}

fn status_from_str(value: &str) -> MemoryStatus {
    match value {
        "active" => MemoryStatus::Active,
        "archived" => MemoryStatus::Archived,
        "rejected" => MemoryStatus::Rejected,
        _ => MemoryStatus::Candidate,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_db(tag: &str) -> StoreDb {
        let dir = std::env::temp_dir().join(format!(
            "sacode_store_{}_{}",
            tag,
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("task-store.sqlite3");
        StoreDb::new(&path).unwrap()
    }

    #[test]
    fn memory_entries_roundtrip_and_query_by_status() {
        let db = temp_db("mem");
        let entry = MemoryIndexEntry {
            id: "gen-2026-01-01-test".to_string(),
            kind: MemoryKind::General,
            scope: MemoryScope::Project,
            source: MemoryEntrySource::AutoLearned,
            status: MemoryStatus::Candidate,
            confidence: Some(0.7),
            content: "auto learned pattern".to_string(),
            context: "from session".to_string(),
            file_name: MemoryKind::General.file_name().to_string(),
            created_at: "2026-01-01".to_string(),
            last_accessed_at: Some("2026-01-01".to_string()),
            access_count: 0,
        };
        assert!(db.save_memory_entry(&entry).unwrap());

        // 二次写入应为更新而非新增
        let mut updated = entry.clone();
        updated.status = MemoryStatus::Active;
        updated.access_count = 3;
        db.save_memory_entry(&updated).unwrap();

        let candidates = db.list_memory_entries_by_status(MemoryStatus::Candidate).unwrap();
        assert!(candidates.is_empty(), "更新后不应仍有 candidate");

        let active = db.list_memory_entries_by_status(MemoryStatus::Active).unwrap();
        assert_eq!(active.len(), 1);
        assert_eq!(active[0].id, "gen-2026-01-01-test");
        assert_eq!(active[0].access_count, 3);
        assert_eq!(active[0].source, MemoryEntrySource::AutoLearned);
    }

    #[test]
    fn mistake_entries_dedup_and_list() {
        let db = temp_db("mistake");
        assert!(db
            .save_mistake_entry("测试失败模式", "test", "detail", true, "2026-01-01")
            .unwrap());
        // 重复 (summary, scope) 应更新而非新增
        assert!(db
            .save_mistake_entry("测试失败模式", "test", "updated detail", true, "2026-01-02")
            .unwrap());
        assert!(db
            .save_mistake_entry("shell 错误", "shell", "detail", true, "2026-01-01")
            .unwrap());

        let list = db.list_mistake_entries().unwrap();
        assert_eq!(list.len(), 2, "重复 summary+scope 应合并为一条");
        assert!(list.iter().any(|(s, _, _)| s == "测试失败模式"));
        assert!(list.iter().any(|(s, _, _)| s == "shell 错误"));
    }
}
