use serde::{Deserialize, Serialize};
use serde_json::Value;

pub const METHOD_INITIALIZE: &str = "initialize";
pub const METHOD_SESSION_NEW: &str = "session/new";
pub const METHOD_SESSION_PROMPT: &str = "session/prompt";
pub const METHOD_SESSION_CANCEL: &str = "session/cancel";
pub const METHOD_SESSION_EVENT: &str = "session/event";
pub const METHOD_SESSION_PERMISSION: &str = "session/permission";
pub const METHOD_SESSION_PERMISSION_RESOLVED: &str = "session/permission/resolved";

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

    pub fn timeout(message: impl Into<String>) -> Self {
        Self {
            code: -32000,
            message: message.into(),
            data: None,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct JsonRpcRequest {
    pub jsonrpc: String,
    pub id: JsonRpcId,
    pub method: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub params: Option<Value>,
}

impl JsonRpcRequest {
    pub fn new(id: JsonRpcId, method: impl Into<String>, params: Option<Value>) -> Self {
        Self {
            jsonrpc: "2.0".to_string(),
            id,
            method: method.into(),
            params,
        }
    }
}

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
    pub fn success(id: JsonRpcId, result: Value) -> Self {
        Self {
            jsonrpc: "2.0".to_string(),
            id,
            result: Some(result),
            error: None,
        }
    }

    pub fn failure(id: JsonRpcId, error: JsonRpcError) -> Self {
        Self {
            jsonrpc: "2.0".to_string(),
            id,
            result: None,
            error: Some(error),
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
    pub fn from_value(value: Value) -> anyhow::Result<Self> {
        // Discriminate by shape: has id+result|error → response; id+method → request; method only → notification
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

/// Build initialize params for an Agent Backend handshake.
pub fn initialize_params(client_name: &str, client_version: &str) -> Value {
    serde_json::json!({
        "protocolVersion": 1,
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn discriminate_response_request_notification() {
        let response = serde_json::json!({"jsonrpc":"2.0","id":1,"result":{"ok":true}});
        let msg = JsonRpcMessage::from_value(response).unwrap();
        assert!(matches!(msg, JsonRpcMessage::Response(_)));

        let request = serde_json::json!({"jsonrpc":"2.0","id":"abc","method":"session/permission","params":{}});
        let msg = JsonRpcMessage::from_value(request).unwrap();
        assert!(matches!(msg, JsonRpcMessage::Request(_)));

        let notification =
            serde_json::json!({"jsonrpc":"2.0","method":"session/event","params":{"x":1}});
        let msg = JsonRpcMessage::from_value(notification).unwrap();
        assert!(matches!(msg, JsonRpcMessage::Notification(_)));
    }

    #[test]
    fn response_error_roundtrip() {
        let resp =
            JsonRpcResponse::failure(JsonRpcId::Number(2), JsonRpcError::method_not_found("nope"));
        let raw = serde_json::to_string(&resp).unwrap();
        let parsed: JsonRpcResponse = serde_json::from_str(&raw).unwrap();
        assert_eq!(parsed.id, JsonRpcId::Number(2));
        assert_eq!(parsed.error.unwrap().code, -32601);
    }
}
