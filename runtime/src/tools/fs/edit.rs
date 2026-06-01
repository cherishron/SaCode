use std::fs;

use crate::sandbox::FsAccess;
use crate::tools::{SideEffectLevel, ToolOutput, ToolSpec};

use super::access::resolve_allowed_path;

pub fn spec() -> ToolSpec {
    ToolSpec {
        name: "fs.edit".to_string(),
        description: "精确编辑文件内容（字符串替换）".to_string(),
        input_schema: serde_json::json!({
            "type": "object",
            "properties": {
                "path": { "type": "string", "description": "文件路径" },
                "old_string": { "type": "string", "description": "要替换的原始字符串" },
                "new_string": { "type": "string", "description": "替换后的新字符串" },
                "replace_all": { "type": "boolean", "default": false, "description": "是否替换所有匹配" }
            },
            "required": ["path", "old_string", "new_string"]
        }),
        output_schema: serde_json::json!({
            "type": "object",
            "properties": {
                "success": { "type": "boolean" },
                "replacements": { "type": "integer" },
                "path": { "type": "string" }
            }
        }),
        side_effect_level: SideEffectLevel::Modify,
        approval_required: true,
        timeout_ms: Some(5_000),
        tags: vec!["fs".to_string(), "edit".to_string()],
    }
}

pub fn execute(input: serde_json::Value) -> anyhow::Result<ToolOutput> {
    let path = input["path"].as_str().unwrap_or("");
    let old_string = input["old_string"].as_str().unwrap_or("");
    let new_string = input["new_string"].as_str().unwrap_or("");
    let replace_all = input["replace_all"].as_bool().unwrap_or(false);

    if path.is_empty() {
        return Ok(ToolOutput::failure("path is required"));
    }
    if old_string.is_empty() {
        return Ok(ToolOutput::failure("old_string is required"));
    }

    let file_path = resolve_allowed_path(path, FsAccess::Write)?;
    if !file_path.exists() {
        return Ok(ToolOutput::failure(format!("file not found: {}", path)));
    }

    let content = fs::read_to_string(&file_path)?;
    let occurrences = content.matches(old_string).count();
    if occurrences == 0 {
        return Ok(ToolOutput::failure("old_string not found in file"));
    }
    if occurrences > 1 && !replace_all {
        return Ok(ToolOutput::failure(format!(
            "old_string matched {} times, set replace_all=true or provide more context",
            occurrences
        )));
    }

    let updated = if replace_all {
        content.replace(old_string, new_string)
    } else {
        content.replacen(old_string, new_string, 1)
    };

    fs::write(&file_path, updated)?;

    Ok(ToolOutput::success(serde_json::json!({
        "success": true,
        "replacements": if replace_all { occurrences } else { 1 },
        "path": file_path.display().to_string()
    })).with_message(format!("edited {}", file_path.display())))
}
