use std::path::PathBuf;

use anyhow::Result;
use sacode_runtime::identity::{
    login, logout, select_secret_store, status_summary, sync_models, IdentityConfig, LoginOptions,
};

use crate::provider_config::ProviderConfigStore;

pub async fn run(sub_args: Vec<String>) -> Result<()> {
    let mut args = sub_args.iter().map(|s| s.as_str());
    let sub = args.next().unwrap_or("status");
    match sub {
        "login" => cmd_login(sub_args[1..].to_vec()).await,
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
        "  sacode account status",
        "  sacode account logout [--revoke]",
        "  sacode account models",
        "",
        "Env overrides:",
        "  SACODE_IDP_BASE_URL, SACODE_GATEWAY_BASE_URL, SACODE_IDENTITY_CLIENT_ID",
        "  SACODE_HOME (user config/session root)",
        "",
        "Security: gateway api_key and refresh_token are stored in the OS keyring;",
        "provider.json only keeps secret_ref. Existing /login manual providers remain supported.",
    ]
    .join("\n")
}

fn parse_flags(args: &[String]) -> (IdentityConfig, LoginOptions) {
    let mut idp = None;
    let mut gateway = None;
    let mut client_id = None;
    let mut provider = None;
    let mut redirect = None;
    let mut dry_run = false;
    let mut no_browser = false;
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
            other => {
                tracing::warn!("ignoring unknown account login flag: {other}");
            }
        }
        i += 1;
    }

    // Spec priority: CLI flag > env > file > default.
    let mut config = IdentityConfig::load(user_root().as_deref()).unwrap_or_default();
    config.apply_env_overrides();
    config = config.with_overrides(idp, gateway, client_id, redirect, provider);
    config.normalize();

    let opts = LoginOptions {
        workdir: PathBuf::from("."),
        user_root: user_root(),
        dry_run,
        open_browser: !no_browser && !dry_run,
        insecure_file_secrets: insecure,
        ..Default::default()
    };
    (config, opts)
}

fn user_root() -> Option<PathBuf> {
    if let Ok(v) = std::env::var("SACODE_HOME") {
        if !v.trim().is_empty() {
            return Some(PathBuf::from(v.trim()));
        }
    }
    None
}

async fn cmd_login(args: Vec<String>) -> Result<()> {
    let (config, opts) = parse_flags(&args);
    let store = select_secret_store(opts.insecure_file_secrets, opts.user_root.as_deref());

    if !opts.dry_run {
        // Persist resolved config (no secrets) for future commands.
        let _ = config.save(user_root().as_deref());
    }

    let outcome = login(config, opts, store.as_ref()).await?;
    if outcome.dry_run {
        println!("dry-run complete; no tokens or keys were stored.");
        return Ok(());
    }
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
    println!("  key storage: secret store (OS keyring by default; not provider.json)");
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
