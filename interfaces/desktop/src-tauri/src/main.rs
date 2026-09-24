// SaCode Desktop Tauri shell — holds sacode serve sidecar + daemon token.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod sidecar;

use std::path::PathBuf;
use std::sync::Arc;

use sidecar::{start_sidecar, DaemonProxyResponse, SacodeSidecar, SidecarHandleDto};
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::sync::Mutex;

struct SidecarState {
    inner: Mutex<Option<SacodeSidecar>>,
    event_bridge: Mutex<Option<tauri::async_runtime::JoinHandle<()>>>,
}

fn repo_root_guess() -> PathBuf {
    // src-tauri → interfaces/desktop → interfaces → SaCode
    let mut p = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
    for _ in 0..4 {
        if p.join("target/debug/sacode.exe").exists() || p.join("Cargo.toml").exists() {
            if p.join("kernel").is_dir() {
                return p;
            }
        }
        if !p.pop() {
            break;
        }
    }
    PathBuf::from("../..")
}

fn default_sacode_binary() -> PathBuf {
    if let Ok(p) = std::env::var("SACODE_BINARY_PATH") {
        if !p.trim().is_empty() {
            return PathBuf::from(p);
        }
    }
    let root = repo_root_guess();
    let candidates = [
        root.join("target/debug/sacode.exe"),
        root.join("target/release/sacode.exe"),
        root.join("target/debug/sacode"),
        root.join("target/release/sacode"),
        PathBuf::from("target/debug/sacode.exe"),
        PathBuf::from("sacode"),
    ];
    for c in candidates {
        if c.exists() {
            return c;
        }
    }
    PathBuf::from("sacode")
}

fn default_workspace() -> PathBuf {
    if let Ok(p) = std::env::var("SACODE_DESKTOP_WORKSPACE") {
        return PathBuf::from(p);
    }
    repo_root_guess()
}

#[tauri::command]
async fn start_daemon(
    state: State<'_, Arc<SidecarState>>,
    workspace: Option<String>,
) -> Result<SidecarHandleDto, String> {
    let mut guard = state.inner.lock().await;
    let workspace_path = workspace
        .map(|w| {
            let p = PathBuf::from(w);
            if p.is_absolute() {
                p
            } else {
                repo_root_guess().join(p)
            }
        })
        .unwrap_or_else(default_workspace);
    if !workspace_path.is_dir() {
        return Err(format!(
            "workspace is not a directory: {}",
            workspace_path.display()
        ));
    }
    let requested_workspace = std::fs::canonicalize(&workspace_path).map_err(|e| e.to_string())?;
    if let Some(existing) = guard.as_ref() {
        if existing.workspace == requested_workspace {
            return Ok(existing.handle_dto());
        }
    }
    if let Some(bridge) = state.event_bridge.lock().await.take() {
        bridge.abort();
    }
    if let Some(mut existing) = guard.take() {
        existing.stop().await;
    }
    let ready_dir = std::env::temp_dir().join("sacode-desktop-sidecar");
    let handle = start_sidecar(
        default_sacode_binary(),
        requested_workspace,
        ready_dir,
        std::env::var("SACODE_OPENCODE_EXECUTABLE").ok(),
        std::env::var("SACODE_OPENCODE_ARGS").ok(),
    )
    .await
    .map_err(|e| e.to_string())?;
    let dto = handle.handle_dto();
    *guard = Some(handle);
    Ok(dto)
}

#[tauri::command]
async fn stop_daemon(state: State<'_, Arc<SidecarState>>) -> Result<(), String> {
    let mut guard = state.inner.lock().await;
    if let Some(bridge) = state.event_bridge.lock().await.take() {
        bridge.abort();
    }
    if let Some(mut handle) = guard.take() {
        handle.stop().await;
    }
    Ok(())
}

#[tauri::command]
async fn daemon_info(
    state: State<'_, Arc<SidecarState>>,
) -> Result<Option<SidecarHandleDto>, String> {
    let guard = state.inner.lock().await;
    Ok(guard.as_ref().map(|h| h.handle_dto()))
}

/// Proxy HTTP to local daemon. Token stays in this process.
#[tauri::command]
async fn daemon_proxy(
    state: State<'_, Arc<SidecarState>>,
    method: String,
    path: String,
    body: Option<String>,
) -> Result<DaemonProxyResponse, String> {
    let guard = state.inner.lock().await;
    let Some(handle) = guard.as_ref() else {
        return Err("daemon not started".into());
    };
    handle.proxy(&method, &path, body).await
}

/// Poll SSE events from daemon and re-emit to WebView (token never leaves Rust).
/// Emits event name `daemon-event` with payload `{ event, id?, task_id?, data }`.
#[tauri::command]
async fn start_event_bridge(
    app: AppHandle,
    state: State<'_, Arc<SidecarState>>,
    task_id: Option<String>,
) -> Result<(), String> {
    let sidecar = state.inner.lock().await;
    let Some(handle) = sidecar.as_ref() else {
        return Err("daemon not started".into());
    };
    let base_url = handle.base_url().to_string();
    let token = handle.token().to_string();
    let query = match task_id.as_deref() {
        Some(t) if !t.is_empty() => format!("?task_id={}", urlencoding_minimal(t)),
        _ => String::new(),
    };
    let mut bridge_slot = state.event_bridge.lock().await;
    if let Some(bridge) = bridge_slot.take() {
        bridge.abort();
    }
    let bridge = tauri::async_runtime::spawn(async move {
        let client = reqwest::Client::new();
        let mut last_event_id: Option<String> = None;
        loop {
            match pump_sse(&client, &base_url, &token, &query, &mut last_event_id, &app).await {
                Ok(()) => {
                    // stream ended cleanly; reconnect shortly
                    tokio::time::sleep(std::time::Duration::from_secs(1)).await;
                }
                Err(_) => {
                    tokio::time::sleep(std::time::Duration::from_secs(2)).await;
                }
            }
        }
    });
    *bridge_slot = Some(bridge);
    Ok(())
}

fn urlencoding_minimal(s: &str) -> String {
    s.chars()
        .map(|c| match c {
            'A'..='Z' | 'a'..='z' | '0'..='9' | '-' | '_' | '.' | '~' => c.to_string(),
            _ => format!("%{:02X}", c as u8),
        })
        .collect()
}

async fn pump_sse(
    client: &reqwest::Client,
    base_url: &str,
    token: &str,
    query: &str,
    last_event_id: &mut Option<String>,
    app: &AppHandle,
) -> Result<(), String> {
    let mut req = client
        .get(format!("{base_url}/api/stream{query}"))
        .header("Accept", "text/event-stream");
    if !token.is_empty() {
        req = req.bearer_auth(token);
    }
    if let Some(id) = last_event_id.clone() {
        req = req.header("Last-Event-ID", id);
    }
    let mut resp = req.send().await.map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Err(format!("sse status {}", resp.status()));
    }
    let mut buf = String::new();
    while let Some(chunk) = resp.chunk().await.map_err(|e| e.to_string())? {
        buf.push_str(&String::from_utf8_lossy(&chunk));
        while let Some(idx) = find_frame_end(&buf) {
            let frame: String = buf.drain(..idx).collect();
            if let Some(evt) = parse_sse_frame(&frame) {
                if let Some(id) = &evt.id {
                    *last_event_id = Some(id.clone());
                }
                let _ = app.emit("daemon-event", evt);
            }
        }
        if buf.len() > 512 * 1024 {
            buf.clear();
        }
    }
    Ok(())
}

fn find_frame_end(s: &str) -> Option<usize> {
    let lf = s.find("\n\n").map(|i| i + 2);
    let crlf = s.find("\r\n\r\n").map(|i| i + 4);
    match (lf, crlf) {
        (Some(a), Some(b)) => Some(a.min(b)),
        (Some(a), None) => Some(a),
        (None, Some(b)) => Some(b),
        _ => None,
    }
}

#[derive(Debug, Clone, serde::Serialize)]
struct DaemonEventPayload {
    event: String,
    id: Option<String>,
    task_id: Option<String>,
    data: serde_json::Value,
}

fn parse_sse_frame(frame: &str) -> Option<DaemonEventPayload> {
    let mut event = "message".to_string();
    let mut id = None;
    let mut data_lines: Vec<String> = Vec::new();
    for raw in frame.split('\n') {
        let raw = raw.trim_end_matches('\r');
        if raw.is_empty() || raw.starts_with(':') {
            continue;
        }
        let (field, value) = match raw.split_once(':') {
            Some((f, v)) => (f, v.trim_start_matches(' ')),
            None => (raw, ""),
        };
        match field {
            "event" => event = value.to_string(),
            "id" => id = Some(value.to_string()),
            "data" => data_lines.push(value.to_string()),
            _ => {}
        }
    }
    if data_lines.is_empty() {
        return None;
    }
    let data: serde_json::Value = serde_json::from_str(&data_lines.join("\n")).ok()?;
    let task_id = data
        .get("task_id")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());
    Some(DaemonEventPayload {
        event,
        id,
        task_id,
        data,
    })
}

fn main() {
    let sidecar_state = Arc::new(SidecarState {
        inner: Mutex::new(None),
        event_bridge: Mutex::new(None),
    });
    tauri::Builder::default()
        .manage(sidecar_state)
        .invoke_handler(tauri::generate_handler![
            start_daemon,
            stop_daemon,
            daemon_info,
            daemon_proxy,
            start_event_bridge
        ])
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::Destroyed = event {
                let app: AppHandle = window.app_handle().clone();
                let state = app.state::<Arc<SidecarState>>();
                let state = state.inner().clone();
                tauri::async_runtime::spawn(async move {
                    let mut guard = state.inner.lock().await;
                    if let Some(bridge) = state.event_bridge.lock().await.take() {
                        bridge.abort();
                    }
                    if let Some(mut handle) = guard.take() {
                        handle.stop().await;
                    }
                });
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running SaCode Desktop");
}

#[cfg(test)]
mod tests {
    // path validation lives in sidecar::tests
}
