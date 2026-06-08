use std::{
    collections::BTreeMap,
    fs,
    path::{Path, PathBuf},
};

use anyhow::Result;
use serde::{Deserialize, Serialize};

const PROFILE_CONFIG_FILE: &str = ".sacode/profile.json";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ProfileDefinition {
    pub planner: String,
    pub coder: String,
    pub reviewer: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ProjectProfileConfig {
    #[serde(default)]
    pub current: String,
    #[serde(default)]
    pub profiles: BTreeMap<String, ProfileDefinition>,
}

#[derive(Debug, Clone)]
pub struct ProjectProfileStore {
    path: PathBuf,
}

impl ProjectProfileStore {
    pub fn new(workdir: &Path) -> Self {
        Self {
            path: workdir.join(PROFILE_CONFIG_FILE),
        }
    }

    pub fn load(&self) -> Result<ProjectProfileConfig> {
        if !self.path.exists() {
            return Ok(default_profile_config());
        }

        let content = fs::read_to_string(&self.path)?;
        let mut config: ProjectProfileConfig = serde_json::from_str(&content)?;
        normalize_profile_config(&mut config);
        Ok(config)
    }

    pub fn save(&self, config: &ProjectProfileConfig) -> Result<()> {
        if let Some(parent) = self.path.parent() {
            fs::create_dir_all(parent)?;
        }

        let mut normalized = config.clone();
        normalize_profile_config(&mut normalized);
        fs::write(&self.path, serde_json::to_string_pretty(&normalized)?)?;
        Ok(())
    }

    pub fn ensure_exists(&self) -> Result<ProjectProfileConfig> {
        let config = self.load()?;
        self.save(&config)?;
        Ok(config)
    }

    pub fn set_current(&self, name: &str) -> Result<ProjectProfileConfig> {
        let mut config = self.load()?;
        if !config.profiles.contains_key(name) {
            anyhow::bail!("profile not found: {}", name);
        }
        config.current = name.to_string();
        self.save(&config)?;
        Ok(config)
    }
}

pub fn default_profile_config() -> ProjectProfileConfig {
    let mut profiles = BTreeMap::new();
    profiles.insert(
        "default".to_string(),
        ProfileDefinition {
            planner: "gpt-5.4".to_string(),
            coder: "deepseek-v4-flash".to_string(),
            reviewer: "deepseek-v4-flash".to_string(),
        },
    );
    profiles.insert(
        "economy".to_string(),
        ProfileDefinition {
            planner: "deepseek-v4-flash".to_string(),
            coder: "deepseek-v4-flash".to_string(),
            reviewer: "deepseek-v4-flash".to_string(),
        },
    );
    profiles.insert(
        "local".to_string(),
        ProfileDefinition {
            planner: "ollama/glm-4.7-flash".to_string(),
            coder: "ollama/glm-4.7-flash".to_string(),
            reviewer: "ollama/glm-4.7-flash".to_string(),
        },
    );

    ProjectProfileConfig {
        current: "default".to_string(),
        profiles,
    }
}

fn normalize_profile_config(config: &mut ProjectProfileConfig) {
    if config.profiles.is_empty() {
        *config = default_profile_config();
        return;
    }

    config.current = config.current.trim().to_string();
    if config.current.is_empty() || !config.profiles.contains_key(&config.current) {
        config.current = config
            .profiles
            .keys()
            .next()
            .cloned()
            .unwrap_or_else(|| "default".to_string());
    }
}

#[cfg(test)]
mod tests {
    use std::{
        fs,
        time::{SystemTime, UNIX_EPOCH},
    };

    use super::ProjectProfileStore;

    #[test]
    fn project_profile_store_uses_project_local_file() {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time before unix epoch")
            .as_nanos();
        let workdir = std::env::temp_dir().join(format!("sacode-profile-store-{unique}"));
        fs::create_dir_all(&workdir).expect("create temp workdir");

        let store = ProjectProfileStore::new(&workdir);
        let config = store.ensure_exists().expect("ensure profile config");
        assert_eq!(config.current, "default");
        assert!(workdir.join(".sacode/profile.json").exists());

        let updated = store.set_current("local").expect("set current profile");
        assert_eq!(updated.current, "local");
    }
}
