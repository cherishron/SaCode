use std::process::{Command, Stdio};
use std::time::Duration;
use std::io::Read;
use wait_timeout::ChildExt;

use crate::tools::spec::{ToolSpec, ToolOutput, SideEffectLevel};

use super::sandbox::ShellSandbox;

const DEFAULT_TIMEOUT_SECS: u64 = 30;
const MAX_OUTPUT_LEN: usize = 10000;

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

    let parts = split_command(command_str)?;
    let Some(program) = parts.first() else {
        return Ok(ToolOutput::failure("command is required"));
    };

    let mut cmd = Command::new(program);
    cmd.args(parts.iter().skip(1));
    cmd.stdout(Stdio::piped());
    cmd.stderr(Stdio::piped());

    if let Some(dir) = cwd {
        cmd.current_dir(dir);
    }

    let mut child = cmd.spawn()?;

    let timeout = Duration::from_secs(timeout_secs);
    let status = child.wait_timeout(timeout)?;

    match status {
        Some(exit_status) => {
            let mut stdout = String::new();
            let mut stderr = String::new();

            if let Some(mut out) = child.stdout {
                out.read_to_string(&mut stdout)?;
            }
            if let Some(mut err) = child.stderr {
                err.read_to_string(&mut stderr)?;
            }

            stdout = truncate_output(stdout);
            stderr = truncate_output(stderr);

            let exit_code = exit_status.code().unwrap_or(-1);
            let success = exit_status.success();

            Ok(ToolOutput::success(serde_json::json!({
                "stdout": stdout,
                "stderr": stderr,
                "exit_code": exit_code,
                "success": success,
                "timed_out": false
            })))
        }
        None => {
            child.kill()?;
            child.wait()?;

            Ok(ToolOutput::failure("command timed out")
                .with_message(format!("Timeout after {} seconds", timeout_secs)))
        }
    }
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

    false
}

fn truncate_output(output: String) -> String {
    if output.len() > MAX_OUTPUT_LEN {
        format!("{}... (truncated, {} bytes total)", 
            &output[..MAX_OUTPUT_LEN], output.len())
    } else {
        output
    }
}
