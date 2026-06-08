use anyhow::Result;
use std::sync::{Arc, Mutex};

use sacode_kernel::{ApprovalPolicy, ExecutionMode};
use sacode_runtime::{McpConfigStore, ProviderClient, SessionPrompt, SessionService};
use tower_lsp::{
    jsonrpc::Result as LspResult,
    lsp_types::{
        CodeAction, CodeActionKind, CodeActionOrCommand, CodeActionProviderCapability,
        CodeActionResponse, Command, CompletionItem, CompletionItemKind, CompletionOptions,
        CompletionParams, CompletionResponse, DidChangeTextDocumentParams,
        DidCloseTextDocumentParams, DidOpenTextDocumentParams, Hover, HoverContents, HoverParams,
        HoverProviderCapability, InitializeParams, InitializeResult, InitializedParams,
        InsertTextFormat, MessageType, Position, Range, ServerCapabilities,
        TextDocumentSyncCapability, TextDocumentSyncKind, TextEdit,
    },
    Client, LanguageServer, LspService, Server,
};

use crate::config::LspConfig;
use crate::document::{DocumentManager, TextDocument};

struct SaCodeLanguageServer {
    client: Client,
    documents: Arc<Mutex<DocumentManager>>,
    sessions: SessionService,
    provider_config: Arc<Mutex<Option<sacode_kernel::model::ModelProvider>>>,
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
    }

    async fn did_change(&self, params: DidChangeTextDocumentParams) {
        if let Some(change) = params.content_changes.into_iter().last() {
            self.documents
                .lock()
                .expect("document mutex poisoned")
                .update(
                    &params.text_document.uri,
                    change.text,
                    params.text_document.version,
                );
        }
    }

    async fn did_close(&self, params: DidCloseTextDocumentParams) {
        self.documents
            .lock()
            .expect("document mutex poisoned")
            .close(&params.text_document.uri);
    }

    async fn completion(&self, params: CompletionParams) -> LspResult<Option<CompletionResponse>> {
        let sessions = self.sessions.clone();
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

        if !has_errors
            && range.start.line == range.end.line
            && range.start.character == range.end.character
        {
            return Ok(Some(Vec::new()));
        }

        let code_snippet = document
            .content
            .lines()
            .skip(range.start.line as usize)
            .take((range.end.line - range.start.line + 1) as usize)
            .collect::<Vec<_>>()
            .join("\n");

        let actions = vec![
            CodeActionOrCommand::CodeAction(CodeAction {
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
            }),
            CodeActionOrCommand::CodeAction(CodeAction {
                title: "SaCode: Fix errors".to_string(),
                kind: Some(CodeActionKind::QUICKFIX),
                diagnostics: Some(diagnostics.clone()),
                edit: if let Some(provider) = provider_config {
                    Some(generate_fix_edits(&provider, &code_snippet, &document, range).await)
                } else {
                    None
                },
                ..CodeAction::default()
            }),
            CodeActionOrCommand::CodeAction(CodeAction {
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
            }),
        ];

        Ok(Some(actions))
    }
}

pub async fn run_stdio_server(_config: &LspConfig) -> Result<()> {
    let stdin = tokio::io::stdin();
    let stdout = tokio::io::stdout();
    let workdir = std::env::current_dir()?;
    let provider = resolve_provider_for_lsp(&workdir);
    let (service, socket) = LspService::new(|client| SaCodeLanguageServer {
        client,
        documents: Arc::new(Mutex::new(DocumentManager::default())),
        sessions: SessionService::new(),
        provider_config: Arc::new(Mutex::new(provider)),
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
    let _store = McpConfigStore::new(workdir);
    let config_path = workdir.join(".sacode/config.json");
    if !config_path.exists() {
        return None;
    }

    let config_content = std::fs::read_to_string(&config_path).ok()?;
    let config: serde_json::Value = serde_json::from_str(&config_content).ok()?;
    let current = config.get("current").and_then(|v| v.as_str())?;
    let providers = config.get("providers").and_then(|v| v.as_object())?;
    let provider_config = providers.get(current)?;
    let kind = match current.to_ascii_lowercase().as_str() {
        "openai" => sacode_kernel::model::ProviderKind::Openai,
        "deepseek" => sacode_kernel::model::ProviderKind::Deepseek,
        "mimo" => sacode_kernel::model::ProviderKind::Mimo,
        "longcat" => sacode_kernel::model::ProviderKind::Longcat,
        "ollama" => sacode_kernel::model::ProviderKind::Ollama,
        other => sacode_kernel::model::ProviderKind::Custom(other.to_string()),
    };

    Some(sacode_kernel::model::ModelProvider {
        kind,
        model: provider_config
            .get("model")
            .and_then(|v| v.as_str())
            .unwrap_or("gpt-5.4")
            .to_string(),
        api_key: provider_config
            .get("api_key")
            .and_then(|v| v.as_str())
            .map(str::to_string),
        base_url: provider_config
            .get("base_url")
            .and_then(|v| v.as_str())
            .map(str::to_string),
        rule: None,
    })
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

    let fixed_code = client
        .simple_chat(provider, &prompt)
        .await
        .ok()
        .and_then(|s| {
            let trimmed = s.trim();
            if trimmed.starts_with("```") {
                Some(
                    trimmed
                        .lines()
                        .skip(1)
                        .take_while(|l| !l.starts_with("```"))
                        .collect::<Vec<_>>()
                        .join("\n"),
                )
            } else {
                Some(trimmed.to_string())
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
        .unwrap_or_else(|| "AI assistance available".to_string());

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
