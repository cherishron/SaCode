use std::path::Path;
use std::process::{Command, Stdio};
use std::time::Duration;

use anyhow::Result;
use wait_timeout::ChildExt;

use super::FailedTest;
use crate::tools::{SideEffectLevel, ToolOutput, ToolSpec};

#[derive(Debug, serde::Deserialize)]
struct TestRunInput {
    framework: Option<String>,
    target: Option<String>,
    filter: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum TestFramework {
    Rust,
    Node,
    Go,
    Pytest,
}

impl TestFramework {
    fn as_str(self) -> &'static str {
        match self {
            Self::Rust => "cargo",
            Self::Node => "npm",
            Self::Go => "go",
            Self::Pytest => "pytest",
        }
    }
}

pub fn spec() -> ToolSpec {
    ToolSpec {
        name: "test.run".to_string(),
        description: "运行项目测试并返回结果摘要，含结构化失败信息".to_string(),
        input_schema: serde_json::json!({
            "type": "object",
            "properties": {
                "framework": { "type": "string", "description": "可选: cargo|npm|go|pytest" },
                "target": { "type": "string", "description": "可选: 测试目标路径或包名" },
                "filter": { "type": "string", "description": "可选: 测试过滤关键字" }
            }
        }),
        output_schema: serde_json::json!({
            "type": "object",
            "properties": {
                "success": { "type": "boolean" },
                "framework": { "type": "string" },
                "command": { "type": "array", "items": { "type": "string" } },
                "summary": { "type": "string" },
                "total": { "type": "integer" },
                "passed": { "type": "integer" },
                "failed": { "type": "integer" },
                "failed_tests": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "name": { "type": "string" },
                            "module": { "type": "string" },
                            "error_message": { "type": "string" },
                            "location": { "type": "string" }
                        }
                    }
                },
                "stdout": { "type": "string" },
                "stderr": { "type": "string" },
                "exit_code": { "type": "integer" }
            }
        }),
        side_effect_level: SideEffectLevel::ReadOnly,
        approval_required: false,
        timeout_ms: Some(120_000),
        tags: vec!["test".to_string(), "verify".to_string()],
    }
}

pub fn execute(input: serde_json::Value) -> Result<ToolOutput> {
    let payload: TestRunInput = serde_json::from_value(input)?;
    let framework = resolve_framework(payload.framework.as_deref())?;
    let command = build_command(
        framework,
        payload.target.as_deref(),
        payload.filter.as_deref(),
    );
    let Some((program, args)) = command.split_first() else {
        return Ok(ToolOutput::failure("empty test command"));
    };

    let timeout_ms = 120_000;
    let mut child = Command::new(program)
        .args(args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()?;
    let output = match child.wait_timeout(Duration::from_millis(timeout_ms))? {
        Some(status) => {
            let stdout = child.wait_with_output()?;
            std::process::Output {
                status,
                stdout: stdout.stdout,
                stderr: stdout.stderr,
            }
        }
        None => {
            // 超时：杀掉子进程并返回超时错误
            let _ = child.kill();
            let _ = child.wait();
            return Ok(ToolOutput::failure(format!(
                "test command timed out after {}ms: {}",
                timeout_ms,
                command.join(" ")
            )));
        }
    };
    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();
    let success = output.status.success();
    let exit_code = output.status.code().unwrap_or(-1);

    // 解析结构化测试结果
    let combined_output = format!("{stdout}\n{stderr}");
    let (total, passed, failed_count, failed_tests) =
        parse_test_results(framework, &combined_output);

    let summary = if success {
        format!("{} tests passed ({} total)", framework.as_str(), total)
    } else {
        format!(
            "{} tests failed: {} passed, {} failed out of {} total",
            framework.as_str(),
            passed,
            failed_count,
            total
        )
    };

    Ok(ToolOutput::success(serde_json::json!({
        "success": success,
        "framework": framework.as_str(),
        "command": command,
        "summary": summary,
        "total": total,
        "passed": passed,
        "failed": failed_count,
        "failed_tests": failed_tests,
        "stdout": truncate_output(&stdout),
        "stderr": truncate_output(&stderr),
        "exit_code": exit_code,
    })))
}

/// 解析各框架的测试输出，提取结构化失败信息
fn parse_test_results(
    framework: TestFramework,
    output: &str,
) -> (usize, usize, usize, Vec<FailedTest>) {
    match framework {
        TestFramework::Rust => parse_rust_results(output),
        TestFramework::Go => parse_go_results(output),
        TestFramework::Pytest => parse_pytest_results(output),
        TestFramework::Node => parse_node_results(output),
    }
}

/// 解析 cargo test 输出
/// 格式示例：
///   test foo::bar::test_something ... FAILED
///   test foo::bar::test_another ... ok
///   test result: FAILED. 3 passed; 2 failed; 0 ignored; ...
fn parse_rust_results(output: &str) -> (usize, usize, usize, Vec<FailedTest>) {
    let mut failed_names: Vec<(String, String)> = Vec::new(); // (module, name)
    let mut passed: usize = 0;
    let mut failed_count: usize = 0;

    for line in output.lines() {
        let trimmed = line.trim();

        // 匹配 "test module::name ... FAILED" 或 "test name ... FAILED"
        // cargo test 行格式固定为 `test <full_name> ... <result>`，
        // 去掉 `test ` 前缀与 ` FAILED` 后缀后，需再剥离 ` ...` 才能得到纯名称
        if trimmed.starts_with("test ") && trimmed.ends_with(" FAILED") {
            let name_part = trimmed
                .strip_prefix("test ")
                .and_then(|s| s.strip_suffix(" FAILED"))
                .unwrap_or("")
                .trim()
                .trim_end_matches(" ...")
                .trim();
            let (module, name) = split_rust_test_name(name_part);
            failed_names.push((module, name));
        }

        // 匹配汇总行 "test result: FAILED. 3 passed; 2 failed; 0 ignored; ..."
        if trimmed.starts_with("test result:") {
            if let Some(value) = extract_number(trimmed, "passed") {
                passed += value;
            }
            if let Some(value) = extract_number(trimmed, "failed") {
                failed_count += value;
            }
            // 也提取 ignored/Measured 等，但只关注核心指标
        }
    }

    let total = passed + failed_count;

    // 为每个失败测试提取错误消息
    let failed_tests = build_rust_failed_tests(output, &failed_names);

    (total, passed, failed_count, failed_tests)
}

/// 拆分 Rust 测试名为模块和函数名
fn split_rust_test_name(full_name: &str) -> (String, String) {
    if let Some(pos) = full_name.rfind("::") {
        (
            full_name[..pos].to_string(),
            full_name[pos + 2..].to_string(),
        )
    } else {
        (String::new(), full_name.to_string())
    }
}

/// 从 cargo test 输出中提取失败测试的错误消息
fn build_rust_failed_tests(
    output: &str,
    failed_names: &[(String, String)],
) -> Vec<FailedTest> {
    if failed_names.is_empty() {
        return Vec::new();
    }

    let mut results = Vec::new();
    let lines: Vec<&str> = output.lines().collect();

    for (module, name) in failed_names {
        let full_name = if module.is_empty() {
            name.clone()
        } else {
            format!("{}::{}", module, name)
        };

        // 在输出中查找 "failures:" 段落后的错误详情和源码位置
        let error_message = extract_rust_failure_detail(&lines, &full_name);
        let location = extract_rust_failure_location(&lines, &full_name);

        results.push(FailedTest {
            name: name.clone(),
            module: module.clone(),
            error_message,
            location,
        });
    }

    results
}

/// 从 cargo test 的 "failures:" 段落提取具体失败信息
fn extract_rust_failure_detail(lines: &[&str], test_name: &str) -> String {
    // 查找 "failures:" 标记行
    let failures_start = lines.iter().position(|line| line.trim() == "failures:");
    let Some(start) = failures_start else {
        return String::new();
    };

    // 在 failures 段落中查找以 "---- test_name ----" 开头的块
    let header = format!("---- {} ----", test_name);
    for i in start..lines.len() {
        if lines[i].trim() == header {
            // 收集后续行直到下一个 "----" 或空行分隔
            let mut detail_lines = Vec::new();
            for j in (i + 1)..lines.len() {
                let line = lines[j].trim();
                if line.starts_with("----") || line.is_empty() && detail_lines.len() > 3 {
                    break;
                }
                if !line.is_empty() {
                    detail_lines.push(line.to_string());
                }
            }
            // 限制错误消息长度
            let detail = detail_lines.join("\n");
            return truncate_string(&detail, 500);
        }
    }

    String::new()
}

/// 从 cargo test 的 "failures:" 段落提取失败测试的源码位置
///
/// cargo test 输出格式（panic 信息中含位置）：
/// ```text
/// ---- test_name ----
/// test_name
/// panicked at 'message', src/foo.rs:42:5
/// ```
///
/// 也兼容 backtrace 格式：
/// ```text
///    0: std::panicking::begin_panic
///   at /rustc/.../std::panicking.rs:578:5
///   1: test_name
///   at src/foo.rs:42:5
/// ```
fn extract_rust_failure_location(lines: &[&str], test_name: &str) -> String {
    let failures_start = lines.iter().position(|line| line.trim() == "failures:");
    let Some(start) = failures_start else {
        return String::new();
    };

    let header = format!("---- {} ----", test_name);
    for i in start..lines.len() {
        if lines[i].trim() == header {
            // 在失败块中查找 `src/...:line:col` 格式的位置
            for j in (i + 1)..lines.len() {
                let line = lines[j].trim();
                if line.starts_with("----") {
                    break;
                }
                // 匹配 "panicked at '...', src/path:line:col" 或 "at src/path:line:col"
                if let Some(loc) = extract_rust_location_from_line(line) {
                    return loc;
                }
            }
            break;
        }
    }

    String::new()
}

/// 从单行中提取 Rust 源码位置（src/path:line 或 src/path:line:col）
///
/// 匹配规则：
/// - 路径以 `.rs` 结尾
/// - 路径后跟 `:line` 或 `:line:col`
/// - 路径前通常有 `at ` 或 `, ` 前缀
fn extract_rust_location_from_line(line: &str) -> Option<String> {
    // 查找所有 `.rs` 出现位置，尝试从每个位置向前找路径起点，向后找行号
    let bytes = line.as_bytes();
    let mut search_start = 0;
    while let Some(rs_pos) = line[search_start..].find(".rs") {
        let abs_rs_pos = search_start + rs_pos;
        // 向前查找路径起点（路径字符：字母/数字/`_`/`-`/`.`/`/`/`\`）
        let mut path_start = abs_rs_pos;
        while path_start > 0 {
            let prev = bytes[path_start - 1];
            if prev.is_ascii_alphanumeric()
                || prev == b'_'
                || prev == b'-'
                || prev == b'.'
                || prev == b'/'
                || prev == b'\\'
            {
                path_start -= 1;
            } else {
                break;
            }
        }
        let path_end = abs_rs_pos + 3; // 跳过 ".rs"

        // 向后查找 `:line` 或 `:line:col`
        let rest = &line[path_end..];
        if rest.starts_with(':') {
            // 提取 :line:col 部分
            let mut end = 1;
            while end < rest.len()
                && (rest.as_bytes()[end].is_ascii_digit() || rest.as_bytes()[end] == b':')
            {
                end += 1;
            }
            if end > 1 {
                let location = format!("{}{}", &line[path_start..path_end], &rest[..end]);
                return Some(location);
            }
        }

        search_start = abs_rs_pos + 3;
    }
    None
}

/// 解析 go test 输出
/// 格式示例：
///   --- FAIL: TestSomething (0.00s)
///       test_file_test.go:12: error message
///   FAIL
///   FAIL    package/path    0.123s
fn parse_go_results(output: &str) -> (usize, usize, usize, Vec<FailedTest>) {
    let mut failed_tests = Vec::new();
    let mut passed: usize = 0;
    let mut failed_count: usize = 0;

    for line in output.lines() {
        let trimmed = line.trim();

        // 匹配 "--- FAIL: TestName"
        if let Some(rest) = trimmed.strip_prefix("--- FAIL: ") {
            let name = rest.split_whitespace().next().unwrap_or("").to_string();
            // 尝试提取位置信息
            let location = extract_go_location(output, &name);
            let error_message = extract_go_error_message(output, &name);
            failed_tests.push(FailedTest {
                name,
                module: String::new(),
                error_message,
                location,
            });
            failed_count += 1;
        }

        // 匹配 "--- PASS: TestName"
        if trimmed.starts_with("--- PASS: ") {
            passed += 1;
        }
    }

    let total = passed + failed_count;
    (total, passed, failed_count, failed_tests)
}

/// 从 go test 输出提取失败测试的位置信息
fn extract_go_location(output: &str, test_name: &str) -> String {
    let header = format!("--- FAIL: {}", test_name);
    let mut found_header = false;
    for line in output.lines() {
        if line.trim().starts_with(&header) {
            found_header = true;
            continue;
        }
        if found_header {
            let trimmed = line.trim();
            // 匹配 "    file_test.go:12: error message"
            if let Some(colon_pos) = trimmed.find(".go:") {
                let location_end = trimmed[colon_pos..]
                    .find(':')
                    .map(|pos| colon_pos + pos)
                    .unwrap_or(trimmed.len().min(colon_pos + 20));
                return trimmed[..location_end].trim().to_string();
            }
            // 遇到下一个测试标记则停止
            if trimmed.starts_with("--- ") {
                break;
            }
        }
    }
    String::new()
}

/// 从 go test 输出提取失败测试的错误消息
fn extract_go_error_message(output: &str, test_name: &str) -> String {
    let header = format!("--- FAIL: {}", test_name);
    let mut found_header = false;
    let mut messages = Vec::new();

    for line in output.lines() {
        if line.trim().starts_with(&header) {
            found_header = true;
            continue;
        }
        if found_header {
            let trimmed = line.trim();
            if trimmed.starts_with("--- ") || trimmed == "FAIL" {
                break;
            }
            if !trimmed.is_empty() {
                // 去掉 "file.go:line: " 前缀，只保留错误消息
                if let Some(colon_pos) = trimmed.find(".go:") {
                    if let Some(msg_start) = trimmed[colon_pos..].find(": ") {
                        let msg = trimmed[colon_pos + msg_start + 2..].trim();
                        if !msg.is_empty() {
                            messages.push(msg.to_string());
                        }
                    }
                } else {
                    messages.push(trimmed.to_string());
                }
            }
        }
    }

    truncate_string(&messages.join("\n"), 500)
}

/// 解析 pytest 输出
/// 格式示例：
///   FAILED tests/test_foo.py::test_bar - AssertionError: ...
///   2 passed, 1 failed in 0.5s
fn parse_pytest_results(output: &str) -> (usize, usize, usize, Vec<FailedTest>) {
    let mut failed_tests = Vec::new();
    let mut passed: usize = 0;
    let mut failed_count: usize = 0;

    for line in output.lines() {
        let trimmed = line.trim();

        // 匹配 "FAILED path/to/test.py::TestClass::test_method - ErrorType: message"
        if trimmed.starts_with("FAILED ") {
            let rest = trimmed.strip_prefix("FAILED ").unwrap_or("");
            let parts: Vec<&str> = rest.splitn(2, " - ").collect();
            let location_part = parts.first().unwrap_or(&"").to_string();
            let error_part = parts.get(1).map(|s| s.to_string()).unwrap_or_default();

            // 拆分路径::类::方法
            let segments: Vec<&str> = location_part.split("::").collect();
            let (module, name) = if segments.len() >= 2 {
                (segments[0].to_string(), segments.last().unwrap().to_string())
            } else {
                (String::new(), location_part.clone())
            };

            failed_tests.push(FailedTest {
                name,
                module,
                error_message: truncate_string(&error_part, 500),
                location: location_part,
            });
            failed_count += 1;
        }

        // 匹配 "PASSED" 行
        if trimmed.starts_with("PASSED ") {
            passed += 1;
        }
    }

    // 尝试从汇总行提取更准确的数字
    if let Some(summary_line) = output.lines().rev().find(|line| {
        let l = line.trim();
        l.contains("passed") || l.contains("failed")
    }) {
        if let Some(value) = extract_number(summary_line, "passed") {
            passed = value;
        }
        if let Some(value) = extract_number(summary_line, "failed") {
            failed_count = value;
        }
    }

    let total = passed + failed_count;
    (total, passed, failed_count, failed_tests)
}

/// 解析 npm test (Jest) 输出
/// 格式示例：
///   FAIL  src/foo.test.js
///     ● Test Suite › test name
///       expect(received).toBe(expected)
///   Tests:       2 failed, 3 passed, 5 total
fn parse_node_results(output: &str) -> (usize, usize, usize, Vec<FailedTest>) {
    let mut failed_tests = Vec::new();
    let mut passed: usize = 0;
    let mut failed_count: usize = 0;

    let lines: Vec<&str> = output.lines().collect();
    let mut current_file = String::new();

    for (i, line) in lines.iter().enumerate() {
        let trimmed = line.trim();

        // 匹配 "FAIL  path/to/test.js"
        if trimmed.starts_with("FAIL ") {
            current_file = trimmed
                .strip_prefix("FAIL ")
                .unwrap_or("")
                .trim()
                .to_string();
        }

        // 匹配 "● Test Suite › test name" (Jest 失败标记)
        if trimmed.starts_with("● ") {
            let name = trimmed.strip_prefix("● ").unwrap_or("").to_string();
            // 收集后续行作为错误消息
            let mut error_lines = Vec::new();
            for j in (i + 1)..lines.len().min(i + 10) {
                let next = lines[j].trim();
                if next.starts_with("● ") || next.starts_with("FAIL") || next.starts_with("PASS") {
                    break;
                }
                if !next.is_empty() {
                    error_lines.push(next.to_string());
                }
            }
            failed_tests.push(FailedTest {
                name,
                module: current_file.clone(),
                error_message: truncate_string(&error_lines.join("\n"), 500),
                location: current_file.clone(),
            });
        }

        // 匹配汇总行 "Tests:       2 failed, 3 passed, 5 total"
        if trimmed.contains("failed") && trimmed.contains("passed") {
            if let Some(value) = extract_number(trimmed, "passed") {
                passed = value;
            }
            if let Some(value) = extract_number(trimmed, "failed") {
                failed_count = value;
            }
        }
    }

    let total = passed + failed_count;
    (total, passed, failed_count, failed_tests)
}

/// 从文本中提取 "N keyword" 格式的数字
fn extract_number(text: &str, keyword: &str) -> Option<usize> {
    // 匹配 "3 passed" 或 "2 failed" 等模式
    let pattern = format!(r"(\d+)\s+{}", keyword);
    if let Ok(re) = regex::Regex::new(&pattern) {
        if let Some(caps) = re.captures(text) {
            return caps[1].parse::<usize>().ok();
        }
    }
    None
}

/// 截断字符串到指定字符数
fn truncate_string(text: &str, max_chars: usize) -> String {
    if text.chars().count() <= max_chars {
        text.to_string()
    } else {
        let truncated: String = text.chars().take(max_chars).collect();
        format!("{}...", truncated)
    }
}

fn resolve_framework(explicit: Option<&str>) -> Result<TestFramework> {
    if let Some(value) = explicit {
        return match value.trim().to_lowercase().as_str() {
            "cargo" | "rust" => Ok(TestFramework::Rust),
            "npm" | "node" | "jest" => Ok(TestFramework::Node),
            "go" => Ok(TestFramework::Go),
            "pytest" | "python" => Ok(TestFramework::Pytest),
            _ => anyhow::bail!("unsupported framework: {}", value),
        };
    }

    let cwd = std::env::current_dir()?;
    detect_framework(&cwd).ok_or_else(|| anyhow::anyhow!("unable to detect test framework"))
}

fn detect_framework(cwd: &Path) -> Option<TestFramework> {
    if cwd.join("Cargo.toml").exists() {
        Some(TestFramework::Rust)
    } else if cwd.join("package.json").exists() {
        Some(TestFramework::Node)
    } else if cwd.join("go.mod").exists() {
        Some(TestFramework::Go)
    } else if cwd.join("pyproject.toml").exists() || cwd.join("pytest.ini").exists() {
        Some(TestFramework::Pytest)
    } else {
        None
    }
}

fn build_command(
    framework: TestFramework,
    target: Option<&str>,
    filter: Option<&str>,
) -> Vec<String> {
    match framework {
        TestFramework::Rust => {
            let mut command = vec!["cargo".to_string(), "test".to_string()];
            if let Some(target) = target.filter(|value| !value.trim().is_empty()) {
                command.extend(split_shell_like_args(target));
            }
            if let Some(filter) = filter.filter(|value| !value.trim().is_empty()) {
                command.push(filter.trim().to_string());
            }
            command
        }
        TestFramework::Node => {
            let mut command = vec!["npm".to_string(), "test".to_string()];
            if let Some(filter) = filter.filter(|value| !value.trim().is_empty()) {
                command.push("--".to_string());
                command.push(filter.trim().to_string());
            }
            command
        }
        TestFramework::Go => {
            let mut command = vec!["go".to_string(), "test".to_string()];
            command.push(
                target
                    .filter(|value| !value.trim().is_empty())
                    .unwrap_or("./...")
                    .trim()
                    .to_string(),
            );
            if let Some(filter) = filter.filter(|value| !value.trim().is_empty()) {
                command.push("-run".to_string());
                command.push(filter.trim().to_string());
            }
            command
        }
        TestFramework::Pytest => {
            let mut command = vec!["pytest".to_string()];
            if let Some(target) = target.filter(|value| !value.trim().is_empty()) {
                command.push(target.trim().to_string());
            }
            if let Some(filter) = filter.filter(|value| !value.trim().is_empty()) {
                command.push("-k".to_string());
                command.push(filter.trim().to_string());
            }
            command
        }
    }
}

fn truncate_output(text: &str) -> String {
    const LIMIT: usize = 8_000;
    let mut output = String::new();
    for ch in text.chars().take(LIMIT) {
        output.push(ch);
    }
    if text.chars().count() > LIMIT {
        output.push_str("\n...(truncated)");
    }
    output
}

fn split_shell_like_args(value: &str) -> Vec<String> {
    value
        .split_whitespace()
        .filter(|part| !part.is_empty())
        .map(|part| part.to_string())
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn build_rust_command_with_target_and_filter() {
        let command = build_command(TestFramework::Rust, Some("-p sacode-cli"), Some("footer"));
        assert_eq!(command, vec!["cargo", "test", "-p", "sacode-cli", "footer"]);
    }

    #[test]
    fn build_go_command_defaults_to_all_packages() {
        let command = build_command(TestFramework::Go, None, None);
        assert_eq!(command, vec!["go", "test", "./..."]);
    }

    #[test]
    fn parse_rust_test_output() {
        let output = "\
running 5 tests
test foo::bar::test_something ... FAILED
test foo::bar::test_another ... ok
test foo::test_basic ... ok
test baz::test_fail ... FAILED
test test_standalone ... ok

failures:

---- foo::bar::test_something ----
thread 'main' panicked at 'assertion failed: 1 == 2', src/foo.rs:42:5

---- baz::test_fail ----
assertion `left == right` failed
  left: 1
 right: 2

test result: FAILED. 3 passed; 2 failed; 0 ignored; 0 measured; 5 total";

        let (total, passed, failed, tests) = parse_rust_results(output);
        assert_eq!(total, 5);
        assert_eq!(passed, 3);
        assert_eq!(failed, 2);
        assert_eq!(tests.len(), 2);
        assert_eq!(tests[0].name, "test_something");
        assert_eq!(tests[0].module, "foo::bar");
        assert!(tests[0].error_message.contains("panicked"));
        // location 应从 panic 信息中提取 "src/foo.rs:42:5"
        assert_eq!(tests[0].location, "src/foo.rs:42:5");
        assert_eq!(tests[1].name, "test_fail");
        assert_eq!(tests[1].module, "baz");
        // 第二个失败无 panic 位置信息，location 应为空
        assert_eq!(tests[1].location, "");
    }

    #[test]
    fn parse_go_test_output() {
        let output = "\
=== RUN   TestAdd
--- PASS: TestAdd (0.00s)
=== RUN   TestSubtract
--- FAIL: TestSubtract (0.00s)
    math_test.go:15: expected 5, got 3
    math_test.go:16: another assertion failed
FAIL
FAIL    pkg/math    0.123s";

        let (total, passed, failed, tests) = parse_go_results(output);
        assert_eq!(total, 2);
        assert_eq!(passed, 1);
        assert_eq!(failed, 1);
        assert_eq!(tests.len(), 1);
        assert_eq!(tests[0].name, "TestSubtract");
        assert!(tests[0].error_message.contains("expected 5"));
    }

    #[test]
    fn parse_pytest_output() {
        let output = "\
test_main.py ....F                                                    [100%]

=================================== FAILURES ===================================
_________________________ test_divide_by_zero _________________________

    def test_divide_by_zero():
>       1 / 0
E       ZeroDivisionError: division by zero

test_main.py:5: ZeroDivisionError
=========================== short test summary info ============================
FAILED test_main.py::test_divide_by_zero - ZeroDivisionError: division by zero
3 passed, 1 failed in 0.05s";

        let (total, passed, failed, tests) = parse_pytest_results(output);
        assert_eq!(total, 4);
        assert_eq!(passed, 3);
        assert_eq!(failed, 1);
        assert_eq!(tests.len(), 1);
        assert_eq!(tests[0].name, "test_divide_by_zero");
        assert_eq!(tests[0].module, "test_main.py");
        assert!(tests[0].error_message.contains("ZeroDivisionError"));
    }

    #[test]
    fn parse_jest_output() {
        let output = "\
FAIL  src/calculator.test.js
  ● Calculator › should add two numbers

    expect(received).toBe(expected)

    Expected: 5
    Received: 4

      12 | test('should add two numbers', () => {
      13 |   expect(add(2, 2)).toBe(5);

  ● Calculator › should handle errors

    TypeError: something is not a function

PASS  src/utils.test.js
Tests:       2 failed, 5 passed, 7 total";

        let (total, passed, failed, tests) = parse_node_results(output);
        assert_eq!(total, 7);
        assert_eq!(passed, 5);
        assert_eq!(failed, 2);
        assert_eq!(tests.len(), 2);
        assert_eq!(tests[0].name, "Calculator › should add two numbers");
        assert!(tests[0].error_message.contains("Expected: 5"));
    }

    #[test]
    fn extract_number_from_summary() {
        assert_eq!(extract_number("3 passed; 2 failed", "passed"), Some(3));
        assert_eq!(extract_number("3 passed; 2 failed", "failed"), Some(2));
        assert_eq!(extract_number("1 passed, 5 failed in 0.5s", "passed"), Some(1));
        assert_eq!(extract_number("no match here", "passed"), None);
    }

    #[test]
    fn split_rust_test_name_simple() {
        let (module, name) = split_rust_test_name("test_standalone");
        assert_eq!(module, "");
        assert_eq!(name, "test_standalone");
    }

    #[test]
    fn split_rust_test_name_qualified() {
        let (module, name) = split_rust_test_name("foo::bar::test_something");
        assert_eq!(module, "foo::bar");
        assert_eq!(name, "test_something");
    }
}
