use serde::{Deserialize, Serialize};

use crate::event::Event;
use crate::schema::{Task, TaskState};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Checkpoint {
    pub task: Task,
    pub current_iteration: usize,
    pub current_step: usize,
    pub executed_tools: Vec<ToolRecord>,
    pub pending_approval: Option<String>,
    pub recent_events: Vec<Event>,
    pub created_at: String,
    pub updated_at: String,
    /// 任务状态（统一状态机）
    ///
    /// 旧 checkpoint 文件无此字段，反序列化时默认为 Pending。
    /// restore 时可据此判断任务原状态，决定是否恢复执行。
    #[serde(default)]
    pub status: TaskState,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolRecord {
    pub name: String,
    pub input: serde_json::Value,
    pub output: serde_json::Value,
    pub success: bool,
    pub timestamp: String,
}

impl Checkpoint {
    pub fn new(task: Task) -> Self {
        let now = chrono_now();
        Self {
            task,
            current_iteration: 0,
            current_step: 0,
            executed_tools: Vec::new(),
            pending_approval: None,
            recent_events: Vec::new(),
            created_at: now.clone(),
            updated_at: now,
            status: TaskState::Pending,
        }
    }

    /// 设置任务状态（统一状态机）
    pub fn set_status(&mut self, status: TaskState) {
        self.status = status;
        self.updated_at = chrono_now();
    }

    pub fn record_tool(
        &mut self,
        name: String,
        input: serde_json::Value,
        output: serde_json::Value,
        success: bool,
    ) {
        self.executed_tools.push(ToolRecord {
            name,
            input,
            output,
            success,
            timestamp: chrono_now(),
        });
        self.updated_at = chrono_now();
    }

    pub fn add_event(&mut self, event: Event) {
        self.recent_events.push(event);
        if self.recent_events.len() > 100 {
            self.recent_events.remove(0);
        }
        self.updated_at = chrono_now();
    }

    pub fn advance_step(&mut self) {
        self.current_step += 1;
        self.updated_at = chrono_now();
    }

    pub fn set_iteration(&mut self, iteration: usize) {
        self.current_iteration = iteration;
        self.updated_at = chrono_now();
    }

    pub fn set_pending_approval(&mut self, action: String) {
        self.pending_approval = Some(action);
        self.updated_at = chrono_now();
    }

    pub fn clear_pending_approval(&mut self) {
        self.pending_approval = None;
        self.updated_at = chrono_now();
    }
}

fn chrono_now() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default();
    format!("{}Z", now.as_secs())
}
