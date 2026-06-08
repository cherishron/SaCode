use crate::tools::{SideEffectLevel, ToolOutput, ToolSpec};

use super::navigate_session;

pub fn spec() -> ToolSpec {
    ToolSpec {
        name: "browser.navigate".to_string(),
        description: "Navigate an existing browser session to a new URL".to_string(),
        input_schema: serde_json::json!({
            "type": "object",
            "properties": {
                "session_id": { "type": "string" },
                "url": { "type": "string" }
            },
            "required": ["session_id", "url"]
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
        tags: vec!["browser".to_string(), "navigate".to_string()],
    }
}

pub fn execute(input: serde_json::Value) -> anyhow::Result<ToolOutput> {
    let session_id = input["session_id"].as_str().unwrap_or("").trim();
    let url = input["url"].as_str().unwrap_or("").trim();
    if session_id.is_empty() {
        return Ok(ToolOutput::failure("session_id is required"));
    }
    if url.is_empty() {
        return Ok(ToolOutput::failure("url is required"));
    }

    let session = navigate_session(session_id, url)?;
    Ok(ToolOutput::success(serde_json::json!({
        "session_id": session.session_id,
        "url": session.url,
        "status": session.status,
        "title": session.title,
        "text": session.text,
    })))
}
