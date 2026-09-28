//! P0-1：`interaction.ask` 问题应答闭环
//!
//! 任务带 `pending_question` 等待用户回答时：
//! - `GET /task/:id/status` 暴露 `pending_question`
//! - `POST /task/:id/answer` 以答案续写会话（或新建任务），并清除挂起问题

use std::sync::Arc;

use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::Json;

use super::types::TaskRequest;
use super::DaemonState;

#[derive(Debug, serde::Deserialize)]
pub struct AnswerQuestionRequest {
    /// 自由文本回答；与 `selected` 至少一项非空
    #[serde(default)]
    pub answer: String,
    /// 选项回答（options 列表中的选中值）
    #[serde(default)]
    pub selected: Vec<String>,
    /// 用户取消提问
    #[serde(default)]
    pub cancelled: bool,
}

/// POST /task/:id/answer
pub async fn answer_task_question(
    State(state): State<Arc<DaemonState>>,
    Path(task_id): Path<String>,
    Json(req): Json<AnswerQuestionRequest>,
) -> (StatusCode, Json<serde_json::Value>) {
    let has_question = {
        let tasks = state.tasks.read().await;
        match tasks.get(&task_id) {
            Some(task) => task.pending_question.is_some(),
            None => {
                return (
                    StatusCode::NOT_FOUND,
                    Json(serde_json::json!({
                        "status": "error",
                        "message": "task not found",
                    })),
                );
            }
        }
    };
    if !has_question {
        return (
            StatusCode::CONFLICT,
            Json(serde_json::json!({
                "status": "error",
                "message": "task has no pending question",
            })),
        );
    }

    {
        let mut tasks = state.tasks.write().await;
        if let Some(task) = tasks.get_mut(&task_id) {
            task.pending_question = None;
        }
    }

    let answer_text = if req.cancelled {
        "（用户取消了提问）".to_string()
    } else {
        let mut parts: Vec<String> = Vec::new();
        if !req.answer.trim().is_empty() {
            parts.push(req.answer.trim().to_string());
        }
        if !req.selected.is_empty() {
            parts.push(req.selected.join("、"));
        }
        if parts.is_empty() {
            return (
                StatusCode::BAD_REQUEST,
                Json(serde_json::json!({
                    "status": "error",
                    "message": "answer or selected is required",
                })),
            );
        }
        parts.join("\n")
    };

    let conversation_id = state
        .store
        .as_ref()
        .and_then(|store| store.find_conversation_for_task(&task_id).ok().flatten());

    let request = TaskRequest {
        prompt: answer_text,
        mode: "build".to_string(),
        priority: "normal".to_string(),
        dependencies: vec![],
        retry_policy: None,
        scheduled_at: None,
        deadline: None,
        backend_id: None,
        session_id: None,
        model_provider: None,
        model_name: None,
        skill: None,
        context_paths: vec![],
    };

    if let Some(conversation_id) = conversation_id {
        super::desktop_conversations::append(State(state), Path(conversation_id), Json(request)).await
    } else {
        super::desktop_conversations::create(State(state), Json(request)).await
    }
}
