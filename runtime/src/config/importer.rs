//! Detect and read provider configuration from external coding tools.
//!
//! Reads are strictly read-only: source tool configs are never written back.
//! Applying an import writes only into SaCode's own `provider.json` under the
//! target project root.

use std::fs;
use std::path::{Path, PathBuf};

use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};

use crate::identity::provider_bridge::{ProviderCatalog, ProviderCatalogBridge, ProviderEntry};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ExternalTool {
    CodeBuddy,
    OpenCode,
}

impl ExternalTool {
    pub fn id(self) -> &'static str {
        match self {
            ExternalTool::CodeBuddy => "codebuddy",
            ExternalTool::OpenCode => "opencode",
        }
    }

    pub fn label(self) -> &'static str {
        match self {
            ExternalTool::CodeBuddy => "CodeBuddy",
            ExternalTool::OpenCode => "OpenCode",
        }
    }

    fn parse(s: &str) -> Option<Self> {
        match s {
            "codebuddy" => Some(ExternalTool::CodeBuddy),
            "opencode" => Some(ExternalTool::OpenCode),
            _ => None,
        }
    }
}

/// A detected external tool plus the config path that was found on disk.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DetectedTool {
    pub id: String,
    pub label: String,
    pub config_path: String,
    pub provider_count: usize,
}

/// One provider entry read from an external tool, before user confirmation.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ImportedProvider {
    /// Provider name pre-filled for the SaCode catalog.
    pub name: String,
    pub base_url: String,
    pub model: String,
    pub auth_header: Option<String>,
    pub auth_scheme: Option<String>,
    /// true when the source entry already carries a plaintext key.
    pub has_api_key: bool,
    #[serde(skip_serializing)]
    pub api_key: Option<String>,
}

fn home_dir() -> PathBuf {
    std::env::var_os("USERPROFILE")
        .or_else(|| std::env::var_os("HOME"))
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("."))
}

fn local_appdata() -> Option<PathBuf> {
    std::env::var_os("LOCALAPPDATA").map(PathBuf::from)
}

fn config_dir() -> Option<PathBuf> {
    std::env::var_os("APPDATA").map(PathBuf::from)
}

/// Candidate config directories for a tool, in probe order.
fn tool_config_paths(tool: ExternalTool) -> Vec<PathBuf> {
    let home = home_dir();
    match tool {
        ExternalTool::CodeBuddy => {
            let mut paths = Vec::new();
            if let Some(local) = local_appdata() {
                paths.push(local.join("CodeBuddyExtension"));
            }
            if let Some(config) = config_dir() {
                paths.push(config.join("codebuddy"));
            }
            paths.push(home.join(".config").join("codebuddy"));
            paths
        }
        ExternalTool::OpenCode => vec![
            home.join(".config").join("opencode"),
            home.join(".opencode"),
        ],
    }
}

/// Direct read of the first existing config file, ignoring candidates that do
/// not exist on this machine.
fn read_first_json(paths: &[PathBuf]) -> Option<(PathBuf, serde_json::Value)> {
    for path in paths {
        let Ok(raw) = fs::read_to_string(path) else {
            continue;
        };
        if raw.trim().is_empty() {
            continue;
        }
        if let Ok(value) = serde_json::from_str::<serde_json::Value>(&raw) {
            return Some((path.clone(), value));
        }
    }
    None
}

fn config_file_candidates(base: &Path) -> Vec<PathBuf> {
    let mut out = vec![
        base.join("opencode.json"),
        base.join("opencode.jsonc"),
        base.join("providers.json"),
        base.join("settings.json"),
        base.join("config.json"),
    ];
    // Some tools keep a named config file (e.g. `opencode.json`).
    out.extend(
        fs::read_dir(base)
            .into_iter()
            .flatten()
            .filter_map(|entry| entry.ok())
            .map(|entry| entry.path())
            .filter(|path| {
                path.is_file()
                    && path
                        .file_name()
                        .map(|n| n.to_string_lossy().to_lowercase())
                        .is_some_and(|n| n.ends_with(".json"))
                    && !n_is_ignored(path)
            }),
    );
    out
}

fn n_is_ignored(path: &Path) -> bool {
    let name = path
        .file_name()
        .map(|n| n.to_string_lossy().to_lowercase())
        .unwrap_or_default();
    name == "package.json" || name == "package-lock.json" || name == "tsconfig.json"
}

/// Detect external tools whose config directory exists on this machine.
pub fn detect_external_tools() -> Vec<DetectedTool> {
    [ExternalTool::CodeBuddy, ExternalTool::OpenCode]
        .into_iter()
        .filter_map(|tool| {
            let candidates = tool_config_paths(tool);
            let base = candidates.into_iter().find(|base| base.is_dir())?;
            let provider_count = read_providers_at(&base).len();
            Some(DetectedTool {
                id: tool.id().to_string(),
                label: tool.label().to_string(),
                config_path: base.display().to_string(),
                provider_count,
            })
        })
        .collect()
}

/// Read provider entries from an external tool config.
///
/// Tolerates the two common shapes:
/// `{"providers": {"name": {...}}}` and `{"provider": {"name": {...}}}`,
/// plus a top-level `models` list where each item is a provider descriptor.
pub fn read_tool_providers(tool: ExternalTool) -> Vec<ImportedProvider> {
    tool_config_paths(tool)
        .into_iter()
        .filter(|path| path.is_dir())
        .flat_map(|base| read_providers_at(&base))
        .collect()
}

fn read_providers_at(base: &Path) -> Vec<ImportedProvider> {
    for path in config_file_candidates(base) {
        if let Some((_, value)) = read_first_json(&[path]) {
            let providers = parse_providers(&value);
            if !providers.is_empty() {
                return providers;
            }
        }
    }
    Vec::new()
}

fn parse_providers(value: &serde_json::Value) -> Vec<ImportedProvider> {
    let mut out = Vec::new();
    let push = |name: String, entry: &serde_json::Value, out: &mut Vec<ImportedProvider>| {
        let Some(obj) = entry.as_object() else {
            return;
        };
        let base_url = string_field(obj, &["base_url", "baseURL", "baseUrl", "url", "endpoint"]);
        let api_key = string_field(obj, &["api_key", "apiKey", "apikey"]);
        let model = string_field(obj, &["model", "default_model", "defaultModel"])
            .unwrap_or_else(|| models_field(obj).join(", "));
        // 没有 base_url 的条目无法作为 Provider 使用，直接跳过。
        if base_url.is_none() {
            return;
        }
        out.push(ImportedProvider {
            name,
            base_url: base_url.unwrap_or_default(),
            model,
            auth_header: string_field(obj, &["auth_header", "authHeader"]),
            auth_scheme: string_field(obj, &["auth_scheme", "authScheme"]),
            has_api_key: api_key.is_some(),
            api_key,
        });
    };

    for key in ["providers", "provider", "providers_list"] {
        if let Some(map) = value.get(key).and_then(|v| v.as_object()) {
            for (name, entry) in map {
                push(name.clone(), entry, &mut out);
            }
            if !out.is_empty() {
                return dedup(out);
            }
        }
    }
    if let Some(map) = value.get("providers").and_then(|v| v.as_array()) {
        for entry in map {
            let name = string_field_obj(entry, &["name", "id"]).unwrap_or_default();
            push(name, entry, &mut out);
        }
    }
    if let Some(list) = value.get("models").and_then(|v| v.as_array()) {
        for entry in list {
            let name = string_field_obj(entry, &["name", "id"]).unwrap_or_default();
            push(name, entry, &mut out);
        }
    }
    dedup(out)
}

fn dedup(mut providers: Vec<ImportedProvider>) -> Vec<ImportedProvider> {
    let mut seen = std::collections::BTreeSet::new();
    providers.retain(|p| seen.insert(format!("{}|{}", p.name, p.base_url)));
    providers
}

fn string_field(obj: &serde_json::Map<String, serde_json::Value>, keys: &[&str]) -> Option<String> {
    keys.iter()
        .find_map(|key| obj.get(*key))
        .and_then(|v| v.as_str())
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}

fn string_field_obj(value: &serde_json::Value, keys: &[&str]) -> Option<String> {
    value.as_object().and_then(|obj| string_field(obj, keys))
}

fn models_field(obj: &serde_json::Map<String, serde_json::Value>) -> Vec<String> {
    obj.get("models")
        .and_then(|v| v.as_array())
        .map(|list| {
            list.iter()
                .filter_map(|m| m.as_str().map(|s| s.to_string()))
                .collect()
        })
        .unwrap_or_default()
}

/// Resolve a tool id from its wire string.
pub fn tool_from_id(id: &str) -> Option<ExternalTool> {
    ExternalTool::parse(id)
}

/// Apply user-confirmed provider entries into SaCode's `provider.json`.
///
/// Entries with an empty name or base_url are rejected. The returned catalog
/// reflects the on-disk state after the write.
pub fn apply_imported_providers(
    workdir: &Path,
    providers: Vec<ImportedProvider>,
) -> Result<ProviderCatalog> {
    let bridge = ProviderCatalogBridge::new(workdir);
    let mut catalog = bridge.load().context("read provider catalog")?;
    for provider in providers {
        let name = provider.name.trim().to_string();
        if name.is_empty() {
            anyhow::bail!("provider name is empty");
        }
        if provider.base_url.trim().is_empty() {
            anyhow::bail!("provider {name} has no base_url");
        }
        let mut entry = ProviderEntry {
            base_url: provider.base_url.trim().to_string(),
            model: provider.model.trim().to_string(),
            auth_header: provider.auth_header.clone(),
            auth_scheme: provider.auth_scheme.clone(),
            ..ProviderEntry::default()
        };
        // Source api_key stays in memory only; never persisted in plaintext.
        entry.api_key = String::new();
        catalog.providers.insert(name, entry);
    }
    bridge.save(&catalog).context("write provider catalog")?;
    Ok(catalog)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_object_shaped_providers() {
        let value = serde_json::json!({
            "providers": {
                "acme": {
                    "base_url": "https://api.acme.dev/v1",
                    "api_key": "sk-test",
                    "model": "acme-large"
                },
                "beta": {
                    "baseURL": "https://beta.example",
                    "models": ["m1", "m2"]
                }
            }
        });
        let parsed = parse_providers(&value);
        assert_eq!(parsed.len(), 2);
        let acme = parsed.iter().find(|p| p.name == "acme").unwrap();
        assert_eq!(acme.base_url, "https://api.acme.dev/v1");
        assert_eq!(acme.model, "acme-large");
        assert!(acme.has_api_key);
        let beta = parsed.iter().find(|p| p.name == "beta").unwrap();
        assert_eq!(beta.model, "m1, m2");
        assert!(!beta.has_api_key);
    }

    #[test]
    fn parse_models_array_shape() {
        let value = serde_json::json!({
            "models": [
                {"name": "openai", "base_url": "https://api.openai.com/v1", "api_key": "k"},
                {"name": "empty"}
            ]
        });
        let parsed = parse_providers(&value);
        assert_eq!(parsed.len(), 1);
        assert_eq!(parsed[0].name, "openai");
    }

    #[test]
    fn missing_config_detects_nothing() {
        assert!(read_tool_providers(ExternalTool::OpenCode).is_empty());
        let dir = tempfile::tempdir().unwrap();
        assert!(detect_external_tools()
            .into_iter()
            .all(|tool| tool.config_path != dir.path().display().to_string()));
    }

    #[test]
    fn apply_rejects_empty_name_and_writes_catalog() {
        let dir = tempfile::tempdir().unwrap();
        let err = apply_imported_providers(
            dir.path(),
            vec![ImportedProvider {
                name: "  ".into(),
                base_url: "https://x".into(),
                model: "m".into(),
                auth_header: None,
                auth_scheme: None,
                has_api_key: false,
                api_key: None,
            }],
        );
        assert!(err.is_err());

        let catalog = apply_imported_providers(
            dir.path(),
            vec![ImportedProvider {
                name: "acme".into(),
                base_url: " https://api.acme.dev/v1 ".into(),
                model: "acme-large".into(),
                auth_header: None,
                auth_scheme: None,
                has_api_key: true,
                api_key: Some("sk-secret".into()),
            }],
        )
        .unwrap();
        let entry = catalog.providers.get("acme").unwrap();
        assert_eq!(entry.base_url, "https://api.acme.dev/v1");
        assert_eq!(entry.model, "acme-large");
        assert!(entry.api_key.is_empty(), "api_key must not be persisted");
    }

    #[test]
    fn tool_ids_round_trip() {
        assert_eq!(tool_from_id("codebuddy"), Some(ExternalTool::CodeBuddy));
        assert_eq!(tool_from_id("opencode"), Some(ExternalTool::OpenCode));
        assert_eq!(tool_from_id("nope"), None);
    }
}
