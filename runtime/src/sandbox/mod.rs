mod executor;

pub use executor::SandboxExecutor;

use std::path::PathBuf;

#[derive(Debug, Clone)]
pub struct SandboxPolicy {
    pub allowed_paths: Vec<PathBuf>,
    pub denied_paths: Vec<PathBuf>,
    pub allowed_commands: Vec<String>,
    pub network_allowed: bool,
    pub max_memory_mb: Option<usize>,
    pub timeout_ms: Option<u64>,
}

impl SandboxPolicy {
    pub fn new() -> Self {
        Self {
            allowed_paths: Vec::new(),
            denied_paths: Vec::new(),
            allowed_commands: Vec::new(),
            network_allowed: false,
            max_memory_mb: None,
            timeout_ms: None,
        }
    }

    pub fn allow_path(mut self, path: PathBuf) -> Self {
        self.allowed_paths.push(path);
        self
    }

    pub fn deny_path(mut self, path: PathBuf) -> Self {
        self.denied_paths.push(path);
        self
    }

    pub fn allow_command(mut self, cmd: String) -> Self {
        self.allowed_commands.push(cmd);
        self
    }

    pub fn allow_network(mut self) -> Self {
        self.network_allowed = true;
        self
    }

    pub fn max_memory(mut self, mb: usize) -> Self {
        self.max_memory_mb = Some(mb);
        self
    }

    pub fn timeout(mut self, ms: u64) -> Self {
        self.timeout_ms = Some(ms);
        self
    }

    pub fn readonly() -> Self {
        Self::new()
            .allow_path(PathBuf::from("."))
            .allow_command("ls".to_string())
            .allow_command("cat".to_string())
            .allow_command("head".to_string())
            .allow_command("tail".to_string())
    }

    pub fn build() -> Self {
        Self::new()
            .allow_path(PathBuf::from("."))
            .allow_command("cargo".to_string())
            .allow_command("npm".to_string())
            .allow_command("git".to_string())
            .timeout(30000)
    }

    pub fn yolo() -> Self {
        Self::new()
            .allow_path(PathBuf::from("."))
            .allow_network()
    }

    pub fn check_path(&self, path: &PathBuf) -> bool {
        if self.denied_paths.iter().any(|p| path.starts_with(p)) {
            return false;
        }
        
        self.allowed_paths.iter().any(|p| path.starts_with(p))
    }

    pub fn check_command(&self, cmd: &str) -> bool {
        self.allowed_commands.iter().any(|allowed| cmd.starts_with(allowed))
    }
}

impl Default for SandboxPolicy {
    fn default() -> Self {
        Self::readonly()
    }
}