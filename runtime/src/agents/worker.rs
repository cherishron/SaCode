//! 子 Agent 执行器 — 使用统一 TaskExecutor 调用 LLM
//!
//! 重构后，run_sub_agent 通过 TaskExecutor 真正调用 LLM + 工具执行，
//! 而非使用 kernel 层的占位 PlannerAgent/Supervisor。

use sacode_kernel::{
    AgentRole, ExecutionMode, SubAgentResult, SubAgentTask,
};

use super::model_router::{resolve_role_route, ResolvedRoleRoute};
use crate::executor::task_runner::{
    AutoApproveDecider, LoggingErrorRecorder, TaskRunConfig,
    build_tool_definitions_filtered, execute_task_with_failover,
};
use crate::model_routing::TaskProfile;
use crate::prompt::{build_system_prompt, PromptContext};
use crate::tools::ToolRegistry;
use crate::McpConfigStore;

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
pub async fn run_sub_agent(
    task: SubAgentTask,
    role: AgentRole,
    profile: &TaskProfile,
    workdir: &std::path::Path,
) -> WorkerRunResult {
    let resolved_route = resolve_role_route(workdir, &role, profile);
    let resolved_model_summary = resolved_route
        .as_ref()
        .map(|route| route.summary.clone())
        .unwrap_or_else(|| resolve_role_model_summary(&role));

    // 构建角色专属系统提示词
    let role_instruction = build_role_system_instruction(&role);

    // 构建工具注册表
    let mut tools = ToolRegistry::builtin();
    let mcp_store = McpConfigStore::new(workdir);
    let _ = crate::register_enabled_mcp_tools_sync(&mcp_store, &mut tools);

    let tool_names: Vec<String> = tools.names().iter().map(|name| name.to_string()).collect();

    // 构建系统提示词：角色指令 + 基础系统提示
    let base_system_prompt = build_system_prompt(&PromptContext {
        workdir,
        mode: ExecutionMode::Build,
        tool_names: &tool_names,
    })
    .unwrap_or_default();

    let system_prompt = format!("{}\n\n{}", role_instruction, base_system_prompt);

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
    };

    // 通过统一 TaskExecutor 执行（含 Failover）
    let task_run_result = execute_task_with_failover(
        &config,
        resolved_route.as_ref().map(|r| &r.plan),
        &candidates,
        profile,
        None, // 子 Agent 暂不支持流式输出
        None, // 子 Agent 暂不记录模型健康
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

#[cfg(test)]
mod tests {
    use super::build_role_summary_from_result;
    use sacode_kernel::AgentRole;

    fn role(role_id: &str) -> AgentRole {
        AgentRole {
            id: role_id.to_string(),
            ..AgentRole::default()
        }
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
}
