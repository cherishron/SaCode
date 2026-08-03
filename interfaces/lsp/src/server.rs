use anyhow::Result;
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use sacode_kernel::{ApprovalPolicy, ExecutionMode};
use sacode_runtime::{ProviderClient, SessionPrompt, SessionService};
use tower_lsp::{
    jsonrpc::Result as LspResult,
    lsp_types::{
        CodeAction, CodeActionKind, CodeActionOrCommand, CodeActionProviderCapability,
        CodeActionResponse, Command, CompletionItem, CompletionItemKind, CompletionOptions,
        CompletionParams, CompletionResponse, DidChangeTextDocumentParams,
        DidCloseTextDocumentParams, DidOpenTextDocumentParams, Hover, HoverContents, HoverParams,
        HoverProviderCapability, InitializeParams, InitializeResult, InitializedParams,
        InsertTextFormat, MessageType, Position, Range, ServerCapabilities,
        TextDocumentSyncCapability, TextDocumentSyncKind, TextEdit, Url,
    },
    Client, LanguageServer, LspService, Server,
};

use crate::code_intelligence::{completion_response_from_ast, hover_from_ast};
use crate::config::LspConfig;
use crate::diagnostics::DiagnosticsProvider;
use crate::document::{DocumentManager, TextDocument};

struct SaCodeLanguageServer {
    client: Client,
    documents: Arc<Mutex<DocumentManager>>,
    sessions: SessionService,
    provider_config: Arc<Mutex<Option<sacode_kernel::model::ModelProvider>>>,
    /// 诊断提供者：按语言调度外部检查器
    diagnostics_provider: Arc<DiagnosticsProvider>,
    /// 是否启用诊断发布（来自 LspConfig.capabilities.diagnostics）
    diagnostics_enabled: bool,
    /// 诊断去抖间隔毫秒（来自 LspConfig.behavior.diagnostic_interval_ms）
    diagnostic_interval_ms: u64,
    /// 按 URI 跟踪待处理的诊断任务，便于在文档变更时取消旧任务
    pending_diagnostics: Arc<tokio::sync::Mutex<HashMap<Url, tokio::task::JoinHandle<()>>>>,
}

#[tower_lsp::async_trait]
impl LanguageServer for SaCodeLanguageServer {
    async fn initialize(&self, _: InitializeParams) -> LspResult<InitializeResult> {
        Ok(InitializeResult {
            server_info: None,
            capabilities: ServerCapabilities {
                text_document_sync: Some(TextDocumentSyncCapability::Kind(
                    TextDocumentSyncKind::FULL,
                )),
                completion_provider: Some(CompletionOptions::default()),
                hover_provider: Some(HoverProviderCapability::Simple(true)),
                code_action_provider: Some(CodeActionProviderCapability::Simple(true)),
                ..Default::default()
            },
        })
    }

    async fn initialized(&self, _: InitializedParams) {
        let _ = self
            .client
            .log_message(MessageType::INFO, "SaCode LSP initialized")
            .await;
    }

    async fn shutdown(&self) -> LspResult<()> {
        Ok(())
    }

    async fn did_open(&self, params: DidOpenTextDocumentParams) {
        let uri = params.text_document.uri.clone();
        let version = params.text_document.version;
        let document = TextDocument {
            uri: params.text_document.uri,
            content: params.text_document.text,
            version: params.text_document.version,
            language_id: params.text_document.language_id,
        };
        self.documents
            .lock()
            .expect("document mutex poisoned")
            .open(document);
        // 文档打开后触发首次诊断
        self.spawn_diagnostics(uri, version).await;
    }

    async fn did_change(&self, params: DidChangeTextDocumentParams) {
        let uri = params.text_document.uri.clone();
        let version = params.text_document.version;
        if let Some(change) = params.content_changes.into_iter().last() {
            self.documents
                .lock()
                .expect("document mutex poisoned")
                .update(&uri, change.text, version);
        }
        // 文档变更后触发诊断（带去抖）
        self.spawn_diagnostics(uri, version).await;
    }

    async fn did_close(&self, params: DidCloseTextDocumentParams) {
        let uri = params.text_document.uri.clone();
        self.documents
            .lock()
            .expect("document mutex poisoned")
            .close(&uri);
        // 取消该 URI 的待处理诊断任务
        let prev = {
            let mut pending = self.pending_diagnostics.lock().await;
            pending.remove(&uri)
        };
        if let Some(handle) = prev {
            handle.abort();
        }
        // 文档关闭时清空已发布的诊断（LSP 约定）
        let _ = self.client.publish_diagnostics(uri, Vec::new(), None).await;
    }

    async fn completion(&self, params: CompletionParams) -> LspResult<Option<CompletionResponse>> {
        let provider_config = self
            .provider_config
            .lock()
            .expect("provider mutex poisoned")
            .clone();
        let uri = params.text_document_position.text_document.uri;
        let position = params.text_document_position.position;
        let context = params.context.clone();
        let document = self
            .documents
            .lock()
            .expect("document mutex poisoned")
            .get(&uri)
            .cloned();

        // 优先走 AST 静态补全：基于当前文档符号生成 CompletionItem
        // 失败或为空时降级到 AI 路径（保持向后兼容）
        if let Some(doc) = &document {
            if let Some(response) = completion_response_from_ast(doc, position) {
                return Ok(Some(response));
            }
        }

        let sessions = self.sessions.clone();
        let items =
            completion_items(document, &sessions, &provider_config, position, context).await;
        Ok(Some(CompletionResponse::Array(items)))
    }

    async fn hover(&self, params: HoverParams) -> LspResult<Option<Hover>> {
        let provider_config = self
            .provider_config
            .lock()
            .expect("provider mutex poisoned")
            .clone();
        let uri = &params.text_document_position_params.text_document.uri;
        let position = params.text_document_position_params.position;
        let Some(document) = self
            .documents
            .lock()
            .expect("document mutex poisoned")
            .get(uri)
            .cloned()
        else {
            return Ok(None);
        };

        // 优先走 AST 静态 hover：基于符号表查找光标附近的符号
        // 命中时返回静态信息，避免 AI 调用开销
        if let Some(hover) = hover_from_ast(&document, position) {
            return Ok(Some(hover));
        }

        let content = document.content.clone();
        let language_id = document.language_id.clone();
        let line_start = position.line.saturating_sub(2);
        let line_end = (position.line + 3).min(content.lines().count() as u32);

        let code_context = content
            .lines()
            .skip(line_start as usize)
            .take((line_end - line_start) as usize)
            .collect::<Vec<_>>()
            .join("\n");

        let hover_content = if let Some(provider) = provider_config {
            generate_ai_hover(&provider, &code_context, position, &language_id).await
        } else {
            format!(
                "**Language:** {}\n\n**Line {}**\n```{}\n{}\n```",
                language_id,
                position.line + 1,
                language_id,
                code_context
                    .lines()
                    .nth(position.line as usize)
                    .unwrap_or_default()
                    .trim()
            )
        };

        Ok(Some(Hover {
            contents: HoverContents::Markup(tower_lsp::lsp_types::MarkupContent {
                kind: tower_lsp::lsp_types::MarkupKind::Markdown,
                value: hover_content,
            }),
            range: Some(Range {
                start: Position {
                    line: position.line,
                    character: 0,
                },
                end: Position {
                    line: position.line,
                    character: code_context
                        .lines()
                        .nth(position.line as usize)
                        .map(|l| l.len())
                        .unwrap_or(0) as u32,
                },
            }),
        }))
    }

    async fn code_action(
        &self,
        params: tower_lsp::lsp_types::CodeActionParams,
    ) -> LspResult<Option<CodeActionResponse>> {
        let provider_config = self
            .provider_config
            .lock()
            .expect("provider mutex poisoned")
            .clone();
        let uri = &params.text_document.uri;
        let Some(document) = self
            .documents
            .lock()
            .expect("document mutex poisoned")
            .get(uri)
            .cloned()
        else {
            return Ok(Some(Vec::new()));
        };

        let range = params.range;
        let diagnostics = params.context.diagnostics.clone();
        let has_errors = diagnostics
            .iter()
            .any(|d| d.severity == Some(tower_lsp::lsp_types::DiagnosticSeverity::ERROR));

        let mut actions = Vec::new();

        // 基于诊断的 quickfix：每个 error / warning 提供一个独立的 Fix 动作
        // 这比单一 "Fix errors" 更细粒度，便于用户针对具体错误选择
        for diagnostic in &diagnostics {
            let severity_label = match diagnostic.severity {
                Some(tower_lsp::lsp_types::DiagnosticSeverity::ERROR) => "Error",
                Some(tower_lsp::lsp_types::DiagnosticSeverity::WARNING) => "Warning",
                Some(tower_lsp::lsp_types::DiagnosticSeverity::INFORMATION) => "Info",
                _ => "Diagnostic",
            };
            let source_label = diagnostic.source.as_deref().unwrap_or("unknown");
            let message = &diagnostic.message;
            actions.push(CodeActionOrCommand::CodeAction(CodeAction {
                title: format!(
                    "SaCode: Fix {} ({}): {}",
                    severity_label, source_label, message
                ),
                kind: Some(CodeActionKind::QUICKFIX),
                diagnostics: Some(vec![diagnostic.clone()]),
                edit: None,
                ..CodeAction::default()
            }));
        }

        let code_snippet = document
            .content
            .lines()
            .skip(range.start.line as usize)
            .take((range.end.line - range.start.line + 1).max(1) as usize)
            .collect::<Vec<_>>()
            .join("\n");

        // 当光标未选中具体范围时，仅在有诊断或代码片段非空时给出通用动作
        let is_caret = range.start.line == range.end.line
            && range.start.character == range.end.character;
        if !is_caret || has_errors || !code_snippet.trim().is_empty() {
            actions.push(CodeActionOrCommand::CodeAction(CodeAction {
                title: "SaCode: Explain this code".to_string(),
                kind: Some(CodeActionKind::QUICKFIX),
                command: Some(Command {
                    title: "Explain with AI".to_string(),
                    command: "sacode.explain".to_string(),
                    arguments: Some(vec![
                        serde_json::json!(code_snippet),
                        serde_json::json!(document.language_id),
                    ]),
                }),
                ..CodeAction::default()
            }));

            // 仅当有 AI provider 时提供修复建议
            if let Some(provider) = provider_config {
                actions.push(CodeActionOrCommand::CodeAction(CodeAction {
                    title: "SaCode: Fix errors".to_string(),
                    kind: Some(CodeActionKind::QUICKFIX),
                    diagnostics: Some(diagnostics.clone()),
                    edit: Some(generate_fix_edits(&provider, &code_snippet, &document, range).await),
                    ..CodeAction::default()
                }));
            }

            actions.push(CodeActionOrCommand::CodeAction(CodeAction {
                title: "SaCode: Refactor".to_string(),
                kind: Some(CodeActionKind::REFACTOR),
                command: Some(Command {
                    title: "Refactor with AI".to_string(),
                    command: "sacode.refactor".to_string(),
                    arguments: Some(vec![
                        serde_json::json!(code_snippet),
                        serde_json::json!(document.language_id),
                    ]),
                }),
                ..CodeAction::default()
            }));
        }

        Ok(Some(actions))
    }
}

impl SaCodeLanguageServer {
    /// 触发文档诊断（带去抖）
    ///
    /// 实现策略：
    /// 1. 取消该 URI 的旧任务（避免快速连续编辑时堆积）
    /// 2. spawn 新任务：先 sleep `diagnostic_interval_ms`，再运行检查器
    /// 3. 检查完成后通过 `client.publish_diagnostics` 推送给客户端
    ///
    /// 注：spawn 前已克隆文档内容，spawn 内不持有 documents mutex。
    /// 子进程（cargo/tsc/python）若仍在运行，abort 仅取消 future 不杀进程，
    /// 其输出会被丢弃，资源浪费可接受。
    async fn spawn_diagnostics(&self, uri: Url, version: i32) {
        if !self.diagnostics_enabled {
            return;
        }
        // 取消该 URI 的待处理任务
        let prev = {
            let mut pending = self.pending_diagnostics.lock().await;
            pending.remove(&uri)
        };
        if let Some(handle) = prev {
            handle.abort();
        }
        // 在 spawn 前克隆文档，避免在 spawn 内长时间持有 documents mutex
        let doc = {
            let docs = self.documents.lock().expect("document mutex poisoned");
            docs.get(&uri).cloned()
        };
        let Some(doc) = doc else {
            return;
        };
        let client = self.client.clone();
        let provider = self.diagnostics_provider.clone();
        let interval = self.diagnostic_interval_ms;
        let uri_for_publish = uri.clone();
        let handle = tokio::spawn(async move {
            if interval > 0 {
                tokio::time::sleep(Duration::from_millis(interval)).await;
            }
            let diagnostics = provider.analyze(&doc);
            let _ = client
                .publish_diagnostics(uri_for_publish, diagnostics, Some(version))
                .await;
        });
        let mut pending = self.pending_diagnostics.lock().await;
        pending.insert(uri, handle);
    }
}

pub async fn run_stdio_server(config: &LspConfig) -> Result<()> {
    let stdin = tokio::io::stdin();
    let stdout = tokio::io::stdout();
    let workdir = std::env::current_dir()?;
    let provider = resolve_provider_for_lsp(&workdir);
    let diagnostics_enabled = config.capabilities.diagnostics;
    let diagnostic_interval_ms = config.behavior.diagnostic_interval_ms;
    let (service, socket) = LspService::new(move |client| SaCodeLanguageServer {
        client,
        documents: Arc::new(Mutex::new(DocumentManager::default())),
        sessions: SessionService::new(),
        provider_config: Arc::new(Mutex::new(provider)),
        diagnostics_provider: Arc::new(DiagnosticsProvider::new(workdir.clone())),
        diagnostics_enabled,
        diagnostic_interval_ms,
        pending_diagnostics: Arc::new(tokio::sync::Mutex::new(HashMap::new())),
    });
    Server::new(stdin, stdout, socket).serve(service).await;
    Ok(())
}

pub async fn run_tcp_server(config: &LspConfig) -> Result<()> {
    let listener =
        tokio::net::TcpListener::bind((config.server.host.as_str(), config.server.port)).await?;
    tracing::info!(host = %config.server.host, port = config.server.port, "LSP TCP server listening");
    loop {
        let (_stream, _addr) = listener.accept().await?;
        tracing::debug!("accepted LSP TCP connection");
    }
}

fn resolve_provider_for_lsp(
    workdir: &std::path::Path,
) -> Option<sacode_kernel::model::ModelProvider> {
    // 复用 runtime 的 provider 候选加载（来源：.sacode/provider.json），
    // 取首个候选。早期实现误读 .sacode/config.json，此处统一走 canonical 路径。
    sacode_runtime::resolve_config_model_candidates(workdir)
        .into_iter()
        .next()
        .map(|(_, _, provider)| provider)
}

async fn generate_ai_hover(
    provider: &sacode_kernel::model::ModelProvider,
    code_context: &str,
    position: Position,
    language_id: &str,
) -> String {
    let client = ProviderClient::new();
    let prompt = format!(
        "分析以下 {} 代码片段（光标在行 {}），给出简洁的解释（不超过 100 字）：\n\n```{}\n{}\n```",
        language_id,
        position.line + 1,
        language_id,
        code_context
    );

    match client.simple_chat(provider, &prompt).await {
        Ok(explanation) => format!(
            "**SaCode AI Analysis**\n\n{}\n\n---\n\n**Language:** {}\n**Position:** Line {}",
            explanation.trim(),
            language_id,
            position.line + 1
        ),
        Err(_) => format!(
            "**Language:** {}\n\n**Line {}**\n```{}\n{}\n```",
            language_id,
            position.line + 1,
            language_id,
            code_context
                .lines()
                .nth(position.line as usize)
                .unwrap_or_default()
                .trim()
        ),
    }
}

async fn generate_fix_edits(
    provider: &sacode_kernel::model::ModelProvider,
    code_snippet: &str,
    document: &TextDocument,
    range: Range,
) -> tower_lsp::lsp_types::WorkspaceEdit {
    let client = ProviderClient::new();
    let prompt = format!(
        "修复以下 {} 代码中的错误，只输出修复后的代码，不要解释：\n\n```{}\n{}\n```",
        document.language_id, document.language_id, code_snippet
    );

    let fixed_code = client.simple_chat(provider, &prompt).await.ok().map(|s| {
        let trimmed = s.trim();
        if trimmed.starts_with("```") {
            trimmed
                .lines()
                .skip(1)
                .take_while(|l| !l.starts_with("```"))
                .collect::<Vec<_>>()
                .join("\n")
        } else {
            trimmed.to_string()
        }
    });

    tower_lsp::lsp_types::WorkspaceEdit {
        changes: Some(std::collections::HashMap::from([(
            document.uri.clone(),
            vec![TextEdit {
                range,
                new_text: fixed_code.unwrap_or_else(|| code_snippet.to_string()),
            }],
        )])),
        document_changes: None,
        change_annotations: None,
    }
}

async fn completion_items(
    document: Option<TextDocument>,
    sessions: &SessionService,
    provider_config: &Option<sacode_kernel::model::ModelProvider>,
    position: Position,
    context: Option<tower_lsp::lsp_types::CompletionContext>,
) -> Vec<CompletionItem> {
    let Some(document) = document else {
        return vec![CompletionItem {
            label: "sacode.todo".to_string(),
            kind: Some(CompletionItemKind::TEXT),
            detail: Some("Open a file to enable completions".to_string()),
            ..CompletionItem::default()
        }];
    };

    let line = document
        .content
        .lines()
        .nth(position.line as usize)
        .unwrap_or_default();
    let prefix = line
        .chars()
        .take(position.character as usize)
        .collect::<String>();

    let trigger_kind = context
        .map(|c| c.trigger_kind)
        .unwrap_or(tower_lsp::lsp_types::CompletionTriggerKind::INVOKED);

    if let Some(provider) = provider_config {
        if trigger_kind == tower_lsp::lsp_types::CompletionTriggerKind::TRIGGER_CHARACTER {
            return generate_ai_completions(provider, &prefix, &document.language_id).await;
        }
    }

    let session = sessions
        .create_session(std::env::current_dir().unwrap_or_else(|_| ".".into()))
        .ok();

    let ai_hint = if let Some(handle) = session {
        sessions
            .prompt(
                &handle.id,
                SessionPrompt {
                    content: format!("为以下代码前缀生成 3 个简短补全建议：{}", prefix.trim()),
                    mode: ExecutionMode::Build,
                    approval: ApprovalPolicy::AutoDeny,
                },
            )
            .await
            .ok()
            .and_then(|events| {
                events.into_iter().find_map(|event| match event {
                    sacode_runtime::SessionEvent::Done { summary } => Some(summary),
                    _ => None,
                })
            })
            .unwrap_or_else(|| "AI assistance available".to_string())
    } else {
        "AI assistance available".to_string()
    };

    vec![
        CompletionItem {
            label: "sacode.explain".to_string(),
            kind: Some(CompletionItemKind::TEXT),
            detail: Some("Explain current context".to_string()),
            documentation: Some(tower_lsp::lsp_types::Documentation::String(ai_hint.clone())),
            ..CompletionItem::default()
        },
        CompletionItem {
            label: "sacode.fix".to_string(),
            kind: Some(CompletionItemKind::TEXT),
            detail: Some("Generate a fix suggestion".to_string()),
            ..CompletionItem::default()
        },
        CompletionItem {
            label: "sacode.ai".to_string(),
            kind: Some(CompletionItemKind::TEXT),
            detail: Some("AI-powered completion".to_string()),
            documentation: Some(tower_lsp::lsp_types::Documentation::String(ai_hint)),
            insert_text: Some(prefix.trim().to_string()),
            insert_text_format: Some(InsertTextFormat::PLAIN_TEXT),
            ..CompletionItem::default()
        },
    ]
}

async fn generate_ai_completions(
    provider: &sacode_kernel::model::ModelProvider,
    prefix: &str,
    language_id: &str,
) -> Vec<CompletionItem> {
    let client = ProviderClient::new();
    let prompt = format!(
        "为以下 {} 代码前缀生成 3 个可能的后续补全，每个补全不超过一行：\n\n{}",
        language_id,
        prefix.trim()
    );

    let completions = match client.simple_chat(provider, &prompt).await {
        Ok(response) => response
            .lines()
            .take(3)
            .map(|line| line.trim().to_string())
            .collect::<Vec<_>>(),
        Err(_) => vec![
            "completion 1".to_string(),
            "completion 2".to_string(),
            "completion 3".to_string(),
        ],
    };

    completions
        .into_iter()
        .enumerate()
        .map(|(index, completion)| CompletionItem {
            label: completion.to_string(),
            kind: Some(CompletionItemKind::TEXT),
            detail: Some(format!("AI suggestion #{}", index + 1)),
            sort_text: Some(format!("{}", index)),
            ..CompletionItem::default()
        })
        .collect()
}
