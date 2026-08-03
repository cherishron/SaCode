//! SaCode SDK — 极简调用入口
//!
//! 设计意图：把 SaCode 的核心能力（LLM 调用 + 工具执行 + 灵枢路由）
//! 封装成一行可调用的 API，便于嵌入式集成或 RPC 模式复用。
//!
//! 设计原则：
//! - **默认极简**：默认仅注入核心层工具（4 个），系统提示词压缩到最小，
//!   让 SDK 调用的 token 占用比裸调用 LLM 仅多出少量结构化开销。
//! - **复用既有路径**：底层调用 [`crate::executor::task_runner::execute_task_with_provider`]，
//!   不绕过灵枢的沙箱审计与工具执行链路。
//! - **可选扩展**：通过 [`SdkClient::with_full_tools`] / [`SdkClient::with_role`]
//!   等构建器方法切换到完整工具集 + 角色白名单 + 任务画像命中。
//!
//! # 典型用法
//!
//! ```no_run
//! use sacode_runtime::sdk::{SdkClient, SdkResult};
//!
//! # async fn run() -> anyhow::Result<()> {
//! // 1. 最简调用（核心层工具 + 默认配置）
//! let client = SdkClient::new(".".into()).await?;
//! let result: SdkResult = client.execute_task("读取 README.md 并总结").await?;
//! println!("{}", result.text);
//! # Ok(())
//! # }
//! ```

use std::path::{Path, PathBuf};
use std::sync::Arc;

use anyhow::{Context, Result};
use sacode_kernel::ExecutionMode;
use serde::{Deserialize, Serialize};

use crate::executor::task_runner::{
    AutoApproveDecider, LoggingErrorRecorder, TaskRunConfig, execute_task_with_provider,
};
use crate::model_routing::TaskProfile;
use crate::prompt::{PromptContext, build_system_prompt};
use crate::tools::{ToolLayer, ToolRegistry};

/// SDK 执行结果
///
/// 封装 [`crate::executor::task_runner::TaskRunResult`] 中面向调用方最关心的字段，
/// 避免把内部 `TaskRunResult` 直接暴露给 SDK 消费者。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SdkResult {
    /// LLM 最终响应文本（成功为模型回复，失败为错误描述）
    pub text: String,
    /// 是否成功
    pub success: bool,
    /// Token 使用量（若 provider 返回）
    #[serde(default)]
    pub usage: Option<UsageStats>,
    /// 是否达到轮次上限
    pub hit_round_limit: bool,
    /// 实际注入 prompt 的工具名列表
    pub injected_tools: Vec<String>,
    /// 注入是否被 token 预算裁剪
    pub budget_trimmed: bool,
    /// LLM API 耗时（毫秒）
    pub api_duration_ms: u64,
    /// 工具执行耗时（毫秒）
    pub tool_duration_ms: u64,
}

/// Token 使用量统计
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct UsageStats {
    #[serde(default)]
    pub prompt_tokens: u64,
    #[serde(default)]
    pub completion_tokens: u64,
    #[serde(default)]
    pub total_tokens: u64,
}

/// SDK 客户端构建器
///
/// 通过构建器模式逐步配置：工作目录 / 工具集 / 角色 / 任务画像 / token 预算。
/// 不显式配置时使用最省 token 的默认值。
pub struct SdkClient {
    workdir: PathBuf,
    mode: ExecutionMode,
    max_iterations: usize,
    /// 是否启用全部 26 个内置工具（默认 false：仅核心层）
    use_full_tools: bool,
    /// 角色白名单（若设置，扩展层仅注入角色 allowed_tools）
    role: Option<sacode_kernel::AgentRole>,
    /// 任务画像（若设置且无角色白名单，按 task_kinds 命中扩展工具）
    task_profile: Option<TaskProfile>,
    /// prompt token 预算（字符数近似，None 表示不限制）
    context_budget: Option<usize>,
    /// 额外附加到 system prompt 末尾的指令（可选）
    extra_instruction: Option<String>,
}

impl SdkClient {
    /// 创建 SDK 客户端
    ///
    /// `workdir` 是 SaCode 项目根目录（含 `.sacode/provider.json`）。
    /// 默认配置：
    /// - mode = Build
    /// - max_iterations = 5
    /// - 仅注入核心层 4 个工具
    /// - 无角色 / 无任务画像 / 无 token 预算
    pub async fn new(workdir: PathBuf) -> Result<Self> {
        Ok(Self {
            workdir,
            mode: ExecutionMode::Build,
            max_iterations: 5,
            use_full_tools: false,
            role: None,
            task_profile: None,
            context_budget: None,
            extra_instruction: None,
        })
    }

    /// 启用全部内置工具（核心 + 扩展，共 26 个）
    pub fn with_full_tools(mut self) -> Self {
        self.use_full_tools = true;
        self
    }

    /// 设置执行模式
    pub fn with_mode(mut self, mode: ExecutionMode) -> Self {
        self.mode = mode;
        self
    }

    /// 设置最大工具调用轮次
    pub fn with_max_iterations(mut self, n: usize) -> Self {
        self.max_iterations = n;
        self
    }

    /// 绑定角色（用于角色白名单与角色系统指令注入）
    pub fn with_role(mut self, role: sacode_kernel::AgentRole) -> Self {
        self.role = Some(role);
        self
    }

    /// 设置任务画像（仅在未设置角色白名单时生效）
    pub fn with_task_profile(mut self, profile: TaskProfile) -> Self {
        self.task_profile = Some(profile);
        self
    }

    /// 设置 prompt token 预算（字符数近似）
    ///
    /// 超出预算时按"核心 → 角色 → 任务命中"顺序裁剪扩展层工具。
    pub fn with_context_budget(mut self, budget_chars: usize) -> Self {
        self.context_budget = Some(budget_chars);
        self
    }

    /// 追加额外系统指令（拼接到系统 prompt 末尾）
    pub fn with_extra_instruction(mut self, instruction: impl Into<String>) -> Self {
        self.extra_instruction = Some(instruction.into());
        self
    }

    /// 执行单次任务
    ///
    /// 内部流程：
    /// 1. 解析 provider 候选（来自 `.sacode/provider.json`）
    /// 2. 通过 [`ToolRegistry::for_prompt`] 筛选注入工具
    /// 3. 构建系统 prompt（核心层最小 + 可选角色指令 + 可选额外指令）
    /// 4. 调用 [`execute_task_with_provider`]，沙箱审计与工具循环自动接管
    pub async fn execute_task(&self, prompt: &str) -> Result<SdkResult> {
        // 1. 构建 ToolRegistry（按是否启用全集决定起点）
        let mut tools = if self.use_full_tools {
            ToolRegistry::builtin()
        } else {
            ToolRegistry::core_tools()
        };

        // 加载 MCP 工具（若 .sacode/mcp.json 存在）
        let mcp_store = crate::McpConfigStore::new(self.workdir.as_path());
        let _ = crate::register_enabled_mcp_tools_sync(&mcp_store, &mut tools);

        // 2. 按 role / profile / budget 筛选注入工具
        let (injected_specs, budget_trimmed) = tools.for_prompt(
            self.role.as_ref(),
            self.task_profile.as_ref(),
            self.context_budget,
        );

        let injected_names: Vec<String> =
            injected_specs.iter().map(|s| s.name.clone()).collect();

        // 3. 构建 system prompt
        let tool_names_owned = injected_names.clone();
        let base_prompt = build_system_prompt(&PromptContext {
            workdir: &self.workdir,
            mode: self.mode,
            tool_names: &tool_names_owned,
        })
        .unwrap_or_default();

        let role_section = self.role.as_ref().map(|r| {
            format!(
                "\n\n[角色指令]\n你是 {}（{}）。\n{}",
                r.name, r.id, r.system_prompt
            )
        });

        let extra_section = self
            .extra_instruction
            .as_ref()
            .map(|s| format!("\n\n[额外指令]\n{}", s));

        // SDK 模式标识，方便 LLM 区分调用上下文
        let sdk_header = if self.use_full_tools {
            "[SDK Mode]\n通过 SaCode SDK 调用，工具集：全量。".to_string()
        } else {
            format!(
                "[SDK Mode]\n通过 SaCode SDK 调用，工具集：核心层 {} 个（{}）。",
                injected_names.len(),
                injected_names.join(", ")
            )
        };

        let system_prompt = format!(
            "{}\n\n{}{}{}",
            sdk_header,
            base_prompt,
            role_section.unwrap_or_default(),
            extra_section.unwrap_or_default(),
        );

        // 4. 解析 provider（取首个候选）
        let candidates = crate::resolve_config_model_candidates(&self.workdir);
        let provider = candidates
            .first()
            .map(|(_, _, p)| p.clone())
            .ok_or_else(|| {
                anyhow::anyhow!(
                    "未找到可用 provider，请先运行 `sacode init` 或在 .sacode/provider.json 配置"
                )
            })?;

        // 5. 构建 TaskRunConfig 并执行
        let config = TaskRunConfig {
            workdir: &self.workdir,
            mode: self.mode,
            max_iterations: self.max_iterations,
            system_prompt,
            user_prompt: prompt.to_string(),
            provider,
            tools,
            approval: Arc::new(AutoApproveDecider),
            error_recorder: Arc::new(LoggingErrorRecorder),
        };

        let result = execute_task_with_provider(&config, None).await;

        let text = result
            .response
            .clone()
            .unwrap_or_else(|err| format!("执行失败：{}", err));

        let usage = result.usage.as_ref().map(|u| UsageStats {
            prompt_tokens: u.prompt_tokens as u64,
            completion_tokens: u.completion_tokens as u64,
            total_tokens: u.total_tokens as u64,
        });

        Ok(SdkResult {
            text,
            success: result.response.is_ok(),
            usage,
            hit_round_limit: result.hit_round_limit,
            injected_tools: injected_names,
            budget_trimmed,
            api_duration_ms: result.api_duration_ms,
            tool_duration_ms: result.tool_duration_ms,
        })
    }

    /// 返回当前工作目录引用
    pub fn workdir(&self) -> &Path {
        &self.workdir
    }

    /// 返回当前注入工具的分层统计（用于诊断 / 监控）
    ///
    /// 返回 `(core_count, extended_count)`
    pub fn layer_stats(&self) -> (usize, usize) {
        // 不实际构建 registry，仅按 use_full_tools 估算
        if self.use_full_tools {
            let reg = ToolRegistry::builtin();
            (
                reg.specs_by_layer(ToolLayer::Core).len(),
                reg.specs_by_layer(ToolLayer::Extended).len(),
            )
        } else {
            (4, 0)
        }
    }
}

/// 便捷入口：在指定工作目录上执行单次任务
///
/// 等价于：
/// ```no_run
/// # use sacode_runtime::sdk::{SdkClient, SdkResult};
/// # async fn f() -> anyhow::Result<()> {
/// let result = SdkClient::new(".".into()).await?.execute_task("...").await?;
/// # Ok(())
/// # }
/// ```
pub async fn execute_task(workdir: PathBuf, prompt: &str) -> Result<SdkResult> {
    let client = SdkClient::new(workdir).await.context("创建 SdkClient 失败")?;
    client.execute_task(prompt).await
}
