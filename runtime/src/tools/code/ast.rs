use std::collections::BTreeSet;

use anyhow::{anyhow, Context};
use tree_sitter::{Language, Node, Parser, Tree};

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct AstNodeRecord {
    pub kind: String,
    pub start_line: usize,
    pub start_column: usize,
    pub end_line: usize,
    pub end_column: usize,
    pub text: String,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct AstSymbol {
    pub name: String,
    pub kind: String,
    pub line: usize,
    pub preview: String,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct AstImport {
    pub specifier: String,
    pub line: usize,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct AstSummary {
    pub language: String,
    pub root_kind: String,
    pub node_count: usize,
    pub symbols: Vec<AstSymbol>,
    pub imports: Vec<AstImport>,
}

/// 带 range 信息的符号记录 — 供 LSP documentSymbol / goto definition 使用
///
/// 与 AstSymbol 的区别：包含完整的起止行列和名称选择范围，
/// 使 LSP 客户端能精确定位符号在编辑器中的高亮区域。
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct AstSymbolWithRange {
    pub name: String,
    pub kind: String,
    /// 符号完整节点的起始行（1-based）
    pub start_line: usize,
    /// 符号完整节点的起始列（1-based）
    pub start_column: usize,
    /// 符号完整节点的结束行（1-based）
    pub end_line: usize,
    /// 符号完整节点的结束列（1-based）
    pub end_column: usize,
    /// 名称部分的选择范围起始行（1-based）
    pub selection_start_line: usize,
    /// 名称部分的选择范围起始列（1-based）
    pub selection_start_column: usize,
    /// 名称部分的选择范围结束行（1-based）
    pub selection_end_line: usize,
    /// 名称部分的选择范围结束列（1-based）
    pub selection_end_column: usize,
    pub preview: String,
}

/// 符号引用位置 — 供 LSP references 使用
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct AstReference {
    pub name: String,
    pub start_line: usize,
    pub start_column: usize,
    pub end_line: usize,
    pub end_column: usize,
    /// 是否为定义处（用于 references 请求中 includeDeclaration 过滤）
    pub is_declaration: bool,
}

#[derive(Debug, Default, Clone)]
pub struct AstEditor;

impl AstEditor {
    pub fn summarize(language: &str, source: &str) -> anyhow::Result<AstSummary> {
        let parsed = parse_source(language, source)?;
        let root = parsed.tree.root_node();
        let mut symbols = Vec::new();
        let mut imports = BTreeSet::new();
        let mut node_count = 0;

        walk_tree(root, &mut |node| {
            node_count += 1;
            if let Some(symbol) = extract_symbol(&parsed, node) {
                symbols.push(symbol);
            }
            for import in extract_imports(&parsed, node) {
                imports.insert((import.specifier, import.line));
            }
        });

        Ok(AstSummary {
            language: language.to_string(),
            root_kind: root.kind().to_string(),
            node_count,
            symbols,
            imports: imports
                .into_iter()
                .map(|(specifier, line)| AstImport { specifier, line })
                .collect(),
        })
    }

    pub fn top_level_nodes(language: &str, source: &str) -> anyhow::Result<Vec<AstNodeRecord>> {
        let parsed = parse_source(language, source)?;
        let root = parsed.tree.root_node();
        let mut nodes = Vec::new();
        for index in 0..root.named_child_count() {
            let Some(child) = root.named_child(index) else {
                continue;
            };
            nodes.push(to_node_record(&parsed, child));
        }
        Ok(nodes)
    }

    /// 提取带完整 range 信息的符号列表 — 供 LSP documentSymbol 使用
    ///
    /// 与 `summarize` 的区别：返回每个符号的完整节点 range 和名称选择 range，
    /// 而非仅符号所在的行号。LSP documentSymbol 需要 range 和 selection_range。
    pub fn symbols_with_range(
        language: &str,
        source: &str,
    ) -> anyhow::Result<Vec<AstSymbolWithRange>> {
        let parsed = parse_source(language, source)?;
        let root = parsed.tree.root_node();
        let mut symbols = Vec::new();

        walk_tree(root, &mut |node| {
            if let Some((kind, name_node)) = extract_symbol_name_node(&parsed, node) {
                let name = node_text(parsed.source, name_node).ok();
                let name_start = name_node.start_position();
                let name_end = name_node.end_position();
                let node_start = node.start_position();
                let node_end = node.end_position();
                if let Some(name) = name {
                    symbols.push(AstSymbolWithRange {
                        name,
                        kind: kind.to_string(),
                        start_line: node_start.row + 1,
                        start_column: node_start.column + 1,
                        end_line: node_end.row + 1,
                        end_column: node_end.column + 1,
                        selection_start_line: name_start.row + 1,
                        selection_start_column: name_start.column + 1,
                        selection_end_line: name_end.row + 1,
                        selection_end_column: name_end.column + 1,
                        preview: node_text(parsed.source, node)
                            .unwrap_or_default()
                            .trim()
                            .replace('\n', " "),
                    });
                }
            }
        });

        Ok(symbols)
    }

    /// 在文档中查找指定符号名的所有引用位置 — 供 LSP references 使用
    ///
    /// 策略：遍历 AST 中所有 identifier / type_identifier 等名称节点，
    /// 匹配符号名。标记定义处（与符号定义节点重合的位置）。
    pub fn find_references(
        language: &str,
        source: &str,
        symbol_name: &str,
    ) -> anyhow::Result<Vec<AstReference>> {
        let parsed = parse_source(language, source)?;
        let root = parsed.tree.root_node();
        let mut references = Vec::new();

        // 先收集所有定义位置，用于标记 is_declaration
        let mut declaration_positions = std::collections::HashSet::new();
        let symbols = Self::symbols_with_range(language, source)?;
        for symbol in &symbols {
            declaration_positions.insert((
                symbol.selection_start_line,
                symbol.selection_start_column,
            ));
        }

        walk_tree(root, &mut |node| {
            // 收集所有可能的名称节点
            if is_name_node(node, parsed.language) {
                if let Ok(text) = node_text(parsed.source, node) {
                    let trimmed = text.trim();
                    if trimmed == symbol_name {
                        let start = node.start_position();
                        let end = node.end_position();
                        let is_declaration = declaration_positions
                            .contains(&(start.row + 1, start.column + 1));
                        references.push(AstReference {
                            name: trimmed.to_string(),
                            start_line: start.row + 1,
                            start_column: start.column + 1,
                            end_line: end.row + 1,
                            end_column: end.column + 1,
                            is_declaration,
                        });
                    }
                }
            }
        });

        Ok(references)
    }
}

struct ParsedSource<'a> {
    language: &'a str,
    source: &'a str,
    tree: Tree,
}

fn parse_source<'a>(language: &'a str, source: &'a str) -> anyhow::Result<ParsedSource<'a>> {
    let mut parser = Parser::new();
    let tree_sitter_language = language_for(language)?;
    parser
        .set_language(&tree_sitter_language)
        .map_err(|error| anyhow!("failed to set parser language: {error}"))?;
    let tree = parser
        .parse(source, None)
        .ok_or_else(|| anyhow!("failed to parse source"))?;
    Ok(ParsedSource {
        language,
        source,
        tree,
    })
}

fn language_for(language: &str) -> anyhow::Result<Language> {
    match language {
        "rust" => Ok(tree_sitter_rust::LANGUAGE.into()),
        "python" => Ok(tree_sitter_python::LANGUAGE.into()),
        "javascript" => Ok(tree_sitter_javascript::LANGUAGE.into()),
        "typescript" => Ok(tree_sitter_typescript::LANGUAGE_TYPESCRIPT.into()),
        "go" => Ok(tree_sitter_go::LANGUAGE.into()),
        other => Err(anyhow!("unsupported language: {other}")),
    }
}

fn walk_tree(node: Node<'_>, visit: &mut impl FnMut(Node<'_>)) {
    visit(node);
    let mut cursor = node.walk();
    for child in node.named_children(&mut cursor) {
        walk_tree(child, visit);
    }
}

fn extract_symbol(parsed: &ParsedSource<'_>, node: Node<'_>) -> Option<AstSymbol> {
    let (kind, name_node) = extract_symbol_name_node(parsed, node)?;
    let name = node_text(parsed.source, name_node).ok()?;
    let start = name_node.start_position();
    Some(AstSymbol {
        name,
        kind: kind.to_string(),
        line: start.row + 1,
        preview: node_text(parsed.source, node)
            .ok()?
            .trim()
            .replace('\n', " "),
    })
}

/// 提取符号的 kind 和名称节点 — 供 extract_symbol 和 symbols_with_range 共用
///
/// 返回 (kind 字符串, name_node)，未命中符号定义时返回 None。
fn extract_symbol_name_node<'a>(
    parsed: &ParsedSource<'a>,
    node: Node<'a>,
) -> Option<(&'static str, Node<'a>)> {
    let kind = node.kind();
    match parsed.language {
        "rust" => match kind {
            "function_item" => node.child_by_field_name("name").map(|n| ("fn", n)),
            "struct_item" => node.child_by_field_name("name").map(|n| ("struct", n)),
            "enum_item" => node.child_by_field_name("name").map(|n| ("enum", n)),
            "trait_item" => node.child_by_field_name("name").map(|n| ("trait", n)),
            "mod_item" => node.child_by_field_name("name").map(|n| ("mod", n)),
            "type_item" => node.child_by_field_name("name").map(|n| ("type", n)),
            "impl_item" => node.child_by_field_name("type").map(|n| ("impl", n)),
            _ => None,
        },
        "python" => match kind {
            "function_definition" => node.child_by_field_name("name").map(|n| ("function", n)),
            "class_definition" => node.child_by_field_name("name").map(|n| ("class", n)),
            _ => None,
        },
        "javascript" | "typescript" => extract_js_symbol(node),
        "go" => match kind {
            "function_declaration" | "method_declaration" => {
                node.child_by_field_name("name").map(|n| ("function", n))
            }
            "type_declaration" => named_descendant_by_kind(node, &["type_spec"]).and_then(|spec| {
                spec.child_by_field_name("name")
                    .or_else(|| named_descendant_by_kind(spec, &["type_identifier"]))
                    .map(|n| ("type", n))
            }),
            "var_declaration" => named_descendant_by_kind(node, &["var_spec"]).and_then(|spec| {
                spec.child_by_field_name("name")
                    .or_else(|| named_descendant_by_kind(spec, &["identifier"]))
                    .map(|n| ("var", n))
            }),
            "const_declaration" => {
                named_descendant_by_kind(node, &["const_spec"]).and_then(|spec| {
                    spec.child_by_field_name("name")
                        .or_else(|| named_descendant_by_kind(spec, &["identifier"]))
                        .map(|n| ("const", n))
                })
            }
            _ => None,
        },
        _ => None,
    }
}

/// 判断节点是否为名称节点（identifier 等）— 供 find_references 使用
///
/// 不同语言的名称节点 kind 不同，此处统一判断。
fn is_name_node(node: Node<'_>, language: &str) -> bool {
    let kind = node.kind();
    match language {
        "rust" => matches!(kind, "identifier" | "type_identifier" | "field_identifier"),
        "python" => matches!(kind, "identifier"),
        "javascript" | "typescript" => matches!(kind, "identifier" | "type_identifier"),
        "go" => matches!(kind, "identifier" | "type_identifier"),
        _ => false,
    }
}

fn extract_js_symbol(node: Node<'_>) -> Option<(&'static str, Node<'_>)> {
    match node.kind() {
        "function_declaration" => node.child_by_field_name("name").map(|n| ("function", n)),
        "class_declaration" => node.child_by_field_name("name").map(|n| ("class", n)),
        "interface_declaration" => node.child_by_field_name("name").map(|n| ("interface", n)),
        "type_alias_declaration" => node.child_by_field_name("name").map(|n| ("type", n)),
        "enum_declaration" => node.child_by_field_name("name").map(|n| ("enum", n)),
        "lexical_declaration" | "variable_declaration" => {
            named_descendant_by_kind(node, &["variable_declarator"])
                .and_then(|decl| decl.child_by_field_name("name").map(|n| ("function", n)))
        }
        _ => None,
    }
}

fn extract_imports(parsed: &ParsedSource<'_>, node: Node<'_>) -> Vec<AstImport> {
    match parsed.language {
        "rust" => extract_rust_imports(parsed.source, node),
        "python" => extract_python_imports(parsed.source, node),
        "javascript" | "typescript" => extract_js_imports(parsed.source, node),
        "go" => extract_go_imports(parsed.source, node),
        _ => Vec::new(),
    }
}

fn extract_rust_imports(source: &str, node: Node<'_>) -> Vec<AstImport> {
    if !matches!(
        node.kind(),
        "use_declaration" | "use_as_clause" | "scoped_use_list"
    ) {
        return Vec::new();
    }
    if node.kind() != "use_declaration" {
        return Vec::new();
    }
    let Some(argument) = node.child_by_field_name("argument") else {
        return Vec::new();
    };
    vec![AstImport {
        specifier: node_text(source, argument)
            .unwrap_or_default()
            .trim()
            .to_string(),
        line: node.start_position().row + 1,
    }]
}

fn extract_python_imports(source: &str, node: Node<'_>) -> Vec<AstImport> {
    match node.kind() {
        "import_statement" => node
            .children(&mut node.walk())
            .filter(|child| child.kind() == "dotted_name" || child.kind() == "aliased_import")
            .filter_map(|child| {
                let target = if child.kind() == "aliased_import" {
                    child.child(0)
                } else {
                    Some(child)
                }?;
                Some(AstImport {
                    specifier: node_text(source, target).ok()?.trim().to_string(),
                    line: target.start_position().row + 1,
                })
            })
            .collect(),
        "import_from_statement" => {
            let mut items = Vec::new();
            let mut cursor = node.walk();
            for child in node.named_children(&mut cursor) {
                if child.kind() != "dotted_name" && child.kind() != "relative_import" {
                    continue;
                }
                if let Ok(specifier) = node_text(source, child) {
                    let specifier = specifier.trim().to_string();
                    if !specifier.is_empty() {
                        items.push(AstImport {
                            specifier,
                            line: child.start_position().row + 1,
                        });
                        break;
                    }
                }
            }
            items
        }
        _ => Vec::new(),
    }
}

fn extract_js_imports(source: &str, node: Node<'_>) -> Vec<AstImport> {
    match node.kind() {
        "import_statement" => node
            .child_by_field_name("source")
            .and_then(|source_node| to_import_from_string_literal(source, source_node))
            .into_iter()
            .collect(),
        "call_expression" => {
            let Some(function) = node.child_by_field_name("function") else {
                return Vec::new();
            };
            let Ok(function_name) = node_text(source, function) else {
                return Vec::new();
            };
            if function_name != "require" {
                return Vec::new();
            }
            named_descendant_by_kind(node, &["string", "string_fragment", "string_literal"])
                .and_then(|literal| to_import_from_string_literal(source, literal))
                .into_iter()
                .collect()
        }
        _ => Vec::new(),
    }
}

fn extract_go_imports(source: &str, node: Node<'_>) -> Vec<AstImport> {
    if node.kind() != "import_declaration" {
        return Vec::new();
    }
    // tree-sitter-go 的 import 结构有两种形态：
    //   单行：import_declaration -> import_spec -> interpreted_string_literal
    //   多行：import_declaration -> import_spec_list -> import_spec* -> interpreted_string_literal
    node.named_children(&mut node.walk())
        .filter(|child| {
            matches!(
                child.kind(),
                "import_spec" | "import_spec_list" | "interpreted_string_literal"
            )
        })
        .flat_map(|child| match child.kind() {
            "import_spec" => child
                .named_children(&mut child.walk())
                .filter_map(|inner| to_import_from_string_literal(source, inner))
                .collect::<Vec<_>>(),
            "import_spec_list" => child
                .named_children(&mut child.walk())
                .filter(|spec| spec.kind() == "import_spec")
                .flat_map(|spec| {
                    spec.named_children(&mut spec.walk())
                        .filter_map(|inner| to_import_from_string_literal(source, inner))
                        .collect::<Vec<_>>()
                })
                .collect(),
            _ => to_import_from_string_literal(source, child)
                .into_iter()
                .collect(),
        })
        .collect()
}

fn to_import_from_string_literal(source: &str, node: Node<'_>) -> Option<AstImport> {
    let kind = node.kind();
    if !matches!(
        kind,
        "string" | "string_fragment" | "string_literal" | "interpreted_string_literal"
    ) {
        return None;
    }
    let raw = node_text(source, node).ok()?;
    let specifier = raw.trim().trim_matches(['"', '\'', '`']).to_string();
    if specifier.is_empty() {
        return None;
    }
    Some(AstImport {
        specifier,
        line: node.start_position().row + 1,
    })
}

fn to_node_record(parsed: &ParsedSource<'_>, node: Node<'_>) -> AstNodeRecord {
    let start = node.start_position();
    let end = node.end_position();
    AstNodeRecord {
        kind: node.kind().to_string(),
        start_line: start.row + 1,
        start_column: start.column + 1,
        end_line: end.row + 1,
        end_column: end.column + 1,
        text: node_text(parsed.source, node)
            .unwrap_or_default()
            .trim()
            .replace('\n', " "),
    }
}

fn node_text(source: &str, node: Node<'_>) -> anyhow::Result<String> {
    node.utf8_text(source.as_bytes())
        .map(|text| text.to_string())
        .with_context(|| format!("failed to read node text for kind {}", node.kind()))
}

fn named_descendant_by_kind<'a>(node: Node<'a>, kinds: &[&str]) -> Option<Node<'a>> {
    let mut cursor = node.walk();
    for child in node.named_children(&mut cursor) {
        if kinds.contains(&child.kind()) {
            return Some(child);
        }
        if let Some(descendant) = named_descendant_by_kind(child, kinds) {
            return Some(descendant);
        }
    }
    None
}
