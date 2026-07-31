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
}
