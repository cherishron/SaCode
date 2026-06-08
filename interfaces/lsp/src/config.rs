use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct LspConfig {
    #[serde(default)]
    pub server: LspServerConfig,
    #[serde(default)]
    pub capabilities: LspCapabilitiesConfig,
    #[serde(default)]
    pub behavior: LspBehaviorConfig,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LspServerConfig {
    #[serde(default = "default_host")]
    pub host: String,
    #[serde(default = "default_lsp_port")]
    pub port: u16,
    #[serde(default = "default_max_connections")]
    pub max_connections: usize,
}

impl Default for LspServerConfig {
    fn default() -> Self {
        Self {
            host: default_host(),
            port: default_lsp_port(),
            max_connections: default_max_connections(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LspCapabilitiesConfig {
    #[serde(default = "default_true")]
    pub completion: bool,
    #[serde(default = "default_true")]
    pub diagnostics: bool,
    #[serde(default = "default_true")]
    pub hover: bool,
    #[serde(default = "default_true")]
    pub code_action: bool,
}

impl Default for LspCapabilitiesConfig {
    fn default() -> Self {
        Self {
            completion: true,
            diagnostics: true,
            hover: true,
            code_action: true,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LspBehaviorConfig {
    #[serde(default = "default_debounce_ms")]
    pub debounce_ms: u64,
    #[serde(default = "default_diagnostic_interval_ms")]
    pub diagnostic_interval_ms: u64,
}

impl Default for LspBehaviorConfig {
    fn default() -> Self {
        Self {
            debounce_ms: default_debounce_ms(),
            diagnostic_interval_ms: default_diagnostic_interval_ms(),
        }
    }
}

fn default_host() -> String {
    "127.0.0.1".to_string()
}

fn default_lsp_port() -> u16 {
    9528
}

fn default_max_connections() -> usize {
    10
}

fn default_true() -> bool {
    true
}

fn default_debounce_ms() -> u64 {
    300
}

fn default_diagnostic_interval_ms() -> u64 {
    2000
}
