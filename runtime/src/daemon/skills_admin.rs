//! P1-2：技能管理 HTTP 面（用户 / 项目目录）
//!
//! - GET /api/skills
//! - PUT /api/skills/:name — 创建/更新
//! - DELETE /api/skills/:name

use std::sync::Arc;

use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::Json;

use crate::skills::{SkillRegistry, SkillSource};
use crate::SaCodeConfig;

use super::DaemonState;

fn registry_for(state: &Arc<DaemonState>) -> SkillRegistry {
    let workdir = state
        .workdir
        .clone()
        .unwrap_or_else(|| std::env::current_dir().unwrap_or_else(|_| std::path::PathBuf::from(".")));
    SkillRegistry::new_from_config(SaCodeConfig::new(&workdir))
}

fn parse_source(s: &str) -> SkillSource {
    match s {
        "user" => SkillSource::User,
        "workspace" => SkillSource::Workspace,
        _ => SkillSource::Project,
    }
}

pub async fn list_skills(State(state): State<Arc<DaemonState>>) -> Json<serde_json::Value> {
    let registry = registry_for(&state);
    match registry.list() {
        Ok(skills) => Json(serde_json::json!({
            "skills": skills.iter().map(|s| serde_json::json!({
                "name": s.name,
                "description": s.description,
                "source": s.source.label(),
                "path": s.path.display().to_string(),
                "version": s.version,
                "author": s.author,
                "tags": s.tags,
            })).collect::<Vec<_>>(),
        })),
        Err(err) => Json(serde_json::json!({
            "skills": [],
            "error": err.to_string(),
        })),
    }
}

#[derive(Debug, serde::Deserialize)]
pub struct UpsertSkillRequest {
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub prompt: String,
    /// user | project | workspace，默认 project
    #[serde(default = "default_source")]
    pub source: String,
    #[serde(default = "default_version")]
    pub version: String,
    #[serde(default)]
    pub author: String,
    #[serde(default)]
    pub tags: Vec<String>,
}

fn default_source() -> String {
    "project".to_string()
}

fn default_version() -> String {
    "1.0.0".to_string()
}

pub async fn upsert_skill(
    State(state): State<Arc<DaemonState>>,
    Path(name): Path<String>,
    Json(req): Json<UpsertSkillRequest>,
) -> (StatusCode, Json<serde_json::Value>) {
    if name.trim().is_empty() {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({ "status": "error", "message": "name is required" })),
        );
    }
    if req.prompt.trim().is_empty() {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({ "status": "error", "message": "prompt is required" })),
        );
    }
    let registry = registry_for(&state);
    let source = parse_source(&req.source);
    match registry.save_skill_with_meta(
        &name,
        &req.description,
        &req.prompt,
        &req.version,
        if req.author.is_empty() { "local" } else { &req.author },
        req.tags,
        source,
    ) {
        Ok(path) => (
            StatusCode::OK,
            Json(serde_json::json!({
                "status": "ok",
                "name": name,
                "path": path.display().to_string(),
            })),
        ),
        Err(err) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({ "status": "error", "message": err.to_string() })),
        ),
    }
}

#[derive(Debug, serde::Deserialize)]
pub struct DeleteSkillQuery {
    #[serde(default = "default_source")]
    pub source: String,
}

/// DELETE /api/skills/:name?source=project
pub async fn delete_skill(
    State(state): State<Arc<DaemonState>>,
    Path(name): Path<String>,
    axum::extract::Query(q): axum::extract::Query<DeleteSkillQuery>,
) -> (StatusCode, Json<serde_json::Value>) {
    let registry = registry_for(&state);
    // 按 source 删；失败再试 project/user（避免只删错源）
    let primary = parse_source(&q.source);
    let mut result = registry.remove_skill(&name, primary);
    if result.is_err() {
        for source in [SkillSource::Project, SkillSource::User, SkillSource::Workspace] {
            if registry.remove_skill(&name, source).is_ok() {
                result = Ok(());
                break;
            }
        }
    }
    match result {
        Ok(()) => (
            StatusCode::OK,
            Json(serde_json::json!({ "status": "ok", "name": name })),
        ),
        Err(err) => (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({ "status": "error", "message": err.to_string() })),
        ),
    }
}
