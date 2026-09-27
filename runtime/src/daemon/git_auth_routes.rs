//! HTTP routes for Git platform authentication.
//!
//! Exposes the existing `git_auth` module over `/api/git-auth/*` so the
//! Desktop settings center can link/unlink GitHub and Gitee accounts.

use std::sync::Arc;

use axum::{extract::State, http::StatusCode, Json};
use serde::{Deserialize, Serialize};

use super::DaemonState;

fn json_error(code: StatusCode, message: &str) -> (StatusCode, Json<serde_json::Value>) {
    (code, Json(serde_json::json!({ "error": message })))
}

fn ok_json(value: serde_json::Value) -> (StatusCode, Json<serde_json::Value>) {
    (StatusCode::OK, Json(value))
}

/// Returns the user-level `.sacode` root used by `git_auth` storage functions.
/// In Desktop the daemon runs with a workdir, but git auth is a user-level
/// concern, so we always resolve from `USERPROFILE`/`HOME`.
fn git_user_root() -> Option<std::path::PathBuf> {
    std::env::var_os("USERPROFILE")
        .or_else(|| std::env::var_os("HOME"))
        .map(|p| std::path::PathBuf::from(p).join(".sacode"))
}

/// `GET /api/git-auth/status` — authorization state for each platform.
pub async fn status(State(_state): State<Arc<DaemonState>>) -> Json<serde_json::Value> {
    let statuses = crate::git_auth::git_auth_status(git_user_root().as_deref());
    Json(serde_json::json!({
        "platforms": statuses,
    }))
}

/// `POST /api/git-auth/github/device` — start GitHub device-flow authorization.
#[derive(Debug, Clone, Deserialize)]
pub struct GithubDeviceRequest {
    #[serde(default)]
    pub client_id: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct DeviceFlowResponse {
    pub device_code: String,
    pub user_code: String,
    pub verification_uri: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub verification_uri_complete: Option<String>,
    pub expires_in: u64,
    pub interval: u64,
}

pub async fn github_device(
    Json(req): Json<GithubDeviceRequest>,
) -> (StatusCode, Json<serde_json::Value>) {
    let client_id = match req
        .client_id
        .or_else(|| {
            crate::git_auth::GitHubDeviceClient::client_id_from_env()
                .ok()
                .filter(|id| !id.is_empty())
        })
        .ok_or_else(|| "GitHub client id not configured".to_string())
    {
        Ok(id) => id,
        Err(msg) => return json_error(StatusCode::BAD_REQUEST, &msg),
    };
    let client = crate::git_auth::GitHubDeviceClient::new(client_id);
    match client.start_device_flow().await {
        Ok(session) => ok_json(
            serde_json::to_value(DeviceFlowResponse {
                device_code: session.device_code,
                user_code: session.user_code,
                verification_uri: session.verification_uri,
                verification_uri_complete: session.verification_uri_complete,
                expires_in: session.expires_in,
                interval: session.interval,
            })
            .unwrap_or_default(),
        ),
        Err(e) => json_error(StatusCode::BAD_GATEWAY, &e.to_string()),
    }
}

/// `POST /api/git-auth/github/poll` — poll for token after device authorization.
#[derive(Debug, Clone, Deserialize)]
pub struct GithubPollRequest {
    pub device_code: String,
    #[serde(default)]
    pub timeout_seconds: Option<u64>,
    #[serde(default)]
    pub client_id: Option<String>,
}

pub async fn github_poll(
    Json(req): Json<GithubPollRequest>,
) -> (StatusCode, Json<serde_json::Value>) {
    let client_id = req
        .client_id
        .or_else(|| crate::git_auth::GitHubDeviceClient::client_id_from_env().ok());
    let Some(client_id) = client_id.filter(|id| !id.trim().is_empty()) else {
        return json_error(StatusCode::BAD_REQUEST, "GitHub client id not configured");
    };
    let client = crate::git_auth::GitHubDeviceClient::new(client_id);
    let timeout = std::time::Duration::from_secs(req.timeout_seconds.unwrap_or(300));
    let interval = std::time::Duration::from_secs(5);
    match client
        .complete_device_flow_poll(&req.device_code, timeout, interval)
        .await
    {
        Ok(token) => {
            let login = client.github_user_login(&token).await;
            if let Err(e) = crate::git_auth::save_token(
                crate::git_auth::AuthHost::Github,
                &token,
                "device_flow",
                login.clone(),
                git_user_root().as_deref(),
            ) {
                tracing::error!(?e, "failed to save github token");
                return json_error(StatusCode::INTERNAL_SERVER_ERROR, "failed to save token");
            }
            ok_json(serde_json::json!({
                "status": "ok",
                "platform": "github",
                "login": login,
            }))
        }
        Err(e) => json_error(StatusCode::BAD_GATEWAY, &e.to_string()),
    }
}

/// `POST /api/git-auth/gitee/authorize` — return Gitee authorization URL.
#[derive(Debug, Clone, Deserialize)]
pub struct GiteeAuthorizeRequest {
    #[serde(default)]
    pub redirect_uri: Option<String>,
}

pub async fn gitee_authorize(
    Json(req): Json<GiteeAuthorizeRequest>,
) -> (StatusCode, Json<serde_json::Value>) {
    let redirect = req
        .redirect_uri
        .unwrap_or_else(|| "http://localhost:18321/callback".to_string());
    match crate::git_auth::GiteeLoopbackConfig::from_env(&redirect) {
        Ok(config) => {
            let state = format!("gitee-{:016x}", rand::random::<u64>());
            let url = config.authorize_url(&state);
            ok_json(serde_json::json!({
                "authorize_url": url,
                "state": state,
            }))
        }
        Err(e) => json_error(StatusCode::BAD_REQUEST, &format!("gitee config: {e}")),
    }
}

/// `POST /api/git-auth/gitee/callback` — exchange authorization code for token.
#[derive(Debug, Clone, Deserialize)]
pub struct GiteeCallbackRequest {
    pub code: String,
    #[serde(default)]
    pub redirect_uri: Option<String>,
}

pub async fn gitee_callback(
    Json(req): Json<GiteeCallbackRequest>,
) -> (StatusCode, Json<serde_json::Value>) {
    let redirect = req
        .redirect_uri
        .unwrap_or_else(|| "http://localhost:18321/callback".to_string());
    match crate::git_auth::GiteeLoopbackConfig::from_env(&redirect) {
        Ok(config) => {
            let client = crate::git_auth::GiteeOAuthClient::new(config);
            match client.exchange_code(&req.code).await {
                Ok(token) => {
                    if let Err(e) = crate::git_auth::save_token(
                        crate::git_auth::AuthHost::Gitee,
                        &token,
                        "oauth_code",
                        None,
                        git_user_root().as_deref(),
                    ) {
                        tracing::error!(?e, "failed to save gitee token");
                        return json_error(
                            StatusCode::INTERNAL_SERVER_ERROR,
                            "failed to save token",
                        );
                    }
                    ok_json(serde_json::json!({
                        "status": "ok",
                        "platform": "gitee",
                    }))
                }
                Err(e) => json_error(StatusCode::BAD_GATEWAY, &e.to_string()),
            }
        }
        Err(e) => json_error(StatusCode::BAD_REQUEST, &format!("gitee config: {e}")),
    }
}

/// `POST /api/git-auth/logout` — disconnect a platform.
#[derive(Debug, Clone, Deserialize)]
pub struct LogoutRequest {
    pub host: String,
}

pub async fn logout(Json(req): Json<LogoutRequest>) -> (StatusCode, Json<serde_json::Value>) {
    let Ok(host) = crate::git_auth::AuthHost::parse(&req.host) else {
        return json_error(StatusCode::BAD_REQUEST, "unknown git platform");
    };
    match crate::git_auth::logout_host(Some(host), git_user_root().as_deref()) {
        Ok(_) => ok_json(serde_json::json!({ "status": "ok" })),
        Err(e) => json_error(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()),
    }
}
