//! Product-line primary path: sa-idp session → SaAiApiGateway api_key → gateway models.
//!
//! Custom `/connect` providers remain an escape hatch, not the default product flow.

use std::path::{Path, PathBuf};

use crate::provider_config::NamedProviderConfig;
use crate::provider_runtime::{resolve_authorized_named_provider, resolve_named_provider};
use sacode_runtime::identity::{
    ensure_fresh_session, is_identity_provider_name, select_secret_store, IdentityConfig,
    IdentitySession, LoginOptions,
};

/// Resolve the saai product provider from session.json (runtime injection).
/// Identity providers are NO LONGER stored in provider.json;
/// they are constructed on-the-fly from the identity session.
pub fn resolve_gateway_named_provider(_workdir: &Path) -> Option<NamedProviderConfig> {
    let session = IdentitySession::load(None).ok().flatten()?;
    if session.gateway_key_ref.is_none() {
        return None;
    }
    let mut config = IdentityConfig::load(None).unwrap_or_default();
    config.apply_env_overrides();
    config.fill_local_defaults_if_empty();
    let base_url = config.provider_base_url();
    if base_url.is_empty() {
        return None;
    }
    let model = if !session.default_model.trim().is_empty() {
        session.default_model.clone()
    } else {
        session.models.first().cloned().unwrap_or_default()
    };
    if model.is_empty() {
        return None;
    }
    // Resolve api_key from keyring/file secret store.
    let secret_ref = session.gateway_key_ref.clone()?;
    let mut provider_config = crate::provider_config::ProviderConfig {
        base_url,
        api_key: String::new(),
        model,
        auth_header: Some("Authorization".to_string()),
        auth_scheme: Some("Bearer".to_string()),
        secret_ref: Some(secret_ref),
    };
    // Resolve secret_ref to plaintext for runtime use.
    if provider_config.api_key.is_empty() {
        provider_config.api_key = provider_config.resolved_api_key();
    }
    if provider_config.api_key.is_empty() {
        return None;
    }
    let name = if !session.provider_name.is_empty() {
        session.provider_name
    } else {
        "sa-ai".to_string()
    };
    Some(NamedProviderConfig {
        name,
        config: provider_config,
    })
}

/// Identity session models / default model (already synced from gateway `/v1/models`).
pub fn identity_session_models() -> Option<(Vec<String>, String)> {
    let session = IdentitySession::load(None).ok().flatten()?;
    if session.models.is_empty() && session.default_model.trim().is_empty() {
        return Some((session.models, session.default_model));
    }
    Some((session.models, session.default_model))
}

#[allow(dead_code)]
fn identity_default_model() -> Option<String> {
    let (_, default_model) = identity_session_models()?;
    if default_model.trim().is_empty() {
        None
    } else {
        Some(default_model)
    }
}

/// Product-line ready: gateway identity provider usable, or any authorized provider.
pub fn product_ready(workdir: &Path) -> bool {
    resolve_gateway_named_provider(workdir).is_some()
        || resolve_authorized_named_provider(workdir).is_some()
}

/// Prefer the gateway product path; fall back to authorized custom providers.
pub fn resolve_product_named_provider(workdir: &Path) -> Option<NamedProviderConfig> {
    if let Some(named) = resolve_gateway_named_provider(workdir) {
        return Some(named);
    }
    // Also accept identity name via current provider.json even if not sa-ai branded yet.
    if let Some(named) = resolve_named_provider(workdir) {
        if is_identity_provider_name(&named.name) {
            let mut config = named.config;
            if config.api_key.is_empty() {
                config.api_key = config.resolved_api_key();
            }
            if !config.api_key.is_empty() && !config.base_url.is_empty() {
                return Some(NamedProviderConfig {
                    name: named.name,
                    config,
                });
            }
        }
    }
    resolve_authorized_named_provider(workdir)
}

/// Best-effort session refresh before model calls (7-day stay-logged-in via refresh_token).
pub fn ensure_product_session_best_effort(workdir: &Path) -> Result<(), String> {
    let Ok(Some(_session)) = IdentitySession::load(None) else {
        return Ok(()); // not on product identity path — custom providers unaffected
    };
    let mut config = IdentityConfig::load(None).unwrap_or_default();
    config.apply_env_overrides();
    config.fill_local_defaults_if_empty();
    let user_root = identity_user_root();
    let store = select_secret_store(false, user_root.as_deref());
    let rt = match tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
    {
        Ok(rt) => rt,
        Err(e) => return Err(format!("session runtime: {e}")),
    };
    let _opts = LoginOptions {
        workdir: workdir.to_path_buf(),
        user_root: user_root.clone(),
        dry_run: false,
        open_browser: false,
        ..Default::default()
    };
    match rt.block_on(ensure_fresh_session(
        &config,
        user_root.as_deref(),
        workdir,
        store.as_ref(),
        false,
        None,
        None,
        120,
    )) {
        Ok(_fresh) => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

fn identity_user_root() -> Option<PathBuf> {
    if let Ok(v) = std::env::var("SACODE_HOME") {
        if !v.trim().is_empty() {
            return Some(PathBuf::from(v.trim()));
        }
    }
    None
}

/// Build a ModelProvider from the product path (gateway first).
pub fn product_model_provider(workdir: &Path) -> Option<sacode_kernel::model::ModelProvider> {
    let named = resolve_product_named_provider(workdir)?;
    let mut config = named.config;
    if config.api_key.is_empty() {
        config.api_key = config.resolved_api_key();
    }
    if config.api_key.is_empty() {
        return None;
    }
    Some(config.to_model_provider())
}

/// Catalog entries for /models: identity gateway models first, then others.
pub fn product_model_entries(workdir: &Path) -> Vec<(String, String)> {
    let mut out = Vec::new();
    if let Some((models, default_model)) = identity_session_models() {
        let provider = resolve_gateway_named_provider(workdir)
            .map(|n| n.name)
            .unwrap_or_else(|| "sa-ai".to_string());
        if !default_model.trim().is_empty() {
            out.push((provider.clone(), default_model.clone()));
        }
        for m in models {
            if m != default_model {
                out.push((provider.clone(), m));
            }
        }
        if !out.is_empty() {
            return out;
        }
    }
    if let Some(named) = resolve_product_named_provider(workdir) {
        out.push((named.name, named.config.model));
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use serial_test::serial;

    struct EnvGuard {
        values: Vec<(&'static str, Option<std::ffi::OsString>)>,
    }

    impl EnvGuard {
        fn set(values: &[(&'static str, &std::ffi::OsStr)]) -> Self {
            let previous = values
                .iter()
                .map(|(key, _)| (*key, std::env::var_os(key)))
                .collect();
            for (key, value) in values {
                std::env::set_var(key, value);
            }
            Self { values: previous }
        }
    }

    impl Drop for EnvGuard {
        fn drop(&mut self) {
            for (key, value) in self.values.drain(..) {
                match value {
                    Some(value) => std::env::set_var(key, value),
                    None => std::env::remove_var(key),
                }
            }
        }
    }

    #[test]
    fn is_identity_provider_name_matches_product_aliases() {
        assert!(is_identity_provider_name("sa-ai"));
        assert!(is_identity_provider_name("sa-gateway"));
        assert!(!is_identity_provider_name("openai"));
    }

    #[test]
    #[serial]
    fn product_ready_false_without_providers() {
        let tmp = tempfile::tempdir().unwrap();
        let _env = EnvGuard::set(&[
            ("SACODE_HOME", tmp.path().as_os_str()),
            ("USERPROFILE", tmp.path().as_os_str()),
            ("HOME", tmp.path().as_os_str()),
        ]);
        assert!(!product_ready(tmp.path()));
    }

    #[test]
    #[serial]
    fn resolve_gateway_requires_usable_key() {
        // resolve_gateway_named_provider now reads from session.json, not provider.json.
        // Without a session, it returns None.
        let tmp = tempfile::tempdir().unwrap();
        let _env = EnvGuard::set(&[
            ("SACODE_HOME", tmp.path().as_os_str()),
            (
                "SACODE_IDENTITY_SECRET_BACKEND",
                std::ffi::OsStr::new("file"),
            ),
        ]);

        // No session → no gateway provider.
        assert!(resolve_gateway_named_provider(tmp.path()).is_none());
    }
}
