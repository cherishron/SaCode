use super::{extract_tag_text, html_to_text, send_with_retries, truncate_chars};
use crate::sandbox::{active_policy, NetworkAccess};
use crate::tools::{SideEffectLevel, ToolOutput, ToolSpec};
use anyhow::Result;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

const MAX_WEB_RESULTS: usize = 5;
const MAX_SNIPPET_CHARS: usize = 400;

#[derive(Debug, Deserialize)]
struct SearchInput {
    query: String,
    provider: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
struct SearchResult {
    title: String,
    url: String,
    snippet: String,
    providers: Vec<String>,
    confirmed_by: usize,
}

#[derive(Debug, Clone)]
struct HtmlLinkCandidate {
    url: String,
    title: String,
    snippet: String,
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
                "count": { "type": "integer" },
                "providers_used": { "type": "array" },
                "results": { "type": "array" },
                "final_text": { "type": "string" }
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
        return Ok(ToolOutput::failure(
            "network access blocked by sandbox policy",
        ));
    }

    let payload: SearchInput = serde_json::from_value(input)?;
    let provider = payload.provider.unwrap_or_else(|| "baidu".to_string());

    if !matches!(
        provider.as_str(),
        "auto" | "baidu" | "sogou" | "so360" | "bing"
    ) {
        return Ok(ToolOutput::failure(format!(
            "unsupported search provider: {}",
            provider
        )));
    }

    let (resolved_provider, providers_used, results) = match try_search(&payload.query, &provider) {
        Ok(search) => search,
        Err(_) => {
            return Ok(ToolOutput::failure(
                "web search failed; provider unavailable or returned no usable results",
            ));
        }
    };

    let final_text = results
        .iter()
        .enumerate()
        .map(|(index, item)| {
            let title = item
                .get("title")
                .and_then(|value| value.as_str())
                .unwrap_or("Untitled");
            let url = item
                .get("url")
                .and_then(|value| value.as_str())
                .unwrap_or("");
            let snippet = item
                .get("snippet")
                .and_then(|value| value.as_str())
                .unwrap_or("");
            format!("{}. {}\nURL: {}\n{}", index + 1, title, url, snippet)
        })
        .collect::<Vec<_>>()
        .join("\n\n");

    Ok(ToolOutput::success(serde_json::json!({
        "provider": resolved_provider,
        "query": payload.query,
        "count": results.len(),
        "providers_used": providers_used,
        "results": results,
        "final_text": final_text,
    })))
}

fn try_search(
    query: &str,
    provider: &str,
) -> Result<(String, Vec<String>, Vec<serde_json::Value>)> {
    if provider != "auto" {
        let results = try_html_search_page(query, provider)?;
        if results.is_empty() {
            anyhow::bail!("no usable search results")
        }
        let used = vec![provider.to_string()];
        let items = results
            .into_iter()
            .map(search_result_to_json)
            .collect::<Vec<_>>();
        return Ok((provider.to_string(), used, items));
    }

    let ordered_providers = ["baidu", "sogou", "so360", "bing"];
    let mut provider_results = Vec::new();
    let mut providers_used = Vec::new();

    for name in ordered_providers {
        if let Ok(results) = try_html_search_page(query, name) {
            if !results.is_empty() {
                providers_used.push(name.to_string());
                provider_results.push((name.to_string(), results));
            }
        }
    }

    if provider_results.is_empty() {
        anyhow::bail!("no usable search results")
    }

    let merged = merge_cross_verified_results(provider_results);
    let items = merged
        .into_iter()
        .map(search_result_to_json)
        .collect::<Vec<_>>();
    Ok(("auto".to_string(), providers_used, items))
}

fn try_html_search_page(query: &str, provider: &str) -> Result<Vec<SearchResult>> {
    let (url, query_params): (&str, Vec<(&str, &str)>) = match provider {
        "baidu" => ("https://www.baidu.com/s", vec![("wd", query)]),
        "sogou" => ("https://www.sogou.com/web", vec![("query", query)]),
        "so360" => ("https://www.so.com/s", vec![("q", query)]),
        "bing" => ("https://www.bing.com/search", vec![("q", query)]),
        _ => anyhow::bail!("unsupported fallback provider"),
    };

    let response = send_with_retries(15, |client| client.get(url).query(&query_params))?;
    let body = response.text()?;
    Ok(parse_search_results_from_html(&body, provider))
}

fn parse_search_results_from_html(html: &str, provider: &str) -> Vec<SearchResult> {
    let mut results = Vec::new();
    let page_title = extract_tag_text(html, "title");
    let page_text = html_to_text(html);
    let fallback_snippet = truncate_chars(&page_text, MAX_SNIPPET_CHARS);

    for candidate in extract_link_candidates(html) {
        if results.len() >= MAX_WEB_RESULTS {
            break;
        }

        results.push(SearchResult {
            title: truncate_chars(
                if candidate.title.is_empty() {
                    page_title.as_deref().unwrap_or("Search Results")
                } else {
                    &candidate.title
                },
                160,
            ),
            url: candidate.url,
            snippet: if candidate.snippet.is_empty() {
                fallback_snippet.clone()
            } else {
                candidate.snippet
            },
            providers: vec![provider.to_string()],
            confirmed_by: 1,
        });
    }

    results
}

fn extract_link_candidates(html: &str) -> Vec<HtmlLinkCandidate> {
    let mut candidates = Vec::new();
    let mut offset = 0;

    while let Some(index) = html[offset..].find("href=") {
        let href_start = offset + index + 5;
        let Some(quote) = html[href_start..].chars().next() else {
            break;
        };
        if quote != '"' && quote != '\'' {
            offset = href_start;
            continue;
        }
        let value_start = href_start + 1;
        let Some(end_rel) = html[value_start..].find(quote) else {
            break;
        };
        let value_end = value_start + end_rel;
        let candidate = html[value_start..value_end].trim();
        if is_public_result_url(candidate) {
            let (title, snippet) = extract_anchor_title_and_snippet(html, href_start, value_end);
            candidates.push(HtmlLinkCandidate {
                url: candidate.to_string(),
                title,
                snippet,
            });
        }
        offset = value_end + 1;
    }

    candidates.sort_by(|a, b| a.url.cmp(&b.url));
    candidates.dedup_by(|a, b| a.url == b.url);
    candidates
}

fn is_public_result_url(url: &str) -> bool {
    (url.starts_with("https://") || url.starts_with("http://"))
        && !url.contains("bing.com")
        && !url.contains("baidu.com")
        && !url.contains("sogou.com")
        && !url.contains("so.com")
        && !url.contains("javascript:")
}

fn extract_anchor_title_and_snippet(
    html: &str,
    href_start: usize,
    href_end: usize,
) -> (String, String) {
    let title = extract_anchor_text_around(html, href_start).unwrap_or_default();
    let snippet = extract_context_snippet(html, href_end);
    (title, snippet)
}

fn extract_anchor_text_around(html: &str, href_start: usize) -> Option<String> {
    let anchor_open = html[..href_start].rfind("<a")?;
    let anchor_open_end = html[anchor_open..].find('>')? + anchor_open + 1;
    let anchor_close = html[anchor_open_end..].find("</a>")? + anchor_open_end;
    let text = html_to_text(&html[anchor_open_end..anchor_close]);
    (!text.is_empty()).then_some(truncate_chars(&text, 160))
}

fn extract_context_snippet(html: &str, from_index: usize) -> String {
    let end = (from_index + 400).min(html.len());
    let raw = &html[from_index..end];
    let text = html_to_text(raw);
    truncate_chars(&text, MAX_SNIPPET_CHARS)
}

fn merge_cross_verified_results(
    provider_results: Vec<(String, Vec<SearchResult>)>,
) -> Vec<SearchResult> {
    let mut by_url: BTreeMap<String, SearchResult> = BTreeMap::new();

    for (provider, results) in provider_results {
        for result in results {
            let entry = by_url
                .entry(result.url.clone())
                .or_insert_with(|| SearchResult {
                    title: result.title.clone(),
                    url: result.url.clone(),
                    snippet: result.snippet.clone(),
                    providers: Vec::new(),
                    confirmed_by: 0,
                });
            if !entry.providers.iter().any(|item| item == &provider) {
                entry.providers.push(provider.clone());
                entry.confirmed_by += 1;
            }
        }
    }

    let mut merged = by_url.into_values().collect::<Vec<_>>();
    merged.sort_by(|a, b| {
        b.confirmed_by
            .cmp(&a.confirmed_by)
            .then_with(|| a.url.cmp(&b.url))
    });
    if merged.len() > MAX_WEB_RESULTS {
        merged.truncate(MAX_WEB_RESULTS);
    }
    merged
}

fn search_result_to_json(result: SearchResult) -> serde_json::Value {
    serde_json::json!({
        "title": result.title,
        "url": result.url,
        "snippet": result.snippet,
        "providers": result.providers,
        "confirmed_by": result.confirmed_by,
    })
}

#[cfg(test)]
mod tests {
    use super::{
        extract_anchor_title_and_snippet, extract_link_candidates, is_public_result_url,
        merge_cross_verified_results, parse_search_results_from_html, SearchResult,
    };

    #[test]
    fn search_html_parser_extracts_public_links() {
        let html = r#"
        <html><head><title>Rust Search</title></head><body>
        <a href="https://www.rust-lang.org/">Rust</a>
        <a href="https://docs.rs/serde">Serde</a>
        <a href="https://www.bing.com/search?q=rust">Ignored</a>
        </body></html>
        "#;

        let links = extract_link_candidates(html);
        assert_eq!(links.len(), 2);
        assert!(links
            .iter()
            .any(|item| item.url == "https://www.rust-lang.org/"));
        assert!(links.iter().any(|item| item.url == "https://docs.rs/serde"));
    }

    #[test]
    fn search_html_parser_builds_results() {
        let html = r#"
        <html><head><title>Search Results</title></head><body>
        <a href="https://example.com/a">A</a>
        <a href="https://example.com/b">B</a>
        </body></html>
        "#;

        let results = parse_search_results_from_html(html, "bing");
        assert_eq!(results.len(), 2);
        assert_eq!(results[0].title, "A");
        assert!(!results[0].snippet.is_empty());
    }

    #[test]
    fn search_html_parser_extracts_anchor_title_and_context() {
        let html = r#"
        <div class="result">
          <a href="https://example.com/item">Example Result</a>
          <p>This is a local summary for the result page.</p>
        </div>
        "#;
        let href_index = html.find("href=").expect("href index");
        let href_end = html[href_index + 5..].find('"').expect("first quote") + href_index + 6;
        let (title, snippet) = extract_anchor_title_and_snippet(html, href_index, href_end);
        assert_eq!(title, "Example Result");
        assert!(snippet.contains("This is a local summary"));
    }

    #[test]
    fn public_result_url_filters_search_engine_links() {
        assert!(is_public_result_url("https://example.com/article"));
        assert!(!is_public_result_url("https://www.bing.com/search?q=rust"));
        assert!(!is_public_result_url(
            "https://www.sogou.com/web?query=rust"
        ));
        assert!(!is_public_result_url("javascript:void(0)"));
    }

    #[test]
    fn merge_cross_verified_results_counts_confirmations() {
        let merged = merge_cross_verified_results(vec![
            (
                "baidu".to_string(),
                vec![SearchResult {
                    title: "A".to_string(),
                    url: "https://example.com/a".to_string(),
                    snippet: "first".to_string(),
                    providers: vec!["baidu".to_string()],
                    confirmed_by: 1,
                }],
            ),
            (
                "sogou".to_string(),
                vec![SearchResult {
                    title: "A".to_string(),
                    url: "https://example.com/a".to_string(),
                    snippet: "second".to_string(),
                    providers: vec!["sogou".to_string()],
                    confirmed_by: 1,
                }],
            ),
        ]);

        assert_eq!(merged.len(), 1);
        assert_eq!(merged[0].confirmed_by, 2);
        assert!(merged[0].providers.iter().any(|item| item == "baidu"));
        assert!(merged[0].providers.iter().any(|item| item == "sogou"));
    }
}
