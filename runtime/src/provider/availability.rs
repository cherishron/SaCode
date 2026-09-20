use std::time::Duration;

use reqwest::Client;
use sacode_kernel::model::{
    ChatMessage, ChatRequest, ModelProvider, ProviderValidationSnapshot, ProviderValidationStatus,
};
use serde::Deserialize;

use super::{client::resolved_api_key, ProviderClient, ProviderClientError};

const DEFAULT_VALIDATION_TIMEOUT_MS: u64 = 10_000;

#[derive(Debug)]
pub struct ProviderAvailabilityService {
    timeout: Duration,
    client: ProviderClient,
    http: Client,
}

impl ProviderAvailabilityService {
    pub fn new(timeout_ms: u64) -> Self {
        let timeout = Duration::from_millis(timeout_ms.max(1));
        Self {
            timeout,
            client: ProviderClient::with_timeout(timeout),
            http: Client::builder()
                .timeout(timeout)
                .build()
                .unwrap_or_else(|_| Client::new()),
        }
    }

    pub async fn validate(&self, provider: &ModelProvider) -> ProviderValidationSnapshot {
        let checked_at = Some(chrono::Utc::now().to_rfc3339());
        let model = Some(provider.model.clone());
        let available_models = self.fetch_models(provider).await.unwrap_or_default();
        let request = validation_request(provider);
        let result = tokio::time::timeout(self.timeout, self.client.chat(provider, request)).await;

        match result {
            Ok(Ok(_)) => ProviderValidationSnapshot {
                status: ProviderValidationStatus::Available,
                checked_at,
                model,
                failure: None,
                available_models,
                ..Default::default()
            },
            Ok(Err(error)) => {
                let failure = error
                    .downcast_ref::<ProviderClientError>()
                    .map(|value| value.failure.clone())
                    .unwrap_or_else(|| {
                        ProviderClientError::invalid_response("provider/validation_failed").failure
                    });
                ProviderValidationSnapshot {
                    status: ProviderValidationStatus::Unavailable,
                    checked_at,
                    model,
                    failure: Some(failure),
                    available_models,
                    ..Default::default()
                }
            }
            Err(_) => ProviderValidationSnapshot {
                status: ProviderValidationStatus::Unavailable,
                checked_at,
                model,
                failure: Some(ProviderClientError::network_timeout().failure),
                available_models,
                ..Default::default()
            },
        }
    }

    pub fn validate_blocking(&self, provider: &ModelProvider) -> ProviderValidationSnapshot {
        let checked_at = Some(chrono::Utc::now().to_rfc3339());
        let model = Some(provider.model.clone());
        let available_models = self.fetch_models_blocking(provider).unwrap_or_default();
        let base_url = provider
            .base_url
            .as_deref()
            .unwrap_or_default()
            .trim_end_matches('/');
        let client = self.blocking_client();
        let mut request = client
            .post(format!("{base_url}/chat/completions"))
            .json(&validation_request(provider));
        if let Some(key) = resolved_api_key(provider) {
            request = request.bearer_auth(key);
        }
        let result = request.send().map_err(ProviderClientError::from_transport);
        let failure = match result {
            Ok(response) if response.status().is_success() => {
                match response.json::<sacode_kernel::model::ChatResponse>() {
                    Ok(_) => None,
                    Err(_) => {
                        Some(ProviderClientError::invalid_response("provider/invalid_json").failure)
                    }
                }
            }
            Ok(response) => {
                let status = response.status();
                let headers = response.headers().clone();
                let body = response.text().unwrap_or_default();
                Some(ProviderClientError::from_http(status, &headers, &body).failure)
            }
            Err(error) => Some(error.failure),
        };
        ProviderValidationSnapshot {
            status: if failure.is_none() {
                ProviderValidationStatus::Available
            } else {
                ProviderValidationStatus::Unavailable
            },
            checked_at,
            model,
            failure,
            available_models,
            ..Default::default()
        }
    }

    pub fn discover_models_blocking(
        &self,
        provider: &ModelProvider,
    ) -> Result<Vec<String>, ProviderClientError> {
        self.fetch_models_blocking(provider)
    }

    async fn fetch_models(
        &self,
        provider: &ModelProvider,
    ) -> Result<Vec<String>, ProviderClientError> {
        let base_url = provider
            .base_url
            .as_deref()
            .unwrap_or_default()
            .trim_end_matches('/');
        if base_url.is_empty() {
            return Ok(Vec::new());
        }
        let mut request = self.http.get(format!("{base_url}/models"));
        if let Some(key) = resolved_api_key(provider) {
            request = request.bearer_auth(key);
        }
        let response = request
            .send()
            .await
            .map_err(ProviderClientError::from_transport)?;
        let status = response.status();
        if !status.is_success() {
            let headers = response.headers().clone();
            let body = response.text().await.unwrap_or_default();
            return Err(ProviderClientError::from_http(status, &headers, &body));
        }
        let payload: ModelsResponse = response
            .json()
            .await
            .map_err(|_| ProviderClientError::invalid_response("provider/invalid_models_json"))?;
        let mut models = payload
            .data
            .into_iter()
            .map(|item| item.id)
            .filter(|id| !id.trim().is_empty())
            .collect::<Vec<_>>();
        models.sort();
        models.dedup();
        Ok(models)
    }

    fn fetch_models_blocking(
        &self,
        provider: &ModelProvider,
    ) -> Result<Vec<String>, ProviderClientError> {
        let base_url = provider
            .base_url
            .as_deref()
            .unwrap_or_default()
            .trim_end_matches('/');
        if base_url.is_empty() {
            return Ok(Vec::new());
        }
        let client = self.blocking_client();
        let mut request = client.get(format!("{base_url}/models"));
        if let Some(key) = resolved_api_key(provider) {
            request = request.bearer_auth(key);
        }
        let response = request
            .send()
            .map_err(ProviderClientError::from_transport)?;
        let status = response.status();
        if !status.is_success() {
            let headers = response.headers().clone();
            let body = response.text().unwrap_or_default();
            return Err(ProviderClientError::from_http(status, &headers, &body));
        }
        let payload: ModelsResponse = response
            .json()
            .map_err(|_| ProviderClientError::invalid_response("provider/invalid_models_json"))?;
        Ok(normalize_models(payload))
    }

    fn blocking_client(&self) -> reqwest::blocking::Client {
        reqwest::blocking::Client::builder()
            .timeout(self.timeout)
            .build()
            .unwrap_or_else(|_| reqwest::blocking::Client::new())
    }
}

impl Default for ProviderAvailabilityService {
    fn default() -> Self {
        Self::new(DEFAULT_VALIDATION_TIMEOUT_MS)
    }
}

fn validation_request(provider: &ModelProvider) -> ChatRequest {
    let mut request = ChatRequest::new(
        provider.model.clone(),
        vec![ChatMessage::user("Reply with OK.")],
    );
    request.temperature = Some(0.0);
    request.max_tokens = Some(1);
    request
}

#[derive(Debug, Deserialize)]
struct ModelsResponse {
    #[serde(default)]
    data: Vec<ModelItem>,
}

#[derive(Debug, Deserialize)]
struct ModelItem {
    id: String,
}

fn normalize_models(payload: ModelsResponse) -> Vec<String> {
    let mut models = payload
        .data
        .into_iter()
        .map(|item| item.id)
        .filter(|id| !id.trim().is_empty())
        .collect::<Vec<_>>();
    models.sort();
    models.dedup();
    models
}

#[cfg(test)]
mod tests {
    use axum::{
        extract::State,
        http::StatusCode,
        response::IntoResponse,
        routing::{get, post},
        Json, Router,
    };
    use sacode_kernel::model::{ProviderFailureCategory, ProviderKind};
    use serde_json::json;

    use super::*;

    #[derive(Clone)]
    struct TestState {
        chat_status: StatusCode,
        chat_body: serde_json::Value,
        delay_ms: u64,
    }

    async fn models() -> impl IntoResponse {
        Json(json!({"data": [{"id": "model-b"}, {"id": "model-a"}]}))
    }

    async fn chat(State(state): State<TestState>) -> impl IntoResponse {
        if state.delay_ms > 0 {
            tokio::time::sleep(Duration::from_millis(state.delay_ms)).await;
        }
        (state.chat_status, Json(state.chat_body))
    }

    async fn server(state: TestState) -> String {
        let app = Router::new()
            .route("/v1/models", get(models))
            .route("/v1/chat/completions", post(chat))
            .with_state(state);
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
            .await
            .expect("bind test server");
        let address = listener.local_addr().expect("test server address");
        tokio::spawn(async move {
            axum::serve(listener, app).await.expect("serve test app");
        });
        format!("http://{address}/v1")
    }

    fn provider(base_url: String) -> ModelProvider {
        ModelProvider {
            kind: ProviderKind::Custom("test".to_string()),
            model: "model-a".to_string(),
            base_url: Some(base_url),
            api_key: Some("secret-never-log".to_string()),
            rule: None,
            auth_header: None,
            auth_scheme: None,
        }
    }

    #[tokio::test]
    async fn validates_target_model_with_real_chat_response() {
        let base_url = server(TestState {
            chat_status: StatusCode::OK,
            chat_body: json!({
                "id": "test",
                "model": "model-a",
                "choices": [{"index": 0, "message": {"role": "assistant", "content": "OK"}, "finish_reason": "stop"}],
                "usage": null
            }),
            delay_ms: 0,
        })
        .await;
        let snapshot = ProviderAvailabilityService::new(1_000)
            .validate(&provider(base_url))
            .await;
        assert_eq!(snapshot.status, ProviderValidationStatus::Available);
        assert_eq!(snapshot.available_models, vec!["model-a", "model-b"]);
        assert!(snapshot.failure.is_none());
    }

    #[tokio::test]
    async fn model_list_does_not_hide_chat_authentication_failure() {
        let base_url = server(TestState {
            chat_status: StatusCode::UNAUTHORIZED,
            chat_body: json!({"error": {"code": "invalid_api_key", "message": "secret-never-log"}}),
            delay_ms: 0,
        })
        .await;
        let snapshot = ProviderAvailabilityService::new(1_000)
            .validate(&provider(base_url))
            .await;
        assert_eq!(snapshot.status, ProviderValidationStatus::Unavailable);
        assert_eq!(
            snapshot.failure.as_ref().map(|failure| failure.category),
            Some(ProviderFailureCategory::Authentication)
        );
        assert!(!serde_json::to_string(&snapshot)
            .expect("serialize snapshot")
            .contains("secret-never-log"));
    }

    #[tokio::test]
    async fn validation_timeout_is_network_failure() {
        let base_url = server(TestState {
            chat_status: StatusCode::OK,
            chat_body: json!({}),
            delay_ms: 100,
        })
        .await;
        let snapshot = ProviderAvailabilityService::new(20)
            .validate(&provider(base_url))
            .await;
        assert_eq!(snapshot.status, ProviderValidationStatus::Unavailable);
        assert_eq!(
            snapshot.failure.as_ref().map(|failure| failure.category),
            Some(ProviderFailureCategory::Network)
        );
    }
}
