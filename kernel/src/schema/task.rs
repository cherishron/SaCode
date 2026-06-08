use serde::{Deserialize, Serialize};
use std::fmt;

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

impl fmt::Display for ExecutionMode {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            ExecutionMode::Plan => write!(f, "plan"),
            ExecutionMode::Build => write!(f, "build"),
            ExecutionMode::Yolo => write!(f, "yolo"),
        }
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
