use anyhow::Result;
use sacode_kernel::{ApprovalPolicy, Event, ExecutionMode};
use sacode_runtime::{SessionPrompt, SessionService};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use tokio::{
    io::{AsyncBufReadExt, AsyncWriteExt, BufReader, Lines},
    net::TcpListener,
};

use crate::config::AcpConfig;
use crate::protocol::*;

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
            tracing::warn!(%addr, "ACP connection rejected: max connections reached");
            continue;
        }
        active_connections.fetch_add(1, Ordering::Relaxed);
        let service = service.clone();
        let conn_counter = active_connections.clone();
        tokio::spawn(async move {
            if let Err(error) = serve_connection_tcp(stream, service).await {
                tracing::warn!(%addr, %error, "ACP connection failed");
            }
            conn_counter.fetch_sub(1, Ordering::Relaxed);
        });
    }
}

/// 启动 ACP server（stdio 子进程模式）—— 编辑器以 `sacode acp` 接入。
///
/// 从 stdin 逐行读取 JSON-RPC 请求，向 stdout 写入 JSON-RPC 响应与
/// `session/update` 流式通知（均与 CodeBuddy / OpenCode 一致：newline-delimited
/// JSON-RPC，无 SSE 前缀）。
pub async fn run_stdio_server() -> Result<()> {
    let service = SessionService::new();
    let stdin = tokio::io::stdin();
    let reader = BufReader::new(stdin);
    let writer = std::sync::Arc::new(tokio::sync::Mutex::new(tokio::io::BufWriter::new(
        tokio::io::stdout(),
    )));
    serve_lines(reader.lines(), writer, service).await
}

// ============================================================================
// 通用连接处理（TCP / stdio 共用）
// ============================================================================

async fn serve_connection_tcp(
    stream: tokio::net::TcpStream,
    service: SessionService,
) -> Result<()> {
    let (reader, writer) = stream.into_split();
    let writer = std::sync::Arc::new(tokio::sync::Mutex::new(tokio::io::BufWriter::new(writer)));
    serve_lines(BufReader::new(reader).lines(), writer, service).await
}

/// 逐行读取 JSON-RPC 请求并分发；流式通知与响应写入同一 writer。
async fn serve_lines<R, W>(
    mut lines: Lines<BufReader<R>>,
    writer: std::sync::Arc<tokio::sync::Mutex<W>>,
    service: SessionService,
) -> Result<()>
where
    R: tokio::io::AsyncRead + Unpin,
    W: tokio::io::AsyncWrite + Unpin + Send + 'static,
{
    while let Some(line) = lines.next_line().await? {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }

        let request: JsonRpcRequest = match serde_json::from_str(line) {
            Ok(req) => req,
            Err(e) => {
                write_json(
                    &writer,
                    &JsonRpcResponse {
                        jsonrpc: "2.0".to_string(),
                        id: JsonRpcId::Number(0),
                        result: None,
                        error: Some(JsonRpcError::invalid_params(format!(
                            "parse error: {}",
                            e
                        ))),
                    },
                )
                .await?;
                continue;
            }
        };

        if let Err(error) = handle_one(&service, &request, &writer).await {
            tracing::warn!(%error, method = %request.method, "ACP request failed");
            write_json(
                &writer,
                &JsonRpcResponse {
                    jsonrpc: "2.0".to_string(),
                    id: request.id.clone(),
                    result: None,
                    error: Some(JsonRpcError::internal(error.to_string())),
                },
            )
            .await?;
        }
    }
    Ok(())
}

/// 处理单条请求：响应与流式通知都写回 writer。
/// 顺序为「先响应（含首帧 PromptResponse），后流式 session/update」，保证客户端按序重组。
async fn handle_one<W>(
    service: &SessionService,
    request: &JsonRpcRequest,
    writer: &std::sync::Arc<tokio::sync::Mutex<W>>,
) -> Result<()>
where
    W: tokio::io::AsyncWrite + Unpin + Send + 'static,
{
        if request.method == "session/prompt" {
            let (response, streamed) = handle_session_prompt(service, request).await?;
            write_json(
                writer,
                &JsonRpcResponse {
                    jsonrpc: "2.0".to_string(),
                    id: request.id.clone(),
                    result: Some(serde_json::to_value(&response)?),
                    error: None,
                },
            )
            .await?;
            for update in &streamed {
                write_json(
                    writer,
                    &session_update_notification(&response.session_id, update),
                )
                .await?;
            }
            return Ok(());
        }

    let value = dispatch_request(service, request).await?;
    write_json(
        writer,
        &JsonRpcResponse {
            jsonrpc: "2.0".to_string(),
            id: request.id.clone(),
            result: Some(value),
            error: None,
        },
    )
    .await?;
    Ok(())
}

// ============================================================================
// 请求分发（非流式方法）
// ============================================================================

async fn dispatch_request(service: &SessionService, request: &JsonRpcRequest) -> Result<serde_json::Value> {
    match request.method.as_str() {
        "initialize" => Ok(serde_json::to_value(InitializeResult {
            protocol_version: PROTOCOL_VERSION,
            agent_capabilities: AgentCapabilities {
                load_session: true,
                prompt_capabilities: PromptCapabilities {
                    image: false,
                    audio: false,
                    embedded_context: false,
                },
                mcp_capabilities: McpCapabilities {
                    http: false,
                    sse: false,
                },
                session_capabilities: None,
                auth: None,
            },
            agent_info: Some(AgentInfo {
                name: "SaCode".to_string(),
                version: env!("CARGO_PKG_VERSION").to_string(),
            }),
            auth_methods: Vec::new(),
            _meta: None,
        })?),
        "authenticate" => Ok(serde_json::json!({
            "authenticated": true,
            "_meta": { "sacode.auth": "passthrough" }
        })),
        "getConfigOptions" => Ok(serde_json::to_value(build_config_options())?),
        "setSessionConfigOption" => Ok(serde_json::to_value(build_config_options())?),
        "session/new" => {
            let cwd = request
                .params
                .as_ref()
                .and_then(|v| v.get("cwd"))
                .and_then(|v| v.as_str())
                .map(std::path::PathBuf::from)
                .unwrap_or_else(|| std::env::current_dir().unwrap_or_else(|_| ".".into()));
            let handle = service.create_session(cwd)?;
            Ok(serde_json::to_value(NewSessionResponse {
                session_id: handle.id.clone(),
                session: session_to_acp(&handle),
                checkpoint: handle.last_checkpoint.clone(),
            })?)
        }
        "session/load" => {
            let cwd = request
                .params
                .as_ref()
                .and_then(|v| v.get("cwd"))
                .and_then(|v| v.as_str())
                .map(std::path::PathBuf::from)
                .unwrap_or_else(|| std::env::current_dir().unwrap_or_else(|_| ".".into()));
            let checkpoint = request
                .required_string("checkpoint")?;
            let handle = service.load_session(&cwd, &checkpoint)?;
            Ok(serde_json::to_value(LoadSessionResponse {
                session: session_to_acp(&handle),
                checkpoint: handle.last_checkpoint.clone(),
            })?)
        }
        "session/list" => {
            let sessions = service
                .list_sessions()
                .into_iter()
                .map(|handle| session_to_acp(&handle))
                .collect();
            Ok(serde_json::to_value(ListSessionsResponse { sessions })?)
        }
        "session/get" => {
            let session_id = request.required_string("sessionId")?;
            let handle = service.get_session(&session_id)?;
            Ok(serde_json::to_value(session_to_acp(&handle))?)
        }
        "session/cancel" => {
            let session_id = request.required_string("sessionId")?;
            service.cancel_session(&session_id)?;
            Ok(serde_json::json!({ "cancelled": true }))
        }
        "session/close" => {
            let session_id = request.required_string("sessionId")?;
            service.close_session(&session_id)?;
            Ok(serde_json::json!({ "closed": true }))
        }
        "tools/list" => {
            let registry = sacode_runtime::ToolRegistry::builtin();
            let tools: Vec<Tool> = registry
                .specs()
                .iter()
                .map(|spec| Tool {
                    name: spec.name.clone(),
                    description: if spec.description.is_empty() {
                        None
                    } else {
                        Some(spec.description.clone())
                    },
                    input_schema: Some(spec.input_schema.clone()),
                })
                .collect();
            Ok(serde_json::to_value(ToolsListResponse { tools })?)
        }
        "tools/call" => {
            let tool_name = request.required_string("name")?;
            let arguments = request
                .params
                .as_ref()
                .and_then(|v| v.get("arguments"))
                .cloned()
                .unwrap_or_else(|| serde_json::json!({}));
            let registry = sacode_runtime::ToolRegistry::builtin();
            if registry.get(&tool_name).is_none() {
                anyhow::bail!("unknown tool: {}", tool_name);
            }
            match registry.execute(&tool_name, arguments) {
                Ok(output) => Ok(serde_json::json!({
                    "success": output.success,
                    "data": output.data,
                    "message": output.message,
                })),
                Err(error) => Ok(serde_json::json!({
                    "success": false,
                    "error": error.to_string(),
                })),
            }
        }
        other => Err(anyhow::anyhow!("{}", JsonRpcError::method_not_found(other).message)),
    }
}

// ============================================================================
// session/prompt（含流式 SessionUpdate 映射）
// ============================================================================

async fn handle_session_prompt(
    service: &SessionService,
    request: &JsonRpcRequest,
) -> Result<(PromptResponse, Vec<SessionUpdate>)> {
    let session_id = request.required_string("sessionId")?;
    let content = request.required_string("prompt")?;
    let (mode, approval) = resolve_mode(request.string("mode").as_deref());
    let events = service
        .prompt(
            &session_id,
            SessionPrompt {
                content,
                mode,
                approval,
            },
        )
        .await?;

    // 将 SessionEvent 序列映射为 ACP SessionUpdate（保持顺序）。
    let mut updates: Vec<SessionUpdate> = Vec::new();
    let mut had_error = false;
    for event in &events {
        let produced = event_to_updates(event, &session_id, &mut had_error);
        updates.extend(produced);
    }

    let prompt_response = updates.first().cloned();
    let streamed = if updates.len() > 1 {
        updates[1..].to_vec()
    } else {
        Vec::new()
    };

    // 透传客户端 _meta（如 conversationRequestId）。
    let meta = request.meta().cloned();

    Ok((
        PromptResponse {
            session_id,
            prompt_response,
            _meta: meta,
        },
        streamed,
    ))
}

/// 单个 SessionEvent 可映射为 0..n 个 SessionUpdate（错误事件额外追加 session_end）。
fn event_to_updates(
    event: &sacode_runtime::SessionEvent,
    session_id: &str,
    had_error: &mut bool,
) -> Vec<SessionUpdate> {
    let mut out = Vec::new();
    match event {
        sacode_runtime::SessionEvent::Started { .. } => {
            out.push(SessionUpdate::SessionInfo(SessionInfoUpdate {
                session_id: Some(session_id.to_string()),
                ..Default::default()
            }));
        }
        sacode_runtime::SessionEvent::KernelEvent(inner) => match inner {
            Event::Message { content } => out.push(SessionUpdate::AgentMessageChunk(AgentMessageChunk {
                content: ContentBlock::text(content.clone()),
            })),
            Event::Thinking { content } => out.push(SessionUpdate::AgentMessageChunk(AgentMessageChunk {
                content: ContentBlock::text(content.clone()),
            })),
            Event::PlanGenerated { steps } => {
                out.push(SessionUpdate::AgentMessageChunk(AgentMessageChunk {
                    content: ContentBlock::text(steps.join("\n")),
                }))
            }
            Event::CommandOutput { command, output } => {
                out.push(SessionUpdate::AgentMessageChunk(AgentMessageChunk {
                    content: ContentBlock::text(format!("${}\n{}", command, output)),
                }))
            }
            Event::ToolCallStarted { name, input } => out.push(SessionUpdate::ToolCall(ToolCall {
                tool_call_id: format!("tc-{}", name),
                name: name.clone(),
                status: Some("in_progress".to_string()),
                title: None,
                content: None,
                raw_input: Some(input.clone()),
            })),
            Event::ToolCallFinished { name, output, success } => {
                out.push(SessionUpdate::ToolCallUpdate(ToolCallUpdate {
                    tool_call_id: format!("tc-{}", name),
                    status: Some(if *success { "completed" } else { "failed" }.to_string()),
                    title: None,
                    content: Some(vec![ContentBlock::text(output.to_string())]),
                }))
            }
            Event::Error { message } => {
                *had_error = true;
                out.push(SessionUpdate::AgentMessageChunk(AgentMessageChunk {
                    content: ContentBlock::text(message.clone()),
                }));
            }
            Event::Done { .. } | Event::ApprovalRequested { .. } | Event::ApprovalResolved { .. }
            | Event::FileChanged { .. } => {}
        },
        sacode_runtime::SessionEvent::ToolCallStarted { step_id, name, input } => {
            out.push(SessionUpdate::ToolCall(ToolCall {
                tool_call_id: format!("tc-{}-{}", step_id, name),
                name: name.clone(),
                status: Some("in_progress".to_string()),
                title: None,
                content: None,
                raw_input: Some(input.clone()),
            }))
        }
        sacode_runtime::SessionEvent::ToolCallFinished { step_id, name, output, success } => {
            out.push(SessionUpdate::ToolCallUpdate(ToolCallUpdate {
                tool_call_id: format!("tc-{}-{}", step_id, name),
                status: Some(if *success { "completed" } else { "failed" }.to_string()),
                title: None,
                content: Some(vec![ContentBlock::text(output.to_string())]),
            }))
        }
        sacode_runtime::SessionEvent::Done { .. } => out.push(SessionUpdate::SessionEnd(SessionEnd {
            end_reason: Some(if *had_error { "error" } else { "completed" }.to_string()),
        })),
        sacode_runtime::SessionEvent::Error { message } => {
            *had_error = true;
            out.push(SessionUpdate::AgentMessageChunk(AgentMessageChunk {
                content: ContentBlock::text(message.clone()),
            }));
            out.push(SessionUpdate::SessionEnd(SessionEnd {
                end_reason: Some("error".to_string()),
            }));
        }
    }
    out
}

/// 解析执行模式 + 审批策略。ACP 无交互用户，`yolo`/`auto` 显式请求时自动放行工具。
fn resolve_mode(mode: Option<&str>) -> (ExecutionMode, ApprovalPolicy) {
    match mode {
        Some("plan") => (ExecutionMode::Plan, ApprovalPolicy::AutoDeny),
        Some("auto") | Some("yolo") => (ExecutionMode::Yolo, ApprovalPolicy::AutoApprove),
        _ => (ExecutionMode::Build, ApprovalPolicy::AutoDeny),
    }
}

/// 真实生效的会话配置项（ACP `getConfigOptions` / `setSessionConfigOption`）。
/// 当前唯一真正影响 `session/prompt` 行为的是执行模式 `mode`
/// （经 `resolve_mode` 映射为 (ExecutionMode, ApprovalPolicy)）。
fn build_config_options() -> ConfigOptionsResponse {
    ConfigOptionsResponse {
        config_options: vec![ConfigOption {
            id: "mode".to_string(),
            name: "执行模式".to_string(),
            option_type: "string".to_string(),
            description: "build=自动构建并执行（工具调用需人工确认）；plan=仅规划不执行；auto/yolo=自动执行并自动批准工具调用".to_string(),
            category: Some("execution".to_string()),
            current_value: Some(serde_json::json!("build")),
        }],
    }
}

// ============================================================================
// 辅助
// ============================================================================

fn session_to_acp(handle: &sacode_runtime::SessionHandle) -> Session {
    Session {
        session_id: handle.id.clone(),
        cwd: handle.cwd.to_string_lossy().to_string(),
        status: Some(session_status_to_string(&handle.status)),
        tools: Some(handle.tools.clone()),
        checkpoint: handle.last_checkpoint.clone(),
    }
}

fn session_status_to_string(status: &sacode_runtime::SessionStatus) -> String {
    match status {
        sacode_runtime::SessionStatus::Idle => "idle",
        sacode_runtime::SessionStatus::Running => "running",
        sacode_runtime::SessionStatus::Cancelling => "cancelling",
        sacode_runtime::SessionStatus::Cancelled => "cancelled",
        sacode_runtime::SessionStatus::Closed => "closed",
        sacode_runtime::SessionStatus::Failed(_) => "failed",
    }
    .to_string()
}

async fn write_json<W>(
    writer: &std::sync::Arc<tokio::sync::Mutex<W>>,
    value: &impl serde::Serialize,
) -> Result<()>
where
    W: tokio::io::AsyncWrite + Unpin + Send + 'static,
{
    let mut guard = writer.lock().await;
    let line = serde_json::to_string(value)?;
    guard.write_all(line.as_bytes()).await?;
    guard.write_all(b"\n").await?;
    guard.flush().await?;
    Ok(())
}

// ============================================================================
// 测试
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolve_mode_recognizes_values() {
        assert_eq!(
            resolve_mode(Some("plan")),
            (ExecutionMode::Plan, ApprovalPolicy::AutoDeny)
        );
        assert_eq!(
            resolve_mode(Some("yolo")),
            (ExecutionMode::Yolo, ApprovalPolicy::AutoApprove)
        );
        assert_eq!(
            resolve_mode(Some("auto")),
            (ExecutionMode::Yolo, ApprovalPolicy::AutoApprove)
        );
        assert_eq!(
            resolve_mode(Some("build")),
            (ExecutionMode::Build, ApprovalPolicy::AutoDeny)
        );
        assert_eq!(
            resolve_mode(None),
            (ExecutionMode::Build, ApprovalPolicy::AutoDeny)
        );
    }

    #[test]
    fn initialize_response_is_well_formed() {
        let result = InitializeResult {
            protocol_version: PROTOCOL_VERSION,
            agent_capabilities: AgentCapabilities {
                load_session: true,
                ..Default::default()
            },
            agent_info: Some(AgentInfo {
                name: "SaCode".to_string(),
                version: "1.1.1".to_string(),
            }),
            auth_methods: Vec::new(),
            _meta: None,
        };
        let json = serde_json::to_value(&result).unwrap();
        assert_eq!(json["protocolVersion"], 1);
        assert_eq!(json["agentCapabilities"]["loadSession"], true);
        assert_eq!(json["agentCapabilities"]["promptCapabilities"]["image"], false);
    }

    #[test]
    fn session_update_serializes_with_snake_type_and_camel_fields() {
        let update = SessionUpdate::AgentMessageChunk(AgentMessageChunk {
            content: ContentBlock::text("hello"),
        });
        let json = serde_json::to_value(&update).unwrap();
        assert_eq!(json["type"], "agent_message_chunk");
        assert_eq!(json["content"]["type"], "text");
        assert_eq!(json["content"]["text"], "hello");
    }

    #[test]
    fn tool_call_update_serializes_camel_fields() {
        let update = SessionUpdate::ToolCallUpdate(ToolCallUpdate {
            tool_call_id: "tc-bash".to_string(),
            status: Some("completed".to_string()),
            title: None,
            content: Some(vec![ContentBlock::text("out")]),
        });
        let json = serde_json::to_value(&update).unwrap();
        assert_eq!(json["type"], "tool_call_update");
        assert_eq!(json["toolCallId"], "tc-bash");
        assert_eq!(json["status"], "completed");
    }

    #[test]
    fn event_message_maps_to_agent_message_chunk() {
        let mut had_error = false;
        let event = sacode_runtime::SessionEvent::KernelEvent(Event::message("hi"));
        let updates = event_to_updates(&event, "s1", &mut had_error);
        assert_eq!(updates.len(), 1);
        match &updates[0] {
            SessionUpdate::AgentMessageChunk(c) => {
                assert_eq!(c.content, ContentBlock::text("hi"));
            }
            _ => panic!("expected agent_message_chunk"),
        }
    }

    #[test]
    fn done_without_error_maps_to_completed() {
        let mut had_error = false;
        let event = sacode_runtime::SessionEvent::Done {
            summary: "ok".to_string(),
        };
        let updates = event_to_updates(&event, "s1", &mut had_error);
        assert_eq!(updates.len(), 1);
        match &updates[0] {
            SessionUpdate::SessionEnd(e) => assert_eq!(e.end_reason.as_deref(), Some("completed")),
            _ => panic!("expected session_end"),
        }
    }

    #[test]
    fn error_event_appends_session_end_with_error_reason() {
        let mut had_error = false;
        let event = sacode_runtime::SessionEvent::Error {
            message: "boom".to_string(),
        };
        let updates = event_to_updates(&event, "s1", &mut had_error);
        assert!(had_error);
        assert_eq!(updates.len(), 2);
        assert!(matches!(updates[1], SessionUpdate::SessionEnd(_)));
    }

    #[test]
    fn config_options_include_real_mode_option() {
        let options = build_config_options();
        assert_eq!(options.config_options.len(), 1);
        let mode = &options.config_options[0];
        assert_eq!(mode.id, "mode");
        assert_eq!(mode.option_type, "string");
        assert_eq!(mode.category.as_deref(), Some("execution"));
        assert_eq!(mode.current_value, Some(serde_json::json!("build")));
        // 序列化后字段名符合 ACP camelCase：configOptions / type / currentValue
        let json = serde_json::to_value(&options).unwrap();
        assert_eq!(json["configOptions"][0]["id"], "mode");
        assert_eq!(json["configOptions"][0]["type"], "string");
        assert_eq!(json["configOptions"][0]["currentValue"], "build");
    }
}
