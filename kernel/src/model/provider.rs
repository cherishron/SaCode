use serde::{Deserialize, Serialize};

use super::ModelRule;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ProviderKind {
    Openai,
    Deepseek,
    Mimo,
    Longcat,
    Ollama,
    Custom(String),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ThinkingConfig {
    #[serde(rename = "type")]
    pub thinking_type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reasoning_effort: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelProvider {
    pub kind: ProviderKind,
    pub model: String,
    pub base_url: Option<String>,
    pub api_key: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rule: Option<ModelRule>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatRequest {
    pub model: String,
    pub messages: Vec<ChatMessage>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tools: Option<Vec<ToolDefinition>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub temperature: Option<f32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub top_p: Option<f32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_tokens: Option<u32>,
    pub stream: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub thinking: Option<ThinkingConfig>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reasoning_effort: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatMessage {
    pub role: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub content: Option<MessageContent>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reasoning_content: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_calls: Option<Vec<ToolCall>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_call_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(untagged)]
pub enum MessageContent {
    Text(String),
    Parts(Vec<MessagePart>),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum MessagePart {
    #[serde(rename = "text")]
    Text { text: String },
    #[serde(rename = "image_url")]
    ImageUrl { image_url: ImageUrlPart },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ImageUrlPart {
    pub url: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatResponse {
    pub id: Option<String>,
    pub model: String,
    pub choices: Vec<ChatChoice>,
    pub usage: Option<ChatUsage>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatChoice {
    pub index: u32,
    pub message: ChatMessage,
    pub finish_reason: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatUsage {
    pub prompt_tokens: u32,
    pub completion_tokens: u32,
    pub total_tokens: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolDefinition {
    #[serde(rename = "type")]
    pub tool_type: String,
    pub function: FunctionDefinition,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FunctionDefinition {
    pub name: String,
    pub description: String,
    pub parameters: serde_json::Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolCall {
    pub id: String,
    #[serde(rename = "type")]
    pub call_type: String,
    pub function: FunctionCall,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FunctionCall {
    pub name: String,
    pub arguments: String,
}

impl ChatRequest {
    pub fn new(model: impl Into<String>, messages: Vec<ChatMessage>) -> Self {
        Self {
            model: model.into(),
            messages,
            tools: None,
            temperature: Some(0.7),
            top_p: None,
            max_tokens: None,
            stream: false,
            thinking: None,
            reasoning_effort: None,
        }
    }

    pub fn simple(model: impl Into<String>, prompt: impl Into<String>) -> Self {
        Self::new(model, vec![ChatMessage::user(prompt)])
    }

    pub fn with_tools(
        model: impl Into<String>,
        messages: Vec<ChatMessage>,
        tools: Vec<ToolDefinition>,
    ) -> Self {
        Self {
            model: model.into(),
            messages,
            tools: Some(tools),
            temperature: Some(0.7),
            top_p: None,
            max_tokens: None,
            stream: false,
            thinking: None,
            reasoning_effort: None,
        }
    }

    pub fn with_thinking(
        model: impl Into<String>,
        messages: Vec<ChatMessage>,
        tools: Vec<ToolDefinition>,
        effort: Option<String>,
    ) -> Self {
        Self {
            model: model.into(),
            messages,
            tools: Some(tools),
            temperature: None,
            top_p: None,
            max_tokens: None,
            stream: false,
            thinking: Some(ThinkingConfig {
                thinking_type: "enabled".to_string(),
                reasoning_effort: effort.clone(),
            }),
            reasoning_effort: effort,
        }
    }

    pub fn needs_thinking(model: &str) -> bool {
        let lower = model.to_lowercase();
        lower.starts_with("mimo") || lower.contains("deepseek-v4") || lower == "deepseek-reasoner"
    }
}

impl ChatMessage {
    pub fn user(content: impl Into<String>) -> Self {
        Self {
            role: "user".to_string(),
            content: Some(MessageContent::Text(content.into())),
            reasoning_content: None,
            tool_calls: None,
            tool_call_id: None,
            name: None,
        }
    }

    pub fn user_parts(parts: Vec<MessagePart>) -> Self {
        Self {
            role: "user".to_string(),
            content: Some(MessageContent::Parts(parts)),
            reasoning_content: None,
            tool_calls: None,
            tool_call_id: None,
            name: None,
        }
    }

    pub fn system(content: impl Into<String>) -> Self {
        Self {
            role: "system".to_string(),
            content: Some(MessageContent::Text(content.into())),
            reasoning_content: None,
            tool_calls: None,
            tool_call_id: None,
            name: None,
        }
    }

    pub fn assistant(content: impl Into<String>) -> Self {
        Self {
            role: "assistant".to_string(),
            content: Some(MessageContent::Text(content.into())),
            reasoning_content: None,
            tool_calls: None,
            tool_call_id: None,
            name: None,
        }
    }

    pub fn assistant_tool_calls(tool_calls: Vec<ToolCall>) -> Self {
        Self {
            role: "assistant".to_string(),
            content: None,
            reasoning_content: None,
            tool_calls: Some(tool_calls),
            tool_call_id: None,
            name: None,
        }
    }

    pub fn assistant_with_reasoning(
        content: Option<String>,
        reasoning_content: Option<String>,
        tool_calls: Option<Vec<ToolCall>>,
    ) -> Self {
        Self {
            role: "assistant".to_string(),
            content: content.map(MessageContent::Text),
            reasoning_content,
            tool_calls,
            tool_call_id: None,
            name: None,
        }
    }

    pub fn tool_result(tool_call_id: impl Into<String>, content: impl Into<String>) -> Self {
        Self {
            role: "tool".to_string(),
            content: Some(MessageContent::Text(content.into())),
            reasoning_content: None,
            tool_calls: None,
            tool_call_id: Some(tool_call_id.into()),
            name: None,
        }
    }

    pub fn tool_result_named(
        tool_call_id: impl Into<String>,
        name: impl Into<String>,
        content: impl Into<String>,
    ) -> Self {
        Self {
            role: "tool".to_string(),
            content: Some(MessageContent::Text(content.into())),
            reasoning_content: None,
            tool_calls: None,
            tool_call_id: Some(tool_call_id.into()),
            name: Some(name.into()),
        }
    }

    pub fn has_tool_calls(&self) -> bool {
        self.tool_calls.is_some() && !self.tool_calls.as_ref().unwrap().is_empty()
    }

    pub fn is_tool_result(&self) -> bool {
        self.role == "tool"
    }

    pub fn has_reasoning(&self) -> bool {
        self.reasoning_content.is_some() && !self.reasoning_content.as_ref().unwrap().is_empty()
    }

    pub fn text(&self) -> Option<&str> {
        match self.content.as_ref() {
            Some(MessageContent::Text(text)) => Some(text.as_str()),
            _ => None,
        }
    }
}

impl ThinkingConfig {
    pub fn enabled() -> Self {
        Self {
            thinking_type: "enabled".to_string(),
            reasoning_effort: None,
        }
    }

    pub fn with_effort(effort: impl Into<String>) -> Self {
        Self {
            thinking_type: "enabled".to_string(),
            reasoning_effort: Some(effort.into()),
        }
    }
}

impl ToolDefinition {
    pub fn function(
        name: impl Into<String>,
        description: impl Into<String>,
        parameters: serde_json::Value,
    ) -> Self {
        Self {
            tool_type: "function".to_string(),
            function: FunctionDefinition {
                name: name.into(),
                description: description.into(),
                parameters,
            },
        }
    }
}

impl ModelProvider {
    pub fn openai(model: impl Into<String>) -> Self {
        Self {
            kind: ProviderKind::Openai,
            model: model.into(),
            base_url: Some("https://api.openai.com/v1".to_string()),
            api_key: None,
            rule: None,
        }
    }

    pub fn deepseek(model: impl Into<String>) -> Self {
        Self {
            kind: ProviderKind::Deepseek,
            model: model.into(),
            base_url: Some("https://api.deepseek.com".to_string()),
            api_key: None,
            rule: None,
        }
    }

    pub fn mimo(model: impl Into<String>) -> Self {
        Self {
            kind: ProviderKind::Mimo,
            model: model.into(),
            base_url: Some("https://token-plan-cn.xiaomimimo.com/v1".to_string()),
            api_key: None,
            rule: None,
        }
    }

    pub fn longcat(model: impl Into<String>) -> Self {
        Self {
            kind: ProviderKind::Longcat,
            model: model.into(),
            base_url: Some("https://api.longcat.chat/openai/v1".to_string()),
            api_key: None,
            rule: None,
        }
    }

    pub fn ollama(model: impl Into<String>) -> Self {
        Self {
            kind: ProviderKind::Ollama,
            model: model.into(),
            base_url: Some("http://127.0.0.1:11434/v1".to_string()),
            api_key: None,
            rule: None,
        }
    }

    pub fn with_api_key(mut self, key: impl Into<String>) -> Self {
        self.api_key = Some(key.into());
        self
    }

    pub fn with_base_url(mut self, url: impl Into<String>) -> Self {
        self.base_url = Some(url.into());
        self
    }

    pub fn needs_thinking(&self) -> bool {
        self.rule
            .as_ref()
            .map(|rule| rule.should_think())
            .unwrap_or_else(|| ChatRequest::needs_thinking(&self.model))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn needs_thinking_detects_mimo_models() {
        assert!(ChatRequest::needs_thinking("mimo-v2.5-pro"));
        assert!(ChatRequest::needs_thinking("MiMo-V2.5-Pro"));
        assert!(ChatRequest::needs_thinking("mimo-v2"));
        assert!(ChatRequest::needs_thinking("deepseek-v4-pro"));
        assert!(ChatRequest::needs_thinking("deepseek-v4-flash"));
        assert!(ChatRequest::needs_thinking("DeepSeek-V4-Pro"));
        assert!(ChatRequest::needs_thinking("deepseek-reasoner"));
        assert!(!ChatRequest::needs_thinking("gpt-4o-mini"));
        assert!(!ChatRequest::needs_thinking("deepseek-chat"));
        assert!(!ChatRequest::needs_thinking("qwen2.5-coder"));
        assert!(!ChatRequest::needs_thinking("LongCat-2.0-Preview"));
    }

    #[test]
    fn with_thinking_configures_request() {
        let req = ChatRequest::with_thinking(
            "mimo-v2.5-pro",
            vec![ChatMessage::user("hello")],
            vec![ToolDefinition::function(
                "fs.read",
                "read a file",
                serde_json::json!({"type": "object", "properties": {"path": {"type": "string"}}}),
            )],
            None,
        );
        assert!(req.thinking.is_some());
        assert_eq!(req.thinking.unwrap().thinking_type, "enabled");
        assert!(req.tools.is_some());
        assert_eq!(req.tools.unwrap().len(), 1);
    }

    #[test]
    fn chat_message_has_tool_calls() {
        let msg = ChatMessage::assistant_tool_calls(vec![ToolCall {
            id: "call_1".to_string(),
            call_type: "function".to_string(),
            function: FunctionCall {
                name: "fs.read".to_string(),
                arguments: "{\"path\":\"/tmp/test\"}".to_string(),
            },
        }]);
        assert!(msg.has_tool_calls());
        assert!(msg.text().is_none());
    }

    #[test]
    fn chat_message_has_reasoning() {
        let msg = ChatMessage::assistant_with_reasoning(
            Some("result".to_string()),
            Some("thinking process".to_string()),
            None,
        );
        assert!(msg.has_reasoning());
        assert_eq!(
            msg.reasoning_content.as_deref().unwrap(),
            "thinking process"
        );
        assert_eq!(msg.text().unwrap(), "result");
    }

    #[test]
    fn user_parts_message_serializes_with_content_parts() {
        let msg = ChatMessage::user_parts(vec![
            MessagePart::Text {
                text: "describe this image".to_string(),
            },
            MessagePart::ImageUrl {
                image_url: ImageUrlPart {
                    url: "data:image/png;base64,AAAA".to_string(),
                },
            },
        ]);
        let json = serde_json::to_string(&msg).unwrap();
        assert!(json.contains("\"content\":["));
        assert!(json.contains("\"type\":\"image_url\""));
    }

    #[test]
    fn tool_result_message_fields() {
        let msg = ChatMessage::tool_result("call_1", "file content");
        assert_eq!(msg.role, "tool");
        assert_eq!(msg.tool_call_id.as_deref().unwrap(), "call_1");
        assert_eq!(msg.text().unwrap(), "file content");
    }

    #[test]
    fn tool_definition_serialization() {
        let def = ToolDefinition::function(
            "fs.read",
            "Read a file",
            serde_json::json!({"type": "object", "properties": {"path": {"type": "string"}}}),
        );
        let json = serde_json::to_string(&def).unwrap();
        assert!(json.contains("\"type\":\"function\""));
        assert!(json.contains("\"name\":\"fs.read\""));
    }

    #[test]
    fn model_provider_needs_thinking() {
        let mimo = ModelProvider::mimo("mimo-v2.5-pro");
        assert!(mimo.needs_thinking());
        let deepseek_v4 = ModelProvider::deepseek("deepseek-v4-pro");
        assert!(deepseek_v4.needs_thinking());
        let openai = ModelProvider::openai("gpt-4o-mini");
        assert!(!openai.needs_thinking());
    }
}
