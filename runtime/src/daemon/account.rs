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
