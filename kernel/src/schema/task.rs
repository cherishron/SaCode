use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ExecutionMode {
    Plan,
    Build,
    Yolo,
}

impl Default for ExecutionMode {
    fn default() -> Self {
        Self::Build
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Task {
    pub prompt: String,
    pub mode: ExecutionMode,
    pub stdin: Option<String>,
}

impl Task {
    pub fn new(prompt: impl Into<String>, mode: ExecutionMode, stdin: Option<String>) -> Self {
        Self {
            prompt: prompt.into(),
            mode,
            stdin,
        }
    }
}
