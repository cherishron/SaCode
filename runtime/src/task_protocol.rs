use sacode_kernel::{
    BackendTaskMeta, EntrySource, ExecutionMode, FailureCategory, ResultSummary, RouteSummary,
    TaskPhase, TaskQueueStatus, TaskRun, TaskSnapshot, TaskState, TaskTimestamps, TerminalOutcome,
    ValidationStatus, ValidationSummary, TASK_PROTOCOL_VERSION,
};

use crate::classify_failure;

pub struct TaskSnapshotProjection<'a> {
    pub task_id: &'a str,
    pub mode: ExecutionMode,
    pub source: EntrySource,
    pub queue_status: Option<TaskQueueStatus>,
    pub task_run: Option<&'a TaskRun>,
    pub output: Option<&'a str>,
    pub error: Option<&'a str>,
    /// Optional Agent Backend metadata (M0). None → native sacode.
    pub backend: Option<&'a BackendTaskMeta>,
}

pub fn assemble_checkpoint_snapshot(
    task_id: &str,
    checkpoint: &sacode_kernel::Checkpoint,
) -> TaskSnapshot {
    let task_run = TaskRun {
        task_id: Some(task_id.to_string()),
        source: Some("checkpoint".to_string()),
        mode: Some(checkpoint.task.mode),
        started_at: Some(checkpoint.created_at.clone()),
        updated_at: Some(checkpoint.updated_at.clone()),
        ..TaskRun::default()
    };
    let mut snapshot = assemble_task_snapshot(TaskSnapshotProjection {
        task_id,
        mode: checkpoint.task.mode,
        source: EntrySource::Daemon,
        queue_status: Some(checkpoint.status.to_queue_status()),
        task_run: Some(&task_run),
        output: None,
        error: None,
        backend: None,
    });
    snapshot.timestamps.created_at = Some(checkpoint.created_at.clone());
    snapshot
}

pub fn assemble_task_snapshot(projection: TaskSnapshotProjection<'_>) -> TaskSnapshot {
    let state = projected_state(projection.queue_status, projection.task_run);
    let task_run = projection.task_run;
    let output = projection.output.map(str::to_string).or_else(|| {
        task_run.and_then(|run| {
            run.output_text.clone().or_else(|| {
                run.report
                    .as_ref()
                    .and_then(|report| report.final_output.clone())
            })
        })
    });
    let error = projection.error.or_else(|| {
        task_run.and_then(|run| {
            run.report.as_ref().and_then(|report| {
                report.events.iter().rev().find_map(|event| match event {
                    sacode_kernel::Event::Error { message } => Some(message.as_str()),
                    _ => None,
                })
            })
        })
    });
    let terminal_outcome = TerminalOutcome::try_from(state).ok();
    let failure = (state == TaskState::Failed).then(|| {
        classify_failure(
            FailureCategory::Provider,
            error.unwrap_or("unknown task failure"),
        )
    });
    let result = output.map(|text| ResultSummary {
        text: Some(text),
        changed_objects: Vec::new(),
    });
    let route = task_run
        .and_then(|run| run.report.as_ref())
        .and_then(|report| {
            let first = report.route_records.first()?;
            let last = report.route_records.last()?;
            // 灵枢·降级透明：请求路由与实际路由不一致（或发生多次切换）时视为已切换
            let switched = last.primary.provider_name != first.primary.provider_name
                || last.primary.model_name != first.primary.model_name;
            Some(RouteSummary {
                provider: last.primary.provider_name.clone(),
                model: last.primary.model_name.clone(),
                switched,
                reason: (!last.route_reason.is_empty()).then(|| last.route_reason.clone()),
            })
        });
    let timestamps = TaskTimestamps {
        created_at: None,
        started_at: task_run.and_then(|run| run.started_at.clone()),
        updated_at: task_run.and_then(|run| run.updated_at.clone()),
        finished_at: state
            .is_terminal()
            .then(|| task_run.and_then(|run| run.updated_at.clone()))
            .flatten(),
    };

    TaskSnapshot {
        schema_version: TASK_PROTOCOL_VERSION,
        task_id: projection.task_id.to_string(),
        mode: projection.mode,
        source: projection.source,
        state,
        phase: TaskPhase::from(state),
        terminal_outcome,
        failure,
        result,
        validation: Some(ValidationSummary {
            status: ValidationStatus::Unknown,
            checks: Vec::new(),
        }),
        route,
        timestamps,
        backend: projection.backend.cloned(),
    }
}

fn projected_state(queue_status: Option<TaskQueueStatus>, task_run: Option<&TaskRun>) -> TaskState {
    match queue_status {
        Some(TaskQueueStatus::Running) => task_run
            .and_then(|run| run.state.clone())
            .map(TaskState::from)
            .unwrap_or(TaskState::Running),
        Some(status) => TaskState::from(status),
        None => task_run
            .and_then(|run| run.state.clone())
            .map(TaskState::from)
            .unwrap_or(TaskState::Pending),
    }
}

#[cfg(test)]
mod tests {
    use sacode_kernel::{ExecutionReport, RouteRecord, RoutedModelRecord, TaskRunState};

    use super::*;

    fn projection<'a>(
        state: TaskQueueStatus,
        task_run: Option<&'a TaskRun>,
        error: Option<&'a str>,
    ) -> TaskSnapshotProjection<'a> {
        TaskSnapshotProjection {
            task_id: "task-1",
            mode: ExecutionMode::Build,
            source: EntrySource::Daemon,
            queue_status: Some(state),
            task_run,
            output: None,
            error,
            backend: None,
        }
    }

    #[test]
    fn failed_snapshot_uses_safe_failure_message() {
        let snapshot = assemble_task_snapshot(projection(
            TaskQueueStatus::Failed,
            None,
            Some("401 api key sk-test-secret-value is invalid"),
        ));

        assert!(snapshot.validate().is_ok());
        assert!(!snapshot
            .failure
            .expect("failure")
            .safe_message
            .contains("sk-test-secret-value"));
    }

    #[test]
    fn running_queue_preserves_waiting_for_approval() {
        let run = TaskRun {
            state: Some(TaskRunState::WaitingForApproval),
            ..TaskRun::default()
        };
        let snapshot =
            assemble_task_snapshot(projection(TaskQueueStatus::Running, Some(&run), None));

        assert!(snapshot.validate().is_ok());
        assert_eq!(snapshot.state, TaskState::WaitingForApproval);
        assert_eq!(snapshot.terminal_outcome, None);
    }

    #[test]
    fn terminal_snapshots_validate() {
        for state in [
            TaskQueueStatus::Completed,
            TaskQueueStatus::Failed,
            TaskQueueStatus::Cancelled,
        ] {
            let snapshot = assemble_task_snapshot(projection(state, None, Some("failed")));
            assert!(snapshot.validate().is_ok());
        }
    }

    #[test]
    fn route_is_projected_from_last_record() {
        let run = TaskRun {
            state: Some(TaskRunState::Completed),
            report: Some(ExecutionReport {
                route_records: vec![RouteRecord {
                    task_id: "task-1".to_string(),
                    role_id: "main".to_string(),
                    primary: RoutedModelRecord {
                        provider_name: "provider-a".to_string(),
                        model_name: "model-a".to_string(),
                        ..RoutedModelRecord::default()
                    },
                    fallbacks: Vec::new(),
                    route_reason: "selected route".to_string(),
                }],
                ..ExecutionReport::default()
            }),
            ..TaskRun::default()
        };
        let snapshot =
            assemble_task_snapshot(projection(TaskQueueStatus::Completed, Some(&run), None));
        let route = snapshot.route.expect("route");

        assert_eq!(route.provider, "provider-a");
        assert_eq!(route.model, "model-a");
        assert_eq!(route.reason.as_deref(), Some("selected route"));
    }
}
