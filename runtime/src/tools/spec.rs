use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolSpec {
    pub name: String,
    pub description: String,
    pub input_schema: serde_json::Value,
    pub output_schema: serde_json::Value,
    pub side_effect_level: SideEffectLevel,
    pub approval_required: bool,
    pub timeout_ms: Option<u64>,
    pub tags: Vec<String>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum SideEffectLevel {
    ReadOnly,
    Modify,
    Execute,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolOutput {
    pub success: bool,
    pub data: serde_json::Value,
    pub message: Option<String>,
}

impl ToolOutput {
    pub fn success(data: serde_json::Value) -> Self {
        Self {
            success: true,
            data,
            message: None,
        }
    }

    pub fn failure(message: impl Into<String>) -> Self {
        Self {
            success: false,
            data: serde_json::json!(null),
            message: Some(message.into()),
        }
    }

    pub fn with_message(mut self, message: impl Into<String>) -> Self {
        self.message = Some(message.into());
        self
    }
}

impl ToolSpec {
    pub fn is_read_only(&self) -> bool {
        self.side_effect_level == SideEffectLevel::ReadOnly
    }

    pub fn needs_approval(&self) -> bool {
        self.approval_required || !self.is_read_only()
    }
}