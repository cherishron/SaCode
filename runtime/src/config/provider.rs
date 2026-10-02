//! providers.json 单一事实源（P2-1）
//!
//! 历史问题：providers.json 的读取逻辑住在 CLI crate
//! （`interfaces/cli/src/provider_config.rs`），而依赖方向是
//! `interfaces → runtime`，导致 runtime/daemon 无法复用，只能另起一套
//! （写 `<workspace>/.sacode/config.json` 的 provider/provider_state 字段），
//! 形成「读取来源不统一 / 重复配置」。
//!
//! 本模块把 providers.json 的**读取与合并**下沉到 runtime，作为单一事实源：
//! - user 级 `~/.sacode/providers.json`：全局默认（主写入目标）
//! - project 级 `<workdir>/.sacode/provider.json`：工作区只读覆盖（同名覆盖）
//!
//! 兼容性：支持三种历史格式
//! 1. 标准 catalog：`{ current, providers: { name: {...} } }`
//! 2. desktop camelCase：`{ activeProvider, providers: { name: { baseUrl, apiKey, defaultModel } } }`
//! 3. legacy 单 provider：顶层直接是 provider 字段
//!
//! 安全：api_key 永不落 providers.json，只存 secret store（secret_ref）。

use anyhow::Result;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use crate::config::SaCodeConfig;
// 复用 kernel 已有的 normalize_base_url，避免第三份重复实现。
use sacode_kernel::model::normalize_base_url;

pub const USER_PROVIDERS_FILE: &str = "providers.json";
pub const PROJECT_PROVIDERS_FILE: &str = "provider.json";

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq)]
pub struct ProviderConfig {
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
    pub secret_ref: Option<sacode_kernel::model::SecretRef>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ProviderCatalog {
    #[serde(default)]
    pub current: String,
    #[serde(default)]
    pub providers: BTreeMap<String, ProviderConfig>,
}

impl ProviderConfig {
    /// Resolve api_key for runtime use: prefer secret_ref (product line), legacy plaintext last.
    pub fn resolved_api_key(&self) -> String {
        if let Some(r#ref) = self.secret_ref.as_ref() {
            if let Ok(Some(v)) = crate::identity::secret_store::resolve_secret_ref(r#ref, None) {
                if !v.is_empty() {
                    return v;
                }
            }
        }
        self.api_key.clone()
    }

    /// 转成 kernel 的 ModelProvider（供 agent loop 消费）。
    pub fn to_model_provider(&self) -> sacode_kernel::model::ModelProvider {
        let kind = sacode_kernel::model::detect_provider_kind(&self.base_url, &self.model);
        sacode_kernel::model::ModelProvider {
            kind,
            model: self.model.clone(),
            base_url: Some(normalize_base_url(&self.base_url)),
            api_key: Some(self.resolved_api_key()),
            rule: None,
            auth_header: self.auth_header.clone(),
            auth_scheme: self.auth_scheme.clone(),
        }
    }
}

#[derive(Debug, Clone)]
pub struct NamedProviderConfig {
    pub name: String,
    pub config: ProviderConfig,
}

/// providers.json 的读取入口（单一事实源）。
#[derive(Debug, Clone)]
pub struct ProviderCatalogStore {
    user_path: PathBuf,
    project_path: PathBuf,
}

impl ProviderCatalogStore {
    pub fn new(workdir: &Path) -> Self {
        let root = SaCodeConfig::new(workdir);
        // SACODE_HOME 覆盖（测试/CI 隔离用），与 CLI 历史行为一致。
        let user_path = std::env::var_os("SACODE_HOME")
            .map(PathBuf::from)
            .unwrap_or(root.user_dir.clone())
            .join(USER_PROVIDERS_FILE);
        Self {
            user_path,
            project_path: root.project_dir.join(PROJECT_PROVIDERS_FILE),
        }
    }

    pub fn user_path(&self) -> &Path {
        &self.user_path
    }

    /// 从单个文件加载（user 或 project），支持三种历史格式。
    pub fn load_from_file(path: &Path) -> Result<Option<ProviderCatalog>> {
        if !path.exists() {
            return Ok(None);
        }
        let content = std::fs::read_to_string(path)?;
        if content.trim().is_empty() {
            return Ok(None);
        }
        let value: serde_json::Value = serde_json::from_str(&content)?;
        if value.get("providers").is_some() {
            // desktop camelCase 优先判定：含 activeProvider 或 camelCase 字段时
            // 必须先走 camelCase 解析，否则标准解析会把 base_url/model 解析为空。
            if Self::looks_like_desktop_catalog(&value) {
                return Self::parse_desktop_catalog(&value);
            }
            if let Ok(mut catalog) = serde_json::from_value::<ProviderCatalog>(value.clone()) {
                if catalog.current.is_empty() {
                    if let Some(active) = value.get("activeProvider").and_then(|v| v.as_str()) {
                        catalog.current = active.to_string();
                    }
                }
                normalize_catalog(&mut catalog);
                return Ok(Some(catalog));
            }
            return Self::parse_desktop_catalog(&value);
        }
        // legacy single-provider shape
        let mut config: ProviderConfig = serde_json::from_value(value)?;
        config.base_url = normalize_base_url(&config.base_url);
        let mut providers = BTreeMap::new();
        providers.insert("default".to_string(), config);
        Ok(Some(ProviderCatalog {
            current: "default".to_string(),
            providers,
        }))
    }

    /// 是否像 desktop camelCase 格式（activeProvider / baseUrl / apiKey / defaultModel）。
    fn looks_like_desktop_catalog(value: &serde_json::Value) -> bool {
        if value.get("activeProvider").is_some() {
            return true;
        }
        let Some(obj) = value.get("providers").and_then(|v| v.as_object()) else {
            return false;
        };
        obj.values().any(|entry| {
            entry.get("baseUrl").is_some()
                || entry.get("apiKey").is_some()
                || entry.get("defaultModel").is_some()
        })
    }

    /// desktop camelCase → 标准 catalog。
    fn parse_desktop_catalog(value: &serde_json::Value) -> Result<Option<ProviderCatalog>> {
        let providers_val = value.get("providers");
        let Some(providers_obj) = providers_val.and_then(|v| v.as_object()) else {
            return Ok(None);
        };
        let mut providers = BTreeMap::new();
        for (name, entry) in providers_obj {
            let config = ProviderConfig {
                base_url: entry
                    .get("baseUrl")
                    .or_else(|| entry.get("base_url"))
                    .and_then(|v| v.as_str())
                    .map(normalize_base_url)
                    .unwrap_or_default(),
                api_key: entry
                    .get("apiKey")
                    .or_else(|| entry.get("api_key"))
                    .and_then(|v| v.as_str())
                    .unwrap_or_default()
                    .to_string(),
                model: entry
                    .get("defaultModel")
                    .or_else(|| entry.get("model"))
                    .and_then(|v| v.as_str())
                    .unwrap_or_default()
                    .to_string(),
                auth_header: entry
                    .get("auth_header")
                    .and_then(|v| v.as_str())
                    .map(String::from),
                auth_scheme: entry
                    .get("auth_scheme")
                    .and_then(|v| v.as_str())
                    .map(String::from),
                secret_ref: entry
                    .get("secret_ref")
                    .map(|v| serde_json::from_value(v.clone()))
                    .transpose()
                    .ok()
                    .flatten(),
            };
            providers.insert(name.clone(), config);
        }
        let current = value
            .get("activeProvider")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let mut catalog = ProviderCatalog { current, providers };
        normalize_catalog(&mut catalog);
        Ok(Some(catalog))
    }

    /// user + project 合并（project 同名覆盖 user）。
    pub fn load_effective(&self) -> Result<Option<ProviderCatalog>> {
        let user = Self::load_from_file(&self.user_path)?;
        let project = Self::load_from_file(&self.project_path)?;
        match (user, project) {
            (None, None) => Ok(None),
            (Some(u), None) => Ok(Some(u)),
            (None, Some(p)) => Ok(Some(p)),
            (Some(mut u), Some(p)) => {
                for (name, entry) in p.providers {
                    u.providers.insert(name, entry);
                }
                if !p.current.is_empty() {
                    u.current = p.current;
                }
                normalize_catalog(&mut u);
                Ok(Some(u))
            }
        }
    }

    /// 当前生效的 provider（按 current 或首个）。
    pub fn load_current(&self) -> Result<Option<NamedProviderConfig>> {
        let catalog = match self.load_effective()? {
            Some(value) => value,
            None => return Ok(None),
        };
        if catalog.providers.is_empty() {
            return Ok(None);
        }
        let current_name =
            if !catalog.current.is_empty() && catalog.providers.contains_key(&catalog.current) {
                catalog.current.clone()
            } else {
                catalog.providers.keys().next().cloned().unwrap_or_default()
            };
        Ok(catalog
            .providers
            .get(&current_name)
            .cloned()
            .map(|config| NamedProviderConfig {
                name: current_name,
                config,
            }))
    }
}

/// 归一化 catalog：base_url 归一 + current 指向存在的 key。
/// （normalize_base_url 复用 kernel 实现，见文件顶部 import）
pub(crate) fn normalize_catalog(catalog: &mut ProviderCatalog) {
    for config in catalog.providers.values_mut() {
        config.base_url = normalize_base_url(&config.base_url);
    }
    if !catalog.current.is_empty() && !catalog.providers.contains_key(&catalog.current) {
        catalog.current = catalog.providers.keys().next().cloned().unwrap_or_default();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn loads_standard_catalog() {
        let json = r#"{"current":"sa-ai","providers":{"sa-ai":{"base_url":"http://127.0.0.1:8090/v1/","model":"m1"}}}"#;
        let dir = std::env::temp_dir().join("sacode-test-provider-std");
        let _ = std::fs::create_dir_all(&dir);
        let path = dir.join("providers.json");
        std::fs::write(&path, json).unwrap();
        let catalog = ProviderCatalogStore::load_from_file(&path).unwrap().unwrap();
        assert_eq!(catalog.current, "sa-ai");
        // trailing slash normalized
        assert_eq!(catalog.providers["sa-ai"].base_url, "http://127.0.0.1:8090/v1");
    }

    #[test]
    fn loads_desktop_camelcase_format() {
        let json = r#"{"activeProvider":"p1","providers":{"p1":{"baseUrl":"https://x.ai/v1","apiKey":"k","defaultModel":"mm"}}}"#;
        let dir = std::env::temp_dir().join("sacode-test-provider-desktop");
        let _ = std::fs::create_dir_all(&dir);
        let path = dir.join("providers.json");
        std::fs::write(&path, json).unwrap();
        let catalog = ProviderCatalogStore::load_from_file(&path).unwrap().unwrap();
        assert_eq!(catalog.current, "p1");
        assert_eq!(catalog.providers["p1"].base_url, "https://x.ai/v1");
        assert_eq!(catalog.providers["p1"].model, "mm");
    }

    #[test]
    fn loads_legacy_single_provider() {
        let json = r#"{"base_url":"https://legacy.ai/v1","model":"lm"}"#;
        let dir = std::env::temp_dir().join("sacode-test-provider-legacy");
        let _ = std::fs::create_dir_all(&dir);
        let path = dir.join("providers.json");
        std::fs::write(&path, json).unwrap();
        let catalog = ProviderCatalogStore::load_from_file(&path).unwrap().unwrap();
        assert_eq!(catalog.current, "default");
        assert!(catalog.providers.contains_key("default"));
    }

    #[test]
    fn normalize_catalog_fixes_dangling_current() {
        let mut catalog = ProviderCatalog {
            current: "gone".to_string(),
            providers: BTreeMap::new(),
        };
        catalog.providers.insert(
            "real".to_string(),
            ProviderConfig {
                base_url: "http://a.b/".to_string(),
                ..Default::default()
            },
        );
        normalize_catalog(&mut catalog);
        // current 指向不存在的 key → 回退到首个
        assert_eq!(catalog.current, "real");
        // base_url 结尾斜杠归一
        assert_eq!(catalog.providers["real"].base_url, "http://a.b");
    }
}
