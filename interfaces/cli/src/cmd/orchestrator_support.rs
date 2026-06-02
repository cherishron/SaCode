use sacode_kernel::SummaryRecord;

pub(super) fn format_summary_record(summary: Option<&SummaryRecord>) -> Option<String> {
    let summary = summary?;
    let mut lines = Vec::new();
    lines.push("[Summary Record]".to_string());
    lines.push(format!("Task: {}", summary.task));
    if !summary.roles.is_empty() {
        lines.push(format!("Roles: {}", summary.roles.join(", ")));
    }
    if let Some(reporter_summary) = summary
        .reporter_summary
        .as_ref()
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
    {
        lines.push(format!("Reporter: {}", reporter_summary));
    }
    if let Some(overall_conclusion) = summary
        .overall_conclusion
        .as_ref()
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
    {
        lines.push(format!("Overall: {}", overall_conclusion));
    }
    if !summary.key_risks.is_empty() {
        lines.push("Key Risks:".to_string());
        for risk in &summary.key_risks {
            lines.push(format!("  - {}", risk));
        }
    }
    if let Some(next_action) = summary
        .recommended_next_action
        .as_ref()
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
    {
        lines.push(format!("Next: {}", next_action));
    }
    if !summary.conflicts.is_empty() {
        lines.push("Conflicts:".to_string());
        for conflict in &summary.conflicts {
            lines.push(format!("  - {}", conflict));
        }
    }
    if !summary.items.is_empty() {
        lines.push("Items:".to_string());
        for item in &summary.items {
            lines.push(format!("  - {} [{}]: {}", item.role_id, item.route, item.output));
        }
    }
    Some(lines.join("\n"))
}

#[cfg(test)]
use sacode_kernel::{Event, ToolCallIntent};
#[cfg(test)]
use serde::Serialize;

#[cfg(test)]
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub(super) struct ToolResult {
    pub(super) iteration: usize,
    pub(super) step_id: usize,
    pub(super) name: String,
    pub(super) success: bool,
    pub(super) summary: String,
}

#[cfg(test)]
#[derive(Debug, Clone)]
pub(super) struct ExecutedTool {
    pub(super) iteration: usize,
    pub(super) step_id: usize,
    pub(super) name: String,
    pub(super) summary: String,
}

#[cfg(test)]
#[derive(Debug, Clone)]
pub(super) struct StepEventBatch {
    pub(super) events: Vec<Event>,
}

#[cfg(test)]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum RetryDecision {
    Retry,
    Stop,
}

#[cfg(test)]
pub(super) fn parse_mcp_tool_name(name: &str) -> Option<(&str, &str)> {
    let rest = name.strip_prefix("mcp.")?;
    let (server, tool) = rest.split_once('.')?;
    Some((server, tool))
}

#[cfg(test)]
pub(super) fn should_retry_tool_call(intent: &ToolCallIntent, summary: &str) -> RetryDecision {
    let retryable_tool = intent.name == "web.search" || intent.name.starts_with("mcp.");
    if !retryable_tool {
        return RetryDecision::Stop;
    }

    let summary = summary.to_lowercase();
    let non_retryable = [
        "denied by policy",
        "denied by user",
        "no approval input",
        "not found",
        "unsupported",
        "invalid",
    ];
    if non_retryable.iter().any(|needle| summary.contains(needle)) {
        return RetryDecision::Stop;
    }

    RetryDecision::Retry
}

#[cfg(test)]
pub(super) fn resolve_tool_events(events: &[Event], step_event_batches: &[StepEventBatch]) -> Vec<Event> {
    let mut step_batches = step_event_batches.iter();
    let mut final_events = Vec::new();
    let mut index = 0;

    while index < events.len() {
        let event = &events[index];

        if matches!(event, Event::ToolCallStarted { .. }) {
            while index < events.len() && matches!(events[index], Event::ToolCallStarted { .. }) {
                index += 1;
            }

            if let Some(batch) = step_batches.next() {
                final_events.extend(batch.events.iter().cloned());
            }

            continue;
        }

        final_events.push(event.clone());
        index += 1;
    }

    final_events
}

#[cfg(test)]
pub(super) fn collect_tool_results(final_events: &[Event], executed_tools: &[ExecutedTool]) -> Vec<ToolResult> {
    let completed_tools: Vec<(String, bool)> = final_events
        .iter()
        .filter_map(|event| match event {
            Event::ToolCallFinished { name, success, .. } => Some((name.clone(), *success)),
            _ => None,
        })
        .collect();

    executed_tools
        .iter()
        .zip(completed_tools)
        .map(|(executed_tool, (actual_name, success))| {
            let name = if actual_name == executed_tool.name {
                actual_name
            } else {
                executed_tool.name.clone()
            };
            ToolResult {
                iteration: executed_tool.iteration,
                step_id: executed_tool.step_id,
                name,
                success,
                summary: executed_tool.summary.clone(),
            }
        })
        .collect()
}
