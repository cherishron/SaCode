use crate::tools::{SideEffectLevel, ToolOutput, ToolSpec};

use super::get_session;

pub fn spec() -> ToolSpec {
    ToolSpec {
        name: "browser.snapshot".to_string(),
        description: "Get the current snapshot of a browser session".to_string(),
        input_schema: serde_json::json!({
            "type": "object",
            "properties": {
                "session_id": { "type": "string" },
                "format": { "type": "string", "enum": ["text", "html"], "default": "text" }
            },
            "required": ["session_id"]
        }),
        output_schema: serde_json::json!({
            "type": "object",
            "properties": {
                "session_id": { "type": "string" },
                "url": { "type": "string" },
                "status": { "type": "integer" },
                "title": { "type": ["string", "null"] },
                "format": { "type": "string" },
                "content": { "type": "string" }
            }
        }),
        side_effect_level: SideEffectLevel::ReadOnly,
        approval_required: false,
        timeout_ms: Some(5_000),
        tags: vec!["browser".to_string(), "snapshot".to_string()],
    }
}

pub fn execute(input: serde_json::Value) -> anyhow::Result<ToolOutput> {
    let session_id = input["session_id"].as_str().unwrap_or("").trim();
    if session_id.is_empty() {
        return Ok(ToolOutput::failure("session_id is required"));
    }

    let format = input["format"].as_str().unwrap_or("text");
    let session = get_session(session_id)?;
    let content = if format == "html" {
        session.html.clone()
    } else {
        session.text.clone()
    };

    Ok(ToolOutput::success(serde_json::json!({
        "session_id": session.session_id,
        "url": session.url,
        "status": session.status,
        "title": session.title,
        "format": format,
        "content": content,
    })))
}
