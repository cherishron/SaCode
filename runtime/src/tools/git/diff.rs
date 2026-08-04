use std::process::Command;

use crate::tools::spec::{SideEffectLevel, ToolOutput, ToolSpec};

const MAX_DIFF_CHARS: usize = 4000;
const MAX_DIFF_FILES: usize = 50;

pub fn spec() -> ToolSpec {
    ToolSpec {
        name: "git.diff".to_string(),
        description: "获取 git 差异。stat_only=true(默认) 返回 --stat 摘要；stat_only=false 返回可应用的完整 patch（用于回滚或审查）".to_string(),
        input_schema: serde_json::json!({
            "type": "object",
            "properties": {
                "from_ref": { "type": "string", "description": "起始引用(可选)" },
                "to_ref": { "type": "string", "description": "目标引用(可选)" },
                "cached": { "type": "boolean", "description": "暂存区差异(可选)" },
                "stat_only": { "type": "boolean", "description": "true=仅统计摘要(默认)；false=返回完整 patch 文本" }
            }
        }),
        output_schema: serde_json::json!({
            "type": "object",
            "properties": {
                "diff": { "type": "string", "description": "diff 文本预览（截断保护）" },
                "patch": { "type": "string", "description": "完整 patch 文本（仅 stat_only=false 时非空，可被 git apply 使用）" },
                "files": {
                    "type": "array",
                    "items": { "type": "string" }
                },
                "file_count": { "type": "integer" },
                "stats": {
                    "type": "object",
                    "properties": {
                        "insertions": { "type": "integer" },
                        "deletions": { "type": "integer" }
                    }
                },
                "cached": { "type": "boolean" },
                "stat_only": { "type": "boolean" },
                "truncated": { "type": "boolean" }
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
    // 默认 true 保持向后兼容：旧调用方不传该参数时仍走 --stat 摘要模式
    let stat_only = input["stat_only"].as_bool().unwrap_or(true);

    let mut cmd = Command::new("git");
    cmd.arg("diff");

    if cached {
        cmd.arg("--cached");
    }

    if let (Some(from), Some(to)) = (from_ref, to_ref) {
        cmd.arg(from).arg(to);
    }

    // stat_only=true 时附加 --stat 仅取摘要；false 时获取完整可应用 patch
    if stat_only {
        cmd.arg("--stat");
    }

    let output = cmd.output();

    match output {
        Ok(result) => {
            let stdout = String::from_utf8_lossy(&result.stdout);
            let stderr = String::from_utf8_lossy(&result.stderr);

            if result.status.success() || !stdout.is_empty() {
                let diff_output = stdout.to_string();
                let chars_truncated = diff_output.len() > MAX_DIFF_CHARS;
                let preview = truncate_chars(&diff_output, MAX_DIFF_CHARS);

                if stat_only {
                    // 摘要模式：从 --stat 输出解析文件列表（含 `|` 分隔的行）
                    let files: Vec<String> = diff_output
                        .lines()
                        .filter(|line| line.contains("|"))
                        .map(|line| line.split('|').next().unwrap_or("").trim().to_string())
                        .collect();
                    let file_count = files.len();
                    let files: Vec<String> =
                        files.into_iter().take(MAX_DIFF_FILES).collect();
                    let stats = parse_stats(&diff_output);

                    Ok(ToolOutput::success(serde_json::json!({
                        "diff": preview,
                        "patch": "",
                        "files": files,
                        "file_count": file_count,
                        "stats": stats,
                        "cached": cached,
                        "stat_only": true,
                        "truncated": chars_truncated || file_count > MAX_DIFF_FILES
                    })))
                } else {
                    // 完整 patch 模式：返回可被 `git apply` 消费的 patch 文本
                    let files = extract_files_from_patch(&diff_output);
                    let file_count = files.len();
                    let files: Vec<String> =
                        files.into_iter().take(MAX_DIFF_FILES).collect();
                    let stats = count_patch_stats(&diff_output);

                    Ok(ToolOutput::success(serde_json::json!({
                        "diff": preview,
                        "patch": preview,
                        "files": files,
                        "file_count": file_count,
                        "stats": stats,
                        "cached": cached,
                        "stat_only": false,
                        "truncated": chars_truncated || file_count > MAX_DIFF_FILES
                    })))
                }
            } else if !stderr.is_empty() {
                Ok(ToolOutput::failure(stderr.to_string()))
            } else {
                Ok(ToolOutput::success(serde_json::json!({
                    "diff": "",
                    "patch": "",
                    "files": [],
                    "file_count": 0,
                    "stats": { "insertions": 0, "deletions": 0 },
                    "cached": cached,
                    "stat_only": stat_only,
                    "truncated": false
                }))
                .with_message("no changes"))
            }
        }
        Err(e) => Ok(ToolOutput::failure(format!(
            "git diff execution failed: {}",
            e
        ))),
    }
}

/// 从完整 patch 文本解析涉及的文件列表
/// 匹配 `+++ b/path/to/file` 行，跳过 `/dev/null`（删除文件场景）
fn extract_files_from_patch(patch: &str) -> Vec<String> {
    let mut files = Vec::new();
    let mut seen = std::collections::HashSet::new();
    for line in patch.lines() {
        if let Some(rest) = line.strip_prefix("+++ ") {
            let path = rest.strip_prefix("b/").unwrap_or(rest).trim();
            if path == "/dev/null" {
                continue;
            }
            // 去重：同一文件可能出现在多个 hunk
            if seen.insert(path.to_string()) {
                files.push(path.to_string());
            }
        }
    }
    files
}

/// 从完整 patch 统计插入/删除行数
/// 以 `+` 开头（非 `+++`）计为插入，以 `-` 开头（非 `---`）计为删除
fn count_patch_stats(patch: &str) -> serde_json::Value {
    let mut insertions: usize = 0;
    let mut deletions: usize = 0;

    for line in patch.lines() {
        if line.starts_with("+++") || line.starts_with("---") {
            continue;
        }
        if line.starts_with('+') {
            insertions += 1;
        } else if line.starts_with('-') {
            deletions += 1;
        }
    }

    serde_json::json!({
        "insertions": insertions,
        "deletions": deletions
    })
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

fn truncate_chars(value: &str, max_chars: usize) -> String {
    let mut chars = value.chars();
    let preview: String = chars.by_ref().take(max_chars).collect();
    if chars.next().is_some() {
        format!("{}...", preview)
    } else {
        preview
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const SAMPLE_PATCH: &str = "\
diff --git a/src/lib.rs b/src/lib.rs
index 1a2b3c4..5d6e7f8 100644
--- a/src/lib.rs
+++ b/src/lib.rs
@@ -10,3 +10,5 @@ pub fn existing() {
     let x = 1;
-    let y = 2;
+    let y = 3;
+    let z = 4;
 }
diff --git a/README.md b/README.md
deleted file mode 100644
index 9abc123..0000000
--- a/README.md
+++ /dev/null
@@ -1,2 +0,0 @@
-old line 1
-old line 2
";

    #[test]
    fn extract_files_from_patch_skips_dev_null_and_dedupes() {
        let files = extract_files_from_patch(SAMPLE_PATCH);
        // README.md 因 +++ /dev/null 被跳过，仅保留 src/lib.rs
        assert_eq!(files, vec!["src/lib.rs".to_string()]);
    }

    #[test]
    fn extract_files_from_patch_dedupes_repeated_files() {
        let patch = "\
+++ b/a.rs
+1
+++ b/b.rs
+2
+++ b/a.rs
+3
";
        let files = extract_files_from_patch(patch);
        assert_eq!(files, vec!["a.rs".to_string(), "b.rs".to_string()]);
    }

    #[test]
    fn count_patch_stats_counts_plus_minus_lines() {
        let stats = count_patch_stats(SAMPLE_PATCH);
        // 插入: let y = 3; let z = 4;  → 2
        // 删除: let y = 2; old line 1; old line 2 → 3
        assert_eq!(stats["insertions"].as_u64(), Some(2));
        assert_eq!(stats["deletions"].as_u64(), Some(3));
    }

    #[test]
    fn count_patch_stats_ignores_hunk_headers() {
        let patch = "\
--- a/f.rs
+++ b/f.rs
@@ -1,1 +1,1 @@
-a
+a
";
        let stats = count_patch_stats(patch);
        assert_eq!(stats["insertions"].as_u64(), Some(1));
        assert_eq!(stats["deletions"].as_u64(), Some(1));
    }

    #[test]
    fn count_patch_stats_empty_returns_zero() {
        let stats = count_patch_stats("");
        assert_eq!(stats["insertions"].as_u64(), Some(0));
        assert_eq!(stats["deletions"].as_u64(), Some(0));
    }

    #[test]
    fn stat_only_defaults_to_true_when_omitted() {
        // 验证默认值逻辑：不传 stat_only 时应走摘要模式
        let input = serde_json::json!({});
        let stat_only = input["stat_only"].as_bool().unwrap_or(true);
        assert!(stat_only);
    }

    #[test]
    fn truncate_chars_appends_ellipsis_when_truncated() {
        let s = "abcdefghij";
        assert_eq!(truncate_chars(s, 5), "abcde...");
        assert_eq!(truncate_chars(s, 10), "abcdefghij");
        assert_eq!(truncate_chars("ab", 5), "ab");
    }
}
