use sacode_kernel::{AgentRole, ExecutionMode, PlannerAgent, SubAgentResult, SubAgentTask, Supervisor, Task};

use super::model_router::{ResolvedRoleRoute, resolve_role_route};
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
        provider,
        primary_model,
        thinking,
        reasoning_effort,
        role.model_policy.auto_route
    )
}

fn extract_result_summary(
    planner_events: &[sacode_kernel::Event],
    execution_events: &[sacode_kernel::Event],
) -> String {
    execution_events
        .iter()
        .rev()
        .find_map(done_summary)
        .or_else(|| planner_events.iter().rev().find_map(done_summary))
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| "任务已完成".to_string())
}

fn done_summary(event: &sacode_kernel::Event) -> Option<String> {
    match event {
        sacode_kernel::Event::Done { summary } => Some(summary.trim().to_string()),
        _ => None,
    }
}

fn build_role_summary(role: &AgentRole, execution: &sacode_kernel::agent::ExecutionResult) -> String {
    let completed_steps = execution.output.plan.completed_count();
    let tool_names = execution
        .tool_calls
        .iter()
        .flat_map(|(_, calls)| calls.iter().map(|call| call.name.as_str()))
        .collect::<Vec<_>>();
    let final_summary = extract_result_summary(&[], &execution.output.events);

    match role.id.as_str() {
        "system-architect" => format!(
            "架构路径已梳理，完成 {} 个步骤，重点覆盖 {}。{}",
            completed_steps,
            summarize_tool_focus(&tool_names),
            final_summary
        ),
        "repo-explorer" => format!(
            "仓库上下文已扫描，完成 {} 个步骤，重点覆盖 {}。{}",
            completed_steps,
            summarize_tool_focus(&tool_names),
            final_summary
        ),
        "implementer" => format!(
            "实现链路已推进，完成 {} 个步骤，执行涉及 {}。{}",
            completed_steps,
            summarize_tool_focus(&tool_names),
            final_summary
        ),
        "test-engineer" => format!(
            "验证路径已执行，完成 {} 个步骤，检查覆盖 {}。{}",
            completed_steps,
            summarize_tool_focus(&tool_names),
            final_summary
        ),
        "code-reviewer" => format!(
            "审查链路已完成，完成 {} 个步骤，重点检查 {}。{}",
            completed_steps,
            summarize_tool_focus(&tool_names),
            final_summary
        ),
        "devops-operator" => format!(
            "交付链路已检查，完成 {} 个步骤，操作涉及 {}。{}",
            completed_steps,
            summarize_tool_focus(&tool_names),
            final_summary
        ),
        "reporter" => format!(
            "汇总结论已生成，完成 {} 个步骤，参考了 {}。{}",
            completed_steps,
            summarize_tool_focus(&tool_names),
            final_summary
        ),
        "requirement-analyst" => format!(
            "需求约束已梳理，完成 {} 个步骤，分析覆盖 {}。{}",
            completed_steps,
            summarize_tool_focus(&tool_names),
            final_summary
        ),
        _ => format!("完成 {} 个步骤，覆盖 {}。{}", completed_steps, summarize_tool_focus(&tool_names), final_summary),
    }
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
