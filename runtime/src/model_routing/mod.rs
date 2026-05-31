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

        if prompt_words.iter().any(|w| ["rust", "cargo"].contains(w)) {
            profile.languages.push("rust".to_string());
            profile.evidence.push("prompt mentions rust/cargo".to_string());
        }
        if workdir.join("Cargo.toml").exists() {
            if !profile.languages.contains(&"rust".to_string()) {
                profile.languages.push("rust".to_string());
            }
            profile.evidence.push("Cargo.toml exists".to_string());
        }

        if prompt_words.iter().any(|w| ["go", "golang"].contains(w)) {
            profile.languages.push("go".to_string());
            profile.evidence.push("prompt mentions go/golang".to_string());
        }
        if workdir.join("go.mod").exists() {
            if !profile.languages.contains(&"go".to_string()) {
                profile.languages.push("go".to_string());
            }
            profile.evidence.push("go.mod exists".to_string());
        }

        if prompt_words.iter().any(|w| ["python", "django", "fastapi"].contains(w)) {
            profile.languages.push("python".to_string());
            profile.evidence.push("prompt mentions python/django/fastapi".to_string());
        }
        if workdir.join("pyproject.toml").exists() || workdir.join("requirements.txt").exists() {
            if !profile.languages.contains(&"python".to_string()) {
                profile.languages.push("python".to_string());
            }
            profile.evidence.push("pyproject.toml or requirements.txt exists".to_string());
        }

        if prompt_words.iter().any(|w| ["node", "npm", "yarn", "pnpm"].contains(w)) {
            profile.languages.push("node".to_string());
            profile.evidence.push("prompt mentions node/npm/yarn/pnpm".to_string());
        }
        if workdir.join("package.json").exists() {
            if !profile.languages.contains(&"node".to_string()) {
                profile.languages.push("node".to_string());
            }
            profile.evidence.push("package.json exists".to_string());
        }

        if prompt_words.iter().any(|w| ["react", "jsx", "tsx"].contains(w)) {
            profile.frameworks.push("react".to_string());
            profile.evidence.push("prompt mentions react/jsx/tsx".to_string());
        }
        if prompt_words.iter().any(|w| ["vue"].contains(w)) {
            profile.frameworks.push("vue".to_string());
            profile.evidence.push("prompt mentions vue".to_string());
        }
        if prompt_words.iter().any(|w| ["next", "nextjs"].contains(w)) {
            profile.frameworks.push("next".to_string());
            profile.evidence.push("prompt mentions next/nextjs".to_string());
        }

        if workdir.join("interfaces/cli").exists() {
            profile.surfaces.push("cli".to_string());
            profile.evidence.push("interfaces/cli exists".to_string());
        }
        if workdir.join("interfaces/tui").exists() || prompt_words.iter().any(|w| ["tui"].contains(w)) {
            profile.surfaces.push("tui".to_string());
            profile.evidence.push("interfaces/tui exists or prompt mentions tui".to_string());
        }
        if workdir.join("interfaces/lsp").exists() {
            profile.surfaces.push("lsp".to_string());
            profile.evidence.push("interfaces/lsp exists".to_string());
        }
        if workdir.join("runtime").exists() {
            profile.surfaces.push("runtime".to_string());
            profile.evidence.push("runtime exists".to_string());
        }
        if workdir.join("kernel").exists() {
            profile.surfaces.push("kernel".to_string());
            profile.evidence.push("kernel exists".to_string());
        }

        if prompt_words.iter().any(|w| ["implement", "实现", "添加", "增加"].contains(w)) {
            profile.task_kinds.push("implementation".to_string());
        }
        if prompt_words.iter().any(|w| ["refactor", "重构"].contains(w)) {
            profile.task_kinds.push("refactor".to_string());
        }
        if prompt_words.iter().any(|w| ["bug", "fix", "修复"].contains(w)) {
            profile.task_kinds.push("bugfix".to_string());
        }
        if prompt_words.iter().any(|w| ["test", "测试"].contains(w)) {
            profile.task_kinds.push("test".to_string());
        }
        if prompt_words.iter().any(|w| ["doc", "文档", "readme"].contains(w)) {
            profile.task_kinds.push("docs".to_string());
        }

        let reasoning_keywords = [
            "架构", "设计", "分析", "评估", "决策",
            "重构", "优化", "梳理", "收敛",
            "architect", "design", "analyze", "evaluate",
            "refactor", "optimize",
        ];
        if reasoning_keywords.iter().any(|k| lower.contains(k)) {
            profile.needs_reasoning = true;
            profile.evidence.push("prompt indicates reasoning-heavy task".to_string());
        }

        if profile.languages.contains(&"rust".to_string()) && profile.task_kinds.contains(&"implementation".to_string()) {
            profile.risk_level = TaskRiskLevel::Medium;
        }
        if profile.languages.contains(&"rust".to_string()) && profile.surfaces.contains(&"cli".to_string()) && profile.surfaces.contains(&"tui".to_string()) {
            profile.risk_level = TaskRiskLevel::High;
            profile.evidence.push("multi-surface rust implementation is high risk".to_string());
        }

        profile
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
            } else if lower.contains("401") || lower.contains("403") || lower.contains("unauthorized") {
                reasons.push("authentication error, switching model".to_string());
            } else if lower.contains("503") || lower.contains("502") || lower.contains("unavailable") {
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
            "i cannot", "i'm unable", "i am unable", "i can't",
            "无法", "不能", "不支持", "我不能",
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
                reasons.push(format!("model asks for clarification without progress: {}", pattern));
            }
        }

        if !profile.languages.is_empty() {
            let text_mentions_language = profile.languages.iter().any(|lang| {
                lower_text.contains(&lang.to_lowercase())
            });
            if !text_mentions_language && tool_calls.is_empty() && lower_text.len() > 500 {
                reasons.push("response does not reflect expected language context".to_string());
            }
        }

        let repetition_patterns = [
            "as i mentioned", "as mentioned earlier", "如前所述",
            "as discussed", "to reiterate",
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
        if profile.task_kinds.contains(&"implementation".to_string()) && !has_code && tool_calls.is_empty() {
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
        std::fs::write(workdir.join("Cargo.toml"), "[package]\nname = \"test\"").expect("write cargo");

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
        let score = NodeScore::evaluate(
            Some("timeout after 30s"),
            "some response",
            &[],
            &profile,
        );

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
        let score = NodeScore::evaluate(
            None,
            "I cannot help with this request.",
            &[],
            &profile,
        );

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
