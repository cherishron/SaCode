//! saai unified identity client (I3): sa-idp OIDC + gateway api_key exchange.
//!
//! Design truth: saai/docs/identity/unified-identity.md + sa-idp. Secrets never land in
//! provider.json; key material is stored via SecretStore (OS keyring in prod).

pub mod callback;
pub mod config;
pub mod gateway;
pub mod oidc;
pub mod pkce;
pub mod provider_bridge;
pub mod secret_store;
pub mod service;
pub mod session;

pub use config::IdentityConfig;
pub use secret_store::{resolve_secret_ref, MemorySecretStore, OsKeyringSecretStore, SecretStore};
pub use service::{
    complete_login_with_dyn_clients, login, login_with_dyn_clients, logout, select_secret_store,
    status_summary, sync_models, GatewayHttpDyn, LoginOptions, LoginOutcome, OidcHttpDyn,
    TypedClients,
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
/// Gateway contract: exchange access_token for a data-plane api_key.
/// 真源：gateway-rs `POST /api/auth/exchange`（docs/clients/status-2026-09-20.md）
pub const GATEWAY_KEY_EXCHANGE_PATH: &str = "/api/auth/exchange";
/// OpenAI-compatible model discovery path on the gateway.
pub const GATEWAY_MODELS_PATH: &str = "/v1/models";
/// sa-idp OIDC 路径前缀（与 sa-idp routes.rs 一致，非 oauth2/）。
pub const IDP_AUTHORIZE_PATH: &str = "/oauth/authorize";
pub const IDP_TOKEN_PATH: &str = "/oauth/token";
pub const IDP_REVOKE_PATH: &str = "/oauth/revoke";
