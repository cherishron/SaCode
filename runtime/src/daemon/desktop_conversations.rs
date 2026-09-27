use std::sync::Arc;

use axum::{
    extract::{Path, State},
    http::StatusCode,
    Json,
};
use sacode_kernel::TASK_PROTOCOL_VERSION;

use super::{
    handlers::{dispatch_task_with_turn, TaskDispatchError},
    parse_mode, DaemonState, TaskRequest, TaskResponse,
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

pub async fn list(State(state): State<Arc<DaemonState>>) -> (StatusCode, Json<serde_json::Value>) {
    let Some(store) = state.store.as_ref() else {
        return error(
            StatusCode::SERVICE_UNAVAILABLE,
            "conversation store unavailable",
        );
    };
    match store.desktop_conversations() {
        Ok(entries) => {
            let tasks = state.tasks.read().await;
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
                let latest = turns.last().and_then(|turn| tasks.get(&turn.task_id));
                conversations.push(serde_json::json!({"id": entry.conversation_id, "title": entry.prompt, "created_at": entry.created_at, "latest_task_id": turns.last().map(|turn| &turn.task_id), "status": latest.map(|task| task.derived_queue_status().to_string()).unwrap_or_else(|| "unknown".into())}));
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
    match store.desktop_turns(&id) {
        Ok(turns) if !turns.is_empty() => {
            let tasks = state.tasks.read().await;
            let turns: Vec<_> = turns.iter().map(|turn| {
                let task = tasks.get(&turn.task_id);
                serde_json::json!({"task_id": turn.task_id, "prompt": turn.prompt, "created_at": turn.created_at,
                    "status": task.map(|task| task.derived_queue_status().to_string()).unwrap_or_else(|| "unknown".into()),
                    "output": task.and_then(|task| task.output.as_deref()), "error": task.and_then(|task| task.error.as_deref())})
            }).collect();
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
            let response = TaskResponse::queued(
                task_id,
                parse_mode(&req.mode),
                queue_status,
                "Task created and submitted to queue".into(),
                Some(backend),
            );
            let mut value = serde_json::to_value(response).unwrap_or_default();
            value["conversation_id"] = serde_json::json!(conversation_id);
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
