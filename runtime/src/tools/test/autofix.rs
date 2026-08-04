//! 测试自动修复循环 — test runner + 结构化修复上下文 + 迭代验证
//!
//! 设计目标：
//! - 运行测试 → 解析失败 → 生成结构化修复上下文 → LLM 工具循环修复 → 重新运行测试
//! - 闭环验证：修复后自动重跑测试确认通过
//! - 最大迭代次数限制，避免无限循环
//! - 输出含源码位置和错误分类，供 LLM 直接定位修复
//!
//! 灵枢 · 自动修复闭环：
//! test.fix 的角色是"提供高质量修复上下文"，而非"自己修复"。
//! LLM 在 task_runner 工具循环中消费 test.fix 输出，自然完成：
//!   test.fix → fs.read → fs.edit → test.run 验证
//!
//! 与竞品对比：
//! - Codex CLI：GitHub Action 自动修复 CI 失败
//! - Claude Code：手动 /test 命令 + 人工修复
//! - SaCode：结构化修复上下文 + LLM 工具循环自然闭环

use super::{ErrorCategory, FailedTest};
use crate::tools::{SideEffectLevel, ToolOutput, ToolSpec};

/// 最大修复迭代次数
const MAX_FIX_ITERATIONS: usize = 3;

/// 修复迭代结果
#[derive(Debug, Clone, serde::Serialize)]
struct FixIteration {
    /// 迭代轮次（从 1 开始）
    iteration: usize,
    /// 测试结果
    test_result: TestResultSummary,
    /// 修复上下文（供 LLM 消费的结构化信息）
    fix_context: Option<FixContext>,
    /// 修复是否成功
    fix_success: bool,
}

/// 测试结果摘要
#[derive(Debug, Clone, serde::Serialize)]
struct TestResultSummary {
    success: bool,
    total: usize,
    passed: usize,
    failed: usize,
    failed_tests: Vec<FailedTest>,
    framework: String,
}

/// 结构化修复上下文 — 供 LLM 工具循环消费
///
/// 包含失败测试的源码位置、错误分类和修复建议，
/// LLM 可基于此信息直接调用 fs.read + fs.edit 完成修复。
#[derive(Debug, Clone, serde::Serialize)]
struct FixContext {
    /// 失败测试列表（含源码位置和错误分类）
    failures: Vec<FailureDetail>,
    /// 修复策略摘要（人类可读）
    strategy_summary: String,
}

/// 单个失败测试的详细信息
#[derive(Debug, Clone, serde::Serialize)]
struct FailureDetail {
    /// 测试名称
    name: String,
    /// 模块路径
    module: String,
    /// 错误消息
    error_message: String,
    /// 源码位置（如 `src/math.rs:42`，空表示未提取到）
    location: String,
    /// 错误类型分类
    category: ErrorCategory,
    /// 该错误类型的修复建议
    suggestion: String,
}

pub fn spec() -> ToolSpec {
    ToolSpec {
        name: "test.fix".to_string(),
        description: "运行测试并生成结构化修复上下文（闭环循环：测试→修复上下文→LLM修复→验证）".to_string(),
        input_schema: serde_json::json!({
            "type": "object",
            "properties": {
                "framework": { "type": "string", "description": "可选: cargo|npm|go|pytest" },
                "target": { "type": "string", "description": "可选: 测试目标路径或包名" },
                "filter": { "type": "string", "description": "可选: 测试过滤关键字" },
                "max_iterations": { "type": "integer", "description": "最大修复迭代次数，默认 3" },
                "auto_apply": { "type": "boolean", "description": "是否自动应用修复（false 则仅生成修复上下文），默认 true" }
            }
        }),
        output_schema: serde_json::json!({
            "type": "object",
            "properties": {
                "success": { "type": "boolean" },
                "framework": { "type": "string" },
                "iterations": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "iteration": { "type": "integer" },
                            "test_result": { "type": "object" },
                            "fix_context": {
                                "type": "object",
                                "properties": {
                                    "failures": {
                                        "type": "array",
                                        "items": {
                                            "type": "object",
                                            "properties": {
                                                "name": { "type": "string" },
                                                "module": { "type": "string" },
                                                "error_message": { "type": "string" },
                                                "location": { "type": "string" },
                                                "category": { "type": "string" },
                                                "suggestion": { "type": "string" }
                                            }
                                        }
                                    },
                                    "strategy_summary": { "type": "string" }
                                }
                            },
                            "fix_success": { "type": "boolean" }
                        }
                    }
                },
                "total_iterations": { "type": "integer" },
                "final_result": { "type": "object" },
                "summary": { "type": "string" }
            }
        }),
        side_effect_level: SideEffectLevel::Modify,
        approval_required: true,
        timeout_ms: Some(300_000), // 5 分钟超时
        tags: vec!["test".to_string(), "fix".to_string(), "autofix".to_string()],
    }
}

pub fn execute(input: serde_json::Value) -> anyhow::Result<ToolOutput> {
    let framework = input["framework"].as_str().map(str::trim);
    let target = input["target"].as_str().map(str::trim);
    let filter = input["filter"].as_str().map(str::trim);
    let max_iterations = input["max_iterations"]
        .as_u64()
        .unwrap_or(MAX_FIX_ITERATIONS as u64) as usize;
    let auto_apply = input["auto_apply"].as_bool().unwrap_or(true);

    let mut iterations = Vec::new();
    let mut current_iteration = 0;

    loop {
        current_iteration += 1;

        // 运行测试
        let test_output = run_test(framework, target, filter)?;
        let test_summary = parse_test_output(&test_output);

        // 如果测试全部通过，修复循环结束
        if test_summary.success {
            iterations.push(FixIteration {
                iteration: current_iteration,
                test_result: test_summary.clone(),
                fix_context: None,
                fix_success: true,
            });
            break;
        }

        // 达到最大迭代次数
        if current_iteration > max_iterations {
            let fix_context = build_fix_context(&test_summary);
            iterations.push(FixIteration {
                iteration: current_iteration,
                test_result: test_summary.clone(),
                fix_context: Some(fix_context),
                fix_success: false,
            });
            break;
        }

        // 生成结构化修复上下文
        let fix_context = build_fix_context(&test_summary);

        iterations.push(FixIteration {
            iteration: current_iteration,
            test_result: test_summary.clone(),
            fix_context: Some(fix_context.clone()),
            fix_success: false, // 尚未验证
        });

        // 如果不自动应用，仅返回修复上下文
        if !auto_apply {
            break;
        }

        // 灵枢 · 自动修复闭环：
        // test.fix 不直接修改源码，而是输出结构化修复上下文供 LLM 消费。
        // LLM 在工具循环中读取 fix_context，调用 fs.read 读取源码，
        // 调用 fs.edit 应用修复，然后再次调用 test.fix 或 test.run 验证。
        // 此处写入修复上下文文件，便于 LLM 跨工具调用时引用。
        write_fix_context(&fix_context)?;
    }

    // 构建最终结果
    let final_test = iterations.last().map(|it| it.test_result.clone());
    let overall_success = final_test.as_ref().is_some_and(|t| t.success);
    let total_iterations = iterations.len();

    let summary = if overall_success {
        format!(
            "测试修复成功：经过 {} 轮迭代，所有测试通过",
            total_iterations
        )
    } else {
        let failed = final_test.as_ref().map_or(0, |t| t.failed);
        format!(
            "测试修复未完成：经过 {} 轮迭代，仍有 {} 个测试失败。请基于 fix_context 中的 location 和 suggestion 调用 fs.read + fs.edit 修复",
            total_iterations, failed
        )
    };

    Ok(ToolOutput::success(serde_json::json!({
        "success": overall_success,
        "framework": final_test.as_ref().map(|t| t.framework.clone()).unwrap_or_default(),
        "iterations": iterations,
        "total_iterations": total_iterations,
        "final_result": final_test,
        "summary": summary,
    }))
    .with_message(if overall_success {
        "所有测试通过，修复闭环完成"
    } else {
        "仍有失败测试，请消费 fix_context 中的 location 和 suggestion 进行修复"
    }))
}

/// 运行测试（调用 test.run 工具逻辑）
fn run_test(
    framework: Option<&str>,
    target: Option<&str>,
    filter: Option<&str>,
) -> anyhow::Result<serde_json::Value> {
    let mut input = serde_json::json!({});
    if let Some(fw) = framework {
        input["framework"] = serde_json::json!(fw);
    }
    if let Some(t) = target {
        input["target"] = serde_json::json!(t);
    }
    if let Some(f) = filter {
        input["filter"] = serde_json::json!(f);
    }

    let output = super::runner::execute(input)?;
    Ok(output.data)
}

/// 解析测试输出为结构化摘要
fn parse_test_output(data: &serde_json::Value) -> TestResultSummary {
    let failed_tests = data["failed_tests"]
        .as_array()
        .map(|arr| {
            arr.iter()
                .map(|item| FailedTest {
                    name: item["name"].as_str().unwrap_or("").to_string(),
                    module: item["module"].as_str().unwrap_or("").to_string(),
                    error_message: item["error_message"].as_str().unwrap_or("").to_string(),
                    location: item["location"].as_str().unwrap_or("").to_string(),
                })
                .collect()
        })
        .unwrap_or_default();

    TestResultSummary {
        success: data["success"].as_bool().unwrap_or(false),
        total: data["total"].as_u64().unwrap_or(0) as usize,
        passed: data["passed"].as_u64().unwrap_or(0) as usize,
        failed: data["failed"].as_u64().unwrap_or(0) as usize,
        failed_tests,
        framework: data["framework"].as_str().unwrap_or("unknown").to_string(),
    }
}

/// 构建结构化修复上下文
///
/// 将失败测试转换为含错误分类和源码位置的修复上下文，
/// 供 LLM 工具循环直接消费（fs.read → fs.edit → test.run）
fn build_fix_context(test_result: &TestResultSummary) -> FixContext {
    let failures: Vec<FailureDetail> = test_result
        .failed_tests
        .iter()
        .map(|failed| {
            let category = ErrorCategory::from_error_message(&failed.error_message);
            FailureDetail {
                name: failed.name.clone(),
                module: failed.module.clone(),
                error_message: failed.error_message.clone(),
                location: failed.location.clone(),
                suggestion: category.fix_suggestion().to_string(),
                category,
            }
        })
        .collect();

    let strategy_summary = build_strategy_summary(&failures);

    FixContext {
        failures,
        strategy_summary,
    }
}

/// 生成修复策略摘要
fn build_strategy_summary(failures: &[FailureDetail]) -> String {
    let mut lines = Vec::new();

    lines.push(format!(
        "# 修复策略（{} 个失败测试）",
        failures.len()
    ));
    lines.push(String::new());
    lines.push("建议工作流：".to_string());
    lines.push("1. 根据 location 调用 fs.read 读取失败测试相关源码".to_string());
    lines.push("2. 基于 error_message 和 suggestion 调用 fs.edit 应用修复".to_string());
    lines.push("3. 调用 test.run 或 test.fix 验证修复".to_string());
    lines.push(String::new());

    for (i, failure) in failures.iter().enumerate() {
        lines.push(format!(
            "## 失败 #{}: {} [{}]",
            i + 1,
            failure.name,
            serde_json::to_string(&failure.category).unwrap_or_else(|_| "\"other\"".to_string())
        ));
        if !failure.module.is_empty() {
            lines.push(format!("- 模块: {}", failure.module));
        }
        if !failure.location.is_empty() {
            lines.push(format!("- 位置: {}", failure.location));
        }
        if !failure.error_message.is_empty() {
            lines.push(format!("- 错误: {}", failure.error_message));
        }
        lines.push(format!("- 建议: {}", failure.suggestion));
        lines.push(String::new());
    }

    lines.join("\n")
}

/// 将修复上下文写入文件，便于 LLM 跨工具调用时引用
fn write_fix_context(context: &FixContext) -> anyhow::Result<()> {
    let workdir = std::env::current_dir()?;
    let fix_dir = workdir.join(".sacode");
    std::fs::create_dir_all(&fix_dir)?;

    let fix_path = fix_dir.join("fix-context.json");
    let json = serde_json::to_string_pretty(context)?;
    std::fs::write(&fix_path, json)?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn build_fix_context_classifies_assertion_error() {
        let test_result = TestResultSummary {
            success: false,
            total: 5,
            passed: 3,
            failed: 2,
            failed_tests: vec![
                FailedTest {
                    name: "test_add".to_string(),
                    module: "math".to_string(),
                    error_message: "assertion failed: expected 5, got 4".to_string(),
                    location: "src/math.rs:42".to_string(),
                },
                FailedTest {
                    name: "test_divide".to_string(),
                    module: "math".to_string(),
                    error_message: "panic at division by zero".to_string(),
                    location: "src/math.rs:78".to_string(),
                },
            ],
            framework: "cargo".to_string(),
        };

        let context = build_fix_context(&test_result);
        assert_eq!(context.failures.len(), 2);

        // 断言错误
        assert_eq!(context.failures[0].category, ErrorCategory::AssertionFailure);
        assert!(context.failures[0].suggestion.contains("断言条件"));
        assert_eq!(context.failures[0].location, "src/math.rs:42");

        // panic 错误
        assert_eq!(context.failures[1].category, ErrorCategory::PanicOrNull);
        assert!(context.failures[1].suggestion.contains("空值检查"));
        assert_eq!(context.failures[1].location, "src/math.rs:78");
    }

    #[test]
    fn build_fix_context_classifies_type_error() {
        let test_result = TestResultSummary {
            success: false,
            total: 1,
            passed: 0,
            failed: 1,
            failed_tests: vec![FailedTest {
                name: "test_types".to_string(),
                module: "types".to_string(),
                error_message: "mismatched types: expected String, found i32".to_string(),
                location: "src/types.rs:15".to_string(),
            }],
            framework: "cargo".to_string(),
        };

        let context = build_fix_context(&test_result);
        assert_eq!(context.failures[0].category, ErrorCategory::TypeMismatch);
        assert!(context.failures[0].suggestion.contains("类型注解"));
    }

    #[test]
    fn build_fix_context_classifies_import_error() {
        let test_result = TestResultSummary {
            success: false,
            total: 1,
            passed: 0,
            failed: 1,
            failed_tests: vec![FailedTest {
                name: "test_import".to_string(),
                module: "imports".to_string(),
                error_message: "cannot find function `foo` in module `bar`".to_string(),
                location: "".to_string(),
            }],
            framework: "cargo".to_string(),
        };

        let context = build_fix_context(&test_result);
        assert_eq!(context.failures[0].category, ErrorCategory::ImportNotFound);
        assert!(context.failures[0].suggestion.contains("导入路径"));
        // location 为空时不影响分类
        assert!(context.failures[0].location.is_empty());
    }

    #[test]
    fn strategy_summary_includes_workflow_and_locations() {
        let test_result = TestResultSummary {
            success: false,
            total: 1,
            passed: 0,
            failed: 1,
            failed_tests: vec![FailedTest {
                name: "test_foo".to_string(),
                module: "mod".to_string(),
                error_message: "assertion failed".to_string(),
                location: "src/mod.rs:10".to_string(),
            }],
            framework: "cargo".to_string(),
        };

        let context = build_fix_context(&test_result);
        let summary = &context.strategy_summary;

        // 包含工作流指引
        assert!(summary.contains("fs.read"));
        assert!(summary.contains("fs.edit"));
        assert!(summary.contains("test.run"));
        // 包含源码位置
        assert!(summary.contains("src/mod.rs:10"));
        // 包含错误分类
        assert!(summary.contains("assertion_failure"));
    }

    #[test]
    fn parse_test_output_extracts_failures_with_location() {
        let data = serde_json::json!({
            "success": false,
            "total": 10,
            "passed": 8,
            "failed": 2,
            "framework": "cargo",
            "failed_tests": [
                {"name": "test_a", "module": "mod_a", "error_message": "assertion failed", "location": "src/a.rs:10"},
                {"name": "test_b", "module": "mod_b", "error_message": "panic", "location": "src/b.rs:20"}
            ]
        });

        let summary = parse_test_output(&data);
        assert!(!summary.success);
        assert_eq!(summary.failed_tests.len(), 2);
        assert_eq!(summary.failed_tests[0].location, "src/a.rs:10");
        assert_eq!(summary.failed_tests[1].location, "src/b.rs:20");
    }

    #[test]
    fn parse_test_output_success() {
        let data = serde_json::json!({
            "success": true,
            "total": 5,
            "passed": 5,
            "failed": 0,
            "framework": "npm",
            "failed_tests": []
        });

        let summary = parse_test_output(&data);
        assert!(summary.success);
        assert!(summary.failed_tests.is_empty());
    }

    #[test]
    fn parse_test_output_handles_missing_location() {
        let data = serde_json::json!({
            "success": false,
            "total": 1,
            "passed": 0,
            "failed": 1,
            "framework": "cargo",
            "failed_tests": [
                {"name": "test_no_loc", "module": "mod", "error_message": "error"}
            ]
        });

        let summary = parse_test_output(&data);
        assert_eq!(summary.failed_tests[0].location, "");
    }
}
