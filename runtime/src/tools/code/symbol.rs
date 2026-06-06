use std::fs;
use std::path::{Path, PathBuf};

use crate::sandbox::FsAccess;
use crate::tools::{SideEffectLevel, ToolOutput, ToolSpec};

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

    let mut files = Vec::new();
    collect_source_files(&resolved_path, language, &mut files)?;
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

    for (index, line) in content.lines().enumerate() {
        if symbols.len() >= limit {
            break;
        }

        let Some((kind, name)) = parse_symbol(line, language) else {
            continue;
        };

        symbols.push(SymbolEntry {
            name,
            kind,
            path: display_path.clone(),
            line: index + 1,
            preview: line.trim().to_string(),
        });
    }

    Ok(())
}

fn parse_symbol(line: &str, language: &str) -> Option<(String, String)> {
    match language {
        "rust" => parse_rust_symbol(line),
        "python" => parse_python_symbol(line),
        "javascript" | "typescript" => parse_js_symbol(line),
        "go" => parse_go_symbol(line),
        _ => None,
    }
}

fn parse_rust_symbol(line: &str) -> Option<(String, String)> {
    let trimmed = line.trim();
    if trimmed.is_empty() || trimmed.starts_with("//") || trimmed.starts_with("#") {
        return None;
    }

    for keyword in ["fn", "struct", "enum", "trait", "mod", "type"] {
        if let Some(name) = extract_name_after_keyword(trimmed, keyword) {
            return Some((keyword.to_string(), name));
        }
    }

    if let Some(name) = extract_impl_name(trimmed) {
        return Some(("impl".to_string(), name));
    }

    None
}

fn parse_python_symbol(line: &str) -> Option<(String, String)> {
    let trimmed = line.trim();
    if trimmed.is_empty() || trimmed.starts_with('#') {
        return None;
    }

    if let Some(name) = extract_name_after_prefix(trimmed, "def ") {
        return Some(("function".to_string(), name));
    }
    if let Some(name) = extract_name_after_prefix(trimmed, "async def ") {
        return Some(("function".to_string(), name));
    }
    if let Some(name) = extract_name_after_prefix(trimmed, "class ") {
        return Some(("class".to_string(), name));
    }
    None
}

fn parse_js_symbol(line: &str) -> Option<(String, String)> {
    let trimmed = line.trim();
    if trimmed.is_empty() || trimmed.starts_with("//") {
        return None;
    }

    for prefix in [
        "export function ",
        "function ",
        "export class ",
        "class ",
        "export interface ",
        "interface ",
        "export type ",
        "type ",
        "export enum ",
        "enum ",
        "const ",
        "let ",
        "var ",
    ] {
        if let Some(name) = extract_name_after_prefix(trimmed, prefix) {
            let kind = if prefix.contains("class") {
                "class"
            } else if prefix.contains("interface") {
                "interface"
            } else if prefix.contains("type") {
                "type"
            } else if prefix.contains("enum") {
                "enum"
            } else {
                "function"
            };
            return Some((kind.to_string(), trim_js_assignment_name(&name)));
        }
    }
    None
}

fn parse_go_symbol(line: &str) -> Option<(String, String)> {
    let trimmed = line.trim();
    if trimmed.is_empty() || trimmed.starts_with("//") {
        return None;
    }

    if let Some(name) = extract_name_after_prefix(trimmed, "func ") {
        return Some(("function".to_string(), trim_go_receiver(&name)));
    }
    if let Some(name) = extract_name_after_prefix(trimmed, "type ") {
        return Some(("type".to_string(), name));
    }
    if let Some(name) = extract_name_after_prefix(trimmed, "var ") {
        return Some(("var".to_string(), name));
    }
    if let Some(name) = extract_name_after_prefix(trimmed, "const ") {
        return Some(("const".to_string(), name));
    }
    None
}

fn extract_name_after_keyword(line: &str, keyword: &str) -> Option<String> {
    let marker = format!("{} ", keyword);
    let position = line.find(&marker)?;
    let prefix = &line[..position];
    if !prefix.is_empty()
        && !prefix.ends_with("pub ")
        && !prefix.ends_with("async ")
        && !prefix.ends_with("unsafe ")
        && !prefix.ends_with("const ")
        && !prefix.ends_with("default ")
    {
        return None;
    }

    let rest = &line[position + marker.len()..];
    take_identifier(rest)
}

fn extract_impl_name(line: &str) -> Option<String> {
    let rest = line.strip_prefix("impl ")?;
    let target = rest.split(" for ").next().unwrap_or(rest).trim();
    take_identifier(target)
}

fn extract_name_after_prefix(line: &str, prefix: &str) -> Option<String> {
    let rest = line.strip_prefix(prefix)?;
    take_identifier(rest)
}

fn trim_js_assignment_name(name: &str) -> String {
    name.trim_end_matches(['=', ':']).to_string()
}

fn trim_go_receiver(name: &str) -> String {
    if let Some(receiver_end) = name.find(')') {
        let after_receiver = name[receiver_end + 1..].trim();
        if let Some(identifier) = take_identifier(after_receiver) {
            return identifier;
        }
    }
    name.to_string()
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

fn take_identifier(value: &str) -> Option<String> {
    let ident: String = value
        .chars()
        .take_while(|ch| ch.is_ascii_alphanumeric() || *ch == '_')
        .collect();
    if ident.is_empty() {
        None
    } else {
        Some(ident)
    }
}
