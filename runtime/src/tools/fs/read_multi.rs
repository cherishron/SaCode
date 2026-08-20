use crate::sandbox::FsAccess;
use crate::tools::context::current_context;
use crate::tools::{SideEffectLevel, ToolOutput, ToolSpec};



fn build_file_summary(path: &str, lines: usize, total_lines: usize) -> String {
    format!(
        "read {} lines from {} ({} lines total)",
        lines, path, total_lines
    )
}

fn build_batch_summary(success_count: usize, failed_count: usize, total_files: usize) -> String {
    format!(
        "read {} of {} files successfully ({} failed)",
        success_count, total_files, failed_count
    )
}

pub fn spec() -> ToolSpec {
    ToolSpec {
        name: "fs.read_multi".to_string(),
        description: "批量读取多个文件".to_string(),
        input_schema: serde_json::json!({
            "type": "object",
            "properties": {
                "paths": { "type": "array", "items": { "type": "string" }, "description": "文件路径列表" },
                "limit_per_file": { "type": "integer", "default": 200, "description": "每个文件的最大读取行数" }
            },
            "required": ["paths"]
        }),
        output_schema: serde_json::json!({
            "type": "object",
            "properties": {
                "summary": { "type": "string" },
                "files": { "type": "array" },
                "total_files": { "type": "integer" },
                "success_count": { "type": "integer" },
                "failed_count": { "type": "integer" }
            }
        }),
        side_effect_level: SideEffectLevel::ReadOnly,
        approval_required: false,
        timeout_ms: Some(15_000),
        tags: vec!["fs".to_string(), "read".to_string(), "batch".to_string()],
    }
}

pub fn execute(input: serde_json::Value) -> anyhow::Result<ToolOutput> {
    let Some(paths) = input["paths"].as_array() else {
        return Ok(ToolOutput::failure("paths is required"));
    };
    let limit_per_file = input["limit_per_file"].as_u64().unwrap_or(200) as usize;

    let mut files = Vec::new();
    let mut success_count = 0;
    let mut failed_count = 0;

    for path_value in paths {
        let path = path_value.as_str().unwrap_or("");
        if path.is_empty() {
            failed_count += 1;
            files.push(serde_json::json!({
                "path": path,
                "error": "empty path"
            }));
            continue;
        }

        match read_one(path, limit_per_file) {
            Ok(file) => {
                success_count += 1;
                files.push(file);
            }
            Err(error) => {
                failed_count += 1;
                files.push(serde_json::json!({
                    "path": path,
                    "error": error.to_string()
                }));
            }
        }
    }

    Ok(ToolOutput::success(serde_json::json!({
        "summary": build_batch_summary(success_count, failed_count, paths.len()),
        "files": files,
        "total_files": paths.len(),
        "success_count": success_count,
        "failed_count": failed_count
    })))
}

fn read_one(path: &str, limit_per_file: usize) -> anyhow::Result<serde_json::Value> {
    let file_path = current_context().resolve_path(path, FsAccess::Read)?;
    let ctx = current_context();
    if !ctx.exists(&file_path) {
        anyhow::bail!("file not found: {}", path);
    }
    let content = ctx.read_text(&file_path)?;
    let all_lines: Vec<&str> = content.lines().collect();
    let selected = all_lines
        .iter()
        .take(limit_per_file)
        .copied()
        .collect::<Vec<_>>()
        .join("\n");
    Ok(serde_json::json!({
        "path": file_path.display().to_string(),
        "summary": build_file_summary(&file_path.display().to_string(), all_lines.len().min(limit_per_file), all_lines.len()),
        "content": selected,
        "lines": all_lines.len().min(limit_per_file),
        "total_lines": all_lines.len()
    }))
}
