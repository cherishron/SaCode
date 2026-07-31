use anyhow::Result;
use sacode_kernel::ApprovalPolicy;
use sacode_runtime::{SessionPrompt, SessionService};
use tokio::{
    io::{AsyncBufReadExt, AsyncWriteExt, BufReader},
    net::TcpListener,
};

use crate::config::AcpConfig;

pub async fn run_server(config: &AcpConfig) -> Result<()> {
    let listener = TcpListener::bind((config.server.host.as_str(), config.server.port)).await?;
    let service = SessionService::new();
    tracing::info!(
        host = %config.server.host,
        port = config.server.port,
        max_connections = config.server.max_connections,
        "ACP server listening"
    );

    loop {
        let (stream, addr) = listener.accept().await?;
        tracing::debug!(%addr, "accepted ACP connection");
        let service = service.clone();
        tokio::spawn(async move {
            if let Err(error) = serve_connection(stream, service).await {
                tracing::warn!(%addr, %error, "ACP connection failed");
            }
        });
    }
}

async fn serve_connection(stream: tokio::net::TcpStream, service: SessionService) -> Result<()> {
    let (reader, mut writer) = stream.into_split();
    let mut lines = BufReader::new(reader).lines();

    while let Some(line) = lines.next_line().await? {
        if line.trim().is_empty() {
            continue;
        }

        let request: JsonRpcRequest = serde_json::from_str(&line)?;
        let response = handle_request(&service, request).await?;
        writer
            .write_all(format!("{}\n", serde_json::to_string(&response)?).as_bytes())
            .await?;
    }

    Ok(())
}

async fn handle_request(service: &SessionService, request: JsonRpcRequest) -> Result<JsonRpcResponse> {
    let result = match request.method.as_str() {
        "initialize" => serde_json::json!({
            "capabilities": {
                "session": true,
                "loadSession": true,
                "tools": true
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
            let session_id = required_string(&request, "sessionId")?;
            let content = required_string(&request, "prompt")?;
            let mode = request
                .params
                .as_ref()
                .and_then(|value| value.get("mode"))
                .and_then(|value| value.as_str())
                .map(parse_mode)
                .unwrap_or(sacode_kernel::ExecutionMode::Build);
            let events = service.prompt(
                &session_id,
                SessionPrompt {
                    content,
                    mode,
                    approval: ApprovalPolicy::AutoDeny,
                },
            ).await?;
            serde_json::to_value(events)?
        }
        "session/cancel" => {
            let session_id = required_string(&request, "sessionId")?;
            service.cancel_session(&session_id)?;
            serde_json::json!({ "cancelled": true })
        }
        "session/close" => {
            let session_id = required_string(&request, "sessionId")?;
            service.close_session(&session_id)?;
            serde_json::json!({ "closed": true })
        }
        "session/get" => {
            let session_id = required_string(&request, "sessionId")?;
            serde_json::to_value(service.get_session(&session_id)?)?
        }
        "session/list" => serde_json::to_value(service.list_sessions())?,
        other => serde_json::json!({ "warning": format!("unsupported method: {}", other) }),
    };

    Ok(JsonRpcResponse {
        jsonrpc: "2.0".to_string(),
        id: request.id,
        result: Some(result),
        error: None,
    })
}

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
        "yolo" => sacode_kernel::ExecutionMode::Yolo,
        _ => sacode_kernel::ExecutionMode::Build,
    }
}

#[derive(Debug, serde::Deserialize)]
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
