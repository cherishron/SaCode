use crate::tools::{SideEffectLevel, ToolOutput, ToolSpec};
use crate::sandbox::{active_policy, NetworkAccess};
use super::{decode_html_entities, normalize_url, send_with_retries, truncate_chars};
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
    #[serde(rename = "Topics")]
    topics: Option<Vec<DuckDuckGoTopic>>,
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
    if !active_policy().check_network(NetworkAccess::Search) {
        return Ok(ToolOutput::failure("network access blocked by sandbox policy"));
    }

    let payload: SearchInput = serde_json::from_value(input)?;
    let provider = payload.provider.unwrap_or_else(|| "duckduckgo".to_string());

    if provider != "duckduckgo" {
        return Ok(ToolOutput::failure(format!(
            "unsupported search provider: {}",
            provider
        )));
    }

    let response = send_with_retries(15, |client| {
        client
            .get("https://api.duckduckgo.com/")
            .query(&[("q", payload.query.as_str()), ("format", "json"), ("no_html", "1"), ("skip_disambig", "1")])
    })?;

    let body: DuckDuckGoResponse = response.json()?;
    let mut results = Vec::new();

    if !body.abstract_text.trim().is_empty() {
        results.push(serde_json::json!({
            "title": truncate_chars(&decode_html_entities(&payload.query), 160),
            "url": normalize_url(&body.abstract_url),
            "snippet": truncate_chars(&decode_html_entities(&body.abstract_text), 400),
        }));
    }

    flatten_topics(&body.related_topics, &mut results);

    if results.len() > MAX_WEB_RESULTS {
        results.truncate(MAX_WEB_RESULTS);
    }

    let final_text = results
        .iter()
        .enumerate()
        .map(|(index, item)| {
            let title = item.get("title").and_then(|value| value.as_str()).unwrap_or("Untitled");
            let url = item.get("url").and_then(|value| value.as_str()).unwrap_or("");
            let snippet = item.get("snippet").and_then(|value| value.as_str()).unwrap_or("");
            format!("{}. {}\nURL: {}\n{}", index + 1, title, url, snippet)
        })
        .collect::<Vec<_>>()
        .join("\n\n");

    Ok(ToolOutput::success(serde_json::json!({
        "provider": provider,
        "query": payload.query,
        "count": results.len(),
        "results": results,
        "final_text": final_text,
    })))
}

fn flatten_topics(topics: &[DuckDuckGoTopic], results: &mut Vec<serde_json::Value>) {
    for item in topics {
        if results.len() >= MAX_WEB_RESULTS {
            return;
        }

        if let (Some(text), Some(url)) = (item.text.as_ref(), item.first_url.as_ref()) {
            let decoded = decode_html_entities(text);
            let snippet = truncate_chars(&decoded, 400);
            results.push(serde_json::json!({
                "title": truncate_chars(&decoded, 160),
                "url": normalize_url(url),
                "snippet": snippet,
            }));
        }

        if let Some(children) = item.topics.as_ref() {
            flatten_topics(children, results);
        }
    }
}
