use std::path::PathBuf;

use anyhow::Result;

use crate::sandbox::{active_policy, FsAccess, NetworkAccess};

use super::ToolSpec;

pub fn preflight(spec: &ToolSpec, input: &serde_json::Value) -> Result<()> {
    let policy = active_policy();

    if let Some(network_access) = required_network_access(&spec.name, input) {
        if !policy.check_network(network_access) {
            anyhow::bail!("network access blocked by sandbox policy");
        }
    }

    if spec.name == "task.spawn" && !policy.check_task_spawn() {
        anyhow::bail!("task spawn blocked by sandbox policy");
    }

    if let Some(command) = extract_command(&spec.name, input) {
        if !policy.check_command(&command) {
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
            anyhow::bail!("path is blocked by sandbox policy");
        }
    }

    Ok(())
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
        "git.diff" => Some("git".to_string()),
        "task.spawn" => std::env::current_exe()
            .ok()
            .map(|path| path.to_string_lossy().to_string()),
        _ => None,
    }
}

fn path_access_for_tool(tool_name: &str) -> FsAccess {
    match tool_name {
        "fs.write" | "fs.edit" => FsAccess::Write,
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
