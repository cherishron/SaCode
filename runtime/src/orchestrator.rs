use sacode_kernel::{
    ApprovalPolicy, Checkpoint, ExecutionContext, ExecutionReport, HookContext, LifecyclePoint,
    TaskRun, ToolExecutionContext, ToolExecutionRecord,
};

use crate::{
    task_run_from_report, CheckpointStorage, HookExecutor, LoggingHook, SandboxExecutor,
    ToolRegistry,
};

/// 运行时编排器 — 编排占位 Supervisor + 工具执行 + Hook + 检查点
///
/// **注意**：此类仍使用占位 Supervisor，仅用于兼容旧路径。
/// 新代码应使用 `task_runner::execute_task_with_provider` 替代。
#[allow(deprecated)]
pub struct RuntimeOrchestrator {
    supervisor: sacode_kernel::Supervisor,
    tools: ToolRegistry,
    checkpoints: CheckpointStorage,
    hooks: HookExecutor,
}

#[allow(deprecated)]
impl RuntimeOrchestrator {
    pub fn new(
        supervisor: sacode_kernel::Supervisor,
        tools: ToolRegistry,
        _sandbox: SandboxExecutor,
        checkpoints: CheckpointStorage,
    ) -> Self {
        let mut hooks = HookExecutor::new();
        hooks.register(LoggingHook::new());
        Self {
            supervisor,
            tools,
            checkpoints,
            hooks,
        }
    }

    pub fn execute(&self, context: &ExecutionContext) -> anyhow::Result<ExecutionReport> {
        let mut report = ExecutionReport::default();
        let mut checkpoint = Checkpoint::new(context.task.clone());
        checkpoint.set_iteration(context.iteration);

        let task_started = HookContext::new(LifecyclePoint::TaskStarted, context.clone());
        report.hook_records.extend(
            self.hooks
                .execute(LifecyclePoint::TaskStarted, &task_started),
        );

        let supervisor_result = self.supervisor.execute(&context.task);
        report.plan = Some(supervisor_result.output.plan.clone());
        report.events = supervisor_result.output.events;
        report.final_output = report.events.last().map(event_summary);

        for event in &report.events {
            checkpoint.add_event(event.clone());
        }

        for (step_id, tool_calls) in &supervisor_result.tool_calls {
            let step_description = report
                .plan
                .as_ref()
                .and_then(|plan| plan.steps.iter().find(|step| &step.id == step_id))
                .map(|step| step.description.clone())
                .unwrap_or_else(|| format!("step-{}", step_id));

            for tool_call in tool_calls {
                let tool_context = ToolExecutionContext {
                    step_id: Some(*step_id),
                    tool_name: tool_call.name.clone(),
                    approval_required: tool_call.requires_approval,
                };
                let execution_context = context
                    .clone()
                    .with_step(*step_id, step_description.clone());

                let started =
                    HookContext::new(LifecyclePoint::ToolStarted, execution_context.clone())
                        .with_tool(tool_context.clone());
                report
                    .hook_records
                    .extend(self.hooks.execute(LifecyclePoint::ToolStarted, &started));

                let (output, success) =
                    self.execute_tool(&tool_call.name, &tool_call.input, context.approval);

                checkpoint.record_tool(
                    tool_call.name.clone(),
                    tool_call.input.clone(),
                    output.clone(),
                    success,
                );

                report.tool_records.push(ToolExecutionRecord {
                    step_id: Some(*step_id),
                    tool_name: tool_call.name.clone(),
                    success,
                });

                let finished = HookContext::new(LifecyclePoint::ToolFinished, execution_context)
                    .with_tool(tool_context);
                report
                    .hook_records
                    .extend(self.hooks.execute(LifecyclePoint::ToolFinished, &finished));
            }
        }

        if let Some(plan) = &report.plan {
            for step in &plan.steps {
                let step_context = context.clone().with_step(step.id, step.description.clone());
                let started = HookContext::new(LifecyclePoint::StepStarted, step_context.clone());
                report
                    .hook_records
                    .extend(self.hooks.execute(LifecyclePoint::StepStarted, &started));

                let finished = HookContext::new(LifecyclePoint::StepFinished, step_context);
                report
                    .hook_records
                    .extend(self.hooks.execute(LifecyclePoint::StepFinished, &finished));
            }
        }

        let checkpoint_path = self.checkpoints.save(&checkpoint)?;
        let checkpoint_ref = checkpoint_path.display().to_string();
        report.checkpoint_refs.push(checkpoint_ref.clone());

        let checkpoint_saved = HookContext::new(LifecyclePoint::CheckpointSaved, context.clone())
            .with_checkpoint_ref(checkpoint_ref);
        report.hook_records.extend(
            self.hooks
                .execute(LifecyclePoint::CheckpointSaved, &checkpoint_saved),
        );

        let task_finished = HookContext::new(LifecyclePoint::TaskFinished, context.clone());
        report.hook_records.extend(
            self.hooks
                .execute(LifecyclePoint::TaskFinished, &task_finished),
        );

        Ok(report)
    }

    pub fn execute_task_run(&self, context: &ExecutionContext) -> anyhow::Result<TaskRun> {
        let report = self.execute(context)?;
        Ok(task_run_from_report(
            context.task_id.clone(),
            context.mode,
            context.task.prompt.clone(),
            &report,
            crate::infer_task_run_state(&report),
        ))
    }

    fn execute_tool(
        &self,
        name: &str,
        input: &serde_json::Value,
        approval: ApprovalPolicy,
    ) -> (serde_json::Value, bool) {
        let spec = self.tools.get(name);
        let needs_approval = spec.map(|s| s.needs_approval()).unwrap_or(false);

        if needs_approval {
            match approval {
                ApprovalPolicy::AutoApprove => {}
                ApprovalPolicy::AutoDeny => {
                    return (serde_json::json!({ "error": "denied by policy" }), false)
                }
                ApprovalPolicy::Prompt => {
                    return (
                        serde_json::json!({ "error": "interactive approval unavailable" }),
                        false,
                    )
                }
            }
        }

        if let Some(_spec) = spec {
            match self.tools.execute(name, input.clone()) {
                Ok(output) => {
                    if output.success {
                        (output.data, true)
                    } else {
                        (
                            serde_json::json!({ "error": output.message.unwrap_or_default() }),
                            false,
                        )
                    }
                }
                Err(error) => (serde_json::json!({ "error": error.to_string() }), false),
            }
        } else {
            (
                serde_json::json!({ "error": format!("unknown tool: {}", name) }),
                false,
            )
        }
    }
}

fn event_summary(event: &sacode_kernel::Event) -> String {
    match event {
        sacode_kernel::Event::Message { content } => content.clone(),
        sacode_kernel::Event::Thinking { content } => content.clone(),
        sacode_kernel::Event::Done { summary } => summary.clone(),
        sacode_kernel::Event::Error { message } => message.clone(),
        _ => format!("{:?}", event),
    }
}
