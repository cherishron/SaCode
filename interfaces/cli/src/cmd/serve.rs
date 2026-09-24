use anyhow::Result;
use std::net::{IpAddr, Ipv4Addr, SocketAddr};
use std::path::PathBuf;

use sacode_runtime::daemon::{run_daemon_with_options, DaemonBindOptions};

pub async fn run(args: Vec<String>) -> Result<()> {
    let enable_acp = args.iter().any(|arg| arg == "--acp");
    let enable_lsp = args.iter().any(|arg| arg == "--lsp");

    if enable_acp && enable_lsp {
        println!(
            "Combined serve mode is scaffolded. Start ACP and LSP in separate processes for now."
        );
        return Ok(());
    }

    if enable_acp {
        println!("Use `sacode acp serve` to start ACP server.");
        return Ok(());
    }

    if enable_lsp {
        println!("Use `sacode lsp serve` to start LSP server.");
        return Ok(());
    }

    // --port=0 / --port 0 → OS-assigned loopback port (Desktop sidecar)
    let mut port: u16 = 8080;
    let mut host = "127.0.0.1".to_string();
    let mut ready_file: Option<PathBuf> = None;
    let mut nonce: Option<String> = None;
    let mut auth_token: Option<String> = None;

    let mut i = 0;
    while i < args.len() {
        let arg = args[i].as_str();
        if let Some(value) = arg.strip_prefix("--port=") {
            port = value
                .parse::<u16>()
                .map_err(|e| anyhow::anyhow!("无效端口 {value}: {e}"))?;
        } else if arg == "--port" {
            i += 1;
            let value = args
                .get(i)
                .ok_or_else(|| anyhow::anyhow!("--port 需要参数"))?;
            port = value
                .parse::<u16>()
                .map_err(|e| anyhow::anyhow!("无效端口 {value}: {e}"))?;
        } else if arg == "--port0" {
            port = 0;
        } else if let Some(value) = arg.strip_prefix("--host=") {
            host = value.to_string();
        } else if arg == "--host" {
            i += 1;
            host = args
                .get(i)
                .ok_or_else(|| anyhow::anyhow!("--host 需要参数"))?
                .clone();
        } else if let Some(value) = arg.strip_prefix("--ready-file=") {
            ready_file = Some(PathBuf::from(value));
        } else if arg == "--ready-file" {
            i += 1;
            let value = args
                .get(i)
                .ok_or_else(|| anyhow::anyhow!("--ready-file 需要参数"))?;
            ready_file = Some(PathBuf::from(value));
        } else if let Some(value) = arg.strip_prefix("--nonce=") {
            nonce = Some(value.to_string());
        } else if let Some(value) = arg.strip_prefix("--auth-token=") {
            auth_token = Some(value.to_string());
        } else if arg == "--auth-token" {
            i += 1;
            let value = args
                .get(i)
                .ok_or_else(|| anyhow::anyhow!("--auth-token 需要参数"))?;
            auth_token = Some(value.clone());
        }
        i += 1;
    }

    // Env fallback for sidecar handshake secrets/correlation values. Desktop uses
    // environment variables so neither value appears in argv or process listings.
    if nonce.is_none() {
        if let Ok(value) = std::env::var("SACODE_DAEMON_READY_NONCE") {
            if !value.trim().is_empty() {
                nonce = Some(value);
            }
        }
    }
    if auth_token.is_none() {
        if let Ok(token) = std::env::var("SACODE_DAEMON_TOKEN") {
            if !token.trim().is_empty() {
                auth_token = Some(token);
            }
        }
    }

    let ip: IpAddr = host
        .parse()
        .map_err(|e| anyhow::anyhow!("无效 host {host}: {e}"))?;
    let addr = SocketAddr::new(ip, port);

    run_daemon_with_options(DaemonBindOptions {
        addr,
        ready_file,
        nonce,
        auth_token,
    })
    .await;
    Ok(())
}

#[allow(dead_code)]
fn default_loopback() -> IpAddr {
    IpAddr::V4(Ipv4Addr::LOCALHOST)
}
