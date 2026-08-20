use std::{convert::Infallible, pin::Pin, time::Duration};

use async_stream::stream;
use axum::response::sse::{Event, KeepAlive, Sse};
use futures::{stream, Stream, StreamExt};
use tokio::sync::broadcast;

use crate::daemon::{EventHistory, StreamEvent};

pub type SseResponse = Sse<Pin<Box<dyn Stream<Item = Result<Event, Infallible>> + Send>>>;

/// 终结事件类型：订阅特定任务时收到这些事件后主动关闭流，
/// 让消费方能正确感知任务结束而不是无限挂起等待
const TERMINAL_EVENTS: &[&str] = &["task_completed", "task_failed", "task_cancelled"];

/// 构造 SSE 响应：把 StreamEvent 流转换为 axum SSE Event 流
/// - `evt.seq` 作为 SSE `id` 字段下发，供客户端 Last-Event-ID 续传
/// - KeepAlive 显式 15s + "ping" 文本，跨代理兼容性更好
fn build_sse_response<S>(stream: S) -> SseResponse
where
    S: Stream<Item = StreamEvent> + Send + 'static,
{
    let event_stream = stream.map(|evt| {
        let payload = serde_json::to_string(&evt.data).unwrap_or_else(|_| "{}".to_string());
        let mut event = Event::default().event(evt.event_type).data(payload);
        if let Some(seq) = evt.seq {
            event = event.id(seq.to_string());
        }
        Ok::<Event, Infallible>(event)
    });
    let boxed_stream: Pin<Box<dyn Stream<Item = Result<Event, Infallible>> + Send>> =
        Box::pin(event_stream);
    Sse::new(boxed_stream).keep_alive(
        KeepAlive::new()
            .interval(Duration::from_secs(15))
            .text("ping"),
    )
}

/// 无 replay 的 SSE 流：直接消费 broadcast
pub fn stream_from_broadcast(
    receiver: broadcast::Receiver<StreamEvent>,
    task_filter: Option<String>,
) -> SseResponse {
    build_sse_response(filter_stream_events(receiver, task_filter))
}

/// 带 Last-Event-ID replay 的 SSE 流：先回放历史事件，再切到 live broadcast
///
/// 流程：
/// 1. 回放 history 中 seq > `last_event_id` 的事件（按 task_filter 过滤）
/// 2. 记录 replay 的最大 seq，live 阶段跳过 seq <= 该值的事件以避免重复
/// 3. 切到 live broadcast 继续消费
///
/// 这样客户端断线重连时不会丢失任务执行中的事件，实现端到端流式任务无中断
pub fn stream_from_broadcast_with_replay(
    receiver: broadcast::Receiver<StreamEvent>,
    task_filter: Option<String>,
    history: &EventHistory,
    last_event_id: Option<u64>,
) -> SseResponse {
    build_sse_response(replay_then_live_stream(
        receiver,
        task_filter,
        history,
        last_event_id,
    ))
}

/// 构造 replay + live 合并的裸 StreamEvent 流（供测试直接消费，不经 Sse 包装）
fn replay_then_live_stream(
    receiver: broadcast::Receiver<StreamEvent>,
    task_filter: Option<String>,
    history: &EventHistory,
    last_event_id: Option<u64>,
) -> impl Stream<Item = StreamEvent> + Send + 'static {
    // 1. 回放历史事件
    let replay = last_event_id
        .map(|last| history.replay_after(last))
        .unwrap_or_default();
    let replay_max_seq = replay.last().map(|(s, _)| *s).unwrap_or(0u64);

    // 2. 按任务过滤 replay 事件
    let filter = task_filter.clone();
    let replay_filtered: Vec<StreamEvent> = replay
        .into_iter()
        .filter_map(|(_, evt)| {
            if let Some(f) = filter.as_ref() {
                if evt.task_id != *f {
                    return None;
                }
            }
            Some(evt)
        })
        .collect();

    // 3. replay 流 + live 流（去重）
    let replay_stream = stream::iter(replay_filtered);
    let live_stream = filter_stream_events(receiver, task_filter).filter(move |evt| {
        // 跳过 live 中已被 replay 覆盖的事件（通过 seq 去重）
        let evt_seq = evt.seq.unwrap_or(0);
        futures::future::ready(evt_seq > replay_max_seq)
    });

    replay_stream.chain(live_stream)
}

/// 从 broadcast 接收器过滤并转发 StreamEvent
///
/// 行为约定（端到端流式任务稳定性）：
/// 1. `task_filter` 非空时仅转发匹配 task_id 的事件
/// 2. `task_filter` 非空且收到终结事件（task_completed/task_failed/task_cancelled）后主动关闭流，
///    让订阅特定任务的客户端能正确感知结束而不是无限挂起；全局 `/events` 不关闭
/// 3. broadcast Lagged 时发出 `lagged` 提示事件（含 skipped 数与 hint），让消费方可补偿拉取
///    `/task/:id/status`，而不是静默漏掉关键事件
fn filter_stream_events(
    mut receiver: broadcast::Receiver<StreamEvent>,
    task_filter: Option<String>,
) -> impl Stream<Item = StreamEvent> + Send {
    stream! {
        loop {
            match receiver.recv().await {
                Ok(evt) => {
                    // 仅订阅特定任务时按 task_id 过滤
                    if let Some(filter) = task_filter.as_ref() {
                        if evt.task_id != *filter {
                            continue;
                        }
                    }
                    let is_terminal = TERMINAL_EVENTS.iter().any(|t| *t == evt.event_type);
                    yield evt;
                    // 订阅特定任务且收到终结事件时主动关闭流
                    // 全局 /events 不关闭，避免一个任务结束影响其他订阅
                    if task_filter.is_some() && is_terminal {
                        break;
                    }
                }
                Err(broadcast::error::RecvError::Lagged(skipped)) => {
                    // 消费方处理慢导致消息丢失，发送 lagged 提示事件
                    // 让消费方知道需要拉取 /task/:id/status 或带 Last-Event-ID 重连补偿
                    yield StreamEvent {
                        task_id: String::new(),
                        event_type: "lagged".to_string(),
                        data: serde_json::json!({
                            "reason": "lagged",
                            "skipped": skipped,
                            "hint": "reconnect with Last-Event-ID or fetch /task/:id/status to reconcile",
                        }),
                        seq: None,
                    };
                    continue;
                }
                Err(broadcast::error::RecvError::Closed) => break,
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    fn make_event(task_id: &str, event_type: &str) -> StreamEvent {
        StreamEvent {
            task_id: task_id.to_string(),
            event_type: event_type.to_string(),
            data: serde_json::json!({ "seq": event_type }),
            seq: None,
        }
    }

    /// 收集流中所有事件的 event_type 直到流结束
    async fn collect_event_types<S>(stream: S) -> Vec<String>
    where
        S: Stream<Item = StreamEvent>,
    {
        let mut types = vec![];
        let mut s = Box::pin(stream);
        while let Some(evt) = s.next().await {
            types.push(evt.event_type);
        }
        types
    }

    /// 订阅特定任务时，收到终结事件后流应主动关闭，让客户端能感知结束
    #[tokio::test]
    async fn closes_after_terminal_event_with_task_filter() {
        let (tx, rx) = broadcast::channel(16);
        let stream = filter_stream_events(rx, Some("task-1".to_string()));

        tx.send(make_event("task-1", "task_started")).unwrap();
        tx.send(make_event("task-1", "tool_call_started")).unwrap();
        tx.send(make_event("task-1", "task_completed")).unwrap();
        drop(tx);

        let types = collect_event_types(stream).await;
        assert_eq!(
            types,
            vec!["task_started", "tool_call_started", "task_completed"]
        );
    }

    /// 其他 task_id 的事件应被过滤掉，且不触发流关闭
    #[tokio::test]
    async fn filters_out_other_task_events() {
        let (tx, rx) = broadcast::channel(16);
        let stream = filter_stream_events(rx, Some("task-1".to_string()));

        tx.send(make_event("task-2", "task_completed")).unwrap();
        tx.send(make_event("task-1", "task_started")).unwrap();
        tx.send(make_event("task-1", "task_failed")).unwrap();
        drop(tx);

        let types = collect_event_types(stream).await;
        assert_eq!(types, vec!["task_started", "task_failed"]);
    }

    /// broadcast Lagged 时应发出 `lagged` 提示事件，而不是静默丢弃
    #[tokio::test]
    async fn emits_lagged_hint_on_overflow() {
        let (tx, rx) = broadcast::channel(2);
        let stream = filter_stream_events(rx, None);

        for i in 0..8 {
            let _ = tx.send(make_event("task-1", &format!("msg-{}", i)));
        }
        drop(tx);

        let types = collect_event_types(stream).await;
        assert!(
            types.iter().any(|t| t == "lagged"),
            "应在 broadcast 溢出时发出 lagged 提示事件，实际收到: {:?}",
            types
        );
    }

    /// 全局订阅（task_filter=None）收到终结事件不应关闭流
    #[tokio::test]
    async fn global_stream_does_not_close_on_terminal_event() {
        let (tx, rx) = broadcast::channel(16);
        let mut stream = Box::pin(filter_stream_events(rx, None));

        tx.send(make_event("task-1", "task_completed")).unwrap();
        let first = stream.next().await.expect("stream should yield event");
        assert_eq!(first.event_type, "task_completed");

        tx.send(make_event("task-2", "task_started")).unwrap();
        let second = tokio::time::timeout(Duration::from_millis(500), stream.next())
            .await
            .expect("流不应在终结事件后关闭")
            .expect("应有事件");
        assert_eq!(second.event_type, "task_started");
    }

    /// EventHistory 应能按 seq 顺序 push 和 replay_after 回放
    #[tokio::test]
    async fn event_history_push_and_replay() {
        let history = EventHistory::new(8);
        // 写入 3 条事件
        let mut e1 = make_event("task-1", "task_started");
        let s1 = history.push(&mut e1);
        let mut e2 = make_event("task-1", "task_completed");
        let s2 = history.push(&mut e2);
        let mut e3 = make_event("task-2", "task_started");
        let s3 = history.push(&mut e3);
        assert_eq!([s1, s2, s3], [1, 2, 3]);
        // push 后 evt.seq 应被赋值
        assert_eq!(e1.seq, Some(1));

        // replay_after(0) 应返回全部 3 条
        let replay = history.replay_after(0);
        assert_eq!(replay.len(), 3);
        assert_eq!(replay[0].0, 1);
        assert_eq!(replay[2].0, 3);

        // replay_after(1) 应返回 seq>1 的 2 条
        let replay = history.replay_after(1);
        assert_eq!(replay.len(), 2);
        assert_eq!(replay[0].0, 2);
    }

    /// EventHistory 容量满后应丢弃最旧的事件（环形缓冲）
    #[tokio::test]
    async fn event_history_evicts_oldest_when_full() {
        let history = EventHistory::new(3);
        for i in 0..5 {
            let mut e = make_event("task-1", &format!("evt-{}", i));
            history.push(&mut e);
        }
        // 容量 3，写入 5 条，应只保留最后 3 条（seq=3,4,5）
        let replay = history.replay_after(0);
        assert_eq!(replay.len(), 3);
        assert_eq!(replay[0].0, 3);
        assert_eq!(replay[2].0, 5);
    }

    /// stream_from_broadcast_with_replay 应先回放历史，再切到 live，且无重复
    #[tokio::test]
    async fn replay_then_live_without_duplicate() {
        let (tx, rx) = broadcast::channel(16);
        let history = EventHistory::new(32);

        // 预先写入 2 条历史事件（模拟客户端断线期间产生的事件）
        let mut e1 = make_event("task-1", "task_started");
        let s1 = history.push(&mut e1);
        let mut e2 = make_event("task-1", "msg-1");
        let s2 = history.push(&mut e2);
        assert_eq!([s1, s2], [1, 2]);

        // 客户端携带 Last-Event-ID=0 重连，应回放 seq>0 的历史
        let stream = replay_then_live_stream(rx, Some("task-1".to_string()), &history, Some(0));

        // 发送 live 事件：必须经过 history.push 以获得 seq，模拟生产环境 forwarder 行为
        let mut live_evt = make_event("task-1", "task_completed");
        let live_seq = history.push(&mut live_evt);
        assert_eq!(live_seq, 3);
        tx.send(live_evt).unwrap();
        drop(tx);

        // 收集所有事件的 event_type
        let types = collect_event_types(stream).await;
        // 应收到：2 条 replay(task_started, msg-1) + 1 条 live(task_completed 触发关闭) = 3 条
        assert_eq!(
            types,
            vec!["task_started", "msg-1", "task_completed"],
            "应回放 2 条历史 + 1 条 live 终结事件，实际: {:?}",
            types
        );
    }
}
