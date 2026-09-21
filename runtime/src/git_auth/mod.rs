//! Git platform OAuth / token authorization (Compose git-platform-oauth).
//!
//! Tokens live in OS keyring (or Memory/File stores). Git reads them via
//! `sacode git auth credential` (git credential.helper protocol).

pub mod credential;
pub mod gitee;
pub mod github;
pub mod store;

pub use credential::{
    credential_reply, emit_credential, host_for_git_host, parse_credential_request,
    resolve_credential, username_for_host, CredentialRequest,
};
pub use gitee::{parse_gitee_token_json, GiteeLoopbackConfig, GiteeOAuthClient};
pub use github::{
    parse_device_code_json, parse_token_poll_json, DeviceAuthSession, GitHubDeviceClient,
};
pub use store::{
    git_auth_status, identity_login_state, load_auth_meta, logout_host, meta_path, save_auth_meta,
    save_token, secret_store_for, token_for_host, AuthEntry, AuthHost, GitAuthMeta, GitAuthStatus,
    GITEE_TOKEN_LOCATOR, GITHUB_TOKEN_LOCATOR,
};

/// Client-side error with actionable message (never includes tokens).
#[derive(Debug, Clone)]
pub enum GitAuthError {
    Message(String),
    MissingClient(String),
    Flow(String),
}

impl std::fmt::Display for GitAuthError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Message(m) => f.write_str(m),
            Self::MissingClient(m) => write!(f, "missing client config: {m}"),
            Self::Flow(m) => write!(f, "oauth flow failed: {m}"),
        }
    }
}

impl std::error::Error for GitAuthError {}

impl GitAuthError {
    pub fn msg(s: impl Into<String>) -> Self {
        Self::Message(s.into())
    }
}

pub type GitAuthResult<T> = Result<T, GitAuthError>;
