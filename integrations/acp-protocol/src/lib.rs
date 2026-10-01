//! Shared JSON-RPC 2.0 envelope and ACP method constants.
//!
//! This crate is the **single source of truth** for the JSON-RPC wire types
//! used by both:
//! - `sacode-acp` (ACP v1 server — `interfaces/acp`)
//! - `sacode-acp-client` (ACP client / agent backend — `integrations/acp`)
//!
//! It deliberately has **no** transport, no tokio, no daemon dependency — just
//! the serializable envelope so both sides agree on the wire shape.
//!
//! ACP-specific message *payload* types (e.g. `SessionUpdate`, `Session`,
//! `Tool`, `InitializeResult`) remain in their respective crates because the
//! server and client have different (sometimes divergent) payload schemas.

use serde::{Deserialize, Serialize};
use serde_json::Value;

// ============================================================================
// ACP method constants
// ============================================================================

pub const PROTOCOL_VERSION: u64 = 1;

pub const METHOD_INITIALIZE: &str = "initialize";
pub const METHOD_SESSION_NEW: &str = "session/new";
pub const METHOD_SESSION_PROMPT: &str = "session/prompt";
pub const METHOD_SESSION_CANCEL: &str = "session/cancel";
pub const METHOD_SESSION_EVENT: &str = "session/event";
pub const METHOD_SESSION_PERMISSION: &str = "session/permission";
pub const METHOD_SESSION_PERMISSION_RESOLVED: &str = "session/permission/resolved";

// ============================================================================
// JSON-RPC 2.0 envelope
// ============================================================================

/// JSON-RPC request id (number or string).
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(untagged)]
pub enum JsonRpcId {
    Number(i64),
    String(String),
}

impl JsonRpcId {
    pub fn as_key(&self) -> String {
        match self {
            Self::Number(n) => format!("n:{n}"),
            Self::String(s) => format!("s:{s}"),
        }
    }
}

impl std::fmt::Display for JsonRpcId {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Number(n) => write!(f, "{n}"),
            Self::String(s) => f.write_str(s),
        }
    }
}

impl From<i64> for JsonRpcId {
    fn from(n: i64) -> Self {
        Self::Number(n)
    }
}

impl From<&str> for JsonRpcId {
    fn from(s: &str) -> Self {
        Self::String(s.to_string())
    }
}

/// JSON-RPC 2.0 request.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct JsonRpcRequest {
    pub jsonrpc: String,
    pub id: JsonRpcId,
    pub method: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub params: Option<Value>,
}

impl JsonRpcRequest {
    pub fn new(id: impl Into<JsonRpcId>, method: impl Into<String>, params: Option<Value>) -> Self {
        Self {
            jsonrpc: "2.0".to_string(),
            id: id.into(),
            method: method.into(),
            params,
        }
    }

    /// Extract the `_meta` object from the request params (used for
    /// `conversationRequestId` and other per-call extensions).
    pub fn meta(&self) -> Option<&Value> {
        self.params.as_ref().and_then(|p| p.get("_meta"))
    }

    /// Required string param from the params object.
    pub fn required_string(&self, key: &str) -> anyhow::Result<String> {
        self.params
            .as_ref()
            .and_then(|p| p.get(key))
            .and_then(|v| v.as_str())
            .map(str::to_string)
            .ok_or_else(|| anyhow::anyhow!("missing string param: {}", key))
    }

    /// Optional string param from the params object.
    pub fn string(&self, key: &str) -> Option<String> {
        self.params
            .as_ref()
            .and_then(|p| p.get(key))
            .and_then(|v| v.as_str())
            .map(str::to_string)
    }
}

/// JSON-RPC 2.0 error object.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct JsonRpcError {
    pub code: i64,
    pub message: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub data: Option<Value>,
}

impl JsonRpcError {
    pub fn parse_error(message: impl Into<String>) -> Self {
        Self {
            code: -32700,
            message: message.into(),
            data: None,
        }
    }

    pub fn method_not_found(method: &str) -> Self {
        Self {
            code: -32601,
            message: format!("method not found: {method}"),
            data: None,
        }
    }

    pub fn invalid_params(msg: impl Into<String>) -> Self {
        Self {
            code: -32602,
            message: msg.into(),
            data: None,
        }
    }

    pub fn internal(msg: impl Into<String>) -> Self {
        Self {
            code: -32603,
            message: msg.into(),
            data: None,
        }
    }

    pub fn timeout(message: impl Into<String>) -> Self {
        Self {
            code: -32000,
            message: message.into(),
            data: None,
        }
    }
}

/// JSON-RPC 2.0 response.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct JsonRpcResponse {
    pub jsonrpc: String,
    pub id: JsonRpcId,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub result: Option<Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<JsonRpcError>,
}

impl JsonRpcResponse {
    pub fn success(id: impl Into<JsonRpcId>, result: Value) -> Self {
        Self {
            jsonrpc: "2.0".to_string(),
            id: id.into(),
            result: Some(result),
            error: None,
        }
    }

    pub fn failure(id: impl Into<JsonRpcId>, error: JsonRpcError) -> Self {
        Self {
            jsonrpc: "2.0".to_string(),
            id: id.into(),
            result: None,
            error: Some(error),
        }
    }
}

/// JSON-RPC 2.0 notification (no id).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct JsonRpcNotification {
    pub jsonrpc: String,
    pub method: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub params: Option<Value>,
}

impl JsonRpcNotification {
    pub fn new(method: impl Into<String>, params: Option<Value>) -> Self {
        Self {
            jsonrpc: "2.0".to_string(),
            method: method.into(),
            params,
        }
    }
}

/// A decoded inbound wire message: response, client→agent request, or notification.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum JsonRpcMessage {
    Response(JsonRpcResponse),
    Request(JsonRpcRequest),
    Notification(JsonRpcNotification),
}

impl JsonRpcMessage {
    /// Discriminate by shape: has id+result|error → response; id+method → request;
    /// method only → notification.
    pub fn from_value(value: Value) -> anyhow::Result<Self> {
        let obj = value
            .as_object()
            .ok_or_else(|| anyhow::anyhow!("JSON-RPC message must be an object"))?;
        let has_id = obj.contains_key("id");
        let has_method = obj.contains_key("method");
        let has_result = obj.contains_key("result");
        let has_error = obj.contains_key("error");

        if has_id && (has_result || has_error) && !has_method {
            return Ok(Self::Response(serde_json::from_value(value)?));
        }
        if has_id && has_method {
            return Ok(Self::Request(serde_json::from_value(value)?));
        }
        if has_method && !has_id {
            return Ok(Self::Notification(serde_json::from_value(value)?));
        }
        // Legacy: response with explicit null result
        if has_id && !has_method {
            return Ok(Self::Response(serde_json::from_value(value)?));
        }
        Err(anyhow::anyhow!("unrecognized JSON-RPC message shape"))
    }
}

// ============================================================================
// Helper builders for ACP client handshake
// ============================================================================

/// Build initialize params for an Agent Backend handshake.
pub fn initialize_params(client_name: &str, client_version: &str) -> Value {
    serde_json::json!({
        "protocolVersion": PROTOCOL_VERSION,
        "clientInfo": {
            "name": client_name,
            "version": client_version,
        },
        "capabilities": {
            "fs": true,
            "terminal": false,
        }
    })
}

/// Build session/prompt params.
/// OpenCode 1.18+ expects `prompt` as an array of content parts, not a bare string.
pub fn prompt_params(session_id: &str, prompt: &str, mode: Option<&str>) -> Value {
    let mut params = serde_json::json!({
        "sessionId": session_id,
        "prompt": [{ "type": "text", "text": prompt }],
        "mcpServers": [],
    });
    if let Some(mode) = mode {
        params["mode"] = Value::String(mode.to_string());
    }
    params
}

/// Permission response for agent reverse request.
pub fn permission_response(request_id: &str, approved: bool, reason: Option<&str>) -> Value {
    serde_json::json!({
        "requestId": request_id,
        "approved": approved,
        "reason": reason,
    })
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn discriminate_response_request_notification() {
        let response = serde_json::json!({"jsonrpc":"2.0","id":1,"result":{"ok":true}});
        let msg = JsonRpcMessage::from_value(response).unwrap();
        assert!(matches!(msg, JsonRpcMessage::Response(_)));

        let request =
            serde_json::json!({"jsonrpc":"2.0","id":"abc","method":"session/permission","params":{}});
        let msg = JsonRpcMessage::from_value(request).unwrap();
        assert!(matches!(msg, JsonRpcMessage::Request(_)));

        let notification =
            serde_json::json!({"jsonrpc":"2.0","method":"session/event","params":{"x":1}});
        let msg = JsonRpcMessage::from_value(notification).unwrap();
        assert!(matches!(msg, JsonRpcMessage::Notification(_)));
    }

    #[test]
    fn response_error_roundtrip() {
        let resp = JsonRpcResponse::failure(JsonRpcId::Number(2), JsonRpcError::method_not_found("nope"));
        let raw = serde_json::to_string(&resp).unwrap();
        let parsed: JsonRpcResponse = serde_json::from_str(&raw).unwrap();
        assert_eq!(parsed.id, JsonRpcId::Number(2));
        assert_eq!(parsed.error.unwrap().code, -32601);
    }

    #[test]
    fn request_helper_methods() {
        let req = JsonRpcRequest::new(
            JsonRpcId::Number(1),
            "session/prompt",
            Some(serde_json::json!({"sessionId":"s1","prompt":"hi","_meta":{"conversationRequestId":"c1"}})),
        );
        assert_eq!(req.required_string("sessionId").unwrap(), "s1");
        assert_eq!(req.string("prompt"), Some("hi".to_string()));
        assert_eq!(
            req.meta().and_then(|m| m.get("conversationRequestId"))
                .and_then(|v| v.as_str()),
            Some("c1")
        );
    }

    #[test]
    fn error_constructors() {
        assert_eq!(JsonRpcError::parse_error("x").code, -32700);
        assert_eq!(JsonRpcError::method_not_found("y").code, -32601);
        assert_eq!(JsonRpcError::invalid_params("z").code, -32602);
        assert_eq!(JsonRpcError::internal("w").code, -32603);
        assert_eq!(JsonRpcError::timeout("t").code, -32000);
    }

    #[test]
    fn initialize_params_shape() {
        let p = initialize_params("SaCode", "1.1.1");
        assert_eq!(p["protocolVersion"], PROTOCOL_VERSION);
        assert_eq!(p["clientInfo"]["name"], "SaCode");
    }

    #[test]
    fn prompt_params_includes_mode() {
        let p = prompt_params("s1", "hi", Some("plan"));
        assert_eq!(p["sessionId"], "s1");
        assert_eq!(p["mode"], "plan");
        assert!(p["prompt"].is_array());
    }
}
