pub mod extract;
pub mod navigate;
pub mod open;
pub mod snapshot;

use std::{collections::HashMap, sync::{Mutex, OnceLock}};

use anyhow::{anyhow, Result};
use reqwest::blocking::Client;
use serde::{Deserialize, Serialize};

const MAX_HTML_CHARS: usize = 50_000;
const MAX_TEXT_CHARS: usize = 20_000;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BrowserSession {
    pub session_id: String,
    pub url: String,
    pub status: u16,
    pub title: Option<String>,
    pub html: String,
    pub text: String,
}

static BROWSER_SESSIONS: OnceLock<Mutex<HashMap<String, BrowserSession>>> = OnceLock::new();

fn sessions() -> &'static Mutex<HashMap<String, BrowserSession>> {
    BROWSER_SESSIONS.get_or_init(|| Mutex::new(HashMap::new()))
}

pub fn create_session(url: &str) -> Result<BrowserSession> {
    let session = fetch_session(None, url)?;
    save_session(session.clone())?;
    Ok(session)
}

pub fn navigate_session(session_id: &str, url: &str) -> Result<BrowserSession> {
    let session = fetch_session(Some(session_id), url)?;
    save_session(session.clone())?;
    Ok(session)
}

pub fn get_session(session_id: &str) -> Result<BrowserSession> {
    let guard = sessions()
        .lock()
        .map_err(|_| anyhow!("browser session store poisoned"))?;
    guard
        .get(session_id)
        .cloned()
        .ok_or_else(|| anyhow!("browser session not found: {}", session_id))
}

fn save_session(session: BrowserSession) -> Result<()> {
    let mut guard = sessions()
        .lock()
        .map_err(|_| anyhow!("browser session store poisoned"))?;
    guard.insert(session.session_id.clone(), session);
    Ok(())
}

fn fetch_session(existing_id: Option<&str>, url: &str) -> Result<BrowserSession> {
    let client = Client::builder()
        .timeout(std::time::Duration::from_secs(20))
        .redirect(reqwest::redirect::Policy::limited(10))
        .build()?;
    let response = client
        .get(url)
        .header(
            reqwest::header::USER_AGENT,
            "SaCodeBrowser/0.1 (+https://github.com/cherishron/sacode)",
        )
        .send()?;
    let final_url = response.url().to_string();
    let status = response.status().as_u16();
    let body = response.text()?;
    let html = truncate_chars(&body, MAX_HTML_CHARS);
    let text = truncate_chars(&html_to_text(&body), MAX_TEXT_CHARS);
    let title = extract_title(&body);

    Ok(BrowserSession {
        session_id: existing_id
            .map(str::to_string)
            .unwrap_or_else(new_session_id),
        url: final_url,
        status,
        title,
        html,
        text,
    })
}

fn new_session_id() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};

    let millis = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|value| value.as_millis())
        .unwrap_or_default();
    format!("browser-{}", millis)
}

fn extract_title(html: &str) -> Option<String> {
    let lower = html.to_lowercase();
    let start = lower.find("<title>")? + "<title>".len();
    let end = lower[start..].find("</title>")? + start;
    let raw = html[start..end].trim();
    if raw.is_empty() {
        None
    } else {
        Some(collapse_whitespace(raw))
    }
}

pub fn html_to_text(html: &str) -> String {
    let mut out = String::with_capacity(html.len());
    let mut in_tag = false;
    for ch in html.chars() {
        match ch {
            '<' => {
                in_tag = true;
                out.push(' ');
            }
            '>' => {
                in_tag = false;
                out.push(' ');
            }
            _ if !in_tag => out.push(ch),
            _ => {}
        }
    }
    collapse_whitespace(&out)
}

pub fn collapse_whitespace(input: &str) -> String {
    input.split_whitespace().collect::<Vec<_>>().join(" ")
}

pub fn truncate_chars(input: &str, max_chars: usize) -> String {
    let mut chars = input.chars();
    let preview: String = chars.by_ref().take(max_chars).collect();
    if chars.next().is_some() {
        format!("{}...", preview)
    } else {
        preview
    }
}

pub fn extract_fragment(html: &str, selector: &str) -> Option<String> {
    let selector = selector.trim();
    if selector.is_empty() {
        return None;
    }

    if let Some(id) = selector.strip_prefix('#') {
        return extract_tag_with_attr(html, "id", id);
    }
    if let Some(class_name) = selector.strip_prefix('.') {
        return extract_tag_with_class(html, class_name);
    }
    extract_first_tag(html, selector)
}

fn extract_first_tag(html: &str, tag: &str) -> Option<String> {
    let start_token = format!("<{}", tag);
    let end_token = format!("</{}>", tag);
    let lower = html.to_lowercase();
    let start = lower.find(&start_token.to_lowercase())?;
    let end = lower[start..].find(&end_token.to_lowercase())? + start + end_token.len();
    Some(html[start..end].to_string())
}

fn extract_tag_with_attr(html: &str, attr: &str, value: &str) -> Option<String> {
    let pattern = format!("{}=\"{}\"", attr, value);
    let lower = html.to_lowercase();
    let start = lower.find(&pattern.to_lowercase())?;
    let tag_start = html[..start].rfind('<')?;
    let tag_end = html[start..].find('>')? + start;
    let tag_name = html[tag_start + 1..tag_end]
        .split_whitespace()
        .next()?
        .trim_matches('/');
    let close = format!("</{}>", tag_name.to_lowercase());
    let end = lower[tag_end..].find(&close)? + tag_end + close.len();
    Some(html[tag_start..end].to_string())
}

fn extract_tag_with_class(html: &str, class_name: &str) -> Option<String> {
    let double = format!("class=\"{}\"", class_name);
    let single = format!("class='{}'", class_name);
    if let Some(fragment) = extract_tag_with_attr(html, "class", class_name) {
        return Some(fragment);
    }

    let lower = html.to_lowercase();
    let pos = lower
        .find(&double.to_lowercase())
        .or_else(|| lower.find(&single.to_lowercase()))?;
    let tag_start = html[..pos].rfind('<')?;
    let tag_end = html[pos..].find('>')? + pos;
    let tag_name = html[tag_start + 1..tag_end]
        .split_whitespace()
        .next()?
        .trim_matches('/');
    let close = format!("</{}>", tag_name.to_lowercase());
    let end = lower[tag_end..].find(&close)? + tag_end + close.len();
    Some(html[tag_start..end].to_string())
}
