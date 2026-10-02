//! 自动化调度后端：cron 规则 CRUD + 校验 + 手动触发 + 执行历史。
//!
//! ## cron 表达式
//!
//! 统一使用 **6 段**格式（含秒）：`sec min hour dom mon dow`。
//! `cron` crate 0.12 的标准解析即 6 段，前 5 段表达式会被拒绝，
//! 避免「5 段以为是每日、实际报错」的歧义。
//!
//! 触发判定与 next_run 计算一律按 **UTC**，返回 RFC3339；前端本地化展示。
//!
//! ## 触发路径
//!
//! 手动（`POST /rules/:id/run`）与定时（`scheduler` worker）**共用**
//! [`dispatch_task`](super::handlers::dispatch_task)，不绕过审批/审计/Changes 链路。

use std::sync::Arc;

use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use chrono::{DateTime, Utc};
use cron::Schedule;
use serde::{Deserialize, Serialize};
use std::str::FromStr;

use super::types::{DaemonState, TaskRequest};
use crate::store::automation::AutomationRunRecord;
use crate::store::StoreDb;

/// 自动化规则（API 视图）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AutomationRule {
    pub id: String,
    pub name: String,
    /// 6 段 cron（含秒）
    pub cron_expr: String,
    pub prompt: String,
    pub backend_id: Option<String>,
    pub enabled: bool,
    pub last_fired_at: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub next_run: Option<String>,
}

/// 执行历史条目（API 视图）
#[derive(Debug, Clone, Serialize)]
pub struct AutomationRun {
    pub id: String,
    pub rule_id: String,
    pub task_id: String,
    pub triggered_at: String,
    pub status: String,
}

#[derive(Debug, Deserialize)]
pub struct AutomationHistoryQuery {
    #[serde(default)]
    pub rule_id: Option<String>,
    #[serde(default)]
    pub limit: Option<usize>,
}

#[derive(Debug, Deserialize)]
pub struct CreateAutomationRuleRequest {
    pub name: String,
    pub cron_expr: String,
    pub prompt: String,
    #[serde(default)]
    pub backend_id: Option<String>,
    #[serde(default = "default_enabled")]
    pub enabled: bool,
}

#[derive(Debug, Deserialize)]
pub struct UpdateAutomationRuleRequest {
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub cron_expr: Option<String>,
    #[serde(default)]
    pub prompt: Option<String>,
    #[serde(default)]
    pub backend_id: Option<String>,
    #[serde(default)]
    pub enabled: Option<bool>,
}

fn default_enabled() -> bool {
    true
}

fn now_rfc3339() -> String {
    Utc::now().to_rfc3339()
}

fn generate_rule_id() -> String {
    format!("rule-{:032x}", rand::random::<u128>())
}

/// 校验并解析 cron 表达式，失败返回人话错误
pub fn parse_cron(expr: &str) -> Result<Schedule, String> {
    let trimmed = expr.trim();
    if trimmed.is_empty() {
        return Err("cron 表达式不能为空".to_string());
    }
    let field_count = trimmed.split_whitespace().count();
    if field_count != 6 {
        return Err(format!(
            "cron 表达式需要 6 段（秒 分 时 日 月 周），当前 {field_count} 段。示例：`0 30 9 * * *` 表示每天 09:30"
        ));
    }
    Schedule::from_str(trimmed).map_err(|error| format!("cron 表达式无效：{error}"))
}

/// 按 UTC 计算下次触发时间
pub fn next_run(schedule: &Schedule, after: DateTime<Utc>) -> Option<DateTime<Utc>> {
    schedule.after(&after).next()
}

/// 依据水位判断是否该触发：
/// 返回 `Some(next_fire)` 表示应触发并把水位推进到该时刻。
///
/// 规则：
/// - 取 `last_fired_at` 之后（严格晚于）的第一个计划时间
/// - 若存在且 <= now，则交给调度器判断是否仍在 60 秒有效窗口内
/// - 不会为未来的时间提前触发
pub fn should_fire(
    schedule: &Schedule,
    last_fired_at: Option<&str>,
    now: DateTime<Utc>,
) -> Option<DateTime<Utc>> {
    let watermark = last_fired_at
        .and_then(|raw| DateTime::parse_from_rfc3339(raw).ok())
        .map(|parsed| parsed.with_timezone(&Utc));
    let candidate = watermark.and_then(|watermark| schedule.after(&watermark).next());
    candidate.filter(|fire| *fire <= now)
}

fn store_of(state: &DaemonState) -> Option<Arc<StoreDb>> {
    state.store.clone()
}

fn api(value: serde_json::Value) -> Response {
    let status = value
        .get("status")
        .and_then(serde_json::Value::as_u64)
        .and_then(|code| StatusCode::from_u16(code as u16).ok())
        .unwrap_or(StatusCode::OK);
    (status, Json(value)).into_response()
}

fn respond_store_missing() -> Response {
    api(serde_json::json!({
        "error": "自动化存储不可用（task store 未启用）",
        "status": 503
    }))
}

fn rule_to_api(record: &crate::store::automation::AutomationRuleRecord) -> AutomationRule {
    let next = record
        .enabled
        .then(|| {
            Schedule::from_str(&record.cron_expr)
                .ok()
                .and_then(|schedule| next_run(&schedule, Utc::now()))
        })
        .flatten()
        .map(|value| value.to_rfc3339());
    AutomationRule {
        id: record.id.clone(),
        name: record.name.clone(),
        cron_expr: record.cron_expr.clone(),
        prompt: record.prompt.clone(),
        backend_id: record.backend_id.clone(),
        enabled: record.enabled,
        last_fired_at: record.last_fired_at.clone(),
        next_run: next,
    }
}

fn run_to_api(record: &AutomationRunRecord) -> AutomationRun {
    AutomationRun {
        id: record.id.clone(),
        rule_id: record.rule_id.clone(),
        task_id: record.task_id.clone(),
        triggered_at: record.triggered_at.clone(),
        status: record.status.clone(),
    }
}

/// GET /api/automation/rules
pub async fn list_rules(State(state): State<Arc<DaemonState>>) -> Response {
    let Some(store) = store_of(&state) else {
        return respond_store_missing();
    };
    match store.list_automation_rules() {
        Ok(records) => {
            let rules: Vec<AutomationRule> = records.iter().map(rule_to_api).collect();
            api(serde_json::json!({ "rules": rules }))
        }
        Err(error) => api(serde_json::json!({
            "error": format!("failed to list automation rules: {error}"),
            "status": 500
        })),
    }
}

/// POST /api/automation/rules
pub async fn create_rule(
    State(state): State<Arc<DaemonState>>,
    Json(req): Json<CreateAutomationRuleRequest>,
) -> Response {
    let Some(store) = store_of(&state) else {
        return respond_store_missing();
    };
    let name = req.name.trim().to_string();
    if name.is_empty() || name.len() > 200 {
        return api(serde_json::json!({ "error": "规则名称长度必须为 1-200 字节", "status": 400 }));
    }
    if req.prompt.trim().is_empty() || req.prompt.len() > 65_536 {
        return api(
            serde_json::json!({ "error": "规则提示词长度必须为 1-65536 字节", "status": 400 }),
        );
    }
    let schedule = match parse_cron(&req.cron_expr) {
        Ok(value) => value,
        Err(message) => return api(serde_json::json!({ "error": message, "status": 400 })),
    };
    let rule_id = generate_rule_id();
    let now = now_rfc3339();
    if let Err(error) = store.insert_automation_rule(
        &rule_id,
        &name,
        req.cron_expr.trim(),
        req.prompt.trim(),
        req.backend_id.as_deref(),
        req.enabled,
        &now,
    ) {
        return api(serde_json::json!({
            "error": format!("failed to create automation rule: {error}"),
            "status": 500
        }));
    }
    let next = req
        .enabled
        .then(|| next_run(&schedule, Utc::now()))
        .flatten()
        .map(|value| value.to_rfc3339());
    api(serde_json::json!({
        "rule": AutomationRule {
            id: rule_id,
            name,
            cron_expr: req.cron_expr.trim().to_string(),
            prompt: req.prompt.trim().to_string(),
            backend_id: req.backend_id,
            enabled: req.enabled,
            last_fired_at: None,
            next_run: next,
        }
    }))
}

/// PUT /api/automation/rules/:id
pub async fn update_rule(
    State(state): State<Arc<DaemonState>>,
    Path(rule_id): Path<String>,
    Json(req): Json<UpdateAutomationRuleRequest>,
) -> Response {
    let Some(store) = store_of(&state) else {
        return respond_store_missing();
    };
    let existing = match store.get_automation_rule(&rule_id) {
        Ok(Some(record)) => record,
        Ok(None) => return api(serde_json::json!({ "error": "规则不存在", "status": 404 })),
        Err(error) => {
            return api(serde_json::json!({
                "error": format!("failed to load automation rule: {error}"),
                "status": 500
            }))
        }
    };

    let name = req
        .name
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or(existing.name);
    let prompt = req
        .prompt
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or(existing.prompt);
    if name.is_empty() || name.len() > 200 || prompt.is_empty() || prompt.len() > 65_536 {
        return api(serde_json::json!({ "error": "规则名称或提示词长度无效", "status": 400 }));
    }
    let cron_expr = req.cron_expr.unwrap_or(existing.cron_expr);
    let schedule = match parse_cron(&cron_expr) {
        Ok(value) => value,
        Err(message) => return api(serde_json::json!({ "error": message, "status": 400 })),
    };
    let backend_id = req.backend_id.or(existing.backend_id);
    let enabled = req.enabled.unwrap_or(existing.enabled);

    let now = now_rfc3339();
    if let Err(error) = store.update_automation_rule(
        &rule_id,
        &name,
        cron_expr.trim(),
        &prompt,
        backend_id.as_deref(),
        enabled,
        &now,
    ) {
        return api(serde_json::json!({
            "error": format!("failed to update automation rule: {error}"),
            "status": 500
        }));
    }
    let next = enabled
        .then(|| next_run(&schedule, Utc::now()))
        .flatten()
        .map(|value| value.to_rfc3339());
    api(serde_json::json!({
        "rule": AutomationRule {
            id: rule_id,
            name,
            cron_expr: cron_expr.trim().to_string(),
            prompt,
            backend_id,
            enabled,
            last_fired_at: existing.last_fired_at,
            next_run: next,
        }
    }))
}

/// DELETE /api/automation/rules/:id
pub async fn delete_rule(
    State(state): State<Arc<DaemonState>>,
    Path(rule_id): Path<String>,
) -> Response {
    let Some(store) = store_of(&state) else {
        return respond_store_missing();
    };
    match store.delete_automation_rule(&rule_id) {
        Ok(true) => api(serde_json::json!({ "deleted": true, "id": rule_id })),
        Ok(false) => api(serde_json::json!({ "error": "规则不存在", "status": 404 })),
        Err(error) => api(serde_json::json!({
            "error": format!("failed to delete automation rule: {error}"),
            "status": 500
        })),
    }
}

/// POST /api/automation/rules/:id/toggle
pub async fn toggle_rule(
    State(state): State<Arc<DaemonState>>,
    Path(rule_id): Path<String>,
) -> Response {
    let Some(store) = store_of(&state) else {
        return respond_store_missing();
    };
    let existing = match store.get_automation_rule(&rule_id) {
        Ok(Some(record)) => record,
        Ok(None) => return api(serde_json::json!({ "error": "规则不存在", "status": 404 })),
        Err(error) => {
            return api(serde_json::json!({
                "error": format!("failed to load automation rule: {error}"),
                "status": 500
            }))
        }
    };
    let next_enabled = !existing.enabled;
    if let Err(error) = store.set_automation_rule_enabled(&rule_id, next_enabled, &now_rfc3339()) {
        return api(serde_json::json!({
            "error": format!("failed to toggle automation rule: {error}"),
            "status": 500
        }));
    }
    let next_run = next_enabled
        .then(|| {
            Schedule::from_str(&existing.cron_expr)
                .ok()
                .and_then(|schedule| next_run(&schedule, Utc::now()))
        })
        .flatten()
        .map(|value| value.to_rfc3339());
    api(serde_json::json!({
        "rule": AutomationRule {
            id: existing.id,
            name: existing.name,
            cron_expr: existing.cron_expr,
            prompt: existing.prompt,
            backend_id: existing.backend_id,
            enabled: next_enabled,
            last_fired_at: existing.last_fired_at,
            next_run,
        }
    }))
}

/// POST /api/automation/rules/:id/run — 手动立即执行
pub async fn run_rule(
    State(state): State<Arc<DaemonState>>,
    Path(rule_id): Path<String>,
) -> Response {
    let Some(store) = store_of(&state) else {
        return respond_store_missing();
    };
    let record = match store.get_automation_rule(&rule_id) {
        Ok(Some(record)) => record,
        Ok(None) => return api(serde_json::json!({ "error": "规则不存在", "status": 404 })),
        Err(error) => {
            return api(serde_json::json!({
                "error": format!("failed to load automation rule: {error}"),
                "status": 500
            }))
        }
    };
    let triggered_at = now_rfc3339();
    match trigger_rule(&state, &record, &triggered_at, false).await {
        Ok(outcome) => api(serde_json::json!({
            "run": run_to_api_outcome(&rule_id, &outcome),
            "task_id": outcome.task_id,
        })),
        Err(message) => api(serde_json::json!({ "error": message, "status": 500 })),
    }
}

fn run_to_api_outcome(rule_id: &str, outcome: &TriggerOutcome) -> AutomationRun {
    AutomationRun {
        id: outcome.run_id.clone(),
        rule_id: rule_id.to_string(),
        task_id: outcome.task_id.clone(),
        triggered_at: outcome.triggered_at.clone(),
        status: "running".to_string(),
    }
}

/// GET /api/automation/history?rule_id=&limit=
pub async fn list_history(
    State(state): State<Arc<DaemonState>>,
    Query(query): Query<AutomationHistoryQuery>,
) -> Response {
    let Some(store) = store_of(&state) else {
        return respond_store_missing();
    };
    let limit = query.limit.unwrap_or(50);
    match store.list_automation_runs(query.rule_id.as_deref(), limit) {
        Ok(records) => {
            let runs: Vec<AutomationRun> = records.iter().map(run_to_api).collect();
            api(serde_json::json!({ "runs": runs }))
        }
        Err(error) => api(serde_json::json!({
            "error": format!("failed to list automation history: {error}"),
            "status": 500
        })),
    }
}

/// 触发一次规则：dispatch_task + 写 runs；定时触发须先由 scheduler 原子认领水位。
/// 手动触发独立于 cron，不改变下一次计划执行时间。
pub(crate) struct TriggerOutcome {
    pub run_id: String,
    pub task_id: String,
    pub triggered_at: String,
}

pub(crate) async fn trigger_rule(
    state: &Arc<DaemonState>,
    record: &crate::store::automation::AutomationRuleRecord,
    triggered_at: &str,
    scheduled: bool,
) -> Result<TriggerOutcome, String> {
    DateTime::parse_from_rfc3339(triggered_at)
        .map_err(|error| format!("invalid trigger time: {error}"))?;

    let request = TaskRequest {
        prompt: format!("[automation:{}] {}", record.name, record.prompt),
        mode: "build".to_string(),
        priority: "normal".to_string(),
        dependencies: Vec::new(),
        retry_policy: None,
        scheduled_at: None,
        deadline: None,
        backend_id: record.backend_id.clone(),
        session_id: None,
        model_provider: None,
        model_name: None,
        skill: None,
        context_paths: Vec::new(),
        reasoning_effort: None,
        skills: Vec::new(),
        client_msg_id: None,
    };
    let task_id = super::handlers::dispatch_task(state, &request)
        .await
        .map(|(task_id, _, _)| task_id)
        .map_err(|error| match error {
            super::handlers::TaskDispatchError::SkillUnavailable { skill, .. } => {
                format!("skill not available: {skill}")
            }
            super::handlers::TaskDispatchError::BackendUnavailable { message, .. } => message,
            super::handlers::TaskDispatchError::QueueRejected { message, .. } => message,
        })?;

    let Some(store) = state.store.as_ref() else {
        return Err("task store unavailable".to_string());
    };
    let run_id = format!(
        "run-{}-{:x}",
        record.id,
        Utc::now().timestamp_nanos_opt().unwrap_or_default()
    );
    store
        .insert_automation_run(&run_id, &record.id, &task_id, triggered_at)
        .map_err(|error| format!("failed to record automation run: {error}"))?;
    if let Some(status) = state
        .tasks
        .read()
        .await
        .get(&task_id)
        .map(|task| task.derived_queue_status())
    {
        let terminal = match status {
            ref value if value == "completed" => Some("completed"),
            ref value if value == "failed" => Some("failed"),
            ref value if value == "cancelled" => Some("cancelled"),
            _ => None,
        };
        if let Some(terminal) = terminal {
            sync_automation_run_status(state, &task_id, terminal);
        }
    }
    super::events::emit_event(
        state,
        &task_id,
        "automation_triggered",
        serde_json::json!({
            "rule_id": record.id,
            "rule_name": record.name,
            "run_id": run_id,
            "task_id": task_id,
            "triggered_at": triggered_at,
            "scheduled": scheduled,
        }),
    );

    Ok(TriggerOutcome {
        run_id,
        task_id,
        triggered_at: triggered_at.to_string(),
    })
}

/// 任务终态时按 task_id 反查 automation_runs 并回填状态。
/// 返回是否命中（测试用）。
pub fn sync_automation_run_status(state: &DaemonState, task_id: &str, status: &str) -> bool {
    let Some(store) = state.store.as_ref() else {
        return false;
    };
    match store.update_automation_run_status(task_id, status) {
        Ok(hit) => hit,
        Err(error) => {
            tracing::warn!(?error, %task_id, "failed to update automation run status");
            false
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_cron_accepts_six_field_expression() {
        let schedule = parse_cron("0 30 9 * * *").expect("daily 09:30 should parse");
        let next = next_run(&schedule, Utc::now()).expect("has upcoming");
        assert!(next > Utc::now());
    }

    #[test]
    fn parse_cron_rejects_five_field_expression() {
        let error = parse_cron("30 9 * * *").expect_err("5 fields must be rejected");
        assert!(
            error.contains('6'),
            "error should mention 6 fields: {error}"
        );
    }

    #[test]
    fn parse_cron_rejects_garbage() {
        assert!(parse_cron("not a cron").is_err());
        assert!(parse_cron("   ").is_err());
    }

    #[test]
    fn parse_cron_rejects_out_of_range_values() {
        assert!(parse_cron("70 30 9 * * *").is_err(), "seconds > 59");
        assert!(parse_cron("0 30 25 * * *").is_err(), "hour 25");
    }

    #[test]
    fn should_fire_advances_once_past_due() {
        let schedule = parse_cron("0 * * * * *").expect("every minute");
        let now = Utc::now();
        // 水位在上一分钟 → 本分钟应触发
        let watermark = (now - chrono::Duration::minutes(2)).to_rfc3339();
        let fire = should_fire(&schedule, Some(&watermark), now);
        assert!(fire.is_some(), "past-due rule must fire");
    }

    #[test]
    fn should_fire_skips_future_watermark() {
        let schedule = parse_cron("0 * * * * *").expect("every minute");
        let now = Utc::now();
        // 水位在 5 分钟后 → next 计划时间仍远在未来，不应触发
        let watermark = (now + chrono::Duration::minutes(5)).to_rfc3339();
        assert!(should_fire(&schedule, Some(&watermark), now).is_none());
    }

    #[tokio::test]
    async fn rule_crud_history_and_persistence() {
        let temp = tempfile::tempdir().unwrap();
        let state = Arc::new(DaemonState::new_with_workdir(Some(temp.path().to_path_buf())).await);
        let store = state.store.as_ref().unwrap();
        let created = create_rule(
            State(state.clone()),
            Json(CreateAutomationRuleRequest {
                name: "每日检查".into(),
                cron_expr: "0 0 9 * * *".into(),
                prompt: "检查状态".into(),
                backend_id: None,
                enabled: true,
            }),
        )
        .await;
        assert_eq!(created.status(), StatusCode::OK);
        let rule = store
            .list_enabled_automation_rules()
            .unwrap()
            .pop()
            .unwrap();
        assert_eq!(rule.name, "每日检查");
        let updated = update_rule(
            State(state.clone()),
            Path(rule.id.clone()),
            Json(UpdateAutomationRuleRequest {
                name: Some("更新后".into()),
                cron_expr: Some("0 30 9 * * *".into()),
                prompt: Some("新任务".into()),
                backend_id: None,
                enabled: Some(true),
            }),
        )
        .await;
        assert_eq!(updated.status(), StatusCode::OK);
        assert_eq!(
            store
                .get_automation_rule(&rule.id)
                .unwrap()
                .unwrap()
                .cron_expr,
            "0 30 9 * * *"
        );
        let fire_at = (Utc::now() + chrono::Duration::seconds(1)).to_rfc3339();
        let updated_at = store
            .get_automation_rule(&rule.id)
            .unwrap()
            .unwrap()
            .updated_at;
        assert!(store
            .claim_automation_occurrence(&rule.id, None, &updated_at, &fire_at, &now_rfc3339())
            .unwrap());
        assert!(!store
            .claim_automation_occurrence(&rule.id, None, &updated_at, &fire_at, &now_rfc3339())
            .unwrap());
        let toggle = toggle_rule(State(state.clone()), Path(rule.id.clone())).await;
        assert_eq!(toggle.status(), StatusCode::OK);
        assert!(store.list_enabled_automation_rules().unwrap().is_empty());
        store
            .insert_automation_run("run-test", &rule.id, "task-test", &now_rfc3339())
            .unwrap();
        assert!(store
            .update_automation_run_status("task-test", "completed")
            .unwrap());
        let history = store.list_automation_runs(Some(&rule.id), 50).unwrap();
        assert_eq!(history[0].status, "completed");
        drop(state);
        let reopened = StoreDb::from_workspace(temp.path()).unwrap();
        assert_eq!(
            reopened
                .get_automation_rule(&rule.id)
                .unwrap()
                .unwrap()
                .name,
            "更新后"
        );
        assert_eq!(
            reopened.list_automation_runs(None, 50).unwrap()[0].task_id,
            "task-test"
        );
        let state = Arc::new(DaemonState::new_with_workdir(Some(temp.path().to_path_buf())).await);
        assert_eq!(
            delete_rule(State(state), Path(rule.id.clone()))
                .await
                .status(),
            StatusCode::OK
        );
        assert!(reopened
            .list_automation_runs(Some(&rule.id), 50)
            .unwrap()
            .is_empty());
    }

    #[test]
    fn should_fire_never_fired_rule_defers() {
        let schedule = parse_cron("0 0 0 1 1 *").expect("yearly");
        let now = Utc::now();
        // 从未触发过：只取 now 之后的计划时间，不补历史
        assert!(should_fire(&schedule, None, now).is_none());
    }
}
