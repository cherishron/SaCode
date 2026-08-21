use std::sync::Arc;

use axum::extract::{Path, State};
use axum::Json;
use tokio::sync::oneshot;

use crate::executor::task_runner::{ApprovalDecider, ApprovalDecision};
use crate::tools::SideEffectLevel;
use sacode_kernel::ExecutionMode;

use super::events::emit_event;
use super::DaemonState;

/// POST /task/:id/approve — VSCode 扩展回传审批结果
///
/// 请求体: `{ "approved": true/false }`
pub async fn resolve_approval(
    State(state): State<Arc<DaemonState>>,
    Path(task_id): Path<String>,
    Json(req): Json<serde_json::Value>,
) -> Json<serde_json::Value> {
    let approved = req
        .get("approved")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);

    let mut pending = state.pending_approvals.lock().await;
    if let Some(tx) = pending.remove(&task_id) {
        let _ = tx.send(approved);
        Json(serde_json::json!({ "task_id": task_id, "status": "resolved", "approved": approved }))
    } else {
        Json(serde_json::json!({
            "task_id": task_id,
            "status": "no_pending_approval",
            "error": "No pending approval found for this task"
        }))
    }
}

/// HTTP 审批决策器 — daemon 路径专用
///
/// 当工具需要审批时（Build 模式 + Modify 级工具），通过 SSE 发布
/// `approval_requested` 事件，然后阻塞等待 VSCode 扩展通过
/// `POST /task/:id/approve` 回传审批结果。
///
/// 阻塞机制：`decide()` 是同步函数，内部用 `std::sync::mpsc` + 轮询。
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
        // 发布 approval_requested 事件到 SSE
        emit_event(
            &self.state,
            &self.task_id,
            "approval_requested",
            serde_json::json!({
                "tool_name": tool_name,
                "side_effect_level": format!("{:?}", side_effect_level),
                "args": args,
            }),
        );

        // 创建 oneshot channel，把 sender 存入 pending_approvals
        let (tx, mut rx) = oneshot::channel::<bool>();
        {
            let mut pending = self.state.pending_approvals.blocking_lock();
            pending.insert(self.task_id.clone(), tx);
        }

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
                        pending.remove(&self.task_id);
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
