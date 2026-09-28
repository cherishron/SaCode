use std::{
    sync::{Arc, Mutex, OnceLock},
    time::Duration,
};

use axum::{extract::State, http::StatusCode, Json};
use serde::Deserialize;
use serde_json::{json, Value};
use url::Url;

use super::DaemonState;
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

pub async fn status() -> (StatusCode, Json<Value>) {
    match identity::status_summary(None) {
        Ok(summary) => (
            StatusCode::OK,
            Json(json!({
                "account": json!({
                    "logged_in": summary.logged_in,
                    "subject": summary.subject,
                    "provider_name": summary.provider_name,
                    "models_count": summary.models_count,
                    "default_model": summary.default_model,
                    "gateway_base_url": summary.gateway_base_url,
                    "logged_in_at": summary.logged_in_at,
                }),
                "login_state": login_state().lock().unwrap().clone(),
            })),
        ),
        Err(_) => error(StatusCode::INTERNAL_SERVER_ERROR, "账号状态不可用"),
    }
}

pub async fn login(State(state): State<Arc<DaemonState>>) -> (StatusCode, Json<Value>) {
    let cfg = match config() {
        Ok(cfg) => cfg,
        Err(_) => return error(StatusCode::INTERNAL_SERVER_ERROR, "登录配置不可用"),
    };
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
    let workdir = state
        .workdir
        .as_deref()
        .unwrap_or_else(|| std::path::Path::new("."));
    let store = identity::select_secret_store(false, None);
    match identity::sync_models(&cfg, None, workdir, store.as_ref(), None).await {
        Ok(models) => (StatusCode::OK, Json(json!({ "models": models }))),
        Err(_) => {
            tracing::warn!("sync models failed");
            error(
                StatusCode::BAD_GATEWAY,
                "模型同步失败，请检查网关连接和账号授权",
            )
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
            error(
                StatusCode::BAD_GATEWAY,
                "网关注册失败，请检查账号、网关及上游模型设置",
            )
        }
    }
}

/// GET /account/entitlements — 本人权益（sa-entitlement `/v1/entitlements/me`）。
pub async fn entitlements(
    axum::extract::Query(q): axum::extract::Query<std::collections::HashMap<String, String>>,
) -> (StatusCode, Json<Value>) {
    let cfg = match current_session_config() {
        Ok(cfg) => cfg,
        Err(_) => return error(StatusCode::INTERNAL_SERVER_ERROR, "权益配置不可用"),
    };
    let store = identity::select_secret_store(false, None);
    let access = match identity::ensure_entitlement_access_token(&cfg, store.as_ref(), None, 120)
        .await
    {
        Ok(t) => t,
        Err(e) => {
            tracing::warn!(error = %e, "entitlement token unavailable");
            return (
                StatusCode::UNAUTHORIZED,
                Json(json!({
                    "error": "需要权益授权",
                    "needs_entitlement_auth": true,
                })),
            );
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
            error(
                StatusCode::BAD_GATEWAY,
                "权益服务不可用，请稍后重试或检查 sa-entitlement",
            )
        }
    }
}

/// POST /account/entitlement-login — 为 sacode-ent 再走一次 PKCE（IdP 会话存在时通常无感）。
pub async fn entitlement_login(State(state): State<Arc<DaemonState>>) -> (StatusCode, Json<Value>) {
    let cfg = match config() {
        Ok(cfg) => cfg,
        Err(_) => return error(StatusCode::INTERNAL_SERVER_ERROR, "权益登录配置不可用"),
    };
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
