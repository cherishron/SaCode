use std::path::{Path, PathBuf};

use anyhow::Result;
use sacode_runtime::{inspect_server, McpConfigStore, McpServerConfig, McpSource};

use crate::plugin_config::PluginConfigStore;

const CONTEXT7_NAME: &str = "context7";
const CONTEXT7_URL: &str = "https://mcp.context7.com/mcp";
const CONTEXT7_REMOTE_LABEL: &str = "official remote";

pub async fn run() -> Result<()> {
    let workdir = PathBuf::from(".");
    ensure_default_context7(&workdir).await?;
    println!("{}", render_status(&workdir).await?);
    Ok(())
}

pub async fn ensure_default_context7(workdir: &Path) -> Result<bool> {
    let store = McpConfigStore::new(workdir);
    let merged = store.load()?;
    if merged
        .mcp
        .get(CONTEXT7_NAME)
        .map(|server| server.enabled)
        .unwrap_or(false)
    {
        return Ok(false);
    }

    let mut project = store.load_from_source(McpSource::Project)?;
    project.mcp.insert(
        CONTEXT7_NAME.to_string(),
        McpServerConfig {
            server_type: "remote".to_string(),
            url: CONTEXT7_URL.to_string(),
            enabled: true,
        },
    );
    store.save_to_source(&project, McpSource::Project)?;
    Ok(true)
}

pub async fn render_status(workdir: &Path) -> Result<String> {
    let mut lines = vec!["当前状态".to_string()];
    lines.push(String::new());
    lines.push("MCP:".to_string());
    lines.extend(render_mcp_status(workdir).await?);
    lines.push(String::new());
    lines.push("插件:".to_string());
    lines.extend(render_plugin_status(workdir)?);
    Ok(lines.join("\n"))
}

async fn render_mcp_status(workdir: &Path) -> Result<Vec<String>> {
    let store = McpConfigStore::new(workdir);
    let entries = store.list_entries()?;
    if entries.is_empty() {
        return Ok(vec!["- 无 MCP 配置".to_string()]);
    }

    let mut lines = Vec::new();
    for entry in entries {
        let status = if entry.server.enabled {
            match inspect_server(&entry.server).await {
                Ok(details) => {
                    let mut suffix = String::new();
                    if let Some(name) = details.server_name {
                        suffix.push_str(&format!(" | server {}", name));
                    }
                    if let Some(version) = details.server_version {
                        suffix.push_str(&format!(" {}", version));
                    }
                    format!("connected{}", suffix)
                }
                Err(error) => format!("unreachable | {}", error),
            }
        } else {
            "disabled".to_string()
        };

        let provider = if entry.name == CONTEXT7_NAME && entry.server.url == CONTEXT7_URL {
            CONTEXT7_REMOTE_LABEL.to_string()
        } else {
            entry.server.server_type.clone()
        };

        lines.push(format!(
            "- {} [{}] {} | {} | {}",
            entry.name,
            entry.source.label(),
            provider,
            status,
            entry.server.url
        ));
    }
    Ok(lines)
}

fn render_plugin_status(workdir: &Path) -> Result<Vec<String>> {
    let store = PluginConfigStore::new(workdir);
    let entries = store.list_entries()?;
    if entries.is_empty() {
        return Ok(vec!["- 无插件配置".to_string()]);
    }

    Ok(entries
        .into_iter()
        .map(|plugin| {
            let version = if plugin.plugin.version.trim().is_empty() {
                "latest".to_string()
            } else {
                plugin.plugin.version
            };
            format!(
                "- {} {} | {} [{}]",
                plugin.plugin.name,
                version,
                if plugin.plugin.enabled {
                    "linked"
                } else {
                    "disabled"
                },
                plugin.source.label()
            )
        })
        .collect())
}
