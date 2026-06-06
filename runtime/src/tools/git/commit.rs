use std::process::Command;

use crate::tools::{SideEffectLevel, ToolOutput, ToolSpec};

#[derive(Debug, serde::Deserialize)]
struct GitCommitInput {
    message: String,
    paths: Option<Vec<String>>,
    add_all: Option<bool>,
}

pub fn spec() -> ToolSpec {
    ToolSpec {
        name: "git.commit".to_string(),
        description: "提交当前仓库变更".to_string(),
        input_schema: serde_json::json!({
            "type": "object",
            "properties": {
                "message": { "type": "string", "description": "提交信息" },
                "paths": {
                    "type": "array",
                    "items": { "type": "string" },
                    "description": "可选: 仅提交指定路径"
                },
                "add_all": {
                    "type": "boolean",
                    "description": "可选: 是否执行 git add -A，默认 false"
                }
            },
            "required": ["message"]
        }),
        output_schema: serde_json::json!({
            "type": "object",
            "properties": {
                "success": { "type": "boolean" },
                "commit_hash": { "type": "string" },
                "message": { "type": "string" },
                "summary": { "type": "string" }
            }
        }),
        side_effect_level: SideEffectLevel::Modify,
        approval_required: true,
        timeout_ms: Some(15_000),
        tags: vec!["git".to_string(), "commit".to_string()],
    }
}

pub fn execute(input: serde_json::Value) -> anyhow::Result<ToolOutput> {
    let payload: GitCommitInput = serde_json::from_value(input)?;
    let message = payload.message.trim();
    if message.is_empty() {
        return Ok(ToolOutput::failure("message is required"));
    }

    if payload.add_all.unwrap_or(false) {
        let add_output = Command::new("git").args(["add", "-A"]).output()?;
        if !add_output.status.success() {
            let stderr = String::from_utf8_lossy(&add_output.stderr)
                .trim()
                .to_string();
            return Ok(ToolOutput::failure(if stderr.is_empty() {
                "git add -A failed".to_string()
            } else {
                stderr
            }));
        }
    } else if let Some(paths) = payload.paths.as_ref().filter(|items| !items.is_empty()) {
        let mut cmd = Command::new("git");
        cmd.arg("add").arg("--");
        for path in paths {
            cmd.arg(path);
        }
        let add_output = cmd.output()?;
        if !add_output.status.success() {
            let stderr = String::from_utf8_lossy(&add_output.stderr)
                .trim()
                .to_string();
            return Ok(ToolOutput::failure(if stderr.is_empty() {
                "git add for selected paths failed".to_string()
            } else {
                stderr
            }));
        }
    }

    let status_output = Command::new("git").args(["status", "--short"]).output()?;
    if !status_output.status.success() {
        let stderr = String::from_utf8_lossy(&status_output.stderr)
            .trim()
            .to_string();
        return Ok(ToolOutput::failure(if stderr.is_empty() {
            "git status failed".to_string()
        } else {
            stderr
        }));
    }
    let short_status = String::from_utf8_lossy(&status_output.stdout)
        .trim()
        .to_string();
    if short_status.is_empty() {
        return Ok(ToolOutput::failure("no changes to commit"));
    }

    let staged_output = Command::new("git")
        .args(["diff", "--cached", "--name-only"])
        .output()?;
    if !staged_output.status.success() {
        let stderr = String::from_utf8_lossy(&staged_output.stderr)
            .trim()
            .to_string();
        return Ok(ToolOutput::failure(if stderr.is_empty() {
            "git diff --cached failed".to_string()
        } else {
            stderr
        }));
    }
    let staged_files = String::from_utf8_lossy(&staged_output.stdout)
        .trim()
        .to_string();
    if staged_files.is_empty() {
        return Ok(ToolOutput::failure(
            "no staged changes to commit; provide paths or set add_all=true",
        ));
    }

    let commit_output = Command::new("git")
        .args(["commit", "-m", message])
        .output()?;
    if !commit_output.status.success() {
        let stderr = String::from_utf8_lossy(&commit_output.stderr)
            .trim()
            .to_string();
        return Ok(ToolOutput::failure(if stderr.is_empty() {
            "git commit failed".to_string()
        } else {
            stderr
        }));
    }

    let hash_output = Command::new("git")
        .args(["rev-parse", "--short=8", "HEAD"])
        .output()?;
    if !hash_output.status.success() {
        let stderr = String::from_utf8_lossy(&hash_output.stderr)
            .trim()
            .to_string();
        return Ok(ToolOutput::failure(if stderr.is_empty() {
            "git rev-parse failed".to_string()
        } else {
            stderr
        }));
    }
    let commit_hash = String::from_utf8_lossy(&hash_output.stdout)
        .trim()
        .to_string();

    Ok(ToolOutput::success(serde_json::json!({
        "success": true,
        "commit_hash": commit_hash,
        "message": message,
        "summary": format!("created commit {}: {}", commit_hash, message)
    }))
    .with_message(format!("created commit {}", commit_hash)))
}
