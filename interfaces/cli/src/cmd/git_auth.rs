use anyhow::Result;
use std::io::Read;
use std::time::Duration;

use sacode_runtime::git_auth::{
    credential_reply, emit_credential, git_auth_status, logout_host, save_token, token_for_host,
    AuthHost, GitHubDeviceClient, GiteeLoopbackConfig,
};
use sacode_runtime::identity::callback::start_callback_server;

pub async fn run(sub_args: Vec<String>) -> Result<()> {
    let first = sub_args.first().map(|s| s.as_str()).unwrap_or("help");
    match first {
        "auth" => run_auth(sub_args[1..].to_vec()).await,
        "help" | "--help" | "-h" => {
            print!("{}", help());
            Ok(())
        }
        other => {
            anyhow::bail!("unknown git subcommand: {other}\n{}", help())
        }
    }
}

fn help() -> String {
    [
        "sacode git — platform auth helpers",
        "",
        "Login truth source: sa-idp (sacode account login).",
        "Git OAuth/PAT are **attached credentials**, not a second login system.",
        "",
        "Usage:",
        "  sacode account login                # sa-idp OIDC (required before git OAuth)",
        "  sacode git auth login github       # device flow (SACODE_GITHUB_CLIENT_ID)",
        "  sacode git auth login gitee        # loopback OAuth (SACODE_GITEE_CLIENT_ID/SECRET)",
        "  sacode git auth status",
        "  sacode git auth logout [github|gitee]",
        "  sacode git auth credential         # git credential.helper stdin",
        "  sacode git auth set-token <host>   # PAT fallback (stdin; no idp_subject)",
        "",
        "git config --global credential.helper='!sacode git auth credential'",
        "",
    ]
    .join("\n")
}

async fn run_auth(args: Vec<String>) -> Result<()> {
    let cmd = args.first().map(|s| s.as_str()).unwrap_or("status");
    match cmd {
        "login" => {
            let host = args.get(1).map(|s| s.as_str()).unwrap_or("github");
            login(host).await
        }
        "status" => {
            let (idp_ok, subject) = sacode_runtime::git_auth::identity_login_state(None);
            let status = git_auth_status(None);
            println!(
                "idp_logged_in={} idp_subject={}",
                idp_ok,
                subject.as_deref().unwrap_or("-")
            );
            println!("{}", serde_json::to_string_pretty(&status)?);
            Ok(())
        }
        "logout" => {
            let host = match args.get(1).map(|s| AuthHost::parse(s)) {
                Some(Ok(h)) => Some(h),
                Some(Err(e)) => return Err(e.into()),
                None => None,
            };
            logout_host(host, None)?;
            println!("git auth logged out");
            Ok(())
        }
        "credential" => {
            let mut raw = String::new();
            std::io::stdin().read_to_string(&mut raw)?;
            let raw = raw.trim_start_matches('\u{feff}').to_string();
            emit_credential(&raw, None)?;
            Ok(())
        }
        "set-token" => {
            let host = AuthHost::parse(args.get(1).map(|s| s.as_str()).unwrap_or(""))?;
            let mut token = String::new();
            std::io::stdin().read_to_string(&mut token)?;
            let token = token.trim_start_matches('\u{feff}').trim().to_string();
            if token.is_empty() {
                anyhow::bail!("token on stdin is empty");
            }
            save_token(host, &token, "token", None, None)?;
            println!("stored {} token (keyring/file)", host.as_str());
            Ok(())
        }
        _ => {
            print!("{}", help());
            Ok(())
        }
    }
}

async fn login(host: &str) -> Result<()> {
    // 登录真源：sa-idp。Git 平台 OAuth 只作为身份下的附属凭据。
    let (idp_ok, subject) = sacode_runtime::git_auth::identity_login_state(None);
    if !idp_ok {
        anyhow::bail!(
            "Git platform login requires sa-idp first.\n\
             Run: sacode account login\n\
             (PAT fallback: echo <token> | sacode git auth set-token {host})"
        );
    }
    println!(
        "sa-idp session ok (subject={})",
        subject.as_deref().unwrap_or("-")
    );
    match AuthHost::parse(host)? {
        AuthHost::Github => {
            let client_id = GitHubDeviceClient::client_id_from_env()?;
            let client = GitHubDeviceClient::new(client_id);
            let session = client.start_device_flow().await?;
            println!("GitHub device authorization");
            println!("  user_code : {}", session.user_code);
            println!("  open      : {}", session.verification_uri);
            if let Some(complete) = session.verification_uri_complete.as_ref() {
                println!("  or open   : {complete}");
            }
            let _ = webbrowser::open(&session.verification_uri);
            println!("Waiting for authorization...");
            let mut token = None;
            let deadline = std::time::Instant::now() + Duration::from_secs(300);
            while std::time::Instant::now() < deadline {
                match client.poll_token(&session.device_code).await {
                    Ok(Some(t)) => {
                        token = Some(t);
                        break;
                    }
                    Ok(None) => {}
                    Err(e) => eprintln!("poll: {e}"),
                }
                tokio::time::sleep(Duration::from_secs(session.interval.max(3))).await;
            }
            let token =
                token.ok_or_else(|| anyhow::anyhow!("github device authorization timed out"))?;
            let login_name = client.github_user_login(&token).await;
            save_token(AuthHost::Github, &token, "device", login_name.clone(), None)?;
            println!(
                "GitHub authorized{}",
                login_name.map(|n| format!(" as {n}")).unwrap_or_default()
            );
            Ok(())
        }
        AuthHost::Gitee => {
            let cb = start_callback_server(None)?;
            let redirect = cb.redirect_uri.clone();
            let config = GiteeLoopbackConfig::from_env(redirect)?;
            let state = "sacode-gitee";
            let url = config.authorize_url(state);
            println!("Gitee authorize URL:\n{url}");
            let _ = webbrowser::open(&url);
            let cb_url = cb.wait_for_callback(Duration::from_secs(300))?;
            let code = parse_code_from_callback(&cb_url)?;
            let client = sacode_runtime::git_auth::GiteeOAuthClient::new(config);
            let token = client.exchange_code(&code).await?;
            save_token(AuthHost::Gitee, &token, "oauth", None, None)?;
            println!("Gitee authorized");
            Ok(())
        }
    }
}

fn parse_code_from_callback(url: &str) -> Result<String> {
    let u = url::Url::parse(url)?;
    u.query_pairs()
        .find(|(k, _)| k == "code")
        .map(|(_, v)| v.to_string())
        .ok_or_else(|| anyhow::anyhow!("gitee callback missing code"))
}

/// Re-export for credential helper tests / callers.
#[allow(dead_code)]
pub fn credential_line(username: &str, password: &str) -> String {
    credential_reply(username, password)
}

#[allow(dead_code)]
pub fn resolve_token_for_git_host(host: &str) -> Result<Option<String>> {
    match sacode_runtime::git_auth::credential::host_for_git_host(host) {
        Some(h) => Ok(token_for_host(h, None)?),
        None => Ok(None),
    }
}
