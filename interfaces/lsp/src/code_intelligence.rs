//! LSP 代码智能 — 基于 runtime `code::ast::AstEditor` 的 completion / hover 实现
//!
//! 设计意图：
//! - 复用 runtime 的 tree-sitter AST 解析能力，避免在 LSP 内重复实现
//! - 同步执行：tree-sitter 解析快（<10ms / 中等文件），无需 spawn
//! - 容错优先：解析失败时返回空列表，不阻断 LSP 流程

use std::path::Path;

use sacode_runtime::tools::code::ast::{AstEditor, AstSummary, AstSymbol, AstSymbolWithRange};
use tower_lsp::lsp_types::{
    CompletionItem, CompletionItemKind, CompletionResponse, DocumentSymbol,
    DocumentSymbolResponse, Hover, HoverContents, Location, MarkupContent, MarkupKind, Position,
    Range, SymbolKind, Url,
};

use crate::document::TextDocument;

/// 把 LSP language_id 映射到 AstEditor 支持的 language 字符串
///
/// LSP 的 language_id 来自 `DidOpenTextDocumentParams.language_id`，
/// 与 tree-sitter 的语言名存在差异（如 "typescriptreact" 不在 ast 支持列表中）。
pub fn language_id_to_ast_language(language_id: &str) -> Option<&'static str> {
    match language_id {
        "rust" => Some("rust"),
        "python" => Some("python"),
        "javascript" => Some("javascript"),
        "typescript" => Some("typescript"),
        "typescriptreact" | "javascriptreact" => Some("typescript"),
        "go" => Some("go"),
        _ => None,
    }
}

/// 对文档执行 AST 解析，返回符号摘要
///
/// 失败时返回 None，调用方按需降级（如返回空 completion / 朴素 hover）。
pub fn summarize_document(doc: &TextDocument) -> Option<AstSummary> {
    let language = language_id_to_ast_language(&doc.language_id)?;
    AstEditor::summarize(language, &doc.content).ok()
}

/// 生成 completion 列表：把 AST 中所有符号作为补全项
///
/// 策略：
/// 1. 解析当前文档，提取所有顶层符号
/// 2. 按光标位置过滤（仅保留光标之前的符号，避免前向引用噪音）
/// 3. 把符号名作为 label，kind 作为 detail，preview 作为 documentation
///
/// 注：这是基础实现，不做上下文类型推断（例如不区分方法调用 vs 变量引用）。
/// AI 增强的补全仍由原 generate_ai_completions 路径兜底。
pub fn completion_items_from_ast(doc: &TextDocument, position: Position) -> Vec<CompletionItem> {
    let Some(summary) = summarize_document(doc) else {
        return Vec::new();
    };

    summary
        .symbols
        .into_iter()
        .filter(|symbol| symbol.line <= position.line as usize + 1)
        .map(symbol_to_completion_item)
        .collect()
}

/// 把符号转换为 CompletionItem
fn symbol_to_completion_item(symbol: AstSymbol) -> CompletionItem {
    CompletionItem {
        label: symbol.name.clone(),
        kind: Some(symbol_kind_to_completion_kind(&symbol.kind)),
        detail: Some(format!("{} (line {})", symbol.kind, symbol.line)),
        documentation: Some(tower_lsp::lsp_types::Documentation::MarkupContent(MarkupContent {
            kind: MarkupKind::Markdown,
            value: format!("```rust\n{}\n```", symbol.preview),
        })),
        insert_text: Some(symbol.name),
        insert_text_format: Some(tower_lsp::lsp_types::InsertTextFormat::PLAIN_TEXT),
        ..CompletionItem::default()
    }
}

/// 把 AST 符号 kind 字符串映射到 LSP CompletionItemKind
fn symbol_kind_to_completion_kind(kind: &str) -> CompletionItemKind {
    match kind {
        "fn" | "function" => CompletionItemKind::FUNCTION,
        "struct" | "class" => CompletionItemKind::CLASS,
        "enum" => CompletionItemKind::ENUM,
        "trait" | "interface" => CompletionItemKind::INTERFACE,
        "type" => CompletionItemKind::STRUCT,
        "mod" => CompletionItemKind::MODULE,
        "const" => CompletionItemKind::CONSTANT,
        "var" => CompletionItemKind::VARIABLE,
        _ => CompletionItemKind::TEXT,
    }
}

/// 生成 hover：查找包含光标位置的符号，返回其 kind + preview
///
/// 策略：
/// 1. 解析当前文档
/// 2. 在 symbols 中查找 line 最接近 position.line 的符号（同行优先）
/// 3. 返回 Markdown 格式：`**<kind> <name>** (line N)\n\n<preview>`
pub fn hover_from_ast(doc: &TextDocument, position: Position) -> Option<Hover> {
    let summary = summarize_document(doc)?;
    let target_line = position.line as usize + 1;

    // 找同行的符号；若无则找最近的（容差 ±2 行）
    let symbol = summary
        .symbols
        .iter()
        .find(|s| s.line == target_line)
        .or_else(|| {
            summary.symbols.iter().filter(|s| s.line.abs_diff(target_line) <= 2).min_by_key(|s| s.line.abs_diff(target_line))
        })?;

    let content = format!(
        "**{} {}** (line {})\n\n```{}\n{}\n```",
        symbol.kind,
        symbol.name,
        symbol.line,
        doc.language_id,
        symbol.preview
    );

    Some(Hover {
        contents: HoverContents::Markup(MarkupContent {
            kind: MarkupKind::Markdown,
            value: content,
        }),
        range: Some(Range {
            start: Position {
                line: position.line,
                character: 0,
            },
            end: Position {
                line: position.line,
                character: u32::MAX,
            },
        }),
    })
}

/// 在指定文档路径下，从 LSP URI 解析出文件路径
///
/// 用于 code_action 路径过滤（与 diagnostics 模块的 uri_to_file_path 等价）
pub fn uri_to_local_path(uri: &tower_lsp::lsp_types::Url, workdir: &Path) -> Option<std::path::PathBuf> {
    let path = uri.to_file_path().ok()?;
    // 若 path 在 workdir 内，返回相对路径，便于与 cargo/tsc 输出对齐
    if let Ok(relative) = path.strip_prefix(workdir) {
        Some(workdir.join(relative))
    } else {
        Some(path)
    }
}

/// 把 completion_items_from_ast 的结果包装为 CompletionResponse
pub fn completion_response_from_ast(doc: &TextDocument, position: Position) -> Option<CompletionResponse> {
    let items = completion_items_from_ast(doc, position);
    if items.is_empty() {
        None
    } else {
        Some(CompletionResponse::Array(items))
    }
}

/// 在没有 AI provider 时的 hover fallback：基于 AST 给出静态信息
pub fn hover_fallback(doc: &TextDocument, position: Position) -> Option<Hover> {
    hover_from_ast(doc, position)
}

// ============================================================================
// documentSymbol — 桥接 code.symbols 到 LSP
// ============================================================================

/// 生成文档符号大纲 — 供 LSP textDocument/documentSymbol 使用
///
/// 复用 runtime 的 tree-sitter AST 解析，返回带完整 range 的符号树。
/// LSP 客户端用此结果展示 outline 视图和面包屑导航。
pub fn document_symbols_from_ast(doc: &TextDocument) -> Vec<DocumentSymbol> {
    let Some(language) = language_id_to_ast_language(&doc.language_id) else {
        return Vec::new();
    };
    let symbols = AstEditor::symbols_with_range(language, &doc.content).unwrap_or_default();
    symbols.into_iter().map(symbol_with_range_to_document_symbol).collect()
}

/// 把 AstSymbolWithRange 转换为 LSP DocumentSymbol
fn symbol_with_range_to_document_symbol(symbol: AstSymbolWithRange) -> DocumentSymbol {
    DocumentSymbol {
        name: symbol.name.clone(),
        detail: Some(format!("{} (line {})", symbol.kind, symbol.start_line)),
        kind: symbol_kind_to_lsp_symbol_kind(&symbol.kind),
        tags: None,
        deprecated: None,
        range: Range {
            start: Position {
                line: (symbol.start_line as u32).saturating_sub(1),
                character: (symbol.start_column as u32).saturating_sub(1),
            },
            end: Position {
                line: (symbol.end_line as u32).saturating_sub(1),
                character: (symbol.end_column as u32).saturating_sub(1),
            },
        },
        selection_range: Range {
            start: Position {
                line: (symbol.selection_start_line as u32).saturating_sub(1),
                character: (symbol.selection_start_column as u32).saturating_sub(1),
            },
            end: Position {
                line: (symbol.selection_end_line as u32).saturating_sub(1),
                character: (symbol.selection_end_column as u32).saturating_sub(1),
            },
        },
        children: None,
    }
}

/// 把 AST 符号 kind 映射到 LSP SymbolKind
fn symbol_kind_to_lsp_symbol_kind(kind: &str) -> SymbolKind {
    match kind {
        "fn" | "function" => SymbolKind::FUNCTION,
        "struct" | "class" => SymbolKind::CLASS,
        "enum" => SymbolKind::ENUM,
        "trait" | "interface" => SymbolKind::INTERFACE,
        "type" => SymbolKind::TYPE_PARAMETER,
        "mod" => SymbolKind::MODULE,
        "const" => SymbolKind::CONSTANT,
        "var" => SymbolKind::VARIABLE,
        "impl" => SymbolKind::OBJECT,
        _ => SymbolKind::VARIABLE,
    }
}

// ============================================================================
// references — 基于 AST 查找符号引用
// ============================================================================

/// 在文档中查找指定符号名的所有引用位置 — 供 LSP textDocument/references 使用
///
/// 策略：遍历 AST 中所有 identifier 节点，匹配符号名。
/// include_declaration 控制是否包含定义处。
pub fn find_references_in_document(
    doc: &TextDocument,
    uri: &Url,
    symbol_name: &str,
    include_declaration: bool,
) -> Vec<Location> {
    let Some(language) = language_id_to_ast_language(&doc.language_id) else {
        return Vec::new();
    };
    let references = AstEditor::find_references(language, &doc.content, symbol_name).unwrap_or_default();
    references
        .into_iter()
        .filter(|reference| include_declaration || !reference.is_declaration)
        .map(|reference| Location {
            uri: uri.clone(),
            range: Range {
                start: Position {
                    line: (reference.start_line as u32).saturating_sub(1),
                    character: (reference.start_column as u32).saturating_sub(1),
                },
                end: Position {
                    line: (reference.end_line as u32).saturating_sub(1),
                    character: (reference.end_column as u32).saturating_sub(1),
                },
            },
        })
        .collect()
}

// ============================================================================
// goto definition — 基于符号表查找定义位置
// ============================================================================

/// 在文档中查找指定位置的符号定义 — 供 LSP textDocument/definition 使用
///
/// 策略：
/// 1. 找到光标位置所在的 identifier 文本（作为符号名）
/// 2. 在符号表中查找该名称的定义位置
/// 3. 返回定义处的 Location
pub fn find_definition_in_document(
    doc: &TextDocument,
    uri: &Url,
    position: Position,
) -> Option<Location> {
    let language = language_id_to_ast_language(&doc.language_id)?;
    let symbols = AstEditor::symbols_with_range(language, &doc.content).ok()?;

    // 尝试从光标位置提取符号名
    let symbol_name = extract_symbol_name_at_position(doc, position)?;

    // 在符号表中查找定义
    let definition = symbols.into_iter().find(|symbol| symbol.name == symbol_name)?;

    Some(Location {
        uri: uri.clone(),
        range: Range {
            start: Position {
                line: (definition.selection_start_line as u32).saturating_sub(1),
                character: (definition.selection_start_column as u32).saturating_sub(1),
            },
            end: Position {
                line: (definition.selection_end_line as u32).saturating_sub(1),
                character: (definition.selection_end_column as u32).saturating_sub(1),
            },
        },
    })
}

/// 从文档光标位置提取符号名（基于行文本切分）
///
/// 这是一种简化的策略：取光标所在行的光标位置前后的标识符字符。
/// 不依赖 AST，避免对每个光标位置都解析 AST。
fn extract_symbol_name_at_position(doc: &TextDocument, position: Position) -> Option<String> {
    let line = doc.content.lines().nth(position.line as usize)?;
    let char_pos = (position.character as usize).min(line.len());

    // 向左扫描找到标识符起始
    let start = line[..char_pos]
        .char_indices()
        .rev()
        .take_while(|(_, ch)| ch.is_alphanumeric() || *ch == '_')
        .last()
        .map(|(idx, _)| idx)
        .unwrap_or(char_pos);

    // 向右扫描找到标识符结束
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

// ============================================================================
// rename — 基于引用列表生成重命名 WorkspaceEdit
// ============================================================================

/// 为文档中的符号生成重命名编辑 — 供 LSP textDocument/rename 使用
///
/// 策略：复用 find_references_in_document 收集所有引用位置，
/// 为每个引用生成一个 TextEdit 替换为新名称。
pub fn rename_symbol_in_document(
    doc: &TextDocument,
    uri: &Url,
    position: Position,
    new_name: &str,
) -> Option<tower_lsp::lsp_types::WorkspaceEdit> {
    let symbol_name = extract_symbol_name_at_position(doc, position)?;
    if symbol_name.is_empty() {
        return None;
    }

    let locations = find_references_in_document(doc, uri, &symbol_name, true);
    if locations.is_empty() {
        return None;
    }

    let edits: Vec<tower_lsp::lsp_types::TextEdit> = locations
        .into_iter()
        .map(|location| tower_lsp::lsp_types::TextEdit {
            range: location.range,
            new_text: new_name.to_string(),
        })
        .collect();

    let mut changes = std::collections::HashMap::new();
    changes.insert(uri.clone(), edits);

    Some(tower_lsp::lsp_types::WorkspaceEdit {
        changes: Some(changes),
        document_changes: None,
        change_annotations: None,
    })
}

/// 检查光标位置是否可重命名 — 供 LSP textDocument/prepareRename 使用
///
/// 返回占位 range，让客户端进入重命名输入模式。
pub fn prepare_rename_in_document(
    doc: &TextDocument,
    position: Position,
) -> Option<Range> {
    let symbol_name = extract_symbol_name_at_position(doc, position)?;
    if symbol_name.is_empty() {
        return None;
    }

    // 返回光标所在标识符的 range
    let line = doc.content.lines().nth(position.line as usize)?;
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

    Some(Range {
        start: Position {
            line: position.line,
            character: start as u32,
        },
        end: Position {
            line: position.line,
            character: end as u32,
        },
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;
    use tower_lsp::lsp_types::Url;

    fn rust_doc(content: &str) -> TextDocument {
        TextDocument {
            uri: Url::parse("file:///fake/src/lib.rs").unwrap(),
            content: content.to_string(),
            version: 1,
            language_id: "rust".to_string(),
        }
    }

    #[test]
    fn language_id_mapping_supports_common_languages() {
        assert_eq!(language_id_to_ast_language("rust"), Some("rust"));
        assert_eq!(language_id_to_ast_language("python"), Some("python"));
        assert_eq!(language_id_to_ast_language("typescript"), Some("typescript"));
        assert_eq!(language_id_to_ast_language("typescriptreact"), Some("typescript"));
        assert_eq!(language_id_to_ast_language("go"), Some("go"));
        assert_eq!(language_id_to_ast_language("markdown"), None);
    }

    #[test]
    fn summarize_rust_doc_finds_top_level_symbols() {
        let doc = rust_doc("fn greet() {}\nstruct Foo;\n");
        let summary = summarize_document(&doc).expect("summary");
        let names: Vec<_> = summary.symbols.iter().map(|s| s.name.as_str()).collect();
        assert!(names.contains(&"greet"));
        assert!(names.contains(&"Foo"));
    }

    #[test]
    fn completion_items_filters_after_cursor() {
        let doc = rust_doc("fn first() {}\nfn second() {}\nfn third() {}\n");
        // 光标在第 1 行（0-based），只能看到第 1+1=2 行之前的符号
        let items = completion_items_from_ast(&doc, Position { line: 1, character: 0 });
        let labels: Vec<_> = items.iter().map(|i| i.label.as_str()).collect();
        assert!(labels.contains(&"first"));
        // second 在第 2 行（1-based），不算 ≤ position.line+1=2，应包含
        assert!(labels.contains(&"second"));
        // third 在第 3 行，超过 2，不应包含
        assert!(!labels.contains(&"third"));
    }

    #[test]
    fn completion_returns_empty_for_unsupported_language() {
        let doc = TextDocument {
            uri: Url::parse("file:///fake/readme.md").unwrap(),
            content: "# title".to_string(),
            version: 1,
            language_id: "markdown".to_string(),
        };
        let items = completion_items_from_ast(&doc, Position { line: 0, character: 0 });
        assert!(items.is_empty());
    }

    #[test]
    fn hover_finds_symbol_at_same_line() {
        let doc = rust_doc("fn greet() {\n    println!(\"hi\");\n}\n");
        let hover = hover_from_ast(&doc, Position { line: 0, character: 5 }).expect("hover");
        match hover.contents {
            HoverContents::Markup(content) => {
                assert!(content.value.contains("greet"));
                assert!(content.value.contains("fn"));
            }
            _ => panic!("expected markup"),
        }
    }

    #[test]
    fn hover_returns_none_when_no_symbols_nearby() {
        let doc = rust_doc("fn greet() {}\n");
        // 光标在第 100 行，附近无符号
        let hover = hover_from_ast(&doc, Position { line: 100, character: 0 });
        assert!(hover.is_none());
    }

    #[test]
    fn hover_returns_none_for_unsupported_language() {
        let doc = TextDocument {
            uri: Url::parse("file:///fake/readme.md").unwrap(),
            content: "# title".to_string(),
            version: 1,
            language_id: "markdown".to_string(),
        };
        let hover = hover_from_ast(&doc, Position { line: 0, character: 0 });
        assert!(hover.is_none());
    }

    #[test]
    fn symbol_kind_mapping_covers_common_variants() {
        assert_eq!(symbol_kind_to_completion_kind("fn"), CompletionItemKind::FUNCTION);
        assert_eq!(symbol_kind_to_completion_kind("struct"), CompletionItemKind::CLASS);
        assert_eq!(symbol_kind_to_completion_kind("trait"), CompletionItemKind::INTERFACE);
        assert_eq!(symbol_kind_to_completion_kind("unknown"), CompletionItemKind::TEXT);
    }

    #[test]
    fn completion_response_returns_none_for_empty() {
        let doc = rust_doc("// no symbols\n");
        let response = completion_response_from_ast(&doc, Position { line: 0, character: 0 });
        assert!(response.is_none());
    }

    #[test]
    fn completion_response_returns_array_for_non_empty() {
        let doc = rust_doc("fn greet() {}\n");
        let response =
            completion_response_from_ast(&doc, Position { line: 0, character: 0 }).expect("response");
        match response {
            CompletionResponse::Array(items) => assert!(!items.is_empty()),
            _ => panic!("expected array"),
        }
    }

    #[test]
    fn uri_to_local_path_handles_file_scheme() {
        let workdir = PathBuf::from(std::env::current_dir().expect("cwd"));
        let url = Url::from_file_path(&workdir).expect("Url::from_file_path");
        let path = uri_to_local_path(&url, &workdir);
        assert!(path.is_some());
    }
}
