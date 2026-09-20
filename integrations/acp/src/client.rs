use std::collections::HashMap;
use std::sync::atomic::{AtomicI64, Ordering};
use std::sync::Arc;
use std::time::Duration;

use anyhow::{anyhow, Result};
use serde_json::Value;
use tokio::io::{AsyncRead, AsyncWrite, AsyncWriteExt, BufReader};
use tokio::sync::{mpsc, oneshot, Mutex};
use tokio::time::timeout;

use crate::framing::{decode_line, encode_request, take_lines, FramedMessage};
use crate::protocol::{
    initialize_params, JsonRpcError, JsonRpcId, JsonRpcMessage, JsonRpcRequest, JsonRpcResponse,
    METHOD_INITIALIZE,
};

/// Handler for Agent → client reverse requests (e.g. permission).
pub trait IncomingRequestHandler: Send + Sync + 'static {
    /// Return Some(result) to approve/answer, or Some(error) via response construction.
    fn handle(&self, request: &JsonRpcRequest) -> Option<Result<Value, JsonRpcError>>;
}

/// Events delivered to the backend adapter / daemon layer.
#[derive(Debug, Clone)]
pub enum AcpClientEvent {
    Notification {
        method: String,
        params: Option<Value>,
    },
    /// Agent initiated a request (permission, etc.).
    IncomingRequest {
        method: String,
        id: JsonRpcId,
        params: Option<Value>,
    },
    /// Stdout closed or process ended.
    Closed,
}

#[derive(Debug, Clone)]
pub struct ClientConfig {
    pub request_timeout: Duration,
    pub client_name: String,
    pub client_version: String,
}

impl Default for ClientConfig {
    fn default() -> Self {
        Self {
            request_timeout: Duration::from_secs(60),
            client_name: "sacode".to_string(),
            client_version: env!("CARGO_PKG_VERSION").to_string(),
        }
    }
}

type PendingMap = HashMap<String, oneshot::Sender<JsonRpcResponse>>;

/// Shared ACP client state over any AsyncRead/AsyncWrite pair (stdio, TCP, mock).
pub struct AcpClient {
    writer: Arc<Mutex<Box<dyn AsyncWrite + Send + Unpin>>>,
    pending: Arc<Mutex<PendingMap>>,
    next_id: AtomicI64,
    config: ClientConfig,
    #[allow(dead_code)]
    event_tx: mpsc::Sender<AcpClientEvent>,
    /// Closed when reader loop exits.
    closed_tx: Arc<Mutex<Option<oneshot::Sender<()>>>>,
}

impl AcpClient {
    /// Spawn reader loop on `reader`; write requests through `writer`.
    /// Returns client + event receiver.
    pub fn spawn<R>(
        reader: R,
        writer: Box<dyn AsyncWrite + Send + Unpin>,
        handler: Option<Arc<dyn IncomingRequestHandler>>,
        config: ClientConfig,
    ) -> (Arc<Self>, mpsc::Receiver<AcpClientEvent>)
    where
        R: AsyncRead + Send + Unpin + 'static,
    {
        let (event_tx, event_rx) = mpsc::channel(256);
        let (closed_tx, _closed_rx) = oneshot::channel();
        let pending: Arc<Mutex<PendingMap>> = Arc::new(Mutex::new(HashMap::new()));
        let client = Arc::new(Self {
            writer: Arc::new(Mutex::new(writer)),
            pending: pending.clone(),
            next_id: AtomicI64::new(1),
            config,
            event_tx: event_tx.clone(),
            closed_tx: Arc::new(Mutex::new(Some(closed_tx))),
        });

        let pending_reader = pending.clone();
        let event_tx_reader = event_tx.clone();
        let client_for_incoming = client.clone();
        tokio::spawn(async move {
            let mut reader = BufReader::new(reader);
            let mut buffer = String::new();
            let mut chunk = vec![0u8; 8192];
            loop {
                match tokio::io::AsyncReadExt::read(&mut reader, &mut chunk).await {
                    Ok(0) | Err(_) => {
                        // Fail all pending requests so callers do not hang.
                        let mut map = pending_reader.lock().await;
                        for (_, tx) in map.drain() {
                            let _ = tx.send(JsonRpcResponse::failure(
                                JsonRpcId::String("closed".into()),
                                JsonRpcError {
                                    code: -32001,
                                    message: "agent process closed".into(),
                                    data: None,
                                },
                            ));
                        }
                        let _ = event_tx_reader.send(AcpClientEvent::Closed).await;
                        break;
                    }
                    Ok(n) => {
                        buffer.push_str(&String::from_utf8_lossy(&chunk[..n]));
                        for line in take_lines(&mut buffer) {
                            match decode_line(&line) {
                                Ok(FramedMessage::Message(msg)) => {
                                    handle_inbound(
                                        msg,
                                        &pending_reader,
                                        &event_tx_reader,
                                        handler.as_deref(),
                                        &client_for_incoming,
                                    )
                                    .await;
                                }
                                Ok(FramedMessage::Invalid { .. }) | Err(_) => {
                                    // Skip malformed lines; adapters log if needed.
                                    tracing::warn!("acp client skipped malformed frame");
                                }
                            }
                        }
                    }
                }
            }
            if let Some(tx) = client_for_incoming.closed_tx.lock().await.take() {
                let _ = tx.send(());
            }
        });

        (client, event_rx)
    }

    pub async fn request(&self, method: &str, params: Option<Value>) -> Result<Value> {
        let id_num = self.next_id.fetch_add(1, Ordering::SeqCst);
        let id = JsonRpcId::Number(id_num);
        let line = encode_request(id_num, method, params);
        let (tx, rx) = oneshot::channel();
        {
            let mut map = self.pending.lock().await;
            map.insert(id.as_key(), tx);
        }
        {
            let mut w = self.writer.lock().await;
            w.write_all(line.as_bytes()).await?;
            w.write_all(b"\n").await?;
            w.flush().await?;
        }

        match timeout(self.config.request_timeout, rx).await {
            Ok(Ok(response)) => {
                if let Some(err) = response.error {
                    Err(anyhow!("ACP error {}: {}", err.code, err.message))
                } else {
                    Ok(response.result.unwrap_or(Value::Null))
                }
            }
            Ok(Err(_)) => Err(anyhow!("ACP request channel closed for {method}")),
            Err(_) => {
                self.pending.lock().await.remove(&id.as_key());
                Err(anyhow!(
                    "ACP request timeout after {:?} method={method}",
                    self.config.request_timeout
                ))
            }
        }
    }

    pub async fn notify(&self, method: &str, params: Option<Value>) -> Result<()> {
        let mut msg = serde_json::json!({"jsonrpc":"2.0","method": method});
        if let Some(params) = params {
            msg["params"] = params;
        }
        let line = crate::framing::encode_line(&msg);
        let mut w = self.writer.lock().await;
        w.write_all(line.as_bytes()).await?;
        w.write_all(b"\n").await?;
        w.flush().await?;
        Ok(())
    }

    pub async fn send_response(&self, response: &JsonRpcResponse) -> Result<()> {
        let line = crate::framing::encode_line(&serde_json::to_value(response)?);
        let mut w = self.writer.lock().await;
        w.write_all(line.as_bytes()).await?;
        w.write_all(b"\n").await?;
        w.flush().await?;
        Ok(())
    }

    pub async fn initialize(&self) -> Result<Value> {
        self.request(
            METHOD_INITIALIZE,
            Some(initialize_params(
                &self.config.client_name,
                &self.config.client_version,
            )),
        )
        .await
    }

    pub fn request_timeout(&self) -> Duration {
        self.config.request_timeout
    }

    pub fn config(&self) -> &ClientConfig {
        &self.config
    }
}

async fn handle_inbound(
    msg: JsonRpcMessage,
    pending: &Arc<Mutex<PendingMap>>,
    event_tx: &mpsc::Sender<AcpClientEvent>,
    handler: Option<&dyn IncomingRequestHandler>,
    client: &Arc<AcpClient>,
) {
    match msg {
        JsonRpcMessage::Response(response) => {
            let key = response.id.as_key();
            let tx = pending.lock().await.remove(&key);
            if let Some(tx) = tx {
                let _ = tx.send(response);
            }
        }
        JsonRpcMessage::Notification(notification) => {
            let _ = event_tx
                .send(AcpClientEvent::Notification {
                    method: notification.method,
                    params: notification.params,
                })
                .await;
        }
        JsonRpcMessage::Request(request) => {
            if let Some(handler) = handler {
                if let Some(result) = handler.handle(&request) {
                    let response = match result {
                        Ok(value) => JsonRpcResponse::success(request.id.clone(), value),
                        Err(err) => JsonRpcResponse::failure(request.id.clone(), err),
                    };
                    let _ = client.send_response(&response).await;
                    return;
                }
            }
            // No handler: reply method-not-found so agent does not hang.
            let response = JsonRpcResponse::failure(
                request.id.clone(),
                JsonRpcError::method_not_found(&request.method),
            );
            let _ = client.send_response(&response).await;
            let _ = event_tx
                .send(AcpClientEvent::IncomingRequest {
                    method: request.method,
                    id: request.id,
                    params: request.params,
                })
                .await;
        }
    }
}

// Cleaner test harness used by unit tests
#[cfg(test)]
pub struct DuplexHarness {
    pub client: Arc<AcpClient>,
    pub events: mpsc::Receiver<AcpClientEvent>,
    pub agent: tokio::io::DuplexStream,
}

#[cfg(test)]
pub fn duplex_client(timeout_ms: u64) -> DuplexHarness {
    let (client_end, agent_end) = tokio::io::duplex(64 * 1024);
    let (read_half, write_half) = tokio::io::split(client_end);
    struct W(tokio::io::WriteHalf<tokio::io::DuplexStream>);
    impl AsyncWrite for W {
        fn poll_write(
            self: std::pin::Pin<&mut Self>,
            cx: &mut std::task::Context<'_>,
            buf: &[u8],
        ) -> std::task::Poll<Result<usize, std::io::Error>> {
            std::pin::Pin::new(&mut self.get_mut().0).poll_write(cx, buf)
        }
        fn poll_flush(
            self: std::pin::Pin<&mut Self>,
            cx: &mut std::task::Context<'_>,
        ) -> std::task::Poll<Result<(), std::io::Error>> {
            std::pin::Pin::new(&mut self.get_mut().0).poll_flush(cx)
        }
        fn poll_shutdown(
            self: std::pin::Pin<&mut Self>,
            cx: &mut std::task::Context<'_>,
        ) -> std::task::Poll<Result<(), std::io::Error>> {
            std::pin::Pin::new(&mut self.get_mut().0).poll_shutdown(cx)
        }
    }
    let config = ClientConfig {
        request_timeout: Duration::from_millis(timeout_ms),
        ..Default::default()
    };
    let (client, events) = AcpClient::spawn(read_half, Box::new(W(write_half)), None, config);
    DuplexHarness {
        client,
        events,
        agent: agent_end,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    async fn read_agent_line(agent: &mut tokio::io::DuplexStream) -> String {
        let mut buf = vec![0u8; 8192];
        let mut acc = Vec::new();
        loop {
            let n = agent.read(&mut buf).await.unwrap();
            if n == 0 {
                break;
            }
            acc.extend_from_slice(&buf[..n]);
            if let Some(pos) = acc.iter().position(|b| *b == b'\n') {
                return String::from_utf8_lossy(&acc[..pos]).to_string();
            }
        }
        String::from_utf8_lossy(&acc).to_string()
    }

    #[tokio::test]
    async fn initialize_transcript_roundtrip() {
        let mut h = duplex_client(2000);
        let client = h.client.clone();
        let handle = tokio::spawn(async move { client.initialize().await });
        let request_line = read_agent_line(&mut h.agent).await;
        assert!(request_line.contains("initialize"));
        let value: Value = serde_json::from_str(&request_line).unwrap();
        let id = value["id"].clone();
        let response = serde_json::json!({
            "jsonrpc": "2.0",
            "id": id,
            "result": { "capabilities": { "session": true, "streaming": true } }
        });
        h.agent
            .write_all(format!("{response}\n").as_bytes())
            .await
            .unwrap();
        let result = handle.await.unwrap().unwrap();
        assert_eq!(result["capabilities"]["session"], true);
    }

    #[tokio::test]
    async fn concurrent_requests_handle_out_of_order_responses() {
        let mut h = duplex_client(3000);
        let c1 = h.client.clone();
        let c2 = h.client.clone();
        // Issue first request, capture id, then second — still concurrent pending.
        let t1 = tokio::spawn(async move {
            c1.request("session/new", Some(serde_json::json!({"cwd":"."})))
                .await
        });
        let line1 = tokio::time::timeout(Duration::from_secs(2), read_agent_line(&mut h.agent))
            .await
            .expect("first request line");
        let v1: Value = serde_json::from_str(&line1).unwrap();

        let t2 = tokio::spawn(async move {
            c2.request("session/load", Some(serde_json::json!({"id":"s"})))
                .await
        });
        let line2 = tokio::time::timeout(Duration::from_secs(2), read_agent_line(&mut h.agent))
            .await
            .expect("second request line");
        let v2: Value = serde_json::from_str(&line2).unwrap();
        assert_ne!(v1["id"], v2["id"]);

        // Respond in reverse order
        let resp2 =
            serde_json::json!({"jsonrpc":"2.0","id": v2["id"], "result":{"sessionId":"s2"}});
        let resp1 =
            serde_json::json!({"jsonrpc":"2.0","id": v1["id"], "result":{"sessionId":"s1"}});
        h.agent
            .write_all(format!("{resp2}\n{resp1}\n").as_bytes())
            .await
            .unwrap();

        let r2 = tokio::time::timeout(Duration::from_secs(2), t2)
            .await
            .expect("t2 timeout")
            .unwrap()
            .unwrap();
        let r1 = tokio::time::timeout(Duration::from_secs(2), t1)
            .await
            .expect("t1 timeout")
            .unwrap()
            .unwrap();
        if v1["method"] == "session/new" {
            assert_eq!(r1["sessionId"], "s1");
            assert_eq!(r2["sessionId"], "s2");
        } else {
            assert_eq!(r1["sessionId"], "s2");
            assert_eq!(r2["sessionId"], "s1");
        }
    }

    #[tokio::test]
    async fn notification_and_response_interleave() {
        let mut h = duplex_client(2000);
        let client = h.client.clone();
        let handle = tokio::spawn(async move {
            client
                .request(
                    "session/prompt",
                    Some(serde_json::json!({"sessionId":"s","prompt":"hi"})),
                )
                .await
        });
        let req = read_agent_line(&mut h.agent).await;
        let v: Value = serde_json::from_str(&req).unwrap();
        let note = serde_json::json!({"jsonrpc":"2.0","method":"session/event","params":{"sessionId":"s","kind":"text"}});
        let resp = serde_json::json!({"jsonrpc":"2.0","id": v["id"], "result":{"eventCount":1}});
        h.agent
            .write_all(format!("{note}\n{resp}\n").as_bytes())
            .await
            .unwrap();
        let result = handle.await.unwrap().unwrap();
        assert_eq!(result["eventCount"], 1);
        match h.events.recv().await {
            Some(AcpClientEvent::Notification { method, .. }) => {
                assert_eq!(method, "session/event")
            }
            other => panic!("expected notification, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn agent_permission_request_dispatched() {
        struct DenyAll;
        impl IncomingRequestHandler for DenyAll {
            fn handle(&self, request: &JsonRpcRequest) -> Option<Result<Value, JsonRpcError>> {
                if request.method == "session/permission" {
                    Some(Ok(
                        serde_json::json!({"approved": false, "reason": "denied"}),
                    ))
                } else {
                    None
                }
            }
        }
        let (client_end, mut agent) = tokio::io::duplex(64 * 1024);
        let (read_half, write_half) = tokio::io::split(client_end);
        struct W(tokio::io::WriteHalf<tokio::io::DuplexStream>);
        impl AsyncWrite for W {
            fn poll_write(
                self: std::pin::Pin<&mut Self>,
                cx: &mut std::task::Context<'_>,
                buf: &[u8],
            ) -> std::task::Poll<Result<usize, std::io::Error>> {
                std::pin::Pin::new(&mut self.get_mut().0).poll_write(cx, buf)
            }
            fn poll_flush(
                self: std::pin::Pin<&mut Self>,
                cx: &mut std::task::Context<'_>,
            ) -> std::task::Poll<Result<(), std::io::Error>> {
                std::pin::Pin::new(&mut self.get_mut().0).poll_flush(cx)
            }
            fn poll_shutdown(
                self: std::pin::Pin<&mut Self>,
                cx: &mut std::task::Context<'_>,
            ) -> std::task::Poll<Result<(), std::io::Error>> {
                std::pin::Pin::new(&mut self.get_mut().0).poll_shutdown(cx)
            }
        }
        let _client = AcpClient::spawn(
            read_half,
            Box::new(W(write_half)),
            Some(Arc::new(DenyAll)),
            ClientConfig::default(),
        );
        agent
            .write_all(
                br#"{"jsonrpc":"2.0","id":"perm-1","method":"session/permission","params":{"tool":"fs.write"}}"#,
            )
            .await
            .unwrap();
        agent.write_all(b"\n").await.unwrap();
        let mut buf = vec![0u8; 4096];
        let mut acc = Vec::new();
        loop {
            let n = agent.read(&mut buf).await.unwrap();
            if n == 0 {
                break;
            }
            acc.extend_from_slice(&buf[..n]);
            if acc.contains(&b'\n') {
                break;
            }
        }
        let line = String::from_utf8_lossy(&acc);
        assert!(line.contains("perm-1"));
        assert!(line.contains("approved"));
        assert!(line.contains("false"));
    }

    #[tokio::test]
    async fn request_timeout_returns_error() {
        let h = duplex_client(50);
        let client = h.client.clone();
        let err = client.request("initialize", None).await.unwrap_err();
        assert!(err.to_string().contains("timeout") || err.to_string().contains("closed"));
    }

    #[tokio::test]
    async fn process_exit_clears_pending() {
        let mut h = duplex_client(5000);
        let client = h.client.clone();
        let handle = tokio::spawn(async move { client.request("session/new", None).await });
        let _ = read_agent_line(&mut h.agent).await;
        drop(h.agent); // close agent side → client reader EOF
        let err = handle.await.unwrap().unwrap_err();
        assert!(err.to_string().contains("closed") || err.to_string().contains("timeout"));
        match h.events.recv().await {
            Some(AcpClientEvent::Closed) | None => {}
            other => panic!("expected closed event, got {other:?}"),
        }
    }
}
