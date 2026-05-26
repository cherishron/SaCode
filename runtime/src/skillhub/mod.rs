use anyhow::Result;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::{fs, path::Path};

use crate::{mcp::{McpConfig, McpServerConfig, McpSource}, skills::{SkillSource, SkillSpec}};

const DEFAULT_SKILLHUB_BASE_URL: &str = "https://skillhub.monkeycode-ai.com";

#[derive(Debug, Clone)]
pub struct SkillHubClient {
    pub base_url: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SkillHubSkillMeta {
    pub name: String,
    pub description: String,
    pub author: String,
    pub version: String,
    pub download_url: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SkillHubMcpMeta {
    pub name: String,
    pub url: String,
    pub description: String,
}

impl SkillHubClient {
    pub fn new() -> Self {
        Self {
            base_url: std::env::var("SACODE_SKILLHUB_BASE_URL")
                .unwrap_or_else(|_| DEFAULT_SKILLHUB_BASE_URL.to_string()),
        }
    }

    pub async fn search_skills(&self, keyword: &str) -> Result<Vec<SkillHubSkillMeta>> {
        let client = http_client()?;
        let url = format!("{}/api/skills/search", self.base_url.trim_end_matches('/'));
        let response = client
            .get(url)
            .query(&[("q", keyword)])
            .send()
            .await?;
        Ok(response.json().await?)
    }

    pub async fn search_mcp(&self, keyword: &str) -> Result<Vec<SkillHubMcpMeta>> {
        let client = http_client()?;
        let url = format!("{}/api/mcp/search", self.base_url.trim_end_matches('/'));
        let response = client
            .get(url)
            .query(&[("q", keyword)])
            .send()
            .await?;
        Ok(response.json().await?)
    }

    pub async fn install_skill(&self, name: &str, target_dir: &Path) -> Result<SkillSpec> {
        let client = http_client()?;
        let url = format!("{}/api/skills/{}/download", self.base_url.trim_end_matches('/'), name);
        let response = client.get(url).send().await?;
        let content = response.text().await?;

        fs::create_dir_all(target_dir)?;
        let path = target_dir.join(format!("{}.md", name));
        fs::write(&path, &content)?;

        Ok(parse_downloaded_skill(&path, &content, detect_skill_source(target_dir)))
    }

    pub async fn install_mcp(&self, name: &str, config_path: &Path) -> Result<()> {
        let client = http_client()?;
        let url = format!("{}/api/mcp/{}/install", self.base_url.trim_end_matches('/'), name);
        let response = client.get(url).send().await?;
        let meta: SkillHubMcpMeta = response.json().await?;

        let mut config = if config_path.exists() {
            let content = fs::read_to_string(config_path)?;
            serde_json::from_str::<McpConfig>(&content)?
        } else {
            McpConfig::default()
        };

        config.mcp.insert(
            meta.name,
            McpServerConfig {
                server_type: "remote".to_string(),
                url: meta.url,
                enabled: true,
            },
        );

        if let Some(parent) = config_path.parent() {
            fs::create_dir_all(parent)?;
        }
        fs::write(config_path, serde_json::to_string_pretty(&config)?)?;
        Ok(())
    }

    pub async fn install_mcp_to_source(&self, name: &str, config_path: &Path, _source: McpSource) -> Result<()> {
        self.install_mcp(name, config_path).await
    }
}

fn detect_skill_source(target_dir: &Path) -> SkillSource {
    if target_dir
        .components()
        .any(|component| component.as_os_str() == ".sacode")
    {
        SkillSource::Project
    } else {
        SkillSource::User
    }
}

fn parse_downloaded_skill(path: &Path, content: &str, source: SkillSource) -> SkillSpec {
    let default_name = path
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("unknown")
        .to_string();

    let mut name = default_name;
    let mut description = String::new();
    let mut prompt = String::new();
    let mut in_prompt = false;

    for line in content.lines() {
        if let Some(rest) = line.strip_prefix("# ") {
            name = rest.trim().to_string();
            continue;
        }

        if let Some(rest) = line.strip_prefix("Description: ") {
            description = rest.trim().to_string();
            continue;
        }

        if line.trim() == "## Prompt" {
            in_prompt = true;
            continue;
        }

        if in_prompt {
            if !prompt.is_empty() {
                prompt.push('\n');
            }
            prompt.push_str(line);
        }
    }

    SkillSpec {
        name,
        description,
        prompt: prompt.trim().to_string(),
        path: path.to_path_buf(),
        source,
    }
}

fn http_client() -> Result<Client> {
    Ok(Client::builder()
        .timeout(std::time::Duration::from_secs(20))
        .build()?)
}
