use std::time::Duration;

use serde::Deserialize;

use super::store::AuthHost;
use super::{GitAuthError, GitAuthResult};

const DEVICE_CODE_URL: &str = "https://github.com/login/device/code";
const ACCESS_TOKEN_URL: &str = "https://github.com/login/oauth/access_token";
const DEFAULT_SCOPE: &str = "repo read:user";

#[derive(Debug, Clone)]
pub struct DeviceAuthSession {
    pub device_code: String,
    pub user_code: String,
    pub verification_uri: String,
    pub verification_uri_complete: Option<String>,
    pub expires_in: u64,
    pub interval: u64,
}

#[derive(Debug, Deserialize)]
struct DeviceCodeResponse {
    device_code: String,
    user_code: String,
    verification_uri: String,
    verification_uri_complete: Option<String>,
    expires_in: u64,
    interval: Option<u64>,
}

#[derive(Debug, Deserialize)]
struct TokenPollResponse {
    access_token: Option<String>,
    #[allow(dead_code)]
    token_type: Option<String>,
    error: Option<String>,
    error_description: Option<String>,
}

pub struct GitHubDeviceClient {
    pub client_id: String,
    pub scope: String,
    pub http: reqwest::Client,
}

impl GitHubDeviceClient {
    pub fn new(client_id: impl Into<String>) -> Self {
        Self {
            client_id: client_id.into(),
            scope: DEFAULT_SCOPE.to_string(),
            http: reqwest::Client::new(),
        }
    }

    pub fn client_id_from_env() -> GitAuthResult<String> {
        std::env::var("SACODE_GITHUB_CLIENT_ID")
            .ok()
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .ok_or_else(|| {
                GitAuthError::MissingClient(
                    "set SACODE_GITHUB_CLIENT_ID (GitHub OAuth App / Device Flow client_id)".into(),
                )
            })
    }

    pub async fn start_device_flow(&self) -> GitAuthResult<DeviceAuthSession> {
        if self.client_id.trim().is_empty() {
            return Err(GitAuthError::MissingClient("github client_id empty".into()));
        }
        let body = self
            .http
            .post(DEVICE_CODE_URL)
            .header(reqwest::header::ACCEPT, "application/json")
            .form(&[
                ("client_id", self.client_id.as_str()),
                ("scope", self.scope.as_str()),
            ])
            .send()
            .await
            .map_err(|e| GitAuthError::Flow(format!("device code request failed: {e}")))?;
        let status = body.status();
        let text = body.text().await.unwrap_or_default();
        if !status.is_success() {
            return Err(GitAuthError::Flow(format!(
                "device code HTTP {status}: {}",
                text.chars().take(160).collect::<String>()
            )));
        }
        let parsed: DeviceCodeResponse = serde_json::from_str(&text)
            .map_err(|e| GitAuthError::Flow(format!("device code parse: {e}")))?;
        Ok(DeviceAuthSession {
            device_code: parsed.device_code,
            user_code: parsed.user_code,
            verification_uri: parsed.verification_uri,
            verification_uri_complete: parsed.verification_uri_complete,
            expires_in: parsed.expires_in,
            interval: parsed.interval.unwrap_or(5).max(1),
        })
    }

    pub async fn poll_token(&self, device_code: &str) -> GitAuthResult<Option<String>> {
        let resp = self
            .http
            .post(ACCESS_TOKEN_URL)
            .header(reqwest::header::ACCEPT, "application/json")
            .form(&[
                ("client_id", self.client_id.as_str()),
                ("device_code", device_code),
                ("grant_type", "urn:ietf:params:oauth:grant-type:device_code"),
            ])
            .send()
            .await
            .map_err(|e| GitAuthError::Flow(format!("token poll failed: {e}")))?;
        let text = resp.text().await.unwrap_or_default();
        let parsed: TokenPollResponse = serde_json::from_str(&text)
            .map_err(|e| GitAuthError::Flow(format!("token poll parse: {e}")))?;
        if let Some(tok) = parsed.access_token {
            if !tok.is_empty() {
                return Ok(Some(tok));
            }
        }
        Ok(None)
    }

    pub async fn complete_device_flow_poll(
        &self,
        device_code: &str,
        wait: Duration,
        interval: Duration,
    ) -> GitAuthResult<String> {
        let deadline = std::time::Instant::now() + wait;
        let mut last_err = None;
        while std::time::Instant::now() < deadline {
            match self.poll_token(device_code).await {
                Ok(Some(tok)) => return Ok(tok),
                Ok(None) => {
                    last_err = Some("authorization_pending or slow_down".to_string());
                }
                Err(e) => last_err = Some(e.to_string()),
            }
            tokio::time::sleep(interval.max(Duration::from_secs(2))).await;
        }
        Err(GitAuthError::Flow(format!(
            "github device flow timed out: {}",
            last_err.unwrap_or_else(|| "unknown".into())
        )))
    }

    pub async fn github_user_login(&self, token: &str) -> Option<String> {
        let resp = self
            .http
            .get("https://api.github.com/user")
            .bearer_auth(token)
            .header("User-Agent", "sacode")
            .send()
            .await
            .ok()?;
        let v: serde_json::Value = resp.json().await.ok()?;
        v.get("login").and_then(|l| l.as_str()).map(str::to_string)
    }

    pub fn host(&self) -> AuthHost {
        AuthHost::Github
    }
}

/// Parse GitHub device-code mock / fixture JSON.
pub fn parse_device_code_json(text: &str) -> Result<DeviceAuthSession, String> {
    let parsed: DeviceCodeResponse = serde_json::from_str(text).map_err(|e| format!("{e}"))?;
    Ok(DeviceAuthSession {
        device_code: parsed.device_code,
        user_code: parsed.user_code,
        verification_uri: parsed.verification_uri,
        verification_uri_complete: parsed.verification_uri_complete,
        expires_in: parsed.expires_in,
        interval: parsed.interval.unwrap_or(5),
    })
}

pub fn parse_token_poll_json(text: &str) -> Result<Option<String>, String> {
    let parsed: TokenPollResponse = serde_json::from_str(text).map_err(|e| format!("{e}"))?;
    if let Some(t) = parsed.access_token {
        if !t.is_empty() {
            return Ok(Some(t));
        }
    }
    if let Some(err) = parsed.error {
        return Err(format!(
            "{err}: {}",
            parsed.error_description.unwrap_or_default()
        ));
    }
    Ok(None)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_device_and_token_fixtures() {
        let d = parse_device_code_json(
            r#"{"device_code":"dev","user_code":"ABCD-1234","verification_uri":"https://github.com/login/device","expires_in":900,"interval":5}"#,
        )
        .unwrap();
        assert_eq!(d.user_code, "ABCD-1234");
        assert!(parse_device_code_json("{}").is_err());
        let tok = parse_token_poll_json(r#"{"access_token":"gho_test","token_type":"bearer"}"#)
            .unwrap()
            .unwrap();
        assert_eq!(tok, "gho_test");
        assert!(parse_token_poll_json(r#"{"error":"authorization_pending"}"#).is_err());
    }

    #[test]
    fn missing_client_id_is_actionable() {
        std::env::remove_var("SACODE_GITHUB_CLIENT_ID");
        match GitHubDeviceClient::client_id_from_env() {
            Err(GitAuthError::MissingClient(m)) => assert!(m.contains("SACODE_GITHUB_CLIENT_ID")),
            other => panic!("unexpected {other:?}"),
        }
    }
}
