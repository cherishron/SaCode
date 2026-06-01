use std::fs;

use crate::sandbox::FsAccess;
use crate::tools::spec::{ToolSpec, ToolOutput, SideEffectLevel};

use super::access::resolve_allowed_path;

pub fn spec() -> ToolSpec {
    ToolSpec {
        name: "fs.read".to_string(),
        description: "读取文件内容".to_string(),
        input_schema: serde_json::json!({
            "type": "object",
            "properties": {
                "path": { "type": "string", "description": "文件路径" },
                "offset": { "type": "integer", "description": "起始行号(可选,默认1)" },
                "limit": { "type": "integer", "description": "读取行数限制(可选,默认200)" }
            },
            "required": ["path"]
        }),
        output_schema: serde_json::json!({
            "type": "object",
            "properties": {
                "path": { "type": "string" },
                "content": { "type": "string" },
                "lines": { "type": "integer" },
                "total_lines": { "type": "integer" }
            }
        }),
        side_effect_level: SideEffectLevel::ReadOnly,
        approval_required: false,
        timeout_ms: Some(5000),
        tags: vec!["fs".to_string(), "read".to_string()],
    }
}

pub fn execute(input: serde_json::Value) -> anyhow::Result<ToolOutput> {
    let path = input["path"].as_str().unwrap_or("");
    let offset = input["offset"].as_u64().unwrap_or(1) as usize;
    let limit = input["limit"].as_u64().unwrap_or(200) as usize;

    if path.is_empty() {
        return Ok(ToolOutput::failure("path is required"));
    }

    let file_path = resolve_allowed_path(path, FsAccess::Read)?;
    if !file_path.exists() {
        return Ok(ToolOutput::failure(format!("file not found: {}", path)));
    }

    let content = fs::read_to_string(&file_path)?;
    let all_lines: Vec<&str> = content.lines().collect();
    let total_lines = all_lines.len();

    let start = if offset > 0 { offset - 1 } else { 0 };
    let end = std::cmp::min(start + limit, total_lines);

    let selected_lines: Vec<&str> = all_lines[start..end].to_vec();
    let output_content = selected_lines.join("\n");

    Ok(ToolOutput::success(serde_json::json!({
        "path": path,
        "content": output_content,
        "lines": selected_lines.len(),
        "total_lines": total_lines,
        "offset": offset,
        "limit": limit
    })))
}
