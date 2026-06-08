use crate::tools::spec::{SideEffectLevel, ToolOutput, ToolSpec};
use crate::{active_backend, active_policy, BackendCommandOutput, SandboxCommand};

use super::sandbox::ShellSandbox;

const DEFAULT_TIMEOUT_SECS: u64 = 30;
const MAX_OUTPUT_LEN: usize = 10000;

#[cfg(target_os = "windows")]
const WINDOWS_SHELL_BUILTINS: &[&str] = &[
    "dir", "type", "echo", "copy", "del", "ren", "mkdir", "rmdir",
    "set", "cd", "chdir", "md", "move", "pushd", "popd", "path",
    "assoc", "ftype", "cls", "color", "date", "time", "title",
    "mklink", "robocopy", "xcopy", "find", "findstr", "where",
    "sort", "more", "fc", "comp", "tree", "ver", "vol",
];

#[cfg(target_os = "windows")]
const WINDOWS_DANGEROUS_PATTERNS: &[&str] = &[
    "format", "diskpart", "bcdedit", "reg delete", "del /f /s", "rmdir /s",
    "takeown", "icacls", "shutdown", "reboot", "net user", "wmic",
];

pub fn spec() -> ToolSpec {
    ToolSpec {
        name: "shell.exec".to_string(),
        description: "执行 Shell 命令".to_string(),
        input_schema: serde_json::json!({
            "type": "object",
            "properties": {
                "command": { "type": "string", "description": "要执行的命令" },
                "timeout": { "type": "integer", "description": "超时秒数(可选,默认30)" },
                "cwd": { "type": "string", "description": "工作目录(可选)" }
            },
            "required": ["command"]
        }),
        output_schema: serde_json::json!({
            "type": "object",
            "properties": {
                "stdout": { "type": "string" },
                "stderr": { "type": "string" },
                "exit_code": { "type": "integer" },
                "success": { "type": "boolean" },
                "timed_out": { "type": "boolean" }
            }
        }),
        side_effect_level: SideEffectLevel::Execute,
        approval_required: true,
        timeout_ms: Some(DEFAULT_TIMEOUT_SECS * 1000),
        tags: vec!["shell".to_string(), "exec".to_string()],
    }
}

pub fn execute(input: serde_json::Value) -> anyhow::Result<ToolOutput> {
    let command_str = input["command"].as_str().unwrap_or("");
    let timeout_secs = input["timeout"].as_u64().unwrap_or(DEFAULT_TIMEOUT_SECS);
    let cwd = input["cwd"].as_str();

    if command_str.is_empty() {
        return Ok(ToolOutput::failure("command is required"));
    }

    if is_dangerous_command(command_str) {
        return Ok(ToolOutput::failure("dangerous command blocked"));
    }

    ShellSandbox::validate(command_str, cwd)?;

    let parts = build_command_parts(command_str)?;
    let Some(program) = parts.first() else {
        return Ok(ToolOutput::failure("command is required"));
    };

    let output = active_backend().execute_command(
        &active_policy(),
        &SandboxCommand {
            program: program.clone(),
            args: parts.iter().skip(1).cloned().collect(),
            cwd: cwd.map(str::to_string),
            timeout_ms: timeout_secs * 1000,
        },
    )?;

    Ok(tool_output_from_backend(output))
}

fn split_command(command: &str) -> anyhow::Result<Vec<String>> {
    let mut parts = Vec::new();
    let mut current = String::new();
    let mut chars = command.chars().peekable();
    let mut quote: Option<char> = None;

    while let Some(ch) = chars.next() {
        match quote {
            Some(active_quote) => {
                if ch == active_quote {
                    quote = None;
                } else if ch == '\\' {
                    if let Some(next) = chars.next() {
                        current.push(next);
                    }
                } else {
                    current.push(ch);
                }
            }
            None => {
                if ch.is_whitespace() {
                    if !current.is_empty() {
                        parts.push(std::mem::take(&mut current));
                    }
                } else if ch == '\'' || ch == '"' {
                    quote = Some(ch);
                } else if ch == '\\' {
                    if let Some(next) = chars.next() {
                        current.push(next);
                    }
                } else {
                    current.push(ch);
                }
            }
        }
    }

    if quote.is_some() {
        anyhow::bail!("unterminated quoted string in command");
    }

    if !current.is_empty() {
        parts.push(current);
    }

    Ok(parts)
}

fn build_command_parts(command: &str) -> anyhow::Result<Vec<String>> {
    #[cfg(target_os = "windows")]
    {
        let parsed = split_command(command)?;
        let Some(program) = parsed.first() else {
            anyhow::bail!("command is required");
        };
        if needs_shell_wrapper(program) {
            return Ok(vec!["cmd.exe".to_string(), "/C".to_string(), command.to_string()]);
        }
        return Ok(parsed);
    }

    #[cfg(not(target_os = "windows"))]
    {
        split_command(command)
    }
}

fn is_dangerous_command(cmd: &str) -> bool {
    let dangerous_patterns = [
        "rm -rf /",
        "rm -rf ~",
        "rm -rf *",
        ":(){ :|:& };:",
        "mkfs",
        "dd if=",
        "> /dev/sda",
        "chmod 777 /",
        "shutdown",
        "reboot",
        "init 0",
        "init 6",
    ];

    let cmd_lower = cmd.to_lowercase();
    for pattern in dangerous_patterns {
        if cmd_lower.contains(pattern) {
            return true;
        }
    }

    #[cfg(target_os = "windows")]
    {
        for pattern in WINDOWS_DANGEROUS_PATTERNS {
            if cmd_lower.contains(pattern) {
                return true;
            }
        }
    }

    false
}

#[cfg(target_os = "windows")]
fn needs_shell_wrapper(program: &str) -> bool {
    let lower = program.to_ascii_lowercase();
    WINDOWS_SHELL_BUILTINS.contains(&lower.as_str())
}

fn truncate_output(output: String) -> String {
    if output.len() > MAX_OUTPUT_LEN {
        format!(
            "{}... (truncated, {} bytes total)",
            &output[..MAX_OUTPUT_LEN],
            output.len()
        )
    } else {
        output
    }
}

fn tool_output_from_backend(output: BackendCommandOutput) -> ToolOutput {
    if output.timed_out {
        return ToolOutput::failure("command timed out");
    }

    ToolOutput::success(serde_json::json!({
        "stdout": truncate_output(output.stdout),
        "stderr": truncate_output(output.stderr),
        "exit_code": output.exit_code,
        "success": output.exit_code == 0,
        "timed_out": false
    }))
}
