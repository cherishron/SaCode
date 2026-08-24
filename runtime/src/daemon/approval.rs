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
use super::{DaemonState, PendingApproval};

/// 全局审批序号：保证同一任务内多个审批 ID 唯一
static APPROVAL_SEQ: AtomicU64 = AtomicU64::new(0);

/// 生成唯一审批 ID：`{task_id}-{seq}`，同一任务连续审批不冲突
fn generate_approval_id(task_id: &str) -> String {
    let seq = APPROVAL_SEQ.fetch_add(1, Ordering::Relaxed);
    format!("{task_id}-{seq}")
}

/// POST /task/:id/approve — VSCode 扩展回传审批结果
///
/// 请求体: `{ "approval_id": "...", "approved": true/false }`
///
/// 响应状态码：
/// - 200：审批已接收并解除等待
/// - 400：缺少 `approval_id` 或 `approved` 字段
/// - 404：该 approval_id 不存在或已处理
/// - 409：approval_id 与路径 task_id 不匹配
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
            // 发送审批结果，解除 task_runner 的等待
            let _ = entry.tx.send(approved);
            (
                StatusCode::OK,
                Json(serde_json::json!({
                    "task_id": task_id,
                    "approval_id": approval_id,
                    "status": "resolved",
                    "approved": approved
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
/// 然后阻塞等待 VSCode 扩展通过 `POST /task/:id/approve` 回传审批结果。
///
/// 先注册再通知：消除"SSE 已发出但 pending 表尚未登记"的竞态窗口，
/// 扩展即使在事件到达的瞬间立即回传，也能匹配到已登记的审批。
///
/// 阻塞机制：`decide()` 是同步函数，内部轮询 oneshot receiver。
/// 轮询超时 5 分钟后自动拒绝（防止扩展崩溃导致任务永久挂起）。
pub struct HttpApprovalDecider {
    state: Arc<DaemonState>,
    task_id: String,
}

impl HttpApprovalDecider {
    pub fn new(state: Arc<DaemonState>, task_id: String) -> Self {
        Self { state, task_id }
    }
}

impl ApprovalDecider for HttpApprovalDecider {
    fn needs_interactive_approval(&self, tool_name: &str, mode: ExecutionMode) -> bool {
        mode == ExecutionMode::Build && !tool_name.starts_with("mcp.")
    }

    fn decide(
        &self,
        tool_name: &str,
        side_effect_level: SideEffectLevel,
        args: &serde_json::Value,
    ) -> ApprovalDecision {
        let approval_id = generate_approval_id(&self.task_id);

        // 创建 oneshot channel，把 sender 存入 pending_approvals
        let (tx, mut rx) = oneshot::channel::<bool>();
        {
            let mut pending = self.state.pending_approvals.blocking_lock();
            pending.insert(
                approval_id.clone(),
                PendingApproval {
                    task_id: self.task_id.clone(),
                    created_at: std::time::Instant::now(),
                    tx,
                },
            );
        }

        // 先注册再通知：pending 表已含此 approval_id，扩展即时回传也能命中
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

        // 阻塞等待审批结果（轮询，超时 5 分钟）
        let timeout = std::time::Duration::from_secs(300);
        let start = std::time::Instant::now();
        loop {
            // 尝试非阻塞接收
            match rx.try_recv() {
                Ok(approved) => {
                    // 发送 approval_resolved 事件
                    emit_event(
                        &self.state,
                        &self.task_id,
                        "approval_resolved",
                        serde_json::json!({ "approved": approved }),
                    );
                    return if approved {
                        ApprovalDecision::Approved
                    } else {
                        ApprovalDecision::Denied
                    };
                }
                Err(oneshot::error::TryRecvError::Empty) => {
                    if start.elapsed() > timeout {
                        // 超时自动拒绝
                        let mut pending = self.state.pending_approvals.blocking_lock();
                        pending.remove(&approval_id);
                        emit_event(
                            &self.state,
                            &self.task_id,
                            "approval_resolved",
                            serde_json::json!({ "approved": false, "reason": "timeout" }),
                        );
                        return ApprovalDecision::Denied;
                    }
                    std::thread::sleep(std::time::Duration::from_millis(200));
                }
                Err(oneshot::error::TryRecvError::Closed) => {
                    // sender 被 drop（不应发生）
                    return ApprovalDecision::Denied;
                }
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
