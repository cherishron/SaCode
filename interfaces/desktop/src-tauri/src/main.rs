// SaCode Desktop Tauri shell — holds sacode serve sidecar + daemon token.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod sidecar;
mod terminal;

use std::path::PathBuf;
use std::sync::Arc;

use sidecar::{
    pretty_canonicalize, start_sidecar, DaemonProxyResponse, SacodeSidecar, SidecarHandleDto,
};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Emitter, Manager, State};
use terminal::{TerminalStartDto, TerminalState};
use tokio::sync::Mutex;

struct SidecarState {
    inner: Mutex<Option<SacodeSidecar>>,
    event_bridge: Mutex<Option<tauri::async_runtime::JoinHandle<()>>>,
    /// 关闭窗口时隐藏到托盘而非退出。
    tray: std::sync::atomic::AtomicBool,
}

impl SidecarState {
    fn new() -> Self {
        Self {
            inner: Mutex::new(None),
            event_bridge: Mutex::new(None),
            tray: std::sync::atomic::AtomicBool::new(false),
        }
    }

    fn tray_enabled(&self) -> bool {
        self.tray.load(std::sync::atomic::Ordering::Relaxed)
    }
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
    terminal_state: State<'_, Arc<TerminalState>>,
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
    // std::fs::canonicalize emits \\?\ prefixed paths on Windows, which are
    // meaningless to users and break child processes that echo them back.
    let requested_workspace = pretty_canonicalize(&workspace_path).map_err(|e| e.to_string())?;
    if let Some(existing) = guard.as_ref() {
        if existing.workspace == requested_workspace {
            return Ok(existing.handle_dto());
        }
    }
    // A terminal belongs to the workspace that launched it. End it before
    // replacing the sidecar so shell commands cannot run in a stale folder.
    let terminals = terminal_state.inner().clone();
    tokio::task::spawn_blocking(move || terminals.close_all())
        .await
        .map_err(|error| error.to_string())?;
    if let Some(bridge) = state.event_bridge.lock().await.take() {
        bridge.abort();
    }
    if let Some(mut existing) = guard.take() {
        existing.stop().await;
    }
    let ready_dir = std::env::temp_dir().join("sacode-desktop-sidecar");
    let handle = start_sidecar(
        default_sacode_binary(),
        requested_workspace.clone(),
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
async fn select_workspace_folder() -> Result<Option<String>, String> {
    #[cfg(windows)]
    {
        let script = r#"
Add-Type -AssemblyName System.Windows.Forms
$dialog = New-Object System.Windows.Forms.FolderBrowserDialog
$dialog.Description = '选择任务项目文件夹'
$dialog.ShowNewFolderButton = $true
if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {
  [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
  Write-Output $dialog.SelectedPath
}
"#;
        let mut picker = tokio::process::Command::new("powershell.exe");
        picker.args(["-NoProfile", "-STA", "-Command", script]);
        picker.creation_flags(0x08000000); // CREATE_NO_WINDOW: keep the folder dialog, hide its console host.
        let output = picker
            .output()
            .await
            .map_err(|error| format!("failed to open folder picker: {error}"))?;
        if !output.status.success() {
            return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
        }
        let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
        return Ok((!path.is_empty()).then_some(path));
    }

    #[cfg(not(windows))]
    {
        Err("folder picker is not available on this platform yet".to_string())
    }
}

#[tauri::command]
async fn stop_daemon(
    state: State<'_, Arc<SidecarState>>,
    terminal_state: State<'_, Arc<TerminalState>>,
) -> Result<(), String> {
    let mut guard = state.inner.lock().await;
    let terminals = terminal_state.inner().clone();
    tokio::task::spawn_blocking(move || terminals.close_all())
        .await
        .map_err(|error| error.to_string())?;
    if let Some(bridge) = state.event_bridge.lock().await.take() {
        bridge.abort();
    }
    if let Some(mut handle) = guard.take() {
        handle.stop().await;
    }
    Ok(())
}

/// Start or reuse an interactive PTY shell in the current daemon workspace.
/// The renderer cannot supply an arbitrary working directory or shell command.
#[tauri::command]
async fn terminal_start(
    app: AppHandle,
    state: State<'_, Arc<SidecarState>>,
    terminal_state: State<'_, Arc<TerminalState>>,
    rows: Option<u16>,
    cols: Option<u16>,
) -> Result<TerminalStartDto, String> {
    let sidecar = state.inner.lock().await;
    let workspace = sidecar
        .as_ref()
        .map(|handle| handle.workspace.clone())
        .ok_or_else(|| "daemon not started".to_string())?;
    let terminals = terminal_state.inner().clone();
    tokio::task::spawn_blocking(move || {
        terminals.start(app, workspace, rows.unwrap_or(24), cols.unwrap_or(80))
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn terminal_write(
    terminal_state: State<'_, Arc<TerminalState>>,
    terminal_id: String,
    data: String,
) -> Result<(), String> {
    let terminals = terminal_state.inner().clone();
    tokio::task::spawn_blocking(move || terminals.write(&terminal_id, data))
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn terminal_resize(
    terminal_state: State<'_, Arc<TerminalState>>,
    terminal_id: String,
    rows: u16,
    cols: u16,
) -> Result<(), String> {
    let terminals = terminal_state.inner().clone();
    tokio::task::spawn_blocking(move || terminals.resize(&terminal_id, rows, cols))
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn terminal_close(
    terminal_state: State<'_, Arc<TerminalState>>,
    terminal_id: String,
) -> Result<(), String> {
    let terminals = terminal_state.inner().clone();
    tokio::task::spawn_blocking(move || terminals.close(&terminal_id))
        .await
        .map_err(|error| error.to_string())?
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
    // Snapshot the connection info and release the Mutex before the HTTP call
    // so concurrent IPC commands are never serialized behind a slow request.
    let snapshot = {
        let guard = state.inner.lock().await;
        guard
            .as_ref()
            .map(|h| h.proxy_snapshot())
            .ok_or_else(|| "daemon not started".to_string())?
    };
    snapshot.proxy(&method, &path, body).await
}

/// Poll SSE events from daemon and re-emit to WebView (token never leaves Rust).
/// Emits event name `daemon-event` with payload `{ event, id?, task_id?, data }`.
#[tauri::command]
async fn start_event_bridge(
    app: AppHandle,
    state: State<'_, Arc<SidecarState>>,
    task_id: Option<String>,
) -> Result<(), String> {
    // Snapshot connection info and release the Mutex immediately.
    let (base_url, token) = {
        let sidecar = state.inner.lock().await;
        let Some(handle) = sidecar.as_ref() else {
            return Err("daemon not started".into());
        };
        (handle.base_url().to_string(), handle.token().to_string())
    };
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

/// 切换系统托盘：开启后关闭窗口时隐藏到托盘而不是退出。
#[tauri::command]
async fn set_tray_enabled(
    app: AppHandle,
    state: State<'_, Arc<SidecarState>>,
    enabled: bool,
) -> Result<bool, String> {
    state
        .tray
        .store(enabled, std::sync::atomic::Ordering::Relaxed);
    if enabled {
        // 点击托盘图标重新显示窗口。
        if app.tray_by_id("main").is_none() {
            use tauri::menu::{Menu, MenuEvent, MenuItem};
            use tauri::tray::{MouseButton, MouseButtonState, TrayIconEvent};
            use tauri::Manager;
            let show = MenuItem::with_id(&app, "show", "显示主窗口", true, None::<&str>)
                .map_err(|e| format!("build tray menu: {e}"))?;
            let quit = MenuItem::with_id(&app, "quit", "退出 SaCode", true, None::<&str>)
                .map_err(|e| format!("build tray menu: {e}"))?;
            let menu = Menu::with_items(&app, &[&show, &quit])
                .map_err(|e| format!("build tray menu: {e}"))?;
            let handle = app.clone();
            TrayIconBuilder::with_id("main")
                .tooltip("SaCode Desktop")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(
                    move |tray, menu_event: MenuEvent| match menu_event.id().as_ref() {
                        "show" => {
                            if let Some(win) = tray.app_handle().get_webview_window("main") {
                                let _ = win.show();
                                let _ = win.set_focus();
                            }
                        }
                        "quit" => {
                            tray.app_handle().exit(0);
                        }
                        _ => {}
                    },
                )
                .on_tray_icon_event(move |_tray, event: TrayIconEvent| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        if let Some(win) = handle.get_webview_window("main") {
                            let _ = win.show();
                            let _ = win.set_focus();
                        }
                    }
                })
                .build(&app)
                .map_err(|e| format!("build tray: {e}"))?;
            let _ = (show, quit);
        }
    }
    Ok(enabled)
}

/// 保存托盘/自启动偏好，返回是否真正生效（仅 Tauri 环境可切换）。
#[tauri::command]
async fn set_autostart(app: AppHandle, enabled: bool) -> Result<(), String> {
    use tauri_plugin_autostart::ManagerExt;
    if enabled {
        app.autolaunch()
            .enable()
            .map_err(|e| format!("enable autostart: {e}"))
    } else {
        app.autolaunch()
            .disable()
            .map_err(|e| format!("disable autostart: {e}"))
    }
}

fn main() {
    let sidecar_state = Arc::new(SidecarState::new());
    let terminal_state = Arc::new(TerminalState::new());
    tauri::Builder::default()
        .manage(sidecar_state)
        .manage(terminal_state)
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec![]),
        ))
        .setup(|app| {
            // Log that the window was created — helps diagnose WebView2 init issues.
            let win = app.get_webview_window("main");
            match win {
                Some(w) => {
                    let _ = w.set_title("SaCode Desktop");
                    // Force the window to show in case it's hidden.
                    let _ = w.show();
                }
                None => {
                    eprintln!("[tauri] ERROR: main window not found after setup");
                }
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            start_daemon,
            select_workspace_folder,
            stop_daemon,
            daemon_info,
            daemon_proxy,
            start_event_bridge,
            terminal_start,
            terminal_write,
            terminal_resize,
            terminal_close,
            set_tray_enabled,
            set_autostart
        ])
        .on_window_event(|window, event| {
            // 关闭请求先隐藏到托盘（若托盘启用），真正退出走 Destroyed。
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                let to_tray = window
                    .app_handle()
                    .try_state::<Arc<SidecarState>>()
                    .map(|s| s.tray_enabled())
                    .unwrap_or(false);
                if to_tray {
                    api.prevent_close();
                    let _ = window.hide();
                    return;
                }
            }
            if let tauri::WindowEvent::Destroyed = event {
                if let Some(terminal_state) = window.app_handle().try_state::<Arc<TerminalState>>()
                {
                    terminal_state.close_all();
                }
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
