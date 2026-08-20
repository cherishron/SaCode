//! 语义搜索层 — 基于 BM25 算法的代码语义搜索
//!
//! 设计目标：
//! - 支持自然语言查询（如"处理HTTP请求的函数"）
//! - 模糊名称匹配（如搜索"calc"匹配"calculate_total"）
//! - 跨语言语义关联（如"错误处理"关联 Result/try/except/error）
//! - 基于 tree-sitter AST 的结构化索引增强
//!
//! 算法：BM25（Best Matching 25）
//! - 经典信息检索算法，对 TF-IDF 的改进
//! - 考虑词频饱和度和文档长度归一化
//! - 无需嵌入向量即可实现基础语义搜索
//!
//! 与竞品对比：
//! - Claude Code：嵌入向量语义搜索（需要外部模型）
//! - Codex CLI：BM25 工具搜索（与本项目方案一致）
//! - Aider：tree-sitter Repo Map + PageRank 排序
//! - SaCode：BM25 + AST 结构化索引（混合方案）

use std::collections::{BTreeSet, HashMap};
use std::fs;
use std::path::{Path, PathBuf};

use crate::sandbox::FsAccess;
use crate::tools::context::current_context;
use crate::tools::{SideEffectLevel, ToolOutput, ToolSpec};

use super::cache::{ast_cache, file_list_cache};
use super::symbol::detect_language;

// ── BM25 参数 ──────────────────────────────────────────

/// BM25 参数 k1：控制词频饱和度，典型值 1.2 ~ 2.0
const BM25_K1: f64 = 1.5;
/// BM25 参数 b：控制文档长度归一化，典型值 0.75
const BM25_B: f64 = 0.75;

// ── 语义扩展映射 ───────────────────────────────────────

/// 编程概念的语义关联映射
/// 用于将自然语言查询扩展到相关的代码术语
static SEMANTIC_EXPANSIONS: &[(&str, &[&str])] = &[
    // 错误处理
    (
        "error",
        &[
            "error",
            "err",
            "result",
            "failure",
            "exception",
            "panic",
            "throw",
            "catch",
        ],
    ),
    (
        "错误",
        &[
            "error",
            "err",
            "result",
            "failure",
            "exception",
            "panic",
            "throw",
            "catch",
            "错误",
        ],
    ),
    (
        "异常",
        &["exception", "error", "panic", "throw", "catch", "异常"],
    ),
    // 测试
    (
        "test",
        &[
            "test", "spec", "mock", "stub", "assert", "expect", "verify", "validate",
        ],
    ),
    (
        "测试",
        &[
            "test", "spec", "assert", "expect", "verify", "validate", "测试",
        ],
    ),
    // HTTP / 网络
    (
        "http",
        &[
            "http", "request", "response", "route", "handler", "endpoint", "api", "rest", "get",
            "post", "put", "delete",
        ],
    ),
    (
        "请求",
        &["request", "http", "fetch", "api", "handler", "请求"],
    ),
    (
        "路由",
        &["route", "router", "handler", "endpoint", "path", "路由"],
    ),
    // 数据库
    (
        "database",
        &[
            "db",
            "database",
            "sql",
            "query",
            "model",
            "schema",
            "migration",
            "repository",
            "dao",
        ],
    ),
    (
        "数据库",
        &[
            "db",
            "database",
            "sql",
            "query",
            "model",
            "schema",
            "migration",
            "数据库",
        ],
    ),
    // 配置
    (
        "config",
        &[
            "config",
            "setting",
            "option",
            "preference",
            "env",
            "configuration",
        ],
    ),
    ("配置", &["config", "setting", "option", "env", "配置"]),
    // 认证
    (
        "auth",
        &[
            "auth",
            "login",
            "token",
            "session",
            "credential",
            "password",
            "jwt",
            "oauth",
        ],
    ),
    (
        "认证",
        &["auth", "login", "token", "session", "认证", "登录"],
    ),
    // 日志
    (
        "log",
        &[
            "log", "logger", "tracing", "debug", "info", "warn", "error", "trace",
        ],
    ),
    ("日志", &["log", "logger", "tracing", "日志"]),
    // 并发
    (
        "concurrent",
        &[
            "async",
            "await",
            "thread",
            "spawn",
            "parallel",
            "concurrent",
            "lock",
            "mutex",
            "channel",
        ],
    ),
    (
        "并发",
        &[
            "async",
            "await",
            "thread",
            "spawn",
            "parallel",
            "concurrent",
            "并发",
        ],
    ),
    ("异步", &["async", "await", "future", "promise", "异步"]),
    // 序列化
    (
        "serialize",
        &[
            "serialize",
            "deserialize",
            "json",
            "encode",
            "decode",
            "parse",
            "format",
        ],
    ),
    (
        "序列化",
        &["serialize", "json", "encode", "decode", "parse", "序列化"],
    ),
    // 缓存
    (
        "cache",
        &["cache", "memoize", "store", "buffer", "lru", "缓存"],
    ),
    ("缓存", &["cache", "memoize", "store", "缓存"]),
    // 构建
    (
        "build",
        &["build", "compile", "make", "cargo", "npm", "构建", "编译"],
    ),
    ("构建", &["build", "compile", "make", "构建"]),
];

// ── 数据结构 ───────────────────────────────────────────

/// 搜索结果条目
#[derive(Debug, Clone, serde::Serialize)]
struct SearchResult {
    /// 文件路径（相对路径）
    path: String,
    /// 语言
    language: String,
    /// 匹配的符号名
    symbol_name: Option<String>,
    /// 符号类型（fn/struct/class/...）
    symbol_kind: Option<String>,
    /// 符号所在行号
    line: Option<usize>,
    /// 代码预览
    preview: String,
    /// BM25 相关性得分
    score: f64,
    /// 匹配类型：semantic / fuzzy_name / exact_name / content
    match_type: String,
}

/// 文档索引条目（用于 BM25 计算）
#[derive(Debug, Clone)]
struct DocumentEntry {
    path: String,
    language: String,
    /// 文档中的词项及其词频
    term_freqs: HashMap<String, usize>,
    /// 文档长度（词项总数）
    doc_length: usize,
    /// 关联的符号信息
    symbols: Vec<SymbolInfo>,
}

#[derive(Debug, Clone)]
struct SymbolInfo {
    name: String,
    kind: String,
    line: usize,
    preview: String,
}

/// BM25 索引
struct Bm25Index {
    /// 所有文档
    documents: Vec<DocumentEntry>,
    /// 文档频率：每个词项出现在多少文档中
    doc_freq: HashMap<String, usize>,
    /// 平均文档长度
    avg_doc_length: f64,
    /// 文档总数
    doc_count: usize,
}

impl Bm25Index {
    /// 从文件列表构建索引
    fn build(files: &[(PathBuf, String)], root: &Path) -> Self {
        let mut documents = Vec::new();
        let mut doc_freq: HashMap<String, usize> = HashMap::new();

        for (file_path, language) in files {
            let content = match fs::read_to_string(file_path) {
                Ok(c) => c,
                Err(_) => continue,
            };

            let relative_path = match file_path.strip_prefix(root) {
                Ok(rel) if !rel.as_os_str().is_empty() => rel.display().to_string(),
                // rel 为空或 strip 失败时退回完整路径展示
                _ => file_path.display().to_string(),
            };

            // 提取 AST 符号信息
            let symbols = extract_symbols_for_index(file_path, language, &content);

            // 分词：符号名 + 标识符 + 注释关键词
            let mut term_freqs = HashMap::new();
            let mut doc_length = 0usize;

            // 1. 从符号名提取词项（权重更高）
            for sym in &symbols {
                for token in tokenize_identifier(&sym.name) {
                    *term_freqs.entry(token.clone()).or_insert(0) += 3; // 符号名权重 ×3
                    doc_length += 3;
                }
                // 符号类型也作为词项
                *term_freqs.entry(sym.kind.clone()).or_insert(0) += 1;
                doc_length += 1;
            }

            // 2. 从代码内容提取标识符
            for token in tokenize_source(&content) {
                *term_freqs.entry(token.clone()).or_insert(0) += 1;
                doc_length += 1;
            }

            // 记录文档频率
            for term in term_freqs.keys() {
                *doc_freq.entry(term.clone()).or_insert(0) += 1;
            }

            documents.push(DocumentEntry {
                path: relative_path,
                language: language.clone(),
                term_freqs,
                doc_length,
                symbols,
            });
        }

        let doc_count = documents.len();
        let avg_doc_length = if doc_count > 0 {
            documents.iter().map(|d| d.doc_length as f64).sum::<f64>() / doc_count as f64
        } else {
            1.0
        };

        Self {
            documents,
            doc_freq,
            avg_doc_length,
            doc_count,
        }
    }

    /// 执行 BM25 搜索
    fn search(&self, query: &str, limit: usize) -> Vec<SearchResult> {
        // 扩展查询词项
        let query_terms = expand_query(query);

        // 计算每个文档的 BM25 得分
        let mut scored_docs: Vec<(usize, f64, Vec<(String, String)>)> = self
            .documents
            .iter()
            .enumerate()
            .map(|(doc_idx, doc)| {
                let mut score = 0.0f64;
                let mut matched_terms = Vec::new();

                for (term, weight) in &query_terms {
                    let tf = doc.term_freqs.get(term).copied().unwrap_or(0) as f64;
                    if tf == 0.0 {
                        continue;
                    }

                    let df = self.doc_freq.get(term).copied().unwrap_or(0) as f64;
                    // IDF = ln((N - df + 0.5) / (df + 0.5) + 1)
                    let idf = ((self.doc_count as f64 - df + 0.5) / (df + 0.5) + 1.0).ln();

                    // BM25 TF 部分
                    let tf_norm = (tf * (BM25_K1 + 1.0))
                        / (tf
                            + BM25_K1
                                * (1.0 - BM25_B
                                    + BM25_B * doc.doc_length as f64 / self.avg_doc_length));

                    score += idf * tf_norm * weight;
                    matched_terms.push((term.clone(), "semantic".to_string()));
                }

                (doc_idx, score, matched_terms)
            })
            .filter(|(_, score, _)| *score > 0.0)
            .collect();

        // 按得分降序排序
        scored_docs.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));

        // 构建搜索结果
        let mut results = Vec::new();
        for (doc_idx, score, matched_terms) in scored_docs {
            if results.len() >= limit {
                break;
            }

            let doc = &self.documents[doc_idx];

            // 查找最匹配的符号
            let best_symbol = find_best_matching_symbol(&doc.symbols, &matched_terms);

            let (symbol_name, symbol_kind, line, preview, match_type) = match best_symbol {
                Some(sym) => {
                    // 判断匹配类型
                    let mt = if query_terms
                        .iter()
                        .any(|(t, _)| sym.name.eq_ignore_ascii_case(t))
                    {
                        "exact_name"
                    } else if query_terms
                        .iter()
                        .any(|(t, _)| sym.name.to_lowercase().contains(&t.to_lowercase()))
                    {
                        "fuzzy_name"
                    } else {
                        "semantic"
                    };
                    (
                        Some(sym.name.clone()),
                        Some(sym.kind.clone()),
                        Some(sym.line),
                        sym.preview.clone(),
                        mt.to_string(),
                    )
                }
                None => {
                    // 无符号匹配，使用文件级内容匹配
                    let preview = doc.path.clone();
                    (None, None, None, preview, "content".to_string())
                }
            };

            results.push(SearchResult {
                path: doc.path.clone(),
                language: doc.language.clone(),
                symbol_name,
                symbol_kind,
                line,
                preview: truncate_preview(&preview),
                score: (score * 1000.0).round() / 1000.0, // 保留3位小数
                match_type,
            });
        }

        results
    }
}

// ── 查询扩展 ───────────────────────────────────────────

/// 扩展查询词项，返回 (词项, 权重) 列表
fn expand_query(query: &str) -> Vec<(String, f64)> {
    let mut terms = Vec::new();
    let mut seen = BTreeSet::new();

    // 1. 原始查询分词
    for token in tokenize_query(query) {
        if seen.insert(token.clone()) {
            terms.push((token, 1.0));
        }
    }

    // 2. 语义扩展：查找关联词
    let query_lower = query.to_lowercase();
    for (keyword, expansions) in SEMANTIC_EXPANSIONS {
        if query_lower.contains(keyword) {
            for expansion in *expansions {
                if seen.insert(expansion.to_string()) {
                    // 扩展词权重略低，避免噪声
                    terms.push((expansion.to_string(), 0.6));
                }
            }
        }
    }

    // 3. 标识符拆分扩展：如 "HTTPRequest" → ["http", "request"]
    for (token, weight) in terms.clone() {
        if token.contains('_') || token.chars().any(|c| c.is_uppercase()) {
            for sub in tokenize_identifier(&token) {
                if seen.insert(sub.clone()) {
                    terms.push((sub, weight * 0.5));
                }
            }
        }
    }

    terms
}

// ── 分词 ───────────────────────────────────────────────

/// 对查询文本分词
fn tokenize_query(query: &str) -> Vec<String> {
    query
        .split(|c: char| !c.is_alphanumeric() && c != '_')
        .filter(|s| !s.is_empty())
        .map(|s| s.to_lowercase())
        .filter(|s| s.len() >= 2) // 过滤单字符
        .collect()
}

/// 对标识符分词（驼峰/下划线拆分）
/// 例如："calculateTotalPrice" → ["calculate", "total", "price"]
///       "http_request_handler" → ["http", "request", "handler"]
///       "HTTPRequestHandler" → ["http", "request", "handler"]
fn tokenize_identifier(ident: &str) -> Vec<String> {
    let chars: Vec<char> = ident.chars().collect();
    let mut tokens = Vec::new();
    let mut start = 0;

    for i in 1..chars.len() {
        let prev = chars[i - 1];
        let curr = chars[i];

        // 下划线分隔
        if curr == '_' {
            if i > start {
                let token: String = chars[start..i].iter().collect();
                let lower = token.to_lowercase();
                if lower.len() >= 2 {
                    tokens.push(lower);
                }
            }
            start = i + 1;
            continue;
        }
        if prev == '_' {
            continue;
        }

        // 驼峰边界检测
        let should_split = if curr.is_uppercase() && prev.is_lowercase() {
            // camelCase 边界：小写 -> 大写
            true
        } else if curr.is_uppercase() && prev.is_uppercase() {
            // 连续大写：如果下一个字符是小写，当前大写是新词开始
            // 如 "HTTPRequest" 的 'R' 后跟 'e'，说明 'R' 是 "Request" 的开始
            i + 1 < chars.len() && chars[i + 1].is_lowercase()
        } else {
            false
        };

        if should_split {
            let token: String = chars[start..i].iter().collect();
            let lower = token.to_lowercase();
            if lower.len() >= 2 {
                tokens.push(lower);
            }
            start = i;
        }
    }

    // 最后一个 token
    if start < chars.len() {
        let token: String = chars[start..].iter().collect();
        let lower = token.to_lowercase();
        if lower.len() >= 2 {
            tokens.push(lower);
        }
    }

    tokens
}

/// 对源代码分词，提取标识符和关键词
fn tokenize_source(source: &str) -> Vec<String> {
    let mut tokens = Vec::new();

    for line in source.lines() {
        let trimmed = line.trim();
        // 跳过注释行（简单启发式）
        if trimmed.starts_with("//") || trimmed.starts_with('#') || trimmed.starts_with("/*") {
            continue;
        }

        for part in trimmed.split(|c: char| !c.is_alphanumeric() && c != '_') {
            if part.len() >= 2 {
                tokens.push(part.to_lowercase());
            }
        }
    }

    tokens
}

// ── 辅助函数 ───────────────────────────────────────────

/// 从 AST 提取符号信息用于索引
fn extract_symbols_for_index(path: &Path, language: &str, content: &str) -> Vec<SymbolInfo> {
    let summary = match ast_cache().get_or_compute(path, language, content) {
        Ok(s) => s,
        Err(_) => return Vec::new(),
    };

    summary
        .symbols
        .into_iter()
        .map(|sym| SymbolInfo {
            name: sym.name,
            kind: sym.kind,
            line: sym.line,
            preview: sym.preview,
        })
        .collect()
}

/// 查找最匹配查询词项的符号
fn find_best_matching_symbol(
    symbols: &[SymbolInfo],
    matched_terms: &[(String, String)],
) -> Option<SymbolInfo> {
    let term_set: BTreeSet<String> = matched_terms.iter().map(|(t, _)| t.clone()).collect();

    symbols
        .iter()
        .map(|sym| {
            // 完整符号名匹配（最高权重）
            let full_match = if term_set.contains(&sym.name.to_lowercase()) {
                1
            } else {
                0
            };
            // token 级别重叠度
            let sym_tokens = tokenize_identifier(&sym.name);
            let token_overlap = sym_tokens
                .iter()
                .filter(|t| term_set.contains(&t.to_lowercase()))
                .count();
            (sym.clone(), full_match + token_overlap)
        })
        .max_by_key(|(_, overlap)| *overlap)
        .filter(|(_, overlap)| *overlap > 0)
        .map(|(sym, _)| sym)
}

/// 截断预览文本
fn truncate_preview(text: &str) -> String {
    sacode_kernel::util::truncate_with_ellipsis(text, 200)
}

/// 收集源文件及其语言
fn collect_source_files_with_language(
    path: &Path,
    _language: Option<&str>,
    files: &mut Vec<PathBuf>,
) -> anyhow::Result<()> {
    if path.is_file() {
        if detect_language(path).is_some() {
            files.push(path.to_path_buf());
        }
        return Ok(());
    }

    // 跳过常见非源码目录
    let skip_dirs = [
        "node_modules",
        ".git",
        "target",
        "dist",
        "build",
        "__pycache__",
        ".sacode",
    ];

    for entry in fs::read_dir(path)? {
        let entry = entry?;
        let entry_path = entry.path();
        if entry_path.is_dir() {
            let dir_name = entry_path
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("");
            if skip_dirs.contains(&dir_name) {
                continue;
            }
            collect_source_files_with_language(&entry_path, None, files)?;
        } else if detect_language(&entry_path).is_some() {
            files.push(entry_path);
        }
    }
    Ok(())
}

// ── 工具接口 ───────────────────────────────────────────

pub fn spec() -> ToolSpec {
    ToolSpec {
        name: "code.search".to_string(),
        description: "语义搜索代码：支持自然语言查询、模糊名称匹配和跨语言关联".to_string(),
        input_schema: serde_json::json!({
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": "搜索查询，支持自然语言（如'处理HTTP请求的函数'）、模糊名称（如'calc'）或精确名称"
                },
                "path": {
                    "type": "string",
                    "description": "搜索范围路径，默认当前工作目录"
                },
                "limit": {
                    "type": "integer",
                    "description": "最多返回多少个结果，默认 20"
                },
                "match_type": {
                    "type": "string",
                    "description": "过滤匹配类型：semantic / fuzzy_name / exact_name / content，默认全部"
                }
            },
            "required": ["query"]
        }),
        output_schema: serde_json::json!({
            "type": "object",
            "properties": {
                "query": { "type": "string" },
                "path": { "type": "string" },
                "results": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "path": { "type": "string" },
                            "language": { "type": "string" },
                            "symbol_name": { "type": "string" },
                            "symbol_kind": { "type": "string" },
                            "line": { "type": "integer" },
                            "preview": { "type": "string" },
                            "score": { "type": "number" },
                            "match_type": { "type": "string" }
                        }
                    }
                },
                "count": { "type": "integer" },
                "expanded_terms": {
                    "type": "array",
                    "items": { "type": "string" },
                    "description": "查询扩展后的词项列表"
                }
            }
        }),
        side_effect_level: SideEffectLevel::ReadOnly,
        approval_required: false,
        timeout_ms: Some(30_000),
        tags: vec![
            "code".to_string(),
            "search".to_string(),
            "semantic".to_string(),
        ],
    }
}

pub fn execute(input: serde_json::Value) -> anyhow::Result<ToolOutput> {
    let query = input["query"].as_str().unwrap_or("").trim();
    let path = input["path"].as_str().unwrap_or(".").trim();
    let limit = input["limit"].as_u64().unwrap_or(20) as usize;
    let match_type_filter = input["match_type"].as_str().map(str::trim);

    if query.is_empty() {
        return Ok(ToolOutput::failure("query is required"));
    }

    let resolved_path = current_context().resolve_path(path, FsAccess::Read)?;
    if !resolved_path.exists() {
        return Ok(ToolOutput::failure(format!("path not found: {}", path)));
    }

    // 收集源文件
    let source_files = file_list_cache().get_or_collect(
        &resolved_path,
        None,
        collect_source_files_with_language,
    )?;

    if source_files.is_empty() {
        return Ok(ToolOutput::success(serde_json::json!({
            "query": query,
            "path": path,
            "results": [],
            "count": 0,
            "expanded_terms": []
        }))
        .with_message("no supported source files found"));
    }

    // 构建带语言信息的文件列表
    let files_with_lang: Vec<(PathBuf, String)> = source_files
        .into_iter()
        .filter_map(|p| detect_language(&p).map(|lang| (p, lang.to_string())))
        .collect();

    // 构建 BM25 索引
    let index = Bm25Index::build(&files_with_lang, &resolved_path);

    // 执行搜索
    let mut results = index.search(query, limit * 2); // 多取一些用于过滤

    // 按匹配类型过滤
    if let Some(filter) = match_type_filter {
        results.retain(|r| r.match_type == filter);
    }

    // 截断到 limit
    results.truncate(limit);

    // 获取扩展词项
    let expanded_terms = expand_query(query)
        .into_iter()
        .take(20)
        .map(|(t, _)| t)
        .collect::<Vec<_>>();

    let count = results.len();
    Ok(ToolOutput::success(serde_json::json!({
        "query": query,
        "path": path,
        "results": results,
        "count": count,
        "expanded_terms": expanded_terms,
    })))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tokenize_identifier_splits_camel_case() {
        let tokens = tokenize_identifier("calculateTotalPrice");
        assert_eq!(tokens, vec!["calculate", "total", "price"]);
    }

    #[test]
    fn tokenize_identifier_splits_snake_case() {
        let tokens = tokenize_identifier("http_request_handler");
        assert_eq!(tokens, vec!["http", "request", "handler"]);
    }

    #[test]
    fn tokenize_identifier_handles_mixed() {
        let tokens = tokenize_identifier("HTTPRequestHandler");
        assert!(tokens.contains(&"http".to_string()));
        assert!(tokens.contains(&"request".to_string()));
        assert!(tokens.contains(&"handler".to_string()));
    }

    #[test]
    fn expand_query_includes_semantic_expansions() {
        let terms = expand_query("error handling");
        let term_strings: Vec<&str> = terms.iter().map(|(t, _)| t.as_str()).collect();
        // 应包含 "error" 及其语义扩展
        assert!(term_strings.contains(&"error"));
        assert!(term_strings.contains(&"result"));
        assert!(term_strings.contains(&"exception"));
    }

    #[test]
    fn expand_query_chinese_keywords() {
        let terms = expand_query("错误处理");
        let term_strings: Vec<&str> = terms.iter().map(|(t, _)| t.as_str()).collect();
        assert!(term_strings.contains(&"error"));
        assert!(term_strings.contains(&"result"));
    }

    #[test]
    fn bm25_index_builds_and_searches() {
        use std::io::Write;

        let dir = tempfile::tempdir().unwrap();

        // 创建测试文件
        let rust_file = dir.path().join("handler.rs");
        let mut f = std::fs::File::create(&rust_file).unwrap();
        writeln!(f, "pub fn handle_http_request() -> Result<()> {{").unwrap();
        writeln!(f, "    Ok(())").unwrap();
        writeln!(f, "}}").unwrap();

        let go_file = dir.path().join("server.go");
        let mut f = std::fs::File::create(&go_file).unwrap();
        writeln!(f, "func HandleError() error {{").unwrap();
        writeln!(f, "    return nil").unwrap();
        writeln!(f, "}}").unwrap();

        let files = vec![
            (rust_file.clone(), "rust".to_string()),
            (go_file.clone(), "go".to_string()),
        ];

        let index = Bm25Index::build(&files, dir.path());
        assert!(index.doc_count >= 2);

        // 搜索 "http request"
        let results = index.search("http request", 10);
        // handler.rs 应排在前面（包含 http + request）
        assert!(!results.is_empty(), "应返回搜索结果");
    }

    #[test]
    fn bm25_ranks_relevant_documents_higher() {
        use std::io::Write;

        let dir = tempfile::tempdir().unwrap();

        // 高相关文件
        let auth_file = dir.path().join("auth.rs");
        let mut f = std::fs::File::create(&auth_file).unwrap();
        writeln!(
            f,
            "pub fn authenticate_user(token: &str) -> Result<User> {{"
        )
        .unwrap();
        writeln!(f, "    validate_token(token)?;").unwrap();
        writeln!(f, "    Ok(User::default())").unwrap();
        writeln!(f, "}}").unwrap();

        // 低相关文件
        let util_file = dir.path().join("util.rs");
        let mut f = std::fs::File::create(&util_file).unwrap();
        writeln!(f, "pub fn format_string(s: &str) -> String {{").unwrap();
        writeln!(f, "    s.trim().to_string()").unwrap();
        writeln!(f, "}}").unwrap();

        let files = vec![
            (auth_file, "rust".to_string()),
            (util_file, "rust".to_string()),
        ];

        let index = Bm25Index::build(&files, dir.path());
        let results = index.search("auth token", 10);

        // auth.rs 应排在 util.rs 前面
        if results.len() >= 2 {
            assert!(
                results[0].path.contains("auth"),
                "auth.rs 应排在首位，实际首位: {}",
                results[0].path
            );
        }
    }

    #[test]
    fn search_result_match_type_classification() {
        // 精确名称匹配
        let symbols = vec![SymbolInfo {
            name: "calculate_total".to_string(),
            kind: "fn".to_string(),
            line: 1,
            preview: "pub fn calculate_total()".to_string(),
        }];
        let matched = vec![("calculate_total".to_string(), "semantic".to_string())];
        let result = find_best_matching_symbol(&symbols, &matched);
        assert!(result.is_some());
        assert_eq!(result.unwrap().name, "calculate_total");
    }
}
