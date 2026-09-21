use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use anyhow::{anyhow, Result};
use sacode_kernel::model::{SecretRef, SecretRefKind};

/// Resolve secrets from a locator. Production uses OS keyring; tests use memory.
pub trait SecretStore: Send + Sync {
    fn get(&self, locator: &str) -> Result<Option<String>>;
    fn set(&self, locator: &str, secret: &str) -> Result<()>;
    fn delete(&self, locator: &str) -> Result<()>;
}

#[derive(Default, Clone)]
pub struct MemorySecretStore {
    inner: Arc<Mutex<HashMap<String, String>>>,
}

impl MemorySecretStore {
    pub fn new() -> Self {
        Self::default()
    }
}

impl SecretStore for MemorySecretStore {
    fn get(&self, locator: &str) -> Result<Option<String>> {
        Ok(self.inner.lock().unwrap().get(locator).cloned())
    }

    fn set(&self, locator: &str, secret: &str) -> Result<()> {
        self.inner
            .lock()
            .unwrap()
            .insert(locator.to_string(), secret.to_string());
        Ok(())
    }

    fn delete(&self, locator: &str) -> Result<()> {
        self.inner.lock().unwrap().remove(locator);
        Ok(())
    }
}

/// OS keyring backend. Locator: `os-keyring:{service}/{account}`.
///
/// On Windows Credential Manager the target/username mapping can vary;
/// we try a few stable shapes on read.
pub struct OsKeyringSecretStore;

impl OsKeyringSecretStore {
    pub fn new() -> Self {
        Self
    }

    fn entries(service: &str, account: &str) -> Vec<keyring::Entry> {
        let mut out = Vec::new();
        if let Ok(e) = keyring::Entry::new(service, account) {
            out.push(e);
        }
        if let Ok(e) = keyring::Entry::new(service, &format!("{service}/{account}")) {
            out.push(e);
        }
        if let Ok(e) = keyring::Entry::new(&format!("{service}/{account}"), service) {
            out.push(e);
        }
        out
    }
}

impl Default for OsKeyringSecretStore {
    fn default() -> Self {
        Self::new()
    }
}

impl SecretStore for OsKeyringSecretStore {
    fn get(&self, locator: &str) -> Result<Option<String>> {
        let (service, account) = parse_keyring_locator(locator)?;
        for entry in Self::entries(service, account) {
            match entry.get_password() {
                Ok(v) => return Ok(Some(v)),
                Err(keyring::Error::NoEntry) => continue,
                Err(e) => {
                    tracing::warn!(error = %e, %locator, "keyring get failed; trying next target");
                    continue;
                }
            }
        }
        Ok(None)
    }

    fn set(&self, locator: &str, secret: &str) -> Result<()> {
        let (service, account) = parse_keyring_locator(locator)?;
        let mut last = None;
        for entry in Self::entries(service, account) {
            match entry.set_password(secret) {
                Ok(()) => return Ok(()),
                Err(e) => last = Some(e),
            }
        }
        Err(anyhow!(
            "keyring set failed for {locator}: {}",
            last.map(|e| e.to_string())
                .unwrap_or_else(|| "no entry backend".into())
        ))
    }

    fn delete(&self, locator: &str) -> Result<()> {
        let (service, account) = parse_keyring_locator(locator)?;
        let mut last = None;
        for entry in Self::entries(service, account) {
            match entry.delete_credential() {
                Ok(()) => return Ok(()),
                Err(keyring::Error::NoEntry) => continue,
                Err(e) => last = Some(e),
            }
        }
        if let Some(e) = last {
            Err(anyhow!("keyring delete failed for {locator}: {e}"))
        } else {
            Ok(())
        }
    }
}

pub fn parse_keyring_locator(locator: &str) -> Result<(&str, &str)> {
    let rest = locator.strip_prefix("os-keyring:").ok_or_else(|| {
        anyhow!("invalid keyring locator (expected os-keyring:service/account): {locator}")
    })?;
    let (service, account) = rest
        .split_once('/')
        .ok_or_else(|| anyhow!("invalid keyring locator (missing account): {locator}"))?;
    if service.is_empty() || account.is_empty() {
        anyhow::bail!("invalid keyring locator (empty service/account): {locator}");
    }
    Ok((service, account))
}

pub fn secret_ref_from_locator(locator: &str, secret: &str) -> SecretRef {
    SecretRef {
        kind: SecretRefKind::OsKeyring,
        locator: Some(locator.to_string()),
        masked: SecretRef::mask_secret(secret),
    }
}

/// Resolve a secret_ref using the provided store, then default backends.
///
/// Order when `store` is None:
/// 1. Environment locator (if kind=Environment)
/// 2. OS keyring (for `os-keyring:` locators)
/// 3. File secret store under SACODE_HOME/USERPROFILE (`--insecure-file-secrets` writes)
/// 4. Env `SACODE_IDENTITY_SECRET_<ACCOUNT>` escape hatch
pub fn resolve_secret_ref(
    secret_ref: &SecretRef,
    store: Option<&dyn SecretStore>,
) -> Result<Option<String>> {
    match secret_ref.kind {
        SecretRefKind::Environment => {
            let var = secret_ref
                .locator
                .as_deref()
                .ok_or_else(|| anyhow!("environment secret_ref missing locator"))?;
            Ok(std::env::var(var).ok())
        }
        SecretRefKind::LegacyInline => Ok(None),
        SecretRefKind::Stored | SecretRefKind::OsKeyring => {
            let locator = secret_ref
                .locator
                .as_deref()
                .ok_or_else(|| anyhow!("secret_ref missing locator"))?;
            if let Some(store) = store {
                return store.get(locator);
            }
            if locator.starts_with("os-keyring:") {
                // Prefer OS keyring; fall back on Err/None (wrong credential layout,
                // headless CI, or --insecure-file-secrets writes).
                if let Ok(Some(v)) = OsKeyringSecretStore.get(locator) {
                    return Ok(Some(v));
                }
                let file_store = crate::identity::service::FileSecretStore::new(None);
                if let Ok(Some(v)) = file_store.get(locator) {
                    return Ok(Some(v));
                }
                if let Some(account) = locator.rsplit('/').next() {
                    let env_key = format!(
                        "SACODE_IDENTITY_SECRET_{}",
                        account.to_uppercase().replace('-', "_")
                    );
                    if let Ok(v) = std::env::var(&env_key) {
                        if !v.is_empty() {
                            return Ok(Some(v));
                        }
                    }
                }
                Ok(None)
            } else {
                Err(anyhow!(
                    "stored secret_ref without secret store backend: {locator}"
                ))
            }
        }
    }
}

/// Best-effort default store for production paths: OS keyring.
pub fn default_secret_store() -> Box<dyn SecretStore> {
    Box::new(OsKeyringSecretStore::new())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn memory_store_roundtrip() {
        let store = MemorySecretStore::new();
        store
            .set("os-keyring:sacode/identity/gateway-api-key", "sa-test")
            .unwrap();
        assert_eq!(
            store
                .get("os-keyring:sacode/identity/gateway-api-key")
                .unwrap()
                .as_deref(),
            Some("sa-test")
        );
        store
            .delete("os-keyring:sacode/identity/gateway-api-key")
            .unwrap();
        assert!(store
            .get("os-keyring:sacode/identity/gateway-api-key")
            .unwrap()
            .is_none());
    }

    #[test]
    fn parse_locator_requires_shape() {
        assert!(parse_keyring_locator("os-keyring:sacode/identity/gateway-api-key").is_ok());
        assert!(parse_keyring_locator("keyring:foo").is_err());
        assert!(parse_keyring_locator("os-keyring:noslash").is_err());
    }

    #[test]
    fn resolve_secret_ref_uses_injected_store() {
        let store = MemorySecretStore::new();
        store
            .set("os-keyring:sacode/identity/refresh-token", "rt-1")
            .unwrap();
        let r#ref = SecretRef::os_keyring("os-keyring:sacode/identity/refresh-token");
        let value = resolve_secret_ref(&r#ref, Some(&store)).unwrap().unwrap();
        assert_eq!(value, "rt-1");
    }

    /// Live Windows keyring probe via production OsKeyringSecretStore.
    #[test]
    fn live_keyring_gateway_key_resolves() {
        let loc = "os-keyring:sacode/identity/gateway-api-key";
        let store = OsKeyringSecretStore;
        let marker = format!("idp-probe-{}", std::process::id());
        // set then get — proves production path
        store.set(loc, &marker).expect("keyring set");
        let got = store.get(loc).expect("keyring get");
        assert_eq!(got.as_deref(), Some(marker.as_str()));
        // restore real key from file fallback if present
        let file_store = crate::identity::service::FileSecretStore::new(None);
        if let Ok(Some(real)) = file_store.get(loc) {
            let _ = OsKeyringSecretStore.set(loc, &real);
            eprintln!("restored real gateway key into keyring");
        } else {
            let _ = store.delete(loc);
        }
        eprintln!("live_keyring_identity_ok");
    }
}
