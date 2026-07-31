//! 灵枢 · 自组织 — 角色驱动编排
//!
//! 核心模块：多角色协同、动态任务分配、子 agent 结果汇总与裁决
//! 对应 AGENTS.md 中「自组织 — 角色驱动编排」
//!
//! 设计理念源自《黄帝内经》经络协调脏腑的隐喻：
//! - 角色如同经络，各司其职
//! - 任务如同脏腑需求，动态分配给最适合的角色

use std::collections::HashMap;

use anyhow::Result;
use sacode_kernel::{
    ConflictRecord, ExecutionContext, ExecutionReport, HookRecord, LifecyclePoint, RouteRecord,
    RoutedModelRecord, SummaryItemRecord, SummaryRecord, TaskRun, ToolExecutionRecord,
};

use super::message_bus::{AgentMessageKind, CommunicationSummary, MessageBus, build_communication_summary};
use super::summary_compactor::{
    compact_aggregate_output, compact_conflict_detail, consensus_output, detect_output_polarity,
    extract_final_consensus, extract_risk_summary, OutputPolarity,
};
use super::{build_execution_plan, RoleRegistry};
use crate::agents::worker::{run_sub_agent, WorkerRunResult};
use crate::model_routing::TaskProfile;
use crate::{task_run_from_report, CheckpointStorage};

pub async fn execute_role_driven_orchestration(
    context: &ExecutionContext,
    checkpoints: &CheckpointStorage,
) -> Result<(ExecutionReport, sacode_kernel::AgentExecutionPlan)> {
    let workdir = std::env::current_dir()?;
    let roles = RoleRegistry::builtin();
    let profile = TaskProfile::from_prompt_and_workspace(&context.task.prompt, &workdir);
    let plan = build_execution_plan(&context.task.prompt, &workdir, &profile, roles.all());

    let mut report = ExecutionReport {
        plan: Some(sacode_kernel::Plan::new(
            context.task.prompt.clone(),
            Vec::new(),
            context.mode.to_string(),
        )),
        events: vec![sacode_kernel::Event::message(format!(
            "进入角色驱动编排模式：{:?}",
            plan.mode
        ))],
        tool_records: Vec::new(),
        route_records: Vec::new(),
        conflicts: Vec::new(),
        conflict_records: Vec::new(),
        summary_record: None,
        hook_records: vec![HookRecord {
            hook_name: "role-driven-orchestrator".to_string(),
            point: LifecyclePoint::TaskStarted,
            success: true,
            message: Some(plan.summary.clone()),
        }],
        checkpoint_refs: Vec::new(),
        final_output: None,
    };

    // 创建消息总线，支持子 Agent 间通信
    let message_bus = MessageBus::new();

    let results = execute_parallel_groups(&plan, &roles, &profile, &workdir, &mut report, &message_bus).await;

    // 收集通信摘要
    let comm_summaries = collect_communication_summaries(&results, &message_bus).await;
    fold_worker_results(&mut report, &results, &comm_summaries);

    let checkpoint = sacode_kernel::Checkpoint::new(context.task.clone());
    let checkpoint_path = checkpoints.save(&checkpoint)?;
    report
        .checkpoint_refs
        .push(checkpoint_path.display().to_string());
    report.hook_records.push(HookRecord {
        hook_name: "role-driven-orchestrator".to_string(),
        point: LifecyclePoint::TaskFinished,
        success: true,
        message: Some(format!("workers={}", results.len())),
    });
    report.conflict_records = collect_conflict_records(&results.iter().collect::<Vec<_>>());
    report.conflicts = report
        .conflict_records
        .iter()
        .map(|record| record.summary.clone())
        .collect();
    report.summary_record = Some(build_summary_record(
        &context.task.prompt,
        &results,
        &report.conflicts,
        &report.conflict_records,
    ));
    report.final_output = Some(aggregate_worker_results(
        &context.task.prompt,
        &results,
        &report.conflicts,
    ));
    report.events.push(sacode_kernel::Event::thinking(format!(
        "主 Agent 汇总裁决完成，汇总角色数：{}",
        results.len()
    )));
    report.events.push(sacode_kernel::Event::done(format!(
        "角色驱动编排完成，子 Agent 数量：{}",
        results.len()
    )));

    Ok((report, plan))
}

pub async fn execute_role_driven_task_run(
    context: &ExecutionContext,
    checkpoints: &CheckpointStorage,
) -> Result<(TaskRun, sacode_kernel::AgentExecutionPlan)> {
    let (report, plan) = execute_role_driven_orchestration(context, checkpoints).await?;
    let task_run = task_run_from_report(
        context.task_id.clone(),
        context.mode,
        context.task.prompt.clone(),
        &report,
        crate::infer_task_run_state(&report),
    );
    Ok((task_run, plan))
}

async fn execute_parallel_groups(
    plan: &sacode_kernel::AgentExecutionPlan,
    roles: &RoleRegistry,
    profile: &TaskProfile,
    workdir: &std::path::Path,
    report: &mut ExecutionReport,
    message_bus: &MessageBus,
) -> Vec<WorkerRunResult> {
    let mut all_results = Vec::new();

    // 注册所有子 Agent 到消息总线
    for task in &plan.tasks {
        let _ = message_bus.register(task.id.clone()).await;
    }

    report.events.push(sacode_kernel::Event::message(format!(
        "消息总线已初始化，注册 Agent 数：{}",
        plan.tasks.len()
    )));

    for (group_index, group) in plan.parallel_groups.iter().enumerate() {
        report.events.push(sacode_kernel::Event::message(format!(
            "开始执行并发组 #{}，任务数：{}",
            group_index + 1,
            group.len()
        )));

        let mut worker_runs = Vec::new();
        for task_id in group {
            let Some(task) = plan.tasks.iter().find(|task| &task.id == task_id) else {
                report.events.push(sacode_kernel::Event::error(format!(
                    "未找到子任务: {}",
                    task_id
                )));
                continue;
            };
            let Some(role) = roles.find(&task.role_id).cloned() else {
                report.events.push(sacode_kernel::Event::error(format!(
                    "缺少角色定义: {}",
                    task.role_id
                )));
                continue;
            };
            worker_runs.push(run_sub_agent(task.clone(), role, profile, workdir));
        }

        let mut group_results = futures::future::join_all(worker_runs).await;

        // 并发组执行完毕后，通过消息总线同步进度
        for result in &group_results {
            let status = if result.result.success { "完成" } else { "失败" };
            message_bus
                .broadcast(
                    &result.task.id,
                    AgentMessageKind::ProgressSync,
                    format!("角色 [{}] 任务 [{}] {}", result.role.id, result.task.title, status),
                )
                .await;
        }

        report.events.push(sacode_kernel::Event::message(format!(
            "并发组 #{} 执行完成",
            group_index + 1
        )));
        all_results.append(&mut group_results);
    }

    all_results
}

fn fold_worker_results(report: &mut ExecutionReport, results: &[WorkerRunResult], comm_summaries: &HashMap<String, CommunicationSummary>) {
    for item in results {
        report.events.push(sacode_kernel::Event::message(format!(
            "子 Agent [{}] 绑定角色 [{}]",
            item.task.id, item.role.id
        )));
        report.events.push(sacode_kernel::Event::thinking(format!(
            "子 Agent [{}] 模型决策：{}",
            item.task.id, item.resolved_model_summary
        )));

        // 记录通信摘要
        if let Some(comm) = comm_summaries.get(&item.task.id) {
            if comm.sent_count > 0 || comm.received_count > 0 {
                report.events.push(sacode_kernel::Event::thinking(format!(
                    "子 Agent [{}] 通信：发送 {} 条，接收 {} 条",
                    item.task.id, comm.sent_count, comm.received_count
                )));
            }
        }
        if let Some(route) = &item.resolved_route {
            report.events.push(sacode_kernel::Event::thinking(format!(
                "子 Agent [{}] 主路由：{}/{} score={} thinking={}",
                item.task.id,
                route.plan.primary.provider_name,
                route.plan.primary.model_name,
                route.plan.primary.route_score,
                route.plan.primary.needs_thinking
            )));
            if !route.plan.fallbacks.is_empty() {
                let fallback_summary = route
                    .plan
                    .fallbacks
                    .iter()
                    .map(|entry| {
                        format!(
                            "{}/{}({})",
                            entry.provider_name, entry.model_name, entry.route_score
                        )
                    })
                    .collect::<Vec<_>>()
                    .join(", ");
                report.events.push(sacode_kernel::Event::thinking(format!(
                    "子 Agent [{}] 备选路由：{}",
                    item.task.id, fallback_summary
                )));
            }
        }
        report.events.extend(item.events.clone());
        if let Some(route) = &item.resolved_route {
            report.route_records.push(RouteRecord {
                task_id: item.task.id.clone(),
                role_id: item.role.id.clone(),
                primary: RoutedModelRecord {
                    provider_name: route.plan.primary.provider_name.clone(),
                    model_name: route.plan.primary.model_name.clone(),
                    route_score: route.plan.primary.route_score,
                    needs_thinking: route.plan.primary.needs_thinking,
                    reasons: route.plan.primary.reasons.clone(),
                },
                fallbacks: route
                    .plan
                    .fallbacks
                    .iter()
                    .map(|entry| RoutedModelRecord {
                        provider_name: entry.provider_name.clone(),
                        model_name: entry.model_name.clone(),
                        route_score: entry.route_score,
                        needs_thinking: entry.needs_thinking,
                        reasons: entry.reasons.clone(),
                    })
                    .collect(),
                route_reason: route.plan.route_reason.clone(),
            });
        }
        report.tool_records.push(ToolExecutionRecord {
            step_id: None,
            tool_name: format!("subagent.{}", item.role.id),
            success: item.result.success,
        });
    }
}

fn aggregate_worker_results(
    task_prompt: &str,
    results: &[WorkerRunResult],
    conflicts: &[String],
) -> String {
    let mut ordered = results.iter().collect::<Vec<_>>();
    ordered.sort_by_key(|item| role_rank(&item.role.id));

    let mut lines = Vec::new();
    lines.push(format!("task={}", task_prompt.trim()));
    lines.push(format!(
        "roles={}",
        ordered
            .iter()
            .map(|item| item.role.id.as_str())
            .collect::<Vec<_>>()
            .join(",")
    ));

    let reporter_summary = ordered
        .iter()
        .find(|item| item.role.id == "reporter")
        .map(|item| compact_aggregate_output(item.result.output.trim()))
        .filter(|value| !value.is_empty());
    if let Some(summary) = reporter_summary {
        lines.push(format!("reporter_summary={}", summary));
    }

    if !conflicts.is_empty() {
        lines.push(format!("conflicts={}", conflicts.join(" | ")));
    }

    for item in ordered {
        let output = compact_aggregate_output(item.result.output.trim());
        if output.is_empty() {
            continue;
        }

        let route_summary = item
            .resolved_route
            .as_ref()
            .map(|route| {
                format!(
                    "{}/{}",
                    route.plan.primary.provider_name, route.plan.primary.model_name
                )
            })
            .unwrap_or_else(|| "auto".to_string());
        lines.push(format!(
            "- {} [{}]: {}",
            item.role.id, route_summary, output
        ));
    }

    lines.join("\n")
}

fn collect_conflict_records(results: &[&WorkerRunResult]) -> Vec<ConflictRecord> {
    let success_values = results
        .iter()
        .map(|item| item.result.success)
        .collect::<std::collections::BTreeSet<_>>();
    let mut conflicts = Vec::new();
    if success_values.len() > 1 {
        conflicts.push(ConflictRecord {
            kind: "status_conflict".to_string(),
            summary: "mixed success status across roles".to_string(),
            details: results
                .iter()
                .map(|item| {
                    compact_conflict_detail(&format!("{}={}", item.role.id, item.result.success))
                })
                .collect(),
        });
    }

    let route_values = results
        .iter()
        .filter_map(|item| {
            item.resolved_route.as_ref().map(|route| {
                format!(
                    "{}/{}",
                    route.plan.primary.provider_name, route.plan.primary.model_name
                )
            })
        })
        .collect::<std::collections::BTreeSet<_>>();
    if route_values.len() > 1 {
        conflicts.push(ConflictRecord {
            kind: "route_conflict".to_string(),
            summary: format!(
                "multiple primary routes: {}",
                route_values.iter().cloned().collect::<Vec<_>>().join(", ")
            ),
            details: route_values
                .into_iter()
                .map(|detail| compact_conflict_detail(&detail))
                .collect(),
        });
    }

    let implementer_polarity = results
        .iter()
        .find(|item| item.role.id == "implementer")
        .and_then(|item| detect_output_polarity(item.result.output.trim()));
    let validation_disagreements = results
        .iter()
        .filter(|item| matches!(item.role.id.as_str(), "test-engineer" | "code-reviewer"))
        .filter_map(|item| {
            let polarity = detect_output_polarity(item.result.output.trim())?;
            Some((item.role.id.as_str(), polarity, item.result.output.trim()))
        })
        .filter(|(_, polarity, _)| {
            implementer_polarity == Some(OutputPolarity::Positive)
                && *polarity == OutputPolarity::Negative
        })
        .collect::<Vec<_>>();
    if !validation_disagreements.is_empty() {
        conflicts.push(ConflictRecord {
            kind: "validation_conflict".to_string(),
            summary: format!(
                "implementation completion conflicts with validation findings: {}",
                validation_disagreements
                    .iter()
                    .map(|(role_id, _, _)| *role_id)
                    .collect::<Vec<_>>()
                    .join(", ")
            ),
            details: validation_disagreements
                .iter()
                .map(|(role_id, _, output)| {
                    compact_conflict_detail(&format!("{}: {}", role_id, output))
                })
                .collect(),
        });
    }

    let conclusion_values = results
        .iter()
        .filter_map(|item| consensus_output(item.result.output.trim()))
        .collect::<std::collections::BTreeSet<_>>();
    if conclusion_values.len() > 1 {
        conflicts.push(ConflictRecord {
            kind: "conclusion_conflict".to_string(),
            summary: format!(
                "multiple distinct role conclusions: {}",
                conclusion_values
                    .iter()
                    .cloned()
                    .collect::<Vec<_>>()
                    .join(" | ")
            ),
            details: conclusion_values
                .into_iter()
                .map(|detail| compact_conflict_detail(&detail))
                .collect::<std::collections::BTreeSet<_>>()
                .into_iter()
                .collect(),
        });
    }

    let polarities = results
        .iter()
        .filter_map(|item| {
            detect_output_polarity(item.result.output.trim())
                .map(|polarity| (item.role.id.as_str(), polarity))
        })
        .collect::<Vec<_>>();
    let has_positive = polarities
        .iter()
        .any(|(_, polarity)| *polarity == OutputPolarity::Positive);
    let has_negative = polarities
        .iter()
        .any(|(_, polarity)| *polarity == OutputPolarity::Negative);
    if has_positive && has_negative {
        conflicts.push(ConflictRecord {
            kind: "polarity_conflict".to_string(),
            summary: format!(
                "mixed role conclusion polarity: {}",
                polarities
                    .iter()
                    .map(|(role_id, polarity)| format!("{}={}", role_id, polarity.as_str()))
                    .collect::<Vec<_>>()
                    .join(", ")
            ),
            details: polarities
                .iter()
                .map(|(role_id, polarity)| {
                    compact_conflict_detail(&format!("{}={}", role_id, polarity.as_str()))
                })
                .collect(),
        });
    }

    conflicts
}

fn build_summary_record(
    task_prompt: &str,
    results: &[WorkerRunResult],
    conflicts: &[String],
    conflict_records: &[ConflictRecord],
) -> SummaryRecord {
    let mut ordered = results.iter().collect::<Vec<_>>();
    ordered.sort_by_key(|item| role_rank(&item.role.id));

    let reporter_summary = ordered
        .iter()
        .find(|item| item.role.id == "reporter")
        .map(|item| compact_aggregate_output(item.result.output.trim()))
        .filter(|value| !value.is_empty());

    let items = ordered
        .iter()
        .map(|item| {
            let output = compact_aggregate_output(item.result.output.trim());
            let route = item
                .resolved_route
                .as_ref()
                .map(|route| {
                    format!(
                        "{}/{}",
                        route.plan.primary.provider_name, route.plan.primary.model_name
                    )
                })
                .unwrap_or_else(|| "auto".to_string());
            SummaryItemRecord {
                role_id: item.role.id.clone(),
                route,
                output: if output.is_empty() {
                    "任务已完成".to_string()
                } else {
                    output
                },
            }
        })
        .collect::<Vec<_>>();

    let overall_conclusion = infer_overall_conclusion(&items, reporter_summary.as_deref());
    let key_risks = collect_summary_risks(&items, conflicts);
    let recommended_next_action =
        infer_recommended_next_action(&items, conflicts, conflict_records);

    SummaryRecord {
        task: task_prompt.trim().to_string(),
        roles: ordered.iter().map(|item| item.role.id.clone()).collect(),
        reporter_summary,
        overall_conclusion,
        key_risks,
        recommended_next_action,
        conflicts: conflicts.to_vec(),
        items,
    }
}

fn collect_summary_risks(items: &[SummaryItemRecord], conflicts: &[String]) -> Vec<String> {
    let mut risks = conflicts.to_vec();
    for item in items {
        if let Some(risk_summary) = extract_risk_summary(&item.output) {
            risks.push(format!("{}: {}", item.role_id, risk_summary));
        }
    }
    risks.sort();
    risks.dedup();
    risks
}

fn infer_overall_conclusion(
    items: &[SummaryItemRecord],
    reporter_summary: Option<&str>,
) -> Option<String> {
    const PRIORITIZED_ROLE_CONCLUSIONS: &[&str] = &[
        "code-reviewer",
        "test-engineer",
        "implementer",
        "system-architect",
    ];

    if let Some(summary) = reporter_summary
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        return Some(summary.to_string());
    }

    if let Some(conclusion) = PRIORITIZED_ROLE_CONCLUSIONS.iter().find_map(|role_id| {
        items
            .iter()
            .find(|item| item.role_id == *role_id)
            .and_then(|item| extract_final_consensus(&item.output))
    }) {
        return Some(conclusion.to_string());
    }

    items.first().map(|item| item.output.clone())
}

fn infer_recommended_next_action(
    items: &[SummaryItemRecord],
    conflicts: &[String],
    conflict_records: &[ConflictRecord],
) -> Option<String> {
    if conflict_records
        .iter()
        .any(|record| record.kind == "validation_conflict")
    {
        return Some("先修复验证阶段发现的阻塞或回归，再重新执行验证与裁决。".to_string());
    }

    if !conflicts.is_empty() {
        return Some("先消解角色间冲突，再进入下一步执行或交付。".to_string());
    }

    let has_role = |role_id: &str| items.iter().any(|item| item.role_id == role_id);
    let has_negative_signal = items
        .iter()
        .filter_map(|item| detect_output_polarity(&item.output))
        .any(|polarity| polarity == OutputPolarity::Negative);

    const NEGATIVE_SIGNAL_ACTION: &str = "先处理当前失败或阻塞项，再重新执行验证与裁决。";
    const ROLE_PAIR_ACTIONS: &[(&[&str], &str)] = &[
        (
            &["implementer", "code-reviewer"],
            "运行最终验证并整理交付结论，确认改动可以提交。",
        ),
        (
            &["implementer", "test-engineer"],
            "补齐验证结果并确认回归情况，再进入审查或交付。",
        ),
        (
            &["system-architect", "reporter"],
            "基于当前架构结论进入实现拆解，并同步给用户执行方向。",
        ),
    ];
    const SINGLE_ROLE_ACTIONS: &[(&str, &str)] = &[
        (
            "implementer",
            "进入验证与审查阶段，确认改动行为和回归风险。",
        ),
        (
            "test-engineer",
            "根据验证结果决定是否继续修复，或整理测试结论进入交付。",
        ),
        ("system-architect", "根据当前架构结论进入实现或验证阶段。"),
        (
            "reporter",
            "当前结论可直接反馈给用户，并根据需要继续下一轮细化。",
        ),
    ];

    if has_negative_signal {
        return Some(NEGATIVE_SIGNAL_ACTION.to_string());
    }

    if let Some((_, action)) = ROLE_PAIR_ACTIONS
        .iter()
        .find(|(roles, _)| roles.iter().all(|role_id| has_role(role_id)))
    {
        return Some((*action).to_string());
    }

    if let Some((_, action)) = SINGLE_ROLE_ACTIONS
        .iter()
        .find(|(role_id, _)| has_role(role_id))
    {
        return Some((*action).to_string());
    }

    None
}

fn role_rank(role_id: &str) -> usize {
    match role_id {
        "requirement-analyst" => 0,
        "system-architect" => 1,
        "repo-explorer" => 2,
        "implementer" => 3,
        "test-engineer" => 4,
        "code-reviewer" => 5,
        "devops-operator" => 6,
        "reporter" => 7,
        _ => usize::MAX,
    }
}

#[cfg(test)]
mod tests {
    use super::{
        build_summary_record, collect_conflict_records, infer_overall_conclusion,
        infer_recommended_next_action,
    };
    use crate::agents::summary_compactor::{
        compact_aggregate_output, compact_conflict_detail, extract_risk_summary,
    };
    use crate::agents::worker::WorkerRunResult;
    use sacode_kernel::SummaryItemRecord;
    use sacode_kernel::{AgentRole, ConflictRecord, RoleModelPolicy, SubAgentResult, SubAgentTask};

    fn item(role_id: &str, output: &str) -> SummaryItemRecord {
        SummaryItemRecord {
            role_id: role_id.to_string(),
            route: "auto".to_string(),
            output: output.to_string(),
        }
    }

    fn worker(role_id: &str, output: &str) -> WorkerRunResult {
        WorkerRunResult {
            task: SubAgentTask {
                id: format!("task-{}", role_id),
                title: format!("{} task", role_id),
                prompt: "test prompt".to_string(),
                role_id: role_id.to_string(),
            },
            role: AgentRole {
                id: role_id.to_string(),
                name: role_id.to_string(),
                stage: Some(sacode_kernel::RoleStage::Delivery),
                system_prompt: String::new(),
                responsibilities: Vec::new(),
                allowed_tools: Vec::new(),
                preferred_context: Vec::new(),
                deliverables: Vec::new(),
                handoff_to: Vec::new(),
                model_policy: RoleModelPolicy::default(),
            },
            result: SubAgentResult {
                id: format!("result-{}", role_id),
                success: true,
                output: output.to_string(),
            },
            events: Vec::new(),
            resolved_route: None,
            resolved_model_summary: "auto".to_string(),
        }
    }

    #[test]
    fn infer_overall_conclusion_prefers_reporter_summary() {
        let items = vec![item("system-architect", "任务完成，共完成 3 个步骤")];
        let overall = infer_overall_conclusion(&items, Some("汇总结论已生成，适合进入实现。"));
        assert_eq!(overall.as_deref(), Some("汇总结论已生成，适合进入实现。"));
    }

    #[test]
    fn infer_overall_conclusion_prefers_reviewer_consensus_without_reporter() {
        let items = vec![
            item("implementer", "已完成主要改动，补充了相关处理逻辑。"),
            item("code-reviewer", "审查完成。任务完成，共完成 5 个步骤"),
        ];
        let overall = infer_overall_conclusion(&items, None);
        assert_eq!(overall.as_deref(), Some("任务完成，共完成 5 个步骤"));
    }

    #[test]
    fn infer_recommended_next_action_handles_architect_and_reporter_pair() {
        let items = vec![
            item("system-architect", "架构分析完成。"),
            item("reporter", "已整理结论。"),
        ];
        let next = infer_recommended_next_action(&items, &[], &[]);
        assert_eq!(
            next.as_deref(),
            Some("基于当前架构结论进入实现拆解，并同步给用户执行方向。")
        );
    }

    #[test]
    fn infer_recommended_next_action_prioritizes_negative_signals() {
        let items = vec![
            item("implementer", "改动已完成。"),
            item("test-engineer", "验证失败，存在阻塞。"),
        ];
        let next = infer_recommended_next_action(&items, &[], &[]);
        assert_eq!(
            next.as_deref(),
            Some("先处理当前失败或阻塞项，再重新执行验证与裁决。")
        );
    }

    #[test]
    fn extract_risk_summary_returns_compact_sentence() {
        let risk =
            extract_risk_summary("任务完成，但存在回归风险。建议补充验证步骤。后续可继续推进。");
        assert_eq!(risk.as_deref(), Some("但存在回归风险"));
    }

    #[test]
    fn extract_risk_summary_handles_multiline_output() {
        let risk = extract_risk_summary("已完成检查\n阻塞点：接口鉴权失败\n建议补充凭证配置");
        assert_eq!(risk.as_deref(), Some("阻塞点：接口鉴权失败"));
    }

    #[test]
    fn compact_conflict_detail_prefers_risk_sentence() {
        let detail =
            compact_conflict_detail("任务完成，但存在回归风险。建议补充验证。后续继续推进。");
        assert_eq!(detail, "但存在回归风险");
    }

    #[test]
    fn compact_conflict_detail_prefers_final_consensus() {
        let detail = compact_conflict_detail("前置分析已完成。任务完成，共完成 5 个步骤");
        assert_eq!(detail, "任务完成，共完成 5 个步骤");
    }

    #[test]
    fn compact_aggregate_output_prefers_risk_summary() {
        let output =
            compact_aggregate_output("任务完成，但存在回归风险。建议补充验证。后续继续推进。");
        assert_eq!(output, "但存在回归风险");
    }

    #[test]
    fn compact_aggregate_output_prefers_final_consensus() {
        let output = compact_aggregate_output("前置分析已完成。任务完成，共完成 5 个步骤");
        assert_eq!(output, "任务完成，共完成 5 个步骤");
    }

    #[test]
    fn compact_aggregate_output_keeps_informative_first_sentence() {
        let output = compact_aggregate_output(
            "汇总结论已生成，完成 5 个步骤，参考了 代码读取、命令执行与差异检查。任务完成，共完成 5 个步骤",
        );
        assert_eq!(
            output,
            "汇总结论已生成，完成 5 个步骤，参考了 代码读取、命令执行与差异检查"
        );
    }

    #[test]
    fn build_summary_record_compacts_reporter_and_item_outputs() {
        let results = vec![
            worker(
                "system-architect",
                "架构路径已梳理。任务完成，共完成 5 个步骤",
            ),
            worker(
                "reporter",
                "汇总结论已生成，完成 5 个步骤。任务完成，共完成 5 个步骤",
            ),
        ];

        let summary = build_summary_record("test prompt", &results, &[], &[]);

        assert_eq!(
            summary.reporter_summary.as_deref(),
            Some("汇总结论已生成，完成 5 个步骤")
        );
        assert_eq!(
            summary.overall_conclusion.as_deref(),
            Some("汇总结论已生成，完成 5 个步骤")
        );
        assert_eq!(summary.items[0].output, "任务完成，共完成 5 个步骤");
        assert_eq!(summary.items[1].output, "汇总结论已生成，完成 5 个步骤");
    }

    #[test]
    fn collect_conflict_records_adds_validation_conflict_for_negative_validation() {
        let implementer = worker("implementer", "实现结果已整理。任务完成，共完成 5 个步骤");
        let tester = worker(
            "test-engineer",
            "验证风险已识别。验证失败，存在阻塞。建议补齐回归验证。",
        );

        let conflicts = collect_conflict_records(&[&implementer, &tester]);

        assert!(conflicts
            .iter()
            .any(|record| record.kind == "validation_conflict"));
    }

    #[test]
    fn infer_recommended_next_action_prioritizes_validation_conflict() {
        let items = vec![
            item("implementer", "实现结果已整理。任务完成，共完成 5 个步骤"),
            item("test-engineer", "验证风险已识别。验证失败，存在阻塞。"),
        ];
        let conflict_records = vec![ConflictRecord {
            kind: "validation_conflict".to_string(),
            summary: "implementation completion conflicts with validation findings: test-engineer"
                .to_string(),
            details: vec!["test-engineer: 验证失败，存在阻塞".to_string()],
        }];

        let next =
            infer_recommended_next_action(&items, &["conflict".to_string()], &conflict_records);

        assert_eq!(
            next.as_deref(),
            Some("先修复验证阶段发现的阻塞或回归，再重新执行验证与裁决。")
        );
    }
}

/// 从消息总线收集各 Agent 的通信摘要
async fn collect_communication_summaries(
    results: &[WorkerRunResult],
    message_bus: &MessageBus,
) -> HashMap<String, CommunicationSummary> {
    let history = message_bus.message_history().await;
    let mut summaries = HashMap::new();

    for result in results {
        let summary = build_communication_summary(&history, &result.task.id);
        summaries.insert(result.task.id.clone(), summary);
    }

    summaries
}
