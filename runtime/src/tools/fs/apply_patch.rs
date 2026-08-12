//! fs.apply_patch — 应用标准 Git patch format（unified diff）到工作区文件
//!
//! 与 `fs.patch` 的区别：
//! - `fs.patch` 接受 `{path, old_string, new_string}` 自定义格式，做模糊匹配
//! - `fs.apply_patch` 接受标准 `diff --git a/... b/...` + `@@ -a,b +c,d @@` hunk 格式
//!
//! 设计意图：让 `git.diff` 工具 `stat_only=false` 输出的 patch 文本可被直接消费，
//! 形成"diff → review → apply"闭环，无需 `shell.exec git apply`。

use std::fs;
use std::path::{Path, PathBuf};

use crate::sandbox::FsAccess;
use crate::tools::spec::{SideEffectLevel, ToolOutput, ToolSpec};
use similar::TextDiff;

use super::access::resolve_allowed_path;
use super::preflight::preflight_edit_file;

pub fn spec() -> ToolSpec {
    ToolSpec {
        name: "fs.apply_patch".to_string(),
        description: "应用标准 Git patch format（unified diff）到工作区文件。支持 git.diff stat_only=false 输出的 patch 文本直接消费，无需 shell.exec git apply".to_string(),
        input_schema: serde_json::json!({
            "type": "object",
            "properties": {
                "patch": {
                    "type": "string",
                    "description": "标准 unified diff 格式的 patch 文本，含 diff --git 头和 @@ hunk 标记"
                },
                "check": {
                    "type": "boolean",
                    "default": false,
                    "description": "干运行模式：只校验 patch 能否应用，不实际写入文件"
                },
                "paths": {
                    "type": "array",
                    "items": { "type": "string" },
                    "description": "限制应用到的文件路径白名单（可选）。未指定时应用 patch 中所有文件"
                }
            },
            "required": ["patch"]
        }),
        output_schema: serde_json::json!({
            "type": "object",
            "properties": {
                "applied": { "type": "integer", "description": "成功应用的文件数" },
                "failed": { "type": "integer", "description": "应用失败的文件数" },
                "details": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "path": { "type": "string" },
                            "hunks": { "type": "integer" },
                            "status": { "type": "string", "enum": ["applied", "skipped", "failed"] },
                            "error": { "type": "string" }
                        }
                    }
                }
            }
        }),
        side_effect_level: SideEffectLevel::Modify,
        approval_required: true,
        timeout_ms: Some(15000),
        tags: vec!["fs".to_string(), "patch".to_string(), "git".to_string()],
    }
}

pub fn execute(input: serde_json::Value) -> anyhow::Result<ToolOutput> {
    let patch_text = input["patch"]
        .as_str()
        .ok_or_else(|| anyhow::anyhow!("patch is required"))?;
    let check = input["check"].as_bool().unwrap_or(false);
    let path_whitelist: Option<Vec<String>> = input["paths"]
        .as_array()
        .map(|arr| arr.iter().filter_map(|v| v.as_str().map(String::from)).collect());

    let file_patches = parse_unified_diff(patch_text)?;
    let mut details = Vec::new();
    let mut applied_count = 0;
    let mut failed_count = 0;

    for file_patch in file_patches {
        // 白名单过滤
        if let Some(ref whitelist) = path_whitelist {
            if !whitelist.iter().any(|p| p == &file_patch.path) {
                details.push(serde_json::json!({
                    "path": file_patch.path,
                    "hunks": file_patch.hunks.len(),
                    "status": "skipped",
                }));
                continue;
            }
        }

        match apply_file_patch(&file_patch, check) {
            Ok(hunk_count) => {
                applied_count += 1;
                details.push(serde_json::json!({
                    "path": file_patch.path,
                    "hunks": hunk_count,
                    "status": if check { "skipped" } else { "applied" },
                }));
            }
            Err(error) => {
                failed_count += 1;
                details.push(serde_json::json!({
                    "path": file_patch.path,
                    "hunks": file_patch.hunks.len(),
                    "status": "failed",
                    "error": error.to_string(),
                }));
            }
        }
    }

    let success = failed_count == 0;
    let message = if check {
        format!(
            "干运行：{} 个文件可应用，{} 个失败",
            applied_count, failed_count
        )
    } else if success {
        format!("成功应用 {} 个文件", applied_count)
    } else {
        format!(
            "应用 {} 个文件，{} 个失败",
            applied_count, failed_count
        )
    };

    let mut output = ToolOutput::success(serde_json::json!({
        "applied": applied_count,
        "failed": failed_count,
        "details": details,
    }));
    output.success = success;
    output.message = Some(message);
    Ok(output)
}

/// 解析单个文件 patch
#[derive(Debug)]
struct FilePatch {
    path: String,
    hunks: Vec<Hunk>,
}

/// 解析单个 hunk
#[derive(Debug)]
struct Hunk {
    old_start: usize,
    old_count: usize,
    new_start: usize,
    new_count: usize,
    lines: Vec<HunkLine>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum HunkLineKind {
    Context,
    Add,
    Remove,
}

#[derive(Debug)]
struct HunkLine {
    kind: HunkLineKind,
    content: String,
}

/// 解析 unified diff 文本为 FilePatch 列表
///
/// 支持格式：
/// ```text
/// diff --git a/foo.rs b/foo.rs
/// index abc..def 100644
/// --- a/foo.rs
/// +++ b/foo.rs
/// @@ -10,5 +10,7 @@
///  context line
/// -removed line
/// +added line
///  context line
/// ```
fn parse_unified_diff(text: &str) -> anyhow::Result<Vec<FilePatch>> {
    let mut patches = Vec::new();
    let mut current_patch: Option<FilePatch> = None;
    let mut current_hunk: Option<Hunk> = None;
    let mut in_hunk_body = false;

    for line in text.lines() {
        // 新文件 patch 开始
        if line.starts_with("diff --git ") {
            // 保存上一个 hunk
            if let Some(hunk) = current_hunk.take() {
                if let Some(patch) = current_patch.as_mut() {
                    patch.hunks.push(hunk);
                }
            }
            // 保存上一个 patch
            if let Some(patch) = current_patch.take() {
                patches.push(patch);
            }
            in_hunk_body = false;
            // 解析路径：diff --git a/foo.rs b/foo.rs
            let path = parse_diff_git_path(line)?;
            current_patch = Some(FilePatch {
                path,
                hunks: Vec::new(),
            });
            continue;
        }

        // --- a/path 行：标识旧文件（不解析路径，以 diff --git 行为准）
        if line.starts_with("--- ") {
            continue;
        }

        // +++ b/path 行：标识新文件（不解析路径）
        if line.starts_with("+++ ") {
            continue;
        }

        // hunk 头：@@ -old_start,old_count +new_start,new_count @@
        if line.starts_with("@@") {
            // 保存上一个 hunk
            if let Some(hunk) = current_hunk.take() {
                if let Some(patch) = current_patch.as_mut() {
                    patch.hunks.push(hunk);
                }
            }
            let hunk = parse_hunk_header(line)?;
            current_hunk = Some(hunk);
            in_hunk_body = true;
            continue;
        }

        // hunk body 行
        if in_hunk_body {
            if let Some(hunk) = current_hunk.as_mut() {
                if line.starts_with('+') {
                    hunk.lines.push(HunkLine {
                        kind: HunkLineKind::Add,
                        content: line[1..].to_string(),
                    });
                } else if line.starts_with('-') {
                    hunk.lines.push(HunkLine {
                        kind: HunkLineKind::Remove,
                        content: line[1..].to_string(),
                    });
                } else if line.starts_with(' ') {
                    hunk.lines.push(HunkLine {
                        kind: HunkLineKind::Context,
                        content: line[1..].to_string(),
                    });
                } else if line == "\\ No newline at end of file" {
                    // 忽略此标记，不影响 hunk 解析
                } else if line.is_empty() {
                    // 空行在 patch 中视为 context（git diff 有时会省略前导空格）
                    hunk.lines.push(HunkLine {
                        kind: HunkLineKind::Context,
                        content: String::new(),
                    });
                }
            }
        }
    }

    // 保存最后一个 hunk
    if let Some(hunk) = current_hunk.take() {
        if let Some(patch) = current_patch.as_mut() {
            patch.hunks.push(hunk);
        }
    }
    // 保存最后一个 patch
    if let Some(patch) = current_patch.take() {
        patches.push(patch);
    }

    if patches.is_empty() {
        return Err(anyhow::anyhow!("patch 文本中未找到有效的 diff --git 块"));
    }

    Ok(patches)
}

/// 解析 `diff --git a/foo.rs b/foo.rs` 行，返回新文件路径
fn parse_diff_git_path(line: &str) -> anyhow::Result<String> {
    // 格式：diff --git a/<path> b/<path>
    // 取 b/ 后的部分作为目标路径
    let parts: Vec<&str> = line.splitn(4, ' ').collect();
    if parts.len() < 4 {
        return Err(anyhow::anyhow!("无效的 diff --git 行: {}", line));
    }
    let new_path_raw = parts[3];
    // 去除 b/ 前缀
    let path = new_path_raw
        .strip_prefix("b/")
        .unwrap_or(new_path_raw);
    Ok(path.to_string())
}

/// 解析 `@@ -old_start,old_count +new_start,new_count @@` hunk 头
fn parse_hunk_header(line: &str) -> anyhow::Result<Hunk> {
    // 格式：@@ -10,5 +10,7 @@ optional context
    let content = line
        .strip_prefix("@@")
        .ok_or_else(|| anyhow::anyhow!("无效的 hunk 头: {}", line))?;
    // 找到 @@ 结束标记
    let end_pos = content
        .find("@@")
        .ok_or_else(|| anyhow::anyhow!("hunk 头缺少结束 @@: {}", line))?;
    let header_body = content[..end_pos].trim();

    // 解析 -old_start,old_count +new_start,new_count
    let (old_part, new_part) = header_body
        .split_once(' ')
        .ok_or_else(|| anyhow::anyhow!("hunk 头格式错误: {}", line))?;

    let old_part = old_part
        .strip_prefix('-')
        .ok_or_else(|| anyhow::anyhow!("hunk 头缺少 - 前缀: {}", line))?;
    let new_part = new_part
        .strip_prefix('+')
        .ok_or_else(|| anyhow::anyhow!("hunk 头缺少 + 前缀: {}", line))?;

    let (old_start, old_count) = parse_range(old_part)?;
    let (new_start, new_count) = parse_range(new_part)?;

    Ok(Hunk {
        old_start,
        old_count,
        new_start,
        new_count,
        lines: Vec::new(),
    })
}

/// 解析 "10,5" 或 "10" 格式的范围，返回 (start, count)
fn parse_range(s: &str) -> anyhow::Result<(usize, usize)> {
    if let Some((start_str, count_str)) = s.split_once(',') {
        let start: usize = start_str
            .parse()
            .map_err(|_| anyhow::anyhow!("无效的 hunk 范围起始: {}", s))?;
        let count: usize = count_str
            .parse()
            .map_err(|_| anyhow::anyhow!("无效的 hunk 范围计数: {}", s))?;
        Ok((start, count))
    } else {
        let start: usize = s
            .parse()
            .map_err(|_| anyhow::anyhow!("无效的 hunk 范围: {}", s))?;
        Ok((start, 1))
    }
}

/// 应用单个文件的 patch
fn apply_file_patch(file_patch: &FilePatch, check: bool) -> anyhow::Result<usize> {
    let resolved_path = resolve_allowed_path(&file_patch.path, FsAccess::Write)?;

    // 预检：大文件保护 + 二进制检测（与 fs.edit / fs.patch 共享逻辑）
    if let Err(error) = preflight_edit_file(&resolved_path) {
        return Err(anyhow::anyhow!(
            "文件 {} 预检失败: {}",
            file_patch.path,
            error
        ));
    }

    let original_bytes = fs::read(&resolved_path)
        .map_err(|e| anyhow::anyhow!("无法读取文件 {}: {}", file_patch.path, e))?;
    let original_content = String::from_utf8(original_bytes)
        .map_err(|e| anyhow::anyhow!("文件 {} 不是有效的 UTF-8: {}", file_patch.path, e))?;

    // 逐个 hunk 应用
    let mut current_content = original_content;
    for hunk in &file_patch.hunks {
        current_content = apply_hunk(&current_content, hunk)?;
    }

    if check {
        // 干运行：不写入，返回 hunk 数
        return Ok(file_patch.hunks.len());
    }

    // 写入文件
    fs::write(&resolved_path, &current_content)
        .map_err(|e| anyhow::anyhow!("写入文件 {} 失败: {}", file_patch.path, e))?;

    Ok(file_patch.hunks.len())
}

/// 应用单个 hunk 到内容
///
/// 策略：
/// 1. 按 hunk 头的 old_start 定位起始行（1-based）
/// 2. 验证 context + remove 行是否匹配实际内容
/// 3. 替换为 add + context 行
fn apply_hunk(content: &str, hunk: &Hunk) -> anyhow::Result<String> {
    let lines: Vec<&str> = content.lines().collect();

    // old_start 是 1-based，转为 0-based 索引
    let start_idx = if hunk.old_start == 0 {
        0
    } else {
        hunk.old_start - 1
    };

    // 收集 hunk 中的 context + remove 行作为预期匹配
    let expected_lines: Vec<&HunkLine> = hunk
        .lines
        .iter()
        .filter(|l| l.kind == HunkLineKind::Context || l.kind == HunkLineKind::Remove)
        .collect();

    // 收集 hunk 中的 context + add 行作为替换内容
    let replacement_lines: Vec<&HunkLine> = hunk
        .lines
        .iter()
        .filter(|l| l.kind == HunkLineKind::Context || l.kind == HunkLineKind::Add)
        .collect();

    // 边界检查
    if start_idx + expected_lines.len() > lines.len() {
        return Err(anyhow::anyhow!(
            "hunk 范围超出文件内容：start={}, expected={}, total={}",
            hunk.old_start,
            expected_lines.len(),
            lines.len()
        ));
    }

    // 验证匹配：context + remove 行必须与实际内容一致
    for (offset, expected_line) in expected_lines.iter().enumerate() {
        let actual = lines[start_idx + offset];
        if actual != expected_line.content {
            return Err(anyhow::anyhow!(
                "hunk 匹配失败：行 {} 预期 {:?} 实际 {:?}",
                start_idx + offset + 1,
                expected_line.content,
                actual
            ));
        }
    }

    // 构建新内容：前半部分 + 替换 + 后半部分
    let mut new_lines: Vec<String> = Vec::with_capacity(lines.len() + replacement_lines.len());
    // 前半部分（hunk 之前）
    new_lines.extend(lines[..start_idx].iter().map(|s| s.to_string()));
    // 替换部分
    new_lines.extend(replacement_lines.iter().map(|l| l.content.clone()));
    // 后半部分（hunk 之后）
    new_lines.extend(lines[start_idx + expected_lines.len()..].iter().map(|s| s.to_string()));

    // 重建字符串，保留末尾换行
    let had_trailing_newline = content.ends_with('\n');
    let mut result = new_lines.join("\n");
    if had_trailing_newline {
        result.push('\n');
    }
    Ok(result)
}

/// 生成 diff 摘要（供输出展示用）
#[allow(dead_code)]
fn compute_diff_summary(old: &str, new: &str) -> (usize, usize) {
    use similar::ChangeTag;
    let diff = TextDiff::from_lines(old, new);
    let mut added = 0;
    let mut removed = 0;
    for change in diff.iter_all_changes() {
        match change.tag() {
            ChangeTag::Insert => added += 1,
            ChangeTag::Delete => removed += 1,
            ChangeTag::Equal => {}
        }
    }
    (added, removed)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_simple_unified_diff() {
        let patch = r#"diff --git a/foo.rs b/foo.rs
index abc..def 100644
--- a/foo.rs
+++ b/foo.rs
@@ -1,3 +1,4 @@
 fn main() {
-    println!("old");
+    println!("new");
+    println!("added");
 }
"#;
        let patches = parse_unified_diff(patch).expect("parse diff");
        assert_eq!(patches.len(), 1);
        assert_eq!(patches[0].path, "foo.rs");
        assert_eq!(patches[0].hunks.len(), 1);
        let hunk = &patches[0].hunks[0];
        assert_eq!(hunk.old_start, 1);
        assert_eq!(hunk.old_count, 3);
        assert_eq!(hunk.new_start, 1);
        assert_eq!(hunk.new_count, 4);
        assert_eq!(hunk.lines.len(), 5); // context + remove + add + add + context
    }

    #[test]
    fn parses_hunk_header_without_count() {
        let hunk = parse_hunk_header("@@ -10 +10 @@").expect("parse header");
        assert_eq!(hunk.old_start, 10);
        assert_eq!(hunk.old_count, 1);
        assert_eq!(hunk.new_start, 10);
        assert_eq!(hunk.new_count, 1);
    }

    #[test]
    fn parses_hunk_header_with_context() {
        let hunk =
            parse_hunk_header("@@ -10,5 +10,7 @@ fn main() {").expect("parse header");
        assert_eq!(hunk.old_start, 10);
        assert_eq!(hunk.old_count, 5);
        assert_eq!(hunk.new_start, 10);
        assert_eq!(hunk.new_count, 7);
    }

    #[test]
    fn parses_diff_git_path() {
        let path = parse_diff_git_path("diff --git a/src/foo.rs b/src/foo.rs").unwrap();
        assert_eq!(path, "src/foo.rs");
    }

    #[test]
    fn rejects_empty_patch() {
        let result = parse_unified_diff("not a patch");
        assert!(result.is_err());
    }

    #[test]
    fn applies_hunk_to_content() {
        let content = "line1\nline2\nline3\nline4\n";
        let hunk = Hunk {
            old_start: 2,
            old_count: 1,
            new_start: 2,
            new_count: 2,
            lines: vec![
                HunkLine { kind: HunkLineKind::Remove, content: "line2".to_string() },
                HunkLine { kind: HunkLineKind::Add, content: "line2a".to_string() },
                HunkLine { kind: HunkLineKind::Add, content: "line2b".to_string() },
            ],
        };
        let result = apply_hunk(content, &hunk).expect("apply hunk");
        assert_eq!(result, "line1\nline2a\nline2b\nline3\nline4\n");
    }

    #[test]
    fn rejects_mismatched_hunk() {
        let content = "line1\nline2\nline3\n";
        let hunk = Hunk {
            old_start: 2,
            old_count: 1,
            new_start: 2,
            new_count: 1,
            lines: vec![
                HunkLine { kind: HunkLineKind::Remove, content: "different".to_string() },
                HunkLine { kind: HunkLineKind::Add, content: "new".to_string() },
            ],
        };
        let result = apply_hunk(content, &hunk);
        assert!(result.is_err());
    }

    #[test]
    fn handles_context_only_hunk() {
        let content = "line1\nline2\nline3\n";
        let hunk = Hunk {
            old_start: 1,
            old_count: 3,
            new_start: 1,
            new_count: 3,
            lines: vec![
                HunkLine { kind: HunkLineKind::Context, content: "line1".to_string() },
                HunkLine { kind: HunkLineKind::Context, content: "line2".to_string() },
                HunkLine { kind: HunkLineKind::Context, content: "line3".to_string() },
            ],
        };
        let result = apply_hunk(content, &hunk).expect("apply hunk");
        assert_eq!(result, "line1\nline2\nline3\n");
    }
}
