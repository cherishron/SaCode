use anyhow::Result;
use reqwest::Client;
use sacode_kernel::model::{
    ChatMessage, ChatRequest, ChatResponse, ChatUsage, ModelProvider, ProviderKind, ThinkingConfig,
    ToolDefinition,
};
use std::collections::BTreeMap;

const DEFAULT_TIMEOUT: u64 = 30;
const MAX_TOOL_ROUNDS: usize = 12;
const TOOL_SUMMARY_MAX_CHARS: usize = 500;

#[derive(Debug)]
pub struct ProviderClient {
    http: Client,
}

#[derive(Debug, Clone)]
pub struct StreamChunk {
    pub kind: StreamChunkKind,
    pub content: String,
    pub done: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StreamChunkKind {
    Message,
    Thinking,
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
    pub hit_round_limit: bool,
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

    pub async fn chat(
        &self,
        provider: &ModelProvider,
        request: ChatRequest,
    ) -> Result<ChatResponse> {
        let base_url = provider
            .base_url
            .clone()
            .unwrap_or_else(|| default_base_url(&provider.kind));
        let url = format!("{}/chat/completions", base_url);

        let api_key = provider.api_key.clone().or_else(|| env_key(&provider.kind));

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

    pub async fn simple_chat_with_usage(
        &self,
        provider: &ModelProvider,
        prompt: &str,
    ) -> Result<(String, Option<ChatUsage>)> {
        let request = build_request(provider, vec![ChatMessage::user(prompt)], None, false);
        let response = self.chat(provider, request).await?;
        let usage = response.usage.clone();

        response
            .choices
            .first()
            .map(|c| c.message.text().unwrap_or_default().to_string())
            .map(|content| (content, usage))
            .ok_or_else(|| anyhow::anyhow!("No response from provider"))
    }

    pub async fn simple_chat_streaming_with_usage<F>(
        &self,
        provider: &ModelProvider,
        prompt: &str,
        mut on_chunk: F,
    ) -> Result<(String, Option<ChatUsage>)>
    where
        F: FnMut(&StreamChunk),
    {
        let mut chunks = Vec::new();
        let usage = self
            .stream_chat_with_callback(provider, prompt, |chunk| {
                on_chunk(chunk);
                chunks.push(chunk.clone());
            })
            .await?;
        let text = chunks
            .into_iter()
            .filter(|chunk| !chunk.done)
            .map(|chunk| chunk.content)
            .collect::<String>();
        Ok((text, usage))
    }

    pub async fn simple_chat_messages_with_usage(
        &self,
        provider: &ModelProvider,
        messages: Vec<ChatMessage>,
    ) -> Result<(String, Option<ChatUsage>)> {
        let request = build_request(provider, messages, None, false);
        let response = self.chat(provider, request).await?;
        let usage = response.usage.clone();

        response
            .choices
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
        max_tool_rounds: usize,
    ) -> Result<ToolChatResult>
    where
        F: Fn(&str, &serde_json::Value) -> Result<serde_json::Value>,
    {
        let mut noop = |_chunk: &StreamChunk| {};
        self.tool_chat_streaming(
            provider,
            system_prompt,
            user_prompt,
            tools,
            tool_executor,
            &mut noop,
            max_tool_rounds,
        )
        .await
    }

    pub async fn tool_chat_streaming<F, G>(
        &self,
        provider: &ModelProvider,
        system_prompt: &str,
        user_prompt: &str,
        tools: Vec<ToolDefinition>,
        tool_executor: F,
        on_chunk: &mut G,
        max_tool_rounds: usize,
    ) -> Result<ToolChatResult>
    where
        F: Fn(&str, &serde_json::Value) -> Result<serde_json::Value>,
        G: FnMut(&StreamChunk),
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
        let max_tool_rounds = max_tool_rounds.max(1).min(MAX_TOOL_ROUNDS);
        for _ in 0..max_tool_rounds {
            rounds += 1;
            let (assistant_msg, round_usage) = self
                .stream_round_with_callback(
                    provider,
                    messages.clone(),
                    Some(tools.clone()),
                    on_chunk,
                )
                .await?;
            if let Some(round_usage) = round_usage {
                usage.prompt_tokens += round_usage.prompt_tokens;
                usage.completion_tokens += round_usage.completion_tokens;
                usage.total_tokens += round_usage.total_tokens;
                has_usage = true;
            }

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
                    hit_round_limit: false,
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
                        .filter(|data| {
                            data.get("pending").and_then(|value| value.as_bool()) == Some(true)
                        })
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
                    let reasoning = messages
                        .iter()
                        .rev()
                        .find_map(|m| m.reasoning_content.clone());
                    return Ok(ToolChatResult {
                        messages,
                        final_text: "需要用户回答后继续执行。".to_string(),
                        reasoning_content: reasoning,
                        tool_calls_made,
                        rounds,
                        usage: has_usage.then_some(usage),
                        pending_question: Some(pending_question),
                        hit_round_limit: false,
                    });
                }
            }
        }

        let final_text = messages
            .last()
            .and_then(|m| m.text().map(|text| text.to_string()))
            .unwrap_or_default();
        let reasoning = messages
            .iter()
            .rev()
            .find_map(|m| m.reasoning_content.clone());
        let fallback_text = summarize_tool_outputs(&last_tool_outputs)
            .map(|summary| {
                format!(
                    "我已经完成当前可执行的 {} 轮工具调用，并整理出以下结果摘要。为了避免任务继续在循环中消耗上下文，我先在这里停止。\n\n{}",
                    max_tool_rounds, summary
                )
            })
            .unwrap_or_else(|| {
                format!(
                    "我已经达到最大工具调用轮数 {}，本次共执行 {} 次工具调用。当前循环已安全停止，请根据最近结果继续细化任务后重试。",
                    max_tool_rounds, tool_calls_made
                )
            });

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
            hit_round_limit: true,
        })
    }

    pub async fn stream_chat(
        &self,
        provider: &ModelProvider,
        prompt: &str,
    ) -> Result<Vec<StreamChunk>> {
        let mut chunks = Vec::new();
        self.stream_chat_with_callback(provider, prompt, |chunk| chunks.push(chunk.clone()))
            .await?;
        Ok(chunks)
    }

    pub async fn stream_chat_with_callback<F>(
        &self,
        provider: &ModelProvider,
        prompt: &str,
        mut on_chunk: F,
    ) -> Result<Option<ChatUsage>>
    where
        F: FnMut(&StreamChunk),
    {
        let base_url = provider
            .base_url
            .clone()
            .unwrap_or_else(|| default_base_url(&provider.kind));
        let url = format!("{}/chat/completions", base_url);

        let api_key = provider.api_key.clone().or_else(|| env_key(&provider.kind));

        let request = build_request(provider, vec![ChatMessage::user(prompt)], None, true);

        let mut builder = self.http.post(&url).json(&request);

        if let Some(key) = api_key {
            builder = builder.header("Authorization", format!("Bearer {}", key));
        }

        let mut response = builder.send().await?;
        let status = response.status();

        if !status.is_success() {
            let text = response.text().await?;
            anyhow::bail!("Provider error ({}): {}", status, text);
        }

        let mut usage = None;
        let mut pending = Vec::new();

        while let Some(bytes) = response.chunk().await? {
            pending.extend_from_slice(&bytes);

            while let Some(frame_end) = find_sse_frame_end(&pending) {
                let frame = String::from_utf8(pending[..frame_end].to_vec())?;
                pending.drain(..frame_end + 2);
                usage = handle_sse_frame(&frame, &mut on_chunk, usage)?;
            }
        }

        if !pending.is_empty() && pending.iter().any(|byte| !byte.is_ascii_whitespace()) {
            let frame = String::from_utf8(pending)?;
            usage = handle_sse_frame(&frame, &mut on_chunk, usage)?;
        }

        Ok(usage)
    }

    async fn stream_round_with_callback<F>(
        &self,
        provider: &ModelProvider,
        messages: Vec<ChatMessage>,
        tools: Option<Vec<ToolDefinition>>,
        on_chunk: &mut F,
    ) -> Result<(ChatMessage, Option<ChatUsage>)>
    where
        F: FnMut(&StreamChunk),
    {
        let base_url = provider
            .base_url
            .clone()
            .unwrap_or_else(|| default_base_url(&provider.kind));
        let url = format!("{}/chat/completions", base_url);

        let api_key = provider.api_key.clone().or_else(|| env_key(&provider.kind));
        let request = build_request(provider, messages, tools, true);

        let mut builder = self.http.post(&url).json(&request);
        if let Some(key) = api_key {
            builder = builder.header("Authorization", format!("Bearer {}", key));
        }

        let mut response = builder.send().await?;
        let status = response.status();

        if !status.is_success() {
            let text = response.text().await?;
            anyhow::bail!("Provider error ({}): {}", status, text);
        }

        let mut state = StreamRoundState::default();
        let mut pending = Vec::new();

        while let Some(bytes) = response.chunk().await? {
            pending.extend_from_slice(&bytes);

            while let Some(frame_end) = find_sse_frame_end(&pending) {
                let frame = String::from_utf8(pending[..frame_end].to_vec())?;
                pending.drain(..frame_end + 2);
                handle_stream_round_frame(&frame, &mut state, on_chunk)?;
            }
        }

        if !pending.is_empty() && pending.iter().any(|byte| !byte.is_ascii_whitespace()) {
            let frame = String::from_utf8(pending)?;
            handle_stream_round_frame(&frame, &mut state, on_chunk)?;
        }

        let usage = state.usage.clone();
        Ok((state.into_chat_message(), usage))
    }
}

#[derive(Debug, Default)]
struct StreamRoundState {
    content: String,
    reasoning_content: String,
    tool_calls: BTreeMap<usize, PartialToolCall>,
    usage: Option<ChatUsage>,
}

#[derive(Debug, Default)]
struct PartialToolCall {
    id: String,
    call_type: String,
    function_name: String,
    arguments: String,
}

impl StreamRoundState {
    fn into_chat_message(self) -> ChatMessage {
        let content = (!self.content.is_empty()).then_some(self.content);
        let reasoning_content =
            (!self.reasoning_content.is_empty()).then_some(self.reasoning_content);
        let tool_calls = (!self.tool_calls.is_empty()).then(|| {
            self.tool_calls
                .into_iter()
                .map(|(_, call)| sacode_kernel::model::ToolCall {
                    id: call.id,
                    call_type: if call.call_type.is_empty() {
                        "function".to_string()
                    } else {
                        call.call_type
                    },
                    function: sacode_kernel::model::FunctionCall {
                        name: call.function_name,
                        arguments: call.arguments,
                    },
                })
                .collect::<Vec<_>>()
        });
        ChatMessage::assistant_with_reasoning(content, reasoning_content, tool_calls)
    }
}

fn find_sse_frame_end(bytes: &[u8]) -> Option<usize> {
    bytes.windows(2).position(|window| window == b"\n\n")
}

fn handle_stream_round_frame<F>(
    frame: &str,
    state: &mut StreamRoundState,
    on_chunk: &mut F,
) -> Result<()>
where
    F: FnMut(&StreamChunk),
{
    for line in frame.lines() {
        if !line.starts_with("data: ") {
            continue;
        }

        let data = &line[6..];
        if data == "[DONE]" {
            on_chunk(&StreamChunk {
                kind: StreamChunkKind::Message,
                content: String::new(),
                done: true,
            });
            continue;
        }

        let json = match serde_json::from_str::<serde_json::Value>(data) {
            Ok(value) => value,
            Err(_) => continue,
        };

        if let Some(stream_usage) = json.get("usage") {
            state.usage = serde_json::from_value(stream_usage.clone())
                .ok()
                .or(state.usage.clone());
        }

        if let Some(choices) = json.get("choices").and_then(|c| c.as_array()) {
            if let Some(choice) = choices.first() {
                if let Some(delta) = choice.get("delta") {
                    append_stream_value(delta.get("content"), &mut state.content, false, on_chunk);
                    append_stream_value(
                        delta.get("reasoning_content"),
                        &mut state.reasoning_content,
                        true,
                        on_chunk,
                    );

                    if let Some(tool_calls) =
                        delta.get("tool_calls").and_then(|value| value.as_array())
                    {
                        for tool_call in tool_calls {
                            append_tool_call_delta(tool_call, &mut state.tool_calls);
                        }
                    }
                }
            }
        }
    }

    Ok(())
}

fn append_tool_call_delta(
    value: &serde_json::Value,
    tool_calls: &mut BTreeMap<usize, PartialToolCall>,
) {
    let index = value
        .get("index")
        .and_then(|item| item.as_u64())
        .and_then(|item| usize::try_from(item).ok())
        .unwrap_or(tool_calls.len());
    let entry = tool_calls.entry(index).or_default();

    if let Some(id) = value.get("id").and_then(|item| item.as_str()) {
        entry.id = id.to_string();
    }
    if let Some(call_type) = value.get("type").and_then(|item| item.as_str()) {
        entry.call_type = call_type.to_string();
    }
    if let Some(function) = value.get("function") {
        if let Some(name) = function.get("name").and_then(|item| item.as_str()) {
            entry.function_name = name.to_string();
        }
        if let Some(arguments) = function.get("arguments").and_then(|item| item.as_str()) {
            entry.arguments.push_str(arguments);
        }
    }
}

fn append_stream_value<F>(
    value: Option<&serde_json::Value>,
    target: &mut String,
    prefix_reasoning: bool,
    on_chunk: &mut F,
) where
    F: FnMut(&StreamChunk),
{
    let Some(value) = value else {
        return;
    };

    match value {
        serde_json::Value::String(text) => {
            append_stream_text(text, target, prefix_reasoning, on_chunk)
        }
        serde_json::Value::Array(parts) => {
            for part in parts {
                if let Some(text) = part.get("text").and_then(|item| item.as_str()) {
                    append_stream_text(text, target, prefix_reasoning, on_chunk);
                }
            }
        }
        _ => {}
    }
}

fn append_stream_text<F>(text: &str, target: &mut String, prefix_reasoning: bool, on_chunk: &mut F)
where
    F: FnMut(&StreamChunk),
{
    if text.is_empty() {
        return;
    }

    target.push_str(text);
    on_chunk(&StreamChunk {
        kind: if prefix_reasoning {
            StreamChunkKind::Thinking
        } else {
            StreamChunkKind::Message
        },
        content: text.to_string(),
        done: false,
    });
}

fn handle_sse_frame<F>(
    frame: &str,
    on_chunk: &mut F,
    mut usage: Option<ChatUsage>,
) -> Result<Option<ChatUsage>>
where
    F: FnMut(&StreamChunk),
{
    for line in frame.lines() {
        if !line.starts_with("data: ") {
            continue;
        }

        let data = &line[6..];
        if data == "[DONE]" {
            on_chunk(&StreamChunk {
                kind: StreamChunkKind::Message,
                content: String::new(),
                done: true,
            });
            continue;
        }

        let json = match serde_json::from_str::<serde_json::Value>(data) {
            Ok(value) => value,
            Err(_) => continue,
        };

        if let Some(stream_usage) = json.get("usage") {
            usage = serde_json::from_value(stream_usage.clone()).ok().or(usage);
        }

        if let Some(choices) = json.get("choices").and_then(|c| c.as_array()) {
            if let Some(choice) = choices.first() {
                if let Some(delta) = choice.get("delta") {
                    if let Some(content) = delta.get("content") {
                        emit_stream_content(content, false, on_chunk);
                    }
                    if let Some(reasoning) = delta.get("reasoning_content") {
                        emit_stream_content(reasoning, true, on_chunk);
                    }
                }
            }
        }
    }

    Ok(usage)
}

fn emit_stream_content<F>(value: &serde_json::Value, prefix_reasoning: bool, on_chunk: &mut F)
where
    F: FnMut(&StreamChunk),
{
    match value {
        serde_json::Value::String(text) => emit_stream_text(text, prefix_reasoning, on_chunk),
        serde_json::Value::Array(parts) => {
            for part in parts {
                if let Some(text) = part.get("text").and_then(|item| item.as_str()) {
                    emit_stream_text(text, prefix_reasoning, on_chunk);
                }
            }
        }
        _ => {}
    }
}

fn emit_stream_text<F>(text: &str, prefix_reasoning: bool, on_chunk: &mut F)
where
    F: FnMut(&StreamChunk),
{
    if text.is_empty() {
        return;
    }

    on_chunk(&StreamChunk {
        kind: if prefix_reasoning {
            StreamChunkKind::Thinking
        } else {
            StreamChunkKind::Message
        },
        content: text.to_string(),
        done: false,
    });
}

fn summarize_tool_outputs(outputs: &[(String, serde_json::Value)]) -> Option<String> {
    let mut lines = Vec::new();

    for (name, value) in outputs.iter().rev() {
        if let Some(text) = extract_tool_text(value) {
            lines.push(format!("[{}]\n{}", name, truncate_tool_summary(&text)));
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
    for key in ["summary", "final_text", "text", "body"] {
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
                let title = item
                    .get("title")
                    .and_then(|value| value.as_str())
                    .unwrap_or("Untitled");
                let url = item
                    .get("url")
                    .and_then(|value| value.as_str())
                    .unwrap_or("");
                let snippet = item
                    .get("snippet")
                    .and_then(|value| value.as_str())
                    .unwrap_or("");
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

fn truncate_tool_summary(text: &str) -> String {
    let truncated: String = text.chars().take(TOOL_SUMMARY_MAX_CHARS).collect();
    if truncated.chars().count() < text.chars().count() {
        format!("{}...", truncated)
    } else {
        truncated
    }
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
    let temperature = rule.and_then(|r| r.effective_temperature()).or_else(|| {
        if thinking.is_none() {
            Some(0.7)
        } else {
            None
        }
    });
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
    }
    .to_string()
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
    use super::{
        default_base_url, extract_tool_text, handle_sse_frame, handle_stream_round_frame,
        summarize_tool_outputs, StreamChunkKind, StreamRoundState, ToolChatResult,
    };
    use sacode_kernel::model::{ChatMessage, ChatRequest, ChatResponse, ToolDefinition};

    #[test]
    fn default_base_url_matches_provider_kinds() {
        assert_eq!(
            default_base_url(&sacode_kernel::model::ProviderKind::Mimo),
            "https://api.xiaomimimo.com/v1"
        );
        assert_eq!(
            default_base_url(&sacode_kernel::model::ProviderKind::Openai),
            "https://api.openai.com/v1"
        );
        assert_eq!(
            default_base_url(&sacode_kernel::model::ProviderKind::Deepseek),
            "https://api.deepseek.com"
        );
        assert_eq!(
            default_base_url(&sacode_kernel::model::ProviderKind::Longcat),
            "https://api.longcat.chat/openai/v1"
        );
        assert_eq!(
            default_base_url(&sacode_kernel::model::ProviderKind::Ollama),
            "http://127.0.0.1:11434/v1"
        );
        assert_eq!(
            default_base_url(&sacode_kernel::model::ProviderKind::Custom(
                "other".to_string()
            )),
            ""
        );
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
        assert_eq!(
            msg.reasoning_content.clone().unwrap(),
            "I analyzed the content"
        );
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
            hit_round_limit: false,
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
    fn extract_tool_text_prefers_summary_over_other_fields() {
        let value = serde_json::json!({
            "summary": "read 20 lines from src/views/TextViewer.vue (446 lines total)",
            "final_text": "fallback summary",
            "content": "raw file content"
        });
        assert_eq!(
            extract_tool_text(&value).as_deref(),
            Some("read 20 lines from src/views/TextViewer.vue (446 lines total)")
        );
    }

    #[test]
    fn extract_tool_text_does_not_use_content_field() {
        let value = serde_json::json!({
            "content": "sensitive raw content"
        });
        assert_eq!(extract_tool_text(&value), None);
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

    #[test]
    fn summarize_tool_outputs_truncates_long_text() {
        let summary = summarize_tool_outputs(&[(
            "fs.read".to_string(),
            serde_json::json!({
                "summary": "x".repeat(600)
            }),
        )])
        .expect("summary");

        assert!(summary.contains("[fs.read]"));
        assert!(summary.contains("..."));
        assert!(summary.len() < 540);
    }

    #[test]
    fn handle_sse_frame_extracts_content_reasoning_and_usage() {
        let frame = concat!(
            "data: {\"choices\":[{\"delta\":{\"content\":\"Hello\",\"reasoning_content\":\"think\"}}]}\n",
            "data: {\"usage\":{\"prompt_tokens\":1,\"completion_tokens\":2,\"total_tokens\":3}}\n\n",
            "data: [DONE]\n\n"
        );
        let mut chunks = Vec::new();
        let usage = handle_sse_frame(frame, &mut |chunk| chunks.push(chunk.clone()), None).unwrap();

        assert_eq!(chunks.len(), 3);
        assert_eq!(chunks[0].kind, StreamChunkKind::Message);
        assert_eq!(chunks[0].content, "Hello");
        assert_eq!(chunks[1].kind, StreamChunkKind::Thinking);
        assert_eq!(chunks[1].content, "think");
        assert!(chunks[2].done);

        let usage = usage.expect("usage");
        assert_eq!(usage.prompt_tokens, 1);
        assert_eq!(usage.completion_tokens, 2);
        assert_eq!(usage.total_tokens, 3);
    }

    #[test]
    fn handle_sse_frame_supports_array_content_parts() {
        let frame = concat!(
            "data: {\"choices\":[{\"delta\":{\"content\":[{\"text\":\"Hello\"},{\"text\":\" world\"}]}}]}\n\n"
        );
        let mut chunks = Vec::new();
        let _ = handle_sse_frame(frame, &mut |chunk| chunks.push(chunk.clone()), None).unwrap();

        assert_eq!(chunks.len(), 2);
        assert_eq!(chunks[0].content, "Hello");
        assert_eq!(chunks[1].content, " world");
    }

    #[test]
    fn find_sse_frame_end_detects_double_newline() {
        let bytes = b"data: hello\n\ndata: world";
        assert_eq!(super::find_sse_frame_end(bytes), Some(11));
    }

    #[test]
    fn handle_stream_round_frame_reconstructs_tool_call_arguments() {
        let frame = concat!(
            "data: {\"choices\":[{\"delta\":{\"tool_calls\":[{\"index\":0,\"id\":\"call_1\",\"type\":\"function\",\"function\":{\"name\":\"fs.read\",\"arguments\":\"{\\\"path\\\":\"}}]}}]}\n",
            "data: {\"choices\":[{\"delta\":{\"tool_calls\":[{\"index\":0,\"function\":{\"arguments\":\"\\\"README.md\\\"}\"}}]}}]}\n\n"
        );
        let mut state = StreamRoundState::default();
        let mut chunks = Vec::new();
        handle_stream_round_frame(frame, &mut state, &mut |chunk| chunks.push(chunk.clone()))
            .unwrap();

        assert!(chunks.is_empty());
        let message = state.into_chat_message();
        let tool_calls = message.tool_calls.expect("tool calls");
        assert_eq!(tool_calls.len(), 1);
        assert_eq!(tool_calls[0].id, "call_1");
        assert_eq!(tool_calls[0].function.name, "fs.read");
        assert_eq!(tool_calls[0].function.arguments, "{\"path\":\"README.md\"}");
    }
}
