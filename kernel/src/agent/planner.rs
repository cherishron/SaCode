use serde::Serialize;

use crate::schema::{ExecutionMode, Plan, Step, Task};
use crate::event::Event;

#[derive(Debug, Clone, Serialize)]
pub struct AgentOutput {
    pub mode: ExecutionMode,
    pub task: String,
    pub plan: Plan,
    pub events: Vec<Event>,
}

#[derive(Debug, Default, Clone)]
pub struct PlannerAgent;

impl PlannerAgent {
    pub fn run(&self, task: &Task) -> AgentOutput {
        let steps = self.generate_steps(&task.prompt, task.mode);
        let plan = Plan::new(task.prompt.clone(), steps, format!("{:?}", task.mode));

        let events = vec![
            Event::message(format!("收到任务：{}", task.prompt)),
            Event::PlanGenerated { steps: plan.steps.iter().map(|s| s.description.clone()).collect() },
            Event::done("规划完成，等待执行"),
        ];

        AgentOutput {
            mode: task.mode,
            task: task.prompt.clone(),
            plan,
            events,
        }
    }

    fn generate_steps(&self, _prompt: &str, mode: ExecutionMode) -> Vec<Step> {
        let mut steps = vec![
            Step::new(1, "分析任务需求和约束".to_string(), vec!["fs.read".to_string()], "明确的任务目标".to_string()),
            Step::new(2, "扫描工作区上下文".to_string(), vec!["fs.read".to_string(), "fs.search".to_string()], "相关文件和代码".to_string()),
            Step::new(3, "制定执行方案".to_string(), vec![], "具体的执行步骤".to_string()),
        ];

        if matches!(mode, ExecutionMode::Build | ExecutionMode::Yolo) {
            steps.push(Step::new(4, "执行工具调用".to_string(), vec!["shell.exec".to_string(), "git.diff".to_string()], "执行结果".to_string()));
            steps.push(Step::new(5, "验证执行结果".to_string(), vec![], "验证报告".to_string()));
        }

        steps
    }
}
