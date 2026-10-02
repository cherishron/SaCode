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
                "enabled": s.enabled,
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
    /// 契约 §7.2：默认启用标记；缺省 = true
    #[serde(default = "default_enabled")]
    pub enabled: bool,
}

fn default_source() -> String {
    "project".to_string()
}

fn default_version() -> String {
    "1.0.0".to_string()
}

fn default_enabled() -> bool {
    true
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
        req.enabled,
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

/// 契约 §7.2：`POST /api/skills/import` — ZIP（base64）或目录扫描导入技能。
#[derive(Debug, serde::Deserialize)]
pub struct ImportSkillsRequest {
    /// ZIP 文件 base64 内容；与 `directory` 二选一
    #[serde(default)]
    pub zip_base64: Option<String>,
    /// 目录扫描入口（服务端本地路径）；与 `zip_base64` 二选一
    #[serde(default)]
    pub directory: Option<String>,
    /// user | project | workspace，默认 project
    #[serde(default = "default_source")]
    pub source: String,
}

pub async fn import_skills(
    State(state): State<Arc<DaemonState>>,
    Json(req): Json<ImportSkillsRequest>,
) -> (StatusCode, Json<serde_json::Value>) {
    let has_zip = req
        .zip_base64
        .as_deref()
        .is_some_and(|value| !value.trim().is_empty());
    let has_dir = req
        .directory
        .as_deref()
        .is_some_and(|value| !value.trim().is_empty());
    if !has_zip && !has_dir {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({
                "status": "error",
                "message": "zip_base64 or directory is required",
            })),
        );
    }

    let registry = registry_for(&state);
    let source = parse_source(&req.source);
    let mut imported: Vec<serde_json::Value> = Vec::new();
    let mut errors: Vec<String> = Vec::new();

    if let Some(dir) = req.directory.as_deref().filter(|value| !value.trim().is_empty()) {
        let root = std::path::Path::new(dir);
        if !root.is_dir() {
            return (
                StatusCode::BAD_REQUEST,
                Json(serde_json::json!({
                    "status": "error",
                    "message": format!("directory not found: {dir}"),
                })),
            );
        }
        match collect_skill_files(root) {
            Ok(files) => {
                for (name, content) in files {
                    match write_imported_skill(&registry, source, &name, &content) {
                        Ok(path) => imported.push(serde_json::json!({
                            "name": name,
                            "path": path.display().to_string(),
                        })),
                        Err(err) => errors.push(format!("{name}: {err}")),
                    }
                }
            }
            Err(err) => errors.push(format!("directory scan: {err}")),
        }
    }

    if let Some(raw) = req.zip_base64.as_deref().filter(|value| !value.trim().is_empty()) {
        use base64::Engine as _;
        let decoded = base64::engine::general_purpose::STANDARD
            .decode(raw.trim())
            .map_err(|err| format!("zip_base64 decode: {err}"));
        match decoded {
            Ok(bytes) => match extract_skill_files_from_zip(&bytes) {
                Ok(files) => {
                    for (name, content) in files {
                        match write_imported_skill(&registry, source, &name, &content) {
                            Ok(path) => imported.push(serde_json::json!({
                                "name": name,
                                "path": path.display().to_string(),
                            })),
                            Err(err) => errors.push(format!("{name}: {err}")),
                        }
                    }
                }
                Err(err) => errors.push(err),
            },
            Err(err) => errors.push(err),
        }
    }

    if imported.is_empty() && !errors.is_empty() {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({
                "status": "error",
                "skills": [],
                "message": errors.join("; "),
            })),
        );
    }
    (
        StatusCode::OK,
        Json(serde_json::json!({
            "status": if errors.is_empty() { "ok" } else { "partial" },
            "skills": imported,
            "message": if errors.is_empty() { serde_json::Value::Null } else { serde_json::Value::String(errors.join("; ")) },
        })),
    )
}

/// 递归收集目录下的 `.md` 技能文件（按文件名去重）。
fn collect_skill_files(root: &std::path::Path) -> anyhow::Result<Vec<(String, String)>> {
    let mut files = Vec::new();
    for entry in walkdir(root, 0)? {
        if entry.extension().and_then(|ext| ext.to_str()) != Some("md") {
            continue;
        }
        let Some(stem) = entry.file_stem().and_then(|s| s.to_str()) else {
            continue;
        };
        let content = std::fs::read_to_string(&entry)?;
        files.push((stem.to_string(), content));
    }
    Ok(files)
}

fn walkdir(root: &std::path::Path, depth: usize) -> anyhow::Result<Vec<std::path::PathBuf>> {
    if depth > 8 {
        return Ok(Vec::new());
    }
    let mut out = Vec::new();
    for entry in std::fs::read_dir(root)? {
        let path = entry?.path();
        if path.is_dir() {
            out.extend(walkdir(&path, depth + 1)?);
        } else {
            out.push(path);
        }
    }
    Ok(out)
}

/// 从 ZIP 字节提取 `.md` 技能条目（仅取 .md，跳过目录与二进制）。
fn extract_skill_files_from_zip(bytes: &[u8]) -> Result<Vec<(String, String)>, String> {
    use std::io::Read as _;
    let cursor = std::io::Cursor::new(bytes);
    let mut archive = zip::ZipArchive::new(cursor).map_err(|err| format!("open zip: {err}"))?;
    let mut files = Vec::new();
    for index in 0..archive.len() {
        let mut entry = archive
            .by_index(index)
            .map_err(|err| format!("read zip entry: {err}"))?;
        if entry.is_dir() {
            continue;
        }
        let Some(path) = entry.enclosed_name().map(|p| p.to_path_buf()) else {
            continue;
        };
        if path.extension().and_then(|ext| ext.to_str()) != Some("md") {
            continue;
        }
        let Some(stem) = path.file_stem().and_then(|s| s.to_str()).map(str::to_string) else {
            continue;
        };
        let mut content = String::new();
        entry
            .read_to_string(&mut content)
            .map_err(|err| format!("read {}: {err}", path.display()))?;
        files.push((stem, content));
    }
    Ok(files)
}

/// 解析并落盘一份导入技能；正文按 SkillSpec 格式校验。
fn write_imported_skill(
    registry: &SkillRegistry,
    source: SkillSource,
    name: &str,
    content: &str,
) -> anyhow::Result<std::path::PathBuf> {
    let spec = crate::skills::parse_skill_file(std::path::Path::new(name), content, source);
    if spec.prompt.trim().is_empty() {
        anyhow::bail!("skill has empty prompt");
    }
    registry.save_skill_with_meta(
        &spec.name,
        &spec.description,
        &spec.prompt,
        spec.version.as_deref().unwrap_or("1.0.0"),
        spec.author.as_deref().unwrap_or("imported"),
        spec.tags,
        source,
        spec.enabled,
    )
}
