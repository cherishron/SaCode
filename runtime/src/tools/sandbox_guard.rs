use std::path::PathBuf;

use anyhow::Result;

use crate::sandbox::active_policy;

use super::ToolSpec;

pub fn preflight(spec: &ToolSpec, input: &serde_json::Value) -> Result<()> {
    let policy = active_policy();

    if requires_network(&spec.name, input) && !policy.check_network() {
        anyhow::bail!("network access blocked by sandbox policy");
    }

    if let Some(command) = extract_command(&spec.name, input) {
        if !policy.check_command(&command) {
            anyhow::bail!("command '{}' is blocked by sandbox policy", command);
        }
    }

    for path in extract_paths(input) {
        let resolved = if path.is_absolute() {
            path
        } else {
            std::env::current_dir()?.join(path)
        };

        if !policy.check_path(&resolved) {
            anyhow::bail!("path is blocked by sandbox policy");
        }
    }

    Ok(())
}

fn requires_network(name: &str, input: &serde_json::Value) -> bool {
    is_network_tool(name) || has_network_fields(input)
}

fn is_network_tool(name: &str) -> bool {
    matches!(name, "web.fetch" | "web.search" | "browser.open" | "browser.navigate")
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

fn has_network_fields(input: &serde_json::Value) -> bool {
    for key in ["url", "urls", "base_url", "baseUrl", "endpoint", "endpoints"] {
        if input
            .get(key)
            .and_then(|value| value.as_str())
            .is_some_and(|value| is_network_value(value.trim()))
        {
            return true;
        }

        if input
            .get(key)
            .and_then(|value| value.as_array())
            .is_some_and(|items| items.iter().filter_map(|item| item.as_str()).any(|value| is_network_value(value.trim())))
        {
            return true;
        }
    }

    false
}

fn is_network_value(value: &str) -> bool {
    value.starts_with("http://") || value.starts_with("https://")
}

fn first_token(command: &str) -> Option<&str> {
    command.split_whitespace().next().filter(|token| !token.is_empty())
}
