use anyhow::Result;
use sacode_kernel::{ConflictRecord, ExecutionContext, ExecutionReport, HookRecord, LifecyclePoint, RouteRecord, RoutedModelRecord, SummaryItemRecord, SummaryRecord, ToolExecutionRecord};

use super::{RoleRegistry, build_execution_plan};
use crate::CheckpointStorage;
use crate::agents::worker::{WorkerRunResult, run_sub_agent};
use crate::model_routing::TaskProfile;

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

    let results = execute_parallel_groups(&plan, &roles, &profile, &workdir, &mut report).await;
    fold_worker_results(&mut report, &results);

    let checkpoint = sacode_kernel::Checkpoint::new(context.task.clone());
    let checkpoint_path = checkpoints.save(&checkpoint)?;
    report.checkpoint_refs.push(checkpoint_path.display().to_string());
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
    report.summary_record = Some(build_summary_record(&context.task.prompt, &results, &report.conflicts));
    report.final_output = Some(aggregate_worker_results(&context.task.prompt, &results, &report.conflicts));
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

async fn execute_parallel_groups(
    plan: &sacode_kernel::AgentExecutionPlan,
    roles: &RoleRegistry,
    profile: &TaskProfile,
    workdir: &std::path::Path,
    report: &mut ExecutionReport,
) -> Vec<WorkerRunResult> {
    let mut all_results = Vec::new();

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
        report.events.push(sacode_kernel::Event::message(format!(
            "并发组 #{} 执行完成",
            group_index + 1
        )));
        all_results.append(&mut group_results);
    }

    all_results
}

fn fold_worker_results(report: &mut ExecutionReport, results: &[WorkerRunResult]) {
    for item in results {
        report.events.push(sacode_kernel::Event::message(format!(
            "子 Agent [{}] 绑定角色 [{}]",
            item.task.id, item.role.id
        )));
        report.events.push(sacode_kernel::Event::thinking(format!(
            "子 Agent [{}] 模型决策：{}",
            item.task.id, item.resolved_model_summary
        )));
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
                    .map(|entry| format!("{}/{}({})", entry.provider_name, entry.model_name, entry.route_score))
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

fn aggregate_worker_results(task_prompt: &str, results: &[WorkerRunResult], conflicts: &[String]) -> String {
    let mut ordered = results.iter().collect::<Vec<_>>();
    ordered.sort_by_key(|item| role_rank(&item.role.id));

    let mut lines = Vec::new();
    lines.push(format!("task={}", task_prompt.trim()));
    lines.push(format!("roles={}", ordered.iter().map(|item| item.role.id.as_str()).collect::<Vec<_>>().join(",")));

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
            .map(|route| format!("{}/{}", route.plan.primary.provider_name, route.plan.primary.model_name))
            .unwrap_or_else(|| "auto".to_string());
        lines.push(format!(
            "- {} [{}]: {}",
            item.role.id,
            route_summary,
            output
        ));
    }

    lines.join("\n")
}

fn compact_aggregate_output(output: &str) -> String {
    let trimmed = output.trim();
    if trimmed.is_empty() {
        return String::new();
    }

    if let Some(risk_summary) = extract_risk_summary(trimmed) {
        return risk_summary;
    }

    if let (Some(first_sentence), Some(consensus)) = (
        first_summary_sentence(trimmed),
        extract_final_consensus(trimmed),
    ) {
        let first_sentence = first_sentence.trim();
        let consensus = consensus.trim();
        if first_sentence != consensus
            && first_sentence.chars().count() >= 12
            && is_generic_completion_sentence(consensus)
        {
            return first_sentence.to_string();
        }
    }

    if let Some(consensus) = extract_final_consensus(trimmed) {
        let consensus = consensus.trim();
        if !consensus.is_empty() {
            return consensus.to_string();
        }
    }

    trimmed
        .lines()
        .map(str::trim)
        .find(|line| !line.is_empty())
        .unwrap_or(trimmed)
        .to_string()
}

fn first_summary_sentence(output: &str) -> Option<&str> {
    output
        .split(['\n', '。', '.', ';', '；', '!', '！', '?', '？'])
        .map(str::trim)
        .find(|segment| !segment.is_empty())
}

fn is_generic_completion_sentence(sentence: &str) -> bool {
    let trimmed = sentence.trim();
    trimmed.contains("任务完成")
        || trimmed == "完成"
        || trimmed == "已完成"
        || trimmed == "规划完成，等待执行"
}

fn collect_conflict_records(results: &[&WorkerRunResult]) -> Vec<ConflictRecord> {
    let success_values = results.iter().map(|item| item.result.success).collect::<std::collections::BTreeSet<_>>();
    let mut conflicts = Vec::new();
    if success_values.len() > 1 {
        conflicts.push(ConflictRecord {
            kind: "status_conflict".to_string(),
            summary: "mixed success status across roles".to_string(),
            details: results
                .iter()
                .map(|item| compact_conflict_detail(&format!("{}={}", item.role.id, item.result.success)))
                .collect(),
        });
    }

    let route_values = results
        .iter()
        .filter_map(|item| {
            item.resolved_route
                .as_ref()
                .map(|route| format!("{}/{}", route.plan.primary.provider_name, route.plan.primary.model_name))
        })
        .collect::<std::collections::BTreeSet<_>>();
    if route_values.len() > 1 {
        conflicts.push(ConflictRecord {
            kind: "route_conflict".to_string(),
            summary: format!("multiple primary routes: {}", route_values.iter().cloned().collect::<Vec<_>>().join(", ")),
            details: route_values
                .into_iter()
                .map(|detail| compact_conflict_detail(&detail))
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
                conclusion_values.iter().cloned().collect::<Vec<_>>().join(" | ")
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
        .filter_map(|item| detect_output_polarity(item.result.output.trim()).map(|polarity| (item.role.id.as_str(), polarity)))
        .collect::<Vec<_>>();
    let has_positive = polarities.iter().any(|(_, polarity)| *polarity == OutputPolarity::Positive);
    let has_negative = polarities.iter().any(|(_, polarity)| *polarity == OutputPolarity::Negative);
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
                .map(|(role_id, polarity)| compact_conflict_detail(&format!("{}={}", role_id, polarity.as_str())))
                .collect(),
        });
    }

    conflicts
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum OutputPolarity {
    Positive,
    Negative,
}

impl OutputPolarity {
    fn as_str(self) -> &'static str {
        match self {
            Self::Positive => "positive",
            Self::Negative => "negative",
        }
    }
}

fn detect_output_polarity(output: &str) -> Option<OutputPolarity> {
    let normalized = output.to_lowercase();
    let negative_signals = [
        "fail",
        "failed",
        "failure",
        "error",
        "cannot",
        "can't",
        "unable",
        "blocked",
        "regression",
        "broken",
        "conflict",
        "风险",
        "失败",
        "错误",
        "阻塞",
        "回归",
        "冲突",
    ];
    if negative_signals.iter().any(|signal| normalized.contains(signal)) {
        return Some(OutputPolarity::Negative);
    }

    let positive_signals = [
        "pass",
        "passed",
        "success",
        "successful",
        "done",
        "completed",
        "ready",
        "approved",
        "looks good",
        "完成",
        "通过",
        "成功",
        "可用",
        "已修复",
    ];
    if positive_signals.iter().any(|signal| normalized.contains(signal)) {
        return Some(OutputPolarity::Positive);
    }

    None
}

fn normalized_output(output: &str) -> Option<String> {
    let extracted = output
        .split_once("final=")
        .map(|(_, tail)| tail)
        .unwrap_or(output);
    let extracted = extracted
        .split_once("结论：")
        .map(|(_, tail)| tail)
        .unwrap_or(extracted);
    let normalized = extracted
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");
    if normalized.is_empty() {
        None
    } else {
        Some(normalized)
    }
}

fn consensus_output(output: &str) -> Option<String> {
    if let Some(consensus) = extract_final_consensus(output) {
        return normalized_output(consensus);
    }
    normalized_output(output)
}

fn extract_final_consensus(output: &str) -> Option<&str> {
    output
        .rsplit_once('。')
        .map(|(_, tail)| tail.trim())
        .filter(|tail| !tail.is_empty())
        .or_else(|| {
            output
                .rsplit_once('.')
                .map(|(_, tail)| tail.trim())
                .filter(|tail| !tail.is_empty())
        })
        .filter(|tail| {
            tail.contains("任务完成")
                || tail.contains("完成")
                || tail.contains("失败")
                || tail.contains("阻塞")
                || tail.contains("error")
                || tail.contains("failed")
        })
}

fn build_summary_record(task_prompt: &str, results: &[WorkerRunResult], conflicts: &[String]) -> SummaryRecord {
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
                .map(|route| format!("{}/{}", route.plan.primary.provider_name, route.plan.primary.model_name))
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
    let recommended_next_action = infer_recommended_next_action(&items, conflicts);

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

fn extract_risk_summary(output: &str) -> Option<String> {
    let trimmed = output.trim();
    if trimmed.is_empty() {
        return None;
    }

    let lowered = trimmed.to_lowercase();
    let risk_signals = [
        "风险",
        "阻塞",
        "失败",
        "错误",
        "冲突",
        "回归",
        "risk",
        "blocked",
        "failed",
        "error",
        "conflict",
        "regression",
    ];
    if !risk_signals.iter().any(|signal| lowered.contains(signal)) {
        return None;
    }

    let sentence = trimmed
        .split(['\n', '。', '.', ';', '；', '!', '！', '?', '？'])
        .map(str::trim)
        .find(|segment| {
            let lowered = segment.to_lowercase();
            !segment.is_empty() && risk_signals.iter().any(|signal| lowered.contains(signal))
        })
        .unwrap_or(trimmed);

    let sentence = sentence
        .strip_prefix("- ")
        .or_else(|| sentence.strip_prefix("* "))
        .unwrap_or(sentence)
        .trim();

    let sentence = ["但", "不过", "然而"]
        .iter()
        .find_map(|marker| sentence.find(marker).map(|index| sentence[index..].trim()))
        .filter(|value| !value.is_empty())
        .unwrap_or(sentence);

    if sentence.is_empty() {
        return None;
    }

    Some(sentence.to_string())
}

fn compact_conflict_detail(detail: &str) -> String {
    let trimmed = detail.trim();
    if trimmed.is_empty() {
        return String::new();
    }

    if (trimmed.contains('=') || trimmed.contains('/'))
        && !trimmed.contains(' ')
        && !trimmed.contains('\n')
        && !trimmed.contains('。')
        && !trimmed.contains('.')
    {
        return trimmed.to_string();
    }

    if let Some(risk_summary) = extract_risk_summary(trimmed) {
        return risk_summary;
    }

    if let Some(consensus) = extract_final_consensus(trimmed) {
        let consensus = consensus.trim();
        if !consensus.is_empty() {
            return consensus.to_string();
        }
    }

    trimmed
        .lines()
        .map(str::trim)
        .find(|line| !line.is_empty())
        .unwrap_or(trimmed)
        .to_string()
}

fn infer_overall_conclusion(
    items: &[SummaryItemRecord],
    reporter_summary: Option<&str>,
) -> Option<String> {
    if let Some(summary) = reporter_summary.map(str::trim).filter(|value| !value.is_empty()) {
        return Some(summary.to_string());
    }

    if let Some(reviewer_conclusion) = items
        .iter()
        .find(|item| item.role_id == "code-reviewer")
        .and_then(|item| extract_final_consensus(&item.output))
    {
        return Some(reviewer_conclusion.to_string());
    }

    if let Some(test_conclusion) = items
        .iter()
        .find(|item| item.role_id == "test-engineer")
        .and_then(|item| extract_final_consensus(&item.output))
    {
        return Some(test_conclusion.to_string());
    }

    if let Some(implementer_conclusion) = items
        .iter()
        .find(|item| item.role_id == "implementer")
        .and_then(|item| extract_final_consensus(&item.output))
    {
        return Some(implementer_conclusion.to_string());
    }

    if let Some(architect_conclusion) = items
        .iter()
        .find(|item| item.role_id == "system-architect")
        .and_then(|item| extract_final_consensus(&item.output))
    {
        return Some(architect_conclusion.to_string());
    }

    items.first().map(|item| item.output.clone())
}

fn infer_recommended_next_action(items: &[SummaryItemRecord], conflicts: &[String]) -> Option<String> {
    if !conflicts.is_empty() {
        return Some("先消解角色间冲突，再进入下一步执行或交付。".to_string());
    }

    let has_role = |role_id: &str| items.iter().any(|item| item.role_id == role_id);
    let has_negative_signal = items
        .iter()
        .filter_map(|item| detect_output_polarity(&item.output))
        .any(|polarity| polarity == OutputPolarity::Negative);

    if has_negative_signal {
        return Some("先处理当前失败或阻塞项，再重新执行验证与裁决。".to_string());
    }
    if has_role("implementer") && has_role("code-reviewer") {
        return Some("运行最终验证并整理交付结论，确认改动可以提交。".to_string());
    }
    if has_role("implementer") && has_role("test-engineer") {
        return Some("补齐验证结果并确认回归情况，再进入审查或交付。".to_string());
    }
    if has_role("system-architect") && has_role("reporter") {
        return Some("基于当前架构结论进入实现拆解，并同步给用户执行方向。".to_string());
    }
    if has_role("implementer") {
        return Some("进入验证与审查阶段，确认改动行为和回归风险。".to_string());
    }
    if has_role("test-engineer") {
        return Some("根据验证结果决定是否继续修复，或整理测试结论进入交付。".to_string());
    }
    if has_role("system-architect") {
        return Some("根据当前架构结论进入实现或验证阶段。".to_string());
    }
    if has_role("reporter") {
        return Some("当前结论可直接反馈给用户，并根据需要继续下一轮细化。".to_string());
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
    use super::{build_summary_record, compact_aggregate_output, compact_conflict_detail, extract_risk_summary, infer_overall_conclusion, infer_recommended_next_action};
    use crate::agents::worker::WorkerRunResult;
    use sacode_kernel::{AgentRole, RoleModelPolicy, SubAgentResult, SubAgentTask};
    use sacode_kernel::SummaryItemRecord;

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
        let next = infer_recommended_next_action(&items, &[]);
        assert_eq!(next.as_deref(), Some("基于当前架构结论进入实现拆解，并同步给用户执行方向。"));
    }

    #[test]
    fn infer_recommended_next_action_prioritizes_negative_signals() {
        let items = vec![
            item("implementer", "改动已完成。"),
            item("test-engineer", "验证失败，存在阻塞。"),
        ];
        let next = infer_recommended_next_action(&items, &[]);
        assert_eq!(next.as_deref(), Some("先处理当前失败或阻塞项，再重新执行验证与裁决。"));
    }

    #[test]
    fn extract_risk_summary_returns_compact_sentence() {
        let risk = extract_risk_summary("任务完成，但存在回归风险。建议补充验证步骤。后续可继续推进。");
        assert_eq!(risk.as_deref(), Some("但存在回归风险"));
    }

    #[test]
    fn extract_risk_summary_handles_multiline_output() {
        let risk = extract_risk_summary("已完成检查\n阻塞点：接口鉴权失败\n建议补充凭证配置");
        assert_eq!(risk.as_deref(), Some("阻塞点：接口鉴权失败"));
    }

    #[test]
    fn compact_conflict_detail_prefers_risk_sentence() {
        let detail = compact_conflict_detail("任务完成，但存在回归风险。建议补充验证。后续继续推进。");
        assert_eq!(detail, "但存在回归风险");
    }

    #[test]
    fn compact_conflict_detail_prefers_final_consensus() {
        let detail = compact_conflict_detail("前置分析已完成。任务完成，共完成 5 个步骤");
        assert_eq!(detail, "任务完成，共完成 5 个步骤");
    }

    #[test]
    fn compact_aggregate_output_prefers_risk_summary() {
        let output = compact_aggregate_output("任务完成，但存在回归风险。建议补充验证。后续继续推进。");
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
        assert_eq!(output, "汇总结论已生成，完成 5 个步骤，参考了 代码读取、命令执行与差异检查");
    }

    #[test]
    fn build_summary_record_compacts_reporter_and_item_outputs() {
        let results = vec![
            worker("system-architect", "架构路径已梳理。任务完成，共完成 5 个步骤"),
            worker("reporter", "汇总结论已生成，完成 5 个步骤。任务完成，共完成 5 个步骤"),
        ];

        let summary = build_summary_record("test prompt", &results, &[]);

        assert_eq!(summary.reporter_summary.as_deref(), Some("汇总结论已生成，完成 5 个步骤"));
        assert_eq!(summary.overall_conclusion.as_deref(), Some("汇总结论已生成，完成 5 个步骤"));
        assert_eq!(summary.items[0].output, "任务完成，共完成 5 个步骤");
        assert_eq!(summary.items[1].output, "汇总结论已生成，完成 5 个步骤");
    }
}
