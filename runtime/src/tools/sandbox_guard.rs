use std::io::Write;
use std::path::PathBuf;

use anyhow::Result;

use crate::sandbox::{active_policy, FsAccess, NetworkAccess};

use super::{SideEffectLevel, ToolSpec};

pub fn preflight(spec: &ToolSpec, input: &serde_json::Value) -> Result<()> {
    if should_audit(spec) {
        write_audit_log(
            &spec.name,
            "preflight_start",
            "pending",
            Some(input),
            None,
        );
    }

    let policy = active_policy();

    if let Some(network_access) = required_network_access(&spec.name, input) {
        if !policy.check_network(network_access) {
            if should_audit(spec) {
                write_audit_log(
                    &spec.name,
                    "preflight_blocked",
                    "network_blocked",
                    Some(input),
                    None,
                );
            }
            anyhow::bail!("network access blocked by sandbox policy");
        }
    }

    if spec.name == "task.spawn" && !policy.check_task_spawn() {
        if should_audit(spec) {
            write_audit_log(
                &spec.name,
                "preflight_blocked",
                "task_spawn_blocked",
                Some(input),
                None,
            );
        }
        anyhow::bail!("task spawn blocked by sandbox policy");
    }

    if let Some(command) = extract_command(&spec.name, input) {
        if !policy.check_command(&command) {
            if should_audit(spec) {
                write_audit_log(
                    &spec.name,
                    "preflight_blocked",
                    "command_blocked",
                    Some(input),
                    Some(serde_json::json!({ "command": command })),
                );
            }
            anyhow::bail!("command '{}' is blocked by sandbox policy", command);
        }
    }

    let path_access = path_access_for_tool(&spec.name);
    for path in extract_paths(input) {
        let resolved = if path.is_absolute() {
            path
        } else {
            std::env::current_dir()?.join(path)
        };

        if !policy.check_path(&resolved, path_access) {
            if should_audit(spec) {
                write_audit_log(
                    &spec.name,
                    "preflight_blocked",
                    "path_blocked",
                    Some(input),
                    Some(serde_json::json!({ "path": resolved.display().to_string() })),
                );
            }
            anyhow::bail!("path is blocked by sandbox policy");
        }
    }

    if should_audit(spec) {
        write_audit_log(
            &spec.name,
            "preflight_allowed",
            "allowed",
            Some(input),
            None,
        );
    }

    Ok(())
}

pub fn audit_execution_result(
    spec: &ToolSpec,
    input: &serde_json::Value,
    output: Option<&super::ToolOutput>,
    error: Option<&str>,
) {
    if !should_audit(spec) {
        return;
    }

    let status = if error.is_some() {
        "error"
    } else if output.is_some_and(|result| result.success) {
        "success"
    } else {
        "failure"
    };

    let result_payload = output.map(|result| {
        serde_json::json!({
            "success": result.success,
            "message": result.message,
            "data": result.data,
        })
    });

    let extra = match (result_payload, error) {
        (Some(payload), Some(message)) => Some(serde_json::json!({
            "result": payload,
            "error": message,
        })),
        (Some(payload), None) => Some(serde_json::json!({ "result": payload })),
        (None, Some(message)) => Some(serde_json::json!({ "error": message })),
        (None, None) => None,
    };

    write_audit_log(&spec.name, "execution", status, Some(input), extra);
}

fn should_audit(spec: &ToolSpec) -> bool {
    matches!(spec.side_effect_level, SideEffectLevel::Modify)
}

fn write_audit_log(
    tool_name: &str,
    phase: &str,
    status: &str,
    input: Option<&serde_json::Value>,
    extra: Option<serde_json::Value>,
) {
    let Ok(workdir) = std::env::current_dir() else {
        return;
    };

    let sacode_dir = workdir.join(".sacode");
    if std::fs::create_dir_all(&sacode_dir).is_err() {
        return;
    }

    let log_path = sacode_dir.join("audit.log");
    let Ok(mut file) = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(log_path)
    else {
        return;
    };

    let mut payload = serde_json::json!({
        "ts": chrono::Utc::now().to_rfc3339(),
        "tool": tool_name,
        "phase": phase,
        "status": status,
    });

    if let Some(input) = input {
        payload["input"] = input.clone();
    }
    if let Some(extra) = extra {
        payload["extra"] = extra;
    }

    let _ = writeln!(file, "{}", payload);
}

fn required_network_access(name: &str, input: &serde_json::Value) -> Option<NetworkAccess> {
    network_access_for_tool(name).or_else(|| network_access_from_fields(input))
}

fn network_access_for_tool(name: &str) -> Option<NetworkAccess> {
    match name {
        "web.search" => Some(NetworkAccess::Search),
        "web.fetch" => Some(NetworkAccess::Fetch),
        "browser.open" | "browser.navigate" => Some(NetworkAccess::Browser),
        _ => None,
    }
}

fn extract_command(tool_name: &str, input: &serde_json::Value) -> Option<String> {
    match tool_name {
        "shell.exec" => input
            .get("command")
            .and_then(|value| value.as_str())
            .and_then(first_token)
            .map(str::to_string),
        "git.diff" | "git.commit" => Some("git".to_string()),
        "task.spawn" => std::env::current_exe()
            .ok()
            .map(|path| path.to_string_lossy().to_string()),
        _ => None,
    }
}

fn path_access_for_tool(tool_name: &str) -> FsAccess {
    match tool_name {
        "fs.write" | "fs.edit" | "git.commit" => FsAccess::Write,
        _ => FsAccess::Read,
    }
}

fn extract_paths(input: &serde_json::Value) -> Vec<PathBuf> {
    let mut paths = Vec::new();

    for key in [
        "path",
        "paths",
        "cwd",
        "file_path",
        "filePath",
        "output_path",
        "outputPath",
        "session_path",
        "sessionPath",
        "root",
        "dir",
        "directory",
    ] {
        if let Some(value) = input.get(key).and_then(|value| value.as_str()) {
            let value = value.trim();
            if !value.is_empty() {
                paths.push(PathBuf::from(value));
            }
        }

        if let Some(items) = input.get(key).and_then(|value| value.as_array()) {
            for item in items {
                if let Some(value) = item.as_str() {
                    let value = value.trim();
                    if !value.is_empty() {
                        paths.push(PathBuf::from(value));
                    }
                }
            }
        }
    }

    paths
}

fn network_access_from_fields(input: &serde_json::Value) -> Option<NetworkAccess> {
    for key in [
        "url",
        "urls",
        "base_url",
        "baseUrl",
        "endpoint",
        "endpoints",
    ] {
        if input
            .get(key)
            .and_then(|value| value.as_str())
            .is_some_and(|value| is_network_value(value.trim()))
        {
            return Some(NetworkAccess::Fetch);
        }

        if input
            .get(key)
            .and_then(|value| value.as_array())
            .is_some_and(|items| {
                items
                    .iter()
                    .filter_map(|item| item.as_str())
                    .any(|value| is_network_value(value.trim()))
            })
        {
            return Some(NetworkAccess::Fetch);
        }
    }

    None
}

fn is_network_value(value: &str) -> bool {
    value.starts_with("http://") || value.starts_with("https://")
}

fn first_token(command: &str) -> Option<&str> {
    command
        .split_whitespace()
        .next()
        .filter(|token| !token.is_empty())
}
