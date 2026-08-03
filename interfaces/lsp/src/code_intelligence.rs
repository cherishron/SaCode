//! LSP 代码智能 — 基于 runtime `code::ast::AstEditor` 的 completion / hover 实现
//!
//! 设计意图：
//! - 复用 runtime 的 tree-sitter AST 解析能力，避免在 LSP 内重复实现
//! - 同步执行：tree-sitter 解析快（<10ms / 中等文件），无需 spawn
//! - 容错优先：解析失败时返回空列表，不阻断 LSP 流程

use std::path::Path;

use sacode_runtime::tools::code::ast::{AstEditor, AstSummary, AstSymbol};
use tower_lsp::lsp_types::{
    CompletionItem, CompletionItemKind, CompletionResponse, Hover, HoverContents, MarkupContent,
    MarkupKind, Position, Range,
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
