use std::fs;
use std::path::Path;

use crate::sandbox::FsAccess;
use crate::tools::spec::{SideEffectLevel, ToolOutput, ToolSpec};
use regex::Regex;

use crate::tools::context::current_context;

const MAX_SEARCH_MATCHES: usize = 50;
/// 单文件最大读取字节数，防止读取超大文件导致内存溢出
const MAX_FILE_SIZE_BYTES: u64 = 10 * 1024 * 1024; // 10MB
/// 最大递归深度，防止符号链接导致的无限递归
const MAX_DEPTH: usize = 20;

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

    let resolved_path = current_context().resolve_path(path, FsAccess::Read)?;

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
    // 用 ignore::WalkBuilder 处理目录遍历，自动支持 .gitignore 语义
    // max_depth(Some(MAX_DEPTH)) 防止符号链接无限递归（WalkBuilder 默认会跟随符号链接）
    let mut builder = ignore::WalkBuilder::new(current);
    builder
        .max_depth(Some(MAX_DEPTH))
        .git_ignore(true)
        .git_global(true)
        .git_exclude(true);
    // 额外过滤：跳过常见非源码目录（node_modules/target 等），
    // 这些目录即使没有 .gitignore 也应跳过
    let walker = builder
        .filter_entry(move |entry| {
            if entry.file_type().map(|ft| ft.is_symlink()).unwrap_or(false) {
                return false;
            }
            if entry.file_type().map(|ft| ft.is_dir()).unwrap_or(false) {
                return !should_skip_dir(entry.path());
            }
            true
        })
        .build();

    for entry in walker {
        let entry = match entry {
            Ok(e) => e,
            Err(err) => {
                // 遍历错误（如权限不足）时静默跳过，不影响其他文件搜索
                let _ = err;
                continue;
            }
        };

        let path = entry.path();

        if path.is_symlink() {
            continue; // 跳过符号链接
        }

        if path.is_file() && matches_file_pattern(root, path, file_pattern) {
            collect_file_matches(root, path, matcher, matches)?;
        }
    }

    Ok(())
}

fn should_skip_dir(path: &Path) -> bool {
    let name = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("");

    // 跨平台通用跳过目录
    let common_skip_dirs = [
        ".git",
        ".svn",
        ".hg",
        "node_modules",
        ".DS_Store",
        "__pycache__",
        ".tox",
        ".mypy_cache",
        ".pytest_cache",
        "target",
        ".gradle",
        ".idea",
        ".vscode",
        ".vs",
    ];

    if common_skip_dirs.contains(&name) {
        return true;
    }

    // Windows 特有跳过目录
    #[cfg(target_os = "windows")]
    {
        let windows_skip_dirs = [
            "$RECYCLE.BIN",
            "System Volume Information",
            "Windows",
            "Program Files",
            "Program Files (x86)",
            "ProgramData",
            "System32",
            "Recovery",
            "AppData",
            "Microsoft",
        ];

        if windows_skip_dirs.contains(&name) {
            return true;
        }
    }

    false
}

fn collect_file_matches(
    root: &Path,
    file_path: &Path,
    matcher: &Regex,
    matches: &mut Vec<serde_json::Value>,
) -> anyhow::Result<()> {
    // 跳过超大文件，避免内存溢出
    let metadata = match fs::metadata(file_path) {
        Ok(m) => m,
        Err(_) => return Ok(()),
    };
    if metadata.len() > MAX_FILE_SIZE_BYTES {
        return Ok(());
    }

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
mod gitignore_tests {
    use std::path::Path;

    use regex::Regex;
    use tempfile::tempdir;

    use super::collect_matches;
    use crate::tests::CurrentDirGuard;

    fn write_file(path: &Path, content: &str) {
        std::fs::write(path, content).expect("write test file");
    }

    #[test]
    fn respects_gitignore_patterns() {
        let temp = tempdir().expect("tempdir");
        let _guard = CurrentDirGuard::enter(temp.path());
        // 必须在临时根目录有 .git 目录，WalkBuilder 才会检查 .gitignore
        std::fs::create_dir_all(temp.path().join(".git")).expect("create .git dir");
        std::fs::create_dir_all(temp.path().join("src")).expect("create src dir");
        std::fs::create_dir_all(temp.path().join("ignored_dir")).expect("create ignored dir");
        std::fs::write(temp.path().join(".gitignore"), "ignored_dir/\n*.log\n").unwrap();

        write_file(&temp.path().join("src/main.rs"), "let target = 1;\n");
        write_file(
            &temp.path().join("ignored_dir/secret.rs"),
            "let target = 2;\n",
        );
        write_file(&temp.path().join("debug.log"), "let target = 3;\n");

        let regex = Regex::new("target").expect("regex");
        let mut matches = Vec::new();
        collect_matches(temp.path(), temp.path(), &regex, None, &mut matches)
            .expect("collect matches");

        // 应只匹配 src/main.rs，忽略 ignored_dir/ 和 *.log
        assert_eq!(matches.len(), 1);
        assert_eq!(matches[0]["file"], "src/main.rs");
    }

    #[test]
    fn windows_skip_dirs_still_work() {
        let temp = tempdir().expect("tempdir");
        let _guard = CurrentDirGuard::enter(temp.path());
        // 无 .gitignore，但有 should_skip_dir 的目录
        std::fs::create_dir_all(temp.path().join("node_modules/pkg")).expect("create node_modules");
        std::fs::create_dir_all(temp.path().join("src")).expect("create src dir");

        write_file(
            &temp.path().join("node_modules/pkg/index.js"),
            "let target = 1;\n",
        );
        write_file(&temp.path().join("src/main.rs"), "let target = 2;\n");

        let regex = Regex::new("target").expect("regex");
        let mut matches = Vec::new();
        collect_matches(temp.path(), temp.path(), &regex, None, &mut matches)
            .expect("collect matches");

        // node_modules 被 should_skip_dir 跳过，只剩 src/main.rs
        assert_eq!(matches.len(), 1);
        assert_eq!(matches[0]["file"], "src/main.rs");
    }
}

#[cfg(test)]
mod tests {
    use std::path::Path;

    use regex::Regex;
    use tempfile::tempdir;

    use super::{collect_matches, wildcard_match};
    // 复用 crate 级共享 CWD 锁，避免与其它测试模块的 set_current_dir 并发冲突
    use crate::tests::CurrentDirGuard;

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

    #[test]
    fn skips_common_ignored_directories() {
        let temp = tempdir().expect("tempdir");
        let _guard = CurrentDirGuard::enter(temp.path());

        // 创建正常目录和应跳过的目录
        std::fs::create_dir_all(temp.path().join("src")).expect("create src dir");
        std::fs::create_dir_all(temp.path().join("node_modules/pkg")).expect("create node_modules");
        std::fs::create_dir_all(temp.path().join(".git/objects")).expect("create .git dir");

        write_file(&temp.path().join("src/main.rs"), "let target = 1;\n");
        write_file(
            &temp.path().join("node_modules/pkg/index.js"),
            "let target = 2;\n",
        );
        write_file(&temp.path().join(".git/objects/pack"), "let target = 3;\n");

        let regex = Regex::new("target").expect("regex");
        let mut matches = Vec::new();
        collect_matches(temp.path(), temp.path(), &regex, None, &mut matches)
            .expect("collect matches");

        // 只应匹配 src/main.rs，跳过 node_modules 和 .git
        assert_eq!(matches.len(), 1);
        assert_eq!(matches[0]["file"], "src/main.rs");
    }

    #[test]
    fn skips_oversized_files() {
        let temp = tempdir().expect("tempdir");
        let _guard = CurrentDirGuard::enter(temp.path());

        // 创建一个超大文件（超过 MAX_FILE_SIZE_BYTES）
        let big_content = "x".repeat(11 * 1024 * 1024); // 11MB
        write_file(&temp.path().join("big.txt"), &big_content);
        write_file(&temp.path().join("small.txt"), "findme\n");

        let regex = Regex::new("findme|x").expect("regex");
        let mut matches = Vec::new();
        collect_matches(temp.path(), temp.path(), &regex, None, &mut matches)
            .expect("collect matches");

        // 只应匹配 small.txt，跳过超大文件
        assert_eq!(matches.len(), 1);
        assert_eq!(matches[0]["file"], "small.txt");
    }

    #[test]
    fn respects_max_depth() {
        let temp = tempdir().expect("tempdir");
        let _guard = CurrentDirGuard::enter(temp.path());

        // 创建深度嵌套目录（超过 MAX_DEPTH=20）
        let mut deep_path = temp.path().to_path_buf();
        for i in 0..25 {
            deep_path = deep_path.join(format!("level{}", i));
        }
        std::fs::create_dir_all(&deep_path).expect("create deep dir");
        write_file(&deep_path.join("deep.txt"), "deep_target\n");

        // 浅层文件
        write_file(&temp.path().join("shallow.txt"), "shallow_target\n");

        let regex = Regex::new("target").expect("regex");
        let mut matches = Vec::new();
        collect_matches(temp.path(), temp.path(), &regex, None, &mut matches)
            .expect("collect matches");

        // 应至少匹配到浅层文件
        assert!(matches.iter().any(|m| m["file"] == "shallow.txt"));
    }
}
