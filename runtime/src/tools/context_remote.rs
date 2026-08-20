//! 远程执行环境 — RemoteContext（§3.3 第四步）
//!
//! 把 [`crate::tools::context::ExecutionContext`] 的实现从本地进程替换为
//! "通过命令前缀转发到远端"的执行世界。
//!
//! **当前迁移范围**：仅 `ExecutionContext` trait 方法覆盖的 FS 操作（read_text /
//! read_bytes / write_text / append_text / exists / list_dir / metadata /
//! create_dir_all）和 `exec`。以下工具**未走 `current_context()`**，仍本地执行：
//! - `shell.exec` 直接调用 `run_local_command`（非 `ctx.exec`）
//! - `test.run` 本地 `Command::spawn`
//! - `fs.search` 本地 `std::fs::walkdir`
//!
//! 完整远程化需把这些工具也迁移到 `ctx.exec()` / `ctx.read_bytes_partial()` 等。
//!
//! 设计：
//! - `command_prefix`：在每条命令前注入的 argv（如 `["ssh", "user@host"]`、
//!   Docker 场景 `["docker", "exec", "-i", "container"]`）。空前缀等价于本地。
//! - FS 操作翻译为远程 shell 命令：
//!   - `read_text`  → `cat <path>`
//!   - `read_bytes`→ `cat <path>`（文本通道，二进制场景需 base64，见下）
//!   - `write_text`→ `printf '%s' <content> > <path>`（含父目录创建）
//!   - `append_text` → `printf '%s' <content> >> <path>`
//!   - `exists`     → `test -e <path>`
//!   - `list_dir`   → `ls -1p <dir>` 解析（目录带 `/` 后缀）
//! - `exec`：直接把原命令作为后缀拼接，由 `run_local_command` 经前缀执行。
//!
//! 二进制安全：当前 `read_bytes` 经文本通道 `cat` 会破坏二进制。生产级远程实现
//! 应改为 `base64 -w0` 编码回传再解码。本期作为"抽象可行性验证"保留文本通道，
//! 并在文档与测试中标明此限制（见对比文档 §3.3 风险）。
//!
//! 平台差异：前缀命令的拼接沿用现有 `build_command_parts` 的平台包装逻辑
//! （`needs_cmd_wrapper` / `needs_sh_wrapper`），保证与本地 `shell.exec` 一致。
//!
//! **路径语义限制（N1）**：当前 FS 工具的沙箱校验（`fs/access.rs::resolve_allowed_path`）
//! 用**本地** `current_dir().canonicalize()` 解析相对路径、用**本地**文件系统校验路径合法性。
//! 远程模式下存在三重死路：
//! 1. 相对路径被解析为本地绝对路径（如 `E:\Project\...`）→ 发给 Linux 远端必然不存在；
//! 2. 代码只在远端时，本地无此文件 → `canonicalize` 直接报错，到不了 ctx；
//! 3. 用户传远端绝对路径 `/remote/abs` → 本地 sandbox 判定越界拒绝。
//!
//! 因此 `--remote` 仅在"本地/远端路径完全同构"场景下可用（如 Docker bind mount 同路径、
//! 或空前缀本地测试）。生产级远程化需引入路径映射层（如 workdir 映射或 chroot 语义），
//! 让沙箱校验与路径解析都在远端语义下完成。

use std::path::Path;

use anyhow::{anyhow, Result};

use crate::tools::context::{
    CommandOutput, DirEntry, EntryType, ExecutionContext,
};
use crate::tools::shell::exec::run_local_command;

/// 远程执行环境（实验性）
///
/// 通过 `command_prefix` 把 FS/exec 操作转发到远端。
/// 注意：当前有路径语义限制（见模块文档 N1），仅路径同构场景可用。
pub struct RemoteContext {
    /// 命令前缀 argv（如 `["ssh", "user@host"]`）。空向量表示本地等价。
    command_prefix: Vec<String>,
    /// 命令执行超时（毫秒）
    timeout_ms: u64,
    /// 远程工作目录（可选）。用于对绝对路径做边界校验，确保路径位于远端 workdir 之内。
    remote_workdir: Option<String>,
}

impl RemoteContext {
    /// 构造远程执行环境
    ///
    /// - `command_prefix`：注入到每条命令前的 argv，空向量等价于本地。
    /// - `remote_workdir`：可选的远程工作目录，用于对绝对路径做边界校验。
    /// - `timeout_ms`：单条命令超时（毫秒），默认 30_000。
    pub fn new(command_prefix: Vec<String>, remote_workdir: Option<String>) -> Self {
        Self {
            command_prefix,
            timeout_ms: 30_000,
            remote_workdir,
        }
    }

    /// 设置命令超时（毫秒），链式构造用。
    pub fn with_timeout(mut self, timeout_ms: u64) -> Self {
        self.timeout_ms = timeout_ms;
        self
    }

    /// 把前缀与原始命令拼接为完整命令字符串
    fn wrap(&self, command: &str) -> String {
        if self.command_prefix.is_empty() {
            return command.to_string();
        }
        let prefix = self.command_prefix.join(" ");
        format!("{prefix} {command}")
    }

    /// 经前缀执行一条命令，返回输出
    fn run(&self, command: &str) -> Result<CommandOutput> {
        let wrapped = self.wrap(command);
        run_local_command(&wrapped, None, self.timeout_ms)
    }
}

/// 对远端路径做单引号转义，防止空格/特殊字符破坏 shell 命令
fn shell_quote(path: &str) -> String {
    format!("'{}'", path.replace('\'', "'\\''"))
}

impl ExecutionContext for RemoteContext {
    fn read_text(&self, path: &Path) -> Result<String> {
        let path = shell_quote(&path.to_string_lossy());
        // 远程 cat：文本通道读取
        let output = self.run(&format!("cat {path}"))?;
        if output.exit_code != 0 {
            return Err(anyhow!("remote read failed: {}", output.stderr));
        }
        Ok(output.stdout)
    }

    fn read_bytes(&self, path: &Path) -> Result<Vec<u8>> {
        let path = shell_quote(&path.to_string_lossy());
        // 经文本通道 `cat` 读取并转字节。注意：文本通道会破坏二进制内容
        // （换行归一、非 UTF-8 字节丢失）。生产级远程实现应改用 base64 编码回传
        // 或 gRPC 二进制流。本期作为"抽象可行性验证"保留文本通道。
        let output = self.run(&format!("cat {path}"))?;
        if output.exit_code != 0 {
            return Err(anyhow!("remote read_bytes failed: {}", output.stderr));
        }
        Ok(output.stdout.into_bytes())
    }

    fn write_text(&self, path: &Path, content: &str) -> Result<usize> {
        let path = shell_quote(&path.to_string_lossy());
        // 创建父目录（远端）后写入。
        // 用单引号包裹 content，并对内容中的单引号做转义（'\'' 序列）。
        let escaped = content.replace('\'', "'\\''");
        let command = format!(
            "mkdir -p \"$(dirname {path})\" && printf '%s' '{escaped}' > {path}"
        );
        let output = self.run(&command)?;
        if output.exit_code != 0 {
            return Err(anyhow!("remote write failed: {}", output.stderr));
        }
        Ok(content.len())
    }

    fn append_text(&self, path: &Path, content: &str) -> Result<usize> {
        let path = shell_quote(&path.to_string_lossy());
        let escaped = content.replace('\'', "'\\''");
        let command = format!(
            "mkdir -p \"$(dirname {path})\" && printf '%s' '{escaped}' >> {path}"
        );
        let output = self.run(&command)?;
        if output.exit_code != 0 {
            return Err(anyhow!("remote append failed: {}", output.stderr));
        }
        Ok(content.len())
    }

    fn exists(&self, path: &Path) -> bool {
        let path = shell_quote(&path.to_string_lossy());
        match self.run(&format!("test -e {path}")) {
            Ok(output) => output.exit_code == 0,
            Err(_) => false,
        }
    }

    fn list_dir(&self, dir: &Path) -> Result<Vec<DirEntry>> {
        let dir = shell_quote(&dir.to_string_lossy());
        // `ls -1p`：每行一个条目，目录以 `/` 结尾。
        let output = self.run(&format!("ls -1p {dir}"))?;
        if output.exit_code != 0 {
            return Err(anyhow!("remote list failed: {}", output.stderr));
        }
        let mut entries = Vec::new();
        for line in output.stdout.lines() {
            let line = line.trim();
            if line.is_empty() {
                continue;
            }
            let is_dir = line.ends_with('/');
            let name = line.trim_end_matches('/').to_string();
            entries.push(DirEntry {
                relative_path: name,
                // 远端 ls 不返回 size，目录/文件统一 0（远程 size 需 stat，留作增强）
                entry_type: if is_dir {
                    EntryType::Directory
                } else {
                    EntryType::File
                },
                size: 0,
            });
        }
        Ok(entries)
    }

    fn metadata(&self, path: &Path) -> Result<(u64, Option<u64>)> {
        let path = shell_quote(path.to_string_lossy().as_ref());
        // stat -c (Linux) / stat -f (BSD/macOS) 兼容
        let output = self.run(&format!("stat -c '%s %Y' {path} 2>/dev/null || stat -f '%z %m' {path}"))?;
        if output.exit_code != 0 {
            return Err(anyhow!("remote metadata failed: {}", output.stderr));
        }
        let parts: Vec<&str> = output.stdout.trim().split_whitespace().collect();
        if parts.len() < 2 {
            return Err(anyhow!("remote metadata: unexpected stat output"));
        }
        let size = parts[0].parse::<u64>().unwrap_or(0);
        let modified = parts[1].parse::<u64>().ok();
        Ok((size, modified))
    }

    fn create_dir_all(&self, path: &Path) -> Result<()> {
        let path = shell_quote(path.to_string_lossy().as_ref());
        let output = self.run(&format!("mkdir -p {path}"))?;
        if output.exit_code != 0 {
            return Err(anyhow!("remote mkdir failed: {}", output.stderr));
        }
        Ok(())
    }

    fn exec(&self, command: &str, cwd: Option<&str>, timeout_ms: u64) -> Result<CommandOutput> {
        let wrapped = self.wrap(command);
        run_local_command(&wrapped, cwd, timeout_ms)
    }

    fn resolve_path(&self, path: &str, access: crate::sandbox::FsAccess) -> Result<std::path::PathBuf> {
        let _ = access;
        let p = std::path::PathBuf::from(path);
        if p.is_absolute() {
            if let Some(ref wd) = self.remote_workdir {
                let wd = std::path::PathBuf::from(wd);
                if !p.starts_with(&wd) {
                    anyhow::bail!("path {:?} is outside remote workdir {:?}", p, wd);
                }
            }
        }
        Ok(p)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;

    use crate::tools::context::{current_context, set_default_context};

    /// 验证命令前缀拼接逻辑（不实际执行，纯字符串构造）
    #[test]
    fn remote_context_wraps_command_with_prefix() {
        // 用确定不存在的前缀，避免依赖环境中是否安装 ssh（Windows 10+ 自带
        // OpenSSH 会导致 ssh 真实发起网络请求，使测试变为网络依赖）。
        let probe = "sacode_remote_probe_xyz";
        let ctx = RemoteContext::new(vec![probe.to_string(), "user@host".to_string()], None);
        // 注入前缀后，echo 命令被发往前缀命令；本地无该命令，exec 会返回
        // Err（program not found）或 Ok 但非 0 退出。两种都证明前缀被注入、
        // echo hello 未被本地执行。核心是「输出里不应出现 hello」。
        let result = ctx.exec("echo hello", None, 1000);
        let stdout_has_hello = match &result {
            Ok(output) => output.stdout.contains("hello"),
            Err(_) => false,
        };
        assert!(
            !stdout_has_hello,
            "prefix must intercept command: exec result was {:?}",
            result
        );
    }

    #[test]
    fn remote_context_empty_prefix_no_wrap() {
        let ctx = RemoteContext::new(vec![], None);
        // 空前缀：exec 直接透传原命令，本地 echo 应成功且不含探测前缀。
        let output = ctx
            .exec("echo hello", None, 1000)
            .expect("exec returns output");
        assert!(output.stdout.contains("hello"));
        assert!(!output.stderr.contains("sacode_remote_probe_xyz"));
    }

    /// 演示"工具零改，仅换执行世界"：RemoteContext 的 exec 透传前缀，拦截本地命令。
    ///
    /// 注：进程内默认上下文由 `OnceLock` 持有（首次初始化后不可变），并行测试
    /// 中无法保证 `set_default_context` 一定生效，故此处直接对 RemoteContext
    /// 实例验证前缀拦截逻辑（等价于工具通过 `current_context()` 拿到远程实例
    /// 时的行为），避免依赖全局状态初始化顺序。
    #[test]
    fn set_default_context_switches_execution_world() {
        let probe = "sacode_remote_probe_xyz";
        let remote: Arc<dyn ExecutionContext> =
            Arc::new(RemoteContext::new(vec![probe.to_string(), "user@host".to_string()], None));

        // set_default_context 调用不 panic（OnceLock 重复 set 静默忽略，符合预期）
        set_default_context(remote.clone());

        // 通过 RemoteContext 实例直接验证：前缀拦截生效，echo hello 不被本地执行
        let result = remote.exec("echo hello", None, 1000);
        let stdout_has_hello = match &result {
            Ok(output) => output.stdout.contains("hello"),
            Err(_) => false,
        };
        assert!(
            !stdout_has_hello,
            "RemoteContext must intercept command via prefix, got {:?}",
            result
        );
    }

    /// 真实 FS 操作的端到端验证（仅 Unix：远端语义假设为 POSIX shell）
    #[cfg(unix)]
    #[test]
    fn remote_context_posix_fs_operations() {
        let ctx = RemoteContext::new(vec![], None); // 本地即 Unix，等价于远端 POSIX
        let dir = tempfile::tempdir().expect("tempdir");
        let file = dir.path().join("remote_local.txt");

        assert!(!ctx.exists(&file));
        let written = ctx.write_text(&file, "remote content").expect("write");
        assert_eq!(written, "remote content".len());
        assert!(ctx.exists(&file));

        let read = ctx.read_text(&file).expect("read");
        assert_eq!(read, "remote content");

        let listed = ctx.list_dir(dir.path()).expect("list");
        assert!(listed.iter().any(|e| e.relative_path == "remote_local.txt"));
    }
}

