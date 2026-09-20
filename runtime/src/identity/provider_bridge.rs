//! Bridge between identity login and project `provider.json` catalog.
//!
//! Keeps identity concerns out of the CLI provider store while ensuring the
//! sa-ai provider entry never holds plaintext api_key on disk.

use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};

use anyhow::{Context, Result};
use sacode_kernel::model::{normalize_base_url, SecretRef};
use serde::{Deserialize, Serialize};

const PROVIDER_CONFIG_FILE: &str = ".sacode/provider.json";

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ProviderEntry {
    #[serde(default)]
    pub base_url: String,
    #[serde(default)]
    pub api_key: String,
    #[serde(default)]
    pub model: String,
    #[serde(default)]
    pub auth_header: Option<String>,
    #[serde(default)]
    pub auth_scheme: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub secret_ref: Option<SecretRef>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ProviderCatalog {
    #[serde(default)]
    pub current: String,
    #[serde(default)]
    pub providers: BTreeMap<String, ProviderEntry>,
}

pub struct ProviderCatalogBridge {
    path: PathBuf,
}

impl ProviderCatalogBridge {
    pub fn new(workdir: &Path) -> Self {
        Self {
            path: workdir.join(PROVIDER_CONFIG_FILE),
        }
    }

    pub fn load(&self) -> Result<ProviderCatalog> {
        if !self.path.exists() {
            return Ok(ProviderCatalog::default());
        }
        let raw = fs::read_to_string(&self.path)
            .with_context(|| format!("read {}", self.path.display()))?;
        if raw.trim().is_empty() {
            return Ok(ProviderCatalog::default());
        }
        let value: serde_json::Value = serde_json::from_str(&raw)?;
        if value.get("providers").is_some() {
            return Ok(serde_json::from_value(value)?);
        }
        // legacy single-provider shape
        let entry: ProviderEntry = serde_json::from_value(value)?;
        let mut providers = BTreeMap::new();
        providers.insert("default".to_string(), entry);
        Ok(ProviderCatalog {
            current: "default".to_string(),
            providers,
        })
    }

    pub fn save(&self, catalog: &ProviderCatalog) -> Result<()> {
        if let Some(parent) = self.path.parent() {
            fs::create_dir_all(parent)?;
        }
        fs::write(&self.path, serde_json::to_string_pretty(catalog)?)
            .with_context(|| format!("write {}", self.path.display()))?;
        Ok(())
    }

    pub fn upsert_identity_provider(
        &mut self,
        name: &str,
        base_url: &str,
        secret_ref: SecretRef,
        model: &str,
        auth_header: Option<&str>,
        auth_scheme: Option<&str>,
    ) -> Result<()> {
        let mut catalog = self.load()?;
        catalog.providers.insert(
            name.to_string(),
            ProviderEntry {
                base_url: normalize_base_url(base_url),
                // Security baseline: never write gateway api_key plaintext.
                api_key: String::new(),
                model: model.to_string(),
                auth_header: auth_header.map(|s| s.to_string()),
                auth_scheme: auth_scheme.map(|s| s.to_string()),
                secret_ref: Some(secret_ref),
            },
        );
        self.save(&catalog)
    }

    pub fn set_current(&mut self, name: &str) -> Result<()> {
        let mut catalog = self.load()?;
        if !catalog.providers.contains_key(name) {
            anyhow::bail!("provider not found: {name}");
        }
        catalog.current = name.to_string();
        self.save(&catalog)
    }
}

/// Resolve api_key for a provider entry: plaintext if present, else secret_ref.
pub fn resolve_entry_api_key(
    entry: &ProviderEntry,
    secret_store: Option<&dyn crate::identity::secret_store::SecretStore>,
) -> Result<String> {
    if !entry.api_key.is_empty() {
        return Ok(entry.api_key.clone());
    }
    let Some(secret_ref) = entry.secret_ref.as_ref() else {
        return Ok(String::new());
    };
    crate::identity::secret_store::resolve_secret_ref(secret_ref, secret_store)
        .map(|v| v.unwrap_or_default())
}
