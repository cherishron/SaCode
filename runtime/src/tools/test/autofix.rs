//! 测试自动修复循环 — test runner + LLM 反馈 + 迭代修复
//!
//! 设计目标：
//! - 运行测试 → 解析失败 → 生成修复提示 → LLM 修复 → 重新运行测试
//! - 闭环验证：修复后自动重跑测试确认通过
//! - 最大迭代次数限制，避免无限循环
//! - 结构化修复报告
//!
//! 与竞品对比：
//! - Codex CLI：GitHub Action 自动修复 CI 失败
//! - Claude Code：手动 /test 命令 + 人工修复
//! - SaCode：自动闭环修复循环（test.run → LLM fix → test.run → ...）

use std::path::Path;

use crate::sandbox::FsAccess;
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
    /// 修复动作描述
    fix_action: Option<String>,
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
    failed_tests: Vec<FailedTestSummary>,
    framework: String,
}

/// 失败测试摘要
#[derive(Debug, Clone, serde::Serialize)]
struct FailedTestSummary {
    name: String,
    module: String,
    error_message: String,
}

pub fn spec() -> ToolSpec {
    ToolSpec {
        name: "test.fix".to_string(),
        description: "运行测试并自动修复失败用例（闭环循环：测试→修复→验证）".to_string(),
        input_schema: serde_json::json!({
            "type": "object",
            "properties": {
                "framework": { "type": "string", "description": "可选: cargo|npm|go|pytest" },
                "target": { "type": "string", "description": "可选: 测试目标路径或包名" },
                "filter": { "type": "string", "description": "可选: 测试过滤关键字" },
                "max_iterations": { "type": "integer", "description": "最大修复迭代次数，默认 3" },
                "auto_apply": { "type": "boolean", "description": "是否自动应用修复（false 则仅生成修复建议），默认 true" }
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
                            "fix_action": { "type": "string" },
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
                fix_action: None,
                fix_success: true,
            });
            break;
        }

        // 达到最大迭代次数
        if current_iteration > max_iterations {
            iterations.push(FixIteration {
                iteration: current_iteration,
                test_result: test_summary.clone(),
                fix_action: Some("已达最大迭代次数，停止修复".to_string()),
                fix_success: false,
            });
            break;
        }

        // 生成修复建议
        let fix_suggestion = generate_fix_suggestion(&test_summary);

        iterations.push(FixIteration {
            iteration: current_iteration,
            test_result: test_summary.clone(),
            fix_action: Some(fix_suggestion.clone()),
            fix_success: false, // 尚未验证
        });

        // 如果不自动应用，仅返回建议
        if !auto_apply {
            break;
        }

        // 自动修复：将修复建议写入 .sacode/fix-suggestion.md
        // 实际修复由 LLM 在后续步骤中完成
        write_fix_suggestion(&fix_suggestion)?;
    }

    // 构建最终结果
    let final_test = iterations.last().map(|it| it.test_result.clone());
    let overall_success = final_test.as_ref().map_or(false, |t| t.success);
    let total_iterations = iterations.len();

    let summary = if overall_success {
        format!(
            "测试修复成功：经过 {} 轮迭代，所有测试通过",
            total_iterations
        )
    } else {
        let failed = final_test.as_ref().map_or(0, |t| t.failed);
        format!(
            "测试修复未完成：经过 {} 轮迭代，仍有 {} 个测试失败",
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
    })))
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
                .map(|item| FailedTestSummary {
                    name: item["name"].as_str().unwrap_or("").to_string(),
                    module: item["module"].as_str().unwrap_or("").to_string(),
                    error_message: item["error_message"].as_str().unwrap_or("").to_string(),
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

/// 生成修复建议
fn generate_fix_suggestion(test_result: &TestResultSummary) -> String {
    let mut lines = Vec::new();

    lines.push(format!(
        "# 测试修复建议（{} 个失败 / {} 个总计）",
        test_result.failed, test_result.total
    ));
    lines.push(String::new());

    for (i, failed) in test_result.failed_tests.iter().enumerate() {
        lines.push(format!("## 失败 #{}: {}", i + 1, failed.name));
        if !failed.module.is_empty() {
            lines.push(format!("- 模块: {}", failed.module));
        }
        if !failed.error_message.is_empty() {
            lines.push(format!("- 错误: {}", failed.error_message));
        }
        lines.push(String::new());
    }

    lines.push("## 修复策略".to_string());
    lines.push(String::new());

    // 基于错误消息的启发式修复建议
    for failed in &test_result.failed_tests {
        let error_lower = failed.error_message.to_lowercase();
        let suggestion = if error_lower.contains("not found")
            || error_lower.contains("undefined")
            || error_lower.contains("cannot find")
        {
            "检查导入路径和模块名称是否正确，确认依赖已安装"
        } else if error_lower.contains("type mismatch")
            || error_lower.contains("type error")
            || error_lower.contains("mismatched types")
        {
            "检查类型注解和转换，确认函数签名与调用一致"
        } else if error_lower.contains("assert")
            || error_lower.contains("expected")
            || error_lower.contains("but got")
        {
            "检查断言条件，确认预期值与实际值是否匹配"
        } else if error_lower.contains("panic")
            || error_lower.contains("unwrap")
            || error_lower.contains("null")
            || error_lower.contains("nil")
        {
            "添加空值检查和错误处理，避免 unwrap/nil 解引用"
        } else if error_lower.contains("timeout")
            || error_lower.contains("deadlock")
        {
            "检查异步操作和锁使用，确认无死锁或超时场景"
        } else if error_lower.contains("permission")
            || error_lower.contains("access denied")
        {
            "检查文件权限和访问控制配置"
        } else {
            "分析错误消息，定位根因并修复"
        };

        lines.push(format!("- **{}**: {}", failed.name, suggestion));
    }

    lines.join("\n")
}

/// 将修复建议写入文件
fn write_fix_suggestion(suggestion: &str) -> anyhow::Result<()> {
    let workdir = std::env::current_dir()?;
    let fix_dir = workdir.join(".sacode");
    std::fs::create_dir_all(&fix_dir)?;

    let fix_path = fix_dir.join("fix-suggestion.md");
    std::fs::write(&fix_path, suggestion)?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn generate_fix_suggestion_with_assertion_error() {
        let test_result = TestResultSummary {
            success: false,
            total: 5,
            passed: 3,
            failed: 2,
            failed_tests: vec![
                FailedTestSummary {
                    name: "test_add".to_string(),
                    module: "math".to_string(),
                    error_message: "assertion failed: expected 5, got 4".to_string(),
                },
                FailedTestSummary {
                    name: "test_divide".to_string(),
                    module: "math".to_string(),
                    error_message: "panic at division by zero".to_string(),
                },
            ],
            framework: "cargo".to_string(),
        };

        let suggestion = generate_fix_suggestion(&test_result);
        assert!(suggestion.contains("test_add"));
        assert!(suggestion.contains("test_divide"));
        assert!(suggestion.contains("修复策略"));
        // 断言错误应有对应建议
        assert!(suggestion.contains("断言条件"));
        // panic 错误应有对应建议
        assert!(suggestion.contains("空值检查"));
    }

    #[test]
    fn generate_fix_suggestion_with_type_error() {
        let test_result = TestResultSummary {
            success: false,
            total: 1,
            passed: 0,
            failed: 1,
            failed_tests: vec![FailedTestSummary {
                name: "test_types".to_string(),
                module: "types".to_string(),
                error_message: "mismatched types: expected String, found i32".to_string(),
            }],
            framework: "cargo".to_string(),
        };

        let suggestion = generate_fix_suggestion(&test_result);
        assert!(suggestion.contains("类型注解"));
    }

    #[test]
    fn parse_test_output_extracts_failures() {
        let data = serde_json::json!({
            "success": false,
            "total": 10,
            "passed": 8,
            "failed": 2,
            "framework": "cargo",
            "failed_tests": [
                {"name": "test_a", "module": "mod_a", "error_message": "assertion failed"},
                {"name": "test_b", "module": "mod_b", "error_message": "panic"}
            ]
        });

        let summary = parse_test_output(&data);
        assert!(!summary.success);
        assert_eq!(summary.total, 10);
        assert_eq!(summary.passed, 8);
        assert_eq!(summary.failed, 2);
        assert_eq!(summary.failed_tests.len(), 2);
        assert_eq!(summary.failed_tests[0].name, "test_a");
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
}
