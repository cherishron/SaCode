use std::path::Path;
use std::process::Command;

use anyhow::Result;

use crate::tools::{SideEffectLevel, ToolOutput, ToolSpec};

#[derive(Debug, serde::Deserialize)]
struct TestRunInput {
    framework: Option<String>,
    target: Option<String>,
    filter: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum TestFramework {
    Rust,
    Node,
    Go,
    Pytest,
}

impl TestFramework {
    fn as_str(self) -> &'static str {
        match self {
            Self::Rust => "cargo",
            Self::Node => "npm",
            Self::Go => "go",
            Self::Pytest => "pytest",
        }
    }
}

pub fn spec() -> ToolSpec {
    ToolSpec {
        name: "test.run".to_string(),
        description: "运行项目测试并返回结果摘要".to_string(),
        input_schema: serde_json::json!({
            "type": "object",
            "properties": {
                "framework": { "type": "string", "description": "可选: cargo|npm|go|pytest" },
                "target": { "type": "string", "description": "可选: 测试目标路径或包名" },
                "filter": { "type": "string", "description": "可选: 测试过滤关键字" }
            }
        }),
        output_schema: serde_json::json!({
            "type": "object",
            "properties": {
                "success": { "type": "boolean" },
                "framework": { "type": "string" },
                "command": { "type": "array", "items": { "type": "string" } },
                "summary": { "type": "string" },
                "stdout": { "type": "string" },
                "stderr": { "type": "string" },
                "exit_code": { "type": "integer" }
            }
        }),
        side_effect_level: SideEffectLevel::ReadOnly,
        approval_required: false,
        timeout_ms: Some(120_000),
        tags: vec!["test".to_string(), "verify".to_string()],
    }
}

pub fn execute(input: serde_json::Value) -> Result<ToolOutput> {
    let payload: TestRunInput = serde_json::from_value(input)?;
    let framework = resolve_framework(payload.framework.as_deref())?;
    let command = build_command(framework, payload.target.as_deref(), payload.filter.as_deref());
    let Some((program, args)) = command.split_first() else {
        return Ok(ToolOutput::failure("empty test command"));
    };

    let output = Command::new(program).args(args).output()?;
    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();
    let success = output.status.success();
    let exit_code = output.status.code().unwrap_or(-1);
    let summary = if success {
        format!("{} tests finished successfully", framework.as_str())
    } else {
        format!("{} tests failed with exit code {}", framework.as_str(), exit_code)
    };

    Ok(ToolOutput::success(serde_json::json!({
        "success": success,
        "framework": framework.as_str(),
        "command": command,
        "summary": summary,
        "stdout": truncate_output(&stdout),
        "stderr": truncate_output(&stderr),
        "exit_code": exit_code,
    })))
}

fn resolve_framework(explicit: Option<&str>) -> Result<TestFramework> {
    if let Some(value) = explicit {
        return match value.trim().to_lowercase().as_str() {
            "cargo" | "rust" => Ok(TestFramework::Rust),
            "npm" | "node" | "jest" => Ok(TestFramework::Node),
            "go" => Ok(TestFramework::Go),
            "pytest" | "python" => Ok(TestFramework::Pytest),
            _ => anyhow::bail!("unsupported framework: {}", value),
        };
    }

    let cwd = std::env::current_dir()?;
    detect_framework(&cwd).ok_or_else(|| anyhow::anyhow!("unable to detect test framework"))
}

fn detect_framework(cwd: &Path) -> Option<TestFramework> {
    if cwd.join("Cargo.toml").exists() {
        Some(TestFramework::Rust)
    } else if cwd.join("package.json").exists() {
        Some(TestFramework::Node)
    } else if cwd.join("go.mod").exists() {
        Some(TestFramework::Go)
    } else if cwd.join("pyproject.toml").exists() || cwd.join("pytest.ini").exists() {
        Some(TestFramework::Pytest)
    } else {
        None
    }
}

fn build_command(
    framework: TestFramework,
    target: Option<&str>,
    filter: Option<&str>,
) -> Vec<String> {
    match framework {
        TestFramework::Rust => {
            let mut command = vec!["cargo".to_string(), "test".to_string()];
            if let Some(target) = target.filter(|value| !value.trim().is_empty()) {
                command.push(target.trim().to_string());
            }
            if let Some(filter) = filter.filter(|value| !value.trim().is_empty()) {
                command.push(filter.trim().to_string());
            }
            command
        }
        TestFramework::Node => {
            let mut command = vec!["npm".to_string(), "test".to_string()];
            if let Some(filter) = filter.filter(|value| !value.trim().is_empty()) {
                command.push("--".to_string());
                command.push(filter.trim().to_string());
            }
            command
        }
        TestFramework::Go => {
            let mut command = vec!["go".to_string(), "test".to_string()];
            command.push(
                target
                    .filter(|value| !value.trim().is_empty())
                    .unwrap_or("./...")
                    .trim()
                    .to_string(),
            );
            if let Some(filter) = filter.filter(|value| !value.trim().is_empty()) {
                command.push("-run".to_string());
                command.push(filter.trim().to_string());
            }
            command
        }
        TestFramework::Pytest => {
            let mut command = vec!["pytest".to_string()];
            if let Some(target) = target.filter(|value| !value.trim().is_empty()) {
                command.push(target.trim().to_string());
            }
            if let Some(filter) = filter.filter(|value| !value.trim().is_empty()) {
                command.push("-k".to_string());
                command.push(filter.trim().to_string());
            }
            command
        }
    }
}

fn truncate_output(text: &str) -> String {
    const LIMIT: usize = 8_000;
    let mut output = String::new();
    for ch in text.chars().take(LIMIT) {
        output.push(ch);
    }
    if text.chars().count() > LIMIT {
        output.push_str("\n...(truncated)");
    }
    output
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn build_rust_command_with_target_and_filter() {
        let command = build_command(TestFramework::Rust, Some("-p sacode-cli"), Some("footer"));
        assert_eq!(
            command,
            vec!["cargo", "test", "-p sacode-cli", "footer"]
        );
    }

    #[test]
    fn build_go_command_defaults_to_all_packages() {
        let command = build_command(TestFramework::Go, None, None);
        assert_eq!(command, vec!["go", "test", "./..."]);
    }
}
