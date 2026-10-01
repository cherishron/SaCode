//! ACP client protocol — re-exports shared types from `sacode-acp-protocol`.
//!
//! The JSON-RPC 2.0 envelope (`JsonRpcRequest`, `JsonRpcResponse`, `JsonRpcError`,
//! `JsonRpcNotification`, `JsonRpcMessage`, `JsonRpcId`), method constants
//! (`METHOD_*`), and helper builders (`initialize_params`, `prompt_params`,
//! `permission_response`) now live in the `sacode-acp-protocol` crate.
//!
//! This module re-exports them so existing `use sacode_acp_client::protocol::*`
//! paths continue to work without touching consumer code.
//!
//! Client-specific framing / transport logic remains in `framing.rs`, `process.rs`,
//! and `client.rs`.

pub use sacode_acp_protocol::*;

// The client also used `PROTOCOL_VERSION` — re-export for backward compat.
pub use sacode_acp_protocol::PROTOCOL_VERSION;
