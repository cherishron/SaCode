pub mod autofix;
pub mod runner;

/// 结构化测试失败条目 — runner 和 autofix 共享
///
/// 统一定义避免 `runner::FailedTest` 与 `autofix::FailedTestSummary` 的字段不一致
/// （autofix 原先缺少 `location` 字段，导致 LLM 无法定位失败源码位置）
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct FailedTest {
    /// 测试名称
    pub name: String,
    /// 模块路径
    pub module: String,
    /// 错误消息
    pub error_message: String,
    /// 源码位置（如 `src/math.rs:42`，空表示未提取到）
    #[serde(default)]
    pub location: String,
}

/// 错误类型分类 — 用于结构化修复策略
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ErrorCategory {
    /// 导入/引用错误（not found / undefined / cannot find）
    ImportNotFound,
    /// 类型错误（type mismatch / mismatched types）
    TypeMismatch,
    /// 断言失败（assert / expected / but got）
    AssertionFailure,
    /// panic / unwrap / null 解引用
    PanicOrNull,
    /// 超时/死锁
    TimeoutOrDeadlock,
    /// 权限/访问错误
    Permission,
    /// 其它错误
    Other,
}

impl ErrorCategory {
    /// 根据错误消息关键词推断错误类型
    pub fn from_error_message(message: &str) -> Self {
        let lower = message.to_lowercase();
        if lower.contains("not found")
            || lower.contains("undefined")
            || lower.contains("cannot find")
        {
            Self::ImportNotFound
        } else if lower.contains("type mismatch")
            || lower.contains("type error")
            || lower.contains("mismatched types")
        {
            Self::TypeMismatch
        } else if lower.contains("assert")
            || lower.contains("expected")
            || lower.contains("but got")
        {
            Self::AssertionFailure
        } else if lower.contains("panic")
            || lower.contains("unwrap")
            || lower.contains("null")
            || lower.contains("nil")
        {
            Self::PanicOrNull
        } else if lower.contains("timeout") || lower.contains("deadlock") {
            Self::TimeoutOrDeadlock
        } else if lower.contains("permission") || lower.contains("access denied") {
            Self::Permission
        } else {
            Self::Other
        }
    }

    /// 返回该错误类型的修复建议
    pub fn fix_suggestion(&self) -> &'static str {
        match self {
            Self::ImportNotFound => "检查导入路径和模块名称是否正确，确认依赖已安装",
            Self::TypeMismatch => "检查类型注解和转换，确认函数签名与调用一致",
            Self::AssertionFailure => "检查断言条件，确认预期值与实际值是否匹配",
            Self::PanicOrNull => "添加空值检查和错误处理，避免 unwrap/nil 解引用",
            Self::TimeoutOrDeadlock => "检查异步操作和锁使用，确认无死锁或超时场景",
            Self::Permission => "检查文件权限和访问控制配置",
            Self::Other => "分析错误消息，定位根因并修复",
        }
    }
}
