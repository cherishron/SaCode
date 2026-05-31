use sacode_kernel::{AgentRole, RoleModelPolicy, RoleStage};

#[derive(Debug, Clone, Default)]
pub struct RoleRegistry {
    roles: Vec<AgentRole>,
}

impl RoleRegistry {
    pub fn builtin() -> Self {
        Self {
            roles: builtin_roles(),
        }
    }

    pub fn all(&self) -> &[AgentRole] {
        &self.roles
    }

    pub fn find(&self, role_id: &str) -> Option<&AgentRole> {
        self.roles.iter().find(|role| role.id == role_id)
    }
}

pub fn find_role<'a>(roles: &'a [AgentRole], role_id: &str) -> Option<&'a AgentRole> {
    roles.iter().find(|role| role.id == role_id)
}

pub fn builtin_roles() -> Vec<AgentRole> {
    vec![
        AgentRole {
            id: "requirement-analyst".to_string(),
            name: "Requirement Analyst".to_string(),
            stage: Some(RoleStage::Requirements),
            system_prompt: "Clarify goals, scope, constraints, and acceptance criteria.".to_string(),
            responsibilities: vec![
                "Refine ambiguous user requests".to_string(),
                "Extract acceptance criteria".to_string(),
            ],
            preferred_context: vec!["task".to_string(), "recent_messages".to_string()],
            deliverables: vec!["requirements".to_string(), "acceptance_criteria".to_string()],
            handoff_to: vec!["system-architect".to_string(), "implementer".to_string()],
            model_policy: RoleModelPolicy {
                thinking: Some(true),
                auto_route: true,
                ..RoleModelPolicy::default()
            },
            ..AgentRole::default()
        },
        AgentRole {
            id: "system-architect".to_string(),
            name: "System Architect".to_string(),
            stage: Some(RoleStage::Design),
            system_prompt: "Design module boundaries, execution flow, and technical tradeoffs.".to_string(),
            responsibilities: vec![
                "Define architecture changes".to_string(),
                "Identify dependency and state boundaries".to_string(),
            ],
            deliverables: vec!["design_notes".to_string(), "risk_notes".to_string()],
            handoff_to: vec!["implementer".to_string(), "code-reviewer".to_string()],
            model_policy: RoleModelPolicy {
                thinking: Some(true),
                auto_route: true,
                ..RoleModelPolicy::default()
            },
            ..AgentRole::default()
        },
        AgentRole {
            id: "repo-explorer".to_string(),
            name: "Repo Explorer".to_string(),
            stage: Some(RoleStage::Implementation),
            system_prompt: "Explore the repository, identify relevant files, and map execution paths.".to_string(),
            responsibilities: vec![
                "Locate relevant files and entry points".to_string(),
                "Summarize code paths and dependencies".to_string(),
            ],
            deliverables: vec!["file_map".to_string(), "context_summary".to_string()],
            handoff_to: vec!["implementer".to_string(), "test-engineer".to_string()],
            model_policy: RoleModelPolicy {
                auto_route: true,
                ..RoleModelPolicy::default()
            },
            ..AgentRole::default()
        },
        AgentRole {
            id: "implementer".to_string(),
            name: "Implementer".to_string(),
            stage: Some(RoleStage::Implementation),
            system_prompt: "Implement the requested change with minimal correct edits.".to_string(),
            responsibilities: vec![
                "Produce code changes".to_string(),
                "Keep edits minimal and consistent".to_string(),
            ],
            deliverables: vec!["code_diff".to_string()],
            handoff_to: vec!["test-engineer".to_string(), "code-reviewer".to_string()],
            model_policy: RoleModelPolicy {
                thinking: Some(false),
                auto_route: true,
                ..RoleModelPolicy::default()
            },
            ..AgentRole::default()
        },
        AgentRole {
            id: "test-engineer".to_string(),
            name: "Test Engineer".to_string(),
            stage: Some(RoleStage::Quality),
            system_prompt: "Validate behavior, regressions, and edge cases.".to_string(),
            responsibilities: vec![
                "Plan or run validation steps".to_string(),
                "Identify regression and edge risks".to_string(),
            ],
            deliverables: vec!["test_results".to_string(), "validation_notes".to_string()],
            handoff_to: vec!["code-reviewer".to_string(), "reporter".to_string()],
            model_policy: RoleModelPolicy {
                auto_route: true,
                ..RoleModelPolicy::default()
            },
            ..AgentRole::default()
        },
        AgentRole {
            id: "code-reviewer".to_string(),
            name: "Code Reviewer".to_string(),
            stage: Some(RoleStage::Quality),
            system_prompt: "Review for bugs, regressions, and missing verification.".to_string(),
            responsibilities: vec![
                "Find correctness and regression risks".to_string(),
                "Call out missing validation".to_string(),
            ],
            deliverables: vec!["review_findings".to_string()],
            handoff_to: vec!["reporter".to_string()],
            model_policy: RoleModelPolicy {
                thinking: Some(true),
                auto_route: true,
                ..RoleModelPolicy::default()
            },
            ..AgentRole::default()
        },
        AgentRole {
            id: "devops-operator".to_string(),
            name: "DevOps Operator".to_string(),
            stage: Some(RoleStage::Delivery),
            system_prompt: "Handle deployment, runtime configuration, and health validation.".to_string(),
            responsibilities: vec![
                "Prepare deploy or runtime checks".to_string(),
                "Summarize operational risks".to_string(),
            ],
            deliverables: vec!["deploy_notes".to_string(), "health_checks".to_string()],
            handoff_to: vec!["reporter".to_string()],
            model_policy: RoleModelPolicy {
                auto_route: true,
                ..RoleModelPolicy::default()
            },
            ..AgentRole::default()
        },
        AgentRole {
            id: "reporter".to_string(),
            name: "Reporter".to_string(),
            stage: Some(RoleStage::Delivery),
            system_prompt: "Summarize execution results, user impact, and next actions.".to_string(),
            responsibilities: vec![
                "Prepare user-facing summary".to_string(),
                "Highlight outcome and residual risks".to_string(),
            ],
            deliverables: vec!["final_report".to_string()],
            model_policy: RoleModelPolicy {
                auto_route: true,
                ..RoleModelPolicy::default()
            },
            ..AgentRole::default()
        },
    ]
}
