use std::{collections::BTreeSet, fs, path::Path, sync::Arc};

use axum::{
    extract::{Path as AxumPath, State},
    response::IntoResponse,
    Json,
};
use base64::Engine;
use serde::{Deserialize, Serialize};

use super::types::DaemonState;

const README_LIMIT: usize = 4_000;

#[derive(Debug, Clone, Serialize)]
pub struct DesignProjectContext {
    pub workspace: String,
    pub project_name: String,
    pub summary: String,
    pub technologies: Vec<String>,
    pub source_roots: Vec<String>,
    pub manifests: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct DesignTemplateResource {
    pub id: String,
    pub title: String,
    pub summary: String,
    pub components: Vec<String>,
    pub layout_notes: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct DesignResourceItem {
    pub id: &'static str,
    pub title: &'static str,
    pub summary: &'static str,
    pub tags: &'static [&'static str],
}

#[derive(Debug, Clone, Serialize)]
pub struct DesignResourceCatalog {
    pub templates: Vec<DesignTemplateResource>,
    pub visual_styles: Vec<DesignResourceItem>,
    pub design_systems: Vec<DesignResourceItem>,
    pub baselines: Vec<DesignResourceItem>,
}

pub async fn get_design_context(
    State(state): State<Arc<DaemonState>>,
) -> Json<DesignProjectContext> {
    Json(scan_project_context(state.workdir.as_deref()))
}

pub async fn list_design_resources() -> Json<DesignResourceCatalog> {
    let templates = crate::ai_design::list_design_examples()
        .into_iter()
        .map(|example| DesignTemplateResource {
            id: example.id.to_string(),
            title: example.title.to_string(),
            summary: example.summary.to_string(),
            components: example
                .components
                .iter()
                .map(|value| (*value).to_string())
                .collect(),
            layout_notes: example
                .layout_notes
                .iter()
                .map(|value| (*value).to_string())
                .collect(),
        })
        .collect();

    Json(DesignResourceCatalog {
        templates,
        visual_styles: vec![
            DesignResourceItem {
                id: "clean-tech",
                title: "Clean Tech",
                summary: "高对比信息层级、克制装饰与清晰数据表达。",
                tags: &["科技", "清晰", "数据"],
            },
            DesignResourceItem {
                id: "soft-glass",
                title: "Soft Glass",
                summary: "柔和渐变、半透明层次与轻量空间感。",
                tags: &["渐变", "玻璃", "轻盈"],
            },
            DesignResourceItem {
                id: "editorial-grid",
                title: "Editorial Grid",
                summary: "强调字体层级、留白与杂志式栅格。",
                tags: &["排版", "栅格", "内容"],
            },
        ],
        design_systems: vec![
            DesignResourceItem {
                id: "tdesign-web",
                title: "TDesign Web",
                summary: "适用于中后台与企业应用的组件和 Token 基线。",
                tags: &["企业", "中后台", "组件"],
            },
            DesignResourceItem {
                id: "sacode-desktop",
                title: "SaCode Desktop",
                summary: "深色优先、令牌驱动的桌面工作台设计系统。",
                tags: &["桌面", "深色", "开发工具"],
            },
        ],
        baselines: vec![
            DesignResourceItem {
                id: "accessible-ui",
                title: "Accessible UI",
                summary: "键盘可达、状态非颜色独占、对比度与语义结构基线。",
                tags: &["可访问性", "键盘", "语义"],
            },
            DesignResourceItem {
                id: "responsive-product",
                title: "Responsive Product",
                summary: "桌面、平板和移动视口的一致响应式规则。",
                tags: &["响应式", "多端", "布局"],
            },
            DesignResourceItem {
                id: "dense-workbench",
                title: "Dense Workbench",
                summary: "面向专业工具的高信息密度和渐进披露规则。",
                tags: &["工作台", "高密度", "效率"],
            },
        ],
    })
}

/// 设计系统提取任务
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExtractionJob {
    pub id: String,
    pub source_type: String,
    pub source_ref: String,
    pub status: String,
    pub progress: f32,
    pub result_id: Option<String>,
    pub result_version: Option<u32>,
    pub result_size: Option<u64>,
    pub result_sha256: Option<String>,
    pub result_expires_at: Option<String>,
    pub manifest: Option<serde_json::Value>,
    pub error: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

/// 创建提取任务请求
#[derive(Debug, Deserialize)]
pub struct CreateExtractionRequest {
    pub source_type: String,
    pub source_ref: String,
    pub confirmed: bool,
    /// 图片文件名（source_type == "image" 时必填）
    #[serde(default)]
    pub image_filename: Option<String>,
    /// 图片 MIME 类型（如 image/png）
    #[serde(default)]
    #[allow(dead_code)]
    pub image_content_type: Option<String>,
    /// 图片字节大小
    #[serde(default)]
    #[allow(dead_code)]
    pub image_size: Option<u64>,
}

/// 校验提取 URL 安全性：拒绝非 http/https、内网地址、file:// 等
pub fn validate_extraction_url(url: &str) -> Result<String, String> {
    let parsed = url::Url::parse(url).map_err(|_| format!("invalid url: {url}"))?;

    match parsed.scheme() {
        "http" | "https" => {}
        "file" => return Err("file:// scheme is not allowed".to_string()),
        other => return Err(format!("unsupported scheme: {other}")),
    }

    let host = parsed
        .host_str()
        .ok_or_else(|| "url missing host".to_string())?;

    // 拒绝 localhost / IP 字面量内网地址 / 内网域名
    let host_lower = host.to_lowercase();
    if host_lower == "localhost" {
        return Err("localhost is not allowed".to_string());
    }
    if host_lower.ends_with(".local") {
        return Err(".local addresses are not allowed".to_string());
    }

    // url crate 对 IPv6 地址 host_str() 返回带括号的 `[::1]`，去掉后再解析
    let host_trimmed = host_lower
        .strip_prefix('[')
        .and_then(|s| s.strip_suffix(']'))
        .unwrap_or(&host_lower);

    // 解析 IPv4 地址，检查内网段
    if let Ok(ip) = host_trimmed.parse::<std::net::Ipv4Addr>() {
        if ip.is_loopback() || ip.is_private() || ip.is_link_local() || ip.is_unspecified() {
            return Err(format!("private/reserved ip address not allowed: {host}"));
        }
    }

    // 解析 IPv6 地址，拒绝 loopback (::1) 和 unspecified (::)
    if let Ok(ip) = host_trimmed.parse::<std::net::Ipv6Addr>() {
        if ip.is_loopback() || ip.is_unspecified() {
            return Err(format!("private/reserved ipv6 address not allowed: {host}"));
        }
    }

    Ok(url.to_string())
}

fn now_iso8601() -> String {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default();
    chrono::DateTime::from_timestamp(now.as_secs() as i64, now.subsec_nanos())
        .unwrap_or_default()
        .to_rfc3339()
}

fn now_plus_secs_iso8601(secs: u64) -> String {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default();
    let future = now + std::time::Duration::from_secs(secs);
    chrono::DateTime::from_timestamp(future.as_secs() as i64, future.subsec_nanos())
        .unwrap_or_default()
        .to_rfc3339()
}

/// 创建提取任务
pub async fn create_extraction(
    State(state): State<Arc<DaemonState>>,
    Json(req): Json<CreateExtractionRequest>,
) -> impl IntoResponse {
    if !req.confirmed {
        return (
            axum::http::StatusCode::BAD_REQUEST,
            "confirmed must be true",
        )
            .into_response();
    }

    let source_ref = if req.source_type == "url" {
        match validate_extraction_url(&req.source_ref) {
            Ok(canonical) => canonical,
            Err(err) => {
                return (
                    axum::http::StatusCode::BAD_REQUEST,
                    format!("invalid source_ref: {err}"),
                )
                    .into_response();
            }
        }
    } else if req.source_type == "image" {
        // source_ref 是 base64 data URL 或裸 base64
        let data = req
            .source_ref
            .strip_prefix("data:")
            .unwrap_or(&req.source_ref);
        // 去掉可能的 MIME 前缀 (e.g. image/png;base64,)
        let data = data.split(',').last().unwrap_or(data);
        // 验证是合法 base64 且不超过 10MB
        match base64::engine::general_purpose::STANDARD.decode(data) {
            Ok(bytes) => {
                if bytes.len() > 10 * 1024 * 1024 {
                    return (
                        axum::http::StatusCode::PAYLOAD_TOO_LARGE,
                        "image exceeds 10MB limit",
                    )
                        .into_response();
                }
                if bytes.len() < 100 {
                    return (
                        axum::http::StatusCode::BAD_REQUEST,
                        "image too small to analyze",
                    )
                        .into_response();
                }
                format!(
                    "image:{}:{}",
                    req.image_filename.as_deref().unwrap_or("upload"),
                    bytes.len()
                )
            }
            Err(e) => {
                return (
                    axum::http::StatusCode::BAD_REQUEST,
                    format!("invalid base64 image data: {e}"),
                )
                    .into_response();
            }
        }
    } else {
        req.source_ref.clone()
    };

    let id = generate_id();
    let now = now_iso8601();

    let job = ExtractionJob {
        id: id.clone(),
        source_type: req.source_type.clone(),
        source_ref: source_ref.clone(),
        status: "queued".to_string(),
        progress: 0.0,
        result_id: None,
        result_version: None,
        result_size: None,
        result_sha256: None,
        result_expires_at: None,
        manifest: None,
        error: None,
        created_at: now.clone(),
        updated_at: now,
    };

    {
        let mut jobs = state.extraction_jobs.write().await;
        jobs.insert(id.clone(), job.clone());
    }

    // 后台模拟提取流程
    let state_clone = state.clone();
    let job_id = id.clone();
    let source_type = req.source_type.clone();
    let source_ref_for_manifest = source_ref.clone();
    tokio::spawn(async move {
        run_extraction_simulation(state_clone, job_id, source_type, source_ref_for_manifest).await;
    });

    (axum::http::StatusCode::CREATED, Json(job)).into_response()
}

async fn run_extraction_simulation(
    state: Arc<DaemonState>,
    job_id: String,
    source_type: String,
    source_ref: String,
) {
    // scanning
    tokio::time::sleep(std::time::Duration::from_secs(1)).await;
    {
        let mut jobs = state.extraction_jobs.write().await;
        if let Some(job) = jobs.get_mut(&job_id) {
            if job.status == "cancelled" {
                return;
            }
            job.status = "scanning".to_string();
            job.progress = 0.3;
            job.updated_at = now_iso8601();
        }
    }

    // analyzing
    tokio::time::sleep(std::time::Duration::from_secs(2)).await;
    {
        let mut jobs = state.extraction_jobs.write().await;
        if let Some(job) = jobs.get_mut(&job_id) {
            if job.status == "cancelled" {
                return;
            }
            job.status = "analyzing".to_string();
            job.progress = 0.6;
            job.updated_at = now_iso8601();
        }
    }

    // packaging
    tokio::time::sleep(std::time::Duration::from_secs(1)).await;
    {
        let mut jobs = state.extraction_jobs.write().await;
        if let Some(job) = jobs.get_mut(&job_id) {
            if job.status == "cancelled" {
                return;
            }
            job.status = "packaging".to_string();
            job.progress = 0.9;
            job.updated_at = now_iso8601();
        }
    }

    // succeeded
    tokio::time::sleep(std::time::Duration::from_secs(1)).await;
    {
        let mut jobs = state.extraction_jobs.write().await;
        if let Some(job) = jobs.get_mut(&job_id) {
            if job.status == "cancelled" {
                return;
            }

            let short_id: String = job_id.chars().take(8).collect();
            let result_id = format!("ds-{}", short_id);
            let (name, source_manifest) = if source_type == "image" {
                (
                    "Extracted Design System (from screenshot)",
                    serde_json::json!({
                        "type": "image",
                        "filename": source_ref,
                        "mode": "vision-analysis",
                    }),
                )
            } else {
                (
                    "Extracted Design System",
                    serde_json::json!({
                        "type": source_type,
                        "url": source_ref,
                        "mode": "standard",
                    }),
                )
            };
            let manifest = serde_json::json!({
                "schemaVersion": "od-design-system-project/v1",
                "id": format!("extraction-{}", short_id),
                "name": name,
                "category": "Imported",
                "source": source_manifest,
                "files": {
                    "design": "DESIGN.md",
                    "tokens": "tokens.css",
                    "components": "components.json",
                    "guidelines": "GUIDELINES.md",
                },
            });

            job.status = "succeeded".to_string();
            job.progress = 1.0;
            job.result_id = Some(result_id.clone());
            job.result_version = Some(1);
            job.result_size = Some(48_512);
            job.result_sha256 = Some(md5_placeholder(&result_id));
            job.result_expires_at = Some(now_plus_secs_iso8601(7 * 24 * 3600));
            job.manifest = Some(manifest);
            job.updated_at = now_iso8601();
        }
    }
}

/// 简单的确定性占位哈希（非加密用途，仅为生成稳定 sha256 占位值）
fn md5_placeholder(input: &str) -> String {
    use sha2::{Digest, Sha256};
    let mut hasher = Sha256::new();
    hasher.update(input.as_bytes());
    let bytes = hasher.finalize();
    let hex: String = bytes.iter().map(|b| format!("{:02x}", b)).collect();
    format!("sha256:{}", hex)
}

/// 生成随机 ID（8 字节十六进制）
fn generate_id() -> String {
    use rand::Rng;
    let bytes: [u8; 16] = rand::thread_rng().gen();
    let hex: String = bytes.iter().map(|b| format!("{:02x}", b)).collect();
    hex
}

// ---------------------------------------------------------------------------
// Design Session CRUD
// ---------------------------------------------------------------------------

/// 设计会话：一次完整设计任务的草稿/计划/生成状态机载体
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DesignSession {
    pub id: String,
    pub workspace: String,
    pub goal: String,
    pub request: String,
    pub notes: String,
    pub primary_template_id: Option<String>,
    pub visual_style_id: Option<String>,
    pub design_system_id: Option<String>,
    pub baseline_ids: Vec<String>,
    pub outputs: Vec<String>,
    pub backend_id: String,
    pub mode: String,
    pub target_path: String,
    /// "draft" | "planning" | "planned" | "generating" | "completed" | "failed"
    pub status: String,
    pub plan: Option<GenerationPlan>,
    pub prompt_snapshot: Option<String>,
    pub context_hash: Option<String>,
    pub task_id: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

/// 生成计划：阶段划分、模型分配、预估产物与目标文件
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GenerationPlan {
    pub stages: Vec<GenerationStage>,
    pub models: Vec<ModelAssignment>,
    pub estimated_outputs: Vec<String>,
    pub target_files: Vec<String>,
}

/// 生成阶段：id ∈ {"context" | "brief" | "design" | "assets" | "code" | "verify"}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GenerationStage {
    pub id: String,
    pub label: String,
    pub model_id: Option<String>,
    /// "pending" | "running" | "completed" | "failed" | "skipped"
    pub status: String,
    pub required: bool,
}

/// 阶段模型分配：该阶段使用的 backend 与能力标签
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelAssignment {
    pub stage: String,
    pub backend_id: String,
    pub capability: String,
}

/// 创建设计会话请求
#[derive(Debug, Deserialize)]
pub struct CreateSessionRequest {
    pub workspace: Option<String>,
    pub goal: String,
    pub request: String,
    pub backend_id: Option<String>,
}

/// 更新设计会话请求：None = 不变，Some(val) = 更新
#[derive(Debug, Deserialize)]
pub struct UpdateSessionRequest {
    pub goal: Option<String>,
    pub request: Option<String>,
    pub notes: Option<String>,
    pub primary_template_id: Option<Option<String>>,
    pub visual_style_id: Option<Option<String>>,
    pub design_system_id: Option<Option<String>>,
    pub baseline_ids: Option<Vec<String>>,
    pub outputs: Option<Vec<String>>,
    pub backend_id: Option<String>,
    pub mode: Option<String>,
    pub target_path: Option<String>,
}

/// 创建设计会话
pub async fn create_session(
    State(state): State<Arc<DaemonState>>,
    Json(req): Json<CreateSessionRequest>,
) -> impl IntoResponse {
    let id = generate_id();
    let now = now_iso8601();
    let workspace = req
        .workspace
        .clone()
        .or_else(|| {
            state
                .workdir
                .as_ref()
                .map(|dir| dir.to_string_lossy().to_string())
        })
        .unwrap_or_default();

    let session = DesignSession {
        id: id.clone(),
        workspace,
        goal: req.goal.clone(),
        request: req.request.clone(),
        notes: String::new(),
        primary_template_id: None,
        visual_style_id: None,
        design_system_id: None,
        baseline_ids: Vec::new(),
        outputs: Vec::new(),
        backend_id: req
            .backend_id
            .clone()
            .unwrap_or_else(|| "sacode".to_string()),
        mode: "build".to_string(),
        target_path: String::new(),
        status: "draft".to_string(),
        plan: None,
        prompt_snapshot: None,
        context_hash: None,
        task_id: None,
        created_at: now.clone(),
        updated_at: now,
    };

    {
        let mut sessions = state.design_sessions.write().await;
        sessions.insert(id.clone(), session.clone());
    }

    (axum::http::StatusCode::CREATED, Json(session)).into_response()
}

/// 列出所有设计会话（按 updated_at 降序）
pub async fn list_sessions(State(state): State<Arc<DaemonState>>) -> Json<Vec<DesignSession>> {
    let sessions = state.design_sessions.read().await;
    let mut list: Vec<DesignSession> = sessions.values().cloned().collect();
    list.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
    Json(list)
}

/// 获取单个设计会话
pub async fn get_session(
    State(state): State<Arc<DaemonState>>,
    AxumPath(id): AxumPath<String>,
) -> impl IntoResponse {
    let sessions = state.design_sessions.read().await;
    match sessions.get(&id) {
        Some(session) => Json(session.clone()).into_response(),
        None => (axum::http::StatusCode::NOT_FOUND, "not found").into_response(),
    }
}

/// 更新设计会话：仅覆盖 req 中出现的字段
pub async fn update_session(
    State(state): State<Arc<DaemonState>>,
    AxumPath(id): AxumPath<String>,
    Json(req): Json<UpdateSessionRequest>,
) -> impl IntoResponse {
    let mut sessions = state.design_sessions.write().await;
    match sessions.get_mut(&id) {
        Some(session) => {
            if let Some(goal) = req.goal {
                session.goal = goal;
            }
            if let Some(request) = req.request {
                session.request = request;
            }
            if let Some(notes) = req.notes {
                session.notes = notes;
            }
            if let Some(primary_template_id) = req.primary_template_id {
                session.primary_template_id = primary_template_id;
            }
            if let Some(visual_style_id) = req.visual_style_id {
                session.visual_style_id = visual_style_id;
            }
            if let Some(design_system_id) = req.design_system_id {
                session.design_system_id = design_system_id;
            }
            if let Some(baseline_ids) = req.baseline_ids {
                session.baseline_ids = baseline_ids;
            }
            if let Some(outputs) = req.outputs {
                session.outputs = outputs;
            }
            if let Some(backend_id) = req.backend_id {
                session.backend_id = backend_id;
            }
            if let Some(mode) = req.mode {
                session.mode = mode;
            }
            if let Some(target_path) = req.target_path {
                session.target_path = target_path;
            }
            session.updated_at = now_iso8601();
            (axum::http::StatusCode::OK, Json(session.clone())).into_response()
        }
        None => (axum::http::StatusCode::NOT_FOUND, "not found").into_response(),
    }
}

/// 基于 outputs 推导生成阶段；stage 去重且保持首次出现顺序
fn stages_for_outputs(outputs: &[String]) -> Vec<(String, String, bool)> {
    let mut stages: Vec<(String, String, bool)> = vec![];
    let mut push = |id: &str, label: String| {
        if !stages.iter().any(|(existing, _, _)| existing == id) {
            stages.push((id.to_string(), label, true));
        }
    };

    for output in outputs {
        match output.as_str() {
            "brief" => push("brief", "设计简报".to_string()),
            "prompt" => push("brief", "设计简报".to_string()),
            "design" | "design-system" => push("design", "设计规范".to_string()),
            "images" => push("assets", "视觉资产".to_string()),
            "code" => push("code", "代码生成".to_string()),
            _ => {}
        }
    }

    let context = String::from("上下文分析");
    let verify = String::from("验证检查");
    let ordered = vec![
        ("context", context, true),
        ("brief", String::from("设计简报"), false),
        ("design", String::from("设计规范"), false),
        ("assets", String::from("视觉资产"), false),
        ("code", String::from("代码生成"), false),
        ("verify", verify, true),
    ];

    let mut result: Vec<(String, String, bool)> = Vec::new();
    result.push(("context".to_string(), ordered[0].1.clone(), ordered[0].2));
    for (id, label, required) in stages {
        result.push((id, label, required));
    }
    result.push(("verify".to_string(), ordered[5].1.clone(), ordered[5].2));
    result
}

/// 预估目标文件：结合 target_path 与 outputs 生成文件清单
fn estimated_target_files(session: &DesignSession) -> Vec<String> {
    let root = session.target_path.trim();
    let root = root.trim_end_matches('/').trim_end_matches('\\');
    let join = |name: &str| -> String {
        if root.is_empty() {
            name.to_string()
        } else {
            format!("{root}/{name}")
        }
    };

    let mut files: Vec<String> = Vec::new();
    for output in &session.outputs {
        match output.as_str() {
            "brief" | "prompt" => {
                files.push(join("DESIGN_BRIEF.md"));
            }
            "design" | "design-system" => {
                files.push(join("DESIGN.md"));
                files.push(join("tokens.css"));
            }
            "images" => {
                files.push(join("assets/images"));
            }
            "code" => {
                files.push(join("src/pages/index.tsx"));
                files.push(join("src/components/"));
            }
            _ => {}
        }
    }
    if files.is_empty() {
        files.push(join("src/pages/index.tsx"));
        files.push(join("DESIGN.md"));
    }
    files.sort();
    files.dedup();
    files
}

/// 阶段能力标签：不同阶段对模型能力要求不同
fn stage_capability(stage: &str) -> String {
    match stage {
        "context" => "analysis",
        "brief" => "writing",
        "design" => "design",
        "assets" => "image",
        "code" => "code",
        "verify" => "review",
        _ => "general",
    }
    .to_string()
}

/// 计算 prompt_snapshot 的 sha256（带 `sha256:` 前缀）
fn sha256_hex(input: &str) -> String {
    use sha2::{Digest, Sha256};
    let mut hasher = Sha256::new();
    hasher.update(input.as_bytes());
    let bytes = hasher.finalize();
    let hex: String = bytes.iter().map(|b| format!("{:02x}", b)).collect();
    format!("sha256:{hex}")
}

/// 由 session 字段拼接结构化 Prompt（TS buildSaDesignPrompt 的 Rust 简化版）
fn build_prompt_snapshot(session: &DesignSession) -> String {
    let mut lines: Vec<String> = vec![
        "# SaDesign 项目设计任务".to_string(),
        String::new(),
        "请先分析当前工作区，再根据以下已确认的 Design Context 完成设计任务。".to_string(),
        String::new(),
        "## 项目事实".to_string(),
        format!("- 工作区：{}", session.workspace),
        String::new(),
        "## 设计目标".to_string(),
        format!("- 类型：{}", session.goal),
        format!("- 用户需求：{}", session.request),
        format!("- 目标产物：{}", session.outputs.join("、")),
        format!("- 目标路径：{}", session.target_path),
    ];

    let basis = vec![
        format!(
            "- 主模板：{}",
            session
                .primary_template_id
                .clone()
                .unwrap_or_else(|| "未指定".to_string())
        ),
        format!(
            "- 视觉风格：{}",
            session
                .visual_style_id
                .clone()
                .unwrap_or_else(|| "沿用当前项目风格".to_string())
        ),
        format!(
            "- 设计系统：{}",
            session
                .design_system_id
                .clone()
                .unwrap_or_else(|| "优先复用项目现有组件与 Token".to_string())
        ),
        format!(
            "- 方向基线：{}",
            if session.baseline_ids.is_empty() {
                "无额外基线".to_string()
            } else {
                session.baseline_ids.join("、")
            }
        ),
    ];
    lines.push(String::new());
    lines.push("## 设计依据".to_string());
    lines.extend(basis);
    if !session.notes.trim().is_empty() {
        lines.push(format!("- 用户补充：{}", session.notes.trim()));
    }

    lines.push(String::new());
    lines.push("## 执行约束".to_string());
    lines.push("1. 先输出简短的项目理解、设计计划和预计文件变更，再开始修改。".to_string());
    lines.push("2. 优先复用现有框架、组件、样式 Token 和目录结构，不引入无关依赖。".to_string());
    lines.push("3. 前端实现必须包含加载、空状态、错误和键盘可达等必要交互状态。".to_string());
    lines.push(
        "4. 所有文件修改进入 SaCode Changes/Diff 与审批流程，不覆盖无关用户改动。".to_string(),
    );
    lines.push("5. 完成后运行最小相关检查，并总结设计选择、生成产物和验证结果。".to_string());

    lines.join("\n")
}

/// 为设计会话生成计划：填充 plan/prompt_snapshot/context_hash，status → "planned"
pub async fn plan_session(
    State(state): State<Arc<DaemonState>>,
    AxumPath(id): AxumPath<String>,
) -> impl IntoResponse {
    let mut sessions = state.design_sessions.write().await;
    match sessions.get_mut(&id) {
        Some(session) => {
            let stages_spec = stages_for_outputs(&session.outputs);
            let stages: Vec<GenerationStage> = stages_spec
                .into_iter()
                .map(|(stage_id, label, required)| GenerationStage {
                    id: stage_id.clone(),
                    label,
                    model_id: Some(session.backend_id.clone()),
                    status: "pending".to_string(),
                    required,
                })
                .collect();
            let models: Vec<ModelAssignment> = stages
                .iter()
                .map(|stage| ModelAssignment {
                    stage: stage.id.clone(),
                    backend_id: session.backend_id.clone(),
                    capability: stage_capability(&stage.id),
                })
                .collect();

            let prompt = build_prompt_snapshot(session);
            let plan = GenerationPlan {
                stages,
                models,
                estimated_outputs: session.outputs.clone(),
                target_files: estimated_target_files(session),
            };

            session.context_hash = Some(sha256_hex(&prompt));
            session.prompt_snapshot = Some(prompt);
            session.plan = Some(plan);
            session.status = "planned".to_string();
            session.updated_at = now_iso8601();

            (axum::http::StatusCode::OK, Json(session.clone())).into_response()
        }
        None => (axum::http::StatusCode::NOT_FOUND, "not found").into_response(),
    }
}

/// 确认计划并启动生成：status → "generating"，生成 task_id
pub async fn generate_session(
    State(state): State<Arc<DaemonState>>,
    AxumPath(id): AxumPath<String>,
) -> impl IntoResponse {
    let mut sessions = state.design_sessions.write().await;
    match sessions.get_mut(&id) {
        Some(session) => {
            if session.status != "planned" {
                return (
                    axum::http::StatusCode::CONFLICT,
                    format!(
                        "session must be planned before generate, current status: {}",
                        session.status
                    ),
                )
                    .into_response();
            }
            let task_id = generate_id();
            session.task_id = Some(task_id.clone());
            session.status = "generating".to_string();
            session.updated_at = now_iso8601();
            (axum::http::StatusCode::OK, Json(session.clone())).into_response()
        }
        None => (axum::http::StatusCode::NOT_FOUND, "not found").into_response(),
    }
}

// ---------------------------------------------------------------------------
// 设计系统包下载 / 导入
// ---------------------------------------------------------------------------

/// 设计系统包文件清单
fn design_system_package_contents(id: &str) -> Vec<(&'static str, String)> {
    vec![
        (
            "DESIGN.md",
            format!(
                "# Extracted Design System\n\nPackage id: {id}.\n\n\
                 This design system was extracted by SaCode Design extraction pipeline.\n\
                 Reuse these tokens and components before introducing new styles.\n"
            ),
        ),
        (
            "tokens.css",
            ":root {\n  --color-brand: #1677ff;\n  --color-text: #1f2329;\n  \
             --color-bg: #ffffff;\n  --radius-sm: 4px;\n  --radius-md: 8px;\n  \
             --font-family: system-ui, -apple-system, sans-serif;\n}\n"
                .to_string(),
        ),
        (
            "design-tokens.json",
            serde_json::to_string_pretty(&serde_json::json!({
                "schemaVersion": "od-design-system-project/v1",
                "id": id,
                "name": "Extracted Design System",
                "category": "Imported",
                "tokens": {
                    "color": {
                        "brand": { "value": "#1677ff" },
                        "text": { "value": "#1f2329" },
                        "bg": { "value": "#ffffff" }
                    },
                    "radius": {
                        "sm": { "value": "4px" },
                        "md": { "value": "8px" }
                    },
                    "font": {
                        "family": { "value": "system-ui, -apple-system, sans-serif" }
                    }
                }
            }))
            .unwrap_or_else(|_| "{}".to_string()),
        ),
        (
            "components.manifest.json",
            serde_json::to_string_pretty(&serde_json::json!({
                "schemaVersion": "od-design-components/v1",
                "components": [
                    {
                        "name": "Button",
                        "props": ["variant", "size", "disabled"],
                        "tokens": ["--color-brand", "--radius-sm"]
                    },
                    {
                        "name": "Card",
                        "props": ["bordered", "shadow"],
                        "tokens": ["--color-bg", "--radius-md"]
                    }
                ]
            }))
            .unwrap_or_else(|_| "{}".to_string()),
        ),
        (
            "USAGE.md",
            format!(
                "# Usage\n\n1. Copy `tokens.css` into your global stylesheet.\n\
                 2. Register the manifest entries from `components.manifest.json`.\n\
                 3. Follow `DESIGN.md` for layout and interaction rules.\n\n\
                 Package id: {id}\n"
            ),
        ),
    ]
}

/// 下载设计系统包：返回 ZIP 格式
pub async fn download_design_system(
    State(state): State<Arc<DaemonState>>,
    AxumPath(id): AxumPath<String>,
) -> impl IntoResponse {
    let job_info = {
        let jobs = state.extraction_jobs.read().await;
        jobs.values()
            .find(|job| job.result_id.as_deref() == Some(id.as_str()) && job.status == "succeeded")
            .map(|job| (job.id.clone(), job.result_expires_at.clone()))
    };

    let Some((source_job_id, result_expires_at)) = job_info else {
        return (axum::http::StatusCode::NOT_FOUND, "not found").into_response();
    };

    // 检查过期
    if let Some(expires) = result_expires_at.as_deref() {
        if let Some(deadline) = chrono::DateTime::parse_from_rfc3339(expires).ok() {
            if deadline <= chrono::Utc::now() {
                return axum::http::StatusCode::GONE.into_response();
            }
        }
    }

    let files = design_system_package_contents(id.as_str());

    // 构建 ZIP（store + deflate 混合，单条目直接 store 简单可靠）
    let mut zip_buf = Vec::new();
    let mut central_dir: Vec<u8> = Vec::new();
    let mut offset: u32 = 0;
    for (path, content) in &files {
        let raw = content.as_bytes();
        // 使用 store（无压缩）保证简单可靠；这些文件都是文本，体积很小
        let crc = crc32(raw);
        let name_bytes = path.as_bytes();
        let header_size = 30 + name_bytes.len();
        // Local file header
        zip_buf.extend_from_slice(&0x04034b50u32.to_le_bytes());
        zip_buf.extend_from_slice(&20u16.to_le_bytes()); // version needed
        zip_buf.extend_from_slice(&0u16.to_le_bytes()); // flags
        zip_buf.extend_from_slice(&0u16.to_le_bytes()); // method: store
        zip_buf.extend_from_slice(&0u16.to_le_bytes()); // mod time
        zip_buf.extend_from_slice(&0u16.to_le_bytes()); // mod date
        zip_buf.extend_from_slice(&crc.to_le_bytes());
        zip_buf.extend_from_slice(&(raw.len() as u32).to_le_bytes()); // compressed size
        zip_buf.extend_from_slice(&(raw.len() as u32).to_le_bytes()); // uncompressed size
        zip_buf.extend_from_slice(&(name_bytes.len() as u16).to_le_bytes());
        zip_buf.extend_from_slice(&0u16.to_le_bytes()); // extra len
        zip_buf.extend_from_slice(name_bytes);
        // File data
        zip_buf.extend_from_slice(raw);
        // Central directory entry
        central_dir.extend_from_slice(&0x02014b50u32.to_le_bytes());
        central_dir.extend_from_slice(&20u16.to_le_bytes()); // version made by
        central_dir.extend_from_slice(&20u16.to_le_bytes()); // version needed
        central_dir.extend_from_slice(&0u16.to_le_bytes()); // flags
        central_dir.extend_from_slice(&0u16.to_le_bytes()); // method
        central_dir.extend_from_slice(&0u16.to_le_bytes()); // mod time
        central_dir.extend_from_slice(&0u16.to_le_bytes()); // mod date
        central_dir.extend_from_slice(&crc.to_le_bytes());
        central_dir.extend_from_slice(&(raw.len() as u32).to_le_bytes());
        central_dir.extend_from_slice(&(raw.len() as u32).to_le_bytes());
        central_dir.extend_from_slice(&(name_bytes.len() as u16).to_le_bytes());
        central_dir.extend_from_slice(&0u16.to_le_bytes()); // extra
        central_dir.extend_from_slice(&0u16.to_le_bytes()); // comment
        central_dir.extend_from_slice(&0u16.to_le_bytes()); // disk number
        central_dir.extend_from_slice(&0u16.to_le_bytes()); // internal attrs
        central_dir.extend_from_slice(&0u32.to_le_bytes()); // external attrs
        central_dir.extend_from_slice(&offset.to_le_bytes()); // local header offset
        central_dir.extend_from_slice(name_bytes);
        offset += header_size as u32 + raw.len() as u32;
    }
    // manifest.json entry
    {
        let manifest = serde_json::json!({
            "id": id,
            "schemaVersion": "od-design-system-project/v1",
            "source_job_id": source_job_id,
            "format": "zip",
            "files": files.iter().map(|(p, _)| p.to_string()).collect::<Vec<_>>(),
        });
        let content = serde_json::to_string_pretty(&manifest).unwrap_or_else(|_| "{}".to_string());
        let raw = content.as_bytes();
        let crc = crc32(raw);
        let name_bytes = b"manifest.json";
        let _header_size = 30 + name_bytes.len();
        zip_buf.extend_from_slice(&0x04034b50u32.to_le_bytes());
        zip_buf.extend_from_slice(&20u16.to_le_bytes());
        zip_buf.extend_from_slice(&0u16.to_le_bytes());
        zip_buf.extend_from_slice(&0u16.to_le_bytes());
        zip_buf.extend_from_slice(&0u16.to_le_bytes());
        zip_buf.extend_from_slice(&0u16.to_le_bytes());
        zip_buf.extend_from_slice(&crc.to_le_bytes());
        zip_buf.extend_from_slice(&(raw.len() as u32).to_le_bytes());
        zip_buf.extend_from_slice(&(raw.len() as u32).to_le_bytes());
        zip_buf.extend_from_slice(&(name_bytes.len() as u16).to_le_bytes());
        zip_buf.extend_from_slice(&0u16.to_le_bytes());
        zip_buf.extend_from_slice(name_bytes);
        zip_buf.extend_from_slice(raw);
        central_dir.extend_from_slice(&0x02014b50u32.to_le_bytes());
        central_dir.extend_from_slice(&20u16.to_le_bytes());
        central_dir.extend_from_slice(&20u16.to_le_bytes());
        central_dir.extend_from_slice(&0u16.to_le_bytes());
        central_dir.extend_from_slice(&0u16.to_le_bytes());
        central_dir.extend_from_slice(&0u16.to_le_bytes());
        central_dir.extend_from_slice(&0u16.to_le_bytes());
        central_dir.extend_from_slice(&crc.to_le_bytes());
        central_dir.extend_from_slice(&(raw.len() as u32).to_le_bytes());
        central_dir.extend_from_slice(&(raw.len() as u32).to_le_bytes());
        central_dir.extend_from_slice(&(name_bytes.len() as u16).to_le_bytes());
        central_dir.extend_from_slice(&0u16.to_le_bytes());
        central_dir.extend_from_slice(&0u16.to_le_bytes());
        central_dir.extend_from_slice(&0u16.to_le_bytes());
        central_dir.extend_from_slice(&0u16.to_le_bytes());
        central_dir.extend_from_slice(&0u32.to_le_bytes());
        central_dir.extend_from_slice(&offset.to_le_bytes());
        central_dir.extend_from_slice(name_bytes);
    }
    let cd_offset = zip_buf.len() as u32;
    let cd_size = central_dir.len() as u32;
    let total_entries = (files.len() + 1) as u16;
    zip_buf.extend_from_slice(&central_dir);
    // End of central directory
    zip_buf.extend_from_slice(&0x06054b50u32.to_le_bytes());
    zip_buf.extend_from_slice(&0u16.to_le_bytes()); // disk
    zip_buf.extend_from_slice(&0u16.to_le_bytes()); // cd start disk
    zip_buf.extend_from_slice(&total_entries.to_le_bytes()); // entries on disk
    zip_buf.extend_from_slice(&total_entries.to_le_bytes()); // total entries
    zip_buf.extend_from_slice(&cd_size.to_le_bytes());
    zip_buf.extend_from_slice(&cd_offset.to_le_bytes());
    zip_buf.extend_from_slice(&0u16.to_le_bytes()); // comment len

    (
        axum::http::StatusCode::OK,
        [
            (
                axum::http::header::CONTENT_TYPE,
                "application/zip".to_string(),
            ),
            (
                axum::http::header::HeaderName::from_static("x-package-format"),
                "zip".to_string(),
            ),
            (
                axum::http::header::CONTENT_DISPOSITION,
                format!("attachment; filename=\"{}.zip\"", id),
            ),
        ],
        zip_buf,
    )
        .into_response()
}

/// CRC-32 (IEEE 802.3) — ZIP 必需
fn crc32(data: &[u8]) -> u32 {
    let mut crc: u32 = 0xffffffff;
    for &b in data {
        crc ^= b as u32;
        for _ in 0..8 {
            crc = if crc & 1 != 0 {
                (crc >> 1) ^ 0xedb88320
            } else {
                crc >> 1
            };
        }
    }
    !crc
}

/// 导入设计系统：返回导入目标路径（不落盘，模拟导入）
pub async fn import_design_system(
    State(state): State<Arc<DaemonState>>,
    AxumPath(id): AxumPath<String>,
) -> impl IntoResponse {
    let matching = {
        let jobs = state.extraction_jobs.read().await;
        jobs.values()
            .any(|job| job.result_id.as_deref() == Some(id.as_str()) && job.status == "succeeded")
    };

    if !matching {
        return (axum::http::StatusCode::NOT_FOUND, "not found").into_response();
    }

    (
        axum::http::StatusCode::OK,
        Json(serde_json::json!({
            "imported": true,
            "id": id,
            "project_path": format!(".sacode/design-systems/{id}/"),
        })),
    )
        .into_response()
}

/// 列出所有提取任务（按 created_at 降序）
pub async fn list_extractions(State(state): State<Arc<DaemonState>>) -> Json<Vec<ExtractionJob>> {
    let jobs = state.extraction_jobs.read().await;
    let mut list: Vec<ExtractionJob> = jobs.values().cloned().collect();
    list.sort_by(|a, b| b.created_at.cmp(&a.created_at));
    Json(list)
}

/// 获取单个提取任务
pub async fn get_extraction(
    State(state): State<Arc<DaemonState>>,
    AxumPath(id): AxumPath<String>,
) -> impl IntoResponse {
    let jobs = state.extraction_jobs.read().await;
    match jobs.get(&id) {
        Some(job) => Json(job.clone()).into_response(),
        None => (axum::http::StatusCode::NOT_FOUND, "not found").into_response(),
    }
}

/// 取消提取任务
pub async fn cancel_extraction(
    State(state): State<Arc<DaemonState>>,
    AxumPath(id): AxumPath<String>,
) -> impl IntoResponse {
    let mut jobs = state.extraction_jobs.write().await;
    match jobs.get_mut(&id) {
        Some(job) => {
            job.status = "cancelled".to_string();
            job.updated_at = now_iso8601();
            (axum::http::StatusCode::OK, Json(job.clone())).into_response()
        }
        None => (axum::http::StatusCode::NOT_FOUND, "not found").into_response(),
    }
}

fn scan_project_context(workdir: Option<&Path>) -> DesignProjectContext {
    let Some(root) = workdir else {
        return DesignProjectContext {
            workspace: String::new(),
            project_name: "Unknown project".to_string(),
            summary: "工作目录不可用。".to_string(),
            technologies: Vec::new(),
            source_roots: Vec::new(),
            manifests: Vec::new(),
        };
    };
    let project_name = package_name(root)
        .or_else(|| cargo_package_name(root))
        .or_else(|| {
            root.file_name()
                .map(|value| value.to_string_lossy().to_string())
        })
        .unwrap_or_else(|| "Project".to_string());
    let summary = read_project_summary(root).unwrap_or_else(|| {
        format!("{project_name} 项目。SaDesign 将使用项目清单和源码目录整理设计上下文。")
    });

    let manifest_candidates = [
        "package.json",
        "Cargo.toml",
        "pyproject.toml",
        "requirements.txt",
        "go.mod",
        "build.gradle.kts",
        "settings.gradle.kts",
        "pubspec.yaml",
    ];
    let manifests: Vec<String> = manifest_candidates
        .iter()
        .filter(|name| root.join(name).is_file())
        .map(|name| (*name).to_string())
        .collect();

    let source_candidates = [
        "src",
        "app",
        "apps",
        "components",
        "interfaces",
        "runtime",
        "packages",
        "public",
        "assets",
        "docs",
    ];
    let source_roots = source_candidates
        .iter()
        .filter(|name| root.join(name).is_dir())
        .map(|name| (*name).to_string())
        .collect();

    let mut technologies = BTreeSet::new();
    if root.join("package.json").is_file() {
        technologies.insert("Node.js".to_string());
        detect_package_technologies(root, &mut technologies);
    }
    if root.join("Cargo.toml").is_file() {
        technologies.insert("Rust".to_string());
    }
    if root.join("pyproject.toml").is_file() || root.join("requirements.txt").is_file() {
        technologies.insert("Python".to_string());
    }
    if root.join("go.mod").is_file() {
        technologies.insert("Go".to_string());
    }
    if root.join("build.gradle.kts").is_file() || root.join("settings.gradle.kts").is_file() {
        technologies.insert("Kotlin".to_string());
    }

    DesignProjectContext {
        workspace: root.to_string_lossy().to_string(),
        project_name,
        summary,
        technologies: technologies.into_iter().collect(),
        source_roots,
        manifests,
    }
}

fn package_name(root: &Path) -> Option<String> {
    let raw = fs::read_to_string(root.join("package.json")).ok()?;
    let value: serde_json::Value = serde_json::from_str(&raw).ok()?;
    value.get("name")?.as_str().map(str::to_string)
}

fn cargo_package_name(root: &Path) -> Option<String> {
    let raw = fs::read_to_string(root.join("Cargo.toml")).ok()?;
    let mut in_package = false;
    for line in raw.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with('[') {
            in_package = trimmed == "[package]";
            continue;
        }
        if in_package && trimmed.starts_with("name") {
            return trimmed
                .split_once('=')
                .map(|(_, value)| value.trim().trim_matches('"').to_string())
                .filter(|value| !value.is_empty());
        }
    }
    None
}

fn read_project_summary(root: &Path) -> Option<String> {
    for name in ["README.md", "README.zh-CN.md", "README.en.md"] {
        let Ok(raw) = fs::read_to_string(root.join(name)) else {
            continue;
        };
        let summary = raw
            .lines()
            .map(str::trim)
            .filter(|line| {
                !line.is_empty()
                    && !line.starts_with('#')
                    && !line.starts_with("![")
                    && !line.starts_with("[![")
                    && !line.starts_with("<img")
                    && !line.starts_with("<div")
            })
            .take(8)
            .collect::<Vec<_>>()
            .join(" ");
        if !summary.is_empty() {
            return Some(summary.chars().take(README_LIMIT).collect());
        }
    }
    None
}

fn detect_package_technologies(root: &Path, technologies: &mut BTreeSet<String>) {
    let Ok(raw) = fs::read_to_string(root.join("package.json")) else {
        return;
    };
    let Ok(value) = serde_json::from_str::<serde_json::Value>(&raw) else {
        return;
    };
    let mut dependency_names = BTreeSet::new();
    for key in ["dependencies", "devDependencies"] {
        if let Some(entries) = value.get(key).and_then(|entry| entry.as_object()) {
            dependency_names.extend(entries.keys().cloned());
        }
    }
    for (dependency, label) in [
        ("react", "React"),
        ("vue", "Vue"),
        ("svelte", "Svelte"),
        ("@angular/core", "Angular"),
        ("vite", "Vite"),
        ("next", "Next.js"),
        ("typescript", "TypeScript"),
        ("@tauri-apps/api", "Tauri"),
        ("tailwindcss", "Tailwind CSS"),
        ("tdesign-react", "TDesign"),
        ("tdesign-vue-next", "TDesign"),
    ] {
        if dependency_names.contains(dependency) {
            technologies.insert(label.to_string());
        }
    }
}

// ── 图片生成 ──

#[derive(Debug, Deserialize)]
pub struct ImageGenerationRequest {
    pub prompt: String,
    #[serde(default = "default_image_size")]
    pub size: String,
    #[serde(default = "default_image_n")]
    pub n: u32,
    #[serde(default = "default_image_output_format")]
    pub output_format: String,
    #[serde(default = "default_image_watermark")]
    pub watermark: bool,
}

fn default_image_size() -> String {
    "1024x1024".to_string()
}
fn default_image_n() -> u32 {
    1
}
fn default_image_output_format() -> String {
    "png".to_string()
}
fn default_image_watermark() -> bool {
    false
}

#[derive(Debug, Serialize)]
pub struct ImageGenerationResult {
    pub images: Vec<GeneratedImage>,
    pub model: String,
    pub provider: String,
}

#[derive(Debug, Serialize)]
pub struct GeneratedImage {
    pub url: String,
    pub size: String,
    pub format: String,
}

/// POST /api/design/images/generate — 调用 SenseNova 图片生成 API
pub async fn generate_images(Json(req): Json<ImageGenerationRequest>) -> impl IntoResponse {
    let api_key = std::env::var("SENSENOVA_API_KEY").unwrap_or_default();
    if api_key.is_empty() {
        return (
            axum::http::StatusCode::SERVICE_UNAVAILABLE,
            "SENSENOVA_API_KEY not configured; image generation is unavailable",
        )
            .into_response();
    }

    if req.prompt.trim().is_empty() {
        return (
            axum::http::StatusCode::BAD_REQUEST,
            "prompt must not be empty",
        )
            .into_response();
    }

    if req.n == 0 || req.n > 4 {
        return (
            axum::http::StatusCode::BAD_REQUEST,
            "n must be between 1 and 4",
        )
            .into_response();
    }

    let body = serde_json::json!({
        "model": "sensenova-u1.5-fast",
        "prompt": req.prompt,
        "n": req.n,
        "size": req.size,
        "output_format": req.output_format,
        "response_format": "url",
        "watermark": req.watermark,
    });

    let client = reqwest::Client::new();
    let response = client
        .post("https://token.sensenova.cn/v1/images/generations")
        .header("Authorization", format!("Bearer {api_key}"))
        .header("Content-Type", "application/json")
        .json(&body)
        .send()
        .await;

    match response {
        Ok(resp) => {
            let status = resp.status();
            if !status.is_success() {
                let text = resp.text().await.unwrap_or_default();
                return (
                    axum::http::StatusCode::from_u16(status.as_u16())
                        .unwrap_or(axum::http::StatusCode::BAD_GATEWAY),
                    format!("SenseNova API error: {text}"),
                )
                    .into_response();
            }

            let body: serde_json::Value = match resp.json().await {
                Ok(v) => v,
                Err(e) => {
                    return (
                        axum::http::StatusCode::BAD_GATEWAY,
                        format!("failed to parse SenseNova response: {e}"),
                    )
                        .into_response();
                }
            };

            let images = parse_sensenova_response(&body, &req.size, &req.output_format);

            if images.is_empty() {
                return (
                    axum::http::StatusCode::BAD_GATEWAY,
                    "SenseNova returned no images",
                )
                    .into_response();
            }

            (
                axum::http::StatusCode::OK,
                Json(ImageGenerationResult {
                    images,
                    model: "sensenova-u1.5-fast".to_string(),
                    provider: "sensenova".to_string(),
                }),
            )
                .into_response()
        }
        Err(e) => (
            axum::http::StatusCode::BAD_GATEWAY,
            format!("failed to reach SenseNova API: {e}"),
        )
            .into_response(),
    }
}

fn parse_sensenova_response(
    body: &serde_json::Value,
    size: &str,
    format: &str,
) -> Vec<GeneratedImage> {
    let mut images = Vec::new();

    // OpenAI-compatible format: { "data": [{ "url": "..." }, ...] }
    if let Some(data) = body.get("data").and_then(|d| d.as_array()) {
        for item in data {
            if let Some(url) = item.get("url").and_then(|u| u.as_str()) {
                images.push(GeneratedImage {
                    url: url.to_string(),
                    size: size.to_string(),
                    format: format.to_string(),
                });
            }
        }
    }

    images
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn scans_manifest_technology_and_source_roots() {
        let temp = tempfile::tempdir().unwrap();
        fs::write(
            temp.path().join("package.json"),
            r#"{"name":"demo-ui","dependencies":{"react":"1"},"devDependencies":{"typescript":"1","vite":"1"}}"#,
        )
        .unwrap();
        fs::write(
            temp.path().join("README.md"),
            "# Demo\n\nA design workspace.",
        )
        .unwrap();
        fs::create_dir(temp.path().join("src")).unwrap();

        let context = scan_project_context(Some(temp.path()));
        assert_eq!(context.project_name, "demo-ui");
        assert!(context.summary.contains("design workspace"));
        assert!(context.technologies.contains(&"React".to_string()));
        assert!(context.technologies.contains(&"TypeScript".to_string()));
        assert_eq!(context.source_roots, vec!["src"]);
    }

    #[tokio::test]
    async fn resources_reuse_existing_ai_design_examples() {
        let catalog = list_design_resources().await;
        assert!(catalog
            .0
            .templates
            .iter()
            .any(|item| item.id == "td-dashboard"));
        assert!(!catalog.0.visual_styles.is_empty());
        assert!(!catalog.0.baselines.is_empty());
    }

    #[tokio::test]
    async fn creates_and_lists_extraction_jobs() {
        let state = Arc::new(DaemonState::new().await);

        let req = CreateExtractionRequest {
            source_type: "url".to_string(),
            source_ref: "https://example.com/design".to_string(),
            confirmed: true,
            image_filename: None,
            image_content_type: None,
            image_size: None,
        };

        let response = create_extraction(State(state.clone()), Json(req)).await;
        let response = response.into_response();
        assert_eq!(response.status(), axum::http::StatusCode::CREATED);

        // 解析返回的 extraction job
        let body_bytes = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap();
        let job: ExtractionJob = serde_json::from_slice(&body_bytes).unwrap();
        assert_eq!(job.status, "queued");
        assert_eq!(job.source_type, "url");

        // 立即列表验证（此时后台任务可能还未完成）
        let list = list_extractions(State(state.clone())).await;
        assert_eq!(list.0.len(), 1);
        assert_eq!(list.0[0].id, job.id);

        // 等待后台模拟提取完成（1+2+1+1 = 5 秒）
        tokio::time::sleep(std::time::Duration::from_millis(5200)).await;

        // 验证最终状态
        let jobs = state.extraction_jobs.read().await;
        let final_job = jobs.get(&job.id).unwrap();
        assert_eq!(final_job.status, "succeeded");
        assert_eq!(final_job.progress, 1.0);
        assert!(final_job.result_id.is_some());
        assert!(final_job.result_sha256.is_some());
        assert!(final_job.result_size.is_some());
        assert!(final_job.result_expires_at.is_some());
        let manifest = final_job.manifest.as_ref().unwrap();
        assert_eq!(manifest["schemaVersion"], "od-design-system-project/v1");
        assert_eq!(manifest["category"], "Imported");
    }

    #[test]
    fn validate_extraction_url_rejects_private_addresses() {
        let rejected = [
            "http://localhost/api",
            "http://127.0.0.1/api",
            "http://[::1]/api",
            "http://0.0.0.0/api",
            "http://printer.local/api",
            "http://169.254.1.1/api",
            "http://10.0.0.1/api",
            "http://172.16.0.1/api",
            "http://172.31.255.255/api",
            "http://192.168.1.1/api",
            "file:///etc/passwd",
            "ftp://example.com/file",
        ];
        for url in rejected {
            assert!(
                validate_extraction_url(url).is_err(),
                "should reject: {url}"
            );
        }
    }

    #[test]
    fn validate_extraction_url_accepts_public_https() {
        let accepted = [
            "https://example.com/design",
            "https://fonts.googleapis.com/css2?family=Inter:wght@400&display=swap",
            "http://8.8.8.8/api",
        ];
        for url in accepted {
            let result = validate_extraction_url(url);
            assert!(result.is_ok(), "should accept: {url} ({result:?})");
        }
    }

    #[tokio::test]
    async fn creates_updates_and_plans_session() {
        let state = Arc::new(DaemonState::new().await);

        // 创建 session
        let req = CreateSessionRequest {
            workspace: None,
            goal: "page".to_string(),
            request: "为仪表盘页面设计首页".to_string(),
            backend_id: None,
        };
        let response = create_session(State(state.clone()), Json(req)).await;
        let response = response.into_response();
        assert_eq!(response.status(), axum::http::StatusCode::CREATED);

        let body_bytes = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap();
        let session: DesignSession = serde_json::from_slice(&body_bytes).unwrap();
        assert_eq!(session.status, "draft");
        assert_eq!(session.goal, "page");

        // 更新 session：设置 outputs / notes
        let update_req = UpdateSessionRequest {
            goal: None,
            request: None,
            notes: Some("需要支持深色模式".to_string()),
            primary_template_id: Some(Some("td-dashboard".to_string())),
            visual_style_id: Some(Some("clean-tech".to_string())),
            design_system_id: Some(None),
            baseline_ids: Some(vec!["accessible-ui".to_string()]),
            outputs: Some(vec![
                "brief".to_string(),
                "design".to_string(),
                "code".to_string(),
            ]),
            backend_id: None,
            mode: None,
            target_path: Some("src/app".to_string()),
        };
        let response = update_session(
            State(state.clone()),
            AxumPath(session.id.clone()),
            Json(update_req),
        )
        .await;
        let response = response.into_response();
        assert_eq!(response.status(), axum::http::StatusCode::OK);
        let body_bytes = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap();
        let updated: DesignSession = serde_json::from_slice(&body_bytes).unwrap();
        assert_eq!(updated.notes, "需要支持深色模式");
        assert_eq!(
            updated.primary_template_id,
            Some("td-dashboard".to_string())
        );
        assert_eq!(updated.visual_style_id, Some("clean-tech".to_string()));
        assert_eq!(updated.design_system_id, None);
        assert_eq!(updated.baseline_ids, vec!["accessible-ui".to_string()]);
        assert_eq!(
            updated.outputs,
            vec![
                "brief".to_string(),
                "design".to_string(),
                "code".to_string()
            ]
        );
        assert_eq!(updated.target_path, "src/app");

        // plan
        let response = plan_session(State(state.clone()), AxumPath(session.id.clone())).await;
        let response = response.into_response();
        assert_eq!(response.status(), axum::http::StatusCode::OK);
        let body_bytes = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap();
        let planned: DesignSession = serde_json::from_slice(&body_bytes).unwrap();
        assert_eq!(planned.status, "planned");

        let plan = planned.plan.expect("plan should be set after plan_session");
        // 阶段必须包含 context 和 verify（required）
        let stage_ids: Vec<&str> = plan.stages.iter().map(|s| s.id.as_str()).collect();
        assert_eq!(stage_ids[0], "context");
        assert_eq!(stage_ids.last().copied(), Some("verify"));
        // brief/design/code 都应出现
        assert!(stage_ids.contains(&"brief"));
        assert!(stage_ids.contains(&"design"));
        assert!(stage_ids.contains(&"code"));
        // context 和 verify 应是 required
        let context_stage = plan.stages.iter().find(|s| s.id == "context").unwrap();
        assert!(context_stage.required);
        let verify_stage = plan.stages.iter().find(|s| s.id == "verify").unwrap();
        assert!(verify_stage.required);
        // models 数量 == stages 数量
        assert_eq!(plan.models.len(), plan.stages.len());
        // estimated_outputs 复制自 session.outputs
        assert_eq!(plan.estimated_outputs, planned.outputs);
        // target_files 非空
        assert!(!plan.target_files.is_empty());
        // prompt_snapshot 与 context_hash 已填充
        assert!(planned.prompt_snapshot.is_some());
        assert!(planned.context_hash.is_some());
        assert!(planned
            .context_hash
            .as_ref()
            .unwrap()
            .starts_with("sha256:"));
    }

    #[tokio::test]
    async fn list_sessions_returns_descending() {
        let state = Arc::new(DaemonState::new().await);

        let req1 = CreateSessionRequest {
            workspace: None,
            goal: "page".to_string(),
            request: "first".to_string(),
            backend_id: None,
        };
        let r1 = create_session(State(state.clone()), Json(req1))
            .await
            .into_response();
        let body1 = axum::body::to_bytes(r1.into_body(), usize::MAX)
            .await
            .unwrap();
        let s1: DesignSession = serde_json::from_slice(&body1).unwrap();

        // 让 updated_at 有差异
        tokio::time::sleep(std::time::Duration::from_millis(1100)).await;

        let req2 = CreateSessionRequest {
            workspace: None,
            goal: "dashboard".to_string(),
            request: "second".to_string(),
            backend_id: None,
        };
        let r2 = create_session(State(state.clone()), Json(req2))
            .await
            .into_response();
        let body2 = axum::body::to_bytes(r2.into_body(), usize::MAX)
            .await
            .unwrap();
        let s2: DesignSession = serde_json::from_slice(&body2).unwrap();

        let list = list_sessions(State(state.clone())).await;
        assert_eq!(list.0.len(), 2);
        // 降序：s2 在前
        assert_eq!(list.0[0].id, s2.id);
        assert_eq!(list.0[1].id, s1.id);
        assert!(list.0[0].updated_at >= list.0[1].updated_at);
    }

    #[tokio::test]
    async fn download_design_system_returns_package() {
        let state = Arc::new(DaemonState::new().await);

        // 创建提取任务并等待完成
        let req = CreateExtractionRequest {
            source_type: "url".to_string(),
            source_ref: "https://example.com/design".to_string(),
            confirmed: true,
            image_filename: None,
            image_content_type: None,
            image_size: None,
        };
        let r = create_extraction(State(state.clone()), Json(req))
            .await
            .into_response();
        let body = axum::body::to_bytes(r.into_body(), usize::MAX)
            .await
            .unwrap();
        let job: ExtractionJob = serde_json::from_slice(&body).unwrap();

        tokio::time::sleep(std::time::Duration::from_millis(5200)).await;

        let jobs = state.extraction_jobs.read().await;
        let final_job = jobs.get(&job.id).unwrap();
        assert_eq!(final_job.status, "succeeded");
        let result_id = final_job.result_id.clone().unwrap();
        drop(jobs);

        // 下载包
        let response = download_design_system(State(state.clone()), AxumPath(result_id.clone()))
            .await
            .into_response();
        assert_eq!(response.status(), axum::http::StatusCode::OK);
        let content_type = response
            .headers()
            .get(axum::http::header::CONTENT_TYPE)
            .map(|v| v.to_str().unwrap_or(""))
            .unwrap_or("");
        assert_eq!(content_type, "application/zip");
        let pkg_format = response
            .headers()
            .get("x-package-format")
            .map(|v| v.to_str().unwrap_or(""))
            .unwrap_or("");
        assert_eq!(pkg_format, "zip");

        let body = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap();
        // 验证 ZIP 签名（PK\x03\x04）
        assert_eq!(&body[..2], b"PK");
        // 验证包含文件名内容（store 模式，文件名和内容都在原始字节中可找到）
        let body_str = String::from_utf8_lossy(&body);
        assert!(body_str.contains("DESIGN.md"));
        assert!(body_str.contains("tokens.css"));
        assert!(body_str.contains("manifest.json"));
        assert!(body_str.contains("\"format\": \"zip\""));
    }

    #[tokio::test]
    async fn import_design_system_succeeds() {
        let state = Arc::new(DaemonState::new().await);

        let req = CreateExtractionRequest {
            source_type: "url".to_string(),
            source_ref: "https://example.com/design".to_string(),
            confirmed: true,
            image_filename: None,
            image_content_type: None,
            image_size: None,
        };
        let r = create_extraction(State(state.clone()), Json(req))
            .await
            .into_response();
        let body = axum::body::to_bytes(r.into_body(), usize::MAX)
            .await
            .unwrap();
        let job: ExtractionJob = serde_json::from_slice(&body).unwrap();

        tokio::time::sleep(std::time::Duration::from_millis(5200)).await;

        let jobs = state.extraction_jobs.read().await;
        let final_job = jobs.get(&job.id).unwrap();
        assert_eq!(final_job.status, "succeeded");
        let result_id = final_job.result_id.clone().unwrap();
        drop(jobs);

        let response = import_design_system(State(state.clone()), AxumPath(result_id.clone()))
            .await
            .into_response();
        assert_eq!(response.status(), axum::http::StatusCode::OK);
        let body = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap();
        let result: serde_json::Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(result["imported"], true);
        assert_eq!(result["id"], result_id);
        assert_eq!(
            result["project_path"],
            format!(".sacode/design-systems/{result_id}/")
        );
    }

    #[tokio::test]
    async fn creates_image_extraction_from_base64() {
        let state = Arc::new(DaemonState::new().await);

        // 生成 200 字节的假图片数据
        let fake_image = vec![0u8; 200];
        let b64 = base64::engine::general_purpose::STANDARD.encode(&fake_image);

        let req = CreateExtractionRequest {
            source_type: "image".to_string(),
            source_ref: format!("data:image/png;base64,{b64}"),
            confirmed: true,
            image_filename: Some("screenshot.png".to_string()),
            image_content_type: Some("image/png".to_string()),
            image_size: Some(200),
        };
        let r = create_extraction(State(state.clone()), Json(req))
            .await
            .into_response();
        assert_eq!(r.status(), axum::http::StatusCode::CREATED);
        let body = axum::body::to_bytes(r.into_body(), usize::MAX)
            .await
            .unwrap();
        let job: ExtractionJob = serde_json::from_slice(&body).unwrap();
        assert_eq!(job.source_type, "image");
        assert!(job.source_ref.starts_with("image:screenshot.png:"));

        // 等待模拟完成
        tokio::time::sleep(std::time::Duration::from_millis(5200)).await;
        let jobs = state.extraction_jobs.read().await;
        let final_job = jobs.get(&job.id).unwrap();
        assert_eq!(final_job.status, "succeeded");
        let manifest = final_job.manifest.as_ref().unwrap();
        assert_eq!(manifest["source"]["type"], "image");
        assert_eq!(manifest["source"]["mode"], "vision-analysis");
    }

    #[tokio::test]
    async fn rejects_oversized_image() {
        let state = Arc::new(DaemonState::new().await);

        // 生成 11MB 数据
        let big_image = vec![0u8; 11 * 1024 * 1024];
        let b64 = base64::engine::general_purpose::STANDARD.encode(&big_image);

        let req = CreateExtractionRequest {
            source_type: "image".to_string(),
            source_ref: format!("data:image/png;base64,{b64}"),
            confirmed: true,
            image_filename: Some("big.png".to_string()),
            image_content_type: Some("image/png".to_string()),
            image_size: Some(11 * 1024 * 1024),
        };
        let r = create_extraction(State(state), Json(req))
            .await
            .into_response();
        assert_eq!(r.status(), axum::http::StatusCode::PAYLOAD_TOO_LARGE);
    }

    #[test]
    fn parse_sensenova_response_extracts_image_urls() {
        let body = serde_json::json!({
            "data": [
                { "url": "https://cdn.example.com/img1.png" },
                { "url": "https://cdn.example.com/img2.png" },
            ]
        });
        let images = parse_sensenova_response(&body, "1024x1024", "png");
        assert_eq!(images.len(), 2);
        assert_eq!(images[0].url, "https://cdn.example.com/img1.png");
        assert_eq!(images[0].size, "1024x1024");
        assert_eq!(images[0].format, "png");
    }

    #[test]
    fn parse_sensenova_response_handles_empty_data() {
        let body = serde_json::json!({ "data": [] });
        let images = parse_sensenova_response(&body, "1024x1024", "png");
        assert!(images.is_empty());
    }

    #[test]
    fn parse_sensenova_response_skips_missing_url() {
        let body = serde_json::json!({
            "data": [
                { "url": "https://cdn.example.com/img1.png" },
                { "b64_json": "iVBOR..." },
            ]
        });
        let images = parse_sensenova_response(&body, "1024x1024", "png");
        assert_eq!(images.len(), 1);
    }
}
