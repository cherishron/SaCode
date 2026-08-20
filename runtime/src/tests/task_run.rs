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
    // 持有沙箱锁全程，避免 cwd/HOME 隔离期间与其它沙箱测试并发
    let _guard = sandbox_test_lock();
    let temp_dir = tempfile::tempdir().expect("create temp dir");
    let workdir = temp_dir.path();
    // 隔离 cwd 与 HOME/USERPROFILE，避免读取项目根 .sacode/config.json 触发真实 LLM 调用
    let _cwd = CurrentDirGuard::enter(workdir);
    let _home = HomeEnvGuard::set(workdir);
    // 写入空 provider 配置，使 resolve_config_model_candidates 返回空，
    // worker 命中「无可用模型配置」分支直接返回，不发任何 HTTP 请求
    std::fs::create_dir_all(workdir.join(".sacode")).expect("create .sacode dir");
    std::fs::write(workdir.join(".sacode/config.json"), "{}").expect("write empty config");

    let task = Task::new("生成一个简单计划", ExecutionMode::Plan, None);
    let context = sacode_kernel::ExecutionContext::new(task).with_task_id("role-1");

    let (run, _plan) = crate::execute_role_driven_task_run(
        &context,
        &crate::CheckpointStorage::new(workdir),
        workdir,
        None,
        crate::agents::loop_impl::LoopSubsystems::default(),
    )
    .await
    .expect("execute role driven task run");

    assert_eq!(run.task_id.as_deref(), Some("role-1"));
    assert_eq!(run.mode, Some(ExecutionMode::Plan));
    // 无可用 provider 时 worker 返回 Error 事件，infer_task_run_state 据此推断为 Failed
    assert_eq!(run.state, Some(sacode_kernel::TaskRunState::Failed));
    assert_eq!(run.prompt.as_deref(), Some("生成一个简单计划"));
    assert!(run.report.is_some());
}
