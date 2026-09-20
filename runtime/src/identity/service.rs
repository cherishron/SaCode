use std::path::{Path, PathBuf};
use std::time::Duration;

use anyhow::{anyhow, Context, Result};
use chrono::Utc;
use sacode_kernel::model::SecretRef;

use super::callback::{open_or_print_authorize_url, start_callback_server};
use super::config::IdentityConfig;
use super::gateway::{pick_default_model, GatewayKeyResponse, ReqwestGatewayHttp};
use super::oidc::{split_auth_code, ReqwestOidcHttp, TokenResponse};
use super::pkce::{build_authorize_url, generate_browser_params, DEFAULT_SCOPE};
use super::secret_store::{resolve_secret_ref, OsKeyringSecretStore, SecretStore};
use super::session::{IdentitySession, SessionStatus};
use super::{DEFAULT_PROVIDER_NAME, GATEWAY_API_KEY_LOCATOR, REFRESH_TOKEN_LOCATOR};

#[derive(Debug, Clone)]
pub struct LoginOptions {
    pub workdir: PathBuf,
    pub user_root: Option<PathBuf>,
    pub dry_run: bool,
    pub open_browser: bool,
    pub callback_timeout: Duration,
    pub insecure_file_secrets: bool,
}

impl Default for LoginOptions {
    fn default() -> Self {
        Self {
            workdir: PathBuf::from("."),
            user_root: None,
            dry_run: false,
            open_browser: true,
            callback_timeout: Duration::from_secs(300),
            insecure_file_secrets: false,
        }
    }
}

#[derive(Debug, Clone)]
pub struct LoginOutcome {
    pub session: IdentitySession,
    pub provider_name: String,
    pub models: Vec<String>,
    pub default_model: Option<String>,
    pub dry_run: bool,
    /// Non-fatal models fetch error (keys may still be stored).
    pub models_error: Option<String>,
}

/// Object-safe OIDC surface used by login orchestration and tests.
pub trait OidcHttpDyn: Send + Sync {
    fn exchange_code_box<'a>(
        &'a self,
        token_endpoint: &'a str,
        client_id: &'a str,
        code: &'a str,
        redirect_uri: &'a str,
        code_verifier: &'a str,
    ) -> std::pin::Pin<Box<dyn std::future::Future<Output = Result<TokenResponse>> + Send + 'a>>;

    fn refresh_box<'a>(
        &'a self,
        token_endpoint: &'a str,
        client_id: &'a str,
        refresh_token: &'a str,
    ) -> std::pin::Pin<Box<dyn std::future::Future<Output = Result<TokenResponse>> + Send + 'a>>;
}

/// Object-safe gateway surface used by login orchestration and tests.
pub trait GatewayHttpDyn: Send + Sync {
    fn exchange_gateway_key_box<'a>(
        &'a self,
        exchange_url: &'a str,
        access_token: &'a str,
    ) -> std::pin::Pin<Box<dyn std::future::Future<Output = Result<GatewayKeyResponse>> + Send + 'a>>;

    fn list_models_box<'a>(
        &'a self,
        models_url: &'a str,
        api_key: &'a str,
    ) -> std::pin::Pin<Box<dyn std::future::Future<Output = Result<Vec<String>>> + Send + 'a>>;
}

pub struct TypedClients<'a> {
    pub oidc: &'a dyn OidcHttpDyn,
    pub gateway: &'a dyn GatewayHttpDyn,
}

impl<'a> TypedClients<'a> {
    pub fn new(oidc: &'a dyn OidcHttpDyn, gateway: &'a dyn GatewayHttpDyn) -> Self {
        Self { oidc, gateway }
    }
}

struct LiveOidc(ReqwestOidcHttp);
struct LiveGateway(ReqwestGatewayHttp);

impl LiveOidc {
    fn new() -> Self {
        Self(ReqwestOidcHttp::new())
    }
}

impl LiveGateway {
    fn new() -> Self {
        Self(ReqwestGatewayHttp::new())
    }
}

impl OidcHttpDyn for LiveOidc {
    fn exchange_code_box<'a>(
        &'a self,
        token_endpoint: &'a str,
        client_id: &'a str,
        code: &'a str,
        redirect_uri: &'a str,
        code_verifier: &'a str,
    ) -> std::pin::Pin<Box<dyn std::future::Future<Output = Result<TokenResponse>> + Send + 'a>>
    {
        let endpoint = token_endpoint.to_string();
        let client_id = client_id.to_string();
        let code = code.to_string();
        let redirect_uri = redirect_uri.to_string();
        let code_verifier = code_verifier.to_string();
        let client = self.0.client.clone();
        Box::pin(async move {
            let resp = client
                .post(&endpoint)
                .form(&[
                    ("grant_type", "authorization_code"),
                    ("code", code.as_str()),
                    ("redirect_uri", redirect_uri.as_str()),
                    ("client_id", client_id.as_str()),
                    ("code_verifier", code_verifier.as_str()),
                ])
                .send()
                .await
                .with_context(|| format!("POST {endpoint}"))?;
            parse_token(resp).await
        })
    }

    fn refresh_box<'a>(
        &'a self,
        token_endpoint: &'a str,
        client_id: &'a str,
        refresh_token: &'a str,
    ) -> std::pin::Pin<Box<dyn std::future::Future<Output = Result<TokenResponse>> + Send + 'a>>
    {
        let endpoint = token_endpoint.to_string();
        let client_id = client_id.to_string();
        let refresh_token = refresh_token.to_string();
        let client = self.0.client.clone();
        Box::pin(async move {
            let resp = client
                .post(&endpoint)
                .form(&[
                    ("grant_type", "refresh_token"),
                    ("refresh_token", refresh_token.as_str()),
                    ("client_id", client_id.as_str()),
                ])
                .send()
                .await
                .with_context(|| format!("POST refresh {endpoint}"))?;
            parse_token(resp).await
        })
    }
}

async fn parse_token(resp: reqwest::Response) -> Result<TokenResponse> {
    let status = resp.status();
    let body = resp.text().await.unwrap_or_default();
    if !status.is_success() {
        let snippet: String = body.chars().take(200).collect();
        anyhow::bail!("token endpoint returned HTTP {status}: {snippet}");
    }
    let parsed: TokenResponse = serde_json::from_str(&body).context("parse token response")?;
    if parsed.access_token.trim().is_empty() {
        anyhow::bail!("token response missing access_token");
    }
    Ok(parsed)
}

impl GatewayHttpDyn for LiveGateway {
    fn exchange_gateway_key_box<'a>(
        &'a self,
        exchange_url: &'a str,
        access_token: &'a str,
    ) -> std::pin::Pin<Box<dyn std::future::Future<Output = Result<GatewayKeyResponse>> + Send + 'a>>
    {
        let url = exchange_url.to_string();
        let token = access_token.to_string();
        let client = self.0.client.clone();
        Box::pin(async move {
            let resp = client
                .post(&url)
                .bearer_auth(&token)
                .json(&serde_json::json!({ "client": "sacode" }))
                .send()
                .await
                .with_context(|| format!("POST {url}"))?;
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            if !status.is_success() {
                let snippet: String = body.chars().take(200).collect();
                anyhow::bail!("gateway key exchange failed: HTTP {status}: {snippet}");
            }
            let parsed: GatewayKeyResponse =
                serde_json::from_str(&body).context("parse gateway key response")?;
            if parsed.api_key.trim().is_empty() {
                anyhow::bail!("gateway key response missing api_key");
            }
            Ok(parsed)
        })
    }

    fn list_models_box<'a>(
        &'a self,
        models_url: &'a str,
        api_key: &'a str,
    ) -> std::pin::Pin<Box<dyn std::future::Future<Output = Result<Vec<String>>> + Send + 'a>> {
        let url = models_url.to_string();
        let key = api_key.to_string();
        let client = self.0.client.clone();
        Box::pin(async move {
            let resp = client
                .get(&url)
                .bearer_auth(&key)
                .send()
                .await
                .with_context(|| format!("GET {url}"))?;
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            if !status.is_success() {
                let snippet: String = body.chars().take(200).collect();
                anyhow::bail!("gateway models failed: HTTP {status}: {snippet}");
            }
            let parsed: super::gateway::ModelsListResponse =
                serde_json::from_str(&body).context("parse /v1/models response")?;
            Ok(parsed
                .data
                .into_iter()
                .map(|m| m.id)
                .filter(|id| !id.trim().is_empty())
                .collect())
        })
    }
}

pub async fn login(
    config: IdentityConfig,
    opts: LoginOptions,
    secret_store: &dyn SecretStore,
) -> Result<LoginOutcome> {
    login_with_dyn_clients(config, opts, secret_store, None).await
}

pub async fn login_with_dyn_clients(
    mut config: IdentityConfig,
    opts: LoginOptions,
    secret_store: &dyn SecretStore,
    clients: Option<TypedClients<'_>>,
) -> Result<LoginOutcome> {
    config.normalize();

    if opts.dry_run {
        println!("{}", config.dry_run_summary());
        return Ok(LoginOutcome {
            session: IdentitySession {
                idp_base_url: config.idp_base_url.clone(),
                gateway_base_url: config.gateway_base_url.clone(),
                client_id: config.client_id.clone(),
                provider_name: config.provider_name.clone(),
                ..Default::default()
            },
            provider_name: config.provider_name.clone(),
            models: vec![],
            default_model: None,
            dry_run: true,
            models_error: None,
        });
    }

    config.ensure_ready_for_network()?;

    let params = generate_browser_params();
    let callback = start_callback_server(config.redirect_uri.as_deref())?;
    let redirect_uri = callback.redirect_uri.clone();
    let authorize_url = build_authorize_url(
        &config.authorize_endpoint(),
        &config.client_id,
        &redirect_uri,
        &params.state,
        &params.nonce,
        &params.pkce.challenge,
        DEFAULT_SCOPE,
    )?;
    if opts.open_browser {
        open_or_print_authorize_url(&authorize_url);
    } else {
        println!("Authorize URL:\n{authorize_url}");
    }

    let callback_url = callback.wait_for_callback(opts.callback_timeout)?;
    let (code, state) = split_auth_code(&callback_url)?;
    if state != params.state {
        anyhow::bail!("OAuth state mismatch; possible CSRF, aborting login");
    }

    let token = exchange_code(
        clients.as_ref(),
        &config,
        &code,
        &redirect_uri,
        &params.pkce.verifier,
    )
    .await?;

    complete_login_with_dyn_clients(&config, opts, secret_store, token, clients).await
}

async fn exchange_code(
    clients: Option<&TypedClients<'_>>,
    config: &IdentityConfig,
    code: &str,
    redirect_uri: &str,
    code_verifier: &str,
) -> Result<TokenResponse> {
    match clients {
        Some(c) => {
            c.oidc
                .exchange_code_box(
                    &config.token_endpoint(),
                    &config.client_id,
                    code,
                    redirect_uri,
                    code_verifier,
                )
                .await
        }
        None => {
            LiveOidc::new()
                .exchange_code_box(
                    &config.token_endpoint(),
                    &config.client_id,
                    code,
                    redirect_uri,
                    code_verifier,
                )
                .await
        }
    }
}

pub async fn complete_login_with_dyn_clients(
    config: &IdentityConfig,
    opts: LoginOptions,
    secret_store: &dyn SecretStore,
    token: TokenResponse,
    clients: Option<TypedClients<'_>>,
) -> Result<LoginOutcome> {
    let exchange_url = config.gateway_exchange_url();
    let key_resp = match clients.as_ref() {
        Some(c) => {
            c.gateway
                .exchange_gateway_key_box(&exchange_url, &token.access_token)
                .await?
        }
        None => {
            LiveGateway::new()
                .exchange_gateway_key_box(&exchange_url, &token.access_token)
                .await?
        }
    };

    let refresh = token.refresh_token.clone().ok_or_else(|| {
        anyhow!("token response missing refresh_token; scope offline_access required")
    })?;

    secret_store.set(GATEWAY_API_KEY_LOCATOR, &key_resp.api_key)?;
    secret_store.set(REFRESH_TOKEN_LOCATOR, &refresh)?;

    let models_url = config.gateway_models_url();
    let (models, models_error) = match clients.as_ref() {
        Some(c) => match c
            .gateway
            .list_models_box(&models_url, &key_resp.api_key)
            .await
        {
            Ok(m) => (m, None),
            Err(e) => {
                tracing::warn!("gateway models fetch failed after login: {e}");
                (Vec::new(), Some(e.to_string()))
            }
        },
        None => match LiveGateway::new()
            .list_models_box(&models_url, &key_resp.api_key)
            .await
        {
            Ok(m) => (m, None),
            Err(e) => {
                tracing::warn!("gateway models fetch failed after login: {e}");
                (Vec::new(), Some(e.to_string()))
            }
        },
    };
    let default_model = pick_default_model(&models);

    let mut session = IdentitySession {
        schema_version: 1,
        subject: token_sub_hint(&token),
        idp_base_url: config.idp_base_url.clone(),
        gateway_base_url: config.gateway_base_url.clone(),
        client_id: config.client_id.clone(),
        provider_name: config.provider_name.clone(),
        models: models.clone(),
        default_model: default_model.clone().unwrap_or_default(),
        logged_in_at: Some(Utc::now().to_rfc3339()),
        ..Default::default()
    };
    session.set_key_refs(&key_resp.api_key, &refresh);
    session.apply_token_metadata(token.expires_in, Some(&refresh));
    session.save(opts.user_root.as_deref())?;

    write_provider_entry(&opts.workdir, config, &key_resp.api_key, &default_model)?;

    Ok(LoginOutcome {
        session,
        provider_name: config.provider_name.clone(),
        models,
        default_model,
        dry_run: false,
        models_error,
    })
}

fn token_sub_hint(token: &TokenResponse) -> Option<String> {
    use base64::engine::general_purpose::URL_SAFE_NO_PAD;
    use base64::Engine;
    let id = token.id_token.as_deref()?;
    let mut parts = id.split('.');
    let _h = parts.next()?;
    let payload = parts.next()?;
    let bytes = URL_SAFE_NO_PAD.decode(payload).ok()?;
    let value: serde_json::Value = serde_json::from_slice(&bytes).ok()?;
    value
        .get("sub")
        .and_then(|s| s.as_str())
        .map(|s| s.to_string())
}

fn write_provider_entry(
    workdir: &Path,
    config: &IdentityConfig,
    api_key: &str,
    default_model: &Option<String>,
) -> Result<()> {
    let mut store = super::provider_bridge::ProviderCatalogBridge::new(workdir);
    let mut secret_ref = SecretRef::os_keyring(GATEWAY_API_KEY_LOCATOR);
    secret_ref.masked = SecretRef::mask_secret(api_key);
    store.upsert_identity_provider(
        &config.provider_name,
        &config.provider_base_url(),
        secret_ref,
        default_model.as_deref().unwrap_or(""),
        Some("Authorization"),
        Some("Bearer"),
    )?;
    store.set_current(&config.provider_name)?;
    Ok(())
}

pub fn status_summary(user_root: Option<&Path>) -> Result<SessionStatus> {
    match IdentitySession::load(user_root)? {
        Some(session) => Ok(session.status()),
        None => Ok(SessionStatus {
            logged_in: false,
            subject: None,
            idp_base_url: String::new(),
            gateway_base_url: String::new(),
            client_id: String::new(),
            provider_name: DEFAULT_PROVIDER_NAME.to_string(),
            models_count: 0,
            default_model: None,
            gateway_key_ref_masked: None,
            refresh_token_ref_masked: None,
            logged_in_at: None,
        }),
    }
}

pub fn logout(
    user_root: Option<&Path>,
    secret_store: &dyn SecretStore,
    revoke_remote: bool,
    config: Option<IdentityConfig>,
) -> Result<()> {
    let _ = secret_store.delete(GATEWAY_API_KEY_LOCATOR);
    let _ = secret_store.delete(REFRESH_TOKEN_LOCATOR);
    IdentitySession::delete(user_root)?;
    if revoke_remote {
        if let Some(mut cfg) = config {
            cfg.normalize();
            if !cfg.idp_base_url.is_empty() {
                if let Ok(client) = reqwest::blocking::Client::builder()
                    .timeout(Duration::from_secs(10))
                    .build()
                {
                    // Best-effort revoke of stored refresh token when still present.
                    let refresh = resolve_secret_ref(
                        &sacode_kernel::model::SecretRef::os_keyring(REFRESH_TOKEN_LOCATOR),
                        Some(secret_store),
                    )
                    .ok()
                    .flatten();
                    let mut form = vec![
                        ("token_type_hint".to_string(), "refresh_token".to_string()),
                        ("client_id".to_string(), cfg.client_id.clone()),
                    ];
                    if let Some(token) = refresh.filter(|t| !t.is_empty()) {
                        form.push(("token".to_string(), token));
                    }
                    let _ = client.post(cfg.revoke_endpoint()).form(&form).send();
                }
            }
        }
    }
    Ok(())
}

pub async fn refresh_access_token(
    config: &IdentityConfig,
    user_root: Option<&Path>,
    secret_store: &dyn SecretStore,
    oidc: Option<&dyn OidcHttpDyn>,
) -> Result<TokenResponse> {
    let session = IdentitySession::load(user_root)?
        .ok_or_else(|| anyhow!("not logged in; run `sacode account login`"))?;
    let refresh_ref = session
        .refresh_token_ref
        .clone()
        .ok_or_else(|| anyhow!("session missing refresh_token_ref"))?;
    let refresh = resolve_secret_ref(&refresh_ref, Some(secret_store))?
        .ok_or_else(|| anyhow!("refresh_token not found in secret store"))?;
    let token = match oidc {
        Some(client) => {
            client
                .refresh_box(&config.token_endpoint(), &config.client_id, &refresh)
                .await?
        }
        None => {
            LiveOidc::new()
                .refresh_box(&config.token_endpoint(), &config.client_id, &refresh)
                .await?
        }
    };
    if let Some(new_rt) = token.refresh_token.as_deref() {
        secret_store.set(REFRESH_TOKEN_LOCATOR, new_rt)?;
    }
    Ok(token)
}

pub async fn sync_models(
    config: &IdentityConfig,
    user_root: Option<&Path>,
    workdir: &Path,
    secret_store: &dyn SecretStore,
    gateway: Option<&dyn GatewayHttpDyn>,
) -> Result<Vec<String>> {
    let mut session = IdentitySession::load(user_root)?
        .ok_or_else(|| anyhow!("not logged in; run `sacode account login`"))?;
    let key_ref = session
        .gateway_key_ref
        .clone()
        .ok_or_else(|| anyhow!("session missing gateway_key_ref"))?;
    let api_key = resolve_secret_ref(&key_ref, Some(secret_store))?
        .ok_or_else(|| anyhow!("gateway api_key not found in secret store"))?;
    let models_url = config.gateway_models_url();
    let models = match gateway {
        Some(c) => c.list_models_box(&models_url, &api_key).await?,
        None => {
            LiveGateway::new()
                .list_models_box(&models_url, &api_key)
                .await?
        }
    };
    let default_model = pick_default_model(&models);
    session.models = models.clone();
    session.default_model = default_model.clone().unwrap_or_default();
    session.save(user_root)?;
    write_provider_entry(workdir, config, &api_key, &default_model)?;
    Ok(models)
}

pub fn select_secret_store(
    insecure_file_secrets: bool,
    user_root: Option<&Path>,
) -> Box<dyn SecretStore> {
    if insecure_file_secrets {
        return Box::new(FileSecretStore::new(user_root));
    }
    Box::new(OsKeyringSecretStore::new())
}

/// File-backed store — only for `--insecure-file-secrets` / constrained envs.
pub struct FileSecretStore {
    path: PathBuf,
    inner: std::sync::Mutex<std::collections::HashMap<String, String>>,
}

impl FileSecretStore {
    pub fn new(user_root: Option<&Path>) -> Self {
        let root = user_root.map(|p| p.to_path_buf()).unwrap_or_else(|| {
            if let Ok(v) = std::env::var("SACODE_HOME") {
                PathBuf::from(v)
            } else if let Ok(v) = std::env::var("USERPROFILE") {
                PathBuf::from(v)
            } else {
                PathBuf::from(".")
            }
        });
        let path = root
            .join(".sacode")
            .join("identity")
            .join("secrets.local.json");
        let inner = std::fs::read_to_string(&path)
            .ok()
            .and_then(|raw| serde_json::from_str(&raw).ok())
            .unwrap_or_default();
        Self {
            path,
            inner: std::sync::Mutex::new(inner),
        }
    }

    fn persist(&self) -> Result<()> {
        let map = self.inner.lock().unwrap();
        if let Some(parent) = self.path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        std::fs::write(&self.path, serde_json::to_string_pretty(&*map)?)?;
        Ok(())
    }
}

impl SecretStore for FileSecretStore {
    fn get(&self, locator: &str) -> Result<Option<String>> {
        Ok(self.inner.lock().unwrap().get(locator).cloned())
    }

    fn set(&self, locator: &str, secret: &str) -> Result<()> {
        self.inner
            .lock()
            .unwrap()
            .insert(locator.to_string(), secret.to_string());
        self.persist()
    }

    fn delete(&self, locator: &str) -> Result<()> {
        self.inner.lock().unwrap().remove(locator);
        self.persist()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::identity::gateway::GatewayKeyResponse;
    use crate::identity::secret_store::MemorySecretStore;

    struct MockOidc;
    impl OidcHttpDyn for MockOidc {
        fn exchange_code_box<'a>(
            &'a self,
            _token_endpoint: &'a str,
            _client_id: &'a str,
            _code: &'a str,
            _redirect_uri: &'a str,
            _code_verifier: &'a str,
        ) -> std::pin::Pin<Box<dyn std::future::Future<Output = Result<TokenResponse>> + Send + 'a>>
        {
            Box::pin(async {
                Ok(TokenResponse {
                    access_token: "access-token-test".into(),
                    token_type: "Bearer".into(),
                    expires_in: Some(3600),
                    refresh_token: Some("refresh-token-test".into()),
                    id_token: None,
                })
            })
        }

        fn refresh_box<'a>(
            &'a self,
            _token_endpoint: &'a str,
            _client_id: &'a str,
            refresh_token: &'a str,
        ) -> std::pin::Pin<Box<dyn std::future::Future<Output = Result<TokenResponse>> + Send + 'a>>
        {
            Box::pin(async move {
                assert_eq!(refresh_token, "refresh-token-test");
                Ok(TokenResponse {
                    access_token: "access-token-refreshed".into(),
                    token_type: "Bearer".into(),
                    expires_in: Some(3600),
                    refresh_token: Some("refresh-token-test-2".into()),
                    id_token: None,
                })
            })
        }
    }

    struct MockGateway;
    impl GatewayHttpDyn for MockGateway {
        fn exchange_gateway_key_box<'a>(
            &'a self,
            _exchange_url: &'a str,
            access_token: &'a str,
        ) -> std::pin::Pin<
            Box<dyn std::future::Future<Output = Result<GatewayKeyResponse>> + Send + 'a>,
        > {
            Box::pin(async move {
                assert_eq!(access_token, "access-token-test");
                Ok(GatewayKeyResponse {
                    api_key: "sa-mock-key-42".into(),
                    issued: Some(true),
                    prefix: Some("sa-mock".into()),
                    id: None,
                    created_at: None,
                })
            })
        }

        fn list_models_box<'a>(
            &'a self,
            _models_url: &'a str,
            api_key: &'a str,
        ) -> std::pin::Pin<Box<dyn std::future::Future<Output = Result<Vec<String>>> + Send + 'a>>
        {
            Box::pin(async move {
                assert_eq!(api_key, "sa-mock-key-42");
                Ok(vec!["deepseek-chat".to_string(), "qwen-plus".to_string()])
            })
        }
    }

    #[tokio::test]
    async fn complete_login_writes_session_provider_and_secrets() {
        let tmp = tempfile::tempdir().unwrap();
        let workdir = tmp.path().join("project");
        std::fs::create_dir_all(&workdir).unwrap();
        let user_root = tmp.path().join("home");
        std::fs::create_dir_all(&user_root).unwrap();

        let config = IdentityConfig {
            idp_base_url: "https://idp.test".into(),
            gateway_base_url: "https://gw.test".into(),
            client_id: "sacode".into(),
            redirect_uri: None,
            provider_name: "sa-ai".into(),
        };
        let store = MemorySecretStore::new();
        let oidc = MockOidc;
        let gateway = MockGateway;
        let clients = Some(TypedClients::new(&oidc, &gateway));

        let token = TokenResponse {
            access_token: "access-token-test".into(),
            token_type: "Bearer".into(),
            expires_in: Some(3600),
            refresh_token: Some("refresh-token-test".into()),
            id_token: None,
        };

        let opts = LoginOptions {
            workdir: workdir.clone(),
            user_root: Some(user_root.clone()),
            dry_run: false,
            open_browser: false,
            callback_timeout: Duration::from_secs(1),
            insecure_file_secrets: false,
        };

        let outcome = complete_login_with_dyn_clients(&config, opts, &store, token, clients)
            .await
            .unwrap();

        assert_eq!(outcome.provider_name, "sa-ai");
        assert_eq!(outcome.default_model.as_deref(), Some("deepseek-chat"));
        assert_eq!(
            store.get(GATEWAY_API_KEY_LOCATOR).unwrap().as_deref(),
            Some("sa-mock-key-42")
        );
        assert_eq!(
            store.get(REFRESH_TOKEN_LOCATOR).unwrap().as_deref(),
            Some("refresh-token-test")
        );

        let session_raw =
            std::fs::read_to_string(IdentitySession::session_path(Some(&user_root))).unwrap();
        assert!(!session_raw.contains("sa-mock-key-42"));
        assert!(!session_raw.contains("refresh-token-test"));

        let provider_raw = std::fs::read_to_string(workdir.join(".sacode/provider.json")).unwrap();
        assert!(provider_raw.contains("sa-ai"));
        let parsed: serde_json::Value = serde_json::from_str(&provider_raw).unwrap();
        let sa = &parsed["providers"]["sa-ai"];
        assert_eq!(sa["api_key"].as_str().unwrap_or("MISSING"), "");
        assert_eq!(
            sa["secret_ref"]["kind"].as_str().unwrap_or(""),
            "os_keyring"
        );
        assert_eq!(sa["base_url"].as_str().unwrap_or(""), "https://gw.test/v1");

        let status = status_summary(Some(&user_root)).unwrap();
        assert!(status.logged_in);
        assert_eq!(status.models_count, 2);

        // refresh rotates refresh_token in store
        let refreshed = refresh_access_token(&config, Some(&user_root), &store, Some(&oidc))
            .await
            .unwrap();
        assert_eq!(refreshed.access_token, "access-token-refreshed");
        assert_eq!(
            store.get(REFRESH_TOKEN_LOCATOR).unwrap().as_deref(),
            Some("refresh-token-test-2")
        );

        logout(Some(&user_root), &store, false, None).unwrap();
        assert!(store.get(GATEWAY_API_KEY_LOCATOR).unwrap().is_none());
        assert!(IdentitySession::load(Some(&user_root)).unwrap().is_none());
    }

    #[tokio::test]
    async fn dry_run_does_not_require_network_or_secrets() {
        let store = MemorySecretStore::new();
        let config = IdentityConfig::default();
        let opts = LoginOptions {
            dry_run: true,
            open_browser: false,
            ..Default::default()
        };
        let out = login(config, opts, &store).await.unwrap();
        assert!(out.dry_run);
        assert!(store.get(GATEWAY_API_KEY_LOCATOR).unwrap().is_none());
    }
}
