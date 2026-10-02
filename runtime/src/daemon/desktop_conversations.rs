use std::sync::Arc;

use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    Json,
};
use sacode_kernel::TASK_PROTOCOL_VERSION;

use super::{
    handlers::{dispatch_task_with_turn, TaskDispatchError},
    parse_mode, DaemonState, TaskRequest, TaskResponse,
};
use crate::store::desktop_conversations::{
    DesktopConversationMeta, DesktopTurnMeta,
};

fn failure(error: TaskDispatchError) -> (StatusCode, Json<serde_json::Value>) {
    let (code, response) = match error {
        TaskDispatchError::SkillUnavailable {
            task_id,
            mode,
            skill,
        } => (
            StatusCode::BAD_REQUEST,
            TaskResponse::error(task_id, mode, format!("skill not available: {skill}")),
        ),
        TaskDispatchError::BackendUnavailable {
            task_id,
            mode,
            message,
            ..
        } => (
            StatusCode::BAD_REQUEST,
            TaskResponse::error(task_id, mode, message),
        ),
        TaskDispatchError::QueueRejected {
            task_id,
            mode,
            message,
        } => (
            StatusCode::SERVICE_UNAVAILABLE,
            TaskResponse::error(task_id, mode, message),
        ),
    };
    (
        code,
        Json(serde_json::to_value(response).unwrap_or_default()),
    )
}

fn error(code: StatusCode, message: &str) -> (StatusCode, Json<serde_json::Value>) {
    (code, Json(serde_json::json!({"error": message})))
}

/// 契约 §1.3：从模型规则取真实 context window；缺省时前端才允许 200k 兜底
fn context_window_for(
    workdir: Option<&std::path::Path>,
    model_provider: Option<&str>,
    model_name: Option<&str>,
) -> Option<u64> {
    let workdir = workdir?;
    let candidates = crate::agents::resolve_selectable_model_candidates(workdir);
    let picked = match (model_provider, model_name) {
        (Some(provider), Some(model)) => candidates
            .iter()
            .find(|(p, m, _)| p == provider && m == model)
            .map(|(_, _, runtime)| runtime.clone()),
        _ => candidates.first().map(|(_, _, runtime)| runtime.clone()),
    }?;
    picked
        .rule
        .as_ref()
        .and_then(|rule| rule.limit.as_ref())
        .map(|limit| limit.context as u64)
        .filter(|value| *value > 0)
}

/// 契约 §2.2/§12.4：frames → TurnEvent[]（含灵枢四类）
fn frames_to_events(frames: &[crate::store::desktop_conversations::DesktopFrame]) -> Vec<serde_json::Value> {
    frames
        .iter()
        .map(|frame| {
            let seq = frame.seq.max(0) as u64;
            let detail: Option<serde_json::Value> = frame
                .detail
                .as_deref()
                .and_then(|raw| serde_json::from_str(raw).ok());
            match frame.kind.as_str() {
                "assistant" => serde_json::json!({ "type": "text", "seq": seq, "text": frame.text }),
                "thinking" => serde_json::json!({
                    "type": "thinking", "seq": seq, "text": frame.text, "collapsed": true,
                }),
                "tool" => {
                    let (tool, status) = if let Some(name) = frame.text.strip_suffix('✓') {
                        (name.trim().to_string(), "ok")
                    } else if let Some(name) = frame.text.strip_suffix('✗') {
                        (name.trim().to_string(), "err")
                    } else {
                        (frame.text.clone(), "running")
                    };
                    let input = detail
                        .as_ref()
                        .filter(|value| !value.is_null())
                        .cloned();
                    serde_json::json!({
                        "type": "tool", "seq": seq, "tool": tool, "status": status,
                        "input": input,
                    })
                }
                "approval" => {
                    let d = detail.clone().unwrap_or(serde_json::Value::Null);
                    let status = match d.get("approved").and_then(|v| v.as_bool()) {
                        Some(true) => "approved",
                        Some(false) => "rejected",
                        None => "pending",
                    };
                    serde_json::json!({
                        "type": "approval", "seq": seq,
                        "approval_id": d.get("approval_id").and_then(|v| v.as_str()).unwrap_or(""),
                        "tool": d.get("tool_name").and_then(|v| v.as_str())
                            .or_else(|| d.get("tool").and_then(|v| v.as_str()))
                            .unwrap_or(&frame.text),
                        "summary": frame.text,
                        "status": status,
                    })
                }
                "ask" => {
                    let d = detail.clone().unwrap_or(serde_json::Value::Null);
                    serde_json::json!({
                        "type": "ask", "seq": seq,
                        "question_id": d.get("question_id").and_then(|v| v.as_str()).unwrap_or(""),
                        "question": d.get("question").and_then(|v| v.as_str()).unwrap_or(&frame.text),
                        "options": d.get("options").cloned(),
                        "allow_multiple": d.get("allow_multiple").cloned(),
                        "status": d.get("status").and_then(|v| v.as_str()).unwrap_or("answered"),
                        "answer": d.get("answer").cloned(),
                    })
                }
                "subagent" => {
                    let d = detail.clone().unwrap_or(serde_json::Value::Null);
                    serde_json::json!({
                        "type": "subagent", "seq": seq,
                        "agent_id": d.get("agent_id").and_then(|v| v.as_str()).unwrap_or(""),
                        "title": d.get("title").and_then(|v| v.as_str()).unwrap_or(&frame.text),
                        "status": d.get("status").and_then(|v| v.as_str()).unwrap_or("done"),
                        "summary": d.get("summary").cloned(),
                        "result": d.get("result").cloned(),
                    })
                }
                "role_assignment" => {
                    let d = detail.clone().unwrap_or(serde_json::Value::Null);
                    serde_json::json!({
                        "type": "role_assignment", "seq": seq,
                        "roles": d.get("roles").cloned().unwrap_or_else(|| serde_json::json!([])),
                    })
                }
                "conflict" => {
                    let d = detail.clone().unwrap_or(serde_json::Value::Null);
                    serde_json::json!({
                        "type": "conflict", "seq": seq,
                        "conflict_id": d.get("conflict_id").cloned(),
                        "kind": d.get("kind").and_then(|v| v.as_str()).unwrap_or("conflict"),
                        "summary": d.get("summary").and_then(|v| v.as_str()).unwrap_or(&frame.text),
                        "details": d.get("details").cloned(),
                        "status": d.get("status").and_then(|v| v.as_str()).unwrap_or("detected"),
                        "intervention": d.get("intervention").cloned(),
                    })
                }
                "model_route" => {
                    let d = detail.clone().unwrap_or(serde_json::Value::Null);
                    serde_json::json!({
                        "type": "model_route", "seq": seq,
                        "role_id": d.get("role_id").and_then(|v| v.as_str()),
                        "primary": d.get("primary").cloned().unwrap_or(serde_json::Value::Null),
                        "fallbacks": d.get("fallbacks").cloned(),
                        "reason": d.get("reason").and_then(|v| v.as_str()),
                        "failed_over": d.get("failed_over").and_then(|v| v.as_bool()),
                    })
                }
                "summary" => {
                    let d = detail.clone().unwrap_or(serde_json::Value::Null);
                    serde_json::json!({
                        "type": "summary", "seq": seq,
                        "task": d.get("task").and_then(|v| v.as_str()).unwrap_or(&frame.text),
                        "roles": d.get("roles").cloned(),
                        "conclusion": d.get("conclusion").cloned(),
                        "key_risks": d.get("key_risks").cloned(),
                        "next_action": d.get("next_action").cloned(),
                        "conflicts": d.get("conflicts").cloned(),
                    })
                }
                // O4: ACP 后端执行轨迹（契约 §13.3）
                "agent_backend" => {
                    let d = detail.clone().unwrap_or(serde_json::Value::Null);
                    serde_json::json!({
                        "type": "agent_backend", "seq": seq,
                        "backend_id": d.get("backend_id").and_then(|v| v.as_str()).unwrap_or(""),
                        "title": d.get("title").and_then(|v| v.as_str()).unwrap_or(&frame.text),
                        "status": d.get("status").and_then(|v| v.as_str()).unwrap_or("done"),
                        "summary": d.get("summary").cloned(),
                        "result": d.get("result").cloned(),
                        "quota": d.get("quota").cloned(),
                    })
                }
                _ => serde_json::json!({ "type": "text", "seq": seq, "text": frame.text }),
            }
        })
        .collect()
}

#[derive(Debug, serde::Deserialize)]
pub struct ListQuery {
    /// 契约 §3.2：title + prompt + output 子串搜索
    #[serde(default)]
    pub q: Option<String>,
}

pub async fn list(
    State(state): State<Arc<DaemonState>>,
    Query(query): Query<ListQuery>,
) -> (StatusCode, Json<serde_json::Value>) {
    let Some(store) = state.store.as_ref() else {
        return error(
            StatusCode::SERVICE_UNAVAILABLE,
            "conversation store unavailable",
        );
    };
    match store.desktop_conversations() {
        Ok(entries) => {
            let tasks = state.tasks.read().await;
            let needle = query
                .q
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(str::to_lowercase);
            let mut conversations = Vec::with_capacity(entries.len());
            for entry in entries {
                let turns = match store.desktop_turns(&entry.conversation_id) {
                    Ok(turns) => turns,
                    Err(err) => {
                        tracing::warn!(?err, "list conversation turns failed");
                        return error(
                            StatusCode::INTERNAL_SERVER_ERROR,
                            "conversation store unavailable",
                        );
                    }
                };
                let meta = store
                    .desktop_conversation_meta(&entry.conversation_id)
                    .unwrap_or_default();
                let latest = turns.last().and_then(|turn| tasks.get(&turn.task_id));
                let preview = turns
                    .last()
                    .map(|turn| {
                        tasks
                            .get(&turn.task_id)
                            .and_then(|task| task.output.as_deref())
                            .filter(|output| !output.trim().is_empty())
                            .map(|output| output.trim().chars().take(80).collect::<String>())
                            .unwrap_or_else(|| {
                                turn.prompt.trim().chars().take(80).collect::<String>()
                            })
                    })
                    .unwrap_or_default();
                let title = meta
                    .title
                    .clone()
                    .unwrap_or_else(|| entry.prompt.trim().chars().take(40).collect::<String>());
                // 契约 §3.2：搜索 title + prompt + output 子串
                if let Some(needle) = &needle {
                    let haystack = format!(
                        "{}\n{}\n{}",
                        title.to_lowercase(),
                        entry.prompt.to_lowercase(),
                        turns
                            .iter()
                            .filter_map(|turn| {
                                tasks
                                    .get(&turn.task_id)
                                    .and_then(|task| task.output.as_deref())
                            })
                            .collect::<Vec<_>>()
                            .join("\n")
                            .to_lowercase()
                    );
                    if !haystack.contains(needle.as_str()) {
                        continue;
                    }
                }
                conversations.push(serde_json::json!({
                    "id": entry.conversation_id,
                    "title": title,
                    "created_at": entry.created_at,
                    "latest_task_id": turns.last().map(|turn| &turn.task_id),
                    "status": latest.map(|task| task.derived_queue_status().to_string()).unwrap_or_else(|| "unknown".into()),
                    "archived": meta.archived,
                    "unread": meta.unread,
                    "updated_at": meta.updated_at,
                    "preview": preview,
                }));
            }
            (
                StatusCode::OK,
                Json(
                    serde_json::json!({"protocol_version": TASK_PROTOCOL_VERSION, "conversations": conversations}),
                ),
            )
        }
        Err(err) => {
            tracing::warn!(?err, "list conversations failed");
            error(
                StatusCode::INTERNAL_SERVER_ERROR,
                "conversation store unavailable",
            )
        }
    }
}

pub async fn get(
    State(state): State<Arc<DaemonState>>,
    Path(id): Path<String>,
) -> (StatusCode, Json<serde_json::Value>) {
    let Some(store) = state.store.as_ref() else {
        return error(
            StatusCode::SERVICE_UNAVAILABLE,
            "conversation store unavailable",
        );
    };
    // 会话在分格中可见 → 立即清未读（契约 §3.3）
    let _ = store.clear_desktop_conversation_unread(&id);
    match store.desktop_turns(&id) {
        Ok(turns) if !turns.is_empty() => {
            let tasks = state.tasks.read().await;
            let turns: Vec<_> = turns
                .iter()
                .map(|turn| {
                    let task = tasks.get(&turn.task_id);
                    let frames = store
                        .desktop_frames(&turn.task_id)
                        .unwrap_or_default();
                    let events = frames_to_events(&frames);
                    let turn_meta = store.desktop_turn_meta(&turn.task_id).ok().flatten();
                    // usage：优先 turn meta（跨重启），回落内存 TaskStatus
                    let usage = turn_meta
                        .as_ref()
                        .and_then(|meta| meta.usage_json.as_deref())
                        .and_then(|raw| serde_json::from_str::<serde_json::Value>(raw).ok())
                        .or_else(|| {
                            task.and_then(|task| task.usage.clone()).and_then(|value| {
                                // ChatUsage: prompt_tokens/completion_tokens → input/output
                                Some(serde_json::json!({
                                    "input_tokens": value.get("prompt_tokens").cloned(),
                                    "output_tokens": value.get("completion_tokens").cloned(),
                                }))
                            })
                        });
                    let settings_snapshot = turn_meta
                        .as_ref()
                        .and_then(|meta| meta.settings_json.as_deref())
                        .and_then(|raw| serde_json::from_str::<serde_json::Value>(raw).ok());
                    serde_json::json!({
                        "task_id": turn.task_id,
                        "prompt": turn.prompt,
                        "created_at": turn.created_at,
                        "status": task.map(|task| task.derived_queue_status().to_string()).unwrap_or_else(|| "unknown".into()),
                        "output": task.and_then(|task| task.output.as_deref()),
                        "error": task.and_then(|task| task.error.as_deref()),
                        "frames": frames.iter().map(|f| serde_json::json!({
                            "seq": f.seq,
                            "kind": f.kind,
                            "text": f.text,
                            "detail": f.detail,
                        })).collect::<Vec<_>>(),
                        "events": events,
                        "usage": usage,
                        "settings_snapshot": settings_snapshot,
                    })
                })
                .collect();
            (
                StatusCode::OK,
                Json(serde_json::json!({"id": id, "turns": turns})),
            )
        }
        Ok(_) => error(StatusCode::NOT_FOUND, "conversation not found"),
        Err(err) => {
            tracing::warn!(?err, "load conversation failed");
            error(
                StatusCode::INTERNAL_SERVER_ERROR,
                "conversation store unavailable",
            )
        }
    }
}

pub async fn create(
    State(state): State<Arc<DaemonState>>,
    Json(req): Json<TaskRequest>,
) -> (StatusCode, Json<serde_json::Value>) {
    send(state, None, req).await
}

pub async fn append(
    State(state): State<Arc<DaemonState>>,
    Path(id): Path<String>,
    Json(req): Json<TaskRequest>,
) -> (StatusCode, Json<serde_json::Value>) {
    send(state, Some(id), req).await
}

async fn send(
    state: Arc<DaemonState>,
    id: Option<String>,
    req: TaskRequest,
) -> (StatusCode, Json<serde_json::Value>) {
    if req.prompt.trim().is_empty() {
        return error(StatusCode::BAD_REQUEST, "prompt is empty");
    }
    // 契约 §1.2：reasoning_effort 取值校验（null/缺省 = 跟随 provider 默认）
    if let Some(effort) = req.reasoning_effort.as_deref() {
        if !matches!(effort, "low" | "medium" | "high") {
            return error(
                StatusCode::BAD_REQUEST,
                "reasoning_effort must be one of low|medium|high",
            );
        }
    }
    let Some(store) = state.store.as_ref() else {
        return error(
            StatusCode::SERVICE_UNAVAILABLE,
            "conversation store unavailable",
        );
    };
    let _guard = state.desktop_conversation_lock.lock().await;
    let mut request = req.clone();
    if let Some(id) = &id {
        let turns = match store.desktop_turns(id) {
            Ok(turns) if !turns.is_empty() => turns,
            Ok(_) => return error(StatusCode::NOT_FOUND, "conversation not found"),
            Err(err) => {
                tracing::warn!(?err, "load conversation failed");
                return error(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "conversation store unavailable",
                );
            }
        };
        // 契约 §1.2：client_msg_id 幂等 —— 同会话内重发直接回既有 task
        if let Some(client_msg_id) = req
            .client_msg_id
            .as_deref()
            .filter(|value| !value.trim().is_empty())
        {
            if let Ok(Some(existing_task_id)) = store.find_task_by_client_msg_id(id, client_msg_id)
            {
                let tasks = state.tasks.read().await;
                let value = serde_json::json!({
                    "protocol_version": TASK_PROTOCOL_VERSION,
                    "task_id": existing_task_id,
                    "status": "duplicate",
                    "message": "duplicate client_msg_id; returning existing task",
                    "queue_status": tasks
                        .get(&existing_task_id)
                        .map(|task| task.derived_queue_status())
                        .unwrap_or_else(|| "unknown".into()),
                    "conversation_id": id,
                });
                return (StatusCode::OK, Json(value));
            }
        }
        let tasks = state.tasks.read().await;
        if turns.last().is_some_and(|turn| {
            tasks.get(&turn.task_id).is_none_or(|task| {
                !matches!(
                    task.derived_queue_status().as_str(),
                    "completed" | "failed" | "cancelled"
                )
            })
        }) {
            return error(StatusCode::CONFLICT, "wait for the previous turn to finish");
        }
        let mut history = String::new();
        for turn in turns.iter().rev().take(12).rev() {
            history.push_str("User: ");
            history.push_str(&turn.prompt);
            history.push('\n');
            if let Some(output) = tasks
                .get(&turn.task_id)
                .and_then(|task| task.output.as_deref())
            {
                history.push_str("Assistant: ");
                history.push_str(output);
                history.push('\n');
            }
        }
        if history.chars().count() > 32000 {
            return error(
                StatusCode::BAD_REQUEST,
                "conversation history too long; start a new conversation",
            );
        }
        request.prompt = format!(
            "[Previous conversation]\n{history}[Current user message]\n{}",
            req.prompt
        );
        if request.prompt.chars().count() > 64000 {
            return error(StatusCode::BAD_REQUEST, "conversation message too long");
        }
    }
    let conversation_id =
        id.unwrap_or_else(|| format!("conversation-{:032x}", rand::random::<u128>()));
    match dispatch_task_with_turn(&state, &request, Some((&conversation_id, &req.prompt))).await {
        Ok((task_id, queue_status, backend)) => {
            // 契约 §2.2：settings_snapshot 随 turn 落盘
            let settings_snapshot = serde_json::json!({
                "model_provider": request.model_provider,
                "model_name": request.model_name,
                "reasoning_effort": request.reasoning_effort,
                "skills": if request.skills.is_empty() {
                    request.skill.clone().map(|skill| vec![skill]).unwrap_or_default()
                } else {
                    request.skills.clone()
                },
            });
            let meta = DesktopTurnMeta {
                client_msg_id: request
                    .client_msg_id
                    .as_deref()
                    .filter(|value| !value.trim().is_empty())
                    .map(str::to_string),
                settings_json: Some(settings_snapshot.to_string()),
                usage_json: None,
            };
            if let Err(err) = store.save_desktop_turn_meta(&task_id, &meta) {
                tracing::warn!(?err, "failed to persist turn meta");
            }
            // 有新 turn 落盘 → unread = true（契约 §3.3）
            if let Err(err) = store.mark_desktop_conversation_unread(&conversation_id) {
                tracing::warn!(?err, "failed to mark conversation unread");
            }
            let context_window = context_window_for(
                state.workdir.as_deref(),
                request.model_provider.as_deref(),
                request.model_name.as_deref(),
            );
            let response = TaskResponse::queued(
                task_id,
                parse_mode(&req.mode),
                queue_status,
                "Task created and submitted to queue".into(),
                Some(backend),
            );
            let mut value = serde_json::to_value(response).unwrap_or_default();
            value["conversation_id"] = serde_json::json!(conversation_id);
            if let Some(context_window) = context_window {
                value["context_window"] = serde_json::json!(context_window);
            }
            (StatusCode::OK, Json(value))
        }
        Err(err) => failure(err),
    }
}

pub async fn delete(
    State(state): State<Arc<DaemonState>>,
    Path(id): Path<String>,
) -> (StatusCode, Json<serde_json::Value>) {
    let Some(store) = state.store.as_ref() else {
        return error(
            StatusCode::SERVICE_UNAVAILABLE,
            "conversation store unavailable",
        );
    };
    let _guard = state.desktop_conversation_lock.lock().await;
    let turns = match store.desktop_turns(&id) {
        Ok(turns) if !turns.is_empty() => turns,
        Ok(_) => return error(StatusCode::NOT_FOUND, "conversation not found"),
        Err(err) => {
            tracing::warn!(?err, "load conversation failed");
            return error(
                StatusCode::INTERNAL_SERVER_ERROR,
                "conversation store unavailable",
            );
        }
    };
    for turn in &turns {
        state.queue.cancel(&turn.task_id).await;
        state.executor.lock().await.abort_task(&turn.task_id).await;
        state.clear_pending_approvals_for_task(&turn.task_id).await;
    }
    if let Err(err) = store.delete_desktop_conversation(&id) {
        tracing::error!(?err, "delete conversation failed");
        return error(
            StatusCode::INTERNAL_SERVER_ERROR,
            "conversation store unavailable",
        );
    }
    {
        let mut tasks = state.tasks.write().await;
        for turn in &turns {
            tasks.remove(&turn.task_id);
        }
    }
    for turn in &turns {
        state.queue.forget_desktop_turn(&turn.task_id).await;
    }
    (
        StatusCode::OK,
        Json(serde_json::json!({"status": "deleted", "id": id})),
    )
}

// ── 契约 §1.4：会话设置（含草稿） ────────────────────────────────────

pub async fn settings_get(
    State(state): State<Arc<DaemonState>>,
    Path(id): Path<String>,
) -> (StatusCode, Json<serde_json::Value>) {
    let Some(store) = state.store.as_ref() else {
        return error(
            StatusCode::SERVICE_UNAVAILABLE,
            "conversation store unavailable",
        );
    };
    match store.desktop_conversation_settings(&id) {
        Ok(Some(settings)) => (
            StatusCode::OK,
            Json(
                serde_json::json!({
                    "conversation_id": id,
                    "model_provider": settings.model_provider,
                    "model_name": settings.model_name,
                    "reasoning_effort": settings.reasoning_effort,
                    "skills": settings.skills,
                    "draft": settings.draft,
                }),
            ),
        ),
        Ok(None) => (
            StatusCode::OK,
            Json(serde_json::json!({"conversation_id": id})),
        ),
        Err(err) => {
            tracing::warn!(?err, "load conversation settings failed");
            error(
                StatusCode::INTERNAL_SERVER_ERROR,
                "conversation store unavailable",
            )
        }
    }
}

#[derive(Debug, serde::Deserialize, Default)]
pub struct SettingsPatch {
    #[serde(default)]
    pub model_provider: Option<String>,
    #[serde(default)]
    pub model_name: Option<String>,
    /// `null` = 显式清空（跟随 provider 默认）；缺省字段 = 不改
    #[serde(default)]
    pub reasoning_effort: Option<Option<String>>,
    #[serde(default)]
    pub skills: Option<Vec<String>>,
    #[serde(default)]
    pub draft: Option<String>,
}

pub async fn settings_put(
    State(state): State<Arc<DaemonState>>,
    Path(id): Path<String>,
    Json(patch): Json<SettingsPatch>,
) -> (StatusCode, Json<serde_json::Value>) {
    let Some(store) = state.store.as_ref() else {
        return error(
            StatusCode::SERVICE_UNAVAILABLE,
            "conversation store unavailable",
        );
    };
    if let Some(effort) = patch.reasoning_effort.as_ref().and_then(|value| value.as_ref()) {
        if !matches!(effort.as_str(), "low" | "medium" | "high") {
            return error(
                StatusCode::BAD_REQUEST,
                "reasoning_effort must be one of low|medium|high",
            );
        }
    }
    let mut settings = store
        .desktop_conversation_settings(&id)
        .ok()
        .flatten()
        .unwrap_or_default();
    if let Some(value) = patch.model_provider {
        settings.model_provider = Some(value);
    }
    if let Some(value) = patch.model_name {
        settings.model_name = Some(value);
    }
    // Some(None) = 显式清空；Some(Some(v)) = 设置；None = 不改
    match patch.reasoning_effort {
        Some(value) => settings.reasoning_effort = value,
        None => {}
    }
    if let Some(value) = patch.skills {
        settings.skills = Some(value);
    }
    if let Some(value) = patch.draft {
        settings.draft = Some(value);
    }
    if let Err(err) = store.save_desktop_conversation_settings(&id, &settings) {
        tracing::warn!(?err, "save conversation settings failed");
        return error(
            StatusCode::INTERNAL_SERVER_ERROR,
            "conversation store unavailable",
        );
    }
    (
        StatusCode::OK,
        Json(
            serde_json::json!({
                "conversation_id": id,
                "model_provider": settings.model_provider,
                "model_name": settings.model_name,
                "reasoning_effort": settings.reasoning_effort,
                "skills": settings.skills,
                "draft": settings.draft,
            }),
        ),
    )
}

// ── 契约 §3.2：重命名 / 归档 / 恢复 ──────────────────────────────────

#[derive(Debug, serde::Deserialize)]
pub struct RenameRequest {
    pub title: String,
}

pub async fn rename(
    State(state): State<Arc<DaemonState>>,
    Path(id): Path<String>,
    Json(req): Json<RenameRequest>,
) -> (StatusCode, Json<serde_json::Value>) {
    let Some(store) = state.store.as_ref() else {
        return error(
            StatusCode::SERVICE_UNAVAILABLE,
            "conversation store unavailable",
        );
    };
    if req.title.trim().is_empty() {
        return error(StatusCode::BAD_REQUEST, "title is empty");
    }
    match store.desktop_turns(&id) {
        Ok(turns) if !turns.is_empty() => {}
        Ok(_) => return error(StatusCode::NOT_FOUND, "conversation not found"),
        Err(err) => {
            tracing::warn!(?err, "load conversation failed");
            return error(
                StatusCode::INTERNAL_SERVER_ERROR,
                "conversation store unavailable",
            );
        }
    }
    let meta = DesktopConversationMeta {
        conversation_id: id.clone(),
        title: Some(req.title.trim().to_string()),
        ..store.desktop_conversation_meta(&id).unwrap_or_default()
    };
    if let Err(err) = store.save_desktop_conversation_meta(&meta) {
        tracing::warn!(?err, "rename conversation failed");
        return error(
            StatusCode::INTERNAL_SERVER_ERROR,
            "conversation store unavailable",
        );
    }
    (
        StatusCode::OK,
        Json(serde_json::json!({"status": "ok", "id": id, "title": meta.title})),
    )
}

pub async fn archive(
    State(state): State<Arc<DaemonState>>,
    Path(id): Path<String>,
) -> (StatusCode, Json<serde_json::Value>) {
    set_archived(state, id, true).await
}

pub async fn restore(
    State(state): State<Arc<DaemonState>>,
    Path(id): Path<String>,
) -> (StatusCode, Json<serde_json::Value>) {
    set_archived(state, id, false).await
}

async fn set_archived(
    state: Arc<DaemonState>,
    id: String,
    archived: bool,
) -> (StatusCode, Json<serde_json::Value>) {
    let Some(store) = state.store.as_ref() else {
        return error(
            StatusCode::SERVICE_UNAVAILABLE,
            "conversation store unavailable",
        );
    };
    match store.desktop_turns(&id) {
        Ok(turns) if !turns.is_empty() => {}
        Ok(_) => return error(StatusCode::NOT_FOUND, "conversation not found"),
        Err(err) => {
            tracing::warn!(?err, "load conversation failed");
            return error(
                StatusCode::INTERNAL_SERVER_ERROR,
                "conversation store unavailable",
            );
        }
    }
    let meta = DesktopConversationMeta {
        conversation_id: id.clone(),
        archived,
        ..store.desktop_conversation_meta(&id).unwrap_or_default()
    };
    if let Err(err) = store.save_desktop_conversation_meta(&meta) {
        tracing::warn!(?err, "archive/restore conversation failed");
        return error(
            StatusCode::INTERNAL_SERVER_ERROR,
            "conversation store unavailable",
        );
    }
    (
        StatusCode::OK,
        Json(serde_json::json!({
            "status": "ok",
            "id": id,
            "archived": archived,
        })),
    )
}
