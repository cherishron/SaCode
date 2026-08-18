//! 工具执行事件流水线 — 拦截器机制
//!
//! 借鉴 deepseek-harness 的 `tool/call → pre-execute → execute → post-execute → result`
//! 五阶段事件链设计（见 `docs/reference/comparison-with-deepseek-harness.md` §3.2）。
//!
//! SaCode 原有的 `sandbox_guard::preflight` / `audit_execution_result` 是事实上的
//! `pre-execute` / `on-result` 拦截点，本模块将其重构为可注册、可组合的
//! [`ToolInterceptor`] trait，使审批 / 策略 / 遥测 / 超时等关注点可独立挂载，
//! 而无需修改工具代码本身。
//!
//! 设计约束（Rust 静态分发 + 灵枢既有优势不削弱）：
//! - 拦截器为同步 trait（`Send + Sync`），保留与原 `preflight` 一致的执行语义。
//! - 异步拦截器（人工审批 UI、远程策略服务）留作第二步（v1.2），本期不做。
//! - 默认注册的拦截器组合必须等价于原 `sandbox_guard` 行为，保证向后兼容。

use serde_json::Value;

use super::{SideEffectLevel, ToolOutput, ToolSpec};

/// 单次工具调用的执行上下文
///
/// 用于把 session / task 维度信息传给拦截器，使其能把事件关联到正确的会话流。
/// 当前仅携带 `session_id`（对应 `.sacode/events.log` 的会话分片），后续可扩展。
#[derive(Debug, Clone, Default)]
pub struct InterceptContext {
    /// 会话标识；空字符串表示未关联会话（如独立 `sacode "<task>"` 调用）
    pub session_id: String,
    /// 触发本次工具调用的任务标识（可选，用于跨任务事件关联）
    pub task_id: Option<String>,
}

/// `pre_execute` 的裁决结果
#[derive(Debug, Clone)]
pub enum PreExecuteDecision {
    /// 放行，使用原始 input 执行
    Allow,
    /// 拒绝执行，reason 会写入审计日志并作为错误返回给调用方
    Deny { reason: String },
    /// 放行，但使用改写后的 input（如参数校验修正、策略注入）
    Modify { new_input: Value },
}

/// `post_execute` 的裁决结果
#[derive(Debug, Clone)]
pub enum PostExecuteDecision {
    /// 保留执行结果，原样返回
    Keep,
    /// 执行失败或需要重试（如临时网络错误）；max_attempts 为建议重试上限
    Retry { max_attempts: usize },
    /// 改写返回给 Agent 的结果（如脱敏、结构归一化）
    Transform { new_output: ToolOutput },
}

/// 工具执行拦截器
///
/// 实现者注册到 [`crate::tools::ToolRegistry`] 后，在每次工具执行的
/// `pre_execute`（执行前）与 `post_execute`（执行后）阶段被顺序调用。
///
/// 所有拦截器按顺序执行；任一 `pre_execute` 返回 `Deny` 即中断链并拒绝执行；
/// `post_execute` 的 `Transform` 改写会传播给后续拦截器与最终返回。
pub trait ToolInterceptor: Send + Sync {
    /// 执行前拦截：审批、参数校验、策略检查、超时设置等
    ///
    /// - 返回 `Allow` / `Modify`：继续执行链
    /// - 返回 `Deny`：中断链，工具不执行，reason 作为错误返回
    fn pre_execute(
        &self,
        spec: &ToolSpec,
        input: &Value,
        ctx: &InterceptContext,
    ) -> PreExecuteDecision;

    /// 执行后拦截：结果审计、遥测记录、成功/失败分支、重试策略等
    ///
    /// 默认实现为 `Keep`（不做任何事），子类按需覆盖。
    fn post_execute(
        &self,
        _spec: &ToolSpec,
        _input: &Value,
        _output: Option<&ToolOutput>,
        _error: Option<&str>,
        _ctx: &InterceptContext,
    ) -> PostExecuteDecision {
        PostExecuteDecision::Keep
    }

    /// 拦截器名称，用于审计日志与调试
    fn name(&self) -> &'static str;
}

/// `side_effect_level` 是否达到需要审计/拦截的阈值
///
/// 与原 `sandbox_guard::should_audit` 语义一致：仅 `Modify` 级工具强制审计。
pub fn should_audit(spec: &ToolSpec) -> bool {
    matches!(spec.side_effect_level, SideEffectLevel::Modify)
}
