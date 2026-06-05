use anyhow::Result;

use crate::provider_config::{
    fallback_models, fetch_models, NamedProviderConfig, ProviderConfig, ProviderConfigStore,
    SaCodeConfigStore,
};

#[derive(Debug, Clone)]
pub struct ModelOption {
    pub provider_name: String,
    pub model_name: String,
}

#[derive(Debug, Clone)]
pub struct ConnectResult {
    pub current_provider: NamedProviderConfig,
}

pub fn connect_provider(
    provider_store: &ProviderConfigStore,
    sacode_store: &SaCodeConfigStore,
    name: &str,
    base_url: &str,
    api_key: String,
) -> Result<ConnectResult> {
    let config = ProviderConfig {
        base_url: base_url.to_string(),
        api_key,
        model: String::new(),
    };

    provider_store.save_named(name, &config, true)?;
    let models = fetch_models(&config).unwrap_or_default();
    let (final_models, default_model) = if !models.is_empty() {
        (models.clone(), models[0].clone())
    } else {
        let fallbacks = fallback_models(name);
        let default = fallbacks.first().cloned().unwrap_or_default();
        (fallbacks, default)
    };

    let mut final_config = config;
    final_config.model = default_model.clone();
    if !default_model.is_empty() {
        provider_store.save_named(name, &final_config, true)?;
        let mut spec =
            sacode_store
                .provider(name)?
                .unwrap_or_else(|| sacode_kernel::model::ProviderSpec {
                    name: name.to_string(),
                    base_url: base_url.to_string(),
                    api_key: String::new(),
                    models: std::collections::BTreeMap::new(),
                });
        spec.name = name.to_string();
        spec.base_url = base_url.to_string();
        spec.api_key = final_config.api_key.clone();
        for model in &final_models {
            spec.models
                .entry(model.clone())
                .or_insert_with(|| sacode_kernel::model::ModelRule {
                    name: model.clone(),
                    ..Default::default()
                });
        }
        sacode_store.upsert_provider(name, spec)?;
        sacode_store.set_model(name, &default_model)?;
    }

    Ok(ConnectResult {
        current_provider: NamedProviderConfig {
            name: name.to_string(),
            config: final_config,
        },
    })
}

pub fn collect_model_options(
    provider_store: &ProviderConfigStore,
    sacode_store: &SaCodeConfigStore,
) -> Result<Vec<ModelOption>> {
    let Some(catalog) = provider_store.load_catalog()? else {
        return Ok(Vec::new());
    };

    let mut options = Vec::new();
    for (provider_name, config) in catalog.providers {
        let models = fetch_models(&config)
            .ok()
            .filter(|models| !models.is_empty())
            .unwrap_or_else(|| {
                let configured = sacode_store
                    .provider(&provider_name)
                    .ok()
                    .flatten()
                    .map(|spec| spec.models.keys().cloned().collect::<Vec<_>>())
                    .unwrap_or_default();
                if configured.is_empty() {
                    fallback_models(&provider_name)
                } else {
                    configured
                }
            });

        for model_name in models {
            options.push(ModelOption {
                provider_name: provider_name.clone(),
                model_name,
            });
        }
    }

    options.sort_by(|a, b| {
        a.provider_name
            .cmp(&b.provider_name)
            .then(a.model_name.cmp(&b.model_name))
    });
    Ok(options)
}

pub fn switch_model(
    provider_store: &ProviderConfigStore,
    sacode_store: &SaCodeConfigStore,
    provider_name: &str,
    model_name: &str,
) -> Result<NamedProviderConfig> {
    let mut config = provider_store
        .get(provider_name)?
        .ok_or_else(|| anyhow::anyhow!("provider not found: {}", provider_name))?;
    config.model = model_name.to_string();
    provider_store.save_named(provider_name, &config, true)?;
    sacode_store.set_model(provider_name, model_name)?;
    Ok(NamedProviderConfig {
        name: provider_name.to_string(),
        config,
    })
}

pub fn switch_provider(
    provider_store: &ProviderConfigStore,
    sacode_store: &SaCodeConfigStore,
    provider_name: &str,
) -> Result<NamedProviderConfig> {
    let config = sacode_store.load_or_default()?;
    let model_name = config
        .resolve_model(&config.model)
        .filter(|(name, _)| name == provider_name)
        .map(|(_, model_name)| model_name)
        .or_else(|| {
            config
                .provider
                .get(provider_name)
                .and_then(|spec| spec.models.keys().next().cloned())
        })
        .unwrap_or_default();
    sacode_store.set_model(provider_name, &model_name)?;
    provider_store.set_current(provider_name)?;
    let provider = provider_store
        .get(provider_name)?
        .ok_or_else(|| anyhow::anyhow!("provider not found: {}", provider_name))?;
    Ok(NamedProviderConfig {
        name: provider_name.to_string(),
        config: provider,
    })
}
