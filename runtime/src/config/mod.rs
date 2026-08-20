use anyhow::Result;
use serde::{Deserialize, Serialize};
use std::path::{Component, Path, PathBuf};

use crate::sandbox::{
    DockerSandboxBackend, LocalSandboxBackend, SandboxBackend, SandboxExecutor, SandboxPolicy,
};
use crate::{mcp::McpConfig, skills::SkillSpec};
use sacode_kernel::ExecutionMode;
use std::sync::Arc;

pub mod profile;

const USER_ROOT_DIR: &str = ".sacode";
const PROJECT_ROOT_DIR: &str = ".sacode";
const SKILLS_DIR: &str = "skills";
const MCP_CONFIG_FILE: &str = "mcp.json";
const IDE_CONFIG_FILE: &str = "server.json";
const PROJECT_ACCESS_FILE: &str = "dirs.json";
const SANDBOX_CONFIG_FILE: &str = "sandbox.json";
const LOOP_CONFIG_FILE: &str = "loop.json";

#[derive(Debug, Clone)]
pub struct SaCodeConfig {
    pub user_dir: PathBuf,
    pub project_dir: PathBuf,
    pub workspace_dir: PathBuf,
}

impl SaCodeConfig {
    pub fn new(workdir: &Path) -> Self {
        // Windows 上 HOME 通常不存在，USERPROFILE 才是用户主目录；
        // Unix 上 HOME 是标准。二者均无时退化为当前目录。
        let user_dir = std::env::var_os("USERPROFILE")
            .or_else(|| std::env::var_os("HOME"))
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

    /// §3.4 第四步雏形：`--dump-config` 调试能力
    ///
    /// 汇总当前生效的完整配置（各配置文件 + 可选命名 Profile 覆盖），
    /// 标注每个配置块的来源，便于排查 Profile/Bundle/Patch 组合冲突。
    /// 返回 JSON 字符串，供 CLI `--dump-config` 直接打印。
    pub fn dump_effective_config(&self, profile_name: Option<&str>) -> Result<String> {
        let mut dump = serde_json::Map::new();

        // 各现有配置文件块（来源标注）
        let mcp = self.load_merged_mcp_config().unwrap_or_default();
        dump.insert(
            "mcp".to_string(),
            serde_json::json!({
                "source": "mcp.json (user + project merged)",
                "servers": mcp.mcp.len(),
            }),
        );

        let sandbox = SandboxConfigStore::new(&self.project_dir)
            .load()
            .unwrap_or_default();
        dump.insert(
            "sandbox".to_string(),
            serde_json::json!({
                "source": "sandbox.json",
                "backend": format!("{:?}", sandbox.backend.kind),
            }),
        );

        // 可选命名 Profile 覆盖（§3.4 第一步）
        if let Some(name) = profile_name {
            let profiles_dir = crate::config::profile::profiles_dir_of(&self.project_dir);
            match crate::config::profile::Profile::resolve(&profiles_dir, name) {
                Ok(profile) => {
                    // 第三步：叠加该 Profile 名下的全部 Patch（按 priority 排序）
                    let patches_dir = crate::config::profile::patches_dir_of(&self.project_dir);
                    let patch_set = crate::config::profile::PatchSet::load_all(&patches_dir)
                        .unwrap_or_default();
                    let patch_names = patch_set.names();

                    dump.insert(
                        "profile".to_string(),
                        serde_json::json!({
                            "name": profile.name,
                            "inheritance_chain": profile.inheritance_chain,
                            "model": profile.manifest.model,
                            "execution_mode": profile.manifest.execution_mode,
                            "enabled_tools": profile.manifest.enabled_tools,
                            "disabled_tools": profile.manifest.disabled_tools,
                            "mcp_servers": profile.manifest.mcp_servers,
                            "applied_patches": patch_names,
                            "source": format!("profiles/{}.json (with extends)", name),
                        }),
                    );
                }
                Err(e) => {
                    dump.insert(
                        "profile".to_string(),
                        serde_json::json!({
                            "name": name,
                            "error": e.to_string(),
                        }),
                    );
                }
            }
        }

        dump.insert(
            "project_dir".to_string(),
            serde_json::Value::String(self.project_dir.display().to_string()),
        );
        dump.insert(
            "user_dir".to_string(),
            serde_json::Value::String(self.user_dir.display().to_string()),
        );

        Ok(serde_json::to_string_pretty(&serde_json::Value::Object(
            dump,
        ))?)
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

/// §3.5 第三步：Loop 选择配置存储。
///
/// 从 `.sacode/loop.json` 读取 `LoopConfig`，支持 `agent_loop` 字段选择 Loop
/// 实现、`subsystems` 字段组合灵枢子系统开关。CLI `--agent-loop` 可直接覆盖
/// `kind`。文件不存在时回退默认（灵枢 `LingShu` + 全开子系统）。
#[derive(Debug, Clone)]
pub struct LoopConfigStore {
    path: PathBuf,
}

impl LoopConfigStore {
    pub fn new(workdir: &Path) -> Self {
        Self {
            path: SaCodeConfig::new(workdir)
                .project_dir
                .join(LOOP_CONFIG_FILE),
        }
    }

    /// 读取 Loop 配置；文件不存在或损坏时回退默认。
    pub fn load(&self) -> crate::agents::loop_impl::LoopConfig {
        if !self.path.exists() {
            return crate::agents::loop_impl::LoopConfig::default();
        }
        match std::fs::read_to_string(&self.path)
            .ok()
            .and_then(|c| serde_json::from_str::<crate::agents::loop_impl::LoopConfig>(&c).ok())
        {
            Some(config) => config,
            None => crate::agents::loop_impl::LoopConfig::default(),
        }
    }

    /// 覆盖保存 Loop 配置（用于 `sacode config set agent-loop ...` 等场景）。
    pub fn save(&self, config: &crate::agents::loop_impl::LoopConfig) -> Result<()> {
        if let Some(parent) = self.path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        std::fs::write(&self.path, serde_json::to_string_pretty(config)?)?;
        Ok(())
    }

    pub fn path(&self) -> &Path {
        &self.path
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
        if !config
            .allowed_dirs
            .iter()
            .any(|entry| entry == &canonical_str)
        {
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

    pub fn is_allowed_path(&self, workspace_root: &Path, path: &Path) -> Result<bool> {
        let workspace_root = canonicalize_existing_prefix(workspace_root)?;
        let candidate = canonicalize_existing_prefix(path)?;

        if candidate.starts_with(&workspace_root) {
            return Ok(true);
        }

        for allowed in self.allowed_dirs()? {
            if candidate.starts_with(canonicalize_existing_prefix(&allowed)?) {
                return Ok(true);
            }
        }

        Ok(false)
    }
}

fn normalize_allowed_dirs(dirs: &mut Vec<String>) {
    dirs.retain(|dir| !dir.trim().is_empty());
    dirs.sort();
    dirs.dedup();
}

fn canonicalize_existing_prefix(path: &Path) -> Result<PathBuf> {
    let normalized = normalize_path(path)?;
    let mut existing = normalized.as_path();
    let mut missing = Vec::new();

    while !existing.exists() {
        let Some(name) = existing.file_name() else {
            anyhow::bail!("path is outside workspace");
        };
        missing.push(name.to_os_string());
        let Some(parent) = existing.parent() else {
            anyhow::bail!("path is outside workspace");
        };
        existing = parent;
    }

    let mut canonical = existing.canonicalize()?;
    for segment in missing.iter().rev() {
        canonical.push(segment);
    }
    Ok(canonical)
}

fn normalize_path(path: &Path) -> Result<PathBuf> {
    let mut normalized = PathBuf::new();
    for component in path.components() {
        match component {
            Component::CurDir => {}
            Component::ParentDir => {
                if !normalized.pop() {
                    anyhow::bail!("path is outside workspace");
                }
            }
            other => normalized.push(other.as_os_str()),
        }
    }
    Ok(normalized)
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
            let paths = self
                .allowed_paths
                .iter()
                .map(PathBuf::from)
                .collect::<Vec<_>>();
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::agents::loop_impl::{AgentLoopKind, LoopConfig, LoopSubsystems};

    #[test]
    fn loop_config_store_roundtrip() {
        let dir = tempfile::tempdir().expect("tempdir");
        let store = LoopConfigStore::new(dir.path());

        // 初始无文件：回退默认
        let loaded = store.load();
        assert_eq!(loaded.kind, AgentLoopKind::LingShu);
        assert_eq!(loaded.subsystems, LoopSubsystems::default());

        // 写入自定义配置（仅自防护），再读回
        let custom = LoopConfig {
            kind: AgentLoopKind::LingShu,
            subsystems: LoopSubsystems::protection_only(),
        };
        store.save(&custom).expect("save loop config");
        let reloaded = store.load();
        assert_eq!(reloaded.subsystems, LoopSubsystems::protection_only());
        assert_eq!(reloaded.kind, AgentLoopKind::LingShu);
    }

    #[test]
    fn loop_config_store_corrupt_falls_back_to_default() {
        let dir = tempfile::tempdir().expect("tempdir");
        let store = LoopConfigStore::new(dir.path());
        if let Some(parent) = store.path().parent() {
            std::fs::create_dir_all(parent).expect("create parent dir");
        }
        std::fs::write(store.path.clone(), "{not valid json").expect("write corrupt");
        let loaded = store.load();
        assert_eq!(loaded.kind, AgentLoopKind::LingShu);
        assert_eq!(loaded.subsystems, LoopSubsystems::default());
    }
}
