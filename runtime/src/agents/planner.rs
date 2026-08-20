use std::path::Path;

use sacode_kernel::{
    AgentExecutionPlan, AgentRole, OrchestrationHint, OrchestrationMode, PlannedRole, RoleScore,
    SubAgentTask, TaskAnalysis, TaskScope, TaskType,
};

use super::model_router::resolve_role_route;
use crate::model_routing::TaskProfile;

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
        .map(|(_, rest)| {
            rest.split_whitespace()
                .next()
                .unwrap_or("")
                .trim_matches(|c| c == '[' || c == ']')
        })
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
    } else if contains_any(
        &lower,
        &["实现", "修复", "重构", "implement", "fix", "refactor"],
    ) {
        TaskType::Implement
    } else {
        TaskType::Mixed
    };

    TaskAnalysis {
        task_type,
        complexity,
        risk,
        estimated_scope,
        requires_write: contains_any(
            &lower,
            &[
                "实现", "修改", "修复", "重构", "add", "change", "fix", "refactor",
            ],
        ),
        requires_validation: contains_any(&lower, &["测试", "验证", "test", "verify", "check"]),
        requires_delivery: contains_any(
            &lower,
            &["部署", "发布", "报告", "deploy", "release", "report"],
        ),
    }
}

pub fn score_roles(
    analysis: &TaskAnalysis,
    roles: &[AgentRole],
    profile: &TaskProfile,
) -> Vec<RoleScore> {
    let mut scores = roles
        .iter()
        .map(|role| {
            let mut score = 0.0f32;
            let mut reason = Vec::new();

            match role.id.as_str() {
                "requirement-analyst"
                    if matches!(analysis.task_type, TaskType::Requirements | TaskType::Mixed) =>
                {
                    score += 0.85;
                    reason.push("task needs requirement refinement".to_string());
                }
                "system-architect"
                    if matches!(analysis.task_type, TaskType::Design | TaskType::Mixed)
                        || profile.needs_reasoning =>
                {
                    score += 0.8;
                    reason.push("task is design or reasoning heavy".to_string());
                }
                "repo-explorer"
                    if matches!(
                        analysis.task_type,
                        TaskType::Explore | TaskType::Mixed | TaskType::Implement
                    ) =>
                {
                    score += 0.75;
                    reason.push("task needs repository context".to_string());
                }
                "implementer"
                    if analysis.requires_write
                        || matches!(analysis.task_type, TaskType::Implement) =>
                {
                    score += 0.9;
                    reason.push("task requires code changes".to_string());
                }
                "test-engineer"
                    if analysis.requires_validation
                        || matches!(analysis.task_type, TaskType::Test) =>
                {
                    score += 0.8;
                    reason.push("task requires validation".to_string());
                }
                "code-reviewer" if analysis.requires_write || analysis.risk >= 0.5 => {
                    score += 0.7;
                    reason.push("task has write or regression risk".to_string());
                }
                "devops-operator"
                    if matches!(analysis.task_type, TaskType::Deploy)
                        || analysis.requires_delivery =>
                {
                    score += 0.8;
                    reason.push("task requires delivery or deployment".to_string());
                }
                "reporter"
                    if analysis.requires_delivery
                        || matches!(analysis.task_type, TaskType::Report | TaskType::Mixed) =>
                {
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

    scores.sort_by(|a, b| {
        b.score
            .partial_cmp(&a.score)
            .unwrap_or(std::cmp::Ordering::Equal)
    });
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
        OrchestrationMode::UlwDynamic => hint
            .max_agents
            .unwrap_or_else(|| dynamic_agent_count(&analysis)),
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
                role_name: role
                    .map(|value| value.name.clone())
                    .unwrap_or_else(|| score.role_id.clone()),
                task_id: task.id.clone(),
                can_write: score.role_id == "implementer",
                preferred_model: resolved_route
                    .as_ref()
                    .map(|route| {
                        format!(
                            "{}/{}",
                            route.plan.primary.provider_name, route.plan.primary.model_name
                        )
                    })
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
        // 灵枢 · Agent Teams：基于角色 handoff_to 依赖做拓扑排序
        // 替换原来的静态"前 2 + 剩余"分组，让角色依赖驱动执行顺序
        build_dependency_groups(&tasks, roles)
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

/// 灵枢 · Agent Teams：基于角色 handoff_to 依赖构建拓扑排序的并发分组
///
/// 替换原来的静态"前 2 + 剩余"分组，让角色依赖驱动执行顺序。
///
/// 算法：Kahn's BFS 拓扑排序，同层节点放入同一并发组。
/// 例如角色依赖链：
///   requirement-analyst → system-architect → implementer → test-engineer → code-reviewer → reporter
/// 生成分组：
///   [requirement-analyst], [system-architect], [implementer], [test-engineer], [code-reviewer], [reporter]
///
/// 无依赖的角色会被分到第一组（与 requirement-analyst 同层并发）。
/// 检测到循环依赖时，把剩余任务全部放入当前组以打破死锁。
fn build_dependency_groups(tasks: &[SubAgentTask], roles: &[AgentRole]) -> Vec<Vec<String>> {
    use std::collections::{HashMap, HashSet};

    // 构建 role_id → task_id 映射
    let role_to_task: HashMap<&str, &str> = tasks
        .iter()
        .map(|task| (task.role_id.as_str(), task.id.as_str()))
        .collect();

    // 构建 task 依赖图：如果 task A 的角色 handoff_to 包含角色 B，
    // 且角色 B 对应 task B，则 A 依赖 B（B 完成后 A 才能开始）
    let mut in_degree: HashMap<&str, usize> = HashMap::new();
    let mut dependents: HashMap<&str, Vec<&str>> = HashMap::new(); // prerequisite_task_id → 依赖它的 task_ids

    for task in tasks {
        in_degree.entry(task.id.as_str()).or_insert(0);
        dependents.entry(task.id.as_str()).or_insert_with(Vec::new);
    }

    for task in tasks {
        let Some(role) = roles.iter().find(|r| r.id == task.role_id) else {
            continue;
        };
        for handoff_role_id in &role.handoff_to {
            if let Some(&prerequisite_task_id) = role_to_task.get(handoff_role_id.as_str()) {
                // task 依赖 prerequisite_task_id（prerequisite 完成后 task 才能开始）
                *in_degree.entry(task.id.as_str()).or_insert(0) += 1;
                dependents
                    .entry(prerequisite_task_id)
                    .or_insert_with(Vec::new)
                    .push(task.id.as_str());
            }
        }
    }

    // Kahn's algorithm：BFS 拓扑排序，同层节点放入同一并发组
    let mut groups: Vec<Vec<String>> = Vec::new();
    let mut remaining: HashSet<&str> = tasks.iter().map(|t| t.id.as_str()).collect();

    while !remaining.is_empty() {
        // 找出当前入度为 0 的 task
        let mut current_layer: Vec<&str> = remaining
            .iter()
            .filter(|task_id| in_degree.get(*task_id).copied().unwrap_or(0) == 0)
            .copied()
            .collect();

        if current_layer.is_empty() {
            // 循环依赖：把剩余 task 全放入当前组（打破死锁）
            current_layer = remaining.iter().copied().collect();
        }

        current_layer.sort(); // 确定性排序，保证测试可复现
        let group: Vec<String> = current_layer.iter().map(|s| s.to_string()).collect();

        // 从 remaining 中移除当前层
        for task_id in &current_layer {
            remaining.remove(task_id);
        }

        // 更新依赖当前层 task 的入度
        for task_id in &current_layer {
            if let Some(deps) = dependents.get(task_id) {
                for dep in deps {
                    if let Some(deg) = in_degree.get_mut(dep) {
                        *deg = deg.saturating_sub(1);
                    }
                }
            }
        }

        groups.push(group);
    }

    groups
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

    if let Some(index) = selected
        .iter()
        .rposition(|score| score.role_id != "implementer")
    {
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
    if contains_any(
        &lower,
        &[
            "并发",
            "多 agent",
            "multi agent",
            "orchestrator",
            "workflow",
        ],
    ) {
        score += 0.2;
    }
    if contains_any(
        &lower,
        &["部署", "测试", "发布", "deploy", "test", "release"],
    ) {
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
    if contains_any(
        lower_prompt,
        &["重构", "删除", "迁移", "refactor", "delete", "migrate"],
    ) {
        risk += 0.1;
    }
    risk.min(1.0)
}

fn contains_any(haystack: &str, needles: &[&str]) -> bool {
    needles.iter().any(|needle| haystack.contains(needle))
}
