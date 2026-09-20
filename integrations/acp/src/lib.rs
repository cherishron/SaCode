//! Generic ACP protocol types (JSON-RPC 2.0 shaped) for calling external Agents.
//!
//! This crate has **no** UI and **no** daemon dependency. SaCode ACP Server
//! (`interfaces/acp`) remains the inbound path; this crate is the outbound
//! client used by daemon Agent Backends (e.g. OpenCode).

pub mod client;
pub mod framing;
pub mod process;
pub mod protocol;

pub use client::{AcpClient, AcpClientEvent, ClientConfig, IncomingRequestHandler};
pub use framing::{decode_line, encode_line, FrameError, FramedMessage, MAX_MESSAGE_BYTES};
pub use process::{AcpProcess, ProcessConfig, SpawnError};
pub use protocol::{
    initialize_params, permission_response, prompt_params, JsonRpcError, JsonRpcId, JsonRpcMessage,
    JsonRpcNotification, JsonRpcRequest, JsonRpcResponse, METHOD_INITIALIZE, METHOD_SESSION_CANCEL,
    METHOD_SESSION_EVENT, METHOD_SESSION_NEW, METHOD_SESSION_PERMISSION, METHOD_SESSION_PROMPT,
};
