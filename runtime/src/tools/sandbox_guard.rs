use std::io::Write;
use std::path::PathBuf;

use anyhow::Result;

use crate::sandbox::{FsAccess, NetworkAccess};

use super::{SideEffectLevel, ToolOutput, ToolSpec};

/// 向后兼容入口：执行前审批检查
///
/// 保留为自由函数，委托给默认拦截器链（见 `interceptors::default`）。
/// 新代码应优先使用 `ToolRegistry::execute` 的拦截器机制。
pub fn preflight(spec: &ToolSpec, input: &serde_json::Value) -> Result<()> {
    use super::interceptor::InterceptContext;
    use super::interceptors::default::run_preflight_chain;
    use super::interceptors::default::default_interceptors;

    let interceptors = default_interceptors();
    let ctx = InterceptContext::default();
    match run_preflight_chain(spec, input, &ctx, &interceptors)? {
        _ => Ok(()),
    }
}

/// 向后兼容入口：执行后审计
///
/// 保留为自由函数，委托给 `AuditInterceptor` 的 `post_execute`（见 `interceptors::default`）。
/// 新代码应优先使用 `ToolRegistry::execute` 的拦截器机制。
pub fn audit_execution_result(
    spec: &ToolSpec,
    input: &serde_json::Value,
    output: Option<&ToolOutput>,
    error: Option<&str>,
) {
    use super::interceptor::{InterceptContext, PostExecuteDecision, ToolInterceptor};
    use super::interceptors::default::AuditInterceptor;

    let interceptor = AuditInterceptor;
    let _ = matches!(
        interceptor.post_execute(spec, input, output, error, &InterceptContext::default()),
        PostExecuteDecision::Keep
    );
}

// ── 审计辅助函数：供默认拦截器复用 ───────────────────────────────

pub(crate) fn should_audit(spec: &ToolSpec) -> bool {
    matches!(spec.side_effect_level, SideEffectLevel::Modify)
}

pub(crate) fn audit_preflight_start(tool_name: &str, input: &serde_json::Value) {
    write_audit_log(tool_name, "preflight_start", "pending", Some(input), None);
}

pub(crate) fn audit_preflight_allowed(tool_name: &str, input: &serde_json::Value) {
    write_audit_log(tool_name, "preflight_allowed", "allowed", Some(input), None);
}

pub(crate) fn audit_network_blocked(tool_name: &str, input: &serde_json::Value) {
    write_audit_log(tool_name, "preflight_blocked", "network_blocked", Some(input), None);
}

pub(crate) fn audit_task_spawn_blocked(tool_name: &str, input: &serde_json::Value) {
    write_audit_log(
        tool_name,
        "preflight_blocked",
        "task_spawn_blocked",
        Some(input),
        None,
    );
}

pub(crate) fn audit_command_blocked(tool_name: &str, input: &serde_json::Value, command: &str) {
    write_audit_log(
        tool_name,
        "preflight_blocked",
        "command_blocked",
        Some(input),
        Some(serde_json::json!({ "command": command })),
    );
}

pub(crate) fn audit_path_blocked(tool_name: &str, input: &serde_json::Value, resolved: &PathBuf) {
    write_audit_log(
        tool_name,
        "preflight_blocked",
        "path_blocked",
        Some(input),
        Some(serde_json::json!({ "path": resolved.display().to_string() })),
    );
}

pub(crate) fn write_audit_log(
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

pub(crate) fn required_network_access(name: &str, input: &serde_json::Value) -> Option<NetworkAccess> {
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

pub(crate) fn extract_command(tool_name: &str, input: &serde_json::Value) -> Option<String> {
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

pub(crate) fn path_access_for_tool(tool_name: &str) -> FsAccess {
    match tool_name {
        "fs.write" | "fs.edit" | "git.commit" => FsAccess::Write,
        _ => FsAccess::Read,
    }
}

pub(crate) fn extract_paths(input: &serde_json::Value) -> Vec<PathBuf> {
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
