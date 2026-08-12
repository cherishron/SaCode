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
