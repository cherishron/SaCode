//! fs 工具共享的文件预检 — 大文件保护 + 二进制检测
//!
//! 设计意图：
//! - edit/patch/apply_patch 三个 Modify 级工具统一预检，避免对二进制文件或大文件误操作
//! - 阈值与 fs.search / fs.apply_patch 原有保护对齐（10MB）
//! - 二进制检测策略与 git 对齐：采样前 8KB，NUL 字节判定

use std::path::Path;

/// 单文件最大允许字节数（10 MB）
///
/// 阈值依据：fs.read 默认 200 行，10MB 文本通常 >50k 行，
/// 远超常规编辑场景。超出时拒绝操作，避免内存膨胀和误改大文件。
pub const MAX_FILE_SIZE_BYTES: u64 = 10 * 1024 * 1024;

/// 二进制检测的采样大小（8 KB）
///
/// 与 git 的 binary 检测策略对齐：读取文件前 8KB，
/// 若包含 NUL 字节则判定为二进制。NUL 字节几乎不出现在文本文件中。
const BINARY_SAMPLE_SIZE: usize = 8 * 1024;

/// 预检错误 — 调用方据此生成用户可读的失败信息
#[derive(Debug)]
pub enum PreflightError {
    /// 文件过大
    FileTooLarge { size: u64, max: u64 },
    /// 疑似二进制文件
    BinaryFile,
    /// 读取文件元数据失败
    Metadata(std::io::Error),
    /// 打开或读取文件失败
    Read(std::io::Error),
}

impl PreflightError {
    /// 生成用户可读的错误信息
    pub fn to_message(&self) -> String {
        match self {
            Self::FileTooLarge { size, max } => {
                format!("file too large: {} bytes (max {} bytes)", size, max)
            }
            Self::BinaryFile => "file appears to be binary (contains NUL bytes)".to_string(),
            Self::Metadata(error) => format!("failed to read file metadata: {}", error),
            Self::Read(error) => format!("failed to read file: {}", error),
        }
    }
}

impl std::fmt::Display for PreflightError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.to_message())
    }
}

impl std::error::Error for PreflightError {}

/// 对 edit/patch 目标文件做预检：大小 + 二进制检测
///
/// 调用时机：在 `resolve_allowed_path` 之后、`fs::read_to_string` 之前。
/// 任一检查失败立即返回，避免对不适宜的文件做后续处理。
///
/// # 示例
/// ```ignore
/// let file_path = resolve_allowed_path(path, FsAccess::Write)?;
/// if let Err(error) = preflight_edit_file(&file_path) {
///     return Ok(ToolOutput::failure(error.to_message()));
/// }
/// let content = fs::read_to_string(&file_path)?;
/// ```
pub fn preflight_edit_file(path: &Path) -> Result<(), PreflightError> {
    let ctx = crate::tools::context::current_context();
    let (size, _) = ctx
        .metadata(path)
        .map_err(|e| PreflightError::Metadata(std::io::Error::other(e.to_string())))?;
    if size > MAX_FILE_SIZE_BYTES {
        return Err(PreflightError::FileTooLarge {
            size,
            max: MAX_FILE_SIZE_BYTES,
        });
    }
    if is_binary_file(path)? {
        return Err(PreflightError::BinaryFile);
    }
    Ok(())
}

/// 检测文件是否为二进制 — 采样前 8KB，检查是否包含 NUL 字节
///
/// 策略与 git 对齐：NUL 字节几乎不出现在文本文件中，
/// 出现 NUL 即判定为二进制。空文件视为非二进制（文本）。
fn is_binary_file(path: &Path) -> Result<bool, PreflightError> {
    let ctx = crate::tools::context::current_context();
    let bytes = ctx
        .read_bytes_partial(path, BINARY_SAMPLE_SIZE)
        .map_err(|e| PreflightError::Read(std::io::Error::other(e.to_string())))?;
    Ok(bytes.contains(&0))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    /// 临时测试目录 guard — 析构时清理
    struct TempDir {
        path: std::path::PathBuf,
    }

    impl TempDir {
        fn new() -> Self {
            let path = std::env::temp_dir().join(format!(
                "sacode-preflight-{}-{}",
                std::process::id(),
                std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap()
                    .as_nanos()
            ));
            std::fs::create_dir_all(&path).unwrap();
            Self { path }
        }

        fn write(&self, name: &str, content: &[u8]) -> std::path::PathBuf {
            let file_path = self.path.join(name);
            let mut file = std::fs::File::create(&file_path).unwrap();
            file.write_all(content).unwrap();
            file_path
        }
    }

    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.path);
        }
    }

    #[test]
    fn text_file_passes_preflight() {
        let dir = TempDir::new();
        let path = dir.write("text.txt", b"hello world\n");
        assert!(preflight_edit_file(&path).is_ok());
    }

    #[test]
    fn binary_file_fails_preflight() {
        let dir = TempDir::new();
        // 包含 NUL 字节的内容
        let path = dir.write("bin.dat", &[0x50, 0x4B, 0x00, 0x03, 0x04]);
        let error = preflight_edit_file(&path).unwrap_err();
        assert!(matches!(error, PreflightError::BinaryFile));
        assert!(error.to_message().contains("binary"));
    }

    #[test]
    fn empty_file_passes_preflight() {
        let dir = TempDir::new();
        let path = dir.write("empty.txt", b"");
        assert!(preflight_edit_file(&path).is_ok());
    }

    #[test]
    fn missing_file_fails_with_metadata_error() {
        let path = std::path::PathBuf::from("/nonexistent/sacode-preflight-missing.txt");
        let error = preflight_edit_file(&path).unwrap_err();
        assert!(matches!(error, PreflightError::Metadata(_)));
    }

    #[test]
    fn large_file_fails_preflight() {
        let dir = TempDir::new();
        // 构造一个超过阈值的稀疏文件（不用真写 10MB 数据）
        let path = dir.path.join("large.txt");
        let file = std::fs::File::create(&path).unwrap();
        // 用 seek 设置文件大小，超过 MAX_FILE_SIZE_BYTES
        file.set_len(MAX_FILE_SIZE_BYTES + 1).unwrap();
        drop(file);

        let error = preflight_edit_file(&path).unwrap_err();
        assert!(matches!(error, PreflightError::FileTooLarge { .. }));
        assert!(error.to_message().contains("too large"));
    }

    #[test]
    fn utf8_multibyte_text_passes_preflight() {
        let dir = TempDir::new();
        // 中文内容不应被误判为二进制
        let path = dir.write("cn.txt", "中文测试内容\n多字节字符".as_bytes());
        assert!(preflight_edit_file(&path).is_ok());
    }
}
