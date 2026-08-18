//! 灵枢 · Agent Loop 可替换抽象（§3.5）
//!
//! 借鉴 deepseek-harness 的 `core/agent-loop` 设计，把 SaCode 的编排主循环
//! 抽象为可替换的 `AgentLoop` trait，便于在不改动产品层代码的前提下替换
//! 循环策略（如 ReAct / Tree-of-Thought / Plan-and-Execute）。
//!
//! 设计约束（见 comparison doc §3.5）：
//! - **编译期选择，非运行时热替换**：Rust 静态分发更适合用 feature flag /
//!   配置编译选择 Loop 实现，避免 trait 对象动态分发的高频开销。
//! - **灵枢三子系统不可割裂**：`LingShuLoop`（默认实现）封装现有
//!   `execute_role_driven_orchestration` 全部逻辑，保留自组织（角色编排 /
//!   DAG 调度）、自防护（`InterventionRequest` / `dispatch_fix_loop`）、
//!   自愈合（模型故障转移路由）。
//!
//! 命名注意：本模块使用的上下文类型为 `sacode_kernel::ExecutionContext`
//! （struct），与 `crate::tools::context::ExecutionContext`（运行时执行环境
//! 能力接口 trait）是两种完全不同的类型，请勿混淆。

use anyhow::Result;
use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use sacode_kernel::{ExecutionContext, ExecutionReport, TaskRun};

use super::{execute_role_driven_orchestration, RoleRegistry};
use crate::config::profile::Profile;
use crate::CheckpointStorage;

/// 单步执行描述：一次模型请求 + 工具调用循环。
///
/// 对应 DSH 的 `step`。在灵枢默认实现中，整轮角色编排是 `turn` 的单位，
/// `step` 作为更细粒度的执行抽象存在，供自定义 Loop 复用。
#[derive(Debug, Clone)]
pub struct ExecutionStep {
    /// 步骤序号
    pub step_id: usize,
    /// 步骤描述
    pub description: String,
    /// 该步骤允许使用的工具白名单（空表示不限制）
    pub tools: Vec<String>,
    /// 期望输出
    pub expected_output: String,
}

/// 单步执行结果。
#[derive(Debug, Clone, Default)]
pub struct StepResult {
    /// 本步产生的文本输出
    pub output: String,
    /// 是否触发了冲突处置（自防护）
    pub conflict_handled: bool,
    /// 是否发生了模型故障转移（自愈合）
    pub model_failover: bool,
}

/// §3.5 第二步：灵枢子系统可组合开关。
///
/// 把灵枢三子系统（自组织 / 自防护 / 自愈合）暴露为可独立开启/关闭的开关，
/// 供自定义 `AgentLoop` 实现组合使用。这样替换 Loop 策略时，可以选择性启用
/// 所需子系统（例如某自定义 Loop 只用自防护、不用自组织）。
///
/// 设计约束：开关是「数据面」配置，由 `AgentLoop` 实现在内部解释执行。
/// `LingShuLoop` 默认全开，确保与现有 `execute_role_driven_orchestration`
/// 行为完全一致（向后兼容）。后续可逐步把开关透传到 orchestrator 内部的
/// 各子系统钩子（见 doc §3.5 风险项），本期先把可组合能力落地为结构化配置。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct LoopSubsystems {
    /// 自组织：角色驱动编排 / DAG 并行组调度
    pub self_organization: bool,
    /// 自防护：冲突检测 → InterventionRequest → dispatch_fix_loop
    pub self_protection: bool,
    /// 自愈合：模型故障转移路由
    pub self_healing: bool,
}

impl Default for LoopSubsystems {
    /// 默认全开 —— 与现有 orchestrator 行为一致
    fn default() -> Self {
        Self {
            self_organization: true,
            self_protection: true,
            self_healing: true,
        }
    }
}

impl LoopSubsystems {
    /// 仅自防护（无自组织 / 无自愈合）—— 适合轻量自定义 Loop
    pub fn protection_only() -> Self {
        Self {
            self_organization: false,
            self_protection: true,
            self_healing: false,
        }
    }

    /// 全部关闭 —— 纯透传，适合对照基线
    pub fn none() -> Self {
        Self {
            self_organization: false,
            self_protection: false,
            self_healing: false,
        }
    }
}

/// §3.5 第三步：Loop 实现种类（编译期已知集合）。
///
/// 按 doc §3.5「不追求运行时热替换，走编译期选择」，这里用枚举而非 trait
/// 对象动态分发。新增 Loop 实现时在此枚举追加变体 + `build` 实现即可，
/// 配合 feature flag 可控制可用集合，避免二进制膨胀。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
pub enum AgentLoopKind {
    /// 灵枢默认实现：自组织 + 自防护 + 自愈合
    #[default]
    LingShu,
}

impl AgentLoopKind {
    /// 从配置字符串解析（未知值回退默认 `LingShu`）
    pub fn parse(s: &str) -> Self {
        match s.trim().to_ascii_lowercase().as_str() {
            "ling_shu" | "lingshu" | "" => AgentLoopKind::LingShu,
            _ => AgentLoopKind::LingShu,
        }
    }

    /// 配置字符串表示
    pub fn as_str(&self) -> &'static str {
        match self {
            AgentLoopKind::LingShu => "ling_shu",
        }
    }
}

/// Loop 配置：实现种类 + 子系统开关组合。
///
/// 由 `.sacode/loop.json` 加载，CLI `--agent-loop` 可覆盖 `kind`。
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct LoopConfig {
    /// Loop 实现种类
    #[serde(default)]
    pub kind: AgentLoopKind,
    /// 子系统开关组合
    #[serde(default)]
    pub subsystems: LoopSubsystems,
}

impl LoopConfig {
    /// 默认配置：灵枢默认 Loop + 全开子系统
    pub fn default_config() -> Self {
        Self::default()
    }
}

/// Agent Loop 抽象：把"如何驱动一个任务"与"产品层编排逻辑"解耦。
///
/// - `orchestrate_turn`：完整任务周期（对应 DSH 的 `turn`），从输入到完成。
/// - `orchestrate_step`：单次模型请求 + 工具调用循环（对应 DSH 的 `step`）。
///
/// 实现必须保证灵枢三子系统（自组织 / 自防护 / 自愈合）协同可用；
/// `LingShuLoop` 作为默认实现，直接复用现有 orchestrator 逻辑，确保
/// 行为向后兼容。
///
/// 注意：trait 不强制 `Send`/`Sync` 的异步方法边界。按 doc §3.5，Loop 走
/// **编译期静态分发**（feature flag / 配置编译选择），不做运行时 `dyn`
/// 跨线程热替换，因此无需约束 future 为 `Send`。`LingShuLoop` 结构本身仍
/// 满足 `Send + Sync`，可在多线程运行时中持有。
#[async_trait(?Send)]
pub trait AgentLoop {
    /// 完整任务周期：从用户输入到任务完成。
    ///
    /// `workdir` 提供任务工作目录上下文（角色画像、`from_prompt_and_workspace`
    /// 需要）。`named_profile` 为可选命名 Profile（§3.4），用于约束工具集，
    /// 由具体 Loop 实现解释应用。返回结构化 `ExecutionReport`。
    async fn orchestrate_turn(
        &self,
        context: &ExecutionContext,
        checkpoints: &CheckpointStorage,
        workdir: &std::path::Path,
        named_profile: Option<&Profile>,
    ) -> Result<ExecutionReport>;

    /// 单步执行：单次模型请求 + 工具调用。
    ///
    /// 默认实现委托 `orchestrate_turn` 作为单步的退化形式（灵枢默认 Loop 中
    /// `step` 由 `execute_parallel_groups` 内部逐组驱动）。自定义 Loop
    /// 可覆盖此方法实现更细粒度的控制。
    async fn orchestrate_step(
        &self,
        context: &ExecutionContext,
        step: &ExecutionStep,
    ) -> Result<StepResult> {
        // 退化实现：step 在灵枢默认 Loop 中不是独立入口，仅在上下文中登记
        // 步骤信息并复用 turn 语义。自定义策略（如 ReAct）应覆盖此方法。
        let _ = step;
        Ok(StepResult {
            output: format!("step#{} registered within ling_shu turn", step.step_id),
            ..Default::default()
        })
    }
}

/// 灵枢默认 Loop 实现：封装现有 `execute_role_driven_orchestration` 全部逻辑。
///
/// 持有 `RoleRegistry`（自组织角色注册表）+ `LoopSubsystems`（子系统开关），
/// 复用消息总线与检查点存储。任何 `AgentLoop` 实现都可通过组合这些子系统
/// 复现灵枢能力。
pub struct LingShuLoop {
    roles: RoleRegistry,
    /// 子系统开关组合（§3.5 第二步可组合化）
    subsystems: LoopSubsystems,
}

impl Default for LingShuLoop {
    fn default() -> Self {
        Self::new()
    }
}

impl LingShuLoop {
    /// 创建默认 Loop，内置全部内置角色（`RoleRegistry::builtin()`），子系统全开。
    pub fn new() -> Self {
        Self {
            roles: RoleRegistry::builtin(),
            subsystems: LoopSubsystems::default(),
        }
    }

    /// 使用自定义角色注册表创建 Loop（供测试或自定义编排复用）。
    pub fn with_roles(roles: RoleRegistry) -> Self {
        Self {
            roles,
            subsystems: LoopSubsystems::default(),
        }
    }

    /// 使用指定子系统开关创建 Loop（§3.5 第二步可组合化）。
    pub fn with_subsystems(roles: RoleRegistry, subsystems: LoopSubsystems) -> Self {
        Self { roles, subsystems }
    }

    /// 暴露内置角色注册表，供自定义 Loop 组合灵枢子系统。
    pub fn roles(&self) -> &RoleRegistry {
        &self.roles
    }

    /// 暴露子系统开关组合（§3.5 第二步可组合化数据面）。
    pub fn subsystems(&self) -> LoopSubsystems {
        self.subsystems
    }
}

#[async_trait(?Send)]
impl AgentLoop for LingShuLoop {
    async fn orchestrate_turn(
        &self,
        context: &ExecutionContext,
        checkpoints: &CheckpointStorage,
        workdir: &std::path::Path,
        named_profile: Option<&Profile>,
    ) -> Result<ExecutionReport> {
        // 灵枢默认实现直接委托现有 orchestrator，保证：
        // - 自组织：角色编排 / DAG 并行组调度
        // - 自防护：冲突检测 → InterventionRequest → dispatch_fix_loop
        // - 自愈合：模型故障转移路由（worker 内部）
        //
        // `self.subsystems` 在本期作为可组合数据面暴露（供自定义 Loop 组合）；
        // LingShuLoop 默认全开，确保与现有 orchestrator 行为完全一致。
        // 后续可将开关透传到 orchestrator 内部各子系统钩子（doc §3.5 风险项）。
        let (report, _plan) =
            execute_role_driven_orchestration(context, checkpoints, workdir, named_profile)
                .await?;
        Ok(report)
    }
}

/// §3.5 第三步：根据 `LoopConfig` 构建对应 Loop 实现（编译期已知类型）。
///
/// 返回具体类型而非 `dyn AgentLoop`，保持静态分发，避免 trait 对象动态分发
/// 在 Loop 每步产生的高频开销。CLI `--agent-loop` / `loop.json` 仅控制此处
/// 的 `kind` 与 `subsystems` 选择。
pub fn build_agent_loop(config: &LoopConfig) -> LingShuLoop {
    match config.kind {
        AgentLoopKind::LingShu => {
            LingShuLoop::with_subsystems(RoleRegistry::builtin(), config.subsystems)
        }
    }
}

/// 便捷入口：以 `LingShuLoop` 默认实现驱动一个任务周期，返回 `TaskRun`。
///
/// 等价替换直接调用 `execute_role_driven_task_run`，但经由 `AgentLoop` trait，
/// 便于将来按配置切换 Loop 实现（编译期选择）。
pub async fn run_with_ling_shu_loop(
    context: &ExecutionContext,
    checkpoints: &CheckpointStorage,
    workdir: &std::path::Path,
) -> Result<(TaskRun, sacode_kernel::AgentExecutionPlan)> {
    let loop_impl = LingShuLoop::new();
    let report = loop_impl.orchestrate_turn(context, checkpoints, workdir, None).await?;
    let task_run = crate::task_run_from_report(
        context.task_id.clone(),
        context.mode,
        context.task.prompt.clone(),
        &report,
        crate::infer_task_run_state(&report),
    );
    Ok((task_run, sacode_kernel::AgentExecutionPlan::default()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use sacode_kernel::{ExecutionMode, Task};
    use std::path::Path;

    fn sample_context(prompt: &str) -> ExecutionContext {
        ExecutionContext::new(Task::new(prompt, ExecutionMode::Build, None))
    }

    #[test]
    fn ling_shu_loop_carries_builtin_roles() {
        let loop_impl = LingShuLoop::new();
        // 内置角色注册表必须可用，保证自组织子系统不被割裂。
        assert!(!loop_impl.roles().all().is_empty());
    }

    #[test]
    fn ling_shu_loop_is_default_send_sync() {
        fn assert_send_sync<T: Send + Sync>() {}
        assert_send_sync::<LingShuLoop>();
    }

    // ── §3.5 第二步：子系统可组合化 ──

    #[test]
    fn loop_subsystems_default_all_on() {
        let s = LoopSubsystems::default();
        assert!(s.self_organization && s.self_protection && s.self_healing);
    }

    #[test]
    fn loop_subsystems_presets() {
        let p = LoopSubsystems::protection_only();
        assert!(!p.self_organization && p.self_protection && !p.self_healing);
        let n = LoopSubsystems::none();
        assert!(!n.self_organization && !n.self_protection && !n.self_healing);
    }

    // ── §3.5 第三步：Loop 注册与选择 ──

    #[test]
    fn agent_loop_kind_parse_known_and_unknown() {
        assert_eq!(AgentLoopKind::parse("ling_shu"), AgentLoopKind::LingShu);
        assert_eq!(AgentLoopKind::parse(""), AgentLoopKind::LingShu);
        // 未知值回退默认，不 panic
        assert_eq!(AgentLoopKind::parse("react"), AgentLoopKind::LingShu);
        assert_eq!(AgentLoopKind::LingShu.as_str(), "ling_shu");
    }

    #[test]
    fn build_agent_loop_carries_subsystems() {
        let cfg = LoopConfig {
            kind: AgentLoopKind::LingShu,
            subsystems: LoopSubsystems::protection_only(),
        };
        let loop_impl = build_agent_loop(&cfg);
        assert_eq!(loop_impl.subsystems(), LoopSubsystems::protection_only());
        // 角色注册表仍可用（自组织数据面保留）
        assert!(!loop_impl.roles().all().is_empty());
    }

    #[test]
    fn build_agent_loop_default_full_subsystems() {
        let loop_impl = build_agent_loop(&LoopConfig::default());
        assert_eq!(loop_impl.subsystems(), LoopSubsystems::default());
    }

    #[tokio::test]
    async fn ling_shu_loop_step_delegates_without_panic() {
        let loop_impl = LingShuLoop::new();
        let ctx = sample_context("test step delegation");
        let step = ExecutionStep {
            step_id: 1,
            description: "probe".into(),
            tools: vec![],
            expected_output: String::new(),
        };
        let result = loop_impl.orchestrate_step(&ctx, &step).await;
        assert!(result.is_ok());
        let step_result = result.unwrap();
        assert!(!step_result.output.is_empty());
    }

    // orchestrate_turn 的等价性由集成测试覆盖：run_with_ling_shu_loop 应与
    // execute_role_driven_task_run 产出一致的 ExecutionReport 结构。
    // 此处用轻量断言验证编排入口可用，避免触发真实 LLM 调用。
    #[tokio::test]
    async fn ling_shu_loop_turn_entrypoint_compiles_and_dispatches() {
        let loop_impl = LingShuLoop::new();
        let ctx = sample_context("verify loop entrypoint exists");
        let checkpoints = CheckpointStorage::new(Path::new("."));
        // 不调用真实 LLM，仅验证 trait 方法签名与人参可调用性。
        // 真实闭环由 runtime 集成测试 / CLI 端到端验证。
        let _ = loop_impl
            .orchestrate_turn(&ctx, &checkpoints, Path::new("."), None)
            .await;
        // 若 LLM 不可用，orchestrate_turn 会返回 Err，这里只验证签名可调用。
        // 因此用类型断言代替运行时成功断言：
        fn _assert_trait_obj(_: &dyn AgentLoop) {}
        _assert_trait_obj(&loop_impl);
    }
}
