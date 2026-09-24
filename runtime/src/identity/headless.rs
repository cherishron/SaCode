//! Headless / cloud Linux login paths for saai identity.
//!
//! Supported:
//! 1. `login --headless` — print authorize URL + SSH tunnel + paste-callback instructions;
//!    persist PKCE pending state (0600) so a later `--paste-callback` can finish the exchange.
//! 2. `login --paste-callback <url>` — complete OAuth when the browser callback is copied
//!    from the laptop address bar (or arrives via SSH port forward).
//! 3. `login --device` — RFC 8628 device grant when sa-idp exposes device endpoints.
//! 4. `account set-api-key` — non-OIDC provisioning for CI/cloud (key still goes to SecretStore).

use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

use anyhow::{anyhow, bail, Context, Result};
use serde::{Deserialize, Serialize};

use super::config::IdentityConfig;
use super::gateway::GatewayHttp as _;
use super::oidc::{split_auth_code, OidcHttp as _, TokenResponse};
use super::pkce::{build_authorize_url, generate_browser_params, DEFAULT_SCOPE};
use super::secret_store::SecretStore;
use super::service::{
    complete_login_with_dyn_clients, FileSecretStore, LoginOptions, LoginOutcome,
};
use super::{IDP_AUTHORIZE_PATH, IDP_TOKEN_PATH};

/// Pending PKCE material for headless login. Contains verifier — treat as sensitive.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PendingLogin {
    pub schema_version: u32,
    pub created_at: String,
    pub idp_base_url: String,
    pub gateway_base_url: String,
    pub client_id: String,
    pub provider_name: String,
    pub redirect_uri: String,
    pub state: String,
    pub nonce: String,
    pub code_verifier: String,
    pub authorize_url: String,
}

pub fn pending_login_path(user_root: Option<&Path>) -> PathBuf {
    let root = user_root
        .map(|p| p.to_path_buf())
        .unwrap_or_else(super::config::home_dir_fallback);
    root.join(".sacode")
        .join("identity")
        .join("pending-login.json")
}

fn write_private(path: &Path, contents: &str) -> Result<()> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    std::fs::write(path, contents)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600));
    }
    Ok(())
}

impl PendingLogin {
    pub fn save(&self, user_root: Option<&Path>) -> Result<PathBuf> {
        let path = pending_login_path(user_root);
        write_private(&path, &serde_json::to_string_pretty(self)?)?;
        Ok(path)
    }

    pub fn load(user_root: Option<&Path>) -> Result<Self> {
        let path = pending_login_path(user_root);
        let raw = std::fs::read_to_string(&path)
            .with_context(|| format!("pending login not found: {}", path.display()))?;
        let pending: Self = serde_json::from_str(&raw).context("parse pending-login.json")?;
        if pending.schema_version != 1 {
            bail!(
                "unsupported pending-login schema_version {}",
                pending.schema_version
            );
        }
        Ok(pending)
    }

    pub fn clear(user_root: Option<&Path>) {
        let _ = std::fs::remove_file(pending_login_path(user_root));
    }

    pub fn to_config(&self) -> IdentityConfig {
        IdentityConfig {
            idp_base_url: self.idp_base_url.clone(),
            gateway_base_url: self.gateway_base_url.clone(),
            client_id: self.client_id.clone(),
            redirect_uri: Some(self.redirect_uri.clone()),
            provider_name: self.provider_name.clone(),
        }
    }
}

/// Human instructions printed for cloud/headless operators.
pub fn headless_login_instructions(authorize_url: &str, redirect_uri: &str) -> String {
    let port = redirect_uri
        .rsplit_once(':')
        .and_then(|(_, rest)| rest.split('/').next())
        .unwrap_or("");
    format!(
        "=== Headless / Linux cloud login ===\n\
         \n\
         This machine has no browser. Complete login from your laptop:\n\
         \n\
         A) SSH port-forward (recommended, callback reaches this server automatically)\n\
            1. On your laptop:  ssh -L {port}:127.0.0.1:{port} <user>@<this-server>\n\
            2. Keep this command running on the server.\n\
            3. Open the authorize URL in the laptop browser (same SSH session forwards 127.0.0.1:{port}).\n\
            4. After IdP login, callback hits this server → login completes here.\n\
         \n\
         B) Paste callback URL (no tunnel)\n\
            1. Open the authorize URL in any browser that can reach sa-idp.\n\
            2. After login the browser may show \"connection refused\" — that is expected\n\
               (redirect targets 127.0.0.1 on YOUR laptop).\n\
            3. Copy the FULL address-bar URL starting with {redirect_uri}?code=\n\
            4. On this server run:\n\
               sacode account login --paste-callback '<full-callback-url>'\n\
         \n\
         C) CI / provisioned key (no browser at all)\n\
            sacode account set-api-key <sa-...>\n\
            (admin or console-issued gateway key; stored in SecretStore, not in git)\n\
         \n\
         Authorize URL:\n\
         {authorize_url}\n"
    )
}

/// Build authorize URL + persist pending PKCE for later paste-callback.
pub fn prepare_headless_login(
    config: &IdentityConfig,
    user_root: Option<&Path>,
) -> Result<(PendingLogin, String)> {
    let mut config = config.clone();
    config.normalize();
    if config.idp_base_url.is_empty() {
        bail!("identity idp_base_url is empty; set SACODE_IDP_BASE_URL or --idp");
    }
    // Bind callback server first so redirect_uri port is real.
    let callback = super::callback::start_callback_server(config.redirect_uri.as_deref())?;
    let redirect_uri = callback.redirect_uri.clone();
    // Drop the listener — paste-callback does not need it; tunnel path rebinds later.
    drop(callback);

    let params = generate_browser_params();
    let authorize_url = build_authorize_url(
        &format!(
            "{}{}",
            config.idp_base_url.trim_end_matches('/'),
            IDP_AUTHORIZE_PATH
        ),
        &config.client_id,
        &redirect_uri,
        &params.state,
        &params.nonce,
        &params.pkce.challenge,
        DEFAULT_SCOPE,
    )?;
    let pending = PendingLogin {
        schema_version: 1,
        created_at: chrono::Utc::now().to_rfc3339(),
        idp_base_url: config.idp_base_url.clone(),
        gateway_base_url: config.gateway_base_url.clone(),
        client_id: config.client_id.clone(),
        provider_name: config.provider_name.clone(),
        redirect_uri: redirect_uri.clone(),
        state: params.state,
        nonce: params.nonce,
        code_verifier: params.pkce.verifier,
        authorize_url: authorize_url.clone(),
    };
    pending.save(user_root)?;
    Ok((pending, authorize_url))
}

/// Finish login using a callback URL pasted by the operator.
pub async fn login_with_paste_callback(
    callback_url: &str,
    opts: LoginOptions,
    secret_store: &dyn SecretStore,
) -> Result<LoginOutcome> {
    let pending = PendingLogin::load(opts.user_root.as_deref())?;
    let (code, state) = split_auth_code(callback_url)?;
    if state != pending.state {
        bail!(
            "OAuth state mismatch (callback state != pending-login.json). \
             Re-run `sacode account login --headless` and paste the NEW authorize URL callback."
        );
    }
    let config = pending.to_config();
    let token_endpoint = format!(
        "{}{}",
        config.idp_base_url.trim_end_matches('/'),
        IDP_TOKEN_PATH
    );
    let client = super::oidc::ReqwestOidcHttp::new();
    let token = client
        .exchange_code(
            &token_endpoint,
            &pending.client_id,
            &code,
            &pending.redirect_uri,
            &pending.code_verifier,
        )
        .await
        .context("authorization_code exchange failed (check sa-idp /oauth/token and PKCE)")?;
    let outcome =
        complete_login_with_dyn_clients(&config, opts.clone(), secret_store, token, None).await?;
    PendingLogin::clear(opts.user_root.as_deref());
    Ok(outcome)
}

/// Wait on the local callback server after headless prepare (SSH tunnel path).
pub async fn login_headless_wait(
    config: &IdentityConfig,
    opts: LoginOptions,
    secret_store: &dyn SecretStore,
) -> Result<LoginOutcome> {
    let (pending, authorize_url) = prepare_headless_login(config, opts.user_root.as_deref())?;
    let instructions = headless_login_instructions(&authorize_url, &pending.redirect_uri);
    println!("{instructions}");
    println!(
        "Waiting up to {}s for callback (or Ctrl+C then use --paste-callback)...",
        opts.callback_timeout.as_secs()
    );

    // Rebind the same redirect port if possible.
    let callback = super::callback::start_callback_server(Some(&pending.redirect_uri))
        .or_else(|_| super::callback::start_callback_server(None))?;
    let callback_url = callback.wait_for_callback(opts.callback_timeout)?;
    let result = login_with_paste_callback(&callback_url, opts, secret_store).await;
    if result.is_ok() {
        PendingLogin::clear(None);
    }
    result
}

// --- RFC 8628 Device Authorization Grant (client) ---

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DeviceCodeResponse {
    pub device_code: String,
    pub user_code: String,
    pub verification_uri: String,
    #[serde(default)]
    pub verification_uri_complete: Option<String>,
    pub expires_in: u64,
    #[serde(default)]
    pub interval: Option<u64>,
}

const DEVICE_GRANT_TYPE: &str = "urn:ietf:params:oauth:grant-type:device_code";
/// Prefer discovery/canonical RFC 8628 path first (sa-idp: `/oauth/device_authorization`).
const DEVICE_CODE_PATHS: &[&str] = &[
    "/oauth/device_authorization",
    "/oauth/device/code",
    "/oauth/device/authorize",
];

pub async fn request_device_code(
    idp_base_url: &str,
    client_id: &str,
) -> Result<DeviceCodeResponse> {
    let client = reqwest::Client::new();
    let base = idp_base_url.trim_end_matches('/').to_string();
    let mut last_err = None;
    for path in DEVICE_CODE_PATHS {
        let url = format!("{base}{path}");
        match client
            .post(&url)
            .form(&[("client_id", client_id), ("scope", DEFAULT_SCOPE)])
            .timeout(Duration::from_secs(15))
            .send()
            .await
        {
            Ok(resp) if resp.status().is_success() => {
                return resp
                    .json::<DeviceCodeResponse>()
                    .await
                    .context("parse device code response");
            }
            Ok(resp) if resp.status() == reqwest::StatusCode::NOT_FOUND => {
                last_err = Some(anyhow!("404 at {url}"));
                continue;
            }
            Ok(resp) => {
                let status = resp.status();
                let body = resp.text().await.unwrap_or_default();
                last_err = Some(anyhow!("device code HTTP {status}: {body}"));
            }
            Err(e) => {
                last_err = Some(anyhow!("device code request failed: {e}"));
            }
        }
    }
    Err(last_err.unwrap_or_else(|| {
        anyhow!(
            "sa-idp does not expose device authorization yet (tried {DEVICE_CODE_PATHS:?}). \
             Use `sacode account login --headless` + paste-callback, SSH tunnel, or \
             `sacode account set-api-key` for cloud hosts."
        )
    }))
}

pub async fn poll_device_token(
    idp_base_url: &str,
    client_id: &str,
    device_code: &str,
    expires_in: u64,
    interval_secs: u64,
) -> Result<TokenResponse> {
    let token_url = format!("{}{}", idp_base_url.trim_end_matches('/'), IDP_TOKEN_PATH);
    let client = reqwest::Client::new();
    let interval = interval_secs.max(3);
    let deadline = Instant::now() + Duration::from_secs(expires_in.max(30));
    while Instant::now() < deadline {
        let resp = client
            .post(&token_url)
            .form(&[
                ("grant_type", DEVICE_GRANT_TYPE),
                ("device_code", device_code),
                ("client_id", client_id),
            ])
            .timeout(Duration::from_secs(20))
            .send()
            .await
            .context("device token poll request failed")?;
        if resp.status().is_success() {
            return resp
                .json::<TokenResponse>()
                .await
                .context("parse device token");
        }
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        // RFC 8628: authorization_pending / slow_down
        if body.contains("authorization_pending") || body.contains("slow_down") {
            tokio::time::sleep(Duration::from_secs(interval)).await;
            continue;
        }
        if body.contains("expired_token") || body.contains("access_denied") {
            bail!("device authorization failed: {body}");
        }
        // Unknown IdP error — surface once
        if status == reqwest::StatusCode::NOT_FOUND {
            bail!("token endpoint rejected device_code grant (404). sa-idp may not support RFC 8628 yet.");
        }
        bail!("device token poll HTTP {status}: {body}");
    }
    bail!("device code expired before authorization completed")
}

/// Device authorization prompt (RFC 8628) shown while waiting for phone confirm.
#[derive(Debug, Clone)]
pub struct DeviceAuthPrompt {
    pub verification_uri: String,
    pub verification_uri_complete: Option<String>,
    pub user_code: String,
    pub expires_in: u64,
}

impl DeviceAuthPrompt {
    pub fn primary_uri(&self) -> String {
        self.verification_uri_complete
            .clone()
            .unwrap_or_else(|| self.verification_uri.clone())
    }
}

/// Full device-login orchestration.
pub async fn login_device_flow(
    config: &IdentityConfig,
    opts: LoginOptions,
    secret_store: &dyn SecretStore,
) -> Result<LoginOutcome> {
    login_device_flow_with_prompt(config, opts, secret_store, |prompt| {
        println!("Device login — open the following on any device and enter the code:\n");
        if let Some(complete) = prompt.verification_uri_complete.as_deref() {
            println!("  {complete}");
        } else {
            println!("  {}", prompt.verification_uri);
            println!("  code: {}", prompt.user_code);
        }
        println!("\nExpires in {}s. Waiting...", prompt.expires_in);
    })
    .await
}

/// Device login with a side-channel prompt (TUI can surface the URL/code without stdout).
pub async fn login_device_flow_with_prompt(
    config: &IdentityConfig,
    opts: LoginOptions,
    secret_store: &dyn SecretStore,
    on_prompt: impl FnOnce(DeviceAuthPrompt),
) -> Result<LoginOutcome> {
    let mut config = config.clone();
    config.normalize();
    if config.idp_base_url.is_empty() {
        bail!("identity idp_base_url is empty; set SACODE_IDP_BASE_URL or --idp");
    }
    let device = request_device_code(&config.idp_base_url, &config.client_id).await?;
    let prompt = DeviceAuthPrompt {
        verification_uri: device.verification_uri.clone(),
        verification_uri_complete: device.verification_uri_complete.clone(),
        user_code: device.user_code.clone(),
        expires_in: device.expires_in,
    };
    on_prompt(prompt);
    let token = poll_device_token(
        &config.idp_base_url,
        &config.client_id,
        &device.device_code,
        device.expires_in,
        device.interval.unwrap_or(5),
    )
    .await?;
    complete_login_with_dyn_clients(&config, opts, secret_store, token, None).await
}

/// Non-interactive cloud login: store a pre-issued gateway api_key.
pub fn apply_gateway_api_key(
    api_key: &str,
    config: &IdentityConfig,
    opts: &LoginOptions,
    secret_store: &dyn SecretStore,
) -> Result<LoginOutcome> {
    let key = api_key.trim();
    if key.is_empty() {
        bail!("api key is empty");
    }
    if !key.starts_with("sa-") && !key.starts_with("sk-") {
        eprintln!("warning: gateway keys usually start with sa-; storing anyway");
    }
    let mut config = config.clone();
    config.normalize();
    if config.gateway_base_url.is_empty() {
        bail!("gateway_base_url is empty; set SACODE_GATEWAY_BASE_URL or --gateway");
    }

    store_secret_with_fallback(secret_store, opts.user_root.as_deref(), Some(key), None)?;

    let models = fetch_models_best_effort(&config, key);
    let default_model = super::gateway::pick_default_model(&models.0);
    let mut session = super::session::IdentitySession {
        schema_version: 1,
        subject: None,
        idp_base_url: config.idp_base_url.clone(),
        gateway_base_url: config.gateway_base_url.clone(),
        client_id: config.client_id.clone(),
        provider_name: config.provider_name.clone(),
        models: models.0.clone(),
        default_model: default_model.clone().unwrap_or_default(),
        logged_in_at: Some(chrono::Utc::now().to_rfc3339()),
        ..Default::default()
    };
    // Key ref only — no refresh token for provisioned keys.
    session.set_key_refs(key, "");
    session.save(opts.user_root.as_deref())?;
    super::service::write_provider_entry_public(&opts.workdir, &config, key, &default_model)?;

    Ok(LoginOutcome {
        session,
        provider_name: config.provider_name.clone(),
        models: models.0,
        default_model,
        dry_run: false,
        models_error: models.1,
    })
}

fn fetch_models_best_effort(
    config: &IdentityConfig,
    api_key: &str,
) -> (Vec<String>, Option<String>) {
    let models_url = config.gateway_models_url();
    let rt = tokio::runtime::Handle::try_current().ok();
    let fut = async {
        super::gateway::ReqwestGatewayHttp::new()
            .list_models(&models_url, api_key)
            .await
    };
    match rt {
        Some(_) => {
            // We are already in async context when called from login_device; use block_in_place if available.
            match tokio::task::block_in_place(|| tokio::runtime::Handle::current().block_on(fut)) {
                Ok(m) => (m, None),
                Err(e) => (Vec::new(), Some(e.to_string())),
            }
        }
        None => {
            let runtime = tokio::runtime::Builder::new_current_thread()
                .enable_all()
                .build();
            match runtime {
                Ok(r) => match r.block_on(fut) {
                    Ok(m) => (m, None),
                    Err(e) => (Vec::new(), Some(e.to_string())),
                },
                Err(e) => (Vec::new(), Some(e.to_string())),
            }
        }
    }
}

/// Store secrets preferring the provided store; fall back to 0600 file store on keyring errors.
/// `api_key` / `refresh` — pass None to skip updating that slot (e.g. refresh rotation only).
pub fn store_secret_with_fallback(
    store: &dyn SecretStore,
    user_root: Option<&Path>,
    api_key: Option<&str>,
    refresh: Option<&str>,
) -> Result<&'static str> {
    let try_store = |s: &dyn SecretStore| -> Result<()> {
        if let Some(k) = api_key {
            if !k.is_empty() {
                s.set(super::GATEWAY_API_KEY_LOCATOR, k)?;
            }
        }
        if let Some(r) = refresh {
            if !r.is_empty() {
                s.set(super::REFRESH_TOKEN_LOCATOR, r)?;
            }
        }
        if api_key.is_none() && refresh.is_none() {
            bail!("nothing to store");
        }
        Ok(())
    };
    if try_store(store).is_ok() {
        return Ok("secret-store");
    }
    let file = FileSecretStore::new(user_root);
    try_store(&file)?;
    eprintln!(
        "warn: primary secret store failed (headless Linux often has no OS keyring / Secret Service).\n\
         Secrets written to: ~/.sacode/identity/secrets.local.json (0600).\n\
         Ensure $HOME is private to the service user; never commit this file; prefer systemd credentials \
         or env SACODE_IDENTITY_SECRET_* in hardened deployments."
    );
    Ok("file")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::identity::secret_store::MemorySecretStore;

    #[test]
    fn headless_instructions_mention_paste_and_set_api_key() {
        let text = headless_login_instructions(
            "https://idp.example/oauth/authorize?x=1",
            "http://127.0.0.1:38472/callback",
        );
        assert!(text.contains("ssh -L 38472"));
        assert!(text.contains("--paste-callback"));
        assert!(text.contains("set-api-key"));
        assert!(text.contains("oauth/authorize"));
    }

    #[test]
    fn device_auth_prompt_prefers_complete_uri() {
        let prompt = DeviceAuthPrompt {
            verification_uri: "http://127.0.0.1:8080/device".into(),
            verification_uri_complete: Some("http://127.0.0.1:8080/device?code=ABCD".into()),
            user_code: "ABCD-1234".into(),
            expires_in: 300,
        };
        assert_eq!(
            prompt.primary_uri(),
            "http://127.0.0.1:8080/device?code=ABCD"
        );
        let bare = DeviceAuthPrompt {
            verification_uri: "http://127.0.0.1:8080/device".into(),
            verification_uri_complete: None,
            user_code: "ABCD-1234".into(),
            expires_in: 300,
        };
        assert_eq!(bare.primary_uri(), "http://127.0.0.1:8080/device");
    }

    #[test]
    fn pending_login_roundtrip_and_clear() {
        let tmp = tempfile::tempdir().unwrap();
        let pending = PendingLogin {
            schema_version: 1,
            created_at: "t".into(),
            idp_base_url: "http://127.0.0.1:8080".into(),
            gateway_base_url: "http://127.0.0.1:8090".into(),
            client_id: "sacode".into(),
            provider_name: "sa-ai".into(),
            redirect_uri: "http://127.0.0.1:1/callback".into(),
            state: "st".into(),
            nonce: "n".into(),
            code_verifier: "v".into(),
            authorize_url: "https://idp/oauth/authorize".into(),
        };
        let path = pending.save(Some(tmp.path())).unwrap();
        assert!(path.exists());
        let loaded = PendingLogin::load(Some(tmp.path())).unwrap();
        assert_eq!(loaded.state, "st");
        assert_eq!(loaded.code_verifier, "v");
        let cfg = loaded.to_config();
        assert_eq!(cfg.client_id, "sacode");
        PendingLogin::clear(Some(tmp.path()));
        assert!(PendingLogin::load(Some(tmp.path())).is_err());
    }

    #[test]
    fn paste_callback_rejects_state_mismatch() {
        let tmp = tempfile::tempdir().unwrap();
        let pending = PendingLogin {
            schema_version: 1,
            created_at: "t".into(),
            idp_base_url: "http://127.0.0.1:8080".into(),
            gateway_base_url: "http://127.0.0.1:8090".into(),
            client_id: "sacode".into(),
            provider_name: "sa-ai".into(),
            redirect_uri: "http://127.0.0.1:1/callback".into(),
            state: "expected".into(),
            nonce: "n".into(),
            code_verifier: "v".into(),
            authorize_url: "u".into(),
        };
        pending.save(Some(tmp.path())).unwrap();
        let store = MemorySecretStore::new();
        let opts = LoginOptions {
            workdir: tmp.path().to_path_buf(),
            user_root: Some(tmp.path().to_path_buf()),
            open_browser: false,
            ..Default::default()
        };
        let rt = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap();
        let err = rt
            .block_on(login_with_paste_callback(
                "http://127.0.0.1:1/callback?code=abc&state=WRONG",
                opts,
                &store,
            ))
            .unwrap_err();
        assert!(err.to_string().contains("state mismatch"));
    }

    #[test]
    fn set_api_key_stores_secret_and_session() {
        let tmp = tempfile::tempdir().unwrap();
        let config = IdentityConfig {
            idp_base_url: String::new(),
            gateway_base_url: "http://127.0.0.1:59999".into(),
            client_id: "sacode".into(),
            redirect_uri: None,
            provider_name: "sa-ai".into(),
        };
        let store = MemorySecretStore::new();
        let opts = LoginOptions {
            workdir: tmp.path().to_path_buf(),
            user_root: Some(tmp.path().to_path_buf()),
            open_browser: false,
            ..Default::default()
        };
        let outcome = apply_gateway_api_key("sa-cloud-key-001", &config, &opts, &store).unwrap();
        assert_eq!(outcome.provider_name, "sa-ai");
        let got = store.get(super::super::GATEWAY_API_KEY_LOCATOR).unwrap();
        assert_eq!(got.as_deref(), Some("sa-cloud-key-001"));
        assert!(
            tmp.path().join(".sacode/identity/session.json").exists() || {
                // session may write under user_root
                tmp.path().join(".sacode").join("identity").exists()
            }
        );
    }

    #[test]
    fn store_fallback_writes_file_when_primary_fails() {
        struct Failing;
        impl SecretStore for Failing {
            fn get(&self, _: &str) -> Result<Option<String>> {
                Ok(None)
            }
            fn set(&self, _: &str, _: &str) -> Result<()> {
                Err(anyhow!("keyring unavailable"))
            }
            fn delete(&self, _: &str) -> Result<()> {
                Ok(())
            }
        }
        let tmp = tempfile::tempdir().unwrap();
        let backend = store_secret_with_fallback(
            &Failing,
            Some(tmp.path()),
            Some("sa-fallback-key"),
            Some("refresh-x"),
        )
        .unwrap();
        assert_eq!(backend, "file");
        let path = tmp.path().join(".sacode/identity/secrets.local.json");
        assert!(path.exists());
        let raw = std::fs::read_to_string(&path).unwrap();
        assert!(raw.contains("sa-fallback-key"));
        let file = FileSecretStore::new(Some(tmp.path()));
        assert_eq!(
            file.get(super::super::GATEWAY_API_KEY_LOCATOR)
                .unwrap()
                .as_deref(),
            Some("sa-fallback-key")
        );
    }
}
