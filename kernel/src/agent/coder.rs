use crate::schema::Step;
use crate::event::Event;

#[derive(Debug, Clone)]
pub struct ToolCallIntent {
    pub name: String,
    pub input: serde_json::Value,
    pub requires_approval: bool,
}

#[derive(Debug, Clone)]
pub struct CoderOutput {
    pub step: usize,
    pub result: String,
    pub events: Vec<Event>,
    pub tool_calls: Vec<ToolCallIntent>,
}

#[derive(Debug, Default, Clone)]
pub struct CoderAgent;

impl CoderAgent {
    pub fn execute_step(&self, step: &mut Step) -> CoderOutput {
        step.mark_running();

        let events = vec![
            Event::thinking(format!("准备执行步骤 {}: {}", step.id, step.description)),
        ];

        let tool_calls: Vec<ToolCallIntent> = step.tools.iter().map(|tool| {
            let input = match tool.as_str() {
                "fs.read" => serde_json::json!({ "path": "README.md" }),
                "fs.search" => serde_json::json!({ "pattern": "fn" }),
                "web.search" => serde_json::json!({ "query": step.description }),
                "git.diff" => serde_json::json!({}),
                "shell.exec" => serde_json::json!({ "command": "pwd" }),
                value if value.starts_with("mcp.") => serde_json::json!({ "query": step.description }),
                _ => serde_json::json!({}),
            };

            ToolCallIntent {
                name: tool.clone(),
                input,
                requires_approval: tool == "shell.exec" || tool.starts_with("mcp."),
            }
        }).collect();

        let result = format!("步骤 {} 已准备 {} 个工具调用", step.id, tool_calls.len());

        CoderOutput {
            step: step.id,
            result,
            events,
            tool_calls,
        }
    }
}
