use std::ffi::{CStr, CString};
use std::os::raw::c_char;

use crate::schema::{ExecutionMode, Plan, Step};

/// FFI 句柄 — 提供 C ABI 兼容入口
///
/// 设计说明：
/// - FFI 仅返回静态 plan 占位（不调用 LLM），供 C/Python/Node 等外部调用方快速验证集成
/// - 真正的 LLM 调用 + 工具执行请使用 runtime 层的
///   [`sacode_runtime::sdk::execute_task`] 或 [`SdkClient`](sacode_runtime::sdk::SdkClient)
/// - 保持 kernel 层零外部依赖，cdylib 体积最小
pub struct SacodeHandle;

impl Default for SacodeHandle {
    fn default() -> Self {
        Self::new()
    }
}

impl SacodeHandle {
    pub fn new() -> Self {
        Self
    }

    /// 生成静态 plan JSON（占位实现，不调用 LLM）
    pub fn execute(&self, prompt: &str, mode: ExecutionMode) -> String {
        let steps = build_static_steps(prompt, mode);
        let plan = Plan::new(prompt.to_string(), steps, format!("{mode:?}"));
        serde_json::to_string(&plan).unwrap_or_else(|_| "{}".to_string())
    }
}

/// 构建静态执行步骤模板
///
/// 此函数复刻了 deprecated PlannerAgent 的步骤生成逻辑，使 FFI 不再依赖
/// deprecated 结构。步骤内容为静态模板，不包含真正的 LLM 分析。
fn build_static_steps(prompt: &str, mode: ExecutionMode) -> Vec<Step> {
    let mut discovery_tools = vec!["fs.read".to_string(), "fs.search".to_string()];
    if should_use_web_search(prompt) {
        discovery_tools.push("web.search".to_string());
    }

    let mut steps = vec![
        Step::new(
            1,
            "分析任务需求和约束".to_string(),
            vec!["fs.read".to_string()],
            "明确的任务目标".to_string(),
        ),
        Step::new(
            2,
            "扫描工作区上下文".to_string(),
            discovery_tools,
            "相关文件和代码".to_string(),
        ),
        Step::new(
            3,
            "制定执行方案".to_string(),
            vec![],
            "具体的执行步骤".to_string(),
        ),
    ];

    if matches!(mode, ExecutionMode::Build | ExecutionMode::Yolo) {
        let mut execution_tools = vec!["shell.exec".to_string(), "git.diff".to_string()];
        execution_tools.extend(extract_mcp_tools(prompt));
        steps.push(Step::new(
            4,
            "执行工具调用".to_string(),
            execution_tools,
            "执行结果".to_string(),
        ));
        steps.push(Step::new(
            5,
            "验证执行结果".to_string(),
            vec![],
            "验证报告".to_string(),
        ));
    }

    steps
}

fn should_use_web_search(prompt: &str) -> bool {
    let lower = prompt.to_lowercase();
    ["搜索", "联网", "web", "search", "docs", "文档"]
        .iter()
        .any(|needle| lower.contains(needle))
}

fn extract_mcp_tools(prompt: &str) -> Vec<String> {
    prompt
        .split_whitespace()
        .filter(|token| token.starts_with("mcp.") && token.matches('.').count() >= 2)
        .map(|token| {
            token
                .trim_matches(|c: char| ",.;:()[]{}\"'".contains(c))
                .to_string()
        })
        .collect()
}

/// 将字符串转为 CString，含内部 NUL 字节时返回错误占位而非 panic
///
/// FFI 边界需要 CString 以返回 C ABI。正常输入不会含 NUL
///（JSON 序列化结果、静态 ASCII 字面量、CStr 转换后的 String），
/// 此函数仅作防御性兜底，避免异常输入导致 panic 中断宿主进程。
fn into_c_string(s: impl Into<Vec<u8>>) -> CString {
    CString::new(s).unwrap_or_else(|_| {
        // 仅在输入含内部 NUL 字节时触发，正常路径不可达
        CString::new("error: string contains NUL byte").expect("static ASCII literal without NUL")
    })
}

#[no_mangle]
pub extern "C" fn sacode_new() -> *mut SacodeHandle {
    let handle = Box::new(SacodeHandle::new());
    Box::into_raw(handle)
}

/// # Safety
///
/// The handle must be a valid pointer previously returned by `sacode_new()`.
/// Passing a null pointer or a pointer that has already been freed is undefined behavior.
#[no_mangle]
pub unsafe extern "C" fn sacode_free(handle: *mut SacodeHandle) {
    if !handle.is_null() {
        drop(Box::from_raw(handle));
    }
}

/// # Safety
///
/// - `handle` must be a valid pointer previously returned by `sacode_new()`.
/// - `prompt` must be a valid null-terminated C string.
/// - The returned string must be freed with `sacode_free_string()`.
#[no_mangle]
pub unsafe extern "C" fn sacode_execute(
    handle: *mut SacodeHandle,
    prompt: *const c_char,
    mode: i32,
) -> *mut c_char {
    if handle.is_null() {
        return into_c_string("error: null handle").into_raw();
    }
    if prompt.is_null() {
        return into_c_string("error: null prompt").into_raw();
    }
    let handle = &*handle;
    let prompt = CStr::from_ptr(prompt).to_string_lossy().into_owned();

    let execution_mode = match mode {
        1 => ExecutionMode::Plan,
        2 => ExecutionMode::Yolo,
        _ => ExecutionMode::Build,
    };

    let result = handle.execute(&prompt, execution_mode);
    into_c_string(result).into_raw()
}

/// # Safety
///
/// `s` must be a valid pointer previously returned by `sacode_execute()`.
/// Passing a null pointer is safe (no-op).
#[no_mangle]
pub unsafe extern "C" fn sacode_free_string(s: *mut c_char) {
    if !s.is_null() {
        drop(CString::from_raw(s));
    }
}

#[no_mangle]
pub extern "C" fn sacode_version() -> *mut c_char {
    into_c_string(env!("CARGO_PKG_VERSION")).into_raw()
}
