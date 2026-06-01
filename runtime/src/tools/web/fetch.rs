use crate::tools::{SideEffectLevel, ToolOutput, ToolSpec};
use crate::sandbox::{active_policy, NetworkAccess};
use anyhow::Result;

#[derive(Debug, serde::Deserialize)]
struct FetchInput {
    url: String,
}

pub fn spec() -> ToolSpec {
    ToolSpec {
        name: "web.fetch".to_string(),
        description: "Fetch a web page over HTTP".to_string(),
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
                "url": { "type": "string" },
                "status": { "type": "number" },
                "body": { "type": "string" }
            }
        }),
        side_effect_level: SideEffectLevel::ReadOnly,
        approval_required: false,
        timeout_ms: Some(15_000),
        tags: vec!["web".to_string(), "fetch".to_string()],
    }
}

pub fn execute(input: serde_json::Value) -> Result<ToolOutput> {
    if !active_policy().check_network(NetworkAccess::Fetch) {
        return Ok(ToolOutput::failure("network access blocked by sandbox policy"));
    }

    let payload: FetchInput = serde_json::from_value(input)?;
    let client = reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .build()?;

    let response = client.get(&payload.url).send()?;
    let status = response.status().as_u16();
    let body = response.text()?;
    let trimmed = truncate_chars(&body, 20_000);

    Ok(ToolOutput::success(serde_json::json!({
        "url": payload.url,
        "status": status,
        "body": trimmed,
    })))
}

fn truncate_chars(input: &str, max_chars: usize) -> String {
    let mut chars = input.chars();
    let preview: String = chars.by_ref().take(max_chars).collect();
    if chars.next().is_some() {
        format!("{}...", preview)
    } else {
        preview
    }
}
