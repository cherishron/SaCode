use std::fs;
use std::path::Path;

use crate::sandbox::FsAccess;
use crate::tools::spec::{SideEffectLevel, ToolOutput, ToolSpec};
use regex::Regex;

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

    let matcher =
        Regex::new(pattern).map_err(|error| anyhow::anyhow!("invalid regex pattern: {}", error))?;
    let mut all_matches = Vec::new();

    collect_matches(
        &resolved_path,
        &resolved_path,
        &matcher,
        file_pattern,
        &mut all_matches,
    )?;

    let count = all_matches.len();
    let truncated = count > MAX_SEARCH_MATCHES;
    let matches: Vec<serde_json::Value> =
        all_matches.into_iter().take(MAX_SEARCH_MATCHES).collect();

    if count == 0 {
        Ok(ToolOutput::success(serde_json::json!({
            "matches": [],
            "count": 0
        }))
        .with_message("no matches found"))
    } else {
        Ok(ToolOutput::success(serde_json::json!({
            "matches": matches,
            "count": count,
            "returned": MAX_SEARCH_MATCHES.min(count),
            "truncated": truncated
        })))
    }
}

fn collect_matches(
    root: &Path,
    current: &Path,
    matcher: &Regex,
    file_pattern: Option<&str>,
    matches: &mut Vec<serde_json::Value>,
) -> anyhow::Result<()> {
    if current.is_file() {
        if matches_file_pattern(root, current, file_pattern) {
            collect_file_matches(root, current, matcher, matches)?;
        }
        return Ok(());
    }

    for entry in fs::read_dir(current)? {
        let entry = entry?;
        let path = entry.path();
        if path.is_dir() {
            #[cfg(target_os = "windows")]
            if should_skip_dir(&path) {
                continue;
            }
            collect_matches(root, &path, matcher, file_pattern, matches)?;
        } else if path.is_file() && matches_file_pattern(root, &path, file_pattern) {
            collect_file_matches(root, &path, matcher, matches)?;
        }
    }

    Ok(())
}

#[cfg(target_os = "windows")]
fn should_skip_dir(path: &Path) -> bool {
    let name = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("");
    
    let skip_dirs = [
        "$RECYCLE.BIN",
        "System Volume Information",
        "Windows",
        "Program Files",
        "Program Files (x86)",
        "ProgramData",
        "System32",
        "Recovery",
    ];
    
    skip_dirs.contains(&name)
}

fn collect_file_matches(
    root: &Path,
    file_path: &Path,
    matcher: &Regex,
    matches: &mut Vec<serde_json::Value>,
) -> anyhow::Result<()> {
    let content = match fs::read_to_string(file_path) {
        Ok(content) => content,
        Err(_) => return Ok(()),
    };

    let display_path = relative_display_path(root, file_path);
    for (index, line) in content.lines().enumerate() {
        if matcher.is_match(line) {
            matches.push(serde_json::json!({
                "file": display_path,
                "line": index + 1,
                "content": line,
            }));
        }
    }

    Ok(())
}

fn matches_file_pattern(root: &Path, file_path: &Path, file_pattern: Option<&str>) -> bool {
    let Some(pattern) = file_pattern
        .map(str::trim)
        .filter(|pattern| !pattern.is_empty())
    else {
        return true;
    };

    let relative = relative_display_path(root, file_path);
    wildcard_match(pattern, &relative)
        || wildcard_match(
            pattern,
            file_path
                .file_name()
                .and_then(|name| name.to_str())
                .unwrap_or(""),
        )
}

fn relative_display_path(root: &Path, file_path: &Path) -> String {
    file_path
        .strip_prefix(root)
        .unwrap_or(file_path)
        .to_string_lossy()
        .replace(std::path::MAIN_SEPARATOR, "/")
}

fn wildcard_match(pattern: &str, text: &str) -> bool {
    wildcard_match_bytes(pattern.as_bytes(), text.as_bytes())
}

fn wildcard_match_bytes(pattern: &[u8], text: &[u8]) -> bool {
    let mut pattern_index = 0;
    let mut text_index = 0;
    let mut star_index = None;
    let mut match_index = 0;

    while text_index < text.len() {
        if pattern_index < pattern.len()
            && (pattern[pattern_index] == b'?' || pattern[pattern_index] == text[text_index])
        {
            pattern_index += 1;
            text_index += 1;
        } else if pattern_index < pattern.len() && pattern[pattern_index] == b'*' {
            star_index = Some(pattern_index);
            pattern_index += 1;
            match_index = text_index;
        } else if let Some(star) = star_index {
            pattern_index = star + 1;
            match_index += 1;
            text_index = match_index;
        } else {
            return false;
        }
    }

    while pattern_index < pattern.len() && pattern[pattern_index] == b'*' {
        pattern_index += 1;
    }

    pattern_index == pattern.len()
}

#[cfg(test)]
mod tests {
    use std::path::{Path, PathBuf};

    use regex::Regex;
    use tempfile::tempdir;

    use super::{collect_matches, wildcard_match};

    struct CurrentDirGuard {
        original_dir: PathBuf,
    }

    impl CurrentDirGuard {
        fn enter(path: &Path) -> Self {
            let original_dir = std::env::current_dir().expect("read current dir");
            std::env::set_current_dir(path).expect("enter temp dir");
            Self { original_dir }
        }
    }

    impl Drop for CurrentDirGuard {
        fn drop(&mut self) {
            std::env::set_current_dir(&self.original_dir).expect("restore current dir");
        }
    }

    fn write_file(path: &Path, content: &str) {
        std::fs::write(path, content).expect("write test file");
    }

    #[test]
    fn matches_wildcard_file_patterns() {
        assert!(wildcard_match("*.rs", "lib.rs"));
        assert!(wildcard_match("src/*.rs", "src/lib.rs"));
        assert!(!wildcard_match("*.rs", "lib.ts"));
    }

    #[test]
    fn collects_matches_from_workspace_files() {
        let temp = tempdir().expect("tempdir");
        let _guard = CurrentDirGuard::enter(temp.path());
        std::fs::create_dir_all(temp.path().join("src")).expect("create src dir");
        write_file(
            &temp.path().join("src/lib.rs"),
            "fn main() {}\nlet value = 1;\n",
        );
        write_file(&temp.path().join("src/app.ts"), "const value = 1;\n");

        let regex = Regex::new("value").expect("regex");
        let mut matches = Vec::new();
        collect_matches(temp.path(), temp.path(), &regex, Some("*.rs"), &mut matches)
            .expect("collect matches");

        assert_eq!(matches.len(), 1);
        assert_eq!(matches[0]["file"], "src/lib.rs");
        assert_eq!(matches[0]["line"], 2);
        assert_eq!(matches[0]["content"], "let value = 1;");
    }

    #[test]
    fn returns_relative_paths_for_nested_matches() {
        let temp = tempdir().expect("tempdir");
        let _guard = CurrentDirGuard::enter(temp.path());
        std::fs::create_dir_all(temp.path().join("nested/deeper")).expect("create nested dir");
        write_file(
            &temp.path().join("nested/deeper/file.txt"),
            "prefix:key:value\n",
        );

        let regex = Regex::new("key:value").expect("regex");
        let mut matches = Vec::new();
        collect_matches(temp.path(), temp.path(), &regex, None, &mut matches)
            .expect("collect matches");

        assert_eq!(matches.len(), 1);
        assert_eq!(matches[0]["file"], "nested/deeper/file.txt");
        assert_eq!(matches[0]["content"], "prefix:key:value");
    }
}
