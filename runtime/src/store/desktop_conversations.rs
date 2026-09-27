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
        }
        transaction.commit()?;
        Ok(task_ids)
    }
}
