use anyhow::Result;
use std::sync::{Arc, Mutex};

use sacode_kernel::{ApprovalPolicy, ExecutionMode};
use sacode_runtime::{SessionPrompt, SessionService};
use tower_lsp::{jsonrpc::Result as LspResult, lsp_types::{CodeActionProviderCapability, CodeActionResponse, CompletionItem, CompletionOptions, CompletionParams, CompletionResponse, DidChangeTextDocumentParams, DidCloseTextDocumentParams, DidOpenTextDocumentParams, Hover, HoverContents, HoverParams, HoverProviderCapability, InitializeParams, InitializeResult, InitializedParams, MarkedString, MessageType, Position, ServerCapabilities, TextDocumentSyncCapability, TextDocumentSyncKind}, Client, LanguageServer, LspService, Server};

use crate::config::LspConfig;
use crate::document::{DocumentManager, TextDocument};

struct SaCodeLanguageServer {
    client: Client,
    documents: Arc<Mutex<DocumentManager>>,
    sessions: SessionService,
}

#[tower_lsp::async_trait]
impl LanguageServer for SaCodeLanguageServer {
    async fn initialize(&self, _: InitializeParams) -> LspResult<InitializeResult> {
        Ok(InitializeResult {
            server_info: None,
            capabilities: ServerCapabilities {
                text_document_sync: Some(TextDocumentSyncCapability::Kind(TextDocumentSyncKind::FULL)),
                completion_provider: Some(CompletionOptions::default()),
                hover_provider: Some(HoverProviderCapability::Simple(true)),
                code_action_provider: Some(CodeActionProviderCapability::Simple(true)),
                ..Default::default()
            },
        })
    }

    async fn initialized(&self, _: InitializedParams) {
        let _ = self.client.log_message(MessageType::INFO, "SaCode LSP initialized").await;
    }

    async fn shutdown(&self) -> LspResult<()> {
        Ok(())
    }

    async fn did_open(&self, params: DidOpenTextDocumentParams) {
        let document = TextDocument {
            uri: params.text_document.uri,
            content: params.text_document.text,
            version: params.text_document.version,
            language_id: params.text_document.language_id,
        };
        self.documents.lock().expect("document mutex poisoned").open(document);
    }

    async fn did_change(&self, params: DidChangeTextDocumentParams) {
        if let Some(change) = params.content_changes.into_iter().last() {
            self.documents
                .lock()
                .expect("document mutex poisoned")
                .update(&params.text_document.uri, change.text, params.text_document.version);
        }
    }

    async fn did_close(&self, params: DidCloseTextDocumentParams) {
        self.documents
            .lock()
            .expect("document mutex poisoned")
            .close(&params.text_document.uri);
    }

    async fn completion(&self, params: CompletionParams) -> LspResult<Option<CompletionResponse>> {
        let items = completion_items(
            &self.documents.lock().expect("document mutex poisoned"),
            &self.sessions,
            &params.text_document_position.text_document.uri,
            params.text_document_position.position,
        );
        Ok(Some(CompletionResponse::Array(items)))
    }

    async fn hover(&self, params: HoverParams) -> LspResult<Option<Hover>> {
        let documents = self.documents.lock().expect("document mutex poisoned");
        let uri = &params.text_document_position_params.text_document.uri;
        let position = params.text_document_position_params.position;
        let Some(document) = documents.get(uri) else {
            return Ok(None);
        };

        let line = document
            .content
            .lines()
            .nth(position.line as usize)
            .unwrap_or_default()
            .to_string();

        Ok(Some(Hover {
            contents: HoverContents::Scalar(MarkedString::String(format!(
                "Language: {}\nLine {}: {}",
                document.language_id,
                position.line + 1,
                line.trim()
            ))),
            range: None,
        }))
    }

    async fn code_action(&self, _: tower_lsp::lsp_types::CodeActionParams) -> LspResult<Option<CodeActionResponse>> {
        Ok(Some(Vec::new()))
    }
}

pub async fn run_stdio_server(_config: &LspConfig) -> Result<()> {
    let stdin = tokio::io::stdin();
    let stdout = tokio::io::stdout();
    let (service, socket) = LspService::new(|client| SaCodeLanguageServer {
        client,
        documents: Arc::new(Mutex::new(DocumentManager::default())),
        sessions: SessionService::new(),
    });
    Server::new(stdin, stdout, socket).serve(service).await;
    Ok(())
}

pub async fn run_tcp_server(config: &LspConfig) -> Result<()> {
    let listener = tokio::net::TcpListener::bind((config.server.host.as_str(), config.server.port)).await?;
    tracing::info!(host = %config.server.host, port = config.server.port, "LSP TCP server listening");
    loop {
        let (_stream, _addr) = listener.accept().await?;
        tracing::debug!("accepted LSP TCP connection");
    }
}

fn completion_items(
    documents: &DocumentManager,
    sessions: &SessionService,
    uri: &tower_lsp::lsp_types::Url,
    position: Position,
) -> Vec<CompletionItem> {
    let Some(document) = documents.get(uri) else {
        return vec![CompletionItem::new_simple("sacode.todo".to_string(), "Open a file to enable completions".to_string())];
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
    let session = sessions
        .create_session(std::env::current_dir().unwrap_or_else(|_| ".".into()))
        .ok();

    let ai_hint = session
        .and_then(|handle| {
            sessions
                .prompt(
                    &handle.id,
                    SessionPrompt {
                        content: format!("为以下代码前缀生成 3 个简短补全建议：{}", prefix.trim()),
                        mode: ExecutionMode::Build,
                        approval: ApprovalPolicy::AutoDeny,
                    },
                )
                .ok()
        })
        .and_then(|events| {
            events.into_iter().find_map(|event| match event {
                sacode_runtime::SessionEvent::Done { summary } => Some(summary),
                _ => None,
            })
        })
        .unwrap_or_else(|| "任务完成，共完成 1 个步骤".to_string());

    vec![
        CompletionItem::new_simple("sacode.explain".to_string(), format!("Explain current line: {}", prefix.trim())),
        CompletionItem::new_simple("sacode.fix".to_string(), "Generate a fix suggestion".to_string()),
        CompletionItem::new_simple("sacode.ai".to_string(), ai_hint),
    ]
}
