use std::path::Path;

use sacode_kernel::{
    AgentExecutionPlan, AgentRole, OrchestrationHint, OrchestrationMode, PlannedRole, RoleScore,
    SubAgentTask, TaskAnalysis, TaskScope, TaskType,
};

use crate::model_routing::TaskProfile;
use super::model_router::resolve_role_route;

pub fn parse_orchestration_hint(prompt: &str) -> OrchestrationHint {
    let trimmed = prompt.trim();
    let upper = trimmed.to_uppercase();
    if !upper.starts_with("ULW") {
        return OrchestrationHint {
            mode: Some(OrchestrationMode::DefaultFixed),
            max_agents: Some(2),
            intensity: None,
            dynamic_roles: false,
        };
    }

    let max_agents = trimmed
        .split(['[', ']', ',', ' '])
        .find_map(|part| part.trim().strip_prefix("max_agents="))
        .and_then(|value| value.parse::<usize>().ok());

    let intensity = trimmed
        .split_once(':')
        .map(|(_, rest)| rest.split_whitespace().next().unwrap_or("").trim_matches(|c| c == '[' || c == ']'))
        .filter(|value| !value.is_empty())
        .map(|value| value.to_string());

    OrchestrationHint {
        mode: Some(OrchestrationMode::UlwDynamic),
        max_agents,
        intensity,
        dynamic_roles: true,
    }
}

pub fn strip_orchestration_prefix(prompt: &str) -> String {
    let trimmed = prompt.trim();
    let upper = trimmed.to_uppercase();
    if !upper.starts_with("ULW") {
        return trimmed.to_string();
    }

    let bytes = trimmed.as_bytes();
    let mut index = 3usize;

    if bytes.get(index) == Some(&b':') {
        index += 1;
        while let Some(byte) = bytes.get(index) {
            if *byte == b'[' || byte.is_ascii_whitespace() {
                break;
            }
            index += 1;
        }
    }

    if bytes.get(index) == Some(&b'[') {
        index += 1;
        while let Some(byte) = bytes.get(index) {
            index += 1;
            if *byte == b']' {
                break;
            }
        }
    }

    trimmed[index..].trim().to_string()
}

pub fn analyze_task(prompt: &str, _workdir: &Path, profile: &TaskProfile) -> TaskAnalysis {
    let lower = prompt.to_lowercase();
    let complexity = estimate_complexity(prompt, profile);
    let risk = estimate_risk(profile, &lower);
    let estimated_scope = if complexity >= 0.8 {
        TaskScope::Large
    } else if complexity >= 0.45 {
        TaskScope::Medium
    } else {
        TaskScope::Small
    };

    let task_type = if contains_any(&lower, &["需求", "requirement", "acceptance"]) {
        TaskType::Requirements
    } else if contains_any(&lower, &["设计", "架构", "design", "architect"]) {
        TaskType::Design
    } else if contains_any(&lower, &["测试", "test", "验证", "regression"]) {
        TaskType::Test
    } else if contains_any(&lower, &["部署", "上线", "deploy", "release"]) {
        TaskType::Deploy
    } else if contains_any(&lower, &["报告", "汇报", "summary", "report"]) {
        TaskType::Report
    } else if contains_any(&lower, &["查", "分析", "explore", "inspect"]) {
        TaskType::Explore
    } else if contains_any(&lower, &["实现", "修复", "重构", "implement", "fix", "refactor"]) {
        TaskType::Implement
    } else {
        TaskType::Mixed
    };

    TaskAnalysis {
        task_type,
        complexity,
        risk,
        estimated_scope,
        requires_write: contains_any(&lower, &["实现", "修改", "修复", "重构", "add", "change", "fix", "refactor"]),
        requires_validation: contains_any(&lower, &["测试", "验证", "test", "verify", "check"]),
        requires_delivery: contains_any(&lower, &["部署", "发布", "报告", "deploy", "release", "report"]),
    }
}

pub fn score_roles(analysis: &TaskAnalysis, roles: &[AgentRole], profile: &TaskProfile) -> Vec<RoleScore> {
    let mut scores = roles
        .iter()
        .map(|role| {
            let mut score = 0.0f32;
            let mut reason = Vec::new();

            match role.id.as_str() {
                "requirement-analyst" if matches!(analysis.task_type, TaskType::Requirements | TaskType::Mixed) => {
                    score += 0.85;
                    reason.push("task needs requirement refinement".to_string());
                }
                "system-architect" if matches!(analysis.task_type, TaskType::Design | TaskType::Mixed) || profile.needs_reasoning => {
                    score += 0.8;
                    reason.push("task is design or reasoning heavy".to_string());
                }
                "repo-explorer" if matches!(analysis.task_type, TaskType::Explore | TaskType::Mixed | TaskType::Implement) => {
                    score += 0.75;
                    reason.push("task needs repository context".to_string());
                }
                "implementer" if analysis.requires_write || matches!(analysis.task_type, TaskType::Implement) => {
                    score += 0.9;
                    reason.push("task requires code changes".to_string());
                }
                "test-engineer" if analysis.requires_validation || matches!(analysis.task_type, TaskType::Test) => {
                    score += 0.8;
                    reason.push("task requires validation".to_string());
                }
                "code-reviewer" if analysis.requires_write || analysis.risk >= 0.5 => {
                    score += 0.7;
                    reason.push("task has write or regression risk".to_string());
                }
                "devops-operator" if matches!(analysis.task_type, TaskType::Deploy) || analysis.requires_delivery => {
                    score += 0.8;
                    reason.push("task requires delivery or deployment".to_string());
                }
                "reporter" if analysis.requires_delivery || matches!(analysis.task_type, TaskType::Report | TaskType::Mixed) => {
                    score += 0.65;
                    reason.push("task benefits from summarized output".to_string());
                }
                _ => {}
            }

            if analysis.complexity >= 0.75 {
                score += 0.05;
            }
            if analysis.risk >= 0.75 && role.id == "code-reviewer" {
                score += 0.1;
                reason.push("high risk raises review priority".to_string());
            }

            RoleScore {
                role_id: role.id.clone(),
                score: score.min(1.0),
                reason,
            }
        })
        .collect::<Vec<_>>();

    scores.sort_by(|a, b| b.score.partial_cmp(&a.score).unwrap_or(std::cmp::Ordering::Equal));
    scores
}

pub fn build_execution_plan(
    prompt: &str,
    workdir: &Path,
    profile: &TaskProfile,
    roles: &[AgentRole],
) -> AgentExecutionPlan {
    let hint = parse_orchestration_hint(prompt);
    let analysis = analyze_task(prompt, workdir, profile);
    let scores = score_roles(&analysis, roles, profile);

    let mode = hint.mode.clone().unwrap_or(OrchestrationMode::DefaultFixed);
    let max_agents = match mode {
        OrchestrationMode::DefaultFixed => 2,
        OrchestrationMode::UlwDynamic => hint.max_agents.unwrap_or_else(|| dynamic_agent_count(&analysis)),
    }
    .clamp(1, 4);

    let selected = scores
        .iter()
        .filter(|score| score.score >= 0.45)
        .take(max_agents)
        .collect::<Vec<_>>();

    let selected = ensure_reporter_selected(selected, &scores, max_agents);

    let tasks = selected
        .iter()
        .enumerate()
        .map(|(index, score)| SubAgentTask {
            id: format!("agent-task-{}", index + 1),
            title: format!("{} task", score.role_id),
            prompt: prompt.to_string(),
            role_id: score.role_id.clone(),
        })
        .collect::<Vec<_>>();

    let planned_roles = selected
        .iter()
        .zip(tasks.iter())
        .map(|(score, task)| {
            let role = roles.iter().find(|role| role.id == score.role_id);
            let resolved_route = role.and_then(|value| resolve_role_route(workdir, value, profile));
            PlannedRole {
                role_id: score.role_id.clone(),
                role_name: role.map(|value| value.name.clone()).unwrap_or_else(|| score.role_id.clone()),
                task_id: task.id.clone(),
                can_write: score.role_id == "implementer",
                preferred_model: resolved_route
                    .as_ref()
                    .map(|route| format!("{}/{}", route.plan.primary.provider_name, route.plan.primary.model_name))
                    .or_else(|| role.and_then(|value| value.model_policy.primary_model.clone()))
                    .or_else(|| role.and_then(|value| value.model_policy.provider.clone())),
                needs_thinking: resolved_route
                    .as_ref()
                    .map(|route| route.plan.primary.needs_thinking)
                    .unwrap_or(false),
                route_reason: resolved_route
                    .map(|route| route.plan.route_reason)
                    .unwrap_or_default(),
            }
        })
        .collect::<Vec<_>>();

    let parallel_groups = if matches!(mode, OrchestrationMode::DefaultFixed) {
        vec![tasks.iter().map(|task| task.id.clone()).collect()]
    } else {
        vec![
            tasks.iter().take(2).map(|task| task.id.clone()).collect(),
            tasks.iter().skip(2).map(|task| task.id.clone()).collect(),
        ]
        .into_iter()
        .filter(|group: &Vec<String>| !group.is_empty())
        .collect()
    };

    AgentExecutionPlan {
        use_multi_agent: tasks.len() > 1,
        mode,
        summary: format!(
            "task_type={:?}, complexity={:.2}, risk={:.2}, selected_roles={}",
            analysis.task_type,
            analysis.complexity,
            analysis.risk,
            planned_roles
                .iter()
                .map(|role| role.role_id.as_str())
                .collect::<Vec<_>>()
                .join(",")
        ),
        roles: planned_roles,
        tasks,
        parallel_groups,
        max_agents,
    }
}

fn ensure_reporter_selected<'a>(
    mut selected: Vec<&'a RoleScore>,
    scores: &'a [RoleScore],
    max_agents: usize,
) -> Vec<&'a RoleScore> {
    if selected.len() <= 1 || selected.iter().any(|score| score.role_id == "reporter") {
        return selected;
    }

    let Some(reporter_score) = scores.iter().find(|score| score.role_id == "reporter") else {
        return selected;
    };

    if selected.len() < max_agents {
        selected.push(reporter_score);
        return selected;
    }

    if let Some(index) = selected.iter().rposition(|score| score.role_id != "implementer") {
        selected[index] = reporter_score;
    } else if let Some(last) = selected.last_mut() {
        *last = reporter_score;
    }

    selected
}

fn dynamic_agent_count(analysis: &TaskAnalysis) -> usize {
    if analysis.complexity >= 0.85 {
        4
    } else if analysis.complexity >= 0.65 {
        3
    } else {
        2
    }
}

fn estimate_complexity(prompt: &str, profile: &TaskProfile) -> f32 {
    let lower = prompt.to_lowercase();
    let mut score = 0.2f32;
    if profile.needs_reasoning {
        score += 0.2;
    }
    if profile.surfaces.len() >= 2 {
        score += 0.2;
    }
    if profile.task_kinds.len() >= 2 {
        score += 0.15;
    }
    if contains_any(&lower, &["并发", "多 agent", "multi agent", "orchestrator", "workflow"]) {
        score += 0.2;
    }
    if contains_any(&lower, &["部署", "测试", "发布", "deploy", "test", "release"]) {
        score += 0.1;
    }
    score.min(1.0)
}

fn estimate_risk(profile: &TaskProfile, lower_prompt: &str) -> f32 {
    let mut risk: f32 = match profile.risk_level {
        crate::model_routing::TaskRiskLevel::Low => 0.2,
        crate::model_routing::TaskRiskLevel::Medium => 0.5,
        crate::model_routing::TaskRiskLevel::High => 0.8,
    };
    if contains_any(lower_prompt, &["重构", "删除", "迁移", "refactor", "delete", "migrate"]) {
        risk += 0.1;
    }
    risk.min(1.0)
}

fn contains_any(haystack: &str, needles: &[&str]) -> bool {
    needles.iter().any(|needle| haystack.contains(needle))
}
