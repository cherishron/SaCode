use std::fs;

use similar::{Algorithm, ChangeTag, TextDiff};

use crate::sandbox::FsAccess;
use crate::tools::{SideEffectLevel, ToolOutput, ToolSpec};

use super::access::resolve_allowed_path;

pub fn spec() -> ToolSpec {
    ToolSpec {
        name: "fs.patch".to_string(),
        description: "按严格上下文批量应用文件补丁".to_string(),
        input_schema: serde_json::json!({
            "type": "object",
            "properties": {
                "patches": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "path": { "type": "string", "description": "目标文件路径" },
                            "old_string": { "type": "string", "description": "要匹配的原始内容" },
                            "new_string": { "type": "string", "description": "替换后的内容" },
                            "replace_all": { "type": "boolean", "default": false, "description": "是否替换全部匹配" }
                        },
                        "required": ["path", "old_string", "new_string"]
                    }
                }
            },
            "required": ["patches"]
        }),
        output_schema: serde_json::json!({
            "type": "object",
            "properties": {
                "success": { "type": "boolean" },
                "applied": { "type": "integer" },
                "files": { "type": "array" },
                "conflicts": { "type": "array" }
            }
        }),
        side_effect_level: SideEffectLevel::Modify,
        approval_required: true,
        timeout_ms: Some(10_000),
        tags: vec!["fs".to_string(), "patch".to_string()],
    }
}

pub fn execute(input: serde_json::Value) -> anyhow::Result<ToolOutput> {
    let Some(patches) = input.get("patches").and_then(|value| value.as_array()) else {
        return Ok(ToolOutput::failure("patches array is required"));
    };

    if patches.is_empty() {
        return Ok(ToolOutput::failure("patches array must not be empty"));
    }

    let mut plans = Vec::new();
    let mut conflicts = Vec::new();

    for (index, patch) in patches.iter().enumerate() {
        match build_patch_plan(index, patch)? {
            PatchPlanOutcome::Ready(plan) => plans.push(plan),
            PatchPlanOutcome::Conflict(conflict) => conflicts.push(conflict),
        }
    }

    if !conflicts.is_empty() {
        return Ok(
            ToolOutput::failure("patch application failed due to conflicts").with_message(
                serde_json::to_string(&serde_json::json!({
                    "success": false,
                    "applied": 0,
                    "files": [],
                    "conflicts": conflicts,
                }))
                .unwrap_or_else(|_| "patch application failed due to conflicts".to_string()),
            ),
        );
    }

    for plan in &plans {
        fs::write(&plan.absolute_path, &plan.updated_content)?;
    }

    Ok(ToolOutput::success(serde_json::json!({
        "success": true,
        "applied": plans.iter().map(|plan| plan.replacements).sum::<usize>(),
        "files": plans.iter().map(|plan| serde_json::json!({
            "path": plan.absolute_path.display().to_string(),
            "replacements": plan.replacements,
        })).collect::<Vec<_>>(),
        "conflicts": [],
    }))
    .with_message(format!("applied {} patch item(s)", plans.len())))
}

enum PatchPlanOutcome {
    Ready(PatchPlan),
    Conflict(serde_json::Value),
}

struct PatchPlan {
    absolute_path: std::path::PathBuf,
    updated_content: String,
    replacements: usize,
}

#[derive(Clone, Copy)]
enum NewlineStyle {
    Lf,
    Crlf,
}

fn build_patch_plan(index: usize, patch: &serde_json::Value) -> anyhow::Result<PatchPlanOutcome> {
    let path = patch
        .get("path")
        .and_then(|value| value.as_str())
        .unwrap_or("");
    let old_string = patch
        .get("old_string")
        .and_then(|value| value.as_str())
        .unwrap_or("");
    let new_string = patch
        .get("new_string")
        .and_then(|value| value.as_str())
        .unwrap_or("");
    let replace_all = patch
        .get("replace_all")
        .and_then(|value| value.as_bool())
        .unwrap_or(false);

    if path.is_empty() {
        return Ok(PatchPlanOutcome::Conflict(conflict(
            index,
            path,
            "missing_path",
        )));
    }
    if old_string.is_empty() {
        return Ok(PatchPlanOutcome::Conflict(conflict(
            index,
            path,
            "missing_old_string",
        )));
    }

    let absolute_path = resolve_allowed_path(path, FsAccess::Write)?;
    if !absolute_path.exists() {
        return Ok(PatchPlanOutcome::Conflict(conflict(
            index,
            path,
            "file_not_found",
        )));
    }

    let content = fs::read_to_string(&absolute_path)?;
    let (updated_content, replacements) =
        match apply_exact_patch(&content, old_string, new_string, replace_all) {
            Some(result) => result,
            None => match apply_normalized_patch(&content, old_string, new_string, replace_all) {
                Some(result) => result,
                None => {
                    return Ok(PatchPlanOutcome::Conflict(conflict(
                        index,
                        path,
                        classify_match_failure(&content, old_string),
                    )))
                }
            },
        };

    Ok(PatchPlanOutcome::Ready(PatchPlan {
        absolute_path,
        updated_content,
        replacements,
    }))
}

fn conflict(index: usize, path: &str, reason: &str) -> serde_json::Value {
    serde_json::json!({
        "index": index,
        "path": path,
        "reason": reason,
    })
}

fn apply_exact_patch(
    content: &str,
    old_string: &str,
    new_string: &str,
    replace_all: bool,
) -> Option<(String, usize)> {
    let occurrences = content.matches(old_string).count();
    if occurrences == 0 || (occurrences > 1 && !replace_all) {
        return None;
    }

    let updated_content = if replace_all {
        content.replace(old_string, new_string)
    } else {
        content.replacen(old_string, new_string, 1)
    };
    Some((updated_content, if replace_all { occurrences } else { 1 }))
}

fn apply_normalized_patch(
    content: &str,
    old_string: &str,
    new_string: &str,
    replace_all: bool,
) -> Option<(String, usize)> {
    let style = detect_newline_style(content);
    let normalized_content = normalize_newlines(content);
    let normalized_old = normalize_newlines(old_string);
    let normalized_new = normalize_newlines(new_string);
    let occurrences = normalized_content.matches(&normalized_old).count();
    let normalized_updated = if occurrences > 0 {
        if occurrences > 1 && !replace_all {
            return None;
        }
        if replace_all {
            normalized_content.replace(&normalized_old, &normalized_new)
        } else {
            normalized_content.replacen(&normalized_old, &normalized_new, 1)
        }
    } else {
        apply_fuzzy_patch(&normalized_content, &normalized_old, &normalized_new, replace_all)?
    };

    Some((
        restore_newlines(&normalized_updated, style),
        if occurrences > 0 {
            if replace_all { occurrences } else { 1 }
        } else {
            1
        },
    ))
}

fn classify_match_failure(content: &str, old_string: &str) -> &'static str {
    let exact = content.matches(old_string).count();
    if exact > 1 {
        return "ambiguous_match";
    }

    let normalized_content = normalize_newlines(content);
    let normalized_old = normalize_newlines(old_string);
    let normalized = normalized_content.matches(&normalized_old).count();
    if normalized > 1 {
        "ambiguous_match"
    } else {
        "old_string_not_found"
    }
}

fn normalize_newlines(input: &str) -> String {
    input.replace("\r\n", "\n")
}

fn detect_newline_style(content: &str) -> NewlineStyle {
    if content.contains("\r\n") {
        NewlineStyle::Crlf
    } else {
        NewlineStyle::Lf
    }
}

fn restore_newlines(input: &str, style: NewlineStyle) -> String {
    match style {
        NewlineStyle::Lf => input.to_string(),
        NewlineStyle::Crlf => input.replace('\n', "\r\n"),
    }
}

fn apply_fuzzy_patch(
    content: &str,
    old_string: &str,
    new_string: &str,
    replace_all: bool,
) -> Option<String> {
    if replace_all {
        return None;
    }

    let content_lines: Vec<&str> = content.split_inclusive('\n').collect();
    let old_lines: Vec<&str> = old_string.split_inclusive('\n').collect();
    if old_lines.is_empty() || content_lines.len() < old_lines.len() {
        return None;
    }

    let needle = old_lines.join("");
    let mut best_match: Option<(usize, usize)> = None;

    for start in 0..=content_lines.len().saturating_sub(old_lines.len()) {
        let end = start + old_lines.len();
        let candidate = content_lines[start..end].join("");
        let score = diff_distance(&needle, &candidate);
        let max_len = needle.len().max(candidate.len());
        if max_len == 0 {
            continue;
        }
        if score * 5 > max_len {
            continue;
        }
        match best_match {
            Some((_, best_score)) if score >= best_score => {}
            _ => best_match = Some((start, score)),
        }
    }

    let (start, _) = best_match?;
    let end = start + old_lines.len();
    let mut updated = String::new();
    updated.push_str(&content_lines[..start].join(""));
    updated.push_str(new_string);
    updated.push_str(&content_lines[end..].join(""));
    Some(updated)
}

fn diff_distance(old: &str, new: &str) -> usize {
    let diff = TextDiff::configure()
        .algorithm(Algorithm::Myers)
        .diff_lines(old, new);

    diff.iter_all_changes()
        .map(|change| match change.tag() {
            ChangeTag::Equal => 0,
            ChangeTag::Delete | ChangeTag::Insert => change.value().len(),
        })
        .sum()
}
