use anyhow::Result;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

use crate::{mcp::McpConfig, skills::SkillSpec};
use crate::sandbox::{DockerSandboxBackend, LocalSandboxBackend, SandboxBackend, SandboxExecutor, SandboxPolicy};
use sacode_kernel::ExecutionMode;
use std::sync::Arc;

const USER_ROOT_DIR: &str = ".sacode";
const PROJECT_ROOT_DIR: &str = ".sacode";
const SKILLS_DIR: &str = "skills";
const MCP_CONFIG_FILE: &str = "mcp.json";
const IDE_CONFIG_FILE: &str = "server.json";
const PROJECT_ACCESS_FILE: &str = "dirs.json";
const SANDBOX_CONFIG_FILE: &str = "sandbox.json";

#[derive(Debug, Clone)]
pub struct SaCodeConfig {
    pub user_dir: PathBuf,
    pub project_dir: PathBuf,
    pub workspace_dir: PathBuf,
}

impl SaCodeConfig {
    pub fn new(workdir: &Path) -> Self {
        let user_dir = std::env::var_os("HOME")
            .map(PathBuf::from)
            .unwrap_or_else(|| PathBuf::from("."))
            .join(USER_ROOT_DIR);

        Self {
            user_dir,
            project_dir: workdir.join(PROJECT_ROOT_DIR),
            workspace_dir: workdir.join(SKILLS_DIR),
        }
    }

    pub fn user_skills_dir(&self) -> PathBuf {
        self.user_dir.join(SKILLS_DIR)
    }

    pub fn project_skills_dir(&self) -> PathBuf {
        self.project_dir.join(SKILLS_DIR)
    }

    pub fn workspace_skills_dir(&self) -> PathBuf {
        self.workspace_dir.clone()
    }

    pub fn user_mcp_config(&self) -> PathBuf {
        self.user_dir.join(MCP_CONFIG_FILE)
    }

    pub fn project_mcp_config(&self) -> PathBuf {
        self.project_dir.join(MCP_CONFIG_FILE)
    }

    pub fn project_server_config(&self) -> PathBuf {
        self.project_dir.join(IDE_CONFIG_FILE)
    }

    pub fn project_access_config(&self) -> PathBuf {
        self.project_dir.join(PROJECT_ACCESS_FILE)
    }

    pub fn project_sandbox_config(&self) -> PathBuf {
        self.project_dir.join(SANDBOX_CONFIG_FILE)
    }

    pub fn load_merged_mcp_config(&self) -> Result<McpConfig> {
        let mut merged = McpConfig::default();

        for path in [self.user_mcp_config(), self.project_mcp_config()] {
            if !path.exists() {
                continue;
            }

            let content = std::fs::read_to_string(&path)?;
            let config: McpConfig = serde_json::from_str(&content)?;
            merged.mcp.extend(config.mcp);
        }

        Ok(merged)
    }

    pub fn load_all_skills(&self) -> Result<Vec<SkillSpec>> {
        crate::skills::SkillRegistry::new_from_config(self.clone()).list()
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct IdeServerConfig {
    #[serde(default)]
    pub acp: ProtocolServerConfig,
    #[serde(default)]
    pub lsp: ProtocolServerConfig,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProtocolServerConfig {
    #[serde(default = "default_host")]
    pub host: String,
    #[serde(default)]
    pub port: u16,
}

impl Default for ProtocolServerConfig {
    fn default() -> Self {
        Self {
            host: default_host(),
            port: 0,
        }
    }
}

#[derive(Debug, Clone)]
pub struct IdeServerConfigStore {
    path: PathBuf,
}

impl IdeServerConfigStore {
    pub fn new(workdir: &Path) -> Self {
        Self {
            path: SaCodeConfig::new(workdir).project_server_config(),
        }
    }

    pub fn load(&self) -> Result<IdeServerConfig> {
        if !self.path.exists() {
            return Ok(IdeServerConfig::default());
        }

        let content = std::fs::read_to_string(&self.path)?;
        Ok(serde_json::from_str(&content)?)
    }

    pub fn save(&self, config: &IdeServerConfig) -> Result<()> {
        if let Some(parent) = self.path.parent() {
            std::fs::create_dir_all(parent)?;
        }

        std::fs::write(&self.path, serde_json::to_string_pretty(config)?)?;
        Ok(())
    }
}

fn default_host() -> String {
    "127.0.0.1".to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ProjectAccessConfig {
    #[serde(default)]
    pub allowed_dirs: Vec<String>,
}

#[derive(Debug, Clone)]
pub struct ProjectAccessConfigStore {
    path: PathBuf,
}

impl ProjectAccessConfigStore {
    pub fn new(workdir: &Path) -> Self {
        Self {
            path: SaCodeConfig::new(workdir).project_access_config(),
        }
    }

    pub fn load(&self) -> Result<ProjectAccessConfig> {
        if !self.path.exists() {
            return Ok(ProjectAccessConfig::default());
        }

        let content = std::fs::read_to_string(&self.path)?;
        let mut config: ProjectAccessConfig = serde_json::from_str(&content)?;
        normalize_allowed_dirs(&mut config.allowed_dirs);
        Ok(config)
    }

    pub fn save(&self, config: &ProjectAccessConfig) -> Result<()> {
        if let Some(parent) = self.path.parent() {
            std::fs::create_dir_all(parent)?;
        }

        let mut normalized = config.clone();
        normalize_allowed_dirs(&mut normalized.allowed_dirs);
        std::fs::write(&self.path, serde_json::to_string_pretty(&normalized)?)?;
        Ok(())
    }

    pub fn add_dir(&self, path: &Path) -> Result<PathBuf> {
        if !path.is_absolute() {
            anyhow::bail!("path must be absolute")
        }
        if !path.exists() {
            anyhow::bail!("directory not found: {}", path.display())
        }
        if !path.is_dir() {
            anyhow::bail!("path is not a directory: {}", path.display())
        }

        let canonical = path.canonicalize()?;
        let canonical_str = canonical.to_string_lossy().to_string();

        let mut config = self.load()?;
        if !config.allowed_dirs.iter().any(|entry| entry == &canonical_str) {
            config.allowed_dirs.push(canonical_str);
        }
        self.save(&config)?;
        Ok(canonical)
    }

    pub fn allowed_dirs(&self) -> Result<Vec<PathBuf>> {
        Ok(self
            .load()?
            .allowed_dirs
            .into_iter()
            .map(PathBuf::from)
            .collect())
    }
}

fn normalize_allowed_dirs(dirs: &mut Vec<String>) {
    dirs.retain(|dir| !dir.trim().is_empty());
    dirs.sort();
    dirs.dedup();
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct SandboxConfig {
    #[serde(default)]
    pub backend: SandboxBackendConfig,
    #[serde(default)]
    pub plan: SandboxModeConfig,
    #[serde(default)]
    pub build: SandboxModeConfig,
    #[serde(default)]
    pub yolo: SandboxModeConfig,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct SandboxBackendConfig {
    #[serde(default)]
    pub kind: SandboxBackendKind,
    #[serde(default)]
    pub docker: DockerSandboxConfig,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, Default, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum SandboxBackendKind {
    #[default]
    Local,
    Docker,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct DockerSandboxConfig {
    #[serde(default)]
    pub image: Option<String>,
    #[serde(default)]
    pub workspace_mount: Option<String>,
    #[serde(default)]
    pub network_mode: Option<String>,
    #[serde(default)]
    pub cpus: Option<String>,
    #[serde(default)]
    pub memory: Option<String>,
    #[serde(default)]
    pub user: Option<String>,
    #[serde(default)]
    pub read_only_rootfs: Option<bool>,
    #[serde(default)]
    pub tmpfs: Vec<String>,
}

impl SandboxConfig {
    pub fn apply(&self, mode: ExecutionMode, policy: SandboxPolicy) -> SandboxPolicy {
        let mode_config = match mode {
            ExecutionMode::Plan => &self.plan,
            ExecutionMode::Build => &self.build,
            ExecutionMode::Yolo => &self.yolo,
        };
        mode_config.apply(policy)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct SandboxModeConfig {
    #[serde(default)]
    pub fs: SandboxFsConfig,
    #[serde(default)]
    pub network: SandboxNetworkConfig,
    #[serde(default)]
    pub shell: SandboxShellConfig,
    #[serde(default)]
    pub task: SandboxTaskConfig,
    #[serde(default)]
    pub resources: SandboxResourceConfig,

    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub network_allowed: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max_memory_mb: Option<usize>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub timeout_ms: Option<u64>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub allowed_commands: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub denied_paths: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub allowed_paths: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct SandboxFsConfig {
    #[serde(default)]
    pub read_paths: Vec<String>,
    #[serde(default)]
    pub write_paths: Vec<String>,
    #[serde(default)]
    pub deny_paths: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct SandboxNetworkConfig {
    pub search_allowed: Option<bool>,
    pub fetch_allowed: Option<bool>,
    pub browser_allowed: Option<bool>,
    #[serde(default)]
    pub host_allowlist: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct SandboxShellConfig {
    pub enabled: Option<bool>,
    #[serde(default)]
    pub allowed_commands: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct SandboxTaskConfig {
    pub spawn_allowed: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct SandboxResourceConfig {
    pub max_memory_mb: Option<usize>,
    pub timeout_ms: Option<u64>,
}

impl SandboxModeConfig {
    fn apply(&self, mut policy: SandboxPolicy) -> SandboxPolicy {
        if !self.fs.read_paths.is_empty() {
            policy.fs.read_paths = self.fs.read_paths.iter().map(PathBuf::from).collect();
        }
        if !self.fs.write_paths.is_empty() {
            policy.fs.write_paths = self.fs.write_paths.iter().map(PathBuf::from).collect();
        }
        if !self.fs.deny_paths.is_empty() {
            policy.fs.denied_paths = self.fs.deny_paths.iter().map(PathBuf::from).collect();
        }

        if let Some(search_allowed) = self.network.search_allowed {
            policy.network.search_allowed = search_allowed;
        }
        if let Some(fetch_allowed) = self.network.fetch_allowed {
            policy.network.fetch_allowed = fetch_allowed;
        }
        if let Some(browser_allowed) = self.network.browser_allowed {
            policy.network.browser_allowed = browser_allowed;
        }
        if !self.network.host_allowlist.is_empty() {
            policy.network.host_allowlist = self.network.host_allowlist.clone();
        }

        if let Some(enabled) = self.shell.enabled {
            policy.shell.enabled = enabled;
        }
        if !self.shell.allowed_commands.is_empty() {
            policy.shell.allowed_commands = self.shell.allowed_commands.clone();
        }

        if let Some(spawn_allowed) = self.task.spawn_allowed {
            policy.task.spawn_allowed = spawn_allowed;
        }

        if let Some(max_memory_mb) = self.resources.max_memory_mb {
            policy.resources.max_memory_mb = Some(max_memory_mb);
        }
        if let Some(timeout_ms) = self.resources.timeout_ms {
            policy.resources.timeout_ms = Some(timeout_ms);
        }

        if let Some(network_allowed) = self.network_allowed {
            policy.network.search_allowed = network_allowed;
            policy.network.fetch_allowed = network_allowed;
            policy.network.browser_allowed = network_allowed;
        }
        if let Some(max_memory_mb) = self.max_memory_mb {
            policy.resources.max_memory_mb = Some(max_memory_mb);
        }
        if let Some(timeout_ms) = self.timeout_ms {
            policy.resources.timeout_ms = Some(timeout_ms);
        }
        if !self.allowed_commands.is_empty() {
            policy.shell.enabled = true;
            policy.shell.allowed_commands = self.allowed_commands.clone();
        }
        if !self.allowed_paths.is_empty() {
            let paths = self.allowed_paths.iter().map(PathBuf::from).collect::<Vec<_>>();
            policy.fs.read_paths = paths.clone();
            policy.fs.write_paths = paths;
        }
        if !self.denied_paths.is_empty() {
            policy.fs.denied_paths = self.denied_paths.iter().map(PathBuf::from).collect();
        }
        policy
    }
}

#[derive(Debug, Clone)]
pub struct SandboxConfigStore {
    path: PathBuf,
}

impl SandboxConfigStore {
    pub fn new(workdir: &Path) -> Self {
        Self {
            path: SaCodeConfig::new(workdir).project_sandbox_config(),
        }
    }

    pub fn load(&self) -> Result<SandboxConfig> {
        if !self.path.exists() {
            return Ok(SandboxConfig::default());
        }

        let content = std::fs::read_to_string(&self.path)?;
        Ok(serde_json::from_str(&content)?)
    }

    pub fn save(&self, config: &SandboxConfig) -> Result<()> {
        if let Some(parent) = self.path.parent() {
            std::fs::create_dir_all(parent)?;
        }

        std::fs::write(&self.path, serde_json::to_string_pretty(config)?)?;
        Ok(())
    }

    pub fn policy_for_mode(&self, mode: ExecutionMode) -> Result<SandboxPolicy> {
        let config = self.load()?;
        Ok(config.apply(mode, SandboxPolicy::for_mode(mode)))
    }

    pub fn executor_for_mode(&self, mode: ExecutionMode) -> Result<SandboxExecutor> {
        let config = self.load()?;
        let policy = config.apply(mode, SandboxPolicy::for_mode(mode));
        let backend = backend_from_config(&config.backend);
        Ok(SandboxExecutor::with_backend(policy, backend))
    }

    pub fn path(&self) -> &Path {
        &self.path
    }
}

fn backend_from_config(config: &SandboxBackendConfig) -> Arc<dyn SandboxBackend> {
    match config.kind {
        SandboxBackendKind::Local => Arc::new(LocalSandboxBackend),
        SandboxBackendKind::Docker => Arc::new(DockerSandboxBackend::new(config.docker.clone())),
    }
}
