//! 灵枢 · 自组织 — 角色注册表
//!
//! 核心模块：内置角色定义与管理
//! 对应 AGENTS.md 中「自组织 — 角色驱动编排」
//!
//! 角色定义包括：
//! - requirement-analyst：需求分析
//! - system-architect：系统架构
//! - repo-explorer：代码探索
//! - implementer：代码实现
//! - code-reviewer：代码审查
//! - test-engineer：测试工程
//! - security-analyst：安全分析

use anyhow::Result;
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

    /// 创建包含内置角色和项目级自定义角色的注册表
    pub fn with_custom_agents(workdir: &std::path::Path) -> Self {
        let mut roles = builtin_roles();
        let custom_agents = super::agent_loader::load_custom_agents(workdir);
        for custom in custom_agents {
            // 如果自定义角色 ID 与内置角色冲突，覆盖内置角色
            if let Some(pos) = roles.iter().position(|r| r.id == custom.id) {
                tracing::info!("自定义 Agent [{}] 覆盖内置角色", custom.id);
                roles[pos] = custom;
            } else {
                tracing::info!("添加自定义 Agent [{}]", custom.id);
                roles.push(custom);
            }
        }
        Self { roles }
    }

    pub fn all(&self) -> &[AgentRole] {
        &self.roles
    }

    pub fn find(&self, role_id: &str) -> Option<&AgentRole> {
        self.roles.iter().find(|role| role.id == role_id)
    }

    /// 动态注册运行时创建的角色（M2 Agent 协作协议升级）
    ///
    /// 根据任务需要动态创建角色并分配邮箱（由调用方负责注册到 MessageBus）。
    /// 若 role_id 与现有角色冲突，返回错误避免静默覆盖。
    pub fn register_dynamic_role(&mut self, role: AgentRole) -> anyhow::Result<()> {
        if self.roles.iter().any(|r| r.id == role.id) {
            return Err(anyhow::anyhow!(
                "角色 [{}] 已存在，动态注册被拒绝（避免 ID 冲突）",
                role.id
            ));
        }
        tracing::info!("动态注册角色 [{}]", role.id);
        self.roles.push(role);
        Ok(())
    }

    /// 动态注册或覆盖（同名则替换）角色
    ///
    /// 与 [`register_dynamic_role`] 不同，此处允许覆盖同名角色，
    /// 用于任务需要动态调整角色职责的场景。
    pub fn upsert_dynamic_role(&mut self, role: AgentRole) {
        if let Some(pos) = self.roles.iter().position(|r| r.id == role.id) {
            tracing::info!("动态角色 [{}] 已存在，覆盖更新", role.id);
            self.roles[pos] = role;
        } else {
            tracing::info!("动态注册角色 [{}]", role.id);
            self.roles.push(role);
        }
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
            system_prompt: "Clarify goals, scope, constraints, and acceptance criteria."
                .to_string(),
            responsibilities: vec![
                "Refine ambiguous user requests".to_string(),
                "Extract acceptance criteria".to_string(),
            ],
            preferred_context: vec!["task".to_string(), "recent_messages".to_string()],
            deliverables: vec![
                "requirements".to_string(),
                "acceptance_criteria".to_string(),
            ],
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
            system_prompt: "Design module boundaries, execution flow, and technical tradeoffs."
                .to_string(),
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
            system_prompt:
                "Explore the repository, identify relevant files, and map execution paths."
                    .to_string(),
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
            system_prompt: "Handle deployment, runtime configuration, and health validation."
                .to_string(),
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
            system_prompt: "Summarize execution results, user impact, and next actions."
                .to_string(),
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

#[cfg(test)]
mod tests {
    use super::*;
    use sacode_kernel::AgentRole;

    fn dynamic_role(id: &str) -> AgentRole {
        AgentRole {
            id: id.to_string(),
            name: id.to_string(),
            system_prompt: format!("dynamic role {}", id),
            ..AgentRole::default()
        }
    }

    #[test]
    fn register_dynamic_role_adds_new_role() {
        let mut registry = RoleRegistry::builtin();
        let initial_count = registry.all().len();
        registry
            .register_dynamic_role(dynamic_role("custom-agent"))
            .expect("应成功注册");
        assert_eq!(registry.all().len(), initial_count + 1);
        assert!(registry.find("custom-agent").is_some());
    }

    #[test]
    fn register_dynamic_role_rejects_duplicate_id() {
        let mut registry = RoleRegistry::builtin();
        registry
            .register_dynamic_role(dynamic_role("custom-agent"))
            .expect("首次注册应成功");
        let result = registry.register_dynamic_role(dynamic_role("custom-agent"));
        assert!(result.is_err(), "重复 ID 应被拒绝");
    }

    #[test]
    fn upsert_dynamic_role_overrides_existing() {
        let mut registry = RoleRegistry::builtin();
        let initial_count = registry.all().len();
        // 覆盖内置角色
        let mut updated = dynamic_role("implementer");
        updated.system_prompt = "updated implementer prompt".to_string();
        registry.upsert_dynamic_role(updated);
        assert_eq!(registry.all().len(), initial_count, "覆盖不应增加数量");
        assert_eq!(
            registry.find("implementer").unwrap().system_prompt,
            "updated implementer prompt"
        );
    }

    #[test]
    fn builtin_registry_has_expected_roles() {
        let registry = RoleRegistry::builtin();
        for role_id in [
            "requirement-analyst",
            "system-architect",
            "repo-explorer",
            "implementer",
            "test-engineer",
            "code-reviewer",
            "devops-operator",
            "reporter",
        ] {
            assert!(registry.find(role_id).is_some(), "应内置角色 {}", role_id);
        }
    }
}
