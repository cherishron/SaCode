use std::process::Command;

use crate::tools::spec::{ToolSpec, ToolOutput, SideEffectLevel};

pub fn spec() -> ToolSpec {
    ToolSpec {
        name: "git.diff".to_string(),
        description: "获取 git 差异".to_string(),
        input_schema: serde_json::json!({
            "type": "object",
            "properties": {
                "from_ref": { "type": "string", "description": "起始引用(可选)" },
                "to_ref": { "type": "string", "description": "目标引用(可选)" },
                "cached": { "type": "boolean", "description": "暂存区差异(可选)" }
            }
        }),
        output_schema: serde_json::json!({
            "type": "object",
            "properties": {
                "diff": { "type": "string" },
                "files": {
                    "type": "array",
                    "items": { "type": "string" }
                },
                "stats": {
                    "type": "object",
                    "properties": {
                        "insertions": { "type": "integer" },
                        "deletions": { "type": "integer" }
                    }
                }
            }
        }),
        side_effect_level: SideEffectLevel::ReadOnly,
        approval_required: false,
        timeout_ms: Some(10000),
        tags: vec!["git".to_string(), "diff".to_string()],
    }
}

pub fn execute(input: serde_json::Value) -> anyhow::Result<ToolOutput> {
    let from_ref = input["from_ref"].as_str();
    let to_ref = input["to_ref"].as_str();
    let cached = input["cached"].as_bool().unwrap_or(false);

    let mut cmd = Command::new("git");
    cmd.arg("diff");

    if cached {
        cmd.arg("--cached");
    }

    if let (Some(from), Some(to)) = (from_ref, to_ref) {
        cmd.arg(from).arg(to);
    }

    cmd.arg("--stat");

    let output = cmd.output();

    match output {
        Ok(result) => {
            let stdout = String::from_utf8_lossy(&result.stdout);
            let stderr = String::from_utf8_lossy(&result.stderr);

            if result.status.success() || !stdout.is_empty() {
                let diff_output = stdout.to_string();

                let files: Vec<String> = diff_output
                    .lines()
                    .filter(|line| line.contains("|"))
                    .map(|line| {
                        line.split('|').next().unwrap_or("").trim().to_string()
                    })
                    .collect();

                let stats = parse_stats(&diff_output);

                Ok(ToolOutput::success(serde_json::json!({
                    "diff": diff_output,
                    "files": files,
                    "stats": stats,
                    "cached": cached
                })))
            } else if !stderr.is_empty() {
                Ok(ToolOutput::failure(stderr.to_string()))
            } else {
                Ok(ToolOutput::success(serde_json::json!({
                    "diff": "",
                    "files": [],
                    "stats": { "insertions": 0, "deletions": 0 }
                })).with_message("no changes"))
            }
        }
        Err(e) => Ok(ToolOutput::failure(format!("git diff execution failed: {}", e))),
    }
}

fn parse_stats(output: &str) -> serde_json::Value {
    let mut insertions = 0;
    let mut deletions = 0;

    for line in output.lines() {
        if line.ends_with('-') || line.ends_with('+') {
            continue;
        }

        if line.contains("file changed") || line.contains("files changed") {
            if let Some(stats_part) = line.split("changed").nth(1) {
                if stats_part.contains("insertion") {
                    let num = stats_part
                        .split_whitespace()
                        .next()
                        .unwrap_or("0")
                        .parse::<usize>()
                        .unwrap_or(0);
                    insertions += num;
                }
                if stats_part.contains("deletion") {
                    let num = stats_part
                        .split_whitespace()
                        .next()
                        .unwrap_or("0")
                        .parse::<usize>()
                        .unwrap_or(0);
                    deletions += num;
                }
            }
        }
    }

    serde_json::json!({
        "insertions": insertions,
        "deletions": deletions
    })
}
