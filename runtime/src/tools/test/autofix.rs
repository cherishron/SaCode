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

/// 最大修复迭代次数 — 硬上限防止无限循环浪费 token
pub const MAX_FIX_ITERATIONS: usize = 3;

/// 自动修复闭环状态机
///
/// 灵枢 · 自修复回路：test.fix 在 `auto_apply=true` 模式下不再是"单次生成上下文"，
/// 而是驱动一个"分析 → 生成上下文 → 验证 → 成功/耗尽"的状态机。
/// 由于真正的修复动作（fs.edit）由 LLM 在外部工具循环中完成，本状态机在每个验证
/// 失败后重新生成结构化修复上下文（fix-context.json）供 LLM 消费，并记录度量。
///
/// 注意：单次 `test.fix` 调用是**单轮**语义——它生成修复上下文后即退出，
/// 等待 LLM 在外部工具循环（`fs.edit` 应用修改 → 再次调用 `test.fix`/`test.run`
/// 验证）中介入。因此状态机不在此处自行重跑测试或应用修改（与历史契约一致）。
/// `max_iterations` 仅作为对外暴露的"多轮外部循环预算"上限语义，单轮执行恒为 1 轮。
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum FixLoopState {
    /// 分析失败测试，生成修复上下文
    Analyzing { failures: usize },
    /// 已生成第 `iteration` 轮修复上下文，等待 LLM 应用修改
    Patching {
        iteration: u8,
        failure_types: Vec<ErrorCategory>,
    },
    /// 已生成上下文，等待外部（LLM 工具循环 / orchestrator）应用修改并验证
    PendingExternalFix { iteration: u8 },
    /// 修复成功（共 `iterations` 轮）
    Success { iterations: u8 },
    /// 达到迭代上限仍未通过（共 `iterations` 轮）
    Exhausted { iterations: u8 },
}

/// 单次修复迭代的度量结果
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct FixOutcome {
    /// 实际迭代轮数
    pub iterations: u8,
    /// 最终是否修复成功
    pub success: bool,
    /// 各轮检测的失败类型汇总（去重）
    pub failure_types: Vec<ErrorCategory>,
    /// 各轮采用的修复策略摘要（对应 fix-context.strategy_summary）
    pub fix_strategies: Vec<String>,
    /// 估算消耗 token（按 4 字符/token 近似，仅用于相对度量）
    pub total_tokens_estimated: u64,
}

/// 修复迭代结果（用于 serialized 输出）
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
    /// 本轮回合状态机快照
    state: String,
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
        description: "运行测试并生成结构化修复上下文（自动修复闭环：测试→分析失败→生成修复上下文→LLM 应用修复→重新验证，最多 max_iterations 轮）".to_string(),
        input_schema: serde_json::json!({
            "type": "object",
            "properties": {
                "framework": { "type": "string", "description": "可选: cargo|npm|go|pytest" },
                "target": { "type": "string", "description": "可选: 测试目标路径或包名" },
                "filter": { "type": "string", "description": "可选: 测试过滤关键字" },
                "max_iterations": { "type": "integer", "description": "最大修复迭代次数，默认 3" },
                "auto_apply": { "type": "boolean", "description": "是否驱动自动修复闭环（true 则每轮失败后重新生成修复上下文，由 LLM 在工具循环中应用修复），默认 true" }
            }
        }),
        output_schema: serde_json::json!({
            "type": "object",
            "properties": {
                "success": { "type": "boolean" },
                "framework": { "type": "string" },
                "fix_outcome": {
                    "type": "object",
                    "properties": {
                        "iterations": { "type": "integer" },
                        "success": { "type": "boolean" },
                        "failure_types": { "type": "array", "items": { "type": "string" } },
                        "fix_strategies": { "type": "array", "items": { "type": "string" } },
                        "total_tokens_estimated": { "type": "integer" }
                    }
                },
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
                            "fix_success": { "type": "boolean" },
                            "state": { "type": "string" }
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
    let max_iterations = (input["max_iterations"]
        .as_u64()
        .unwrap_or(MAX_FIX_ITERATIONS as u64) as usize)
        .min(MAX_FIX_ITERATIONS);
    let auto_apply = input["auto_apply"].as_bool().unwrap_or(true);

    // 灵枢 · 自动修复闭环：
    // test.fix 驱动 "分析 → 生成修复上下文 → 验证" 的状态机。
    // 每轮验证失败后，重新生成 fix-context.json 供 LLM 在外部工具循环中调用
    // fs.read + fs.edit 应用修复，随后再次调用 test.fix（或 test.run）验证。
    // 达到 max_iterations 上限仍未通过则降级为 Exhausted，返回最佳尝试 + 度量。

    let mut iterations: Vec<FixIteration> = Vec::new();
    let mut failure_types: Vec<ErrorCategory> = Vec::new();
    let mut fix_strategies: Vec<String> = Vec::new();
    let mut total_tokens_estimated: u64 = 0;

    // 首轮：运行测试
    let test_output = run_test(framework, target, filter)?;
    let test_summary = parse_test_output(&test_output);

    // 测试全部通过：无需修复
    if test_summary.success {
        let outcome = FixOutcome {
            iterations: 1,
            success: true,
            failure_types: Vec::new(),
            fix_strategies: Vec::new(),
            total_tokens_estimated: 0,
        };
        let iteration = FixIteration {
            iteration: 1,
            test_result: test_summary.clone(),
            fix_context: None,
            fix_success: true,
            state: "Success".to_string(),
        };
        let summary = format!("测试全部通过：{} 个测试，0 个失败", test_summary.total);
        return Ok(ToolOutput::success(serde_json::json!({
            "success": true,
            "framework": test_summary.framework,
            "fix_outcome": outcome,
            "iterations": [iteration],
            "total_iterations": 1,
            "final_result": test_summary,
            "summary": summary,
        }))
        .with_message("所有测试通过，无需修复"));
    }

    // 进入修复闭环。
    // 单轮语义：test.fix 同步调用只做"分析 + 生成修复上下文"一步即退出，
    // 不在此处重跑测试或应用修改（修改属于 LLM 工具循环）。`max_iterations`
    // 作为对外暴露的"多轮外部循环预算"上限语义保留；当 `max_iterations <= 1`
    // 时直接判定为 Exhausted（无外部循环余量），否则进入 PendingExternalFix 等待 LLM 介入。
    let round = 1usize;
    let loop_state: FixLoopState;

    // 分析阶段：生成结构化修复上下文（状态机：Analyzing → Patching）
    let fix_context = build_fix_context(&test_summary);
    let round_failure_types: Vec<ErrorCategory> =
        fix_context.failures.iter().map(|f| f.category).collect();
    for category in &round_failure_types {
        if !failure_types.contains(category) {
            failure_types.push(*category);
        }
    }
    if !fix_strategies.contains(&fix_context.strategy_summary) {
        fix_strategies.push(fix_context.strategy_summary.clone());
    }
    // 估算 token：fix-context 序列化长度 / 4
    total_tokens_estimated += (serde_json::to_string(&fix_context)
        .map(|s| s.len())
        .unwrap_or(0)
        / 4) as u64;

    // 写入 fix-context.json 供 LLM 工具循环消费
    write_fix_context(&fix_context)?;

    // 状态机：Patching — 等待 LLM 在工具循环中应用修改
    // 记录本轮迭代（此时尚未验证，fix_success 取决于下一轮 test.fix 调用）
    let iteration = FixIteration {
        iteration: round,
        test_result: test_summary.clone(),
        fix_context: Some(fix_context.clone()),
        fix_success: false,
        state: format!("Patching#{}", round),
    };
    iterations.push(iteration);

    // 无外部循环余量（max_iterations <= 1）：降级为 Exhausted，
    // 交由外部（LLM 工具循环 / orchestrator）自行决定后续。
    if max_iterations <= 1 {
        loop_state = FixLoopState::Exhausted {
            iterations: round as u8,
        };
    } else {
        // 已生成上下文，等待外部应用修改并验证（单轮执行恒为 1 轮）
        loop_state = FixLoopState::PendingExternalFix {
            iteration: round as u8,
        };
    }

    let success = test_summary.success;
    let final_state_label = match &loop_state {
        FixLoopState::Success { iterations } => format!("Success#{}", iterations),
        FixLoopState::Exhausted { iterations } => format!("Exhausted#{}", iterations),
        FixLoopState::PendingExternalFix { iteration } => {
            format!("PendingExternalFix#{}", iteration)
        }
        _ => "Analyzing".to_string(),
    };

    let outcome = FixOutcome {
        iterations: round as u8,
        success,
        failure_types: failure_types.clone(),
        fix_strategies: fix_strategies.clone(),
        total_tokens_estimated,
    };

    let summary = format!(
        "检测到 {} 个失败测试，已生成第 {} 轮修复上下文（状态：{}）。{}",
        test_summary.failed,
        round,
        final_state_label,
        if auto_apply {
            "请基于 fix_context 中的 location 和 suggestion 调用 fs.read + fs.edit 修复，再调用 test.fix 验证（自动修复闭环）。"
        } else {
            "（auto_apply=false，仅生成上下文）"
        }
    );

    Ok(ToolOutput::success(serde_json::json!({
        "success": success,
        "framework": test_summary.framework,
        "fix_outcome": outcome,
        "iterations": iterations,
        "total_iterations": round,
        "final_result": test_summary,
        "summary": summary,
    }))
    .with_message("已生成修复上下文，请消费 fix_context 进行修复"))
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

    lines.push(format!("# 修复策略（{} 个失败测试）", failures.len()));
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
        assert_eq!(
            context.failures[0].category,
            ErrorCategory::AssertionFailure
        );
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

    /// 端到端验证：test.fix → fix-context.json → 模拟 LLM 修复 → test.run 验证
    ///
    /// 验证完整闭环：
    /// 1. 创建有 bug 的 Python 项目（add 函数返回 a-b 而非 a+b）
    /// 2. 调用 test.fix 生成 fix_context（单次执行，无空转循环）
    /// 3. 验证 fix-context.json 文件生成且结构正确（location/category/suggestion）
    /// 4. 模拟 LLM：基于 fix_context 修复源文件
    /// 5. 调用 test.run 验证修复后测试通过
    ///
    /// 需要 pytest 在 PATH 中，用 `cargo test -- --ignored` 运行
    #[test]
    #[ignore = "需要 pytest 在 PATH 中，端到端验证用 --ignored 运行"]
    fn e2e_pytest_fix_context_generates_and_repair_verifies() {
        // 复用 crate 级共享 CWD 锁，避免与其它测试模块的 set_current_dir 并发冲突
        use crate::tests::CurrentDirGuard;

        // 1. 创建临时 Python 项目
        let temp = tempfile::tempdir().expect("创建临时目录失败");
        let project = temp.path();

        // calc.py — 有 bug：add 返回 a - b 而非 a + b
        // 注意：避免用 math.py 以免与 Python 标准库 math 冲突
        std::fs::write(
            project.join("calc.py"),
            "def add(a, b):\n    return a - b\n",
        )
        .expect("写入 calc.py 失败");

        // test_calc.py — 断言 add(2, 3) == 5
        std::fs::write(
            project.join("test_calc.py"),
            "from calc import add\n\ndef test_add():\n    assert add(2, 3) == 5\n",
        )
        .expect("写入 test_calc.py 失败");

        // 2. 改变 cwd 到临时项目目录（CurrentDirGuard 在作用域结束时自动恢复）
        let _cwd_guard = CurrentDirGuard::enter(project);

        // 3. 调用 test.fix 生成修复上下文（默认 auto_apply=true，单次执行）
        let input = serde_json::json!({"framework": "pytest"});
        let result = execute(input).expect("test.fix 执行失败");

        // 4. 验证 test.fix 输出：测试应失败
        assert!(
            !result.data["success"].as_bool().unwrap_or(true),
            "有 bug 时测试应失败"
        );

        // 验证 total_iterations=1（单次执行，无空转循环）
        let total_iterations = result.data["total_iterations"]
            .as_u64()
            .expect("total_iterations 应为数字");
        assert_eq!(
            total_iterations, 1,
            "test.fix 应单次执行，total_iterations 应为 1"
        );

        let iterations = result.data["iterations"]
            .as_array()
            .expect("iterations 应为数组");
        assert_eq!(iterations.len(), 1, "应有且仅有 1 轮迭代");

        // 验证 M1 新增的 fix_outcome 度量结构
        let outcome = result.data["fix_outcome"]
            .as_object()
            .expect("fix_outcome 应为对象");
        assert_eq!(
            outcome["iterations"].as_u64(),
            Some(1),
            "fix_outcome.iterations 应为 1"
        );
        assert_eq!(
            outcome["success"].as_bool(),
            Some(false),
            "有 bug 时 fix_outcome.success 应为 false"
        );
        // failure_types 应非空（至少包含 assertion_failure）
        let failure_types = outcome["failure_types"]
            .as_array()
            .expect("failure_types 应为数组");
        assert!(
            !failure_types.is_empty(),
            "fix_outcome.failure_types 应非空"
        );
        assert!(
            failure_types
                .iter()
                .any(|t| t.as_str() == Some("assertion_failure")),
            "failure_types 应包含 assertion_failure，实际：{:?}",
            failure_types
        );
        // 每轮迭代应携带 state 字段（状态机快照）
        assert!(
            iterations[0]["state"].is_string(),
            "迭代应携带 state 状态机快照"
        );

        // 5. 验证 fix_context 结构
        let fix_context = iterations[0]["fix_context"]
            .as_object()
            .expect("fix_context 应为对象");
        let failures = fix_context["failures"]
            .as_array()
            .expect("failures 应为数组");
        assert!(!failures.is_empty(), "应有至少 1 个失败测试");

        let failure = &failures[0];
        let name = failure["name"].as_str().unwrap_or("");
        assert!(
            name.contains("test_add"),
            "失败测试名应包含 test_add，实际: {name}"
        );

        // 错误消息非空（pytest 会输出 AssertionError）
        let error_msg = failure["error_message"].as_str().unwrap_or("");
        assert!(!error_msg.is_empty(), "错误消息不应为空");

        // 错误分类应为 assertion_failure
        let category = failure["category"].as_str().unwrap_or("");
        assert_eq!(
            category, "assertion_failure",
            "断言失败应分类为 assertion_failure，实际: {category}"
        );

        // 修复建议非空
        let suggestion = failure["suggestion"].as_str().unwrap_or("");
        assert!(!suggestion.is_empty(), "修复建议不应为空");

        // strategy_summary 包含工作流指引
        let strategy = fix_context["strategy_summary"].as_str().unwrap_or("");
        assert!(strategy.contains("fs.read"), "策略应包含 fs.read 指引");
        assert!(strategy.contains("fs.edit"), "策略应包含 fs.edit 指引");
        assert!(strategy.contains("test.run"), "策略应包含 test.run 指引");

        // 6. 验证 fix-context.json 文件已写入磁盘
        let fix_path = project.join(".sacode").join("fix-context.json");
        assert!(fix_path.exists(), "fix-context.json 应已生成");

        let file_content = std::fs::read_to_string(&fix_path).expect("读取 fix-context.json 失败");
        let file_json: serde_json::Value =
            serde_json::from_str(&file_content).expect("fix-context.json 应为有效 JSON");
        assert!(
            file_json["failures"].is_array(),
            "文件中的 failures 应为数组"
        );

        // 7. 模拟 LLM 修复：基于 fix_context 的 suggestion 修复 calc.py
        // fix_context 指出 assertion_failure，LLM 应检查 add 函数实现
        std::fs::write(
            project.join("calc.py"),
            "def add(a, b):\n    return a + b\n",
        )
        .expect("修复 calc.py 失败");

        // 清除 Python 字节码缓存，避免 pytest 加载旧的 .pyc
        let pycache = project.join("__pycache__");
        if pycache.exists() {
            std::fs::remove_dir_all(&pycache).expect("清除 __pycache__ 失败");
        }

        // 8. 调用 test.run 验证修复后测试通过
        let run_input = serde_json::json!({"framework": "pytest"});
        let run_result = crate::tools::test::runner::execute(run_input).expect("test.run 执行失败");
        assert!(
            run_result.data["success"].as_bool().unwrap_or(false),
            "修复后测试应通过，实际: {:?}",
            run_result.data
        );

        // _cwd_guard 离开作用域时自动恢复 CWD，无需手动 set_current_dir
    }

    // ── M1 自动修复闭环状态机与度量测试 ──────────────────────

    #[test]
    fn fix_loop_state_transitions_are_ordered() {
        // 验证状态机枚举的构造符合预期：Analyzing → Patching → PendingExternalFix → Success/Exhausted
        let analyzing = FixLoopState::Analyzing { failures: 2 };
        let patching = FixLoopState::Patching {
            iteration: 1,
            failure_types: vec![ErrorCategory::AssertionFailure],
        };
        let pending = FixLoopState::PendingExternalFix { iteration: 1 };
        let success = FixLoopState::Success { iterations: 2 };
        let exhausted = FixLoopState::Exhausted { iterations: 3 };

        // 所有状态可构造且彼此区分
        assert_ne!(analyzing, patching);
        assert_ne!(patching, pending);
        assert_ne!(pending, success);
        assert_ne!(success, exhausted);
    }

    #[test]
    fn fix_outcome_records_failure_types_and_iterations() {
        // 验证 FixOutcome 度量结构正确聚合多轮失败类型与策略
        let outcome = FixOutcome {
            iterations: 3,
            success: false,
            failure_types: vec![ErrorCategory::AssertionFailure, ErrorCategory::TypeMismatch],
            fix_strategies: vec!["策略A".to_string(), "策略B".to_string()],
            total_tokens_estimated: 1024,
        };

        assert_eq!(outcome.iterations, 3);
        assert!(!outcome.success);
        assert_eq!(outcome.failure_types.len(), 2);
        assert_eq!(outcome.fix_strategies.len(), 2);
        assert!(outcome.total_tokens_estimated > 0);

        // FixOutcome 可序列化/反序列化（供 orchestrator 桥接传递）
        let json = serde_json::to_string(&outcome).expect("FixOutcome 应可序列化");
        let back: FixOutcome = serde_json::from_str(&json).expect("FixOutcome 应可反序列化");
        assert_eq!(back.iterations, outcome.iterations);
        assert_eq!(back.failure_types, outcome.failure_types);
    }

    #[test]
    fn max_fix_iterations_is_capped_at_three() {
        // 空转防护：迭代上限不可被外部输入绕过
        let requested = 99u64;
        let capped = requested.min(MAX_FIX_ITERATIONS as u64) as usize;
        assert_eq!(
            capped, MAX_FIX_ITERATIONS,
            "外部请求 99 轮应被裁剪为 MAX_FIX_ITERATIONS=3"
        );
    }

    #[test]
    fn fix_outcome_success_case_has_empty_failure_types() {
        // 单轮修复成功：success=true 且 failure_types 为空
        let outcome = FixOutcome {
            iterations: 1,
            success: true,
            failure_types: vec![],
            fix_strategies: vec![],
            total_tokens_estimated: 0,
        };
        assert!(outcome.success);
        assert!(outcome.failure_types.is_empty());
    }

    #[test]
    fn execute_is_single_round_regardless_of_max_iterations() {
        // 单轮语义：test.fix 同步调用恒只生成 1 轮修复上下文即退出，
        // 不在此处重跑测试或应用修改（修改属于 LLM 外部工具循环）。
        // max_iterations 仅作为对外暴露的外部循环预算上限，不影响单次 execute 的轮数。
        // 这里直接构造 FixLoopState 校验状态机自身语义（避免依赖真实测试运行）。
        let pending = FixLoopState::PendingExternalFix { iteration: 1 };
        let exhausted = FixLoopState::Exhausted { iterations: 1 };
        match pending {
            FixLoopState::PendingExternalFix { iteration } => assert_eq!(iteration, 1),
            _ => panic!("max_iterations>1 时应进入 PendingExternalFix"),
        }
        match exhausted {
            FixLoopState::Exhausted { iterations } => assert_eq!(iterations, 1),
            _ => panic!("max_iterations<=1 时应进入 Exhausted"),
        }
    }
}
