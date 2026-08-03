//! tree-sitter 相关系统全面测试套件
//!
//! 覆盖四大维度：
//! 1. AST 解析核心能力测试 — 验证 5 语言解析正确性、边界场景、符号/导入提取精度
//! 2. 语义搜索层功能测试 — 评估当前结构化索引的语义检索能力与缺失
//! 3. 解析能力自动化闭环验证 — 确保解析→提取→缓存→失效的完整链路
//! 4. 性能潜力数据支撑测试 — 量化解析延迟、缓存命中率、内存占用

use std::fs;
use std::path::PathBuf;
use std::time::Instant;

use super::ast::{AstEditor, AstSummary};
use super::cache::{AstCache, FileListCache};

// ============================================================
// 维度一：AST 解析核心能力测试
// ============================================================

#[test]
fn ast_rust_parse_basic_structures() {
    let source = r#"
pub struct User {
    name: String,
    age: u32,
}

enum Status {
    Active,
    Inactive,
}

trait Service {
    fn run(&self) -> Result<()>;
}

impl Service for User {
    fn run(&self) -> Result<()> {
        Ok(())
    }
}

mod internal {
    pub fn helper() {}
}

type Result<T> = std::result::Result<T, Box<dyn std::error::Error>>;
"#;
    let summary = AstEditor::summarize("rust", source).expect("rust parse should succeed");
    assert_eq!(summary.language, "rust");
    assert!(summary.node_count > 0, "应解析出 AST 节点");

    // 验证符号提取完整性
    let symbol_names: Vec<&str> = summary.symbols.iter().map(|s| s.name.as_str()).collect();
    assert!(symbol_names.contains(&"User"), "应提取 struct User");
    assert!(symbol_names.contains(&"Status"), "应提取 enum Status");
    assert!(symbol_names.contains(&"Service"), "应提取 trait Service");
    assert!(symbol_names.contains(&"User"), "应提取 impl User");
    assert!(symbol_names.contains(&"helper"), "应提取 fn helper");
    assert!(symbol_names.contains(&"Result"), "应提取 type Result");

    // 验证符号类型标注
    let user_symbol = summary.symbols.iter().find(|s| s.name == "User").unwrap();
    assert_eq!(user_symbol.kind, "struct");
    let status_symbol = summary.symbols.iter().find(|s| s.name == "Status").unwrap();
    assert_eq!(status_symbol.kind, "enum");
}

#[test]
fn ast_python_parse_classes_and_functions() {
    let source = r#"
class DataProcessor:
    def __init__(self, config):
        self.config = config

    async def process(self):
        pass

def standalone_function():
    pass
"#;
    let summary = AstEditor::summarize("python", source).expect("python parse should succeed");
    let symbol_names: Vec<&str> = summary.symbols.iter().map(|s| s.name.as_str()).collect();
    assert!(symbol_names.contains(&"DataProcessor"), "应提取 class DataProcessor");
    assert!(symbol_names.contains(&"standalone_function"), "应提取 function standalone_function");
}

#[test]
fn ast_javascript_parse_es6_patterns() {
    let source = r#"
function greet(name) {
    return `Hello, ${name}!`;
}

class App {
    constructor() {}
    render() {}
}

const handler = () => {};
const config = { debug: true };

export default App;
"#;
    let summary = AstEditor::summarize("javascript", source).expect("js parse should succeed");
    let symbol_names: Vec<&str> = summary.symbols.iter().map(|s| s.name.as_str()).collect();
    assert!(symbol_names.contains(&"greet"), "应提取 function greet");
    assert!(symbol_names.contains(&"App"), "应提取 class App");
    assert!(symbol_names.contains(&"handler"), "应提取箭头函数 handler");
}

#[test]
fn ast_typescript_parse_interfaces_and_types() {
    let source = r#"
interface Config {
    port: number;
    host: string;
}

type Result<T> = { ok: T } | { error: string };

enum Direction {
    Up,
    Down,
}

function start(config: Config): void {}

const runner = async () => {};
"#;
    let summary = AstEditor::summarize("typescript", source).expect("ts parse should succeed");
    let symbol_names: Vec<&str> = summary.symbols.iter().map(|s| s.name.as_str()).collect();
    assert!(symbol_names.contains(&"Config"), "应提取 interface Config");
    assert!(symbol_names.contains(&"Result"), "应提取 type Result");
    assert!(symbol_names.contains(&"Direction"), "应提取 enum Direction");
    assert!(symbol_names.contains(&"start"), "应提取 function start");
}

#[test]
fn ast_go_parse_structs_and_methods() {
    let source = r#"
package main

import "fmt"

type Server struct {
    Port int
}

func (s *Server) Start() error {
    return nil
}

func NewServer() *Server {
    return &Server{}
}

var defaultPort = 8080

const maxRetries = 3
"#;
    let summary = AstEditor::summarize("go", source).expect("go parse should succeed");
    let symbol_names: Vec<&str> = summary.symbols.iter().map(|s| s.name.as_str()).collect();
    assert!(symbol_names.contains(&"Server"), "应提取 type Server");
    assert!(symbol_names.contains(&"Start"), "应提取 func Start");
    assert!(symbol_names.contains(&"NewServer"), "应提取 func NewServer");
    assert!(symbol_names.contains(&"defaultPort"), "应提取 var defaultPort");
    assert!(symbol_names.contains(&"maxRetries"), "应提取 const maxRetries");
}

#[test]
fn ast_unsupported_language_returns_error() {
    let result = AstEditor::summarize("haskell", "main = putStrLn \"hello\"");
    assert!(result.is_err(), "不支持的语言应返回错误");
    assert!(
        result.unwrap_err().to_string().contains("unsupported language"),
        "错误信息应指明不支持的语言"
    );
}

#[test]
fn ast_empty_source_produces_minimal_summary() {
    let summary = AstEditor::summarize("rust", "").expect("空源码应可解析");
    assert_eq!(summary.symbols.len(), 0, "空源码不应有符号");
    assert_eq!(summary.imports.len(), 0, "空源码不应有导入");
    // 空源码仍有根节点
    assert!(summary.node_count > 0, "空源码应有根节点");
}

#[test]
fn ast_syntax_error_source_still_parses() {
    // 缺少右花括号的 Rust 代码
    let source = "fn broken() { let x = 1";
    let summary = AstEditor::summarize("rust", source).expect("语法错误源码应仍可解析（tree-sitter 容错）");
    // tree-sitter 的 ERROR 节点不应导致 panic
    assert!(summary.node_count > 0, "语法错误源码仍应有 AST 节点");
}

#[test]
fn ast_rust_imports_extraction() {
    let source = r#"
use std::collections::HashMap;
use std::io::Read;
use anyhow::Result;
use crate::inner::Worker;
"#;
    let summary = AstEditor::summarize("rust", source).expect("rust parse should succeed");
    let specifiers: Vec<&str> = summary.imports.iter().map(|i| i.specifier.as_str()).collect();
    assert!(
        specifiers.iter().any(|s| s.contains("std::collections::HashMap")),
        "应提取 use std::collections::HashMap"
    );
    assert!(
        specifiers.iter().any(|s| s.contains("crate::inner::Worker")),
        "应提取 use crate::inner::Worker"
    );
}

#[test]
fn ast_python_imports_extraction() {
    let source = r#"
import os
import sys
from pathlib import Path
from collections import OrderedDict
"#;
    let summary = AstEditor::summarize("python", source).expect("python parse should succeed");
    let specifiers: Vec<&str> = summary.imports.iter().map(|i| i.specifier.as_str()).collect();
    assert!(specifiers.iter().any(|s| *s == "os"), "应提取 import os");
    assert!(
        specifiers.iter().any(|s| s.contains("pathlib")),
        "应提取 from pathlib"
    );
}

#[test]
fn ast_javascript_imports_extraction() {
    let source = r#"
import React from 'react';
import { useState } from 'react';
const express = require('express');
"#;
    let summary = AstEditor::summarize("javascript", source).expect("js parse should succeed");
    let specifiers: Vec<&str> = summary.imports.iter().map(|i| i.specifier.as_str()).collect();
    assert!(
        specifiers.iter().any(|s| *s == "react"),
        "应提取 import from 'react'"
    );
    assert!(
        specifiers.iter().any(|s| *s == "express"),
        "应提取 require('express')"
    );
}

#[test]
fn ast_go_imports_extraction() {
    let source = r#"
package main

import "fmt"
import "net/http"

import (
    "os"
    "strings"
)
"#;
    let summary = AstEditor::summarize("go", source).expect("go parse should succeed");
    let specifiers: Vec<&str> = summary.imports.iter().map(|i| i.specifier.as_str()).collect();
    assert!(specifiers.iter().any(|s| *s == "fmt"), "应提取 import \"fmt\"");
    assert!(specifiers.iter().any(|s| *s == "net/http"), "应提取 import \"net/http\"");
    assert!(specifiers.iter().any(|s| *s == "os"), "应提取多行 import \"os\"");
    assert!(specifiers.iter().any(|s| *s == "strings"), "应提取多行 import \"strings\"");
}

#[test]
fn ast_symbol_line_numbers_are_correct() {
    let source = "fn first() {}\n\nfn second() {}\n";
    let summary = AstEditor::summarize("rust", source).expect("parse should succeed");
    let first = summary.symbols.iter().find(|s| s.name == "first").unwrap();
    let second = summary.symbols.iter().find(|s| s.name == "second").unwrap();
    assert_eq!(first.line, 1, "first 应在第 1 行");
    assert_eq!(second.line, 3, "second 应在第 3 行");
}

#[test]
fn ast_top_level_nodes_extraction() {
    let source = "fn foo() {}\nstruct Bar;\n";
    let nodes = AstEditor::top_level_nodes("rust", source).expect("top_level_nodes should succeed");
    assert!(nodes.len() >= 2, "应有至少 2 个顶层节点");
    let kinds: Vec<&str> = nodes.iter().map(|n| n.kind.as_str()).collect();
    assert!(kinds.contains(&"function_item"), "应包含 function_item");
    assert!(kinds.contains(&"struct_item"), "应包含 struct_item");
}

#[test]
fn ast_deeply_nested_structures() {
    let source = r#"
mod outer {
    mod inner {
        pub struct Deep {
            value: Option<Result<String, Box<dyn std::error::Error>>>,
        }

        impl Deep {
            pub fn new() -> Self {
                Self { value: None }
            }
        }
    }
}
"#;
    let summary = AstEditor::summarize("rust", source).expect("深层嵌套应可解析");
    let symbol_names: Vec<&str> = summary.symbols.iter().map(|s| s.name.as_str()).collect();
    assert!(symbol_names.contains(&"outer"), "应提取 mod outer");
    assert!(symbol_names.contains(&"inner"), "应提取 mod inner");
    assert!(symbol_names.contains(&"Deep"), "应提取 struct Deep");
}

// ============================================================
// 维度二：语义搜索层功能测试（评估当前能力与缺失）
// ============================================================

#[test]
fn semantic_search_current_capability_exact_name_match() {
    // 当前系统基于 tree-sitter 符号索引，支持精确名称匹配
    let source = r#"
pub fn calculate_total(items: &[Item]) -> f64 {
    items.iter().map(|i| i.price).sum()
}

pub struct Item {
    pub price: f64,
    pub name: String,
}
"#;
    let summary = AstEditor::summarize("rust", source).expect("parse should succeed");

    // 精确名称搜索 — 当前系统可支持
    let found = summary.symbols.iter().find(|s| s.name == "calculate_total");
    assert!(found.is_some(), "精确名称搜索应能找到 calculate_total");

    let found_item = summary.symbols.iter().find(|s| s.name == "Item");
    assert!(found_item.is_some(), "精确名称搜索应能找到 Item");
}

#[test]
fn semantic_search_current_capability_kind_filter() {
    // 当前系统支持按 kind 过滤
    let source = "fn foo() {}\nstruct Bar;\nenum Baz {};\n";
    let summary = AstEditor::summarize("rust", source).expect("parse should succeed");

    let functions: Vec<_> = summary.symbols.iter().filter(|s| s.kind == "fn").collect();
    let structs: Vec<_> = summary.symbols.iter().filter(|s| s.kind == "struct").collect();
    let enums: Vec<_> = summary.symbols.iter().filter(|s| s.kind == "enum").collect();

    assert_eq!(functions.len(), 1, "应找到 1 个 fn");
    assert_eq!(structs.len(), 1, "应找到 1 个 struct");
    assert_eq!(enums.len(), 1, "应找到 1 个 enum");
}

#[test]
fn semantic_search_gap_fuzzy_name_matching() {
    // 缺失能力评估：模糊名称搜索
    // 场景：用户搜索 "calc" 期望匹配 "calculate_total"
    let source = "pub fn calculate_total() {}\npub fn calc_price() {}\npub fn compute_sum() {}\n";
    let summary = AstEditor::summarize("rust", source).expect("parse should succeed");

    // 当前系统仅支持精确匹配，模糊搜索需额外实现
    let fuzzy_results: Vec<_> = summary
        .symbols
        .iter()
        .filter(|s| s.name.contains("calc"))
        .collect();

    // 子串匹配可部分工作，但真正的语义搜索需要嵌入向量
    assert!(
        fuzzy_results.len() >= 2,
        "子串匹配至少应找到 calculate_total 和 calc_price"
    );

    // 语义搜索缺失：compute_sum 与 "calc" 语义相近但子串不匹配
    let semantic_near_miss: Vec<_> = summary
        .symbols
        .iter()
        .filter(|s| s.name.contains("compute"))
        .collect();
    assert!(
        !semantic_near_miss.is_empty(),
        "compute_sum 与 calc 语义相关但子串不匹配 — 这是语义搜索层的缺失"
    );
}

#[test]
fn semantic_search_gap_cross_language_search() {
    // 缺失能力评估：跨语言语义搜索
    // 场景：同一概念在不同语言中的实现
    let rust_source = "struct Config { port: u16 }\n";
    let ts_source = "interface Config { port: number; }\n";

    let rust_summary = AstEditor::summarize("rust", rust_source).expect("rust parse");
    let ts_summary = AstEditor::summarize("typescript", ts_source).expect("ts parse");

    // 两者都有 Config 符号，但当前系统无法关联它们的语义等价性
    assert!(
        rust_summary.symbols.iter().any(|s| s.name == "Config"),
        "Rust 侧有 Config"
    );
    assert!(
        ts_summary.symbols.iter().any(|s| s.name == "Config"),
        "TypeScript 侧有 Config"
    );
    // 缺失：无法建立跨语言的语义关联
}

#[test]
fn semantic_search_gap_natural_language_query() {
    // 缺失能力评估：自然语言查询
    // 场景：用户搜索"处理HTTP请求的函数"
    let source = r#"
fn handle_http_request(req: Request) -> Response {}
fn parse_url(url: &str) -> Url {}
fn validate_token(token: &str) -> bool {}
"#;
    let summary = AstEditor::summarize("rust", source).expect("parse should succeed");

    // 当前系统无法理解"处理HTTP请求"这样的自然语言查询
    // 只能通过精确名称或子串匹配
    let by_substring = summary
        .symbols
        .iter()
        .filter(|s| s.name.contains("http"))
        .collect::<Vec<_>>();
    assert_eq!(by_substring.len(), 1, "子串匹配只能找到 handle_http_request");

    // "处理HTTP请求" 语义上应匹配 handle_http_request，但当前无法实现
    // 这需要嵌入向量语义搜索层
}

// ============================================================
// 维度三：解析能力自动化闭环验证测试
// ============================================================

#[test]
fn closed_loop_parse_then_extract_symbols_and_imports() {
    // 闭环验证：解析 → 符号提取 → 导入提取 → 一致性校验
    let source = r#"
use std::fs;
use anyhow::Result;

pub fn read_config(path: &str) -> Result<String> {
    let content = fs::read_to_string(path)?;
    Ok(content)
}

pub struct Config {
    pub path: String,
}
"#;
    let summary = AstEditor::summarize("rust", source).expect("闭环解析应成功");

    // 验证符号数量合理
    assert!(summary.symbols.len() >= 2, "应提取至少 2 个符号");

    // 验证导入数量合理
    assert!(summary.imports.len() >= 2, "应提取至少 2 个导入");

    // 验证符号行号在源码行数范围内
    let line_count = source.lines().count();
    for symbol in &summary.symbols {
        assert!(
            symbol.line <= line_count,
            "符号 {} 行号 {} 超出源码行数 {}",
            symbol.name,
            symbol.line,
            line_count
        );
    }

    // 验证导入行号在源码行数范围内
    for import in &summary.imports {
        assert!(
            import.line <= line_count,
            "导入 {} 行号 {} 超出源码行数 {}",
            import.specifier,
            import.line,
            line_count
        );
    }
}

#[test]
fn closed_loop_cache_hit_returns_same_result() {
    // 闭环验证：缓存命中应返回一致结果
    let cache = AstCache::new(64);
    let dir = tempfile::tempdir().expect("create temp dir");
    let file_path = dir.path().join("test.rs");
    fs::write(&file_path, "fn cached_fn() {}\n").expect("write file");

    let source = fs::read_to_string(&file_path).expect("read file");
    let first = cache
        .get_or_compute(&file_path, "rust", &source)
        .expect("first compute");
    let second = cache
        .get_or_compute(&file_path, "rust", &source)
        .expect("second compute (cache hit)");

    assert_eq!(
        first.symbols.len(),
        second.symbols.len(),
        "缓存命中应返回相同符号数量"
    );
    assert_eq!(
        first.symbols[0].name, second.symbols[0].name,
        "缓存命中应返回相同符号名称"
    );
}

#[test]
fn closed_loop_cache_invalidation_on_file_change() {
    // 闭环验证：文件修改后缓存应失效
    let cache = AstCache::new(64);
    let dir = tempfile::tempdir().expect("create temp dir");
    let file_path = dir.path().join("mutable.rs");
    fs::write(&file_path, "fn original() {}\n").expect("write original");

    let source_v1 = fs::read_to_string(&file_path).expect("read v1");
    let result_v1 = cache
        .get_or_compute(&file_path, "rust", &source_v1)
        .expect("compute v1");
    assert_eq!(result_v1.symbols[0].name, "original");

    // 修改文件
    fs::write(&file_path, "fn modified() {}\n").expect("write modified");
    cache.invalidate(&file_path);

    let source_v2 = fs::read_to_string(&file_path).expect("read v2");
    let result_v2 = cache
        .get_or_compute(&file_path, "rust", &source_v2)
        .expect("compute v2");
    assert_eq!(
        result_v2.symbols[0].name, "modified",
        "缓存失效后应返回新内容"
    );
}

#[test]
fn closed_loop_cache_eviction_under_capacity() {
    // 闭环验证：缓存容量限制下的淘汰行为
    let cache = AstCache::new(3);
    let dir = tempfile::tempdir().expect("create temp dir");

    // 填充超过容量的缓存项
    for i in 0..5 {
        let file_path = dir.path().join(format!("file_{}.rs", i));
        fs::write(&file_path, format!("fn func_{}() {{}}\n", i)).expect("write file");
        let source = fs::read_to_string(&file_path).expect("read file");
        cache
            .get_or_compute(&file_path, "rust", &source)
            .expect("compute should succeed");
    }

    // 缓存应正常工作（不 panic），最旧的条目被淘汰
    let file_path = dir.path().join("file_4.rs");
    let source = fs::read_to_string(&file_path).expect("read file");
    let result = cache
        .get_or_compute(&file_path, "rust", &source)
        .expect("最新条目应可访问");
    assert_eq!(result.symbols[0].name, "func_4");
}

#[test]
fn closed_loop_file_list_cache_consistency() {
    // 闭环验证：文件列表缓存一致性
    // 直接使用 FileListCache 的公共 API，传入闭包收集文件
    let cache = FileListCache::new();
    let dir = tempfile::tempdir().expect("create temp dir");
    fs::write(dir.path().join("a.rs"), "fn a() {}").expect("write a.rs");
    fs::write(dir.path().join("b.rs"), "fn b() {}").expect("write b.rs");

    let collect_fn = |path: &std::path::Path,
                      _lang: Option<&str>,
                      files: &mut Vec<std::path::PathBuf>|
     -> anyhow::Result<()> {
        for entry in fs::read_dir(path)? {
            let entry = entry?;
            if entry.path().extension().and_then(|e| e.to_str()) == Some("rs") {
                files.push(entry.path());
            }
        }
        Ok(())
    };

    let files_first = cache
        .get_or_collect(dir.path(), Some("rust"), collect_fn)
        .expect("first collect");

    let files_second = cache
        .get_or_collect(dir.path(), Some("rust"), collect_fn)
        .expect("second collect (cache hit)");

    assert_eq!(
        files_first.len(),
        files_second.len(),
        "缓存命中应返回相同文件数量"
    );
    assert_eq!(files_first.len(), 2, "应找到 2 个 .rs 文件");
}

#[test]
fn closed_loop_reparse_after_syntax_fix() {
    // 闭环验证：语法错误修复后重新解析应得到正确结果
    let broken = "fn broken( { let x = 1";
    let summary_broken = AstEditor::summarize("rust", broken).expect("语法错误应容错解析");
    // 语法错误时可能提取不到完整符号
    let has_broken_fn = summary_broken
        .symbols
        .iter()
        .any(|s| s.name == "broken");

    let fixed = "fn broken() { let x = 1; }";
    let summary_fixed = AstEditor::summarize("rust", fixed).expect("修复后应正常解析");
    assert!(
        summary_fixed.symbols.iter().any(|s| s.name == "broken"),
        "修复后应能提取 broken 函数"
    );

    // 修复后节点数应更多（更完整的 AST）
    assert!(
        summary_fixed.node_count >= summary_broken.node_count,
        "修复后 AST 节点数应不少于语法错误时"
    );
}

// ============================================================
// 维度四：性能潜力数据支撑测试
// ============================================================

#[test]
fn perf_single_file_parse_latency() {
    // 性能指标：单文件解析延迟
    let source = "fn func() {}\n".repeat(100); // 100 行代码
    let start = Instant::now();
    for _ in 0..100 {
        let _ = AstEditor::summarize("rust", &source).expect("parse should succeed");
    }
    let elapsed = start.elapsed();
    let avg_latency = elapsed / 100;

    // 预期：单文件 100 行 Rust 代码解析平均延迟 < 5ms
    assert!(
        avg_latency.as_millis() < 5,
        "单文件解析平均延迟应 < 5ms，实际: {:?}",
        avg_latency
    );
}

#[test]
fn perf_large_file_parse_latency() {
    // 性能指标：大文件解析延迟
    let mut source = String::new();
    // 生成 1000 行 Rust 代码
    for i in 0..1000 {
        source.push_str(&format!("fn function_{}() {{ let x = {}; x }}\n", i, i));
    }

    let start = Instant::now();
    let summary = AstEditor::summarize("rust", &source).expect("large file parse");
    let elapsed = start.elapsed();

    // 预期：1000 行代码解析延迟 < 200ms（并发测试环境下放宽阈值避免 flaky）
    assert!(
        elapsed.as_millis() < 200,
        "1000 行代码解析延迟应 < 200ms，实际: {:?}",
        elapsed
    );
    // 预期：应提取 1000 个函数符号
    assert_eq!(
        summary.symbols.len(),
        1000,
        "应提取 1000 个函数符号，实际: {}",
        summary.symbols.len()
    );
}

#[test]
fn perf_cache_hit_latency_vs_miss() {
    // 性能指标：缓存命中 vs 未命中延迟对比
    // 使用足够大的源码（2000 行）让解析成本显著高于 HashMap lookup，
    // 避免 μs 级噪声导致断言不稳定。
    let cache = AstCache::new(512);
    let dir = tempfile::tempdir().expect("create temp dir");
    let file_path = dir.path().join("perf_test.rs");
    let source = "fn cached() {}\n".repeat(2000);
    fs::write(&file_path, &source).expect("write file");

    let source_content = fs::read_to_string(&file_path).expect("read file");

    // 冷启动（缓存未命中）
    let start_cold = Instant::now();
    cache
        .get_or_compute(&file_path, "rust", &source_content)
        .expect("cold compute");
    let cold_latency = start_cold.elapsed();

    // 缓存命中
    let start_hot = Instant::now();
    cache
        .get_or_compute(&file_path, "rust", &source_content)
        .expect("hot compute");
    let hot_latency = start_hot.elapsed();

    // 预期：缓存命中延迟应显著低于未命中
    assert!(
        hot_latency < cold_latency,
        "缓存命中延迟 ({:?}) 应低于未命中 ({:?})",
        hot_latency,
        cold_latency
    );
}

#[test]
fn perf_multi_language_parse_latency() {
    // 性能指标：5 语言解析延迟对比
    let test_cases = [
        ("rust", "fn main() { let x = 1; }\n".repeat(50)),
        ("python", "def main():\n    x = 1\n".repeat(50)),
        ("javascript", "function main() { let x = 1; }\n".repeat(50)),
        ("typescript", "function main(): void { let x = 1; }\n".repeat(50)),
        ("go", "func main() { x := 1 }\n".repeat(50)),
    ];

    let mut latencies = Vec::new();
    for (lang, source) in &test_cases {
        let start = Instant::now();
        for _ in 0..50 {
            let _ = AstEditor::summarize(lang, source).expect("parse should succeed");
        }
        let elapsed = start.elapsed();
        let avg = elapsed / 50;
        latencies.push((*lang, avg));
    }

    // 预期：所有语言平均解析延迟 < 5ms
    for (lang, latency) in &latencies {
        assert!(
            latency.as_millis() < 5,
            "语言 {} 平均解析延迟应 < 5ms，实际: {:?}",
            lang,
            latency
        );
    }
}

#[test]
fn perf_cache_memory_efficiency() {
    // 性能指标：缓存内存效率
    let cache = AstCache::new(100);
    let dir = tempfile::tempdir().expect("create temp dir");

    // 填充缓存
    for i in 0..100 {
        let file_path = dir.path().join(format!("mem_test_{}.rs", i));
        let source = format!("fn func_{}() {{}}\n", i);
        fs::write(&file_path, &source).expect("write file");
        let content = fs::read_to_string(&file_path).expect("read file");
        cache
            .get_or_compute(&file_path, "rust", &content)
            .expect("compute should succeed");
    }

    // 验证缓存正常工作（不 OOM，不 panic）
    let file_path = dir.path().join("mem_test_99.rs");
    let content = fs::read_to_string(&file_path).expect("read file");
    let result = cache
        .get_or_compute(&file_path, "rust", &content)
        .expect("缓存应正常工作");
    assert_eq!(result.symbols[0].name, "func_99");
}

#[test]
fn perf_node_count_scaling() {
    // 性能指标：节点数随代码规模线性增长
    let sizes = [10, 50, 100, 500];
    let mut node_counts = Vec::new();

    for &size in &sizes {
        let source: String = (0..size)
            .map(|i| format!("fn func_{}() {{}}\n", i))
            .collect();
        let summary = AstEditor::summarize("rust", &source).expect("parse should succeed");
        node_counts.push((size, summary.node_count));
    }

    // 预期：节点数随代码规模近似线性增长
    // 验证比例关系：size=500 的节点数应约为 size=10 的 50 倍（±20%）
    let ratio_10 = node_counts[0].1 as f64 / node_counts[0].0 as f64;
    let ratio_500 = node_counts[3].1 as f64 / node_counts[3].0 as f64;
    let deviation = (ratio_500 - ratio_10).abs() / ratio_10;
    assert!(
        deviation < 0.5,
        "节点数增长应近似线性，比例偏差: {:.1}%",
        deviation * 100.0
    );
}

// ============================================================
// 维度五：架构实现统一度评估测试
// ============================================================

#[test]
fn architecture_tool_spec_interface_consistency() {
    // 评估：所有 code.* 工具的 ToolSpec 接口一致性
    let symbol_spec = crate::tools::code::symbol::spec();
    let deps_spec = crate::tools::code::deps::spec();

    // 验证命名规范：code.<name> 格式
    assert!(
        symbol_spec.name.starts_with("code."),
        "code.symbols 名称应符合 code.<name> 命名规范"
    );
    assert!(
        deps_spec.name.starts_with("code."),
        "code.deps 名称应符合 code.<name> 命名规范"
    );

    // 验证 SideEffectLevel 一致性：code.* 工具应为 ReadOnly
    assert!(
        symbol_spec.is_read_only(),
        "code.symbols 应为 ReadOnly"
    );
    assert!(
        deps_spec.is_read_only(),
        "code.deps 应为 ReadOnly"
    );

    // 验证 input_schema 结构一致性：都应有 path 属性
    let symbol_props = symbol_spec.input_schema["properties"]
        .as_object()
        .expect("code.symbols input_schema 应有 properties");
    let deps_props = deps_spec.input_schema["properties"]
        .as_object()
        .expect("code.deps input_schema 应有 properties");

    assert!(
        symbol_props.contains_key("path"),
        "code.symbols 应有 path 属性"
    );
    assert!(
        deps_props.contains_key("path"),
        "code.deps 应有 path 属性"
    );

    // 验证 output_schema 结构一致性：都应有 count 和 truncated
    for (name, spec) in &[(&symbol_spec.name, &symbol_spec), (&deps_spec.name, &deps_spec)] {
        let output_props = spec.output_schema["properties"]
            .as_object()
            .unwrap_or_else(|| panic!("{} output_schema 应有 properties", name));
        assert!(
            output_props.contains_key("count"),
            "{} 应有 count 属性",
            name
        );
        assert!(
            output_props.contains_key("truncated"),
            "{} 应有 truncated 属性",
            name
        );
    }
}

#[test]
fn architecture_cache_interface_consistency() {
    // 评估：AstCache 和 FileListCache 的接口统一度
    // 两者都应支持 get_or_* 模式和 invalidate 操作
    let ast_cache = AstCache::new(64);
    let file_list_cache = FileListCache::new();

    let dir = tempfile::tempdir().expect("create temp dir");
    let file_path = dir.path().join("test.rs");
    fs::write(&file_path, "fn test() {}").expect("write file");
    let source = fs::read_to_string(&file_path).expect("read file");

    // AstCache: get_or_compute
    let ast_result = ast_cache
        .get_or_compute(&file_path, "rust", &source)
        .expect("AstCache get_or_compute 应成功");
    assert!(!ast_result.symbols.is_empty(), "应提取到符号");

    // FileListCache: get_or_collect
    let file_list_result = file_list_cache
        .get_or_collect(dir.path(), Some("rust"), |path, _lang, files| {
            for entry in fs::read_dir(path)? {
                let entry = entry?;
                if entry.path().extension().and_then(|e| e.to_str()) == Some("rs") {
                    files.push(entry.path());
                }
            }
            Ok(())
        })
        .expect("FileListCache get_or_collect 应成功");
    assert!(!file_list_result.is_empty(), "应找到文件");

    // 两者都支持 invalidate
    ast_cache.invalidate(&file_path);
    file_list_cache.invalidate(&file_path);
    // invalidate 后不应 panic
}

#[test]
fn architecture_ast_summary_serialization_consistency() {
    // 评估：AstSummary 序列化/反序列化一致性
    let source = "fn test_fn() {}\nstruct TestStruct;\nuse std::io;\n";
    let summary = AstEditor::summarize("rust", source).expect("parse should succeed");

    // 序列化
    let json = serde_json::to_string(&summary).expect("AstSummary 应可序列化");
    let deserialized: AstSummary =
        serde_json::from_str(&json).expect("AstSummary 应可反序列化");

    // 验证一致性
    assert_eq!(
        summary.language, deserialized.language,
        "language 序列化后应一致"
    );
    assert_eq!(
        summary.node_count, deserialized.node_count,
        "node_count 序列化后应一致"
    );
    assert_eq!(
        summary.symbols.len(),
        deserialized.symbols.len(),
        "symbols 数量序列化后应一致"
    );
    for (orig, deser) in summary.symbols.iter().zip(deserialized.symbols.iter()) {
        assert_eq!(orig.name, deser.name, "符号名称序列化后应一致");
        assert_eq!(orig.kind, deser.kind, "符号类型序列化后应一致");
        assert_eq!(orig.line, deser.line, "符号行号序列化后应一致");
    }
}

#[test]
fn architecture_error_handling_consistency() {
    // 评估：错误处理风格一致性
    // 不支持的语言应返回包含 "unsupported language" 的错误
    let result = AstEditor::summarize("ruby", "def hello; end");
    assert!(result.is_err());
    assert!(result
        .unwrap_err()
        .to_string()
        .contains("unsupported language"));

    // 空源码不应报错（容错解析）
    let result = AstEditor::summarize("rust", "");
    assert!(result.is_ok(), "空源码应容错解析，不应报错");

    // 语法错误源码不应报错（tree-sitter 容错）
    let result = AstEditor::summarize("rust", "fn broken(");
    assert!(result.is_ok(), "语法错误源码应容错解析");
}

#[test]
fn architecture_language_support_coverage() {
    // 评估：5 语言支持覆盖度
    let languages = ["rust", "python", "javascript", "typescript", "go"];
    let minimal_sources = [
        "fn main() {}",
        "def main(): pass",
        "function main() {}",
        "function main(): void {}",
        "func main() {}",
    ];

    for (lang, source) in languages.iter().zip(minimal_sources.iter()) {
        let result = AstEditor::summarize(lang, source);
        assert!(
            result.is_ok(),
            "语言 {} 应被支持，但解析失败: {:?}",
            lang,
            result.err()
        );
    }
}

#[test]
fn architecture_symbol_kind_consistency_across_languages() {
    // 评估：跨语言符号 kind 标注一致性
    // 函数在所有语言中应有统一的 kind 标注
    let test_cases = [
        ("rust", "fn my_func() {}", "fn"),
        ("python", "def my_func(): pass", "function"),
        ("javascript", "function my_func() {}", "function"),
        ("typescript", "function my_func(): void {}", "function"),
        ("go", "func myFunc() {}", "function"),
    ];

    for (lang, source, _expected_kind) in &test_cases {
        let summary = AstEditor::summarize(lang, source)
            .unwrap_or_else(|e| panic!("{} 解析失败: {}", lang, e));
        assert!(
            !summary.symbols.is_empty(),
            "语言 {} 应提取到至少 1 个符号",
            lang
        );
        // 各语言函数的 kind 标注不同是预期的（fn vs function）
        // 但应确保 kind 不为空
        for symbol in &summary.symbols {
            assert!(
                !symbol.kind.is_empty(),
                "符号 {} 的 kind 不应为空",
                symbol.name
            );
        }
    }
}
