use std::{env, path::Path};

use sacode_kernel::model::ModelProvider;

use crate::provider_config::{NamedProviderConfig, ProviderConfigStore, SaCodeConfigStore, provider_spec_to_model_provider};

pub fn resolve_named_provider(workdir: &Path) -> Option<NamedProviderConfig> {
    let store = ProviderConfigStore::new(workdir);
    store.load_current().ok().flatten()
}

pub fn resolve_provider(workdir: &Path) -> ModelProvider {
    let config_store = SaCodeConfigStore::new(workdir);
    if let Ok(Some(config)) = config_store.load() {
        if !config.model.trim().is_empty() {
            if let Some((provider_name, model_name)) = config.resolve_model(&config.model) {
                if let Some(provider) = config.provider.get(&provider_name) {
                    return provider_spec_to_model_provider(provider, &model_name);
                }
            }
        }
    }

    if let Some(named) = resolve_named_provider(workdir) {
        let config = named.config;
        if !config.base_url.is_empty() && !config.api_key.is_empty() && !config.model.is_empty() {
            return config.to_model_provider();
        }
    }

    let model = env::var("SACODE_MODEL")
        .or_else(|_| env::var("DEFAULT_MODEL"))
        .unwrap_or_else(|_| "gpt-4o-mini".to_string());

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
