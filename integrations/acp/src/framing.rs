//! Newline-delimited JSON framing for ACP stdio.
//!
//! Standard messages are one JSON object per line.
//! Legacy SaCode server may prefix notifications with `event: ` — accepted on
//! decode for compatibility, never emitted on encode.

use serde_json::{json, Value};

use crate::protocol::{JsonRpcMessage, JsonRpcResponse};

/// Maximum accepted single message size (bytes) before the line is rejected.
pub const MAX_MESSAGE_BYTES: usize = 4 * 1024 * 1024;

/// Prefix used by legacy SaCode ACP server for stream notifications.
pub const LEGACY_EVENT_PREFIX: &str = "event: ";

#[derive(Debug, Clone, PartialEq)]
pub enum FramedMessage {
    /// Valid JSON-RPC payload.
    Message(JsonRpcMessage),
    /// Malformed line that was rejected (parse/size). Not fatal to the stream
    /// when the client chooses to skip; reported for metrics/adapters.
    Invalid { reason: String },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum FrameError {
    Empty,
    TooLarge { len: usize, max: usize },
    InvalidJson { detail: String },
    UnrecognizedShape { detail: String },
}

impl std::fmt::Display for FrameError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Empty => write!(f, "empty frame"),
            Self::TooLarge { len, max } => write!(f, "frame too large: {len} > {max}"),
            Self::InvalidJson { detail } => write!(f, "invalid JSON: {detail}"),
            Self::UnrecognizedShape { detail } => write!(f, "unrecognized message: {detail}"),
        }
    }
}

impl std::error::Error for FrameError {}

/// Encode a JSON-RPC message as a single line (no trailing newline in return;
/// callers typically append `\n` when writing to stdio).
pub fn encode_line(value: &Value) -> String {
    // serde_json::to_string is compact single-line.
    serde_json::to_string(value).unwrap_or_else(|_| "{}".to_string())
}

pub fn encode_request(id: i64, method: &str, params: Option<Value>) -> String {
    let mut msg = json!({
        "jsonrpc": "2.0",
        "id": id,
        "method": method,
    });
    if let Some(params) = params {
        msg["params"] = params;
    }
    encode_line(&msg)
}

pub fn encode_notification(method: &str, params: Option<Value>) -> String {
    let mut msg = json!({
        "jsonrpc": "2.0",
        "method": method,
    });
    if let Some(params) = params {
        msg["params"] = params;
    }
    encode_line(&msg)
}

/// Decode one stdout line into a framed message.
///
/// Accepts optional legacy `event: ` prefix (stripped, not required).
/// Rejects lines larger than `MAX_MESSAGE_BYTES`.
pub fn decode_line(line: &str) -> Result<FramedMessage, FrameError> {
    let trimmed = line.trim();
    if trimmed.is_empty() {
        return Err(FrameError::Empty);
    }
    if trimmed.len() > MAX_MESSAGE_BYTES {
        return Err(FrameError::TooLarge {
            len: trimmed.len(),
            max: MAX_MESSAGE_BYTES,
        });
    }

    let payload = trimmed
        .strip_prefix(LEGACY_EVENT_PREFIX)
        .unwrap_or(trimmed)
        .trim();

    // Detect SSE-style "event: name\ndata: {...}" collapsed cases that are not valid JSON.
    if payload.starts_with("data:") || payload.contains("\ndata:") {
        return Err(FrameError::UnrecognizedShape {
            detail:
                "SSE-style frame is not supported in generic ACP client; adapters must normalize"
                    .into(),
        });
    }

    let value: Value = serde_json::from_str(payload).map_err(|e| FrameError::InvalidJson {
        detail: e.to_string(),
    })?;
    JsonRpcMessage::from_value(value)
        .map(FramedMessage::Message)
        .map_err(|e| FrameError::UnrecognizedShape {
            detail: e.to_string(),
        })
}

/// Convenience: build a parse-error response for a malformed inbound line.
pub fn parse_error_response(id: Value, detail: &str) -> JsonRpcResponse {
    JsonRpcResponse::failure(
        crate::protocol::JsonRpcId::String(
            id.as_str()
                .map(|s| s.to_string())
                .unwrap_or_else(|| "null".to_string()),
        ),
        crate::protocol::JsonRpcError::parse_error(detail.to_string()),
    )
}

/// Split a buffer into complete lines, returning remainder.
pub fn take_lines(buffer: &mut String) -> Vec<String> {
    let mut lines = Vec::new();
    loop {
        match buffer.find('\n') {
            Some(idx) => {
                let mut line: String = buffer.drain(..=idx).collect();
                if line.ends_with('\n') {
                    line.pop();
                }
                if line.ends_with('\r') {
                    line.pop();
                }
                lines.push(line);
            }
            None => break,
        }
    }
    lines
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decode_standard_response() {
        let line = r#"{"jsonrpc":"2.0","id":1,"result":{"ok":true}}"#;
        let framed = decode_line(line).unwrap();
        match framed {
            FramedMessage::Message(JsonRpcMessage::Response(r)) => {
                assert_eq!(r.id, crate::protocol::JsonRpcId::Number(1));
            }
            other => panic!("unexpected: {other:?}"),
        }
    }

    #[test]
    fn decode_legacy_event_prefix() {
        let line =
            r#"event: {"jsonrpc":"2.0","method":"session/event","params":{"sessionId":"s1"}}"#;
        let framed = decode_line(line).unwrap();
        match framed {
            FramedMessage::Message(JsonRpcMessage::Notification(n)) => {
                assert_eq!(n.method, "session/event");
            }
            other => panic!("unexpected: {other:?}"),
        }
    }

    #[test]
    fn decode_crlf_lines() {
        let mut buffer = "{\"jsonrpc\":\"2.0\",\"id\":2,\"result\":{}}\r\n{\"jsonrpc\":\"2.0\",\"method\":\"session/event\",\"params\":{}}\r\n".to_string();
        let lines = take_lines(&mut buffer);
        assert_eq!(lines.len(), 2);
        assert!(decode_line(&lines[0]).is_ok());
        assert!(decode_line(&lines[1]).is_ok());
    }

    #[test]
    fn reject_invalid_json_and_oversized() {
        assert!(matches!(
            decode_line("not-json"),
            Err(FrameError::InvalidJson { .. })
        ));
        let huge = format!("{{\"a\":\"{}\"}}", "x".repeat(MAX_MESSAGE_BYTES));
        assert!(matches!(
            decode_line(&huge),
            Err(FrameError::TooLarge { .. })
        ));
        assert!(matches!(decode_line("   "), Err(FrameError::Empty)));
    }

    #[test]
    fn reject_sse_style_frames() {
        assert!(matches!(
            decode_line("event: session/event\ndata: {\"x\":1}"),
            Err(FrameError::UnrecognizedShape { .. })
        ));
    }

    #[test]
    fn encode_request_is_single_line() {
        let line = encode_request(7, "initialize", Some(json!({"a":1})));
        assert!(!line.contains('\n'));
        assert!(line.contains("\"id\":7"));
        let framed = decode_line(&line).unwrap();
        assert!(matches!(
            framed,
            FramedMessage::Message(JsonRpcMessage::Request(_))
        ));
    }
}
