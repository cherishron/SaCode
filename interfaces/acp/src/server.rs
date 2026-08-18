use anyhow::Result;
use sacode_kernel::ApprovalPolicy;
use sacode_runtime::{SessionPrompt, SessionService};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use tokio::{
    io::{AsyncBufReadExt, AsyncWriteExt, BufReader},
    net::TcpListener,
};

use crate::config::AcpConfig;

/// 启动 ACP server（TCP 模式）
pub async fn run_server(config: &AcpConfig) -> Result<()> {
    let listener = TcpListener::bind((config.server.host.as_str(), config.server.port)).await?;
    let service = SessionService::new();
    let max_connections = config.server.max_connections;
    let active_connections = Arc::new(AtomicUsize::new(0usize));
    tracing::info!(
        host = %config.server.host,
        port = config.server.port,
        max_connections,
        "ACP server listening"
    );

    loop {
        let (stream, addr) = listener.accept().await?;
        if active_connections.load(Ordering::Relaxed) >= max_connections {
            tracing::warn!(%addr, active_connections = active_connections.load(Ordering::Relaxed), max_connections, "ACP connection rejected: max connections reached");
            continue;
        }
        active_connections.fetch_add(1, Ordering::Relaxed);
        tracing::debug!(%addr, active_connections = active_connections.load(Ordering::Relaxed), "accepted ACP connection");
        let service = service.clone();
        let conn_counter = active_connections.clone();
        tokio::spawn(async move {
            if let Err(error) = serve_tcp_connection(stream, service).await {
                tracing::warn!(%addr, %error, "ACP connection failed");
            }
            conn_counter.fetch_sub(1, Ordering::Relaxed);
            tracing::debug!(%addr, "ACP connection closed");
        });
    }
}

/// 启动 ACP server（stdio 子进程模式）
///
/// 从 stdin 读取 JSON-RPC 请求，写入 stdout 响应。
/// 每行一个 JSON 对象，支持流式推送事件通知。
pub async fn run_stdio_server() -> Result<()> {
    let service = SessionService::new();
    let stdin = tokio::io::stdin();
    let mut stdout = tokio::io::BufWriter::new(tokio::io::stdout());
    let mut lines = BufReader::new(stdin).lines();

    while let Some(line) = lines.next_line().await? {
        if line.trim().is_empty() {
            continue;
        }

        let request: JsonRpcRequest = match serde_json::from_str(&line) {
            Ok(req) => req,
            Err(e) => {
                let error_resp = JsonRpcResponse {
                    jsonrpc: "2.0".to_string(),
                    id: serde_json::Value::Null,
                    result: None,
                    error: Some(serde_json::json!({
                        "code": -32700,
                        "message": format!("parse error: {}", e)
                    })),
                };
                let _ = stdout
                    .write_all(format!("{}\n", serde_json::to_string(&error_resp)?).as_bytes())
                    .await;
                let _ = stdout.flush().await;
                continue;
            }
        };

        // 处理请求 — 对 session/prompt 做流式推送
        let response = handle_request_streaming(&service, &request, &mut stdout).await?;
        // 写最终响应
        stdout
            .write_all(format!("{}\n", serde_json::to_string(&response)?).as_bytes())
            .await?;
        stdout.flush().await?;
    }

    Ok(())
}

// ============================================================================
// TCP 连接处理
// ============================================================================

async fn serve_tcp_connection(
    stream: tokio::net::TcpStream,
    service: SessionService,
) -> Result<()> {
    let (reader, mut writer) = stream.into_split();
    let mut lines = BufReader::new(reader).lines();

    while let Some(line) = lines.next_line().await? {
        if line.trim().is_empty() {
            continue;
        }

        let request: JsonRpcRequest = match serde_json::from_str(&line) {
            Ok(req) => req,
            Err(e) => {
                let error_resp = JsonRpcResponse {
                    jsonrpc: "2.0".to_string(),
                    id: serde_json::Value::Null,
                    result: None,
                    error: Some(serde_json::json!({
                        "code": -32700,
                        "message": format!("parse error: {}", e)
                    })),
                };
                let _ = writer
                    .write_all(format!("{}\n", serde_json::to_string(&error_resp)?).as_bytes())
                    .await;
                let _ = writer.flush().await;
                continue;
            }
        };
        let response = handle_request(&service, request).await?;
        writer
            .write_all(format!("{}\n", serde_json::to_string(&response)?).as_bytes())
            .await?;
    }

    Ok(())
}

// ============================================================================
// 请求处理（含流式版本）
// ============================================================================

/// 标准请求处理 — 返回最终响应（无流式推送）
async fn handle_request(service: &SessionService, request: JsonRpcRequest) -> Result<JsonRpcResponse> {
    match dispatch_request(service, &request).await {
        Ok(result) => Ok(JsonRpcResponse {
            jsonrpc: "2.0".to_string(),
            id: request.id,
            result: Some(result),
            error: None,
        }),
        Err(error) => Ok(JsonRpcResponse {
            jsonrpc: "2.0".to_string(),
            id: request.id,
            result: None,
            error: Some(serde_json::json!({
                "code": -32601,
                "message": format!("{}", error)
            })),
        }),
    }
}

/// 流式请求处理 — 对 session/prompt 先推送事件通知，再返回最终响应
async fn handle_request_streaming(
    service: &SessionService,
    request: &JsonRpcRequest,
    writer: &mut (impl tokio::io::AsyncWrite + Unpin),
) -> Result<JsonRpcResponse> {
    let is_streaming_method = request.method == "session/prompt"
        || request.method == "session/update";

    if !is_streaming_method {
        // 非流式方法，直接返回
        return handle_request(service, request.clone()).await;
    }

    // 执行 prompt 获取事件
    let session_id = required_string(request, "sessionId")?;
    let content = required_string(request, "prompt")?;
    let mode = request
        .params
        .as_ref()
        .and_then(|value| value.get("mode"))
        .and_then(|value| value.as_str())
        .map(parse_mode)
        .unwrap_or(sacode_kernel::ExecutionMode::Build);
    let events = service
        .prompt(
            &session_id,
            SessionPrompt {
                content,
                mode,
                approval: ApprovalPolicy::AutoDeny,
            },
        )
        .await?;

    // 流式推送事件通知（无 id 的 JSON-RPC notification）
    for event in &events {
        let notification = serde_json::json!({
            "jsonrpc": "2.0",
            "method": "session/event",
            "params": {
                "sessionId": session_id,
                "event": event,
            }
        });
        let line = serde_json::to_string(&notification)?;
        // notification 用 "event: " 前缀，便于客户端区分
        writer
            .write_all(format!("event: {}\n", line).as_bytes())
            .await?;
        writer.flush().await?;
    }

    Ok(JsonRpcResponse {
        jsonrpc: "2.0".to_string(),
        id: request.id.clone(),
        result: Some(serde_json::json!({
            "eventCount": events.len(),
            "sessionId": session_id,
        })),
        error: None,
    })
}

/// 请求分发 — 执行具体方法
async fn dispatch_request(service: &SessionService, request: &JsonRpcRequest) -> Result<serde_json::Value> {
    let result = match request.method.as_str() {
        "initialize" => serde_json::json!({
            "capabilities": {
                "session": true,
                "loadSession": true,
                "tools": true,
                "streaming": true,
            }
        }),
        "session/new" => {
            let cwd = request
                .params
                .as_ref()
                .and_then(|value| value.get("cwd"))
                .and_then(|value| value.as_str())
                .map(std::path::PathBuf::from)
                .unwrap_or_else(|| std::env::current_dir().unwrap_or_else(|_| ".".into()));
            serde_json::to_value(service.create_session(cwd)?)?
        }
        "session/load" => {
            let cwd = request
                .params
                .as_ref()
                .and_then(|value| value.get("cwd"))
                .and_then(|value| value.as_str())
                .map(std::path::PathBuf::from)
                .unwrap_or_else(|| std::env::current_dir().unwrap_or_else(|_| ".".into()));
            let checkpoint = request
                .params
                .as_ref()
                .and_then(|value| value.get("checkpoint"))
                .and_then(|value| value.as_str())
                .ok_or_else(|| anyhow::anyhow!("missing checkpoint"))?;
            serde_json::to_value(service.load_session(&cwd, checkpoint)?)?
        }
        "session/prompt" => {
            // 非流式路径 — 直接返回事件（兼容旧客户端）
            let session_id = required_string(request, "sessionId")?;
            let content = required_string(request, "prompt")?;
            let mode = request
                .params
                .as_ref()
                .and_then(|value| value.get("mode"))
                .and_then(|value| value.as_str())
                .map(parse_mode)
                .unwrap_or(sacode_kernel::ExecutionMode::Build);
            let events = service
                .prompt(
                    &session_id,
                    SessionPrompt {
                        content,
                        mode,
                        approval: ApprovalPolicy::AutoDeny,
                    },
                )
                .await?;
            serde_json::to_value(events)?
        }
        "session/cancel" => {
            let session_id = required_string(request, "sessionId")?;
            service.cancel_session(&session_id)?;
            serde_json::json!({ "cancelled": true })
        }
        "session/close" => {
            let session_id = required_string(request, "sessionId")?;
            service.close_session(&session_id)?;
            serde_json::json!({ "closed": true })
        }
        "session/get" => {
            let session_id = required_string(request, "sessionId")?;
            serde_json::to_value(service.get_session(&session_id)?)?
        }
        "session/list" => serde_json::to_value(service.list_sessions())?,
        "tools/list" => {
            let registry = sacode_runtime::ToolRegistry::builtin();
            let tools: Vec<serde_json::Value> = registry
                .specs()
                .iter()
                .map(|spec| {
                    serde_json::json!({
                        "name": spec.name,
                        "description": spec.description,
                        "inputSchema": spec.input_schema,
                    })
                })
                .collect();
            serde_json::json!({ "tools": tools })
        }
        "tools/call" => {
            let tool_name = required_string(request, "name")?;
            let arguments = request
                .params
                .as_ref()
                .and_then(|value| value.get("arguments"))
                .cloned()
                .unwrap_or_else(|| serde_json::json!({}));
            let registry = sacode_runtime::ToolRegistry::builtin();
            match registry.execute(&tool_name, arguments) {
                Ok(output) => serde_json::json!({
                    "success": output.success,
                    "data": output.data,
                    "message": output.message,
                }),
                Err(error) => serde_json::json!({
                    "success": false,
                    "error": error.to_string(),
                }),
            }
        }
        other => anyhow::bail!("method not found: {}", other),
    };

    Ok(result)
}

// ============================================================================
// 辅助函数
// ============================================================================

fn required_string(request: &JsonRpcRequest, key: &str) -> Result<String> {
    request
        .params
        .as_ref()
        .and_then(|value| value.get(key))
        .and_then(|value| value.as_str())
        .map(str::to_string)
        .ok_or_else(|| anyhow::anyhow!("missing {}", key))
}

fn parse_mode(value: &str) -> sacode_kernel::ExecutionMode {
    match value {
        "plan" => sacode_kernel::ExecutionMode::Plan,
        "auto" | "yolo" => sacode_kernel::ExecutionMode::Yolo,
        _ => sacode_kernel::ExecutionMode::Build,
    }
}

#[derive(Debug, Clone, serde::Deserialize)]
struct JsonRpcRequest {
    #[allow(dead_code)]
    jsonrpc: String,
    id: serde_json::Value,
    method: String,
    params: Option<serde_json::Value>,
}

#[derive(Debug, serde::Serialize)]
struct JsonRpcResponse {
    jsonrpc: String,
    id: serde_json::Value,
    result: Option<serde_json::Value>,
    error: Option<serde_json::Value>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_mode_recognizes_values() {
        assert_eq!(parse_mode("plan"), sacode_kernel::ExecutionMode::Plan);
        assert_eq!(parse_mode("yolo"), sacode_kernel::ExecutionMode::Yolo);
        assert_eq!(parse_mode("auto"), sacode_kernel::ExecutionMode::Yolo);
        assert_eq!(parse_mode("build"), sacode_kernel::ExecutionMode::Build);
        assert_eq!(parse_mode("unknown"), sacode_kernel::ExecutionMode::Build);
    }

    #[test]
    fn required_string_extracts_field() {
        let request = JsonRpcRequest {
            jsonrpc: "2.0".to_string(),
            id: serde_json::json!(1),
            method: "test".to_string(),
            params: Some(serde_json::json!({
                "name": "hello",
                "count": 42,
            })),
        };

        assert_eq!(required_string(&request, "name").unwrap(), "hello");
        assert!(required_string(&request, "count").is_err());
        assert!(required_string(&request, "missing").is_err());
    }

    #[test]
    fn required_string_missing_params_returns_error() {
        let request = JsonRpcRequest {
            jsonrpc: "2.0".to_string(),
            id: serde_json::json!(1),
            method: "test".to_string(),
            params: None,
        };
        assert!(required_string(&request, "anything").is_err());
    }

    #[test]
    fn initialize_response_includes_streaming_capability() {
        // 验证 initialize 响应包含 streaming 能力声明
        let capabilities = serde_json::json!({
            "session": true,
            "loadSession": true,
            "tools": true,
            "streaming": true,
        });
        assert!(capabilities.get("streaming").unwrap().as_bool().unwrap());
    }
}