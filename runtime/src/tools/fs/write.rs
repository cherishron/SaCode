use crate::tools::{ToolSpec, ToolOutput, SideEffectLevel};

fn resolve_workspace_path(path: &str) -> anyhow::Result<std::path::PathBuf> {
    let workspace_root = std::env::current_dir()?;
    let requested_path = std::path::PathBuf::from(path);
    let joined_path = if requested_path.is_absolute() {
        requested_path
    } else {
        workspace_root.join(requested_path)
    };

    let mut normalized = std::path::PathBuf::new();
    for component in joined_path.components() {
        match component {
            std::path::Component::CurDir => {}
            std::path::Component::ParentDir => {
                if !normalized.pop() {
                    anyhow::bail!("path is outside workspace");
                }
            }
            other => normalized.push(other.as_os_str()),
        }
    }

    if normalized.starts_with(&workspace_root) {
        Ok(normalized)
    } else {
        anyhow::bail!("path is outside workspace")
    }
}

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

    let path_buf = resolve_workspace_path(path)?;
    
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
