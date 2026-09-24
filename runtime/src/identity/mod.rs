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
pub use gateway::{
    GatewayKeyResponse, ModelConnectionItem, ModelConnectionRequest, ModelConnectionResponse,
    ModelsListResponse, ReqwestGatewayHttp,
};
pub use headless::{
    apply_gateway_api_key, headless_login_instructions, login_device_flow,
    login_device_flow_with_prompt, login_headless_wait, login_with_paste_callback,
    prepare_headless_login, store_secret_with_fallback, DeviceAuthPrompt, PendingLogin,
};
pub use secret_store::{resolve_secret_ref, MemorySecretStore, OsKeyringSecretStore, SecretStore};
pub use service::{
    access_token_expires_soon, complete_login_with_dyn_clients, ensure_fresh_session, login,
    login_with_dyn_clients, logout, register_model_connection, select_secret_store, status_summary,
    store_api_key_secret, sync_models, write_provider_entry_public, GatewayHttpDyn, LoginOptions,
    LoginOutcome, OidcHttpDyn, SessionFreshness, TypedClients,
};
pub use session::{IdentitySession, ProviderWriteResult, SessionStatus};

/// Secret locator for the gateway data-plane api_key.
pub const GATEWAY_API_KEY_LOCATOR: &str = "os-keyring:sacode/identity/gateway-api-key";
/// Secret locator for the opaque refresh token.
pub const REFRESH_TOKEN_LOCATOR: &str = "os-keyring:sacode/identity/refresh-token";
/// Per-provider API key locator (custom `/connect` providers). Product line: never plaintext in provider.json.
pub fn provider_api_key_locator(provider_name: &str) -> String {
    format!("os-keyring:sacode/providers/{}", provider_name.trim())
}
/// Default OAuth client_id registered in sa-idp `oauth_clients`.
pub const DEFAULT_CLIENT_ID: &str = "sacode";
/// Default provider name written into `.sacode/provider.json`.
/// Models are discovered from SaAiApiGateway `GET /v1/models`.
/// `sa-gateway` is accepted as a product alias for the same entry.
pub const DEFAULT_PROVIDER_NAME: &str = "sa-ai";
/// Product-facing alias for the gateway-backed identity provider entry.
pub const GATEWAY_PROVIDER_ALIAS: &str = "sa-gateway";

/// True when `name` is an sa-idp/gateway identity provider entry.
pub fn is_identity_provider_name(name: &str) -> bool {
    let n = name.trim();
    n == DEFAULT_PROVIDER_NAME || n == GATEWAY_PROVIDER_ALIAS
}
/// Local/dev sa-idp base URL (must match JWT `iss` / smoke scripts).
pub const DEFAULT_IDP_BASE_URL: &str = "http://127.0.0.1:8080";
/// Local/dev SaAiApiGateway base URL.
pub const DEFAULT_GATEWAY_BASE_URL: &str = "http://127.0.0.1:8090";
/// Gateway contract: exchange access_token for a data-plane api_key.
/// 真源：gateway-rs `POST /api/auth/exchange`（docs/clients/status-2026-09-20.md）
pub const GATEWAY_KEY_EXCHANGE_PATH: &str = "/api/auth/exchange";
/// OpenAI-compatible model discovery path on the gateway.
pub const GATEWAY_MODELS_PATH: &str = "/v1/models";
/// User-owned BYOK model-connection registration (writes gateway providers/channels/routes).
pub const GATEWAY_MODEL_CONNECTIONS_PATH: &str = "/api/user/model-connections";
/// sa-idp OIDC 路径前缀（与 sa-idp routes.rs 一致，非 oauth2/）。
pub const IDP_AUTHORIZE_PATH: &str = "/oauth/authorize";
pub const IDP_TOKEN_PATH: &str = "/oauth/token";
pub const IDP_REVOKE_PATH: &str = "/oauth/revoke";

#[cfg(test)]
mod tests {
    #[test]
    fn identity_provider_names_accept_gateway_alias() {
        assert!(super::is_identity_provider_name("sa-ai"));
        assert!(super::is_identity_provider_name("sa-gateway"));
        assert!(!super::is_identity_provider_name("openai"));
    }
}
