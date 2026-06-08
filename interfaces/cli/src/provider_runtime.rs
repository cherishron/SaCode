use std::{
    collections::BTreeMap,
    env, fs,
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

use sacode_kernel::model::ModelProvider;
use sacode_runtime::{
    build_route_plan_from_candidates, resolve_config_model_candidates, ModelRoutePlan, TaskProfile,
};
use serde::{Deserialize, Serialize};

use crate::provider_config::{
    provider_spec_to_model_provider, NamedProviderConfig, ProviderConfigStore, SaCodeConfigStore,
};

const MODEL_HEALTH_FILE: &str = ".sacode/model-health.json";

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
struct ModelHealthStore {
    #[serde(default)]
    entries: BTreeMap<String, ModelHealthEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
struct ModelHealthEntry {
    #[serde(default)]
    success_count: u32,
    #[serde(default)]
    failure_count: u32,
    #[serde(default)]
    last_status: String,
    #[serde(default)]
    last_error: Option<String>,
    #[serde(default)]
    updated_at: u64,
}

pub fn resolve_named_provider(workdir: &Path) -> Option<NamedProviderConfig> {
    let store = ProviderConfigStore::new(workdir);
    store.load_current().ok().flatten()
}

pub fn record_model_health(
    workdir: &Path,
    provider_name: &str,
    model_name: &str,
    success: bool,
    error: Option<&str>,
) {
    let path = model_health_path(workdir);
    let mut store = load_model_health_store(&path).unwrap_or_default();
    let key = health_key(provider_name, model_name);
    let entry = store.entries.entry(key).or_default();
    if success {
        entry.success_count += 1;
        entry.last_status = "healthy".to_string();
        entry.last_error = None;
    } else {
        entry.failure_count += 1;
        entry.last_status = "unhealthy".to_string();
        entry.last_error = error.map(|value| value.to_string());
    }
    entry.updated_at = current_unix_ts();
    let _ = save_model_health_store(&path, &store);
}

pub fn resolve_provider(workdir: &Path) -> ModelProvider {
    let config_store = SaCodeConfigStore::new(workdir);
    if let Ok(Some(config)) = config_store.load() {
        if !config.model.trim().is_empty() {
            if let Some((provider_name, model_name)) = config.resolve_model(&config.model) {
                if let Some(provider) = config.provider.get(&provider_name) {
                    tracing::debug!(
                        "resolve_provider: using config.json → provider={}, model={}, base_url={}",
                        provider_name,
                        model_name,
                        provider.base_url
                    );
                    return provider_spec_to_model_provider(provider, &model_name);
                }
            }
        }
    }

    if let Some(named) = resolve_named_provider(workdir) {
        let config = named.config;
        if !config.base_url.is_empty() && !config.api_key.is_empty() {
            if !config.model.is_empty() {
                tracing::debug!(
                    "resolve_provider: using provider.json → name={}, model={}, base_url={}",
                    named.name,
                    config.model,
                    config.base_url
                );
                return config.to_model_provider();
            }
            // 即使 model 为空，也尝试使用 provider.json 的配置
            // model 为空时从 SaCodeConfig 中查找该 provider 的模型
            if let Ok(Some(sacode_config)) = config_store.load() {
                if let Some(provider_spec) = sacode_config.provider.get(&named.name) {
                    if let Some(first_model) = provider_spec.models.keys().next() {
                        let mut provider = config.to_model_provider();
                        provider.model = first_model.clone();
                        tracing::debug!(
                            "resolve_provider: provider.json model empty, using first model from config → provider={}, model={}, base_url={}",
                            named.name,
                            first_model,
                            config.base_url
                        );
                        return provider;
                    }
                }
            }
            tracing::warn!(
                "resolve_provider: provider.json has base_url+api_key but model is empty and no models found in config → provider={}",
                named.name
            );
        }
    }

    let model = env::var("SACODE_MODEL")
        .or_else(|_| env::var("DEFAULT_MODEL"))
        .unwrap_or_else(|_| "gpt-5.4".to_string());

    tracing::warn!(
        "resolve_provider: falling back to environment/default → model={}, kind will be inferred from model name",
        model
    );

    if model.starts_with("deepseek") {
        ModelProvider::deepseek(&model)
    } else if model.starts_with("mimo") {
        ModelProvider::mimo(&model)
    } else if model.to_lowercase().contains("longcat") {
        ModelProvider::longcat(&model)
    } else if model.starts_with("ollama") || model.contains("qwen") {
        ModelProvider::ollama(&model)
    } else {
        ModelProvider::openai(&model)
    }
}

pub fn resolve_model_candidates(workdir: &Path) -> Vec<(String, String, ModelProvider)> {
    let mut candidates = resolve_config_model_candidates(workdir);

    if candidates.is_empty() {
        if let Some(named) = resolve_named_provider(workdir) {
            let config = named.config;
            if !config.base_url.is_empty() && !config.api_key.is_empty() && !config.model.is_empty()
            {
                candidates.push((
                    named.name.clone(),
                    config.model.clone(),
                    config.to_model_provider(),
                ));
            }
        }
    }

    candidates
}

pub fn build_route_plan(
    workdir: &Path,
    candidates: &[(String, String, ModelProvider)],
    profile: &TaskProfile,
) -> Option<ModelRoutePlan> {
    build_route_plan_from_candidates(
        workdir,
        candidates,
        None,
        profile,
        "auto-selected based on task profile".to_string(),
    )
}

fn model_health_path(workdir: &Path) -> PathBuf {
    workdir.join(MODEL_HEALTH_FILE)
}

fn health_key(provider_name: &str, model_name: &str) -> String {
    format!("{}/{}", provider_name, model_name)
}

fn current_unix_ts() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|value| value.as_secs())
        .unwrap_or(0)
}

fn load_model_health_store(path: &Path) -> anyhow::Result<ModelHealthStore> {
    if !path.exists() {
        return Ok(ModelHealthStore::default());
    }
    let content = fs::read_to_string(path)?;
    Ok(serde_json::from_str(&content).unwrap_or_default())
}

fn save_model_health_store(path: &Path, store: &ModelHealthStore) -> anyhow::Result<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    fs::write(path, serde_json::to_string_pretty(store)?)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::provider_config::provider_spec_to_model_provider;
    use sacode_kernel::model::{ModelRule, ProviderSpec};
    use std::collections::BTreeMap;

    fn make_provider_spec() -> ProviderSpec {
        let mut models = BTreeMap::new();
        models.insert("model-a".to_string(), ModelRule::default());
        models.insert("model-b".to_string(), ModelRule::default());
        ProviderSpec {
            name: "test".to_string(),
            base_url: "https://example.com/v1".to_string(),
            api_key: "test-key".to_string(),
            models,
        }
    }

    #[test]
    fn build_route_plan_prefers_healthy_model_cache() {
        let temp_dir = tempfile::tempdir().expect("create temp dir");
        let workdir = temp_dir.path();
        let spec = make_provider_spec();
        let candidates = vec![
            (
                "provider".to_string(),
                "model-a".to_string(),
                provider_spec_to_model_provider(&spec, "model-a"),
            ),
            (
                "provider".to_string(),
                "model-b".to_string(),
                provider_spec_to_model_provider(&spec, "model-b"),
            ),
        ];

        record_model_health(workdir, "provider", "model-b", true, None);
        record_model_health(workdir, "provider", "model-a", false, Some("timeout"));

        let profile = TaskProfile::default();
        let plan = build_route_plan(workdir, &candidates, &profile).expect("build route plan");

        assert_eq!(plan.primary.model_name, "model-b");
        assert!(plan
            .primary
            .reasons
            .iter()
            .any(|reason| reason.contains("health cache adjusted")));
    }

    #[test]
    fn build_route_plan_uses_profile_score_without_cache() {
        let temp_dir = tempfile::tempdir().expect("create temp dir");
        let workdir = temp_dir.path();
        let spec = make_provider_spec();
        let candidates = vec![
            (
                "provider".to_string(),
                "deepseek-v4-pro".to_string(),
                provider_spec_to_model_provider(
                    &ProviderSpec {
                        models: {
                            let mut models = BTreeMap::new();
                            models.insert("deepseek-v4-pro".to_string(), ModelRule::default());
                            models
                        },
                        ..spec.clone()
                    },
                    "deepseek-v4-pro",
                ),
            ),
            (
                "provider".to_string(),
                "model-b".to_string(),
                provider_spec_to_model_provider(&spec, "model-b"),
            ),
        ];

        let profile = TaskProfile {
            languages: vec!["rust".to_string()],
            ..TaskProfile::default()
        };
        let plan = build_route_plan(workdir, &candidates, &profile).expect("build route plan");

        assert_eq!(plan.primary.model_name, "deepseek-v4-pro");
    }

    #[test]
    fn build_route_plan_applies_route_override() {
        let temp_dir = tempfile::tempdir().expect("create temp dir");
        let workdir = temp_dir.path();
        let mut models = BTreeMap::new();
        models.insert("model-a".to_string(), ModelRule::default());
        models.insert("model-b".to_string(), ModelRule::default());

        let mut provider = BTreeMap::new();
        provider.insert(
            "provider".to_string(),
            ProviderSpec {
                name: "test".to_string(),
                base_url: "https://example.com/v1".to_string(),
                api_key: "test-key".to_string(),
                models: models.clone(),
            },
        );

        std::fs::create_dir_all(workdir.join(".sacode")).expect("create .sacode");
        std::fs::write(
            workdir.join(".sacode/config.json"),
            serde_json::json!({
                "provider": provider,
                "model_routing": {
                    "overrides": [
                        {
                            "match": {
                                "languages": ["rust"],
                                "surfaces": ["cli"]
                            },
                            "prefer": ["provider/model-b"]
                        }
                    ]
                }
            })
            .to_string(),
        )
        .expect("write config");

        let spec = make_provider_spec();
        let candidates = vec![
            (
                "provider".to_string(),
                "model-a".to_string(),
                provider_spec_to_model_provider(&spec, "model-a"),
            ),
            (
                "provider".to_string(),
                "model-b".to_string(),
                provider_spec_to_model_provider(&spec, "model-b"),
            ),
        ];

        let profile = TaskProfile {
            languages: vec!["rust".to_string()],
            surfaces: vec!["cli".to_string()],
            ..TaskProfile::default()
        };
        let plan = build_route_plan(workdir, &candidates, &profile).expect("build route plan");

        assert_eq!(plan.primary.model_name, "model-b");
        assert!(plan
            .primary
            .reasons
            .iter()
            .any(|reason| reason.contains("override")));
    }
}
