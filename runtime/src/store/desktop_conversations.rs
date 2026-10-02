use anyhow::Result;
use rusqlite::params;

use super::StoreDb;

#[derive(Debug, Clone, serde::Serialize)]
pub struct DesktopTurn {
    pub task_id: String,
    pub conversation_id: String,
    pub prompt: String,
    pub created_at: String,
}

/// P0-3 回放帧
#[derive(Debug, Clone, serde::Serialize)]
pub struct DesktopFrame {
    pub seq: i64,
    pub kind: String,
    pub text: String,
    pub detail: Option<String>,
}

/// 契约 §3.2：会话级元数据（标题 / 归档 / 未读）
#[derive(Debug, Clone, serde::Serialize, Default)]
pub struct DesktopConversationMeta {
    pub conversation_id: String,
    pub title: Option<String>,
    pub archived: bool,
    pub unread: bool,
    pub updated_at: String,
}

/// 契约 §1.4：会话级设置（含草稿）
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, Default)]
pub struct DesktopConversationSettings {
    #[serde(default)]
    pub model_provider: Option<String>,
    #[serde(default)]
    pub model_name: Option<String>,
    #[serde(default)]
    pub reasoning_effort: Option<String>,
    #[serde(default)]
    pub skills: Option<Vec<String>>,
    #[serde(default)]
    pub draft: Option<String>,
}

/// 契约 §2.2：turn 级 settings_snapshot / usage / client_msg_id
#[derive(Debug, Clone, Default)]
pub struct DesktopTurnMeta {
    pub client_msg_id: Option<String>,
    pub settings_json: Option<String>,
    pub usage_json: Option<String>,
}

impl StoreDb {
    pub fn desktop_turns(&self, conversation_id: &str) -> Result<Vec<DesktopTurn>> {
        let connection = self.acquire_lock("desktop_turns")?;
        let mut query = connection.prepare("SELECT task_id, conversation_id, prompt, created_at FROM desktop_turns WHERE conversation_id = ?1 ORDER BY created_at, rowid")?;
        let rows = query.query_map(params![conversation_id], |row| {
            Ok(DesktopTurn {
                task_id: row.get(0)?,
                conversation_id: row.get(1)?,
                prompt: row.get(2)?,
                created_at: row.get(3)?,
            })
        })?;
        Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
    }

    pub fn desktop_conversations(&self) -> Result<Vec<DesktopTurn>> {
        let connection = self.acquire_lock("desktop_conversations")?;
        let mut query = connection.prepare("SELECT t.task_id, t.conversation_id, t.prompt, t.created_at FROM desktop_turns t WHERE t.rowid = (SELECT MIN(first.rowid) FROM desktop_turns first WHERE first.conversation_id = t.conversation_id) ORDER BY (SELECT MAX(last.rowid) FROM desktop_turns last WHERE last.conversation_id = t.conversation_id) DESC")?;
        let rows = query.query_map([], |row| {
            Ok(DesktopTurn {
                task_id: row.get(0)?,
                conversation_id: row.get(1)?,
                prompt: row.get(2)?,
                created_at: row.get(3)?,
            })
        })?;
        Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
    }

    /// P0-3：追加一条可回放帧（工具/助手/系统）
    pub fn append_desktop_frame(
        &self,
        task_id: &str,
        kind: &str,
        text: &str,
        detail: Option<&str>,
    ) -> Result<()> {
        let connection = self.acquire_lock("append_desktop_frame")?;
        connection.execute(
            "INSERT OR IGNORE INTO desktop_frames(task_id, seq, kind, text, detail)
             VALUES (?1, (SELECT COALESCE(MAX(seq), -1) + 1 FROM desktop_frames WHERE task_id = ?1), ?2, ?3, ?4)",
            params![task_id, kind, text, detail],
        )?;
        Ok(())
    }

    /// P0-3：读取任务全部回放帧（按 seq）
    pub fn desktop_frames(&self, task_id: &str) -> Result<Vec<DesktopFrame>> {
        let connection = self.acquire_lock("desktop_frames")?;
        let mut query = connection.prepare(
            "SELECT seq, kind, text, detail FROM desktop_frames WHERE task_id = ?1 ORDER BY seq",
        )?;
        let rows = query.query_map(params![task_id], |row| {
            Ok(DesktopFrame {
                seq: row.get(0)?,
                kind: row.get(1)?,
                text: row.get(2)?,
                detail: row.get(3)?,
            })
        })?;
        Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
    }

    pub fn find_conversation_for_task(&self, task_id: &str) -> Result<Option<String>> {
        let connection = self.acquire_lock("find_conversation_for_task")?;
        let mut query = connection.prepare(
            "SELECT conversation_id FROM desktop_turns WHERE task_id = ?1 ORDER BY rowid DESC LIMIT 1",
        )?;
        let mut rows = query.query_map(params![task_id], |row| row.get::<_, String>(0))?;
        Ok(rows.next().transpose()?)
    }

    pub fn save_desktop_turn(
        &self,
        conversation_id: &str,
        task_id: &str,
        prompt: &str,
    ) -> Result<()> {
        let connection = self.acquire_lock("save_desktop_turn")?;
        connection.execute(
            "INSERT INTO desktop_turns(task_id, conversation_id, prompt) VALUES (?1, ?2, ?3)",
            params![task_id, conversation_id, prompt],
        )?;
        Ok(())
    }

    pub fn delete_desktop_task(&self, task_id: &str) -> Result<()> {
        let mut connection = self.acquire_lock("delete_desktop_task")?;
        let transaction = connection.transaction()?;
        transaction.execute(
            "DELETE FROM desktop_turns WHERE task_id = ?1",
            params![task_id],
        )?;
        transaction.execute("DELETE FROM tasks WHERE task_id = ?1", params![task_id])?;
        transaction.execute(
            "DELETE FROM task_changes WHERE task_id = ?1",
            params![task_id],
        )?;
        transaction.commit()?;
        Ok(())
    }

    pub fn delete_desktop_conversation(&self, conversation_id: &str) -> Result<Vec<String>> {
        let mut connection = self.acquire_lock("delete_desktop_conversation")?;
        let transaction = connection.transaction()?;
        let task_ids = {
            let mut query = transaction
                .prepare("SELECT task_id FROM desktop_turns WHERE conversation_id = ?1")?;
            let ids = query
                .query_map(params![conversation_id], |row| row.get::<_, String>(0))?
                .collect::<rusqlite::Result<Vec<_>>>()?;
            ids
        };
        transaction.execute(
            "DELETE FROM desktop_turns WHERE conversation_id = ?1",
            params![conversation_id],
        )?;
        for task_id in &task_ids {
            transaction.execute("DELETE FROM tasks WHERE task_id = ?1", params![task_id])?;
            transaction.execute(
                "DELETE FROM task_changes WHERE task_id = ?1",
                params![task_id],
            )?;
            transaction.execute(
                "DELETE FROM desktop_turn_meta WHERE task_id = ?1",
                params![task_id],
            )?;
            transaction.execute(
                "DELETE FROM desktop_pending_questions WHERE task_id = ?1",
                params![task_id],
            )?;
            transaction.execute(
                "DELETE FROM desktop_pending_approvals WHERE task_id = ?1",
                params![task_id],
            )?;
            transaction.execute(
                "DELETE FROM desktop_frames WHERE task_id = ?1",
                params![task_id],
            )?;
        }
        transaction.execute(
            "DELETE FROM desktop_conversation_meta WHERE conversation_id = ?1",
            params![conversation_id],
        )?;
        transaction.execute(
            "DELETE FROM desktop_conversation_settings WHERE conversation_id = ?1",
            params![conversation_id],
        )?;
        transaction.commit()?;
        Ok(task_ids)
    }

    // ── 契约 §3.2：会话元数据（标题 / 归档 / 未读） ──────────────────────

    pub fn desktop_conversation_meta(&self, conversation_id: &str) -> Result<DesktopConversationMeta> {
        let connection = self.acquire_lock("desktop_conversation_meta")?;
        let mut query = connection.prepare(
            "SELECT conversation_id, title, archived, unread, updated_at
             FROM desktop_conversation_meta WHERE conversation_id = ?1",
        )?;
        let mut rows = query.query_map(params![conversation_id], |row| {
            Ok(DesktopConversationMeta {
                conversation_id: row.get(0)?,
                title: row.get(1)?,
                archived: row.get::<_, i64>(2)? != 0,
                unread: row.get::<_, i64>(3)? != 0,
                updated_at: row.get(4)?,
            })
        })?;
        Ok(rows.next().transpose()?.unwrap_or(DesktopConversationMeta {
            conversation_id: conversation_id.to_string(),
            ..Default::default()
        }))
    }

    pub fn save_desktop_conversation_meta(&self, meta: &DesktopConversationMeta) -> Result<()> {
        let connection = self.acquire_lock("save_desktop_conversation_meta")?;
        connection.execute(
            "INSERT INTO desktop_conversation_meta(conversation_id, title, archived, unread, updated_at)
             VALUES (?1, ?2, ?3, ?4, CURRENT_TIMESTAMP)
             ON CONFLICT(conversation_id) DO UPDATE SET
                title = COALESCE(?2, title),
                archived = ?3,
                unread = ?4,
                updated_at = CURRENT_TIMESTAMP",
            params![
                meta.conversation_id,
                meta.title,
                meta.archived as i64,
                meta.unread as i64
            ],
        )?;
        Ok(())
    }

    /// 会话不在任何分格且有新 turn 落盘 → unread = true
    pub fn mark_desktop_conversation_unread(&self, conversation_id: &str) -> Result<()> {
        let connection = self.acquire_lock("mark_desktop_conversation_unread")?;
        connection.execute(
            "INSERT INTO desktop_conversation_meta(conversation_id, title, archived, unread, updated_at)
             VALUES (?1, NULL, 0, 1, CURRENT_TIMESTAMP)
             ON CONFLICT(conversation_id) DO UPDATE SET unread = 1, updated_at = CURRENT_TIMESTAMP",
            params![conversation_id],
        )?;
        Ok(())
    }

    pub fn clear_desktop_conversation_unread(&self, conversation_id: &str) -> Result<()> {
        let connection = self.acquire_lock("clear_desktop_conversation_unread")?;
        connection.execute(
            "UPDATE desktop_conversation_meta SET unread = 0, updated_at = CURRENT_TIMESTAMP
             WHERE conversation_id = ?1",
            params![conversation_id],
        )?;
        Ok(())
    }

    // ── 契约 §1.4：会话设置（含草稿） ──────────────────────────────────

    pub fn desktop_conversation_settings(
        &self,
        conversation_id: &str,
    ) -> Result<Option<DesktopConversationSettings>> {
        let connection = self.acquire_lock("desktop_conversation_settings")?;
        let mut query = connection.prepare(
            "SELECT settings_json FROM desktop_conversation_settings WHERE conversation_id = ?1",
        )?;
        let mut rows =
            query.query_map(params![conversation_id], |row| row.get::<_, String>(0))?;
        let Some(json) = rows.next().transpose()? else {
            return Ok(None);
        };
        Ok(serde_json::from_str(&json).ok())
    }

    pub fn save_desktop_conversation_settings(
        &self,
        conversation_id: &str,
        settings: &DesktopConversationSettings,
    ) -> Result<()> {
        let connection = self.acquire_lock("save_desktop_conversation_settings")?;
        let json = serde_json::to_string(settings)?;
        connection.execute(
            "INSERT INTO desktop_conversation_settings(conversation_id, settings_json, updated_at)
             VALUES (?1, ?2, CURRENT_TIMESTAMP)
             ON CONFLICT(conversation_id) DO UPDATE SET
                settings_json = ?2, updated_at = CURRENT_TIMESTAMP",
            params![conversation_id, json],
        )?;
        Ok(())
    }

    // ── 契约 §2.2：turn meta（settings_snapshot / usage / client_msg_id） ──

    pub fn desktop_turn_meta(&self, task_id: &str) -> Result<Option<DesktopTurnMeta>> {
        let connection = self.acquire_lock("desktop_turn_meta")?;
        let mut query = connection.prepare(
            "SELECT client_msg_id, settings_json, usage_json FROM desktop_turn_meta WHERE task_id = ?1",
        )?;
        let mut rows = query.query_map(params![task_id], |row| {
            Ok(DesktopTurnMeta {
                client_msg_id: row.get(0)?,
                settings_json: row.get(1)?,
                usage_json: row.get(2)?,
            })
        })?;
        Ok(rows.next().transpose()?)
    }

    pub fn save_desktop_turn_meta(&self, task_id: &str, meta: &DesktopTurnMeta) -> Result<()> {
        let connection = self.acquire_lock("save_desktop_turn_meta")?;
        connection.execute(
            "INSERT INTO desktop_turn_meta(task_id, client_msg_id, settings_json, usage_json, updated_at)
             VALUES (?1, ?2, ?3, ?4, CURRENT_TIMESTAMP)
             ON CONFLICT(task_id) DO UPDATE SET
                client_msg_id = COALESCE(?2, client_msg_id),
                settings_json = COALESCE(?3, settings_json),
                usage_json = COALESCE(?4, usage_json),
                updated_at = CURRENT_TIMESTAMP",
            params![task_id, meta.client_msg_id, meta.settings_json, meta.usage_json],
        )?;
        Ok(())
    }

    /// 契约 §1.2：client_msg_id 幂等 —— 同会话内重发直接回既有 task
    pub fn find_task_by_client_msg_id(
        &self,
        conversation_id: &str,
        client_msg_id: &str,
    ) -> Result<Option<String>> {
        let connection = self.acquire_lock("find_task_by_client_msg_id")?;
        let mut query = connection.prepare(
            "SELECT t.task_id FROM desktop_turn_meta t
             JOIN desktop_turns turn ON turn.task_id = t.task_id
             WHERE turn.conversation_id = ?1 AND t.client_msg_id = ?2
             ORDER BY t.rowid DESC LIMIT 1",
        )?;
        let mut rows =
            query.query_map(params![conversation_id, client_msg_id], |row| row.get::<_, String>(0))?;
        Ok(rows.next().transpose()?)
    }

    // ── 契约 §12.6：挂起提问 / 审批跨重启恢复 ──────────────────────────

    pub fn save_pending_question(&self, task_id: &str, question_json: &str) -> Result<()> {
        let connection = self.acquire_lock("save_pending_question")?;
        connection.execute(
            "INSERT INTO desktop_pending_questions(task_id, question_json, created_at)
             VALUES (?1, ?2, CURRENT_TIMESTAMP)
             ON CONFLICT(task_id) DO UPDATE SET question_json = ?2",
            params![task_id, question_json],
        )?;
        Ok(())
    }

    pub fn load_pending_question(&self, task_id: &str) -> Result<Option<String>> {
        let connection = self.acquire_lock("load_pending_question")?;
        let mut query = connection.prepare(
            "SELECT question_json FROM desktop_pending_questions WHERE task_id = ?1",
        )?;
        let mut rows = query.query_map(params![task_id], |row| row.get::<_, String>(0))?;
        Ok(rows.next().transpose()?)
    }

    pub fn clear_pending_question(&self, task_id: &str) -> Result<()> {
        let connection = self.acquire_lock("clear_pending_question")?;
        connection.execute(
            "DELETE FROM desktop_pending_questions WHERE task_id = ?1",
            params![task_id],
        )?;
        Ok(())
    }

    pub fn save_pending_approval(
        &self,
        approval_id: &str,
        task_id: &str,
        tool_name: &str,
        args_json: Option<&str>,
    ) -> Result<()> {
        let connection = self.acquire_lock("save_pending_approval")?;
        connection.execute(
            "INSERT OR REPLACE INTO desktop_pending_approvals(approval_id, task_id, tool_name, args_json, status, created_at)
             VALUES (?1, ?2, ?3, ?4, 'pending', CURRENT_TIMESTAMP)",
            params![approval_id, task_id, tool_name, args_json],
        )?;
        Ok(())
    }

    pub fn resolve_pending_approval(&self, approval_id: &str, status: &str) -> Result<()> {
        let connection = self.acquire_lock("resolve_pending_approval")?;
        connection.execute(
            "UPDATE desktop_pending_approvals SET status = ?2 WHERE approval_id = ?1",
            params![approval_id, status],
        )?;
        Ok(())
    }

    pub fn list_pending_approvals(&self, task_id: &str) -> Result<Vec<serde_json::Value>> {
        let connection = self.acquire_lock("list_pending_approvals")?;
        let mut query = connection.prepare(
            "SELECT approval_id, tool_name, args_json, status, created_at
             FROM desktop_pending_approvals WHERE task_id = ?1 ORDER BY created_at",
        )?;
        let rows = query.query_map(params![task_id], |row| {
            Ok(serde_json::json!({
                "approval_id": row.get::<_, String>(0)?,
                "tool_name": row.get::<_, String>(1)?,
                "args_json": row.get::<_, Option<String>>(2)?,
                "status": row.get::<_, String>(3)?,
                "created_at": row.get::<_, String>(4)?,
            }))
        })?;
        Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
    }

    /// 重启后恢复：返回所有仍 pending 的审批
    pub fn all_pending_approvals(&self) -> Result<Vec<serde_json::Value>> {
        let connection = self.acquire_lock("all_pending_approvals")?;
        let mut query = connection.prepare(
            "SELECT approval_id, task_id, tool_name, args_json, status, created_at
             FROM desktop_pending_approvals WHERE status = 'pending' ORDER BY created_at",
        )?;
        let rows = query.query_map([], |row| {
            Ok(serde_json::json!({
                "approval_id": row.get::<_, String>(0)?,
                "task_id": row.get::<_, String>(1)?,
                "tool_name": row.get::<_, String>(2)?,
                "args_json": row.get::<_, Option<String>>(3)?,
                "status": row.get::<_, String>(4)?,
                "created_at": row.get::<_, String>(5)?,
            }))
        })?;
        Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
    }

    /// 重启后恢复：返回所有仍挂起的提问
    pub fn all_pending_questions(&self) -> Result<Vec<(String, String)>> {
        let connection = self.acquire_lock("all_pending_questions")?;
        let mut query = connection.prepare(
            "SELECT task_id, question_json FROM desktop_pending_questions ORDER BY created_at",
        )?;
        let rows = query.query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })?;
        Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
    }
}
