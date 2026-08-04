//! 灵枢 · 自愈合 — 任务画像与模型路由
//!
//! 核心模块：任务特征分析、模型评分、故障转移上下文
//! 对应 AGENTS.md 中「自愈合 — 故障转移路由」
//!
//! 主要数据结构：
//! - TaskProfile：任务画像（语言、框架、表面、风险级别）
//! - ModelRoutePlan：路由计划（主模型 + 备选列表）
//! - FailoverContext：故障切换上下文

use std::path::Path;

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct TaskProfile {
    pub languages: Vec<String>,
    pub frameworks: Vec<String>,
    pub surfaces: Vec<String>,
    pub task_kinds: Vec<String>,
    pub needs_reasoning: bool,
    pub risk_level: TaskRiskLevel,
    pub evidence: Vec<String>,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
pub enum TaskRiskLevel {
    #[default]
    Low,
    Medium,
    High,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RoutedModel {
    pub provider_name: String,
    pub model_name: String,
    pub route_score: i32,
    pub needs_thinking: bool,
    pub reasons: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelRoutePlan {
    pub primary: RoutedModel,
    pub fallbacks: Vec<RoutedModel>,
    pub route_reason: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExecutionNode {
    pub provider_name: String,
    pub model_name: String,
    pub prompt_digest: String,
    pub tool_calls: Vec<NodeToolCall>,
    pub final_text: String,
    pub duration_ms: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NodeToolCall {
    pub name: String,
    pub success: bool,
    pub summary: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum NodeDecision {
    Accept,
    SwitchModel,
    WaitForUser,
    WaitForApproval,
    Fail,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NodeScore {
    pub decision: NodeDecision,
    pub reasons: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FailoverContext {
    pub original_task: String,
    pub completed_steps: Vec<String>,
    pub tool_summary: Vec<String>,
    pub last_error: Option<String>,
    pub low_score_reasons: Vec<String>,
    pub workspace_summary: Vec<String>,
    pub retained_facts: Vec<String>,
}

impl TaskProfile {
    pub fn from_prompt_and_workspace(prompt: &str, workdir: &Path) -> Self {
        let mut profile = Self::default();
        let lower = prompt.to_lowercase();
        let prompt_words: Vec<&str> = lower.split_whitespace().collect();

        detect_languages(&mut profile, &prompt_words, workdir);
        detect_frameworks(&mut profile, &prompt_words);
        detect_surfaces(&mut profile, &prompt_words, workdir);
        detect_task_kinds(&mut profile, &prompt_words);
        detect_reasoning(&mut profile, &lower);
        infer_risk_level(&mut profile);

        profile
    }
}

fn detect_languages(profile: &mut TaskProfile, prompt_words: &[&str], workdir: &Path) {
    if prompt_words.iter().any(|w| ["rust", "cargo"].contains(w)) {
        push_unique(&mut profile.languages, "rust");
        profile
            .evidence
            .push("prompt mentions rust/cargo".to_string());
    }
    if workdir.join("Cargo.toml").exists() {
        push_unique(&mut profile.languages, "rust");
        profile.evidence.push("Cargo.toml exists".to_string());
    }

    if prompt_words.iter().any(|w| ["go", "golang"].contains(w)) {
        push_unique(&mut profile.languages, "go");
        profile
            .evidence
            .push("prompt mentions go/golang".to_string());
    }
    if workdir.join("go.mod").exists() {
        push_unique(&mut profile.languages, "go");
        profile.evidence.push("go.mod exists".to_string());
    }

    if prompt_words
        .iter()
        .any(|w| ["python", "django", "fastapi"].contains(w))
    {
        push_unique(&mut profile.languages, "python");
        profile
            .evidence
            .push("prompt mentions python/django/fastapi".to_string());
    }
    if workdir.join("pyproject.toml").exists() || workdir.join("requirements.txt").exists() {
        push_unique(&mut profile.languages, "python");
        profile
            .evidence
            .push("pyproject.toml or requirements.txt exists".to_string());
    }

    if prompt_words
        .iter()
        .any(|w| ["node", "npm", "yarn", "pnpm"].contains(w))
    {
        push_unique(&mut profile.languages, "node");
        profile
            .evidence
            .push("prompt mentions node/npm/yarn/pnpm".to_string());
    }
    if workdir.join("package.json").exists() {
        push_unique(&mut profile.languages, "node");
        profile.evidence.push("package.json exists".to_string());
    }
}

fn detect_frameworks(profile: &mut TaskProfile, prompt_words: &[&str]) {
    if prompt_words
        .iter()
        .any(|w| ["react", "jsx", "tsx"].contains(w))
    {
        push_unique(&mut profile.frameworks, "react");
        profile
            .evidence
            .push("prompt mentions react/jsx/tsx".to_string());
    }
    if prompt_words.iter().any(|w| ["vue"].contains(w)) {
        push_unique(&mut profile.frameworks, "vue");
        profile.evidence.push("prompt mentions vue".to_string());
    }
    if prompt_words.iter().any(|w| ["next", "nextjs"].contains(w)) {
        push_unique(&mut profile.frameworks, "next");
        profile
            .evidence
            .push("prompt mentions next/nextjs".to_string());
    }
}

fn detect_surfaces(profile: &mut TaskProfile, prompt_words: &[&str], workdir: &Path) {
    if workdir.join("interfaces/cli").exists() {
        push_unique(&mut profile.surfaces, "cli");
        profile.evidence.push("interfaces/cli exists".to_string());
    }
    if workdir.join("interfaces/tui").exists() || prompt_words.iter().any(|w| ["tui"].contains(w)) {
        push_unique(&mut profile.surfaces, "tui");
        profile
            .evidence
            .push("interfaces/tui exists or prompt mentions tui".to_string());
    }
    if workdir.join("interfaces/lsp").exists() {
        push_unique(&mut profile.surfaces, "lsp");
        profile.evidence.push("interfaces/lsp exists".to_string());
    }
    if workdir.join("runtime").exists() {
        push_unique(&mut profile.surfaces, "runtime");
        profile.evidence.push("runtime exists".to_string());
    }
    if workdir.join("kernel").exists() {
        push_unique(&mut profile.surfaces, "kernel");
        profile.evidence.push("kernel exists".to_string());
    }
}

fn detect_task_kinds(profile: &mut TaskProfile, prompt_words: &[&str]) {
    if prompt_words
        .iter()
        .any(|w| ["implement", "实现", "添加", "增加"].contains(w))
    {
        push_unique(&mut profile.task_kinds, "implementation");
    }
    if prompt_words
        .iter()
        .any(|w| ["refactor", "重构"].contains(w))
    {
        push_unique(&mut profile.task_kinds, "refactor");
    }
    if prompt_words
        .iter()
        .any(|w| ["bug", "fix", "修复"].contains(w))
    {
        push_unique(&mut profile.task_kinds, "bugfix");
    }
    if prompt_words.iter().any(|w| ["test", "测试"].contains(w)) {
        push_unique(&mut profile.task_kinds, "test");
    }
    if prompt_words
        .iter()
        .any(|w| ["doc", "文档", "readme"].contains(w))
    {
        push_unique(&mut profile.task_kinds, "docs");
    }
}

fn detect_reasoning(profile: &mut TaskProfile, lower_prompt: &str) {
    let reasoning_keywords = [
        "架构",
        "设计",
        "分析",
        "评估",
        "决策",
        "重构",
        "优化",
        "梳理",
        "收敛",
        "architect",
        "design",
        "analyze",
        "evaluate",
        "refactor",
        "optimize",
    ];
    if reasoning_keywords.iter().any(|k| lower_prompt.contains(k)) {
        profile.needs_reasoning = true;
        profile
            .evidence
            .push("prompt indicates reasoning-heavy task".to_string());
    }
}

fn infer_risk_level(profile: &mut TaskProfile) {
    if profile.languages.iter().any(|lang| lang == "rust")
        && profile
            .task_kinds
            .iter()
            .any(|kind| kind == "implementation")
    {
        profile.risk_level = TaskRiskLevel::Medium;
    }
    if profile.languages.iter().any(|lang| lang == "rust")
        && profile.surfaces.iter().any(|surface| surface == "cli")
        && profile.surfaces.iter().any(|surface| surface == "tui")
    {
        profile.risk_level = TaskRiskLevel::High;
        profile
            .evidence
            .push("multi-surface rust implementation is high risk".to_string());
    }
}

fn push_unique(values: &mut Vec<String>, value: &str) {
    if !values.iter().any(|existing| existing == value) {
        values.push(value.to_string());
    }
}

impl NodeScore {
    pub fn evaluate(
        provider_error: Option<&str>,
        final_text: &str,
        tool_calls: &[NodeToolCall],
        profile: &TaskProfile,
    ) -> Self {
        let mut reasons = Vec::new();

        if let Some(error) = provider_error {
            let lower = error.to_lowercase();
            if lower.contains("timeout") || lower.contains("timed out") {
                reasons.push("provider timeout, switching model".to_string());
            } else if lower.contains("rate limit") || lower.contains("429") {
                reasons.push("rate limited, switching model".to_string());
            } else if lower.contains("401")
                || lower.contains("403")
                || lower.contains("unauthorized")
            {
                reasons.push("authentication error, switching model".to_string());
            } else if lower.contains("503")
                || lower.contains("502")
                || lower.contains("unavailable")
            {
                reasons.push("service unavailable, switching model".to_string());
            } else {
                reasons.push(format!("provider error: {}", error));
            }
            return Self {
                decision: NodeDecision::SwitchModel,
                reasons,
            };
        }

        if final_text.trim().is_empty() {
            reasons.push("empty response from model".to_string());
            return Self {
                decision: NodeDecision::SwitchModel,
                reasons,
            };
        }

        let failed_tools: Vec<&str> = tool_calls
            .iter()
            .filter(|tc| !tc.success)
            .map(|tc| tc.name.as_str())
            .collect();
        if failed_tools.len() > tool_calls.len() / 2 && tool_calls.len() > 2 {
            reasons.push(format!("majority of tools failed: {:?}", failed_tools));
            return Self {
                decision: NodeDecision::SwitchModel,
                reasons,
            };
        }

        let lower_text = final_text.to_lowercase();
        let refusal_patterns = [
            "i cannot",
            "i'm unable",
            "i am unable",
            "i can't",
            "无法",
            "不能",
            "不支持",
            "我不能",
        ];
        for pattern in refusal_patterns {
            if lower_text.contains(pattern) && lower_text.len() < 300 {
                reasons.push("model indicates inability to proceed".to_string());
                return Self {
                    decision: NodeDecision::SwitchModel,
                    reasons,
                };
            }
        }

        let vague_patterns = [
            "i don't have enough information",
            "i need more context",
            "please provide more details",
            "could you clarify",
        ];
        for pattern in vague_patterns {
            if lower_text.contains(pattern) && lower_text.len() < 400 {
                reasons.push(format!(
                    "model asks for clarification without progress: {}",
                    pattern
                ));
            }
        }

        if !profile.languages.is_empty() {
            let text_mentions_language = profile
                .languages
                .iter()
                .any(|lang| lower_text.contains(&lang.to_lowercase()));
            if !text_mentions_language && tool_calls.is_empty() && lower_text.len() > 500 {
                reasons.push("response does not reflect expected language context".to_string());
            }
        }

        let repetition_patterns = [
            "as i mentioned",
            "as mentioned earlier",
            "如前所述",
            "as discussed",
            "to reiterate",
        ];
        let mut repetition_count = 0;
        for pattern in repetition_patterns {
            if lower_text.contains(pattern) {
                repetition_count += 1;
            }
        }
        if repetition_count >= 2 {
            reasons.push("response contains repetitive patterns".to_string());
        }

        let code_indicators = ["```", "fn ", "impl ", "struct ", "class ", "def ", "func "];
        let has_code = code_indicators.iter().any(|ind| final_text.contains(ind));
        if profile.task_kinds.contains(&"implementation".to_string())
            && !has_code
            && tool_calls.is_empty()
        {
            reasons.push("implementation task but no code or tool usage".to_string());
        }

        if reasons.is_empty() {
            Self {
                decision: NodeDecision::Accept,
                reasons: vec!["node completed successfully".to_string()],
            }
        } else if reasons.len() >= 2 {
            Self {
                decision: NodeDecision::SwitchModel,
                reasons,
            }
        } else {
            Self {
                decision: NodeDecision::Accept,
                reasons,
            }
        }
    }
}

impl FailoverContext {
    pub fn to_prompt_section(&self) -> String {
        let mut lines = vec!["[Failover Context]".to_string()];

        lines.push("Original Task:".to_string());
        lines.push(self.original_task.clone());

        if !self.completed_steps.is_empty() {
            lines.push("Completed Steps:".to_string());
            for step in &self.completed_steps {
                lines.push(format!("- {}", step));
            }
        }

        if !self.tool_summary.is_empty() {
            lines.push("Tool Summary:".to_string());
            for summary in &self.tool_summary {
                lines.push(format!("- {}", summary));
            }
        }

        if let Some(error) = &self.last_error {
            lines.push("Last Error:".to_string());
            lines.push(error.clone());
        }

        if !self.low_score_reasons.is_empty() {
            lines.push("Low Score Reasons:".to_string());
            for reason in &self.low_score_reasons {
                lines.push(format!("- {}", reason));
            }
        }

        if !self.workspace_summary.is_empty() {
            lines.push("Workspace Summary:".to_string());
            for summary in &self.workspace_summary {
                lines.push(format!("- {}", summary));
            }
        }

        if !self.retained_facts.is_empty() {
            lines.push("Retained Facts:".to_string());
            for fact in &self.retained_facts {
                lines.push(format!("- {}", fact));
            }
        }

        lines.join("\n")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn task_profile_detects_rust_from_cargo_toml() {
        let temp_dir = tempfile::tempdir().expect("create temp dir");
        let workdir = temp_dir.path();
        std::fs::write(workdir.join("Cargo.toml"), "[package]\nname = \"test\"")
            .expect("write cargo");

        let profile = TaskProfile::from_prompt_and_workspace("帮我实现一个函数", workdir);

        assert!(profile.languages.contains(&"rust".to_string()));
        assert!(profile.evidence.iter().any(|e| e.contains("Cargo.toml")));
    }

    #[test]
    fn task_profile_detects_framework_from_prompt() {
        let temp_dir = tempfile::tempdir().expect("create temp dir");
        let workdir = temp_dir.path();
        std::fs::write(workdir.join("package.json"), "{}").expect("write package.json");

        let profile = TaskProfile::from_prompt_and_workspace("用 React 实现一个组件", workdir);

        assert!(profile.languages.contains(&"node".to_string()));
        assert!(profile.frameworks.contains(&"react".to_string()));
    }

    #[test]
    fn task_profile_detects_reasoning_task() {
        let temp_dir = tempfile::tempdir().expect("create temp dir");
        let workdir = temp_dir.path();

        let profile = TaskProfile::from_prompt_and_workspace("分析这个架构的设计问题", workdir);

        assert!(profile.needs_reasoning);
    }

    #[test]
    fn node_score_switches_on_provider_error() {
        let profile = TaskProfile::default();
        let score = NodeScore::evaluate(Some("timeout after 30s"), "some response", &[], &profile);

        assert_eq!(score.decision, NodeDecision::SwitchModel);
        assert!(score.reasons.iter().any(|r| r.contains("timeout")));
    }

    #[test]
    fn node_score_switches_on_empty_response() {
        let profile = TaskProfile::default();
        let score = NodeScore::evaluate(None, "   ", &[], &profile);

        assert_eq!(score.decision, NodeDecision::SwitchModel);
        assert!(score.reasons.iter().any(|r| r.contains("empty")));
    }

    #[test]
    fn node_score_accepts_valid_response() {
        let profile = TaskProfile::default();
        let score = NodeScore::evaluate(
            None,
            "这是函数实现：\n```rust\nfn main() {}\n```",
            &[],
            &profile,
        );

        assert_eq!(score.decision, NodeDecision::Accept);
    }

    #[test]
    fn node_score_switches_on_refusal_pattern() {
        let profile = TaskProfile::default();
        let score = NodeScore::evaluate(None, "I cannot help with this request.", &[], &profile);

        assert_eq!(score.decision, NodeDecision::SwitchModel);
        assert!(score.reasons.iter().any(|r| r.contains("inability")));
    }

    #[test]
    fn failover_context_generates_section() {
        let ctx = FailoverContext {
            original_task: "实现一个函数".to_string(),
            completed_steps: vec!["读取文件".to_string()],
            tool_summary: vec!["fs.read 成功".to_string()],
            last_error: Some("provider timeout".to_string()),
            low_score_reasons: vec!["响应为空".to_string()],
            workspace_summary: vec!["Rust 项目".to_string()],
            retained_facts: vec!["使用 tokio".to_string()],
        };

        let section = ctx.to_prompt_section();

        assert!(section.contains("[Failover Context]"));
        assert!(section.contains("Original Task:"));
        assert!(section.contains("实现一个函数"));
        assert!(section.contains("Last Error:"));
        assert!(section.contains("provider timeout"));
    }

    // ── 故障转移路由 · 模型切换实战覆盖 ──────────────────────

    #[test]
    fn node_score_switches_on_rate_limit_error() {
        // 429 / rate limit 错误应触发切换
        let profile = TaskProfile::default();

        let score = NodeScore::evaluate(Some("rate limit exceeded (429)"), "response", &[], &profile);
        assert_eq!(score.decision, NodeDecision::SwitchModel);
        assert!(score.reasons.iter().any(|r| r.contains("rate limited")));
    }

    #[test]
    fn node_score_switches_on_authentication_error() {
        // 401 / 403 / unauthorized 错误应触发切换
        let profile = TaskProfile::default();

        let score = NodeScore::evaluate(Some("401 unauthorized"), "response", &[], &profile);
        assert_eq!(score.decision, NodeDecision::SwitchModel);
        assert!(score.reasons.iter().any(|r| r.contains("authentication error")));
    }

    #[test]
    fn node_score_switches_on_service_unavailable() {
        // 502 / 503 / unavailable 错误应触发切换
        let profile = TaskProfile::default();

        let score = NodeScore::evaluate(Some("503 service unavailable"), "response", &[], &profile);
        assert_eq!(score.decision, NodeDecision::SwitchModel);
        assert!(score.reasons.iter().any(|r| r.contains("service unavailable")));
    }

    #[test]
    fn node_score_switches_on_generic_provider_error() {
        // 未分类的 provider 错误应进入兜底分支并触发切换
        let profile = TaskProfile::default();

        let score = NodeScore::evaluate(Some("network reset"), "response", &[], &profile);
        assert_eq!(score.decision, NodeDecision::SwitchModel);
        assert!(score.reasons.iter().any(|r| r.contains("provider error: network reset")));
    }

    #[test]
    fn node_score_switches_on_majority_tool_failures() {
        // 工具数 > 2 且失败数过半时应触发切换
        let profile = TaskProfile::default();
        let tool_calls = vec![
            NodeToolCall {
                name: "fs.read".to_string(),
                success: false,
                summary: "fail".to_string(),
            },
            NodeToolCall {
                name: "fs.write".to_string(),
                success: false,
                summary: "fail".to_string(),
            },
            NodeToolCall {
                name: "shell.exec".to_string(),
                success: true,
                summary: "ok".to_string(),
            },
        ];

        let score = NodeScore::evaluate(None, "partial result", &tool_calls, &profile);
        assert_eq!(score.decision, NodeDecision::SwitchModel);
        assert!(score.reasons.iter().any(|r| r.contains("majority of tools failed")));
    }

    #[test]
    fn node_score_does_not_switch_when_tool_count_below_threshold() {
        // 工具数 ≤ 2 时不触发 majority 切换（即使全部失败）
        let profile = TaskProfile::default();
        let tool_calls = vec![
            NodeToolCall {
                name: "fs.read".to_string(),
                success: false,
                summary: "fail".to_string(),
            },
            NodeToolCall {
                name: "fs.write".to_string(),
                success: false,
                summary: "fail".to_string(),
            },
        ];

        let score = NodeScore::evaluate(None, "all good", &tool_calls, &profile);
        assert_eq!(score.decision, NodeDecision::Accept);
    }

    #[test]
    fn node_score_switches_on_compound_low_signals() {
        // 多个低分信号叠加（≥2 个 reason）应触发切换
        // 这里组合：重复模式 + 模糊信号 + 实现任务无代码
        let profile = TaskProfile {
            task_kinds: vec!["implementation".to_string()],
            ..Default::default()
        };
        // 短响应避免触发 refusal 长度阈值
        let response = "as i mentioned earlier, as discussed, to reiterate. i need more context to proceed.";

        let score = NodeScore::evaluate(None, response, &[], &profile);
        assert_eq!(score.decision, NodeDecision::SwitchModel);
        // 至少 2 个 reason 被记录
        assert!(
            score.reasons.len() >= 2,
            "应至少记录 2 个低分信号，实际：{:?}",
            score.reasons
        );
    }

    #[test]
    fn node_score_accepts_with_single_vague_signal() {
        // 单个模糊信号应保持 Accept（仅记录 reason）
        let profile = TaskProfile::default();
        let response = "i need more context to understand the task";

        let score = NodeScore::evaluate(None, response, &[], &profile);
        assert_eq!(score.decision, NodeDecision::Accept);
        assert!(score.reasons.iter().any(|r| r.contains("asks for clarification")));
    }

    #[test]
    fn node_score_flags_repetition_pattern() {
        // 2 个以上重复模式短语应记录重复 reason
        let profile = TaskProfile::default();
        let response = "as i mentioned earlier, as discussed, the design is solid.";

        let score = NodeScore::evaluate(None, response, &[], &profile);
        // 单一 reason → Accept，但 reason 应包含 "repetitive"
        assert!(score.reasons.iter().any(|r| r.contains("repetitive")));
    }

    #[test]
    fn node_score_flags_implementation_task_without_code() {
        // 实现类任务但无代码块 / 无工具调用 → 记录 reason
        let profile = TaskProfile {
            task_kinds: vec!["implementation".to_string()],
            ..Default::default()
        };

        let score = NodeScore::evaluate(None, "正在分析问题", &[], &profile);
        assert_eq!(score.decision, NodeDecision::Accept);
        assert!(
            score.reasons
                .iter()
                .any(|r| r.contains("implementation task but no code"))
        );
    }

    #[test]
    fn node_score_accepts_implementation_task_with_code() {
        // 实现类任务但响应包含代码块 → 不应记录 "no code" reason
        let profile = TaskProfile {
            task_kinds: vec!["implementation".to_string()],
            ..Default::default()
        };
        let response = "实现如下：\n```rust\nfn add(a: i32, b: i32) -> i32 { a + b }\n```";

        let score = NodeScore::evaluate(None, response, &[], &profile);
        assert_eq!(score.decision, NodeDecision::Accept);
        assert!(
            !score
                .reasons
                .iter()
                .any(|r| r.contains("implementation task but no code")),
            "包含代码块时不应标记 'no code'"
        );
    }

    #[test]
    fn node_score_does_not_flag_refusal_in_long_response() {
        // 长响应（> 300 字节）中的 refusal 短语不应触发立即切换
        let profile = TaskProfile::default();
        let long_response =
            "Here is a detailed analysis of the architecture. I cannot fit everything in a single \
             response, so I will focus on the main components. \
             The system consists of multiple layers including the kernel, runtime, and interfaces. \
             Each layer has distinct responsibilities and dependencies flow strictly downward. \
             This design ensures separation of concerns and testability. \
             The kernel holds pure execution logic and shared data structures.";

        let score = NodeScore::evaluate(None, long_response, &[], &profile);
        // 长响应不应触发 refusal 立即切换
        assert_ne!(score.decision, NodeDecision::SwitchModel);
    }

    // ── FailoverContext 状态机实战覆盖 ──────────────────────

    #[test]
    fn failover_context_minimal_only_original_task() {
        // 仅 original_task 字段时，其他可选小节不应出现在输出中
        let ctx = FailoverContext {
            original_task: "实现功能 X".to_string(),
            completed_steps: Vec::new(),
            tool_summary: Vec::new(),
            last_error: None,
            low_score_reasons: Vec::new(),
            workspace_summary: Vec::new(),
            retained_facts: Vec::new(),
        };

        let section = ctx.to_prompt_section();

        assert!(section.contains("[Failover Context]"));
        assert!(section.contains("Original Task:"));
        assert!(section.contains("实现功能 X"));
        // 空字段对应的小节不应出现
        assert!(!section.contains("Completed Steps:"));
        assert!(!section.contains("Tool Summary:"));
        assert!(!section.contains("Last Error:"));
        assert!(!section.contains("Low Score Reasons:"));
        assert!(!section.contains("Workspace Summary:"));
        assert!(!section.contains("Retained Facts:"));
    }

    #[test]
    fn failover_context_renders_all_sections() {
        // 所有字段填充时，每个小节都应出现且格式正确
        let ctx = FailoverContext {
            original_task: "重构鉴权模块".to_string(),
            completed_steps: vec!["读取 auth.rs".to_string(), "解析依赖".to_string()],
            tool_summary: vec!["fs.read 成功".to_string()],
            last_error: Some("provider timeout".to_string()),
            low_score_reasons: vec!["响应为空".to_string(), "缺少代码块".to_string()],
            workspace_summary: vec!["Rust workspace".to_string()],
            retained_facts: vec!["使用 tokio runtime".to_string(), "auth 模块在 src/auth".to_string()],
        };

        let section = ctx.to_prompt_section();

        // 验证每个小节标题与条目都出现
        assert!(section.contains("Completed Steps:"));
        assert!(section.contains("- 读取 auth.rs"));
        assert!(section.contains("- 解析依赖"));
        assert!(section.contains("Tool Summary:"));
        assert!(section.contains("- fs.read 成功"));
        assert!(section.contains("Last Error:"));
        assert!(section.contains("provider timeout"));
        assert!(section.contains("Low Score Reasons:"));
        assert!(section.contains("- 响应为空"));
        assert!(section.contains("- 缺少代码块"));
        assert!(section.contains("Workspace Summary:"));
        assert!(section.contains("- Rust workspace"));
        assert!(section.contains("Retained Facts:"));
        assert!(section.contains("- 使用 tokio runtime"));
        assert!(section.contains("- auth 模块在 src/auth"));
    }

    // ── TaskProfile 任务画像实战覆盖 ──────────────────────

    #[test]
    fn task_profile_infers_high_risk_for_multi_surface_rust() {
        // Rust + cli + tui 多界面实现应判为高风险
        let temp_dir = tempfile::tempdir().expect("create temp dir");
        let workdir = temp_dir.path();
        std::fs::write(workdir.join("Cargo.toml"), "[package]\nname = \"test\"").expect("write cargo");
        std::fs::create_dir_all(workdir.join("interfaces/cli")).expect("create cli dir");
        std::fs::create_dir_all(workdir.join("interfaces/tui")).expect("create tui dir");

        let profile = TaskProfile::from_prompt_and_workspace("implement new feature", workdir);

        assert_eq!(profile.risk_level, TaskRiskLevel::High);
        assert!(profile.evidence.iter().any(|e| e.contains("high risk")));
        assert!(profile.surfaces.contains(&"cli".to_string()));
        assert!(profile.surfaces.contains(&"tui".to_string()));
    }

    #[test]
    fn task_profile_infers_medium_risk_for_rust_implementation() {
        // Rust + 实现类任务应判为中风险
        let temp_dir = tempfile::tempdir().expect("create temp dir");
        let workdir = temp_dir.path();
        std::fs::write(workdir.join("Cargo.toml"), "[package]\nname = \"test\"").expect("write cargo");

        let profile = TaskProfile::from_prompt_and_workspace("implement new feature", workdir);

        assert_eq!(profile.risk_level, TaskRiskLevel::Medium);
        assert!(profile.task_kinds.contains(&"implementation".to_string()));
    }

    #[test]
    fn task_profile_detects_go_workspace() {
        // go.mod 存在时应识别为 go 语言
        let temp_dir = tempfile::tempdir().expect("create temp dir");
        let workdir = temp_dir.path();
        std::fs::write(workdir.join("go.mod"), "module example\n\ngo 1.21").expect("write go.mod");

        let profile = TaskProfile::from_prompt_and_workspace("refactor the module", workdir);

        assert!(profile.languages.contains(&"go".to_string()));
        assert!(profile.evidence.iter().any(|e| e.contains("go.mod")));
        assert!(profile.task_kinds.contains(&"refactor".to_string()));
    }

    #[test]
    fn task_profile_detects_python_workspace() {
        // requirements.txt 存在时应识别为 python 语言
        let temp_dir = tempfile::tempdir().expect("create temp dir");
        let workdir = temp_dir.path();
        std::fs::write(workdir.join("requirements.txt"), "fastapi\nuvicorn").expect("write requirements");

        let profile = TaskProfile::from_prompt_and_workspace("fix the bug", workdir);

        assert!(profile.languages.contains(&"python".to_string()));
        assert!(profile.evidence.iter().any(|e| e.contains("pyproject.toml or requirements.txt")));
        assert!(profile.task_kinds.contains(&"bugfix".to_string()));
    }

    #[test]
    fn task_profile_detects_all_task_kinds_from_prompt() {
        // 包含所有任务类型关键词的 prompt 应识别全部 5 类
        let temp_dir = tempfile::tempdir().expect("create temp dir");
        let workdir = temp_dir.path();

        let profile = TaskProfile::from_prompt_and_workspace(
            "implement test doc refactor fix for the module",
            workdir,
        );

        assert!(profile.task_kinds.contains(&"implementation".to_string()));
        assert!(profile.task_kinds.contains(&"test".to_string()));
        assert!(profile.task_kinds.contains(&"docs".to_string()));
        assert!(profile.task_kinds.contains(&"refactor".to_string()));
        assert!(profile.task_kinds.contains(&"bugfix".to_string()));
    }

    #[test]
    fn task_profile_detects_node_and_react_framework() {
        // package.json + React 关键词应同时识别 node 语言和 react 框架
        let temp_dir = tempfile::tempdir().expect("create temp dir");
        let workdir = temp_dir.path();
        std::fs::write(workdir.join("package.json"), "{}").expect("write package.json");

        let profile = TaskProfile::from_prompt_and_workspace("implement react component", workdir);

        assert!(profile.languages.contains(&"node".to_string()));
        assert!(profile.frameworks.contains(&"react".to_string()));
        assert!(profile.task_kinds.contains(&"implementation".to_string()));
    }

    #[test]
    fn task_profile_detects_reasoning_for_chinese_keywords() {
        // 中文「分析 / 设计 / 重构 / 优化」等关键词应触发 needs_reasoning
        let temp_dir = tempfile::tempdir().expect("create temp dir");
        let workdir = temp_dir.path();

        let profile = TaskProfile::from_prompt_and_workspace("分析当前架构设计并重构优化", workdir);

        assert!(profile.needs_reasoning);
        assert!(
            profile
                .evidence
                .iter()
                .any(|e| e.contains("reasoning-heavy task"))
        );
    }
}
