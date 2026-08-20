use crate::sandbox::FsAccess;
use crate::tools::{SideEffectLevel, ToolOutput, ToolSpec};

use crate::tools::context::current_context;
use super::patch::find_candidates;
use super::preflight::preflight_edit_file;

pub fn spec() -> ToolSpec {
    ToolSpec {
        name: "fs.edit".to_string(),
        description: "精确编辑文件内容（字符串替换）。匹配失败时返回 top-3 候选诊断（含行号/相似度/预览），与 fs.patch 容错策略对齐".to_string(),
        input_schema: serde_json::json!({
            "type": "object",
            "properties": {
                "path": { "type": "string", "description": "文件路径" },
                "old_string": { "type": "string", "description": "要替换的原始字符串" },
                "new_string": { "type": "string", "description": "替换后的新字符串" },
                "replace_all": { "type": "boolean", "default": false, "description": "是否替换所有匹配" }
            },
            "required": ["path", "old_string", "new_string"]
        }),
        output_schema: serde_json::json!({
            "type": "object",
            "properties": {
                "success": { "type": "boolean" },
                "replacements": { "type": "integer" },
                "path": { "type": "string" },
                "candidates": {
                    "type": "array",
                    "description": "匹配失败时的 top-3 候选诊断（成功时为空数组）",
                    "items": {
                        "type": "object",
                        "properties": {
                            "line": { "type": "integer" },
                            "similarity": { "type": "number" },
                            "preview": { "type": "string" }
                        }
                    }
                }
            }
        }),
        side_effect_level: SideEffectLevel::Modify,
        approval_required: true,
        timeout_ms: Some(5_000),
        tags: vec!["fs".to_string(), "edit".to_string()],
    }
}

pub fn execute(input: serde_json::Value) -> anyhow::Result<ToolOutput> {
    let path = input["path"].as_str().unwrap_or("");
    let old_string = input["old_string"].as_str().unwrap_or("");
    let new_string = input["new_string"].as_str().unwrap_or("");
    let replace_all = input["replace_all"].as_bool().unwrap_or(false);

    if path.is_empty() {
        return Ok(ToolOutput::failure("path is required"));
    }
    if old_string.is_empty() {
        return Ok(ToolOutput::failure("old_string is required"));
    }

    let file_path = current_context().resolve_path(path, FsAccess::Write)?;
    let ctx = crate::tools::context::current_context();
    if !ctx.exists(&file_path) {
        return Ok(ToolOutput::failure(format!("file not found: {}", path)));
    }

    // 预检：大文件保护和二进制检测，避免对不适宜的文件误操作
    if let Err(error) = preflight_edit_file(&file_path) {
        return Ok(ToolOutput::failure(error.to_message()));
    }

    let content = ctx.read_text(&file_path)?;
    let occurrences = content.matches(old_string).count();
    if occurrences == 0 {
        // 对齐 fs.patch 容错策略：返回 top-3 候选诊断辅助定位
        let candidates = find_candidates(&content, old_string);
        let candidate_msg = format_candidates_message(&candidates);
        return Ok(ToolOutput::failure(format!(
            "old_string not found in file{}",
            candidate_msg
        )));
    }
    if occurrences > 1 && !replace_all {
        return Ok(ToolOutput::failure(format!(
            "old_string matched {} times, set replace_all=true or provide more context",
            occurrences
        )));
    }

    let updated = if replace_all {
        content.replace(old_string, new_string)
    } else {
        content.replacen(old_string, new_string, 1)
    };

    ctx.write_text(&file_path, &updated)?;

    Ok(ToolOutput::success(serde_json::json!({
        "success": true,
        "replacements": if replace_all { occurrences } else { 1 },
        "path": file_path.display().to_string(),
        "candidates": [],
    }))
    .with_message(format!("edited {}", file_path.display())))
}

/// 格式化候选诊断为可读字符串，附加到 failure message
fn format_candidates_message(candidates: &[super::patch::Candidate]) -> String {
    if candidates.is_empty() {
        return String::new();
    }
    let mut msg = String::from("\nCandidates (top-3 by similarity):\n");
    for c in candidates {
        msg.push_str(&format!(
            "  line {} (similarity {:.0}%): {}\n",
            c.line,
            c.similarity * 100.0,
            c.preview.replace('\n', "\\n")
        ));
    }
    msg
}
