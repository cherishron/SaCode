// SaCode Desktop Tauri shell — holds sacode serve sidecar.
// Build after: cargo install tauri-cli
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod sidecar;

use std::path::PathBuf;
use std::sync::Arc;

use sidecar::{start_sidecar, SacodeSidecar};
use tauri::{AppHandle, Manager, State};
use tokio::sync::Mutex;

struct SidecarState {
    inner: Mutex<Option<SacodeSidecar>>,
}

fn default_sacode_binary() -> PathBuf {
    if let Ok(p) = std::env::var("SACODE_BINARY_PATH") {
        if !p.trim().is_empty() {
            return PathBuf::from(p);
        }
    }
    // Prefer debug build next to repo when developing.
    let candidates = [
        PathBuf::from("target/debug/sacode.exe"),
        PathBuf::from("target/debug/sacode"),
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
    std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."))
}

#[tauri::command]
async fn start_daemon(
    state: State<'_, Arc<SidecarState>>,
    workspace: Option<String>,
) -> Result<sidecar::SidecarHandleDto, String> {
    let mut guard = state.inner.lock().await;
    if let Some(existing) = guard.as_ref() {
        return Ok(existing.handle_dto());
    }
    let workspace_path = workspace
        .map(PathBuf::from)
        .unwrap_or_else(default_workspace);
    let ready_dir = std::env::temp_dir().join("sacode-desktop-sidecar");
    let handle = start_sidecar(
        default_sacode_binary(),
        workspace_path,
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
    if let Some(mut handle) = guard.take() {
        handle.stop().await;
    }
    Ok(())
}

#[tauri::command]
async fn daemon_info(
    state: State<'_, Arc<SidecarState>>,
) -> Result<Option<sidecar::SidecarHandleDto>, String> {
    let guard = state.inner.lock().await;
    Ok(guard.as_ref().map(|h| h.handle_dto()))
}

fn main() {
    let sidecar_state = Arc::new(SidecarState {
        inner: Mutex::new(None),
    });
    tauri::Builder::default()
        .manage(sidecar_state)
        .invoke_handler(tauri::generate_handler![
            start_daemon,
            stop_daemon,
            daemon_info
        ])
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::Destroyed = event {
                let app: AppHandle = window.app_handle();
                let state = app.state::<Arc<SidecarState>>();
                let state = state.inner().clone();
                tauri::async_runtime::spawn(async move {
                    let mut guard = state.lock().await;
                    if let Some(mut handle) = guard.take() {
                        handle.stop().await;
                    }
                });
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running SaCode Desktop");
}
