use std::{
    collections::HashSet,
    env, fs,
    hash::{Hash, Hasher},
    io,
    path::PathBuf,
};

use super::{App, Message, MessageRole, SessionInfo, StoredMessage, StoredSessionSummary};

#[derive(serde::Serialize, serde::Deserialize)]
struct StoredSession {
    id: String,
    updated_at: String,
    messages: Vec<StoredMessage>,
    summary: Option<StoredSessionSummary>,
    title: String,
    #[serde(default)]
    session_auto_approve_edits: bool,
}

impl App {
    pub(super) fn project_session_dir(&self) -> PathBuf {
        self.workdir.join(".sacode").join("sessions")
    }

    pub(super) fn user_session_dir(&self) -> PathBuf {
        let home = env::var_os("HOME")
            .map(PathBuf::from)
            .unwrap_or_else(|| PathBuf::from("."));
        home.join(".sacode")
            .join("sessions")
            .join("by-workspace")
            .join(self.workspace_hash())
    }

    pub(super) fn project_current_session_path(&self) -> PathBuf {
        self.project_session_dir().join("current.json")
    }

    pub(super) fn user_session_path(&self, session_id: &str) -> PathBuf {
        self.user_session_dir().join(format!("{}.json", session_id))
    }

    pub(super) fn legacy_project_session_path(&self, session_id: &str) -> PathBuf {
        self.project_session_dir()
            .join(format!("{}.json", session_id))
    }

    pub(super) fn ensure_session_dirs(&self) -> io::Result<()> {
        fs::create_dir_all(self.project_session_dir())?;
        fs::create_dir_all(self.user_session_dir())
    }

    pub(super) fn workspace_hash(&self) -> String {
        let mut hasher = std::collections::hash_map::DefaultHasher::new();
        self.workdir.to_string_lossy().hash(&mut hasher);
        format!("{:x}", hasher.finish())
    }

    pub(super) fn session_title(&self) -> String {
        self.messages
            .iter()
            .rev()
            .find(|message| message.role == MessageRole::User)
            .map(|message| {
                message
                    .content
                    .lines()
                    .next()
                    .unwrap_or("新会话")
                    .chars()
                    .take(36)
                    .collect()
            })
            .unwrap_or_else(|| "新会话".to_string())
    }

    pub(super) fn serialize_messages(&self) -> Vec<StoredMessage> {
        self.messages
            .iter()
            .map(|message| StoredMessage {
                role: match message.role {
                    MessageRole::User => "user".to_string(),
                    MessageRole::Assistant => "assistant".to_string(),
                    MessageRole::System => "system".to_string(),
                },
                content: message.content.clone(),
                timestamp: message.timestamp.clone(),
                collapsed: message.collapsed,
            })
            .collect()
    }

    pub(super) fn serialized_session_summary(&self) -> Option<StoredSessionSummary> {
        self.session_summary
            .as_ref()
            .map(|content| StoredSessionSummary {
                content: content.clone(),
                compressed_at: chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string(),
            })
    }

    pub(super) fn save_current_session(&self) {
        if self.ensure_session_dirs().is_err() {
            return;
        }
        let session = StoredSession {
            id: self.session_id.clone(),
            updated_at: chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string(),
            messages: self.serialize_messages(),
            summary: self.serialized_session_summary(),
            title: self.session_title(),
            session_auto_approve_edits: self.session_auto_approve_edits,
        };
        let Ok(serialized) = serde_json::to_string(&session) else {
            return;
        };
        let _ = fs::write(self.project_current_session_path(), &serialized);
        let _ = fs::write(self.user_session_path(&self.session_id), serialized);
    }

    pub(super) fn load_latest_session(&mut self) {
        let current_path = self.project_current_session_path();
        if current_path.exists() {
            self.load_session_from_path(current_path, false);
            return;
        }
        let sessions = self.list_sessions();
        if let Some(session) = sessions.first() {
            self.load_session_by_id(&session.id, false);
        } else {
            self.save_current_session();
        }
    }

    pub(super) fn list_sessions(&self) -> Vec<SessionInfo> {
        let mut seen = HashSet::new();
        let mut sessions = self.read_sessions_from_dir(&self.user_session_dir(), &mut seen);
        sessions.extend(self.read_sessions_from_dir(&self.project_session_dir(), &mut seen));

        sessions.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
        sessions
    }

    pub(super) fn load_session_by_id(&mut self, session_id: &str, announce: bool) {
        let user_path = self.user_session_path(session_id);
        let path = if user_path.exists() {
            user_path
        } else {
            self.legacy_project_session_path(session_id)
        };
        self.load_session_from_path(path, announce);
    }

    pub(super) fn read_sessions_from_dir(
        &self,
        dir: &std::path::Path,
        seen: &mut HashSet<String>,
    ) -> Vec<SessionInfo> {
        let Ok(entries) = fs::read_dir(dir) else {
            return Vec::new();
        };

        entries
            .flatten()
            .filter(|entry| entry.path().extension().and_then(|ext| ext.to_str()) == Some("json"))
            .filter_map(|entry| fs::read_to_string(entry.path()).ok())
            .filter_map(|content| serde_json::from_str::<serde_json::Value>(&content).ok())
            .filter_map(|value| {
                let id = value.get("id")?.as_str()?.to_string();
                if !seen.insert(id.clone()) {
                    return None;
                }
                Some(SessionInfo {
                    id,
                    updated_at: value
                        .get("updated_at")
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string(),
                    title: value
                        .get("title")
                        .and_then(|v| v.as_str())
                        .unwrap_or("新会话")
                        .to_string(),
                })
            })
            .collect()
    }

    pub(super) fn load_session_from_path(&mut self, path: PathBuf, announce: bool) {
        let Ok(content) = fs::read_to_string(path) else {
            return;
        };
        let Ok(value) = serde_json::from_str::<StoredSession>(&content) else {
            return;
        };
        self.session_id = value.id;
        self.session_summary = value.summary.map(|summary| summary.content);
        self.session_auto_approve_edits = value.session_auto_approve_edits;
        self.replace_messages(
            value
                .messages
                .iter()
                .map(|message| Message {
                    role: match message.role.as_str() {
                        "user" => MessageRole::User,
                        "assistant" => MessageRole::Assistant,
                        _ => MessageRole::System,
                    },
                    content: message.content.clone(),
                    timestamp: message.timestamp.clone(),
                    collapsed: message.collapsed,
                })
                .collect(),
        );
        self.scroll_to_bottom();
        if announce {
            self.push_success_message(&format!("已切换到会话 {}", self.session_id));
        }
    }

    pub(super) fn new_session_command(&mut self) {
        let now = chrono::Local::now();
        self.session_id = format!("session-{}", now.format("%Y%m%d%H%M%S"));
        self.replace_messages(vec![Message {
            role: MessageRole::System,
            content: "SaCode - 新会话\n\n上下键可浏览输入历史，/sessions 可切换历史会话。"
                .to_string(),
            timestamp: now.format("%Y-%m-%d %H:%M").to_string(),
            collapsed: false,
        }]);
        self.session_summary = None;
        self.session_auto_approve_edits = false;
        self.queue.queued_messages.clear();
        self.interaction.todo_plan = None;
        self.queue.processing = false;
        self.queue.active_task_id = None;
        self.active_task_started_at = None;
        self.queue.busy_message.clear();
        self.save_current_session();
        self.push_success_message("已创建新会话");
    }

    pub(super) fn clear_current_context(&mut self) {
        let now = chrono::Local::now();
        self.replace_messages(vec![Message {
            role: MessageRole::System,
            content: "当前会话上下文已清空。".to_string(),
            timestamp: now.format("%Y-%m-%d %H:%M").to_string(),
            collapsed: false,
        }]);
        self.session_summary = None;
        self.session_auto_approve_edits = false;
        self.queue.queued_messages.clear();
        self.interaction.todo_plan = None;
        self.queue.processing = false;
        self.queue.active_task_id = None;
        self.active_task_started_at = None;
        self.queue.busy_message.clear();
        self.save_current_session();
        self.scroll_to_bottom();
    }

    pub(super) fn open_session_selector(&mut self) {
        self.session_options = self.list_sessions();
        self.selected_session_index = self
            .session_options
            .iter()
            .position(|session| session.id == self.session_id)
            .unwrap_or(0);
        self.input_mode = super::InputMode::SessionSelect;
        self.push_system_message("已打开会话列表，使用上下方向键选择，Enter 切换，Esc 取消。");
    }
}
