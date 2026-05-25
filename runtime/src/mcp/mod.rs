use anyhow::Result;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::{collections::BTreeMap, fs, path::{Path, PathBuf}};

use crate::tools::{SideEffectLevel, ToolSpec};

const MCP_CONFIG_FILE: &str = ".sacode/mcp.json";

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct McpConfig {
    #[serde(default)]
    pub mcp: BTreeMap<String, McpServerConfig>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McpServerConfig {
    #[serde(rename = "type")]
    pub server_type: String,
    pub url: String,
    pub enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McpServerDetails {
    pub protocol_version: Option<String>,
    pub server_name: Option<String>,
    pub server_version: Option<String>,
    pub instructions: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McpToolInfo {
    pub name: String,
    pub title: Option<String>,
    pub description: Option<String>,
    pub input_schema: serde_json::Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McpToolCallResult {
    pub content: serde_json::Value,
    pub is_error: bool,
}

#[derive(Debug, Clone)]
pub struct McpConfigStore {
    path: PathBuf,
}

impl McpConfigStore {
    pub fn new(workdir: &Path) -> Self {
        Self {
            path: workdir.join(MCP_CONFIG_FILE),
        }
    }

    pub fn load(&self) -> Result<McpConfig> {
        if !self.path.exists() {
            return Ok(McpConfig::default());
        }

        let content = fs::read_to_string(&self.path)?;
        Ok(serde_json::from_str(&content)?)
    }

    pub fn save(&self, config: &McpConfig) -> Result<()> {
        if let Some(parent) = self.path.parent() {
            fs::create_dir_all(parent)?;
        }

        fs::write(&self.path, serde_json::to_string_pretty(config)?)?;
        Ok(())
    }

    pub fn add_remote(&self, name: &str, url: &str) -> Result<()> {
        let mut config = self.load()?;
        config.mcp.insert(
            name.to_string(),
            McpServerConfig {
                server_type: "remote".to_string(),
                url: url.to_string(),
                enabled: true,
            },
        );
        self.save(&config)
    }

    pub fn set_enabled(&self, name: &str, enabled: bool) -> Result<()> {
        let mut config = self.load()?;
        let server = config
            .mcp
            .get_mut(name)
            .ok_or_else(|| anyhow::anyhow!("mcp server not found: {}", name))?;
        server.enabled = enabled;
        self.save(&config)
    }

    pub fn get(&self, name: &str) -> Result<McpServerConfig> {
        let config = self.load()?;
        config
            .mcp
            .get(name)
            .cloned()
            .ok_or_else(|| anyhow::anyhow!("mcp server not found: {}", name))
    }

    pub fn remove(&self, name: &str) -> Result<()> {
        let mut config = self.load()?;
        if config.mcp.remove(name).is_none() {
            anyhow::bail!("mcp server not found: {}", name);
        }
        self.save(&config)
    }
}

pub async fn inspect_server(server: &McpServerConfig) -> Result<McpServerDetails> {
    let client = http_client()?;
    let payload = serde_json::json!({
        "jsonrpc": "2.0",
        "id": 1,
        "method": "initialize",
        "params": {
            "protocolVersion": "2025-06-18",
            "capabilities": {},
            "clientInfo": {
                "name": "sacode",
                "version": env!("CARGO_PKG_VERSION")
            }
        }
    });

    let response: serde_json::Value = client
        .post(&server.url)
        .header("content-type", "application/json")
        .header("Mcp-Method", "initialize")
        .json(&payload)
        .send()
        .await?
        .json()
        .await?;

    let result = response
        .get("result")
        .cloned()
        .unwrap_or_else(|| serde_json::json!({}));

    Ok(McpServerDetails {
        protocol_version: result.get("protocolVersion").and_then(|v| v.as_str()).map(str::to_string),
        server_name: result.get("serverInfo").and_then(|v| v.get("name")).and_then(|v| v.as_str()).map(str::to_string),
        server_version: result.get("serverInfo").and_then(|v| v.get("version")).and_then(|v| v.as_str()).map(str::to_string),
        instructions: result.get("instructions").and_then(|v| v.as_str()).map(str::to_string),
    })
}

pub async fn list_tools(server: &McpServerConfig) -> Result<Vec<McpToolInfo>> {
    let client = http_client()?;
    let payload = serde_json::json!({
        "jsonrpc": "2.0",
        "id": 2,
        "method": "tools/list"
    });

    let response: serde_json::Value = client
        .post(&server.url)
        .header("content-type", "application/json")
        .header("Mcp-Method", "tools/list")
        .json(&payload)
        .send()
        .await?
        .json()
        .await?;

    let tools = response
        .get("result")
        .and_then(|value| value.get("tools"))
        .and_then(|value| value.as_array())
        .cloned()
        .unwrap_or_default();

    Ok(tools
        .into_iter()
        .map(|tool| McpToolInfo {
            name: tool.get("name").and_then(|v| v.as_str()).unwrap_or_default().to_string(),
            title: tool.get("title").and_then(|v| v.as_str()).map(str::to_string),
            description: tool.get("description").and_then(|v| v.as_str()).map(str::to_string),
            input_schema: tool.get("inputSchema").cloned().unwrap_or_else(|| serde_json::json!({})),
        })
        .collect())
}

pub async fn call_tool(server: &McpServerConfig, tool_name: &str, arguments: serde_json::Value) -> Result<McpToolCallResult> {
    let client = http_client()?;
    let payload = serde_json::json!({
        "jsonrpc": "2.0",
        "id": 3,
        "method": "tools/call",
        "params": {
            "name": tool_name,
            "arguments": arguments,
        }
    });

    let response: serde_json::Value = client
        .post(&server.url)
        .header("content-type", "application/json")
        .header("Mcp-Method", "tools/call")
        .json(&payload)
        .send()
        .await?
        .json()
        .await?;

    let result = response
        .get("result")
        .cloned()
        .unwrap_or_else(|| serde_json::json!({}));

    Ok(McpToolCallResult {
        content: result.get("content").cloned().unwrap_or_else(|| result.clone()),
        is_error: result.get("isError").and_then(|v| v.as_bool()).unwrap_or(false),
    })
}

pub async fn list_enabled_tool_specs(store: &McpConfigStore) -> Result<Vec<ToolSpec>> {
    let config = store.load()?;
    let mut specs = Vec::new();

    for (server_name, server) in config.mcp {
        if !server.enabled {
            continue;
        }

        let tools = match list_tools(&server).await {
            Ok(value) => value,
            Err(_) => continue,
        };

        for tool in tools {
            specs.push(tool_info_to_spec(&server_name, tool));
        }
    }

    specs.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(specs)
}

pub async fn find_enabled_search_tool(store: &McpConfigStore) -> Result<Option<(String, String)>> {
    let config = store.load()?;

    for (server_name, server) in config.mcp {
        if !server.enabled {
            continue;
        }

        let tools = match list_tools(&server).await {
            Ok(value) => value,
            Err(_) => continue,
        };

        for tool in tools {
            let lowered_name = tool.name.to_lowercase();
            let lowered_desc = tool.description.clone().unwrap_or_default().to_lowercase();
            if lowered_name.contains("search") || lowered_desc.contains("search") {
                return Ok(Some((server_name, tool.name)));
            }
        }
    }

    Ok(None)
}

fn tool_info_to_spec(server_name: &str, tool: McpToolInfo) -> ToolSpec {
    ToolSpec {
        name: format!("mcp.{}.{}", server_name, tool.name),
        description: tool.description.unwrap_or_else(|| "Remote MCP tool".to_string()),
        input_schema: tool.input_schema,
        output_schema: serde_json::json!({
            "type": "object"
        }),
        side_effect_level: SideEffectLevel::Execute,
        approval_required: true,
        timeout_ms: Some(30_000),
        tags: vec!["mcp".to_string(), server_name.to_string()],
    }
}

fn http_client() -> Result<Client> {
    Ok(Client::builder()
        .timeout(std::time::Duration::from_secs(20))
        .build()?)
}

pub fn call_mcp_tool_sync(server: &McpServerConfig, tool_name: &str, arguments: serde_json::Value) -> Result<McpToolCallResult> {
    let client = http_client()?;
    let payload = serde_json::json!({
        "jsonrpc": "2.0",
        "id": 3,
        "method": "tools/call",
        "params": {
            "name": tool_name,
            "arguments": arguments,
        }
    });

    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .map_err(|e| anyhow::anyhow!("runtime init failed: {}", e))?;

    runtime.block_on(async {
        let response: serde_json::Value = client
            .post(&server.url)
            .header("content-type", "application/json")
            .header("Mcp-Method", "tools/call")
            .json(&payload)
            .send()
            .await?
            .json()
            .await?;

        let result = response
            .get("result")
            .cloned()
            .unwrap_or_else(|| serde_json::json!({}));

        Ok(McpToolCallResult {
            content: result.get("content").cloned().unwrap_or_else(|| result.clone()),
            is_error: result.get("isError").and_then(|v| v.as_bool()).unwrap_or(false),
        })
    })
}

pub fn find_enabled_search_tool_sync(store: &McpConfigStore) -> Result<Option<(String, String)>> {
    let config = store.load()?;

    for (server_name, server) in config.mcp {
        if !server.enabled {
            continue;
        }

        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .map_err(|e| anyhow::anyhow!("runtime init failed: {}", e))?;

        let tools = match runtime.block_on(list_tools(&server)) {
            Ok(value) => value,
            Err(_) => continue,
        };

        for tool in tools {
            let lowered_name = tool.name.to_lowercase();
            let lowered_desc = tool.description.clone().unwrap_or_default().to_lowercase();
            if lowered_name.contains("search") || lowered_desc.contains("search") {
                return Ok(Some((server_name, tool.name)));
            }
        }
    }

    Ok(None)
}

pub fn list_enabled_mcp_tool_specs_sync(store: &McpConfigStore) -> Result<Vec<ToolSpec>> {
    let config = store.load()?;
    let mut specs = Vec::new();

    for (server_name, server) in config.mcp {
        if !server.enabled {
            continue;
        }

        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .map_err(|e| anyhow::anyhow!("runtime init failed: {}", e))?;

        let tools = match runtime.block_on(list_tools(&server)) {
            Ok(value) => value,
            Err(_) => continue,
        };

        for tool in tools {
            specs.push(tool_info_to_spec(&server_name, tool));
        }
    }

    specs.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(specs)
}
