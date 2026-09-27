use std::{
    path::Path,
    sync::{Arc, Mutex, OnceLock},
};

use axum::{
    extract::{Path as RoutePath, State},
    http::StatusCode,
    Json,
};
use sacode_kernel::model::{
    ModelRule, ProviderAuthorizationSource, ProviderProfileType, ProviderRuntimeState,
    ProviderSpec, SaCodeConfig,
};
use serde::Deserialize;
use serde_json::{json, Value};
use url::Url;

use super::DaemonState;
use crate::identity::{self, SecretStore};

type Reply = (StatusCode, Json<Value>);

fn config_lock() -> &'static Mutex<()> {
    static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
    LOCK.get_or_init(|| Mutex::new(()))
}

fn error(status: StatusCode, message: &str) -> Reply {
    (status, Json(json!({ "error": message })))
}

fn project_config_path(state: &DaemonState) -> Option<std::path::PathBuf> {
    state
        .workdir
        .as_ref()
        .map(|dir| dir.join(".sacode/config.json"))
}

fn load(path: &Path) -> anyhow::Result<Value> {
    let parent = path
        .parent()
        .ok_or_else(|| anyhow::anyhow!("missing config directory"))?;
    if parent.is_symlink() || path.is_symlink() {
        anyhow::bail!("project configuration symlink is not writable through the daemon");
    }
    if path.exists() {
        Ok(serde_json::from_slice(&std::fs::read(path)?)?)
    } else {
        Ok(json!({}))
    }
}

fn write(path: &Path, value: &Value) -> anyhow::Result<()> {
    let parent = path
        .parent()
        .ok_or_else(|| anyhow::anyhow!("missing config directory"))?;
    std::fs::create_dir_all(parent)?;
    let tmp = parent.join(format!(".config-{:032x}.tmp", rand::random::<u128>()));
    let bytes = serde_json::to_vec_pretty(value)?;
    {
        use std::io::Write;
        let mut file = std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&tmp)?;
        file.write_all(&bytes)?;
        file.sync_all()?;
    }
    if path.exists() {
        let backup = parent.join(format!(".config-{:032x}.bak", rand::random::<u128>()));
        if let Err(err) = std::fs::rename(path, &backup) {
            let _ = std::fs::remove_file(&tmp);
            return Err(err.into());
        }
        if let Err(err) = std::fs::rename(&tmp, path) {
            let restore = std::fs::rename(&backup, path);
            let _ = std::fs::remove_file(&tmp);
            restore?;
            return Err(err.into());
        }
        // A failed cleanup leaves a recoverable backup, never a truncated config.
        let _ = std::fs::remove_file(&backup);
    } else {
        std::fs::rename(&tmp, path)?;
    }
    Ok(())
}

fn insert_provider_config(value: &mut Value, name: &str, config: &SaCodeConfig, first_model: &str) {
    let object = value.as_object_mut().expect("project config object");
    object.entry("provider").or_insert_with(|| json!({}))[name] = json!(config.provider[name]);
    object.entry("provider_state").or_insert_with(|| json!({}))[name] =
        json!(config.provider_state[name]);
    if config.model.trim().is_empty() {
        object.insert("model".into(), json!(format!("{name}/{first_model}")));
    }
}

fn remove_provider_config(value: &mut Value, name: &str, selected_model: &str) {
    let object = value.as_object_mut().expect("project config object");
    if let Some(providers) = object.get_mut("provider").and_then(Value::as_object_mut) {
        providers.remove(name);
    }
    if let Some(states) = object
        .get_mut("provider_state")
        .and_then(Value::as_object_mut)
    {
        states.remove(name);
    }
    if selected_model.starts_with(&format!("{name}/")) {
        object.insert("model".into(), json!(""));
    }
}

fn valid_url(input: &str) -> bool {
    Url::parse(input).ok().is_some_and(|url| {
        matches!(url.scheme(), "http" | "https")
            && url.host_str().is_some()
            && url.username().is_empty()
            && url.password().is_none()
            && url.fragment().is_none()
            && url.query().is_none()
    })
}

#[derive(Deserialize)]
pub struct CreateProvider {
    name: String,
    base_url: String,
    api_key: String,
    models: Vec<String>,
    #[serde(default)]
    thinking: bool,
    #[serde(default)]
    reasoning_effort: Option<String>,
}

pub async fn list(State(state): State<Arc<DaemonState>>) -> Reply {
    let Some(path) = project_config_path(&state) else {
        return error(StatusCode::BAD_REQUEST, "未选择项目");
    };
    let _guard = config_lock().lock().unwrap();
    let config =
        match load(&path).and_then(|value| Ok(serde_json::from_value::<SaCodeConfig>(value)?)) {
            Ok(config) => config,
            Err(_) => return error(StatusCode::INTERNAL_SERVER_ERROR, "项目配置不可读取"),
        };
    let items = config
        .provider
        .iter()
        .filter_map(|(name, provider)| {
            let state = config.provider_state.get(name)?;
            (state.profile_type == ProviderProfileType::Custom).then(|| {
                json!({
                    "name": name, "base_url": provider.base_url,
                    "models": provider.models.keys().collect::<Vec<_>>(),
                    "has_credential": state.credential_ref.is_some(),
                })
            })
        })
        .collect::<Vec<_>>();
    (StatusCode::OK, Json(json!({ "providers": items })))
}

pub async fn create(
    State(state): State<Arc<DaemonState>>,
    Json(input): Json<CreateProvider>,
) -> Reply {
    let name = input.name.trim();
    let models = input.models.iter().map(|m| m.trim()).collect::<Vec<_>>();
    if name.is_empty()
        || name.len() > 64
        || !name
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
        || !valid_url(&input.base_url)
        || input.api_key.trim().is_empty()
        || models.is_empty()
        || models.iter().any(|m| {
            m.is_empty() || m.len() > 128 || m.contains('/') || m.chars().any(char::is_control)
        })
        || models.len() > 50
    {
        return error(
            StatusCode::BAD_REQUEST,
            "Provider 名称、URL、密钥或模型 ID 无效",
        );
    }
    let Some(path) = project_config_path(&state) else {
        return error(StatusCode::BAD_REQUEST, "未选择项目");
    };
    let _guard = config_lock().lock().unwrap();
    let mut value = match load(&path) {
        Ok(v) if v.is_object() => v,
        _ => return error(StatusCode::INTERNAL_SERVER_ERROR, "项目配置不可读取"),
    };
    let mut parsed: SaCodeConfig = match serde_json::from_value(value.clone()) {
        Ok(v) => v,
        Err(_) => return error(StatusCode::INTERNAL_SERVER_ERROR, "项目配置格式无效"),
    };
    if !value["provider"].is_null() && !value["provider"].is_object()
        || !value["provider_state"].is_null() && !value["provider_state"].is_object()
    {
        return error(StatusCode::BAD_REQUEST, "项目 Provider 配置格式无效");
    }
    if parsed.provider.contains_key(name)
        || identity::is_identity_provider_name(name)
        || identity::IdentitySession::load(None)
            .ok()
            .flatten()
            .is_some_and(|s| s.provider_name == name)
    {
        return error(StatusCode::CONFLICT, "Provider 名称已存在");
    }
    let locator = format!("os-keyring:sacode/provider-{:032x}", rand::random::<u128>());
    let store = identity::OsKeyringSecretStore::new();
    if store.set(&locator, input.api_key.trim()).is_err() {
        return error(
            StatusCode::INTERNAL_SERVER_ERROR,
            "系统凭据库不可用，未保存密钥或 Provider",
        );
    }
    let mut secret_ref = sacode_kernel::model::SecretRef::os_keyring(&locator);
    secret_ref.masked = sacode_kernel::model::SecretRef::mask_secret(input.api_key.trim());
    let rules = models
        .iter()
        .map(|m| {
            (
                m.to_string(),
                ModelRule {
                    name: m.to_string(),
                    thinking: input.thinking,
                    reasoning_effort: input.reasoning_effort.clone(),
                    ..Default::default()
                },
            )
        })
        .collect();
    parsed.provider.insert(
        name.to_string(),
        ProviderSpec {
            name: name.to_string(),
            base_url: input.base_url.trim().trim_end_matches('/').to_string(),
            api_key: String::new(),
            models: rules,
            auth_header: None,
            auth_scheme: None,
        },
    );
    parsed.provider_state.insert(
        name.to_string(),
        ProviderRuntimeState {
            profile_type: ProviderProfileType::Custom,
            credential_ref: Some(secret_ref),
            authorization: sacode_kernel::model::ProviderAuthorization {
                allow_task_content: true,
                allow_auto_failover: false,
                source: ProviderAuthorizationSource::Explicit,
                models: models.iter().map(|m| m.to_string()).collect(),
                updated_at: None,
            },
            ..Default::default()
        },
    );
    insert_provider_config(&mut value, name, &parsed, &models[0]);
    if write(&path, &value).is_err() {
        let _ = store.delete(&locator);
        return error(StatusCode::INTERNAL_SERVER_ERROR, "保存 Provider 配置失败");
    }
    (
        StatusCode::CREATED,
        Json(json!({ "name": name, "models": models })),
    )
}

pub async fn delete(
    State(state): State<Arc<DaemonState>>,
    RoutePath(name): RoutePath<String>,
) -> Reply {
    let Some(path) = project_config_path(&state) else {
        return error(StatusCode::BAD_REQUEST, "未选择项目");
    };
    let _guard = config_lock().lock().unwrap();
    let mut value = match load(&path) {
        Ok(v) if v.is_object() => v,
        _ => return error(StatusCode::INTERNAL_SERVER_ERROR, "项目配置不可读取"),
    };
    let mut parsed: SaCodeConfig = match serde_json::from_value(value.clone()) {
        Ok(v) => v,
        Err(_) => return error(StatusCode::INTERNAL_SERVER_ERROR, "项目配置格式无效"),
    };
    if identity::is_identity_provider_name(&name)
        || parsed
            .provider_state
            .get(&name)
            .is_none_or(|s| s.profile_type != ProviderProfileType::Custom)
        || !parsed.provider.contains_key(&name)
    {
        return error(StatusCode::NOT_FOUND, "未找到可删除的自定义 Provider");
    }
    let reference = parsed
        .provider_state
        .get(&name)
        .and_then(|s| s.credential_ref.clone());
    parsed.provider.remove(&name);
    parsed.provider_state.remove(&name);
    remove_provider_config(&mut value, &name, &parsed.model);
    if write(&path, &value).is_err() {
        return error(StatusCode::INTERNAL_SERVER_ERROR, "删除 Provider 配置失败");
    }
    if let Some(locator) = reference.and_then(|r| r.locator) {
        if locator.starts_with("os-keyring:sacode/provider-") {
            let _ = identity::OsKeyringSecretStore::new().delete(&locator);
        }
    }
    (StatusCode::OK, Json(json!({ "deleted": name })))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn provider_config_roundtrip_preserves_unrelated_fields() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join(".sacode").join("config.json");
        let mut value = json!({
            "custom_extension": { "keep": true },
            "provider": { "other": { "base_url": "https://example.invalid", "future_field": 17 } },
            "provider_state": { "other": { "future_state": "keep" } }
        });
        let before = value.clone();
        let mut config = SaCodeConfig::default();
        config.provider.insert(
            "mine".into(),
            ProviderSpec {
                name: "mine".into(),
                base_url: "https://example.invalid/v1".into(),
                api_key: String::new(),
                models: [("model-a".into(), ModelRule::default())].into(),
                auth_header: None,
                auth_scheme: None,
            },
        );
        config
            .provider_state
            .insert("mine".into(), ProviderRuntimeState::default());
        insert_provider_config(&mut value, "mine", &config, "model-a");
        write(&path, &value).unwrap();
        let loaded = load(&path).unwrap();
        assert_eq!(loaded["provider"]["mine"]["api_key"], "");
        assert_eq!(loaded["model"], "mine/model-a");
        remove_provider_config(&mut value, "mine", "mine/model-a");
        write(&path, &value).unwrap();
        let restored = load(&path).unwrap();
        assert_eq!(restored["custom_extension"], before["custom_extension"]);
        assert_eq!(restored["provider"]["other"], before["provider"]["other"]);
        assert_eq!(
            restored["provider_state"]["other"],
            before["provider_state"]["other"]
        );
        assert!(restored["provider"].get("mine").is_none());
        assert_eq!(restored["model"], "");
    }

    #[test]
    fn rejects_invalid_provider_urls() {
        assert!(!valid_url("file:///private/config"));
        assert!(!valid_url("https://user:secret@example.invalid/v1"));
        assert!(valid_url("http://127.0.0.1:8080/v1"));
    }
}
