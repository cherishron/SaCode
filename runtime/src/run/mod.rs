use sacode_kernel::{Event, ExecutionContext, ExecutionReport, TaskRun, TaskRunState};

pub fn run_task_once(context: &ExecutionContext) -> TaskRun {
    let supervisor = sacode_kernel::Supervisor::new();
    let result = supervisor.execute(&context.task);
    let final_output = result.output.events.iter().rev().find_map(event_summary);
    let report = ExecutionReport {
        plan: Some(result.output.plan.clone()),
        events: result.output.events.clone(),
        final_output: final_output.clone(),
        ..ExecutionReport::default()
    };

    task_run_from_report(
        context.task_id.clone(),
        context.mode,
        context.task.prompt.clone(),
        &report,
        infer_task_run_state(&report),
    )
}

pub fn task_run_from_report(
    task_id: Option<String>,
    mode: sacode_kernel::ExecutionMode,
    prompt: String,
    report: &ExecutionReport,
    state: TaskRunState,
) -> TaskRun {
    let now = now_rfc3339();
    TaskRun {
        task_id,
        source: Some("report".to_string()),
        mode: Some(mode),
        state: Some(state),
        prompt: Some(prompt),
        started_at: Some(now.clone()),
        updated_at: Some(now),
        report: Some(report.clone()),
        output_text: report
            .final_output
            .clone()
            .or_else(|| report.events.iter().rev().find_map(event_summary)),
        ..TaskRun::default()
    }
}

pub fn task_run_snapshot(
    task_id: Option<String>,
    mode: sacode_kernel::ExecutionMode,
    prompt: String,
    state: TaskRunState,
    output_text: Option<String>,
) -> TaskRun {
    let now = now_rfc3339();
    TaskRun {
        task_id,
        source: Some("snapshot".to_string()),
        mode: Some(mode),
        state: Some(state),
        prompt: Some(prompt),
        started_at: Some(now.clone()),
        updated_at: Some(now),
        output_text,
        ..TaskRun::default()
    }
}

pub fn infer_task_run_state(report: &ExecutionReport) -> TaskRunState {
    if report
        .events
        .iter()
        .any(|event| matches!(event, Event::Error { .. }))
    {
        TaskRunState::Failed
    } else {
        TaskRunState::Completed
    }
}

fn event_summary(event: &Event) -> Option<String> {
    match event {
        Event::Message { content } => Some(content.clone()),
        Event::Thinking { content } => Some(content.clone()),
        Event::Done { summary } => Some(summary.clone()),
        Event::Error { message } => Some(message.clone()),
        _ => None,
    }
}

fn now_rfc3339() -> String {
    chrono::Utc::now().to_rfc3339()
}
