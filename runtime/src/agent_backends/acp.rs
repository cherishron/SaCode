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
///
/// O1: fully generic — any id / display_name / executable / args.
/// `command` and `args` are stored separately; never shell-string concatenated.
#[derive(Debug, Clone)]
pub struct AcpBackendConfig {
    pub id: AgentBackendId,
    pub display_name: String,
    pub executable: PathBuf,
    pub args: Vec<String>,
    pub cwd: Option<PathBuf>,
    /// O3 enable/disable switch.
    pub enabled: bool,
    /// O2 install guidance (human-readable; never auto-download).
    pub install_hint: Option<String>,
    /// O5 quota state (in-memory; persisted via registry file).
    pub quota: Option<sacode_kernel::AgentBackendQuota>,
}

impl AcpBackendConfig {
    /// Generic constructor (O1) — any backend id / display name / command / args.
    pub fn new(
        id: impl Into<String>,
        display_name: impl Into<String>,
        executable: impl Into<PathBuf>,
        args: Vec<String>,
    ) -> Self {
        Self {
            id: AgentBackendId::new(id),
            display_name: display_name.into(),
            executable: executable.into(),
            args,
            cwd: None,
            enabled: true,
            install_hint: None,
            quota: None,
        }
    }

    /// Convenience: OpenCode defaults (kept for backward compatibility).
    pub fn opencode(executable: impl Into<PathBuf>) -> Self {
        Self {
            id: AgentBackendId::new("opencode"),
            display_name: "OpenCode".to_string(),
            executable: executable.into(),
            args: Vec::new(),
            cwd: None,
            enabled: true,
            install_hint: Some("npm i -g opencode-ai".to_string()),
            quota: None,
        }
    }

    /// Convenience: Tencent CodeBuddy Code ACP defaults.
    ///
    /// Launch is `codebuddy --acp` (flag, not subcommand). Multitask is not a
    /// launch flag — enable it via `session/set_config_option` (`configId=multitask`).
    pub fn codebuddy(executable: impl Into<PathBuf>) -> Self {
        Self {
            id: AgentBackendId::new("codebuddy"),
            display_name: "CodeBuddy".to_string(),
            executable: executable.into(),
            args: vec!["--acp".to_string()],
            cwd: None,
            enabled: true,
            install_hint: Some("npm i -g @tencent-ai/codebuddy-code".to_string()),
            quota: None,
        }
    }

    pub fn with_install_hint(mut self, hint: impl Into<String>) -> Self {
        self.install_hint = Some(hint.into());
        self
    }

    pub fn with_cwd(mut self, cwd: impl Into<PathBuf>) -> Self {
        self.cwd = Some(cwd.into());
        self
    }

    pub fn with_enabled(mut self, enabled: bool) -> Self {
        self.enabled = enabled;
        self
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
            enabled: self.enabled,
            executable: Some(self.executable.display().to_string()),
            args: if self.args.is_empty() {
                None
            } else {
                Some(self.args.clone())
            },
            version: None,
            diagnostic: None,
            install_hint: self.install_hint.clone(),
            quota: self.quota.clone(),
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

/// Build CodeBuddy ACP config from env (mirror of the OpenCode env hook).
///
/// - `SACODE_CODEBUDDY_EXECUTABLE` — required; absolute path or bare command name.
/// - `SACODE_CODEBUDDY_ARGS` — optional space-separated full arg list (replaces
///   the default `--acp`; include `--acp` yourself if you override).
/// - `SACODE_CODEBUDDY_CWD` — optional working directory.
///
/// Returns `None` when the executable env var is unset or blank.
pub fn codebuddy_config_from_env() -> Option<AcpBackendConfig> {
    let path = std::env::var("SACODE_CODEBUDDY_EXECUTABLE").ok()?;
    let path = path.trim();
    if path.is_empty() {
        return None;
    }
    let mut cfg = AcpBackendConfig::codebuddy(path);
    if let Ok(args) = std::env::var("SACODE_CODEBUDDY_ARGS") {
        let args: Vec<String> = args
            .split_whitespace()
            .map(|s| s.to_string())
            .filter(|s| !s.is_empty())
            .collect();
        if !args.is_empty() {
            cfg.args = args;
        }
    }
    if let Ok(cwd) = std::env::var("SACODE_CODEBUDDY_CWD") {
        if !cwd.trim().is_empty() {
            cfg.cwd = Some(PathBuf::from(cwd.trim()));
        }
    }
    Some(cfg)
}

/// Register the CodeBuddy ACP backend when `SACODE_CODEBUDDY_EXECUTABLE` is set.
///
/// Mirrors `daemon::maybe_register_opencode_from_env` without touching
/// `DaemonState`: the caller passes registry + executor explicitly.
/// Returns `true` when a backend was registered.
pub async fn maybe_register_codebuddy_from_env(
    registry: &super::BackendRegistry,
    executor: &crate::executor::TaskExecutor,
) -> bool {
    let Some(cfg) = codebuddy_config_from_env() else {
        return false;
    };
    registry.register(cfg.descriptor(AgentBackendHealth::Unknown));
    executor.set_acp_backend(cfg).await;
    tracing::info!("registered codebuddy ACP backend from SACODE_CODEBUDDY_EXECUTABLE");
    true
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

    /// Probe: check executable presence first (O2), then ACP handshake.
    ///
    /// Missing executable → `health: Unavailable` + `diagnostic` + `install_hint`.
    /// Never silently downloads. Handshake failure → `Degraded` or `Unavailable`.
    pub async fn probe(&self) -> Result<AgentDescriptor, BackendFailureCode> {
        // O2: executable existence check — no spawn if missing.
        let exe_str = self.config.executable.display().to_string();
        if !self.config.executable.exists() {
            // Also try PATH lookup for bare command names.
            let found_in_path = which_exists(&self.config.executable);
            if !found_in_path {
                let diagnostic = format!("executable not found: {exe_str}");
                let mut desc = self.config.descriptor(AgentBackendHealth::Unavailable);
                desc.diagnostic = Some(diagnostic);
                if desc.install_hint.is_none() {
                    desc.install_hint = Some(format!(
                        "install {} and ensure it is on PATH",
                        self.config.display_name
                    ));
                }
                return Ok(desc);
            }
        }

        let proc_cfg = self.config.process_config();
        let mut process = match AcpProcess::spawn(proc_cfg, None).await {
            Ok(p) => p,
            Err(err) => {
                let mut desc = self.config.descriptor(AgentBackendHealth::Unavailable);
                desc.diagnostic = Some(format!("failed to spawn ACP process: {err}"));
                return Ok(desc);
            }
        };
        let client = process.client();
        let result =
            tokio::time::timeout(std::time::Duration::from_secs(10), client.initialize()).await;
        let (health, diagnostic) = match result {
            Ok(Ok(_caps)) => (AgentBackendHealth::Ready, None),
            Ok(Err(err)) => (
                AgentBackendHealth::Degraded,
                Some(format!("ACP handshake failed: {err}")),
            ),
            Err(_) => (
                AgentBackendHealth::Degraded,
                Some("ACP handshake timed out after 10s".to_string()),
            ),
        };
        let _ = process.kill().await;
        let mut desc = self.config.descriptor(health);
        desc.diagnostic = diagnostic;
        Ok(desc)
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

/// Check if a bare command name exists on PATH (for probe without full path).
fn which_exists(executable: &std::path::Path) -> bool {
    if executable.is_absolute() || executable.components().count() > 1 {
        return executable.exists();
    }
    let name = executable.to_string_lossy().to_string();
    let Ok(path_var) = std::env::var("PATH") else {
        return false;
    };
    std::env::split_paths(&path_var).any(|dir| {
        let candidate = dir.join(&name);
        if candidate.exists() {
            return true;
        }
        // Windows: try with .exe / .cmd / .bat suffixes
        #[cfg(windows)]
        {
            for ext in [".exe", ".cmd", ".bat"] {
                if dir.join(format!("{name}{ext}")).exists() {
                    return true;
                }
            }
        }
        false
    })
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
        assert!(cfg.enabled);
        assert!(cfg.install_hint.is_some());
        let desc = cfg.descriptor(AgentBackendHealth::Ready);
        assert_eq!(desc.kind, AgentBackendKind::Acp);
        assert!(desc.capabilities.approvals);
        assert!(desc.executable.as_deref().unwrap().contains("opencode"));
    }

    #[test]
    fn codebuddy_config_defaults() {
        let cfg = AcpBackendConfig::codebuddy("codebuddy");
        assert_eq!(cfg.id.as_str(), "codebuddy");
        assert_eq!(cfg.display_name, "CodeBuddy");
        assert_eq!(cfg.args, vec!["--acp".to_string()]);
        assert_eq!(
            cfg.install_hint.as_deref(),
            Some("npm i -g @tencent-ai/codebuddy-code")
        );
        assert!(cfg.enabled);
        let desc = cfg.descriptor(AgentBackendHealth::Ready);
        assert_eq!(desc.kind, AgentBackendKind::Acp);
        assert!(desc.capabilities.streaming);
        assert!(desc.capabilities.sessions);
        assert!(desc
            .executable
            .as_deref()
            .unwrap()
            .contains("codebuddy"));
    }

    /// Serialize env-mutating tests so they don't race other parallel tests.
    fn env_test_lock() -> std::sync::MutexGuard<'static, ()> {
        use std::sync::{Mutex, OnceLock};
        static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
        LOCK.get_or_init(|| Mutex::new(()))
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    #[test]
    fn codebuddy_config_from_env_unset_is_none() {
        let _lock = env_test_lock();
        std::env::remove_var("SACODE_CODEBUDDY_EXECUTABLE");
        std::env::remove_var("SACODE_CODEBUDDY_ARGS");
        std::env::remove_var("SACODE_CODEBUDDY_CWD");
        assert!(codebuddy_config_from_env().is_none());

        std::env::set_var("SACODE_CODEBUDDY_EXECUTABLE", "   ");
        assert!(codebuddy_config_from_env().is_none());
        std::env::remove_var("SACODE_CODEBUDDY_EXECUTABLE");
    }

    #[test]
    fn codebuddy_config_from_env_applies_defaults_and_overrides() {
        let _lock = env_test_lock();
        std::env::remove_var("SACODE_CODEBUDDY_ARGS");
        std::env::remove_var("SACODE_CODEBUDDY_CWD");
        std::env::set_var("SACODE_CODEBUDDY_EXECUTABLE", "codebuddy");
        let cfg = codebuddy_config_from_env().expect("config");
        assert_eq!(cfg.id.as_str(), "codebuddy");
        assert_eq!(cfg.args, vec!["--acp".to_string()]);
        assert!(cfg.cwd.is_none());

        std::env::set_var("SACODE_CODEBUDDY_ARGS", "--acp --acp-transport stdio");
        std::env::set_var("SACODE_CODEBUDDY_CWD", "/tmp/cb");
        let cfg = codebuddy_config_from_env().expect("config");
        assert_eq!(cfg.args, vec!["--acp", "--acp-transport", "stdio"]);
        assert_eq!(cfg.cwd.as_deref(), Some(std::path::Path::new("/tmp/cb")));

        std::env::remove_var("SACODE_CODEBUDDY_EXECUTABLE");
        std::env::remove_var("SACODE_CODEBUDDY_ARGS");
        std::env::remove_var("SACODE_CODEBUDDY_CWD");
    }

    #[test]
    fn generic_config_o1() {
        let cfg = AcpBackendConfig::new("codebuddy", "CodeBuddy", "codebuddy", vec!["acp".into()])
            .with_install_hint("install codebuddy from vendor");
        assert_eq!(cfg.id.as_str(), "codebuddy");
        assert_eq!(cfg.display_name, "CodeBuddy");
        assert_eq!(cfg.args, vec!["acp".to_string()]);
        assert_eq!(
            cfg.install_hint.as_deref(),
            Some("install codebuddy from vendor")
        );
        let desc = cfg.descriptor(AgentBackendHealth::Unknown);
        assert_eq!(desc.install_hint.as_deref(), Some("install codebuddy from vendor"));
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
    async fn probe_missing_binary_returns_unavailable_with_hint() {
        let cfg = AcpBackendConfig::new("ghost", "Ghost", "definitely-not-a-real-binary-xyz", vec![])
            .with_install_hint("npm i -g ghost");
        let backend = AcpProcessBackend::new(cfg);
        let desc = backend.probe().await.expect("probe");
        assert_eq!(desc.health, AgentBackendHealth::Unavailable);
        assert!(desc.diagnostic.is_some());
        assert_eq!(desc.install_hint.as_deref(), Some("npm i -g ghost"));
    }

    #[tokio::test]
    async fn codebuddy_probe_missing_binary_returns_unavailable_with_hint() {
        let cfg = AcpBackendConfig::codebuddy("definitely-not-codebuddy-binary-xyz");
        let backend = AcpProcessBackend::new(cfg);
        let desc = backend.probe().await.expect("probe");
        assert_eq!(desc.id.as_str(), "codebuddy");
        assert_eq!(desc.health, AgentBackendHealth::Unavailable);
        assert!(desc.diagnostic.as_deref().unwrap().contains("executable not found"));
        assert_eq!(
            desc.install_hint.as_deref(),
            Some("npm i -g @tencent-ai/codebuddy-code")
        );
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

    /// Live OpenCode ACP probe — explicitly opt in; requires a configured model and credentials.
    #[tokio::test]
    async fn live_opencode_acp_probe_and_prompt() {
        if std::env::var_os("SACODE_RUN_LIVE_OPENCODE_TEST").is_none() {
            eprintln!("skip live opencode probe: set SACODE_RUN_LIVE_OPENCODE_TEST to opt in");
            return;
        }
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
