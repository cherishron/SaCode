use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

use super::provider::{MIMO_TOKEN_PLAN_BASE_URL, OLLAMA_DEFAULT_BASE_URL};

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct SaCodeConfig {
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
    pub model_routing: ModelRoutingConfig,
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
