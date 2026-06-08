pub mod fetch;
pub mod search;

use anyhow::{anyhow, Result};
use reqwest::blocking::{Client, Response};
use reqwest::StatusCode;
use std::thread;
use std::time::Duration;

const MAX_RETRY_ATTEMPTS: usize = 3;
const RETRY_BASE_DELAY_MS: u64 = 250;

fn build_http_client(timeout_secs: u64) -> Result<Client> {
    Client::builder()
        .timeout(Duration::from_secs(timeout_secs))
        .user_agent("SaCode/0.1 web-tools")
        .redirect(reqwest::redirect::Policy::limited(10))
        .build()
        .map_err(|error| anyhow!("build web client failed: {}", error))
}

fn send_with_retries<F>(timeout_secs: u64, mut build_request: F) -> Result<Response>
where
    F: FnMut(&Client) -> reqwest::blocking::RequestBuilder,
{
    let client = build_http_client(timeout_secs)?;
    let mut last_error = None;

    for attempt in 0..MAX_RETRY_ATTEMPTS {
        match build_request(&client).send() {
            Ok(response)
                if should_retry_status(response.status()) && attempt + 1 < MAX_RETRY_ATTEMPTS =>
            {
                thread::sleep(Duration::from_millis(
                    RETRY_BASE_DELAY_MS * (attempt as u64 + 1),
                ));
            }
            Ok(response) => return Ok(response),
            Err(error) if is_retryable_error(&error) && attempt + 1 < MAX_RETRY_ATTEMPTS => {
                last_error = Some(error.to_string());
                thread::sleep(Duration::from_millis(
                    RETRY_BASE_DELAY_MS * (attempt as u64 + 1),
                ));
            }
            Err(error) => {
                return Err(anyhow!(
                    "web request failed after {} attempts: {}",
                    attempt + 1,
                    error
                ));
            }
        }
    }

    Err(anyhow!(
        "web request failed after {} attempts{}",
        MAX_RETRY_ATTEMPTS,
        last_error
            .as_deref()
            .map(|value| format!(": {}", value))
            .unwrap_or_default()
    ))
}

fn should_retry_status(status: StatusCode) -> bool {
    status == StatusCode::REQUEST_TIMEOUT
        || status == StatusCode::TOO_MANY_REQUESTS
        || status == StatusCode::BAD_GATEWAY
        || status == StatusCode::SERVICE_UNAVAILABLE
        || status == StatusCode::GATEWAY_TIMEOUT
        || status == StatusCode::INTERNAL_SERVER_ERROR
}

fn is_retryable_error(error: &reqwest::Error) -> bool {
    error.is_timeout()
        || error.is_connect()
        || error.is_request()
        || error.is_body()
        || error.is_decode()
}

fn normalize_url(url: &str) -> String {
    let trimmed = url.trim();
    if trimmed.starts_with("http://") || trimmed.starts_with("https://") {
        trimmed.to_string()
    } else {
        format!("https://{}", trimmed.trim_start_matches('/'))
    }
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

fn decode_html_entities(input: &str) -> String {
    input
        .replace("&nbsp;", " ")
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
}

fn strip_html_tags(input: &str) -> String {
    let mut output = String::with_capacity(input.len());
    let mut in_tag = false;

    for ch in input.chars() {
        match ch {
            '<' => {
                in_tag = true;
                output.push(' ');
            }
            '>' => {
                in_tag = false;
                output.push(' ');
            }
            _ if !in_tag => output.push(ch),
            _ => {}
        }
    }

    collapse_whitespace(&decode_html_entities(&output))
}

fn collapse_whitespace(input: &str) -> String {
    input.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn remove_html_block(mut html: String, tag: &str) -> String {
    let start_tag = format!("<{}", tag);
    let end_tag = format!("</{}>", tag);
    let lower = html.to_lowercase();
    let mut search_from = 0;
    let mut ranges = Vec::new();

    while let Some(start_rel) = lower[search_from..].find(&start_tag) {
        let start = search_from + start_rel;
        let Some(end_rel) = lower[start..].find(&end_tag) else {
            break;
        };
        let end = start + end_rel + end_tag.len();
        ranges.push((start, end));
        search_from = end;
    }

    for (start, end) in ranges.into_iter().rev() {
        html.replace_range(start..end, " ");
    }

    html
}

fn extract_tag_text(html: &str, tag: &str) -> Option<String> {
    let lower = html.to_lowercase();
    let open = format!("<{}", tag);
    let close = format!("</{}>", tag);
    let start = lower.find(&open)?;
    let open_end = lower[start..].find('>')? + start + 1;
    let end = lower[open_end..].find(&close)? + open_end;
    let text = strip_html_tags(&html[open_end..end]);
    (!text.is_empty()).then_some(text)
}

fn html_to_text(html: &str) -> String {
    let sanitized = remove_html_block(remove_html_block(html.to_string(), "script"), "style");
    strip_html_tags(&sanitized)
}

#[cfg(test)]
mod tests {
    use super::{
        collapse_whitespace, decode_html_entities, extract_tag_text, html_to_text, normalize_url,
        truncate_chars,
    };

    #[test]
    fn normalize_url_adds_https_scheme() {
        assert_eq!(normalize_url("example.com"), "https://example.com");
        assert_eq!(normalize_url("https://example.com"), "https://example.com");
    }

    #[test]
    fn html_helpers_extract_text() {
        let html = "<html><head><title>Test &amp; Demo</title><style>.x{}</style></head><body><script>1</script><h1>Hello</h1><p>World</p></body></html>";
        assert_eq!(
            extract_tag_text(html, "title").as_deref(),
            Some("Test & Demo")
        );
        assert_eq!(html_to_text(html), "Test & Demo Hello World");
        assert_eq!(decode_html_entities("Tom &amp; Jerry"), "Tom & Jerry");
        assert_eq!(collapse_whitespace("a\n\n b\t c"), "a b c");
        assert_eq!(truncate_chars("abcdef", 3), "abc...");
    }
}
