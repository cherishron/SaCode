use std::{
    collections::BTreeMap,
    fs,
    path::{Path, PathBuf},
};

use anyhow::{Context, Result};
use reqwest::blocking::Client;
use sacode_kernel::model::{
    detect_provider_kind, normalize_base_url, preset_providers, ModelProvider,
    ProviderSpec, SaCodeConfig,
};
use serde::{Deserialize, Serialize};

const PROVIDER_CONFIG_FILE: &str = ".sacode/provider.json";
const SACODE_CONFIG_FILE: &str = ".sacode/config.json";

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ProviderConfig {
    pub base_url: String,
    pub api_key: String,
    #[serde(default)]
    pub model: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ProviderCatalog {
    #[serde(default)]
    pub current: String,
    #[serde(default)]
    pub providers: BTreeMap<String, ProviderConfig>,
}

#[derive(Debug, Clone)]
pub struct NamedProviderConfig {
    pub name: String,
    pub config: ProviderConfig,
}

#[derive(Debug, Clone)]
pub struct ProviderConfigStore {
    path: PathBuf,
}

#[derive(Debug, Clone)]
pub struct SaCodeConfigStore {
    user_path: PathBuf,
    project_path: PathBuf,
}

#[derive(Debug, Deserialize)]
struct ModelsResponse {
    data: Vec<ModelItem>,
}

#[derive(Debug, Deserialize)]
struct ModelItem {
    id: String,
}

impl ProviderConfigStore {
    pub fn new(workdir: &Path) -> Self {
        Self {
            path: workdir.join(PROVIDER_CONFIG_FILE),
        }
    }

    pub fn load(&self) -> Result<Option<ProviderConfig>> {
        Ok(self.load_current()?.map(|named| named.config))
    }

    pub fn load_current(&self) -> Result<Option<NamedProviderConfig>> {
        let catalog = match self.load_catalog()? {
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

    pub fn load_catalog(&self) -> Result<Option<ProviderCatalog>> {
        if !self.path.exists() {
            return Ok(None);
        }

        let content = fs::read_to_string(&self.path)?;
        // 空文件或纯空白文件视为未配置，避免 serde 解析失败
        if content.trim().is_empty() {
            return Ok(None);
        }
        let value: serde_json::Value = serde_json::from_str(&content)?;

        if value.get("providers").is_some() {
            let mut catalog: ProviderCatalog = serde_json::from_value(value)?;
            normalize_catalog(&mut catalog);
            return Ok(Some(catalog));
        }

        let mut config: ProviderConfig = serde_json::from_value(value)?;
        config.base_url = normalize_base_url(&config.base_url);
        let mut providers = BTreeMap::new();
        providers.insert("default".to_string(), config);
        Ok(Some(ProviderCatalog {
            current: "default".to_string(),
            providers,
        }))
    }

    pub fn save(&self, config: &ProviderConfig) -> Result<()> {
        self.save_named("default", config, true)
    }

    pub fn save_named(&self, name: &str, config: &ProviderConfig, set_current: bool) -> Result<()> {
        if let Some(parent) = self.path.parent() {
            fs::create_dir_all(parent)?;
        }

        let normalized = ProviderConfig {
            base_url: normalize_base_url(&config.base_url),
            api_key: config.api_key.clone(),
            model: config.model.clone(),
        };

        let mut catalog = self.load_catalog()?.unwrap_or_default();
        catalog
            .providers
            .insert(name.trim().to_string(), normalized);
        if set_current || catalog.current.is_empty() {
            catalog.current = name.trim().to_string();
        }
        normalize_catalog(&mut catalog);

        fs::write(&self.path, serde_json::to_string_pretty(&catalog)?)?;
        Ok(())
    }

    pub fn set_current(&self, name: &str) -> Result<()> {
        let mut catalog = self.load_catalog()?.unwrap_or_default();
        if !catalog.providers.contains_key(name) {
            anyhow::bail!("provider not found: {}", name);
        }
        catalog.current = name.to_string();
        normalize_catalog(&mut catalog);
        fs::write(&self.path, serde_json::to_string_pretty(&catalog)?)?;
        Ok(())
    }

    pub fn get(&self, name: &str) -> Result<Option<ProviderConfig>> {
        Ok(self
            .load_catalog()?
            .and_then(|catalog| catalog.providers.get(name).cloned()))
    }

    pub fn rename(&self, from: &str, to: &str) -> Result<()> {
        let from = from.trim();
        let to = to.trim();
        if from.is_empty() || to.is_empty() {
            anyhow::bail!("provider name cannot be empty");
        }

        let mut catalog = self.load_catalog()?.unwrap_or_default();
        let Some(config) = catalog.providers.remove(from) else {
            anyhow::bail!("provider not found: {}", from);
        };
        if catalog.providers.contains_key(to) {
            anyhow::bail!("provider already exists: {}", to);
        }
        catalog.providers.insert(to.to_string(), config);
        if catalog.current == from {
            catalog.current = to.to_string();
        }
        normalize_catalog(&mut catalog);
        if let Some(parent) = self.path.parent() {
            fs::create_dir_all(parent)?;
        }
        fs::write(&self.path, serde_json::to_string_pretty(&catalog)?)?;
        Ok(())
    }

    pub fn remove(&self, name: &str) -> Result<()> {
        let name = name.trim();
        let mut catalog = self.load_catalog()?.unwrap_or_default();
        if catalog.current == name {
            anyhow::bail!("cannot remove current provider: {}", name);
        }
        if catalog.providers.remove(name).is_none() {
            anyhow::bail!("provider not found: {}", name);
        }
        normalize_catalog(&mut catalog);
        if let Some(parent) = self.path.parent() {
            fs::create_dir_all(parent)?;
        }
        fs::write(&self.path, serde_json::to_string_pretty(&catalog)?)?;
        Ok(())
    }

    pub fn list_names(&self) -> Result<Vec<String>> {
        let mut names: Vec<String> = self
            .load_catalog()?
            .map(|catalog| catalog.providers.keys().cloned().collect())
            .unwrap_or_default();
        names.sort();
        Ok(names)
    }
}

impl SaCodeConfigStore {
    pub fn new(workdir: &Path) -> Self {
        // Windows 上 HOME 通常不存在，USERPROFILE 才是用户主目录；
        // Unix 上 HOME 是标准。二者均无时退化为当前目录。
        let user_path = std::env::var_os("USERPROFILE")
            .or_else(|| std::env::var_os("HOME"))
            .map(PathBuf::from)
            .unwrap_or_else(|| PathBuf::from("."))
            .join(SACODE_CONFIG_FILE);
        Self {
            user_path,
            project_path: workdir.join(SACODE_CONFIG_FILE),
        }
    }

    pub fn load(&self) -> Result<Option<SaCodeConfig>> {
        self.load_from_path(&self.project_path)
    }

    pub fn load_user(&self) -> Result<Option<SaCodeConfig>> {
        self.load_from_path(&self.user_path)
    }

    pub fn load_effective(&self) -> Result<SaCodeConfig> {
        let mut config = self.load_user()?.unwrap_or_else(default_sacode_config);
        if let Some(project) = self.load()? {
            if !project.model.trim().is_empty() {
                config.model = project.model;
            }
            if !project.small_model.trim().is_empty() {
                config.small_model = project.small_model;
            }
            if !project.outstyle.trim().is_empty() {
                config.outstyle = project.outstyle;
            }
            if project.vim_mode {
                config.vim_mode = true;
            }
            config.provider.extend(project.provider);
            if !project.model_routing.overrides.is_empty() {
                config.model_routing = project.model_routing;
            }
        }
        self.normalize(&mut config);
        Ok(config)
    }

    pub fn load_or_default(&self) -> Result<SaCodeConfig> {
        Ok(self.load()?.unwrap_or_else(default_sacode_config))
    }

    pub fn save(&self, config: &SaCodeConfig) -> Result<()> {
        self.save_to_path(&self.project_path, config)
    }

    pub fn save_user(&self, config: &SaCodeConfig) -> Result<()> {
        self.save_to_path(&self.user_path, config)
    }

    pub fn user_path(&self) -> &Path {
        &self.user_path
    }

    pub fn project_path(&self) -> &Path {
        &self.project_path
    }

    pub fn upsert_provider(&self, name: &str, spec: ProviderSpec) -> Result<SaCodeConfig> {
        let mut config = self.load_or_default()?;
        config.provider.insert(name.trim().to_string(), spec);
        self.save(&config)?;
        Ok(config)
    }

    pub fn set_model(&self, provider_name: &str, model_name: &str) -> Result<SaCodeConfig> {
        let mut config = self.load_or_default()?;
        config.model = format!("{}/{}", provider_name, model_name);
        self.save(&config)?;
        Ok(config)
    }

    pub fn provider(&self, name: &str) -> Result<Option<ProviderSpec>> {
        Ok(self.load_or_default()?.provider.get(name).cloned())
    }

    pub fn list_names(&self) -> Result<Vec<String>> {
        let mut names: Vec<String> = self.load_or_default()?.provider.keys().cloned().collect();
        names.sort();
        Ok(names)
    }

    pub fn current_provider_name(&self) -> Result<Option<String>> {
        let config = self.load_or_default()?;
        Ok(config
            .resolve_model(&config.model)
            .map(|(provider_name, _)| provider_name))
    }

    pub fn rename_provider(&self, from: &str, to: &str) -> Result<SaCodeConfig> {
        let from = from.trim();
        let to = to.trim();
        if from.is_empty() || to.is_empty() {
            anyhow::bail!("provider name cannot be empty");
        }

        let mut config = self.load_or_default()?;
        let Some(mut spec) = config.provider.remove(from) else {
            anyhow::bail!("provider not found: {}", from);
        };
        if config.provider.contains_key(to) {
            anyhow::bail!("provider already exists: {}", to);
        }
        spec.name = to.to_string();
        config.provider.insert(to.to_string(), spec);

        if let Some((current_provider, current_model)) = config.resolve_model(&config.model) {
            if current_provider == from {
                config.model = format!("{}/{}", to, current_model);
            }
        }
        if let Some((current_provider, current_model)) = config.resolve_model(&config.small_model) {
            if current_provider == from {
                config.small_model = format!("{}/{}", to, current_model);
            }
        }

        self.save(&config)?;
        Ok(config)
    }

    pub fn remove_provider(&self, name: &str) -> Result<SaCodeConfig> {
        let name = name.trim();
        let mut config = self.load_or_default()?;
        if let Some((current_provider, _)) = config.resolve_model(&config.model) {
            if current_provider == name {
                anyhow::bail!("cannot remove current provider: {}", name);
            }
        }
        if config.provider.remove(name).is_none() {
            anyhow::bail!("provider not found: {}", name);
        }
        self.save(&config)?;
        Ok(config)
    }

    fn normalize(&self, config: &mut SaCodeConfig) {
        for (name, provider) in &mut config.provider {
            if provider.name.trim().is_empty() {
                provider.name = name.clone();
            }
            provider.base_url = normalize_base_url(&provider.base_url);
            let mut normalized_models = BTreeMap::new();
            for (model_name, mut rule) in provider.models.clone() {
                if model_name.trim().is_empty() {
                    continue;
                }
                if rule.name.trim().is_empty() {
                    rule.name = model_name.clone();
                }
                normalized_models.insert(model_name, rule);
            }
            provider.models = normalized_models;
        }
    }

    fn load_from_path(&self, path: &Path) -> Result<Option<SaCodeConfig>> {
        if !path.exists() {
            return Ok(None);
        }

        let content = fs::read_to_string(path)?;
        // 空文件或纯空白文件视为未配置，避免 serde 解析失败
        if content.trim().is_empty() {
            return Ok(None);
        }
        let mut config: SaCodeConfig = serde_json::from_str(&content)?;
        self.normalize(&mut config);
        Ok(Some(config))
    }

    fn save_to_path(&self, path: &Path, config: &SaCodeConfig) -> Result<()> {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)?;
        }
        let mut normalized = config.clone();
        self.normalize(&mut normalized);
        fs::write(path, serde_json::to_string_pretty(&normalized)?)?;
        Ok(())
    }
}

fn default_sacode_config() -> SaCodeConfig {
    SaCodeConfig {
        model: String::new(),
        small_model: String::new(),
        outstyle: String::new(),
        vim_mode: false,
        provider: preset_providers(),
        model_routing: Default::default(),
    }
}

impl ProviderConfig {
    pub fn to_model_provider(&self) -> ModelProvider {
        let kind = detect_provider_kind(&self.base_url, &self.model);
        ModelProvider {
            kind,
            model: self.model.clone(),
            base_url: Some(normalize_base_url(&self.base_url)),
            api_key: Some(self.api_key.clone()),
            rule: None,
        }
    }
}


/// 从 kernel 预设生成 TUI /connect 选择列表：(name, base_url, needs_api_key)
/// 统一收敛预设来源，避免 TUI 侧硬编码。
pub fn preset_connect_options() -> Vec<(String, String, bool)> {
    preset_providers()
        .into_iter()
        .filter(|(name, _)| *name != "ollama") // ollama 无需 API Key
        .map(|(name, spec)| (name, spec.base_url, true))
        .collect()
}

pub fn provider_spec_to_model_provider(spec: &ProviderSpec, model_name: &str) -> ModelProvider {
    let kind = detect_provider_kind(&spec.base_url, model_name);
    ModelProvider {
        kind,
        model: model_name.to_string(),
        base_url: Some(normalize_base_url(&spec.base_url)),
        api_key: Some(spec.api_key.clone()),
        rule: spec.models.get(model_name).cloned(),
    }
}


pub fn fetch_models(config: &ProviderConfig) -> Result<Vec<String>> {
    let client = Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .unwrap_or_else(|_| Client::new());
    let url = format!("{}/models", normalize_base_url(&config.base_url));

    let response = client
        .get(&url)
        .header("Authorization", format!("Bearer {}", config.api_key))
        .send()
        .with_context(|| format!("请求模型列表失败: {url}"))?;
    let status = response.status();

    if !status.is_success() {
        let text = response.text().unwrap_or_default();
        anyhow::bail!("模型列表请求失败 ({}): {}", status, text);
    }

    let payload: ModelsResponse = response.json()?;
    let mut models: Vec<String> = payload
        .data
        .into_iter()
        .map(|item| item.id)
        .filter(|id| !id.trim().is_empty())
        .collect();
    models.sort();
    models.dedup();
    Ok(models)
}

pub fn fallback_models(provider_name: &str) -> Vec<String> {
    match provider_name {
        "ollama" => vec!["glm-4.7-flash".to_string()],
        "mimo" => vec!["mimo-v2.5-pro".to_string(), "mimo-v2.5".to_string()],
        "longcat" => vec!["LongCat-2.0-Preview".to_string()],
        "openai" => vec!["gpt-5.4".to_string(), "gpt-5.5".to_string()],
        "deepseek" => vec![
            "deepseek-v4-flash".to_string(),
            "deepseek-v4-pro".to_string(),
        ],
        _ => vec![],
    }
}


fn normalize_catalog(catalog: &mut ProviderCatalog) {
    let mut normalized = BTreeMap::new();
    for (name, mut config) in catalog.providers.clone() {
        let trimmed_name = name.trim();
        if trimmed_name.is_empty() {
            continue;
        }
        config.base_url = normalize_base_url(&config.base_url);
        normalized.insert(trimmed_name.to_string(), config);
    }
    catalog.providers = normalized;

    if catalog.current.trim().is_empty() || !catalog.providers.contains_key(catalog.current.trim())
    {
        catalog.current = catalog.providers.keys().next().cloned().unwrap_or_default();
    } else {
        catalog.current = catalog.current.trim().to_string();
    }
}

#[cfg(test)]
mod tests {
    use std::{
        fs,
        time::{SystemTime, UNIX_EPOCH},
    };

    use sacode_kernel::model::{detect_provider_kind, normalize_base_url, OLLAMA_DEFAULT_BASE_URL};
    use super::{ProviderConfig, ProviderConfigStore};
    use sacode_kernel::model::ProviderKind;

    #[test]
    fn detect_provider_kind_mimo_from_url() {
        assert_eq!(
            detect_provider_kind("https://api.xiaomimimo.com/v1", ""),
            ProviderKind::Mimo
        );
        assert_eq!(
            detect_provider_kind("https://token-plan-cn.xiaomimimo.com/v1", ""),
            ProviderKind::Mimo
        );
    }

    #[test]
    fn detect_provider_kind_mimo_from_model() {
        assert_eq!(
            detect_provider_kind("https://custom.api.com/v1", "mimo-v2.5-pro"),
            ProviderKind::Mimo
        );
    }

    #[test]
    fn detect_provider_kind_deepseek() {
        assert_eq!(
            detect_provider_kind("https://api.deepseek.com/v1", "deepseek-v4-flash"),
            ProviderKind::Deepseek
        );
    }

    #[test]
    fn detect_provider_kind_ollama() {
        assert_eq!(
            detect_provider_kind(OLLAMA_DEFAULT_BASE_URL, "qwen2.5-coder"),
            ProviderKind::Ollama
        );
    }

    #[test]
    fn detect_provider_kind_custom() {
        assert_eq!(
            detect_provider_kind("https://my-api.example.com/v1", "my-model"),
            ProviderKind::Custom("openai-compatible".to_string())
        );
    }

    #[test]
    fn detect_provider_kind_longcat_from_url() {
        assert_eq!(
            detect_provider_kind("https://api.longcat.chat/openai", ""),
            ProviderKind::Longcat
        );
    }

    #[test]
    fn detect_provider_kind_longcat_from_model() {
        assert_eq!(
            detect_provider_kind("https://custom.api.com/v1", "LongCat-2.0-Preview"),
            ProviderKind::Longcat
        );
    }

    #[test]
    fn normalize_base_url_trims_slashes_and_spaces() {
        assert_eq!(
            normalize_base_url(" https://example.com/v1/ "),
            "https://example.com/v1"
        );
    }

    #[test]
    fn provider_store_saves_and_loads_normalized_config() {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time before unix epoch")
            .as_nanos();
        let workdir = std::env::temp_dir().join(format!("sacode-provider-config-{unique}"));
        fs::create_dir_all(&workdir).expect("create temp workdir");

        let store = ProviderConfigStore::new(&workdir);
        let config = ProviderConfig {
            base_url: "https://example.com/v1/".to_string(),
            api_key: "test-key".to_string(),
            model: "gpt-test".to_string(),
        };
        store.save(&config).expect("save provider config");

        let loaded = store
            .load_current()
            .expect("load provider config")
            .expect("provider config should exist");
        assert_eq!(loaded.name, "default");
        assert_eq!(loaded.config.base_url, "https://example.com/v1");
        assert_eq!(loaded.config.api_key, "test-key");
        assert_eq!(loaded.config.model, "gpt-test");
    }

    #[test]
    fn provider_store_supports_multiple_providers() {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time before unix epoch")
            .as_nanos();
        let workdir = std::env::temp_dir().join(format!("sacode-provider-catalog-{unique}"));
        fs::create_dir_all(&workdir).expect("create temp workdir");

        let store = ProviderConfigStore::new(&workdir);
        store
            .save_named(
                "openai",
                &ProviderConfig {
                    base_url: "https://api.openai.com/v1".to_string(),
                    api_key: "openai-key".to_string(),
                    model: "gpt-5.4".to_string(),
                },
                true,
            )
            .expect("save openai provider");
        store
            .save_named(
                "local",
                &ProviderConfig {
                    base_url: OLLAMA_DEFAULT_BASE_URL.to_string(),
                    api_key: "local-key".to_string(),
                    model: "glm-4.7-flash".to_string(),
                },
                false,
            )
            .expect("save local provider");

        let names = store.list_names().expect("list provider names");
        assert_eq!(names, vec!["local".to_string(), "openai".to_string()]);

        store.set_current("local").expect("switch current provider");
        let loaded = store
            .load_current()
            .expect("load current provider")
            .expect("current provider should exist");
        assert_eq!(loaded.name, "local");
        assert_eq!(loaded.config.model, "glm-4.7-flash");
    }

    #[test]
    fn provider_store_can_rename_and_remove_non_current_provider() {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time before unix epoch")
            .as_nanos();
        let workdir = std::env::temp_dir().join(format!("sacode-provider-rename-remove-{unique}"));
        fs::create_dir_all(&workdir).expect("create temp workdir");

        let store = ProviderConfigStore::new(&workdir);
        store
            .save_named(
                "openai",
                &ProviderConfig {
                    base_url: "https://api.openai.com/v1".to_string(),
                    api_key: "openai-key".to_string(),
                    model: "gpt-5.4".to_string(),
                },
                true,
            )
            .expect("save openai provider");
        store
            .save_named(
                "local",
                &ProviderConfig {
                    base_url: OLLAMA_DEFAULT_BASE_URL.to_string(),
                    api_key: "local-key".to_string(),
                    model: "qwen2.5-coder".to_string(),
                },
                false,
            )
            .expect("save local provider");

        store.rename("local", "ollama").expect("rename provider");
        let names = store
            .list_names()
            .expect("list provider names after rename");
        assert_eq!(names, vec!["ollama".to_string(), "openai".to_string()]);

        store.remove("ollama").expect("remove renamed provider");
        let names = store
            .list_names()
            .expect("list provider names after remove");
        assert_eq!(names, vec!["openai".to_string()]);
    }

    #[test]
    fn provider_store_loads_legacy_single_provider_file() {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time before unix epoch")
            .as_nanos();
        let workdir = std::env::temp_dir().join(format!("sacode-provider-legacy-{unique}"));
        let config_dir = workdir.join(".sacode");
        fs::create_dir_all(&config_dir).expect("create config dir");
        fs::write(
            config_dir.join("provider.json"),
            r#"{
  "base_url": "https://example.com/v1/",
  "api_key": "legacy-key",
  "model": "legacy-model"
}"#,
        )
        .expect("write legacy provider config");

        let store = ProviderConfigStore::new(&workdir);
        let loaded = store
            .load_current()
            .expect("load legacy provider config")
            .expect("legacy provider should exist");
        assert_eq!(loaded.name, "default");
        assert_eq!(loaded.config.base_url, "https://example.com/v1");
        assert_eq!(loaded.config.api_key, "legacy-key");
        assert_eq!(loaded.config.model, "legacy-model");
    }
}
