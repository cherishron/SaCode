use anyhow::{Context, Result};
use reqwest::header::CONTENT_TYPE;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::{fs, path::{Path, PathBuf}};

use crate::mcp::{McpConfig, McpServerConfig, McpSource};
use super::{SkillSource, SkillSpec, parse_skill_file};

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
    #[serde(default)]
    pub rating: Option<f32>,
    #[serde(default)]
    pub download_count: Option<u64>,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default)]
    pub created_at: Option<String>,
    #[serde(default)]
    pub updated_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SkillHubUploadRequest {
    pub name: String,
    pub description: String,
    pub author: String,
    pub version: String,
    pub prompt: String,
    #[serde(default)]
    pub tags: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SkillHubUploadResponse {
    pub success: bool,
    pub message: String,
    pub skill_id: Option<String>,
    pub download_url: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SkillHubVersionMeta {
    pub version: String,
    pub created_at: String,
    pub download_url: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SkillHubSkillListResponse {
    pub skills: Vec<SkillHubSkillMeta>,
    pub total: u64,
    pub page: u64,
    pub per_page: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SkillHubMcpMeta {
    pub name: String,
    pub url: String,
    pub description: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SkillHubPluginMeta {
    pub name: String,
    pub description: String,
    pub author: String,
    pub version: String,
    #[serde(default)]
    pub download_url: String,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default)]
    pub source_ref: Option<String>,
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
        let response = client.get(url).query(&[("q", keyword)]).send().await?;
        Ok(response.json().await?)
    }

    pub async fn search_mcp(&self, keyword: &str) -> Result<Vec<SkillHubMcpMeta>> {
        let client = http_client()?;
        let url = format!("{}/api/mcp/search", self.base_url.trim_end_matches('/'));
        let response = client.get(url).query(&[("q", keyword)]).send().await?;
        Ok(response.json().await?)
    }

    pub async fn search_plugins(&self, keyword: &str) -> Result<Vec<SkillHubPluginMeta>> {
        let client = http_client()?;
        let url = format!("{}/api/plugins/search", self.base_url.trim_end_matches('/'));
        let response = client.get(url).query(&[("q", keyword)]).send().await?;
        let status = response.status();
        if !status.is_success() {
            let body = response.text().await.unwrap_or_default();
            anyhow::bail!("plugin search failed ({}): {}", status, body);
        }
        Ok(response.json().await?)
    }

    pub async fn get_plugin_info(&self, name: &str) -> Result<SkillHubPluginMeta> {
        let client = http_client()?;
        let url = format!(
            "{}/api/plugins/{}/info",
            self.base_url.trim_end_matches('/'),
            name
        );
        let response = client.get(&url).send().await?;
        let status = response.status();
        if !status.is_success() {
            let body = response.text().await.unwrap_or_default();
            anyhow::bail!("failed to get plugin info ({}): {}", status, body);
        }
        Ok(response.json().await?)
    }

    pub async fn install_skill(&self, name: &str, target_dir: &Path) -> Result<SkillSpec> {
        let client = http_client()?;
        let url = format!(
            "{}/api/skills/{}/download",
            self.base_url.trim_end_matches('/'),
            name
        );
        let response = client.get(url).send().await?;
        let status = response.status();
        if !status.is_success() {
            let body = response.text().await.unwrap_or_default();
            anyhow::bail!("skill download failed ({}): {}", status, body);
        }
        let content_type = response
            .headers()
            .get(CONTENT_TYPE)
            .and_then(|value| value.to_str().ok())
            .unwrap_or_default()
            .to_ascii_lowercase();
        if !(content_type.starts_with("text/markdown")
            || content_type.starts_with("text/plain")
            || content_type.starts_with("application/octet-stream"))
        {
            anyhow::bail!("unexpected skill content-type: {}", content_type);
        }
        let content = response.text().await?;

        fs::create_dir_all(target_dir)?;
        let path = target_dir.join(format!("{}.md", name));
        fs::write(&path, &content)?;

        Ok(parse_skill_file(
            &path,
            &content,
            detect_skill_source(target_dir),
        ))
    }

    pub async fn install_mcp(&self, name: &str, config_path: &Path) -> Result<()> {
        let client = http_client()?;
        let url = format!(
            "{}/api/mcp/{}/install",
            self.base_url.trim_end_matches('/'),
            name
        );
        let response = client.get(url).send().await?;
        let status = response.status();
        if !status.is_success() {
            let body = response.text().await.unwrap_or_default();
            anyhow::bail!("mcp install failed ({}): {}", status, body);
        }
        let content_type = response
            .headers()
            .get(CONTENT_TYPE)
            .and_then(|value| value.to_str().ok())
            .unwrap_or_default()
            .to_ascii_lowercase();
        if !content_type.starts_with("application/json") {
            anyhow::bail!("unexpected mcp content-type: {}", content_type);
        }
        let meta: SkillHubMcpMeta = response
            .json()
            .await
            .context("failed to parse mcp install response as json")?;

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

    pub async fn install_mcp_to_source(
        &self,
        name: &str,
        config_path: &Path,
        _source: McpSource,
    ) -> Result<()> {
        self.install_mcp(name, config_path).await
    }

    /// 下载并安装 WASM 插件到 `<workdir>/.sacode/plugins/<name>/`
    ///
    /// 设计意图：
    /// - 复用 install_mcp 的下载/状态校验模式
    /// - 下载 manifest.json + .wasm 两个文件到同一插件目录
    /// - 失败时部分写入的文件由调用方清理（避免在 lib 内做复杂回滚）
    ///
    /// 服务端约定：
    /// - `GET /api/plugins/<name>/install` 返回 JSON：`{ manifest: PluginSpec, wasm_url: string }`
    /// - `manifest.wasm_path` 由本方法覆盖为 `plugin.wasm`（相对插件目录）
    pub async fn install_wasm_plugin(&self, name: &str, workdir: &Path) -> Result<PathBuf> {
        let client = http_client()?;
        let url = format!(
            "{}/api/plugins/{}/install",
            self.base_url.trim_end_matches('/'),
            name
        );
        let response = client.get(&url).send().await?;
        let status = response.status();
        if !status.is_success() {
            let body = response.text().await.unwrap_or_default();
            anyhow::bail!("wasm plugin install failed ({}): {}", status, body);
        }
        let content_type = response
            .headers()
            .get(CONTENT_TYPE)
            .and_then(|value| value.to_str().ok())
            .unwrap_or_default()
            .to_ascii_lowercase();
        if !content_type.starts_with("application/json") {
            anyhow::bail!("unexpected wasm plugin content-type: {}", content_type);
        }

        #[derive(Debug, Deserialize)]
        struct InstallResponse {
            manifest: crate::plugin::PluginSpec,
            wasm_url: String,
        }
        let payload: InstallResponse = response
            .json()
            .await
            .context("failed to parse wasm plugin install response as json")?;

        // 写入插件目录
        let plugins_root = workdir.join(".sacode").join("plugins");
        let plugin_dir = plugins_root.join(name);
        fs::create_dir_all(&plugin_dir)?;

        // manifest 中 wasm_path 改为相对路径，确保跨机器可移植
        let mut manifest = payload.manifest;
        manifest.wasm_path = "plugin.wasm".to_string();
        let manifest_json = serde_json::to_string_pretty(&manifest)?;
        fs::write(plugin_dir.join("manifest.json"), manifest_json)?;

        // 下载 .wasm 文件
        let wasm_bytes = client
            .get(&payload.wasm_url)
            .send()
            .await?
            .bytes()
            .await
            .context("failed to download wasm bytes")?;
        fs::write(plugin_dir.join("plugin.wasm"), &wasm_bytes)?;

        Ok(plugin_dir)
    }

    pub async fn upload_skill(
        &self,
        request: SkillHubUploadRequest,
    ) -> Result<SkillHubUploadResponse> {
        let client = http_client()?;
        let url = format!("{}/api/skills/upload", self.base_url.trim_end_matches('/'));
        let response = client.post(&url).json(&request).send().await?;
        let status = response.status();
        if !status.is_success() {
            let body = response.text().await.unwrap_or_default();
            anyhow::bail!("skill upload failed ({}): {}", status, body);
        }
        Ok(response.json().await?)
    }

    pub async fn publish_skill(
        &self,
        _name: &str,
        skill_path: &Path,
    ) -> Result<SkillHubUploadResponse> {
        let content = fs::read_to_string(skill_path)?;
        let spec = parse_skill_file(skill_path, &content, SkillSource::User);

        let request = SkillHubUploadRequest {
            name: spec.name,
            description: spec.description,
            author: spec.author.clone().unwrap_or_else(|| "unknown".to_string()),
            version: spec.version.clone().unwrap_or_else(|| "1.0.0".to_string()),
            prompt: spec.prompt,
            tags: spec.tags,
        };

        self.upload_skill(request).await
    }

    pub async fn list_skill_versions(&self, name: &str) -> Result<Vec<SkillHubVersionMeta>> {
        let client = http_client()?;
        let url = format!(
            "{}/api/skills/{}/versions",
            self.base_url.trim_end_matches('/'),
            name
        );
        let response = client.get(&url).send().await?;
        let status = response.status();
        if !status.is_success() {
            let body = response.text().await.unwrap_or_default();
            anyhow::bail!("failed to list skill versions ({}): {}", status, body);
        }
        Ok(response.json().await?)
    }

    pub async fn list_skills(&self, page: u64, per_page: u64) -> Result<SkillHubSkillListResponse> {
        let client = http_client()?;
        let url = format!("{}/api/skills/list", self.base_url.trim_end_matches('/'));
        let response = client
            .get(&url)
            .query(&[("page", page), ("per_page", per_page)])
            .send()
            .await?;
        let status = response.status();
        if !status.is_success() {
            let body = response.text().await.unwrap_or_default();
            anyhow::bail!("failed to list skills ({}): {}", status, body);
        }
        Ok(response.json().await?)
    }

    pub async fn get_skill_info(&self, name: &str) -> Result<SkillHubSkillMeta> {
        let client = http_client()?;
        let url = format!(
            "{}/api/skills/{}/info",
            self.base_url.trim_end_matches('/'),
            name
        );
        let response = client.get(&url).send().await?;
        let status = response.status();
        if !status.is_success() {
            let body = response.text().await.unwrap_or_default();
            anyhow::bail!("failed to get skill info ({}): {}", status, body);
        }
        Ok(response.json().await?)
    }
}

impl Default for SkillHubClient {
    fn default() -> Self {
        Self::new()
    }
}

fn detect_skill_source(target_dir: &Path) -> SkillSource {
    // Windows 上 USERPROFILE 为用户主目录，Unix 上 HOME 为标准。
    if let Some(home) = std::env::var_os("USERPROFILE").or_else(|| std::env::var_os("HOME")) {
        let user_dir = Path::new(&home).join(".sacode").join("skills");
        if target_dir.starts_with(&user_dir) {
            return SkillSource::User;
        }
    }

    let normalized = target_dir.to_string_lossy().replace('\\', "/");
    if normalized.contains("/.sacode/") || normalized.ends_with("/.sacode") {
        SkillSource::Project
    } else {
        SkillSource::Workspace
    }
}

fn http_client() -> Result<Client> {
    Ok(Client::builder()
        .timeout(std::time::Duration::from_secs(20))
        .build()?)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detect_skill_source_distinguishes_user_and_project_dirs() {
        let temp_dir = tempfile::tempdir().expect("create temp dir");
        let home_dir = temp_dir.path().join("home");
        let project_dir = temp_dir.path().join("workspace");
        std::fs::create_dir_all(home_dir.join(".sacode/skills")).expect("create user dir");
        std::fs::create_dir_all(project_dir.join(".sacode/skills")).expect("create project dir");

        // detect_skill_source 优先读 USERPROFILE 再读 HOME，测试需同时设置两者，
        // 避免 Windows 真实 USERPROFILE 干扰用户级技能源判定。
        let previous_home = std::env::var_os("HOME");
        let previous_userprofile = std::env::var_os("USERPROFILE");
        std::env::set_var("HOME", &home_dir);
        std::env::set_var("USERPROFILE", &home_dir);

        let user_source = detect_skill_source(&home_dir.join(".sacode/skills"));
        let project_source = detect_skill_source(&project_dir.join(".sacode/skills"));

        match previous_home {
            Some(value) => std::env::set_var("HOME", value),
            None => std::env::remove_var("HOME"),
        }
        match previous_userprofile {
            Some(value) => std::env::set_var("USERPROFILE", value),
            None => std::env::remove_var("USERPROFILE"),
        }

        assert_eq!(user_source, SkillSource::User);
        assert_eq!(project_source, SkillSource::Project);
    }
}
