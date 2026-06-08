use std::{net::SocketAddr, sync::Arc};

use axum::{
    extract::{Path, State},
    Json,
};

use crate::tools::ToolRegistry;
use sacode_kernel::{ExecutionMode, ScheduledTask, Task, TaskQueueStatus};

use super::{
    events::emit_event,
    parse_mode, parse_priority,
    status::{
        parse_queue_status, parse_retry_policy, sync_task_status_from_task_run,
        task_run_for_queue_status, task_run_state_to_queue_status,
    },
    DaemonState, TaskRequest, TaskResponse, TaskStatus,
};

pub async fn health_check() -> Json<serde_json::Value> {
    Json(serde_json::json!({
        "status": "healthy",
        "version": env!("CARGO_PKG_VERSION")
    }))
}

pub async fn create_task(
    State(state): State<Arc<DaemonState>>,
    Json(req): Json<TaskRequest>,
) -> Json<TaskResponse> {
    let task_id = format!("task-{}", chrono::Utc::now().timestamp_millis());
    let mode = parse_mode(&req.mode);
    let priority = parse_priority(&req.priority);
    let retry_policy = parse_retry_policy(&req.retry_policy);
    let task = Task::new(req.prompt.clone(), mode, None);

    let scheduled_task = ScheduledTask::new(task_id.clone(), task)
        .with_priority(priority)
        .with_dependencies(req.dependencies.clone())
        .with_retry_policy(retry_policy);

    {
        let mut tasks = state.tasks.write().await;
        tasks.insert(
            task_id.clone(),
            TaskStatus::new(
                task_id.clone(),
                req.prompt.clone(),
                req.mode.clone(),
                priority.to_string(),
                scheduled_task.retry_policy.max_attempts,
            ),
        );
    }

    emit_event(
        &state,
        &task_id,
        "task_created",
        serde_json::json!({ "prompt": req.prompt, "mode": req.mode, "priority": priority.to_string() }),
    );

    match state.queue.submit(scheduled_task).await {
        Ok(_) => {
            let mut executor = state.executor.lock().await;
            let spawned = executor.run_once().await;

            Json(TaskResponse::queued(
                task_id,
                if spawned > 0 {
                    TaskQueueStatus::Running
                } else {
                    TaskQueueStatus::Pending
                },
                "Task created and submitted to queue".to_string(),
            ))
        }
        Err(e) => Json(TaskResponse::error(
            task_id,
            format!("Failed to submit task: {}", e),
        )),
    }
}

pub async fn get_task_status(
    State(state): State<Arc<DaemonState>>,
    Path(task_id): Path<String>,
) -> Json<serde_json::Value> {
    let tasks = state.tasks.read().await;

    if let Some(status) = tasks.get(&task_id) {
        let task_run = status.task_run.clone().or_else(|| {
            Some(task_run_for_queue_status(
                Some(status.task_id.clone()),
                parse_mode(&status.mode),
                status.prompt.clone(),
                parse_queue_status(&status.queue_status),
                status.output.clone().or_else(|| status.error.clone()),
            ))
        });
        let derived_status = status.derived_queue_status();
        return Json(serde_json::json!({
            "task_id": status.task_id,
            "prompt": status.prompt,
            "mode": status.mode,
            "status": derived_status,
            "queue_status": derived_status,
            "priority": status.priority,
            "progress": status.progress,
            "total_steps": status.total_steps,
            "current_event": status.current_event,
            "current_attempt": status.current_attempt,
            "max_attempts": status.max_attempts,
            "duration_ms": status.duration_ms,
            "error": status.error,
            "output": status.output,
            "task_run": task_run,
        }));
    }

    if let Some(queue_status) = state.queue.status(&task_id).await {
        if let Some(task) = state.queue.get_task(&task_id).await {
            let task_run = task_run_for_queue_status(
                Some(task.id.clone()),
                task.task.mode,
                task.task.prompt.clone(),
                queue_status,
                None,
            );
            let derived = task_run
                .state
                .as_ref()
                .map(task_run_state_to_queue_status)
                .unwrap_or_else(|| "pending".to_string());
            return Json(serde_json::json!({
                "task_id": task_id,
                "prompt": task.task.prompt,
                "mode": task.task.mode.to_string(),
                "status": derived.clone(),
                "queue_status": derived,
                "priority": task.priority.to_string(),
                "current_attempt": task.current_attempt,
                "max_attempts": task.retry_policy.max_attempts,
                "task_run": task_run,
            }));
        }
    }

    if let Some(result) = state.queue.get_result(&task_id).await {
        let task_run = state.queue.get_task_run(&task_id).await.unwrap_or_else(|| {
            task_run_for_queue_status(
                Some(result.task_id.clone()),
                ExecutionMode::Build,
                String::new(),
                result.status,
                result.output.clone().or_else(|| result.error.clone()),
            )
        });
        let derived = task_run
            .state
            .as_ref()
            .map(task_run_state_to_queue_status)
            .unwrap_or_else(|| "not_found".to_string());
        return Json(serde_json::json!({
            "task_id": task_id,
            "status": derived.clone(),
            "queue_status": derived,
            "duration_ms": result.duration_ms,
            "error": result.error,
            "output": result.output,
            "task_run": task_run,
        }));
    }

    Json(serde_json::json!({
        "task_id": task_id,
        "status": "not_found",
        "queue_status": "not_found",
    }))
}

pub async fn get_task_result(
    State(state): State<Arc<DaemonState>>,
    Path(task_id): Path<String>,
) -> Json<serde_json::Value> {
    {
        let tasks = state.tasks.read().await;
        if let Some(status) = tasks.get(&task_id) {
            let derived_status = status.derived_queue_status();
            return Json(serde_json::json!({
                "task_id": status.task_id.clone(),
                "status": derived_status.clone(),
                "queue_status": derived_status,
                "duration_ms": status.duration_ms,
                "error": status.error.clone(),
                "output": status.output.clone(),
                "task_run": status.task_run.clone(),
            }));
        }
    }

    if let Some(result) = state.queue.get_result(&task_id).await {
        let task_run = state.queue.get_task_run(&task_id).await.unwrap_or_else(|| {
            task_run_for_queue_status(
                Some(result.task_id.clone()),
                ExecutionMode::Build,
                String::new(),
                result.status,
                result.output.clone().or_else(|| result.error.clone()),
            )
        });
        let derived = task_run
            .state
            .as_ref()
            .map(task_run_state_to_queue_status)
            .unwrap_or_else(|| "not_found".to_string());
        return Json(serde_json::json!({
            "task_id": result.task_id,
            "status": derived,
            "queue_status": derived,
            "output": result.output,
            "error": result.error,
            "duration_ms": result.duration_ms,
            "completed_at": result.completed_at,
            "task_run": task_run,
        }));
    }

    Json(serde_json::json!({
        "task_id": task_id,
        "status": "not_found",
        "queue_status": "not_found",
        "message": "Task result not available yet",
    }))
}

pub async fn retry_task(
    State(state): State<Arc<DaemonState>>,
    Path(task_id): Path<String>,
) -> Json<serde_json::Value> {
    let queue_status = state.queue.status(&task_id).await;

    if queue_status != Some(TaskQueueStatus::Failed) {
        return Json(serde_json::json!({
            "task_id": task_id,
            "status": "error",
            "message": "Task is not in failed state, cannot retry",
        }));
    }

    if let Some(mut task) = state.queue.get_task(&task_id).await {
        if !task.can_retry() {
            return Json(serde_json::json!({
                "task_id": task_id,
                "status": "error",
                "message": "Task has exceeded max retry attempts",
            }));
        }

        task.increment_attempt();

        match state.queue.submit(task).await {
            Ok(_) => {
                let mut executor = state.executor.lock().await;
                executor.run_once().await;

                Json(serde_json::json!({
                    "task_id": task_id,
                    "status": "queued",
                    "message": "Task retry submitted",
                }))
            }
            Err(e) => Json(serde_json::json!({
                "task_id": task_id,
                "status": "error",
                "message": format!("Failed to submit retry: {}", e),
            })),
        }
    } else {
        Json(serde_json::json!({
            "task_id": task_id,
            "status": "error",
            "message": "Task not found in queue",
        }))
    }
}

pub async fn cancel_task(
    State(state): State<Arc<DaemonState>>,
    Path(task_id): Path<String>,
) -> Json<serde_json::Value> {
    let cancelled = state.queue.cancel(&task_id).await;

    if cancelled {
        {
            let mut tasks = state.tasks.write().await;
            if let Some(status) = tasks.get_mut(&task_id) {
                status.task_run = Some(task_run_for_queue_status(
                    Some(status.task_id.clone()),
                    parse_mode(&status.mode),
                    status.prompt.clone(),
                    TaskQueueStatus::Failed,
                    Some("Task cancelled".to_string()),
                ));
                status.error = Some("Task cancelled".to_string());
                sync_task_status_from_task_run(status);
            }
        }
        emit_event(&state, &task_id, "task_cancelled", serde_json::json!({}));
        Json(serde_json::json!({
            "task_id": task_id,
            "status": "cancelled",
            "message": "Task cancelled successfully",
        }))
    } else {
        Json(serde_json::json!({
            "task_id": task_id,
            "status": "error",
            "message": "Task cannot be cancelled (not in pending/ready/running state)",
        }))
    }
}

pub async fn get_queue_status(State(state): State<Arc<DaemonState>>) -> Json<serde_json::Value> {
    let stats = state.queue.stats().await;
    Json(serde_json::to_value(stats).unwrap_or_else(|_| {
        serde_json::json!({
            "error": "Failed to get queue stats"
        })
    }))
}

pub async fn get_pending_tasks(State(state): State<Arc<DaemonState>>) -> Json<serde_json::Value> {
    let stats = state.queue.stats().await;
    Json(serde_json::json!({
        "pending_count": stats.pending_count,
        "ready_count": stats.ready_count,
        "running_count": stats.running_count,
        "total_queued": stats.pending_count + stats.ready_count + stats.running_count,
    }))
}

pub async fn list_tools() -> Json<serde_json::Value> {
    let registry = ToolRegistry::builtin();
    Json(serde_json::json!({
        "tools": registry.names(),
    }))
}

pub async fn run_daemon(addr: SocketAddr) {
    let app = super::create_daemon().await;

    let listener = tokio::net::TcpListener::bind(addr).await.unwrap();
    axum::serve(listener, app).await.unwrap();
}
