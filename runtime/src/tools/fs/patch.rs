use std::fs;

use similar::{Algorithm, ChangeTag, TextDiff};

use crate::sandbox::FsAccess;
use crate::tools::{SideEffectLevel, ToolOutput, ToolSpec};

use super::access::resolve_allowed_path;
use super::preflight::preflight_edit_file;

pub fn spec() -> ToolSpec {
    ToolSpec {
        name: "fs.patch".to_string(),
        description: "按上下文批量应用文件补丁：先精确匹配，再按 CRLF/LF 归一化匹配，最后按字符级 Myers 相似度做模糊匹配（≥60% 相似度窗口命中）。new_string 替换匹配窗口的全部内容，调用方需在 new_string 中复述窗口内期望保留的行".to_string(),
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
                "files": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "path": { "type": "string" },
                            "replacements": { "type": "integer" },
                            "diff_summary": {
                                "type": "object",
                                "properties": {
                                    "added": { "type": "integer" },
                                    "removed": { "type": "integer" }
                                }
                            }
                        }
                    }
                },
                "conflicts": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "index": { "type": "integer" },
                            "path": { "type": "string" },
                            "reason": { "type": "string" },
                            "candidates": {
                                "type": "array",
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
                    }
                }
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
            "diff_summary": {
                "added": plan.diff_summary.added,
                "removed": plan.diff_summary.removed,
            },
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
    diff_summary: DiffSummary,
}

/// 行级 diff 摘要（G6：调用方可观测实际变更规模）
#[derive(Clone, Copy, Default)]
struct DiffSummary {
    added: usize,
    removed: usize,
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

    // 预检：大文件保护和二进制检测，避免对不适宜的文件误操作
    if let Err(error) = preflight_edit_file(&absolute_path) {
        return Ok(PatchPlanOutcome::Conflict(conflict(
            index,
            path,
            &error.to_message(),
        )));
    }

    let content = fs::read_to_string(&absolute_path)?;
    let (updated_content, replacements) =
        match apply_exact_patch(&content, old_string, new_string, replace_all) {
            Some(result) => result,
            None => match apply_normalized_patch(&content, old_string, new_string, replace_all) {
                Some(result) => result,
                None => {
                    let candidates = find_candidates(&content, old_string);
                    return Ok(PatchPlanOutcome::Conflict(conflict_with_candidates(
                        index,
                        path,
                        classify_match_failure(&content, old_string),
                        &candidates,
                    )));
                }
            },
        };

    let diff_summary = compute_diff_summary(&content, &updated_content);
    Ok(PatchPlanOutcome::Ready(PatchPlan {
        absolute_path,
        updated_content,
        replacements,
        diff_summary,
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
        apply_fuzzy_patch(
            &normalized_content,
            &normalized_old,
            &normalized_new,
            replace_all,
        )?
    };

    Some((
        restore_newlines(&normalized_updated, style),
        if occurrences > 0 {
            if replace_all {
                occurrences
            } else {
                1
            }
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

/// 模糊匹配的最低相似度阈值（0.6 = 60% 字符级相似度）
const MIN_FUZZY_SIMILARITY: f64 = 0.6;

/// 候选诊断的最低相似度阈值（0.1 = 10%，仅过滤纯噪声）
pub(super) const MIN_CANDIDATE_SIMILARITY: f64 = 0.1;

/// 窗口大小浮动比例（±25%）
const WINDOW_DELTA_RATIO: usize = 4;

/// 模糊匹配命中的窗口位置
struct WindowMatch {
    start: usize,
    end: usize,
    similarity: f64,
}

/// 冲突诊断候选 — pub(super) 暴露给 fs.edit 复用
pub(super) struct Candidate {
    pub line: usize,
    pub similarity: f64,
    pub preview: String,
}

fn apply_fuzzy_patch(
    content: &str,
    old_string: &str,
    new_string: &str,
    replace_all: bool,
) -> Option<String> {
    let content_lines: Vec<&str> = content.split_inclusive('\n').collect();
    let old_lines: Vec<&str> = old_string.split_inclusive('\n').collect();
    if old_lines.is_empty() || content_lines.is_empty() {
        return None;
    }

    if replace_all {
        // G2: fuzzy 路径支持 replace_all — 收集所有非重叠窗口
        let windows = find_all_windows(&content_lines, &old_lines, MIN_FUZZY_SIMILARITY);
        if windows.is_empty() {
            return None;
        }
        // 按行索引升序拼接，避免偏移失效
        let mut result = String::new();
        let mut last_end = 0;
        for window in &windows {
            result.push_str(&content_lines[last_end..window.start].join(""));
            result.push_str(new_string);
            last_end = window.end;
        }
        result.push_str(&content_lines[last_end..].join(""));
        return Some(result);
    }

    // G1: 单窗口，可变窗口大小搜索
    let best = find_best_window(&content_lines, &old_lines, MIN_FUZZY_SIMILARITY)?;
    let mut updated = String::new();
    updated.push_str(&content_lines[..best.start].join(""));
    updated.push_str(new_string);
    updated.push_str(&content_lines[best.end..].join(""));
    Some(updated)
}

/// G1: 可变窗口大小搜索最佳匹配
fn find_best_window(
    content_lines: &[&str],
    old_lines: &[&str],
    min_similarity: f64,
) -> Option<WindowMatch> {
    let delta = window_delta(old_lines.len());
    let min_window = old_lines.len().saturating_sub(delta).max(1);
    let max_window = (old_lines.len() + delta).min(content_lines.len());
    let needle = old_lines.join("");

    let mut best: Option<WindowMatch> = None;

    for window_len in min_window..=max_window {
        if window_len > content_lines.len() {
            continue;
        }
        for start in 0..=content_lines.len() - window_len {
            let end = start + window_len;
            let candidate = content_lines[start..end].join("");
            let similarity = diff_similarity(&needle, &candidate);
            if similarity < min_similarity {
                continue;
            }
            match &best {
                Some(current) if similarity <= current.similarity => {}
                _ => best = Some(WindowMatch { start, end, similarity }),
            }
        }
    }

    best
}

/// G2: 收集所有满足阈值的非重叠窗口（按相似度降序贪心选择）
fn find_all_windows(
    content_lines: &[&str],
    old_lines: &[&str],
    min_similarity: f64,
) -> Vec<WindowMatch> {
    let delta = window_delta(old_lines.len());
    let min_window = old_lines.len().saturating_sub(delta).max(1);
    let max_window = (old_lines.len() + delta).min(content_lines.len());
    let needle = old_lines.join("");

    let mut all: Vec<WindowMatch> = Vec::new();

    for window_len in min_window..=max_window {
        if window_len > content_lines.len() {
            continue;
        }
        for start in 0..=content_lines.len() - window_len {
            let end = start + window_len;
            let candidate = content_lines[start..end].join("");
            let similarity = diff_similarity(&needle, &candidate);
            if similarity >= min_similarity {
                all.push(WindowMatch { start, end, similarity });
            }
        }
    }

    // 按相似度降序，贪心选择非重叠窗口
    all.sort_by(|a, b| {
        b.similarity
            .partial_cmp(&a.similarity)
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    let mut selected: Vec<WindowMatch> = Vec::new();
    for window in all {
        let overlaps = selected
            .iter()
            .any(|s| !(window.end <= s.start || window.start >= s.end));
        if !overlaps {
            selected.push(window);
        }
    }

    // 按行索引升序排序，方便后续拼接
    selected.sort_by_key(|w| w.start);
    selected
}

/// G3: 查找 top-3 候选窗口用于冲突诊断 — pub(super) 暴露给 fs.edit 复用
pub(super) fn find_candidates(content: &str, old_string: &str) -> Vec<Candidate> {
    let content_lines: Vec<&str> = content.split_inclusive('\n').collect();
    let old_lines: Vec<&str> = old_string.split_inclusive('\n').collect();
    if old_lines.is_empty() || content_lines.is_empty() {
        return Vec::new();
    }

    let delta = window_delta(old_lines.len());
    let min_window = old_lines.len().saturating_sub(delta).max(1);
    let max_window = (old_lines.len() + delta).min(content_lines.len());
    let needle = old_lines.join("");

    let mut all: Vec<Candidate> = Vec::new();

    for window_len in min_window..=max_window {
        if window_len > content_lines.len() {
            continue;
        }
        for start in 0..=content_lines.len() - window_len {
            let end = start + window_len;
            let candidate_str = content_lines[start..end].join("");
            let similarity = diff_similarity(&needle, &candidate_str);
            if similarity >= MIN_CANDIDATE_SIMILARITY {
                all.push(Candidate {
                    line: start + 1, // 1-indexed，便于人类阅读
                    similarity,
                    preview: preview_window(&candidate_str),
                });
            }
        }
    }

    // 按相似度降序取 top-3
    all.sort_by(|a, b| {
        b.similarity
            .partial_cmp(&a.similarity)
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    // 去重：相同起始行的候选只保留相似度最高的
    let mut seen_lines = std::collections::HashSet::new();
    all.retain(|c| seen_lines.insert(c.line));
    all.truncate(3);
    all
}

/// G3: 带候选诊断的冲突信息
fn conflict_with_candidates(
    index: usize,
    path: &str,
    reason: &str,
    candidates: &[Candidate],
) -> serde_json::Value {
    serde_json::json!({
        "index": index,
        "path": path,
        "reason": reason,
        "candidates": candidates.iter().map(|c| serde_json::json!({
            "line": c.line,
            "similarity": (c.similarity * 100.0).round() / 100.0,
            "preview": c.preview,
        })).collect::<Vec<_>>(),
    })
}

/// G6: 计算行级 diff 摘要（added/removed 行数）
fn compute_diff_summary(old: &str, new: &str) -> DiffSummary {
    let diff = TextDiff::configure()
        .algorithm(Algorithm::Myers)
        .diff_lines(old, new);

    let mut added = 0;
    let mut removed = 0;
    for change in diff.iter_all_changes() {
        match change.tag() {
            ChangeTag::Insert => added += 1,
            ChangeTag::Delete => removed += 1,
            ChangeTag::Equal => {}
        }
    }
    DiffSummary { added, removed }
}

/// 窗口大小浮动范围（±25%）
fn window_delta(old_lines_len: usize) -> usize {
    (old_lines_len / WINDOW_DELTA_RATIO).max(1)
}

/// 截取窗口内容的前 80 字符作为预览
fn preview_window(content: &str) -> String {
    let trimmed = content.trim_end();
    if trimmed.len() <= 80 {
        return trimmed.to_string();
    }
    // 中间截断，保留首尾。
    // 字节切片需要落在 UTF-8 字符边界上，否则会 panic（中文/emoji 等多字节字符）。
    let head = &trimmed[..floor_char_boundary(trimmed, 40)];
    let tail_start = floor_char_boundary(trimmed, trimmed.len().saturating_sub(30));
    let tail = &trimmed[tail_start..];
    format!("{head}…{tail}")
}

/// 返回不超过 `idx` 的最大 UTF-8 字符边界索引。
///
/// Rust 1.75 缺少稳定的 `str::floor_char_boundary`，本地实现等价语义：
/// 当 `idx` 落在多字节字符中间时向前回退到字符起点。
fn floor_char_boundary(s: &str, mut idx: usize) -> usize {
    if idx >= s.len() {
        return s.len();
    }
    while idx > 0 && !s.is_char_boundary(idx) {
        idx -= 1;
    }
    idx
}

/// G5: 字符级 Myers 相似度（0.0-1.0）
///
/// 相比旧的行级 diff_distance，字符级评分对"替换"操作更准确：
/// 行级把 "beta\n" → "beta updated\n" 算作 delete(5) + insert(13) = 18 距离
/// 字符级只算 insert(" updated") = 8 距离，更符合实际差异感知
fn diff_similarity(old: &str, new: &str) -> f64 {
    let diff = TextDiff::configure()
        .algorithm(Algorithm::Myers)
        .diff_chars(old, new);

    let distance: usize = diff
        .iter_all_changes()
        .map(|change| match change.tag() {
            ChangeTag::Equal => 0,
            ChangeTag::Delete | ChangeTag::Insert => change.value().len(),
        })
        .sum();

    let max_len = old.len().max(new.len());
    if max_len == 0 {
        return 1.0;
    }
    1.0 - (distance as f64 / max_len as f64)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 验证 preview_window 对含中文等多字节字符的内容不 panic（原按字节切片会 panic）
    #[test]
    fn preview_window_multi_byte_no_panic() {
        // 构造长度 > 80 字节、且首尾 40/30 字节边界均落在中文字符中间的内容
        let content = "中文测试内容".repeat(20);
        let preview = preview_window(&content);
        assert!(preview.contains('…'));
    }

    /// 验证 4 字节 emoji 在中间截断也安全
    #[test]
    fn preview_window_emoji_no_panic() {
        let content = "😀emoji测试".repeat(20);
        let preview = preview_window(&content);
        assert!(preview.contains('…'));
    }

    /// floor_char_boundary 在边界本身合法时返回原值
    #[test]
    fn floor_char_boundary_at_boundary() {
        assert_eq!(floor_char_boundary("abc", 1), 1);
        assert_eq!(floor_char_boundary("abc", 3), 3);
    }

    /// floor_char_boundary 在多字节字符中间时回退到字符起点
    #[test]
    fn floor_char_boundary_inside_multibyte() {
        // "中" 是 3 字节，索引 1/2 落在字符中间，应回退到 0
        assert_eq!(floor_char_boundary("中", 1), 0);
        assert_eq!(floor_char_boundary("中", 2), 0);
        assert_eq!(floor_char_boundary("中", 3), 3);
        // "ab中" — 索引 3/4 落在"中"中间，应回退到 2
        assert_eq!(floor_char_boundary("ab中", 3), 2);
        assert_eq!(floor_char_boundary("ab中", 4), 2);
    }
}
