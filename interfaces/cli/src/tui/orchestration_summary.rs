#[derive(Debug, Clone, Default)]
pub(crate) struct ParsedOrchestrationSummary {
    pub(crate) reporter_summary: Option<String>,
    pub(crate) overall_conclusion: Option<String>,
    pub(crate) recommended_next_action: Option<String>,
    pub(crate) risk_lines: Vec<String>,
    pub(crate) item_lines: Vec<String>,
    pub(crate) role_lines: Vec<String>,
    pub(crate) route_lines: Vec<String>,
    pub(crate) conflict_lines: Vec<String>,
}

pub(crate) fn parse_orchestration_summary(
    parsed: &serde_json::Value,
) -> ParsedOrchestrationSummary {
    let mut summary = ParsedOrchestrationSummary::default();

    if let Some(summary_record) = parsed.get("summary_record") {
        summary.reporter_summary = summary_record
            .get("reporter_summary")
            .and_then(|value| value.as_str())
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(ToOwned::to_owned);
        summary.overall_conclusion = summary_record
            .get("overall_conclusion")
            .and_then(|value| value.as_str())
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(ToOwned::to_owned);
        summary.recommended_next_action = summary_record
            .get("recommended_next_action")
            .and_then(|value| value.as_str())
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(ToOwned::to_owned);
        summary.risk_lines = summary_record
            .get("key_risks")
            .and_then(|value| value.as_array())
            .map(|risks| {
                risks
                    .iter()
                    .filter_map(|risk| risk.as_str())
                    .map(|risk| format!("- risk: {}", risk))
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default();
        summary.item_lines = summary_record
            .get("items")
            .and_then(|value| value.as_array())
            .map(|items| {
                items
                    .iter()
                    .filter_map(|item| {
                        let role_id = item.get("role_id").and_then(|value| value.as_str())?;
                        let route = item
                            .get("route")
                            .and_then(|value| value.as_str())
                            .unwrap_or("auto");
                        let output = item
                            .get("output")
                            .and_then(|value| value.as_str())
                            .map(str::trim)
                            .filter(|value| !value.is_empty())?;
                        Some(format!("- {} [{}]: {}", role_id, route, output))
                    })
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default();
    }

    summary.role_lines = parsed
        .get("orchestration_plan")
        .and_then(|plan| plan.get("roles"))
        .and_then(|value| value.as_array())
        .map(|roles| {
            roles
                .iter()
                .filter_map(|role| {
                    let role_id = role.get("role_id").and_then(|value| value.as_str())?;
                    let preferred_model = role
                        .get("preferred_model")
                        .and_then(|value| value.as_str())
                        .unwrap_or("auto");
                    let needs_thinking = role
                        .get("needs_thinking")
                        .and_then(|value| value.as_bool())
                        .unwrap_or(false);
                    Some(format!(
                        "- {}: {} thinking={}",
                        role_id, preferred_model, needs_thinking
                    ))
                })
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();

    summary.route_lines = parsed
        .get("route_records")
        .and_then(|value| value.as_array())
        .map(|routes| {
            routes
                .iter()
                .filter_map(|route| {
                    let role_id = route.get("role_id").and_then(|value| value.as_str())?;
                    let primary = route.get("primary")?;
                    let provider_name = primary
                        .get("provider_name")
                        .and_then(|value| value.as_str())
                        .unwrap_or("auto");
                    let model_name = primary
                        .get("model_name")
                        .and_then(|value| value.as_str())
                        .unwrap_or("auto");
                    let score = primary
                        .get("route_score")
                        .and_then(|value| value.as_i64())
                        .unwrap_or(0);
                    let needs_thinking = primary
                        .get("needs_thinking")
                        .and_then(|value| value.as_bool())
                        .unwrap_or(false);
                    Some(format!(
                        "- {}: {}/{} score={} thinking={}",
                        role_id, provider_name, model_name, score, needs_thinking
                    ))
                })
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();

    summary.conflict_lines = if let Some(conflict_records) =
        parsed.get("conflict_records").and_then(|value| value.as_array())
    {
        conflict_records
            .iter()
            .filter_map(|record| {
                let kind = record
                    .get("kind")
                    .and_then(|value| value.as_str())
                    .unwrap_or("conflict");
                let conflict_summary = record.get("summary").and_then(|value| value.as_str())?;
                Some(format!("- [{}] {}", conflict_kind_label(kind), conflict_summary))
            })
            .collect::<Vec<_>>()
    } else {
        parsed
            .get("conflicts")
            .and_then(|value| value.as_array())
            .map(|conflicts| {
                conflicts
                    .iter()
                    .filter_map(|value| value.as_str())
                    .map(|value| format!("- {}", value))
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default()
    };

    summary
}

fn conflict_kind_label(kind: &str) -> &str {
    match kind {
        "validation_conflict" => "验证冲突",
        "status_conflict" => "状态冲突",
        "route_conflict" => "路由冲突",
        "conclusion_conflict" => "结论冲突",
        "polarity_conflict" => "极性冲突",
        _ => kind,
    }
}
