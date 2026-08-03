//! LSP 诊断能力 — 按语言调度外部检查器并解析为 LSP Diagnostic
//!
//! 设计意图：
//! - 最小破坏：仅在 LSP server 内启用诊断发布，不改动 daemon / task_runner / 工具链
//! - 复用 workdir 模式：与 `resolve_provider_for_lsp` 保持一致的 workdir 注入
//! - 语言调度：基于 `TextDocument.language_id` 分派到对应检查器
//!   - rust → `cargo check --message-format=json`
//!   - typescript/javascript → `tsc --noEmit --pretty false`
//!   - python → `python -m py_compile <file>`

use std::path::{Path, PathBuf};
use std::process::Command;

use tower_lsp::lsp_types::{Diagnostic, DiagnosticSeverity, NumberOrString, Position, Range};

use crate::document::TextDocument;

/// 诊断提供者：按语言调度检查器，过滤出指定文档的诊断
#[derive(Debug, Clone)]
pub struct DiagnosticsProvider {
    workdir: PathBuf,
}

impl DiagnosticsProvider {
    pub fn new(workdir: PathBuf) -> Self {
        Self { workdir }
    }

    /// 对指定文档运行诊断，返回该文档对应的 Diagnostic 列表
    ///
    /// 实现策略：
    /// 1. 把 URI 转为本地文件路径
    /// 2. 按 language_id 分派到对应检查器
    /// 3. 检查器在 workdir 运行，过滤出与 doc_path 匹配的诊断
    pub fn analyze(&self, doc: &TextDocument) -> Vec<Diagnostic> {
        let Some(doc_path) = uri_to_file_path(&doc.uri) else {
            return Vec::new();
        };
        match doc.language_id.as_str() {
            "rust" => self.analyze_rust(&doc_path),
            "typescript" | "typescriptreact" | "javascript" | "javascriptreact" => {
                self.analyze_typescript(&doc_path)
            }
            "python" => self.analyze_python(&doc_path),
            _ => Vec::new(),
        }
    }

    /// rust: `cargo check --message-format=json`
    /// 仅当 workdir 含 Cargo.toml 时执行，避免在非 Rust 项目中报错
    fn analyze_rust(&self, doc_path: &Path) -> Vec<Diagnostic> {
        if !self.workdir.join("Cargo.toml").exists() {
            return Vec::new();
        }
        let output = Command::new("cargo")
            .args(["check", "--message-format=json", "--quiet"])
            .current_dir(&self.workdir)
            .output();
        let Ok(output) = output else {
            return Vec::new();
        };
        let stdout = String::from_utf8_lossy(&output.stdout);
        parse_cargo_check_output(&stdout, doc_path, &self.workdir)
    }

    /// typescript/javascript: `tsc --noEmit --pretty false`
    /// 仅当 workdir 含 tsconfig.json 或 package.json 时执行
    fn analyze_typescript(&self, doc_path: &Path) -> Vec<Diagnostic> {
        if !self.workdir.join("tsconfig.json").exists()
            && !self.workdir.join("package.json").exists()
        {
            return Vec::new();
        }
        let output = Command::new("npx")
            .args(["tsc", "--noEmit", "--pretty", "false"])
            .current_dir(&self.workdir)
            .output();
        let Ok(output) = output else {
            return Vec::new();
        };
        // tsc 将编译诊断输出到 stdout
        let stdout = String::from_utf8_lossy(&output.stdout);
        let stderr = String::from_utf8_lossy(&output.stderr);
        let combined = format!("{}\n{}", stdout, stderr);
        parse_tsc_output(&combined, doc_path, &self.workdir)
    }

    /// python: `python -m py_compile <file>`
    /// 仅做语法检查，不导入模块，避免副作用
    fn analyze_python(&self, doc_path: &Path) -> Vec<Diagnostic> {
        let Some(file_str) = doc_path.to_str() else {
            return Vec::new();
        };
        let output = Command::new("python")
            .args(["-m", "py_compile", file_str])
            .current_dir(&self.workdir)
            .output();
        let Ok(output) = output else {
            return Vec::new();
        };
        // py_compile 通过 stderr 报告语法错误
        let stderr = String::from_utf8_lossy(&output.stderr);
        parse_python_output(&stderr, doc_path)
    }
}

/// 解析 cargo check 的 JSON 行输出，过滤出 doc_path 对应的诊断
///
/// cargo check 每行一个 JSON 对象，关注 `reason: "compiler-message"` 的行，
/// 其 `message.spans` 中 `is_primary: true` 的 span 包含位置信息。
pub(crate) fn parse_cargo_check_output(
    stdout: &str,
    doc_path: &Path,
    workdir: &Path,
) -> Vec<Diagnostic> {
    let mut diagnostics = Vec::new();
    for line in stdout.lines() {
        let Ok(value) = serde_json::from_str::<serde_json::Value>(line) else {
            continue;
        };
        if value.get("reason").and_then(|v| v.as_str()) != Some("compiler-message") {
            continue;
        }
        let Some(message) = value.get("message") else {
            continue;
        };
        let level = message.get("level").and_then(|v| v.as_str()).unwrap_or("");
        let severity = match level {
            "error" => DiagnosticSeverity::ERROR,
            "warning" => DiagnosticSeverity::WARNING,
            _ => continue,
        };
        let msg = message
            .get("message")
            .and_then(|v| v.as_str())
            .unwrap_or("");
        let code = message
            .get("code")
            .and_then(|c| c.get("code"))
            .and_then(|v| v.as_str());
        let Some(spans) = message.get("spans").and_then(|v| v.as_array()) else {
            continue;
        };
        for span in spans {
            let is_primary = span
                .get("is_primary")
                .and_then(|v| v.as_bool())
                .unwrap_or(false);
            if !is_primary {
                continue;
            }
            let file_name = span
                .get("file_name")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            let span_path = workdir.join(file_name);
            if !paths_match(&span_path, doc_path) {
                continue;
            }
            let line_start = span
                .get("line_start")
                .and_then(|v| v.as_u64())
                .unwrap_or(1) as u32;
            let line_end = span
                .get("line_end")
                .and_then(|v| v.as_u64())
                .unwrap_or(line_start as u64) as u32;
            let col_start = span
                .get("column_start")
                .and_then(|v| v.as_u64())
                .unwrap_or(1) as u32;
            let col_end = span
                .get("column_end")
                .and_then(|v| v.as_u64())
                .unwrap_or(col_start as u64) as u32;
            diagnostics.push(Diagnostic {
                range: Range {
                    start: Position {
                        line: line_start.saturating_sub(1),
                        character: col_start.saturating_sub(1),
                    },
                    end: Position {
                        line: line_end.saturating_sub(1),
                        character: col_end.saturating_sub(1),
                    },
                },
                severity: Some(severity),
                code: code.map(|c| NumberOrString::String(c.to_string())),
                source: Some("cargo".to_string()),
                message: msg.to_string(),
                ..Default::default()
            });
        }
    }
    diagnostics
}

/// 解析 tsc 输出
///
/// 格式：`path(line,col): error TSxxxx: message` 或 `path(line,col): warning TSxxxx: message`
pub(crate) fn parse_tsc_output(
    output: &str,
    doc_path: &Path,
    workdir: &Path,
) -> Vec<Diagnostic> {
    let mut diagnostics = Vec::new();
    for line in output.lines() {
        // 格式: path(line,col): error TSxxxx: message
        let Some(close_paren) = line.find(')') else {
            continue;
        };
        let Some(open_paren) = line[..close_paren].rfind('(') else {
            continue;
        };
        let file_str = line[..open_paren].trim();
        let coords = &line[open_paren + 1..close_paren];
        let Some((line_str, col_str)) = coords.split_once(',') else {
            continue;
        };
        let rest = line[close_paren + 1..]
            .trim_start_matches(':')
            .trim_start();
        let (severity, code_msg) = match rest.split_whitespace().next() {
            Some("error") => (DiagnosticSeverity::ERROR, rest[5..].trim_start()),
            Some("warning") => (DiagnosticSeverity::WARNING, rest[7..].trim_start()),
            _ => continue,
        };
        let Some((code, msg)) = code_msg.split_once(':') else {
            continue;
        };
        let code = code.trim();
        let msg = msg.trim();
        let span_path = workdir.join(file_str);
        if !paths_match(&span_path, doc_path) {
            continue;
        }
        let Ok(line_n) = line_str.trim().parse::<u32>() else {
            continue;
        };
        let Ok(col) = col_str.trim().parse::<u32>() else {
            continue;
        };
        diagnostics.push(Diagnostic {
            range: Range {
                start: Position {
                    line: line_n.saturating_sub(1),
                    character: col.saturating_sub(1),
                },
                end: Position {
                    line: line_n.saturating_sub(1),
                    character: col,
                },
            },
            severity: Some(severity),
            code: Some(NumberOrString::String(code.to_string())),
            source: Some("tsc".to_string()),
            message: msg.to_string(),
            ..Default::default()
        });
    }
    diagnostics
}

/// 解析 python `py_compile` 的 stderr 输出
///
/// 典型格式：
/// ```text
///   File "foo.py", line 10
///     x =
///         ^
/// SyntaxError: invalid syntax
/// ```
pub(crate) fn parse_python_output(stderr: &str, doc_path: &Path) -> Vec<Diagnostic> {
    let mut diagnostics = Vec::new();
    let mut current_path: Option<PathBuf> = None;
    let mut current_line: Option<u32> = None;

    for line in stderr.lines() {
        let trimmed = line.trim();
        // File "path", line N
        if let Some(rest) = trimmed.strip_prefix("File \"") {
            if let Some(end) = rest.find("\",") {
                let path_str = &rest[..end];
                current_path = Some(PathBuf::from(path_str));
                let after = rest[end + 2..].trim();
                if let Some(line_part) = after.strip_prefix("line ") {
                    current_line = line_part.trim().parse::<u32>().ok();
                }
            }
            continue;
        }
        // 错误类型行，如 "SyntaxError: invalid syntax" 或 "IndentationError: ..."
        // 仅当存在 path+line 上下文时记录
        if let (Some(path), Some(line_n)) = (&current_path, current_line) {
            if !paths_match(path, doc_path) {
                continue;
            }
            // 简单启发式：包含 ": " 且首字母大写的行视为错误描述
            if trimmed.contains(": ")
                && trimmed
                    .chars()
                    .next()
                    .is_some_and(|c| c.is_ascii_uppercase())
            {
                diagnostics.push(Diagnostic {
                    range: Range {
                        start: Position {
                            line: line_n.saturating_sub(1),
                            character: 0,
                        },
                        end: Position {
                            line: line_n.saturating_sub(1),
                            character: u32::MAX,
                        },
                    },
                    severity: Some(DiagnosticSeverity::ERROR),
                    source: Some("python".to_string()),
                    message: trimmed.to_string(),
                    ..Default::default()
                });
                current_path = None;
                current_line = None;
            }
        }
    }
    diagnostics
}

/// 从 LSP URI 提取本地文件路径
fn uri_to_file_path(uri: &tower_lsp::lsp_types::Url) -> Option<PathBuf> {
    uri.to_file_path().ok()
}

/// 比较两个路径是否指向同一文件
///
/// 优先用 `canonicalize` 处理符号链接与大小写差异；
/// 失败（文件不存在等）则词法比较 `components`。
fn paths_match(a: &Path, b: &Path) -> bool {
    if let (Ok(ca), Ok(cb)) = (std::fs::canonicalize(a), std::fs::canonicalize(b)) {
        return ca == cb;
    }
    a.components().eq(b.components())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;
    use tower_lsp::lsp_types::Url;

    /// 构造一个相对路径的 workdir 与 doc_path，避免依赖真实文件系统
    fn workdir_doc_pair(rel: &str) -> (PathBuf, PathBuf) {
        let workdir = PathBuf::from("/fake/workdir");
        (workdir.clone(), workdir.join(rel))
    }

    #[test]
    fn parses_cargo_check_error_primary_span() {
        let cargo_json = r#"{"reason":"compiler-message","package_id":"foo","manifest_path":"/fake/workdir/Cargo.toml","target":{"src_path":"/fake/workdir/src/lib.rs"},"message":{"rendered":"error","children":[],"code":{"code":"E0004","explanation":null},"level":"error","message":"match arms have incompatible types","spans":[{"file_name":"src/lib.rs","byte_start":100,"byte_end":110,"line_start":12,"line_end":12,"column_start":5,"column_end":15,"is_primary":true,"label":"expected type","suggested_replacement":null,"text":[{"highlight_start":5,"highlight_end":15,"text":"foo"}]}]}}"#;
        let (workdir, doc_path) = workdir_doc_pair("src/lib.rs");
        let diags = parse_cargo_check_output(cargo_json, &doc_path, &workdir);
        assert_eq!(diags.len(), 1);
        let d = &diags[0];
        assert_eq!(d.severity, Some(DiagnosticSeverity::ERROR));
        assert_eq!(d.source.as_deref(), Some("cargo"));
        assert_eq!(d.message, "match arms have incompatible types");
        // LSP 行号从 0 开始，cargo 从 1 开始 → 减 1
        assert_eq!(d.range.start.line, 11);
        assert_eq!(d.range.start.character, 4);
        assert_eq!(d.range.end.line, 11);
        assert_eq!(d.range.end.character, 14);
        match &d.code {
            Some(NumberOrString::String(s)) => assert_eq!(s, "E0004"),
            other => panic!("unexpected code: {:?}", other),
        }
    }

    #[test]
    fn filters_cargo_diagnostics_by_doc_path() {
        // span file_name = src/other.rs，doc_path 是 src/lib.rs → 不应匹配
        let cargo_json = r#"{"reason":"compiler-message","message":{"level":"error","message":"x","code":{"code":"E0001"},"spans":[{"file_name":"src/other.rs","line_start":1,"line_end":1,"column_start":1,"column_end":2,"is_primary":true}]}}"#;
        let (workdir, doc_path) = workdir_doc_pair("src/lib.rs");
        let diags = parse_cargo_check_output(cargo_json, &doc_path, &workdir);
        assert!(diags.is_empty());
    }

    #[test]
    fn ignores_non_primary_spans() {
        let cargo_json = r#"{"reason":"compiler-message","message":{"level":"error","message":"x","code":{"code":"E0001"},"spans":[{"file_name":"src/lib.rs","line_start":1,"line_end":1,"column_start":1,"column_end":2,"is_primary":false}]}}"#;
        let (workdir, doc_path) = workdir_doc_pair("src/lib.rs");
        let diags = parse_cargo_check_output(cargo_json, &doc_path, &workdir);
        assert!(diags.is_empty());
    }

    #[test]
    fn skips_non_compiler_message_lines() {
        // reason != compiler-message → 跳过
        let cargo_json = r#"{"reason":"compiler-artifact","message":null}"#;
        let (workdir, doc_path) = workdir_doc_pair("src/lib.rs");
        let diags = parse_cargo_check_output(cargo_json, &doc_path, &workdir);
        assert!(diags.is_empty());
    }

    #[test]
    fn parses_tsc_error_line() {
        let tsc_output = "src/foo.ts(10,5): error TS2322: Type 'string' is not assignable to type 'number'.";
        let (workdir, doc_path) = workdir_doc_pair("src/foo.ts");
        let diags = parse_tsc_output(tsc_output, &doc_path, &workdir);
        assert_eq!(diags.len(), 1);
        let d = &diags[0];
        assert_eq!(d.severity, Some(DiagnosticSeverity::ERROR));
        assert_eq!(d.source.as_deref(), Some("tsc"));
        assert_eq!(d.message, "Type 'string' is not assignable to type 'number'.");
        assert_eq!(d.range.start.line, 9);
        assert_eq!(d.range.start.character, 4);
        assert_eq!(d.range.end.line, 9);
        assert_eq!(d.range.end.character, 5);
        match &d.code {
            Some(NumberOrString::String(s)) => assert_eq!(s, "TS2322"),
            other => panic!("unexpected code: {:?}", other),
        }
    }

    #[test]
    fn parses_tsc_warning_line() {
        let tsc_output = "src/bar.ts(3,1): warning TS6133: 'x' is declared but never used.";
        let (workdir, doc_path) = workdir_doc_pair("src/bar.ts");
        let diags = parse_tsc_output(tsc_output, &doc_path, &workdir);
        assert_eq!(diags.len(), 1);
        assert_eq!(diags[0].severity, Some(DiagnosticSeverity::WARNING));
        match &diags[0].code {
            Some(NumberOrString::String(s)) => assert_eq!(s, "TS6133"),
            _ => panic!(),
        }
    }

    #[test]
    fn filters_tsc_diagnostics_by_doc_path() {
        let tsc_output = "src/other.ts(1,1): error TS9999: x";
        let (workdir, doc_path) = workdir_doc_pair("src/foo.ts");
        let diags = parse_tsc_output(tsc_output, &doc_path, &workdir);
        assert!(diags.is_empty());
    }

    #[test]
    fn skips_non_diagnostic_tsc_lines() {
        let tsc_output = "Some random line without parens\nplain text\n";
        let (workdir, doc_path) = workdir_doc_pair("src/foo.ts");
        let diags = parse_tsc_output(tsc_output, &doc_path, &workdir);
        assert!(diags.is_empty());
    }

    #[test]
    fn parses_python_syntax_error() {
        // py_compile 用 doc_path（绝对路径）作为参数，stderr 中包含同样的绝对路径
        let stderr = "  File \"/fake/workdir/foo.py\", line 10\n    x =\n        ^\nSyntaxError: invalid syntax\n";
        let doc_path = PathBuf::from("/fake/workdir/foo.py");
        let diags = parse_python_output(stderr, &doc_path);
        assert_eq!(diags.len(), 1);
        let d = &diags[0];
        assert_eq!(d.severity, Some(DiagnosticSeverity::ERROR));
        assert_eq!(d.source.as_deref(), Some("python"));
        assert_eq!(d.message, "SyntaxError: invalid syntax");
        assert_eq!(d.range.start.line, 9);
    }

    #[test]
    fn filters_python_diagnostics_by_path() {
        let stderr = "  File \"/fake/workdir/other.py\", line 5\nSyntaxError: invalid syntax\n";
        let doc_path = PathBuf::from("/fake/workdir/foo.py");
        let diags = parse_python_output(stderr, &doc_path);
        assert!(diags.is_empty());
    }

    #[test]
    fn paths_match_handles_same_components() {
        let a = PathBuf::from("/fake/workdir/src/lib.rs");
        let b = PathBuf::from("/fake/workdir/src/lib.rs");
        assert!(paths_match(&a, &b));
    }

    #[test]
    fn paths_match_rejects_different_components() {
        let a = PathBuf::from("/fake/workdir/src/lib.rs");
        let b = PathBuf::from("/fake/workdir/src/other.rs");
        assert!(!paths_match(&a, &b));
    }

    #[test]
    fn uri_to_file_path_handles_file_scheme() {
        // 使用当前工作目录构造 URL，确保跨平台兼容（Windows 需要 drive letter）
        let cwd = std::env::current_dir().expect("current_dir");
        let url = Url::from_file_path(&cwd).expect("Url::from_file_path");
        let path = uri_to_file_path(&url);
        assert!(path.is_some());
    }

    #[test]
    fn analyze_returns_empty_for_unsupported_language() {
        let workdir = PathBuf::from("/fake/workdir");
        let provider = DiagnosticsProvider::new(workdir);
        let url = Url::parse("file:///fake/workdir/src/foo.txt").unwrap();
        let doc = TextDocument {
            uri: url,
            content: "hello".to_string(),
            version: 1,
            language_id: "markdown".to_string(),
        };
        // analyze 会尝试执行 cargo / tsc / python；不支持的语言直接返回空
        let diags = provider.analyze(&doc);
        assert!(diags.is_empty());
    }
}
