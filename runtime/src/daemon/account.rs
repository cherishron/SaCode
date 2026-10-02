use std::{
    sync::{Arc, Mutex, OnceLock},
    time::Duration,
};

use axum::{extract::State, http::StatusCode, Json};
use serde::Deserialize;
use serde_json::{json, Value};
use url::Url;

use super::DaemonState;
use crate::identity::config::validate_base_url;
use crate::identity::{self, IdentityConfig, LoginOptions};
use crate::identity::entitlement_client::EntitlementHttp;

fn login_state() -> &'static Mutex<Option<String>> {
    static STATE: OnceLock<Mutex<Option<String>>> = OnceLock::new();
    STATE.get_or_init(|| Mutex::new(None))
}

fn config() -> anyhow::Result<IdentityConfig> {
    let mut cfg = IdentityConfig::load(None)?;
    cfg.fill_local_defaults_if_empty();
    cfg.normalize();
    Ok(cfg)
}

fn current_session_config() -> anyhow::Result<IdentityConfig> {
    let mut cfg = config()?;
    if let Some(session) = identity::IdentitySession::load(None)? {
        if !session.idp_base_url.is_empty() {
            cfg.idp_base_url = session.idp_base_url;
        }
        if !session.gateway_base_url.is_empty() {
            cfg.gateway_base_url = session.gateway_base_url;
        }
        if !session.client_id.is_empty() {
            cfg.client_id = session.client_id;
        }
        if !session.provider_name.is_empty() {
            cfg.provider_name = session.provider_name;
        }
    }
    Ok(cfg)
}

fn valid_remote_url(value: &str) -> bool {
    Url::parse(value).ok().is_some_and(|url| {
        (url.scheme() == "https" || url.scheme() == "http")
            && url.host_str().is_some()
            && url.username().is_empty()
            && url.password().is_none()
            && url.fragment().is_none()
            && url.query().is_none()
    })
}

fn error(status: StatusCode, message: &str) -> (StatusCode, Json<Value>) {
    (status, Json(json!({ "error": message })))
}

// ---------------------------------------------------------------------------
// Local Mode（docs/plans/local-mode-plan.md P1/P2/P5/P7）
//
// 硬原则：登录永非门槛；三件套（sa-idp / gateway / entitlement）可整体缺席。
// ---------------------------------------------------------------------------

/// 账号页模式（A2/B1）。本地为默认，云增强是可选增强。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CloudMode {
    /// 纯本地：未登录，或云不可达但用户也没显式配置云地址（三件套全停不刷屏）。
    Local,
    /// 已登录且云探测可达。
    Online,
    /// 已登录、或显式配置了云地址，但探测失败 —— 云增强不可用，本地功能不减。
    CloudDegraded,
}

impl CloudMode {
    pub fn as_str(self) -> &'static str {
        match self {
            CloudMode::Local => "local",
            CloudMode::Online => "online",
            CloudMode::CloudDegraded => "cloud_degraded",
        }
    }
}

/// B1 模式推断（探测失败不抛，超时当不可用）：
/// - 已登录 + 云可达 → `online`
/// - 已登录但探测失败 → `cloud_degraded`
/// - 未登录但显式配置了云地址且探测失败 → `cloud_degraded`
/// - 其余（含未登录、三件套全停、纯本地缺省）→ `local`
pub fn infer_cloud_mode(
    logged_in: bool,
    cloud_configured: bool,
    cloud_available: bool,
) -> CloudMode {
    if logged_in {
        if cloud_available {
            CloudMode::Online
        } else {
            CloudMode::CloudDegraded
        }
    } else if cloud_configured && !cloud_available {
        CloudMode::CloudDegraded
    } else {
        CloudMode::Local
    }
}

/// 用户是否显式配置了云地址（落盘 config 或 env 覆盖）。
/// `fill_local_defaults_if_empty` 的 localhost 缺省不算「显式配置」——
/// Local Mode 缺省即 local，三件套全停不得被判成 cloud_degraded。
fn cloud_explicitly_configured(stored: &IdentityConfig, with_env: &IdentityConfig) -> bool {
    let filled = |s: &str| !s.trim().is_empty();
    filled(&stored.idp_base_url)
        || filled(&stored.gateway_base_url)
        || filled(&stored.entitlement_base_url)
        || with_env.idp_base_url != stored.idp_base_url
        || with_env.gateway_base_url != stored.gateway_base_url
        || with_env.entitlement_base_url != stored.entitlement_base_url
}

/// 云探测单 URL 超时预算（B1 建议 ≤500ms）。超时/拒绝/任何传输失败都当作不可用。
const CLOUD_PROBE_TIMEOUT: Duration = Duration::from_millis(400);

fn probe_client() -> Option<reqwest::Client> {
    reqwest::Client::builder()
        .timeout(CLOUD_PROBE_TIMEOUT)
        .connect_timeout(CLOUD_PROBE_TIMEOUT)
        .build()
        .ok()
}

/// 短超时探测单个 base URL 是否可达：任意 HTTP 响应（含 4xx/5xx）都算可达。
/// 失败不抛，一律折叠为 `false`。
async fn probe_url_reachable_with(client: &reqwest::Client, url: &str) -> bool {
    let url = url.trim();
    if url.is_empty() {
        return false;
    }
    client.get(url).send().await.is_ok()
}

async fn probe_url_reachable(url: &str) -> bool {
    let Some(client) = probe_client() else {
        return false;
    };
    probe_url_reachable_with(&client, url).await
}

/// 并行探测云增强地址（idp/gateway/entitlement）是否任一可达。
/// 整体受单 URL 超时约束（≤400ms）；失败不抛。
pub async fn probe_cloud_available(urls: &[&str]) -> bool {
    let Some(client) = probe_client() else {
        return false;
    };
    let probes: Vec<_> = urls
        .iter()
        .map(|url| probe_url_reachable_with(&client, url))
        .collect();
    if probes.is_empty() {
        return false;
    }
    futures::future::join_all(probes).await.into_iter().any(|ok| ok)
}

/// 组装 GET /account/status 响应体。
/// B1：`mode` / `cloud_available` 为纯增量字段，旧字段不删（向后兼容）。
fn build_status_body(
    summary: &identity::SessionStatus,
    login_state: Option<String>,
    mode: CloudMode,
    cloud_available: bool,
) -> Value {
    json!({
        "account": json!({
            "logged_in": summary.logged_in,
            "subject": summary.subject,
            "provider_name": summary.provider_name,
            "models_count": summary.models_count,
            "default_model": summary.default_model,
            "gateway_base_url": summary.gateway_base_url,
            "logged_in_at": summary.logged_in_at,
        }),
        "login_state": login_state,
        "mode": mode.as_str(),
        "cloud_available": cloud_available,
    })
}

/// B2：云增强不可用的结构化错误（三件套未启动/不可达）。
/// UI 以 `code` 识别，不返回 5xx 堆栈。
fn cloud_unavailable_error(message: &str) -> (StatusCode, Json<Value>) {
    (
        StatusCode::SERVICE_UNAVAILABLE,
        Json(json!({
            "error": message,
            "code": "cloud_unavailable",
            "mode": "cloud_degraded",
            "cloud_available": false,
        })),
    )
}

/// 云增强需要权益授权。保留 `needs_entitlement_auth` 兼容旧 UI，新增 `code`。
fn needs_entitlement_auth_error(message: &str) -> (StatusCode, Json<Value>) {
    (
        StatusCode::UNAUTHORIZED,
        Json(json!({
            "error": message,
            "code": "needs_entitlement_auth",
            "needs_entitlement_auth": true,
        })),
    )
}

pub async fn status() -> (StatusCode, Json<Value>) {
    match identity::status_summary(None) {
        Ok(summary) => {
            // 显式配置判定必须在 fill_local_defaults 之前（缺省 localhost 不算配置）。
            let (cloud_configured, probe_urls) =
                match (IdentityConfig::load_stored(None), IdentityConfig::load(None)) {
                    (Ok(stored), Ok(with_env)) => {
                        let configured = cloud_explicitly_configured(&stored, &with_env);
                        let mut effective = with_env;
                        effective.fill_local_defaults_if_empty();
                        effective.normalize();
                        (
                            configured,
                            vec![
                                effective.idp_base_url,
                                effective.gateway_base_url,
                                effective.entitlement_base_url,
                            ],
                        )
                    }
                    _ => (false, Vec::new()),
                };
            // 纯本地短路：未登录且未配置云 → 不发探测、cloud_available=false、mode=local。
            let cloud_available = if summary.logged_in || cloud_configured {
                let refs: Vec<&str> = probe_urls.iter().map(String::as_str).collect();
                probe_cloud_available(&refs).await
            } else {
                false
            };
            let mode = infer_cloud_mode(summary.logged_in, cloud_configured, cloud_available);
            let body = build_status_body(
                &summary,
                login_state().lock().unwrap().clone(),
                mode,
                cloud_available,
            );
            (StatusCode::OK, Json(body))
        }
        Err(_) => error(StatusCode::INTERNAL_SERVER_ERROR, "账号状态不可用"),
    }
}

fn non_sensitive_view(cfg: &IdentityConfig) -> Value {
    json!({
        "idp_base_url": cfg.idp_base_url,
        "gateway_base_url": cfg.gateway_base_url,
        "entitlement_base_url": cfg.entitlement_base_url,
        "client_id": cfg.client_id,
        "provider_name": cfg.provider_name,
    })
}

/// 组装 GET/PUT /account/config 的公共视图：
/// - `stored`：仅落盘值（load_stored，不应用 env 覆盖）
/// - `effective`：生效值（load + fill_local_defaults + normalize）
/// - `env_overrides`：对比 load_stored 与 load 判断各字段是否被 env 覆盖
///
/// 绝不返回 token / secret / session 内容。
fn config_view() -> anyhow::Result<Value> {
    let stored = IdentityConfig::load_stored(None)?;
    let with_env = IdentityConfig::load(None)?;
    let mut effective = with_env.clone();
    effective.fill_local_defaults_if_empty();
    effective.normalize();
    Ok(json!({
        "stored": non_sensitive_view(&stored),
        "effective": non_sensitive_view(&effective),
        "env_overrides": {
            "idp_base_url": with_env.idp_base_url != stored.idp_base_url,
            "gateway_base_url": with_env.gateway_base_url != stored.gateway_base_url,
            "entitlement_base_url": with_env.entitlement_base_url != stored.entitlement_base_url,
        },
    }))
}

/// GET /account/config — IdP / 网关 / 权益服务配置（受 daemon token 保护）。
pub async fn get_config() -> (StatusCode, Json<Value>) {
    match config_view() {
        Ok(view) => (StatusCode::OK, Json(view)),
        Err(e) => {
            tracing::warn!(error = %e, "load account config failed");
            error(StatusCode::INTERNAL_SERVER_ERROR, "身份配置不可用")
        }
    }
}

#[derive(Deserialize)]
pub struct UpdateConfigRequest {
    idp_base_url: Option<String>,
    gateway_base_url: Option<String>,
    entitlement_base_url: Option<String>,
    provider_name: Option<String>,
}

/// PUT /account/config — 更新 IdP / 网关 / 权益服务配置。
///
/// 登录进行中返回 409；字段校验失败返回 400（含具体中文原因）；
/// 基于 load_stored 修改（不固化 env 覆盖），normalize 后落盘。
pub async fn update_config(Json(req): Json<UpdateConfigRequest>) -> (StatusCode, Json<Value>) {
    if matches!(
        login_state().lock().unwrap().as_deref(),
        Some("pending") | Some("pending_entitlement")
    ) {
        return error(StatusCode::CONFLICT, "登录进行中，请稍候再修改配置");
    }
    let mut cfg = match IdentityConfig::load_stored(None) {
        Ok(cfg) => cfg,
        Err(e) => {
            tracing::warn!(error = %e, "load stored identity config failed");
            return error(StatusCode::INTERNAL_SERVER_ERROR, "身份配置不可用");
        }
    };
    if let Some(value) = req.idp_base_url.as_deref() {
        match validate_base_url(value) {
            Ok(normalized) => cfg.idp_base_url = normalized,
            Err(e) => {
                return error(StatusCode::BAD_REQUEST, &format!("idp_base_url 无效：{e:#}"))
            }
        }
    }
    if let Some(value) = req.gateway_base_url.as_deref() {
        match validate_base_url(value) {
            Ok(normalized) => cfg.gateway_base_url = normalized,
            Err(e) => {
                return error(
                    StatusCode::BAD_REQUEST,
                    &format!("gateway_base_url 无效：{e:#}"),
                )
            }
        }
    }
    if let Some(value) = req.entitlement_base_url.as_deref() {
        match validate_base_url(value) {
            Ok(normalized) => cfg.entitlement_base_url = normalized,
            Err(e) => {
                return error(
                    StatusCode::BAD_REQUEST,
                    &format!("entitlement_base_url 无效：{e:#}"),
                )
            }
        }
    }
    if let Some(value) = req.provider_name.as_deref() {
        let value = value.trim();
        if value.is_empty() {
            return error(StatusCode::BAD_REQUEST, "provider_name 不能为空");
        }
        if value.chars().count() > 64 {
            return error(StatusCode::BAD_REQUEST, "provider_name 过长（最多 64 字符）");
        }
        if value.chars().any(char::is_control) {
            return error(StatusCode::BAD_REQUEST, "provider_name 不能包含控制字符");
        }
        cfg.provider_name = value.to_string();
    }
    cfg.normalize();
    if let Err(e) = cfg.save(None) {
        tracing::warn!(error = %e, "save identity config failed");
        return error(StatusCode::INTERNAL_SERVER_ERROR, "身份配置保存失败");
    }
    match config_view() {
        Ok(mut view) => {
            if let Some(obj) = view.as_object_mut() {
                obj.insert("ok".into(), json!(true));
            }
            (StatusCode::OK, Json(view))
        }
        Err(e) => {
            tracing::warn!(error = %e, "reload account config failed");
            error(StatusCode::INTERNAL_SERVER_ERROR, "身份配置不可用")
        }
    }
}

pub async fn login(State(state): State<Arc<DaemonState>>) -> (StatusCode, Json<Value>) {
    let cfg = match config() {
        Ok(cfg) => cfg,
        Err(_) => return error(StatusCode::INTERNAL_SERVER_ERROR, "登录配置不可用"),
    };
    // B2：IdP 未启动时短路为结构化错误，不发起注定失败的 300s PKCE 等待。
    if !probe_url_reachable(&cfg.idp_base_url).await {
        return cloud_unavailable_error("云增强不可用：身份服务（sa-idp）未启动或不可达");
    }
    {
        let mut current = login_state().lock().unwrap();
        if current.as_deref() == Some("pending") {
            return error(StatusCode::CONFLICT, "登录正在进行中");
        }
        *current = Some("pending".into());
    }
    let workdir = state
        .workdir
        .clone()
        .unwrap_or_else(|| std::path::PathBuf::from("."));
    tokio::task::spawn_blocking(move || {
        let result = tokio::runtime::Handle::current().block_on(async {
            let opts = LoginOptions {
                workdir,
                open_browser: true,
                callback_timeout: Duration::from_secs(300),
                ..Default::default()
            };
            let store = identity::select_secret_store(false, None);
            identity::login(cfg, opts, store.as_ref()).await
        });
        let succeeded = result
            .as_ref()
            .is_ok_and(|outcome| outcome.models_error.is_none());
        *login_state().lock().unwrap() =
            Some(if succeeded { "completed" } else { "failed" }.into());
        match result {
            Ok(outcome) if outcome.models_error.is_some() => {
                tracing::warn!("account login completed but models unavailable");
            }
            Err(_) => tracing::warn!("account login failed"),
            _ => {}
        }
    });
    (StatusCode::ACCEPTED, Json(json!({ "status": "pending" })))
}

pub async fn logout() -> (StatusCode, Json<Value>) {
    if login_state().lock().unwrap().as_deref() == Some("pending") {
        return error(StatusCode::CONFLICT, "请等待登录完成后再退出");
    }
    let store = identity::select_secret_store(false, None);
    identity::clear_entitlement_tokens(store.as_ref(), None);
    match identity::logout(None, store.as_ref(), false, None) {
        Ok(()) => {
            *login_state().lock().unwrap() = None;
            (StatusCode::OK, Json(json!({ "status": "logged_out" })))
        }
        Err(_) => error(StatusCode::INTERNAL_SERVER_ERROR, "退出登录失败"),
    }
}

pub async fn sync_models(State(state): State<Arc<DaemonState>>) -> (StatusCode, Json<Value>) {
    let cfg = match current_session_config() {
        Ok(cfg) => cfg,
        Err(_) => return error(StatusCode::INTERNAL_SERVER_ERROR, "模型同步配置不可用"),
    };
    // B2：网关未启动 → 结构化「云增强不可用」，而非 5xx。
    if !probe_url_reachable(&cfg.gateway_base_url).await {
        return cloud_unavailable_error("云增强不可用：网关未启动或不可达");
    }
    let workdir = state
        .workdir
        .as_deref()
        .unwrap_or_else(|| std::path::Path::new("."));
    let store = identity::select_secret_store(false, None);
    match identity::sync_models(&cfg, None, workdir, store.as_ref(), None).await {
        Ok(models) => (StatusCode::OK, Json(json!({ "models": models }))),
        Err(_) => {
            tracing::warn!("sync models failed");
            cloud_unavailable_error("模型同步失败，请检查网关连接和账号授权")
        }
    }
}

#[derive(Deserialize)]
pub struct ConnectionRequest {
    name: String,
    base_url: String,
    upstream_api_key: String,
    models: Vec<ConnectionModel>,
}

#[derive(Deserialize)]
pub struct ConnectionModel {
    client_model: String,
    upstream_model: String,
}

pub async fn register_connection(Json(req): Json<ConnectionRequest>) -> (StatusCode, Json<Value>) {
    if req.name.trim().is_empty()
        || req.name.len() > 64
        || req.name.chars().any(char::is_control)
        || !valid_remote_url(&req.base_url)
        || req.upstream_api_key.trim().is_empty()
        || req.models.is_empty()
        || req.models.len() > 50
        || req.models.iter().any(|m| {
            m.client_model.trim().is_empty()
                || m.client_model.len() > 128
                || m.client_model.contains('/')
                || m.upstream_model.len() > 128
                || m.upstream_model.trim().is_empty()
        })
    {
        return error(StatusCode::BAD_REQUEST, "请填写名称、URL、API Key 和模型");
    }
    let cfg = match current_session_config() {
        Ok(cfg) => cfg,
        Err(_) => return error(StatusCode::INTERNAL_SERVER_ERROR, "网关配置不可用"),
    };
    // B2：网关未启动 → 结构化「云增强不可用」。
    if !probe_url_reachable(&cfg.gateway_base_url).await {
        return cloud_unavailable_error("云增强不可用：网关未启动或不可达");
    }
    let store = identity::select_secret_store(false, None);
    let models = req
        .models
        .into_iter()
        .map(|m| (m.client_model, m.upstream_model))
        .collect::<Vec<_>>();
    match identity::register_model_connection(
        &cfg,
        None,
        store.as_ref(),
        &req.name,
        &req.base_url,
        &req.upstream_api_key,
        &models,
    )
    .await
    {
        Ok(result) if result.ok => (
            StatusCode::OK,
            Json(json!({ "ok": true, "provider_id": result.provider_id })),
        ),
        Ok(_) => error(
            StatusCode::BAD_GATEWAY,
            "网关未接受该模型连接，请检查模型配置",
        ),
        Err(_) => {
            tracing::warn!("register gateway connection failed");
            cloud_unavailable_error("网关注册失败，请检查账号、网关及上游模型设置")
        }
    }
}

/// GET /account/entitlements — 本人权益（sa-entitlement `/v1/entitlements/me`）。
///
/// B2：三件套未启动时返回结构化 `cloud_unavailable`，而非 5xx 堆栈。
pub async fn entitlements(
    axum::extract::Query(q): axum::extract::Query<std::collections::HashMap<String, String>>,
) -> (StatusCode, Json<Value>) {
    let cfg = match current_session_config() {
        Ok(cfg) => cfg,
        Err(_) => return error(StatusCode::INTERNAL_SERVER_ERROR, "权益配置不可用"),
    };
    if !probe_url_reachable(&cfg.entitlement_base_url).await {
        return cloud_unavailable_error("云增强不可用：权益服务未启动或不可达");
    }
    let store = identity::select_secret_store(false, None);
    let access = match identity::ensure_entitlement_access_token(&cfg, store.as_ref(), None, 120)
        .await
    {
        Ok(t) => t,
        Err(e) => {
            tracing::warn!(error = %e, "entitlement token unavailable");
            return needs_entitlement_auth_error("需要权益授权");
        }
    };
    let product = q.get("product").map(|s| s.as_str());
    let http = identity::ReqwestEntitlementHttp::new();
    match http
        .list_my_entitlements(&cfg.entitlement_me_url(), &access, product)
        .await
    {
        Ok(resp) => (
            StatusCode::OK,
            Json(json!({
                "items": resp.items,
                "entitlement_base_url": cfg.entitlement_base_url,
            })),
        ),
        Err(e) => {
            tracing::warn!(error = %e, "entitlements/me failed");
            cloud_unavailable_error("权益服务不可用，请稍后重试或检查 sa-entitlement")
        }
    }
}

/// POST /account/entitlement-login — 为 sacode-ent 再走一次 PKCE（IdP 会话存在时通常无感）。
///
/// B2：IdP 未启动时返回结构化 `cloud_unavailable`，不发起注定失败的交互登录。
pub async fn entitlement_login(State(state): State<Arc<DaemonState>>) -> (StatusCode, Json<Value>) {
    let cfg = match config() {
        Ok(cfg) => cfg,
        Err(_) => return error(StatusCode::INTERNAL_SERVER_ERROR, "权益登录配置不可用"),
    };
    if !probe_url_reachable(&cfg.idp_base_url).await {
        return cloud_unavailable_error("云增强不可用：身份服务（sa-idp）未启动或不可达");
    }
    {
        let mut current = login_state().lock().unwrap();
        if current.as_deref() == Some("pending") {
            return error(StatusCode::CONFLICT, "登录正在进行中");
        }
        *current = Some("pending_entitlement".into());
    }
    let _ = state; // keep state signature aligned with other handlers
    tokio::task::spawn_blocking(move || {
        let result = tokio::runtime::Handle::current().block_on(async {
            let store = identity::select_secret_store(false, None);
            identity::login_entitlement_interactive(
                &cfg,
                store.as_ref(),
                None,
                true,
                Duration::from_secs(300),
            )
            .await
        });
        *login_state().lock().unwrap() =
            Some(if result.is_ok() { "completed" } else { "failed" }.into());
        if result.is_err() {
            tracing::warn!("entitlement login failed");
        }
    });
    (StatusCode::ACCEPTED, Json(json!({ "status": "pending" })))
}

fn license_path() -> std::path::PathBuf {
    identity::config::home_dir_fallback()
        .join(".sacode")
        .join("identity")
        .join("license.json")
}

/// GET /account/license — 本地 License 状态（结构解析 + 可选验签）。
pub async fn license_status() -> (StatusCode, Json<Value>) {
    let path = license_path();
    if !path.exists() {
        return (
            StatusCode::OK,
            Json(json!({ "present": false, "status": "missing" })),
        );
    }
    let raw = match std::fs::read_to_string(&path) {
        Ok(r) => r,
        Err(_) => return error(StatusCode::INTERNAL_SERVER_ERROR, "License 文件不可读"),
    };
    match identity::parse_license(&raw) {
        Ok(lic) => (
            StatusCode::OK,
            Json(json!({
                "present": true,
                "status": "parsed",
                "kid": lic.kid,
                "product": lic.claims.product,
                "capabilities": lic.claims.capabilities,
                "expires_at": lic.claims.expires_at,
                "license_id": lic.claims.license_id,
            })),
        ),
        Err(e) => (
            StatusCode::OK,
            Json(json!({ "present": true, "status": "invalid", "error": e.to_string() })),
        ),
    }
}

/// POST /account/license — 导入 License 文本（只落盘，不签发）。
pub async fn license_import(Json(body): Json<Value>) -> (StatusCode, Json<Value>) {
    let raw = body
        .get("license")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();
    if raw.trim().is_empty() {
        return error(StatusCode::BAD_REQUEST, "缺少 license 内容");
    }
    let lic = match identity::parse_license(&raw) {
        Ok(l) => l,
        Err(e) => {
            return (
                StatusCode::BAD_REQUEST,
                Json(json!({ "error": format!("License 无效：{e}") })),
            )
        }
    };
    let path = license_path();
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    if let Err(e) = std::fs::write(&path, &raw) {
        return error(
            StatusCode::INTERNAL_SERVER_ERROR,
            &format!("License 保存失败：{e}"),
        );
    }
    (
        StatusCode::OK,
        Json(json!({
            "ok": true,
            "kid": lic.kid,
            "product": lic.claims.product,
            "capabilities": lic.claims.capabilities,
            "expires_at": lic.claims.expires_at,
        })),
    )
}

/// POST /account/activation-request — 生成设备激活请求 v1。
pub async fn activation_request(Json(body): Json<Value>) -> (StatusCode, Json<Value>) {
    let device_name = body
        .get("device_name")
        .and_then(Value::as_str)
        .map(|s| s.to_string());
    let product = body
        .get("product")
        .and_then(Value::as_str)
        .unwrap_or(identity::PRODUCT_SACODE)
        .to_string();
    let platform = body
        .get("platform")
        .and_then(Value::as_str)
        .unwrap_or({
            if cfg!(target_os = "windows") {
                "windows"
            } else if cfg!(target_os = "macos") {
                "macos"
            } else {
                "linux"
            }
        })
        .to_string();
    let store = identity::select_secret_store(false, None);
    let client = identity::ClientInfo {
        name: "SaCode Desktop".into(),
        version: env!("CARGO_PKG_VERSION").to_string(),
        platform,
    };
    match identity::build_activation_request(
        store.as_ref(),
        &product,
        device_name.as_deref(),
        client,
        chrono::Utc::now(),
    ) {
        Ok(req) => match identity::activation_request_json(&req) {
            Ok(json_str) => (
                StatusCode::OK,
                Json(json!({
                    "ok": true,
                    "request": serde_json::from_str::<Value>(&json_str).unwrap_or(Value::Null),
                })),
            ),
            Err(e) => error(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()),
        },
        Err(e) => (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": e.to_string() })),
        ),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn req(
        idp: Option<&str>,
        gateway: Option<&str>,
        entitlement: Option<&str>,
        provider: Option<&str>,
    ) -> UpdateConfigRequest {
        UpdateConfigRequest {
            idp_base_url: idp.map(str::to_string),
            gateway_base_url: gateway.map(str::to_string),
            entitlement_base_url: entitlement.map(str::to_string),
            provider_name: provider.map(str::to_string),
        }
    }

    #[tokio::test]
    async fn update_config_rejects_invalid_provider_name() {
        for bad in ["", "   ", &"x".repeat(65), "bad\u{7}name"] {
            let (status, Json(body)) = update_config(Json(req(
                None,
                None,
                None,
                Some(bad),
            )))
            .await;
            assert_eq!(status, StatusCode::BAD_REQUEST, "provider_name={bad:?}");
            let msg = body["error"].as_str().unwrap_or_default();
            assert!(
                msg.contains("provider_name"),
                "错误信息应含字段语义：{msg}"
            );
        }
    }

    #[tokio::test]
    async fn update_config_rejects_unsafe_urls() {
        for (field, bad) in [
            ("idp_base_url", "javascript:alert(1)"),
            ("idp_base_url", "https://idp.test/?a=b"),
            ("gateway_base_url", "ftp://gw.test"),
            ("gateway_base_url", "https://u:p@gw.test"),
            ("entitlement_base_url", "data:text/html,hi"),
            ("entitlement_base_url", "https://ent.test/#frag"),
        ] {
            let (idp, gw, ent) = match field {
                "idp_base_url" => (Some(bad), None, None),
                "gateway_base_url" => (None, Some(bad), None),
                _ => (None, None, Some(bad)),
            };
            let (status, Json(body)) =
                update_config(Json(req(idp, gw, ent, None))).await;
            assert_eq!(status, StatusCode::BAD_REQUEST, "{field}={bad:?}");
            let msg = body["error"].as_str().unwrap_or_default();
            assert!(
                msg.starts_with(field),
                "错误信息应含字段语义：{msg}"
            );
        }
    }

    #[test]
    fn validate_base_url_key_rejections() {
        for bad in [
            "javascript:alert(1)",
            "data:text/html;base64,AAAA",
            "https://idp.test/?a=b",
            "https://idp.test/#frag",
            "https://u:p@idp.test",
            "https://",
            "ftp://idp.test",
            "",
        ] {
            assert!(
                validate_base_url(bad).is_err(),
                "应拒绝非法地址：{bad:?}"
            );
        }
        assert_eq!(
            validate_base_url("http://127.0.0.1:8080/").unwrap(),
            "http://127.0.0.1:8080"
        );
    }

    /// 递归收集 JSON 对象的键路径，用于断言不泄露敏感字段名。
    fn collect_keys(value: &Value, prefix: &str, out: &mut Vec<String>) {
        match value {
            Value::Object(map) => {
                for (key, child) in map {
                    let path = if prefix.is_empty() {
                        key.clone()
                    } else {
                        format!("{prefix}.{key}")
                    };
                    out.push(path.clone());
                    collect_keys(child, &path, out);
                }
            }
            Value::Array(items) => {
                for (idx, child) in items.iter().enumerate() {
                    collect_keys(child, &format!("{prefix}[{idx}]"), out);
                }
            }
            _ => {}
        }
    }

    #[tokio::test]
    async fn get_config_returns_non_sensitive_view() {
        let (status, Json(body)) = get_config().await;
        assert_eq!(status, StatusCode::OK);
        assert!(body.get("stored").is_some());
        assert!(body.get("effective").is_some());
        assert!(body.get("env_overrides").is_some());

        let mut keys = Vec::new();
        collect_keys(&body, "", &mut keys);
        for key in &keys {
            let lower = key.to_ascii_lowercase();
            for forbidden in ["token", "secret", "session", "password", "redirect_uri"] {
                assert!(
                    !lower.contains(forbidden),
                    "视图不得包含敏感字段：{key}（禁止 {forbidden}）"
                );
            }
        }
        // stored 视图只暴露 5 个非敏感字段。
        let stored = body["stored"].as_object().expect("stored 应为对象");
        let expected: std::collections::HashSet<&str> = [
            "idp_base_url",
            "gateway_base_url",
            "entitlement_base_url",
            "client_id",
            "provider_name",
        ]
        .into_iter()
        .collect();
        let actual: std::collections::HashSet<&str> =
            stored.keys().map(String::as_str).collect();
        assert_eq!(actual, expected, "stored 字段应恰为 5 个非敏感字段");
    }

    // ===== B1：mode 推断（Local Mode 硬原则） =====

    #[test]
    fn infer_cloud_mode_defaults_to_local() {
        // 未登录、未配置云 → local（三件套全停不刷屏）
        assert_eq!(infer_cloud_mode(false, false, false), CloudMode::Local);
        // 未登录 + 云可达 → 仍是 local（登录永非门槛；可达只说明「可登录」）
        assert_eq!(infer_cloud_mode(false, false, true), CloudMode::Local);
    }

    #[test]
    fn infer_cloud_mode_logged_in_follows_probe() {
        assert_eq!(infer_cloud_mode(true, true, true), CloudMode::Online);
        assert_eq!(infer_cloud_mode(true, true, false), CloudMode::CloudDegraded);
        assert_eq!(infer_cloud_mode(true, false, true), CloudMode::Online);
        assert_eq!(
            infer_cloud_mode(true, false, false),
            CloudMode::CloudDegraded
        );
    }

    #[test]
    fn infer_cloud_mode_configured_but_unreachable() {
        // 显式配置了云地址但探测失败 → cloud_degraded（即使未登录）
        assert_eq!(
            infer_cloud_mode(false, true, false),
            CloudMode::CloudDegraded
        );
        // 显式配置 + 可达 + 未登录 → local（online 需要已登录）
        assert_eq!(infer_cloud_mode(false, true, true), CloudMode::Local);
    }

    #[test]
    fn cloud_mode_strings_match_contract() {
        assert_eq!(CloudMode::Local.as_str(), "local");
        assert_eq!(CloudMode::Online.as_str(), "online");
        assert_eq!(CloudMode::CloudDegraded.as_str(), "cloud_degraded");
    }

    // ===== B1：status body 纯增量、旧字段不删 =====

    fn empty_summary() -> identity::SessionStatus {
        identity::SessionStatus {
            logged_in: false,
            subject: None,
            idp_base_url: String::new(),
            gateway_base_url: String::new(),
            client_id: String::new(),
            provider_name: "sa-ai".into(),
            models_count: 0,
            default_model: None,
            gateway_key_ref_masked: None,
            refresh_token_ref_masked: None,
            logged_in_at: None,
        }
    }

    #[test]
    fn build_status_body_is_additive() {
        let body = build_status_body(&empty_summary(), None, CloudMode::Local, false);
        // 新字段
        assert_eq!(body["mode"], "local");
        assert_eq!(body["cloud_available"], false);
        // 旧字段保留
        for key in [
            "logged_in",
            "subject",
            "provider_name",
            "models_count",
            "default_model",
            "gateway_base_url",
            "logged_in_at",
        ] {
            assert!(
                body["account"].get(key).is_some(),
                "旧字段不得删除：account.{key}"
            );
        }
        assert!(body.get("login_state").is_some());
    }

    #[test]
    fn build_status_body_online_variant() {
        let mut summary = empty_summary();
        summary.logged_in = true;
        summary.subject = Some("user-1".into());
        summary.models_count = 3;
        let body = build_status_body(
            &summary,
            Some("completed".into()),
            CloudMode::Online,
            true,
        );
        assert_eq!(body["mode"], "online");
        assert_eq!(body["cloud_available"], true);
        assert_eq!(body["account"]["logged_in"], true);
        assert_eq!(body["account"]["subject"], "user-1");
        assert_eq!(body["account"]["models_count"], 3);
        assert_eq!(body["login_state"], "completed");
    }

    // ===== 显式云配置判定（缺省 localhost 不算配置） =====

    #[test]
    fn cloud_configured_ignores_local_defaults() {
        let stored = IdentityConfig::default();
        let with_env = IdentityConfig::default();
        assert!(
            !cloud_explicitly_configured(&stored, &with_env),
            "全缺省（未填 localhost 缺省）应视为未配置云"
        );
    }

    #[test]
    fn cloud_configured_detects_stored_urls() {
        let stored = IdentityConfig {
            gateway_base_url: "https://gw.example.com".into(),
            ..Default::default()
        };
        let with_env = stored.clone();
        assert!(cloud_explicitly_configured(&stored, &with_env));

        let stored = IdentityConfig {
            entitlement_base_url: "https://ent.example.com".into(),
            ..Default::default()
        };
        let with_env = stored.clone();
        assert!(cloud_explicitly_configured(&stored, &with_env));
    }

    #[test]
    fn cloud_configured_detects_env_overrides() {
        let stored = IdentityConfig::default();
        let with_env = IdentityConfig {
            idp_base_url: "https://idp.example.com".into(),
            ..Default::default()
        };
        assert!(cloud_explicitly_configured(&stored, &with_env));
    }

    // ===== B2：结构化降级错误体（UI 可识别） =====

    #[test]
    fn cloud_unavailable_error_body_is_structured() {
        let (status, Json(body)) = cloud_unavailable_error("云增强不可用：权益服务未启动或不可达");
        assert_eq!(status, StatusCode::SERVICE_UNAVAILABLE);
        assert_eq!(body["code"], "cloud_unavailable");
        assert_eq!(body["mode"], "cloud_degraded");
        assert_eq!(body["cloud_available"], false);
        assert!(body["error"].as_str().unwrap_or_default().contains("云增强"));
    }

    #[test]
    fn needs_entitlement_auth_error_body_is_structured() {
        let (status, Json(body)) = needs_entitlement_auth_error("需要权益授权");
        assert_eq!(status, StatusCode::UNAUTHORIZED);
        assert_eq!(body["code"], "needs_entitlement_auth");
        assert_eq!(body["needs_entitlement_auth"], true);
        // 兼容旧 UI：error 字段仍在
        assert!(body["error"].as_str().is_some());
    }

    // ===== 探测失败不抛（B1 短超时约定） =====

    #[tokio::test]
    async fn probe_url_reachable_never_throws_on_failure() {
        // 空 URL 直接 false
        assert!(!probe_url_reachable("").await);
        assert!(!probe_url_reachable("   ").await);
        // 关闭端口 → 连接拒绝，折叠为 false
        assert!(!probe_url_reachable("http://127.0.0.1:1").await);
        // 非法 scheme 同样 false
        assert!(!probe_url_reachable("not-a-url").await);
    }

    #[tokio::test]
    async fn probe_cloud_available_any_reachable() {
        assert!(!probe_cloud_available(&[]).await);
        assert!(!probe_cloud_available(&["", "http://127.0.0.1:1"]).await);
    }
}
