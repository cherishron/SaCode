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
//! - 同步拦截器 [`ToolInterceptor`] 为同步 trait（`Send + Sync`），保留与原
//!   `preflight` 一致的执行语义（热路径零开销）。
//! - 异步拦截器 [`AsyncToolInterceptor`] 为 `pre_execute` / `post_execute` 返回
//!   手写 `BoxFuture`（不用 async_trait crate，零新依赖），供人工审批 UI、
//!   远程策略服务等需要异步 I/O 的场景挂载。异步链仅经
//!   [`crate::tools::ToolRegistry::execute_with_ctx_async`] 入口运行。
//! - [`SyncInterceptorAsAsync`] 适配器把同步拦截器包装进异步链，使既有同步链
//!   逻辑可被异步入口复用（顺序保持）。
//! - 默认注册的拦截器组合必须等价于原 `sandbox_guard` 行为，保证向后兼容。

use serde_json::Value;

use super::{SideEffectLevel, ToolOutput, ToolSpec};

/// 异步 future 的 boxed 形式（手写，零 async_trait 依赖）
///
/// 生命周期参数 `'a` 允许借用在调用栈上构造的 `ToolSpec` / `Value` / `InterceptContext`。
pub type BoxFuture<'a, T> = std::pin::Pin<Box<dyn std::future::Future<Output = T> + Send + 'a>>;

/// 单次工具调用的执行上下文
///
/// 用于把 session / task 维度信息传给拦截器，使其能把事件关联到正确的会话流。
/// 当前携带 `session_id`（对应 `.sacode/events.log` 的会话分片）和 `task_id`，后续可扩展。
#[derive(Debug, Clone, Default)]
pub struct InterceptContext {
    /// 会话标识；None 表示未关联会话（如独立 `sacode "<task>"` 调用）
    pub session_id: Option<String>,
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

/// 异步工具执行拦截器
///
/// 与同步 [`ToolInterceptor`] 共用 [`PreExecuteDecision`] / [`PostExecuteDecision`] 裁决类型，
/// 但 `pre_execute` / `post_execute` 返回 `BoxFuture`（可 await 异步 I/O）。
///
/// 使用场景：人工审批 UI、远程策略服务、需要网络 RTT 的决策逻辑。
/// 仅经 [`crate::tools::ToolRegistry::execute_with_ctx_async`] 入口运行；
/// 同步 `execute_with_ctx` 不跑异步链（调用方需按需迁移 async 入口）。
pub trait AsyncToolInterceptor: Send + Sync {
    /// 执行前拦截（异步）。默认放行。
    fn pre_execute<'a>(
        &'a self,
        _spec: &'a ToolSpec,
        _input: &'a Value,
        _ctx: &'a InterceptContext,
    ) -> BoxFuture<'a, PreExecuteDecision> {
        Box::pin(async { PreExecuteDecision::Allow })
    }

    /// 执行后拦截（异步）。默认 Keep。
    fn post_execute<'a>(
        &'a self,
        _spec: &'a ToolSpec,
        _input: &'a Value,
        _output: Option<&'a ToolOutput>,
        _error: Option<&'a str>,
        _ctx: &'a InterceptContext,
    ) -> BoxFuture<'a, PostExecuteDecision> {
        Box::pin(async { PostExecuteDecision::Keep })
    }

    /// 拦截器名称，用于审计日志与调试
    fn name(&self) -> &'static str;
}

/// 同步拦截器 → 异步链适配器
///
/// 把实现 [`ToolInterceptor`] 的同步拦截器包装进异步链，使既有同步链逻辑
/// （默认拦截器、Profile 挂载等）可在 `execute_with_ctx_async` 入口复用，
/// 且**不改变**其同步语义（内部仍同步调用，仅外壳 async）。
pub struct SyncInterceptorAsAsync {
    inner: std::sync::Arc<dyn ToolInterceptor>,
}

impl SyncInterceptorAsAsync {
    /// 从同步拦截器构造异步适配器
    pub fn new(inner: std::sync::Arc<dyn ToolInterceptor>) -> Self {
        Self { inner }
    }
}

impl AsyncToolInterceptor for SyncInterceptorAsAsync {
    fn pre_execute<'a>(
        &'a self,
        spec: &'a ToolSpec,
        input: &'a Value,
        ctx: &'a InterceptContext,
    ) -> BoxFuture<'a, PreExecuteDecision> {
        let decision = self.inner.pre_execute(spec, input, ctx);
        Box::pin(async move { decision })
    }

    fn post_execute<'a>(
        &'a self,
        spec: &'a ToolSpec,
        input: &'a Value,
        output: Option<&'a ToolOutput>,
        error: Option<&'a str>,
        ctx: &'a InterceptContext,
    ) -> BoxFuture<'a, PostExecuteDecision> {
        let decision = self.inner.post_execute(spec, input, output, error, ctx);
        Box::pin(async move { decision })
    }

    fn name(&self) -> &'static str {
        self.inner.name()
    }
}
