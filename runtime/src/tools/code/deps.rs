use std::collections::{BTreeSet, HashMap};
use std::fs;
use std::path::{Path, PathBuf};

use crate::sandbox::FsAccess;
use crate::tools::{SideEffectLevel, ToolOutput, ToolSpec};

use super::super::fs::access::resolve_allowed_path;
use super::cache::{AST_CACHE, FILE_LIST_CACHE};

const DEFAULT_LIMIT: usize = 200;

pub fn spec() -> ToolSpec {
    ToolSpec {
        name: "code.deps".to_string(),
        description: "提取代码文件依赖关系".to_string(),
        input_schema: serde_json::json!({
            "type": "object",
            "properties": {
                "path": { "type": "string", "description": "文件或目录路径" },
                "limit": { "type": "integer", "description": "最多返回多少个文件节点，默认 200" }
            },
            "required": ["path"]
        }),
        output_schema: serde_json::json!({
            "type": "object",
            "properties": {
                "path": { "type": "string" },
                "summary": { "type": "string" },
                "files": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "path": { "type": "string" },
                            "language": { "type": "string" },
                            "imports": { "type": "array", "items": { "type": "string" } },
                            "imported_by": { "type": "array", "items": { "type": "string" } }
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
        tags: vec!["code".to_string(), "deps".to_string()],
    }
}

pub fn execute(input: serde_json::Value) -> anyhow::Result<ToolOutput> {
    let path = input["path"].as_str().unwrap_or("").trim();
    let limit = input["limit"].as_u64().unwrap_or(DEFAULT_LIMIT as u64) as usize;

    if path.is_empty() {
        return Ok(ToolOutput::failure("path is required"));
    }

    let resolved_path = resolve_allowed_path(path, FsAccess::Read)?;
    if !resolved_path.exists() {
        return Ok(ToolOutput::failure(format!("path not found: {}", path)));
    }

    let mut source_files =
        FILE_LIST_CACHE.get_or_collect(&resolved_path, None, collect_source_files_with_language)?;
    if source_files.is_empty() {
        return Ok(ToolOutput::success(serde_json::json!({
            "path": path,
            "summary": format!("found 0 code dependency nodes in {}", path),
            "files": [],
            "count": 0,
            "truncated": false
        }))
        .with_message("no supported source files found"));
    }

    source_files.sort();

    let mut imported_by_map: HashMap<String, BTreeSet<String>> = HashMap::new();
    let mut file_entries = Vec::new();
    let mut truncated = false;

    for file_path in source_files.iter().take(limit) {
        let relative_path = display_path(&resolved_path, file_path);
        let language = detect_language(file_path).unwrap_or("unknown").to_string();
        let imports = extract_imports(file_path, &language)?;

        for import in &imports {
            for candidate in import_path_candidates(&relative_path, import) {
                imported_by_map
                    .entry(candidate)
                    .or_default()
                    .insert(relative_path.clone());
            }
        }

        file_entries.push((relative_path, language, imports));
    }

    if source_files.len() > limit {
        truncated = true;
    }

    let files = file_entries
        .into_iter()
        .map(|(file_path, language, imports)| {
            let imported_by = imported_by_map
                .get(&file_path)
                .map(|items| items.iter().cloned().collect::<Vec<_>>())
                .unwrap_or_default();
            serde_json::json!({
                "path": file_path,
                "language": language,
                "imports": imports,
                "imported_by": imported_by,
            })
        })
        .collect::<Vec<_>>();

    let count = files.len();
    Ok(ToolOutput::success(serde_json::json!({
        "path": path,
        "summary": format!("found {} code dependency nodes in {}", count, path),
        "files": files,
        "count": count,
        "truncated": truncated,
    })))
}

fn collect_source_files(path: &Path, files: &mut Vec<PathBuf>) -> anyhow::Result<()> {
    if path.is_file() {
        if detect_language(path).is_some() {
            files.push(path.to_path_buf());
        }
        return Ok(());
    }

    for entry in fs::read_dir(path)? {
        let entry = entry?;
        let entry_path = entry.path();
        if entry_path.is_dir() {
            collect_source_files(&entry_path, files)?;
        } else if detect_language(&entry_path).is_some() {
            files.push(entry_path);
        }
    }

    Ok(())
}

fn collect_source_files_with_language(
    path: &Path,
    _language: Option<&str>,
    files: &mut Vec<PathBuf>,
) -> anyhow::Result<()> {
    collect_source_files(path, files)
}

fn display_path(root: &Path, file_path: &Path) -> String {
    match file_path.strip_prefix(root) {
        Ok(relative) if !relative.as_os_str().is_empty() => relative.display().to_string(),
        _ => file_path.display().to_string(),
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

fn extract_imports(path: &Path, language: &str) -> anyhow::Result<Vec<String>> {
    let content = fs::read_to_string(path)?;
    let summary = AST_CACHE.get_or_compute(path, language, &content)?;
    let mut imports = BTreeSet::new();
    for import in summary.imports {
        if !import.specifier.is_empty() {
            imports.insert(import.specifier);
        }
    }
    Ok(imports.into_iter().collect())
}

fn import_path_candidates(current_file: &str, import: &str) -> Vec<String> {
    if !import.starts_with("./") && !import.starts_with("../") {
        return vec![import.to_string()];
    }

    let current_path = Path::new(current_file);
    let base_dir = current_path.parent().unwrap_or_else(|| Path::new(""));
    let joined = normalize_relative_path(&base_dir.join(import));

    let mut candidates = BTreeSet::new();
    candidates.insert(joined.display().to_string());

    if joined.extension().is_none() {
        for ext in ["ts", "tsx", "js", "jsx", "rs", "py", "go"] {
            candidates.insert(joined.with_extension(ext).display().to_string());
        }
        for ext in ["ts", "tsx", "js", "jsx"] {
            candidates.insert(joined.join(format!("index.{}", ext)).display().to_string());
        }
        candidates.insert(joined.join("mod.rs").display().to_string());
    }

    candidates.into_iter().collect()
}

fn normalize_relative_path(path: &Path) -> PathBuf {
    let mut normalized = PathBuf::new();
    for component in path.components() {
        match component {
            std::path::Component::CurDir => {}
            std::path::Component::ParentDir => {
                normalized.pop();
            }
            other => normalized.push(other.as_os_str()),
        }
    }
    normalized
}
