use std::{convert::Infallible, sync::Arc};

use async_stream::stream;
use axum::{
    extract::{Path, State},
    response::sse::{Event, KeepAlive, Sse},
};
use tokio::sync::broadcast;

use sacode_kernel::{TaskQueueStatus, TaskRun};

use super::{parse_mode, status::sync_task_status_from_task_run, status::task_run_for_queue_status, DaemonState, StreamEvent};

pub fn emit_event(state: &DaemonState, task_id: &str, event_type: &str, data: serde_json::Value) {
    let _ = state.event_bus.send(StreamEvent {
        task_id: task_id.to_string(),
        event_type: event_type.to_string(),
        data,
    });
}

pub fn spawn_executor_event_forwarder(state: Arc<DaemonState>) {
    tokio::spawn(async move {
        let mut receiver = {
            let executor = state.executor.lock().await;
            executor.subscribe()
        };

        loop {
            match receiver.recv().await {
                Ok(evt) => {
                    update_task_status_from_executor_event(&state, &evt).await;
                    let _ = state.event_bus.send(StreamEvent {
                        task_id: evt.task_id,
                        event_type: evt.event_type,
                        data: evt.data,
                    });
                }
                Err(broadcast::error::RecvError::Lagged(_)) => continue,
                Err(broadcast::error::RecvError::Closed) => break,
            }
        }
    });
}

pub async fn stream_events(
    State(state): State<Arc<DaemonState>>,
) -> Sse<impl futures::Stream<Item = Result<Event, Infallible>>> {
    let mut receiver = state.event_bus.subscribe();

    let stream = stream! {
        loop {
            match receiver.recv().await {
                Ok(evt) => {
                    let payload = serde_json::to_string(&evt).unwrap_or_else(|_| "{}".to_string());
                    yield Ok(Event::default().event(evt.event_type.clone()).data(payload));
                }
                Err(broadcast::error::RecvError::Lagged(_)) => continue,
                Err(broadcast::error::RecvError::Closed) => break,
            }
        }
    };

    Sse::new(stream).keep_alive(KeepAlive::default())
}

pub async fn stream_task_events(
    State(state): State<Arc<DaemonState>>,
    Path(task_id): Path<String>,
) -> Sse<impl futures::Stream<Item = Result<Event, Infallible>>> {
    let mut receiver = state.event_bus.subscribe();

    let stream = stream! {
        loop {
            match receiver.recv().await {
                Ok(evt) if evt.task_id == task_id => {
                    let payload = serde_json::to_string(&evt).unwrap_or_else(|_| "{}".to_string());
                    yield Ok(Event::default().event(evt.event_type.clone()).data(payload));
                }
                Ok(_) => continue,
                Err(broadcast::error::RecvError::Lagged(_)) => continue,
                Err(broadcast::error::RecvError::Closed) => break,
            }
        }
    };

    Sse::new(stream).keep_alive(KeepAlive::default())
}

async fn update_task_status_from_executor_event(state: &Arc<DaemonState>, evt: &crate::executor::ExecutorEvent) {
    let mut tasks = state.tasks.write().await;
    let Some(status) = tasks.get_mut(&evt.task_id) else {
        return;
    };

    status.current_event = Some(evt.event_type.clone());

    match evt.event_type.as_str() {
        "task_started" => {
            status.task_run = Some(task_run_for_queue_status(
                Some(status.task_id.clone()),
                parse_mode(&status.mode),
                status.prompt.clone(),
                TaskQueueStatus::Running,
                None,
            ));
            sync_task_status_from_task_run(status);
        }
        "task_completed" | "task_failed" => {
            if let Some(result_value) = evt.data.get("result") {
                if let Ok(result) = serde_json::from_value::<sacode_kernel::TaskResult>(result_value.clone()) {
                    status.duration_ms = Some(result.duration_ms);
                    status.output = result.output.clone();
                    status.error = result.error.clone();
                }
            }
            if let Some(task_run_value) = evt.data.get("task_run") {
                if let Ok(task_run) = serde_json::from_value::<TaskRun>(task_run_value.clone()) {
                    status.task_run = Some(task_run);
                }
            }
            sync_task_status_from_task_run(status);
        }
        _ => {}
    }
}
