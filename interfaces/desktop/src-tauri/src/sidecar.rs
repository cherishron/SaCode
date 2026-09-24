//! Tauri sidecar host — spawn `sacode serve --port 0 --ready-file`, keep token in Rust only.

use std::path::PathBuf;
use std::process::Stdio;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use tokio::process::{Child, Command};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DaemonReadyInfo {
    pub schema_version: u32,
    pub host: String,
    pub port: u16,
    pub pid: u32,
    pub version: String,
    pub protocol_version: u32,
    pub base_url: String,
    #[serde(default)]
    pub nonce: Option<String>,
    #[serde(default)]
    pub auth_required: bool,
}

/// WebView-facing handle metadata. **Never includes bearer token.**
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SidecarHandleDto {
    pub host: String,
    pub port: u16,
    pub base_url: String,
    pub pid: u32,
    pub auth_required: bool,
    pub version: String,
    pub workspace: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct DaemonProxyResponse {
    pub status: u16,
    pub ok: bool,
    pub body: String,
}

pub struct SacodeSidecar {
    pub child: Child,
    pub ready_path: PathBuf,
    pub workspace: PathBuf,
    token: String,
    pub info: DaemonReadyInfo,
}

fn random_token() -> String {
    use rand::RngCore;
    let mut buf = [0u8; 24];
    rand::thread_rng().fill_bytes(&mut buf);
    buf.iter().map(|b| format!("{b:02x}")).collect()
}

fn random_nonce() -> String {
    use rand::RngCore;
    let mut buf = [0u8; 16];
    rand::thread_rng().fill_bytes(&mut buf);
    buf.iter().map(|b| format!("{b:02x}")).collect()
}

/// Allow only relative daemon API paths (no scheme/host) to avoid SSRF via IPC.
pub fn validate_proxy_path(path: &str) -> Result<String, String> {
    let p = path.trim();
    if p.is_empty() {
        return Err("daemon path is empty".into());
    }
    if !p.starts_with('/') {
        return Err("daemon path must start with /".into());
    }
    if p.contains("://") || p.contains('\\') || p.contains("..") {
        return Err("daemon path must be a relative API path".into());
    }
    if let Some(host) = p.split('/').nth(1) {
        if host.contains(':') && !host.contains('%') {
            // reject /host:port/... style
            return Err("daemon path must not embed host:port".into());
        }
    }
    Ok(p.to_string())
}

pub async fn start_sidecar(
    binary: PathBuf,
    workspace: PathBuf,
    ready_dir: PathBuf,
    open_code_executable: Option<String>,
    open_code_args: Option<String>,
) -> anyhow::Result<SacodeSidecar> {
    if !workspace.is_dir() {
        anyhow::bail!("workspace is not a directory: {}", workspace.display());
    }
    let workspace = std::fs::canonicalize(&workspace)?;
    std::fs::create_dir_all(&ready_dir)?;
    let ready_path = ready_dir.join("ready.json");
    let _ = std::fs::remove_file(&ready_path);
    let nonce = random_nonce();
    let token = random_token();

    let mut cmd = Command::new(&binary);
    cmd.arg("serve")
        .arg("--port")
        .arg("0")
        .arg("--ready-file")
        .arg(&ready_path)
        .arg("--nonce")
        .arg(&nonce)
        .current_dir(&workspace)
        .env("SACODE_DAEMON_TOKEN", &token)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .kill_on_drop(true);
    if let Some(exe) = open_code_executable.filter(|s| !s.trim().is_empty()) {
        cmd.env("SACODE_OPENCODE_EXECUTABLE", exe);
        cmd.env(
            "SACODE_OPENCODE_ARGS",
            open_code_args.unwrap_or_else(|| "x opencode-ai acp".into()),
        );
    }

    let child = cmd.spawn()?;

    let deadline = Instant::now() + Duration::from_secs(20);
    let mut info = None;
    while Instant::now() < deadline {
        tokio::time::sleep(Duration::from_millis(200)).await;
        if let Ok(raw) = std::fs::read_to_string(&ready_path) {
            if let Ok(parsed) = serde_json::from_str::<DaemonReadyInfo>(&raw) {
                if parsed.port != 0 {
                    info = Some(parsed);
                    break;
                }
            }
        }
    }
    let info = info.ok_or_else(|| anyhow::anyhow!("ready-file timeout: {:?}", ready_path))?;
    if let Some(n) = info.nonce.as_deref() {
        if n != nonce {
            anyhow::bail!("ready-file nonce mismatch");
        }
    }

    let client = reqwest::Client::new();
    let health: serde_json::Value = client
        .get(format!("{}/health", info.base_url))
        .timeout(Duration::from_secs(3))
        .send()
        .await?
        .json()
        .await?;
    if health.get("status").and_then(|v| v.as_str()) != Some("healthy") {
        anyhow::bail!("sidecar health failed: {health}");
    }

    Ok(SacodeSidecar {
        child,
        ready_path,
        workspace,
        token,
        info,
    })
}

impl SacodeSidecar {
    pub fn handle_dto(&self) -> SidecarHandleDto {
        SidecarHandleDto {
            host: self.info.host.clone(),
            port: self.info.port,
            base_url: self.info.base_url.clone(),
            pid: self.info.pid,
            auth_required: self.info.auth_required,
            version: self.info.version.clone(),
            workspace: self.workspace.to_string_lossy().to_string(),
        }
    }

    pub fn token(&self) -> &str {
        &self.token
    }

    pub fn base_url(&self) -> &str {
        &self.info.base_url
    }

    /// HTTP call to local daemon; Authorization attached here, never in WebView.
    pub async fn proxy(
        &self,
        method: &str,
        path: &str,
        body: Option<String>,
    ) -> Result<DaemonProxyResponse, String> {
        let path = validate_proxy_path(path)?;
        let method = match method.to_ascii_uppercase().as_str() {
            "GET" => reqwest::Method::GET,
            "POST" => reqwest::Method::POST,
            other => return Err(format!("unsupported method: {other}")),
        };
        let client = reqwest::Client::new();
        let url = format!("{}{}", self.base_url(), path);
        let mut req = client.request(method, url).timeout(Duration::from_secs(60));
        if !self.token.is_empty() {
            req = req.bearer_auth(&self.token);
        }
        if let Some(b) = body {
            req = req
                .header(reqwest::header::CONTENT_TYPE, "application/json")
                .body(b);
        }
        let resp = req.send().await.map_err(|e| e.to_string())?;
        let status = resp.status().as_u16();
        let text = resp.text().await.map_err(|e| e.to_string())?;
        Ok(DaemonProxyResponse {
            status,
            ok: (200..300).contains(&status),
            body: text,
        })
    }

    pub async fn stop(&mut self) {
        let _ = std::fs::remove_file(&self.ready_path);
        let _ = self.child.start_kill();
        let _ = self.child.wait().await;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validate_proxy_path_accepts_api_paths() {
        assert_eq!(validate_proxy_path("/health").unwrap(), "/health");
        assert_eq!(
            validate_proxy_path("/task/abc/status").unwrap(),
            "/task/abc/status"
        );
        assert_eq!(
            validate_proxy_path("/api/stream?task_id=x").unwrap(),
            "/api/stream?task_id=x"
        );
    }

    #[test]
    fn validate_proxy_path_rejects_absolute_and_traversal() {
        assert!(validate_proxy_path("").is_err());
        assert!(validate_proxy_path("health").is_err());
        assert!(validate_proxy_path("http://evil/health").is_err());
        assert!(validate_proxy_path("/../etc/passwd").is_err());
        assert!(validate_proxy_path("/127.0.0.1:8090/v1").is_err());
    }

    #[test]
    fn sidecar_dto_never_serializes_token() {
        let dto = SidecarHandleDto {
            host: "127.0.0.1".into(),
            port: 1,
            base_url: "http://127.0.0.1:1".into(),
            pid: 2,
            auth_required: true,
            version: "1.1.1".into(),
            workspace: "C:\\workspace".into(),
        };
        let json = serde_json::to_string(&dto).unwrap();
        assert!(!json.contains("token"));
        assert!(json.contains("auth_required"));
    }
}
