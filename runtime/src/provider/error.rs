use std::fmt;

use reqwest::{header::HeaderMap, StatusCode};
use sacode_kernel::model::{ProviderFailure, ProviderFailureCategory, ProviderRecoveryAction};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProviderClientError {
    pub failure: ProviderFailure,
    pub status_code: Option<u16>,
    pub provider_code: Option<String>,
}

impl ProviderClientError {
    pub fn network_timeout() -> Self {
        Self::new(
            ProviderFailureCategory::Network,
            "provider/network_timeout",
            true,
            ProviderRecoveryAction::CheckNetwork,
            "The provider request timed out. Check the network and endpoint, then retry.",
            None,
            None,
            None,
        )
    }

    pub fn from_transport(error: reqwest::Error) -> Self {
        if error.is_timeout() {
            return Self::network_timeout();
        }
        let (code, message) = if error.is_connect() {
            (
                "provider/network_unreachable",
                "The provider could not be reached. Check the network, DNS, TLS, and endpoint.",
            )
        } else {
            (
                "provider/network",
                "The provider request failed before a response was received. Check the network and endpoint.",
            )
        };
        Self::new(
            ProviderFailureCategory::Network,
            code,
            true,
            ProviderRecoveryAction::CheckNetwork,
            message,
            None,
            None,
            None,
        )
    }

    pub fn from_http(status: StatusCode, headers: &HeaderMap, body: &str) -> Self {
        let provider_code = extract_provider_code(body);
        let lower = body.to_ascii_lowercase();
        let retry_after_secs = parse_retry_after(headers);
        if status == StatusCode::UNAUTHORIZED
            || (status == StatusCode::FORBIDDEN
                && contains_any(
                    &lower,
                    &["api key", "credential", "authentication", "unauthorized"],
                ))
        {
            return Self::new(
                ProviderFailureCategory::Authentication,
                "provider/authentication",
                false,
                ProviderRecoveryAction::ReenterCredential,
                "Provider authentication failed. Check the configured credential and account permissions.",
                Some(status.as_u16()),
                provider_code,
                None,
            );
        }
        if status == StatusCode::TOO_MANY_REQUESTS
            || contains_any(
                &lower,
                &[
                    "rate limit",
                    "quota",
                    "resource exhausted",
                    "insufficient quota",
                ],
            )
        {
            return Self::new(
                ProviderFailureCategory::QuotaOrRateLimit,
                "provider/quota_or_rate_limit",
                true,
                ProviderRecoveryAction::CheckQuota,
                "Provider quota or rate limit was reached. Wait for the advised interval or review the account quota.",
                Some(status.as_u16()),
                provider_code,
                retry_after_secs,
            );
        }
        if is_model_failure(status, &lower, provider_code.as_deref()) {
            return Self::new(
                ProviderFailureCategory::ModelUnavailable,
                "provider/model_unavailable",
                false,
                ProviderRecoveryAction::SelectModel,
                "The selected model is unavailable or not accessible. Select a model allowed for this credential.",
                Some(status.as_u16()),
                provider_code,
                None,
            );
        }
        Self::new(
            ProviderFailureCategory::Service,
            "provider/service",
            status.is_server_error(),
            ProviderRecoveryAction::RetryLater,
            "The provider returned an unexpected service response. Retry later or verify the endpoint.",
            Some(status.as_u16()),
            provider_code,
            retry_after_secs,
        )
    }

    pub fn invalid_response(code: &'static str) -> Self {
        Self::new(
            ProviderFailureCategory::Service,
            code,
            true,
            ProviderRecoveryAction::RetryLater,
            "The provider returned an invalid response. Retry later or verify the endpoint compatibility.",
            None,
            None,
            None,
        )
    }

    #[allow(clippy::too_many_arguments)]
    fn new(
        category: ProviderFailureCategory,
        code: impl Into<String>,
        retryable: bool,
        action: ProviderRecoveryAction,
        safe_message: impl Into<String>,
        status_code: Option<u16>,
        provider_code: Option<String>,
        retry_after_secs: Option<u64>,
    ) -> Self {
        Self {
            failure: ProviderFailure {
                category,
                code: code.into(),
                retryable,
                action,
                safe_message: safe_message.into(),
                retry_after_secs,
            },
            status_code,
            provider_code,
        }
    }
}

impl fmt::Display for ProviderClientError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            formatter,
            "{}: {}",
            self.failure.code, self.failure.safe_message
        )
    }
}

impl std::error::Error for ProviderClientError {}

fn is_model_failure(status: StatusCode, body: &str, provider_code: Option<&str>) -> bool {
    let code = provider_code.unwrap_or_default().to_ascii_lowercase();
    let mentions_model = contains_any(body, &["model", "deployment"])
        || contains_any(&code, &["model", "deployment"]);
    (status == StatusCode::NOT_FOUND || status == StatusCode::FORBIDDEN) && mentions_model
        || contains_any(
            body,
            &[
                "model not found",
                "model unavailable",
                "unknown model",
                "model does not exist",
                "no access to model",
            ],
        )
}

fn extract_provider_code(body: &str) -> Option<String> {
    let value: serde_json::Value = serde_json::from_str(body).ok()?;
    let error = value.get("error").unwrap_or(&value);
    for key in ["code", "type"] {
        if let Some(code) = error.get(key).and_then(serde_json::Value::as_str) {
            let code = code.trim();
            if !code.is_empty() {
                return Some(code.chars().take(128).collect());
            }
        }
    }
    None
}

fn parse_retry_after(headers: &HeaderMap) -> Option<u64> {
    headers
        .get(reqwest::header::RETRY_AFTER)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.trim().parse::<u64>().ok())
}

fn contains_any(value: &str, patterns: &[&str]) -> bool {
    patterns.iter().any(|pattern| value.contains(pattern))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn maps_http_provider_failures_without_exposing_body() {
        let mut headers = HeaderMap::new();
        headers.insert(reqwest::header::RETRY_AFTER, "17".parse().expect("header"));
        let cases = [
            (
                StatusCode::UNAUTHORIZED,
                r#"{"error":{"code":"invalid_api_key","message":"sk-never-leak"}}"#,
                ProviderFailureCategory::Authentication,
                "provider/authentication",
            ),
            (
                StatusCode::TOO_MANY_REQUESTS,
                r#"{"error":{"code":"rate_limit_exceeded"}}"#,
                ProviderFailureCategory::QuotaOrRateLimit,
                "provider/quota_or_rate_limit",
            ),
            (
                StatusCode::NOT_FOUND,
                r#"{"error":{"code":"model_not_found","message":"model not found"}}"#,
                ProviderFailureCategory::ModelUnavailable,
                "provider/model_unavailable",
            ),
            (
                StatusCode::BAD_GATEWAY,
                "upstream failed",
                ProviderFailureCategory::Service,
                "provider/service",
            ),
        ];
        for (status, body, category, code) in cases {
            let error = ProviderClientError::from_http(status, &headers, body);
            assert_eq!(error.failure.category, category);
            assert_eq!(error.failure.code, code);
            assert!(!error.to_string().contains("sk-never-leak"));
        }
        let limited =
            ProviderClientError::from_http(StatusCode::TOO_MANY_REQUESTS, &headers, "quota");
        assert_eq!(limited.failure.retry_after_secs, Some(17));
    }

    #[test]
    fn plain_404_endpoint_error_is_service_not_model() {
        let error = ProviderClientError::from_http(
            StatusCode::NOT_FOUND,
            &HeaderMap::new(),
            "route not found",
        );
        assert_eq!(error.failure.category, ProviderFailureCategory::Service);
    }
}
