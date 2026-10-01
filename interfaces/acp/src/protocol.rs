//! ACP (Agent Client Protocol) v1 — payload message types.
//!
//! JSON-RPC 2.0 envelope types (`JsonRpcRequest`, `JsonRpcResponse`,
//! `JsonRpcError`, `JsonRpcNotification`) and method constants now live in
//! `sacode-acp-protocol` (the shared crate). This module re-exports them and
//! defines the ACP v1 **payload** types specific to the server side:
//! `InitializeResult`, `Session`, `SessionUpdate`, `Tool`, etc.
//!
//! Transport: newline-delimited JSON-RPC 2.0 over stdio (or a TCP line stream).
//! Field naming follows the ACP v1 schema: camelCase for normal fields and the
//! literal `_meta` extension bag.
//!
//! Reference: https://agentclientprotocol.com (protocol v1)

use serde::{Deserialize, Serialize};
use serde_json::Value;

// Re-export the shared JSON-RPC envelope so `use crate::protocol::*` works.
pub use sacode_acp_protocol::{
    JsonRpcError, JsonRpcId, JsonRpcMessage, JsonRpcNotification, JsonRpcRequest, JsonRpcResponse,
    METHOD_INITIALIZE, METHOD_SESSION_CANCEL, METHOD_SESSION_EVENT, METHOD_SESSION_NEW,
    METHOD_SESSION_PERMISSION, METHOD_SESSION_PERMISSION_RESOLVED, METHOD_SESSION_PROMPT,
    PROTOCOL_VERSION,
};

// ============================================================================
// initialize
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InitializeResult {
    pub protocol_version: u64,
    pub agent_capabilities: AgentCapabilities,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub agent_info: Option<AgentInfo>,
    #[serde(default)]
    pub auth_methods: Vec<Value>,
    #[serde(default, rename = "_meta", skip_serializing_if = "Option::is_none")]
    pub _meta: Option<Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct AgentCapabilities {
    #[serde(default)]
    pub load_session: bool,
    #[serde(default)]
    pub prompt_capabilities: PromptCapabilities,
    #[serde(default)]
    pub mcp_capabilities: McpCapabilities,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub session_capabilities: Option<Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub auth: Option<Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct PromptCapabilities {
    #[serde(default)]
    pub image: bool,
    #[serde(default)]
    pub audio: bool,
    #[serde(default)]
    pub embedded_context: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct McpCapabilities {
    #[serde(default)]
    pub http: bool,
    #[serde(default)]
    pub sse: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct AgentInfo {
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub version: String,
}

// ============================================================================
// sessions
// ============================================================================

/// ACP `Session` object returned from session lifecycle methods.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Session {
    pub session_id: String,
    pub cwd: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub status: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tools: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub checkpoint: Option<String>,
}

/// `session/new` result.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NewSessionResponse {
    pub session_id: String,
    pub session: Session,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub checkpoint: Option<String>,
}

/// `session/load` result.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LoadSessionResponse {
    pub session: Session,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub checkpoint: Option<String>,
}

/// `session/list` result.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ListSessionsResponse {
    pub sessions: Vec<Session>,
}

/// `session/prompt` result — the first session update is returned inline and the
/// remainder is streamed via `session/update` notifications.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PromptResponse {
    pub session_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub prompt_response: Option<SessionUpdate>,
    #[serde(skip_serializing_if = "Option::is_none", rename = "_meta")]
    pub _meta: Option<Value>,
}

/// `getConfigOptions` / `setSessionConfigOption` result.
#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ConfigOptionsResponse {
    #[serde(default)]
    pub config_options: Vec<ConfigOption>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfigOption {
    pub id: String,
    pub name: String,
    #[serde(rename = "type")]
    pub option_type: String,
    pub description: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub category: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub current_value: Option<Value>,
}

// ============================================================================
// session/update union (streamed)
// ============================================================================

/// Streamed session update. Discriminator `type` is snake_case (ACP v1); fields
/// are camelCase.
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type")]
pub enum SessionUpdate {
    #[serde(rename = "session_info")]
    SessionInfo(SessionInfoUpdate),
    #[serde(rename = "session_info_update")]
    SessionInfoUpdate(SessionInfoUpdate),
    #[serde(rename = "agent_message_chunk")]
    AgentMessageChunk(AgentMessageChunk),
    #[serde(rename = "user_message_chunk")]
    UserMessageChunk(AgentMessageChunk),
    #[serde(rename = "tool_call")]
    ToolCall(ToolCall),
    #[serde(rename = "tool_call_update")]
    ToolCallUpdate(ToolCallUpdate),
    #[serde(rename = "session_end")]
    SessionEnd(SessionEnd),
}

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct SessionInfoUpdate {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub session_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cwd: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub status: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentMessageChunk {
    pub content: ContentBlock,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolCall {
    pub tool_call_id: String,
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub status: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub content: Option<Vec<ContentBlock>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub raw_input: Option<Value>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolCallUpdate {
    pub tool_call_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub status: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub content: Option<Vec<ContentBlock>>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionEnd {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub end_reason: Option<String>,
}

/// Content block for messages / tool output.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(tag = "type", rename_all = "lowercase")]
pub enum ContentBlock {
    Text { text: String },
    Image {
        data: String,
        #[serde(rename = "mimeType")]
        mime_type: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        uri: Option<String>,
    },
}

impl ContentBlock {
    pub fn text(content: impl Into<String>) -> Self {
        Self::Text {
            text: content.into(),
        }
    }
}

// ============================================================================
// tools
// ============================================================================

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Tool {
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub input_schema: Option<Value>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolsListResponse {
    pub tools: Vec<Tool>,
}

// ============================================================================
// Notification builder (server-specific — references SessionUpdate)
// ============================================================================

/// Build a `session/update` notification carrying one `SessionUpdate`.
/// (Free function, not an impl method — avoids a dependency from the shared
/// `sacode-acp-protocol` crate back to server-side types.)
pub fn session_update_notification(session_id: &str, update: &SessionUpdate) -> JsonRpcNotification {
    JsonRpcNotification {
        jsonrpc: "2.0".to_string(),
        method: "session/update".to_string(),
        params: Some(serde_json::json!({
            "sessionId": session_id,
            "sessionUpdate": update,
        })),
    }
}
