use std::{convert::Infallible, sync::Arc};

use axum::{
    extract::{Path, Query, State},
    response::sse::{Event, Sse},
};
use tokio::sync::broadcast;

use sacode_kernel::{TaskQueueStatus, TaskRun, TASK_PROTOCOL_VERSION};

use crate::streaming::sse::{stream_from_broadcast, stream_from_broadcast_with_replay};

use super::{
    parse_mode, status::sync_task_status_from_task_run, status::task_run_for_queue_status,
    DaemonState, StreamEvent,
};

#[derive(Debug, Default, serde::Deserialize)]
pub struct StreamQuery {
    pub task_id: Option<String>,
}

pub fn emit_event(state: &DaemonState, task_id: &str, event_type: &str, data: serde_json::Value) {
    let mut stream_evt = StreamEvent {
        task_id: task_id.to_string(),
        event_type: event_type.to_string(),
        data: normalize_stream_event(task_id, event_type, data),
        seq: None,
    };
    // 先写入历史缓冲（会赋值 seq），再 broadcast，确保重连客户端能通过 Last-Event-ID 续传
    state.event_history.push(&mut stream_evt);
    // 注：send 失败表示无活跃接收者，属正常情况（无 SSE 客户端连接时），不需告警
    let _ = state.event_bus.send(stream_evt);
}

pub fn spawn_executor_event_forwarder(state: Arc<DaemonState>) {
    tokio::spawn(async move {
        let mut receiver = {
            let executor = state.executor.lock().await;
            executor.subscribe()
        };

        loop {
            match receiver.recv().await {
                Ok(evt) => {
                    update_task_status_from_executor_event(&state, &evt).await;
                    // P0-3：可回放帧落盘（工具/助手/错误），重启后按卡片重建
                    persist_desktop_frame(&state, &evt).await;
                    let mut data = evt.data;
                    if let Some(task) = state
                        .tasks
                        .read()
                        .await
                        .get(&evt.task_id)
                        .map(super::TaskStatus::snapshot)
                    {
                        if let serde_json::Value::Object(map) = &mut data {
                            map.insert(
                                "task".to_string(),
                                serde_json::to_value(task).unwrap_or(serde_json::Value::Null),
                            );
                        }
                    }
                    let mut stream_evt = StreamEvent {
                        task_id: evt.task_id.clone(),
                        event_type: evt.event_type.clone(),
                        data: normalize_stream_event(&evt.task_id, &evt.event_type, data),
                        seq: None,
                    };
                    // 转发到 daemon event_bus 前先写入历史，保证 executor→daemon→SSE 全链路可续传
                    state.event_history.push(&mut stream_evt);
                    let _ = state.event_bus.send(stream_evt);
                }
                Err(broadcast::error::RecvError::Lagged(skipped)) => {
                    // executor event_bus 溢出，从 executor 到 daemon 的事件已丢失
                    // 这是端到端流式任务的连通性断点：SSE 客户端将永久漏掉这些事件
                    // 记录 warn 以便运维定位，客户端可通过 Last-Event-ID 重连续传已缓冲部分
                    state
                        .metrics
                        .sse
                        .forwarder_lagged
                        .fetch_add(1, std::sync::atomic::Ordering::Relaxed);
                    state
                        .metrics
                        .sse
                        .forwarder_skipped
                        .fetch_add(skipped, std::sync::atomic::Ordering::Relaxed);
                    tracing::warn!(
                        target: "sacode.daemon.forwarder",
                        skipped,
                        "executor event_bus lagged, events dropped from daemon forwarder; \
                         SSE clients should reconnect with Last-Event-ID to reconcile"
                    );
                    continue;
                }
                Err(broadcast::error::RecvError::Closed) => break,
            }
        }
    });
}

pub fn spawn_daemon_workers(state: Arc<DaemonState>) {
    tokio::spawn(async move {
        loop {
            {
                let mut executor = state.executor.lock().await;
                executor.run_once().await;
            }
            state.retry_handler.run_once().await;
            tokio::time::sleep(std::time::Duration::from_millis(100)).await;
        }
    });
}

fn normalize_stream_event(
    task_id: &str,
    event_type: &str,
    data: serde_json::Value,
) -> serde_json::Value {
    let timestamp = chrono::Utc::now().to_rfc3339();
    let payload = match data {
        serde_json::Value::Object(map) => serde_json::Value::Object(map),
        other => serde_json::json!({ "value": other }),
    };

    let mut normalized = serde_json::Map::new();
    normalized.insert(
        "protocol_version".to_string(),
        serde_json::json!(TASK_PROTOCOL_VERSION),
    );
    normalized.insert(
        "task_id".to_string(),
        serde_json::Value::String(task_id.to_string()),
    );
    normalized.insert(
        "event_type".to_string(),
        serde_json::Value::String(event_type.to_string()),
    );
    normalized.insert(
        "timestamp".to_string(),
        serde_json::Value::String(timestamp),
    );
    normalized.insert("payload".to_string(), payload.clone());

    if let serde_json::Value::Object(map) = payload {
        normalized.extend(map);
    }

    serde_json::Value::Object(normalized)
}

pub async fn stream_events(
    State(state): State<Arc<DaemonState>>,
) -> Sse<impl futures::Stream<Item = Result<Event, Infallible>>> {
    // 全局事件流：不支持 Last-Event-ID replay（跨任务回放成本高，由消费方按需重连单任务）
    stream_from_broadcast(state.event_bus.subscribe(), None, state.metrics.clone())
}

pub async fn stream_task_events(
    State(state): State<Arc<DaemonState>>,
    Path(task_id): Path<String>,
    headers: axum::http::HeaderMap,
) -> Sse<impl futures::Stream<Item = Result<Event, Infallible>>> {
    let last_event_id = parse_last_event_id(&headers);
    stream_from_broadcast_with_replay(
        state.event_bus.subscribe(),
        Some(task_id),
        &state.event_history,
        last_event_id,
        state.metrics.clone(),
    )
}

pub async fn stream_api_events(
    State(state): State<Arc<DaemonState>>,
    Query(query): Query<StreamQuery>,
    headers: axum::http::HeaderMap,
) -> Sse<impl futures::Stream<Item = Result<Event, Infallible>>> {
    let last_event_id = parse_last_event_id(&headers);
    stream_from_broadcast_with_replay(
        state.event_bus.subscribe(),
        query.task_id,
        &state.event_history,
        last_event_id,
        state.metrics.clone(),
    )
}

/// 解析 `Last-Event-ID` 请求头，返回其代表的 seq
/// SSE 规范：客户端重连时携带最后收到的事件 id，服务端据此回放后续事件
fn parse_last_event_id(headers: &axum::http::HeaderMap) -> Option<u64> {
    headers
        .get("last-event-id")
        .and_then(|v| v.to_str().ok())
        .and_then(|s| s.trim().parse::<u64>().ok())
}

fn freeze_task_changes(state: &DaemonState, task_id: &str) {
    let (Some(workdir), Some(store)) = (state.workdir.as_deref(), state.store.as_ref()) else {
        return;
    };
    let baseline = match store.load_task_change_baseline(task_id) {
        Ok(Some(value)) => value,
        Ok(None) => return,
        Err(error) => {
            tracing::warn!(?error, ?task_id, "failed to load task change baseline");
            return;
        }
    };
    let snapshot = crate::task_changes::capture_workspace_tree(workdir).and_then(|final_tree| {
        crate::task_changes::diff_workspace_trees(workdir, &baseline, &final_tree)
    });
    match snapshot {
        Ok(snapshot) => {
            if let Err(error) = store.save_task_changes(task_id, &snapshot) {
                tracing::warn!(?error, ?task_id, "failed to persist final task changes");
            }
        }
        Err(error) => tracing::warn!(?error, ?task_id, "failed to freeze final task changes"),
    }
}

/// P0-3：把 executor 事件里可展示的部分写成回放帧
async fn persist_desktop_frame(state: &Arc<DaemonState>, evt: &crate::executor::ExecutorEvent) {
    let Some(store) = state.store.as_ref() else {
        return;
    };
    let (kind, text, detail) = match evt.event_type.as_str() {
        "message" => {
            let text = evt
                .data
                .get("content")
                .and_then(|v| v.as_str())
                .unwrap_or_default()
                .to_string();
            if text.trim().is_empty() {
                return;
            }
            ("assistant", text, None)
        }
        "thinking" => {
            let text = evt
                .data
                .get("content")
                .and_then(|v| v.as_str())
                .unwrap_or_default()
                .to_string();
            if text.trim().is_empty() {
                return;
            }
            // 契约 §12.4：thinking 独立 kind，不再折进 tool
            ("thinking", text, None)
        }
        "tool_call_started" => {
            let tool = evt
                .data
                .get("tool")
                .or_else(|| evt.data.get("tool_name"))
                .or_else(|| evt.data.get("name"))
                .and_then(|v| v.as_str())
                .unwrap_or("tool");
            let args = evt.data.get("args").or_else(|| evt.data.get("input"));
            let detail = args.map(|a| serde_json::to_string(a).unwrap_or_default());
            ("tool", tool.to_string(), detail)
        }
        "tool_call_finished" | "tool_finished" => {
            let tool = evt
                .data
                .get("tool")
                .or_else(|| evt.data.get("tool_name"))
                .and_then(|v| v.as_str())
                .unwrap_or("tool");
            let ok = evt
                .data
                .get("success")
                .and_then(|v| v.as_bool())
                .unwrap_or(true);
            ("tool", format!("{tool} {}", if ok { "✓" } else { "✗" }), None)
        }
        "error" => {
            let text = evt
                .data
                .get("message")
                .or_else(|| evt.data.get("error"))
                .or_else(|| evt.data.get("content"))
                .and_then(|v| v.as_str())
                .unwrap_or_default()
                .to_string();
            if text.trim().is_empty() {
                return;
            }
            ("error", text, None)
        }
        "plan_generated" => {
            let text = evt
                .data
                .get("summary")
                .or_else(|| evt.data.get("title"))
                .or_else(|| evt.data.get("content"))
                .and_then(|v| v.as_str())
                .map(|s| s.to_string())
                .unwrap_or_else(|| "计划已生成".to_string());
            ("tool", text, Some("plan".to_string()))
        }
        _ => return,
    };
    let _ = store.append_desktop_frame(&evt.task_id, kind, &text, detail.as_deref());
}

/// 契约 §2.4：灵枢特色事件投影 —— `ExecutionReport` → desktop_frames
///
/// 数据源（`kernel/src/execution/report.rs`）：
/// - `plan` / RoleScore → `role_assignment`
/// - `conflict_records` → `conflict`
/// - `route_records` → `model_route`（failover 后 route_reason 带 "failover" → `failed_over`）
/// - `summary_record` → `summary`
///
/// 同 task_id 按投影顺序编号 seq（由 `append_desktop_frame` 的 MAX(seq)+1 保证）；
/// 记忆/学习型（mistakes / preferences）不进消息流。
fn persist_ling_shu_frames(
    store: &crate::StoreDb,
    task_id: &str,
    report: &sacode_kernel::ExecutionReport,
) {
    // role_assignment：plan 里的角色分工（谁接活）
    if let Some(plan) = report.plan.as_ref() {
        // schema::Plan 只有 task/steps/mode；角色分工在 plan 摘要里以 steps 形式存在，
        // 有 steps 时投影为一条 role_assignment（steps = 分工）。
        if !plan.steps.is_empty() {
            let roles: Vec<serde_json::Value> = plan
                .steps
                .iter()
                .map(|step| {
                    serde_json::json!({
                        "role_id": format!("step-{}", step.id),
                        "role_name": step.description,
                        "reason": step.expected_output,
                    })
                })
                .collect();
            let detail = serde_json::json!({ "roles": roles }).to_string();
            let _ = store.append_desktop_frame(
                task_id,
                "role_assignment",
                &format!("角色编排：{} 个分工", roles.len()),
                Some(&detail),
            );
        }
    }

    // model_route：路由记录（自愈合）；route_reason 含 failover → failed_over
    for route in &report.route_records {
        let failed_over = route.route_reason.to_lowercase().contains("failover")
            || route.route_reason.contains("切换");
        let detail = serde_json::json!({
            "role_id": route.role_id,
            "primary": {
                "provider": route.primary.provider_name,
                "model": route.primary.model_name,
                "score": route.primary.route_score,
                "needs_thinking": route.primary.needs_thinking,
            },
            "fallbacks": route.fallbacks.iter().map(|f| serde_json::json!({
                "provider": f.provider_name,
                "model": f.model_name,
                "score": f.route_score,
            })).collect::<Vec<_>>(),
            "reason": route.route_reason,
            "failed_over": failed_over,
        })
        .to_string();
        let _ = store.append_desktop_frame(
            task_id,
            "model_route",
            &format!(
                "{}/{}{}",
                route.primary.provider_name,
                route.primary.model_name,
                if failed_over { "（已故障切换）" } else { "" }
            ),
            Some(&detail),
        );
    }

    // conflict：冲突记录（自防护）。检测一条；带 intervention 时 status=intervening
    for conflict in &report.conflict_records {
        let is_validation = conflict.kind == "validation_conflict";
        let detail = serde_json::json!({
            "kind": conflict.kind,
            "summary": conflict.summary,
            "details": conflict.details,
            "status": if is_validation { "intervening" } else { "detected" },
            "intervention": if is_validation {
                serde_json::json!({ "target_role": "test-engineer", "action": "dispatch_fix_loop" })
            } else {
                serde_json::Value::Null
            },
        })
        .to_string();
        let _ = store.append_desktop_frame(task_id, "conflict", &conflict.summary, Some(&detail));
    }

    // summary：结构化收尾摘要
    if let Some(summary) = report.summary_record.as_ref() {
        let detail = serde_json::json!({
            "task": summary.task,
            "roles": summary.roles,
            "conclusion": summary.overall_conclusion,
            "key_risks": summary.key_risks,
            "next_action": summary.recommended_next_action,
            "conflicts": summary.conflicts,
        })
        .to_string();
        let _ = store.append_desktop_frame(
            task_id,
            "summary",
            summary.overall_conclusion.as_deref().unwrap_or("任务摘要"),
            Some(&detail),
        );
    }
}

async fn update_task_status_from_executor_event(
    state: &Arc<DaemonState>,
    evt: &crate::executor::ExecutorEvent,
) {
    if matches!(
        evt.event_type.as_str(),
        "task_completed" | "task_failed" | "task_cancelled"
    ) {
        freeze_task_changes(state, &evt.task_id);
        let status = match evt.event_type.as_str() {
            "task_completed" => "completed",
            "task_cancelled" => "cancelled",
            _ => "failed",
        };
        super::automation::sync_automation_run_status(state, &evt.task_id, status);
    }
    let mut tasks = state.tasks.write().await;
    let Some(status) = tasks.get_mut(&evt.task_id) else {
        return;
    };

    status.current_event = Some(evt.event_type.clone());

    match evt.event_type.as_str() {
        "task_started" => {
            status.task_run = Some(task_run_for_queue_status(
                Some(status.task_id.clone()),
                parse_mode(&status.mode),
                status.prompt.clone(),
                TaskQueueStatus::Running,
                None,
            ));
            sync_task_status_from_task_run(status);
        }
        "task_completed" | "task_failed" => {
            if let Some(result_value) = evt.data.get("result") {
                if let Ok(result) =
                    serde_json::from_value::<sacode_kernel::TaskResult>(result_value.clone())
                {
                    status.duration_ms = Some(result.duration_ms);
                    status.output = result.output.clone();
                    status.error = result.error.clone();
                }
            }
            if let Some(task_run_value) = evt.data.get("task_run") {
                if let Ok(task_run) = serde_json::from_value::<TaskRun>(task_run_value.clone()) {
                    // 契约 §2.4：灵枢特色事件（role_assignment/conflict/model_route/summary）
                    // 从 ExecutionReport 投影为回放帧，重启后可合成 TurnEvent
                    if let (Some(store), Some(report)) =
                        (state.store.as_ref(), task_run.report.as_ref())
                    {
                        persist_ling_shu_frames(store, &evt.task_id, report);
                    }
                    status.task_run = Some(task_run);
                }
            }
            // interaction.ask 挂起问题：写入 TaskStatus，供 GET /task/:id/status 与应答端点使用
            match evt.data.get("pending_question") {
                Some(serde_json::Value::Null) | None => {}
                Some(q) => {
                    status.pending_question = Some(q.clone());
                    // 契约 §12.6：挂起提问落盘，重启后可恢复
                    if let Some(store) = state.store.as_ref() {
                        if let Ok(json) = serde_json::to_string(q) {
                            let _ = store.save_pending_question(&evt.task_id, &json);
                        }
                    }
                }
            }
            match evt.data.get("usage") {
                Some(serde_json::Value::Null) | None => {}
                Some(u) => {
                    status.usage = Some(u.clone());
                    // 契约 §12.6：usage 随 turn meta 落盘，重启后 turns 仍带 usage
                    if let Some(store) = state.store.as_ref() {
                        if let Ok(json) = serde_json::to_string(u) {
                            let _ = store.save_desktop_turn_meta(
                                &evt.task_id,
                                &crate::store::desktop_conversations::DesktopTurnMeta {
                                    usage_json: Some(json),
                                    ..Default::default()
                                },
                            );
                        }
                    }
                }
            }
            sync_task_status_from_task_run(status);
        }
        _ => {}
    }
}
