use super::*;

#[test]
fn test_run_task_once_builds_task_run_snapshot() {
    let task = Task::new("生成一个简单计划", ExecutionMode::Plan, None);
    let context = sacode_kernel::ExecutionContext::new(task).with_task_id("task-1");

    let run = crate::run_task_once(&context);

    assert_eq!(run.task_id.as_deref(), Some("task-1"));
    assert_eq!(run.mode, Some(ExecutionMode::Plan));
    assert_eq!(run.state, Some(sacode_kernel::TaskRunState::Completed));
    assert_eq!(run.prompt.as_deref(), Some("生成一个简单计划"));
    assert_eq!(run.source.as_deref(), Some("report"));
    assert!(run.started_at.is_some());
    assert!(run.updated_at.is_some());
    assert!(run.report.is_some());
}

#[test]
fn test_task_run_snapshot_preserves_waiting_state_and_output() {
    let run = crate::task_run_snapshot(
        Some("pending-1".to_string()),
        ExecutionMode::Build,
        "等待用户确认".to_string(),
        sacode_kernel::TaskRunState::WaitingForApproval,
        Some("工具需要授权".to_string()),
    );

    assert_eq!(run.task_id.as_deref(), Some("pending-1"));
    assert_eq!(run.mode, Some(ExecutionMode::Build));
    assert_eq!(run.state, Some(sacode_kernel::TaskRunState::WaitingForApproval));
    assert_eq!(run.prompt.as_deref(), Some("等待用户确认"));
    assert_eq!(run.source.as_deref(), Some("snapshot"));
    assert!(run.started_at.is_some());
    assert!(run.updated_at.is_some());
    assert_eq!(run.output_text.as_deref(), Some("工具需要授权"));
}

#[test]
fn test_runtime_orchestrator_execute_task_run_returns_snapshot() {
    let _guard = sandbox_test_lock();
    let temp_dir = tempfile::tempdir().expect("create temp dir");
    let workdir = temp_dir.path();

    let task = Task::new("生成一个简单计划", ExecutionMode::Plan, None);
    let context = sacode_kernel::ExecutionContext::new(task).with_task_id("orch-1");
    let orchestrator = crate::RuntimeOrchestrator::new(
        sacode_kernel::Supervisor::new(),
        ToolRegistry::builtin(),
        crate::SandboxExecutor::new(crate::SandboxPolicy::for_mode(ExecutionMode::Plan)),
        crate::CheckpointStorage::new(workdir),
    );

    let run = orchestrator.execute_task_run(&context).expect("execute task run");

    assert_eq!(run.task_id.as_deref(), Some("orch-1"));
    assert_eq!(run.mode, Some(ExecutionMode::Plan));
    assert_eq!(run.state, Some(sacode_kernel::TaskRunState::Completed));
    assert_eq!(run.prompt.as_deref(), Some("生成一个简单计划"));
    assert!(run.report.is_some());
}

#[tokio::test]
async fn test_role_driven_task_run_returns_snapshot() {
    let _guard = sandbox_test_lock();
    let temp_dir = tempfile::tempdir().expect("create temp dir");
    let workdir = temp_dir.path();

    let task = Task::new("生成一个简单计划", ExecutionMode::Plan, None);
    let context = sacode_kernel::ExecutionContext::new(task).with_task_id("role-1");

    let (run, _plan) = crate::execute_role_driven_task_run(
        &context,
        &crate::CheckpointStorage::new(workdir),
    )
    .await
    .expect("execute role driven task run");

    assert_eq!(run.task_id.as_deref(), Some("role-1"));
    assert_eq!(run.mode, Some(ExecutionMode::Plan));
    assert_eq!(run.state, Some(sacode_kernel::TaskRunState::Completed));
    assert_eq!(run.prompt.as_deref(), Some("生成一个简单计划"));
    assert!(run.report.is_some());
}
