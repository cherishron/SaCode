use std::path::{Path, PathBuf};

use anyhow::{Context, Result};
use chrono::Utc;
use sacode_kernel::model::{SecretRef, SecretRefKind};
use serde::{Deserialize, Serialize};

use super::secret_store::secret_ref_from_locator;
use super::{GATEWAY_API_KEY_LOCATOR, REFRESH_TOKEN_LOCATOR};

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct IdentitySession {
    #[serde(default = "schema_v1")]
    pub schema_version: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub subject: Option<String>,
    pub idp_base_url: String,
    pub gateway_base_url: String,
    pub client_id: String,
    pub provider_name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub gateway_key_ref: Option<SecretRef>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub refresh_token_ref: Option<SecretRef>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub access_token_expires_at: Option<String>,
    #[serde(default)]
    pub models: Vec<String>,
    #[serde(default)]
    pub default_model: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub logged_in_at: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_refresh_at: Option<String>,
}

fn schema_v1() -> u32 {
    1
}

#[derive(Debug, Clone)]
pub struct ProviderWriteResult {
    pub provider_name: String,
    pub secret_ref: SecretRef,
}

#[derive(Debug, Clone, Serialize)]
pub struct SessionStatus {
    pub logged_in: bool,
    pub subject: Option<String>,
    pub idp_base_url: String,
    pub gateway_base_url: String,
    pub client_id: String,
    pub provider_name: String,
    pub models_count: usize,
    pub default_model: Option<String>,
    pub gateway_key_ref_masked: Option<String>,
    pub refresh_token_ref_masked: Option<String>,
    pub logged_in_at: Option<String>,
}

impl IdentitySession {
    pub fn session_path(user_root: Option<&Path>) -> PathBuf {
        match user_root {
            Some(root) => root.join(".sacode").join("identity").join("session.json"),
            None => default_user_root()
                .join(".sacode")
                .join("identity")
                .join("session.json"),
        }
    }

    pub fn load(user_root: Option<&Path>) -> Result<Option<Self>> {
        let path = Self::session_path(user_root);
        if !path.exists() {
            return Ok(None);
        }
        let raw = std::fs::read_to_string(&path)
            .with_context(|| format!("read session {}", path.display()))?;
        if raw.trim().is_empty() {
            return Ok(None);
        }
        let session: Self = serde_json::from_str(&raw)
            .with_context(|| format!("parse session {}", path.display()))?;
        Ok(Some(session))
    }

    pub fn save(&self, user_root: Option<&Path>) -> Result<()> {
        let path = Self::session_path(user_root);
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let raw = serde_json::to_string_pretty(self)?;
        // Defense in depth: never persist raw key material if it leaked into refs.
        if raw.contains("sa-mock-key")
            || (self.gateway_key_ref.is_some() && raw.contains("\"api_key\": \"sa-"))
        {
            anyhow::bail!(
                "refusing to write identity session that appears to contain plaintext api_key"
            );
        }
        if self.refresh_token_ref.is_none() && raw.contains("refresh_token\": \"") {
            anyhow::bail!(
                "refusing to write identity session that appears to contain plaintext refresh_token"
            );
        }
        std::fs::write(&path, raw).with_context(|| format!("write {}", path.display()))?;
        Ok(())
    }

    pub fn delete(user_root: Option<&Path>) -> Result<()> {
        let path = Self::session_path(user_root);
        if path.exists() {
            std::fs::remove_file(&path)
                .with_context(|| format!("remove session {}", path.display()))?;
        }
        Ok(())
    }

    pub fn status(&self) -> SessionStatus {
        SessionStatus {
            logged_in: self.gateway_key_ref.is_some() || self.refresh_token_ref.is_some(),
            subject: self.subject.clone(),
            idp_base_url: self.idp_base_url.clone(),
            gateway_base_url: self.gateway_base_url.clone(),
            client_id: self.client_id.clone(),
            provider_name: self.provider_name.clone(),
            models_count: self.models.len(),
            default_model: if self.default_model.is_empty() {
                None
            } else {
                Some(self.default_model.clone())
            },
            gateway_key_ref_masked: self
                .gateway_key_ref
                .as_ref()
                .map(|r| format!("{}:{}", kind_label(r.kind), r.masked)),
            refresh_token_ref_masked: self
                .refresh_token_ref
                .as_ref()
                .map(|r| format!("{}:{}", kind_label(r.kind), r.masked)),
            logged_in_at: self.logged_in_at.clone(),
        }
    }

    pub fn apply_token_metadata(&mut self, expires_in: Option<u64>, refresh_token: Option<&str>) {
        if let Some(secs) = expires_in {
            let at = Utc::now() + chrono::Duration::seconds(secs as i64);
            self.access_token_expires_at = Some(at.to_rfc3339());
        }
        if refresh_token.is_some() {
            self.last_refresh_at = Some(Utc::now().to_rfc3339());
        }
    }

    pub fn set_key_refs(&mut self, gateway_key: &str, refresh_token: &str) {
        self.gateway_key_ref = Some(secret_ref_from_locator(
            GATEWAY_API_KEY_LOCATOR,
            gateway_key,
        ));
        if refresh_token.trim().is_empty() {
            // Provisioned cloud api-keys have no refresh token.
            self.refresh_token_ref = None;
        } else {
            self.refresh_token_ref = Some(secret_ref_from_locator(
                REFRESH_TOKEN_LOCATOR,
                refresh_token,
            ));
        }
    }

    pub fn clear_key_refs(&mut self) {
        self.gateway_key_ref = None;
        self.refresh_token_ref = None;
        self.access_token_expires_at = None;
    }
}

fn kind_label(kind: SecretRefKind) -> &'static str {
    match kind {
        SecretRefKind::Environment => "env",
        SecretRefKind::Stored => "stored",
        SecretRefKind::LegacyInline => "legacy",
        SecretRefKind::OsKeyring => "os_keyring",
    }
}

fn default_user_root() -> PathBuf {
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::identity::secret_store::{MemorySecretStore, SecretStore};

    #[test]
    fn session_roundtrip_does_not_store_raw_secrets() {
        let tmp = tempfile::tempdir().unwrap();
        let mut session = IdentitySession {
            idp_base_url: "https://idp.test".into(),
            gateway_base_url: "https://gw.test".into(),
            client_id: "sacode".into(),
            provider_name: "sa-ai".into(),
            models: vec!["deepseek-chat".into()],
            default_model: "deepseek-chat".into(),
            subject: Some("user-1".into()),
            logged_in_at: Some("2026-09-20T00:00:00Z".into()),
            ..Default::default()
        };
        session.set_key_refs("sa-super-secret-key-9999", "refresh-plain-token-9999");
        session.save(Some(tmp.path())).unwrap();

        let raw = std::fs::read_to_string(IdentitySession::session_path(Some(tmp.path()))).unwrap();
        assert!(!raw.contains("sa-super-secret-key-9999"));
        assert!(!raw.contains("refresh-plain-token-9999"));
        assert!(raw.contains("os_keyring"));

        let loaded = IdentitySession::load(Some(tmp.path())).unwrap().unwrap();
        assert_eq!(loaded.provider_name, "sa-ai");
        assert_eq!(
            loaded.gateway_key_ref.as_ref().unwrap().kind,
            SecretRefKind::OsKeyring
        );

        let status = loaded.status();
        assert!(status.logged_in);
        assert!(status.gateway_key_ref_masked.unwrap().contains("****9999"));
    }

    #[test]
    fn memory_store_holds_key_material() {
        let store = MemorySecretStore::new();
        store.set(GATEWAY_API_KEY_LOCATOR, "sa-abc").unwrap();
        store.set(REFRESH_TOKEN_LOCATOR, "rt-abc").unwrap();
        assert_eq!(
            store.get(GATEWAY_API_KEY_LOCATOR).unwrap().as_deref(),
            Some("sa-abc")
        );
        assert_eq!(
            store.get(REFRESH_TOKEN_LOCATOR).unwrap().as_deref(),
            Some("rt-abc")
        );
    }
}
