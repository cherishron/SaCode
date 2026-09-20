//! Agent Backend protocol types (M0 freeze).
//!
//! These types are the **internal** daemon/backend adaptation model.
//! Clients (VSCode/Desktop) must consume projected Task Protocol / SSE events,
//! never this surface directly as a long-lived public event protocol.

use serde::{Deserialize, Serialize};
use std::fmt;

use super::task_protocol::FailureCategory;

/// Default backend id used when a request omits `backend_id`.
pub const DEFAULT_AGENT_BACKEND_ID: &str = "sacode";

/// Stable identifier for an Agent Backend (`sacode`, `opencode`, ...).
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(transparent)]
pub struct AgentBackendId(String);

impl AgentBackendId {
    pub fn new(id: impl Into<String>) -> Self {
        let id = id.into().trim().to_string();
        if id.is_empty() {
            return Self::sacode();
        }
        Self(id)
    }

    pub fn sacode() -> Self {
        Self(DEFAULT_AGENT_BACKEND_ID.to_string())
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }

    pub fn is_default(&self) -> bool {
        self.0 == DEFAULT_AGENT_BACKEND_ID
    }
}

impl Default for AgentBackendId {
    fn default() -> Self {
        Self::sacode()
    }
}

impl fmt::Display for AgentBackendId {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0)
    }
}

impl From<&str> for AgentBackendId {
    fn from(value: &str) -> Self {
        Self::new(value)
    }
}

impl From<String> for AgentBackendId {
    fn from(value: String) -> Self {
        Self::new(value)
    }
}

/// Capability flags advertised by a backend during probe/registration.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
pub struct AgentCapabilities {
    #[serde(default)]
    pub streaming: bool,
    #[serde(default)]
    pub tool_calls: bool,
    #[serde(default)]
    pub approvals: bool,
    #[serde(default)]
    pub cancel: bool,
    #[serde(default)]
    pub sessions: bool,
    #[serde(default)]
    pub modes: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub notes: Option<String>,
}

impl AgentCapabilities {
    pub fn sacode_native() -> Self {
        Self {
            streaming: true,
            tool_calls: true,
            approvals: true,
            cancel: true,
            sessions: true,
            modes: vec!["plan".into(), "build".into(), "auto".into()],
            notes: Some("SaCode native runtime via task_runner".into()),
        }
    }
}

/// Health of a registered backend as observed by the daemon.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum AgentBackendHealth {
    Unknown,
    Ready,
    Degraded,
    Unavailable,
}

impl Default for AgentBackendHealth {
    fn default() -> Self {
        Self::Unknown
    }
}

/// Static + runtime descriptor for an Agent Backend.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct AgentDescriptor {
    pub id: AgentBackendId,
    pub display_name: String,
    #[serde(default)]
    pub kind: AgentBackendKind,
    #[serde(default)]
    pub health: AgentBackendHealth,
    #[serde(default)]
    pub capabilities: AgentCapabilities,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub executable: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub version: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub diagnostic: Option<String>,
}

impl AgentDescriptor {
    pub fn sacode() -> Self {
        Self {
            id: AgentBackendId::sacode(),
            display_name: "SaCode".to_string(),
            kind: AgentBackendKind::Native,
            health: AgentBackendHealth::Ready,
            capabilities: AgentCapabilities::sacode_native(),
            executable: None,
            version: Some(env!("CARGO_PKG_VERSION").to_string()),
            diagnostic: None,
        }
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "snake_case")]
pub enum AgentBackendKind {
    #[default]
    Native,
    Acp,
}

/// Lightweight backend metadata attached to a TaskSnapshot (optional).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct BackendTaskMeta {
    pub backend_id: AgentBackendId,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub backend_kind: Option<AgentBackendKind>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub agent_session_id: Option<String>,
}

impl BackendTaskMeta {
    pub fn sacode() -> Self {
        Self {
            backend_id: AgentBackendId::sacode(),
            backend_kind: Some(AgentBackendKind::Native),
            agent_session_id: None,
        }
    }
}

/// Backend-oriented failure codes (mapped into Task Protocol FailureDetail.code).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum BackendFailureCode {
    BackendNotFound,
    BackendUnavailable,
    BackendHandshakeFailed,
    BackendProtocolError,
    BackendTimeout,
    BackendCancelled,
    BackendProcessExited,
    PermissionDenied,
}

impl BackendFailureCode {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::BackendNotFound => "backend/not_found",
            Self::BackendUnavailable => "backend/unavailable",
            Self::BackendHandshakeFailed => "backend/handshake_failed",
            Self::BackendProtocolError => "backend/protocol_error",
            Self::BackendTimeout => "backend/timeout",
            Self::BackendCancelled => "backend/cancelled",
            Self::BackendProcessExited => "backend/process_exited",
            Self::PermissionDenied => "backend/permission_denied",
        }
    }

    /// Serde snake_case variant names differ from protocol `code` strings;
    /// keep `as_str` as the stable protocol mapping.
    pub fn from_protocol_code(code: &str) -> Option<Self> {
        match code {
            "backend/not_found" => Some(Self::BackendNotFound),
            "backend/unavailable" => Some(Self::BackendUnavailable),
            "backend/handshake_failed" => Some(Self::BackendHandshakeFailed),
            "backend/protocol_error" => Some(Self::BackendProtocolError),
            "backend/timeout" => Some(Self::BackendTimeout),
            "backend/cancelled" => Some(Self::BackendCancelled),
            "backend/process_exited" => Some(Self::BackendProcessExited),
            "backend/permission_denied" => Some(Self::PermissionDenied),
            _ => None,
        }
    }

    pub fn failure_category(self) -> FailureCategory {
        match self {
            Self::BackendNotFound
            | Self::BackendUnavailable
            | Self::BackendHandshakeFailed
            | Self::BackendProcessExited => FailureCategory::System,
            Self::BackendProtocolError => FailureCategory::Compatibility,
            Self::BackendTimeout => FailureCategory::Recovery,
            Self::BackendCancelled => FailureCategory::System,
            Self::PermissionDenied => FailureCategory::Permission,
        }
    }

    pub fn retryable(self) -> bool {
        matches!(
            self,
            Self::BackendUnavailable | Self::BackendTimeout | Self::BackendProcessExited
        )
    }
}

impl fmt::Display for BackendFailureCode {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

/// Internal AgentEvent — projected by daemon into Task Protocol / SSE.
/// Not a second long-lived client-facing event protocol (PRD §3.2 / M0).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum AgentEvent {
    Started {
        backend_id: AgentBackendId,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        agent_session_id: Option<String>,
    },
    TextDelta {
        text: String,
    },
    ThinkingDelta {
        text: String,
    },
    ToolCall {
        tool: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        summary: Option<String>,
    },
    PermissionRequest {
        request_id: String,
        tool: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        summary: Option<String>,
    },
    PermissionResolved {
        request_id: String,
        approved: bool,
    },
    Failed {
        #[serde(rename = "code")]
        code_name: String,
        safe_message: String,
    },
    Completed {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        summary: Option<String>,
    },
    Cancelled,
}

/// Normalize an optional backend_id from a request: missing/empty → `sacode`.
pub fn normalize_backend_id(value: Option<AgentBackendId>) -> AgentBackendId {
    match value {
        Some(id) if !id.as_str().trim().is_empty() => AgentBackendId::new(id.as_str()),
        _ => AgentBackendId::sacode(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_backend_is_sacode() {
        assert_eq!(AgentBackendId::default().as_str(), "sacode");
        assert!(AgentBackendId::default().is_default());
        assert_eq!(normalize_backend_id(None).as_str(), "sacode");
        assert_eq!(
            normalize_backend_id(Some(AgentBackendId::new("  "))).as_str(),
            "sacode"
        );
        assert_eq!(
            normalize_backend_id(Some(AgentBackendId::new("opencode"))).as_str(),
            "opencode"
        );
    }

    #[test]
    fn agent_event_serde_roundtrip() {
        let event = AgentEvent::Started {
            backend_id: AgentBackendId::sacode(),
            agent_session_id: Some("sess-1".into()),
        };
        let raw = serde_json::to_string(&event).unwrap();
        assert!(raw.contains("\"type\":\"started\""));
        let parsed: AgentEvent = serde_json::from_str(&raw).unwrap();
        assert_eq!(parsed, event);
    }

    #[test]
    fn failure_codes_map_to_protocol_categories() {
        assert_eq!(
            BackendFailureCode::BackendNotFound.as_str(),
            "backend/not_found"
        );
        assert_eq!(
            BackendFailureCode::BackendProtocolError.failure_category(),
            FailureCategory::Compatibility
        );
        assert!(BackendFailureCode::BackendTimeout.retryable());
        assert!(!BackendFailureCode::BackendNotFound.retryable());
        assert_eq!(
            BackendFailureCode::from_protocol_code("backend/timeout"),
            Some(BackendFailureCode::BackendTimeout)
        );
    }

    #[test]
    fn descriptor_sacode_is_native_ready() {
        let d = AgentDescriptor::sacode();
        assert_eq!(d.id.as_str(), "sacode");
        assert_eq!(d.kind, AgentBackendKind::Native);
        assert_eq!(d.health, AgentBackendHealth::Ready);
        assert!(d.capabilities.approvals);
    }
}
