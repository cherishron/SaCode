//! ACP Agent Backend adapter (M4 scaffold).
//!
//! Uses `sacode-acp-client` to talk to external Agents (OpenCode) over stdio.
//! Does **not** consume TaskQueue — daemon executor remains the lifecycle owner.

use std::path::PathBuf;
use std::sync::Arc;

use sacode_acp_client::{AcpProcess, ClientConfig, ProcessConfig};
use sacode_kernel::{
    AgentBackendHealth, AgentBackendId, AgentBackendKind, AgentCapabilities, AgentDescriptor,
    BackendFailureCode,
};

use super::BackendTaskContext;

/// Configuration for an ACP-backed Agent (user-level trusted config only).
#[derive(Debug, Clone)]
pub struct AcpBackendConfig {
    pub id: AgentBackendId,
    pub display_name: String,
    pub executable: PathBuf,
    pub args: Vec<String>,
    pub cwd: Option<PathBuf>,
}

impl AcpBackendConfig {
    pub fn opencode(executable: impl Into<PathBuf>) -> Self {
        Self {
            id: AgentBackendId::new("opencode"),
            display_name: "OpenCode".to_string(),
            executable: executable.into(),
            args: Vec::new(),
            cwd: None,
        }
    }

    pub fn descriptor(&self, health: AgentBackendHealth) -> AgentDescriptor {
        AgentDescriptor {
            id: self.id.clone(),
            display_name: self.display_name.clone(),
            kind: AgentBackendKind::Acp,
            health,
            capabilities: AgentCapabilities {
                streaming: true,
                tool_calls: true,
                approvals: true,
                cancel: true,
                sessions: true,
                modes: vec!["build".into()],
                notes: Some("ACP stdio backend".into()),
            },
            executable: Some(self.executable.display().to_string()),
            version: None,
            diagnostic: None,
        }
    }

    pub fn process_config(&self) -> ProcessConfig {
        let mut cfg = ProcessConfig::new(&self.executable).with_args(self.args.clone());
        if let Some(cwd) = &self.cwd {
            cfg = cfg.with_cwd(cwd.clone());
        }
        cfg.client = ClientConfig::default();
        cfg
    }
}

/// ACP process-backed Agent handle.
pub struct AcpProcessBackend {
    config: AcpBackendConfig,
}

impl AcpProcessBackend {
    pub fn new(config: AcpBackendConfig) -> Self {
        Self { config }
    }

    pub fn id(&self) -> &AgentBackendId {
        &self.config.id
    }

    pub fn accepts(&self, ctx: &BackendTaskContext) -> bool {
        ctx.backend_id == self.config.id && !ctx.prompt.trim().is_empty()
    }

    /// Probe: spawn process and run initialize handshake.
    pub async fn probe(&self) -> Result<AgentDescriptor, BackendFailureCode> {
        let proc_cfg = self.config.process_config();
        let mut process = AcpProcess::spawn(proc_cfg, None)
            .await
            .map_err(|_| BackendFailureCode::BackendUnavailable)?;
        let client = process.client();
        let result =
            tokio::time::timeout(std::time::Duration::from_secs(10), client.initialize()).await;
        let health = match result {
            Ok(Ok(_caps)) => AgentBackendHealth::Ready,
            Ok(Err(_)) => AgentBackendHealth::Degraded,
            Err(_) => AgentBackendHealth::Degraded,
        };
        let _ = process.kill().await;
        Ok(self.config.descriptor(health))
    }

    /// Execute one ACP prompt under daemon executor ownership.
    ///
    /// Maps ACP notifications via `opencode_map` and emits SSE-compatible
    /// events on the provided bus. Lifecycle (cancel/terminal persist) stays
    /// in TaskExecutor.
    pub async fn execute_prompt(
        &self,
        task_id: &str,
        prompt: &str,
        mode: sacode_kernel::ExecutionMode,
        event_bus: Option<&tokio::sync::broadcast::Sender<crate::executor::ExecutorEvent>>,
    ) -> AcpExecutionOutcome {
        let backend_id = self.config.id.clone();
        let started = std::time::Instant::now();
        let mut process = match AcpProcess::spawn(self.config.process_config(), None).await {
            Ok(p) => p,
            Err(err) => {
                let message = format!("failed to spawn ACP backend {}: {err}", backend_id);
                emit_named(
                    event_bus,
                    task_id,
                    "task_failed",
                    serde_json::json!({
                        "code": "backend/unavailable",
                        "backend_id": backend_id.as_str(),
                        "message": message,
                    }),
                );
                return AcpExecutionOutcome::failed(
                    task_id,
                    message,
                    started.elapsed().as_millis() as u64,
                );
            }
        };

        let client = process.client();
        if let Err(err) = client.initialize().await {
            let message = format!("ACP initialize failed: {err}");
            let _ = process.kill().await;
            emit_named(
                event_bus,
                task_id,
                "task_failed",
                serde_json::json!({
                    "code": "backend/handshake_failed",
                    "backend_id": backend_id.as_str(),
                    "message": message,
                }),
            );
            return AcpExecutionOutcome::failed(
                task_id,
                message,
                started.elapsed().as_millis() as u64,
            );
        }

        let session = match client
            .request(
                sacode_acp_client::METHOD_SESSION_NEW,
                Some(serde_json::json!({
                    "cwd": self.config.cwd.clone()
                        .map(|p| p.display().to_string())
                        .unwrap_or_else(|| ".".to_string()),
                    // OpenCode 1.18+ requires mcpServers array (may be empty)
                    "mcpServers": [],
                })),
            )
            .await
        {
            Ok(value) => value
                .get("sessionId")
                .and_then(|v| v.as_str())
                .or_else(|| value.get("id").and_then(|v| v.as_str()))
                .map(str::to_string)
                .unwrap_or_else(|| format!("acp-{task_id}")),
            Err(err) => {
                let message = format!("ACP session/new failed: {err}");
                let _ = process.kill().await;
                emit_named(
                    event_bus,
                    task_id,
                    "task_failed",
                    serde_json::json!({
                        "code": "backend/protocol_error",
                        "message": message,
                    }),
                );
                return AcpExecutionOutcome::failed(
                    task_id,
                    message,
                    started.elapsed().as_millis() as u64,
                );
            }
        };

        emit_named(
            event_bus,
            task_id,
            "backend_session_started",
            serde_json::json!({
                "task_id": task_id,
                "backend_id": backend_id.as_str(),
                "agent_session_id": session,
            }),
        );

        let prompt_params =
            sacode_acp_client::prompt_params(&session, prompt, Some(mode.to_string().as_str()));

        let prompt_future = client.request(
            sacode_acp_client::METHOD_SESSION_PROMPT,
            Some(prompt_params),
        );
        tokio::pin!(prompt_future);

        let mut summary: Option<String> = None;
        let mut failed: Option<String> = None;
        let mut output_parts: Vec<String> = Vec::new();
        let deadline = std::time::Duration::from_secs(300);

        let outcome = tokio::time::timeout(deadline, async {
            loop {
                tokio::select! {
                    result = &mut prompt_future => {
                        match result {
                            Ok(value) => {
                                if let Some(s) = value.get("summary").and_then(|v| v.as_str()) {
                                    summary = Some(s.to_string());
                                }
                                if summary.is_none() && !output_parts.is_empty() {
                                    summary = Some(output_parts.join(""));
                                }
                                if summary.is_none() {
                                    summary = Some(format!("ACP task completed via {}", backend_id));
                                }
                                break;
                            }
                            Err(err) => {
                                failed = Some(format!("ACP session/prompt failed: {err}"));
                                break;
                            }
                        }
                    }
                    maybe_event = process.events_mut().recv() => {
                        match maybe_event {
                            Some(event) => {
                                let projected = super::opencode_map::project_acp_client_event(
                                    &event,
                                    task_id,
                                    &backend_id,
                                );
                                for p in projected {
                                    if p.sse_event == "backend_event_unmapped" {
                                        emit_named(event_bus, task_id, &p.sse_event, p.data.clone());
                                        continue;
                                    }
                                    if let AgentEvent::TextDelta { text } = &p.agent_event {
                                        output_parts.push(text.clone());
                                    }
                                    if let AgentEvent::Completed { summary: s } = &p.agent_event {
                                        if s.is_some() {
                                            summary = s.clone();
                                        }
                                    }
                                    if let AgentEvent::Failed { safe_message, .. } = &p.agent_event {
                                        failed = Some(safe_message.clone());
                                    }
                                    emit_named(event_bus, task_id, &p.sse_event, p.data.clone());
                                }
                                if failed.is_some() {
                                    break;
                                }
                            }
                            None => {
                                if failed.is_none() {
                                    failed = Some("ACP agent closed before completion".to_string());
                                }
                                break;
                            }
                        }
                    }
                }
            }
        })
        .await;

        if outcome.is_err() {
            failed = Some(format!("ACP task timed out after {deadline:?}"));
        }

        let _ = process.kill().await;
        let duration_ms = started.elapsed().as_millis() as u64;

        if let Some(err) = failed {
            emit_named(
                event_bus,
                task_id,
                "task_failed",
                serde_json::json!({
                    "code": "backend/protocol_error",
                    "backend_id": backend_id.as_str(),
                    "message": err,
                }),
            );
            AcpExecutionOutcome::failed(task_id, err, duration_ms)
        } else {
            let text = summary.unwrap_or_else(|| "ACP task completed".to_string());
            emit_named(
                event_bus,
                task_id,
                "task_completed",
                serde_json::json!({
                    "task_id": task_id,
                    "backend_id": backend_id.as_str(),
                    "summary": text,
                }),
            );
            AcpExecutionOutcome::success(task_id, text, duration_ms)
        }
    }
}

use sacode_kernel::AgentEvent;

fn emit_named(
    bus: Option<&tokio::sync::broadcast::Sender<crate::executor::ExecutorEvent>>,
    task_id: &str,
    event_type: &str,
    data: serde_json::Value,
) {
    if let Some(bus) = bus {
        let _ = bus.send(crate::executor::ExecutorEvent {
            task_id: task_id.to_string(),
            event_type: event_type.to_string(),
            data,
        });
    }
}

/// Result of one ACP backend execution for TaskExecutor to persist.
#[derive(Debug, Clone)]
pub struct AcpExecutionOutcome {
    pub task_id: String,
    pub success: bool,
    pub output: Option<String>,
    pub error: Option<String>,
    pub duration_ms: u64,
}

impl AcpExecutionOutcome {
    pub fn success(task_id: &str, output: String, duration_ms: u64) -> Self {
        Self {
            task_id: task_id.to_string(),
            success: true,
            output: Some(output),
            error: None,
            duration_ms,
        }
    }

    pub fn failed(task_id: &str, error: String, duration_ms: u64) -> Self {
        Self {
            task_id: task_id.to_string(),
            success: false,
            output: None,
            error: Some(error),
            duration_ms,
        }
    }
}

/// Shared handle type for registry.
pub type SharedAcpBackend = Arc<AcpProcessBackend>;

#[cfg(test)]
mod tests {
    use super::*;
    use sacode_kernel::ExecutionMode;

    #[test]
    fn opencode_config_defaults() {
        let cfg = AcpBackendConfig::opencode("opencode");
        assert_eq!(cfg.id.as_str(), "opencode");
        let desc = cfg.descriptor(AgentBackendHealth::Ready);
        assert_eq!(desc.kind, AgentBackendKind::Acp);
        assert!(desc.capabilities.approvals);
        assert!(desc.executable.as_deref().unwrap().contains("opencode"));
    }

    #[test]
    fn accepts_only_matching_backend() {
        let backend = AcpProcessBackend::new(AcpBackendConfig::opencode("opencode"));
        let ok = BackendTaskContext {
            task_id: "t".into(),
            prompt: "hi".into(),
            mode: ExecutionMode::Build,
            backend_id: AgentBackendId::new("opencode"),
            session_id: None,
            workspace_root: ".".into(),
        };
        assert!(backend.accepts(&ok));
        let wrong = BackendTaskContext {
            backend_id: AgentBackendId::sacode(),
            ..ok
        };
        assert!(!backend.accepts(&wrong));
    }

    #[tokio::test]
    async fn execute_prompt_missing_binary_fails_closed() {
        let backend = AcpProcessBackend::new(AcpBackendConfig::opencode(
            "definitely-not-opencode-binary-xyz",
        ));
        let outcome = backend
            .execute_prompt("task-1", "hi", ExecutionMode::Build, None)
            .await;
        assert!(!outcome.success);
        let err = outcome.error.unwrap();
        assert!(err.contains("spawn") || err.contains("not found") || err.contains("failed"));
    }

    /// Live OpenCode ACP probe — skipped unless bun + package are available.
    #[tokio::test]
    async fn live_opencode_acp_probe_and_prompt() {
        let bun = std::env::var("SACODE_OPENCODE_EXECUTABLE").unwrap_or_else(|_| {
            "C:\\Users\\jingg\\.version-fox\\cache\\nodejs\\v-24.14.1\\nodejs-24.14.1\\node_modules\\bun\\bin\\bun.exe"
                .to_string()
        });
        if !std::path::Path::new(&bun).exists() {
            eprintln!("skip live opencode probe: bun not found at {bun}");
            return;
        }
        let mut cfg = AcpBackendConfig::opencode(&bun);
        cfg.args = vec!["x".into(), "opencode-ai".into(), "acp".into()];
        cfg.cwd = Some(std::path::PathBuf::from("E:\\Project\\sa\\saai"));
        let backend = AcpProcessBackend::new(cfg);
        let desc = backend.probe().await.expect("probe");
        assert_eq!(desc.id.as_str(), "opencode");

        let outcome = backend
            .execute_prompt(
                "task-live-1",
                "Reply with exactly: PONG",
                ExecutionMode::Build,
                None,
            )
            .await;
        assert!(outcome.success, "outcome={outcome:?}");
        let text = outcome.output.unwrap_or_default();
        assert!(!text.is_empty());
        eprintln!("live acp output: {text}");
    }
}
