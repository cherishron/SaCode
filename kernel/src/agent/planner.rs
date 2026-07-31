use serde::Serialize;

use crate::event::Event;
use crate::schema::{ExecutionMode, Plan, Step, Task};

#[derive(Debug, Clone, Serialize)]
pub struct AgentOutput {
    pub mode: ExecutionMode,
    pub task: String,
    pub plan: Plan,
    pub events: Vec<Event>,
}

/// 占位规划 Agent — 仅生成静态步骤模板，不调用 LLM
///
/// **已废弃**：runtime 层的 `TaskExecutor` 已替代此占位实现，
/// 真正的 LLM 调用和工具执行在 `runtime::executor::task_runner` 中完成。
/// 此结构仅作为 kernel 层的兼容占位保留。
#[derive(Debug, Default, Clone)]
#[deprecated(
    since = "0.12.0",
    note = "使用 runtime::executor::task_runner::execute_task_with_provider 替代"
)]
pub struct PlannerAgent;

impl PlannerAgent {
    pub fn run(&self, task: &Task) -> AgentOutput {
        let steps = self.generate_steps(&task.prompt, task.mode);
        let plan = Plan::new(task.prompt.clone(), steps, format!("{:?}", task.mode));

        let events = vec![
            Event::message(format!("收到任务：{}", task.prompt)),
            Event::PlanGenerated {
                steps: plan.steps.iter().map(|s| s.description.clone()).collect(),
            },
            Event::done("规划完成，等待执行"),
        ];

        AgentOutput {
            mode: task.mode,
            task: task.prompt.clone(),
            plan,
            events,
        }
    }

    fn generate_steps(&self, prompt: &str, mode: ExecutionMode) -> Vec<Step> {
        let mut discovery_tools = vec!["fs.read".to_string(), "fs.search".to_string()];
        if should_use_web_search(prompt) {
            discovery_tools.push("web.search".to_string());
        }

        let mut steps = vec![
            Step::new(
                1,
                "分析任务需求和约束".to_string(),
                vec!["fs.read".to_string()],
                "明确的任务目标".to_string(),
            ),
            Step::new(
                2,
                "扫描工作区上下文".to_string(),
                discovery_tools,
                "相关文件和代码".to_string(),
            ),
            Step::new(
                3,
                "制定执行方案".to_string(),
                vec![],
                "具体的执行步骤".to_string(),
            ),
        ];

        if matches!(mode, ExecutionMode::Build | ExecutionMode::Yolo) {
            let mut execution_tools = vec!["shell.exec".to_string(), "git.diff".to_string()];
            execution_tools.extend(extract_mcp_tools(prompt));
            steps.push(Step::new(
                4,
                "执行工具调用".to_string(),
                execution_tools,
                "执行结果".to_string(),
            ));
            steps.push(Step::new(
                5,
                "验证执行结果".to_string(),
                vec![],
                "验证报告".to_string(),
            ));
        }

        steps
    }
}

fn should_use_web_search(prompt: &str) -> bool {
    let lower = prompt.to_lowercase();
    ["搜索", "联网", "web", "search", "docs", "文档"]
        .iter()
        .any(|needle| lower.contains(needle))
}

fn extract_mcp_tools(prompt: &str) -> Vec<String> {
    prompt
        .split_whitespace()
        .filter(|token| token.starts_with("mcp.") && token.matches('.').count() >= 2)
        .map(|token| {
            token
                .trim_matches(|c: char| ",.;:()[]{}\"'".contains(c))
                .to_string()
        })
        .collect()
}
