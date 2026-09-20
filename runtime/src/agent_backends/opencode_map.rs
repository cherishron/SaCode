//! OpenCode / generic ACP → AgentEvent → Task/SSE projection (M4).
//!
//! Explicit mapping table from implementation plan. Unknown events are
//! preserved as `backend_event_unmapped` and never crash the process.

use sacode_acp_client::AcpClientEvent;
use sacode_kernel::{AgentBackendId, AgentEvent};
use serde_json::Value;

/// Projected SSE / daemon event after AgentEvent mapping.
#[derive(Debug, Clone, PartialEq)]
pub struct ProjectedEvent {
    /// Daemon SSE `event_type` / stream event name.
    pub sse_event: String,
    /// AgentEvent internal model (not client-public protocol).
    pub agent_event: AgentEvent,
    /// Payload for SSE data (already includes task_id when known).
    pub data: Value,
}

/// Map ACP notification method + params into AgentEvent.
///
/// Reference plan table:
/// | ACP | AgentEvent | SSE |
/// | session started | Started | backend_session_started |
/// | text delta | TextDelta | message |
/// | reasoning | ThinkingDelta | thinking |
/// | tool start | ToolCall | tool_call_started |
/// | permission request | PermissionRequest | approval_requested |
/// | result | Completed | task_completed |
/// | protocol error | Failed | task_failed |
pub fn map_acp_notification(
    method: &str,
    params: Option<&Value>,
    default_backend: &AgentBackendId,
) -> Option<AgentEvent> {
    let params = params.cloned().unwrap_or(Value::Null);
    match method {
        "session/event" | "session/update" | "agent/event" => {
            map_session_event_payload(&params, default_backend)
        }
        "session/started" | "session/new" => Some(AgentEvent::Started {
            backend_id: default_backend.clone(),
            agent_session_id: params
                .get("sessionId")
                .and_then(|v| v.as_str())
                .map(str::to_string),
        }),
        "session/completed" | "session/result" => Some(AgentEvent::Completed {
            summary: extract_text(&params),
        }),
        "session/error" | "error" => Some(AgentEvent::Failed {
            code_name: params
                .get("code")
                .and_then(|v| v.as_str())
                .unwrap_or("backend/protocol_error")
                .to_string(),
            safe_message: params
                .get("message")
                .and_then(|v| v.as_str())
                .unwrap_or("ACP agent error")
                .to_string(),
        }),
        "session/cancelled" | "session/canceled" => Some(AgentEvent::Cancelled),
        other => {
            tracing::debug!(method = other, "acp unmapped notification method");
            None
        }
    }
}

fn map_session_event_payload(
    params: &Value,
    default_backend: &AgentBackendId,
) -> Option<AgentEvent> {
    // OpenCode 1.18: { sessionId, update: { sessionUpdate, content?, ... } }
    // Generic adapters: { sessionId, event: { kind, text, ... } } or flat params
    let event = params
        .get("update")
        .or_else(|| params.get("event"))
        .unwrap_or(params);

    let kind = event
        .get("sessionUpdate")
        .or_else(|| event.get("kind"))
        .or_else(|| event.get("type"))
        .and_then(|v| v.as_str())
        .unwrap_or("");

    // Noise from OpenCode that must not be treated as agent output.
    match kind {
        "available_commands_update"
        | "usage_update"
        | "session_config_update"
        | "file_update"
        | "todo_update"
        | "tool_available_update" => {
            return None;
        }
        _ => {}
    }

    match kind {
        "session_started" | "started" | "session_status" => Some(AgentEvent::Started {
            backend_id: default_backend.clone(),
            agent_session_id: params
                .get("sessionId")
                .and_then(|v| v.as_str())
                .map(str::to_string),
        }),
        // OpenCode text stream: update.content = { type: "text", text: "..." }
        "agent_message_chunk" | "text" | "text_delta" | "message" | "message_delta" => {
            let text = event
                .get("content")
                .and_then(|c| {
                    if c.is_string() {
                        c.as_str().map(str::to_string)
                    } else {
                        extract_text(c)
                    }
                })
                .or_else(|| extract_text(event))
                .unwrap_or_default();
            if text.is_empty() {
                return None;
            }
            Some(AgentEvent::TextDelta { text })
        }
        "agent_reasoning_delta"
        | "agent_reasoning_chunk"
        | "thinking"
        | "reasoning"
        | "reasoning_delta" => Some(AgentEvent::ThinkingDelta {
            text: event
                .get("content")
                .and_then(|c| extract_text(c))
                .or_else(|| extract_text(event))
                .unwrap_or_default(),
        }),
        "tool_call"
        | "tool_started"
        | "tool_call_started"
        | "tool"
        | "tool_execution_started"
        | "tool_execution_updated"
        | "tool_execution_finished" => Some(AgentEvent::ToolCall {
            tool: event
                .get("tool")
                .or_else(|| event.get("toolName"))
                .or_else(|| event.get("name"))
                .and_then(|v| v.as_str())
                .unwrap_or("unknown")
                .to_string(),
            summary: extract_text(event),
        }),
        "permission_request"
        | "approval_requested"
        | "permission"
        | "tool_execution_approval_requested" => Some(AgentEvent::PermissionRequest {
            request_id: event
                .get("requestId")
                .or_else(|| event.get("request_id"))
                .or_else(|| event.get("id"))
                .and_then(|v| v.as_str())
                .unwrap_or("unknown")
                .to_string(),
            tool: event
                .get("tool")
                .or_else(|| event.get("toolName"))
                .and_then(|v| v.as_str())
                .unwrap_or("unknown")
                .to_string(),
            summary: extract_text(event),
        }),
        "permission_resolved" | "approval_resolved" => Some(AgentEvent::PermissionResolved {
            request_id: event
                .get("requestId")
                .or_else(|| event.get("request_id"))
                .and_then(|v| v.as_str())
                .unwrap_or("unknown")
                .to_string(),
            approved: event
                .get("approved")
                .and_then(|v| v.as_bool())
                .unwrap_or(false),
        }),
        "completed" | "result" | "done" | "session_completed" => Some(AgentEvent::Completed {
            summary: extract_text(event),
        }),
        "failed" | "error" => Some(AgentEvent::Failed {
            code_name: event
                .get("code")
                .and_then(|v| v.as_str())
                .unwrap_or("backend/protocol_error")
                .to_string(),
            safe_message: event
                .get("message")
                .or_else(|| event.get("error"))
                .and_then(|v| v.as_str())
                .unwrap_or("ACP agent failure")
                .to_string(),
        }),
        "cancelled" | "canceled" => Some(AgentEvent::Cancelled),
        _ => None,
    }
}

fn extract_text(value: &Value) -> Option<String> {
    for key in ["text", "content", "message", "summary", "delta"] {
        if let Some(s) = value.get(key).and_then(|v| v.as_str()) {
            if !s.is_empty() {
                return Some(s.to_string());
            }
        }
    }
    None
}

/// SSE event name for an AgentEvent (plan mapping table).
pub fn sse_event_name(event: &AgentEvent) -> &'static str {
    match event {
        AgentEvent::Started { .. } => "backend_session_started",
        AgentEvent::TextDelta { .. } => "message",
        AgentEvent::ThinkingDelta { .. } => "thinking",
        AgentEvent::ToolCall { .. } => "tool_call_started",
        AgentEvent::PermissionRequest { .. } => "approval_requested",
        AgentEvent::PermissionResolved { .. } => "approval_resolved",
        AgentEvent::Failed { .. } => "task_failed",
        AgentEvent::Completed { .. } => "task_completed",
        AgentEvent::Cancelled => "task_cancelled",
    }
}

/// Project ACP client event into daemon SSE stream events for one task.
pub fn project_acp_client_event(
    event: &AcpClientEvent,
    task_id: &str,
    backend_id: &AgentBackendId,
) -> Vec<ProjectedEvent> {
    match event {
        AcpClientEvent::Notification { method, params } => {
            match map_acp_notification(method, params.as_ref(), backend_id) {
                Some(agent_event) => vec![project_agent_event(agent_event, task_id, backend_id)],
                None => {
                    // Skip pure noise (usage/commands) without inventing a Completed event.
                    let is_noise = params
                        .as_ref()
                        .and_then(|p| p.get("update"))
                        .or_else(|| params.as_ref().and_then(|p| p.get("event")))
                        .and_then(|e| {
                            e.get("sessionUpdate")
                                .or_else(|| e.get("kind"))
                                .and_then(|v| v.as_str())
                        })
                        .map(|k| {
                            matches!(
                                k,
                                "available_commands_update"
                                    | "usage_update"
                                    | "session_config_update"
                                    | "file_update"
                                    | "todo_update"
                                    | "tool_available_update"
                            )
                        })
                        .unwrap_or(false);
                    if is_noise {
                        return Vec::new();
                    }
                    vec![ProjectedEvent {
                        sse_event: "backend_event_unmapped".to_string(),
                        // Do not use Completed — it would pollute task output summaries.
                        agent_event: AgentEvent::Failed {
                            code_name: "backend/event_unmapped".to_string(),
                            safe_message: format!("unmapped ACP event: {method}"),
                        },
                        data: serde_json::json!({
                            "task_id": task_id,
                            "backend_id": backend_id.as_str(),
                            "method": method,
                            "params": params,
                        }),
                    }]
                }
            }
        }
        AcpClientEvent::IncomingRequest {
            method: _,
            id,
            params,
        } => {
            let tool = params
                .as_ref()
                .and_then(|p| p.get("tool"))
                .and_then(|v| v.as_str())
                .unwrap_or("unknown")
                .to_string();
            let agent_event = AgentEvent::PermissionRequest {
                request_id: id.to_string(),
                tool,
                summary: None,
            };
            vec![project_agent_event(agent_event, task_id, backend_id)]
        }
        AcpClientEvent::Closed => {
            let agent_event = AgentEvent::Failed {
                code_name: sacode_kernel::BackendFailureCode::BackendProcessExited
                    .as_str()
                    .to_string(),
                safe_message: "ACP agent process closed".to_string(),
            };
            vec![project_agent_event(agent_event, task_id, backend_id)]
        }
    }
}

pub fn project_agent_event(
    agent_event: AgentEvent,
    task_id: &str,
    backend_id: &AgentBackendId,
) -> ProjectedEvent {
    let sse_event = sse_event_name(&agent_event).to_string();
    let data = serde_json::json!({
        "task_id": task_id,
        "backend_id": backend_id.as_str(),
        "agent_event": agent_event,
    });
    ProjectedEvent {
        sse_event,
        agent_event,
        data,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn oc() -> AgentBackendId {
        AgentBackendId::new("opencode")
    }

    #[test]
    fn maps_text_and_thinking_deltas() {
        let text = map_acp_notification(
            "session/event",
            Some(&json!({"sessionId":"s","event":{"kind":"text","text":"hello"}})),
            &oc(),
        )
        .unwrap();
        assert_eq!(sse_event_name(&text), "message");
        match text {
            AgentEvent::TextDelta { text } => assert_eq!(text, "hello"),
            other => panic!("{other:?}"),
        }

        let think = map_acp_notification(
            "session/event",
            Some(&json!({"event":{"kind":"reasoning","text":"plan"}})),
            &oc(),
        )
        .unwrap();
        assert_eq!(sse_event_name(&think), "thinking");
    }

    #[test]
    fn maps_permission_and_completed() {
        let perm = map_acp_notification(
            "session/event",
            Some(
                &json!({"event":{"kind":"permission_request","requestId":"p1","tool":"fs.write"}}),
            ),
            &oc(),
        )
        .unwrap();
        assert_eq!(sse_event_name(&perm), "approval_requested");

        let done = map_acp_notification("session/completed", Some(&json!({"summary":"ok"})), &oc())
            .unwrap();
        assert_eq!(sse_event_name(&done), "task_completed");
    }

    #[test]
    fn unknown_event_projects_unmapped_without_panic() {
        let projected = project_acp_client_event(
            &AcpClientEvent::Notification {
                method: "session/event".into(),
                params: Some(json!({"event":{"kind":"totally_unknown","x":1}})),
            },
            "task-1",
            &oc(),
        );
        assert_eq!(projected.len(), 1);
        assert_eq!(projected[0].sse_event, "backend_event_unmapped");
        assert_eq!(projected[0].data["task_id"], "task-1");
    }

    #[test]
    fn incoming_permission_maps_to_approval_requested() {
        let projected = project_acp_client_event(
            &AcpClientEvent::IncomingRequest {
                method: "session/permission".into(),
                id: sacode_acp_client::JsonRpcId::Number(9),
                params: Some(json!({"tool":"shell.exec"})),
            },
            "task-2",
            &oc(),
        );
        assert_eq!(projected[0].sse_event, "approval_requested");
        match &projected[0].agent_event {
            AgentEvent::PermissionRequest {
                request_id, tool, ..
            } => {
                assert_eq!(request_id, "9");
                assert_eq!(tool, "shell.exec");
            }
            other => panic!("{other:?}"),
        }
    }

    #[test]
    fn process_closed_maps_to_failed() {
        let projected = project_acp_client_event(&AcpClientEvent::Closed, "t", &oc());
        assert_eq!(projected[0].sse_event, "task_failed");
    }

    #[test]
    fn opencode_agent_message_chunk_maps_to_text_delta() {
        let ev = map_acp_notification(
            "session/update",
            Some(&json!({
                "sessionId": "ses_1",
                "update": {
                    "sessionUpdate": "agent_message_chunk",
                    "messageId": "msg_1",
                    "content": { "type": "text", "text": "P" }
                }
            })),
            &oc(),
        )
        .unwrap();
        match ev {
            AgentEvent::TextDelta { text } => assert_eq!(text, "P"),
            other => panic!("{other:?}"),
        }
        // concatenate chunks like executor does
        let mut out = String::new();
        for chunk in ["P", "ONG"] {
            let e = map_acp_notification(
                "session/update",
                Some(&json!({
                    "update": {
                        "sessionUpdate": "agent_message_chunk",
                        "content": { "type": "text", "text": chunk }
                    }
                })),
                &oc(),
            )
            .unwrap();
            if let AgentEvent::TextDelta { text } = e {
                out.push_str(&text);
            }
        }
        assert_eq!(out, "PONG");
    }

    #[test]
    fn opencode_usage_and_commands_are_noise_not_output() {
        for kind in ["available_commands_update", "usage_update"] {
            let projected = project_acp_client_event(
                &AcpClientEvent::Notification {
                    method: "session/update".into(),
                    params: Some(json!({
                        "sessionId": "s",
                        "update": { "sessionUpdate": kind, "used": 1 }
                    })),
                },
                "t1",
                &oc(),
            );
            assert!(projected.is_empty(), "kind={kind} should be noise");
        }
    }

    #[test]
    fn fixture_transcript_shape() {
        // Representative OpenCode-style notification sequence
        let seq = [
            json!({"jsonrpc":"2.0","method":"session/event","params":{"sessionId":"s1","event":{"kind":"session_started"}}}),
            json!({"jsonrpc":"2.0","method":"session/event","params":{"sessionId":"s1","event":{"kind":"text","text":"working"}}}),
            json!({"jsonrpc":"2.0","method":"session/event","params":{"sessionId":"s1","event":{"kind":"tool_call_started","tool":"fs.read"}}}),
            json!({"jsonrpc":"2.0","method":"session/completed","params":{"sessionId":"s1","summary":"done"}}),
        ];
        let mut names = Vec::new();
        for msg in &seq {
            let method = msg["method"].as_str().unwrap();
            let params = msg.get("params").cloned();
            let ev = map_acp_notification(method, params.as_ref(), &oc()).unwrap();
            names.push(sse_event_name(&ev).to_string());
        }
        assert_eq!(
            names,
            vec![
                "backend_session_started",
                "message",
                "tool_call_started",
                "task_completed"
            ]
        );
    }
}
