use sacode_kernel::{
    AgentRole, ExecutionMode, PlannerAgent, SubAgentResult, SubAgentTask, Supervisor, Task,
};

use super::model_router::{resolve_role_route, ResolvedRoleRoute};
use crate::model_routing::TaskProfile;

#[derive(Debug, Clone)]
pub struct WorkerRunResult {
    pub task: SubAgentTask,
    pub role: AgentRole,
    pub result: SubAgentResult,
    pub events: Vec<sacode_kernel::Event>,
    pub resolved_route: Option<ResolvedRoleRoute>,
    pub resolved_model_summary: String,
}

pub async fn run_sub_agent(
    task: SubAgentTask,
    role: AgentRole,
    profile: &TaskProfile,
    workdir: &std::path::Path,
) -> WorkerRunResult {
    let task_input = Task::new(task.prompt.clone(), ExecutionMode::Build, None);
    let resolved_route = resolve_role_route(workdir, &role, profile);
    let resolved_model_summary = resolved_route
        .as_ref()
        .map(|route| route.summary.clone())
        .unwrap_or_else(|| resolve_role_model_summary(&role));

    let planner = PlannerAgent::default();
    let output = planner.run(&task_input);
    let supervisor = Supervisor::default();
    let execution = supervisor.execute(&task_input);

    let summary = build_role_summary(&role, &execution);

    let mut events = vec![sacode_kernel::Event::message(format!(
        "子 Agent [{}] 开始处理任务：{}",
        role.id, task.title
    ))];
    events.push(sacode_kernel::Event::thinking(format!(
        "角色模型策略：{}",
        resolved_model_summary
    )));
    events.extend(output.events.clone());
    events.extend(execution.output.events.clone());
    events.push(sacode_kernel::Event::done(format!(
        "子 Agent [{}] 完成任务：{}",
        role.id, task.title
    )));

    WorkerRunResult {
        result: SubAgentResult {
            id: task.id.clone(),
            success: true,
            output: summary,
        },
        task,
        role,
        events,
        resolved_route,
        resolved_model_summary,
    }
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

fn extract_result_summary(
    planner_events: &[sacode_kernel::Event],
    execution_events: &[sacode_kernel::Event],
) -> String {
    execution_events
        .iter()
        .rev()
        .find_map(terminal_summary)
        .or_else(|| planner_events.iter().rev().find_map(terminal_summary))
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| "任务已完成".to_string())
}

fn terminal_summary(event: &sacode_kernel::Event) -> Option<String> {
    match event {
        sacode_kernel::Event::Done { summary } => Some(summary.trim().to_string()),
        sacode_kernel::Event::Error { message } => Some(message.trim().to_string()),
        _ => None,
    }
}

fn build_role_summary(
    role: &AgentRole,
    execution: &sacode_kernel::agent::ExecutionResult,
) -> String {
    let completed_steps = execution.output.plan.completed_count();
    let tool_names = execution
        .tool_calls
        .iter()
        .flat_map(|(_, calls)| calls.iter().map(|call| call.name.as_str()))
        .collect::<Vec<_>>();
    let tool_focus = summarize_tool_focus(&tool_names);
    let final_summary = extract_result_summary(&[], &execution.output.events);
    let has_failure_signal = has_failure_signal(&execution.output.events);

    match role.id.as_str() {
        "system-architect" => format!(
            "{}，完成 {} 个步骤，重点覆盖 {}。架构结论：{}",
            if has_failure_signal {
                "架构风险已识别"
            } else {
                "架构结论已整理"
            },
            completed_steps,
            tool_focus,
            final_summary
        ),
        "repo-explorer" => format!(
            "{}，完成 {} 个步骤，重点覆盖 {}。探索结论：{}",
            if has_failure_signal {
                "仓库阻塞线索已识别"
            } else {
                "仓库线索已整理"
            },
            completed_steps,
            tool_focus,
            final_summary
        ),
        "implementer" => format!(
            "{}，完成 {} 个步骤，执行涉及 {}。实现结论：{}",
            if has_failure_signal {
                "实现阻塞已识别"
            } else {
                "实现结果已整理"
            },
            completed_steps,
            tool_focus,
            final_summary
        ),
        "test-engineer" => format!(
            "{}，完成 {} 个步骤，检查覆盖 {}。测试结论：{}",
            if has_failure_signal {
                "验证风险已识别"
            } else {
                "验证结果已整理"
            },
            completed_steps,
            tool_focus,
            final_summary
        ),
        "code-reviewer" => format!(
            "{}，完成 {} 个步骤，重点检查 {}。审查结论：{}",
            if has_failure_signal {
                "审查风险已识别"
            } else {
                "审查结果已整理"
            },
            completed_steps,
            tool_focus,
            final_summary
        ),
        "devops-operator" => format!(
            "{}，完成 {} 个步骤，操作涉及 {}。交付结论：{}",
            if has_failure_signal {
                "交付阻塞已识别"
            } else {
                "交付检查已整理"
            },
            completed_steps,
            tool_focus,
            final_summary
        ),
        "reporter" => format!(
            "{}，完成 {} 个步骤，参考了 {}。主结论：{}",
            if has_failure_signal {
                "汇总风险已生成"
            } else {
                "汇总结论已生成"
            },
            completed_steps,
            tool_focus,
            final_summary
        ),
        "requirement-analyst" => format!(
            "{}，完成 {} 个步骤，分析覆盖 {}。需求结论：{}",
            if has_failure_signal {
                "需求风险已识别"
            } else {
                "需求约束已整理"
            },
            completed_steps,
            tool_focus,
            final_summary
        ),
        _ => format!(
            "{}，完成 {} 个步骤，覆盖 {}。执行结论：{}",
            if has_failure_signal {
                "执行风险已识别"
            } else {
                "执行结果已整理"
            },
            completed_steps,
            tool_focus,
            final_summary
        ),
    }
}

fn has_failure_signal(events: &[sacode_kernel::Event]) -> bool {
    events.iter().any(|event| match event {
        sacode_kernel::Event::Error { .. } => true,
        sacode_kernel::Event::ToolCallFinished { success, .. } => !success,
        sacode_kernel::Event::Done { summary } => contains_failure_signal(summary),
        sacode_kernel::Event::Message { content } | sacode_kernel::Event::Thinking { content } => {
            contains_failure_signal(content)
        }
        _ => false,
    })
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

fn summarize_tool_focus(tool_names: &[&str]) -> &'static str {
    let has_fs = tool_names.iter().any(|name| name.starts_with("fs."));
    let has_shell = tool_names.iter().any(|name| *name == "shell.exec");
    let has_git = tool_names.iter().any(|name| *name == "git.diff");
    let has_web = tool_names.iter().any(|name| *name == "web.search");
    let has_mcp = tool_names.iter().any(|name| name.starts_with("mcp."));

    if has_fs && has_shell && has_git {
        "代码读取、命令执行与差异检查"
    } else if has_fs && has_git {
        "代码读取与差异检查"
    } else if has_fs && has_shell {
        "代码读取与命令执行"
    } else if has_fs {
        "代码读取"
    } else if has_shell {
        "命令执行"
    } else if has_git {
        "差异检查"
    } else if has_web {
        "联网检索"
    } else if has_mcp {
        "外部 MCP 工具"
    } else {
        "基础执行流程"
    }
}

#[cfg(test)]
mod tests {
    use super::build_role_summary;
    use sacode_kernel::{AgentOutput, AgentRole, Event, ExecutionMode, ExecutionResult, Plan};

    fn role(role_id: &str) -> AgentRole {
        AgentRole {
            id: role_id.to_string(),
            ..AgentRole::default()
        }
    }

    fn execution_result(events: Vec<Event>) -> ExecutionResult {
        ExecutionResult {
            output: AgentOutput {
                mode: ExecutionMode::Build,
                task: "test task".to_string(),
                plan: Plan::new("test task".to_string(), Vec::new(), "build".to_string()),
                events,
            },
            tool_calls: Vec::new(),
        }
    }

    #[test]
    fn build_role_summary_uses_success_tone_for_implementer() {
        let summary = build_role_summary(
            &role("implementer"),
            &execution_result(vec![Event::done("任务完成，共完成 3 个步骤")]),
        );

        assert!(summary.contains("实现结果已整理"));
        assert!(summary.contains("实现结论：任务完成，共完成 3 个步骤"));
    }

    #[test]
    fn build_role_summary_uses_failure_tone_for_test_engineer() {
        let summary = build_role_summary(
            &role("test-engineer"),
            &execution_result(vec![Event::error("验证失败，存在阻塞")]),
        );

        assert!(summary.contains("验证风险已识别"));
        assert!(summary.contains("测试结论：验证失败，存在阻塞"));
    }
}
