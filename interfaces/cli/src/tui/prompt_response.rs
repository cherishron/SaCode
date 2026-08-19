use super::{parse_orchestration_summary, App, MessageRole};
use anyhow::Result;

#[cfg_attr(test, allow(dead_code))]
impl App {
    pub(super) fn extract_last_json_value(raw: &str) -> Result<serde_json::Value> {
        if let Ok(value) = serde_json::from_str::<serde_json::Value>(raw) {
            return Ok(value);
        }

        let bytes = raw.as_bytes();
        for start in (0..bytes.len()).rev() {
            match bytes[start] {
                b'{' | b'[' => {
                    if let Ok(value) = serde_json::from_str::<serde_json::Value>(&raw[start..]) {
                        return Ok(value);
                    }
                }
                _ => {}
            }
        }

        anyhow::bail!("未找到合法 JSON 对象")
    }

    pub(super) fn build_task_prompt(&self, user_input: &str) -> String {
        let mut sections = Vec::new();

        if let Some(summary) = self
            .session_summary
            .as_ref()
            .filter(|value| !value.trim().is_empty())
        {
            sections.push(format!(
                "以下是当前会话的历史摘要，请在后续任务中延续这些上下文与约束：\n{}",
                summary.trim()
            ));
        }

        let recent_messages = self.recent_context_messages(user_input, 6);
        if !recent_messages.is_empty() {
            sections.push(format!(
                "以下是最近对话，请结合这些内容继续处理：\n{}",
                recent_messages.join("\n\n")
            ));
        }

        sections.push(format!("当前用户请求：\n{}", user_input.trim()));
        sections.join("\n\n---\n\n")
    }

    pub(super) fn extract_provider_response(parsed: &serde_json::Value) -> Option<String> {
        let response = parsed.get("provider_response")?;

        if let Some(text) = response.as_str() {
            let trimmed = text.trim();
            return (!trimmed.is_empty()).then(|| trimmed.to_string());
        }

        if let Some(object) = response.as_object() {
            if let Some(text) = object.get("Ok").and_then(|value| value.as_str()) {
                let trimmed = text.trim();
                if !trimmed.is_empty() {
                    return Some(trimmed.to_string());
                }
            }
        }

        None
    }

    pub(super) fn extract_summary_record_response(parsed: &serde_json::Value) -> Option<String> {
        let summary_record = parsed.get("summary_record")?;
        let overview = summary_record
            .get("overview")
            .and_then(|value| value.as_str())
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(ToString::to_string);

        let sections = summary_record
            .get("sections")
            .and_then(|value| value.as_array())
            .map(|items| {
                items
                    .iter()
                    .filter_map(|item| {
                        let title = item.get("title").and_then(|value| value.as_str())?.trim();
                        let bullets = item
                            .get("bullets")
                            .and_then(|value| value.as_array())
                            .map(|values| {
                                values
                                    .iter()
                                    .filter_map(|value| value.as_str().map(str::trim))
                                    .filter(|value| !value.is_empty())
                                    .collect::<Vec<_>>()
                            })
                            .unwrap_or_default();
                        if title.is_empty() && bullets.is_empty() {
                            return None;
                        }
                        if bullets.is_empty() {
                            Some(title.to_string())
                        } else {
                            Some(format!("{}: {}", title, bullets.join("；")))
                        }
                    })
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default();

        let mut parts = Vec::new();
        if let Some(overview) = overview {
            parts.push(overview);
        }
        parts.extend(sections);
        (!parts.is_empty()).then(|| parts.join("\n"))
    }

    pub(super) fn has_explicit_todo_signal(value: &serde_json::Value) -> bool {
        value
            .get("ui")
            .and_then(|ui| ui.get("todo_plan"))
            .map(|todo| {
                todo.get("show")
                    .and_then(|value| value.as_bool())
                    .unwrap_or(false)
                    || todo
                        .get("confirm_required")
                        .and_then(|value| value.as_bool())
                        .unwrap_or(false)
            })
            .unwrap_or(false)
    }

    pub(super) fn recent_context_messages(
        &self,
        current_input: &str,
        max_items: usize,
    ) -> Vec<String> {
        let mut skipped_current_user = false;

        self.messages
            .iter()
            .rev()
            .filter(|message| {
                if skipped_current_user {
                    return matches!(message.role, MessageRole::User | MessageRole::Assistant);
                }

                let is_current_user_message = matches!(message.role, MessageRole::User)
                    && message.content.trim() == current_input.trim();
                if is_current_user_message {
                    skipped_current_user = true;
                    return false;
                }

                matches!(message.role, MessageRole::User | MessageRole::Assistant)
            })
            .take(max_items)
            .collect::<Vec<_>>()
            .into_iter()
            .rev()
            .map(|message| {
                let role = match message.role {
                    MessageRole::User => "用户",
                    MessageRole::Assistant => "助手",
                    MessageRole::System => "系统",
                };
                format!("[{}] {}", role, message.content.trim())
            })
            .collect()
    }

    pub(super) fn format_cli_events(events: Option<&serde_json::Value>) -> Option<String> {
        let events = events?.as_array()?;
        let mut lines = Vec::new();
        for event in events {
            let kind = event
                .get("type")
                .and_then(|value| value.as_str())
                .unwrap_or("");
            match kind {
                "message" => {
                    if let Some(content) = event.get("content").and_then(|value| value.as_str()) {
                        lines.push(content.to_string());
                    }
                }
                "thinking" => {
                    if let Some(content) = event.get("content").and_then(|value| value.as_str()) {
                        lines.push(format!("[思考] {}", content));
                    }
                }
                "tool_call_started" => {
                    let name = event
                        .get("name")
                        .and_then(|value| value.as_str())
                        .unwrap_or("工具");
                    lines.push(format!("[工具] {} ...running", name));
                }
                "tool_call_finished" => {
                    let name = event
                        .get("name")
                        .and_then(|value| value.as_str())
                        .unwrap_or("工具");
                    let success = event
                        .get("success")
                        .and_then(|value| value.as_bool())
                        .unwrap_or(false);
                    let output = event
                        .get("output")
                        .cloned()
                        .unwrap_or(serde_json::Value::Null);
                    let summary = Self::summarize_json_output(&output);
                    if success {
                        if summary.is_empty() {
                            lines.push(format!("[工具] {} 完成 ✓", name));
                        } else {
                            lines.push(format!("[工具] {} 完成 ✓: {}", name, summary));
                        }
                    } else {
                        let fail_msg = if summary.is_empty() {
                            String::from("失败 ✗")
                        } else {
                            format!("失败 ✗: {}", summary)
                        };
                        lines.push(format!("[工具] {} {}", name, fail_msg));
                    }
                }
                "done" => {
                    if let Some(summary) = event.get("summary").and_then(|value| value.as_str()) {
                        lines.push(summary.to_string());
                    }
                }
                "error" => {
                    if let Some(message) = event.get("message").and_then(|value| value.as_str()) {
                        lines.push(format!("[错误] {}", message));
                    }
                }
                _ => {}
            }
        }

        if lines.is_empty() {
            None
        } else {
            Some(lines.join("\n"))
        }
    }

    pub(super) fn format_orchestration_details(parsed: &serde_json::Value) -> Option<String> {
        let parsed_summary = parse_orchestration_summary(parsed);
        let mut lines = Vec::new();

        if parsed_summary.reporter_summary.is_some()
            || parsed_summary.overall_conclusion.is_some()
            || parsed_summary.recommended_next_action.is_some()
            || !parsed_summary.risk_lines.is_empty()
            || !parsed_summary.item_lines.is_empty()
        {
            lines.push("[主裁决摘要]".to_string());
            if let Some(summary) = parsed_summary.reporter_summary.as_deref() {
                lines.push(format!("- reporter: {}", summary));
            }
            if let Some(conclusion) = parsed_summary.overall_conclusion.as_deref() {
                lines.push(format!("- overall: {}", conclusion));
            }
            lines.extend(parsed_summary.risk_lines.iter().cloned());
            if let Some(next_action) = parsed_summary.recommended_next_action.as_deref() {
                lines.push(format!("- next: {}", next_action));
            }
            lines.extend(parsed_summary.item_lines.iter().cloned());
        }

        if !parsed_summary.role_lines.is_empty() {
            lines.push("[编排角色]".to_string());
            lines.extend(parsed_summary.role_lines.iter().cloned());
        }

        if !parsed_summary.route_lines.is_empty() {
            lines.push("[角色路由]".to_string());
            lines.extend(parsed_summary.route_lines.iter().cloned());
        }

        if !parsed_summary.conflict_lines.is_empty() {
            lines.push("[冲突]".to_string());
            lines.extend(parsed_summary.conflict_lines.iter().cloned());
        }

        if lines.is_empty() {
            None
        } else {
            Some(lines.join("\n"))
        }
    }

    pub(super) fn merge_cli_response(
        events: Option<String>,
        provider_response: Option<String>,
    ) -> Option<String> {
        let mut sections = Vec::new();

        if let Some(response) = provider_response.filter(|value| !value.trim().is_empty()) {
            sections.push(response);
        }
        if sections.is_empty() {
            if let Some(events) = events.filter(|value| !value.trim().is_empty()) {
                sections.push(events);
            }
        }

        if sections.is_empty() {
            None
        } else {
            Some(sections.join("\n\n"))
        }
    }

    pub(super) fn summarize_json_output(output: &serde_json::Value) -> String {
        if output.is_null() {
            return String::new();
        }
        let source_prefix = output
            .get("source")
            .and_then(|value| value.as_str())
            .filter(|value| !value.is_empty())
            .map(|value| format!("[{}] ", value))
            .unwrap_or_default();
        if let Some(content) = output.get("content") {
            return format!("{}{}", source_prefix, Self::preview_json_text(content));
        }
        format!("{}{}", source_prefix, Self::preview_json_text(output))
    }

    pub(super) fn preview_json_text(value: &serde_json::Value) -> String {
        let text = if let Some(text) = value.as_str() {
            text.to_string()
        } else {
            serde_json::to_string(value).unwrap_or_default()
        };
        let trimmed = text.trim();
        let mut chars = trimmed.chars();
        let preview: String = chars.by_ref().take(120).collect();
        if chars.next().is_some() {
            format!("{}...", preview)
        } else {
            preview
        }
    }
}
