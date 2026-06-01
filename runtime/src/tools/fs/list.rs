use std::fs;
use std::path::Path;

use crate::sandbox::FsAccess;
use crate::tools::{SideEffectLevel, ToolOutput, ToolSpec};

use super::access::resolve_allowed_path;

pub fn spec() -> ToolSpec {
    ToolSpec {
        name: "fs.list".to_string(),
        description: "列出目录内容".to_string(),
        input_schema: serde_json::json!({
            "type": "object",
            "properties": {
                "path": { "type": "string", "default": ".", "description": "目录路径" },
                "recursive": { "type": "boolean", "default": false, "description": "是否递归列出" },
                "include_hidden": { "type": "boolean", "default": false, "description": "是否包含隐藏文件" }
            }
        }),
        output_schema: serde_json::json!({
            "type": "object",
            "properties": {
                "path": { "type": "string" },
                "entries": { "type": "array" },
                "total_entries": { "type": "integer" }
            }
        }),
        side_effect_level: SideEffectLevel::ReadOnly,
        approval_required: false,
        timeout_ms: Some(10_000),
        tags: vec!["fs".to_string(), "list".to_string()],
    }
}

pub fn execute(input: serde_json::Value) -> anyhow::Result<ToolOutput> {
    let path = input["path"].as_str().unwrap_or(".");
    let recursive = input["recursive"].as_bool().unwrap_or(false);
    let include_hidden = input["include_hidden"].as_bool().unwrap_or(false);

    let dir_path = resolve_allowed_path(path, FsAccess::Read)?;
    if !dir_path.exists() {
        return Ok(ToolOutput::failure(format!("directory not found: {}", path)));
    }
    if !dir_path.is_dir() {
        return Ok(ToolOutput::failure(format!("path is not a directory: {}", path)));
    }

    let mut entries = Vec::new();
    collect_entries(&dir_path, &dir_path, recursive, include_hidden, &mut entries)?;
    entries.sort_by(|a, b| {
        let a_type = a["type"].as_str().unwrap_or("");
        let b_type = b["type"].as_str().unwrap_or("");
        a_type.cmp(b_type).then_with(|| a["name"].as_str().unwrap_or("").cmp(b["name"].as_str().unwrap_or("")))
    });

    Ok(ToolOutput::success(serde_json::json!({
        "path": dir_path.display().to_string(),
        "entries": entries,
        "total_entries": entries.len()
    })))
}

fn collect_entries(
    root: &Path,
    current: &Path,
    recursive: bool,
    include_hidden: bool,
    entries: &mut Vec<serde_json::Value>,
) -> anyhow::Result<()> {
    for entry in fs::read_dir(current)? {
        let entry = entry?;
        let file_name = entry.file_name();
        let file_name = file_name.to_string_lossy().to_string();
        if !include_hidden && file_name.starts_with('.') {
            continue;
        }

        let path = entry.path();
        let metadata = entry.metadata()?;
        let relative = relative_name(root, &path);
        let kind = if metadata.is_dir() { "directory" } else { "file" };

        entries.push(serde_json::json!({
            "name": relative,
            "type": kind,
            "size": metadata.len()
        }));

        if recursive && metadata.is_dir() {
            collect_entries(root, &path, recursive, include_hidden, entries)?;
        }
    }
    Ok(())
}

fn relative_name(root: &Path, path: &Path) -> String {
    path.strip_prefix(root)
        .unwrap_or(path)
        .to_string_lossy()
        .replace(std::path::MAIN_SEPARATOR, "/")
}
