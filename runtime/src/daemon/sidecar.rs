//! Daemon bind + Desktop sidecar ready-file handshake.

use std::net::SocketAddr;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};

/// Ready-file payload written by `sacode serve --port 0 --ready-file <path>`.
///
/// **Security**: bearer token is NEVER written here. Clients that need auth
/// receive the token out-of-band (Desktop Rust shell env / pipe).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DaemonReadyInfo {
    pub schema_version: u32,
    pub host: String,
    pub port: u16,
    pub pid: u32,
    pub version: String,
    pub protocol_version: u32,
    pub base_url: String,
    /// Instance nonce for sidecar correlation (optional).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub nonce: Option<String>,
    /// Whether auth token is required (token itself is not included).
    #[serde(default)]
    pub auth_required: bool,
}

impl DaemonReadyInfo {
    pub fn from_addr(addr: SocketAddr, auth_required: bool, nonce: Option<String>) -> Self {
        let host = addr.ip().to_string();
        let port = addr.port();
        Self {
            schema_version: 1,
            host: host.clone(),
            port,
            pid: std::process::id(),
            version: env!("CARGO_PKG_VERSION").to_string(),
            protocol_version: sacode_kernel::TASK_PROTOCOL_VERSION,
            base_url: format!("http://{host}:{port}"),
            nonce,
            auth_required,
        }
    }

    pub fn write_to(&self, path: &std::path::Path) -> std::io::Result<()> {
        if let Some(parent) = path.parent() {
            if !parent.as_os_str().is_empty() {
                std::fs::create_dir_all(parent)?;
            }
        }
        let json = serde_json::to_string_pretty(self)
            .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e))?;
        std::fs::write(path, json)
    }
}

#[derive(Debug, Clone)]
pub struct DaemonBindOptions {
    /// Requested listen address. Port 0 = OS-assigned.
    pub addr: SocketAddr,
    /// Optional ready-file path for Desktop sidecar handshake.
    pub ready_file: Option<PathBuf>,
    /// Optional instance nonce echoed into ready-file.
    pub nonce: Option<String>,
    /// Bearer token for optional daemon auth. Not written to ready-file.
    pub auth_token: Option<String>,
}

impl Default for DaemonBindOptions {
    fn default() -> Self {
        Self {
            addr: SocketAddr::from(([127, 0, 0, 1], 8080)),
            ready_file: None,
            nonce: None,
            auth_token: None,
        }
    }
}

/// Bind listener; if port is 0, resolve OS-assigned port, write ready-file, serve.
pub async fn run_daemon_with_options(options: DaemonBindOptions) {
    let auth_required = options
        .auth_token
        .as_ref()
        .map(|t| !t.trim().is_empty())
        .unwrap_or(false);

    if let Some(token) = options.auth_token.clone() {
        if !token.trim().is_empty() {
            std::env::set_var("SACODE_DAEMON_TOKEN", token.trim());
        }
    }

    let app = super::create_daemon().await;

    let listener = match tokio::net::TcpListener::bind(options.addr).await {
        Ok(listener) => listener,
        Err(error) => {
            eprintln!("daemon bind {} 失败: {error}", options.addr);
            return;
        }
    };

    let local = match listener.local_addr() {
        Ok(addr) => addr,
        Err(error) => {
            eprintln!("daemon local_addr 失败: {error}");
            return;
        }
    };

    let info = DaemonReadyInfo::from_addr(local, auth_required, options.nonce.clone());

    // Always print actual bind address on stdout for shell clients.
    println!("{}", info.base_url);
    if auth_required {
        println!("auth_required=true");
    }

    if let Some(path) = &options.ready_file {
        match info.write_to(path) {
            Ok(()) => {
                eprintln!("daemon ready-file: {}", path.display());
            }
            Err(error) => {
                eprintln!("daemon ready-file 写入失败 {}: {error}", path.display());
            }
        }
    } else {
        eprintln!("SaCode daemon listening {}", info.base_url);
    }

    if let Err(error) = axum::serve(listener, app).await {
        eprintln!("daemon serve 失败: {error}");
    }

    // Best-effort cleanup of ready-file on exit.
    if let Some(path) = &options.ready_file {
        let _ = std::fs::remove_file(path);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ready_info_from_addr_excludes_token_fields() {
        let addr: SocketAddr = "127.0.0.1:0".parse().unwrap();
        let info = DaemonReadyInfo::from_addr(addr, false, Some("nonce-1".into()));
        assert_eq!(info.host, "127.0.0.1");
        assert_eq!(info.schema_version, 1);
        assert_eq!(info.nonce.as_deref(), Some("nonce-1"));
        let json = serde_json::to_string(&info).unwrap();
        assert!(!json.contains("token"));
        assert!(!json.contains("secret"));
        assert!(json.contains("auth_required"));
    }

    #[test]
    fn ready_info_write_roundtrip() {
        let tmp = tempfile::tempdir().unwrap();
        let path = tmp.path().join("nested/ready.json");
        let addr: SocketAddr = "127.0.0.1:34567".parse().unwrap();
        let info = DaemonReadyInfo::from_addr(addr, true, None);
        info.write_to(&path).unwrap();
        let raw = std::fs::read_to_string(&path).unwrap();
        let parsed: DaemonReadyInfo = serde_json::from_str(&raw).unwrap();
        assert_eq!(parsed.port, 34567);
        assert_eq!(parsed.base_url, "http://127.0.0.1:34567");
        assert!(parsed.auth_required);
        assert!(parsed.pid > 0);
    }
}
