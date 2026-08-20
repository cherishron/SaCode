use std::collections::{BTreeSet, HashMap};
use std::fs;
use std::path::{Path, PathBuf};

use crate::sandbox::FsAccess;
use crate::tools::{SideEffectLevel, ToolOutput, ToolSpec};

use crate::tools::context::current_context;
use super::cache::{ast_cache, file_list_cache};

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

    let resolved_path = current_context().resolve_path(path, FsAccess::Read)?;
    if !resolved_path.exists() {
        return Ok(ToolOutput::failure(format!("path not found: {}", path)));
    }

    let mut source_files = file_list_cache().get_or_collect(
        &resolved_path,
        None,
        collect_source_files_with_language,
    )?;
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
    // 统一用正斜杠 /，跨平台一致，便于与 import_path_candidates 的候选匹配
    match file_path.strip_prefix(root) {
        Ok(relative) if !relative.as_os_str().is_empty() => {
            relative.display().to_string().replace('\\', "/")
        }
        _ => file_path.display().to_string().replace('\\', "/"),
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
    let summary = ast_cache().get_or_compute(path, language, &content)?;
    let mut imports = BTreeSet::new();
    for import in summary.imports {
        if !import.specifier.is_empty() {
            imports.insert(import.specifier);
        }
    }
    Ok(imports.into_iter().collect())
}

fn import_path_candidates(current_file: &str, import: &str) -> Vec<String> {
    // Rust 模块路径处理：crate:: / super:: / self:: 映射到文件候选
    if let Some(candidates) = rust_module_candidates(current_file, import) {
        return candidates;
    }

    if !import.starts_with("./") && !import.starts_with("../") {
        return vec![import.to_string()];
    }

    let current_path = Path::new(current_file);
    let base_dir = current_path.parent().unwrap_or_else(|| Path::new(""));
    let joined = normalize_relative_path(&base_dir.join(import));

    let mut candidates = BTreeSet::new();
    // 统一用正斜杠 /，与 display_path 格式一致
    candidates.insert(joined.display().to_string().replace('\\', "/"));

    if joined.extension().is_none() {
        for ext in ["ts", "tsx", "js", "jsx", "rs", "py", "go"] {
            candidates.insert(joined.with_extension(ext).display().to_string().replace('\\', "/"));
        }
        for ext in ["ts", "tsx", "js", "jsx"] {
            candidates.insert(joined.join(format!("index.{}", ext)).display().to_string().replace('\\', "/"));
        }
        candidates.insert(joined.join("mod.rs").display().to_string().replace('\\', "/"));
    }

    candidates.into_iter().collect()
}

/// Rust 模块路径 → 文件候选映射
///
/// 处理三种 Rust 模块前缀：
/// - `crate::foo::bar` → `src/foo/bar.rs` | `src/foo/bar/mod.rs`（Rust 惯例 src 在根下）
///   同时生成无 `src/` 前缀的候选，适配 resolved_path 为 src/ 目录的场景
/// - `super::baz`（可连续 `super::super::`）→ 当前文件上级相应层级的 `baz.rs` | `baz/mod.rs`
/// - `self::qux` → 当前文件所在目录的 `qux.rs` | `qux/mod.rs`
///
/// `std::` / `anyhow::` 等外部 crate 返回 None，由调用方保留 specifier 原样。
/// 所有候选路径统一用正斜杠 `/`，与 display_path 格式一致。
fn rust_module_candidates(current_file: &str, import: &str) -> Option<Vec<String>> {
    // 辅助：把模块路径字符串拼接为文件路径候选（统一用 /）
    let make_candidates = |base_parts: &[&str], module_path: &str| -> Vec<String> {
        let prefix = if base_parts.is_empty() {
            String::new()
        } else {
            format!("{}/", base_parts.join("/"))
        };
        vec![
            format!("{}{}.rs", prefix, module_path),
            format!("{}{}/mod.rs", prefix, module_path),
        ]
    };

    if let Some(rest) = import.strip_prefix("crate::") {
        if rest.is_empty() {
            return None;
        }
        let module_path = rest.replace("::", "/");
        // crate:: 候选：同时生成带 src/ 和不带，适配不同 resolved_path 层级
        let mut candidates = BTreeSet::new();
        for c in make_candidates(&["src"], &module_path) {
            candidates.insert(c);
        }
        for c in make_candidates(&[], &module_path) {
            candidates.insert(c);
        }
        return Some(candidates.into_iter().collect());
    } else if import.starts_with("super::") {
        // 统计 super:: 前缀数量，支持 super::super::foo
        let mut count = 0;
        let mut rest = import;
        while let Some(r) = rest.strip_prefix("super::") {
            count += 1;
            rest = r;
        }
        if rest.is_empty() {
            return None;
        }
        let module_path = rest.replace("::", "/");
        // current_file 用 / 分隔，拆分各级
        let parts: Vec<&str> = current_file.split('/').collect();
        // current_file 如 src/foo/mod.rs，parent 为 src/foo
        // 去掉最后一段（文件名），再上溯 count 级
        let mut base_parts: Vec<&str> = if parts.len() > 1 {
            parts[..parts.len() - 1].to_vec()
        } else {
            Vec::new()
        };
        for _ in 0..count {
            base_parts.pop();
        }
        return Some(make_candidates(&base_parts, &module_path));
    } else if let Some(rest) = import.strip_prefix("self::") {
        if rest.is_empty() {
            return None;
        }
        let module_path = rest.replace("::", "/");
        let parts: Vec<&str> = current_file.split('/').collect();
        let base_parts: Vec<&str> = if parts.len() > 1 {
            parts[..parts.len() - 1].to_vec()
        } else {
            Vec::new()
        };
        return Some(make_candidates(&base_parts, &module_path));
    }

    None
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rust_crate_prefix_maps_to_src_candidates() {
        let candidates = import_path_candidates("src/foo/mod.rs", "crate::bar::baz");
        // 应生成带 src/ 和不带的两套候选
        assert!(candidates.iter().any(|c| c == "src/bar/baz.rs"), "应有 src/bar/baz.rs");
        assert!(candidates.iter().any(|c| c == "src/bar/baz/mod.rs"), "应有 src/bar/baz/mod.rs");
        assert!(candidates.iter().any(|c| c == "bar/baz.rs"), "应有 bar/baz.rs（无 src 前缀）");
        assert!(candidates.iter().any(|c| c == "bar/baz/mod.rs"), "应有 bar/baz/mod.rs");
    }

    #[test]
    fn rust_super_prefix_maps_to_parent_dir() {
        // 当前文件 src/foo/mod.rs，super::bar → src/bar.rs | src/bar/mod.rs
        let candidates = import_path_candidates("src/foo/mod.rs", "super::bar");
        assert!(candidates.iter().any(|c| c == "src/bar.rs"), "应有 src/bar.rs");
        assert!(candidates.iter().any(|c| c == "src/bar/mod.rs"), "应有 src/bar/mod.rs");
    }

    #[test]
    fn rust_double_super_maps_to_grandparent() {
        // 当前文件 src/foo/sub/mod.rs，super::super::bar → src/bar.rs
        let candidates = import_path_candidates("src/foo/sub/mod.rs", "super::super::bar");
        assert!(candidates.iter().any(|c| c == "src/bar.rs"), "应有 src/bar.rs");
        assert!(candidates.iter().any(|c| c == "src/bar/mod.rs"), "应有 src/bar/mod.rs");
    }

    #[test]
    fn rust_self_prefix_maps_to_current_dir() {
        // 当前文件 src/foo/mod.rs，self::bar → src/foo/bar.rs
        let candidates = import_path_candidates("src/foo/mod.rs", "self::bar");
        assert!(candidates.iter().any(|c| c == "src/foo/bar.rs"), "应有 src/foo/bar.rs");
        assert!(candidates.iter().any(|c| c == "src/foo/bar/mod.rs"), "应有 src/foo/bar/mod.rs");
    }

    #[test]
    fn rust_external_crate_returns_original_specifier() {
        // std::collections 等外部 crate 不映射到文件，保留原 specifier
        let candidates = import_path_candidates("src/main.rs", "std::collections::HashMap");
        assert_eq!(candidates, vec!["std::collections::HashMap".to_string()]);
    }

    #[test]
    fn js_relative_path_still_works() {
        // 确保原有 JS/TS 相对路径处理未被破坏
        let candidates = import_path_candidates("src/foo.ts", "./bar");
        assert!(candidates.iter().any(|c| c == "src/bar.ts"), "应有 src/bar.ts");
        assert!(candidates.iter().any(|c| c == "src/bar.tsx"), "应有 src/bar.tsx");
    }
}
