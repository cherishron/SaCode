use anyhow::{anyhow, Context, Result};
use serde::{Deserialize, Serialize};

use super::{GATEWAY_KEY_EXCHANGE_PATH, GATEWAY_MODELS_PATH};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GatewayKeyResponse {
    pub api_key: String,
    /// gateway-rs exchange: true=新签发，false=幂等回发存量 key
    #[serde(default)]
    pub issued: Option<bool>,
    #[serde(default)]
    pub prefix: Option<String>,
    #[serde(default)]
    pub id: Option<String>,
    #[serde(default)]
    pub created_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelsListResponse {
    #[serde(default)]
    pub data: Vec<ModelObject>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelObject {
    pub id: String,
}

/// HTTP surface for gateway data-plane calls. Injectable for mock tests.
pub trait GatewayHttp: Send + Sync {
    fn exchange_gateway_key(
        &self,
        exchange_url: &str,
        access_token: &str,
    ) -> impl std::future::Future<Output = Result<GatewayKeyResponse>> + Send;

    fn list_models(
        &self,
        models_url: &str,
        api_key: &str,
    ) -> impl std::future::Future<Output = Result<Vec<String>>> + Send;
}

#[derive(Debug, Clone, Default)]
pub struct ReqwestGatewayHttp {
    pub client: reqwest::Client,
}

impl ReqwestGatewayHttp {
    pub fn new() -> Self {
        Self {
            client: reqwest::Client::builder()
                .timeout(std::time::Duration::from_secs(30))
                .build()
                .unwrap_or_default(),
        }
    }
}

impl GatewayHttp for ReqwestGatewayHttp {
    async fn exchange_gateway_key(
        &self,
        exchange_url: &str,
        access_token: &str,
    ) -> Result<GatewayKeyResponse> {
        let resp = self
            .client
            .post(exchange_url)
            .bearer_auth(access_token)
            .json(&serde_json::json!({ "client": "sacode" }))
            .send()
            .await
            .with_context(|| format!("POST {exchange_url}"))?;
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        if !status.is_success() {
            let snippet: String = body.chars().take(200).collect();
            anyhow::bail!("gateway key exchange failed: HTTP {status}: {snippet}");
        }
        let parsed: GatewayKeyResponse =
            serde_json::from_str(&body).context("parse gateway key response")?;
        if parsed.api_key.trim().is_empty() {
            anyhow::bail!("gateway key response missing api_key");
        }
        Ok(parsed)
    }

    async fn list_models(&self, models_url: &str, api_key: &str) -> Result<Vec<String>> {
        let resp = self
            .client
            .get(models_url)
            .bearer_auth(api_key)
            .send()
            .await
            .with_context(|| format!("GET {models_url}"))?;
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        if !status.is_success() {
            let snippet: String = body.chars().take(200).collect();
            anyhow::bail!("gateway models failed: HTTP {status}: {snippet}");
        }
        let parsed: ModelsListResponse =
            serde_json::from_str(&body).context("parse /v1/models response")?;
        Ok(parsed
            .data
            .into_iter()
            .map(|m| m.id)
            .filter(|id| !id.trim().is_empty())
            .collect())
    }
}

pub fn build_exchange_url(gateway_base: &str) -> String {
    format!(
        "{}{}",
        gateway_base.trim_end_matches('/'),
        GATEWAY_KEY_EXCHANGE_PATH
    )
}

pub fn build_models_url(gateway_base: &str) -> String {
    format!(
        "{}{}",
        gateway_base.trim_end_matches('/'),
        GATEWAY_MODELS_PATH
    )
}

pub fn pick_default_model(models: &[String]) -> Option<String> {
    if models.is_empty() {
        return None;
    }
    // Prefer chat-like models if present, else first entry.
    let preferred = models.iter().find(|m| {
        let lower = m.to_lowercase();
        lower.contains("chat") || lower.contains("instruct") || lower.starts_with("gpt")
    });
    Some(preferred.cloned().unwrap_or_else(|| models[0].clone()))
}

pub fn validate_gateway_key(api_key: &str) -> Result<()> {
    if api_key.trim().is_empty() {
        return Err(anyhow!("gateway api_key is empty"));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn urls_use_constants() {
        assert_eq!(
            build_exchange_url("https://gw.example.com/"),
            "https://gw.example.com/api/auth/exchange"
        );
        assert_eq!(
            build_models_url("https://gw.example.com"),
            "https://gw.example.com/v1/models"
        );
    }

    #[test]
    fn default_model_prefers_chat() {
        let models = vec![
            "embed-only".to_string(),
            "deepseek-chat".to_string(),
            "other".to_string(),
        ];
        assert_eq!(
            pick_default_model(&models).as_deref(),
            Some("deepseek-chat")
        );
        assert_eq!(pick_default_model(&["a".into()]).as_deref(), Some("a"));
        assert_eq!(pick_default_model(&[]), None);
    }
}
