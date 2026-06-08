use std::{
    fs,
    path::{Path, PathBuf},
};

use anyhow::Result;
use chrono::Local;
use serde::{Deserialize, Serialize};

const TASKS_FILE: &str = ".sacode/tasks.json";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TaskStoreData {
    #[serde(default)]
    pub tasks: Vec<PersistentTask>,
    #[serde(default = "default_next_id")]
    pub next_id: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PersistentTask {
    pub id: u64,
    pub description: String,
    pub status: TaskStatus,
    pub priority: TaskPriority,
    pub created_at: String,
    pub updated_at: String,
    pub completed_at: Option<String>,
    #[serde(default)]
    pub tags: Vec<String>,
    pub notes: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum TaskStatus {
    Pending,
    InProgress,
    Completed,
    Cancelled,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize, Default)]
pub enum TaskPriority {
    Low,
    #[default]
    Medium,
    High,
}

#[derive(Debug, Clone)]
pub struct TaskStore {
    path: PathBuf,
}

impl TaskStore {
    pub fn new(workdir: &Path) -> Self {
        Self {
            path: workdir.join(TASKS_FILE),
        }
    }

    pub fn load(&self) -> Result<TaskStoreData> {
        if !self.path.exists() {
            return Ok(TaskStoreData::default());
        }

        let content = fs::read_to_string(&self.path)?;
        let mut data: TaskStoreData = serde_json::from_str(&content)?;
        normalize_tasks(&mut data);
        Ok(data)
    }

    pub fn save(&self, data: &TaskStoreData) -> Result<()> {
        if let Some(parent) = self.path.parent() {
            fs::create_dir_all(parent)?;
        }

        let mut normalized = data.clone();
        normalize_tasks(&mut normalized);
        fs::write(&self.path, serde_json::to_string_pretty(&normalized)?)?;
        Ok(())
    }

    pub fn list(&self) -> Result<Vec<PersistentTask>> {
        Ok(self.load()?.tasks)
    }

    pub fn add(&self, description: &str, priority: TaskPriority) -> Result<PersistentTask> {
        let description = description.trim();
        if description.is_empty() {
            anyhow::bail!("task description cannot be empty");
        }

        let now = now_string();
        let mut data = self.load()?;
        let task = PersistentTask {
            id: data.next_id,
            description: description.to_string(),
            status: TaskStatus::Pending,
            priority,
            created_at: now.clone(),
            updated_at: now,
            completed_at: None,
            tags: Vec::new(),
            notes: None,
        };
        data.next_id += 1;
        data.tasks.push(task.clone());
        self.save(&data)?;
        Ok(task)
    }

    pub fn get(&self, id: u64) -> Result<Option<PersistentTask>> {
        Ok(self.load()?.tasks.into_iter().find(|task| task.id == id))
    }

    pub fn update_description(&self, id: u64, description: &str) -> Result<PersistentTask> {
        let description = description.trim();
        if description.is_empty() {
            anyhow::bail!("task description cannot be empty");
        }

        let mut data = self.load()?;
        let task = find_task_mut(&mut data, id)?;
        task.description = description.to_string();
        task.updated_at = now_string();
        let updated = task.clone();
        self.save(&data)?;
        Ok(updated)
    }

    pub fn set_status(&self, id: u64, status: TaskStatus) -> Result<PersistentTask> {
        let mut data = self.load()?;
        let now = now_string();

        if status == TaskStatus::InProgress {
            for task in data
                .tasks
                .iter_mut()
                .filter(|task| task.status == TaskStatus::InProgress && task.id != id)
            {
                task.status = TaskStatus::Pending;
                task.updated_at = now.clone();
                task.completed_at = None;
            }
        }

        let task = find_task_mut(&mut data, id)?;
        task.status = status;
        task.updated_at = now.clone();
        task.completed_at = if status == TaskStatus::Completed {
            Some(now)
        } else {
            None
        };
        let updated = task.clone();
        self.save(&data)?;
        Ok(updated)
    }

    pub fn clear_completed(&self) -> Result<usize> {
        let mut data = self.load()?;
        let before = data.tasks.len();
        data.tasks
            .retain(|task| task.status != TaskStatus::Completed);
        let removed = before.saturating_sub(data.tasks.len());
        self.save(&data)?;
        Ok(removed)
    }

    pub fn export_markdown(&self) -> Result<String> {
        let tasks = self.list()?;
        let mut lines = vec!["# Tasks".to_string(), String::new()];

        if tasks.is_empty() {
            lines.push("当前没有持久化任务。".to_string());
            return Ok(lines.join("\n"));
        }

        for task in tasks {
            lines.push(format!(
                "- [{}] #{} {} ({}, {})",
                task.status.label(),
                task.id,
                task.description,
                task.priority.label(),
                task.updated_at,
            ));
        }

        Ok(lines.join("\n"))
    }

    pub fn path(&self) -> &Path {
        &self.path
    }
}

impl Default for TaskStoreData {
    fn default() -> Self {
        Self {
            tasks: Vec::new(),
            next_id: 1,
        }
    }
}

impl TaskStatus {
    pub fn label(self) -> &'static str {
        match self {
            Self::Pending => "PENDING",
            Self::InProgress => "IN_PROGRESS",
            Self::Completed => "COMPLETED",
            Self::Cancelled => "CANCELLED",
        }
    }

    fn rank(self) -> u8 {
        match self {
            Self::InProgress => 0,
            Self::Pending => 1,
            Self::Completed => 2,
            Self::Cancelled => 3,
        }
    }
}

impl TaskPriority {
    pub fn label(self) -> &'static str {
        match self {
            Self::Low => "LOW",
            Self::Medium => "MEDIUM",
            Self::High => "HIGH",
        }
    }

    fn rank(self) -> u8 {
        match self {
            Self::High => 0,
            Self::Medium => 1,
            Self::Low => 2,
        }
    }
}

fn find_task_mut(data: &mut TaskStoreData, id: u64) -> Result<&mut PersistentTask> {
    data.tasks
        .iter_mut()
        .find(|task| task.id == id)
        .ok_or_else(|| anyhow::anyhow!("task not found: {}", id))
}

fn normalize_tasks(data: &mut TaskStoreData) {
    data.tasks.sort_by(|a, b| {
        a.status
            .rank()
            .cmp(&b.status.rank())
            .then(a.priority.rank().cmp(&b.priority.rank()))
            .then(b.updated_at.cmp(&a.updated_at))
            .then(a.id.cmp(&b.id))
    });

    let max_id = data.tasks.iter().map(|task| task.id).max().unwrap_or(0);
    if data.next_id <= max_id {
        data.next_id = max_id + 1;
    }
    if data.next_id == 0 {
        data.next_id = 1;
    }
}

fn now_string() -> String {
    Local::now().to_rfc3339()
}

fn default_next_id() -> u64 {
    1
}
