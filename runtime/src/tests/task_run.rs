use super::*;

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
    assert_eq!(
        run.state,
        Some(sacode_kernel::TaskRunState::WaitingForApproval)
    );
    assert_eq!(run.prompt.as_deref(), Some("等待用户确认"));
    assert_eq!(run.source.as_deref(), Some("snapshot"));
    assert!(run.started_at.is_some());
    assert!(run.updated_at.is_some());
    assert_eq!(run.output_text.as_deref(), Some("工具需要授权"));
}

#[tokio::test]
async fn test_role_driven_task_run_returns_snapshot() {
    let guard = sandbox_test_lock();
    drop(guard);
    let temp_dir = tempfile::tempdir().expect("create temp dir");
    let workdir = temp_dir.path();

    let task = Task::new("生成一个简单计划", ExecutionMode::Plan, None);
    let context = sacode_kernel::ExecutionContext::new(task).with_task_id("role-1");

    let (run, _plan) =
        crate::execute_role_driven_task_run(&context, &crate::CheckpointStorage::new(workdir))
            .await
            .expect("execute role driven task run");

    assert_eq!(run.task_id.as_deref(), Some("role-1"));
    assert_eq!(run.mode, Some(ExecutionMode::Plan));
    assert_eq!(run.state, Some(sacode_kernel::TaskRunState::Completed));
    assert_eq!(run.prompt.as_deref(), Some("生成一个简单计划"));
    assert!(run.report.is_some());
}
