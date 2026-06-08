use serde::{Deserialize, Serialize};

use crate::schema::ExecutionMode;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Session {
    pub id: String,
    pub mode: ExecutionMode,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub compressed_summary: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub compression_ratio: Option<f32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub original_token_count: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub compressed_token_count: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_compressed_at: Option<String>,
}

impl Session {
    pub fn new(id: impl Into<String>, mode: ExecutionMode) -> Self {
        Self {
            id: id.into(),
            mode,
            compressed_summary: None,
            compression_ratio: None,
            original_token_count: None,
            compressed_token_count: None,
            last_compressed_at: None,
        }
    }

    pub fn with_compression(
        mut self,
        summary: String,
        original_tokens: u32,
        compressed_tokens: u32,
        compressed_at: String,
    ) -> Self {
        let ratio = if original_tokens > 0 {
            compressed_tokens as f32 / original_tokens as f32
        } else {
            0.0
        };
        self.compressed_summary = Some(summary);
        self.compression_ratio = Some(ratio);
        self.original_token_count = Some(original_tokens);
        self.compressed_token_count = Some(compressed_tokens);
        self.last_compressed_at = Some(compressed_at);
        self
    }

    pub fn is_compressed(&self) -> bool {
        self.compressed_summary.is_some()
    }

    pub fn compression_ratio(&self) -> f32 {
        self.compression_ratio.unwrap_or(1.0)
    }
}
