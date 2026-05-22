use crate::{
    agent::{CoderAgent, PlannerAgent, ReviewerAgent, AgentOutput, ToolCallIntent},
    schema::{ExecutionMode, Plan, Task},
    event::Event,
};

#[derive(Debug, Clone)]
pub struct ExecutionResult {
    pub output: AgentOutput,
    pub tool_calls: Vec<(usize, Vec<ToolCallIntent>)>,
}

#[derive(Debug, Clone)]
pub struct Supervisor {
    planner: PlannerAgent,
    coder: CoderAgent,
    reviewer: ReviewerAgent,
}

impl Supervisor {
    pub fn new() -> Self {
        Self {
            planner: PlannerAgent,
            coder: CoderAgent,
            reviewer: ReviewerAgent,
        }
    }

    pub fn execute(&self, task: &Task) -> ExecutionResult {
        let planner_output = self.planner.run(task);
        let plan = planner_output.plan.clone();

        if task.mode == ExecutionMode::Plan {
            return ExecutionResult {
                output: planner_output,
                tool_calls: Vec::new(),
            };
        }

        let mut events = planner_output.events.clone();
        let mut plan = plan;
        let mut tool_calls = Vec::new();

        self.execute_plan(&mut plan, &mut events, &mut tool_calls);

        ExecutionResult {
            output: AgentOutput {
                mode: task.mode,
                task: task.prompt.clone(),
                plan,
                events,
            },
            tool_calls,
        }
    }

    fn execute_plan(&self, plan: &mut Plan, events: &mut Vec<Event>, tool_calls: &mut Vec<(usize, Vec<ToolCallIntent>)>) {
        for step in &mut plan.steps {
            let coder_output = self.coder.execute_step(step);
            events.extend(coder_output.events.clone());

            if !coder_output.tool_calls.is_empty() {
                tool_calls.push((step.id, coder_output.tool_calls.clone()));

                for intent in &coder_output.tool_calls {
                    events.push(Event::ToolCallStarted {
                        name: intent.name.clone(),
                        input: intent.input.clone(),
                    });
                }
            }

            step.mark_completed();

            for intent in &coder_output.tool_calls {
                events.push(Event::ToolCallFinished {
                    name: intent.name.clone(),
                    output: serde_json::json!({ "executed": true }),
                    success: true,
                });
            }

            let reviewer_output = self.reviewer.review_step(step, &coder_output.result);
            events.extend(reviewer_output.events.clone());

            if reviewer_output.review.passed {
                events.push(Event::message(format!("步骤 {} 通过审查", step.id)));
            } else {
                events.push(Event::message(format!("步骤 {} 审查有建议", step.id)));
            }
        }

        if plan.is_done() {
            events.push(Event::done(format!("任务完成，共完成 {} 个步骤", plan.completed_count())));
        }
    }
}

impl Default for Supervisor {
    fn default() -> Self {
        Self::new()
    }
}
