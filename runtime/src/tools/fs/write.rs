use crate::tools::{ToolSpec, ToolOutput, SideEffectLevel};
use super::access::resolve_allowed_path;

pub fn spec() -> ToolSpec {
    ToolSpec {
        name: "fs.write".to_string(),
        description: "Write content to a file".to_string(),
        input_schema: serde_json::json!({
            "type": "object",
            "properties": {
                "path": { "type": "string", "description": "File path to write" },
                "content": { "type": "string", "description": "Content to write" },
                "mode": { "type": "string", "enum": ["write", "append"], "default": "write" }
            },
            "required": ["path", "content"]
        }),
        output_schema: serde_json::json!({
            "type": "object",
            "properties": {
                "success": { "type": "boolean" },
                "bytes_written": { "type": "number" },
                "path": { "type": "string" }
            }
        }),
        side_effect_level: SideEffectLevel::Modify,
        approval_required: true,
        timeout_ms: Some(5000),
        tags: vec!["fs".to_string(), "write".to_string()],
    }
}

pub fn execute(input: serde_json::Value) -> anyhow::Result<ToolOutput> {
    let path = input["path"].as_str()
        .ok_or_else(|| anyhow::anyhow!("missing path"))?;
    
    let content = input["content"].as_str()
        .ok_or_else(|| anyhow::anyhow!("missing content"))?;
    
    let mode = input["mode"].as_str().unwrap_or("write");

    let path_buf = resolve_allowed_path(path)?;
    
    if let Some(parent) = path_buf.parent() {
        if !parent.exists() {
            std::fs::create_dir_all(parent)?;
        }
    }

    let bytes_written = match mode {
        "append" => {
            use std::io::Write;
            let mut file = std::fs::OpenOptions::new()
                .create(true)
                .append(true)
                .open(&path_buf)?;
            file.write_all(content.as_bytes())?;
            content.len()
        }
        _ => {
            std::fs::write(&path_buf, content)?;
            content.len()
        }
    };

    Ok(ToolOutput::success(serde_json::json!({
        "bytes_written": bytes_written,
        "path": path_buf.display().to_string()
    })).with_message(format!("Written {} bytes to {}", bytes_written, path_buf.display())))
}
