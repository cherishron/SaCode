//! Agent Profile protocol types (M3).
//!
//! An `AgentProfile` is a **reusable persona** that bundles execution
//! preferences (mode/model) plus domain behaviour (skills, system prompt).
//! It is orthogonal to [`AgentBackend`] — the backend answers *who executes*,
//! the profile answers *how the work is framed*.

use serde::{Deserialize, Serialize};

use super::task::ExecutionMode;

/// User scope profile id that marks "no profile selected".
pub const DEFAULT_AGENT_PROFILE_ID: &str = "default";

/// Execution mode a profile prefers when a task omits one.
pub const PROFILE_MODES: [ExecutionMode; 3] = [
    ExecutionMode::Plan,
    ExecutionMode::Build,
    ExecutionMode::Yolo,
];

/// Logical model tier a profile prefers. `default` means "inherit from the
/// backend / runner configuration"; the other values are advisory hints the
/// runner maps to its own model list.
pub const PROFILE_MODEL_TIERS: [&str; 4] = ["default", "fast", "reasoning", "long-context"];

/// A skill reference attached to a profile.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(transparent)]
pub struct SkillId(String);

impl SkillId {
    pub fn new(id: impl Into<String>) -> Self {
        Self(id.into().trim().to_lowercase())
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl From<&str> for SkillId {
    fn from(value: &str) -> Self {
        Self::new(value)
    }
}

impl From<String> for SkillId {
    fn from(value: String) -> Self {
        Self::new(value)
    }
}

/// A reusable persona: persona prompt + execution preferences + skills.
///
/// ## Persistence
/// - user scope:    `<config_root>/agents.json`
/// - project scope: `<workspace>/.sacode/agents.json`
///
/// Project scope shadows user scope on id collision.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct AgentProfile {
    /// Stable id inside its scope, e.g. `code-reviewer`.
    pub id: String,
    /// Human readable name, e.g. `代码审查员`.
    pub display_name: String,
    /// Emoji shown in compact pickers.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub icon: Option<String>,
    /// Where the profile was loaded from.
    #[serde(default)]
    pub scope: AgentProfileScope,
    /// Preferred execution mode, defaults to `build`.
    #[serde(default = "default_profile_mode")]
    pub mode: ExecutionMode,
    /// Preferred model tier, defaults to `default`.
    #[serde(default = "default_model_tier")]
    pub model_tier: String,
    /// Skills the persona enables by default.
    #[serde(default)]
    pub skills: Vec<SkillId>,
    /// Persona / rules prompt prepended to every task this profile runs.
    #[serde(default)]
    pub system_prompt: String,
    /// User toggle; a disabled profile cannot be selected.
    #[serde(default = "default_true")]
    pub enabled: bool,
    /// Creation timestamp (RFC 3339), informational.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub created_at: Option<String>,
    /// Last update timestamp (RFC 3339), informational.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub updated_at: Option<String>,
}

impl AgentProfile {
    /// Build the fallback profile used when nothing is selected.
    pub fn default_profile() -> Self {
        Self {
            id: DEFAULT_AGENT_PROFILE_ID.to_string(),
            display_name: "默认智能体".to_string(),
            icon: Some("🧠".to_string()),
            scope: AgentProfileScope::User,
            mode: ExecutionMode::Build,
            model_tier: default_model_tier(),
            skills: Vec::new(),
            system_prompt: String::new(),
            enabled: true,
            created_at: None,
            updated_at: None,
        }
    }

    /// True when this is the built-in fallback profile.
    pub fn is_default(&self) -> bool {
        self.id == DEFAULT_AGENT_PROFILE_ID
    }

    /// Validate without mutating. Returns a human readable reason on failure.
    pub fn validate(&self) -> Result<(), String> {
        if self.id.trim().is_empty() {
            return Err("profile id must not be empty".to_string());
        }
        if self.display_name.trim().is_empty() {
            return Err("profile display_name must not be empty".to_string());
        }
        if !PROFILE_MODES.contains(&self.mode) {
            return Err(format!("unsupported profile mode: {:?}", self.mode));
        }
        if !PROFILE_MODEL_TIERS.contains(&self.model_tier.as_str()) {
            return Err(format!(
                "unsupported model tier: {} (expected one of {:?})",
                self.model_tier, PROFILE_MODEL_TIERS
            ));
        }
        Ok(())
    }

    /// Normalize ids/lists in place so persisted files stay comparable.
    pub fn normalize(&mut self) {
        let id = self.id.trim().to_string();
        self.id = if id.is_empty() {
            DEFAULT_AGENT_PROFILE_ID.to_string()
        } else {
            id
        };
        self.display_name = self.display_name.trim().to_string();
        self.model_tier = self.model_tier.trim().to_string();
        self.skills = self
            .skills
            .iter()
            .map(|s| SkillId::new(s.as_str()))
            .filter(|s| !s.as_str().is_empty())
            .collect();
    }
}

/// Which level a profile was loaded from.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AgentProfileScope {
    User,
    #[default]
    Project,
}

/// The five preset personas shipped with the desktop client.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PresetAgentProfile {
    CodeReviewer,
    Refactorer,
    TestEngineer,
    DocWriter,
    SecurityAuditor,
}

impl PresetAgentProfile {
    pub fn id(&self) -> &'static str {
        match self {
            Self::CodeReviewer => "code-reviewer",
            Self::Refactorer => "refactor",
            Self::TestEngineer => "test-engineer",
            Self::DocWriter => "doc-writer",
            Self::SecurityAuditor => "security-auditor",
        }
    }

    pub fn icon(&self) -> &'static str {
        match self {
            Self::CodeReviewer => "🔍",
            Self::Refactorer => "♻",
            Self::TestEngineer => "🧪",
            Self::DocWriter => "📝",
            Self::SecurityAuditor => "🛡",
        }
    }

    pub fn build(&self) -> AgentProfile {
        let base =
            |name: &str, mode: ExecutionMode, tier: &str, skills: &[&str], prompt: String| {
                AgentProfile {
                    id: self.id().to_string(),
                    display_name: name.to_string(),
                    icon: Some(self.icon().to_string()),
                    scope: AgentProfileScope::User,
                    mode,
                    model_tier: tier.to_string(),
                    skills: skills.iter().map(|s| SkillId::from(*s)).collect(),
                    system_prompt: prompt,
                    enabled: true,
                    created_at: None,
                    updated_at: None,
                }
            };

        match self {
            Self::CodeReviewer => base(
                "代码审查员",
                ExecutionMode::Plan,
                "reasoning",
                &["code-review"],
                concat!(
                    "你是 SaCode 的代码审查员。审阅变更时按以下顺序输出：\n",
                    "1. 正确性问题（逻辑错误、边界条件、并发）\n",
                    "2. 可维护性问题（命名、重复、抽象层次）\n",
                    "3. 安全问题（注入、越权、敏感信息泄露）\n",
                    "每项给出文件:行号、严重级（must_fix/should_fix/nice_to_have）和具体改法。\n",
                    "只读分析，不修改代码。",
                )
                .to_string(),
            ),
            Self::Refactorer => base(
                "重构专家",
                ExecutionMode::Build,
                "reasoning",
                &["refactor"],
                concat!(
                    "你是 SaCode 的重构专家。\n",
                    "- 先说明为什么要改（坏味道 + 影响范围），再动手。\n",
                    "- 保持外部行为不变；如需变更行为，单独标注为 breaking。\n",
                    "- 每一步重构可独立回滚，不留中间损坏状态。\n",
                    "- 完成后补充或更新受影响的测试。",
                )
                .to_string(),
            ),
            Self::TestEngineer => base(
                "测试工程师",
                ExecutionMode::Build,
                "default",
                &["test-gen"],
                concat!(
                    "你是 SaCode 的测试工程师。\n",
                    "- 覆盖 happy path、边界条件和失败分支。\n",
                    "- 优先复用现有测试脚手架和 fixture，不重复造轮子。\n",
                    "- 断言要具体，避免只断言返回值非空。\n",
                    "- 不确定的行为先问，不要凭猜测写期望值。",
                )
                .to_string(),
            ),
            Self::DocWriter => base(
                "文档写手",
                ExecutionMode::Plan,
                "default",
                &["doc-write"],
                concat!(
                    "你是 SaCode 的文档写手。\n",
                    "- 先读代码再写，不要照抄注释。\n",
                    "- 面向使用者组织内容：是什么/怎么用/注意什么。\n",
                    "- 示例必须可复制运行。\n",
                    "- 与代码不一致的旧文档直接修正。",
                )
                .to_string(),
            ),
            Self::SecurityAuditor => base(
                "安全审计员",
                ExecutionMode::Plan,
                "reasoning",
                &["code-review", "security-scan"],
                concat!(
                    "你是 SaCode 的安全审计员。聚焦：\n",
                    "1. 命令注入与路径穿越（外部命令、文件读写）\n",
                    "2. 凭据与 Token 泄露（日志、错误信息、前端存储）\n",
                    "3. 越权与 SSRF（未校验的外部 URL）\n",
                    "4. 依赖与供应链风险\n",
                    "输出按可利用性排序，给出攻击场景和修复建议。只读分析。",
                )
                .to_string(),
            ),
        }
    }
}

/// All preset profiles, in display order.
pub fn preset_agent_profiles() -> Vec<AgentProfile> {
    vec![
        PresetAgentProfile::CodeReviewer.build(),
        PresetAgentProfile::Refactorer.build(),
        PresetAgentProfile::TestEngineer.build(),
        PresetAgentProfile::DocWriter.build(),
        PresetAgentProfile::SecurityAuditor.build(),
    ]
}

fn default_profile_mode() -> ExecutionMode {
    ExecutionMode::Build
}

fn default_model_tier() -> String {
    "default".to_string()
}

fn default_true() -> bool {
    true
}
