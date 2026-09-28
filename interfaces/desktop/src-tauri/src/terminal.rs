//! A workspace-bound interactive shell. PTY I/O runs on dedicated threads so
//! neither a blocked shell nor a slow terminal renderer blocks Tauri commands.

use std::collections::HashMap;
use std::io::{Read, Write};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{mpsc, Arc, Mutex};
use std::time::Duration;

use portable_pty::{native_pty_system, Child, ChildKiller, CommandBuilder, MasterPty, PtySize};
use rand::RngCore;
use serde::Serialize;
use tauri::{AppHandle, Emitter};

const CONTROL_TIMEOUT: Duration = Duration::from_secs(5);
const MAX_INPUT_BYTES: usize = 256 * 1024;

#[derive(Clone, Debug, Serialize)]
pub struct TerminalStartDto {
    pub terminal_id: String,
    pub shell: String,
    pub workspace: String,
    pub pid: Option<u32>,
}

#[derive(Clone, Debug, Serialize)]
struct TerminalOutput {
    terminal_id: String,
    data: String,
}

#[derive(Clone, Debug, Serialize)]
struct TerminalExit {
    terminal_id: String,
    code: Option<u32>,
    signal: Option<String>,
    reason: &'static str,
}

enum TerminalControl {
    Write(Vec<u8>, mpsc::Sender<Result<(), String>>),
    Resize(PtySize, mpsc::Sender<Result<(), String>>),
    Close(mpsc::Sender<Result<(), String>>),
}

struct TerminalSession {
    info: TerminalStartDto,
    control: mpsc::Sender<TerminalControl>,
    alive: Arc<AtomicBool>,
    killer: Box<dyn ChildKiller + Send + Sync>,
}

impl TerminalSession {
    fn close(&mut self) {
        if !self.alive.load(Ordering::Acquire) {
            return;
        }
        let (reply, receive) = mpsc::channel();
        let graceful = self.control.send(TerminalControl::Close(reply)).is_ok()
            && receive.recv_timeout(CONTROL_TIMEOUT).is_ok();
        if !graceful && self.alive.load(Ordering::Acquire) {
            // The PTY worker may be stuck in an I/O call; do not leave its shell
            // running after the workspace has been closed.
            let _ = self.killer.kill();
        }
    }
}

impl Drop for TerminalSession {
    fn drop(&mut self) {
        self.close();
    }
}

#[derive(Default)]
pub struct TerminalState {
    sessions: Mutex<HashMap<String, TerminalSession>>,
}

impl TerminalState {
    pub fn new() -> Self {
        Self::default()
    }

    /// Starts an independent persistent shell in the active workspace.
    pub fn start(
        &self,
        app: AppHandle,
        workspace: PathBuf,
        rows: u16,
        cols: u16,
    ) -> Result<TerminalStartDto, String> {
        let size = validated_size(rows, cols)?;
        let session = spawn_session(app, workspace, size)?;
        let info = session.info.clone();
        self.sessions
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .insert(info.terminal_id.clone(), session);
        Ok(info)
    }

    pub fn write(&self, terminal_id: &str, data: String) -> Result<(), String> {
        if data.len() > MAX_INPUT_BYTES {
            return Err("terminal input exceeds 256 KiB".into());
        }
        let control = self.control_for(terminal_id)?;
        let (reply, receive) = mpsc::channel();
        control
            .send(TerminalControl::Write(data.into_bytes(), reply))
            .map_err(|_| "terminal has exited".to_string())?;
        receive
            .recv_timeout(CONTROL_TIMEOUT)
            .map_err(|_| "terminal write timed out".to_string())?
    }

    pub fn resize(&self, terminal_id: &str, rows: u16, cols: u16) -> Result<(), String> {
        let size = validated_size(rows, cols)?;
        let control = self.control_for(terminal_id)?;
        let (reply, receive) = mpsc::channel();
        control
            .send(TerminalControl::Resize(size, reply))
            .map_err(|_| "terminal has exited".to_string())?;
        receive
            .recv_timeout(CONTROL_TIMEOUT)
            .map_err(|_| "terminal resize timed out".to_string())?
    }

    pub fn close(&self, terminal_id: &str) -> Result<(), String> {
        self.sessions
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .remove(terminal_id)
            .map(|_| ())
            .ok_or_else(|| "terminal session not found".into())
    }

    pub fn close_all(&self) {
        self.sessions
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .clear();
    }

    fn control_for(&self, terminal_id: &str) -> Result<mpsc::Sender<TerminalControl>, String> {
        let sessions = self
            .sessions
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        sessions
            .get(terminal_id)
            .filter(|session| session.alive.load(Ordering::Acquire))
            .map(|session| session.control.clone())
            .ok_or_else(|| "terminal session not found or exited".into())
    }
}

fn validated_size(rows: u16, cols: u16) -> Result<PtySize, String> {
    if !(1..=500).contains(&rows) || !(1..=1000).contains(&cols) {
        return Err("terminal size must be 1..500 rows and 1..1000 columns".into());
    }
    Ok(PtySize {
        rows,
        cols,
        pixel_width: 0,
        pixel_height: 0,
    })
}

fn selected_shell() -> String {
    if let Ok(shell) = std::env::var("SACODE_DESKTOP_SHELL") {
        if !shell.trim().is_empty() {
            return shell;
        }
    }
    #[cfg(windows)]
    {
        "powershell.exe".into()
    }
    #[cfg(not(windows))]
    {
        std::env::var("SHELL").unwrap_or_else(|_| "/bin/sh".into())
    }
}

fn random_terminal_id() -> String {
    let mut bytes = [0u8; 16];
    rand::thread_rng().fill_bytes(&mut bytes);
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn spawn_session(
    app: AppHandle,
    workspace: PathBuf,
    size: PtySize,
) -> Result<TerminalSession, String> {
    let shell = selected_shell();
    let pair = native_pty_system()
        .openpty(size)
        .map_err(|error| format!("open terminal PTY: {error}"))?;
    let mut command = CommandBuilder::new(&shell);
    command.cwd(&workspace);
    #[cfg(windows)]
    if shell.eq_ignore_ascii_case("powershell.exe") || shell.eq_ignore_ascii_case("pwsh.exe") {
        command.args(["-NoLogo", "-NoProfile"]);
    }
    #[cfg(not(windows))]
    command.env("TERM", "xterm-256color");
    let mut child = pair
        .slave
        .spawn_command(command)
        .map_err(|error| format!("start terminal shell: {error}"))?;
    // Keeping the slave open in this process would prevent EOF on Unix.
    drop(pair.slave);
    let mut reader = match pair.master.try_clone_reader() {
        Ok(reader) => reader,
        Err(error) => {
            let _ = child.kill();
            let _ = child.wait();
            return Err(format!("open terminal output: {error}"));
        }
    };
    let writer = match pair.master.take_writer() {
        Ok(writer) => writer,
        Err(error) => {
            let _ = child.kill();
            let _ = child.wait();
            return Err(format!("open terminal input: {error}"));
        }
    };
    let terminal_id = random_terminal_id();
    let info = TerminalStartDto {
        terminal_id: terminal_id.clone(),
        shell,
        workspace: workspace.to_string_lossy().into_owned(),
        pid: child.process_id(),
    };
    let mut killer = child.clone_killer();
    let output_app = app.clone();
    let output_id = terminal_id.clone();
    if let Err(error) = std::thread::Builder::new()
        .name("sacode-terminal-output".into())
        .spawn(move || {
            let mut buffer = [0u8; 8192];
            let mut pending = Vec::new();
            loop {
                match reader.read(&mut buffer) {
                    Ok(0) | Err(_) => break,
                    Ok(length) => {
                        let data = decode_utf8_chunk(&mut pending, &buffer[..length]);
                        if !data.is_empty() {
                            let _ = output_app.emit(
                                "terminal-output",
                                TerminalOutput {
                                    terminal_id: output_id.clone(),
                                    data,
                                },
                            );
                        }
                    }
                }
            }
            if !pending.is_empty() {
                let _ = output_app.emit(
                    "terminal-output",
                    TerminalOutput {
                        terminal_id: output_id,
                        data: String::from_utf8_lossy(&pending).into_owned(),
                    },
                );
            }
        })
    {
        let _ = child.kill();
        let _ = child.wait();
        return Err(format!("start terminal output worker: {error}"));
    }
    let (control, receiver) = mpsc::channel();
    let alive = Arc::new(AtomicBool::new(true));
    let worker_alive = Arc::clone(&alive);
    let worker_id = terminal_id;
    if let Err(error) = std::thread::Builder::new()
        .name("sacode-terminal-control".into())
        .spawn(move || {
            run_terminal(
                app,
                worker_id,
                child,
                pair.master,
                writer,
                receiver,
                worker_alive,
            )
        })
    {
        let _ = killer.kill();
        return Err(format!("start terminal control worker: {error}"));
    }
    Ok(TerminalSession {
        info,
        control,
        alive,
        killer,
    })
}

fn run_terminal(
    app: AppHandle,
    terminal_id: String,
    mut child: Box<dyn Child + Send + Sync>,
    master: Box<dyn MasterPty + Send>,
    mut writer: Box<dyn Write + Send>,
    receiver: mpsc::Receiver<TerminalControl>,
    alive: Arc<AtomicBool>,
) {
    let (reason, status) = loop {
        match child.try_wait() {
            Ok(Some(status)) => break ("exited", Some(status)),
            Err(_) => {
                let _ = child.kill();
                break ("error", child.wait().ok());
            }
            Ok(None) => {}
        }
        match receiver.recv_timeout(Duration::from_millis(50)) {
            Ok(TerminalControl::Write(data, reply)) => {
                let result = writer.write_all(&data).map_err(|error| error.to_string());
                let _ = reply.send(result);
            }
            Ok(TerminalControl::Resize(size, reply)) => {
                let result = master.resize(size).map_err(|error| error.to_string());
                let _ = reply.send(result);
            }
            Ok(TerminalControl::Close(reply)) => {
                let kill = child.kill().map_err(|error| error.to_string());
                let status = child.wait().ok();
                let _ = reply.send(kill);
                break ("closed", status);
            }
            Err(mpsc::RecvTimeoutError::Disconnected) => {
                let _ = child.kill();
                break ("closed", child.wait().ok());
            }
            Err(mpsc::RecvTimeoutError::Timeout) => {}
        }
    };
    alive.store(false, Ordering::Release);
    drop(writer);
    drop(master);
    let _ = app.emit(
        "terminal-exit",
        TerminalExit {
            terminal_id,
            code: status.as_ref().map(|value| value.exit_code()),
            signal: status.and_then(|value| value.signal().map(str::to_owned)),
            reason,
        },
    );
}

/// Preserve UTF-8 sequences split across PTY reads without delaying completed
/// text. Invalid sequences are replaced so output can always cross JSON IPC.
fn decode_utf8_chunk(pending: &mut Vec<u8>, chunk: &[u8]) -> String {
    pending.extend_from_slice(chunk);
    let mut output = String::new();
    loop {
        match std::str::from_utf8(pending) {
            Ok(valid) => {
                output.push_str(valid);
                pending.clear();
                break;
            }
            Err(error) => {
                let prefix = error.valid_up_to();
                output.push_str(std::str::from_utf8(&pending[..prefix]).unwrap_or_default());
                match error.error_len() {
                    Some(invalid_len) => {
                        output.push('\u{fffd}');
                        pending.drain(..prefix + invalid_len);
                    }
                    None => {
                        pending.drain(..prefix);
                        break;
                    }
                }
            }
        }
    }
    output
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validates_terminal_size() {
        assert!(validated_size(24, 80).is_ok());
        assert!(validated_size(0, 80).is_err());
        assert!(validated_size(24, 0).is_err());
        assert!(validated_size(501, 80).is_err());
        assert!(validated_size(24, 1001).is_err());
    }

    #[test]
    fn decodes_split_utf8_without_replacement() {
        let mut pending = Vec::new();
        assert_eq!(decode_utf8_chunk(&mut pending, &[0xe4, 0xb8]), "");
        assert_eq!(decode_utf8_chunk(&mut pending, &[0xad, b'!']), "中!");
        assert!(pending.is_empty());
    }

    #[test]
    fn replaces_invalid_utf8_and_continues() {
        let mut pending = Vec::new();
        assert_eq!(
            decode_utf8_chunk(&mut pending, &[b'a', 0xff, b'b']),
            "a\u{fffd}b"
        );
        assert!(pending.is_empty());
    }
}
