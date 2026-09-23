//! saai unified identity client (I3): sa-idp OIDC + gateway api_key exchange.
//!
//! Design truth: saai/docs/identity/unified-identity.md + sa-idp. Secrets never land in
//! provider.json; key material is stored via SecretStore (OS keyring in prod).

pub mod callback;
pub mod config;
pub mod gateway;
pub mod headless;
pub mod oidc;
pub mod pkce;
pub mod provider_bridge;
pub mod secret_store;
pub mod service;
pub mod session;

pub use config::IdentityConfig;
pub use headless::{
    apply_gateway_api_key, headless_login_instructions, login_device_flow,
    login_device_flow_with_prompt, login_headless_wait, login_with_paste_callback,
    prepare_headless_login, store_secret_with_fallback, DeviceAuthPrompt, PendingLogin,
};
pub use secret_store::{resolve_secret_ref, MemorySecretStore, OsKeyringSecretStore, SecretStore};
pub use service::{
    access_token_expires_soon, complete_login_with_dyn_clients, ensure_fresh_session, login,
    login_with_dyn_clients, logout, select_secret_store, status_summary, sync_models,
    write_provider_entry_public, GatewayHttpDyn, LoginOptions, LoginOutcome, OidcHttpDyn,
    SessionFreshness, TypedClients,
};
pub use session::{IdentitySession, ProviderWriteResult, SessionStatus};

/// Secret locator for the gateway data-plane api_key.
pub const GATEWAY_API_KEY_LOCATOR: &str = "os-keyring:sacode/identity/gateway-api-key";
/// Secret locator for the opaque refresh token.
pub const REFRESH_TOKEN_LOCATOR: &str = "os-keyring:sacode/identity/refresh-token";
/// Default OAuth client_id registered in sa-idp `oauth_clients`.
pub const DEFAULT_CLIENT_ID: &str = "sacode";
/// Default provider name written into `.sacode/provider.json`.
pub const DEFAULT_PROVIDER_NAME: &str = "sa-ai";
/// Product-facing alias for the gateway-backed identity provider entry.
pub const GATEWAY_PROVIDER_ALIAS: &str = "sa-gateway";

pub fn is_identity_provider_name(name: &str) -> bool {
    let name = name.trim();
    name == DEFAULT_PROVIDER_NAME || name == GATEWAY_PROVIDER_ALIAS
}

pub fn provider_api_key_locator(provider_name: &str) -> String {
    format!("os-keyring:sacode/providers/{}", provider_name.trim())
}

pub fn store_api_key_secret(
    locator: &str,
    api_key: &str,
    insecure_file_secrets: bool,
    user_root: Option<&std::path::Path>,
) -> anyhow::Result<sacode_kernel::model::SecretRef> {
    let key = api_key.trim();
    if key.is_empty() {
        anyhow::bail!("api key is empty");
    }
    let store = select_secret_store(insecure_file_secrets, user_root);
    store.set(locator, key)?;
    let mut secret_ref = sacode_kernel::model::SecretRef::os_keyring(locator);
    secret_ref.masked = sacode_kernel::model::SecretRef::mask_secret(key);
    Ok(secret_ref)
}
/// Gateway contract: exchange access_token for a data-plane api_key.
/// 真源：gateway-rs `POST /api/auth/exchange`（docs/clients/status-2026-09-20.md）
pub const GATEWAY_KEY_EXCHANGE_PATH: &str = "/api/auth/exchange";
/// OpenAI-compatible model discovery path on the gateway.
pub const GATEWAY_MODELS_PATH: &str = "/v1/models";
/// sa-idp OIDC 路径前缀（与 sa-idp routes.rs 一致，非 oauth2/）。
pub const IDP_AUTHORIZE_PATH: &str = "/oauth/authorize";
pub const IDP_TOKEN_PATH: &str = "/oauth/token";
pub const IDP_REVOKE_PATH: &str = "/oauth/revoke";
