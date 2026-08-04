use crate::tools::spec::{SideEffectLevel, ToolOutput, ToolSpec};
use crate::{active_backend, active_policy, BackendCommandOutput, SandboxCommand};

use super::sandbox::ShellSandbox;

const DEFAULT_TIMEOUT_SECS: u64 = 30;
const MAX_OUTPUT_LEN: usize = 10000;

#[cfg(target_os = "windows")]
const WINDOWS_SHELL_BUILTINS: &[&str] = &[
    "dir",
    "type",
    "echo",
    "copy",
    "del",
    "ren",
    "mkdir",
    "rmdir",
    "set",
    "cd",
    "chdir",
    "md",
    "move",
    "pushd",
    "popd",
    "path",
    "assoc",
    "ftype",
    "cls",
    "color",
    "date",
    "time",
    "title",
    "mklink",
    "robocopy",
    "xcopy",
    "find",
    "findstr",
    "where",
    "sort",
    "more",
    "fc",
    "comp",
    "tree",
    "ver",
    "vol",
    "call",
    "start",
    "exit",
    "if",
    "for",
    "goto",
    "pause",
    "rem",
    "shift",
];

/// Windows 上需要通过 cmd.exe 解释的 shell 操作符
#[cfg(target_os = "windows")]
const WINDOWS_SHELL_OPERATORS: &[&str] = &["|", ">", ">>", "<", "&&", "||", "&", ";"];

#[cfg(target_os = "windows")]
const WINDOWS_DANGEROUS_PATTERNS: &[&str] = &[
    "format",
    "diskpart",
    "bcdedit",
    "reg delete",
    "del /f /s",
    "rmdir /s",
    "rd /s",
    "takeown",
    "icacls",
    "shutdown",
    "reboot",
    "net user",
    "wmic",
    "powershell -enc",
    "cmd /c del",
    "cipher /w",
    "netsh",
    "sc delete",
    "reg add",
];

pub fn spec() -> ToolSpec {
    ToolSpec {
        name: "shell.exec".to_string(),
        description: "执行 Shell 命令".to_string(),
        input_schema: serde_json::json!({
            "type": "object",
            "properties": {
                "command": { "type": "string", "description": "要执行的命令" },
                "timeout": { "type": "integer", "description": "超时秒数(可选,默认30)" },
                "cwd": { "type": "string", "description": "工作目录(可选)" }
            },
            "required": ["command"]
        }),
        output_schema: serde_json::json!({
            "type": "object",
            "properties": {
                "stdout": { "type": "string" },
                "stderr": { "type": "string" },
                "exit_code": { "type": "integer" },
                "success": { "type": "boolean" },
                "timed_out": { "type": "boolean" }
            }
        }),
        side_effect_level: SideEffectLevel::Execute,
        approval_required: true,
        timeout_ms: Some(DEFAULT_TIMEOUT_SECS * 1000),
        tags: vec!["shell".to_string(), "exec".to_string()],
    }
}

pub fn execute(input: serde_json::Value) -> anyhow::Result<ToolOutput> {
    let command_str = input["command"].as_str().unwrap_or("");
    let timeout_secs = input["timeout"].as_u64().unwrap_or(DEFAULT_TIMEOUT_SECS);
    let cwd = input["cwd"].as_str();

    if command_str.is_empty() {
        return Ok(ToolOutput::failure("command is required"));
    }

    if is_dangerous_command(command_str) {
        return Ok(ToolOutput::failure("dangerous command blocked"));
    }

    ShellSandbox::validate(command_str, cwd)?;

    let parts = build_command_parts(command_str)?;
    let Some(program) = parts.first() else {
        return Ok(ToolOutput::failure("command is required"));
    };

    let output = active_backend().execute_command(
        &active_policy(),
        &SandboxCommand {
            program: program.clone(),
            args: parts.iter().skip(1).cloned().collect(),
            cwd: cwd.map(str::to_string),
            timeout_ms: timeout_secs * 1000,
        },
    )?;

    Ok(tool_output_from_backend(output))
}

fn split_command(command: &str) -> anyhow::Result<Vec<String>> {
    let mut parts = Vec::new();
    let mut current = String::new();
    let mut chars = command.chars().peekable();
    let mut quote: Option<char> = None;

    while let Some(ch) = chars.next() {
        match quote {
            Some(active_quote) => {
                if ch == active_quote {
                    quote = None;
                } else if ch == '\\' {
                    if let Some(next) = chars.next() {
                        current.push(next);
                    }
                } else {
                    current.push(ch);
                }
            }
            None => {
                if ch.is_whitespace() {
                    if !current.is_empty() {
                        parts.push(std::mem::take(&mut current));
                    }
                } else if ch == '\'' || ch == '"' {
                    quote = Some(ch);
                } else if ch == '\\' {
                    // Windows 路径中的反斜杠：如果后面跟的是路径分隔符或非特殊字符，
                    // 保留反斜杠作为路径的一部分
                    #[cfg(target_os = "windows")]
                    {
                        current.push('\\');
                        // 检查是否为转义引号的情况
                        if let Some(&next) = chars.peek() {
                            if next == '"' || next == '\'' {
                                // 转义引号：消费反斜杠，保留引号字符
                                current.pop();
                                current.push(chars.next().unwrap());
                            }
                            // 其他情况（路径分隔符等）：反斜杠已保留，继续
                        }
                    }
                    #[cfg(not(target_os = "windows"))]
                    {
                        if let Some(next) = chars.next() {
                            current.push(next);
                        }
                    }
                } else {
                    current.push(ch);
                }
            }
        }
    }

    if quote.is_some() {
        anyhow::bail!("unterminated quoted string in command");
    }

    if !current.is_empty() {
        parts.push(current);
    }

    Ok(parts)
}

fn build_command_parts(command: &str) -> anyhow::Result<Vec<String>> {
    #[cfg(target_os = "windows")]
    {
        // Windows 上：包含 shell 操作符或内建命令时，必须通过 cmd.exe /C 执行
        if needs_cmd_wrapper(command) {
            return Ok(vec![
                "cmd.exe".to_string(),
                "/C".to_string(),
                command.to_string(),
            ]);
        }
        // 普通外部命令：直接解析参数
        split_command(command)
    }

    #[cfg(not(target_os = "windows"))]
    {
        // Unix: 含 shell 操作符（管道、重定向、链式执行）时必须通过 sh -c 解释，
        // 否则 split_command 会把 | > && 等当作字面参数传给程序
        if needs_sh_wrapper(command) {
            return Ok(vec![
                "sh".to_string(),
                "-c".to_string(),
                command.to_string(),
            ]);
        }
        split_command(command)
    }
}

/// 判断 Unix 上命令是否需要通过 sh -c 包装执行
/// 与 Windows 的 needs_cmd_wrapper 对称：检测 shell 操作符
#[cfg(not(target_os = "windows"))]
fn needs_sh_wrapper(command: &str) -> bool {
    const UNIX_SHELL_OPERATORS: &[&str] = &["|", ">", ">>", "<", "&&", "||", "&", ";"];
    for op in UNIX_SHELL_OPERATORS {
        if command.contains(op) {
            return true;
        }
    }
    false
}

/// 判断 Windows 上命令是否需要通过 cmd.exe 包装执行
#[cfg(target_os = "windows")]
fn needs_cmd_wrapper(command: &str) -> bool {
    // 检查 shell 操作符（管道、重定向、链式执行等）
    for op in WINDOWS_SHELL_OPERATORS {
        if command.contains(op) {
            return true;
        }
    }

    // 检查首词是否为 cmd.exe 内建命令
    let first_word = command.split_whitespace().next().unwrap_or("");
    let lower = first_word.to_ascii_lowercase();
    if WINDOWS_SHELL_BUILTINS.contains(&lower.as_str()) {
        return true;
    }

    // .bat / .cmd 脚本需要 cmd.exe 执行
    if lower.ends_with(".bat") || lower.ends_with(".cmd") {
        return true;
    }

    false
}

fn is_dangerous_command(cmd: &str) -> bool {
    let dangerous_patterns = [
        "rm -rf /",
        "rm -rf ~",
        "rm -rf *",
        ":(){ :|:& };:",
        "mkfs",
        "dd if=",
        "> /dev/sda",
        "chmod 777 /",
        "shutdown",
        "reboot",
        "init 0",
        "init 6",
    ];

    let cmd_lower = cmd.to_lowercase();
    for pattern in dangerous_patterns {
        if cmd_lower.contains(pattern) {
            return true;
        }
    }

    #[cfg(target_os = "windows")]
    {
        for pattern in WINDOWS_DANGEROUS_PATTERNS {
            if cmd_lower.contains(pattern) {
                return true;
            }
        }
    }

    false
}

fn truncate_output(output: String) -> String {
    if output.len() > MAX_OUTPUT_LEN {
        // 找到不超过 MAX_OUTPUT_LEN 的最大 UTF-8 字符边界，
        // 避免字节切片落在多字节字符中间导致 panic（中文/emoji 等）
        let end = floor_char_boundary(&output, MAX_OUTPUT_LEN);
        format!(
            "{}... (truncated, {} bytes total)",
            &output[..end],
            output.len()
        )
    } else {
        output
    }
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

fn tool_output_from_backend(output: BackendCommandOutput) -> ToolOutput {
    if output.timed_out {
        return ToolOutput::failure("command timed out");
    }

    ToolOutput::success(serde_json::json!({
        "stdout": truncate_output(output.stdout),
        "stderr": truncate_output(output.stderr),
        "exit_code": output.exit_code,
        "success": output.exit_code == 0,
        "timed_out": false
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn split_command_handles_simple_commands() {
        let parts = split_command("echo hello world").unwrap();
        assert_eq!(parts, vec!["echo", "hello", "world"]);
    }

    #[test]
    fn split_command_handles_quoted_strings() {
        let parts = split_command("echo \"hello world\"").unwrap();
        assert_eq!(parts, vec!["echo", "hello world"]);
    }

    #[test]
    fn split_command_handles_single_quotes() {
        let parts = split_command("echo 'hello world'").unwrap();
        assert_eq!(parts, vec!["echo", "hello world"]);
    }

    #[test]
    fn split_command_rejects_unterminated_quotes() {
        assert!(split_command("echo \"hello").is_err());
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn split_command_preserves_backslash_in_paths() {
        // Windows 路径中的反斜杠应被保留
        let parts = split_command("cmd C:\\Users\\test\\file.txt").unwrap();
        assert_eq!(parts[1], "C:\\Users\\test\\file.txt");
    }

    #[cfg(not(target_os = "windows"))]
    #[test]
    fn split_command_handles_unix_escape() {
        // Unix 上反斜杠是转义字符
        let parts = split_command("echo hello\\ world").unwrap();
        assert_eq!(parts, vec!["echo", "hello world"]);
    }

    #[test]
    fn detects_dangerous_commands() {
        assert!(is_dangerous_command("rm -rf /"));
        assert!(is_dangerous_command("rm -rf ~"));
        assert!(is_dangerous_command("mkfs /dev/sda1"));
        assert!(!is_dangerous_command("ls -la"));
        assert!(!is_dangerous_command("echo hello"));
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn detects_windows_dangerous_commands() {
        assert!(is_dangerous_command("format C:"));
        assert!(is_dangerous_command("diskpart"));
        assert!(is_dangerous_command("reg delete HKLM\\Software"));
        assert!(!is_dangerous_command("dir"));
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn cmd_wrapper_for_shell_builtins() {
        assert!(needs_cmd_wrapper("dir"));
        assert!(needs_cmd_wrapper("echo hello"));
        assert!(needs_cmd_wrapper("type file.txt"));
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn cmd_wrapper_for_pipe_operators() {
        assert!(needs_cmd_wrapper("echo hello | findstr hello"));
        assert!(needs_cmd_wrapper("dir > output.txt"));
        assert!(needs_cmd_wrapper("echo a && echo b"));
        assert!(needs_cmd_wrapper("echo a || echo b"));
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn no_cmd_wrapper_for_simple_external_commands() {
        assert!(!needs_cmd_wrapper("cargo build"));
        assert!(!needs_cmd_wrapper("git status"));
        assert!(!needs_cmd_wrapper("node app.js"));
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn cmd_wrapper_for_batch_scripts() {
        assert!(needs_cmd_wrapper("build.bat"));
        assert!(needs_cmd_wrapper("setup.cmd"));
    }

    #[test]
    fn build_command_parts_basic() {
        let parts = build_command_parts("echo hello").unwrap();
        #[cfg(target_os = "windows")]
        {
            // echo 是 Windows 内建命令，需要 cmd.exe 包装
            assert_eq!(parts, vec!["cmd.exe", "/C", "echo hello"]);
        }
        #[cfg(not(target_os = "windows"))]
        {
            assert_eq!(parts, vec!["echo", "hello"]);
        }
    }

    #[cfg(not(target_os = "windows"))]
    #[test]
    fn sh_wrapper_for_pipe_and_redirect_operators() {
        assert!(needs_sh_wrapper("echo hello | grep hello"));
        assert!(needs_sh_wrapper("ls > out.txt"));
        assert!(needs_sh_wrapper("cmd >> log.txt"));
        assert!(needs_sh_wrapper("cat < input.txt"));
    }

    #[cfg(not(target_os = "windows"))]
    #[test]
    fn sh_wrapper_for_chain_operators() {
        assert!(needs_sh_wrapper("echo a && echo b"));
        assert!(needs_sh_wrapper("echo a || echo b"));
        assert!(needs_sh_wrapper("echo a; echo b"));
        assert!(needs_sh_wrapper("background_job &"));
    }

    #[cfg(not(target_os = "windows"))]
    #[test]
    fn no_sh_wrapper_for_simple_unix_commands() {
        assert!(!needs_sh_wrapper("cargo build"));
        assert!(!needs_sh_wrapper("git status"));
        assert!(!needs_sh_wrapper("echo hello world"));
        assert!(!needs_sh_wrapper("node app.js"));
    }

    #[cfg(not(target_os = "windows"))]
    #[test]
    fn build_command_parts_wraps_with_sh_on_unix() {
        let parts = build_command_parts("echo a && echo b").unwrap();
        assert_eq!(parts, vec!["sh", "-c", "echo a && echo b"]);
    }

    #[cfg(not(target_os = "windows"))]
    #[test]
    fn build_command_parts_no_wrap_for_simple_unix_command() {
        let parts = build_command_parts("cargo build").unwrap();
        assert_eq!(parts, vec!["cargo", "build"]);
    }

    #[test]
    fn truncate_output_limits_length() {
        let long = "a".repeat(20000);
        let truncated = truncate_output(long);
        assert!(truncated.len() < 20000);
        assert!(truncated.contains("truncated"));
    }

    /// 验证含中文等多字节字符的输出截断不 panic（原按字节切片会 panic）
    #[test]
    fn truncate_output_multi_byte_no_panic() {
        // 中文字符 3 字节，MAX_OUTPUT_LEN=10000 落在第 3334 个字符的中间字节
        let long = "中".repeat(5000);
        let truncated = truncate_output(long);
        assert!(truncated.contains("truncated"));
        // 截断后的可见部分必须是合法 UTF-8（String 保证）
        assert!(truncated.chars().count() <= 5000);
    }

    /// 验证 4 字节 emoji 截断也安全
    #[test]
    fn truncate_output_emoji_no_panic() {
        let long = "😀".repeat(3000);
        let truncated = truncate_output(long);
        assert!(truncated.contains("truncated"));
    }
}
