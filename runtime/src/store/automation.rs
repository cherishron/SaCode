//! 自动化规则与执行记录的持久化。
//!
//! 表结构见 `StoreDb::init_schema`：
//! - `automation_rules`：规则本体，`last_fired_at` 是调度水位（重启后不重复补触发）
//! - `automation_runs`：每次触发一条记录，任务终态时回填 status
//!
//! 所有方法复用 `StoreDb::acquire_lock` 的超时锁模式，禁止直接 `.lock()`。

use anyhow::{Context, Result};
use rusqlite::{params, OptionalExtension};

use super::db::StoreDb;

/// 自动化规则（与数据库行一一对应）
#[derive(Debug, Clone)]
pub struct AutomationRuleRecord {
    pub id: String,
    pub name: String,
    pub cron_expr: String,
    pub prompt: String,
    pub backend_id: Option<String>,
    pub enabled: bool,
    pub last_fired_at: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

/// 执行记录行
#[derive(Debug, Clone)]
pub struct AutomationRunRecord {
    pub id: String,
    pub rule_id: String,
    pub task_id: String,
    pub triggered_at: String,
    pub status: String,
}

impl AutomationRuleRecord {
    fn from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<Self> {
        Ok(Self {
            id: row.get("id")?,
            name: row.get("name")?,
            cron_expr: row.get("cron_expr")?,
            prompt: row.get("prompt")?,
            backend_id: row.get("backend_id")?,
            enabled: row.get::<_, i64>("enabled")? != 0,
            last_fired_at: row.get("last_fired_at")?,
            created_at: row.get("created_at")?,
            updated_at: row.get("updated_at")?,
        })
    }
}

impl AutomationRunRecord {
    fn from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<Self> {
        Ok(Self {
            id: row.get("id")?,
            rule_id: row.get("rule_id")?,
            task_id: row.get("task_id")?,
            triggered_at: row.get("triggered_at")?,
            status: row.get("status")?,
        })
    }
}

const RULE_COLUMNS: &str =
    "id, name, cron_expr, prompt, backend_id, enabled, last_fired_at, created_at, updated_at";
const RUN_COLUMNS: &str = "id, rule_id, task_id, triggered_at, status";

impl StoreDb {
    /// 列出全部规则（按创建时间倒序）
    pub fn list_automation_rules(&self) -> Result<Vec<AutomationRuleRecord>> {
        let connection = self.acquire_lock("list_automation_rules")?;
        let sql = format!(
            "SELECT {RULE_COLUMNS} FROM automation_rules ORDER BY created_at DESC, id DESC"
        );
        let mut statement = connection
            .prepare(&sql)
            .context("failed to prepare list_automation_rules")?;
        let rows = statement
            .query_map([], AutomationRuleRecord::from_row)?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(rows)
    }

    /// 列出启用的规则（scheduler 每 tick 调用）
    pub fn list_enabled_automation_rules(&self) -> Result<Vec<AutomationRuleRecord>> {
        let connection = self.acquire_lock("list_enabled_automation_rules")?;
        let sql = format!(
            "SELECT {RULE_COLUMNS} FROM automation_rules WHERE enabled = 1 ORDER BY created_at DESC, id DESC"
        );
        let mut statement = connection
            .prepare(&sql)
            .context("failed to prepare list_enabled_automation_rules")?;
        let rows = statement
            .query_map([], AutomationRuleRecord::from_row)?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(rows)
    }

    pub fn get_automation_rule(&self, rule_id: &str) -> Result<Option<AutomationRuleRecord>> {
        let connection = self.acquire_lock("get_automation_rule")?;
        let sql = format!("SELECT {RULE_COLUMNS} FROM automation_rules WHERE id = ?1");
        connection
            .query_row(&sql, params![rule_id], AutomationRuleRecord::from_row)
            .optional()
            .context("failed to query automation rule")
    }

    /// 插入规则（含 cron 校验已由调用方完成）
    pub fn insert_automation_rule(
        &self,
        rule_id: &str,
        name: &str,
        cron_expr: &str,
        prompt: &str,
        backend_id: Option<&str>,
        enabled: bool,
        now: &str,
    ) -> Result<()> {
        let connection = self.acquire_lock("insert_automation_rule")?;
        connection.execute(
            format!("INSERT INTO automation_rules({RULE_COLUMNS}) VALUES (?1, ?2, ?3, ?4, ?5, ?6, NULL, ?7, ?7)").as_str(),
            params![rule_id, name, cron_expr, prompt, backend_id, enabled as i64, now],
        )?;
        Ok(())
    }

    /// 更新规则字段；返回是否命中
    pub fn update_automation_rule(
        &self,
        rule_id: &str,
        name: &str,
        cron_expr: &str,
        prompt: &str,
        backend_id: Option<&str>,
        enabled: bool,
        now: &str,
    ) -> Result<bool> {
        let connection = self.acquire_lock("update_automation_rule")?;
        let affected = connection.execute(
            "
            UPDATE automation_rules SET
                name = ?1,
                cron_expr = ?2,
                prompt = ?3,
                backend_id = ?4,
                enabled = ?5,
                updated_at = ?6
            WHERE id = ?7
            ",
            params![
                name,
                cron_expr,
                prompt,
                backend_id,
                enabled as i64,
                now,
                rule_id
            ],
        )?;
        Ok(affected > 0)
    }

    pub fn delete_automation_rule(&self, rule_id: &str) -> Result<bool> {
        let connection = self.acquire_lock("delete_automation_rule")?;
        let affected = connection.execute(
            "DELETE FROM automation_rules WHERE id = ?1",
            params![rule_id],
        )?;
        // 一并清理执行历史，避免残留无主记录
        connection.execute(
            "DELETE FROM automation_runs WHERE rule_id = ?1",
            params![rule_id],
        )?;
        Ok(affected > 0)
    }

    pub fn set_automation_rule_enabled(
        &self,
        rule_id: &str,
        enabled: bool,
        now: &str,
    ) -> Result<bool> {
        let connection = self.acquire_lock("set_automation_rule_enabled")?;
        let affected = connection.execute(
            "UPDATE automation_rules SET enabled = ?1, updated_at = ?2 WHERE id = ?3",
            params![enabled as i64, now, rule_id],
        )?;
        Ok(affected > 0)
    }

    /// 原子认领某个计划时刻；仅原先读取的水位与更新时间仍匹配且规则仍启用时成功。
    pub fn claim_automation_occurrence(
        &self,
        rule_id: &str,
        expected_watermark: Option<&str>,
        expected_updated_at: &str,
        fire_at: &str,
        now: &str,
    ) -> Result<bool> {
        let connection = self.acquire_lock("claim_automation_occurrence")?;
        let affected = connection.execute(
            "UPDATE automation_rules SET last_fired_at = ?1, updated_at = ?2
             WHERE id = ?3 AND enabled = 1 AND last_fired_at IS ?4 AND updated_at = ?5
               AND (last_fired_at IS NULL OR last_fired_at < ?1)",
            params![
                fire_at,
                now,
                rule_id,
                expected_watermark,
                expected_updated_at
            ],
        )?;
        Ok(affected == 1)
    }

    pub fn insert_automation_run(
        &self,
        run_id: &str,
        rule_id: &str,
        task_id: &str,
        triggered_at: &str,
    ) -> Result<()> {
        let connection = self.acquire_lock("insert_automation_run")?;
        connection.execute(
            format!(
                "INSERT INTO automation_runs({RUN_COLUMNS}) VALUES (?1, ?2, ?3, ?4, 'running')"
            )
            .as_str(),
            params![run_id, rule_id, task_id, triggered_at],
        )?;
        Ok(())
    }

    /// 按 task_id 回填执行记录状态（任务终态时调用）
    pub fn update_automation_run_status(&self, task_id: &str, status: &str) -> Result<bool> {
        let connection = self.acquire_lock("update_automation_run_status")?;
        let affected = connection.execute(
            "UPDATE automation_runs SET status = ?1, updated_at = CURRENT_TIMESTAMP WHERE task_id = ?2",
            params![status, task_id],
        )?;
        Ok(affected > 0)
    }

    /// 执行历史（可按规则过滤，按触发时间倒序）
    pub fn list_automation_runs(
        &self,
        rule_id: Option<&str>,
        limit: usize,
    ) -> Result<Vec<AutomationRunRecord>> {
        let connection = self.acquire_lock("list_automation_runs")?;
        let capped = limit.clamp(1, 500);
        let sql = format!(
            "
            SELECT {RUN_COLUMNS} FROM automation_runs
            WHERE (?1 IS NULL OR rule_id = ?1)
            ORDER BY triggered_at DESC, id DESC
            LIMIT ?2
            "
        );
        let mut statement = connection
            .prepare(&sql)
            .context("failed to prepare list_automation_runs")?;
        let rows = statement
            .query_map(
                params![rule_id, capped as i64],
                AutomationRunRecord::from_row,
            )?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(rows)
    }
}
