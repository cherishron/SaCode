use anyhow::{anyhow, Result};
use serde::{Deserialize, Serialize};
use std::path::Path;

use crate::{list_enabled_mcp_tool_specs, McpConfigStore, SideEffectLevel, ToolRegistry};

use super::loader::PluginLoader;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PluginKind {
    Builtin,
    Mcp,
    Configured,
}

impl PluginKind {
    pub fn label(self) -> &'static str {
        match self {
            Self::Builtin => "builtin",
            Self::Mcp => "mcp",
            Self::Configured => "configured",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PluginDescriptor {
    pub name: String,
    pub description: String,
    pub kind: PluginKind,
    pub version: Option<String>,
    pub enabled: bool,
    pub source_label: String,
    pub side_effect_level: Option<SideEffectLevel>,
    pub approval_required: Option<bool>,
    pub input_schema: Option<serde_json::Value>,
    #[serde(default)]
    pub tags: Vec<String>,
}

#[derive(Debug, Default, Clone)]
pub struct PluginRegistry {
    entries: Vec<PluginDescriptor>,
}

impl PluginRegistry {
    pub fn discover_builtin() -> Self {
        let mut entries: Vec<_> = ToolRegistry::builtin()
            .specs()
            .into_iter()
            .map(PluginLoader::builtin_from_tool_spec)
            .collect();
        entries.sort_by(|a, b| a.name.cmp(&b.name));
        Self { entries }
    }

    pub async fn discover(workdir: &Path) -> Self {
        let mut entries = Self::discover_builtin().entries;
        let store = McpConfigStore::new(workdir);

        if let Ok(specs) = list_enabled_mcp_tool_specs(&store).await {
            entries.extend(specs.iter().map(PluginLoader::mcp_from_tool_spec));
        }

        entries.sort_by(|a, b| a.name.cmp(&b.name));
        Self { entries }
    }

    pub fn list(&self) -> &[PluginDescriptor] {
        &self.entries
    }

    pub fn search(&self, query: &str) -> Vec<&PluginDescriptor> {
        let needle = query.trim().to_lowercase();
        if needle.is_empty() {
            return self.entries.iter().collect();
        }

        self.entries
            .iter()
            .filter(|entry| {
                entry.name.to_lowercase().contains(&needle)
                    || entry.description.to_lowercase().contains(&needle)
                    || entry
                        .tags
                        .iter()
                        .any(|tag| tag.to_lowercase().contains(&needle))
                    || entry.source_label.to_lowercase().contains(&needle)
            })
            .collect()
    }

    pub fn get(&self, name: &str) -> Result<&PluginDescriptor> {
        self.entries
            .iter()
            .find(|entry| entry.name == name)
            .ok_or_else(|| anyhow!("plugin not found: {}", name))
    }

    pub fn push(&mut self, entry: PluginDescriptor) {
        self.entries.push(entry);
        self.entries.sort_by(|a, b| a.name.cmp(&b.name));
    }
}
