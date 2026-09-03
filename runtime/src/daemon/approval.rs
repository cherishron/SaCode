use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;

use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::Json;
use tokio::sync::oneshot;

use crate::executor::task_runner::{ApprovalDecider, ApprovalDecision};
use crate::tools::SideEffectLevel;
use sacode_kernel::ExecutionMode;

use super::events::emit_event;
use super::{ApprovalResolution, DaemonState, PendingApproval};

/// GET /task/:id/approvals — 查询任务当前待审批列表
///
/// 用于客户端（如 VSCode 扩展）断线重连后恢复审批 UI，不依赖 SSE 恰好在线。
/// 返回 `{ "task_id", "approvals": [ {approval_id, tool_name, side_effect_level, args, waited_secs}, ... ] }`。
pub async fn list_task_approvals(
    State(state): State<Arc<DaemonState>>,
    Path(task_id): Path<String>,
) -> Json<serde_json::Value> {
    let approvals = state.list_pending_approvals(&task_id).await;
    Json(serde_json::json!({
        "task_id": task_id,
        "approvals": approvals,
    }))
}

/// GET /metrics — daemon 可观测性指标快照
///
/// 当前包含审批计数与等待时间；P2-3 将补充 SSE 连接/吞吐/lagged 指标。
pub async fn get_metrics(State(state): State<Arc<DaemonState>>) -> Json<serde_json::Value> {
    let pending = state.pending_approvals.lock().await.len() as u64;
    let mut snapshot = state.metrics.snapshot();
    snapshot["approval"]["pending"] = serde_json::json!(pending);
    Json(snapshot)
}

/// 全局审批序号：保证同一任务内多个审批 ID 唯一
static APPROVAL_SEQ: AtomicU64 = AtomicU64::new(0);

/// 生成唯一审批 ID：`{task_id}-{seq}`，同一任务连续审批不冲突
fn generate_approval_id(task_id: &str) -> String {
    let seq = APPROVAL_SEQ.fetch_add(1, Ordering::Relaxed);
    format!("{task_id}-{seq}")
}

/// POST /task/:id/approve — VSCode 扩展回传审批结果
///
/// 请求体: `{ "approval_id": "...", "approved": true/false, "reason": "..."?, "args_override": {...}? }`
///
/// 响应状态码：
/// - 200：审批已接收并解除等待
/// - 400：缺少 `approval_id` 或 `approved` 字段
/// - 404：该 approval_id 不存在或已处理
/// - 409：approval_id 与路径 task_id 不匹配
fn validate_args_override(
    entry: &PendingApproval,
    approved: bool,
    args_override: Option<serde_json::Value>,
) -> Result<Option<serde_json::Value>, String> {
    let Some(override_value) = args_override else {
        return Ok(None);
    };
    if !approved {
        return Err("args_override requires approved=true".to_string());
    }
    if entry.tool_name != "fs.apply_patch" {
        return Err("args_override is only supported for fs.apply_patch".to_string());
    }
    let object = override_value
        .as_object()
        .ok_or_else(|| "args_override must be an object".to_string())?;
    if object.len() != 1 || !object.contains_key("paths") {
        return Err("fs.apply_patch args_override may only contain paths".to_string());
    }
    let paths = object["paths"]
        .as_array()
        .ok_or_else(|| "args_override.paths must be an array".to_string())?;
    if paths.is_empty() || paths.len() > 128 {
        return Err("args_override.paths must contain 1 to 128 paths".to_string());
    }
    if paths.iter().any(|path| match path.as_str() {
        Some(value) => value.is_empty() || value.len() > 1024,
        None => true,
    }) {
        return Err(
            "args_override.paths entries must be non-empty strings up to 1024 bytes".to_string(),
        );
    }

    let mut approved_args = entry
        .args
        .as_object()
        .cloned()
        .ok_or_else(|| "pending approval args must be an object".to_string())?;
    if let Some(original_paths) = approved_args
        .get("paths")
        .and_then(|value| value.as_array())
    {
        let original_paths: std::collections::HashSet<&str> = original_paths
            .iter()
            .filter_map(|path| path.as_str())
            .collect();
        if paths
            .iter()
            .filter_map(|path| path.as_str())
            .any(|path| !original_paths.contains(path))
        {
            return Err(
                "args_override.paths may not expand the original paths whitelist".to_string(),
            );
        }
    }
    approved_args.insert("paths".to_string(), serde_json::Value::Array(paths.clone()));
    Ok(Some(serde_json::Value::Object(approved_args)))
}

pub async fn resolve_approval(
    State(state): State<Arc<DaemonState>>,
    Path(task_id): Path<String>,
    Json(req): Json<serde_json::Value>,
) -> (StatusCode, Json<serde_json::Value>) {
    let approval_id = match req.get("approval_id").and_then(|v| v.as_str()) {
        Some(id) if !id.is_empty() => id.to_string(),
        _ => {
            return (
                StatusCode::BAD_REQUEST,
                Json(serde_json::json!({
                    "status": "bad_request",
                    "error": "missing required field: approval_id"
                })),
            )
        }
    };
    let approved = match req.get("approved").and_then(|v| v.as_bool()) {
        Some(v) => v,
        None => {
            return (
                StatusCode::BAD_REQUEST,
                Json(serde_json::json!({
                    "status": "bad_request",
                    "error": "missing required field: approved (boolean)"
                })),
            )
        }
    };

    let reason = match req.get("reason") {
        None | Some(serde_json::Value::Null) => None,
        Some(serde_json::Value::String(reason)) if reason.len() <= 128 => Some(reason.clone()),
        Some(serde_json::Value::String(_)) => {
            return (
                StatusCode::BAD_REQUEST,
                Json(serde_json::json!({
                    "status": "bad_request",
                    "error": "reason must be at most 128 bytes"
                })),
            )
        }
        Some(_) => {
            return (
                StatusCode::BAD_REQUEST,
                Json(serde_json::json!({
                    "status": "bad_request",
                    "error": "reason must be a string"
                })),
            )
        }
    };

    let args_override = req.get("args_override").cloned();

    let mut pending = state.pending_approvals.lock().await;
    match pending.remove(&approval_id) {
        Some(entry) => {
            if entry.task_id != task_id {
                // approval_id 存在但属于其他任务：路径与审批不匹配
                // 说明客户端携带了过期/错误的 approval_id，返回 409 并放回
                pending.insert(approval_id.clone(), entry);
                return (
                    StatusCode::CONFLICT,
                    Json(serde_json::json!({
                        "status": "conflict",
                        "error": "approval_id does not belong to task in path"
                    })),
                );
            }
            let approved_args = match validate_args_override(&entry, approved, args_override) {
                Ok(args) => args,
                Err(error) => {
                    pending.insert(approval_id.clone(), entry);
                    return (
                        StatusCode::BAD_REQUEST,
                        Json(serde_json::json!({
                            "status": "bad_request",
                            "error": error,
                        })),
                    );
                }
            };
            // 发送审批结果，解除 task_runner 的等待
            let _ = entry.tx.send(ApprovalResolution {
                approved,
                reason: reason.clone(),
                approved_args,
            });
            (
                StatusCode::OK,
                Json(serde_json::json!({
                    "task_id": task_id,
                    "approval_id": approval_id,
                    "status": "resolved",
                    "approved": approved,
                    "reason": reason
                })),
            )
        }
        None => (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({
                "status": "not_found",
                "error": "no pending approval found for approval_id",
                "approval_id": approval_id,
            })),
        ),
    }
}

/// HTTP 审批决策器 — daemon 路径专用
///
/// 当工具需要审批时（Build 模式 + 非 mcp 工具），先注册 pending 请求
/// （含唯一 approval_id），再通过 SSE 发布 `approval_requested` 事件，
/// 然后异步等待 VSCode 扩展通过 `POST /task/:id/approve` 回传审批结果。
///
/// 先注册再通知：消除“SSE 已发出但 pending 表尚未登记”的竞态窗口。
/// 等待使用 `oneshot.await` + `tokio::time::timeout`，不会占用 Tokio worker 线程。
pub struct HttpApprovalDecider {
    state: Arc<DaemonState>,
    task_id: String,
    timeout: std::time::Duration,
}

impl HttpApprovalDecider {
    const DEFAULT_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(300);

    pub fn new(state: Arc<DaemonState>, task_id: String) -> Self {
        Self {
            state,
            task_id,
            timeout: Self::DEFAULT_TIMEOUT,
        }
    }

    #[cfg(test)]
    pub(crate) fn with_timeout(
        state: Arc<DaemonState>,
        task_id: String,
        timeout: std::time::Duration,
    ) -> Self {
        Self {
            state,
            task_id,
            timeout,
        }
    }

    fn emit_resolved(&self, approval_id: &str, approved: bool, reason: Option<&str>) {
        let mut data = serde_json::json!({
            "approval_id": approval_id,
            "approved": approved,
        });
        if let Some(reason) = reason {
            data["reason"] = serde_json::Value::String(reason.to_string());
        }
        emit_event(&self.state, &self.task_id, "approval_resolved", data);
    }
}

#[async_trait::async_trait]
impl ApprovalDecider for HttpApprovalDecider {
    fn needs_interactive_approval(&self, tool_name: &str, mode: ExecutionMode) -> bool {
        mode == ExecutionMode::Build && !tool_name.starts_with("mcp.")
    }

    async fn decide(
        &self,
        tool_name: &str,
        side_effect_level: SideEffectLevel,
        args: &serde_json::Value,
    ) -> ApprovalDecision {
        let approval_id = generate_approval_id(&self.task_id);
        let (tx, mut rx) = oneshot::channel::<ApprovalResolution>();
        let created_at = std::time::Instant::now();

        {
            let mut pending = self.state.pending_approvals.lock().await;
            pending.insert(
                approval_id.clone(),
                PendingApproval {
                    task_id: self.task_id.clone(),
                    created_at,
                    tool_name: tool_name.to_string(),
                    side_effect_level: format!("{:?}", side_effect_level),
                    args: args.clone(),
                    timeout: self.timeout,
                    tx,
                },
            );
        }
        self.state
            .metrics
            .approval
            .requested
            .fetch_add(1, Ordering::Relaxed);

        emit_event(
            &self.state,
            &self.task_id,
            "approval_requested",
            serde_json::json!({
                "approval_id": approval_id,
                "tool_name": tool_name,
                "side_effect_level": format!("{:?}", side_effect_level),
                "args": args,
            }),
        );

        // 统一的指标记录：审批一旦解决（批准/拒绝/超时/取消）即累加对应计数与等待时间
        let approval_metrics = &self.state.metrics.approval;
        let record = |counter: &AtomicU64| {
            counter.fetch_add(1, Ordering::Relaxed);
            approval_metrics
                .total_wait_ms
                .fetch_add(created_at.elapsed().as_millis() as u64, Ordering::Relaxed);
        };

        match tokio::time::timeout(self.timeout, &mut rx).await {
            Ok(Ok(resolution)) => {
                let approved = resolution.approved;
                record(if approved {
                    &approval_metrics.approved
                } else {
                    &approval_metrics.denied
                });
                self.emit_resolved(&approval_id, approved, resolution.reason.as_deref());
                if approved {
                    resolution
                        .approved_args
                        .map(ApprovalDecision::ApprovedWithArgs)
                        .unwrap_or(ApprovalDecision::Approved)
                } else {
                    ApprovalDecision::Denied
                }
            }
            Ok(Err(_)) => {
                // cancel 清理 pending 时 sender 被 drop，oneshot 会立即唤醒。
                record(&approval_metrics.cancelled);
                self.emit_resolved(&approval_id, false, Some("cancelled"));
                ApprovalDecision::Denied
            }
            Err(_) => {
                let removed = {
                    let mut pending = self.state.pending_approvals.lock().await;
                    pending.remove(&approval_id).is_some()
                };

                if !removed {
                    // resolve_approval 或 cancel 可能刚好取走 sender；区分已提交决定与
                    // sender 被取消清理，避免在超时边界上误报原因。
                    return match rx.await {
                        Ok(resolution) => {
                            let approved = resolution.approved;
                            record(if approved {
                                &approval_metrics.approved
                            } else {
                                &approval_metrics.denied
                            });
                            self.emit_resolved(
                                &approval_id,
                                approved,
                                resolution.reason.as_deref(),
                            );
                            if approved {
                                resolution
                                    .approved_args
                                    .map(ApprovalDecision::ApprovedWithArgs)
                                    .unwrap_or(ApprovalDecision::Approved)
                            } else {
                                ApprovalDecision::Denied
                            }
                        }
                        Err(_) => {
                            record(&approval_metrics.cancelled);
                            self.emit_resolved(&approval_id, false, Some("cancelled"));
                            ApprovalDecision::Denied
                        }
                    };
                }

                record(&approval_metrics.timed_out);
                self.emit_resolved(&approval_id, false, Some("timeout"));
                ApprovalDecision::Denied
            }
        }
    }
}
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn approval_ids_unique_within_task() {
        let a = generate_approval_id("task-1");
        let b = generate_approval_id("task-1");
        assert_ne!(a, b);
    }

    #[test]
    fn approval_ids_unique_across_tasks() {
        let a = generate_approval_id("task-1");
        let b = generate_approval_id("task-2");
        assert_ne!(a, b);
    }
}
