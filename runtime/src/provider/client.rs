use anyhow::Result;
use reqwest::Client;
use sacode_kernel::model::{ChatMessage, ChatRequest, ChatResponse, ChatUsage, ModelProvider, ProviderKind, ThinkingConfig, ToolDefinition};

const DEFAULT_TIMEOUT: u64 = 30;
const MAX_TOOL_ROUNDS: usize = 12;

#[derive(Debug)]
pub struct ProviderClient {
    http: Client,
}

#[derive(Debug, Clone)]
pub struct StreamChunk {
    pub content: String,
    pub done: bool,
}

#[derive(Debug, Clone)]
pub struct ToolChatResult {
    pub messages: Vec<ChatMessage>,
    pub final_text: String,
    pub reasoning_content: Option<String>,
    pub tool_calls_made: usize,
    pub rounds: usize,
    pub usage: Option<ChatUsage>,
    pub pending_question: Option<serde_json::Value>,
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
        self.simple_chat_with_usage(provider, prompt)
            .await
            .map(|result| result.0)
    }

    pub async fn simple_chat_with_usage(&self, provider: &ModelProvider, prompt: &str) -> Result<(String, Option<ChatUsage>)> {
        let request = build_request(provider, vec![ChatMessage::user(prompt)], None, false);
        let response = self.chat(provider, request).await?;
        let usage = response.usage.clone();

        response.choices
            .first()
            .map(|c| c.message.text().unwrap_or_default().to_string())
            .map(|content| (content, usage))
            .ok_or_else(|| anyhow::anyhow!("No response from provider"))
    }

    pub async fn simple_chat_messages_with_usage(&self, provider: &ModelProvider, messages: Vec<ChatMessage>) -> Result<(String, Option<ChatUsage>)> {
        let request = build_request(provider, messages, None, false);
        let response = self.chat(provider, request).await?;
        let usage = response.usage.clone();

        response.choices
            .first()
            .map(|c| c.message.text().unwrap_or_default().to_string())
            .map(|content| (content, usage))
            .ok_or_else(|| anyhow::anyhow!("No response from provider"))
    }

    pub async fn tool_chat<F>(
        &self,
        provider: &ModelProvider,
        system_prompt: &str,
        user_prompt: &str,
        tools: Vec<ToolDefinition>,
        tool_executor: F,
    ) -> Result<ToolChatResult>
    where
        F: Fn(&str, &serde_json::Value) -> Result<serde_json::Value>,
    {
        let mut messages = vec![
            ChatMessage::system(system_prompt),
            ChatMessage::user(user_prompt),
        ];
        let mut tool_calls_made = 0;
        let mut rounds = 0;
        let mut last_tool_outputs: Vec<(String, serde_json::Value)> = Vec::new();
        let mut usage = ChatUsage {
            prompt_tokens: 0,
            completion_tokens: 0,
            total_tokens: 0,
        };
        let mut has_usage = false;
        for _ in 0..MAX_TOOL_ROUNDS {
            rounds += 1;
            let request = build_request(provider, messages.clone(), Some(tools.clone()), false);

            let response = self.chat(provider, request).await?;
            if let Some(round_usage) = response.usage.clone() {
                usage.prompt_tokens += round_usage.prompt_tokens;
                usage.completion_tokens += round_usage.completion_tokens;
                usage.total_tokens += round_usage.total_tokens;
                has_usage = true;
            }

            let assistant_msg = response.choices
                .first()
                .map(|c| c.message.clone())
                .ok_or_else(|| anyhow::anyhow!("No response from provider in round {}", rounds))?;

            if !assistant_msg.has_tool_calls() {
                let final_text = assistant_msg.text().unwrap_or_default().to_string();
                let reasoning = assistant_msg.reasoning_content.clone();
                messages.push(assistant_msg);
                let final_text = if final_text.trim().is_empty() {
                    summarize_tool_outputs(&last_tool_outputs)
                        .unwrap_or_else(|| "模型未返回最终内容，但工具调用已完成。".to_string())
                } else {
                    final_text
                };
                return Ok(ToolChatResult {
                    messages,
                    final_text,
                    reasoning_content: reasoning,
                    tool_calls_made,
                    rounds,
                    usage: has_usage.then_some(usage),
                    pending_question: None,
                });
            }

            let tool_calls = assistant_msg.tool_calls.clone().unwrap();
            messages.push(assistant_msg);

            for tool_call in &tool_calls {
                tool_calls_made += 1;
                let args: serde_json::Value = serde_json::from_str(&tool_call.function.arguments)
                    .unwrap_or_else(|_| serde_json::json!({}));

                let tool_result = tool_executor(&tool_call.function.name, &args);
                let pending_question = if tool_call.function.name == "interaction.ask" {
                    tool_result
                        .as_ref()
                        .ok()
                        .filter(|data| data.get("pending").and_then(|value| value.as_bool()) == Some(true))
                        .cloned()
                } else {
                    None
                };

                let result_content = match tool_result {
                    Ok(data) => {
                        last_tool_outputs.push((tool_call.function.name.clone(), data.clone()));
                        serde_json::to_string(&data).unwrap_or_else(|_| "{}".to_string())
                    }
                    Err(error) => serde_json::json!({ "error": error.to_string() }).to_string(),
                };

                messages.push(ChatMessage::tool_result_named(
                    &tool_call.id,
                    &tool_call.function.name,
                    result_content,
                ));

                if let Some(pending_question) = pending_question {
                    let reasoning = messages.iter().rev().find_map(|m| m.reasoning_content.clone());
                    return Ok(ToolChatResult {
                        messages,
                        final_text: "需要用户回答后继续执行。".to_string(),
                        reasoning_content: reasoning,
                        tool_calls_made,
                        rounds,
                        usage: has_usage.then_some(usage),
                        pending_question: Some(pending_question),
                    });
                }
            }
        }

        let final_text = messages.last()
            .and_then(|m| m.text().map(|text| text.to_string()))
            .unwrap_or_default();
        let reasoning = messages.iter().rev().find_map(|m| m.reasoning_content.clone());
        let fallback_text = summarize_tool_outputs(&last_tool_outputs)
            .unwrap_or_else(|| format!("达到最大工具调用轮数 {}，已执行 {} 次工具调用", MAX_TOOL_ROUNDS, tool_calls_made));

        Ok(ToolChatResult {
            messages,
            final_text: if final_text.is_empty() {
                fallback_text
            } else {
                final_text
            },
            reasoning_content: reasoning,
            tool_calls_made,
            rounds,
            usage: has_usage.then_some(usage),
            pending_question: None,
        })
    }

    pub async fn stream_chat(&self, provider: &ModelProvider, prompt: &str) -> Result<Vec<StreamChunk>> {
        let base_url = provider.base_url.clone().unwrap_or_else(|| default_base_url(&provider.kind));
        let url = format!("{}/chat/completions", base_url);

        let api_key = provider.api_key.clone()
            .or_else(|| env_key(&provider.kind));

        let request = build_request(provider, vec![ChatMessage::user(prompt)], None, true);

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
                                if let Some(reasoning) = delta.get("reasoning_content").and_then(|c| c.as_str()) {
                                    chunks.push(StreamChunk { content: format!("[思考] {}", reasoning), done: false });
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

fn summarize_tool_outputs(outputs: &[(String, serde_json::Value)]) -> Option<String> {
    let mut lines = Vec::new();

    for (name, value) in outputs.iter().rev() {
        if let Some(text) = extract_tool_text(value) {
            lines.push(format!("[{}]\n{}", name, text));
        } else if let Some(error) = value.get("error").and_then(|item| item.as_str()) {
            lines.push(format!("[{}]\n错误: {}", name, error));
        }

        if lines.len() >= 3 {
            break;
        }
    }

    if lines.is_empty() {
        None
    } else {
        Some(lines.into_iter().rev().collect::<Vec<_>>().join("\n\n"))
    }
}

fn extract_tool_text(value: &serde_json::Value) -> Option<String> {
    for key in ["final_text", "text", "body", "content"] {
        if let Some(text) = value.get(key).and_then(|item| item.as_str()) {
            let trimmed = text.trim();
            if !trimmed.is_empty() {
                return Some(trimmed.to_string());
            }
        }
    }

    if let Some(results) = value.get("results").and_then(|item| item.as_array()) {
        let summary = results
            .iter()
            .take(3)
            .enumerate()
            .map(|(index, item)| {
                let title = item.get("title").and_then(|value| value.as_str()).unwrap_or("Untitled");
                let url = item.get("url").and_then(|value| value.as_str()).unwrap_or("");
                let snippet = item.get("snippet").and_then(|value| value.as_str()).unwrap_or("");
                format!("{}. {}\nURL: {}\n{}", index + 1, title, url, snippet)
            })
            .collect::<Vec<_>>()
            .join("\n\n");
        if !summary.is_empty() {
            return Some(summary);
        }
    }

    None
}

fn build_request(
    provider: &ModelProvider,
    messages: Vec<ChatMessage>,
    tools: Option<Vec<ToolDefinition>>,
    stream: bool,
) -> ChatRequest {
    let rule = provider.rule.as_ref();
    let thinking = if provider.needs_thinking() {
        Some(match rule.and_then(|r| r.reasoning_effort.clone()) {
            Some(effort) => ThinkingConfig::with_effort(effort),
            None => ThinkingConfig::enabled(),
        })
    } else {
        None
    };
    let reasoning_effort = rule.and_then(|r| r.reasoning_effort.clone());
    let temperature = rule.and_then(|r| r.effective_temperature()).or_else(|| if thinking.is_none() { Some(0.7) } else { None });
    let top_p = rule.and_then(|r| r.effective_top_p());
    let max_tokens = rule.and_then(|r| r.limit.as_ref().map(|limit| limit.output));

    ChatRequest {
        model: provider.model.clone(),
        messages,
        tools,
        temperature,
        top_p,
        max_tokens,
        stream,
        thinking,
        reasoning_effort,
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
        ProviderKind::Deepseek => "https://api.deepseek.com",
        ProviderKind::Mimo => "https://api.xiaomimimo.com/v1",
        ProviderKind::Longcat => "https://api.longcat.chat/openai/v1",
        ProviderKind::Ollama => "http://127.0.0.1:11434/v1",
        ProviderKind::Custom(_) => "",
    }.to_string()
}

fn env_key(kind: &ProviderKind) -> Option<String> {
    use std::env;
    match kind {
        ProviderKind::Openai => env::var("OPENAI_API_KEY").ok(),
        ProviderKind::Deepseek => env::var("DEEPSEEK_API_KEY").ok(),
        ProviderKind::Mimo => env::var("MIMO_API_KEY").ok(),
        ProviderKind::Longcat => env::var("LONGCAT_API_KEY").ok(),
        ProviderKind::Ollama => None,
        ProviderKind::Custom(_) => None,
    }
}

#[cfg(test)]
mod tests {
    use sacode_kernel::model::{ChatMessage, ChatRequest, ChatResponse, ToolDefinition};
    use super::{default_base_url, extract_tool_text, summarize_tool_outputs, ToolChatResult};

    #[test]
    fn default_base_url_matches_provider_kinds() {
        assert_eq!(default_base_url(&sacode_kernel::model::ProviderKind::Mimo), "https://api.xiaomimimo.com/v1");
        assert_eq!(default_base_url(&sacode_kernel::model::ProviderKind::Openai), "https://api.openai.com/v1");
        assert_eq!(default_base_url(&sacode_kernel::model::ProviderKind::Deepseek), "https://api.deepseek.com");
        assert_eq!(default_base_url(&sacode_kernel::model::ProviderKind::Longcat), "https://api.longcat.chat/openai/v1");
        assert_eq!(default_base_url(&sacode_kernel::model::ProviderKind::Ollama), "http://127.0.0.1:11434/v1");
        assert_eq!(default_base_url(&sacode_kernel::model::ProviderKind::Custom("other".to_string())), "");
    }

    #[test]
    fn chat_request_with_thinking_serializes_correctly() {
        let req = ChatRequest::with_thinking(
            "mimo-v2.5-pro",
            vec![ChatMessage::user("hello")],
            vec![ToolDefinition::function(
                "fs.read",
                "read file",
                serde_json::json!({"type": "object"}),
            )],
            None,
        );
        let json = serde_json::to_string(&req).unwrap();
        assert!(json.contains("\"thinking\""));
        assert!(json.contains("\"type\":\"enabled\""));
        assert!(json.contains("\"tools\""));
        assert!(json.contains("\"stream\":false"));
    }

    #[test]
    fn chat_request_simple_skips_optional_fields() {
        let req = ChatRequest::simple("gpt-4o-mini", "hello");
        let json = serde_json::to_string(&req).unwrap();
        assert!(!json.contains("\"thinking\""));
        assert!(!json.contains("\"tools\""));
    }

    #[test]
    fn chat_response_with_tool_calls_parses() {
        let json = r#"{
            "id": "chat-1",
            "model": "mimo-v2.5-pro",
            "choices": [{
                "index": 0,
                "message": {
                    "role": "assistant",
                    "content": null,
                    "reasoning_content": "I should read the file first",
                    "tool_calls": [{
                        "id": "call_001",
                        "type": "function",
                        "function": {
                            "name": "fs.read",
                            "arguments": "{\"path\":\"README.md\"}"
                        }
                    }]
                },
                "finish_reason": "tool_calls"
            }],
            "usage": {"prompt_tokens": 10, "completion_tokens": 20, "total_tokens": 30}
        }"#;
        let resp: ChatResponse = serde_json::from_str(json).unwrap();
        let msg = &resp.choices[0].message;
        assert!(msg.has_tool_calls());
        assert!(msg.has_reasoning());
        assert_eq!(msg.tool_calls.clone().unwrap()[0].function.name, "fs.read");
    }

    #[test]
    fn chat_response_with_reasoning_only_parses() {
        let json = r#"{
            "id": "chat-2",
            "model": "mimo-v2.5-pro",
            "choices": [{
                "index": 0,
                "message": {
                    "role": "assistant",
                    "content": "The file contains project info.",
                    "reasoning_content": "I analyzed the content"
                },
                "finish_reason": "stop"
            }],
            "usage": {"prompt_tokens": 5, "completion_tokens": 15, "total_tokens": 20}
        }"#;
        let resp: ChatResponse = serde_json::from_str(json).unwrap();
        let msg = &resp.choices[0].message;
        assert!(!msg.has_tool_calls());
        assert!(msg.has_reasoning());
        assert_eq!(msg.text().unwrap(), "The file contains project info.");
        assert_eq!(msg.reasoning_content.clone().unwrap(), "I analyzed the content");
    }

    #[test]
    fn tool_result_message_serializes_with_tool_call_id() {
        let msg = ChatMessage::tool_result_named("call_001", "fs.read", "file content here");
        let json = serde_json::to_string(&msg).unwrap();
        assert!(json.contains("\"tool_call_id\":\"call_001\""));
        assert!(json.contains("\"name\":\"fs.read\""));
        assert!(json.contains("\"role\":\"tool\""));
    }

    #[test]
    fn tool_chat_result_fields() {
        let result = ToolChatResult {
            messages: vec![ChatMessage::assistant("done")],
            final_text: "done".to_string(),
            reasoning_content: Some("thinking".to_string()),
            tool_calls_made: 2,
            rounds: 3,
            usage: None,
            pending_question: None,
        };
        assert_eq!(result.final_text, "done");
        assert_eq!(result.reasoning_content.unwrap(), "thinking");
        assert_eq!(result.tool_calls_made, 2);
        assert_eq!(result.rounds, 3);
    }

    #[test]
    fn extract_tool_text_prefers_final_text() {
        let value = serde_json::json!({
            "final_text": "page summary",
            "text": "fallback"
        });
        assert_eq!(extract_tool_text(&value).as_deref(), Some("page summary"));
    }

    #[test]
    fn summarize_tool_outputs_uses_recent_structured_results() {
        let summary = summarize_tool_outputs(&[
            (
                "web.search".to_string(),
                serde_json::json!({
                    "final_text": "1. Example\nURL: https://example.com\nSnippet"
                }),
            ),
            (
                "web.fetch".to_string(),
                serde_json::json!({
                    "text": "Fetched page text"
                }),
            ),
        ])
        .expect("summary");

        assert!(summary.contains("[web.search]"));
        assert!(summary.contains("[web.fetch]"));
        assert!(summary.contains("Fetched page text"));
    }
}
