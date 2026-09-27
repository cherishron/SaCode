//! HTTP routes for user-level hooks (read-only) and external config import.

use std::sync::Arc;

use axum::{
    extract::{Path, State},
    http::StatusCode,
    Json,
};
use serde::Deserialize;

use super::DaemonState;

fn json_error(code: StatusCode, message: &str) -> (StatusCode, Json<serde_json::Value>) {
    (code, Json(serde_json::json!({ "error": message })))
}

fn ok_json(value: serde_json::Value) -> (StatusCode, Json<serde_json::Value>) {
    (StatusCode::OK, Json(value))
}

fn git_user_root() -> Option<std::path::PathBuf> {
    std::env::var_os("USERPROFILE")
        .or_else(|| std::env::var_os("HOME"))
        .map(|p| std::path::PathBuf::from(p).join(".sacode"))
}

/// `GET /api/hooks` — read-only view of `~/.sacode/settings.json` hooks.
///
/// This never executes hooks; the payload is exactly what is on disk so the
/// settings view can show commands and warn that the CLI owns execution.
pub async fn list_hooks(State(_state): State<Arc<DaemonState>>) -> Json<serde_json::Value> {
    let hooks = crate::hook::load_user_hooks(git_user_root().as_deref());
    let path = crate::hook::user_settings_path(git_user_root().as_deref());
    Json(serde_json::json!({
        "hooks": hooks,
        "config_path": path.display().to_string(),
        "executed": false,
    }))
}

/// `GET /api/import/tools` — detected external tools with config paths.
pub async fn list_tools(State(_state): State<Arc<DaemonState>>) -> Json<serde_json::Value> {
    let tools = crate::config::detect_external_tools();
    Json(serde_json::json!({ "tools": tools }))
}

/// `GET /api/import/tools/:id/providers` — providers readable from a tool.
pub async fn list_tool_providers(
    State(_state): State<Arc<DaemonState>>,
    Path(id): Path<String>,
) -> (StatusCode, Json<serde_json::Value>) {
    let Some(tool) = crate::config::tool_from_id(&id) else {
        return json_error(StatusCode::NOT_FOUND, "unknown tool");
    };
    let providers = crate::config::read_tool_providers(tool);
    ok_json(serde_json::json!({ "providers": providers }))
}

/// `POST /api/import/apply` — write user-confirmed providers into provider.json.
#[derive(Debug, Clone, Deserialize)]
pub struct ApplyImportRequest {
    pub tool: String,
    #[serde(default)]
    pub providers: Vec<String>,
    // Provider names selected in the UI; entries are re-read from disk so a
    // stale payload cannot inject arbitrary base_url values.
    #[serde(default)]
    pub api_keys: std::collections::BTreeMap<String, String>,
}

pub async fn apply_import(
    State(state): State<Arc<DaemonState>>,
    Json(req): Json<ApplyImportRequest>,
) -> (StatusCode, Json<serde_json::Value>) {
    let Some(workdir) = state.workdir.as_ref() else {
        return json_error(StatusCode::SERVICE_UNAVAILABLE, "workdir unavailable");
    };
    let Some(tool) = crate::config::tool_from_id(&req.tool) else {
        return json_error(StatusCode::BAD_REQUEST, "unknown tool");
    };
    let available = crate::config::read_tool_providers(tool);
    let selected: Vec<_> = if req.providers.is_empty() {
        available.clone()
    } else {
        available
            .into_iter()
            .filter(|p| req.providers.iter().any(|name| name == &p.name))
            .collect()
    };
    if selected.is_empty() {
        return json_error(StatusCode::BAD_REQUEST, "no providers selected");
    }
    let mut selected = selected;
    for provider in &mut selected {
        provider.api_key = req.api_keys.get(&provider.name).cloned();
    }
    match crate::config::apply_imported_providers(workdir, selected) {
        Ok(catalog) => ok_json(serde_json::json!({
            "status": "ok",
            "providers": catalog.providers.keys().collect::<Vec<_>>(),
        })),
        Err(e) => json_error(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()),
    }
}
