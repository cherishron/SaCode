use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Duration;

use axum::{
    body::{to_bytes, Body},
    http::{Request, StatusCode},
};
use http_body_util::BodyExt;
use tower::util::ServiceExt;

use crate::{
    build_runtime_system_prompt,
    config::{
        DockerSandboxConfig, SaCodeConfig, SandboxBackendConfig, SandboxBackendKind, SandboxConfig,
        SandboxConfigStore, SandboxModeConfig,
    },
    create_daemon, load_memory_index, load_wiki_context,
    mcp::{register_enabled_tools_sync as register_enabled_mcp_tools_sync, McpConfig},
    queue::{InMemoryStore, TaskQueue, TaskStore},
    rebuild_memory_index,
    sandbox::{DockerSandboxBackend, SandboxCommand},
    skills::SkillRegistry,
    tools::{ToolOutput, ToolSpec},
    McpConfigStore, McpServerConfig, McpSource, MemoryScope, PromptContext, SideEffectLevel,
    StoreDb, ToolRegistry,
};
use sacode_kernel::{
    ExecutionMode, RetryPolicy, ScheduledTask, Task, TaskPriority, TaskQueueStatus,
};

mod daemon_queue;
mod mcp_stdio;
mod sandbox;
mod task_run;
mod tools;
mod wiki;

fn sandbox_test_lock() -> std::sync::MutexGuard<'static, ()> {
    static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
    LOCK.get_or_init(|| Mutex::new(()))
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

struct CurrentDirGuard {
    original_dir: PathBuf,
}

impl CurrentDirGuard {
    fn enter(path: &Path) -> Self {
        let original_dir = std::env::current_dir().expect("read current dir");
        std::env::set_current_dir(path).expect("enter temp dir");
        Self { original_dir }
    }
}

impl Drop for CurrentDirGuard {
    fn drop(&mut self) {
        std::env::set_current_dir(&self.original_dir).expect("restore current dir");
    }
}

struct HomeEnvGuard {
    previous_home: Option<std::ffi::OsString>,
}

impl HomeEnvGuard {
    fn set(path: &Path) -> Self {
        let previous_home = std::env::var_os("HOME");
        std::env::set_var("HOME", path);
        Self { previous_home }
    }
}

impl Drop for HomeEnvGuard {
    fn drop(&mut self) {
        match self.previous_home.take() {
            Some(value) => std::env::set_var("HOME", value),
            None => std::env::remove_var("HOME"),
        }
    }
}
