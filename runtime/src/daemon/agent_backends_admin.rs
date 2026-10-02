//! O3: Agent backend management endpoints (contract §13.2).
//!
//! GET  /api/agent-backends          → list + default_backend_id
//! PUT  /api/agent-backends/:id      → update enabled / executable / args
//! POST /api/agent-backends/:id/probe → trigger probe, return updated descriptor

use std::sync::Arc;

use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::IntoResponse,
    Json,
};
use serde::Deserialize;

use crate::daemon::types::DaemonState;

fn error(status: StatusCode, message: &str) -> (StatusCode, Json<serde_json::Value>) {
    (
        status,
        Json(serde_json::json!({ "status": "error", "message": message })),
    )
}

/// GET /api/agent-backends
pub async fn list_backends(
    State(state): State<Arc<DaemonState>>,
) -> Json<serde_json::Value> {
    let backends = state.agent_backends.list();
    Json(serde_json::json!({
        "backends": backends,
        "default_backend_id": "sacode",
    }))
}

#[derive(Debug, Deserialize)]
pub struct UpdateBackendRequest {
    #[serde(default)]
    pub enabled: Option<bool>,
    #[serde(default)]
    pub executable: Option<String>,
    #[serde(default)]
    pub args: Option<Vec<String>>,
}

/// PUT /api/agent-backends/:id
pub async fn update_backend(
    State(state): State<Arc<DaemonState>>,
    Path(id): Path<String>,
    Json(req): Json<UpdateBackendRequest>,
) -> impl IntoResponse {
    let backend_id = sacode_kernel::AgentBackendId::new(id);
    if backend_id.is_default() {
        return error(
            StatusCode::BAD_REQUEST,
            "native sacode backend cannot be modified",
        );
    }

    // Load current descriptor or error.
    let Some(mut desc) = state.agent_backends.get(&backend_id) else {
        return error(StatusCode::NOT_FOUND, "agent backend not found");
    };

    // O3: enabled switch
    if let Some(enabled) = req.enabled {
        desc.enabled = enabled;
    }

    // O3: executable / args — store separately, never shell-concatenate.
    let mut cfg_updated = false;
    if let Some(exe) = req.executable.as_deref().filter(|s| !s.trim().is_empty()) {
        desc.executable = Some(exe.to_string());
        cfg_updated = true;
    }
    if let Some(args) = &req.args {
        desc.args = Some(args.clone());
        cfg_updated = true;
    }

    state.agent_backends.register(desc.clone());

    // Sync executor ACP config so changes take effect immediately (§13.2).
    if cfg_updated || req.enabled.is_some() {
        let exe = desc
            .executable
            .clone()
            .unwrap_or_else(|| "opencode".to_string());
        let args = desc.args.clone().unwrap_or_default();
        let mut cfg = crate::agent_backends::AcpBackendConfig::new(
            backend_id.as_str(),
            desc.display_name.clone(),
            exe,
            args,
        );
        cfg.enabled = desc.enabled;
        cfg.install_hint = desc.install_hint.clone();
        let executor = state.executor.lock().await;
        if desc.enabled {
            executor.set_acp_backend(cfg).await;
        } else {
            executor.remove_acp_backend(backend_id.as_str()).await;
        }
    }

    (
        StatusCode::OK,
        Json(serde_json::json!({
            "status": "ok",
            "backend": desc,
        })),
    )
}

/// POST /api/agent-backends/:id/probe
pub async fn probe_backend(
    State(state): State<Arc<DaemonState>>,
    Path(id): Path<String>,
) -> impl IntoResponse {
    let backend_id = sacode_kernel::AgentBackendId::new(id);
    if backend_id.is_default() {
        // Native sacode is always ready.
        let desc = sacode_kernel::AgentDescriptor::sacode();
        return (
            StatusCode::OK,
            Json(serde_json::json!({ "status": "ok", "backend": desc })),
        );
    }

    let Some(mut desc) = state.agent_backends.get(&backend_id) else {
        return error(StatusCode::NOT_FOUND, "agent backend not found");
    };

    // Build config from descriptor for probe.
    let exe = desc
        .executable
        .clone()
        .unwrap_or_else(|| backend_id.as_str().to_string());
    let args = desc.args.clone().unwrap_or_default();
    let cfg = crate::agent_backends::AcpBackendConfig::new(
        backend_id.as_str(),
        desc.display_name.clone(),
        exe,
        args,
    )
    .with_install_hint(desc.install_hint.clone().unwrap_or_default());

    let backend = crate::agent_backends::AcpProcessBackend::new(cfg);
    match backend.probe().await {
        Ok(probed) => {
            // Preserve enabled + install_hint from existing descriptor.
            let mut merged = probed;
            merged.enabled = desc.enabled;
            if merged.install_hint.is_none() {
                merged.install_hint = desc.install_hint.clone();
            }
            state.agent_backends.register(merged.clone());
            desc = merged;
            (
                StatusCode::OK,
                Json(serde_json::json!({ "status": "ok", "backend": desc })),
            )
        }
        Err(code) => {
            desc.health = sacode_kernel::AgentBackendHealth::Unavailable;
            desc.diagnostic = Some(format!("probe failed: {}", code.as_str()));
            state.agent_backends.register(desc.clone());
            (
                StatusCode::OK,
                Json(serde_json::json!({ "status": "error", "backend": desc })),
            )
        }
    }
}
