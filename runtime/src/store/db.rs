use std::{path::{Path, PathBuf}, sync::Mutex};

use anyhow::{Context, Result};
use async_trait::async_trait;
use rusqlite::{params, Connection, OptionalExtension};
use sacode_kernel::{ScheduledTask, TaskQueueStatus, TaskResult};

use crate::queue::TaskStore;

pub struct StoreDb {
    path: PathBuf,
    connection: Mutex<Connection>,
}

impl StoreDb {
    pub fn new(path: impl AsRef<Path>) -> Result<Self> {
        let path = path.as_ref().to_path_buf();
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).with_context(|| {
                format!("failed to create task store directory: {}", parent.display())
            })?;
        }

        let connection = Connection::open(&path)
            .with_context(|| format!("failed to open task store db: {}", path.display()))?;

        let db = Self {
            path,
            connection: Mutex::new(connection),
        };
        db.init_schema()?;
        Ok(db)
    }

    pub fn from_workspace(workspace_root: impl AsRef<Path>) -> Result<Self> {
        let path = workspace_root.as_ref().join(".sacode").join("task-store.sqlite3");
        Self::new(path)
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    fn init_schema(&self) -> Result<()> {
        let connection = self.connection.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
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
        let connection = self.connection.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
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
        let connection = self.connection.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        connection.execute(
            "UPDATE tasks SET status = ?2, updated_at = CURRENT_TIMESTAMP WHERE task_id = ?1",
            params![task_id, status.to_string()],
        )?;
        Ok(())
    }

    async fn save_result(&self, result: &TaskResult) -> Result<()> {
        let result_json = Self::serialize_result(result)?;
        let connection = self.connection.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
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
        let connection = self.connection.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
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
        let connection = self.connection.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
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
}

impl StoreDb {
    pub async fn load_result(&self, task_id: &str) -> Result<Option<TaskResult>> {
        let connection = self.connection.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
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
