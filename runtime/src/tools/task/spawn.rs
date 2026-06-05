use std::time::Instant;

use crate::tools::{SideEffectLevel, ToolOutput, ToolSpec};
use crate::{active_backend, active_policy, SandboxCommand};

pub fn spec() -> ToolSpec {
    ToolSpec {
        name: "task.spawn".to_string(),
        description: "启动子任务并返回结果摘要".to_string(),
        input_schema: serde_json::json!({
            "type": "object",
            "properties": {
                "prompt": { "type": "string", "description": "子任务描述" },
                "subagent_type": { "type": "string", "enum": ["explore", "general"], "default": "general" },
                "context": { "type": "string", "description": "补充上下文" }
            },
            "required": ["prompt"]
        }),
        output_schema: serde_json::json!({
            "type": "object",
            "properties": {
                "task_id": { "type": "string" },
                "status": { "type": "string" },
                "result": { "type": "string" },
                "duration_ms": { "type": "integer" }
            }
        }),
        side_effect_level: SideEffectLevel::Execute,
        approval_required: true,
        timeout_ms: Some(120_000),
        tags: vec!["task".to_string(), "spawn".to_string()],
    }
}

pub fn execute(input: serde_json::Value) -> anyhow::Result<ToolOutput> {
    let prompt = input["prompt"].as_str().unwrap_or("");
    let subagent_type = input["subagent_type"].as_str().unwrap_or("general");
    let context = input["context"].as_str().unwrap_or("");
    if prompt.is_empty() {
        return Ok(ToolOutput::failure("prompt is required"));
    }

    let started_at = Instant::now();
    let task_id = format!("spawn-{}", started_at.elapsed().as_nanos());
    let composed_prompt = if context.trim().is_empty() {
        prompt.to_string()
    } else {
        format!("{}\n\n补充上下文:\n{}", prompt, context)
    };

    let current_exe = std::env::current_exe()?;
    let output = active_backend().execute_command(
        &active_policy(),
        &SandboxCommand {
            program: current_exe.to_string_lossy().to_string(),
            args: vec![
                composed_prompt,
                "--mode".to_string(),
                if subagent_type == "explore" {
                    "plan".to_string()
                } else {
                    "build".to_string()
                },
                "--json".to_string(),
            ],
            cwd: None,
            timeout_ms: 120_000,
        },
    )?;

    let duration_ms = started_at.elapsed().as_millis() as u64;
    if output.timed_out {
        return Ok(ToolOutput::success(serde_json::json!({
            "task_id": task_id,
            "status": "failed",
            "result": "task spawn timed out",
            "duration_ms": duration_ms
        })));
    }

    if output.exit_code != 0 {
        return Ok(ToolOutput::success(serde_json::json!({
            "task_id": task_id,
            "status": "failed",
            "result": output.stderr,
            "duration_ms": duration_ms
        })));
    }

    let stdout = output.stdout;
    let parsed = serde_json::from_str::<serde_json::Value>(&stdout)
        .unwrap_or_else(|_| serde_json::json!({ "provider_response": stdout }));
    let result = parsed["provider_response"]
        .as_str()
        .unwrap_or(&stdout)
        .to_string();

    Ok(ToolOutput::success(serde_json::json!({
        "task_id": task_id,
        "status": "completed",
        "result": result,
        "duration_ms": duration_ms
    })))
}
