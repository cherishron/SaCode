use crate::tools::{SideEffectLevel, ToolOutput, ToolSpec};

use super::{collapse_whitespace, extract_fragment, get_session, html_to_text, truncate_chars};

pub fn spec() -> ToolSpec {
    ToolSpec {
        name: "browser.extract".to_string(),
        description: "Extract a fragment from the current browser session".to_string(),
        input_schema: serde_json::json!({
            "type": "object",
            "properties": {
                "session_id": { "type": "string" },
                "selector": { "type": "string", "description": "tag, #id, or .class" },
                "format": { "type": "string", "enum": ["text", "html"], "default": "text" }
            },
            "required": ["session_id", "selector"]
        }),
        output_schema: serde_json::json!({
            "type": "object",
            "properties": {
                "session_id": { "type": "string" },
                "selector": { "type": "string" },
                "format": { "type": "string" },
                "content": { "type": "string" }
            }
        }),
        side_effect_level: SideEffectLevel::ReadOnly,
        approval_required: false,
        timeout_ms: Some(5_000),
        tags: vec!["browser".to_string(), "extract".to_string()],
    }
}

pub fn execute(input: serde_json::Value) -> anyhow::Result<ToolOutput> {
    let session_id = input["session_id"].as_str().unwrap_or("").trim();
    let selector = input["selector"].as_str().unwrap_or("").trim();
    if session_id.is_empty() {
        return Ok(ToolOutput::failure("session_id is required"));
    }
    if selector.is_empty() {
        return Ok(ToolOutput::failure("selector is required"));
    }

    let format = input["format"].as_str().unwrap_or("text");
    let session = get_session(session_id)?;
    let fragment = match extract_fragment(&session.html, selector) {
        Some(value) => value,
        None => return Ok(ToolOutput::failure(format!("selector not found: {}", selector))),
    };
    let content = if format == "html" {
        truncate_chars(&fragment, 20_000)
    } else {
        truncate_chars(&collapse_whitespace(&html_to_text(&fragment)), 10_000)
    };

    Ok(ToolOutput::success(serde_json::json!({
        "session_id": session.session_id,
        "selector": selector,
        "format": format,
        "content": content,
    })))
}
