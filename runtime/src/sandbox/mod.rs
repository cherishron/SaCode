mod executor;

use crate::ProjectAccessConfigStore;
use sacode_kernel::ExecutionMode;

pub use executor::{
    BackendCommandOutput, DockerSandboxBackend, LocalSandboxBackend, SandboxBackend,
    SandboxCommand, SandboxExecutor,
};

use std::path::{Path, PathBuf};
use std::sync::{Arc, OnceLock, RwLock};

static ACTIVE_SANDBOX_POLICY: OnceLock<RwLock<SandboxPolicy>> = OnceLock::new();
static ACTIVE_SANDBOX_BACKEND: OnceLock<RwLock<Arc<dyn SandboxBackend>>> = OnceLock::new();
static ACTIVE_EXECUTION_MODE: OnceLock<RwLock<ExecutionMode>> = OnceLock::new();

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FsAccess {
    Read,
    Write,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum NetworkAccess {
    Search,
    Fetch,
    Browser,
}

#[derive(Debug, Clone)]
pub struct SandboxPolicy {
    pub fs: FsPolicy,
    pub network: NetworkPolicy,
    pub shell: ShellPolicy,
    pub task: TaskPolicy,
    pub resources: ResourcePolicy,
}

#[derive(Debug, Clone, Default)]
pub struct FsPolicy {
    pub read_paths: Vec<PathBuf>,
    pub write_paths: Vec<PathBuf>,
    pub denied_paths: Vec<PathBuf>,
}

#[derive(Debug, Clone, Default)]
pub struct NetworkPolicy {
    pub search_allowed: bool,
    pub fetch_allowed: bool,
    pub browser_allowed: bool,
    pub host_allowlist: Vec<String>,
}

#[derive(Debug, Clone, Default)]
pub struct ShellPolicy {
    pub enabled: bool,
    pub allowed_commands: Vec<String>,
}

#[derive(Debug, Clone, Default)]
pub struct TaskPolicy {
    pub spawn_allowed: bool,
}

#[derive(Debug, Clone, Default)]
pub struct ResourcePolicy {
    pub max_memory_mb: Option<usize>,
    pub timeout_ms: Option<u64>,
}

impl SandboxPolicy {
    pub fn new() -> Self {
        Self {
            fs: FsPolicy::default(),
            network: NetworkPolicy::default(),
            shell: ShellPolicy::default(),
            task: TaskPolicy::default(),
            resources: ResourcePolicy::default(),
        }
    }

    pub fn allow_read_path(mut self, path: PathBuf) -> Self {
        self.fs.read_paths.push(path);
        self
    }

    pub fn allow_write_path(mut self, path: PathBuf) -> Self {
        self.fs.write_paths.push(path);
        self
    }

    pub fn allow_path(mut self, path: PathBuf) -> Self {
        self.fs.read_paths.push(path.clone());
        self.fs.write_paths.push(path);
        self
    }

    pub fn deny_path(mut self, path: PathBuf) -> Self {
        self.fs.denied_paths.push(path);
        self
    }

    pub fn allow_command(mut self, cmd: String) -> Self {
        self.shell.enabled = true;
        self.shell.allowed_commands.push(cmd);
        self
    }

    pub fn allow_search(mut self) -> Self {
        self.network.search_allowed = true;
        self
    }

    pub fn allow_fetch(mut self) -> Self {
        self.network.fetch_allowed = true;
        self
    }

    pub fn allow_browser(mut self) -> Self {
        self.network.browser_allowed = true;
        self
    }

    pub fn enable_shell(mut self) -> Self {
        self.shell.enabled = true;
        self
    }

    pub fn allow_task_spawn(mut self) -> Self {
        self.task.spawn_allowed = true;
        self
    }

    pub fn max_memory(mut self, mb: usize) -> Self {
        self.resources.max_memory_mb = Some(mb);
        self
    }

    pub fn timeout(mut self, ms: u64) -> Self {
        self.resources.timeout_ms = Some(ms);
        self
    }

    pub fn readonly() -> Self {
        Self::new().allow_read_path(PathBuf::from("."))
    }

    pub fn build() -> Self {
        Self::new()
            .allow_path(PathBuf::from("."))
            .allow_search()
            .allow_fetch()
            .enable_shell()
            .allow_task_spawn()
            .timeout(30000)
            .max_memory(512)
    }

    pub fn yolo() -> Self {
        Self::new()
            .allow_path(PathBuf::from("."))
            .allow_search()
            .allow_fetch()
            .allow_browser()
            .enable_shell()
            .allow_task_spawn()
            .timeout(60000)
            .max_memory(1024)
    }

    pub fn for_mode(mode: ExecutionMode) -> Self {
        match mode {
            ExecutionMode::Plan => Self::readonly()
                .allow_search()
                .timeout(15000)
                .max_memory(256),
            ExecutionMode::Build => Self::build(),
            ExecutionMode::Yolo => Self::yolo(),
        }
    }

    pub fn check_path(&self, path: &Path, access: FsAccess) -> bool {
        if current_mode() == ExecutionMode::Yolo {
            return true;
        }

        if self
            .fs
            .denied_paths
            .iter()
            .any(|p| path.starts_with(resolve_policy_path(p)))
        {
            return false;
        }

        let allowed_paths = match access {
            FsAccess::Read => &self.fs.read_paths,
            FsAccess::Write => &self.fs.write_paths,
        };

        if allowed_paths.is_empty() {
            return true;
        }

        if allowed_paths
            .iter()
            .any(|p| path.starts_with(resolve_policy_path(p)))
        {
            return true;
        }

        match std::env::current_dir()
            .ok()
            .and_then(|cwd| cwd.canonicalize().ok())
        {
            Some(workspace_root) => ProjectAccessConfigStore::new(workspace_root.as_path())
                .is_allowed_path(&workspace_root, path)
                .unwrap_or(false),
            None => false,
        }
    }

    pub fn check_command(&self, cmd: &str) -> bool {
        if !self.shell.enabled {
            return false;
        }

        if is_blocked_shell_command(cmd) {
            return false;
        }

        if self.shell.allowed_commands.is_empty() {
            return true;
        }

        self.shell
            .allowed_commands
            .iter()
            .any(|allowed| cmd == allowed)
    }

    pub fn check_network(&self, access: NetworkAccess) -> bool {
        match access {
            NetworkAccess::Search => self.network.search_allowed,
            NetworkAccess::Fetch => self.network.fetch_allowed,
            NetworkAccess::Browser => self.network.browser_allowed,
        }
    }

    pub fn check_task_spawn(&self) -> bool {
        self.task.spawn_allowed
    }

    pub fn timeout_ms(&self) -> Option<u64> {
        self.resources.timeout_ms
    }

    pub fn max_memory_mb(&self) -> Option<usize> {
        self.resources.max_memory_mb
    }
}

pub fn install_global_policy(policy: SandboxPolicy) {
    let cell = ACTIVE_SANDBOX_POLICY.get_or_init(|| RwLock::new(SandboxPolicy::build()));
    if let Ok(mut current) = cell.write() {
        *current = policy;
    }
}

pub fn install_current_mode(mode: ExecutionMode) {
    let cell = ACTIVE_EXECUTION_MODE.get_or_init(|| RwLock::new(ExecutionMode::Build));
    if let Ok(mut current) = cell.write() {
        *current = mode;
    }
}

pub fn install_global_backend(backend: Arc<dyn SandboxBackend>) {
    let cell = ACTIVE_SANDBOX_BACKEND.get_or_init(|| RwLock::new(Arc::new(LocalSandboxBackend)));
    if let Ok(mut current) = cell.write() {
        *current = backend;
    }
}

pub fn active_policy() -> SandboxPolicy {
    let cell = ACTIVE_SANDBOX_POLICY.get_or_init(|| RwLock::new(SandboxPolicy::build()));
    match cell.read() {
        Ok(policy) => policy.clone(),
        Err(_) => SandboxPolicy::build(),
    }
}

pub fn active_backend() -> Arc<dyn SandboxBackend> {
    let cell = ACTIVE_SANDBOX_BACKEND.get_or_init(|| RwLock::new(Arc::new(LocalSandboxBackend)));
    match cell.read() {
        Ok(backend) => backend.clone(),
        Err(_) => Arc::new(LocalSandboxBackend),
    }
}

pub fn current_mode() -> ExecutionMode {
    let cell = ACTIVE_EXECUTION_MODE.get_or_init(|| RwLock::new(ExecutionMode::Build));
    match cell.read() {
        Ok(mode) => *mode,
        Err(_) => ExecutionMode::Build,
    }
}

#[cfg(test)]
pub fn reset_global_policy() {
    install_global_policy(SandboxPolicy::build());
    install_current_mode(ExecutionMode::Build);
    install_global_backend(Arc::new(LocalSandboxBackend));
}

fn resolve_policy_path(path: &PathBuf) -> PathBuf {
    if path.is_absolute() {
        return path.clone();
    }

    match std::env::current_dir() {
        Ok(current_dir) => current_dir.join(path),
        Err(_) => path.clone(),
    }
}

impl Default for SandboxPolicy {
    fn default() -> Self {
        Self::readonly()
    }
}

fn is_blocked_shell_command(cmd: &str) -> bool {
    matches!(cmd, "kill" | "pkill" | "killall" | "taskkill")
}
