use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum OrchestrationMode {
    DefaultFixed,
    UlwDynamic,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum RoleStage {
    Requirements,
    Design,
    Implementation,
    Quality,
    Delivery,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum TaskType {
    Requirements,
    Design,
    Explore,
    Implement,
    Test,
    Deploy,
    Report,
    Mixed,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum TaskScope {
    Small,
    Medium,
    Large,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq, Eq)]
pub struct OrchestrationHint {
    #[serde(default)]
    pub mode: Option<OrchestrationMode>,
    #[serde(default)]
    pub max_agents: Option<usize>,
    #[serde(default)]
    pub intensity: Option<String>,
    #[serde(default)]
    pub dynamic_roles: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq, Eq)]
pub struct RoleModelPolicy {
    #[serde(default)]
    pub primary_model: Option<String>,
    #[serde(default)]
    pub fallback_models: Vec<String>,
    #[serde(default)]
    pub provider: Option<String>,
    #[serde(default)]
    pub thinking: Option<bool>,
    #[serde(default)]
    pub reasoning_effort: Option<String>,
    #[serde(default = "default_true")]
    pub auto_route: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq, Eq)]
pub struct AgentRole {
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub stage: Option<RoleStage>,
    #[serde(default)]
    pub system_prompt: String,
    #[serde(default)]
    pub responsibilities: Vec<String>,
    #[serde(default)]
    pub allowed_tools: Vec<String>,
    #[serde(default)]
    pub preferred_context: Vec<String>,
    #[serde(default)]
    pub deliverables: Vec<String>,
    #[serde(default)]
    pub handoff_to: Vec<String>,
    #[serde(default)]
    pub model_policy: RoleModelPolicy,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct TaskAnalysis {
    pub task_type: TaskType,
    pub complexity: f32,
    pub risk: f32,
    pub estimated_scope: TaskScope,
    pub requires_write: bool,
    pub requires_validation: bool,
    pub requires_delivery: bool,
}

impl Default for TaskAnalysis {
    fn default() -> Self {
        Self {
            task_type: TaskType::Mixed,
            complexity: 0.0,
            risk: 0.0,
            estimated_scope: TaskScope::Small,
            requires_write: false,
            requires_validation: false,
            requires_delivery: false,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct RoleScore {
    pub role_id: String,
    pub score: f32,
    #[serde(default)]
    pub reason: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq, Eq)]
pub struct SubAgentTask {
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub prompt: String,
    #[serde(default)]
    pub role_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq, Eq)]
pub struct SubAgentResult {
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub success: bool,
    #[serde(default)]
    pub output: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq, Eq)]
pub struct PlannedRole {
    #[serde(default)]
    pub role_id: String,
    #[serde(default)]
    pub role_name: String,
    #[serde(default)]
    pub task_id: String,
    #[serde(default)]
    pub can_write: bool,
    #[serde(default)]
    pub preferred_model: Option<String>,
    #[serde(default)]
    pub needs_thinking: bool,
    #[serde(default)]
    pub route_reason: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct AgentExecutionPlan {
    pub use_multi_agent: bool,
    pub mode: OrchestrationMode,
    #[serde(default)]
    pub summary: String,
    #[serde(default)]
    pub roles: Vec<PlannedRole>,
    #[serde(default)]
    pub tasks: Vec<SubAgentTask>,
    #[serde(default)]
    pub parallel_groups: Vec<Vec<String>>,
    pub max_agents: usize,
}

impl Default for AgentExecutionPlan {
    fn default() -> Self {
        Self {
            use_multi_agent: false,
            mode: OrchestrationMode::DefaultFixed,
            summary: String::new(),
            roles: Vec::new(),
            tasks: Vec::new(),
            parallel_groups: Vec::new(),
            max_agents: 2,
        }
    }
}

const fn default_true() -> bool {
    true
}
