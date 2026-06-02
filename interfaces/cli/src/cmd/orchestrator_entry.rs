use std::env;

use anyhow::Result;
use sacode_kernel::{ExecutionContext, Supervisor, Task};
use sacode_runtime::{
    CheckpointStorage, RoleRegistry, RuntimeOrchestrator, SandboxConfigStore, SandboxExecutor, SandboxPolicy,
    TaskProfile, ToolRegistry, build_execution_plan, execute_role_driven_task_run, strip_orchestration_prefix,
};

use super::{CliOptions, orchestrator_support::format_summary_record};
use crate::runner::{RunnerOutput, format_output};

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
        output.task_run = task_run;
    }

    if options.json {
        let response = serde_json::json!({
            "prompt": output.prompt,
            "mode": output.mode,
            "workspace": output.workspace,
            "state": output.effective_state(),
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
        println!("[Orchestration Plan]\n{}\n", serde_json::to_string_pretty(&execution_plan)?);
        println!("{}", format_output(&output));
        if let Some(summary) = format_summary_record(report.summary_record.as_ref()) {
            println!("\n{}", summary);
        }
    }

    Ok(())
}
