use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct AcpConfig {
    #[serde(default)]
    pub server: AcpServerConfig,
    #[serde(default)]
    pub capabilities: AcpCapabilitiesConfig,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AcpServerConfig {
    #[serde(default = "default_host")]
    pub host: String,
    #[serde(default = "default_acp_port")]
    pub port: u16,
    #[serde(default = "default_max_connections")]
    pub max_connections: usize,
}

impl Default for AcpServerConfig {
    fn default() -> Self {
        Self {
            host: default_host(),
            port: default_acp_port(),
            max_connections: default_max_connections(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct AcpCapabilitiesConfig {
    #[serde(default = "default_true")]
    pub load_session: bool,
}

fn default_host() -> String {
    "127.0.0.1".to_string()
}

fn default_acp_port() -> u16 {
    9527
}

fn default_max_connections() -> usize {
    10
}

fn default_true() -> bool {
    true
}
