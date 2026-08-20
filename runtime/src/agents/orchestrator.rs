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

use super::message_bus::{AgentMailboxHandle, CommunicationSummary, MessageBus, build_communication_summary};
use super::summary_compactor::{
    compact_aggregate_output, compact_conflict_detail, consensus_output, detect_output_polarity,
    extract_final_consensus, extract_risk_summary, OutputPolarity,
};
use super::{build_execution_plan, RoleRegistry};
use super::loop_impl::LoopSubsystems;
use crate::agents::worker::{run_sub_agent, WorkerRunResult};
use crate::config::profile::Profile;
use crate::model_routing::TaskProfile;
use crate::{task_run_from_report, CheckpointStorage};

pub async fn execute_role_driven_orchestration(
    context: &ExecutionContext,
    checkpoints: &CheckpointStorage,
    workdir: &std::path::Path,
    named_profile: Option<&Profile>,
    subsystems: LoopSubsystems,
) -> Result<(ExecutionReport, sacode_kernel::AgentExecutionPlan)> {
    let roles = RoleRegistry::builtin();
    let profile = TaskProfile::from_prompt_and_workspace(&context.task.prompt, workdir);
    let plan = build_execution_plan(&context.task.prompt, workdir, &profile, roles.all());

    let mut report = ExecutionReport {
        plan: Some(sacode_kernel::Plan::new(
            context.task.prompt.clone(),
            Vec::new(),
            context.mode.to_string(),
        )),
        events: vec![sacode_kernel::Event::message(format!(
            "进入角色驱动编排模式：{:?}，子系统={:?}",
            plan.mode,
            subsystems
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

    let results = execute_parallel_groups(&plan, &roles, &profile, workdir, &mut report, &message_bus, named_profile, subsystems).await;

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

    // 灵枢 · 自防护 — 冲突处置回路
    // 门控下沉至干预点（C2 贯穿）：self_protection 关闭时仍记录冲突与告警，
    // 仅跳过 InterventionRequest 干预与修复闭环，对齐"仅记录冲突"语义。
    handle_conflict_disposition(&mut report, &message_bus, workdir, subsystems).await;

    finalize_orchestration_events(&mut report, &results);

    Ok((report, plan))
}


/// 灵枢 · 自防护 — 冲突处置回路
///
/// 检测到冲突后，根据严重程度采取不同处置策略：
/// - validation_conflict（实现与验证冲突）：触发修复闭环（M1 状态机）+ 发送 InterventionRequest
/// - 其他冲突：添加告警事件，在输出中追加处置建议
///
/// 门控语义（C2 贯穿）：`subsystems.self_protection` 关闭时**仍记录冲突与告警**，
/// 仅跳过 InterventionRequest 干预与修复闭环——保证冲突可见性不随自防护关闭而丢失。
async fn handle_conflict_disposition(
    report: &mut ExecutionReport,
    message_bus: &MessageBus,
    workdir: &std::path::Path,
    subsystems: LoopSubsystems,
) {
    if report.conflict_records.is_empty() {
        return;
    }
    let has_validation_conflict = report
        .conflict_records
        .iter()
        .any(|record| record.kind == "validation_conflict");

    // self_protection 门控：决定 validation_conflict 是否触发修复闭环
    let fix_loop_triggered = has_validation_conflict && subsystems.self_protection;

    if has_validation_conflict {
        // 最严重冲突：实现与验证冲突 → 实时干预触发修复闭环（自防护→自愈回路）
        report.events.push(sacode_kernel::Event::error(format!(
            "灵枢·自防护：检测到验证冲突（实现与验证结果不一致），{}。冲突数：{}",
            if fix_loop_triggered { "触发修复闭环" } else { "自防护已关闭，仅记录冲突" },
            report.conflict_records.len()
        )));

        if fix_loop_triggered {
            // 发送 InterventionRequest 到消息总线，请求 test-engineer 介入修复
            message_bus
                .broadcast(
                    "orchestrator",
                    super::message_bus::AgentMessageKind::InterventionRequest,
                    format!(
                        "检测到 validation_conflict，请 test-engineer 重新运行 test.fix 修复并验证（最多 {} 轮）",
                        crate::tools::test::autofix::MAX_FIX_ITERATIONS
                    ),
                )
                .await;

            // 触发修复闭环：调用 test.fix 驱动一轮分析与验证（M1 状态机）
            // 修复动作（fs.edit）由外部 LLM 工具循环完成，此处驱动状态机并记录度量
            match dispatch_fix_loop(workdir, report).await {
                Ok(loop_summary) => {
                    report.events.push(sacode_kernel::Event::thinking(format!(
                        "灵枢·自修复：修复闭环驱动完成，{}",
                        loop_summary
                    )));
                }
                Err(error) => {
                    report.events.push(sacode_kernel::Event::error(format!(
                        "灵枢·自修复：修复闭环驱动失败：{}",
                        error
                    )));
                }
            }
        }
    } else {
        // 一般冲突：添加告警，提醒用户关注
        report.events.push(sacode_kernel::Event::message(format!(
            "灵枢·自防护：检测到 {} 项冲突，请关注汇总报告中的建议动作",
            report.conflict_records.len()
        )));
    }

    // 在最终输出中追加冲突处置建议
    if let Some(ref mut output) = report.final_output {
        let conflict_summary: Vec<String> = report
            .conflict_records
            .iter()
            .map(|record| format!("- [{}] {}", record.kind, record.summary))
            .collect();
        output.push_str("\n\n---\n## 灵枢·自防护冲突告警\n");
        output.push_str(&format!(
            "检测到 {} 项冲突：\n{}\n",
            report.conflict_records.len(),
            conflict_summary.join("\n")
        ));
        if has_validation_conflict {
            output.push_str(if fix_loop_triggered {
                "\n**处置建议**：已触发自动修复闭环（test.fix 状态机），请检查实现代码与测试结果的一致性，修复后重新验证。\n"
            } else {
                "\n**处置建议**：检测到验证冲突，但自防护子系统已关闭，未触发自动修复闭环。请人工检查实现与测试结果的一致性。\n"
            });
        } else {
            output.push_str("\n**处置建议**：请审查上方冲突详情，确认是否需要调整执行策略。\n");
        }
    }
}

/// 收尾：追加汇总裁决与完成事件
fn finalize_orchestration_events(report: &mut ExecutionReport, results: &[WorkerRunResult]) {
    report.events.push(sacode_kernel::Event::thinking(format!(
        "主 Agent 汇总裁决完成，汇总角色数：{}",
        results.len()
    )));
    report.events.push(sacode_kernel::Event::done(format!(
        "角色驱动编排完成，子 Agent 数量：{}",
        results.len()
    )));
}
/// 单任务执行入口（C2 贯穿）：接受 `subsystems` 参数控制灵枢三子系统行为。
///
/// 调用方（CLI / SDK / 测试）可按需传入 `LoopSubsystems::default()`（全开）、
/// `LoopSubsystems::protection_only()`（仅自防护）或 `LoopSubsystems::none()`（全关）。
pub async fn execute_role_driven_task_run(
    context: &ExecutionContext,
    checkpoints: &CheckpointStorage,
    workdir: &std::path::Path,
    named_profile: Option<&Profile>,
    subsystems: LoopSubsystems,
) -> Result<(TaskRun, sacode_kernel::AgentExecutionPlan)> {
    let (report, plan) = execute_role_driven_orchestration(context, checkpoints, workdir, named_profile, subsystems).await?;
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
    named_profile: Option<&Profile>,
    subsystems: LoopSubsystems,
) -> Vec<WorkerRunResult> {
    let mut all_results = Vec::new();

    // 灵枢 · Agent Teams：注册所有子 Agent 到消息总线，保留邮箱句柄供 worker 使用
    // worker 通过 mailbox 消费前序 Agent 消息并发布自身进度，形成协作闭环
    let mut mailboxes: HashMap<String, AgentMailboxHandle> = HashMap::new();
    for task in &plan.tasks {
        let mailbox = message_bus.register(task.id.clone()).await;
        mailboxes.insert(task.id.clone(), mailbox);
    }

    // 灵枢 · Agent Teams 阶段三：构建 role_id → task_id 映射
    // worker 解析输出中的协助请求标记（target=role_id）后，
    // 通过此映射转换为 mailbox 目标 task_id，发送定向消息
    let role_task_map: HashMap<String, String> = plan
        .tasks
        .iter()
        .map(|task| (task.role_id.clone(), task.id.clone()))
        .collect();

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
            // 取出 mailbox 传给 worker，让子 Agent 能消费前序消息并发布自身进度
            let mailbox = mailboxes.remove(task_id);
            worker_runs.push(run_sub_agent(
                task.clone(),
                role,
                profile,
                workdir,
                mailbox,
                &role_task_map,
                named_profile,
                subsystems,
            ));
        }

        let mut group_results = futures::future::join_all(worker_runs).await;

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
    let mut conflicts: Vec<ConflictRecord> = Vec::new();

    // 降级：status_conflict/route_conflict/conclusion_conflict/polarity_conflict 降级为日志记录
    // 不再触发独立干预，仅保留 validation_conflict 主路径
    if results.iter().map(|r| r.result.success).collect::<std::collections::BTreeSet<_>>().len() > 1 {
        tracing::debug!("collect_conflict_records: status_conflict (mixed success across roles)");
    }

    if results.iter().filter_map(|r| r.resolved_route.as_ref().map(|route| {
        format!("{}/{}", route.plan.primary.provider_name, route.plan.primary.model_name)
    })).collect::<std::collections::BTreeSet<_>>().len() > 1 {
        tracing::debug!("collect_conflict_records: route_conflict (multiple primary routes)");
    }

    // validation_conflict — 保留为主路径
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
            summary: format!("implementation completion conflicts with validation findings: {}",
                validation_disagreements.iter().map(|(role_id, _, _)| *role_id).collect::<Vec<_>>().join(", ")),
            details: validation_disagreements.iter().map(|(role_id, _, output)| {
                compact_conflict_detail(&format!("{}: {}", role_id, output))
            }).collect(),
        });
    }

    if results.iter().filter_map(|r| consensus_output(r.result.output.trim())).collect::<std::collections::BTreeSet<_>>().len() > 1 {
        tracing::debug!("collect_conflict_records: conclusion_conflict (multiple distinct conclusions)");
    }

    let polarities: Vec<_> = results.iter().filter_map(|item| {
        detect_output_polarity(item.result.output.trim()).map(|p| (item.role.id.as_str(), p))
    }).collect();
    if polarities.iter().any(|(_, p)| *p == OutputPolarity::Positive)
        && polarities.iter().any(|(_, p)| *p == OutputPolarity::Negative) {
        tracing::debug!("collect_conflict_records: polarity_conflict (mixed output polarity)");
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
        aggregate_worker_results, build_summary_record, collect_conflict_records, fold_worker_results,
        infer_overall_conclusion, infer_recommended_next_action,
    };
    use crate::agents::message_bus::CommunicationSummary;
    use crate::agents::model_router::ResolvedRoleRoute;
    use crate::agents::summary_compactor::{
        compact_aggregate_output, compact_conflict_detail, extract_risk_summary,
    };
    use crate::agents::worker::WorkerRunResult;
    use crate::model_routing::{ModelRoutePlan, RoutedModel};
    use sacode_kernel::SummaryItemRecord;
    use sacode_kernel::{AgentRole, ConflictRecord, ExecutionReport, RoleModelPolicy, SubAgentResult, SubAgentTask};
    use std::collections::HashMap;

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

    /// 构造指定 success 状态的 worker，用于状态冲突测试
    fn worker_with_status(role_id: &str, output: &str, success: bool) -> WorkerRunResult {
        let mut w = worker(role_id, output);
        w.result.success = success;
        w
    }

    /// 构造携带 resolved_route 的 worker，用于路由冲突与 fold 测试
    fn worker_with_route(role_id: &str, output: &str, route: ResolvedRoleRoute) -> WorkerRunResult {
        let mut w = worker(role_id, output);
        w.resolved_route = Some(route);
        w
    }

    /// 构造简化的 ResolvedRoleRoute，仅含 primary 路由
    fn route(provider: &str, model: &str) -> ResolvedRoleRoute {
        ResolvedRoleRoute {
            plan: ModelRoutePlan {
                primary: RoutedModel {
                    provider_name: provider.to_string(),
                    model_name: model.to_string(),
                    route_score: 80,
                    needs_thinking: false,
                    reasons: vec!["default".to_string()],
                },
                fallbacks: vec![],
                route_reason: "auto".to_string(),
            },
            summary: format!("{}/{}", provider, model),
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

    // ── 灵枢 · 自组织 · 多角色协同实战覆盖 ──────────────────────

    #[test]
    fn collect_conflict_records_detects_status_conflict() {
        // 维度 1：success 状态混合 — status_conflict
        let explorer = worker_with_status("repo-explorer", "正在分析", true);
        let devops = worker_with_status("devops-operator", "正在分析", false);

        let conflicts = collect_conflict_records(&[&explorer, &devops]);

        assert!(
            conflicts.is_empty(),
            "status_conflict 已降级为日志，不再出现在冲突记录中，实际：{:?}",
            conflicts
        );
    }

    #[test]
    fn collect_conflict_records_detects_route_conflict() {
        // 维度 2：主路由不同 — route_conflict
        // 使用中性输出避免触发其他冲突维度
        let explorer = worker_with_route("repo-explorer", "正在分析", route("openai", "gpt-4"));
        let devops = worker_with_route(
            "devops-operator",
            "正在分析",
            route("anthropic", "claude-3"),
        );

        let conflicts = collect_conflict_records(&[&explorer, &devops]);

        assert!(
            conflicts.is_empty(),
            "route_conflict 已降级为日志，不再出现在冲突记录中，实际：{:?}",
            conflicts
        );
    }

    #[test]
    fn collect_conflict_records_detects_conclusion_conflict() {
        // 维度 4：共识结论不同 — conclusion_conflict
        // 使用相同极性（正向）避免触发 polarity_conflict
        let explorer = worker(
            "repo-explorer",
            "探索完成。任务完成，共完成 3 个步骤",
        );
        let devops = worker(
            "devops-operator",
            "交付检查。任务完成，共完成 5 个步骤",
        );

        let conflicts = collect_conflict_records(&[&explorer, &devops]);

        assert!(
            conflicts.is_empty(),
            "conclusion_conflict 已降级为日志，不再出现在冲突记录中，实际：{:?}",
            conflicts
        );
    }

    #[test]
    fn collect_conflict_records_detects_polarity_conflict() {
        // 极性混合触发 validation_conflict，polarity_conflict 已降级为日志
        // 维度 5：极性混合 — polarity_conflict
        // 实现者正向 + 验证者负向，同时也会触发 validation_conflict，
        // 这里仅断言 polarity_conflict 被识别
        let implementer = worker("implementer", "实现结果已整理。任务完成，共完成 5 个步骤");
        let tester = worker(
            "test-engineer",
            "验证风险已识别。验证失败，存在阻塞。",
        );

        let conflicts = collect_conflict_records(&[&implementer, &tester]);

        assert!(
            !conflicts.is_empty(),
            "极性混合应触发 validation_conflict，实际为空：{:?}",
            conflicts
        );
        assert!(
            conflicts.iter().any(|r| r.kind == "validation_conflict"),
            "应包含 validation_conflict，实际：{:?}",
            conflicts
        );
        assert!(
            !conflicts.iter().any(|r| r.kind == "polarity_conflict"),
            "polarity_conflict 已降级为日志，不应出现在冲突记录中，实际：{:?}",
            conflicts
        );
    }

    #[test]
    fn collect_conflict_records_returns_empty_when_consistent() {
        // 全部角色一致：相同状态、相同极性、相同结论、无路由 → 无冲突
        let explorer = worker("repo-explorer", "正在分析");
        let devops = worker("devops-operator", "正在分析");

        let conflicts = collect_conflict_records(&[&explorer, &devops]);

        assert!(
            conflicts.is_empty(),
            "全部一致时不应检测到冲突，实际：{:?}",
            conflicts
        );
    }

    #[test]
    fn aggregate_worker_results_orders_roles_by_rank() {
        // 验证 aggregate 输出按 role_rank 排序（reporter 在最末）
        let results = vec![
            worker("reporter", "汇总结论已生成，完成 5 个步骤。"),
            worker("repo-explorer", "探索结论已整理。"),
            worker("implementer", "实现结论已整理。"),
        ];

        let output = aggregate_worker_results("测试任务", &results, &[]);

        // roles= 行应按 rank 排序：repo-explorer(2), implementer(3), reporter(7)
        let roles_line = output
            .lines()
            .find(|line| line.starts_with("roles="))
            .expect("应包含 roles= 行");
        assert_eq!(
            roles_line,
            "roles=repo-explorer,implementer,reporter"
        );
    }

    #[test]
    fn aggregate_worker_results_includes_reporter_summary_line() {
        // reporter 角色输出应单独提取为 reporter_summary= 行
        let results = vec![
            worker("implementer", "实现结果已整理。"),
            worker(
                "reporter",
                "汇总结论已生成，完成 5 个步骤。任务完成，共完成 5 个步骤",
            ),
        ];

        let output = aggregate_worker_results("任务 X", &results, &[]);

        let reporter_line = output
            .lines()
            .find(|line| line.starts_with("reporter_summary="));
        assert!(
            reporter_line.is_some(),
            "应包含 reporter_summary= 行，实际输出：\n{}",
            output
        );
        assert!(
            reporter_line
                .unwrap()
                .contains("汇总结论已生成，完成 5 个步骤"),
            "reporter_summary 应包含 reporter 输出摘要"
        );
    }

    #[test]
    fn aggregate_worker_results_includes_conflicts_section() {
        // conflicts 列表非空时，输出应包含 conflicts= 行
        let results = vec![worker("implementer", "实现结果已整理。")];
        let conflicts = vec!["status_conflict: mixed success".to_string()];

        let output = aggregate_worker_results("任务 Y", &results, &conflicts);

        let conflicts_line = output
            .lines()
            .find(|line| line.starts_with("conflicts="));
        assert!(
            conflicts_line.is_some(),
            "应包含 conflicts= 行，实际输出：\n{}",
            output
        );
        assert!(conflicts_line.unwrap().contains("status_conflict: mixed success"));
    }

    #[test]
    fn aggregate_worker_results_skips_empty_role_output() {
        // 空输出角色不应在 aggregate 输出中生成 `- role:` 行
        let results = vec![
            worker("implementer", "实现结果已整理。"),
            worker("repo-explorer", "   "),
        ];

        let output = aggregate_worker_results("任务 Z", &results, &[]);

        // repo-explorer 输出为空，不应在 per-role 行中出现
        let repo_line = output
            .lines()
            .find(|line| line.starts_with("- repo-explorer"));
        assert!(
            repo_line.is_none(),
            "空输出角色不应出现在聚合输出中，实际：\n{}",
            output
        );
        // implementer 仍应出现
        assert!(
            output.lines().any(|line| line.starts_with("- implementer")),
            "非空输出角色应保留"
        );
    }

    #[test]
    fn fold_worker_results_records_route_and_tool_records() {
        // 验证 fold_worker_results 将 route 与 tool 记录正确折叠到 ExecutionReport
        let implementer = worker_with_route(
            "implementer",
            "实现结果已整理。",
            route("openai", "gpt-4"),
        );
        let tester = worker_with_route(
            "test-engineer",
            "验证结论已整理。",
            route("anthropic", "claude-3"),
        );
        let results = vec![implementer, tester];

        let mut report = ExecutionReport::default();
        let comm_summaries: HashMap<String, CommunicationSummary> = HashMap::new();

        fold_worker_results(&mut report, &results, &comm_summaries);

        // 应生成 2 条 tool_records（每个 worker 一条）
        assert_eq!(report.tool_records.len(), 2);
        assert!(report
            .tool_records
            .iter()
            .any(|record| record.tool_name == "subagent.implementer"));
        assert!(report
            .tool_records
            .iter()
            .any(|record| record.tool_name == "subagent.test-engineer"));

        // 应生成 2 条 route_records，包含不同 provider
        assert_eq!(report.route_records.len(), 2);
        let providers: Vec<&str> = report
            .route_records
            .iter()
            .map(|record| record.primary.provider_name.as_str())
            .collect();
        assert!(providers.contains(&"openai"));
        assert!(providers.contains(&"anthropic"));

        // 应生成事件序列（每个 worker 至少 2 条事件：绑定 + 模型决策）
        assert!(
            report.events.len() >= 4,
            "应至少生成 4 条事件（每 worker 2 条），实际：{}",
            report.events.len()
        );
    }

    #[test]
    fn fold_worker_results_includes_communication_summary_events() {
        // 通信摘要非空时，应追加通信事件到 report.events
        let implementer = worker("implementer", "实现结果已整理。");
        let results = vec![implementer];

        let mut comm_summaries: HashMap<String, CommunicationSummary> = HashMap::new();
        comm_summaries.insert(
            "task-implementer".to_string(),
            CommunicationSummary {
                sent_count: 1,
                received_count: 2,
                messages: Vec::new(),
            },
        );

        let mut report = ExecutionReport::default();
        fold_worker_results(&mut report, &results, &comm_summaries);

        // 应包含通信事件 — Event 不实现 Display，通过模式匹配提取 content
        let has_comm_event = report.events.iter().any(|event| {
            if let sacode_kernel::Event::Thinking { content } = event {
                content.contains("通信：发送 1 条，接收 2 条")
            } else {
                false
            }
        });
        assert!(
            has_comm_event,
            "应包含通信摘要事件，实际事件：{:?}",
            report.events
        );
    }

    #[test]
    fn build_summary_record_dedup_risks() {
        // 重复的 conflicts 条目应在 SummaryRecord.key_risks 中去重
        // 注意：role-prefixed risks 因 role_id 不同不会去重，故用 conflicts 验证字面去重
        let results = vec![
            worker("implementer", "实现结果已整理。"),
            worker("code-reviewer", "审查结果已整理。"),
        ];
        let conflicts = vec![
            "status_conflict: mixed success".to_string(),
            "status_conflict: mixed success".to_string(), // 字面重复
            "route_conflict: different providers".to_string(),
        ];

        let summary = build_summary_record("test prompt", &results, &conflicts, &[]);

        // worker 输出无风险信号，key_risks 应仅来自 conflicts（已去重）
        assert_eq!(
            summary.key_risks.len(),
            2,
            "重复 conflicts 应去重为 2 条，实际：{:?}",
            summary.key_risks
        );
        assert!(summary
            .key_risks
            .contains(&"status_conflict: mixed success".to_string()));
        assert!(summary
            .key_risks
            .contains(&"route_conflict: different providers".to_string()));
    }

    // ── C2 贯穿 · 自防护门控单元测试 ──────────────────────────

    /// 构造含 validation_conflict 的 ExecutionReport，用于门控测试
    fn report_with_validation_conflict() -> ExecutionReport {
        ExecutionReport {
            conflict_records: vec![ConflictRecord {
                kind: "validation_conflict".to_string(),
                summary: "实现与验证不一致".to_string(),
                details: vec!["test-engineer 验证失败".to_string()],
            }],
            final_output: Some("初始输出".to_string()),
            ..ExecutionReport::default()
        }
    }

    /// 从事件列表中提取包含指定文本的事件数量
    fn count_events_with(events: &[sacode_kernel::Event], needle: &str) -> usize {
        events.iter().filter(|event| {
            let text = match event {
                sacode_kernel::Event::Error { message } => Some(message.as_str()),
                sacode_kernel::Event::Thinking { content } => Some(content.as_str()),
                sacode_kernel::Event::Message { content } => Some(content.as_str()),
                _ => None,
            };
            text.map_or(false, |t| t.contains(needle))
        }).count()
    }

    #[tokio::test]
    async fn protection_only_skips_fix_loop_on_validation_conflict() {
        // self_protection=false → 不触发修复闭环，仅记录冲突与告警
        use super::{handle_conflict_disposition, MessageBus};
        let mut report = report_with_validation_conflict();
        let bus = MessageBus::new();
        let workdir = std::path::Path::new(".");

        handle_conflict_disposition(&mut report, &bus, workdir, crate::agents::loop_impl::LoopSubsystems::none()).await;

        // 错误事件应包含"自防护已关闭"
        assert_eq!(
            count_events_with(&report.events, "自防护已关闭"),
            1,
            "self_protection=false 时错误事件应包含'自防护已关闭'，实际事件：{:?}",
            report.events.iter().map(|e| format!("{:?}", e)).collect::<Vec<_>>()
        );

        // 不应有修复闭环驱动事件（dispatch_fix_loop 未被调用）
        assert_eq!(
            count_events_with(&report.events, "修复闭环驱动"),
            0,
            "self_protection=false 时不应调用 dispatch_fix_loop"
        );

        // 最终输出应包含"未触发自动修复闭环"
        assert!(
            report.final_output.as_ref().unwrap().contains("未触发自动修复闭环"),
            "输出应提示用户人工检查，实际：{}",
            report.final_output.as_ref().unwrap()
        );
    }

    #[tokio::test]
    async fn default_subsystems_triggers_fix_loop_on_validation_conflict() {
        // self_protection=true（默认）→ 触发修复闭环
        use super::{handle_conflict_disposition, MessageBus};
        let mut report = report_with_validation_conflict();
        let bus = MessageBus::new();
        let workdir = std::path::Path::new(".");

        handle_conflict_disposition(&mut report, &bus, workdir, crate::agents::loop_impl::LoopSubsystems::default()).await;

        // 错误事件应包含"触发修复闭环"
        assert_eq!(
            count_events_with(&report.events, "触发修复闭环"),
            1,
            "self_protection=true 时错误事件应包含'触发修复闭环'"
        );

        // dispatch_fix_loop 被调用——无论成功失败都应有相关事件
        let fix_events = count_events_with(&report.events, "修复闭环驱动");
        assert!(
            fix_events >= 1,
            "self_protection=true 时应调用 dispatch_fix_loop 并记录事件，实际：{:?}",
            report.events.iter().map(|e| format!("{:?}", e)).collect::<Vec<_>>()
        );

        // 最终输出应包含"已触发自动修复闭环"
        assert!(
            report.final_output.as_ref().unwrap().contains("已触发自动修复闭环"),
            "输出应提示修复闭环已触发，实际：{}",
            report.final_output.as_ref().unwrap()
        );
    }

    #[tokio::test]
    async fn no_conflict_skips_disposition_entirely() {
        // 无冲突时 handle_conflict_disposition 应立即返回，不追加任何事件
        use super::{handle_conflict_disposition, MessageBus};
        let mut report = ExecutionReport {
            conflict_records: Vec::new(),
            final_output: Some("正常输出".to_string()),
            ..ExecutionReport::default()
        };
        let initial_event_count = report.events.len();
        let bus = MessageBus::new();
        let workdir = std::path::Path::new(".");

        handle_conflict_disposition(&mut report, &bus, workdir, crate::agents::loop_impl::LoopSubsystems::default()).await;

        assert_eq!(report.events.len(), initial_event_count, "无冲突时不应追加事件");
        assert_eq!(*report.final_output.as_ref().unwrap(), "正常输出", "输出不应被修改");
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

/// 灵枢 · 自修复 — 修复闭环驱动
///
/// 当检测到 `validation_conflict` 时由冲突处置回路调用：直接执行 `test.fix` 工具
/// 驱动一轮"分析失败 → 生成修复上下文 → 验证"状态机（M1 `FixLoopState`）。
/// 修复动作（fs.edit）由外部 LLM 工具循环完成，本函数负责驱动闭环并记录度量。
///
/// 防无限循环：干预次数由调用方（冲突处置块）控制，本函数本身每轮仅生成上下文
/// 并验证，不自行重复执行直至通过（避免空转浪费 token）。
async fn dispatch_fix_loop(
    _workdir: &std::path::Path,
    report: &mut ExecutionReport,
) -> anyhow::Result<String> {
    // 直接驱动 test.fix 状态机（其实现内部使用 current_dir 定位项目根）
    let input = serde_json::json!({
        "auto_apply": true,
        "max_iterations": crate::tools::test::autofix::MAX_FIX_ITERATIONS
    });
    let output = crate::tools::test::autofix::execute(input)?;

    let success = output.data["success"].as_bool().unwrap_or(false);
    let iterations = output.data["total_iterations"].as_u64().unwrap_or(0);
    let summary = output
        .message
        .clone()
        .unwrap_or_else(|| "修复闭环驱动完成".to_string());

    // 记录修复度量到 report
    report.events.push(sacode_kernel::Event::message(format!(
        "灵枢·自修复：test.fix 驱动（success={}, iterations={}）",
        success, iterations
    )));

    Ok(format!("success={}, iterations={}, {}", success, iterations, summary))
}

/// 灵枢 · 实时干预 — 动态调整执行计划
///
/// 接收 `InterventionRequest` 消息后，根据冲突类型动态调整执行计划：
/// - validation_conflict → 追加 test-engineer 修复轮次（重新运行 test.fix）
/// - 其他冲突 → 追加 code-reviewer 复核轮次
///
/// 返回是否成功追加干预轮次（用于调用方判断是否继续编排）。
#[allow(dead_code)]
async fn handle_intervention(
    message_bus: &MessageBus,
    request: &super::message_bus::AgentMessage,
    report: &mut ExecutionReport,
) -> bool {
    let content = &request.content;
    if content.contains("validation_conflict") {
        // 追加 test-engineer 修复轮次：重新运行 test.fix 验证
        let fix_input = serde_json::json!({
            "auto_apply": true,
            "max_iterations": crate::tools::test::autofix::MAX_FIX_ITERATIONS
        });
        match crate::tools::test::autofix::execute(fix_input) {
            Ok(output) => {
                let success = output.data["success"].as_bool().unwrap_or(false);
                report.events.push(sacode_kernel::Event::thinking(format!(
                    "灵枢·实时干预：追加 test-engineer 修复轮次，success={}",
                    success
                )));
                // 回应 InterventionRequest（携带 reply_to 引用链）
                let _ = message_bus
                    .broadcast(
                        "orchestrator",
                        super::message_bus::AgentMessageKind::TaskResult,
                        format!("干预完成：test.fix success={}", success),
                    )
                    .await;
                return true;
            }
            Err(error) => {
                report.events.push(sacode_kernel::Event::error(format!(
                    "灵枢·实时干预：追加修复轮次失败：{}",
                    error
                )));
                return false;
            }
        }
    }

    // 其他冲突：追加 code-reviewer 复核轮次（记录事件，等待 LLM 工具循环消费）
    report.events.push(sacode_kernel::Event::message(format!(
        "灵枢·实时干预：收到非验证类干预请求，已记录待复核：{}",
        content
    )));
    true
}
