use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Instant, SystemTime, UNIX_EPOCH};

use crate::tools::{SideEffectLevel, ToolOutput, ToolSpec};
use crate::{active_backend, active_policy, SandboxCommand};

/// task.spawn 默认超时时间（2 分钟）
const DEFAULT_SPAWN_TIMEOUT_MS: u64 = 120_000;

/// 进程内唯一 task_id 序号生成器（与 SystemTime 纳秒组合保证全局唯一）
static SPAWN_SEQ: AtomicU64 = AtomicU64::new(0);

/// 生成唯一 task_id：时间戳纳秒 + 原子序号，避免同一时刻多次 spawn 冲突
fn generate_task_id() -> String {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let seq = SPAWN_SEQ.fetch_add(1, Ordering::Relaxed);
    format!("spawn-{}-{}", nanos, seq)
}

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
        timeout_ms: Some(DEFAULT_SPAWN_TIMEOUT_MS),
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
    let task_id = generate_task_id();
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
            timeout_ms: DEFAULT_SPAWN_TIMEOUT_MS,
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

#[cfg(test)]
mod tests {
    use super::generate_task_id;

    #[test]
    fn generate_task_id_is_unique_across_calls() {
        // 验证 M2 修复：task_id 不再恒为 spawn-0，多次调用生成唯一 ID
        let mut ids = std::collections::HashSet::new();
        for _ in 0..1000 {
            let id = generate_task_id();
            assert!(!id.starts_with("spawn-0"), "task_id 不应恒为 spawn-0");
            assert!(ids.insert(id), "连续生成的 task_id 必须唯一");
        }
    }

    #[test]
    fn generate_task_id_has_timestamp_prefix() {
        // task_id 格式应为 spawn-<nanos>-<seq>
        let id = generate_task_id();
        let parts: Vec<&str> = id.split('-').collect();
        assert_eq!(parts.len(), 3, "task_id 应包含 3 段：spawn-<nanos>-<seq>");
        assert_eq!(parts[0], "spawn");
        assert!(!parts[1].is_empty(), "时间戳段不应为空");
        assert!(!parts[2].is_empty(), "序号段不应为空");
    }
}
