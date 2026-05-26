use anyhow::Result;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

use crate::{mcp::McpConfig, skills::SkillSpec};

const USER_ROOT_DIR: &str = ".sacode";
const PROJECT_ROOT_DIR: &str = ".sacode";
const SKILLS_DIR: &str = "skills";
const MCP_CONFIG_FILE: &str = "mcp.json";
const IDE_CONFIG_FILE: &str = "server.json";

#[derive(Debug, Clone)]
pub struct SaCodeConfig {
    pub user_dir: PathBuf,
    pub project_dir: PathBuf,
    pub workspace_dir: PathBuf,
}

impl SaCodeConfig {
    pub fn new(workdir: &Path) -> Self {
        let user_dir = std::env::var_os("HOME")
            .map(PathBuf::from)
            .unwrap_or_else(|| PathBuf::from("."))
            .join(USER_ROOT_DIR);

        Self {
            user_dir,
            project_dir: workdir.join(PROJECT_ROOT_DIR),
            workspace_dir: workdir.join(SKILLS_DIR),
        }
    }

    pub fn user_skills_dir(&self) -> PathBuf {
        self.user_dir.join(SKILLS_DIR)
    }

    pub fn project_skills_dir(&self) -> PathBuf {
        self.project_dir.join(SKILLS_DIR)
    }

    pub fn workspace_skills_dir(&self) -> PathBuf {
        self.workspace_dir.clone()
    }

    pub fn user_mcp_config(&self) -> PathBuf {
        self.user_dir.join(MCP_CONFIG_FILE)
    }

    pub fn project_mcp_config(&self) -> PathBuf {
        self.project_dir.join(MCP_CONFIG_FILE)
    }

    pub fn project_server_config(&self) -> PathBuf {
        self.project_dir.join(IDE_CONFIG_FILE)
    }

    pub fn load_merged_mcp_config(&self) -> Result<McpConfig> {
        let mut merged = McpConfig::default();

        for path in [self.user_mcp_config(), self.project_mcp_config()] {
            if !path.exists() {
                continue;
            }

            let content = std::fs::read_to_string(&path)?;
            let config: McpConfig = serde_json::from_str(&content)?;
            merged.mcp.extend(config.mcp);
        }

        Ok(merged)
    }

    pub fn load_all_skills(&self) -> Result<Vec<SkillSpec>> {
        crate::skills::SkillRegistry::new_from_config(self.clone()).list()
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct IdeServerConfig {
    #[serde(default)]
    pub acp: ProtocolServerConfig,
    #[serde(default)]
    pub lsp: ProtocolServerConfig,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProtocolServerConfig {
    #[serde(default = "default_host")]
    pub host: String,
    #[serde(default)]
    pub port: u16,
}

impl Default for ProtocolServerConfig {
    fn default() -> Self {
        Self {
            host: default_host(),
            port: 0,
        }
    }
}

#[derive(Debug, Clone)]
pub struct IdeServerConfigStore {
    path: PathBuf,
}

impl IdeServerConfigStore {
    pub fn new(workdir: &Path) -> Self {
        Self {
            path: SaCodeConfig::new(workdir).project_server_config(),
        }
    }

    pub fn load(&self) -> Result<IdeServerConfig> {
        if !self.path.exists() {
            return Ok(IdeServerConfig::default());
        }

        let content = std::fs::read_to_string(&self.path)?;
        Ok(serde_json::from_str(&content)?)
    }

    pub fn save(&self, config: &IdeServerConfig) -> Result<()> {
        if let Some(parent) = self.path.parent() {
            std::fs::create_dir_all(parent)?;
        }

        std::fs::write(&self.path, serde_json::to_string_pretty(config)?)?;
        Ok(())
    }
}

fn default_host() -> String {
    "127.0.0.1".to_string()
}
