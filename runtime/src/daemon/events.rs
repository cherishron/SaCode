use std::{convert::Infallible, sync::Arc};

use axum::{
    extract::{Path, Query, State},
    response::sse::{Event, Sse},
};
use tokio::sync::broadcast;

use sacode_kernel::{TaskQueueStatus, TaskRun};

use crate::streaming::sse::{stream_from_broadcast, stream_from_broadcast_with_replay};

use super::{
    parse_mode, status::sync_task_status_from_task_run, status::task_run_for_queue_status,
    DaemonState, StreamEvent,
};

#[derive(Debug, Default, serde::Deserialize)]
pub struct StreamQuery {
    pub task_id: Option<String>,
}

pub fn emit_event(state: &DaemonState, task_id: &str, event_type: &str, data: serde_json::Value) {
    let mut stream_evt = StreamEvent {
        task_id: task_id.to_string(),
        event_type: event_type.to_string(),
        data: normalize_stream_event(task_id, event_type, data),
        seq: None,
    };
    // 先写入历史缓冲（会赋值 seq），再 broadcast，确保重连客户端能通过 Last-Event-ID 续传
    state.event_history.push(&mut stream_evt);
    // 注：send 失败表示无活跃接收者，属正常情况（无 SSE 客户端连接时），不需告警
    let _ = state.event_bus.send(stream_evt);
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
                    let mut stream_evt = StreamEvent {
                        task_id: evt.task_id.clone(),
                        event_type: evt.event_type.clone(),
                        data: normalize_stream_event(&evt.task_id, &evt.event_type, evt.data),
                        seq: None,
                    };
                    // 转发到 daemon event_bus 前先写入历史，保证 executor→daemon→SSE 全链路可续传
                    state.event_history.push(&mut stream_evt);
                    let _ = state.event_bus.send(stream_evt);
                }
                Err(broadcast::error::RecvError::Lagged(skipped)) => {
                    // executor event_bus 溢出，从 executor 到 daemon 的事件已丢失
                    // 这是端到端流式任务的连通性断点：SSE 客户端将永久漏掉这些事件
                    // 记录 warn 以便运维定位，客户端可通过 Last-Event-ID 重连续传已缓冲部分
                    tracing::warn!(
                        target: "sacode.daemon.forwarder",
                        skipped,
                        "executor event_bus lagged, events dropped from daemon forwarder; \
                         SSE clients should reconnect with Last-Event-ID to reconcile"
                    );
                    continue;
                }
                Err(broadcast::error::RecvError::Closed) => break,
            }
        }
    });
}

pub fn spawn_daemon_workers(state: Arc<DaemonState>) {
    tokio::spawn(async move {
        loop {
            {
                let mut executor = state.executor.lock().await;
                executor.run_once().await;
            }
            state.retry_handler.run_once().await;
            tokio::time::sleep(std::time::Duration::from_millis(100)).await;
        }
    });
}

fn normalize_stream_event(
    task_id: &str,
    event_type: &str,
    data: serde_json::Value,
) -> serde_json::Value {
    let timestamp = chrono::Utc::now().to_rfc3339();
    let payload = match data {
        serde_json::Value::Object(map) => serde_json::Value::Object(map),
        other => serde_json::json!({ "value": other }),
    };

    let mut normalized = serde_json::Map::new();
    normalized.insert(
        "task_id".to_string(),
        serde_json::Value::String(task_id.to_string()),
    );
    normalized.insert(
        "event_type".to_string(),
        serde_json::Value::String(event_type.to_string()),
    );
    normalized.insert(
        "timestamp".to_string(),
        serde_json::Value::String(timestamp),
    );
    normalized.insert("payload".to_string(), payload.clone());

    if let serde_json::Value::Object(map) = payload {
        normalized.extend(map);
    }

    serde_json::Value::Object(normalized)
}

pub async fn stream_events(
    State(state): State<Arc<DaemonState>>,
) -> Sse<impl futures::Stream<Item = Result<Event, Infallible>>> {
    // 全局事件流：不支持 Last-Event-ID replay（跨任务回放成本高，由消费方按需重连单任务）
    stream_from_broadcast(state.event_bus.subscribe(), None)
}

pub async fn stream_task_events(
    State(state): State<Arc<DaemonState>>,
    Path(task_id): Path<String>,
    headers: axum::http::HeaderMap,
) -> Sse<impl futures::Stream<Item = Result<Event, Infallible>>> {
    let last_event_id = parse_last_event_id(&headers);
    stream_from_broadcast_with_replay(
        state.event_bus.subscribe(),
        Some(task_id),
        &state.event_history,
        last_event_id,
    )
}

pub async fn stream_api_events(
    State(state): State<Arc<DaemonState>>,
    Query(query): Query<StreamQuery>,
    headers: axum::http::HeaderMap,
) -> Sse<impl futures::Stream<Item = Result<Event, Infallible>>> {
    let last_event_id = parse_last_event_id(&headers);
    stream_from_broadcast_with_replay(
        state.event_bus.subscribe(),
        query.task_id,
        &state.event_history,
        last_event_id,
    )
}

/// 解析 `Last-Event-ID` 请求头，返回其代表的 seq
/// SSE 规范：客户端重连时携带最后收到的事件 id，服务端据此回放后续事件
fn parse_last_event_id(headers: &axum::http::HeaderMap) -> Option<u64> {
    headers
        .get("last-event-id")
        .and_then(|v| v.to_str().ok())
        .and_then(|s| s.trim().parse::<u64>().ok())
}

async fn update_task_status_from_executor_event(
    state: &Arc<DaemonState>,
    evt: &crate::executor::ExecutorEvent,
) {
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
                if let Ok(result) =
                    serde_json::from_value::<sacode_kernel::TaskResult>(result_value.clone())
                {
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
