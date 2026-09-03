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
    create_daemon, create_daemon_in, load_memory_index, load_wiki_context,
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

mod approval_flow;
mod daemon_queue;
mod interceptor;
mod mcp_stdio;
mod sandbox;
mod task_run;
mod tools;
mod wiki;

/// 创建使用独立临时工作目录的 daemon
///
/// 避免并行测试共享仓库根目录 `.sacode/task-store.sqlite3`：
/// 多个 daemon 测试并行打开同一 SQLite 文件会触发写锁冲突，
/// 导致 create_task 随机返回 error（SQLITE_BUSY）。
pub(crate) async fn create_isolated_daemon() -> axum::Router {
    let tempdir = tempfile::tempdir().expect("create temp dir for daemon");
    let dir = tempdir.keep();
    create_daemon_in(dir).await
}
fn sandbox_test_lock() -> std::sync::MutexGuard<'static, ()> {
    static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
    LOCK.get_or_init(|| Mutex::new(()))
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

// 进程级 CWD 是全局共享状态，所有修改 CWD 的测试必须通过此锁串行化，
// 避免不同 #[cfg(test)] 模块的 CurrentDirGuard 并发 set_current_dir 互相干扰。
// 任何需要变更 CWD 的测试都应复用此 helper，不要再定义本地 Mutex。
pub(crate) fn cwd_test_lock() -> std::sync::MutexGuard<'static, ()> {
    static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
    LOCK.get_or_init(|| Mutex::new(()))
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

pub(crate) struct CurrentDirGuard {
    _lock: std::sync::MutexGuard<'static, ()>,
    original_dir: PathBuf,
}

impl CurrentDirGuard {
    pub(crate) fn enter(path: &Path) -> Self {
        let lock = cwd_test_lock();
        let original_dir = std::env::current_dir().expect("read current dir");
        std::env::set_current_dir(path).expect("enter temp dir");
        Self {
            _lock: lock,
            original_dir,
        }
    }
}

impl Drop for CurrentDirGuard {
    fn drop(&mut self) {
        // 原目录可能被其他并行测试的 tempdir 清理，恢复失败时退化为用户目录
        if std::env::set_current_dir(&self.original_dir).is_err() {
            let _ = std::env::var_os("USERPROFILE")
                .or_else(|| std::env::var_os("HOME"))
                .map(std::env::set_current_dir);
        }
    }
}

struct HomeEnvGuard {
    previous_home: Option<std::ffi::OsString>,
    previous_userprofile: Option<std::ffi::OsString>,
}

impl HomeEnvGuard {
    fn set(path: &Path) -> Self {
        // 被测代码（config/wiki/skills::hub/model_router）优先读 USERPROFILE 再读 HOME，
        // 测试需同时设置两者，避免 Windows 真实 USERPROFILE 干扰用户级路径判定。
        let previous_home = std::env::var_os("HOME");
        let previous_userprofile = std::env::var_os("USERPROFILE");
        std::env::set_var("HOME", path);
        std::env::set_var("USERPROFILE", path);
        Self {
            previous_home,
            previous_userprofile,
        }
    }
}

impl Drop for HomeEnvGuard {
    fn drop(&mut self) {
        match self.previous_home.take() {
            Some(value) => std::env::set_var("HOME", value),
            None => std::env::remove_var("HOME"),
        }
        match self.previous_userprofile.take() {
            Some(value) => std::env::set_var("USERPROFILE", value),
            None => std::env::remove_var("USERPROFILE"),
        }
    }
}
