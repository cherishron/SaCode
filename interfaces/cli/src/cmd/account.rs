use std::path::PathBuf;

use anyhow::Result;
use sacode_runtime::identity::{
    apply_gateway_api_key, ensure_fresh_session, headless_login_instructions, login,
    login_device_flow, login_headless_wait, login_with_paste_callback, logout,
    prepare_headless_login, select_secret_store, status_summary, sync_models, IdentityConfig,
    LoginOptions,
};

use crate::provider_config::ProviderConfigStore;

pub async fn run(sub_args: Vec<String>) -> Result<()> {
    let mut args = sub_args.iter().map(|s| s.as_str());
    let sub = args.next().unwrap_or("status");
    match sub {
        "login" => cmd_login(sub_args[1..].to_vec()).await,
        "set-api-key" => cmd_set_api_key(sub_args[1..].to_vec()),
        "status" => cmd_status(),
        "logout" => cmd_logout(sub_args[1..].to_vec()),
        "models" => cmd_models().await,
        "help" | "--help" | "-h" => {
            print_account_help();
            Ok(())
        }
        other => {
            anyhow::bail!("unknown account subcommand: {other}\n\n{}", help_footer())
        }
    }
}

fn print_account_help() {
    println!("{}", help_footer());
}

fn help_footer() -> String {
    [
        "sacode account — saai unified identity (sa-idp OIDC)",
        "",
        "Usage:",
        "  sacode account login [--idp <url>] [--gateway <url>] [--client-id <id>]",
        "                       [--provider <name>] [--dry-run] [--no-browser]",
        "                       [--insecure-file-secrets]",
        "                       [--headless | --paste-callback <url> | --device]",
        "  sacode account set-api-key <sa-...> [--gateway <url>] [--idp <url>]",
        "  sacode account status",
        "  sacode account logout [--revoke]",
        "  sacode account models",
        "",
        "Env overrides:",
        "  SACODE_IDP_BASE_URL, SACODE_GATEWAY_BASE_URL, SACODE_IDENTITY_CLIENT_ID",
        "  SACODE_HOME, SACODE_IDENTITY_SECRET_BACKEND=file|keyring",
        "  SACODE_IDENTITY_SECRET_GATEWAY_API_KEY (escape hatch for provisioned keys)",
        "",
        "Headless Linux / cloud:",
        "  login --headless     print authorize URL + SSH tunnel / paste-callback steps",
        "  login --paste-callback '<url>'   finish OAuth using callback URL from browser bar",
        "  login --device       RFC 8628 device grant (needs sa-idp device endpoints)",
        "  set-api-key <key>    non-browser CI path; key stored via SecretStore",
        "",
        "Session / one-week re-login:",
        "  Login stores offline_access refresh_token; client auto-refreshes access_token",
        "  before expiry. Re-login is only required after refresh_token expires/revoked",
        "  (server-side IdP TTL — typically days — not by making access tokens longer).",
        "",
        "Security: gateway api_key and refresh_token are stored in OS keyring when available;",
        "on headless Linux they fall back to ~/.sacode/identity/secrets.local.json (0600).",
        "provider.json only keeps secret_ref. Never commit secrets.local.json or env files.",
    ]
    .join("\n")
}

fn parse_flags(args: &[String]) -> (IdentityConfig, LoginOptions, CliLoginMode) {
    let mut idp = None;
    let mut gateway = None;
    let mut client_id = None;
    let mut provider = None;
    let mut redirect = None;
    let mut dry_run = false;
    let mut no_browser = false;
    let mut insecure = false;
    let mut headless = false;
    let mut device = false;
    let mut paste_callback = None;

    let mut i = 0;
    while i < args.len() {
        match args[i].as_str() {
            "--idp" => {
                i += 1;
                idp = args.get(i).cloned();
            }
            "--gateway" => {
                i += 1;
                gateway = args.get(i).cloned();
            }
            "--client-id" => {
                i += 1;
                client_id = args.get(i).cloned();
            }
            "--provider" => {
                i += 1;
                provider = args.get(i).cloned();
            }
            "--redirect-uri" => {
                i += 1;
                redirect = args.get(i).cloned();
            }
            "--dry-run" => dry_run = true,
            "--no-browser" => no_browser = true,
            "--insecure-file-secrets" => insecure = true,
            "--headless" => headless = true,
            "--device" => device = true,
            "--paste-callback" => {
                i += 1;
                paste_callback = args.get(i).cloned();
            }
            other => {
                tracing::warn!("ignoring unknown account login flag: {other}");
            }
        }
        i += 1;
    }

    let mut config = IdentityConfig::load(user_root().as_deref()).unwrap_or_default();
    config.apply_env_overrides();
    config = config.with_overrides(idp, gateway, client_id, redirect, provider);
    config.normalize();

    let mode = if let Some(url) = paste_callback {
        CliLoginMode::PasteCallback(url)
    } else if headless {
        CliLoginMode::Headless
    } else if device {
        CliLoginMode::Device
    } else {
        CliLoginMode::Browser
    };

    let opts = LoginOptions {
        workdir: PathBuf::from("."),
        user_root: user_root(),
        dry_run,
        // Headless never opens a local browser.
        open_browser: !no_browser && !dry_run && matches!(mode, CliLoginMode::Browser),
        insecure_file_secrets: insecure,
        ..Default::default()
    };
    (config, opts, mode)
}

enum CliLoginMode {
    Browser,
    Headless,
    Device,
    PasteCallback(String),
}

fn user_root() -> Option<PathBuf> {
    if let Ok(v) = std::env::var("SACODE_HOME") {
        if !v.trim().is_empty() {
            return Some(PathBuf::from(v.trim()));
        }
    }
    None
}

fn print_outcome(outcome: &sacode_runtime::identity::LoginOutcome, key_backend: &str) {
    println!("Login OK");
    println!("  provider   : {}", outcome.provider_name);
    println!("  models     : {}", outcome.models.len());
    if let Some(m) = outcome.default_model.as_deref() {
        if !m.is_empty() {
            println!("  default    : {m}");
        }
    }
    if outcome.models.is_empty() {
        eprintln!(
            "warning: gateway models list is empty or could not be fetched; \
             keys were stored. Run `sacode account models` after the gateway is reachable."
        );
    }
    if let Some(err) = outcome.models_error.as_deref() {
        eprintln!("warning: models fetch failed: {err}");
    }
    println!("  key storage: {key_backend}");
    println!(
        "  session    : refresh_token persisted; client will auto-refresh access_token \
         before expiry (stay-logged-in via refresh, not longer access tokens)"
    );
}

fn key_backend_label(store: &dyn sacode_runtime::identity::SecretStore) -> String {
    // Best-effort label without printing secrets.
    let _ = store;
    if std::env::var("SACODE_IDENTITY_SECRET_BACKEND")
        .map(|v| v.eq_ignore_ascii_case("file"))
        .unwrap_or(false)
    {
        return "file (~/.sacode/identity/secrets.local.json)".into();
    }
    "secret store (OS keyring preferred; file fallback on headless Linux)".into()
}

async fn cmd_login(args: Vec<String>) -> Result<()> {
    let (config, opts, mode) = parse_flags(&args);
    let store = select_secret_store(opts.insecure_file_secrets, opts.user_root.as_deref());

    if !opts.dry_run {
        let _ = config.save(user_root().as_deref());
    }

    match mode {
        CliLoginMode::PasteCallback(url) => {
            let outcome = login_with_paste_callback(&url, opts.clone(), store.as_ref()).await?;
            if outcome.dry_run {
                println!("dry-run complete; no tokens or keys were stored.");
                return Ok(());
            }
            print_outcome(&outcome, &key_backend_label(store.as_ref()));
            Ok(())
        }
        CliLoginMode::Headless => {
            if opts.dry_run {
                let (_pending, url) = prepare_headless_login(&config, opts.user_root.as_deref())?;
                println!(
                    "{}",
                    headless_login_instructions(&url, "http://127.0.0.1:<port>/callback")
                );
                println!("dry-run complete; pending-login written, no tokens stored yet.");
                return Ok(());
            }
            let outcome = login_headless_wait(&config, opts, store.as_ref()).await?;
            print_outcome(&outcome, &key_backend_label(store.as_ref()));
            Ok(())
        }
        CliLoginMode::Device => {
            if opts.dry_run {
                println!("device dry-run: would call sa-idp device authorization endpoints.");
                return Ok(());
            }
            let outcome = login_device_flow(&config, opts, store.as_ref()).await?;
            print_outcome(&outcome, &key_backend_label(store.as_ref()));
            Ok(())
        }
        CliLoginMode::Browser => {
            let outcome = login(config, opts, store.as_ref()).await?;
            if outcome.dry_run {
                println!("dry-run complete; no tokens or keys were stored.");
                return Ok(());
            }
            print_outcome(&outcome, &key_backend_label(store.as_ref()));
            Ok(())
        }
    }
}

fn cmd_set_api_key(args: Vec<String>) -> Result<()> {
    let mut key = None;
    let mut idp = None;
    let mut gateway = None;
    let mut provider = None;
    let mut insecure = false;
    let mut i = 0;
    while i < args.len() {
        match args[i].as_str() {
            "--idp" => {
                i += 1;
                idp = args.get(i).cloned();
            }
            "--gateway" => {
                i += 1;
                gateway = args.get(i).cloned();
            }
            "--provider" => {
                i += 1;
                provider = args.get(i).cloned();
            }
            "--insecure-file-secrets" => insecure = true,
            other if !other.starts_with("--") && key.is_none() => {
                key = Some(other.to_string());
            }
            _ => {}
        }
        i += 1;
    }
    // Allow key from env for CI (never print it).
    let key = key
        .or_else(|| std::env::var("SACODE_GATEWAY_API_KEY").ok())
        .filter(|k| !k.trim().is_empty())
        .ok_or_else(|| {
            anyhow::anyhow!(
                "usage: sacode account set-api-key <sa-...>  (or set SACODE_GATEWAY_API_KEY)"
            )
        })?;

    let mut config = IdentityConfig::load(user_root().as_deref()).unwrap_or_default();
    config.apply_env_overrides();
    config = config.with_overrides(idp, gateway, None, None, provider);
    config.normalize();
    let _ = config.save(user_root().as_deref());

    let opts = LoginOptions {
        workdir: PathBuf::from("."),
        user_root: user_root(),
        insecure_file_secrets: insecure,
        open_browser: false,
        ..Default::default()
    };
    let store = select_secret_store(opts.insecure_file_secrets, opts.user_root.as_deref());
    let outcome = apply_gateway_api_key(&key, &config, &opts, store.as_ref())?;
    print_outcome(&outcome, &key_backend_label(store.as_ref()));
    println!(
        "  note       : provisioned key has no refresh_token; re-run set-api-key when rotated"
    );
    Ok(())
}

fn cmd_status() -> Result<()> {
    let status = status_summary(user_root().as_deref())?;
    println!("{}", serde_json::to_string_pretty(&status)?);
    Ok(())
}

fn cmd_logout(args: Vec<String>) -> Result<()> {
    let revoke = args.iter().any(|a| a == "--revoke");
    let config = IdentityConfig::load(user_root().as_deref()).ok();
    let insecure = args.iter().any(|a| a == "--insecure-file-secrets");
    let store = select_secret_store(insecure, user_root().as_deref());
    logout(user_root().as_deref(), store.as_ref(), revoke, config)?;
    println!("Logged out of saai identity (local session cleared).");
    Ok(())
}

async fn cmd_models() -> Result<()> {
    let mut config = IdentityConfig::load(user_root().as_deref()).unwrap_or_default();
    config.apply_env_overrides();
    config.normalize();
    config.ensure_ready_for_network()?;
    let insecure = std::env::var("SACODE_IDENTITY_INSECURE_FILE_SECRETS").is_ok()
        || std::env::var("SACODE_IDENTITY_SECRET_BACKEND")
            .map(|v| v.eq_ignore_ascii_case("file"))
            .unwrap_or(false);
    let store = select_secret_store(insecure, user_root().as_deref());
    let workdir = PathBuf::from(".");
    // Stay-logged-in: auto-refresh access via refresh_token when near expiry.
    match ensure_fresh_session(
        &config,
        user_root().as_deref(),
        &workdir,
        store.as_ref(),
        None,
        None,
        300,
    )
    .await
    {
        Ok(fresh) => {
            if fresh.refreshed || fresh.re_exchanged_gateway_key {
                println!("session: {}", fresh.note);
            }
        }
        Err(e) => {
            eprintln!("session refresh skipped/failed: {e}");
        }
    }
    let models = sync_models(
        &config,
        user_root().as_deref(),
        &workdir,
        store.as_ref(),
        None,
    )
    .await?;
    println!(
        "Synced {} models for provider {}",
        models.len(),
        config.provider_name
    );
    for m in models.iter().take(20) {
        println!("  - {m}");
    }
    if models.len() > 20 {
        println!("  ... {} more", models.len() - 20);
    }
    Ok(())
}

/// Used by doctor/status to note identity configuration without printing secrets.
#[allow(dead_code)]
pub fn identity_configured() -> bool {
    match IdentityConfig::load(user_root().as_deref()) {
        Ok(cfg) => !cfg.idp_base_url.is_empty() || !cfg.gateway_base_url.is_empty(),
        Err(_) => false,
    }
}

/// Check whether the current provider catalog has an identity provider entry.
#[allow(dead_code)]
pub fn identity_provider_present(workdir: &std::path::Path) -> bool {
    let store = ProviderConfigStore::new(workdir);
    store
        .load_catalog()
        .ok()
        .flatten()
        .map(|c| {
            c.providers
                .contains_key(sacode_runtime::identity::DEFAULT_PROVIDER_NAME)
                || c.providers.values().any(|p| p.secret_ref.is_some())
        })
        .unwrap_or(false)
}
