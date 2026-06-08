use std::{convert::Infallible, pin::Pin};

use async_stream::stream;
use axum::response::sse::{Event, KeepAlive, Sse};
use futures::Stream;
use tokio::sync::broadcast;

use crate::daemon::StreamEvent;

pub type SseResponse = Sse<Pin<Box<dyn Stream<Item = Result<Event, Infallible>> + Send>>>;

pub fn stream_from_broadcast(
    mut receiver: broadcast::Receiver<StreamEvent>,
    task_filter: Option<String>,
) -> SseResponse {
    let stream = stream! {
        loop {
            match receiver.recv().await {
                Ok(evt) => {
                    if let Some(filter) = task_filter.as_ref() {
                        if evt.task_id != *filter {
                            continue;
                        }
                    }
                    let payload =
                        serde_json::to_string(&evt.data).unwrap_or_else(|_| "{}".to_string());
                    yield Ok(Event::default().event(evt.event_type.clone()).data(payload));
                }
                Err(broadcast::error::RecvError::Lagged(_)) => continue,
                Err(broadcast::error::RecvError::Closed) => break,
            }
        }
    };

    let boxed_stream: Pin<Box<dyn Stream<Item = Result<Event, Infallible>> + Send>> =
        Box::pin(stream);
    Sse::new(boxed_stream).keep_alive(KeepAlive::default())
}
