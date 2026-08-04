use std::io::IsTerminal;

use anyhow::Result;
use sacode_kernel::schema::{Checkpoint, TaskState};
use sacode_kernel::{Task, TaskRunState};
use serde::Serialize;
use std::io::Write;
use tokio::io::{self, AsyncReadExt};

use super::{CliOptions, JSON_STREAM_PREFIX};
use crate::runner::{
    format_stream_tail, run_task_with_stdin, run_task_with_stdin_and_stream, StreamEventKind,
    RunnerOutput,
};

#[derive(Debug, Serialize)]
struct CliResponse {
    prompt: String,
    mode: sacode_kernel::ExecutionMode,
    max_iterations: usize,
    tools: Vec<String>,
    workspace: String,
    plan: serde_json::Value,
    events: serde_json::Value,
    tool_results: serde_json::Value,
    stdin_preview: Option<String>,
    provider_response: Option<String>,
    state: TaskRunState,
    task_run: sacode_kernel::TaskRun,
    pending_question: Option<serde_json::Value>,
    usage: Option<sacode_kernel::model::ChatUsage>,
    hit_round_limit: bool,
    api_duration_ms: u64,
    tool_duration_ms: u64,
    total_duration_ms: u64,
}

pub(super) async fn run_task(options: CliOptions) -> Result<()> {
    let stdin = read_stdin_if_needed().await?;
    if options.json {
        let output = run_task_with_stdin(
            &options.prompt,
            options.mode,
            options.approval,
            options.max_iterations,
            stdin.clone(),
        )
        .await?;
        // CLI 执行路径写 checkpoint（统一状态机阶段二）
        let _ = write_checkpoint_for_run(&output);
        let response = CliResponse {
            prompt: output.prompt.clone(),
            mode: output.mode,
            max_iterations: options.max_iterations,
            tools: output.tool_names.clone(),
            workspace: output.workspace.clone(),
            plan: serde_json::to_value(&output.plan)?,
            events: serde_json::to_value(&output.events)?,
            tool_results: serde_json::to_value(&output.tool_results)?,
            stdin_preview: stdin.map(|value| preview(&value)),
            provider_response: output.provider_response.clone().ok(),
            state: output.effective_state(),
            task_run: output.task_run.clone(),
            pending_question: output.pending_question.clone(),
            usage: output.usage.clone(),
            hit_round_limit: output.hit_round_limit,
            api_duration_ms: output.api_duration_ms,
            tool_duration_ms: output.tool_duration_ms,
            total_duration_ms: output.total_duration_ms,
        };
        println!("{}", serde_json::to_string_pretty(&response)?);
        return Ok(());
    }

    let json_stream = options.json_stream;
    let output = run_task_with_stdin_and_stream(
        &options.prompt,
        options.mode,
        options.approval,
        options.max_iterations,
        stdin.clone(),
        Some(move |kind: StreamEventKind, chunk: &str| {
            if json_stream {
                let payload = serde_json::json!({
                    "type": "chunk",
                    "kind": match kind {
                        StreamEventKind::Message => "message",
                        StreamEventKind::Thinking => "thinking",
                    },
                    "content": chunk,
                });
                println!("{}{}", JSON_STREAM_PREFIX, payload);
                let _ = std::io::stdout().flush();
            } else {
                print!("{}", chunk);
                let _ = std::io::stdout().flush();
            }
        }),
    )
    .await?;

    // CLI 执行路径写 checkpoint（统一状态机阶段二）
    let _ = write_checkpoint_for_run(&output);

    if options.json_stream {
        let response = CliResponse {
            prompt: output.prompt.clone(),
            mode: output.mode,
            max_iterations: options.max_iterations,
            tools: output.tool_names.clone(),
            workspace: output.workspace.clone(),
            plan: serde_json::to_value(&output.plan)?,
            events: serde_json::to_value(&output.events)?,
            tool_results: serde_json::to_value(&output.tool_results)?,
            stdin_preview: stdin.map(|value| preview(&value)),
            provider_response: output.provider_response.clone().ok(),
            state: output.effective_state(),
            task_run: output.task_run.clone(),
            pending_question: output.pending_question.clone(),
            usage: output.usage.clone(),
            hit_round_limit: output.hit_round_limit,
            api_duration_ms: output.api_duration_ms,
            tool_duration_ms: output.tool_duration_ms,
            total_duration_ms: output.total_duration_ms,
        };
        println!("{}", serde_json::to_string_pretty(&response)?);
        return Ok(());
    }

    println!();
    println!("{}", format_stream_tail(&output));

    if let Some(stdin) = stdin {
        println!("Stdin: {}", preview(&stdin));
    }

    Ok(())
}

async fn read_stdin_if_needed() -> Result<Option<String>> {
    if std::io::stdin().is_terminal() {
        return Ok(None);
    }

    let mut buffer = String::new();
    io::stdin().read_to_string(&mut buffer).await?;
    if buffer.trim().is_empty() {
        return Ok(None);
    }

    Ok(Some(buffer))
}

pub(super) fn preview(input: &str) -> String {
    let trimmed = input.trim();
    let mut chars = trimmed.chars();
    let preview: String = chars.by_ref().take(80).collect();
    if chars.next().is_some() {
        format!("{preview}...")
    } else {
        preview
    }
}

/// CLI 执行路径写 checkpoint（统一状态机阶段二）
///
/// 将 RunnerOutput 转换为 Checkpoint 并持久化到 .sacode/checkpoints/，
/// 使任务状态可跨进程恢复。失败时静默记录（不阻塞 CLI 主流程）。
///
/// 设计要点：
/// - 状态映射：TaskRunState → TaskState（经 From impl），无 state 默认 Failed
/// - 事件历史：截取 RunnerOutput.events 末尾 100 条（Checkpoint::add_event 内部截断）
/// - 工作目录：使用 output.workspace 作为 checkpoint 存储根
fn write_checkpoint_for_run(output: &RunnerOutput) -> Result<()> {
    use sacode_runtime::CheckpointStorage;

    let workdir = std::path::Path::new(&output.workspace);
    let storage = CheckpointStorage::new(workdir);

    // 构建 Task
    let task = Task::new(output.prompt.clone(), output.mode, None);
    let mut checkpoint = Checkpoint::new(task);

    // 记录事件历史
    for event in &output.events {
        checkpoint.add_event(event.clone());
    }

    // 设置统一状态机状态
    let task_state = output
        .task_run
        .state
        .clone()
        .map(TaskState::from)
        .unwrap_or(TaskState::Failed);
    checkpoint.set_status(task_state);

    storage.save(&checkpoint)?;
    Ok(())
}
