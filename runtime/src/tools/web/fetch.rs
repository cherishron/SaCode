use super::{extract_tag_text, html_to_text, normalize_url, send_with_retries, truncate_chars};
use crate::sandbox::{active_policy, NetworkAccess};
use crate::tools::{SideEffectLevel, ToolOutput, ToolSpec};
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
                "content_type": { "type": "string" },
                "title": { "type": "string" },
                "body": { "type": "string" },
                "text": { "type": "string" },
                "final_text": { "type": "string" }
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
        return Ok(ToolOutput::failure(
            "network access blocked by sandbox policy",
        ));
    }

    let payload: FetchInput = serde_json::from_value(input)?;
    let url = normalize_url(&payload.url);
    let response = send_with_retries(15, |client| {
        client.get(&url).header(
            reqwest::header::ACCEPT,
            "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.8",
        )
    })?;

    let status = response.status().as_u16();
    let content_type = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .unwrap_or_default()
        .to_string();
    let body = response.text()?;
    let title = if content_type.contains("html") {
        extract_tag_text(&body, "title")
    } else {
        None
    };
    let text = if content_type.contains("html") {
        html_to_text(&body)
    } else {
        body.clone()
    };
    let trimmed_body = truncate_chars(&body, 20_000);
    let trimmed_text = truncate_chars(&text, 8_000);
    let final_text = if let Some(title) = title.as_ref() {
        if trimmed_text.is_empty() {
            title.clone()
        } else {
            format!("{}\n\n{}", title, trimmed_text)
        }
    } else {
        trimmed_text.clone()
    };

    Ok(ToolOutput::success(serde_json::json!({
        "url": url,
        "status": status,
        "content_type": content_type,
        "title": title,
        "body": trimmed_body,
        "text": trimmed_text,
        "final_text": final_text,
    })))
}
