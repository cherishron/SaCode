use std::{net::SocketAddr, sync::Arc};

use axum::{
    extract::{Path, State},
    Json,
};

use crate::tools::ToolRegistry;
use sacode_kernel::{
    generate_task_id, normalize_backend_id, AgentBackendId, BackendTaskMeta, EntrySource,
    ExecutionMode, ScheduledTask, Task, TaskQueueStatus, TASK_PROTOCOL_VERSION,
};

use crate::{
    assemble_checkpoint_snapshot, assemble_task_snapshot,
    code_audit::{run_audit, AuditScanOptions},
    task_changes::{capture_workspace_tree, diff_workspace_trees, TaskChangesSnapshot},
    TaskSnapshotProjection,
};

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
    let task_id = generate_task_id();
    let mode = parse_mode(&req.mode);
    let priority = parse_priority(&req.priority);
    let retry_policy = parse_retry_policy(&req.retry_policy);
    let task = Task::new(req.prompt.clone(), mode, None);

    let backend_id = normalize_backend_id(
        req.backend_id
            .as_deref()
            .map(AgentBackendId::new)
            .filter(|id| !id.as_str().is_empty()),
    );
    let backend = match state.agent_backends.resolve(Some(backend_id.clone())) {
        Ok((resolved, descriptor)) => BackendTaskMeta {
            backend_id: resolved,
            backend_kind: Some(descriptor.kind),
            agent_session_id: req.session_id.clone(),
        },
        Err(err) => {
            return Json(TaskResponse::backend_dispatch_error(
                task_id,
                mode,
                backend_id.as_str(),
                err.code.as_str(),
                &err.safe_message,
            ));
        }
    };

    if let (Some(workdir), Some(store)) = (state.workdir.as_deref(), state.store.as_ref()) {
        match capture_workspace_tree(workdir) {
            Ok(baseline) => {
                if let Err(error) = store.save_task_change_baseline(&task_id, &baseline) {
                    tracing::warn!(?error, ?task_id, "failed to persist task change baseline");
                }
            }
            Err(error) => {
                tracing::warn!(?error, ?task_id, "failed to capture task change baseline");
            }
        }
    }

    let scheduled_task = ScheduledTask::new(task_id.clone(), task)
        .with_priority(priority)
        .with_dependencies(req.dependencies.clone())
        .with_retry_policy(retry_policy)
        .with_backend_id(backend.backend_id.as_str());

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
                scheduled_task.created_at.to_rfc3339(),
            )
            .with_backend(Some(backend.clone())),
        );
    }

    emit_event(
        &state,
        &task_id,
        "task_created",
        serde_json::json!({
            "prompt": req.prompt,
            "mode": req.mode,
            "priority": priority.to_string(),
            "backend_id": backend.backend_id.as_str(),
            "task": assemble_task_snapshot(TaskSnapshotProjection {
                task_id: &task_id,
                mode,
                source: EntrySource::Daemon,
                queue_status: Some(TaskQueueStatus::Pending),
                task_run: None,
                output: None,
                error: None,
                backend: Some(&backend),
            }),
        }),
    );

    match state.queue.submit(scheduled_task).await {
        Ok(_) => {
            let mut executor = state.executor.lock().await;
            let spawned = executor.run_once().await;

            Json(TaskResponse::queued(
                task_id,
                mode,
                if spawned > 0 {
                    TaskQueueStatus::Running
                } else {
                    TaskQueueStatus::Pending
                },
                "Task created and submitted to queue".to_string(),
                Some(backend),
            ))
        }
        Err(e) => Json(TaskResponse::error(
            task_id,
            mode,
            format!("Failed to submit task: {}", e),
        )),
    }
}

pub async fn list_agents(State(state): State<Arc<DaemonState>>) -> Json<serde_json::Value> {
    let agents = state.agent_backends.list();
    Json(serde_json::json!({
        "agents": agents,
        "default_backend_id": sacode_kernel::DEFAULT_AGENT_BACKEND_ID,
    }))
}

pub async fn list_tasks(State(state): State<Arc<DaemonState>>) -> Json<serde_json::Value> {
    let tasks = state.tasks.read().await;
    let mut items: Vec<serde_json::Value> = tasks
        .values()
        .map(|status| {
            let derived_status = status.derived_queue_status();
            serde_json::json!({
                "task_id": status.task_id,
                "prompt": status.prompt,
                "mode": status.mode,
                "created_at": status.created_at,
                "status": derived_status,
                "queue_status": derived_status,
                "duration_ms": status.duration_ms,
                "error": status.error,
                "output": status.output,
                "task": status.snapshot(),
            })
        })
        .collect();
    items.sort_by(|left, right| {
        right["created_at"]
            .as_str()
            .cmp(&left["created_at"].as_str())
            .then_with(|| right["task_id"].as_str().cmp(&left["task_id"].as_str()))
    });

    Json(serde_json::json!({
        "protocol_version": TASK_PROTOCOL_VERSION,
        "tasks": items,
    }))
}

pub async fn get_task_changes(
    State(state): State<Arc<DaemonState>>,
    Path(task_id): Path<String>,
) -> Json<serde_json::Value> {
    let task_exists = state.tasks.read().await.contains_key(&task_id)
        || state.queue.get_task(&task_id).await.is_some();
    let Some(store) = state.store.as_ref() else {
        return Json(serde_json::json!({
            "protocol_version": TASK_PROTOCOL_VERSION,
            "task_id": task_id,
            "status": "unavailable",
            "message": "task store unavailable",
            "changes": [],
        }));
    };

    match store.load_task_changes(&task_id) {
        Ok(Some(snapshot)) => task_changes_response(&task_id, "final", snapshot),
        Ok(None) if task_exists => {
            let baseline = match store.load_task_change_baseline(&task_id) {
                Ok(Some(value)) => value,
                Ok(None) => {
                    return Json(serde_json::json!({
                        "protocol_version": TASK_PROTOCOL_VERSION,
                        "task_id": task_id,
                        "status": "unavailable",
                        "message": "task change baseline unavailable",
                        "changes": [],
                    }));
                }
                Err(error) => return task_changes_error(&task_id, error),
            };
            let Some(workdir) = state.workdir.as_deref() else {
                return Json(serde_json::json!({
                    "protocol_version": TASK_PROTOCOL_VERSION,
                    "task_id": task_id,
                    "status": "unavailable",
                    "message": "workdir unavailable",
                    "changes": [],
                }));
            };
            match capture_workspace_tree(workdir)
                .and_then(|final_tree| diff_workspace_trees(workdir, &baseline, &final_tree))
            {
                Ok(snapshot) => task_changes_response(&task_id, "live", snapshot),
                Err(error) => task_changes_error(&task_id, error),
            }
        }
        Ok(None) => Json(serde_json::json!({
            "protocol_version": TASK_PROTOCOL_VERSION,
            "task_id": task_id,
            "status": "not_found",
            "changes": [],
        })),
        Err(error) => task_changes_error(&task_id, error),
    }
}

fn task_changes_response(
    task_id: &str,
    status: &str,
    snapshot: TaskChangesSnapshot,
) -> Json<serde_json::Value> {
    Json(serde_json::json!({
        "protocol_version": TASK_PROTOCOL_VERSION,
        "task_id": task_id,
        "status": status,
        "baseline_tree": snapshot.baseline_tree,
        "final_tree": snapshot.final_tree,
        "changes": snapshot.changes,
    }))
}

fn task_changes_error(task_id: &str, error: anyhow::Error) -> Json<serde_json::Value> {
    Json(serde_json::json!({
        "protocol_version": TASK_PROTOCOL_VERSION,
        "task_id": task_id,
        "status": "error",
        "message": error.to_string(),
        "changes": [],
    }))
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
        let task = status.snapshot();
        return Json(serde_json::json!({
            "protocol_version": TASK_PROTOCOL_VERSION,
            "task_id": status.task_id,
            "prompt": status.prompt,
            "mode": status.mode,
            "created_at": status.created_at,
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
            "task": task,
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
            let snapshot = assemble_task_snapshot(TaskSnapshotProjection {
                task_id: &task_id,
                mode: task.task.mode,
                source: EntrySource::Daemon,
                queue_status: Some(queue_status),
                task_run: Some(&task_run),
                output: None,
                error: None,
                backend: None,
            });
            return Json(serde_json::json!({
                "protocol_version": TASK_PROTOCOL_VERSION,
                "task_id": task_id,
                "prompt": task.task.prompt,
                "mode": task.task.mode.to_string(),
                "status": derived.clone(),
                "queue_status": derived,
                "priority": task.priority.to_string(),
                "current_attempt": task.current_attempt,
                "max_attempts": task.retry_policy.max_attempts,
                "task_run": task_run,
                "task": snapshot,
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
        let snapshot = assemble_task_snapshot(TaskSnapshotProjection {
            task_id: &task_id,
            mode: task_run.mode.unwrap_or(ExecutionMode::Build),
            source: EntrySource::Daemon,
            queue_status: Some(result.status),
            task_run: Some(&task_run),
            output: result.output.as_deref(),
            error: result.error.as_deref(),
            backend: None,
        });
        return Json(serde_json::json!({
            "protocol_version": TASK_PROTOCOL_VERSION,
            "task_id": task_id,
            "status": derived.clone(),
            "queue_status": derived,
            "duration_ms": result.duration_ms,
            "error": result.error,
            "output": result.output,
            "task_run": task_run,
            "task": snapshot,
        }));
    }

    // 回退查询：CheckpointStorage 按 task_id 查找（跨进程恢复）
    // 适用于 CLI 进程崩溃后 daemon 重启，task 未入队但 checkpoint 已落盘的场景
    if let Some(workdir) = state.workdir.as_ref() {
        let storage = crate::CheckpointStorage::new(workdir);
        if let Ok(Some(checkpoint)) = storage.load_by_task_id(&task_id) {
            let derived = format!("{:?}", checkpoint.status).to_lowercase();
            let task = assemble_checkpoint_snapshot(&task_id, &checkpoint);
            return Json(serde_json::json!({
                "protocol_version": TASK_PROTOCOL_VERSION,
                "task_id": task_id,
                "status": derived,
                "queue_status": derived,
                "source": "checkpoint",
                "checkpoint": {
                    "status": checkpoint.status,
                    "task_id": checkpoint.task_id,
                    "created_at": checkpoint.created_at,
                    "updated_at": checkpoint.updated_at,
                    "event_count": checkpoint.recent_events.len(),
                    "tool_count": checkpoint.executed_tools.len(),
                },
                "task": task,
                "message": "task restored from checkpoint (cross-process recovery)",
            }));
        }
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
            let task = status.snapshot();
            return Json(serde_json::json!({
                "protocol_version": TASK_PROTOCOL_VERSION,
                "task_id": status.task_id.clone(),
                "status": derived_status.clone(),
                "queue_status": derived_status,
                "duration_ms": status.duration_ms,
                "error": status.error.clone(),
                "output": status.output.clone(),
                "task_run": status.task_run.clone(),
                "task": task,
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
        let snapshot = assemble_task_snapshot(TaskSnapshotProjection {
            task_id: &task_id,
            mode: task_run.mode.unwrap_or(ExecutionMode::Build),
            source: EntrySource::Daemon,
            queue_status: Some(result.status),
            task_run: Some(&task_run),
            output: result.output.as_deref(),
            error: result.error.as_deref(),
            backend: None,
        });
        return Json(serde_json::json!({
            "protocol_version": TASK_PROTOCOL_VERSION,
            "task_id": result.task_id,
            "status": derived,
            "queue_status": derived,
            "output": result.output,
            "error": result.error,
            "duration_ms": result.duration_ms,
            "completed_at": result.completed_at,
            "task_run": task_run,
            "task": snapshot,
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
        state.queue.remove_failed_task(&task_id).await;

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
        if let (Some(workdir), Some(store)) = (state.workdir.as_deref(), state.store.as_ref()) {
            if let Ok(Some(baseline)) = store.load_task_change_baseline(&task_id) {
                match capture_workspace_tree(workdir)
                    .and_then(|final_tree| diff_workspace_trees(workdir, &baseline, &final_tree))
                {
                    Ok(snapshot) => {
                        if let Err(error) = store.save_task_changes(&task_id, &snapshot) {
                            tracing::warn!(
                                ?error,
                                ?task_id,
                                "failed to persist cancelled task changes"
                            );
                        }
                    }
                    Err(error) => {
                        tracing::warn!(?error, ?task_id, "failed to freeze cancelled task changes");
                    }
                }
            }
        }
        // 中止 executor 中正在运行的 JoinHandle，使 LLM 调用和工具操作真正停止
        {
            let executor = state.executor.lock().await;
            executor.abort_task(&task_id).await;
        }
        {
            let mut tasks = state.tasks.write().await;
            if let Some(status) = tasks.get_mut(&task_id) {
                status.task_run = Some(task_run_for_queue_status(
                    Some(status.task_id.clone()),
                    parse_mode(&status.mode),
                    status.prompt.clone(),
                    TaskQueueStatus::Cancelled,
                    Some("Task cancelled".to_string()),
                ));
                status.error = Some("Task cancelled".to_string());
                sync_task_status_from_task_run(status);
            }
        }
        let cancelled_task = state
            .tasks
            .read()
            .await
            .get(&task_id)
            .map(TaskStatus::snapshot);
        emit_event(
            &state,
            &task_id,
            "task_cancelled",
            serde_json::json!({ "task": cancelled_task }),
        );
        // 清理该 task 的待审批 pending：sender drop 会立即唤醒异步等待者，
        // HttpApprovalDecider 随后发出 reason=cancelled 的 approval_resolved 事件。
        let cleared = state.clear_pending_approvals_for_task(&task_id).await;
        if cleared > 0 {
            tracing::info!(
                ?task_id,
                cleared,
                "cleared stale pending approvals on cancel"
            );
        }
        Json(serde_json::json!({
            "protocol_version": TASK_PROTOCOL_VERSION,
            "task_id": task_id,
            "status": "cancelled",
            "message": "Task cancelled successfully",
            "task": cancelled_task,
        }))
    } else if state.queue.status(&task_id).await == Some(TaskQueueStatus::Cancelled) {
        let task = state
            .tasks
            .read()
            .await
            .get(&task_id)
            .map(TaskStatus::snapshot);
        Json(serde_json::json!({
            "protocol_version": TASK_PROTOCOL_VERSION,
            "task_id": task_id,
            "status": "cancelled",
            "message": "Task was already cancelled",
            "task": task,
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

/// 按 task_id 查询 checkpoint（跨进程恢复接口）
///
/// 查询顺序：内存 tasks → 队列 → SQLite 结果 → CheckpointStorage
/// 当 CLI 进程崩溃后 daemon 重启，可通过此端点按 task_id 恢复 checkpoint，
/// 获取任务的完整状态（含事件历史、执行工具记录、统一状态机状态）。
pub async fn get_task_checkpoint(
    State(state): State<Arc<DaemonState>>,
    Path(task_id): Path<String>,
) -> Json<serde_json::Value> {
    // 无工作目录时无法访问 CheckpointStorage
    let Some(workdir) = state.workdir.as_ref() else {
        return Json(serde_json::json!({
            "task_id": task_id,
            "status": "not_found",
            "message": "workdir unavailable, checkpoint lookup disabled",
        }));
    };

    let storage = crate::CheckpointStorage::new(workdir);
    match storage.load_by_task_id(&task_id) {
        Ok(Some(checkpoint)) => Json(serde_json::json!({
            "task_id": task_id,
            "status": "found",
            "checkpoint": checkpoint,
        })),
        Ok(None) => Json(serde_json::json!({
            "task_id": task_id,
            "status": "not_found",
            "message": "no checkpoint found for this task_id",
        })),
        Err(error) => Json(serde_json::json!({
            "task_id": task_id,
            "status": "error",
            "message": format!("failed to load checkpoint: {error}"),
        })),
    }
}

pub async fn run_audit_scan(
    State(state): State<Arc<DaemonState>>,
    Json(req): Json<super::types::AuditRequest>,
) -> Json<serde_json::Value> {
    let Some(workdir) = state.workdir.as_ref() else {
        return Json(serde_json::json!({
            "status": "error",
            "message": "workdir unavailable",
        }));
    };
    let mut opts = AuditScanOptions::default();
    opts.use_ai = req.use_ai.unwrap_or(true);
    if let Some(max_files) = req.max_files {
        opts.max_files = max_files;
    }
    let provider = req.model_provider;
    match run_audit(workdir, &opts, provider.as_ref()).await {
        Ok(outcome) => {
            let audit_id = outcome
                .report
                .created_at
                .replace(':', "-")
                .replace('+', "p");
            let summary = super::types::AuditReportSummary {
                audit_id: audit_id.clone(),
                created_at: outcome.report.created_at.clone(),
                root: outcome.report.root.clone(),
                ai_used: outcome.report.ai_used,
                high: outcome.report.summary.high,
                medium: outcome.report.summary.medium,
                low: outcome.report.summary.low,
                info: outcome.report.summary.info,
                finding_count: outcome.report.findings.len(),
            };
            state
                .audit_reports
                .write()
                .await
                .insert(audit_id.clone(), summary);
            let findings: Vec<serde_json::Value> = outcome
                .report
                .findings
                .iter()
                .map(|f| serde_json::to_value(f).unwrap_or(serde_json::json!({})))
                .collect();
            Json(serde_json::json!({
                "status": "completed",
                "audit_id": audit_id,
                "report": outcome.report,
                "findings": findings,
                "report_json_path": outcome.report_json_path.map(|p| p.display().to_string()),
            }))
        }
        Err(error) => Json(serde_json::json!({
            "status": "error",
            "message": error.to_string(),
        })),
    }
}

pub async fn get_audit_report(
    State(state): State<Arc<DaemonState>>,
    Path(audit_id): Path<String>,
) -> Json<serde_json::Value> {
    let Some(workdir) = state.workdir.as_ref() else {
        return Json(serde_json::json!({
            "status": "error",
            "message": "workdir unavailable",
        }));
    };
    let report_dir = crate::code_audit::report::audit_report_path(workdir, &audit_id);
    let report_path = report_dir.join("report.json");
    if !report_path.exists() {
        return Json(serde_json::json!({
            "status": "not_found",
            "audit_id": audit_id,
        }));
    }
    match crate::code_audit::report::load_report(&report_path) {
        Ok(report) => {
            let summary = state
                .audit_reports
                .read()
                .await
                .get(&audit_id)
                .map(|s| serde_json::to_value(s).unwrap_or(serde_json::json!({})));
            let findings: Vec<serde_json::Value> = report
                .findings
                .iter()
                .map(|f| serde_json::to_value(f).unwrap_or(serde_json::json!({})))
                .collect();
            Json(serde_json::json!({
                "status": "found",
                "audit_id": audit_id,
                "report": report,
                "findings": findings,
                "summary_cached": summary,
            }))
        }
        Err(error) => Json(serde_json::json!({
            "status": "error",
            "audit_id": audit_id,
            "message": error.to_string(),
        })),
    }
}

pub async fn list_audit_reports(State(state): State<Arc<DaemonState>>) -> Json<serde_json::Value> {
    let reports = state.audit_reports.read().await;
    let mut items: Vec<serde_json::Value> = reports
        .values()
        .map(|s| serde_json::to_value(s).unwrap_or(serde_json::json!({})))
        .collect();
    items.sort_by(|a, b| {
        b.get("created_at")
            .and_then(|v| v.as_str())
            .cmp(&a.get("created_at").and_then(|v| v.as_str()))
    });
    Json(serde_json::json!({
        "reports": items,
    }))
}

pub async fn run_daemon(addr: SocketAddr) {
    let app = super::create_daemon().await;

    // bind 失败通常是端口占用，panic 会中断整个进程且无有用上下文
    let listener = match tokio::net::TcpListener::bind(addr).await {
        Ok(listener) => listener,
        Err(error) => {
            eprintln!("daemon bind {addr} 失败: {error}");
            return;
        }
    };
    if let Err(error) = axum::serve(listener, app).await {
        eprintln!("daemon serve 失败: {error}");
    }
}
