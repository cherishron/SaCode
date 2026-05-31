use crate::tools::{SideEffectLevel, ToolOutput, ToolSpec};

use super::create_session;

pub fn spec() -> ToolSpec {
    ToolSpec {
        name: "browser.open".to_string(),
        description: "Open a browser session for a URL".to_string(),
        input_schema: serde_json::json!({
            "type": "object",
            "properties": {
                "url": { "type": "string" }
            },
            "required": ["url"]
        }),
        output_schema: serde_json::json!({
            "type": "object",
            "properties": {
                "session_id": { "type": "string" },
                "url": { "type": "string" },
                "status": { "type": "integer" },
                "title": { "type": ["string", "null"] },
                "text": { "type": "string" }
            }
        }),
        side_effect_level: SideEffectLevel::ReadOnly,
        approval_required: false,
        timeout_ms: Some(20_000),
        tags: vec!["browser".to_string(), "open".to_string()],
    }
}

pub fn execute(input: serde_json::Value) -> anyhow::Result<ToolOutput> {
    let url = input["url"].as_str().unwrap_or("").trim();
    if url.is_empty() {
        return Ok(ToolOutput::failure("url is required"));
    }

    let session = create_session(url)?;
    Ok(ToolOutput::success(serde_json::json!({
        "session_id": session.session_id,
        "url": session.url,
        "status": session.status,
        "title": session.title,
        "text": session.text,
    })))
}
