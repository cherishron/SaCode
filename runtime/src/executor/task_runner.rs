//! 统一任务执行器 — 融合 LLM 调用、工具执行、审批策略、模型路由
//!
//! 从 `interfaces/cli/src/runner.rs` 提取核心执行逻辑到 runtime 层，
//! 使 orchestrator、session、daemon 等路径均可复用。

use std::path::Path;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

use anyhow::Result;
use sacode_kernel::model::{ChatUsage, ModelProvider, ToolDefinition};
use sacode_kernel::{
    Event, ExecutionMode, ExecutionReport, RouteRecord, RoutedModelRecord, TaskRun, TaskRunState,
};

use crate::provider::{ProviderClient, StreamChunkKind, ToolChatResult};
use crate::tools::{SideEffectLevel, ToolRegistry};
use crate::{task_run_from_report, FailoverContext, NodeScore, TaskProfile};

// ── 审批决策 trait ──────────────────────────────────────────────

/// 工具审批决策接口，解耦 CLI 层的 ApprovalPolicy 硬编码
pub trait ApprovalDecider: Send + Sync {
    /// 判断是否需要对工具调用进行交互式审批
    fn needs_interactive_approval(&self, tool_name: &str, mode: ExecutionMode) -> bool;

    /// 对需要审批的工具调用做出决策
    fn decide(
        &self,
        tool_name: &str,
        side_effect_level: SideEffectLevel,
        args: &serde_json::Value,
    ) -> ApprovalDecision;
}

/// 审批决策结果
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ApprovalDecision {
    /// 自动批准
    Approved,
    /// 自动拒绝
    Denied,
    /// 需要用户交互（返回 pending question）
    PromptUser {
        question: String,
        tool_name: String,
        side_effect_level: String,
        args: serde_json::Value,
    },
}

// ── 错误记录 trait ──────────────────────────────────────────────

/// 错误/经验记录接口，解耦 CLI 层的 MistakeBookStore
pub trait ErrorRecorder: Send + Sync {
    fn record_tool_error(&self, tool_name: &str, category: &str, detail: String);
    fn record_provider_error(&self, category: &str, detail: String);
}

// ── 流式输出回调 ────────────────────────────────────────────────

/// 流式输出事件类型
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StreamEventKind {
    Message,
    Thinking,
}

/// 流式输出回调 trait
pub trait StreamHandler: Send + 'static {
    fn handle(&mut self, kind: StreamEventKind, content: &str);
}

impl<F: FnMut(StreamEventKind, &str) + Send + 'static> StreamHandler for F {
    fn handle(&mut self, kind: StreamEventKind, content: &str) {
        self(kind, content)
    }
}

// ── 执行结果 ────────────────────────────────────────────────────

/// 统一任务执行结果
#[derive(Debug, Clone)]
pub struct TaskRunResult {
    /// 模型响应文本
    pub response: std::result::Result<String, String>,
    /// 待用户回答的问题
    pub pending_question: Option<serde_json::Value>,
    /// Token 使用量
    pub usage: Option<ChatUsage>,
    /// 是否达到轮次上限
    pub hit_round_limit: bool,
    /// LLM API 耗时（毫秒）
    pub api_duration_ms: u64,
    /// 工具执行耗时（毫秒）
    pub tool_duration_ms: u64,
    /// 任务运行状态
    pub state: TaskRunState,
    /// 任务运行快照
    pub task_run: TaskRun,
}

// ── 任务执行配置 ────────────────────────────────────────────────

/// 任务执行配置
pub struct TaskRunConfig<'a> {
    /// 工作目录
    pub workdir: &'a Path,
    /// 执行模式
    pub mode: ExecutionMode,
    /// 最大工具调用轮次
    pub max_iterations: usize,
    /// 系统提示词
    pub system_prompt: String,
    /// 用户提示词
    pub user_prompt: String,
    /// 主 Provider
    pub provider: ModelProvider,
    /// 工具注册表
    pub tools: ToolRegistry,
    /// 审批决策器
    pub approval: Arc<dyn ApprovalDecider>,
    /// 错误记录器
    pub error_recorder: Arc<dyn ErrorRecorder>,
    /// 统一 task_id（贯穿 CLI → task_runner → Checkpoint）
    ///
    /// None 表示入口未注入（如子 Agent 内部执行）；
    /// 非 None 时将写入 TaskRun.task_id，保证跨入口可关联。
    pub task_id: Option<String>,
}

// ── 核心执行逻辑 ────────────────────────────────────────────────

/// 执行单次 LLM + 工具调用
pub async fn execute_task_with_provider(
    config: &TaskRunConfig<'_>,
    stream_handler: Option<Box<dyn StreamHandler>>,
) -> TaskRunResult {
    let _total_started_at = Instant::now();
    let tool_defs = build_tool_definitions(&config.tools, config.mode);

    let (response, pending_question, usage, hit_round_limit, api_duration_ms, tool_duration_ms) =
        if config.provider.api_key.is_some()
            && config
                .provider
                .base_url
                .as_ref()
                .is_some_and(|v| !v.is_empty())
        {
            if tool_defs.is_empty() {
                execute_simple_chat(
                    &config.provider,
                    &config.user_prompt,
                    stream_handler,
                    config.error_recorder.as_ref(),
                )
                .await
            } else {
                execute_tool_chat(config, tool_defs, stream_handler).await
            }
        } else {
            (
                Err("没有可用的 provider 配置，请先运行 /login 或 sacode init".to_string()),
                None,
                None,
                false,
                0,
                0,
            )
        };

    let state = match pending_question.as_ref() {
        Some(q) if q.get("kind").and_then(|v| v.as_str()) == Some("tool_approval") => {
            TaskRunState::WaitingForApproval
        }
        Some(_) => TaskRunState::WaitingForUser,
        None if hit_round_limit => TaskRunState::Failed,
        None if response.is_ok() => TaskRunState::Completed,
        None => TaskRunState::Failed,
    };

    let mut report = ExecutionReport::default();
    report.final_output = response.as_ref().ok().cloned();
    if let Some(output) = response.as_ref().ok() {
        report.events.push(Event::Message {
            content: output.clone(),
        });
        report.events.push(Event::Done {
            summary: output.clone(),
        });
    }
    if let Some(error) = response.as_ref().err() {
        report.events.push(Event::Error {
            message: error.clone(),
        });
    }
    // 记录实际使用的路由信息（provider + model）
    if config.provider.api_key.is_some() {
        report.route_records.push(RouteRecord {
            task_id: config.task_id.clone().unwrap_or_default(),
            role_id: "main".to_string(),
            primary: RoutedModelRecord {
                provider_name: format!("{:?}", config.provider.kind),
                model_name: config.provider.model.clone(),
                ..RoutedModelRecord::default()
            },
            fallbacks: Vec::new(),
            route_reason: "single-agent default route".to_string(),
        });
    }

    let task_run = task_run_from_report(
        config.task_id.clone(),
        config.mode,
        config.user_prompt.clone(),
        &report,
        state.clone(),
    );

    TaskRunResult {
        response,
        pending_question,
        usage,
        hit_round_limit,
        api_duration_ms,
        tool_duration_ms,
        state,
        task_run,
    }
}

/// 执行带 Failover 的完整任务（主模型 → 备选模型切换）
pub async fn execute_task_with_failover(
    config: &TaskRunConfig<'_>,
    route_plan: Option<&crate::ModelRoutePlan>,
    candidates: &[(String, String, ModelProvider)],
    profile: &TaskProfile,
    stream_handler: Option<Box<dyn StreamHandler>>,
    model_health_recorder: Option<&dyn Fn(&Path, &str, &str, bool, Option<&str>)>,
) -> TaskRunResult {
    let primary_provider_name = route_plan
        .as_ref()
        .map(|p| p.primary.provider_name.clone())
        .unwrap_or_else(|| "default".to_string());
    let primary_model_name = route_plan
        .as_ref()
        .map(|p| p.primary.model_name.clone())
        .unwrap_or_else(|| config.provider.model.clone());

    // 执行主模型
    let mut result = execute_task_with_provider(config, stream_handler).await;

    // 记录主模型健康状态
    if let Some(recorder) = model_health_recorder {
        recorder(
            config.workdir,
            &primary_provider_name,
            &primary_model_name,
            result.response.is_ok(),
            result.response.as_ref().err().map(String::as_str),
        );
    }

    // Failover 循环
    let mut attempt_count = 0;
    let max_attempts = route_plan
        .as_ref()
        .map(|p| p.fallbacks.len() + 1)
        .unwrap_or(1);

    while attempt_count < max_attempts {
        let should_switch = if result.response.is_err() {
            true
        } else if let Ok(ref response) = result.response {
            let score = NodeScore::evaluate(None, response, &[], profile);
            match score.decision {
                crate::NodeDecision::SwitchModel => true,
                // WaitForUser / WaitForApproval：需要用户介入，不切换模型，直接退出
                crate::NodeDecision::WaitForUser | crate::NodeDecision::WaitForApproval => {
                    if result.pending_question.is_none() {
                        result.pending_question =
                            Some(serde_json::Value::String(score.reasons.join("; ")));
                    }
                    break;
                }
                // Fail：任务明确失败，不切换模型，直接退出
                crate::NodeDecision::Fail => break,
                crate::NodeDecision::Accept => false,
            }
        } else {
            false
        };

        if !should_switch || result.pending_question.is_some() {
            break;
        }

        attempt_count += 1;

        if let Some(plan) = route_plan {
            let fallback_index = attempt_count.saturating_sub(1);
            if let Some(fallback) = plan.fallbacks.get(fallback_index) {
                if let Some((_, _, fallback_provider)) = candidates
                    .iter()
                    .find(|(pn, mn, _)| pn == &fallback.provider_name && mn == &fallback.model_name)
                {
                    // 从已执行的工具记录中提取上下文（report 为 Option，需安全访问）
                    let tool_records: Vec<(Option<usize>, String, bool)> = result
                        .task_run
                        .report
                        .as_ref()
                        .map(|report| {
                            report
                                .tool_records
                                .iter()
                                .map(|record| {
                                    (record.step_id, record.tool_name.clone(), record.success)
                                })
                                .collect()
                        })
                        .unwrap_or_default();

                    let failover_context = FailoverContext {
                        original_task: config.user_prompt.clone(),
                        // 从已执行的工具记录中提取完成步骤
                        completed_steps: tool_records
                            .iter()
                            .filter(|(_, _, success)| *success)
                            .map(|(step_id, name, _)| format!("step {:?}: {}", step_id, name))
                            .collect(),
                        // 工具调用摘要（含成功/失败标记）
                        tool_summary: tool_records
                            .iter()
                            .map(|(_, name, success)| {
                                format!("{} ({})", name, if *success { "ok" } else { "fail" })
                            })
                            .collect(),
                        last_error: result.response.clone().err(),
                        low_score_reasons: vec!["node scored low, switching model".to_string()],
                        workspace_summary: profile.evidence.clone(),
                        // 从部分成功的响应中提取关键事实（前 500 字符）
                        retained_facts: result
                            .response
                            .as_ref()
                            .ok()
                            .map(|response| response.chars().take(500).collect::<String>())
                            .into_iter()
                            .collect(),
                    };
                    let failover_section = failover_context.to_prompt_section();
                    let augmented_prompt =
                        format!("{}\n\n{}", failover_section, config.user_prompt);

                    let fallback_config = TaskRunConfig {
                        user_prompt: augmented_prompt,
                        provider: fallback_provider.clone(),
                        ..config.clone_ref()
                    };

                    result = execute_task_with_provider(&fallback_config, None).await;

                    if let Some(recorder) = model_health_recorder {
                        recorder(
                            config.workdir,
                            &fallback.provider_name,
                            &fallback.model_name,
                            result.response.is_ok(),
                            result.response.as_ref().err().map(String::as_str),
                        );
                    }
                }
            }
        }
    }

    result
}

// ── 内部实现 ────────────────────────────────────────────────────

async fn execute_simple_chat(
    provider: &ModelProvider,
    user_prompt: &str,
    mut stream_handler: Option<Box<dyn StreamHandler>>,
    error_recorder: &dyn ErrorRecorder,
) -> (
    std::result::Result<String, String>,
    Option<serde_json::Value>,
    Option<ChatUsage>,
    bool,
    u64,
    u64,
) {
    let client = ProviderClient::new();
    let api_started_at = Instant::now();

    let result = if let Some(handler) = stream_handler.as_deref_mut() {
        client
            .simple_chat_streaming_with_usage(provider, user_prompt, |chunk| {
                if !chunk.done {
                    handler.handle(
                        match chunk.kind {
                            StreamChunkKind::Message => StreamEventKind::Message,
                            StreamChunkKind::Thinking => StreamEventKind::Thinking,
                        },
                        &chunk.content,
                    );
                }
            })
            .await
    } else {
        client.simple_chat_with_usage(provider, user_prompt).await
    };

    match result {
        Ok((text, usage)) => (
            Ok(text),
            None,
            usage,
            false,
            elapsed_ms(api_started_at.elapsed()),
            0,
        ),
        Err(error) => {
            error_recorder.record_provider_error("provider:chat", error.to_string());
            (
                Err(error.to_string()),
                None,
                None,
                false,
                elapsed_ms(api_started_at.elapsed()),
                0,
            )
        }
    }
}

#[allow(clippy::too_many_arguments)]
async fn execute_tool_chat(
    config: &TaskRunConfig<'_>,
    tool_defs: Vec<ToolDefinition>,
    mut stream_handler: Option<Box<dyn StreamHandler>>,
) -> (
    std::result::Result<String, String>,
    Option<serde_json::Value>,
    Option<ChatUsage>,
    bool,
    u64,
    u64,
) {
    let client = ProviderClient::new();
    let tools_clone = config.tools.clone();
    let provider_for_tools = config.provider.clone();
    let mode = config.mode;
    let approval = config.approval.clone();
    let error_recorder = config.error_recorder.clone();
    let error_recorder_outer = config.error_recorder.clone();
    let tool_duration = Arc::new(AtomicU64::new(0));

    let tool_duration_for_executor = tool_duration.clone();
    let tool_executor = move |name: &str, args: &serde_json::Value| -> Result<serde_json::Value> {
        let tool_started_at = Instant::now();
        let spec = tools_clone.get(name);
        let side_effect_level = spec
            .map(|s| s.side_effect_level)
            .unwrap_or(SideEffectLevel::Execute);
        let needs_approval =
            spec.map(|s| s.needs_approval()).unwrap_or(false) || name.starts_with("mcp.");
        let requires_prompt_approval = needs_approval && mode == ExecutionMode::Build;

        if requires_prompt_approval {
            let decision = approval.decide(name, side_effect_level, args);
            match decision {
                ApprovalDecision::Approved => {}
                ApprovalDecision::Denied => {
                    return Ok(serde_json::json!({ "error": "denied by policy" }))
                }
                ApprovalDecision::PromptUser {
                    question: _,
                    tool_name,
                    side_effect_level: level,
                    args: tool_args,
                } => {
                    return Ok(serde_json::json!({
                        "pending": true,
                        "kind": "tool_approval",
                        "question": format!("工具 {} 需要修改工作区，是否允许继续执行？", tool_name),
                        "options": [
                            { "label": "拒绝", "description": "取消这次修改操作" },
                            { "label": "允许一次", "description": "仅本次执行允许该修改操作" },
                            { "label": "本会话总是允许", "description": "本会话内后续修改操作都自动允许" }
                        ],
                        "multiple": false,
                        "tool_name": tool_name,
                        "side_effect_level": level,
                        "args": tool_args,
                    }));
                }
            }
        }

        if let Some(_spec) = spec {
            let tool_input = if matches!(name, "media.read" | "media.vision") {
                enrich_media_provider_args(args, &provider_for_tools)
            } else {
                args.clone()
            };
            let result = match tools_clone.execute(name, tool_input) {
                Ok(output) => Ok(if output.success {
                    output.data
                } else {
                    error_recorder.record_tool_error(
                        &format!("tool:{}", name),
                        "工具执行失败",
                        output.message.clone().unwrap_or_default(),
                    );
                    serde_json::json!({ "error": output.message.unwrap_or_default() })
                }),
                Err(error) => {
                    // 检查是否为权限受限错误，需要交互式审批
                    if mode == ExecutionMode::Build
                        && is_permission_restricted_error(&error.to_string())
                    {
                        let level_str = format_side_effect_level(side_effect_level);
                        tool_duration_for_executor
                            .fetch_add(elapsed_ms(tool_started_at.elapsed()), Ordering::Relaxed);
                        return Ok(serde_json::json!({
                            "pending": true,
                            "kind": "tool_approval",
                            "question": format!("工具 {} 当前因权限受限无法继续，是否请求用户授权后重试？", name),
                            "options": [
                                { "label": "拒绝", "description": "保持当前权限范围并结束这次操作" },
                                { "label": "允许一次", "description": "本次请求用户授权并继续执行当前操作" },
                                { "label": "本会话总是允许", "description": "本会话内遇到同类权限申请时都继续请求授权" }
                            ],
                            "multiple": false,
                            "tool_name": name,
                            "side_effect_level": level_str,
                            "args": args,
                            "error": error.to_string(),
                        }));
                    }
                    error_recorder.record_tool_error(
                        &format!("tool:{}", name),
                        "工具执行异常",
                        error.to_string(),
                    );
                    Ok(serde_json::json!({ "error": error.to_string() }))
                }
            };
            tool_duration_for_executor
                .fetch_add(elapsed_ms(tool_started_at.elapsed()), Ordering::Relaxed);
            result
        } else {
            tool_duration_for_executor
                .fetch_add(elapsed_ms(tool_started_at.elapsed()), Ordering::Relaxed);
            Ok(serde_json::json!({ "error": format!("unknown tool: {}", name) }))
        }
    };

    let api_started_at = Instant::now();
    let effective_max_iterations = config.max_iterations.max(1);
    let result = if let Some(handler) = stream_handler.as_deref_mut() {
        client
            .tool_chat_streaming(
                &config.provider,
                &config.system_prompt,
                &config.user_prompt,
                tool_defs,
                tool_executor,
                &mut |chunk| {
                    if !chunk.done {
                        handler.handle(
                            match chunk.kind {
                                StreamChunkKind::Message => StreamEventKind::Message,
                                StreamChunkKind::Thinking => StreamEventKind::Thinking,
                            },
                            &chunk.content,
                        );
                    }
                },
                effective_max_iterations,
            )
            .await
    } else {
        client
            .tool_chat(
                &config.provider,
                &config.system_prompt,
                &config.user_prompt,
                tool_defs,
                tool_executor,
                effective_max_iterations,
            )
            .await
    };

    match result {
        Ok(tool_result) => {
            let final_text = format_tool_chat_result(&tool_result, effective_max_iterations);
            (
                Ok(final_text),
                tool_result.pending_question,
                tool_result.usage,
                tool_result.hit_round_limit,
                elapsed_ms(api_started_at.elapsed()),
                tool_duration.load(Ordering::Relaxed),
            )
        }
        Err(error) => {
            error_recorder_outer.record_provider_error("provider:tool_chat", error.to_string());
            (
                Err(error.to_string()),
                None,
                None,
                false,
                elapsed_ms(api_started_at.elapsed()),
                tool_duration.load(Ordering::Relaxed),
            )
        }
    }
}

// ── 辅助函数 ────────────────────────────────────────────────────

/// 构建工具定义列表，Plan 模式下仅暴露只读工具
/// 如果传入 tool_names，仅包含指定工具；否则包含注册表中所有工具
pub fn build_tool_definitions(registry: &ToolRegistry, mode: ExecutionMode) -> Vec<ToolDefinition> {
    build_tool_definitions_filtered(registry, None, mode)
}

/// 构建工具定义列表（带工具名过滤）
pub fn build_tool_definitions_filtered(
    registry: &ToolRegistry,
    tool_names: Option<&[String]>,
    mode: ExecutionMode,
) -> Vec<ToolDefinition> {
    let mut defs = Vec::new();
    let names: Vec<&str> = if let Some(names) = tool_names {
        names.iter().map(|s| s.as_str()).collect()
    } else {
        registry.names()
    };
    for name in names {
        if let Some(spec) = registry.get(name) {
            if mode == ExecutionMode::Plan {
                let plan_allowed = spec.side_effect_level == SideEffectLevel::ReadOnly
                    || matches!(name, "fs.search" | "web.search");
                if !plan_allowed {
                    continue;
                }
            }
            defs.push(spec.to_tool_definition());
        }
    }
    defs
}

/// 为 media 工具注入当前 provider 信息
pub fn enrich_media_provider_args(
    args: &serde_json::Value,
    provider: &ModelProvider,
) -> serde_json::Value {
    let mut enriched = args.clone();
    let Some(object) = enriched.as_object_mut() else {
        return enriched;
    };

    if !object.contains_key("model") {
        object.insert(
            "model".to_string(),
            serde_json::Value::String(provider.model.clone()),
        );
    }
    if !object.contains_key("base_url") {
        if let Some(base_url) = provider.base_url.as_ref().filter(|v| !v.is_empty()) {
            object.insert(
                "base_url".to_string(),
                serde_json::Value::String(base_url.clone()),
            );
        }
    }
    if !object.contains_key("api_key") {
        if let Some(api_key) = provider.api_key.as_ref().filter(|v| !v.is_empty()) {
            object.insert(
                "api_key".to_string(),
                serde_json::Value::String(api_key.clone()),
            );
        }
    }

    enriched
}

/// 格式化 ToolChatResult 的最终输出文本
fn format_tool_chat_result(result: &ToolChatResult, max_iterations: usize) -> String {
    if result.hit_round_limit {
        let summary = if result.final_text.trim().is_empty() {
            "我已经安全停止当前循环，但模型没有返回可展示的最终文本。请基于最近一次工具结果继续缩小任务范围后重试。".to_string()
        } else {
            result.final_text.trim().to_string()
        };

        // 区分「迭代耗尽」与「工具持续失败」：若最后一轮工具报错，说明任务中断更可能是
        // 工具执行失败（如权限/访问拒绝）所致，而非单纯轮次用尽，给出更明确的归因与指引。
        let failure_note = result.last_tool_error.as_ref().map(|err| {
            let mut note = format!(
                "注意：任务在多轮工具调用中持续遇到错误而停止（并非单纯迭代耗尽）。最后错误：{}",
                err
            );
            let hint = tool_error_hint(err);
            if !hint.is_empty() {
                note.push_str("\n\n");
                note.push_str(&hint);
            }
            note
        });

        match failure_note {
            Some(note) => format!(
                "本次任务达到最大迭代次数 {}，我已停止继续自动调用工具。\n\n{}\n\n{}",
                max_iterations, note, summary
            ),
            None => format!(
                "本次任务达到最大迭代次数 {}，我已停止继续自动调用工具。\n\n{}",
                max_iterations, summary
            ),
        }
    } else if result.final_text.trim().is_empty() {
        "工具调用已完成，但模型未生成总结，已返回工具结果摘要。".to_string()
    } else {
        result.final_text.trim().to_string()
    }
}

/// 判断错误是否为权限受限
pub fn is_permission_restricted_error(error: &str) -> bool {
    let lowered = error.to_lowercase();
    [
        "denied by policy",
        "permission denied",
        "blocked by sandbox policy",
        "network access blocked by sandbox policy",
        "path is blocked by sandbox policy",
        "working directory is blocked by sandbox policy",
        "outside workspace",
    ]
    .iter()
    .any(|needle| lowered.contains(needle))
}

/// 判断错误是否为「访问被拒绝」类（含 Windows `os error 5` / 中文「拒绝访问」/
/// POSIX `Permission denied`），用于给出更明确的平台指引。
pub fn is_access_denied_error(error: &str) -> bool {
    let lowered = error.to_lowercase();
    lowered.contains("permission denied")
        || lowered.contains("拒绝访问")
        || lowered.contains("access is denied")
        || lowered.contains("eaccess")
        || lowered.contains("os error 5")
}

/// 为工具执行错误生成针对性的排查指引（特别是 Windows 访问拒绝场景）。
fn tool_error_hint(error: &str) -> String {
    if is_access_denied_error(error) {
        [
            "这通常是 Windows 访问被拒绝（os error 5 / ERROR_ACCESS_DENIED）：",
            "• 目标路径在受保护目录（如 C:\\Windows、Program Files），请改用工作区内的目录；",
            "• 文件可能被 IDE / 杀毒软件 / 其他进程独占锁定，请关闭占用程序后重试；",
            "• 若通过 shell.exec 执行命令，需要管理员权限的操作请改用普通用户可写路径；",
            "• 可尝试将任务目标目录移到项目工作区内，避免跨盘符 / 系统目录。",
        ]
        .join("\n")
    } else if is_permission_restricted_error(error) {
        "这是沙箱策略拦截（路径 / 网络 / 工作目录受限）。请检查目标是否在允许范围内，或通过配置放宽沙箱策略。".to_string()
    } else {
        String::new()
    }
}

/// 格式化副作用级别
pub fn format_side_effect_level(level: SideEffectLevel) -> &'static str {
    match level {
        SideEffectLevel::ReadOnly => "read_only",
        SideEffectLevel::Modify => "modify",
        SideEffectLevel::Execute => "execute",
    }
}

fn elapsed_ms(duration: Duration) -> u64 {
    duration.as_millis().min(u128::from(u64::MAX)) as u64
}

// ── TaskRunConfig 辅助方法 ──────────────────────────────────────

impl TaskRunConfig<'_> {
    /// 创建一个引用相同配置但替换 provider 和 user_prompt 的新配置
    /// 用于 Failover 场景
    fn clone_ref(&self) -> TaskRunConfig<'_> {
        TaskRunConfig {
            workdir: self.workdir,
            mode: self.mode,
            max_iterations: self.max_iterations,
            system_prompt: self.system_prompt.clone(),
            user_prompt: self.user_prompt.clone(),
            provider: self.provider.clone(),
            tools: self.tools.clone(),
            approval: self.approval.clone(),
            error_recorder: self.error_recorder.clone(),
            task_id: self.task_id.clone(),
        }
    }
}

// ── 内置 ApprovalDecider 实现 ───────────────────────────────────

/// 自动批准所有操作的审批器（用于 Plan 模式或受信任场景）
pub struct AutoApproveDecider;

impl ApprovalDecider for AutoApproveDecider {
    fn needs_interactive_approval(&self, _tool_name: &str, _mode: ExecutionMode) -> bool {
        false
    }

    fn decide(
        &self,
        _tool_name: &str,
        _side_effect_level: SideEffectLevel,
        _args: &serde_json::Value,
    ) -> ApprovalDecision {
        ApprovalDecision::Approved
    }
}

/// 自动拒绝所有 Modify 级别操作的审批器
pub struct AutoDenyDecider;

impl ApprovalDecider for AutoDenyDecider {
    fn needs_interactive_approval(&self, tool_name: &str, mode: ExecutionMode) -> bool {
        mode == ExecutionMode::Build && !tool_name.starts_with("mcp.")
    }

    fn decide(
        &self,
        _tool_name: &str,
        _side_effect_level: SideEffectLevel,
        _args: &serde_json::Value,
    ) -> ApprovalDecision {
        ApprovalDecision::Denied
    }
}

/// 交互式审批器（返回 pending question，由调用方处理用户交互）
pub struct PromptUserDecider;

impl ApprovalDecider for PromptUserDecider {
    fn needs_interactive_approval(&self, tool_name: &str, mode: ExecutionMode) -> bool {
        mode == ExecutionMode::Build && !tool_name.starts_with("mcp.")
    }

    fn decide(
        &self,
        tool_name: &str,
        side_effect_level: SideEffectLevel,
        args: &serde_json::Value,
    ) -> ApprovalDecision {
        ApprovalDecision::PromptUser {
            question: format!("工具 {} 需要修改工作区，是否允许继续执行？", tool_name),
            tool_name: tool_name.to_string(),
            side_effect_level: format_side_effect_level(side_effect_level).to_string(),
            args: args.clone(),
        }
    }
}

// ── 内置 ErrorRecorder 实现 ─────────────────────────────────────

/// 空操作错误记录器（不记录任何错误）
pub struct NoopErrorRecorder;

impl ErrorRecorder for NoopErrorRecorder {
    fn record_tool_error(&self, _tool_name: &str, _category: &str, _detail: String) {}
    fn record_provider_error(&self, _category: &str, _detail: String) {}
}

/// 日志错误记录器（仅输出到 tracing）
pub struct LoggingErrorRecorder;

impl ErrorRecorder for LoggingErrorRecorder {
    fn record_tool_error(&self, tool_name: &str, category: &str, detail: String) {
        tracing::warn!(
            "[TaskRunner] tool error: {} - {}: {}",
            tool_name,
            category,
            detail
        );
    }

    fn record_provider_error(&self, category: &str, detail: String) {
        tracing::warn!("[TaskRunner] provider error: {} - {}", category, detail);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::provider::client::ToolChatResult;

    fn base_result() -> ToolChatResult {
        ToolChatResult {
            messages: vec![],
            final_text: String::new(),
            reasoning_content: None,
            tool_calls_made: 0,
            rounds: 3,
            usage: None,
            pending_question: None,
            hit_round_limit: true,
            last_tool_error: None,
        }
    }

    #[test]
    fn format_tool_chat_result_plain_round_limit_no_error() {
        let r = base_result();
        let out = format_tool_chat_result(&r, 3);
        assert!(out.contains("达到最大迭代次数 3"));
        // 无工具错误时不应出现「持续遇到错误」归因
        assert!(!out.contains("并非单纯迭代耗尽"));
    }

    #[test]
    fn format_tool_chat_result_detects_persistent_tool_failure() {
        let mut r = base_result();
        r.last_tool_error = Some("something broke".to_string());
        let out = format_tool_chat_result(&r, 3);
        assert!(out.contains("达到最大迭代次数 3"));
        assert!(out.contains("并非单纯迭代耗尽"));
        assert!(out.contains("最后错误：something broke"));
    }

    #[test]
    fn format_tool_chat_result_gives_windows_access_denied_hint() {
        let mut r = base_result();
        r.last_tool_error = Some("拒绝访问。 (os error 5)".to_string());
        let out = format_tool_chat_result(&r, 3);
        assert!(out.contains("并非单纯迭代耗尽"));
        // Windows 访问拒绝指引应包含受保护目录提示
        assert!(out.contains("受保护目录") || out.contains("C:\\Windows"));
    }

    #[test]
    fn is_access_denied_error_recognizes_os_error_5_and_posix() {
        assert!(is_access_denied_error("拒绝访问。 (os error 5)"));
        assert!(is_access_denied_error("Permission denied (os error 13)"));
        assert!(!is_access_denied_error("connection timed out"));
    }

    #[test]
    fn tool_error_hint_empty_for_unrelated_error() {
        assert!(tool_error_hint("connection timed out").is_empty());
    }
}
