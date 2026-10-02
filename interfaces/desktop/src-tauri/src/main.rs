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
            eprintln!("[sidecar] using SACODE_BINARY_PATH={p}");
            return PathBuf::from(p);
        }
    }
    // 打包产物（NSIS 安装/便携运行）：externalBin 解包后与主 exe 同目录。
    // Tauri 侧车文件名保留 target triple 后缀，两个命名都探测以兼容。
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            for name in [
                "sacode.exe",
                "sacode-x86_64-pc-windows-msvc.exe",
                "sacode-aarch64-pc-windows-msvc.exe",
            ] {
                let candidate = dir.join(name);
                if candidate.exists() {
                    eprintln!(
                        "[sidecar] found binary next to exe: {}",
                        candidate.display()
                    );
                    return candidate;
                }
            }
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
            eprintln!("[sidecar] found binary via repo_root: {}", c.display());
            return c;
        }
    }
    eprintln!("[sidecar] WARNING: no sacode binary found, falling back to 'sacode' on PATH");
    PathBuf::from("sacode")
}

fn default_workspace() -> PathBuf {
    if let Ok(p) = std::env::var("SACODE_DESKTOP_WORKSPACE") {
        return PathBuf::from(p);
    }
    repo_root_guess()
}

fn resolve_workspace(
    workspace: Option<&str>,
    repo_root: &std::path::Path,
    default: &std::path::Path,
) -> Result<PathBuf, String> {
    let path = workspace
        .map(|w| {
            let p = PathBuf::from(w);
            if p.is_absolute() {
                p
            } else {
                repo_root.join(p)
            }
        })
        .unwrap_or_else(|| default.to_path_buf());
    if !path.is_dir() {
        return Err(format!("workspace is not a directory: {}", path.display()));
    }
    pretty_canonicalize(&path).map_err(|e| e.to_string())
}

fn default_ready_dir() -> PathBuf {
    let user_tag = std::env::var("USERNAME")
        .ok()
        .or_else(|| std::env::var("USER").ok())
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| format!("pid-{}", std::process::id()));
    std::env::temp_dir().join(format!("sacode-desktop-sidecar-{}", user_tag))
}

async fn launch_workspace(
    binary: PathBuf,
    workspace: PathBuf,
    ready_dir: PathBuf,
) -> Result<SacodeSidecar, String> {
    start_sidecar(
        binary,
        workspace,
        ready_dir,
        std::env::var("SACODE_OPENCODE_EXECUTABLE").ok(),
        std::env::var("SACODE_OPENCODE_ARGS").ok(),
    )
    .await
    .map_err(|e| e.to_string())
}

async fn prestart_workspace(
    state: &SidecarState,
    workspace: PathBuf,
    binary: PathBuf,
    ready_dir: PathBuf,
) -> Result<(), String> {
    let mut guard = state.inner.lock().await;
    if guard.is_some() {
        return Ok(());
    }
    let workspace = resolve_workspace(None, &repo_root_guess(), &workspace)?;
    let handle = launch_workspace(binary, workspace, ready_dir).await?;
    *guard = Some(handle);
    Ok(())
}

#[tauri::command]
async fn start_daemon(
    state: State<'_, Arc<SidecarState>>,
    terminal_state: State<'_, Arc<TerminalState>>,
    workspace: Option<String>,
) -> Result<SidecarHandleDto, String> {
    let requested_workspace = resolve_workspace(
        workspace.as_deref(),
        &repo_root_guess(),
        &default_workspace(),
    )?;
    start_workspace(
        state.inner(),
        terminal_state.inner(),
        requested_workspace,
        default_sacode_binary(),
        default_ready_dir(),
    )
    .await
}

async fn start_workspace(
    state: &SidecarState,
    terminal_state: &Arc<TerminalState>,
    requested_workspace: PathBuf,
    binary: PathBuf,
    ready_dir: PathBuf,
) -> Result<SidecarHandleDto, String> {
    let mut guard = state.inner.lock().await;
    if let Some(existing) = guard.as_ref() {
        if existing.workspace == requested_workspace {
            return Ok(existing.handle_dto());
        }
    }
    // A terminal belongs to the workspace that launched it. End it before
    // replacing the sidecar so shell commands cannot run in a stale folder.
    let terminals = terminal_state.clone();
    tokio::task::spawn_blocking(move || terminals.close_all())
        .await
        .map_err(|error| error.to_string())?;
    if let Some(bridge) = state.event_bridge.lock().await.take() {
        bridge.abort();
    }
    if let Some(mut existing) = guard.take() {
        existing.stop().await;
    }
    let handle = launch_workspace(binary, requested_workspace, ready_dir).await?;
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

/// Start an interactive PTY shell with an optional workspace-contained cwd.
#[tauri::command]
async fn terminal_start(
    app: AppHandle,
    state: State<'_, Arc<SidecarState>>,
    terminal_state: State<'_, Arc<TerminalState>>,
    rows: Option<u16>,
    cols: Option<u16>,
    cwd: Option<String>,
) -> Result<TerminalStartDto, String> {
    let sidecar = state.inner.lock().await;
    let workspace = sidecar
        .as_ref()
        .map(|handle| handle.workspace.clone())
        .ok_or_else(|| "daemon not started".to_string())?;
    let terminals = terminal_state.inner().clone();
    let result = tokio::task::spawn_blocking(move || {
        let directory = terminal::resolve_terminal_cwd(&workspace, cwd.as_deref())?;
        terminals.start(app, directory, rows.unwrap_or(24), cols.unwrap_or(80))
    })
    .await
    .map_err(|error| error.to_string())?;
    // Keep workspace switching serialized until the PTY has been registered.
    drop(sidecar);
    result
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
/// 关闭时移除托盘图标；返回壳侧真实生效状态。
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
            let mut builder = TrayIconBuilder::with_id("main")
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
                });
            // 托盘必须有图标，否则 Windows 通知区看不到入口
            if let Some(icon) = app.default_window_icon() {
                builder = builder.icon(icon.clone());
            }
            builder
                .build(&app)
                .map_err(|e| format!("build tray: {e}"))?;
            let _ = (show, quit);
        }
        Ok(true)
    } else {
        // 关闭托盘：移除图标，避免“开关关了但图标还在”
        if let Some(tray) = app.tray_by_id("main") {
            let _ = tray.set_visible(false);
        }
        app.remove_tray_by_id("main");
        Ok(false)
    }
}

/// 开机自启：调用 tauri-plugin-autostart（Windows 写 HKCU Run key）。
/// 返回注册表/启动项侧的真实结果；失败向上抛错，不假装已开启。
#[tauri::command]
async fn set_autostart(app: AppHandle, enabled: bool) -> Result<bool, String> {
    use tauri_plugin_autostart::ManagerExt;
    let launcher = app.autolaunch();
    if enabled {
        launcher
            .enable()
            .map_err(|e| format!("enable autostart: {e}"))?;
    } else {
        launcher
            .disable()
            .map_err(|e| format!("disable autostart: {e}"))?;
    }
    launcher
        .is_enabled()
        .map_err(|e| format!("query autostart: {e}"))
}

#[derive(Debug, Clone, serde::Serialize)]
struct SystemIntegrationStatus {
    tray_enabled: bool,
    autostart_enabled: bool,
}

/// 查询托盘 / 自启的壳侧真实状态（用于设置页对账，避免假开关）。
#[tauri::command]
async fn system_integration_status(
    app: AppHandle,
    state: State<'_, Arc<SidecarState>>,
) -> Result<SystemIntegrationStatus, String> {
    use tauri_plugin_autostart::ManagerExt;
    let autostart_enabled = app
        .autolaunch()
        .is_enabled()
        .map_err(|e| format!("query autostart: {e}"))?;
    Ok(SystemIntegrationStatus {
        tray_enabled: state.tray_enabled(),
        autostart_enabled,
    })
}

/// `git_workspace_status` — 在 sidecar 工作目录执行 `git status --porcelain=v1 -z --branch`。
///
/// 返回 `{ branch: Option<String>, porcelain: String }`，porcelain 为原始 NUL 分隔字节
/// （前端用 `parseGitStatusPorcelainZ` 解析）。branch 为当前分支名或 null（detached/无 git）。
#[tauri::command]
async fn git_workspace_status(
    state: State<'_, Arc<SidecarState>>,
) -> Result<GitWorkspaceStatus, String> {
    let workspace = {
        let guard = state.inner.lock().await;
        guard
            .as_ref()
            .map(|h| h.workspace.clone())
            .ok_or_else(|| "daemon not started".to_string())?
    };
    // git 可能不存在或工作目录非 git 仓库 — 返回结构化错误而非 panic
    let output = tokio::process::Command::new("git")
        .args(["status", "--porcelain=v1", "-z", "--branch"])
        .current_dir(&workspace)
        .output()
        .await
        .map_err(|e| format!("git status failed: {e}"))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("git status error: {stderr}"));
    }
    let raw = String::from_utf8_lossy(&output.stdout).into_owned();
    // 从 ## branch... 行提取分支名
    let branch = raw
        .split('\0')
        .next()
        .and_then(|first| first.strip_prefix("## "))
        .and_then(|s| s.split("...").next())
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());
    Ok(GitWorkspaceStatus {
        branch,
        porcelain: raw,
    })
}

/// `git_workspace_diff` — 在工作目录执行 `git diff`（工作区 vs 暂存区）或
/// `git diff --cached`（暂存区 vs HEAD）。返回原始 unified diff 文本。
#[tauri::command]
async fn git_workspace_diff(
    state: State<'_, Arc<SidecarState>>,
    cached: Option<bool>,
    path: Option<String>,
) -> Result<String, String> {
    let workspace = {
        let guard = state.inner.lock().await;
        guard
            .as_ref()
            .map(|h| h.workspace.clone())
            .ok_or_else(|| "daemon not started".to_string())?
    };
    let mut args = vec!["diff".to_string()];
    if cached.unwrap_or(false) {
        args.push("--cached".to_string());
    }
    if let Some(p) = &path {
        args.push("--".to_string());
        args.push(p.clone());
    }
    let output = tokio::process::Command::new("git")
        .args(&args)
        .current_dir(&workspace)
        .output()
        .await
        .map_err(|e| format!("git diff failed: {e}"))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("git diff error: {stderr}"));
    }
    Ok(String::from_utf8_lossy(&output.stdout).into_owned())
}

/// 返回类型（需 pub 以便 Tauri 自动生成 JS 绑定）
#[derive(serde::Serialize)]
pub struct GitWorkspaceStatus {
    pub branch: Option<String>,
    pub porcelain: String,
}

fn main() {
    let sidecar_state = Arc::new(SidecarState::new());
    let terminal_state = Arc::new(TerminalState::new());
    tauri::Builder::default()
        .manage(sidecar_state)
        .manage(terminal_state)
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec!["--hide"]),
        ))
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            // 后台静默启动模式：自启动时传 --hide，或用户从命令行传 --hide。
            // 隐藏模式下窗口保持隐藏（tauri.conf.json visible:false），
            // 用户通过托盘菜单「显示主窗口」手动打开界面。
            let hide_mode = std::env::args().any(|a| a == "--hide" || a == "--background");

            let win = app.get_webview_window("main");
            match win {
                Some(w) => {
                    let _ = w.set_title("SaCode Desktop");
                    // 非隐藏模式才显示窗口；隐藏模式保持不可见。
                    if !hide_mode {
                        let _ = w.show();
                        let _ = w.set_focus();
                    }
                }
                None => {
                    eprintln!("[tauri] ERROR: main window not found after setup");
                }
            }

            // 预启动 daemon：不等前端 IPC 调用（前端渲染慢/异常时 daemon 也能就绪）。
            // 失败不阻塞窗口创建，前端 start_daemon 失败时会展示真实错误。
            {
                let sidecar_state = app.state::<Arc<SidecarState>>().inner().clone();
                let binary = default_sacode_binary();
                let workspace = default_workspace();
                let ready_dir = default_ready_dir();
                tauri::async_runtime::spawn(async move {
                    if let Err(error) =
                        prestart_workspace(&sidecar_state, workspace, binary, ready_dir).await
                    {
                        eprintln!("[sidecar] daemon pre-start FAILED: {error}");
                    }
                });
            }

            // 后台静默启动时自动启用托盘，确保用户有入口重新打开界面。
            if hide_mode {
                let state = app.state::<Arc<SidecarState>>();
                state.tray.store(true, std::sync::atomic::Ordering::Relaxed);
                if app.tray_by_id("main").is_none() {
                    use tauri::menu::{Menu, MenuEvent, MenuItem};
                    use tauri::tray::{MouseButton, MouseButtonState, TrayIconEvent};
                    use tauri::Manager;
                    let handle = app.handle().clone();
                    let show = MenuItem::with_id(app, "show", "显示主窗口", true, None::<&str>)
                        .map_err(|e| format!("build tray menu: {e}"))?;
                    let quit = MenuItem::with_id(app, "quit", "退出 SaCode", true, None::<&str>)
                        .map_err(|e| format!("build tray menu: {e}"))?;
                    let menu = Menu::with_items(app, &[&show, &quit])
                        .map_err(|e| format!("build tray menu: {e}"))?;
                    let mut builder = TrayIconBuilder::with_id("main")
                        .tooltip("SaCode Desktop")
                        .menu(&menu)
                        .show_menu_on_left_click(false)
                        .on_menu_event(move |tray, menu_event: MenuEvent| {
                            match menu_event.id().as_ref() {
                                "show" => {
                                    if let Some(win) = tray.app_handle().get_webview_window("main")
                                    {
                                        let _ = win.show();
                                        let _ = win.set_focus();
                                    }
                                }
                                "quit" => {
                                    tray.app_handle().exit(0);
                                }
                                _ => {}
                            }
                        })
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
                        });
                    if let Some(icon) = app.default_window_icon() {
                        builder = builder.icon(icon.clone());
                    }
                    builder.build(app).map_err(|e| format!("build tray: {e}"))?;
                    let _ = (show, quit);
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
            set_autostart,
            system_integration_status,
            git_workspace_status,
            git_workspace_diff
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
    use super::*;

    #[test]
    fn workspace_resolution_preserves_explicit_relative_base_and_canonicalizes_default() {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path().join("repo");
        let default = temp.path().join("default");
        std::fs::create_dir_all(root.join("project")).unwrap();
        std::fs::create_dir(&default).unwrap();
        assert_eq!(
            resolve_workspace(Some("project/.."), &root, &default).unwrap(),
            pretty_canonicalize(&root).unwrap()
        );
        assert_eq!(
            resolve_workspace(None, &root, &default.join(".")).unwrap(),
            pretty_canonicalize(&default).unwrap()
        );
        assert_eq!(
            resolve_workspace(default.to_str(), &root, &root).unwrap(),
            pretty_canonicalize(&default).unwrap()
        );
        assert!(resolve_workspace(Some("missing"), &root, &default).is_err());
    }

    #[tokio::test]
    async fn failed_prestart_leaves_empty_slot_and_existing_bridge_untouched() {
        let temp = tempfile::tempdir().unwrap();
        let state = SidecarState::new();
        let bridge = tauri::async_runtime::spawn(std::future::pending::<()>());
        *state.event_bridge.lock().await = Some(bridge);
        assert!(prestart_workspace(
            &state,
            temp.path().join("missing"),
            temp.path().join("no-binary"),
            temp.path().join("ready")
        )
        .await
        .is_err());
        assert!(state.inner.lock().await.is_none());
        state.event_bridge.lock().await.take().unwrap().abort();
    }

    #[tokio::test]
    #[ignore = "requires SACODE_TEST_BINARY; starts only owned daemons in isolated temporary workspaces"]
    async fn native_workspace_start_orders_preserve_explicit_choice_and_cleanup() {
        let binary =
            PathBuf::from(std::env::var_os("SACODE_TEST_BINARY").expect("set SACODE_TEST_BINARY"));
        let temp = tempfile::tempdir().unwrap();
        let a = temp.path().join("a");
        let b = temp.path().join("b");
        std::fs::create_dir(&a).unwrap();
        std::fs::create_dir(&b).unwrap();
        let state = SidecarState::new();
        let terminals = Arc::new(TerminalState::new());
        let b_canonical = pretty_canonicalize(&b).unwrap();
        let first = start_workspace(
            &state,
            &terminals,
            b_canonical.clone(),
            binary.clone(),
            temp.path().join("ready-b"),
        )
        .await
        .unwrap();
        let terminal = terminal::tests::owned_native_terminal(&terminals, b_canonical.clone());
        let bridge = tauri::async_runtime::spawn(std::future::pending::<()>());
        *state.event_bridge.lock().await = Some(bridge);
        // An invalid binary makes any accidental late prestart observable immediately.
        prestart_workspace(
            &state,
            a.clone(),
            temp.path().join("no-binary"),
            temp.path().join("late-ready"),
        )
        .await
        .unwrap();
        {
            let mut guard = state.inner.lock().await;
            let current = guard.as_mut().unwrap();
            assert_eq!(current.info.pid, first.pid);
            assert_eq!(current.workspace, b_canonical);
            assert!(current.child.try_wait().unwrap().is_none());
        }
        assert!(state.event_bridge.lock().await.is_some());
        terminals.resize(&terminal.terminal_id, 25, 81).unwrap();
        let reused = start_workspace(
            &state,
            &terminals,
            resolve_workspace(b.join(".").to_str(), &a, &a).unwrap(),
            binary.clone(),
            temp.path().join("unused-ready"),
        )
        .await
        .unwrap();
        assert_eq!(reused.pid, first.pid);
        terminals.close_all();
        state.event_bridge.lock().await.take().unwrap().abort();
        state.inner.lock().await.take().unwrap().stop().await;

        prestart_workspace(
            &state,
            a.clone(),
            binary.clone(),
            temp.path().join("ready-a"),
        )
        .await
        .unwrap();
        let (old_pid, old_ready) = {
            let guard = state.inner.lock().await;
            let old = guard.as_ref().unwrap();
            (old.info.pid, old.ready_path.clone())
        };
        let terminal_a =
            terminal::tests::owned_native_terminal(&terminals, pretty_canonicalize(&a).unwrap());
        let (dropped_tx, dropped_rx) = tokio::sync::oneshot::channel();
        struct NotifyDrop(Option<tokio::sync::oneshot::Sender<()>>);
        impl Drop for NotifyDrop {
            fn drop(&mut self) {
                let _ = self.0.take().unwrap().send(());
            }
        }
        let notify = NotifyDrop(Some(dropped_tx));
        let (started_tx, started_rx) = tokio::sync::oneshot::channel();
        *state.event_bridge.lock().await = Some(tauri::async_runtime::spawn(async move {
            let _notify = notify;
            let _ = started_tx.send(());
            std::future::pending::<()>().await;
        }));
        started_rx.await.unwrap();
        let switched = start_workspace(
            &state,
            &terminals,
            b_canonical,
            binary,
            temp.path().join("ready-b2"),
        )
        .await
        .unwrap();
        assert_ne!(switched.pid, old_pid);
        assert!(terminals.resize(&terminal_a.terminal_id, 25, 81).is_err());
        assert!(!old_ready.exists());
        assert!(state.event_bridge.lock().await.is_none());
        tokio::time::timeout(std::time::Duration::from_secs(5), dropped_rx)
            .await
            .unwrap()
            .unwrap();
        state.inner.lock().await.take().unwrap().stop().await;
    }
}
