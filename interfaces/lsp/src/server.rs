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
        DidCloseTextDocumentParams, DidOpenTextDocumentParams, DocumentSymbol, DocumentSymbolParams,
        DocumentSymbolResponse, GotoDefinitionParams, GotoDefinitionResponse, Hover, HoverContents,
        HoverParams, HoverProviderCapability, InitializeParams, InitializeResult, InitializedParams,
        InsertTextFormat, Location, MessageType, OneOf, Position, PrepareRenameResponse, Range,
        ReferenceParams, RenameParams, ServerCapabilities, SymbolInformation,
        TextDocumentSyncCapability, TextDocumentSyncKind, TextEdit, Url, WorkspaceEdit,
        WorkspaceSymbolParams, Diagnostic, DiagnosticSeverity,
    },
    Client, LanguageServer, LspService, Server,
};

use crate::code_intelligence::{
    completion_response_from_ast, document_symbols_from_ast, find_definition_in_document,
    find_references_in_document, hover_from_ast, prepare_rename_in_document,
    rename_symbol_in_document,
};
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
    /// 灵枢 · 诊断联动：缓存最近一次发布的诊断，供 hover 等功能读取
    /// 避免 hover 时重新调用外部检查器（cargo/tsc/go vet）
    last_diagnostics: Arc<std::sync::Mutex<HashMap<Url, Vec<Diagnostic>>>>,
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
                // 灵枢 · LSP 能力补齐：documentSymbol / references / definition / rename / workspaceSymbol
                document_symbol_provider: Some(OneOf::Left(true)),
                references_provider: Some(OneOf::Left(true)),
                definition_provider: Some(OneOf::Left(true)),
                rename_provider: Some(OneOf::Left(true)),
                workspace_symbol_provider: Some(OneOf::Left(true)),
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
        // 灵枢 · 诊断联动：命中后仍检查该位置的诊断，附加到 hover 内容
        if let Some(mut hover) = hover_from_ast(&document, position) {
            append_position_diagnostics(&mut hover, &self.last_diagnostics, uri, position);
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

        let mut hover_content = if let Some(provider) = provider_config {
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

        // 灵枢 · 诊断联动：附加该位置的诊断信息
        if let Some(diag_section) = build_position_diagnostics_section(&self.last_diagnostics, uri, position) {
            hover_content.push_str("\n\n---\n\n");
            hover_content.push_str(&diag_section);
        }

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

    /// 文档符号大纲 — 供 LSP 客户端展示 outline 视图
    ///
    /// 复用 runtime 的 tree-sitter AST 解析，返回文档中所有顶层符号。
    async fn document_symbol(
        &self,
        params: DocumentSymbolParams,
    ) -> LspResult<Option<DocumentSymbolResponse>> {
        let uri = &params.text_document.uri;
        let document = self
            .documents
            .lock()
            .expect("document mutex poisoned")
            .get(uri)
            .cloned();

        let Some(document) = document else {
            return Ok(None);
        };

        let symbols = document_symbols_from_ast(&document);
        if symbols.is_empty() {
            Ok(None)
        } else {
            Ok(Some(DocumentSymbolResponse::Nested(symbols)))
        }
    }

    /// 工作区符号搜索 — 跨所有已打开文档按 query 过滤符号
    ///
    /// 实现策略：
    /// 1. 收集所有已打开文档（仅内存中已打开的，不扫描磁盘）
    /// 2. 对每个文档调用 `document_symbols_from_ast` 提取嵌套符号树
    /// 3. 递归扁平化符号树，按 query 大小写不敏感子串匹配过滤
    /// 4. 返回 WorkspaceSymbol 列表（含 Location 指向源文件位置）
    ///
    /// 限制：仅搜索已打开文档；未打开的文件需先 didOpen 才能被搜索到。
    async fn symbol(
        &self,
        params: WorkspaceSymbolParams,
    ) -> LspResult<Option<Vec<SymbolInformation>>> {
        let query = params.query.to_lowercase();
        // 收集所有已打开文档（克隆后释放锁，避免长时间持锁）
        let documents: Vec<TextDocument> = self
            .documents
            .lock()
            .expect("document mutex poisoned")
            .iter_all()
            .cloned()
            .collect();

        let mut symbols: Vec<SymbolInformation> = Vec::new();
        for doc in &documents {
            let doc_symbols = document_symbols_from_ast(doc);
            for ds in &doc_symbols {
                collect_workspace_symbols(ds, &doc.uri, &query, &mut symbols);
            }
        }

        if symbols.is_empty() {
            Ok(None)
        } else {
            Ok(Some(symbols))
        }
    }

    /// 引用查找 — 查找光标位置符号在所有已打开文档中的引用
    ///
    /// 基于 AST identifier 节点匹配，支持 includeDeclaration 过滤。
    /// 跨文件搜索：遍历所有已打开文档，对每个文档运行 AST 引用检测。
    async fn references(
        &self,
        params: ReferenceParams,
    ) -> LspResult<Option<Vec<Location>>> {
        let uri = &params.text_document_position.text_document.uri;
        let position = params.text_document_position.position;
        let include_declaration = params.context.include_declaration;

        // 获取当前文档以提取符号名
        let symbol_name = {
            let docs = self.documents.lock().expect("document mutex poisoned");
            let doc = docs.get(uri).cloned();
            doc.and_then(|d| extract_symbol_name_from_document(&d, position))
        };

        let Some(symbol_name) = symbol_name else {
            return Ok(None);
        };

        // 跨文件搜索：遍历所有已打开文档
        let documents: Vec<TextDocument> = self
            .documents
            .lock()
            .expect("document mutex poisoned")
            .iter_all()
            .cloned()
            .collect();

        let mut locations = Vec::new();
        for doc in &documents {
            let doc_locations = find_references_in_document(
                doc,
                &doc.uri,
                &symbol_name,
                include_declaration,
            );
            locations.extend(doc_locations);
        }

        if locations.is_empty() {
            Ok(None)
        } else {
            Ok(Some(locations))
        }
    }

    /// 跳转到定义 — 查找光标位置符号在所有已打开文档中的定义位置
    ///
    /// 策略：从光标位置提取符号名，依次扫描所有已打开文档的符号表，
    /// 返回第一个匹配的定义位置。
    async fn goto_definition(
        &self,
        params: GotoDefinitionParams,
    ) -> LspResult<Option<GotoDefinitionResponse>> {
        let uri = &params.text_document_position_params.text_document.uri;
        let position = params.text_document_position_params.position;

        // 提取符号名
        let symbol_name = {
            let docs = self.documents.lock().expect("document mutex poisoned");
            let doc = docs.get(uri).cloned();
            doc.and_then(|d| extract_symbol_name_from_document(&d, position))
        };

        let Some(symbol_name) = symbol_name else {
            return Ok(None);
        };

        // 跨文件搜索：遍历所有已打开文档，找第一个匹配的定义
        let documents: Vec<TextDocument> = self
            .documents
            .lock()
            .expect("document mutex poisoned")
            .iter_all()
            .cloned()
            .collect();

        for doc in &documents {
            if let Some(location) = find_definition_in_document(doc, &doc.uri, position) {
                // 验证找到的符号名是否匹配提取的符号名
                if let Some(found_name) = extract_symbol_name_from_document(doc, location.range.start) {
                    if found_name == symbol_name {
                        return Ok(Some(GotoDefinitionResponse::Scalar(location)));
                    }
                }
            }
        }

        Ok(None)
    }

    /// 重命名 — 为光标位置的符号生成全文档重命名编辑
    ///
    /// 复用 references 收集所有引用位置，生成 TextEdit 列表。
    async fn rename(
        &self,
        params: RenameParams,
    ) -> LspResult<Option<WorkspaceEdit>> {
        let uri = &params.text_document_position.text_document.uri;
        let position = params.text_document_position.position;
        let new_name = params.new_name;
        let document = self
            .documents
            .lock()
            .expect("document mutex poisoned")
            .get(uri)
            .cloned();

        let Some(document) = document else {
            return Ok(None);
        };

        let edit = rename_symbol_in_document(&document, uri, position, &new_name);
        Ok(edit)
    }

    /// 准备重命名 — 检查光标位置是否可重命名，返回占位 range
    ///
    /// LSP 客户端用此结果进入重命名输入模式。
    async fn prepare_rename(
        &self,
        params: tower_lsp::lsp_types::TextDocumentPositionParams,
    ) -> LspResult<Option<PrepareRenameResponse>> {
        let uri = &params.text_document.uri;
        let position = params.position;
        let document = self
            .documents
            .lock()
            .expect("document mutex poisoned")
            .get(uri)
            .cloned();

        let Some(document) = document else {
            return Ok(None);
        };

        let range = prepare_rename_in_document(&document, position);
        Ok(range.map(|range| {
            PrepareRenameResponse::RangeWithPlaceholder {
                range,
                placeholder: "symbol".to_string(),
            }
        }))
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
        let last_diagnostics = self.last_diagnostics.clone();
        let handle = tokio::spawn(async move {
            if interval > 0 {
                tokio::time::sleep(Duration::from_millis(interval)).await;
            }
            let diagnostics = provider.analyze(&doc);
            // 灵枢 · 诊断联动：缓存诊断结果，供 hover 等功能读取
            // 避免 hover 时重新调用外部检查器
            if let Ok(mut cache) = last_diagnostics.lock() {
                cache.insert(uri_for_publish.clone(), diagnostics.clone());
            }
            let _ = client
                .publish_diagnostics(uri_for_publish, diagnostics, Some(version))
                .await;
        });
        let mut pending = self.pending_diagnostics.lock().await;
        pending.insert(uri, handle);
    }
}

/// 从文档光标位置提取符号名 — 复用 code_intelligence 的提取逻辑
///
/// 用于 references / rename 等需要从光标位置反查符号名的场景。
fn extract_symbol_name_from_document(document: &TextDocument, position: Position) -> Option<String> {
    let line = document.content.lines().nth(position.line as usize)?;
    let char_pos = (position.character as usize).min(line.len());

    let start = line[..char_pos]
        .char_indices()
        .rev()
        .take_while(|(_, ch)| ch.is_alphanumeric() || *ch == '_')
        .last()
        .map(|(idx, _)| idx)
        .unwrap_or(char_pos);

    let end = line[char_pos..]
        .char_indices()
        .take_while(|(_, ch)| ch.is_alphanumeric() || *ch == '_')
        .last()
        .map(|(idx, ch)| char_pos + idx + ch.len_utf8())
        .unwrap_or(char_pos);

    if start >= end {
        return None;
    }

    let name = &line[start..end];
    if name.is_empty() || name.chars().all(|ch| ch.is_numeric()) {
        return None;
    }
    Some(name.to_string())
}

/// 递归扁平化 DocumentSymbol 嵌套树，按 query 过滤并收集为 SymbolInformation
///
/// 匹配规则：query 为空时返回所有符号；非空时按名称大小写不敏感子串匹配。
/// 无论自身是否匹配，都递归处理 children（子符号可能匹配）。
fn collect_workspace_symbols(
    ds: &DocumentSymbol,
    uri: &Url,
    query: &str,
    out: &mut Vec<SymbolInformation>,
) {
    let matched = query.is_empty() || ds.name.to_lowercase().contains(query);
    if matched {
        out.push(SymbolInformation {
            name: ds.name.clone(),
            kind: ds.kind,
            tags: None,
            deprecated: None,
            location: Location {
                uri: uri.clone(),
                range: ds.range,
            },
            container_name: None,
        });
    }
    if let Some(children) = &ds.children {
        for child in children {
            collect_workspace_symbols(child, uri, query, out);
        }
    }
}

/// 灵枢 · 诊断联动：把位置重叠的诊断附加到 AST hover 内容
///
/// 用于 hover_from_ast 命中路径：AST hover 返回静态符号信息后，
/// 追加该位置的诊断（error/warning），让用户 hover 时同时看到符号语义和问题。
fn append_position_diagnostics(
    hover: &mut Hover,
    last_diagnostics: &Arc<std::sync::Mutex<HashMap<Url, Vec<Diagnostic>>>>,
    uri: &Url,
    position: Position,
) {
    if let Some(section) = build_position_diagnostics_section(last_diagnostics, uri, position) {
        if let HoverContents::Markup(ref mut markup) = hover.contents {
            markup.value.push_str("\n\n---\n\n");
            markup.value.push_str(&section);
        }
    }
}

/// 构建位置重叠诊断的 Markdown 段落
///
/// 从 last_diagnostics 缓存读取该 URI 的诊断，过滤出与 position 重叠的诊断，
/// 返回格式化的 Markdown 段落。无诊断时返回 None。
fn build_position_diagnostics_section(
    last_diagnostics: &Arc<std::sync::Mutex<HashMap<Url, Vec<Diagnostic>>>>,
    uri: &Url,
    position: Position,
) -> Option<String> {
    let cache = last_diagnostics.lock().ok()?;
    let diagnostics = cache.get(uri)?;
    let overlapping: Vec<&Diagnostic> = diagnostics
        .iter()
        .filter(|d| position >= d.range.start && position < d.range.end)
        .collect();
    if overlapping.is_empty() {
        return None;
    }
    let mut section = String::from("**Diagnostics:**\n");
    for d in &overlapping {
        let severity_label = match d.severity {
            Some(DiagnosticSeverity::ERROR) => "ERROR",
            Some(DiagnosticSeverity::WARNING) => "WARNING",
            Some(DiagnosticSeverity::INFORMATION) => "INFO",
            Some(DiagnosticSeverity::HINT) => "HINT",
            _ => "DIAG",
        };
        let source = d.source.as_deref().unwrap_or("unknown");
        section.push_str(&format!("- **{}** ({}): {}\n", severity_label, source, d.message));
    }
    Some(section)
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
        last_diagnostics: Arc::new(std::sync::Mutex::new(HashMap::new())),
    });
    Server::new(stdin, stdout, socket).serve(service).await;
    Ok(())
}

pub async fn run_tcp_server(config: &LspConfig) -> Result<()> {
    let listener =
        tokio::net::TcpListener::bind((config.server.host.as_str(), config.server.port)).await?;
    tracing::info!(host = %config.server.host, port = config.server.port, "LSP TCP server listening");
    let max_connections = config.server.max_connections;
    let mut active_connections = 0usize;

    loop {
        let (stream, addr) = listener.accept().await?;
        if active_connections >= max_connections {
            tracing::warn!(%addr, active_connections, max_connections, "LSP TCP connection rejected: max connections reached");
            continue;
        }
        active_connections += 1;
        tracing::debug!(%addr, active_connections, "accepted LSP TCP connection");

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
            last_diagnostics: Arc::new(std::sync::Mutex::new(HashMap::new())),
        });

        // TCP 模式：用 (read, write) 半双工适配 Server::new
        let (read_half, write_half) = tokio::io::split(stream);
        tokio::spawn(async move {
            let _ = Server::new(read_half, write_half, socket).serve(service).await;
            tracing::debug!(%addr, "LSP TCP connection closed");
        });
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
