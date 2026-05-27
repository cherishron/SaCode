use std::path::PathBuf;

use anyhow::Result;
use sacode_runtime::ToolRegistry;

pub fn run(args: Vec<String>) -> Result<()> {
    println!("{}", render_diff(args)?);
    Ok(())
}

pub fn render_diff(args: Vec<String>) -> Result<String> {
    let registry = ToolRegistry::builtin();
    let mut input = serde_json::json!({});
    if args.iter().any(|arg| arg == "cached" || arg == "--cached") {
        input["cached"] = serde_json::Value::Bool(true);
    }

    let output = registry.execute("git.diff", input)?;
    if !output.success {
        return Ok(format!(
            "Diff\n状态: failed\n信息: {}",
            output.message.unwrap_or_else(|| "unknown error".to_string())
        ));
    }

    let data = output.data;
    let files = data
        .get("files")
        .and_then(|value| value.as_array())
        .map(|items| {
            if items.is_empty() {
                "- 无文件变化".to_string()
            } else {
                items.iter()
                    .filter_map(|item| item.as_str())
                    .map(|item| format!("- {}", item))
                    .collect::<Vec<_>>()
                    .join("\n")
            }
        })
        .unwrap_or_else(|| "- 无文件变化".to_string());
    let insertions = data
        .get("stats")
        .and_then(|value| value.get("insertions"))
        .and_then(|value| value.as_u64())
        .unwrap_or(0);
    let deletions = data
        .get("stats")
        .and_then(|value| value.get("deletions"))
        .and_then(|value| value.as_u64())
        .unwrap_or(0);
    let preview = data
        .get("diff")
        .and_then(|value| value.as_str())
        .unwrap_or("");

    Ok(format!(
        "Diff\n模式: {}\n插入: {}\n删除: {}\n文件:\n{}\n\n预览:\n{}",
        if data.get("cached").and_then(|value| value.as_bool()).unwrap_or(false) {
            "cached"
        } else {
            "working tree"
        },
        insertions,
        deletions,
        files,
        if preview.trim().is_empty() { "无差异" } else { preview }
    ))
}
