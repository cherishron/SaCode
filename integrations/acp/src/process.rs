use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::Arc;

use anyhow::Result;
use tokio::io::AsyncReadExt;
use tokio::process::{Child, Command};

use crate::client::{AcpClient, AcpClientEvent, ClientConfig, IncomingRequestHandler};
use crate::protocol::{JsonRpcError, JsonRpcId, JsonRpcResponse};

#[derive(Debug, Clone)]
pub struct ProcessConfig {
    pub executable: PathBuf,
    pub args: Vec<String>,
    pub cwd: Option<PathBuf>,
    pub env_clear: bool,
    pub env: Vec<(String, String)>,
    pub client: ClientConfig,
}

impl ProcessConfig {
    pub fn new(executable: impl Into<PathBuf>) -> Self {
        Self {
            executable: executable.into(),
            args: Vec::new(),
            cwd: None,
            env_clear: false,
            env: Vec::new(),
            client: ClientConfig::default(),
        }
    }

    pub fn with_args(mut self, args: impl IntoIterator<Item = impl Into<String>>) -> Self {
        self.args = args.into_iter().map(Into::into).collect();
        self
    }

    pub fn with_cwd(mut self, cwd: impl Into<PathBuf>) -> Self {
        self.cwd = Some(cwd.into());
        self
    }
}

#[derive(Debug)]
pub enum SpawnError {
    Io(std::io::Error),
    Message(String),
}

impl std::fmt::Display for SpawnError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Io(e) => write!(f, "failed to spawn ACP process: {e}"),
            Self::Message(m) => f.write_str(m),
        }
    }
}

impl std::error::Error for SpawnError {}

impl From<std::io::Error> for SpawnError {
    fn from(value: std::io::Error) -> Self {
        Self::Io(value)
    }
}

/// Managed ACP agent subprocess with stdio JSON-RPC client.
pub struct AcpProcess {
    child: Child,
    client: Arc<AcpClient>,
    events: tokio::sync::mpsc::Receiver<AcpClientEvent>,
    stderr_task: tokio::task::JoinHandle<String>,
}

impl AcpProcess {
    pub async fn spawn(
        config: ProcessConfig,
        handler: Option<Arc<dyn IncomingRequestHandler>>,
    ) -> Result<Self, SpawnError> {
        if !config.executable.exists() && which_missing(&config.executable) {
            return Err(SpawnError::Message(format!(
                "ACP executable not found: {}",
                config.executable.display()
            )));
        }

        let mut cmd = Command::new(&config.executable);
        cmd.args(&config.args)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true);
        if let Some(cwd) = &config.cwd {
            cmd.current_dir(cwd);
        }
        if config.env_clear {
            cmd.env_clear();
        }
        for (k, v) in &config.env {
            cmd.env(k, v);
        }
        #[cfg(windows)]
        {
            // CREATE_NO_WINDOW = 0x08000000 — avoid console flash
            cmd.creation_flags(0x08000000);
        }

        let mut child = cmd.spawn()?;
        let stdin = child
            .stdin
            .take()
            .ok_or_else(|| SpawnError::Message("ACP child stdin unavailable".into()))?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| SpawnError::Message("ACP child stdout unavailable".into()))?;
        let mut stderr = child
            .stderr
            .take()
            .ok_or_else(|| SpawnError::Message("ACP child stderr unavailable".into()))?;

        // Stderr collector — redacted buffer for diagnostics.
        let stderr_task = tokio::spawn(async move {
            let mut buf = Vec::new();
            let mut chunk = [0u8; 4096];
            loop {
                match stderr.read(&mut chunk).await {
                    Ok(0) | Err(_) => break,
                    Ok(n) => buf.extend_from_slice(&chunk[..n]),
                }
            }
            redact_stderr(&String::from_utf8_lossy(&buf))
        });

        struct StdinWriter(tokio::process::ChildStdin);
        impl tokio::io::AsyncWrite for StdinWriter {
            fn poll_write(
                self: std::pin::Pin<&mut Self>,
                cx: &mut std::task::Context<'_>,
                buf: &[u8],
            ) -> std::task::Poll<Result<usize, std::io::Error>> {
                std::pin::Pin::new(&mut self.get_mut().0).poll_write(cx, buf)
            }
            fn poll_flush(
                self: std::pin::Pin<&mut Self>,
                cx: &mut std::task::Context<'_>,
            ) -> std::task::Poll<Result<(), std::io::Error>> {
                std::pin::Pin::new(&mut self.get_mut().0).poll_flush(cx)
            }
            fn poll_shutdown(
                self: std::pin::Pin<&mut Self>,
                cx: &mut std::task::Context<'_>,
            ) -> std::task::Poll<Result<(), std::io::Error>> {
                std::pin::Pin::new(&mut self.get_mut().0).poll_shutdown(cx)
            }
        }

        let client_config = config.client.clone();
        let (client, events) =
            AcpClient::spawn(stdout, Box::new(StdinWriter(stdin)), handler, client_config);

        Ok(Self {
            child,
            client,
            events,
            stderr_task,
        })
    }

    pub fn client(&self) -> Arc<AcpClient> {
        self.client.clone()
    }

    pub fn events_mut(&mut self) -> &mut tokio::sync::mpsc::Receiver<AcpClientEvent> {
        &mut self.events
    }

    pub fn id(&self) -> Option<u32> {
        self.child.id()
    }

    /// Graceful cancel: best-effort session/cancel notify then kill process tree.
    pub async fn cancel(&mut self, session_id: Option<&str>) -> Result<()> {
        if let Some(session_id) = session_id {
            let _ = self
                .client
                .notify(
                    "session/cancel",
                    Some(serde_json::json!({ "sessionId": session_id })),
                )
                .await;
        }
        self.kill().await
    }

    pub async fn kill(&mut self) -> Result<()> {
        #[cfg(windows)]
        {
            if let Some(pid) = self.child.id() {
                // Best-effort process tree kill on Windows.
                let _ = std::process::Command::new("taskkill")
                    .args(["/PID", &pid.to_string(), "/T", "/F"])
                    .stdout(Stdio::null())
                    .stderr(Stdio::null())
                    .status();
            }
        }
        let _ = self.child.start_kill();
        let _ = self.child.wait().await;
        Ok(())
    }

    /// Wait for exit; returns redacted stderr.
    pub async fn wait_stderr(&mut self) -> String {
        let _ = self.child.wait().await;
        let handle =
            std::mem::replace(&mut self.stderr_task, tokio::spawn(async { String::new() }));
        handle.await.unwrap_or_default()
    }
}

fn which_missing(path: &Path) -> bool {
    // Path doesn't exist as given; if it has no parent component it may still be on PATH.
    if path.components().count() > 1 {
        return true;
    }
    false
}

/// Redact likely secrets from stderr before logging/diagnostics.
pub fn redact_stderr(input: &str) -> String {
    let mut out = input.to_string();
    for key in ["sk-", "sa-", "Bearer ", "api_key=", "token="] {
        if let Some(pos) = out.find(key) {
            // Mask following token-ish characters.
            let start = pos + key.len();
            let rest = out[start..].to_string();
            let token_len: usize = rest
                .chars()
                .take_while(|c| c.is_ascii_alphanumeric() || *c == '-' || *c == '_' || *c == '.')
                .count();
            if token_len > 4 {
                let masked = format!("****{}", &rest[rest.len().saturating_sub(4)..]);
                out.replace_range(start..start + token_len, &masked);
            }
        }
    }
    // Never retain raw permission payload dumps beyond a cap.
    if out.len() > 8_000 {
        out.truncate(8_000);
        out.push_str("\n...[stderr truncated]");
    }
    out
}

/// Helper error response for process-layer failures surfaced to daemon.
pub fn process_failure_response(id: JsonRpcId, message: impl Into<String>) -> JsonRpcResponse {
    JsonRpcResponse::failure(
        id,
        JsonRpcError {
            code: -32002,
            message: message.into(),
            data: None,
        },
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn redact_stderr_masks_tokens() {
        let input = "auth failed for sa-super-secret-key-9999 and sk-abcdef123456";
        let redacted = redact_stderr(input);
        assert!(!redacted.contains("sa-super-secret-key-9999"));
        assert!(!redacted.contains("sk-abcdef123456"));
        assert!(redacted.contains("****"));
    }

    #[test]
    fn spawn_missing_executable_errors() {
        let rt = tokio::runtime::Runtime::new().unwrap();
        rt.block_on(async {
            let cfg = ProcessConfig::new("definitely-not-an-acp-agent-binary-xyz");
            match AcpProcess::spawn(cfg, None).await {
                Ok(_) => panic!("expected spawn failure for missing binary"),
                Err(err) => {
                    assert!(
                        err.to_string().contains("not found") || err.to_string().contains("failed")
                    );
                }
            }
        });
    }
}
