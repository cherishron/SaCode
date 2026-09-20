//! Pluggable Agent Backends for daemon task dispatch (M0/M2/M4).
//!
//! Design: keep the existing TaskQueue + executor as the single lifecycle owner.
//! After dequeue, `BackendRegistry` routes by `backend_id` (default `sacode`).
//! Native backend is a thin adapter over the existing task_runner path.
//! ACP backends (OpenCode) use `sacode-acp-client` over stdio.

pub mod acp;
pub mod native;
pub mod opencode_map;
pub mod registry;

pub use acp::{AcpBackendConfig, AcpExecutionOutcome, AcpProcessBackend, SharedAcpBackend};
pub use native::NativeBackend;
pub use opencode_map::{project_acp_client_event, sse_event_name};
pub use registry::{BackendDispatchError, BackendRegistry};

use sacode_kernel::AgentBackendId;

/// Dispatch context handed to a backend when executing a queued task.
#[derive(Debug, Clone)]
pub struct BackendTaskContext {
    pub task_id: String,
    pub prompt: String,
    pub mode: sacode_kernel::ExecutionMode,
    pub backend_id: AgentBackendId,
    pub session_id: Option<String>,
    pub workspace_root: String,
}
