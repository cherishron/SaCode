//! Tauri sidecar host — spawn `sacode serve --port 0 --ready-file`, keep token in Rust only.

use std::path::PathBuf;
use std::process::Stdio;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use tokio::io::AsyncReadExt;
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

#[derive(Debug, Clone, Serialize)]
pub struct SidecarHandleDto {
    pub host: String,
    pub port: u16,
    pub base_url: String,
    pub pid: u32,
    pub auth_required: bool,
    /// Token is returned to the WebView only via invoke (not file). Keep this
    /// short-lived in UI memory; never write to disk.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub token: Option<String>,
}

pub struct SacodeSidecar {
    pub child: Child,
    pub ready_path: PathBuf,
    pub token: String,
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

pub async fn start_sidecar(
    binary: PathBuf,
    workspace: PathBuf,
    ready_dir: PathBuf,
    open_code_executable: Option<String>,
    open_code_args: Option<String>,
) -> anyhow::Result<SacodeSidecar> {
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

    // Health probe (token not required for /health).
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
            token: Some(self.token.clone()),
        }
    }

    pub async fn stop(&mut self) {
        let _ = std::fs::remove_file(&self.ready_path);
        let _ = self.child.start_kill();
        let _ = self.child.wait().await;
    }
}

pub async fn read_stderr_preview(child: &mut Child) -> String {
    let mut buf = [0u8; 256];
    if let Some(err) = child.stderr.as_mut() {
        if let Ok(n) = err.read(&mut buf).await {
            return String::from_utf8_lossy(&buf[..n]).to_string();
        }
    }
    String::new()
}
