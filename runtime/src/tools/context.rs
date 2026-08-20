//! 执行环境能力接口 — ExecutionContext
//!
//! 借鉴 deepseek-harness 的"执行世界"能力接口设计（见
//! `docs/reference/comparison-with-deepseek-harness.md` §3.3）。
//!
//! 设计意图：把 FS / 进程 / Bash 等系统能力的调用从工具实现中抽象出来，
//! 通过注入的 `&dyn ExecutionContext` 操作，而非直接调用 `std::fs` / `std::process`。
//! 这样未来迁移到远程沙箱（Docker / 远程 VM / gVisor）只需提供新的
//! `ExecutionContext` 实现，29 个工具代码零改——这正是 DSH 的核心优势。
//!
//! 本期落地范围（v1.2 第一步）：
//! - 定义 `ExecutionContext` trait（同步，避免引入 async 线程池分发开销）
//! - 提供 `LocalContext`：完整复刻现有 `fs.read` / `fs.write` / `shell.exec`
//!   的系统调用与平台包装逻辑（`needs_cmd_wrapper` / `needs_sh_wrapper`），
//!   保证行为零变化。
//! - 三个核心层工具（`fs.read` / `fs.write` / `shell.exec`）试点通过该接口调用。
//!
//! 设计约束：
//! - trait 为同步 `Send + Sync`，与原 `std::fs` 调用语义一致。
//! - `LocalContext` 行为必须等价于原 `std::fs` / `active_backend().execute_command`，
//!   任何偏差都是回归（见对比文档 §3.3 风险 2）。
//! - 不引入 async：高频工具（如 `fs.read`）的动态分发开销已极小，
//!   暂不叠加 `spawn_blocking` 复杂度。

use std::path::{Path, PathBuf};
use std::sync::{Arc, OnceLock};

use anyhow::Result;

/// 单个命令执行的结果
#[derive(Debug, Clone)]
pub struct CommandOutput {
    pub stdout: String,
    pub stderr: String,
    pub exit_code: i32,
    pub timed_out: bool,
}

/// 目录条目元数据（list_dir 返回）
#[derive(Debug, Clone)]
pub struct DirEntry {
    /// 相对于 list 根目录的路径（使用 `/` 分隔符，跨平台一致）
    pub relative_path: String,
    /// 条目类型
    pub entry_type: EntryType,
    /// 文件大小（字节）；目录为 0
    pub size: u64,
}

/// 目录条目类型
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EntryType {
    File,
    Directory,
}

/// 执行环境能力接口
///
/// 工具通过该 trait 操作文件系统和进程，而非直接绑定 `std::fs` / `std::process`。
/// 本地执行由 [`LocalContext`] 提供；远程沙箱由未来 `RemoteContext` 提供。
///
/// 所有方法为同步：工具执行本身已在 executor 线程中，无需额外异步包装。
pub trait ExecutionContext: Send + Sync {
    /// 读取文件（返回 UTF-8 文本）。`path` 需为已通过沙箱校验的绝对/相对路径。
    fn read_text(&self, path: &Path) -> Result<String>;

    /// 读取文件（返回原始字节）。用于二进制文件（如图片/视频）。
    fn read_bytes(&self, path: &Path) -> Result<Vec<u8>>;

    /// 读取文件的前 N 字节。用于二进制检测等场景，避免读取整个文件。
    fn read_bytes_partial(&self, path: &Path, max_bytes: usize) -> Result<Vec<u8>> {
        let bytes = self.read_bytes(path)?;
        Ok(bytes.into_iter().take(max_bytes).collect())
    }

    /// 写入文件（覆盖）。`path` 需为已通过沙箱校验的路径。
    fn write_text(&self, path: &Path, content: &str) -> Result<usize>;

    /// 追加写入文件。父目录不存在时自动创建。
    fn append_text(&self, path: &Path, content: &str) -> Result<usize>;

    /// 判断路径是否存在。
    fn exists(&self, path: &Path) -> bool;

    /// 列出目录内容（非递归）。
    ///
    /// - `dir`：已通过沙箱校验的目录路径
    /// - 返回目录下的直接子条目（含类型与大小），不含 `.`/`..`
    fn list_dir(&self, dir: &Path) -> Result<Vec<DirEntry>>;

    /// 获取文件/目录元数据（大小、修改时间）。
    /// 返回 (size_bytes, modified_unix_timestamp) 元组。
    fn metadata(&self, path: &Path) -> Result<(u64, Option<u64>)>;

    /// 创建目录（递归）。
    fn create_dir_all(&self, path: &Path) -> Result<()>;

    /// 执行 shell 命令。
    ///
    /// - `command`：完整命令字符串（可能含管道/重定向/链式操作符）
    /// - `cwd`：可选工作目录
    /// - `timeout_ms`：超时毫秒数
    fn exec(&self, command: &str, cwd: Option<&str>, timeout_ms: u64) -> Result<CommandOutput>;

    /// 解析路径（沙箱校验 + 路径规范化）。
    fn resolve_path(&self, path: &str, access: crate::sandbox::FsAccess) -> Result<std::path::PathBuf>;
}

/// 本地执行环境 — 封装现有 `std::fs` / `std::process` 调用与平台包装逻辑
///
/// 行为严格等价于原 `fs.read` / `fs.write` / `shell.exec` 的实现：
/// - `fs.read` 走 `std::fs::read_to_string`
/// - `fs.write` 走 `std::fs::write` / `OpenOptions::append`，父目录自动创建
/// - `shell.exec` 的完整平台包装（`needs_cmd_wrapper` / `needs_sh_wrapper`）
///   与命令危险性检查保持原样，确保回归零变化。
pub struct LocalContext;

impl LocalContext {
    /// 全局默认本地执行环境实例
    pub fn global() -> &'static LocalContext {
        static INSTANCE: LocalContext = LocalContext;
        &INSTANCE
    }
}

/// 默认执行环境持有（可替换）
///
/// 进程内唯一的默认 `ExecutionContext`。默认值为 [`LocalContext`]，
/// 未来可调用 [`set_default_context`] 注入远程沙箱实现（如 `RemoteContext`），
/// 工具代码无需改动即可整体迁移到远程执行环境——这是本抽象的核心收益。
static DEFAULT_CONTEXT: OnceLock<Arc<dyn ExecutionContext>> = OnceLock::new();

fn default_context() -> Arc<dyn ExecutionContext> {
    DEFAULT_CONTEXT
        .get_or_init(|| Arc::new(LocalContext))
        .clone()
}

/// 设置进程内默认执行环境（如远程沙箱 `RemoteContext`）
///
/// 应在程序启动早期调用一次；重复调用不生效（OnceLock 语义）。
/// 工具通过 [`current_context`] 获取当前生效的上下文实例。
pub fn set_default_context(ctx: Arc<dyn ExecutionContext>) {
    let _ = DEFAULT_CONTEXT.set(ctx);
}

/// 返回当前生效的执行环境（默认 [`LocalContext`]）
///
/// 工具内部通过此函数获取执行环境，而非硬编码 `std::fs` / `std::process`，
/// 从而支持运行时替换整个执行世界。
pub fn current_context() -> Arc<dyn ExecutionContext> {
    default_context()
}

impl ExecutionContext for LocalContext {
    fn read_text(&self, path: &Path) -> Result<String> {
        Ok(std::fs::read_to_string(path)?)
    }

    fn write_text(&self, path: &Path, content: &str) -> Result<usize> {
        if let Some(parent) = path.parent() {
            if !parent.exists() {
                std::fs::create_dir_all(parent)?;
            }
        }
        std::fs::write(path, content)?;
        Ok(content.len())
    }

    fn append_text(&self, path: &Path, content: &str) -> Result<usize> {
        if let Some(parent) = path.parent() {
            if !parent.exists() {
                std::fs::create_dir_all(parent)?;
            }
        }
        use std::io::Write;
        let mut file = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(path)?;
        file.write_all(content.as_bytes())?;
        Ok(content.len())
    }

    fn exists(&self, path: &Path) -> bool {
        path.exists()
    }

    fn read_bytes(&self, path: &Path) -> Result<Vec<u8>> {
        Ok(std::fs::read(path)?)
    }

    fn read_bytes_partial(&self, path: &Path, max_bytes: usize) -> Result<Vec<u8>> {
        use std::io::Read;
        let file = std::fs::File::open(path)?;
        let mut reader = std::io::Read::take(file, max_bytes as u64);
        let mut buf = Vec::with_capacity(max_bytes.min(4096));
        reader.read_to_end(&mut buf)?;
        Ok(buf)
    }

    fn list_dir(&self, dir: &Path) -> Result<Vec<DirEntry>> {
        let mut entries = Vec::new();
        for entry in std::fs::read_dir(dir)? {
            let entry = entry?;
            let metadata = entry.metadata()?;
            let entry_type = if metadata.is_dir() {
                EntryType::Directory
            } else {
                EntryType::File
            };
            let relative = entry
                .path()
                .strip_prefix(dir)
                .unwrap_or(&entry.path())
                .to_string_lossy()
                .replace(std::path::MAIN_SEPARATOR, "/");
            entries.push(DirEntry {
                relative_path: relative,
                entry_type,
                size: metadata.len(),
            });
        }
        Ok(entries)
    }

    fn exec(&self, command: &str, cwd: Option<&str>, timeout_ms: u64) -> Result<CommandOutput> {
        // 复用 shell/exec 中已有的完整平台包装与危险命令检查逻辑，
        // 保证与原 `shell.exec::execute` 行为完全一致。
        crate::tools::shell::exec::run_local_command(command, cwd, timeout_ms)
    }

    fn resolve_path(&self, path: &str, access: crate::sandbox::FsAccess) -> Result<PathBuf> {
        crate::tools::fs::access::resolve_allowed_path(path, access)
    }

    fn metadata(&self, path: &Path) -> Result<(u64, Option<u64>)> {
        let meta = std::fs::metadata(path)?;
        let size = meta.len();
        let modified = meta
            .modified()
            .ok()
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_secs());
        Ok((size, modified))
    }

    fn create_dir_all(&self, path: &Path) -> Result<()> {
        std::fs::create_dir_all(path)?;
        Ok(())
    }
}

/// 便捷构造：返回默认本地执行环境引用
pub fn local_context() -> &'static dyn ExecutionContext {
    LocalContext::global()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn local_context_read_write_roundtrip() {
        let dir = tempfile::tempdir().expect("tempdir");
        let file = dir.path().join("test.txt");

        let ctx = LocalContext::global();
        assert!(!ctx.exists(&file));

        let written = ctx.write_text(&file, "hello sacode").expect("write");
        assert_eq!(written, "hello sacode".len());
        assert!(ctx.exists(&file));

        let read = ctx.read_text(&file).expect("read");
        assert_eq!(read, "hello sacode");
    }

    #[test]
    fn local_context_append_accumulates() {
        let dir = tempfile::tempdir().expect("tempdir");
        let file = dir.path().join("append.txt");

        let ctx = LocalContext::global();
        ctx.write_text(&file, "a").expect("write a");
        let appended = ctx.append_text(&file, "b").expect("append b");
        assert_eq!(appended, "b".len());

        let read = ctx.read_text(&file).expect("read");
        assert_eq!(read, "ab");
    }

    #[test]
    fn local_context_current_is_local_by_default() {
        // 未调用 set_default_context 时，current_context 等价于 LocalContext
        let ctx = current_context();
        let dir = tempfile::tempdir().expect("tempdir");
        let file = dir.path().join("default.txt");
        ctx.write_text(&file, "x").expect("write");
        assert!(ctx.exists(&file));
    }
}

