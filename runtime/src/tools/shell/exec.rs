use crate::sandbox::{active_backend, active_policy, SandboxCommand};
use crate::tools::context::CommandOutput;
use crate::tools::spec::{SideEffectLevel, ToolOutput, ToolSpec};

use super::sandbox::ShellSandbox;

const DEFAULT_TIMEOUT_SECS: u64 = 30;
const MAX_OUTPUT_LEN: usize = 10000;

#[cfg(target_os = "windows")]
const WINDOWS_SHELL_BUILTINS: &[&str] = &[
    "dir", "type", "echo", "copy", "del", "ren", "mkdir", "rmdir", "set", "cd", "chdir", "md",
    "move", "pushd", "popd", "path", "assoc", "ftype", "cls", "color", "date", "time", "title",
    "mklink", "robocopy", "xcopy", "find", "findstr", "where", "sort", "more", "fc", "comp",
    "tree", "ver", "vol", "call", "start", "exit", "if", "for", "goto", "pause", "rem", "shift",
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

    if let CommandRisk::Dangerous(reason) = classify_command_risk(command_str) {
        return Ok(ToolOutput::failure(format!("dangerous command blocked: {reason}")));
    }

    ShellSandbox::validate(command_str, cwd)?;

    let output = run_local_command(command_str, cwd, timeout_secs * 1000)?;

    Ok(tool_output_from_backend(output))
}

/// 执行 shell 命令的核心逻辑（供 `LocalContext::exec` 复用）
///
/// 抽取自原 `execute`，保持平台包装（`needs_cmd_wrapper` / `needs_sh_wrapper`）
/// 与危险命令检查行为完全一致——这是 `ExecutionContext::LocalContext`
/// 保证零回归的关键。
pub(crate) fn run_local_command(
    command_str: &str,
    cwd: Option<&str>,
    timeout_ms: u64,
) -> anyhow::Result<CommandOutput> {
    let parts = build_command_parts(command_str)?;
    let Some(program) = parts.first() else {
        anyhow::bail!("command is required");
    };

    let backend_output = active_backend().execute_command(
        &active_policy(),
        &SandboxCommand {
            program: program.clone(),
            args: parts.iter().skip(1).cloned().collect(),
            cwd: cwd.map(str::to_string),
            timeout_ms,
        },
    )?;

    Ok(CommandOutput {
        stdout: backend_output.stdout,
        stderr: backend_output.stderr,
        exit_code: backend_output.exit_code,
        timed_out: backend_output.timed_out,
    })
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
                                current.push(chars.next().unwrap_or(next));
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

/// 命令风险分类结果。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum CommandRisk {
    /// 安全（未命中已知危险操作）。
    Safe,
    /// 危险，附带原因（用于日志与报错信息）。
    Dangerous(&'static str),
}

impl CommandRisk {
    #[cfg(test)]
    pub(crate) fn is_dangerous(self) -> bool {
        matches!(self, CommandRisk::Dangerous(_))
    }
    pub(crate) fn reason(self) -> Option<&'static str> {
        match self {
            CommandRisk::Safe => None,
            CommandRisk::Dangerous(r) => Some(r),
        }
    }
}

/// 危险程序名：单独作为命令首词即判危险（不依赖具体参数），因为这些操作具有不可逆破坏性。
const DANGEROUS_PROGRAMS: &[&str] = &[
    "mkfs", "dd", "shutdown", "reboot", "halt", "poweroff", "format", "diskpart", "bcdedit",
    "takeown", "icacls", "wmic",
];

/// 危险参数模式（对归一化后的命令做子串匹配，抗 `${IFS}`/反斜杠转义混淆）。
const DANGEROUS_PATTERNS: &[(&str, &'static str)] = &[
    ("rm -rf", "recursive force delete"),
    ("rm -fr", "recursive force delete"),
    ("rm -r", "recursive delete"),
    ("rm -f", "force delete"),
    (":(){", "fork bomb"),
    ("> /dev/sda", "overwrite raw disk"),
    ("chmod 777", "world-writable chmod"),
    ("chmod -r 777", "world-writable chmod"),
    ("dd if=", "raw disk write"),
    ("shutdown", "system shutdown"),
    ("reboot", "system reboot"),
    ("init 0", "power off"),
    ("init 6", "reboot"),
    ("reg delete", "registry delete"),
    ("del /f /s", "forced recursive delete (windows)"),
    ("rmdir /s", "recursive dir delete (windows)"),
    ("rd /s", "recursive dir delete (windows)"),
];

/// 归一化命令以便扫描：剥离 `${IFS}`/`$IFS`、反斜杠转义，并折叠连续空白。
/// 目的：抵抗 `rm -rf${IFS}/` 这类简易混淆，同时不改变真实执行语义。
fn normalize_for_scan(cmd: &str) -> String {
    let s = cmd.replace("${IFS}", " ").replace("$IFS", " ");
    let s = s.replace('\\', "");
    let mut out = String::with_capacity(s.len());
    let mut prev_space = false;
    for ch in s.chars() {
        if ch.is_whitespace() {
            if !prev_space && !out.is_empty() {
                out.push(' ');
            }
            prev_space = true;
        } else {
            out.push(ch);
            prev_space = false;
        }
    }
    out.trim().to_string()
}

/// 若命令是 `sh -c "..."` / `bash -c` / `cmd /C "..."` / `powershell -c "..."` 包装，
/// 返回内部命令字符串，否则 `None`。用于深入检查被 shell 包裹的危险命令。
fn shell_inner(cmd: &str) -> Option<String> {
    let tokens = split_command(cmd).ok()?;
    if tokens.len() >= 3 {
        let prog = tokens[0].to_ascii_lowercase();
        let flag = tokens[1].to_ascii_lowercase();
        let is_wrapper = (prog == "sh" && (flag == "-c" || flag == "-e"))
            || (prog == "bash" && (flag == "-c" || flag == "-e"))
            || ((prog == "cmd" || prog == "cmd.exe") && flag == "/c")
            || ((prog == "powershell" || prog == "pwsh")
                && (flag == "-c" || flag == "-command"));
        if is_wrapper {
            return Some(tokens[2..].join(" "));
        }
    }
    None
}

/// 对原始 shell 命令做风险分类（D10 L1：稳健解析黑名单）。
///
/// 相比旧版纯子串匹配，本实现：
/// 1. 解包 `sh -c "..."` / `cmd /C "..."` 深入检查内部命令；
/// 2. 归一化命令（剥离 `${IFS}`、反斜杠转义、折叠空白）抵抗简易混淆；
/// 3. 既按危险程序名（首词）也按危险参数模式判定，降低误放与误拦。
pub(crate) fn classify_command_risk(cmd: &str) -> CommandRisk {
    // 同时检查原始命令与被 shell 包裹的内部命令。
    let inner = shell_inner(cmd).unwrap_or_default();
    let candidates = [cmd, inner.as_str()];
    for raw in candidates {
        if raw.is_empty() {
            continue;
        }
        let normalized = normalize_for_scan(raw);
        let lower = normalized.to_lowercase();

        // 1) 危险程序名（首词）
        if let Some(first) = lower.split_whitespace().next() {
            let prog = first.trim_start_matches(['.', '/', '-']);
            if DANGEROUS_PROGRAMS.iter().any(|p| prog == *p) {
                return CommandRisk::Dangerous("destructive program");
            }
        }

        // 2) 危险参数模式
        for (pat, reason) in DANGEROUS_PATTERNS {
            if lower.contains(pat) {
                return CommandRisk::Dangerous(reason);
            }
        }

        // 3) Windows 专属危险模式
        #[cfg(target_os = "windows")]
        for pat in WINDOWS_DANGEROUS_PATTERNS {
            if lower.contains(pat) {
                return CommandRisk::Dangerous("windows destructive pattern");
            }
        }
    }
    CommandRisk::Safe
}

#[cfg(test)]
fn is_dangerous_command(cmd: &str) -> bool {
    classify_command_risk(cmd).is_dangerous()
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

fn tool_output_from_backend(output: CommandOutput) -> ToolOutput {
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

    #[test]
    fn classify_resists_obfuscation_and_wrappers() {
        // 旧版纯子串匹配会放过的混淆手法
        assert!(is_dangerous_command("rm -rf${IFS}/"));
        assert!(is_dangerous_command("r\\m -rf /"));
        assert!(is_dangerous_command("sh -c \"rm -rf /\""));
        assert!(is_dangerous_command("bash -c 'mkfs /dev/sda1'"));
        assert!(is_dangerous_command("cmd /C \"del /f /s C:\\temp\""));
        // 安全命令仍放行
        assert!(!is_dangerous_command("git status"));
        assert!(!is_dangerous_command("cargo build --release"));
        assert!(!is_dangerous_command("ls -la ./src"));
        // 危险程序名直接命中
        assert!(is_dangerous_command("dd if=/dev/zero of=/dev/sda"));
        assert!(is_dangerous_command("shutdown -h now"));
    }

    #[test]
    fn classify_returns_reason() {
        assert_eq!(
            classify_command_risk("rm -rf /").reason(),
            Some("recursive force delete")
        );
        assert_eq!(classify_command_risk("ls -la").reason(), None);
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
