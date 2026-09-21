use super::{GitAuthError, GitAuthResult};

/// Gitee loopback OAuth configuration.
#[derive(Debug, Clone)]
pub struct GiteeLoopbackConfig {
    pub client_id: String,
    pub client_secret: String,
    pub redirect_uri: String,
    pub scope: String,
}

impl GiteeLoopbackConfig {
    pub fn from_env(redirect_uri: impl Into<String>) -> GitAuthResult<Self> {
        let client_id = std::env::var("SACODE_GITEE_CLIENT_ID")
            .ok()
            .filter(|s| !s.trim().is_empty())
            .ok_or_else(|| GitAuthError::MissingClient("set SACODE_GITEE_CLIENT_ID".into()))?;
        let client_secret = std::env::var("SACODE_GITEE_CLIENT_SECRET")
            .ok()
            .filter(|s| !s.trim().is_empty())
            .ok_or_else(|| GitAuthError::MissingClient("set SACODE_GITEE_CLIENT_SECRET".into()))?;
        Ok(Self {
            client_id,
            client_secret,
            redirect_uri: redirect_uri.into(),
            scope: "projects pull_requests user_info".to_string(),
        })
    }

    pub fn authorize_url(&self, state: &str) -> String {
        format!(
            "https://gitee.com/oauth/authorize?response_type=code&client_id={}&redirect_uri={}&scope={}&state={}",
            urlencoding_loose(&self.client_id),
            urlencoding_loose(&self.redirect_uri),
            urlencoding_loose(&self.scope),
            urlencoding_loose(state),
        )
    }
}

fn urlencoding_loose(s: &str) -> String {
    s.replace(' ', "%20")
        .replace('/', "%2F")
        .replace(':', "%3A")
        .replace('&', "%26")
        .replace('?', "%3F")
        .replace('=', "%3D")
}

#[derive(Debug, Clone)]
pub struct GiteeOAuthClient {
    pub config: GiteeLoopbackConfig,
    pub http: reqwest::Client,
}

impl GiteeOAuthClient {
    pub fn new(config: GiteeLoopbackConfig) -> Self {
        Self {
            config,
            http: reqwest::Client::new(),
        }
    }

    pub async fn exchange_code(&self, code: &str) -> GitAuthResult<String> {
        let resp = self
            .http
            .post("https://gitee.com/oauth/token")
            .form(&[
                ("grant_type", "authorization_code"),
                ("code", code),
                ("client_id", self.config.client_id.as_str()),
                ("client_secret", self.config.client_secret.as_str()),
                ("redirect_uri", self.config.redirect_uri.as_str()),
            ])
            .send()
            .await
            .map_err(|e| GitAuthError::Flow(format!("gitee token exchange failed: {e}")))?;
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        if !status.is_success() {
            return Err(GitAuthError::Flow(format!(
                "gitee token HTTP {status}: {}",
                text.chars().take(160).collect::<String>()
            )));
        }
        let v: serde_json::Value = serde_json::from_str(&text)
            .map_err(|e| GitAuthError::Flow(format!("gitee token parse: {e}")))?;
        v.get("access_token")
            .and_then(|t| t.as_str())
            .filter(|t| !t.is_empty())
            .map(str::to_string)
            .ok_or_else(|| GitAuthError::Flow("gitee response missing access_token".into()))
    }
}

/// Parse gitee token response fixture.
pub fn parse_gitee_token_json(text: &str) -> Result<String, String> {
    let v: serde_json::Value = serde_json::from_str(text).map_err(|e| e.to_string())?;
    v.get("access_token")
        .and_then(|t| t.as_str())
        .filter(|t| !t.is_empty())
        .map(str::to_string)
        .ok_or_else(|| {
            v.get("error")
                .and_then(|e| e.as_str())
                .unwrap_or("missing access_token")
                .to_string()
        })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn gitee_auth_url_and_token_fixture() {
        std::env::set_var("SACODE_GITEE_CLIENT_ID", "cid");
        std::env::set_var("SACODE_GITEE_CLIENT_SECRET", "secret");
        let cfg = GiteeLoopbackConfig::from_env("http://127.0.0.1:1/callback").unwrap();
        let url = cfg.authorize_url("st");
        assert!(url.contains("gitee.com/oauth/authorize"));
        assert!(url.contains("client_id=cid"));
        assert_eq!(
            parse_gitee_token_json(r#"{"access_token":"gt-1","token_type":"bearer"}"#).unwrap(),
            "gt-1"
        );
        assert!(parse_gitee_token_json(r#"{"error":"invalid_grant"}"#).is_err());
        std::env::remove_var("SACODE_GITEE_CLIENT_ID");
        std::env::remove_var("SACODE_GITEE_CLIENT_SECRET");
    }
}
