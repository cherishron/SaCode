use std::fs;
use std::path::{Path, PathBuf};

use crate::sandbox::FsAccess;
use crate::tools::{SideEffectLevel, ToolOutput, ToolSpec};

use super::cache::{AST_CACHE, FILE_LIST_CACHE};
use super::super::fs::access::resolve_allowed_path;

const DEFAULT_LIMIT: usize = 200;

#[derive(Debug, Default, Clone)]
pub struct SymbolIndex;

#[derive(Debug, Clone, serde::Serialize)]
struct SymbolEntry {
    name: String,
    kind: String,
    path: String,
    line: usize,
    preview: String,
}

pub fn spec() -> ToolSpec {
    ToolSpec {
        name: "code.symbols".to_string(),
        description: "提取代码符号索引".to_string(),
        input_schema: serde_json::json!({
            "type": "object",
            "properties": {
                "path": { "type": "string", "description": "文件或目录路径" },
                "language": { "type": "string", "description": "语言类型，当前支持 rust" },
                "limit": { "type": "integer", "description": "最多返回多少个符号，默认 200" }
            },
            "required": ["path"]
        }),
        output_schema: serde_json::json!({
            "type": "object",
            "properties": {
                "path": { "type": "string" },
                "language": { "type": "string" },
                "summary": { "type": "string" },
                "symbols": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "name": { "type": "string" },
                            "kind": { "type": "string" },
                            "path": { "type": "string" },
                            "line": { "type": "integer" },
                            "preview": { "type": "string" }
                        }
                    }
                },
                "count": { "type": "integer" },
                "truncated": { "type": "boolean" }
            }
        }),
        side_effect_level: SideEffectLevel::ReadOnly,
        approval_required: false,
        timeout_ms: Some(10_000),
        tags: vec!["code".to_string(), "symbols".to_string()],
    }
}

pub fn execute(input: serde_json::Value) -> anyhow::Result<ToolOutput> {
    let path = input["path"].as_str().unwrap_or("").trim();
    let language = input["language"].as_str().map(str::trim);
    let limit = input["limit"].as_u64().unwrap_or(DEFAULT_LIMIT as u64) as usize;

    if path.is_empty() {
        return Ok(ToolOutput::failure("path is required"));
    }

    let resolved_path = resolve_allowed_path(path, FsAccess::Read)?;
    if !resolved_path.exists() {
        return Ok(ToolOutput::failure(format!("path not found: {}", path)));
    }

    let files = FILE_LIST_CACHE.get_or_collect(&resolved_path, language, collect_source_files)?;
    let selected_language = language
        .map(|value| value.to_ascii_lowercase())
        .unwrap_or_else(|| detect_primary_language(&files));

    if !matches!(
        selected_language.as_str(),
        "rust" | "python" | "javascript" | "typescript" | "go"
    ) {
        return Ok(ToolOutput::failure(
            "unsupported language; supported: rust, python, javascript, typescript, go",
        ));
    }

    if files.is_empty() {
        return Ok(ToolOutput::success(serde_json::json!({
            "path": path,
            "language": selected_language,
            "summary": format!("found 0 symbols in {}", path),
            "symbols": [],
            "count": 0,
            "truncated": false
        }))
        .with_message("no supported source files found"));
    }

    let mut symbols = Vec::new();
    let mut truncated = false;
    for file in files {
        extract_symbols(
            &resolved_path,
            &file,
            &selected_language,
            &mut symbols,
            limit,
        )?;
        if symbols.len() >= limit {
            truncated = true;
            break;
        }
    }

    let count = symbols.len();
    Ok(ToolOutput::success(serde_json::json!({
        "path": path,
        "language": selected_language,
        "summary": format!("found {} symbols in {}", count, path),
        "symbols": symbols,
        "count": count,
        "truncated": truncated
    })))
}

fn collect_source_files(
    path: &Path,
    language: Option<&str>,
    files: &mut Vec<PathBuf>,
) -> anyhow::Result<()> {
    if path.is_file() {
        if matches_language(path, language) {
            files.push(path.to_path_buf());
        }
        return Ok(());
    }

    for entry in fs::read_dir(path)? {
        let entry = entry?;
        let entry_path = entry.path();
        if entry_path.is_dir() {
            collect_source_files(&entry_path, language, files)?;
        } else if matches_language(&entry_path, language) {
            files.push(entry_path);
        }
    }
    Ok(())
}

fn extract_symbols(
    root_path: &Path,
    file_path: &Path,
    language: &str,
    symbols: &mut Vec<SymbolEntry>,
    limit: usize,
) -> anyhow::Result<()> {
    let content = fs::read_to_string(file_path)?;
    let display_path = match file_path.strip_prefix(root_path) {
        Ok(relative) if !relative.as_os_str().is_empty() => relative.display().to_string(),
        _ => file_path.display().to_string(),
    };

    let summary = AST_CACHE.get_or_compute(file_path, language, &content)?;
    for symbol in summary.symbols {
        if symbols.len() >= limit {
            break;
        }
        symbols.push(SymbolEntry {
            name: symbol.name,
            kind: symbol.kind,
            path: display_path.clone(),
            line: symbol.line,
            preview: symbol.preview,
        });
    }

    Ok(())
}

fn matches_language(path: &Path, language: Option<&str>) -> bool {
    match language.map(|value| value.to_ascii_lowercase()) {
        Some(value) => detect_language(path) == Some(value.as_str()),
        None => detect_language(path).is_some(),
    }
}

fn detect_language(path: &Path) -> Option<&'static str> {
    match path.extension().and_then(|ext| ext.to_str()) {
        Some("rs") => Some("rust"),
        Some("py") => Some("python"),
        Some("js") | Some("jsx") => Some("javascript"),
        Some("ts") | Some("tsx") => Some("typescript"),
        Some("go") => Some("go"),
        _ => None,
    }
}

fn detect_primary_language(files: &[PathBuf]) -> String {
    files
        .first()
        .and_then(|path| detect_language(path))
        .unwrap_or("unknown")
        .to_string()
}
