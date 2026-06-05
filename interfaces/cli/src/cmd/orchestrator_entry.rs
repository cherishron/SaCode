use std::env;

use anyhow::Result;
use sacode_kernel::{ExecutionContext, ExecutionReport, Supervisor, Task, TaskRun};
use sacode_runtime::{
    build_execution_plan, execute_role_driven_task_run, strip_orchestration_prefix,
    CheckpointStorage, RoleRegistry, RuntimeOrchestrator, SandboxConfigStore, SandboxExecutor,
    SandboxPolicy, TaskProfile, ToolRegistry,
};

use super::{orchestrator_support::format_summary_record, CliOptions};
use crate::runner::{format_output, RunnerOutput};

pub(super) async fn run_with_orchestrator(options: CliOptions) -> Result<()> {
    let workdir = env::current_dir()?;
    let effective_prompt = strip_orchestration_prefix(&options.prompt);
    let profile = TaskProfile::from_prompt_and_workspace(&effective_prompt, &workdir);
    let roles = RoleRegistry::builtin();
    let execution_plan = build_execution_plan(&effective_prompt, &workdir, &profile, roles.all());

    let task = Task::new(effective_prompt.clone(), options.mode, None);
    let context = ExecutionContext::new(task).with_approval(options.approval);

    let supervisor = Supervisor::new();
    let tools = ToolRegistry::builtin();
    let sandbox = SandboxConfigStore::new(&workdir)
        .executor_for_mode(options.mode)
        .unwrap_or_else(|_| SandboxExecutor::new(SandboxPolicy::for_mode(options.mode)));
    let checkpoints = CheckpointStorage::new(&workdir);

    let (report, task_run) = if execution_plan.use_multi_agent {
        let (task_run, _actual_plan) = execute_role_driven_task_run(&context, &checkpoints).await?;
        let report = task_run.report.clone().unwrap_or_default();
        (report, Some(task_run))
    } else {
        let orchestrator = RuntimeOrchestrator::new(supervisor, tools, sandbox, checkpoints);
        let task_run = orchestrator.execute_task_run(&context)?;
        let report = task_run.report.clone().unwrap_or_default();
        (report, Some(task_run))
    };

    let mut output = RunnerOutput::from_execution_report(
        &report,
        effective_prompt.clone(),
        options.mode,
        options.max_iterations,
        workdir.to_string_lossy().to_string(),
    );
    if let Some(task_run) = task_run {
        output.provider_response = orchestrator_final_text(Some(&task_run), &report)
            .ok_or_else(|| "orchestrator mode did not produce final output".to_string());
        output.task_run = task_run;
    }

    if options.json {
        let response = serde_json::json!({
            "prompt": output.prompt,
            "mode": output.mode,
            "workspace": output.workspace,
            "provider_response": output.provider_response.clone().ok(),
            "state": output.effective_state(),
            "task_run": output.task_run,
            "pending_question": output.pending_question,
            "usage": output.usage,
            "api_duration_ms": output.api_duration_ms,
            "tool_duration_ms": output.tool_duration_ms,
            "total_duration_ms": output.total_duration_ms,
            "plan": output.plan,
            "events": output.events,
            "tool_results": output.tool_results,
            "route_records": report.route_records,
            "conflicts": report.conflicts,
            "conflict_records": report.conflict_records,
            "summary_record": report.summary_record,
            "orchestration_plan": execution_plan,
        });
        println!("{}", serde_json::to_string_pretty(&response)?);
    } else {
        println!(
            "[Orchestration Plan]\n{}\n",
            serde_json::to_string_pretty(&execution_plan)?
        );
        println!("{}", format_output(&output));
        if let Some(summary) = format_summary_record(report.summary_record.as_ref()) {
            println!("\n{}", summary);
        }
    }

    Ok(())
}

fn orchestrator_final_text(task_run: Option<&TaskRun>, report: &ExecutionReport) -> Option<String> {
    task_run
        .and_then(|run| run.output_text.as_deref())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string)
        .or_else(|| {
            report
                .final_output
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(ToString::to_string)
        })
        .or_else(|| format_summary_record(report.summary_record.as_ref()))
}

#[cfg(test)]
mod tests {
    use super::orchestrator_final_text;
    use sacode_kernel::{
        ExecutionMode, ExecutionReport, SummaryItemRecord, SummaryRecord, TaskRun, TaskRunState,
    };

    #[test]
    fn orchestrator_final_text_prefers_task_run_output() {
        let task_run = TaskRun {
            output_text: Some("final answer".to_string()),
            ..TaskRun::default()
        };
        let report = ExecutionReport {
            final_output: Some("report output".to_string()),
            ..ExecutionReport::default()
        };

        let result = orchestrator_final_text(Some(&task_run), &report);

        assert_eq!(result.as_deref(), Some("final answer"));
    }

    #[test]
    fn orchestrator_final_text_falls_back_to_report_output() {
        let task_run = TaskRun::default();
        let report = ExecutionReport {
            final_output: Some("report output".to_string()),
            ..ExecutionReport::default()
        };

        let result = orchestrator_final_text(Some(&task_run), &report);

        assert_eq!(result.as_deref(), Some("report output"));
    }

    #[test]
    fn orchestrator_final_text_falls_back_to_summary_record() {
        let report = ExecutionReport {
            summary_record: Some(SummaryRecord {
                task: "task".to_string(),
                reporter_summary: Some("summary overview".to_string()),
                overall_conclusion: Some("overall conclusion".to_string()),
                recommended_next_action: Some("next action".to_string()),
                items: vec![SummaryItemRecord {
                    role_id: "reporter".to_string(),
                    route: "deepseek/reasoner".to_string(),
                    output: "item".to_string(),
                }],
                ..SummaryRecord::default()
            }),
            ..ExecutionReport::default()
        };

        let result = orchestrator_final_text(None, &report);

        assert!(result
            .as_deref()
            .is_some_and(|value| value.contains("summary overview")));
    }

    #[test]
    fn orchestrator_json_contract_needs_provider_response_fields() {
        let task_run = TaskRun {
            mode: Some(ExecutionMode::Build),
            state: Some(TaskRunState::Completed),
            output_text: Some("done".to_string()),
            ..TaskRun::default()
        };
        let report = ExecutionReport::default();
        let provider_response = orchestrator_final_text(Some(&task_run), &report);
        let payload = serde_json::json!({
            "provider_response": provider_response,
            "task_run": task_run,
            "pending_question": serde_json::Value::Null,
            "api_duration_ms": 0,
            "tool_duration_ms": 0,
            "total_duration_ms": 0,
        });

        assert_eq!(payload["provider_response"].as_str(), Some("done"));
        assert_eq!(payload["task_run"]["output_text"].as_str(), Some("done"));
        assert!(payload.get("pending_question").is_some());
        assert!(payload.get("api_duration_ms").is_some());
    }
}
