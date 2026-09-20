use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

use super::provider::{
    detect_provider_kind, ProviderAuthorization, ProviderAuthorizationSource, ProviderProfile,
    ProviderProfileType, ProviderRuntimeState, SecretRef, MIMO_TOKEN_PLAN_BASE_URL,
    OLLAMA_DEFAULT_BASE_URL,
};

pub const PROVIDER_CONFIG_SCHEMA_VERSION: u32 = 1;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SaCodeConfig {
    #[serde(default = "legacy_provider_schema_version")]
    pub provider_schema_version: u32,
    #[serde(default)]
    pub model: String,
    #[serde(default)]
    pub small_model: String,
    #[serde(default)]
    pub outstyle: String,
    #[serde(default)]
    pub vim_mode: bool,
    #[serde(default)]
    pub provider: BTreeMap<String, ProviderSpec>,
    #[serde(default)]
    pub provider_state: BTreeMap<String, ProviderRuntimeState>,
    #[serde(default)]
    pub provider_policy: ProviderPolicyConfig,
    #[serde(default)]
    pub model_routing: ModelRoutingConfig,
}

impl Default for SaCodeConfig {
    fn default() -> Self {
        Self {
            provider_schema_version: PROVIDER_CONFIG_SCHEMA_VERSION,
            model: String::new(),
            small_model: String::new(),
            outstyle: String::new(),
            vim_mode: false,
            provider: BTreeMap::new(),
            provider_state: BTreeMap::new(),
            provider_policy: ProviderPolicyConfig::default(),
            model_routing: ModelRoutingConfig::default(),
        }
    }
}

fn legacy_provider_schema_version() -> u32 {
    0
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ProviderPolicyConfig {
    #[serde(default = "default_provider_validation_timeout_ms")]
    pub validation_timeout_ms: u64,
    #[serde(default)]
    pub auto_failover: bool,
}

impl Default for ProviderPolicyConfig {
    fn default() -> Self {
        Self {
            validation_timeout_ms: default_provider_validation_timeout_ms(),
            auto_failover: false,
        }
    }
}

fn default_provider_validation_timeout_ms() -> u64 {
    10_000
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ModelRoutingConfig {
    #[serde(default)]
    pub overrides: Vec<ModelRouteOverride>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ModelRouteOverride {
    #[serde(default)]
    pub r#match: ModelRouteMatch,
    #[serde(default)]
    pub prefer: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ModelRouteMatch {
    #[serde(default)]
    pub languages: Vec<String>,
    #[serde(default)]
    pub surfaces: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProviderSpec {
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub base_url: String,
    #[serde(default)]
    pub api_key: String,
    #[serde(default)]
    pub models: BTreeMap<String, ModelRule>,
    /// 认证头名称覆盖，`None` 表示默认的 `Authorization`。
    #[serde(default)]
    pub auth_header: Option<String>,
    /// 认证头 scheme 前缀覆盖，`Some("")` 表示发送裸密钥。
    #[serde(default)]
    pub auth_scheme: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ModelRule {
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub thinking: bool,
    #[serde(default)]
    pub reasoning_effort: Option<String>,
    #[serde(default)]
    pub limit: Option<ModelLimit>,
    #[serde(default)]
    pub temperature: Option<TemperatureRule>,
    #[serde(default)]
    pub top_p: Option<TopPRule>,
    #[serde(default)]
    pub modalities: Option<Modalities>,
    #[serde(default)]
    pub pricing: Option<ModelPricing>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ModelPricing {
    #[serde(default)]
    pub input_per_million: f64,
    #[serde(default)]
    pub output_per_million: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelLimit {
    #[serde(default)]
    pub context: u32,
    #[serde(default)]
    pub output: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TemperatureRule {
    #[serde(default)]
    pub default: f32,
    #[serde(default)]
    pub range: Option<(f32, f32)>,
    #[serde(default)]
    pub thinking_override: Option<f32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TopPRule {
    #[serde(default)]
    pub default: f32,
    #[serde(default)]
    pub range: Option<(f32, f32)>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Modalities {
    #[serde(default)]
    pub input: Vec<String>,
    #[serde(default)]
    pub output: Vec<String>,
}

impl SaCodeConfig {
    pub fn migrate_provider_compatibility(&mut self) -> bool {
        if self.provider_schema_version >= PROVIDER_CONFIG_SCHEMA_VERSION {
            self.retain_legacy_authorization_for_current();
            return false;
        }

        let current_provider = self
            .resolve_model(&self.model)
            .map(|(provider, _)| provider);
        for (provider_id, spec) in &self.provider {
            self.provider_state
                .entry(provider_id.clone())
                .or_insert_with(|| ProviderRuntimeState {
                    profile_type: ProviderProfileType::Custom,
                    credential_ref: SecretRef::legacy_inline(&spec.api_key),
                    validation: Default::default(),
                    authorization: if current_provider.as_deref() == Some(provider_id.as_str()) {
                        ProviderAuthorization::legacy_current()
                    } else {
                        ProviderAuthorization::default()
                    },
                });
        }
        self.provider_schema_version = PROVIDER_CONFIG_SCHEMA_VERSION;
        self.provider_policy.auto_failover = false;
        self.retain_legacy_authorization_for_current();
        true
    }

    pub fn retain_legacy_authorization_for_current(&mut self) {
        let current_provider = self
            .resolve_model(&self.model)
            .map(|(provider, _)| provider);
        for (provider_id, state) in &mut self.provider_state {
            if state.authorization.source == ProviderAuthorizationSource::LegacyCurrent
                && current_provider.as_deref() != Some(provider_id.as_str())
            {
                state.authorization = ProviderAuthorization::default();
            }
        }
    }

    pub fn provider_profile(&self, provider_id: &str) -> Option<ProviderProfile> {
        let spec = self.provider.get(provider_id)?;
        let state = self
            .provider_state
            .get(provider_id)
            .cloned()
            .unwrap_or_default();
        let selected_model = self
            .resolve_model(&self.model)
            .filter(|(current, _)| current == provider_id)
            .map(|(_, model)| model);
        let inferred_model = selected_model
            .as_deref()
            .or_else(|| spec.models.keys().next().map(String::as_str))
            .unwrap_or_default();
        Some(ProviderProfile {
            provider_id: provider_id.to_string(),
            display_name: if spec.name.trim().is_empty() {
                provider_id.to_string()
            } else {
                spec.name.clone()
            },
            kind: detect_provider_kind(&spec.base_url, inferred_model),
            profile_type: state.profile_type,
            endpoint: spec.base_url.clone(),
            credential_ref: state
                .credential_ref
                .or_else(|| SecretRef::legacy_inline(&spec.api_key)),
            selected_model,
            validation: state.validation,
            authorization: state.authorization,
        })
    }

    pub fn provider_is_authorized(&self, provider_id: &str, model: &str) -> bool {
        if let Some(state) = self.provider_state.get(provider_id) {
            return state.authorization.permits_model(model);
        }
        if let Some((current_provider, current_model)) = self.resolve_model(self.model.as_str()) {
            if current_provider == provider_id && current_model == model {
                return true;
            }
        }
        false
    }

    pub fn resolve_provider_and_model(
        &self,
        model_spec: &str,
    ) -> Option<(&ProviderSpec, &ModelRule, String)> {
        let (provider_name, model_name) = if let Some((p, m)) = model_spec.split_once('/') {
            (p, m)
        } else {
            ("", model_spec)
        };

        if !provider_name.is_empty() {
            let provider = self.provider.get(provider_name)?;
            let rule = provider.models.get(model_name)?;
            return Some((provider, rule, model_name.to_string()));
        }

        for provider in self.provider.values() {
            if let Some(rule) = provider.models.get(model_name) {
                return Some((provider, rule, model_name.to_string()));
            }
        }

        for provider in self.provider.values() {
            for (mname, rule) in &provider.models {
                if mname == model_name || rule.name.split_whitespace().next() == Some(model_name) {
                    return Some((provider, rule, mname.clone()));
                }
            }
        }

        None
    }

    pub fn resolve_model(&self, model_spec: &str) -> Option<(String, String)> {
        let (provider_name, model_name) = if let Some((p, m)) = model_spec.split_once('/') {
            (p.to_string(), m.to_string())
        } else {
            for (pname, provider) in &self.provider {
                if provider.models.contains_key(model_spec) {
                    return Some((pname.clone(), model_spec.to_string()));
                }
            }
            return None;
        };

        if self.provider.contains_key(&provider_name) {
            Some((provider_name, model_name))
        } else {
            None
        }
    }

    pub fn model_names_for_provider(&self, provider_name: &str) -> Vec<String> {
        self.provider
            .get(provider_name)
            .map(|p| p.models.keys().cloned().collect())
            .unwrap_or_default()
    }

    pub fn all_model_specs(&self) -> Vec<String> {
        let mut specs = Vec::new();
        for (pname, provider) in &self.provider {
            for mname in provider.models.keys() {
                specs.push(format!("{}/{}", pname, mname));
            }
        }
        specs.sort();
        specs
    }
}

impl ModelRule {
    pub fn should_think(&self) -> bool {
        self.thinking
    }

    pub fn effective_temperature(&self) -> Option<f32> {
        if self.thinking {
            self.temperature.as_ref().and_then(|t| t.thinking_override)
        } else {
            self.temperature.as_ref().map(|t| t.default)
        }
    }

    pub fn effective_top_p(&self) -> Option<f32> {
        if self.thinking {
            None
        } else {
            self.top_p.as_ref().map(|t| t.default)
        }
    }
}

pub fn preset_providers() -> BTreeMap<String, ProviderSpec> {
    let mut providers = BTreeMap::new();

    // ── Ollama 本地 ──
    providers.insert(
        "ollama".to_string(),
        ProviderSpec {
            name: "Ollama".to_string(),
            base_url: OLLAMA_DEFAULT_BASE_URL.to_string(),
            api_key: String::new(),
            auth_header: None,
            auth_scheme: None,
            models: {
                let mut m = BTreeMap::new();
                m.insert("glm-4.7-flash".to_string(), ModelRule::default());
                m
            },
        },
    );

    // ── DeepSeek ──
    providers.insert(
        "deepseek".to_string(),
        ProviderSpec {
            name: "DeepSeek".to_string(),
            base_url: "https://api.deepseek.com".to_string(),
            api_key: String::new(),
            auth_header: None,
            auth_scheme: None,
            models: {
                let mut m = BTreeMap::new();
                m.insert(
                    "deepseek-v4-flash".to_string(),
                    ModelRule {
                        name: "deepseek-v4-flash 快速模型".to_string(),
                        thinking: true,
                        reasoning_effort: Some("high".to_string()),
                        limit: Some(ModelLimit {
                            context: 1_000_000,
                            output: 384_000,
                        }),
                        temperature: Some(TemperatureRule {
                            default: 0.6,
                            range: Some((0.0, 1.0)),
                            thinking_override: None,
                        }),
                        top_p: Some(TopPRule {
                            default: 0.95,
                            range: Some((0.01, 1.0)),
                        }),
                        modalities: None,
                        pricing: Some(ModelPricing {
                            input_per_million: 1.00,
                            output_per_million: 2.00,
                        }),
                    },
                );
                m.insert(
                    "deepseek-v4-pro".to_string(),
                    ModelRule {
                        name: "deepseek-v4-pro 推理模型 (缓存命中 ¥0.025/未命中 ¥3.00)".to_string(),
                        thinking: true,
                        reasoning_effort: Some("max".to_string()),
                        limit: Some(ModelLimit {
                            context: 1_000_000,
                            output: 384_000,
                        }),
                        temperature: Some(TemperatureRule {
                            default: 0.6,
                            range: Some((0.0, 1.0)),
                            thinking_override: None,
                        }),
                        top_p: Some(TopPRule {
                            default: 0.95,
                            range: Some((0.01, 1.0)),
                        }),
                        modalities: None,
                        pricing: Some(ModelPricing {
                            input_per_million: 3.00,
                            output_per_million: 6.00,
                        }),
                    },
                );
                m
            },
        },
    );

    // ── MiMo ──
    providers.insert(
        "mimo".to_string(),
        ProviderSpec {
            name: "MiMo".to_string(),
            base_url: MIMO_TOKEN_PLAN_BASE_URL.to_string(),
            api_key: String::new(),
            auth_header: None,
            auth_scheme: None,
            models: {
                let mut m = BTreeMap::new();
                m.insert(
                    "mimo-v2.5-pro".to_string(),
                    ModelRule {
                        name: "mimo-v2.5-pro 最强推理，图文输入".to_string(),
                        thinking: true,
                        reasoning_effort: None,
                        limit: Some(ModelLimit {
                            context: 1_000_000,
                            output: 128_000,
                        }),
                        temperature: Some(TemperatureRule {
                            default: 1.0,
                            range: Some((0.0, 1.5)),
                            thinking_override: None,
                        }),
                        top_p: Some(TopPRule {
                            default: 0.95,
                            range: Some((0.01, 1.0)),
                        }),
                        modalities: Some(Modalities {
                            input: vec!["text".to_string(), "image".to_string()],
                            output: vec!["text".to_string()],
                        }),
                        pricing: Some(ModelPricing {
                            input_per_million: 0.80,
                            output_per_million: 2.00,
                        }),
                    },
                );
                m.insert(
                    "mimo-v2.5".to_string(),
                    ModelRule {
                        name: "mimo-v2.5 轻量快速，仅文本".to_string(),
                        thinking: true,
                        reasoning_effort: None,
                        limit: Some(ModelLimit {
                            context: 1_000_000,
                            output: 128_000,
                        }),
                        temperature: Some(TemperatureRule {
                            default: 1.0,
                            range: Some((0.0, 1.5)),
                            thinking_override: None,
                        }),
                        top_p: Some(TopPRule {
                            default: 0.95,
                            range: Some((0.01, 1.0)),
                        }),
                        modalities: Some(Modalities {
                            input: vec!["text".to_string()],
                            output: vec!["text".to_string()],
                        }),
                        pricing: Some(ModelPricing {
                            input_per_million: 0.80,
                            output_per_million: 2.00,
                        }),
                    },
                );
                m
            },
        },
    );

    // ── LongCat ──
    providers.insert(
        "longcat".to_string(),
        ProviderSpec {
            name: "LongCat".to_string(),
            base_url: "https://api.longcat.chat/openai/v1".to_string(),
            api_key: String::new(),
            auth_header: None,
            auth_scheme: None,
            models: {
                let mut m = BTreeMap::new();
                m.insert(
                    "LongCat-2.0-Preview".to_string(),
                    ModelRule {
                        name: "LongCat-2.0-Preview 超限免费".to_string(),
                        thinking: false,
                        reasoning_effort: None,
                        limit: Some(ModelLimit {
                            context: 1_000_000,
                            output: 128_000,
                        }),
                        temperature: None,
                        top_p: None,
                        modalities: None,
                        pricing: Some(ModelPricing {
                            input_per_million: 0.0,
                            output_per_million: 0.0,
                        }),
                    },
                );
                m
            },
        },
    );

    // ── OpenAI ──
    providers.insert(
        "openai".to_string(),
        ProviderSpec {
            name: "OpenAI".to_string(),
            base_url: "https://api.openai.com/v1".to_string(),
            api_key: String::new(),
            auth_header: None,
            auth_scheme: None,
            models: {
                let mut m = BTreeMap::new();
                m.insert(
                    "gpt-5.4".to_string(),
                    ModelRule {
                        name: "gpt-5.4".to_string(),
                        thinking: false,
                        reasoning_effort: None,
                        limit: Some(ModelLimit {
                            context: 128_000,
                            output: 16_384,
                        }),
                        temperature: Some(TemperatureRule {
                            default: 0.7,
                            range: Some((0.0, 2.0)),
                            thinking_override: None,
                        }),
                        top_p: Some(TopPRule {
                            default: 0.95,
                            range: Some((0.01, 1.0)),
                        }),
                        modalities: None,
                        pricing: Some(ModelPricing {
                            input_per_million: 2.50,
                            output_per_million: 15.00,
                        }),
                    },
                );
                m.insert(
                    "gpt-5.5".to_string(),
                    ModelRule {
                        name: "gpt-5.5 (输出量待定)".to_string(),
                        thinking: false,
                        reasoning_effort: None,
                        limit: Some(ModelLimit {
                            context: 1_000_000,
                            output: 0,
                        }),
                        temperature: Some(TemperatureRule {
                            default: 0.7,
                            range: Some((0.0, 2.0)),
                            thinking_override: None,
                        }),
                        top_p: Some(TopPRule {
                            default: 0.95,
                            range: Some((0.01, 1.0)),
                        }),
                        modalities: None,
                        pricing: Some(ModelPricing {
                            input_per_million: 5.00,
                            output_per_million: 30.00,
                        }),
                    },
                );
                m
            },
        },
    );

    // ── 智谱 GLM（OpenAI 兼容）──
    providers.insert(
        "zhipu".to_string(),
        ProviderSpec {
            name: "智谱 GLM".to_string(),
            base_url: "https://open.bigmodel.cn/api/paas/v4".to_string(),
            api_key: String::new(),
            auth_header: None,
            auth_scheme: None,
            models: {
                let mut m = BTreeMap::new();
                m.insert(
                    "glm-4.7-flash".to_string(),
                    ModelRule {
                        name: "glm-4.7-flash 快速免费模型".to_string(),
                        thinking: false,
                        reasoning_effort: None,
                        limit: Some(ModelLimit {
                            context: 128_000,
                            output: 16_384,
                        }),
                        temperature: Some(TemperatureRule {
                            default: 0.7,
                            range: Some((0.0, 1.0)),
                            thinking_override: None,
                        }),
                        top_p: Some(TopPRule {
                            default: 0.95,
                            range: Some((0.01, 1.0)),
                        }),
                        modalities: None,
                        pricing: Some(ModelPricing {
                            input_per_million: 0.0,
                            output_per_million: 0.0,
                        }),
                    },
                );
                m.insert(
                    "glm-4.6".to_string(),
                    ModelRule {
                        name: "glm-4.6 旗舰模型".to_string(),
                        thinking: false,
                        reasoning_effort: None,
                        limit: Some(ModelLimit {
                            context: 200_000,
                            output: 16_384,
                        }),
                        temperature: Some(TemperatureRule {
                            default: 0.7,
                            range: Some((0.0, 1.0)),
                            thinking_override: None,
                        }),
                        top_p: Some(TopPRule {
                            default: 0.95,
                            range: Some((0.01, 1.0)),
                        }),
                        modalities: None,
                        pricing: Some(ModelPricing {
                            input_per_million: 2.0,
                            output_per_million: 8.0,
                        }),
                    },
                );
                m
            },
        },
    );

    // ── 通义千问（DashScope OpenAI 兼容）──
    providers.insert(
        "qwen".to_string(),
        ProviderSpec {
            name: "通义千问".to_string(),
            base_url: "https://dashscope.aliyuncs.com/compatible-mode/v1".to_string(),
            api_key: String::new(),
            auth_header: None,
            auth_scheme: None,
            models: {
                let mut m = BTreeMap::new();
                m.insert(
                    "qwen-plus".to_string(),
                    ModelRule {
                        name: "qwen-plus 通义千问 Plus".to_string(),
                        thinking: false,
                        reasoning_effort: None,
                        limit: Some(ModelLimit {
                            context: 131_072,
                            output: 8_192,
                        }),
                        temperature: Some(TemperatureRule {
                            default: 0.7,
                            range: Some((0.0, 2.0)),
                            thinking_override: None,
                        }),
                        top_p: Some(TopPRule {
                            default: 0.8,
                            range: Some((0.01, 1.0)),
                        }),
                        modalities: None,
                        pricing: Some(ModelPricing {
                            input_per_million: 0.80,
                            output_per_million: 2.0,
                        }),
                    },
                );
                m.insert(
                    "qwen-turbo".to_string(),
                    ModelRule {
                        name: "qwen-turbo 通义千问 Turbo".to_string(),
                        thinking: false,
                        reasoning_effort: None,
                        limit: Some(ModelLimit {
                            context: 1_000_000,
                            output: 8_192,
                        }),
                        temperature: Some(TemperatureRule {
                            default: 0.7,
                            range: Some((0.0, 2.0)),
                            thinking_override: None,
                        }),
                        top_p: Some(TopPRule {
                            default: 0.8,
                            range: Some((0.01, 1.0)),
                        }),
                        modalities: None,
                        pricing: Some(ModelPricing {
                            input_per_million: 0.30,
                            output_per_million: 0.60,
                        }),
                    },
                );
                m
            },
        },
    );
    providers
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::{ProviderAuthorizationSource, ProviderValidationStatus, SecretRefKind};

    fn legacy_config() -> SaCodeConfig {
        serde_json::from_value(serde_json::json!({
            "model": "primary/model-a",
            "provider": {
                "primary": {
                    "name": "Primary",
                    "base_url": "https://primary.example/v1",
                    "api_key": "sk-primary-secret",
                    "models": {
                        "model-a": { "name": "Model A" }
                    }
                },
                "fallback": {
                    "name": "Fallback",
                    "base_url": "https://fallback.example/v1",
                    "api_key": "sk-fallback-secret",
                    "models": {
                        "model-b": { "name": "Model B" }
                    }
                }
            }
        }))
        .expect("deserialize legacy provider config")
    }

    #[test]
    fn legacy_config_migrates_to_unverified_current_only_authorization() {
        let mut config = legacy_config();
        assert_eq!(config.provider_schema_version, 0);

        assert!(config.migrate_provider_compatibility());
        assert_eq!(
            config.provider_schema_version,
            PROVIDER_CONFIG_SCHEMA_VERSION
        );
        assert!(!config.provider_policy.auto_failover);

        let primary = config.provider_state.get("primary").expect("primary state");
        assert_eq!(
            primary.validation.status,
            ProviderValidationStatus::Unverified
        );
        assert!(primary.authorization.allow_task_content);
        assert!(!primary.authorization.allow_auto_failover);
        assert_eq!(
            primary.authorization.source,
            ProviderAuthorizationSource::LegacyCurrent
        );
        assert_eq!(
            primary.credential_ref.as_ref().map(|value| value.kind),
            Some(SecretRefKind::LegacyInline)
        );
        assert_eq!(
            primary
                .credential_ref
                .as_ref()
                .map(|value| value.masked.as_str()),
            Some("****cret")
        );

        let fallback = config
            .provider_state
            .get("fallback")
            .expect("fallback state");
        assert!(!fallback.authorization.allow_task_content);
        assert!(!fallback.authorization.allow_auto_failover);
        assert_eq!(
            fallback.authorization.source,
            ProviderAuthorizationSource::None
        );
    }

    #[test]
    fn switching_current_provider_does_not_expand_legacy_authorization() {
        let mut config = legacy_config();
        config.migrate_provider_compatibility();
        config.model = "fallback/model-b".to_string();

        config.retain_legacy_authorization_for_current();

        assert!(!config.provider_is_authorized("primary", "model-a"));
        assert!(!config.provider_is_authorized("fallback", "model-b"));
    }

    #[test]
    fn new_config_defaults_disable_failover_and_authorization() {
        let config = SaCodeConfig::default();
        assert_eq!(
            config.provider_schema_version,
            PROVIDER_CONFIG_SCHEMA_VERSION
        );
        assert_eq!(config.provider_policy.validation_timeout_ms, 10_000);
        assert!(!config.provider_policy.auto_failover);
        assert!(config.provider_state.is_empty());
    }

    #[test]
    fn provider_profile_never_exposes_inline_secret() {
        let mut config = legacy_config();
        config.migrate_provider_compatibility();

        let profile = config
            .provider_profile("primary")
            .expect("provider profile");
        assert_eq!(profile.provider_id, "primary");
        assert_eq!(profile.display_name, "Primary");
        assert_eq!(profile.selected_model.as_deref(), Some("model-a"));
        let serialized = serde_json::to_string(&profile).expect("serialize profile");
        assert!(!serialized.contains("sk-primary-secret"));
        assert!(serialized.contains("****cret"));
    }

    #[test]
    fn explicit_authorization_can_be_scoped_to_models() {
        let authorization = ProviderAuthorization {
            allow_task_content: true,
            allow_auto_failover: true,
            source: ProviderAuthorizationSource::Explicit,
            models: vec!["allowed".to_string()],
            updated_at: Some("2026-09-19T00:00:00Z".to_string()),
        };

        assert!(authorization.permits_model("allowed"));
        assert!(!authorization.permits_model("other"));
    }
}
