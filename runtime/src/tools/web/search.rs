use crate::tools::{SideEffectLevel, ToolOutput, ToolSpec};
use anyhow::Result;
use serde::Deserialize;

const MAX_WEB_RESULTS: usize = 5;

#[derive(Debug, Deserialize)]
struct SearchInput {
    query: String,
    provider: Option<String>,
}

#[derive(Debug, Deserialize)]
struct DuckDuckGoResponse {
    #[serde(rename = "AbstractText")]
    abstract_text: String,
    #[serde(rename = "AbstractURL")]
    abstract_url: String,
    #[serde(rename = "RelatedTopics")]
    related_topics: Vec<DuckDuckGoTopic>,
}

#[derive(Debug, Deserialize)]
struct DuckDuckGoTopic {
    #[serde(rename = "Text")]
    text: Option<String>,
    #[serde(rename = "FirstURL")]
    first_url: Option<String>,
}

pub fn spec() -> ToolSpec {
    ToolSpec {
        name: "web.search".to_string(),
        description: "Search the web for public information".to_string(),
        input_schema: serde_json::json!({
            "type": "object",
            "properties": {
                "query": { "type": "string" },
                "provider": { "type": "string" }
            },
            "required": ["query"]
        }),
        output_schema: serde_json::json!({
            "type": "object",
            "properties": {
                "provider": { "type": "string" },
                "query": { "type": "string" },
                "results": { "type": "array" }
            }
        }),
        side_effect_level: SideEffectLevel::ReadOnly,
        approval_required: false,
        timeout_ms: Some(15_000),
        tags: vec!["web".to_string(), "search".to_string()],
    }
}

pub fn execute(input: serde_json::Value) -> Result<ToolOutput> {
    let payload: SearchInput = serde_json::from_value(input)?;
    let provider = payload.provider.unwrap_or_else(|| "duckduckgo".to_string());

    if provider != "duckduckgo" {
        return Ok(ToolOutput::failure(format!(
            "unsupported search provider: {}",
            provider
        )));
    }

    let client = reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .build()?;

    let response = client
        .get("https://api.duckduckgo.com/")
        .query(&[("q", payload.query.as_str()), ("format", "json"), ("no_html", "1")])
        .send()?;

    let body: DuckDuckGoResponse = response.json()?;
    let mut results = Vec::new();

    if !body.abstract_text.trim().is_empty() {
        results.push(serde_json::json!({
            "title": payload.query,
            "url": body.abstract_url,
            "snippet": body.abstract_text,
        }));
    }

    for item in body.related_topics.into_iter().take(MAX_WEB_RESULTS) {
        if let (Some(text), Some(url)) = (item.text, item.first_url) {
            results.push(serde_json::json!({
                "title": text,
                "url": url,
                "snippet": text,
            }));
        }
    }

    Ok(ToolOutput::success(serde_json::json!({
        "provider": provider,
        "query": payload.query,
        "count": results.len(),
        "results": results,
    })))
}
