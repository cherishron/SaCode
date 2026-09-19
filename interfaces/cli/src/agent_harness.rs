use anyhow::Result;
use sacode_kernel::model::{
    ProviderAuthorization, ProviderAuthorizationSource, ProviderFailure, ProviderFailureCategory,
    ProviderProfileType, ProviderRuntimeState, ProviderValidationSnapshot,
    ProviderValidationStatus, SecretRef,
};
use sacode_runtime::provider::ProviderAvailabilityService;

use crate::provider_config::{
    fallback_models, NamedProviderConfig, ProviderConfig, ProviderConfigStore, SaCodeConfigStore,
};

#[derive(Debug, Clone)]
pub struct ModelOption {
    pub provider_name: String,
    pub model_name: String,
}

#[derive(Debug, Clone)]
pub struct ConnectResult {
    pub current_provider: NamedProviderConfig,
    pub validation: ProviderValidationSnapshot,
}

pub fn connect_provider(
    provider_store: &ProviderConfigStore,
    sacode_store: &SaCodeConfigStore,
    name: &str,
    base_url: &str,
    api_key: String,
) -> Result<ConnectResult> {
    let mut config = ProviderConfig {
        base_url: base_url.to_string(),
        api_key,
        model: fallback_models(name)
            .into_iter()
            .next()
            .unwrap_or_else(|| name.to_string()),
    };
    let availability = ProviderAvailabilityService::default();
    let mut model_provider = config.to_model_provider();
    let discovered_models = availability
        .discover_models_blocking(&model_provider)
        .unwrap_or_default();
    if let Some(model) = discovered_models.first() {
        config.model = model.clone();
        model_provider = config.to_model_provider();
    }
    let validation = availability.validate_blocking(&model_provider);
    let final_models = if validation.available_models.is_empty() {
        vec![config.model.clone()]
    } else {
        validation.available_models.clone()
    };
    let mut spec = sacode_kernel::model::ProviderSpec {
        name: name.to_string(),
        base_url: base_url.to_string(),
        api_key: if validation.status == ProviderValidationStatus::Available {
            config.api_key.clone()
        } else {
            String::new()
        },
        models: std::collections::BTreeMap::new(),
    };
    spec.name = name.to_string();
    spec.base_url = base_url.to_string();
    for model in &final_models {
        spec.models
            .entry(model.clone())
            .or_insert_with(|| sacode_kernel::model::ModelRule {
                name: model.clone(),
                ..Default::default()
            });
    }
    let mut sacode_config = sacode_store.load_or_default()?;
    sacode_config.provider.insert(name.to_string(), spec);
    sacode_config.provider_state.insert(
        name.to_string(),
        ProviderRuntimeState {
            profile_type: if crate::provider_config::preset_connect_options()
                .iter()
                .any(|(provider_name, _, _)| provider_name == name)
                || name == "ollama"
            {
                ProviderProfileType::Preset
            } else {
                ProviderProfileType::Custom
            },
            credential_ref: SecretRef::legacy_inline(&config.api_key),
            validation: validation.clone(),
            authorization: if validation.status == ProviderValidationStatus::Available {
                ProviderAuthorization {
                    allow_task_content: true,
                    allow_auto_failover: false,
                    source: ProviderAuthorizationSource::Explicit,
                    models: vec![config.model.clone()],
                    updated_at: validation.checked_at.clone(),
                }
            } else {
                ProviderAuthorization::default()
            },
        },
    );
    if validation.status == ProviderValidationStatus::Available {
        sacode_config.model = format!("{}/{}", name, config.model);
    }
    sacode_store.save(&sacode_config)?;

    if validation.status != ProviderValidationStatus::Available {
        let failure = validation
            .failure
            .as_ref()
            .expect("unavailable has failure");
        anyhow::bail!(provider_failure_message(failure));
    }
    provider_store.save_named(name, &config, true)?;

    Ok(ConnectResult {
        current_provider: NamedProviderConfig {
            name: name.to_string(),
            config,
        },
        validation,
    })
}

pub fn provider_failure_message(failure: &ProviderFailure) -> String {
    let (category, recovery) = match failure.category {
        ProviderFailureCategory::Authentication => {
            ("认证失败", "请重新输入 API Key 并检查账号或模型权限。")
        }
        ProviderFailureCategory::QuotaOrRateLimit => {
            ("额度或限流", "请检查额度，或等待限流窗口结束后重试。")
        }
        ProviderFailureCategory::ModelUnavailable => {
            ("模型不可用", "请选择当前凭据有权访问的模型后重试。")
        }
        ProviderFailureCategory::Network => {
            ("网络异常", "请检查网络、代理、DNS、TLS 和服务地址后重试。")
        }
        ProviderFailureCategory::Service => {
            ("服务异常", "请稍后重试，并确认服务地址兼容 OpenAI 接口。")
        }
    };
    let retry = failure
        .retry_after_secs
        .map(|seconds| format!(" 建议等待 {seconds} 秒。"))
        .unwrap_or_default();
    format!(
        "Provider 验证失败（{category}，{}）：{} {recovery}{retry}",
        failure.code, failure.safe_message
    )
}

pub fn collect_model_options(
    provider_store: &ProviderConfigStore,
    sacode_store: &SaCodeConfigStore,
) -> Result<Vec<ModelOption>> {
    let Some(catalog) = provider_store.load_catalog()? else {
        return Ok(Vec::new());
    };
    let authorization_config = sacode_store.load_effective()?;

    let mut options = Vec::new();
    for (provider_name, config) in catalog.providers {
        let models = ProviderAvailabilityService::default()
            .discover_models_blocking(&config.to_model_provider())
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
            let Some(state) = authorization_config.provider_state.get(&provider_name) else {
                continue;
            };
            if state.validation.status != ProviderValidationStatus::Available
                || !state.authorization.permits_model(&model_name)
            {
                continue;
            }
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
    let authorization_config = sacode_store.load_effective()?;
    let state = authorization_config
        .provider_state
        .get(provider_name)
        .ok_or_else(|| anyhow::anyhow!("provider is not verified: {}", provider_name))?;
    if state.validation.status != ProviderValidationStatus::Available
        || !state.authorization.permits_model(model_name)
    {
        anyhow::bail!("model is not authorized: {}/{}", provider_name, model_name);
    }
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
#[cfg(test)]
mod tests {
    use super::*;
    use sacode_kernel::model::{ProviderFailureCategory, ProviderRecoveryAction};
    use serial_test::serial;
    use std::{
        fs,
        io::{Read, Write},
        net::TcpListener,
        path::PathBuf,
        time::{SystemTime, UNIX_EPOCH},
    };

    fn unique_workdir(tag: &str) -> PathBuf {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time before unix epoch")
            .as_nanos();
        let path = std::env::temp_dir().join(format!("sacode-harness-{tag}-{unique}"));
        fs::create_dir_all(&path).expect("create temp workdir");
        path
    }

    fn isolate_user_config_dir(tag: &str) -> PathBuf {
        let sandbox = unique_workdir(tag);
        std::env::set_var("USERPROFILE", &sandbox);
        std::env::set_var("HOME", &sandbox);
        sandbox
    }

    #[test]
    fn provider_failure_message_covers_five_categories() {
        let cases = [
            (ProviderFailureCategory::Authentication, "认证失败"),
            (ProviderFailureCategory::QuotaOrRateLimit, "额度或限流"),
            (ProviderFailureCategory::ModelUnavailable, "模型不可用"),
            (ProviderFailureCategory::Network, "网络异常"),
            (ProviderFailureCategory::Service, "服务异常"),
        ];
        for (category, keyword) in cases {
            let failure = ProviderFailure {
                category,
                code: "provider/test".to_string(),
                retryable: false,
                action: ProviderRecoveryAction::RetryLater,
                safe_message: "safe message".to_string(),
                retry_after_secs: None,
            };
            let message = provider_failure_message(&failure);
            assert!(message.contains(keyword), "{category:?}: {message}");
            assert!(message.contains("provider/test"));
            assert!(message.contains("safe message"));
        }
    }

    fn spawn_mock_provider(
        models_status: u16,
        chat_status: u16,
        chat_body: &'static str,
    ) -> String {
        let listener = TcpListener::bind("127.0.0.1:0").expect("bind mock provider");
        let address = listener.local_addr().expect("mock provider address");
        std::thread::spawn(move || {
            for stream in listener.incoming().take(4) {
                let Ok(mut stream) = stream else { break };
                let mut data = Vec::new();
                let mut buffer = [0u8; 2048];
                loop {
                    let read = stream.read(&mut buffer).unwrap_or(0);
                    if read == 0 {
                        break;
                    }
                    data.extend_from_slice(&buffer[..read]);
                    if String::from_utf8_lossy(&data).contains("\r\n\r\n") {
                        break;
                    }
                }
                let request = String::from_utf8_lossy(&data);
                let (status, body) = if request.starts_with("GET ") {
                    (models_status, "{}".to_string())
                } else {
                    (chat_status, chat_body.to_string())
                };
                let reason = if status == 200 { "OK" } else { "Unauthorized" };
                let response = format!(
                    "HTTP/1.1 {status} {reason}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                    body.len()
                );
                let _ = stream.write_all(response.as_bytes());
                let _ = stream.flush();
            }
        });
        format!("http://{address}/v1")
    }

    const CHAT_OK_BODY: &str = r#"{"id":"test","model":"mock","choices":[{"index":0,"message":{"role":"assistant","content":"OK"},"finish_reason":"stop"}],"usage":null}"#;

    #[test]
    #[serial]
    fn connect_failure_persists_unverified_state_without_credential() {
        let _user_sandbox = isolate_user_config_dir("fail");
        let workdir = unique_workdir("fail-workdir");
        let base_url = spawn_mock_provider(401, 401, "{}");
        let secret = "sk-mock-never-leak-987654";

        let provider_store = ProviderConfigStore::new(&workdir);
        let sacode_store = SaCodeConfigStore::new(&workdir);
        let result = connect_provider(
            &provider_store,
            &sacode_store,
            "mockfail",
            &base_url,
            secret.to_string(),
        );

        let error = result.expect_err("401 must fail validation");
        assert!(error.to_string().contains("认证失败"), "{error}");
        assert!(
            !error.to_string().contains(secret),
            "error message must not leak key"
        );

        let written = fs::read_to_string(workdir.join(".sacode/config.json")).expect("read config");
        assert!(
            !written.contains(secret),
            "config.json must not contain full key"
        );
        let config: serde_json::Value = serde_json::from_str(&written).expect("parse config");
        let state = &config["provider_state"]["mockfail"];
        assert_eq!(state["validation"]["status"], "unavailable");
        assert_eq!(state["authorization"]["allow_task_content"], false);
        assert_eq!(config["model"], "");

        let _ = fs::remove_dir_all(&workdir);
    }

    #[test]
    #[serial]
    fn connect_success_authorizes_only_validated_model() {
        let _user_sandbox = isolate_user_config_dir("ok");
        let workdir = unique_workdir("ok-workdir");
        let base_url = spawn_mock_provider(401, 200, CHAT_OK_BODY);
        let secret = "sk-mock-ok-123456";

        let provider_store = ProviderConfigStore::new(&workdir);
        let sacode_store = SaCodeConfigStore::new(&workdir);
        let result = connect_provider(
            &provider_store,
            &sacode_store,
            "mockok",
            &base_url,
            secret.to_string(),
        )
        .expect("validation must succeed");

        assert_eq!(
            result.validation.status,
            ProviderValidationStatus::Available
        );
        assert_eq!(result.current_provider.config.model, "mockok");

        let written = fs::read_to_string(workdir.join(".sacode/config.json")).expect("read config");
        let config: serde_json::Value = serde_json::from_str(&written).expect("parse config");
        let state = &config["provider_state"]["mockok"];
        assert_eq!(state["validation"]["status"], "available");
        assert_eq!(state["authorization"]["source"], "explicit");
        assert_eq!(state["authorization"]["allow_task_content"], true);
        assert_eq!(state["authorization"]["allow_auto_failover"], false);
        assert_eq!(state["authorization"]["models"][0], "mockok");
        assert_eq!(config["model"], "mockok/mockok");

        let switched = switch_model(&provider_store, &sacode_store, "mockok", "mockok");
        assert!(switched.is_ok(), "authorized model must be switchable");
        let denied = switch_model(&provider_store, &sacode_store, "mockok", "not-authorized");
        assert!(denied.is_err(), "unauthorized model must be rejected");

        let _ = fs::remove_dir_all(&workdir);
    }
}
