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

/// Restricts the initial shell directory, not subsequent interactive shell access.
pub fn resolve_terminal_cwd(
    workspace: &std::path::Path,
    cwd: Option<&str>,
) -> Result<PathBuf, String> {
    let root = crate::sidecar::pretty_canonicalize(workspace).map_err(|error| error.to_string())?;
    let candidate = cwd
        .map(PathBuf::from)
        .map(|path| {
            if path.is_absolute() {
                path
            } else {
                root.join(path)
            }
        })
        .unwrap_or_else(|| root.clone());
    let resolved =
        crate::sidecar::pretty_canonicalize(&candidate).map_err(|error| error.to_string())?;
    if !root.is_dir() || !resolved.is_dir() {
        return Err("terminal cwd and workspace must be existing directories".into());
    }
    if !resolved.starts_with(&root) {
        return Err("terminal cwd must be inside the active workspace".into());
    }
    Ok(resolved)
}

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
    /// Raw PTY bytes decoded as UTF-8 only (JSON IPC needs a string). ANSI/CSI
    /// escapes pass through untouched; stripping is a renderer concern.
    data: String,
}

#[derive(Clone, Debug, Serialize)]
struct TerminalExit {
    terminal_id: String,
    code: Option<u32>,
    signal: Option<String>,
    reason: &'static str,
}

enum TerminalEvent {
    Output(TerminalOutput),
    Exit(TerminalExit),
}

type TerminalEmitter = Arc<dyn Fn(TerminalEvent) + Send + Sync>;

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
        let emitter: TerminalEmitter = Arc::new(move |event| match event {
            TerminalEvent::Output(payload) => {
                let _ = app.emit("terminal-output", payload);
            }
            TerminalEvent::Exit(payload) => {
                let _ = app.emit("terminal-exit", payload);
            }
        });
        self.start_with_emitter(emitter, workspace, rows, cols)
    }

    fn start_with_emitter(
        &self,
        emitter: TerminalEmitter,
        workspace: PathBuf,
        rows: u16,
        cols: u16,
    ) -> Result<TerminalStartDto, String> {
        let size = validated_size(rows, cols)?;
        let session = spawn_session(emitter, workspace, size)?;
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
    emitter: TerminalEmitter,
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
    let output_emitter = Arc::clone(&emitter);
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
                            output_emitter(TerminalEvent::Output(TerminalOutput {
                                terminal_id: output_id.clone(),
                                data,
                            }));
                        }
                    }
                }
            }
            if !pending.is_empty() {
                output_emitter(TerminalEvent::Output(TerminalOutput {
                    terminal_id: output_id,
                    data: String::from_utf8_lossy(&pending).into_owned(),
                }));
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
                emitter,
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
    emitter: TerminalEmitter,
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
    emitter(TerminalEvent::Exit(TerminalExit {
        terminal_id,
        code: status.as_ref().map(|value| value.exit_code()),
        signal: status.and_then(|value| value.signal().map(str::to_owned)),
        reason,
    }));
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
pub(crate) mod tests {
    use super::*;

    #[test]
    fn cwd_resolves_existing_directories_inside_canonical_workspace() {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path().join("workspace");
        let sub = root.join("sub");
        std::fs::create_dir_all(&sub).unwrap();
        let expected_root = crate::sidecar::pretty_canonicalize(&root).unwrap();
        let expected_sub = expected_root.join("sub");
        for cwd in [None, Some("."), Some("sub/.."), Some("")] {
            assert_eq!(resolve_terminal_cwd(&root, cwd).unwrap(), expected_root);
        }
        assert_eq!(
            resolve_terminal_cwd(&root, Some("sub")).unwrap(),
            expected_sub
        );
        assert_eq!(
            resolve_terminal_cwd(&root, sub.to_str()).unwrap(),
            expected_sub
        );
        #[cfg(windows)]
        assert_eq!(
            resolve_terminal_cwd(&std::fs::canonicalize(&root).unwrap(), sub.to_str()).unwrap(),
            expected_sub
        );
    }

    #[test]
    fn cwd_rejects_escape_prefix_collision_files_and_missing_paths() {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path().join("workspace");
        let sibling = temp.path().join("workspace-other");
        std::fs::create_dir(&root).unwrap();
        std::fs::create_dir(&sibling).unwrap();
        std::fs::write(root.join("file"), "test").unwrap();
        for cwd in [
            Some(".."),
            Some("../workspace-other"),
            sibling.to_str(),
            Some("file"),
            Some("missing"),
        ] {
            assert!(
                resolve_terminal_cwd(&root, cwd).is_err(),
                "accepted {cwd:?}"
            );
        }
        assert!(resolve_terminal_cwd(&root.join("missing"), None).is_err());
    }

    #[test]
    fn cwd_rejects_external_directory_link() {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path().join("workspace");
        let outside = temp.path().join("outside");
        std::fs::create_dir(&root).unwrap();
        std::fs::create_dir(&outside).unwrap();
        let link = root.join("escape");
        #[cfg(unix)]
        std::os::unix::fs::symlink(&outside, &link).unwrap();
        #[cfg(windows)]
        {
            // Junctions do not require Windows developer-mode symlink privileges.
            let status = std::process::Command::new("cmd.exe")
                .args(["/C", "mklink", "/J"])
                .arg(&link)
                .arg(&outside)
                .status()
                .unwrap();
            assert!(status.success());
        }
        assert!(resolve_terminal_cwd(&root, Some("escape")).is_err());
        #[cfg(windows)]
        std::fs::remove_dir(&link).unwrap();
        #[cfg(unix)]
        std::fs::remove_file(&link).unwrap();
    }

    #[test]
    #[ignore = "requires a native PTY and the platform shell; starts only an owned shell"]
    fn native_cwd_shell_io_resize_and_close() {
        let temp = tempfile::tempdir().unwrap();
        let sub = temp.path().join("sub");
        std::fs::create_dir(&sub).unwrap();
        let terminals = TerminalState::new();
        let (tx, rx) = mpsc::channel();
        let emitter: TerminalEmitter = Arc::new(move |event| {
            let _ = tx.send(event);
        });
        let cwd = resolve_terminal_cwd(temp.path(), Some("sub")).unwrap();
        let info = terminals
            .start_with_emitter(emitter, cwd.clone(), 24, 80)
            .unwrap();
        assert_eq!(info.workspace, cwd.to_string_lossy());
        terminals.resize(&info.terminal_id, 30, 100).unwrap();
        #[cfg(windows)]
        let command = "Write-Output ('CWD_PROBE:' + (Get-Location).Path)\r";
        #[cfg(not(windows))]
        let command = "printf 'CWD_PROBE:%s\\n' \"$PWD\"\r";
        terminals.write(&info.terminal_id, command.into()).unwrap();
        let expected = format!("CWD_PROBE:{}", cwd.display());
        let deadline = std::time::Instant::now() + Duration::from_secs(10);
        let mut output = String::new();
        while !output.contains(&expected) {
            match rx
                .recv_timeout(deadline.saturating_duration_since(std::time::Instant::now()))
                .unwrap_or_else(|error| {
                    panic!("cwd probe {expected:?}: {error}; output={output:?}")
                }) {
                TerminalEvent::Output(payload) => {
                    // ConPTY asks the terminal renderer for its cursor position.
                    // This headless harness must answer just as the renderer does.
                    if payload.data.contains("\x1b[6n") {
                        terminals
                            .write(&info.terminal_id, "\x1b[1;1R".into())
                            .unwrap();
                        terminals.write(&info.terminal_id, command.into()).unwrap();
                    }
                    output.push_str(&payload.data);
                }
                TerminalEvent::Exit(_) => panic!("shell exited before cwd probe"),
            }
        }
        terminals.close(&info.terminal_id).unwrap();
        assert!(terminals.control_for(&info.terminal_id).is_err());
    }

    pub(crate) fn owned_native_terminal(
        state: &TerminalState,
        workspace: PathBuf,
    ) -> TerminalStartDto {
        state
            .start_with_emitter(Arc::new(|_| {}), workspace, 24, 80)
            .unwrap()
    }

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
