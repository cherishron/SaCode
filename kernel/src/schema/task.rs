use serde::{Deserialize, Serialize};
use std::fmt;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "snake_case")]
pub enum ExecutionMode {
    Plan,
    #[default]
    Build,
    /// auto 模式（原 yolo）：全自动推进任务。serde 序列化为 "auto"，反序列化兼容旧值 "yolo"。
    #[serde(rename = "auto", alias = "yolo")]
    Yolo,
}

impl fmt::Display for ExecutionMode {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            ExecutionMode::Plan => write!(f, "plan"),
            ExecutionMode::Build => write!(f, "build"),
            ExecutionMode::Yolo => write!(f, "auto"),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Task {
    pub prompt: String,
    pub mode: ExecutionMode,
    pub stdin: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub model_provider: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub model_name: Option<String>,
}

impl Task {
    pub fn new(prompt: impl Into<String>, mode: ExecutionMode, stdin: Option<String>) -> Self {
        Self {
            prompt: prompt.into(),
            mode,
            stdin,
            model_provider: None,
            model_name: None,
        }
    }

    pub fn with_model(mut self, provider: Option<String>, model: Option<String>) -> Self {
        self.model_provider = provider.filter(|value| !value.trim().is_empty());
        self.model_name = model.filter(|value| !value.trim().is_empty());
        self
    }
}
