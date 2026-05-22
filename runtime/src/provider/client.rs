use anyhow::Result;
use reqwest::Client;
use sacode_kernel::model::{ChatRequest, ChatResponse, ChatMessage, ModelProvider, ProviderKind};

const DEFAULT_TIMEOUT: u64 = 30;

#[derive(Debug)]
pub struct ProviderClient {
    http: Client,
}

#[derive(Debug, Clone)]
pub struct StreamChunk {
    pub content: String,
    pub done: bool,
}

impl ProviderClient {
    pub fn new() -> Self {
        Self {
            http: Client::builder()
                .timeout(std::time::Duration::from_secs(DEFAULT_TIMEOUT))
                .build()
                .unwrap_or_else(|_| Client::new()),
        }
    }

    pub async fn chat(&self, provider: &ModelProvider, request: ChatRequest) -> Result<ChatResponse> {
        let base_url = provider.base_url.clone().unwrap_or_else(|| default_base_url(&provider.kind));
        let url = format!("{}/chat/completions", base_url);

        let api_key = provider.api_key.clone()
            .or_else(|| env_key(&provider.kind));

        let mut builder = self.http.post(&url).json(&request);

        if let Some(key) = api_key {
            builder = builder.header("Authorization", format!("Bearer {}", key));
        }

        let response = builder.send().await?;
        let status = response.status();

        if !status.is_success() {
            let text = response.text().await?;
            anyhow::bail!("Provider error ({}): {}", status, text);
        }

        let chat_response: ChatResponse = response.json().await?;
        Ok(chat_response)
    }

    pub async fn simple_chat(&self, provider: &ModelProvider, prompt: &str) -> Result<String> {
        let request = ChatRequest::simple(&provider.model, prompt);
        let response = self.chat(provider, request).await?;

        response.choices
            .first()
            .map(|c| c.message.content.clone())
            .ok_or_else(|| anyhow::anyhow!("No response from provider"))
    }

    pub async fn stream_chat(&self, provider: &ModelProvider, prompt: &str) -> Result<Vec<StreamChunk>> {
        let base_url = provider.base_url.clone().unwrap_or_else(|| default_base_url(&provider.kind));
        let url = format!("{}/chat/completions", base_url);

        let api_key = provider.api_key.clone()
            .or_else(|| env_key(&provider.kind));

        let request = ChatRequest {
            model: provider.model.clone(),
            messages: vec![ChatMessage::user(prompt)],
            temperature: Some(0.7),
            max_tokens: None,
            stream: true,
        };

        let mut builder = self.http.post(&url).json(&request);

        if let Some(key) = api_key {
            builder = builder.header("Authorization", format!("Bearer {}", key));
        }

        let response = builder.send().await?;
        let status = response.status();

        if !status.is_success() {
            let text = response.text().await?;
            anyhow::bail!("Provider error ({}): {}", status, text);
        }

        let body = response.text().await?;
        let mut chunks = Vec::new();

        for line in body.lines() {
            if line.starts_with("data: ") {
                let data = &line[6..];
                if data == "[DONE]" {
                    chunks.push(StreamChunk { content: String::new(), done: true });
                    break;
                }
                
                if let Ok(json) = serde_json::from_str::<serde_json::Value>(data) {
                    if let Some(choices) = json.get("choices").and_then(|c| c.as_array()) {
                        if let Some(choice) = choices.first() {
                            if let Some(delta) = choice.get("delta") {
                                if let Some(content) = delta.get("content").and_then(|c| c.as_str()) {
                                    chunks.push(StreamChunk { content: content.to_string(), done: false });
                                }
                            }
                        }
                    }
                }
            }
        }

        Ok(chunks)
    }
}

impl Default for ProviderClient {
    fn default() -> Self {
        Self::new()
    }
}

fn default_base_url(kind: &ProviderKind) -> String {
    match kind {
        ProviderKind::Openai => "https://api.openai.com/v1",
        ProviderKind::Deepseek => "https://api.deepseek.com/v1",
        ProviderKind::Ollama => "http://127.0.0.1:11434/v1",
        ProviderKind::Custom(_) => "",
    }.to_string()
}

fn env_key(kind: &ProviderKind) -> Option<String> {
    use std::env;
    match kind {
        ProviderKind::Openai => env::var("OPENAI_API_KEY").ok(),
        ProviderKind::Deepseek => env::var("DEEPSEEK_API_KEY").ok(),
        ProviderKind::Ollama => None,
        ProviderKind::Custom(_) => None,
    }
}