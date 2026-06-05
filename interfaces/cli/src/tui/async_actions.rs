use sacode_kernel::model::ChatUsage;
use sacode_kernel::{TaskRun, TaskRunState};

use super::async_types::StreamChunkKind;
use super::{
    update_prompt, App, AsyncContext, AsyncResult, InputMode, InteractionState, LoopState, Message,
    MessageRole, PendingInputOptimizationPreview,
};
use crate::cmd::init::InitMode;

impl App {
    pub(super) fn poll_async_results(&mut self) -> bool {
        let mut handled = false;
        while let Ok(result) = self.task_rx.try_recv() {
            handled = true;
            match result {
                AsyncResult::ChatStreamChunk {
                    task_id,
                    kind,
                    content,
                } => self.handle_chat_stream_chunk(task_id, kind, content),
                AsyncResult::ChatCompleted {
                    task_id,
                    prompt,
                    response,
                    hit_round_limit,
                    orchestration_summary,
                    task_run,
                    learned_facts,
                    pending_question,
                    plan,
                    usage,
                    api_duration_ms,
                    tool_duration_ms,
                    total_duration_ms,
                    loop_state,
                } => self.handle_chat_completed(
                    task_id,
                    prompt,
                    response,
                    hit_round_limit,
                    orchestration_summary,
                    task_run,
                    learned_facts,
                    pending_question,
                    plan,
                    usage,
                    api_duration_ms,
                    tool_duration_ms,
                    total_duration_ms,
                    loop_state,
                ),
                AsyncResult::LoginCompleted {
                    provider_name,
                    config,
                } => self.handle_login_completed(provider_name, config),
                AsyncResult::ProvidersLoaded {
                    providers,
                    current_provider,
                } => self.handle_providers_loaded(providers, current_provider),
                AsyncResult::ProviderSwitched { current_provider } => {
                    self.handle_provider_switched(current_provider)
                }
                AsyncResult::ModelsLoaded {
                    models,
                    current_provider,
                    current_model,
                } => self.handle_models_loaded(models, current_provider, current_model),
                AsyncResult::ModelSaved {
                    config,
                    selected_model,
                } => self.handle_model_saved(config, selected_model),
                AsyncResult::VersionChecked {
                    current_version,
                    remote_version,
                    has_update,
                } => {
                    if has_update {
                        if let Some(remote_version) = remote_version {
                            self.push_system_message(&update_prompt(
                                &current_version,
                                &remote_version,
                            ));
                        }
                    }
                }
                AsyncResult::InitCompleted { mode } => self.handle_init_completed(mode),
                AsyncResult::UpdateCompleted { message } => self.handle_update_completed(message),
                AsyncResult::InputOptimized {
                    original,
                    optimized,
                    model_name,
                } => self.handle_input_optimized(original, optimized, model_name),
                AsyncResult::ContextCompressed {
                    summary,
                    model_name,
                } => self.handle_context_compressed(summary, model_name),
                AsyncResult::Failed { context, message } => {
                    self.handle_failed_async_result(context, message)
                }
            }
        }
        handled
    }

    pub(super) fn handle_chat_stream_chunk(
        &mut self,
        task_id: u64,
        kind: StreamChunkKind,
        content: String,
    ) {
        let Some(message_index) = self.task_message_indices.get(&task_id).copied() else {
            return;
        };

        if content.is_empty() {
            return;
        }

        match kind {
            StreamChunkKind::Message => {
                if self.queue.active_task_id == Some(task_id) {
                    self.assistant_pending_thinking = false;
                }
                let mut updated = self
                    .messages
                    .get(message_index)
                    .map(|message| message.content.clone())
                    .unwrap_or_default();
                updated.push_str(&content);
                self.update_message_content_at(message_index, updated);
                self.pin_scroll_to_bottom_if_following();
            }
            StreamChunkKind::Thinking => {
                self.append_message_thinking_at(message_index, &content);
                self.pin_scroll_to_bottom_if_following();
            }
        }
    }

    pub(super) fn handle_chat_completed(
        &mut self,
        task_id: u64,
        prompt: String,
        response: String,
        hit_round_limit: bool,
        orchestration_summary: Option<String>,
        task_run: Option<TaskRun>,
        learned_facts: Vec<crate::learning::LearnedFact>,
        pending_question: Option<serde_json::Value>,
        plan: Option<sacode_kernel::Plan>,
        usage: Option<ChatUsage>,
        api_duration_ms: u64,
        tool_duration_ms: u64,
        total_duration_ms: u64,
        loop_state: Option<LoopState>,
    ) {
        if self.canceled_task_ids.remove(&task_id) {
            if self.queue.active_task_id == Some(task_id) {
                self.finish_active_task();
                self.push_system_message(&format!("已取消任务 #{}: {}", task_id, prompt));
                self.log_event("task_canceled", &format!("#{} {}", task_id, prompt.trim()));
                self.start_next_queued_message();
            }
            return;
        }

        let effective_state = task_run
            .as_ref()
            .and_then(|run| run.state.clone())
            .unwrap_or(TaskRunState::Failed);
        let loop_summary = loop_state
            .as_ref()
            .map(|state| Self::merge_loop_summary(&state.last_summary, &response, hit_round_limit))
            .unwrap_or_else(|| Self::build_loop_summary(&response, hit_round_limit));
        let response_role = if matches!(effective_state, TaskRunState::Failed) {
            MessageRole::System
        } else {
            MessageRole::Assistant
        };
        self.assistant_pending_thinking = false;
        self.orchestration_summary = orchestration_summary;
        let timestamp = chrono::Local::now().format("%Y-%m-%d %H:%M").to_string();
        let task_message_index = self.task_message_indices.get(&task_id).copied();
        if let Some(index) = task_message_index {
            if let Some(message) = self.messages.get_mut(index) {
                message.role = response_role;
                message.content = response;
                if message.thinking.is_empty() {
                    message.collapsed = false;
                }
                message.timestamp = timestamp;
                self.invalidate_message_lines_cache();
            } else {
                self.append_message(Message {
                    role: response_role,
                    content: response,
                    thinking: String::new(),
                    timestamp,
                    collapsed: false,
                });
            }
        } else {
            self.append_message(Message {
                role: response_role,
                content: response,
                thinking: String::new(),
                timestamp,
                collapsed: false,
            });
        }
        if let Some(summary) = crate::runner::format_learned_facts_summary(&learned_facts) {
            self.push_system_message(&summary);
        }
        self.log_event(
            "assistant_response",
            &self
                .messages
                .last()
                .map(|msg| msg.content.clone())
                .unwrap_or_default(),
        );
        if let Some(question) = pending_question.as_ref() {
            let mut pending = question.clone();
            if pending.get("kind").and_then(|value| value.as_str()) == Some("tool_approval") {
                pending["task_prompt"] = serde_json::Value::String(prompt.clone());
            }
            self.set_pending_question_state(pending);
            if let Some(request) = self.interaction.pending_approval_request.as_mut() {
                if request.task_prompt.trim().is_empty() {
                    request.task_prompt = prompt.clone();
                }
            }
            self.push_system_message(&format!(
                "当前任务等待用户回答。可在等待问题面板中选择或输入自定义回答；Esc 返回聊天后普通输入会进入等待队列：{}",
                Self::pending_question_title(question)
            ));
        } else {
            self.clear_pending_question_state();
        }
        if let Some(usage) = usage {
            self.record_usage(usage);
        }
        self.record_performance(api_duration_ms, tool_duration_ms, total_duration_ms);
        self.mark_todo_completed(&prompt);
        if let Some(plan) = plan {
            self.capture_todo_plan(&prompt, plan);
        }
        self.finish_active_task();
        let waiting_for_user = matches!(
            effective_state,
            TaskRunState::WaitingForUser | TaskRunState::WaitingForApproval
        );
        if matches!(effective_state, TaskRunState::Completed) && !waiting_for_user && !hit_round_limit {
            if let Some(state) = loop_state.clone() {
                let next_iteration = state.iteration.saturating_add(1);
                if next_iteration > state.max_iterations {
                    self.push_system_message(&format!(
                        "循环任务已达到最大轮次上限 {} 次，自动停止。",
                        state.max_iterations
                    ));
                } else {
                    self.enqueue_or_start_message_with_approval_and_loop(
                        Self::build_loop_prompt(&state.task, &loop_summary, None),
                        self.current_task_approval_policy(),
                        Some(LoopState {
                            task: state.task.clone(),
                            iteration: next_iteration,
                            max_iterations: state.max_iterations,
                            error_count: 0,
                            last_summary: loop_summary.clone(),
                        }),
                    );
                    self.push_system_message(&format!(
                        "循环任务已完成第 {} 轮，继续下一轮。",
                        state.iteration
                    ));
                }
            }
        } else if matches!(effective_state, TaskRunState::Failed) {
            if let Some(state) = loop_state.clone() {
                if hit_round_limit {
                    self.push_system_message(&format!(
                        "循环任务在第 {} 轮达到最大迭代上限后停止。",
                        state.iteration
                    ));
                    if !waiting_for_user {
                        self.start_next_queued_message();
                    }
                    return;
                }
                let next_error_count = state.error_count.saturating_add(1);
                if next_error_count >= 3 {
                    self.push_system_message(&format!(
                        "循环任务已连续失败 {} 次，自动停止。修复后可重新执行 /loop。",
                        next_error_count
                    ));
                } else {
                    let reflection_hint = match next_error_count {
                        1 => "上一轮执行遇到问题，请重新审视任务需求，换一种方案尝试。",
                        2 => "已连续两轮失败，请深入分析失败原因，检查是否有根本性问题。",
                        _ => "多次失败表明当前方案可能不可行，请彻底换一种思路。",
                    };
                    self.enqueue_or_start_message_with_approval_and_loop(
                        Self::build_loop_prompt(&state.task, &loop_summary, Some(reflection_hint)),
                        self.current_task_approval_policy(),
                        Some(LoopState {
                            task: state.task.clone(),
                            iteration: state.iteration.saturating_add(1),
                            max_iterations: state.max_iterations,
                            error_count: next_error_count,
                            last_summary: loop_summary.clone(),
                        }),
                    );
                    self.push_system_message(&format!(
                        "循环任务本轮失败（累计 {} 次），注入反思信号后继续下一轮。",
                        next_error_count
                    ));
                }
            }
        }
        if !waiting_for_user {
            self.start_next_queued_message();
        }
    }

    fn build_loop_prompt(task: &str, last_summary: &str, reflection_hint: Option<&str>) -> String {
        let mut prompt = format!(
            "循环执行下面的任务，持续检查结果并修复问题，直到任务达到可用完成态：{}",
            task
        );
        if !last_summary.trim().is_empty() {
            prompt.push_str("\n\n上一轮摘要：\n");
            prompt.push_str(last_summary.trim());
        }
        if let Some(reflection_hint) = reflection_hint.filter(|value| !value.trim().is_empty()) {
            prompt.push_str("\n\n反思提示：\n");
            prompt.push_str(reflection_hint.trim());
        }
        prompt
    }

    fn build_loop_summary(response: &str, hit_round_limit: bool) -> String {
        let summary = response.trim();
        if summary.is_empty() {
            return String::new();
        }
        let mut compact = String::new();
        for ch in summary.chars().take(1200) {
            compact.push(ch);
        }
        if summary.chars().count() > 1200 {
            compact.push_str("\n...(已截断)");
        }
        if hit_round_limit {
            format!("本轮在达到最大迭代上限后停止。\n{}", compact)
        } else {
            compact
        }
    }

    fn merge_loop_summary(previous_summary: &str, response: &str, hit_round_limit: bool) -> String {
        let current_summary = Self::build_loop_summary(response, hit_round_limit);
        if current_summary.is_empty() {
            previous_summary.trim().to_string()
        } else {
            current_summary
        }
    }

    pub(super) fn clear_busy_state(&mut self) {
        self.queue.processing = false;
        self.spinner_index = 0;
        self.queue.busy_message.clear();
    }

    pub(super) fn reset_active_async_state(&mut self) {
        self.queue.processing = false;
        self.queue.active_task_id = None;
        self.active_task_started_at = None;
        self.spinner_index = 0;
        self.queue.busy_message.clear();
    }

    pub(super) fn handle_init_completed(&mut self, mode: InitMode) {
        self.clear_busy_state();
        self.input_mode = InputMode::Chat;
        self.push_success_message(&format!("{} 已完成。", crate::cmd::init::mode_name(mode)));
    }

    pub(super) fn handle_update_completed(&mut self, message: String) {
        self.clear_busy_state();
        self.push_system_message(&message);
    }

    pub(super) fn handle_context_compressed(&mut self, summary: String, model_name: String) {
        self.clear_busy_state();
        self.input_mode = InputMode::Chat;
        self.apply_session_summary(summary, &model_name);
    }

    pub(super) fn handle_input_optimized(
        &mut self,
        original: String,
        optimized: String,
        model_name: String,
    ) {
        self.queue.busy_message.clear();
        let optimized = optimized.trim().to_string();
        if optimized.is_empty() {
            self.push_system_message("输入优化未返回结果，保留原始内容。");
            self.input = original;
        } else {
            self.pending_input_optimization = Some(PendingInputOptimizationPreview {
                original,
                optimized,
                model_name: model_name.clone(),
            });
            self.input_mode = InputMode::InputOptimizePreview;
            self.push_system_message(&format!(
                "{} 已返回输入优化建议，按 Enter 应用，按 Esc 取消。",
                model_name
            ));
        }
    }

    pub(super) fn handle_failed_async_result(&mut self, context: AsyncContext, message: String) {
        self.queue.active_child = None;
        if !matches!(context, AsyncContext::OptimizeInput) {
            self.reset_active_async_state();
        } else {
            self.queue.busy_message.clear();
        }
        if matches!(
            context,
            AsyncContext::OptimizeInput
                | AsyncContext::CompressContext
                | AsyncContext::LoadProviders
                | AsyncContext::SaveProvider
                | AsyncContext::LoadModels
                | AsyncContext::SaveModel
        ) {
            self.input_mode = InputMode::Chat;
        }
        self.push_system_message(&message);
        if self.interaction.state == InteractionState::Idle {
            self.start_next_queued_message();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::cmd::ApprovalPolicy;

    #[test]
    fn handle_chat_stream_chunk_appends_to_last_assistant_message() {
        let mut app = App::new();
        app.queue.active_task_id = Some(7);
        app.append_message(Message {
            role: MessageRole::Assistant,
            content: String::new(),
            thinking: String::new(),
            timestamp: "2026-06-05 00:00".to_string(),
            collapsed: false,
        });
        app.task_message_indices.insert(7, 0);

        app.handle_chat_stream_chunk(7, StreamChunkKind::Message, "hello".to_string());
        app.handle_chat_stream_chunk(7, StreamChunkKind::Message, " world".to_string());

        assert_eq!(
            app.messages.last().map(|msg| msg.content.as_str()),
            Some("hello world")
        );
    }

    #[test]
    fn handle_chat_completed_reuses_streaming_placeholder_message() {
        let mut app = App::new();
        app.queue.active_task_id = Some(9);
        let assistant_count_before = app
            .messages
            .iter()
            .filter(|msg| matches!(msg.role, MessageRole::Assistant))
            .count();
        app.append_message(Message {
            role: MessageRole::Assistant,
            content: "partial".to_string(),
            thinking: String::new(),
            timestamp: "2026-06-05 00:00".to_string(),
            collapsed: false,
        });
        app.task_message_indices.insert(9, 0);

        app.handle_chat_completed(
            9,
            "prompt".to_string(),
            "final answer".to_string(),
            false,
            None,
            Some(TaskRun {
                state: Some(TaskRunState::Completed),
                ..Default::default()
            }),
            Vec::new(),
            None,
            None,
            None,
            0,
            0,
            0,
            None,
        );

        let assistant_messages: Vec<_> = app
            .messages
            .iter()
            .filter(|msg| matches!(msg.role, MessageRole::Assistant))
            .collect();
        assert_eq!(assistant_messages.len(), assistant_count_before + 1);
        assert_eq!(
            assistant_messages.last().map(|msg| msg.content.as_str()),
            Some("final answer")
        );
    }

    #[test]
    fn loop_completion_enqueues_next_round_with_summary() {
        let mut app = App::new();
        app.queue.active_task_id = Some(12);

        app.handle_chat_completed(
            12,
            "prompt".to_string(),
            "已完成第一轮检查，修复了配置问题。".to_string(),
            false,
            None,
            Some(TaskRun {
                state: Some(TaskRunState::Completed),
                ..Default::default()
            }),
            Vec::new(),
            None,
            None,
            None,
            0,
            0,
            0,
            Some(LoopState {
                task: "检查项目".to_string(),
                iteration: 1,
                max_iterations: 3,
                error_count: 0,
                last_summary: String::new(),
            }),
        );

        let queued = app
            .queue
            .queued_messages
            .front()
            .expect("next loop task should be queued");
        assert!(queued.content.contains("上一轮摘要"));
        assert!(queued.content.contains("已完成第一轮检查，修复了配置问题。"));
        assert_eq!(queued.loop_state.as_ref().map(|state| state.last_summary.as_str()), Some("已完成第一轮检查，修复了配置问题。"));
    }

    #[test]
    fn loop_round_limit_does_not_enqueue_next_round() {
        let mut app = App::new();
        app.queue.active_task_id = Some(13);

        app.handle_chat_completed(
            13,
            "prompt".to_string(),
            "本轮达到最大迭代次数。".to_string(),
            true,
            None,
            Some(TaskRun {
                state: Some(TaskRunState::Failed),
                ..Default::default()
            }),
            Vec::new(),
            None,
            None,
            None,
            0,
            0,
            0,
            Some(LoopState {
                task: "检查项目".to_string(),
                iteration: 1,
                max_iterations: 3,
                error_count: 0,
                last_summary: String::new(),
            }),
        );

        assert!(app.queue.queued_messages.is_empty());
    }

    #[test]
    fn queue_message_does_not_interrupt_existing_stream_output() {
        let mut app = App::new();
        app.queue.processing = true;
        app.queue.active_task_id = Some(1);
        app.append_message(Message {
            role: MessageRole::Assistant,
            content: String::new(),
            thinking: String::new(),
            timestamp: "2026-06-05 00:00".to_string(),
            collapsed: false,
        });
        app.task_message_indices.insert(1, 0);

        app.handle_chat_stream_chunk(1, StreamChunkKind::Message, "hello".to_string());
        app.enqueue_or_start_message_with_approval(
            "第二个任务".to_string(),
            ApprovalPolicy::Prompt,
        );
        app.handle_chat_stream_chunk(1, StreamChunkKind::Message, " world".to_string());

        assert_eq!(app.messages[0].content, "hello world");
        assert!(app
            .messages
            .iter()
            .any(|msg| msg.content.contains("第二个任务")));
    }

    #[test]
    fn queue_message_does_not_interrupt_existing_thinking_output() {
        let mut app = App::new();
        app.queue.processing = true;
        app.queue.active_task_id = Some(1);
        app.append_message(Message {
            role: MessageRole::Assistant,
            content: String::new(),
            thinking: String::new(),
            timestamp: "2026-06-05 00:00".to_string(),
            collapsed: false,
        });
        app.task_message_indices.insert(1, 0);

        app.handle_chat_stream_chunk(1, StreamChunkKind::Thinking, "分析".to_string());
        app.enqueue_or_start_message_with_approval(
            "第二个任务".to_string(),
            ApprovalPolicy::Prompt,
        );
        app.handle_chat_stream_chunk(1, StreamChunkKind::Thinking, "调用链".to_string());

        assert_eq!(app.messages[0].thinking, "分析调用链");
        assert!(app.messages[0].collapsed);
    }
}
