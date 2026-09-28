//! Dual-client entitlement tokens (sacode-ent, aud=saai-entitlement).
//!
//! The gateway client (`sacode`, aud=saai-api) cannot call sa-entitlement.
//! This module acquires and refreshes a second OAuth token set and stores it
//! only in SecretStore (OS keyring in production).

use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};

use super::config::IdentityConfig;
use super::oidc::{OidcHttp, ReqwestOidcHttp, TokenResponse};
use super::pkce::generate_pkce;
use super::secret_store::SecretStore;
use super::{ENTITLEMENT_ACCESS_TOKEN_LOCATOR, ENTITLEMENT_REFRESH_TOKEN_LOCATOR};

/// Non-secret metadata for the entitlement token set.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
pub struct EntitlementTokenMeta {
    pub client_id: String,
    pub access_token_expires_at: Option<String>,
    pub scope: Option<String>,
}

fn meta_path(user_root: Option<&std::path::Path>) -> std::path::PathBuf {
    let root = user_root
        .map(|p| p.to_path_buf())
        .unwrap_or_else(super::config::home_dir_fallback);
    root.join(".sacode").join("identity").join("entitlement.json")
}

impl EntitlementTokenMeta {
    pub fn load(user_root: Option<&std::path::Path>) -> Result<Option<Self>> {
        let path = meta_path(user_root);
        if !path.exists() {
            return Ok(None);
        }
        let raw = std::fs::read_to_string(&path)
            .with_context(|| format!("read {}", path.display()))?;
        Ok(Some(serde_json::from_str(&raw)?))
    }

    pub fn save(&self, user_root: Option<&std::path::Path>) -> Result<()> {
        let path = meta_path(user_root);
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        std::fs::write(&path, serde_json::to_string_pretty(self)?)
            .with_context(|| format!("write {}", path.display()))?;
        Ok(())
    }

    pub fn clear(user_root: Option<&std::path::Path>) {
        let _ = std::fs::remove_file(meta_path(user_root));
    }
}

/// Persist entitlement tokens + meta. Never write secrets into meta JSON.
pub fn store_entitlement_tokens(
    store: &dyn SecretStore,
    user_root: Option<&std::path::Path>,
    config: &IdentityConfig,
    token: &TokenResponse,
) -> Result<()> {
    store
        .set(ENTITLEMENT_ACCESS_TOKEN_LOCATOR, &token.access_token)
        .context("store entitlement access_token")?;
    if let Some(refresh) = token.refresh_token.as_deref() {
        store
            .set(ENTITLEMENT_REFRESH_TOKEN_LOCATOR, refresh)
            .context("store entitlement refresh_token")?;
    }
    let expires_at = token.expires_in.map(|secs| {
        (chrono::Utc::now() + chrono::Duration::seconds(secs as i64)).to_rfc3339()
    });
    EntitlementTokenMeta {
        client_id: config.entitlement_client_id.clone(),
        access_token_expires_at: expires_at,
        scope: Some(ENTITLEMENT_SCOPE.into()),
    }
    .save(user_root)?;
    Ok(())
}

/// Build authorize URL for the entitlement OAuth client (PKCE).
pub fn entitlement_authorize_url(
    config: &IdentityConfig,
    redirect_uri: &str,
    state: &str,
    nonce: &str,
    challenge: &str,
) -> Result<String> {
    super::pkce::build_authorize_url(
        &config.authorize_endpoint(),
        &config.entitlement_client_id,
        redirect_uri,
        state,
        nonce,
        challenge,
        "openid profile offline_access entitlement:read",
    )
}

/// Exchange an authorization code obtained for `sacode-ent`.
pub async fn exchange_entitlement_code(
    config: &IdentityConfig,
    code: &str,
    redirect_uri: &str,
    code_verifier: &str,
) -> Result<TokenResponse> {
    let http = ReqwestOidcHttp::new();
    http.exchange_code(
        &config.token_endpoint(),
        &config.entitlement_client_id,
        code,
        redirect_uri,
        code_verifier,
    )
    .await
}

/// Refresh the entitlement access token using the stored refresh token.
pub async fn refresh_entitlement_token(
    config: &IdentityConfig,
    store: &dyn SecretStore,
    user_root: Option<&std::path::Path>,
) -> Result<TokenResponse> {
    let refresh = store
        .get(ENTITLEMENT_REFRESH_TOKEN_LOCATOR)
        .ok()
        .flatten()
        .context("no entitlement refresh_token")?;
    let http = ReqwestOidcHttp::new();
    let token = http
        .refresh(
            &config.token_endpoint(),
            &config.entitlement_client_id,
            &refresh,
        )
        .await
        .context("refresh entitlement token")?;
    store_entitlement_tokens(store, user_root, config, &token)?;
    Ok(token)
}

/// Return a usable access token, refreshing when missing/near expiry.
pub async fn ensure_entitlement_access_token(
    config: &IdentityConfig,
    store: &dyn SecretStore,
    user_root: Option<&std::path::Path>,
    min_ttl_secs: u64,
) -> Result<String> {
    if let Ok(Some(token)) = store.get(ENTITLEMENT_ACCESS_TOKEN_LOCATOR) {
        if !access_token_expires_soon(user_root, min_ttl_secs)? {
            return Ok(token);
        }
    }
    let token = refresh_entitlement_token(config, store, user_root).await?;
    Ok(token.access_token)
}

fn access_token_expires_soon(
    user_root: Option<&std::path::Path>,
    min_ttl_secs: u64,
) -> Result<bool> {
    let Some(meta) = EntitlementTokenMeta::load(user_root)? else {
        return Ok(true);
    };
    let Some(raw) = meta.access_token_expires_at else {
        return Ok(true);
    };
    let Ok(expires) = chrono::DateTime::parse_from_rfc3339(&raw) else {
        return Ok(true);
    };
    let remaining = expires.with_timezone(&chrono::Utc) - chrono::Utc::now();
    Ok(remaining.num_seconds() < min_ttl_secs as i64)
}

/// Clear entitlement credentials (logout).
pub fn clear_entitlement_tokens(store: &dyn SecretStore, user_root: Option<&std::path::Path>) {
    let _ = store.delete(ENTITLEMENT_ACCESS_TOKEN_LOCATOR);
    let _ = store.delete(ENTITLEMENT_REFRESH_TOKEN_LOCATOR);
    EntitlementTokenMeta::clear(user_root);
}

/// Pkce challenge re-export helper for second-browser login.
pub fn generate_entitlement_pkce() -> (String, String) {
    let pkce = generate_pkce();
    (pkce.challenge, pkce.verifier)
}

/// Interactive PKCE login for the entitlement OAuth client (`sacode-ent`).
/// Reuses the IdP browser session when present (silent redirect after first login).
pub async fn login_entitlement_interactive(
    config: &IdentityConfig,
    store: &dyn SecretStore,
    user_root: Option<&std::path::Path>,
    open_browser: bool,
    callback_timeout: std::time::Duration,
) -> Result<TokenResponse> {
    let params = super::pkce::generate_browser_params();
    let callback = super::callback::start_callback_server(config.redirect_uri.as_deref())?;
    let redirect_uri = callback.redirect_uri.clone();
    let authorize_url = entitlement_authorize_url(
        config,
        &redirect_uri,
        &params.state,
        &params.nonce,
        &params.pkce.challenge,
    )?;
    let login_url = super::pkce::build_interactive_login_url(&config.idp_base_url, &authorize_url)?;
    if open_browser {
        super::callback::open_or_print_authorize_url(&login_url);
    } else {
        println!("Entitlement sign-in URL:\n{login_url}");
    }
    let callback_url = callback.wait_for_callback(callback_timeout)?;
    let (code, state) = super::oidc::split_auth_code(&callback_url)?;
    if state != params.state {
        anyhow::bail!("OAuth state mismatch for entitlement login");
    }
    let token =
        exchange_entitlement_code(config, &code, &redirect_uri, &params.pkce.verifier).await?;
    store_entitlement_tokens(store, user_root, config, &token)?;
    Ok(token)
}

/// Scope used when requesting entitlement tokens（含 offline_access 以便 refresh）。
pub const ENTITLEMENT_SCOPE: &str = "openid profile offline_access entitlement:read";

#[cfg(test)]
mod tests {
    use super::*;
    use crate::identity::secret_store::MemorySecretStore;

    fn temp_config() -> IdentityConfig {
        IdentityConfig {
            idp_base_url: "http://127.0.0.1:8080".into(),
            gateway_base_url: "http://127.0.0.1:8090".into(),
            entitlement_base_url: "http://127.0.0.1:8091".into(),
            entitlement_client_id: "sacode-ent".into(),
            ..Default::default()
        }
    }

    #[test]
    fn store_tokens_puts_secrets_in_store_not_meta() {
        let tmp = tempfile::tempdir().unwrap();
        let store = MemorySecretStore::new();
        let cfg = temp_config();
        let token = TokenResponse {
            access_token: "ent-access".into(),
            token_type: "Bearer".into(),
            expires_in: Some(3600),
            refresh_token: Some("ent-refresh".into()),
            id_token: None,
        };
        store_entitlement_tokens(&store, Some(tmp.path()), &cfg, &token).unwrap();
        assert_eq!(
            store.get(ENTITLEMENT_ACCESS_TOKEN_LOCATOR).unwrap().unwrap(),
            "ent-access"
        );
        assert_eq!(
            store.get(ENTITLEMENT_REFRESH_TOKEN_LOCATOR).unwrap().unwrap(),
            "ent-refresh"
        );
        let meta_raw = std::fs::read_to_string(
            tmp.path().join(".sacode").join("identity").join("entitlement.json"),
        )
        .unwrap();
        assert!(!meta_raw.contains("ent-access"));
        assert!(!meta_raw.contains("ent-refresh"));
        let meta = EntitlementTokenMeta::load(Some(tmp.path())).unwrap().unwrap();
        assert_eq!(meta.client_id, "sacode-ent");
    }

    #[test]
    fn clear_removes_secrets_and_meta() {
        let tmp = tempfile::tempdir().unwrap();
        let store = MemorySecretStore::new();
        let cfg = temp_config();
        let token = TokenResponse {
            access_token: "a".into(),
            token_type: "Bearer".into(),
            expires_in: Some(60),
            refresh_token: Some("r".into()),
            id_token: None,
        };
        store_entitlement_tokens(&store, Some(tmp.path()), &cfg, &token).unwrap();
        clear_entitlement_tokens(&store, Some(tmp.path()));
        assert!(store.get(ENTITLEMENT_ACCESS_TOKEN_LOCATOR).unwrap().is_none());
        assert!(EntitlementTokenMeta::load(Some(tmp.path())).unwrap().is_none());
    }

    #[test]
    fn expires_soon_when_meta_missing_or_past() {
        let tmp = tempfile::tempdir().unwrap();
        assert!(access_token_expires_soon(Some(tmp.path()), 60).unwrap());
        let cfg = temp_config();
        let store = MemorySecretStore::new();
        let token = TokenResponse {
            access_token: "a".into(),
            token_type: "Bearer".into(),
            expires_in: Some(1),
            refresh_token: Some("r".into()),
            id_token: None,
        };
        store_entitlement_tokens(&store, Some(tmp.path()), &cfg, &token).unwrap();
        // 1s TTL with 60s min → soon
        assert!(access_token_expires_soon(Some(tmp.path()), 60).unwrap());
        // large min_ttl still soon
        assert!(access_token_expires_soon(Some(tmp.path()), 10_000).unwrap());
    }
}
