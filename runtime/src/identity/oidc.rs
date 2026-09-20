use anyhow::{anyhow, Context, Result};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TokenResponse {
    pub access_token: String,
    #[serde(default = "default_token_type")]
    pub token_type: String,
    #[serde(default)]
    pub expires_in: Option<u64>,
    #[serde(default)]
    pub refresh_token: Option<String>,
    #[serde(default)]
    pub id_token: Option<String>,
}

fn default_token_type() -> String {
    "Bearer".to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiscoveryDocument {
    #[serde(default)]
    pub issuer: Option<String>,
    #[serde(default)]
    pub authorization_endpoint: Option<String>,
    #[serde(default)]
    pub token_endpoint: Option<String>,
    #[serde(default)]
    pub jwks_uri: Option<String>,
}

/// HTTP surface for OIDC token operations. Injectable for mock tests.
pub trait OidcHttp: Send + Sync {
    fn exchange_code(
        &self,
        token_endpoint: &str,
        client_id: &str,
        code: &str,
        redirect_uri: &str,
        code_verifier: &str,
    ) -> impl std::future::Future<Output = Result<TokenResponse>> + Send;

    fn refresh(
        &self,
        token_endpoint: &str,
        client_id: &str,
        refresh_token: &str,
    ) -> impl std::future::Future<Output = Result<TokenResponse>> + Send;

    fn discovery(
        &self,
        discovery_endpoint: &str,
    ) -> impl std::future::Future<Output = Result<DiscoveryDocument>> + Send;
}

#[derive(Debug, Clone, Default)]
pub struct ReqwestOidcHttp {
    pub client: reqwest::Client,
}

impl ReqwestOidcHttp {
    pub fn new() -> Self {
        Self {
            client: reqwest::Client::builder()
                .timeout(std::time::Duration::from_secs(30))
                .build()
                .unwrap_or_default(),
        }
    }
}

impl OidcHttp for ReqwestOidcHttp {
    async fn exchange_code(
        &self,
        token_endpoint: &str,
        client_id: &str,
        code: &str,
        redirect_uri: &str,
        code_verifier: &str,
    ) -> Result<TokenResponse> {
        let resp = self
            .client
            .post(token_endpoint)
            .form(&[
                ("grant_type", "authorization_code"),
                ("code", code),
                ("redirect_uri", redirect_uri),
                ("client_id", client_id),
                ("code_verifier", code_verifier),
            ])
            .send()
            .await
            .with_context(|| format!("POST {token_endpoint}"))?;
        parse_token_response(resp).await
    }

    async fn refresh(
        &self,
        token_endpoint: &str,
        client_id: &str,
        refresh_token: &str,
    ) -> Result<TokenResponse> {
        let resp = self
            .client
            .post(token_endpoint)
            .form(&[
                ("grant_type", "refresh_token"),
                ("refresh_token", refresh_token),
                ("client_id", client_id),
            ])
            .send()
            .await
            .with_context(|| format!("POST refresh {token_endpoint}"))?;
        parse_token_response(resp).await
    }

    async fn discovery(&self, discovery_endpoint: &str) -> Result<DiscoveryDocument> {
        let resp = self
            .client
            .get(discovery_endpoint)
            .send()
            .await
            .with_context(|| format!("GET {discovery_endpoint}"))?;
        if !resp.status().is_success() {
            anyhow::bail!("discovery failed: HTTP {}", resp.status());
        }
        Ok(resp.json().await.context("parse discovery document")?)
    }
}

async fn parse_token_response(resp: reqwest::Response) -> Result<TokenResponse> {
    let status = resp.status();
    let body = resp.text().await.unwrap_or_default();
    if !status.is_success() {
        // Never log token material; body may contain error_description only.
        let snippet: String = body.chars().take(200).collect();
        anyhow::bail!("token endpoint returned HTTP {status}: {snippet}");
    }
    let parsed: TokenResponse = serde_json::from_str(&body).context("parse token response JSON")?;
    if parsed.access_token.trim().is_empty() {
        anyhow::bail!("token response missing access_token");
    }
    Ok(parsed)
}

pub fn split_auth_code(callback_url: &str) -> Result<(String, String)> {
    let url = url::Url::parse(callback_url)
        .map_err(|e| anyhow!("invalid callback url {callback_url}: {e}"))?;
    let mut code = None;
    let mut state = None;
    let mut error = None;
    for (k, v) in url.query_pairs() {
        match k.as_ref() {
            "code" => code = Some(v.to_string()),
            "state" => state = Some(v.to_string()),
            "error" => error = Some(v.to_string()),
            _ => {}
        }
    }
    if let Some(err) = error {
        anyhow::bail!("authorization failed: {err}");
    }
    let code = code.ok_or_else(|| anyhow!("callback missing code"))?;
    let state = state.ok_or_else(|| anyhow!("callback missing state"))?;
    Ok((code, state))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn split_auth_code_extracts_fields() {
        let (code, state) =
            split_auth_code("http://127.0.0.1:9/callback?code=abc&state=xyz").unwrap();
        assert_eq!(code, "abc");
        assert_eq!(state, "xyz");
    }

    #[test]
    fn split_auth_code_error_path() {
        assert!(split_auth_code("http://127.0.0.1/cb?error=access_denied").is_err());
    }
}
