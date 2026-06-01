use std::process::Command;

use crate::sandbox::FsAccess;
use crate::tools::spec::{ToolSpec, ToolOutput, SideEffectLevel};

use super::access::resolve_allowed_path;

const MAX_SEARCH_MATCHES: usize = 50;

pub fn spec() -> ToolSpec {
    ToolSpec {
        name: "fs.search".to_string(),
        description: "搜索文件内容".to_string(),
        input_schema: serde_json::json!({
            "type": "object",
            "properties": {
                "pattern": { "type": "string", "description": "搜索模式" },
                "path": { "type": "string", "description": "搜索路径(可选,默认当前目录)" },
                "file_pattern": { "type": "string", "description": "文件匹配模式(可选)" }
            },
            "required": ["pattern"]
        }),
        output_schema: serde_json::json!({
            "type": "object",
            "properties": {
                "matches": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "file": { "type": "string" },
                            "line": { "type": "integer" },
                            "content": { "type": "string" }
                        }
                    }
                },
                "count": { "type": "integer" }
            }
        }),
        side_effect_level: SideEffectLevel::ReadOnly,
        approval_required: false,
        timeout_ms: Some(10000),
        tags: vec!["fs".to_string(), "search".to_string()],
    }
}

pub fn execute(input: serde_json::Value) -> anyhow::Result<ToolOutput> {
    let pattern = input["pattern"].as_str().unwrap_or("");
    let path = input["path"].as_str().unwrap_or(".");
    let file_pattern = input["file_pattern"].as_str();

    if pattern.is_empty() {
        return Ok(ToolOutput::failure("pattern is required"));
    }

    let resolved_path = resolve_allowed_path(path, FsAccess::Read)?;

    let mut cmd = Command::new("grep");
    cmd.arg("-n");
    cmd.arg("-r");
    cmd.arg("--line-buffered");
    
    if let Some(fp) = file_pattern {
        cmd.arg("--include").arg(fp);
    }

    cmd.arg(pattern);
    cmd.arg(&resolved_path);

    let output = cmd.output();

    match output {
        Ok(result) => {
            if result.status.success() || result.stdout.is_empty() == false {
                let stdout = String::from_utf8_lossy(&result.stdout);
                let all_matches: Vec<serde_json::Value> = stdout
                    .lines()
                    .filter_map(|line| {
                        let parts: Vec<&str> = line.splitn(2, ':').collect();
                        if parts.len() == 2 {
                            let file_and_line: Vec<&str> = parts[0].splitn(2, ':').collect();
                            if file_and_line.len() == 2 {
                                let file = file_and_line[0];
                                let line_num = file_and_line[1].parse::<usize>().ok()?;
                                let content = parts[1];
                                Some(serde_json::json!({
                                    "file": file,
                                    "line": line_num,
                                    "content": content
                                }))
                            } else {
                                Some(serde_json::json!({
                                    "file": parts[0],
                                    "line": 0,
                                    "content": parts[1]
                                }))
                            }
                        } else {
                            None
                        }
                    })
                    .collect();
                let count = all_matches.len();
                let truncated = count > MAX_SEARCH_MATCHES;
                let matches: Vec<serde_json::Value> = all_matches.into_iter().take(MAX_SEARCH_MATCHES).collect();

                Ok(ToolOutput::success(serde_json::json!({
                    "matches": matches,
                    "count": count,
                    "returned": MAX_SEARCH_MATCHES.min(count),
                    "truncated": truncated
                })))
            } else {
                Ok(ToolOutput::success(serde_json::json!({
                    "matches": [],
                    "count": 0
                })).with_message("no matches found"))
            }
        }
        Err(e) => Ok(ToolOutput::failure(format!("grep execution failed: {}", e))),
    }
}
