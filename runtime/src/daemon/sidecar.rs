//! Daemon bind + Desktop sidecar ready-file handshake.

use std::net::SocketAddr;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};

/// Ready-file payload written by `sacode serve --port 0 --ready-file <path>`.
///
/// **Security**：bearer token **写入 ready-file**（token 字段）。D9 L1 下 token 已由
/// `run_daemon_with_options` 自动生成并注入 `SACODE_DAEMON_TOKEN`，本地受信客户端
/// （Desktop sidecar / 同一用户进程）经 ready-file 或 env 取得 token。
/// 循环口令绝不进入 argv，避免出现在进程列表。
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
    /// Bearer token for optional daemon auth.
    /// 缺省时由 `run_daemon_with_options` 自动生成随机 token（D9 L1），
    /// 保证 daemon 从不以无鉴权状态运行。
    pub auth_token: Option<String>,
    /// 显式降级：允许以「无鉴权」开放模式运行（仅用于本机调试/测试）。
    /// `true` 且 `auth_token` 为空 → 不自动生成 token，daemon 开放。
    /// 缺省 `false` = 始终自动 token，杜绝误开。
    pub require_auth: bool,
}

impl Default for DaemonBindOptions {
    fn default() -> Self {
        Self {
            addr: SocketAddr::from(([127, 0, 0, 1], 8080)),
            ready_file: None,
            nonce: None,
            auth_token: None,
            require_auth: true,
        }
    }
}

/// 生成高熵随机 daemon token（D9 L1）。
///
/// 使用 OS 级 CSPRNG（`rand::rngs::OsRng`）采样 48 个 url-safe 字符
/// （字母数字 + `-` / `_`），熵 ≈ 285 bit，满足鉴权 token 强度且便于在 env / 进程间传递。
fn generate_daemon_token() -> String {
    use rand::distributions::Alphanumeric;
    use rand::Rng;
    rand::rngs::OsRng
        .sample_iter(&Alphanumeric)
        .take(48)
        .map(|c| {
            let c = c as char;
            match c {
                '+' => '-',
                '/' => '_',
                _ => c,
            }
        })
        .collect()
}

/// Bind listener; if port is 0, resolve OS-assigned port, write ready-file, serve.
pub async fn run_daemon_with_options(options: DaemonBindOptions) {
    // D9 L1：未显式提供 token 时，若 require_auth（默认 true）则自动生成随机 token。
    // 仅当显式 require_auth=false（--open-access）才跳过，保证 daemon 从不以无鉴权状态运行。
    let effective_token: Option<String> = {
        let provided = options.auth_token.as_ref().map(|t| t.trim().to_string());
        match provided {
            Some(token) if !token.is_empty() => Some(token),
            _ if options.require_auth => Some(generate_daemon_token()),
            _ => None,
        }
    };
    let auth_required = effective_token.is_some();

    if let Some(token) = effective_token.clone() {
        std::env::set_var("SACODE_DAEMON_TOKEN", token);
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
    fn generated_token_is_strong_and_url_safe() {
        let token = generate_daemon_token();
        assert_eq!(token.len(), 48, "48 个 url-safe 字符（OsRng Alphanumeric）");
        assert!(token
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_'));
        // 两次生成应不同（CSPRNG）
        assert_ne!(generate_daemon_token(), generate_daemon_token());
    }

    #[test]
    fn default_options_authenticates_even_without_explicit_token() {
        // D9 L1 核心行为：require_auth=true（default）且无显式 token → 自动生成。
        let opts = DaemonBindOptions::default();
        assert!(opts.require_auth, "default 应 require_auth=true");
        assert!(opts.auth_token.is_none(), "default 不带显式 token");
        // run_daemon_with_options 会在 require_auth && auth_token==None 时生成。
        // 这里验证结构性不变量；实际端到端在集成测试覆盖。
    }

    #[test]
    fn open_access_mode_marks_require_auth_false() {
        // 显式 --open-access → require_auth=false（CLI 层已映射）
        let opts = DaemonBindOptions {
            require_auth: false,
            ..DaemonBindOptions::default()
        };
        assert!(!opts.require_auth, "显式降级标记必须生效");
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
