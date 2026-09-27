//! 定时调度 worker：按 UTC 判断触发时机，经 dispatch_task 执行任务。

use std::sync::Arc;
use std::time::Duration;

use chrono::Utc;

use super::{automation, DaemonState};

pub fn spawn_automation_scheduler(state: Arc<DaemonState>) {
    tokio::spawn(async move {
        // 首次扫描也等待一个周期，避免重启时立即重放已经错过的时刻。
        let mut ticker = tokio::time::interval(Duration::from_secs(30));
        ticker.tick().await;
        loop {
            ticker.tick().await;
            let Some(store) = state.store.as_ref() else {
                continue;
            };
            let rules = match store.list_enabled_automation_rules() {
                Ok(rules) => rules,
                Err(error) => {
                    tracing::warn!(?error, "failed to load automation rules");
                    continue;
                }
            };
            let now = Utc::now();
            for rule in rules {
                let schedule = match automation::parse_cron(&rule.cron_expr) {
                    Ok(value) => value,
                    Err(error) => {
                        tracing::warn!(%error, rule_id = %rule.id, "invalid persisted cron rule");
                        continue;
                    }
                };
                let since = rule.last_fired_at.as_deref().or(Some(&rule.created_at));
                let Some(fire_at) = automation::should_fire(&schedule, since, now) else {
                    continue;
                };
                if now.signed_duration_since(fire_at).num_seconds() >= 60 {
                    match store.claim_automation_occurrence(
                        &rule.id,
                        rule.last_fired_at.as_deref(),
                        &rule.updated_at,
                        &now.to_rfc3339(),
                        &now.to_rfc3339(),
                    ) {
                        Ok(true) => {
                            tracing::warn!(rule_id = %rule.id, "skipped missed automation occurrence")
                        }
                        Ok(false) => {}
                        Err(error) => {
                            tracing::warn!(?error, rule_id = %rule.id, "failed to skip missed automation occurrence")
                        }
                    }
                    continue;
                }
                match store.claim_automation_occurrence(
                    &rule.id,
                    rule.last_fired_at.as_deref(),
                    &rule.updated_at,
                    &fire_at.to_rfc3339(),
                    &Utc::now().to_rfc3339(),
                ) {
                    Ok(true) => {
                        if let Err(error) =
                            automation::trigger_rule(&state, &rule, &fire_at.to_rfc3339(), true)
                                .await
                        {
                            tracing::warn!(%error, rule_id = %rule.id, "automation dispatch failed after claiming occurrence");
                        }
                    }
                    Ok(false) => continue,
                    Err(error) => {
                        tracing::warn!(?error, rule_id = %rule.id, "failed to claim automation occurrence")
                    }
                }
            }
        }
    });
}
