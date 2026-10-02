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
    /// 接口协议：openai_compatible | openai_responses | anthropic
    /// （历史上还有 openai | yapi，向后兼容归一化处理）
    #[serde(default = "default_api_type")]
    api_type: String,
    #[serde(default)]
    thinking: bool,
    #[serde(default)]
    reasoning_effort: Option<String>,
}

fn default_api_type() -> String {
    "openai_compatible".to_string()
}

/// 协议类型白名单（3 种）：
/// - openai_compatible：OpenAI 兼容 /v1/chat/completions
/// - openai_responses：OpenAI 原生 /v1/responses
/// - anthropic：Claude / Anthropic Messages API
pub const VALID_API_TYPES: [&str; 3] = ["openai_compatible", "openai_responses", "anthropic"];

/// 归一化协议类型：历史值 openai→openai_compatible、yapi→openai_compatible、
/// anthropic/claude→anthropic；未知值 → openai_compatible（默认）。
pub fn normalize_api_type(raw: &str) -> String {
    match raw.trim() {
        "anthropic" | "claude" => "anthropic".to_string(),
        "openai_responses" => "openai_responses".to_string(),
        // openai（旧默认）、yapi（已移除的自定义网关）、openai_compatible 及一切
        // 兼容 OpenAI chat/completions 的自定义端点，均归入 openai_compatible。
        _ => "openai_compatible".to_string(),
    }
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
    let api_type = normalize_api_type(&input.api_type);
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
        || !VALID_API_TYPES.contains(&api_type.as_str())
    {
        return error(
            StatusCode::BAD_REQUEST,
            "Provider 名称、URL、密钥、模型 ID 或接口协议无效",
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

/// `POST /providers/local/models` 请求体。
#[derive(Deserialize)]
pub struct FetchProviderModelsRequest {
    /// 接口协议（归一化后决定拉取路径）
    #[serde(default = "default_api_type")]
    api_type: String,
    base_url: String,
    #[serde(default)]
    api_key: String,
}

/// `POST /providers/local/models` — 从远端拉取可用模型列表。
///
/// - openai_compatible / openai_responses：`GET {base_url}/models`（OpenAI 标准）
/// - anthropic：`GET {base_url}/models`（Anthropic Messages API 列表端点）
///
/// api_key 仅经 daemon 转发，不落盘、不回显。
pub async fn fetch_provider_models(
    Json(input): Json<FetchProviderModelsRequest>,
) -> Reply {
    if !valid_url(&input.base_url) {
        return error(StatusCode::BAD_REQUEST, "接口地址无效");
    }
    let api_type = normalize_api_type(&input.api_type);
    let root = input.base_url.trim().trim_end_matches('/');
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .build();
    let client = match client {
        Ok(c) => c,
        Err(e) => return error(StatusCode::INTERNAL_SERVER_ERROR, &format!("HTTP 客户端创建失败: {e}")),
    };
    let request = client
        .get(format!("{root}/models"))
        .header("accept", "application/json");
    let request = if input.api_key.trim().is_empty() {
        request
    } else if api_type == "anthropic" {
        // Anthropic 用 x-api-key + anthropic-version；其余两种用 Bearer。
        request
            .header("x-api-key", input.api_key.trim())
            .header("anthropic-version", "2023-06-01")
    } else {
        request.bearer_auth(input.api_key.trim())
    };
    let response = match request.send().await {
        Ok(r) => r,
        Err(e) => {
            return error(
                StatusCode::BAD_GATEWAY,
                &format!("拉取模型列表失败（网络）: {e}"),
            );
        }
    };
    if !response.status().is_success() {
        return error(
            StatusCode::BAD_GATEWAY,
            &format!("远端返回 {}: 请检查接口地址与密钥", response.status().as_u16()),
        );
    }
    let body: Value = match response.json().await {
        Ok(v) => v,
        Err(e) => {
            return error(
                StatusCode::BAD_GATEWAY,
                &format!("远端响应不是合法 JSON: {e}"),
            );
        }
    };
    // OpenAI 形状：{ data: [{ id }] }；Anthropic 形状：{ data: [{ id }] } 或 { models: [...] }
    let mut ids: Vec<String> = body
        .get("data")
        .and_then(|v| v.as_array())
        .map(|items| {
            items
                .iter()
                .filter_map(|item| item.get("id").and_then(|v| v.as_str()))
                .map(str::to_string)
                .collect()
        })
        .unwrap_or_default();
    if ids.is_empty() {
        if let Some(items) = body.get("models").and_then(|v| v.as_array()) {
            ids = items
                .iter()
                .filter_map(|item| item.get("id").or_else(|| item.get("name")).and_then(|v| v.as_str()))
                .map(str::to_string)
                .collect();
        }
    }
    if ids.is_empty() {
        return error(StatusCode::BAD_GATEWAY, "远端未返回任何模型（data 为空）");
    }
    ids.sort();
    ids.dedup();
    let models = ids
        .into_iter()
        .map(|id| json!({ "id": id }))
        .collect::<Vec<_>>();
    (StatusCode::OK, Json(json!({ "models": models })))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn api_type_normalizes_legacy_values_and_whitelists() {
        // 历史值兼容：openai/yapi → openai_compatible
        assert_eq!(normalize_api_type("openai"), "openai_compatible");
        assert_eq!(normalize_api_type("yapi"), "openai_compatible");
        assert_eq!(normalize_api_type(" openai_compatible "), "openai_compatible");
        // 新值保持
        assert_eq!(normalize_api_type("openai_responses"), "openai_responses");
        assert_eq!(normalize_api_type("anthropic"), "anthropic");
        assert_eq!(normalize_api_type("claude"), "anthropic");
        // 未知值 → 默认
        assert_eq!(normalize_api_type("whatever"), "openai_compatible");
        // 归一化结果必在白名单内
        assert!(VALID_API_TYPES.contains(&normalize_api_type("openai").as_str()));
        assert!(VALID_API_TYPES.contains(&normalize_api_type("yapi").as_str()));
    }

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
