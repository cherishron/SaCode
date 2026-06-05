use std::{
    collections::BTreeMap,
    env, fs,
    path::{Path, PathBuf},
};

use anyhow::Result;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct PluginConfigFile {
    #[serde(default)]
    pub plugins: Vec<PluginEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PluginEntry {
    pub name: String,
    #[serde(default)]
    pub version: String,
    #[serde(default = "default_true")]
    pub enabled: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PluginSource {
    User,
    Project,
}

impl PluginSource {
    pub fn label(self) -> &'static str {
        match self {
            Self::User => "user",
            Self::Project => "project",
        }
    }
}

#[derive(Debug, Clone)]
pub struct PluginResolvedEntry {
    pub plugin: PluginEntry,
    pub source: PluginSource,
}

#[derive(Debug, Clone)]
pub struct PluginConfigStore {
    user_path: PathBuf,
    project_path: PathBuf,
}

impl PluginConfigStore {
    pub fn new(workdir: &Path) -> Self {
        let user_path = env::var_os("HOME")
            .map(PathBuf::from)
            .unwrap_or_else(|| PathBuf::from("."))
            .join(".sacode/plugins.json");
        let project_path = workdir.join(".sacode/plugins.json");
        Self {
            user_path,
            project_path,
        }
    }

    pub fn user_path(&self) -> &Path {
        &self.user_path
    }

    pub fn project_path(&self) -> &Path {
        &self.project_path
    }

    pub fn load_from_source(&self, source: PluginSource) -> Result<PluginConfigFile> {
        let path = match source {
            PluginSource::User => &self.user_path,
            PluginSource::Project => &self.project_path,
        };
        if !path.exists() {
            return Ok(PluginConfigFile::default());
        }
        let content = fs::read_to_string(path)?;
        Ok(serde_json::from_str(&content)?)
    }

    pub fn save_to_source(&self, config: &PluginConfigFile, source: PluginSource) -> Result<()> {
        let path = match source {
            PluginSource::User => &self.user_path,
            PluginSource::Project => &self.project_path,
        };
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)?;
        }
        fs::write(path, serde_json::to_string_pretty(config)?)?;
        Ok(())
    }

    pub fn list_entries(&self) -> Result<Vec<PluginResolvedEntry>> {
        let mut merged = BTreeMap::new();
        for source in [PluginSource::User, PluginSource::Project] {
            let config = self.load_from_source(source)?;
            for plugin in config.plugins {
                merged.insert(plugin.name.clone(), PluginResolvedEntry { plugin, source });
            }
        }
        Ok(merged.into_values().collect())
    }

    pub fn upsert(&self, plugin: PluginEntry, source: PluginSource) -> Result<()> {
        let mut config = self.load_from_source(source)?;
        if let Some(existing) = config
            .plugins
            .iter_mut()
            .find(|entry| entry.name == plugin.name)
        {
            *existing = plugin;
        } else {
            config.plugins.push(plugin);
        }
        config.plugins.sort_by(|a, b| a.name.cmp(&b.name));
        self.save_to_source(&config, source)
    }

    pub fn remove(&self, name: &str, source: PluginSource) -> Result<()> {
        let mut config = self.load_from_source(source)?;
        let before = config.plugins.len();
        config.plugins.retain(|plugin| plugin.name != name);
        if before == config.plugins.len() {
            anyhow::bail!("plugin not found: {}", name);
        }
        self.save_to_source(&config, source)
    }

    pub fn set_enabled(&self, name: &str, enabled: bool, source: PluginSource) -> Result<()> {
        let mut config = self.load_from_source(source)?;
        let Some(plugin) = config.plugins.iter_mut().find(|plugin| plugin.name == name) else {
            anyhow::bail!("plugin not found: {}", name);
        };
        plugin.enabled = enabled;
        self.save_to_source(&config, source)
    }
}

fn default_true() -> bool {
    true
}
