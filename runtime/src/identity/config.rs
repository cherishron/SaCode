use std::path::{Path, PathBuf};

use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};

use super::{DEFAULT_CLIENT_ID, DEFAULT_PROVIDER_NAME};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct IdentityConfig {
    pub idp_base_url: String,
    pub gateway_base_url: String,
    #[serde(default = "default_client_id")]
    pub client_id: String,
    /// Loopback redirect. When empty, CLI binds an ephemeral port.
    #[serde(default)]
    pub redirect_uri: Option<String>,
    #[serde(default = "default_provider_name")]
    pub provider_name: String,
}

fn default_client_id() -> String {
    DEFAULT_CLIENT_ID.to_string()
}

fn default_provider_name() -> String {
    DEFAULT_PROVIDER_NAME.to_string()
}

impl Default for IdentityConfig {
    fn default() -> Self {
        Self {
            idp_base_url: String::new(),
            gateway_base_url: String::new(),
            client_id: default_client_id(),
            redirect_uri: None,
            provider_name: default_provider_name(),
        }
    }
}

impl IdentityConfig {
    pub fn user_config_path() -> PathBuf {
        home_dir()
            .join(".sacode")
            .join("identity")
            .join("config.json")
    }

    pub fn load(user_root: Option<&Path>) -> Result<Self> {
        let path = match user_root {
            Some(root) => root.join(".sacode").join("identity").join("config.json"),
            None => Self::user_config_path(),
        };
        let mut cfg = if path.exists() {
            let raw = std::fs::read_to_string(&path)
                .with_context(|| format!("read identity config {}", path.display()))?;
            serde_json::from_str(&raw)
                .with_context(|| format!("parse identity config {}", path.display()))?
        } else {
            Self::default()
        };
        cfg.apply_env_overrides();
        Ok(cfg)
    }

    pub fn save(&self, user_root: Option<&Path>) -> Result<()> {
        let path = match user_root {
            Some(root) => root.join(".sacode").join("identity").join("config.json"),
            None => Self::user_config_path(),
        };
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let raw = serde_json::to_string_pretty(self)?;
        std::fs::write(&path, raw).with_context(|| format!("write {}", path.display()))?;
        Ok(())
    }

    pub fn apply_env_overrides(&mut self) {
        if let Ok(v) = std::env::var("SACODE_IDP_BASE_URL") {
            let v = v.trim().to_string();
            if !v.is_empty() {
                self.idp_base_url = v;
            }
        }
        if let Ok(v) = std::env::var("SACODE_GATEWAY_BASE_URL") {
            let v = v.trim().to_string();
            if !v.is_empty() {
                self.gateway_base_url = v;
            }
        }
        if let Ok(v) = std::env::var("SACODE_IDENTITY_CLIENT_ID") {
            let v = v.trim().to_string();
            if !v.is_empty() {
                self.client_id = v;
            }
        }
    }

    pub fn with_overrides(
        mut self,
        idp: Option<String>,
        gateway: Option<String>,
        client_id: Option<String>,
        redirect_uri: Option<String>,
        provider_name: Option<String>,
    ) -> Self {
        if let Some(v) = idp {
            self.idp_base_url = v;
        }
        if let Some(v) = gateway {
            self.gateway_base_url = v;
        }
        if let Some(v) = client_id {
            self.client_id = v;
        }
        if let Some(v) = redirect_uri {
            self.redirect_uri = if v.trim().is_empty() { None } else { Some(v) };
        }
        if let Some(v) = provider_name {
            self.provider_name = v;
        }
        self
    }

    pub fn normalize(&mut self) {
        self.idp_base_url = self.idp_base_url.trim().trim_end_matches('/').to_string();
        self.gateway_base_url = self
            .gateway_base_url
            .trim()
            .trim_end_matches('/')
            .to_string();
        self.client_id = self.client_id.trim().to_string();
        if self.client_id.is_empty() {
            self.client_id = DEFAULT_CLIENT_ID.to_string();
        }
        if self.provider_name.trim().is_empty() {
            self.provider_name = DEFAULT_PROVIDER_NAME.to_string();
        } else {
            self.provider_name = self.provider_name.trim().to_string();
        }
    }

    /// Fill empty identity endpoints with the local saai development defaults.
    pub fn fill_local_defaults_if_empty(&mut self) {
        if self.idp_base_url.trim().is_empty() {
            self.idp_base_url = "http://127.0.0.1:8080".to_string();
        }
        if self.gateway_base_url.trim().is_empty() {
            self.gateway_base_url = "http://127.0.0.1:8090".to_string();
        }
    }

    pub fn ensure_ready_for_network(&self) -> Result<()> {
        if self.idp_base_url.is_empty() {
            anyhow::bail!(
                "idp_base_url is empty; set SACODE_IDP_BASE_URL or ~/.sacode/identity/config.json"
            );
        }
        if self.gateway_base_url.is_empty() {
            anyhow::bail!(
                "gateway_base_url is empty; set SACODE_GATEWAY_BASE_URL or ~/.sacode/identity/config.json"
            );
        }
        Ok(())
    }

    pub fn authorize_endpoint(&self) -> String {
        format!("{}{}", self.idp_base_url, super::IDP_AUTHORIZE_PATH)
    }

    pub fn token_endpoint(&self) -> String {
        format!("{}{}", self.idp_base_url, super::IDP_TOKEN_PATH)
    }

    pub fn discovery_endpoint(&self) -> String {
        format!("{}/.well-known/openid-configuration", self.idp_base_url)
    }

    pub fn revoke_endpoint(&self) -> String {
        format!("{}{}", self.idp_base_url, super::IDP_REVOKE_PATH)
    }

    pub fn gateway_exchange_url(&self) -> String {
        format!(
            "{}{}",
            self.gateway_base_url,
            super::GATEWAY_KEY_EXCHANGE_PATH
        )
    }

    pub fn gateway_models_url(&self) -> String {
        format!("{}{}", self.gateway_base_url, super::GATEWAY_MODELS_PATH)
    }

    pub fn provider_base_url(&self) -> String {
        format!("{}/v1", self.gateway_base_url.trim_end_matches('/'))
    }

    pub fn dry_run_summary(&self) -> String {
        format!(
            "idp_base_url={}\ngateway_base_url={}\nclient_id={}\nredirect_uri={}\nprovider_name={}\ntoken_endpoint={}\nexchange_url={}\nmodels_url={}",
            self.idp_base_url,
            self.gateway_base_url,
            self.client_id,
            self.redirect_uri.as_deref().unwrap_or("(loopback ephemeral)"),
            self.provider_name,
            self.token_endpoint(),
            self.gateway_exchange_url(),
            self.gateway_models_url(),
        )
    }
}

fn home_dir() -> PathBuf {
    if let Ok(v) = std::env::var("SACODE_HOME") {
        if !v.trim().is_empty() {
            return PathBuf::from(v.trim());
        }
    }
    if let Ok(v) = std::env::var("USERPROFILE") {
        if !v.trim().is_empty() {
            return PathBuf::from(v.trim());
        }
    }
    if let Ok(v) = std::env::var("HOME") {
        if !v.trim().is_empty() {
            return PathBuf::from(v.trim());
        }
    }
    PathBuf::from(".")
}

/// Public alias for identity modules (headless pending-login path).
pub fn home_dir_fallback() -> PathBuf {
    home_dir()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;

    static ENV_LOCK: Mutex<()> = Mutex::new(());

    #[test]
    fn env_overrides_file_values() {
        let _g = ENV_LOCK.lock().unwrap();
        std::env::set_var("SACODE_IDP_BASE_URL", "https://idp.test");
        std::env::set_var("SACODE_GATEWAY_BASE_URL", "https://gw.test/");
        std::env::set_var("SACODE_IDENTITY_CLIENT_ID", "sacode-cli");
        let mut cfg = IdentityConfig::default();
        cfg.apply_env_overrides();
        cfg.normalize();
        assert_eq!(cfg.idp_base_url, "https://idp.test");
        assert_eq!(cfg.gateway_base_url, "https://gw.test");
        assert_eq!(cfg.client_id, "sacode-cli");
        std::env::remove_var("SACODE_IDP_BASE_URL");
        std::env::remove_var("SACODE_GATEWAY_BASE_URL");
        std::env::remove_var("SACODE_IDENTITY_CLIENT_ID");
    }

    #[test]
    fn endpoint_builders_join_paths() {
        let cfg = IdentityConfig {
            idp_base_url: "https://idp.example.com".into(),
            gateway_base_url: "https://gw.example.com".into(),
            ..Default::default()
        };
        assert_eq!(cfg.token_endpoint(), "https://idp.example.com/oauth/token");
        assert_eq!(
            cfg.gateway_exchange_url(),
            "https://gw.example.com/api/auth/exchange"
        );
        assert_eq!(cfg.provider_base_url(), "https://gw.example.com/v1");
    }
}
