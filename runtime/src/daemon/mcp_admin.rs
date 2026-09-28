//! P1-1：MCP 服务器管理 HTTP 面
//!
//! - GET /api/mcp/servers — 合并列表（user/project）
//! - PUT /api/mcp/servers/:name — upsert
//! - DELETE /api/mcp/servers/:name
//! - POST /api/mcp/servers/:name/test — 探活并列出 tools

use std::collections::BTreeMap;
use std::sync::Arc;

use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::Json;

use crate::mcp::{inspect_server, list_tools, McpConfigStore, McpServerConfig, McpSource};
use crate::SaCodeConfig;

use super::DaemonState;

fn store_for(state: &Arc<DaemonState>) -> McpConfigStore {
    let workdir = state
        .workdir
        .clone()
        .unwrap_or_else(|| std::env::current_dir().unwrap_or_else(|_| std::path::PathBuf::from(".")));
    McpConfigStore::new_from_config(SaCodeConfig::new(&workdir))
}

#[derive(Debug, serde::Deserialize)]
pub struct UpsertMcpRequest {
    /// remote | stdio
    #[serde(rename = "type")]
    pub server_type: String,
    #[serde(default)]
    pub url: String,
    #[serde(default)]
    pub command: Option<String>,
    #[serde(default)]
    pub args: Option<Vec<String>>,
    #[serde(default)]
    pub env: Option<BTreeMap<String, String>>,
    #[serde(default = "default_true")]
    pub enabled: bool,
    /// user | project，默认 project（随工作区）
    #[serde(default = "default_source")]
    pub source: String,
}

fn default_true() -> bool {
    true
}

fn default_source() -> String {
    "project".to_string()
}

fn parse_source(s: &str) -> McpSource {
    if s == "user" {
        McpSource::User
    } else {
        McpSource::Project
    }
}

pub async fn list_servers(State(state): State<Arc<DaemonState>>) -> Json<serde_json::Value> {
    let store = store_for(&state);
    match store.list_entries() {
        Ok(entries) => Json(serde_json::json!({
            "servers": entries.iter().map(|e| serde_json::json!({
                "name": e.name,
                "type": e.server.server_type,
                "url": e.server.url,
                "command": e.server.command,
                "args": e.server.args,
                "env": e.server.env,
                "enabled": e.server.enabled,
                "source": e.source.label(),
            })).collect::<Vec<_>>(),
        })),
        Err(err) => Json(serde_json::json!({
            "servers": [],
            "error": err.to_string(),
        })),
    }
}

pub async fn upsert_server(
    State(state): State<Arc<DaemonState>>,
    Path(name): Path<String>,
    Json(req): Json<UpsertMcpRequest>,
) -> (StatusCode, Json<serde_json::Value>) {
    if name.trim().is_empty() {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({ "status": "error", "message": "name is required" })),
        );
    }
    if req.server_type != "remote" && req.server_type != "stdio" {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({ "status": "error", "message": "type must be remote or stdio" })),
        );
    }
    if req.server_type == "remote" && req.url.trim().is_empty() {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({ "status": "error", "message": "url is required for remote" })),
        );
    }
    if req.server_type == "stdio" && req.command.as_deref().unwrap_or("").trim().is_empty() {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({ "status": "error", "message": "command is required for stdio" })),
        );
    }

    let store = store_for(&state);
    let source = parse_source(&req.source);
    let mut config = match store.load_from_source(source) {
        Ok(c) => c,
        Err(err) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({ "status": "error", "message": err.to_string() })),
            );
        }
    };
    config.mcp.insert(
        name.clone(),
        McpServerConfig {
            server_type: req.server_type,
            url: req.url,
            command: req.command,
            args: req.args,
            env: req.env,
            enabled: req.enabled,
        },
    );
    match store.save_to_source(&config, source) {
        Ok(()) => (
            StatusCode::OK,
            Json(serde_json::json!({ "status": "ok", "name": name })),
        ),
        Err(err) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({ "status": "error", "message": err.to_string() })),
        ),
    }
}

pub async fn delete_server(
    State(state): State<Arc<DaemonState>>,
    Path(name): Path<String>,
) -> (StatusCode, Json<serde_json::Value>) {
    let store = store_for(&state);
    // 先从 project 再 user 删除
    let mut removed = false;
    for source in [McpSource::Project, McpSource::User] {
        if store.remove(&name, source).is_ok() {
            removed = true;
            break;
        }
    }
    if removed {
        (
            StatusCode::OK,
            Json(serde_json::json!({ "status": "ok", "name": name })),
        )
    } else {
        (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({ "status": "error", "message": "mcp server not found" })),
        )
    }
}

#[derive(Debug, serde::Deserialize)]
pub struct ToggleMcpRequest {
    pub enabled: bool,
    #[serde(default = "default_source")]
    pub source: String,
}

pub async fn toggle_server(
    State(state): State<Arc<DaemonState>>,
    Path(name): Path<String>,
    Json(req): Json<ToggleMcpRequest>,
) -> (StatusCode, Json<serde_json::Value>) {
    let store = store_for(&state);
    match store.set_enabled(&name, req.enabled, parse_source(&req.source)) {
        Ok(()) => (
            StatusCode::OK,
            Json(serde_json::json!({ "status": "ok", "name": name, "enabled": req.enabled })),
        ),
        Err(err) => (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({ "status": "error", "message": err.to_string() })),
        ),
    }
}

pub async fn test_server(
    State(state): State<Arc<DaemonState>>,
    Path(name): Path<String>,
) -> (StatusCode, Json<serde_json::Value>) {
    let store = store_for(&state);
    let server = match store.get(&name) {
        Ok(s) => s,
        Err(err) => {
            return (
                StatusCode::NOT_FOUND,
                Json(serde_json::json!({ "status": "error", "message": err.to_string() })),
            );
        }
    };
    let details = inspect_server(&server).await.ok();
    let tools = list_tools(&server).await.unwrap_or_default();
    (
        StatusCode::OK,
        Json(serde_json::json!({
            "status": "ok",
            "name": name,
            "details": details,
            "tools": tools.iter().map(|t| serde_json::json!({
                "name": t.name,
                "title": t.title,
                "description": t.description,
            })).collect::<Vec<_>>(),
        })),
    )
}
