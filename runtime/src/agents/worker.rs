//! 子 Agent 执行器 — 使用统一 TaskExecutor 调用 LLM
//!
//! 重构后，run_sub_agent 通过 TaskExecutor 真正调用 LLM + 工具执行，
//! 而非使用 kernel 层的占位 PlannerAgent/Supervisor。

use std::collections::HashMap;
use std::sync::OnceLock;

use regex::Regex;
use sacode_kernel::{
    AgentRole, ExecutionMode, SubAgentResult, SubAgentTask,
};

use super::message_bus::{AgentMailboxHandle, AgentMessage, AgentMessageKind};
use super::model_router::{resolve_role_route, ResolvedRoleRoute};
use crate::executor::task_runner::{
    AutoApproveDecider, LoggingErrorRecorder, TaskRunConfig,
    execute_task_with_failover,
};
use crate::model_routing::TaskProfile;
use crate::prompt::{build_system_prompt, PromptContext};
use crate::tools::ToolRegistry;
use crate::McpConfigStore;

/// 单次 worker 执行允许发出的协助请求数上限，用于死锁防护
const MAX_ASSIST_REQUESTS_PER_RUN: usize = 1;

/// 协助请求标记正则：`[ASSIST_REQUEST:role_id] 内容 [/ASSIST_REQUEST]`
fn assist_request_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| {
        Regex::new(r"\[ASSIST_REQUEST:([a-zA-Z0-9_-]+)\]\s*([\s\S]*?)\[/ASSIST_REQUEST\]")
            .expect("invalid assist_request regex")
    })
}

/// 协助响应标记正则：`[ASSIST_RESPONSE:role_id] 内容 [/ASSIST_RESPONSE]`
fn assist_response_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| {
        Regex::new(r"\[ASSIST_RESPONSE:([a-zA-Z0-9_-]+)\]\s*([\s\S]*?)\[/ASSIST_RESPONSE\]")
            .expect("invalid assist_response regex")
    })
}

#[derive(Debug, Clone)]
pub struct WorkerRunResult {
    pub task: SubAgentTask,
    pub role: AgentRole,
    pub result: SubAgentResult,
    pub events: Vec<sacode_kernel::Event>,
    pub resolved_route: Option<ResolvedRoleRoute>,
    pub resolved_model_summary: String,
}

/// 执行子 Agent 任务 — 通过统一 TaskExecutor 调用 LLM
///
/// 核心变化：不再使用 kernel 层的 PlannerAgent/Supervisor 占位逻辑，
/// 而是通过 TaskExecutor 真正发起 LLM 调用 + 工具执行循环。
///
/// 灵枢 · Agent Teams：通过 `mailbox` 参数接收邮箱句柄，使子 Agent 能够：
/// - 执行前消费前序 Agent 的进度消息，注入到系统提示词作为协作上下文
/// - 执行后发布自身结果摘要到消息总线，供后续 Agent 消费
/// - 执行后检测输出中的协助请求/响应标记，发送定向消息（阶段三）
///
/// `role_task_map`：role_id → task_id 映射，用于将输出中的协助请求标记
/// （target=role_id）转换为 mailbox 的目标 task_id。
pub async fn run_sub_agent(
    task: SubAgentTask,
    role: AgentRole,
    profile: &TaskProfile,
    workdir: &std::path::Path,
    mut mailbox: Option<AgentMailboxHandle>,
    role_task_map: &HashMap<String, String>,
) -> WorkerRunResult {
    let resolved_route = resolve_role_route(workdir, &role, profile);
    let resolved_model_summary = resolved_route
        .as_ref()
        .map(|route| route.summary.clone())
        .unwrap_or_else(|| resolve_role_model_summary(&role));

    // 构建角色专属系统提示词
    let role_instruction = build_role_system_instruction(&role);

    // 构建工具注册表
    let mut tools = ToolRegistry::builtin_with_wasm(workdir);
    let mcp_store = McpConfigStore::new(workdir);
    let _ = crate::register_enabled_mcp_tools_sync(&mcp_store, &mut tools);

    // 灵枢 · 上下文优化：按角色 + 任务画像筛选注入 prompt 的工具 schema
    // 工具仍全量注册在 registry 中（确保可执行），仅 prompt 注入做分层筛选
    let (injected_specs, _budget_trimmed) = tools.for_prompt(Some(&role), Some(profile), None);
    let tool_names: Vec<String> = injected_specs
        .iter()
        .map(|spec| spec.name.to_string())
        .collect();

    // 构建系统提示词：角色指令 + 基础系统提示
    let base_system_prompt = build_system_prompt(&PromptContext {
        workdir,
        mode: ExecutionMode::Build,
        tool_names: &tool_names,
    })
    .unwrap_or_default();

    // 灵枢 · Agent Teams：消费前序 Agent 的消息，注入协作上下文
    // 后续组的子 Agent 能看到前序组的执行进度和结果摘要
    // 阶段三：区分消息类型，RequestAssist/AssistResponse 注入特殊提示
    let peer_context = if let Some(ref mut mailbox) = mailbox {
        let messages = mailbox.try_recv_all().await;
        if messages.is_empty() {
            String::new()
        } else {
            build_peer_context(&messages, &role.id)
        }
    } else {
        String::new()
    };

    let system_prompt = format!("{}\n\n{}{}", role_instruction, base_system_prompt, peer_context);

    // 解析模型候选
    let candidates = super::model_router::resolve_config_model_candidates(workdir);

    // 确定主 Provider
    let primary_provider = resolved_route
        .as_ref()
        .and_then(|route| {
            candidates
                .iter()
                .find(|(pn, mn, _)| {
                    pn == &route.plan.primary.provider_name
                        && mn == &route.plan.primary.model_name
                })
                .map(|(_, _, provider)| provider.clone())
        })
        .or_else(|| {
            // 回退：使用第一个候选
            candidates.first().map(|(_, _, provider)| provider.clone())
        });

    let provider = match primary_provider {
        Some(provider) => provider,
        None => {
            // 无可用 provider，返回失败结果
            return WorkerRunResult {
                result: SubAgentResult {
                    id: task.id.clone(),
                    success: false,
                    output: "无可用模型配置，子 Agent 无法执行".to_string(),
                },
                task,
                role,
                events: vec![
                    sacode_kernel::Event::error("无可用模型配置"),
                ],
                resolved_route,
                resolved_model_summary,
            };
        }
    };

    // 构建 TaskRunConfig
    let config = TaskRunConfig {
        workdir,
        mode: ExecutionMode::Build,
        max_iterations: 5, // 子 Agent 使用较少迭代次数
        system_prompt,
        user_prompt: task.prompt.clone(),
        provider,
        tools,
        approval: std::sync::Arc::new(AutoApproveDecider), // 子 Agent 自动批准
        error_recorder: std::sync::Arc::new(LoggingErrorRecorder), // 仅日志记录
        task_id: None, // 子 Agent 内部执行，不注入统一 task_id
    };

    // 通过统一 TaskExecutor 执行（含 Failover）
    // 灵枢 · 自愈合：子 Agent 执行结果反馈到模型健康缓存，闭合路由自愈回路
    let health_recorder =
        |workdir: &std::path::Path,
         provider_name: &str,
         model_name: &str,
         success: bool,
         error: Option<&str>| {
            super::model_router::record_model_health(
                workdir,
                provider_name,
                model_name,
                success,
                error,
            );
        };

    let task_run_result = execute_task_with_failover(
        &config,
        resolved_route.as_ref().map(|r| &r.plan),
        &candidates,
        profile,
        None, // 子 Agent 暂不支持流式输出
        Some(&health_recorder), // 记录模型健康，闭合自愈合回路
    )
    .await;

    // 构建事件序列
    let mut events = vec![sacode_kernel::Event::message(format!(
        "子 Agent [{}] 开始处理任务：{}",
        role.id, task.title
    ))];
    events.push(sacode_kernel::Event::thinking(format!(
        "角色模型策略：{}",
        resolved_model_summary
    )));

    let success = task_run_result.response.is_ok();
    let output_text = task_run_result
        .response
        .unwrap_or_else(|error| format!("执行失败：{}", error));

    if success {
        events.push(sacode_kernel::Event::done(format!(
            "子 Agent [{}] 完成任务：{}",
            role.id, task.title
        )));
    } else {
        events.push(sacode_kernel::Event::error(format!(
            "子 Agent [{}] 执行失败：{}",
            role.id, task.title
        )));
    }

    let summary = build_role_summary_from_result(&role, &output_text, success);

    // 灵枢 · Agent Teams：发布自身执行结果摘要到消息总线，供后续 Agent 消费
    // 后续组的子 Agent 在执行前会通过 mailbox.try_recv_all() 消费此消息
    if let Some(mailbox) = mailbox {
        let status_label = if success { "完成" } else { "失败" };
        let summary_text = truncate_summary(&output_text);
        mailbox
            .broadcast(
                AgentMessageKind::ProgressSync,
                format!(
                    "角色 [{}] 任务 [{}] {}：{}",
                    role.id, task.title, status_label, summary_text
                ),
            )
            .await;

        // 灵枢 · Agent Teams 阶段三：检测输出中的协助请求/响应标记
        // 通过标记将请求/响应转换为定向消息，实现 agent 间双向协作
        // 死锁防护：单次执行最多发送 MAX_ASSIST_REQUESTS_PER_RUN 个协助请求
        let assist_requests = extract_assist_requests(&output_text);
        let assist_responses = extract_assist_responses(&output_text);

        let mut sent_requests = 0usize;
        for (target_role_id, content) in &assist_requests {
            if sent_requests >= MAX_ASSIST_REQUESTS_PER_RUN {
                tracing::warn!(
                    "角色 [{}] 单次执行协助请求已达上限 {}，忽略对 [{}] 的请求",
                    role.id,
                    MAX_ASSIST_REQUESTS_PER_RUN,
                    target_role_id
                );
                break;
            }
            if let Some(target_task_id) = role_task_map.get(target_role_id) {
                let sent = mailbox
                    .send_to(
                        target_task_id,
                        AgentMessageKind::RequestAssist,
                        content.clone(),
                    )
                    .await;
                if sent {
                    sent_requests += 1;
                    tracing::info!(
                        "角色 [{}] 向 [{}] 发送协助请求",
                        role.id,
                        target_role_id
                    );
                }
            } else {
                tracing::warn!(
                    "角色 [{}] 的协助请求目标 [{}] 未在 role_task_map 中找到",
                    role.id,
                    target_role_id
                );
            }
        }

        // 协助响应不限制数量（是回应已有请求，不会引发循环）
        for (target_role_id, content) in &assist_responses {
            if let Some(target_task_id) = role_task_map.get(target_role_id) {
                mailbox
                    .send_to(
                        target_task_id,
                        AgentMessageKind::AssistResponse,
                        content.clone(),
                    )
                    .await;
                tracing::info!(
                    "角色 [{}] 向 [{}] 发送协助响应",
                    role.id,
                    target_role_id
                );
            }
        }
    }

    WorkerRunResult {
        result: SubAgentResult {
            id: task.id.clone(),
            success,
            output: summary,
        },
        task,
        role,
        events,
        resolved_route,
        resolved_model_summary,
    }
}

/// 构建角色专属系统指令
fn build_role_system_instruction(role: &AgentRole) -> String {
    let mut instruction = format!(
        "[角色指令]\n你是 {}（{}）。\n{}",
        role.name, role.id, role.system_prompt
    );

    if !role.responsibilities.is_empty() {
        instruction.push_str("\n\n[职责]\n");
        for resp in &role.responsibilities {
            instruction.push_str(&format!("- {}\n", resp));
        }
    }

    if !role.preferred_context.is_empty() {
        instruction.push_str("\n\n[关注领域]\n");
        for ctx in &role.preferred_context {
            instruction.push_str(&format!("- {}\n", ctx));
        }
    }

    if !role.deliverables.is_empty() {
        instruction.push_str("\n\n[交付物]\n");
        for d in &role.deliverables {
            instruction.push_str(&format!("- {}\n", d));
        }
    }

    instruction
}

fn resolve_role_model_summary(role: &AgentRole) -> String {
    let provider = role
        .model_policy
        .provider
        .clone()
        .unwrap_or_else(|| "auto".to_string());
    let primary_model = role
        .model_policy
        .primary_model
        .clone()
        .unwrap_or_else(|| "auto".to_string());
    let thinking = role
        .model_policy
        .thinking
        .map(|value| value.to_string())
        .unwrap_or_else(|| "auto".to_string());
    let reasoning_effort = role
        .model_policy
        .reasoning_effort
        .clone()
        .unwrap_or_else(|| "auto".to_string());

    format!(
        "provider={}, model={}, thinking={}, reasoning_effort={}, auto_route={}",
        provider, primary_model, thinking, reasoning_effort, role.model_policy.auto_route
    )
}

/// 从 TaskExecutor 结果构建角色摘要
fn build_role_summary_from_result(role: &AgentRole, output: &str, success: bool) -> String {
    let has_failure_signal = !success || contains_failure_signal(output);

    match role.id.as_str() {
        "system-architect" => format!(
            "{}。架构结论：{}",
            if has_failure_signal {
                "架构风险已识别"
            } else {
                "架构结论已整理"
            },
            truncate_summary(output)
        ),
        "repo-explorer" => format!(
            "{}。探索结论：{}",
            if has_failure_signal {
                "仓库阻塞线索已识别"
            } else {
                "仓库线索已整理"
            },
            truncate_summary(output)
        ),
        "implementer" => format!(
            "{}。实现结论：{}",
            if has_failure_signal {
                "实现阻塞已识别"
            } else {
                "实现结果已整理"
            },
            truncate_summary(output)
        ),
        "test-engineer" => format!(
            "{}。测试结论：{}",
            if has_failure_signal {
                "验证风险已识别"
            } else {
                "验证结果已整理"
            },
            truncate_summary(output)
        ),
        "code-reviewer" => format!(
            "{}。审查结论：{}",
            if has_failure_signal {
                "审查风险已识别"
            } else {
                "审查结果已整理"
            },
            truncate_summary(output)
        ),
        "devops-operator" => format!(
            "{}。交付结论：{}",
            if has_failure_signal {
                "交付阻塞已识别"
            } else {
                "交付检查已整理"
            },
            truncate_summary(output)
        ),
        "reporter" => format!(
            "{}。主结论：{}",
            if has_failure_signal {
                "汇总风险已生成"
            } else {
                "汇总结论已生成"
            },
            truncate_summary(output)
        ),
        "requirement-analyst" => format!(
            "{}。需求结论：{}",
            if has_failure_signal {
                "需求风险已识别"
            } else {
                "需求约束已整理"
            },
            truncate_summary(output)
        ),
        _ => format!(
            "{}。执行结论：{}",
            if has_failure_signal {
                "执行风险已识别"
            } else {
                "执行结果已整理"
            },
            truncate_summary(output)
        ),
    }
}

fn truncate_summary(text: &str) -> &str {
    // 截取前 500 字符作为摘要
    if text.len() > 500 {
        let end = text.char_indices().take(500).last().map(|(i, _)| i).unwrap_or(text.len());
        &text[..end]
    } else {
        text
    }
}

fn contains_failure_signal(text: &str) -> bool {
    let normalized = text.to_lowercase();
    [
        "失败",
        "错误",
        "阻塞",
        "风险",
        "回归",
        "冲突",
        "failed",
        "error",
        "blocked",
        "risk",
        "regression",
        "conflict",
    ]
    .iter()
    .any(|signal| normalized.contains(signal))
}

// ── 灵枢 · Agent Teams 阶段三：消息上下文构建与标记解析 ──────────

/// 根据消息类型构建协作上下文文本，注入到系统提示词
///
/// 不同消息类型使用不同的提示模板，帮助当前 Agent 理解消息意图：
/// - RequestAssist：其他 Agent 在请求当前 Agent 的协助
/// - AssistResponse：其他 Agent 对当前 Agent 之前请求的回应
/// - ProgressSync/Discovery/ConflictWarning：前序 Agent 的进度与发现
fn build_peer_context(messages: &[AgentMessage], current_role_id: &str) -> String {
    let mut context = String::from("\n\n[前序 Agent 协作上下文]\n");
    for msg in messages {
        match msg.kind {
            AgentMessageKind::RequestAssist => {
                // 如果是发给当前角色的请求（to 是当前 agent_id），
                // 注入明确的协助请求提示
                context.push_str(&format!(
                    "- [协助请求] 来自 [{}]：{}\n",
                    msg.from, msg.content
                ));
                context.push_str(&format!(
                    "  请在输出中使用 [ASSIST_RESPONSE:{}] 提供你的回应。[/ASSIST_RESPONSE]\n",
                    msg.from
                ));
            }
            AgentMessageKind::AssistResponse => {
                context.push_str(&format!(
                    "- [协助响应] 来自 [{}]：{}\n",
                    msg.from, msg.content
                ));
            }
            AgentMessageKind::ConflictWarning => {
                context.push_str(&format!(
                    "- [冲突预警] 来自 [{}]：{}\n",
                    msg.from, msg.content
                ));
            }
            AgentMessageKind::Discovery => {
                context.push_str(&format!(
                    "- [发现共享] 来自 [{}]：{}\n",
                    msg.from, msg.content
                ));
            }
            AgentMessageKind::ProgressSync => {
                context.push_str(&format!(
                    "- [进度同步] 来自 [{}]：{}\n",
                    msg.from, msg.content
                ));
            }
            AgentMessageKind::Custom(ref name) => {
                context.push_str(&format!(
                    "- [{}] 来自 [{}]：{}\n",
                    name, msg.from, msg.content
                ));
            }
            AgentMessageKind::TaskDelegate => {
                context.push_str(&format!(
                    "- [任务委派] 来自 [{}]：{}\n",
                    msg.from, msg.content
                ));
            }
            AgentMessageKind::TaskResult => {
                context.push_str(&format!(
                    "- [任务结果] 来自 [{}]：{}\n",
                    msg.from, msg.content
                ));
            }
            AgentMessageKind::InterventionRequest => {
                context.push_str(&format!(
                    "- [冲突干预] 来自 [{}]：{}\n",
                    msg.from, msg.content
                ));
            }
        }
    }
    let _ = current_role_id; // 保留参数用于未来按角色过滤
    context
}

/// 从输出文本中提取协助请求标记
///
/// 标记格式：`[ASSIST_REQUEST:target_role_id] 请求内容 [/ASSIST_REQUEST]`
/// 返回 (target_role_id, content) 列表
fn extract_assist_requests(output: &str) -> Vec<(String, String)> {
    assist_request_re()
        .captures_iter(output)
        .map(|cap| {
            let target = cap.get(1).map(|m| m.as_str().to_string()).unwrap_or_default();
            let content = cap
                .get(2)
                .map(|m| m.as_str().trim().to_string())
                .unwrap_or_default();
            (target, content)
        })
        .collect()
}

/// 从输出文本中提取协助响应标记
///
/// 标记格式：`[ASSIST_RESPONSE:target_role_id] 响应内容 [/ASSIST_RESPONSE]`
/// 返回 (target_role_id, content) 列表
fn extract_assist_responses(output: &str) -> Vec<(String, String)> {
    assist_response_re()
        .captures_iter(output)
        .map(|cap| {
            let target = cap.get(1).map(|m| m.as_str().to_string()).unwrap_or_default();
            let content = cap
                .get(2)
                .map(|m| m.as_str().trim().to_string())
                .unwrap_or_default();
            (target, content)
        })
        .collect()
}

/// 灵枢 · Agent 协作协议升级（M2）：DAG 死锁防护
///
/// 校验一组协助请求是否构成有向无环图（DAG）。
/// 若请求链形成环（A→B→A），强制双向等待会导致死锁，应拒绝该请求。
///
/// `edges`：`(from_role, to_role)` 依赖边列表（来自当前及历史协助请求）
/// 返回 `Ok(())` 表示无环可安全发送；`Err(cycle)` 表示检测到环
pub fn validate_assist_dag(
    edges: &[(String, String)],
) -> Result<(), Vec<String>> {
    use std::collections::{HashMap, HashSet};

    // 构建邻接表
    let mut adjacency: HashMap<String, Vec<String>> = HashMap::new();
    for (from, to) in edges {
        adjacency
            .entry(from.clone())
            .or_default()
            .push(to.clone());
    }

    let mut visited: HashSet<String> = HashSet::new();
    let mut in_stack: HashSet<String> = HashSet::new();
    let mut cycle_path: Vec<String> = Vec::new();

    fn dfs(
        node: &str,
        adjacency: &HashMap<String, Vec<String>>,
        visited: &mut HashSet<String>,
        in_stack: &mut HashSet<String>,
        cycle_path: &mut Vec<String>,
    ) -> Option<Vec<String>> {
        if in_stack.contains(node) {
            // 发现回边，构造环路径
            let start = cycle_path.iter().position(|n| n == node)?;
            let mut cycle = cycle_path[start..].to_vec();
            cycle.push(node.to_string());
            return Some(cycle);
        }
        if visited.contains(node) {
            return None;
        }
        visited.insert(node.to_string());
        in_stack.insert(node.to_string());
        cycle_path.push(node.to_string());

        for next in adjacency.get(node).unwrap_or(&Vec::new()) {
            if let Some(cycle) = dfs(next, adjacency, visited, in_stack, cycle_path) {
                return Some(cycle);
            }
        }

        in_stack.remove(node);
        cycle_path.pop();
        None
    }

    for node in adjacency.keys() {
        if let Some(cycle) = dfs(
            node,
            &adjacency,
            &mut visited,
            &mut in_stack,
            &mut cycle_path,
        ) {
            return Err(cycle);
        }
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{
        build_peer_context, build_role_summary_from_result, extract_assist_requests,
        extract_assist_responses, validate_assist_dag,
    };
    use crate::agents::message_bus::{AgentMessage, AgentMessageKind};
    use sacode_kernel::AgentRole;

    fn role(role_id: &str) -> AgentRole {
        AgentRole {
            id: role_id.to_string(),
            ..AgentRole::default()
        }
    }

    fn message(from: &str, kind: AgentMessageKind, content: &str) -> AgentMessage {
        AgentMessage::new(from.to_string(), None, kind, content.to_string())
    }

    #[test]
    fn build_role_summary_uses_success_tone_for_implementer() {
        let summary = build_role_summary_from_result(
            &role("implementer"),
            "任务完成，共完成 3 个步骤",
            true,
        );

        assert!(summary.contains("实现结果已整理"));
        assert!(summary.contains("实现结论：任务完成"));
    }

    #[test]
    fn build_role_summary_uses_failure_tone_for_test_engineer() {
        let summary = build_role_summary_from_result(
            &role("test-engineer"),
            "验证失败，存在阻塞",
            false,
        );

        assert!(summary.contains("验证风险已识别"));
        assert!(summary.contains("测试结论：验证失败"));
    }

    #[test]
    fn build_role_summary_detects_failure_signal_in_success_output() {
        let summary = build_role_summary_from_result(
            &role("implementer"),
            "部分功能实现失败",
            true, // 技术上成功但输出包含失败信号
        );

        assert!(summary.contains("实现阻塞已识别"));
    }

    // ── 灵枢 · Agent Teams 阶段三测试 ──────────────────────────

    #[test]
    fn extract_assist_requests_parses_single_request() {
        let output = "分析完成。\n[ASSIST_REQUEST:test-engineer]需要验证鉴权流程[/ASSIST_REQUEST]\n结束。";
        let requests = extract_assist_requests(output);
        assert_eq!(requests.len(), 1);
        assert_eq!(requests[0].0, "test-engineer");
        assert_eq!(requests[0].1, "需要验证鉴权流程");
    }

    #[test]
    fn extract_assist_requests_parses_multiple_requests() {
        let output = "[ASSIST_REQUEST:repo-explorer]查找 auth 模块[/ASSIST_REQUEST]\n中间内容\n[ASSIST_REQUEST:test-engineer]运行测试[/ASSIST_REQUEST]";
        let requests = extract_assist_requests(output);
        assert_eq!(requests.len(), 2);
        assert_eq!(requests[0].0, "repo-explorer");
        assert_eq!(requests[1].0, "test-engineer");
    }

    #[test]
    fn extract_assist_requests_returns_empty_when_no_match() {
        let output = "普通输出，没有协助请求标记";
        let requests = extract_assist_requests(output);
        assert!(requests.is_empty());
    }

    #[test]
    fn extract_assist_responses_parses_response() {
        let output = "验证完成。\n[ASSIST_RESPONSE:implementer]鉴权流程已验证通过，无回归风险[/ASSIST_RESPONSE]";
        let responses = extract_assist_responses(output);
        assert_eq!(responses.len(), 1);
        assert_eq!(responses[0].0, "implementer");
        assert_eq!(responses[0].1, "鉴权流程已验证通过，无回归风险");
    }

    #[test]
    fn extract_assist_responses_handles_multiline_content() {
        let output = "[ASSIST_RESPONSE:architect]架构建议：
1. 拆分鉴权模块
2. 引入中间件[/ASSIST_RESPONSE]";
        let responses = extract_assist_responses(output);
        assert_eq!(responses.len(), 1);
        assert!(responses[0].1.contains("拆分鉴权模块"));
        assert!(responses[0].1.contains("引入中间件"));
    }

    #[test]
    fn build_peer_context_distinguishes_message_types() {
        let messages = vec![
            message("architect", AgentMessageKind::ProgressSync, "架构分析完成"),
            message("repo-explorer", AgentMessageKind::Discovery, "发现 auth 模块"),
            message("test-engineer", AgentMessageKind::RequestAssist, "需要实现细节"),
            message("implementer", AgentMessageKind::AssistResponse, "实现已完成"),
            message("reviewer", AgentMessageKind::ConflictWarning, "发现潜在冲突"),
        ];

        let context = build_peer_context(&messages, "implementer");

        // 进度同步
        assert!(context.contains("[进度同步] 来自 [architect]：架构分析完成"));
        // 发现共享
        assert!(context.contains("[发现共享] 来自 [repo-explorer]：发现 auth 模块"));
        // 协助请求（包含响应提示）
        assert!(context.contains("[协助请求] 来自 [test-engineer]：需要实现细节"));
        assert!(context.contains("[ASSIST_RESPONSE:test-engineer]"));
        // 协助响应
        assert!(context.contains("[协助响应] 来自 [implementer]：实现已完成"));
        // 冲突预警
        assert!(context.contains("[冲突预警] 来自 [reviewer]：发现潜在冲突"));
    }

    #[test]
    fn build_peer_context_returns_empty_header_for_empty_messages() {
        let messages: Vec<AgentMessage> = vec![];
        let context = build_peer_context(&messages, "implementer");
        // 空消息列表仍返回头部（但不应被调用，因为调用方会检查 is_empty）
        assert!(context.contains("[前序 Agent 协作上下文]"));
    }

    // ── M2 DAG 死锁防护测试 ──────────────────────────────

    #[test]
    fn validate_assist_dag_accepts_acyclic_edges() {
        // A→B→C 是合法 DAG，应返回 Ok
        let edges = vec![
            ("a".to_string(), "b".to_string()),
            ("b".to_string(), "c".to_string()),
        ];
        assert!(validate_assist_dag(&edges).is_ok(), "A→B→C 应无环");
    }

    #[test]
    fn validate_assist_dag_rejects_cycle() {
        // A→B→A 形成环，双向等待会死锁，应拒绝
        let edges = vec![
            ("a".to_string(), "b".to_string()),
            ("b".to_string(), "a".to_string()),
        ];
        let result = validate_assist_dag(&edges);
        assert!(result.is_err(), "A→B→A 应检测到环");
        let cycle = result.unwrap_err();
        assert!(cycle.contains(&"a".to_string()), "环路径应包含 a");
        assert!(cycle.contains(&"b".to_string()), "环路径应包含 b");
    }

    #[test]
    fn validate_assist_dag_rejects_self_loop() {
        // A→A 自环也应拒绝
        let edges = vec![("a".to_string(), "a".to_string())];
        assert!(validate_assist_dag(&edges).is_err(), "自环应被拒绝");
    }

    #[test]
    fn validate_assist_dag_handles_disconnected_components() {
        // 两个独立 DAG 不应互相影响
        let edges = vec![
            ("a".to_string(), "b".to_string()),
            ("c".to_string(), "d".to_string()),
        ];
        assert!(validate_assist_dag(&edges).is_ok(), "独立 DAG 应无环");
    }
}
