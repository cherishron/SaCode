use std::{
    env,
    io::BufRead,
    io::BufReader,
    io::Read,
    path::PathBuf,
    process::{Child, Command, Stdio},
    sync::{Arc, Mutex},
    thread,
    time::{Duration, Instant},
};

use sacode_kernel::{model::ChatUsage, ExecutionMode, LoopState, TaskRun, TaskRunState};
#[derive(Debug, Default)]
pub(super) struct BackgroundTaskOutput {
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
}

use crate::cmd::config;

use super::async_types::StreamChunkKind;
use super::state::QueuedMessage;
use super::{App, AsyncResult, Message, MessageRole};
use crate::cmd::{ApprovalPolicy, JSON_STREAM_PREFIX};

const BACKGROUND_TASK_TIMEOUT: Duration = Duration::from_secs(180);

impl App {
    pub(super) fn enqueue_or_start_message(&mut self, user_input: String) {
        self.enqueue_or_start_message_with_approval_and_loop(
            user_input,
            self.current_task_approval_policy(),
            None,
        );
    }

    pub(super) fn enqueue_or_start_message_with_approval(
        &mut self,
        user_input: String,
        approval: ApprovalPolicy,
    ) {
        self.enqueue_or_start_message_with_approval_and_loop(user_input, approval, None);
    }

    pub(super) fn enqueue_or_start_orchestrator_message(
        &mut self,
        user_input: String,
        approval: ApprovalPolicy,
    ) {
        let task_id = self.next_task_id;
        self.next_task_id += 1;

        if self.queue.processing {
            self.queue.queued_messages.push_back(QueuedMessage {
                id: task_id,
                content: format!("[orchestrator] {}", user_input),
                approval,
                loop_state: None,
            });
            let waiting_count = self.queue.queued_messages.len();
            let queue_message = if waiting_count == 1 {
                format!("[队列] #{} 已排队，等待执行: /agents run", task_id)
            } else {
                format!(
                    "[队列] #{} 已排队，前方还有 {} 项任务",
                    task_id,
                    waiting_count - 1
                )
            };
            self.push_system_message(&queue_message);
            self.log_event("queue_push", &format!("#{} orchestrator", task_id));
            return;
        }

        self.start_orchestrator_message(task_id, user_input, approval);
    }

    pub(super) fn enqueue_or_start_message_with_approval_and_loop(
        &mut self,
        user_input: String,
        approval: ApprovalPolicy,
        loop_state: Option<LoopState>,
    ) {
        let task_id = self.next_task_id;
        self.next_task_id += 1;

        #[cfg(test)]
        let should_force_queue = loop_state.is_some();
        #[cfg(not(test))]
        let should_force_queue = false;

        if self.queue.processing || should_force_queue {
            self.queue.queued_messages.push_back(QueuedMessage {
                id: task_id,
                content: user_input.clone(),
                approval,
                loop_state,
            });
            let waiting_count = self.queue.queued_messages.len();
            let queue_message = if waiting_count == 1 {
                format!(
                    "[队列] #{} 已排队，等待执行: {}",
                    task_id,
                    user_input.trim()
                )
            } else {
                format!(
                    "[队列] #{} 已排队，前方还有 {} 项任务",
                    task_id,
                    waiting_count - 1
                )
            };
            self.push_system_message(&queue_message);
            self.log_event("queue_push", &format!("#{} {}", task_id, user_input.trim()));
            return;
        }

        self.start_queued_message(QueuedMessage {
            id: task_id,
            content: user_input,
            approval,
            loop_state,
        });
    }

    pub(super) fn start_queued_message(&mut self, queued: QueuedMessage) {
        if let Some(stripped) = queued.content.strip_prefix("[orchestrator] ") {
            self.start_orchestrator_message(queued.id, stripped.to_string(), queued.approval);
            return;
        }

        self.queue.processing = true;
        self.queue.active_task_id = Some(queued.id);
        self.active_task_started_at = Some(chrono::Local::now());
        self.spinner_index = 0;
        self.reset_orchestration_summary();
        let timestamp = chrono::Local::now().format("%Y-%m-%d %H:%M").to_string();
        self.append_message(Message {
            role: MessageRole::User,
            content: queued.content.clone(),
            thinking: String::new(),
            timestamp,
            collapsed: false,
        });
        self.append_message(Message {
            role: MessageRole::Assistant,
            content: String::new(),
            thinking: String::new(),
            timestamp: chrono::Local::now().format("%Y-%m-%d %H:%M").to_string(),
            collapsed: false,
        });
        self.task_message_indices
            .insert(queued.id, self.messages.len().saturating_sub(1));
        self.assistant_pending_thinking = true;
        self.log_event("user_message", queued.content.trim());
        let loop_badge = queued
            .loop_state
            .as_ref()
            .map(|state| format!(" [loop:{}]", state.iteration))
            .unwrap_or_default();
        self.queue.busy_message = format!(
            "正在执行 #{}{}，模型 {}，Esc 取消当前任务",
            queued.id,
            loop_badge,
            self.current_model_name()
        );
        self.log_event(
            "queue_start",
            &format!("#{} {}", queued.id, queued.content.trim()),
        );
        self.spawn_chat_task(
            queued.id,
            queued.content,
            queued.approval,
            queued.loop_state,
        );
    }

    fn start_orchestrator_message(
        &mut self,
        task_id: u64,
        user_input: String,
        approval: ApprovalPolicy,
    ) {
        self.queue.processing = true;
        self.queue.active_task_id = Some(task_id);
        self.active_task_started_at = Some(chrono::Local::now());
        self.spinner_index = 0;
        self.reset_orchestration_summary();
        let timestamp = chrono::Local::now().format("%Y-%m-%d %H:%M").to_string();
        self.append_message(Message {
            role: MessageRole::User,
            content: format!("/agents run {}", user_input.trim()),
            thinking: String::new(),
            timestamp,
            collapsed: false,
        });
        self.append_message(Message {
            role: MessageRole::Assistant,
            content: String::new(),
            thinking: String::new(),
            timestamp: chrono::Local::now().format("%Y-%m-%d %H:%M").to_string(),
            collapsed: false,
        });
        self.task_message_indices
            .insert(task_id, self.messages.len().saturating_sub(1));
        self.assistant_pending_thinking = true;
        self.log_event("user_message", user_input.trim());
        self.queue.busy_message = format!(
            "正在执行 #{} [agents]，模型 {}，Esc 取消当前任务",
            task_id,
            self.current_model_name()
        );
        self.log_event(
            "queue_start",
            &format!("#{} orchestrator {}", task_id, user_input.trim()),
        );
        self.spawn_orchestrator_task(task_id, user_input, approval);
    }

    pub(super) fn spawn_chat_task(
        &mut self,
        task_id: u64,
        user_input: String,
        approval: ApprovalPolicy,
        loop_state: Option<LoopState>,
    ) {
        let sender = self.task_tx.clone();
        #[cfg(test)]
        {
            let _ = approval;
            let _ = sender.send(AsyncResult::ChatCompleted {
                task_id,
                prompt: user_input,
                response: "测试环境已跳过后台执行进程".to_string(),
                hit_round_limit: false,
                orchestration_summary: None,
                task_run: None,
                learned_facts: Vec::new(),
                pending_question: None,
                plan: None,
                usage: None,
                api_duration_ms: 0,
                tool_duration_ms: 0,
                total_duration_ms: 0,
                loop_state,
            });
        }
        #[cfg(not(test))]
        {
            let workdir = self.workdir.clone();
            let mode = self.execution_mode;
            let prompt = self.build_task_prompt(&user_input);
            let Some(child) = Self::spawn_chat_child(&workdir, &prompt, mode, approval) else {
                let _ = sender.send(AsyncResult::ChatCompleted {
                    task_id,
                    prompt: user_input,
                    response: "任务执行失败: 无法启动后台执行进程".to_string(),
                    hit_round_limit: false,
                    orchestration_summary: None,
                    task_run: None,
                    learned_facts: Vec::new(),
                    pending_question: None,
                    plan: None,
                    usage: None,
                    api_duration_ms: 0,
                    tool_duration_ms: 0,
                    total_duration_ms: 0,
                    loop_state,
                });
                return;
            };

            let child = Arc::new(Mutex::new(child));
            self.queue.active_child = Some(child.clone());
            thread::spawn(move || {
                let result = App::execute_user_message_in_background(
                    child,
                    sender.clone(),
                    task_id,
                    &user_input,
                );
                let _ = sender.send(AsyncResult::ChatCompleted {
                    task_id,
                    prompt: user_input,
                    response: result.response,
                    hit_round_limit: result.hit_round_limit,
                    orchestration_summary: result.orchestration_summary,
                    task_run: result.task_run,
                    learned_facts: result.learned_facts,
                    pending_question: result.pending_question,
                    plan: result.plan,
                    usage: result.usage,
                    api_duration_ms: result.api_duration_ms,
                    tool_duration_ms: result.tool_duration_ms,
                    total_duration_ms: result.total_duration_ms,
                    loop_state,
                });
            });
        }
    }

    pub(super) fn spawn_orchestrator_task(
        &mut self,
        task_id: u64,
        user_input: String,
        approval: ApprovalPolicy,
    ) {
        let sender = self.task_tx.clone();
        let workdir = self.workdir.clone();
        let mode = self.execution_mode;
        let Some(child) = Self::spawn_orchestrator_child(&workdir, &user_input, mode, approval)
        else {
            let _ = sender.send(AsyncResult::ChatCompleted {
                task_id,
                prompt: user_input,
                response: "任务执行失败: 无法启动多角色编排进程".to_string(),
                hit_round_limit: false,
                orchestration_summary: None,
                task_run: None,
                learned_facts: Vec::new(),
                pending_question: None,
                plan: None,
                usage: None,
                api_duration_ms: 0,
                tool_duration_ms: 0,
                total_duration_ms: 0,
                loop_state: None,
            });
            return;
        };

        let child = Arc::new(Mutex::new(child));
        self.queue.active_child = Some(child.clone());
        thread::spawn(move || {
            let result = App::execute_user_message_in_background(
                child,
                sender.clone(),
                task_id,
                &user_input,
            );
            let _ = sender.send(AsyncResult::ChatCompleted {
                task_id,
                prompt: user_input,
                response: result.response,
                hit_round_limit: result.hit_round_limit,
                orchestration_summary: result.orchestration_summary,
                task_run: result.task_run,
                learned_facts: result.learned_facts,
                pending_question: result.pending_question,
                plan: result.plan,
                usage: result.usage,
                api_duration_ms: result.api_duration_ms,
                tool_duration_ms: result.tool_duration_ms,
                total_duration_ms: result.total_duration_ms,
                loop_state: None,
            });
        });
    }

    #[cfg_attr(test, allow(dead_code))]
    pub(super) fn spawn_chat_child(
        workdir: &PathBuf,
        user_input: &str,
        mode: ExecutionMode,
        approval: ApprovalPolicy,
    ) -> Option<Child> {
        let current_exe = env::current_exe().ok()?;
        let exe = current_exe
            .parent()
            .map(|dir| dir.join("sacode"))
            .filter(|path| path.exists())
            .unwrap_or(current_exe);
        let approval_arg = match approval {
            ApprovalPolicy::AutoApprove => "--approve",
            ApprovalPolicy::AutoDeny => "--deny",
            ApprovalPolicy::Prompt => "--prompt",
        };
        let effective = config::effective_config(workdir).ok();
        let max_iterations = effective
            .as_ref()
            .map(|value| value.max_iterations)
            .unwrap_or(6)
            .max(1)
            .to_string();
        let mut command = Command::new(exe);
        if let Some(loop_task) = user_input
            .strip_prefix("/loop ")
            .map(str::trim)
            .filter(|task| !task.is_empty())
        {
            command.arg(format!(
                "循环执行下面的任务，持续检查结果并修复问题，直到任务达到可用完成态：{}",
                loop_task
            ));
        } else {
            command.arg(user_input);
        }
        command
            .arg("--mode")
            .arg(mode.to_string())
            .arg(approval_arg)
            .arg("--max-iterations")
            .arg(max_iterations)
            .arg("--json-stream")
            .current_dir(workdir)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .ok()
    }

    pub(super) fn spawn_orchestrator_child(
        workdir: &PathBuf,
        user_input: &str,
        mode: ExecutionMode,
        approval: ApprovalPolicy,
    ) -> Option<Child> {
        let current_exe = env::current_exe().ok()?;
        let exe = current_exe
            .parent()
            .map(|dir| dir.join("sacode"))
            .filter(|path| path.exists())
            .unwrap_or(current_exe);
        let approval_arg = match approval {
            ApprovalPolicy::AutoApprove => "--approve",
            ApprovalPolicy::AutoDeny => "--deny",
            ApprovalPolicy::Prompt => "--prompt",
        };
        let effective = config::effective_config(workdir).ok();
        let max_iterations = effective
            .as_ref()
            .map(|value| value.max_iterations)
            .unwrap_or(6)
            .max(1)
            .to_string();
        Command::new(exe)
            .arg("orchestrator")
            .arg(user_input)
            .arg("--mode")
            .arg(mode.to_string())
            .arg(approval_arg)
            .arg("--max-iterations")
            .arg(max_iterations)
            .arg("--json")
            .current_dir(workdir)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .ok()
    }

    pub(super) fn execute_user_message_in_background(
        child: Arc<Mutex<Child>>,
        sender: std::sync::mpsc::Sender<AsyncResult>,
        task_id: u64,
        _source_task: &str,
    ) -> BackgroundTaskOutput {
        let started_at = Instant::now();
        let (stdout, stderr) = {
            let Ok(mut child) = child.lock() else {
                return BackgroundTaskOutput {
                    response: "任务执行失败: 无法访问后台执行进程".to_string(),
                    ..Default::default()
                };
            };
            (child.stdout.take(), child.stderr.take())
        };

        let Some(stdout) = stdout else {
            return BackgroundTaskOutput {
                response: "任务执行失败: 未获取到后台输出".to_string(),
                ..Default::default()
            };
        };

        let mut output = String::new();
        let mut stdout = BufReader::new(stdout);
        let mut line = String::new();
        loop {
            line.clear();
            match stdout.read_line(&mut line) {
                Ok(0) => break,
                Ok(_) => {
                    output.push_str(&line);
                    if let Some(payload) = line.trim_end().strip_prefix(JSON_STREAM_PREFIX) {
                        if let Ok(value) = serde_json::from_str::<serde_json::Value>(payload) {
                            if value.get("type").and_then(|item| item.as_str()) == Some("chunk") {
                                if let Some(content) =
                                    value.get("content").and_then(|item| item.as_str())
                                {
                                    let _ = sender.send(AsyncResult::ChatStreamChunk {
                                        task_id,
                                        kind: match value.get("kind").and_then(|item| item.as_str())
                                        {
                                            Some("thinking") => StreamChunkKind::Thinking,
                                            _ => StreamChunkKind::Message,
                                        },
                                        content: content.to_string(),
                                    });
                                }
                            }
                        }
                    }
                }
                Err(_) => {
                    return BackgroundTaskOutput {
                        response: "任务执行失败: 读取后台输出失败".to_string(),
                        ..Default::default()
                    };
                }
            }
        }

        let mut stderr_output = String::new();
        if let Some(mut stderr) = stderr {
            let _ = stderr.read_to_string(&mut stderr_output);
        }

        let exit_status = {
            loop {
                let Ok(mut child) = child.lock() else {
                    return BackgroundTaskOutput {
                        response: "任务执行失败: 无法等待后台执行进程退出".to_string(),
                        ..Default::default()
                    };
                };
                match child.try_wait() {
                    Ok(Some(status)) => break Some(status),
                    Ok(None) if started_at.elapsed() >= BACKGROUND_TASK_TIMEOUT => {
                        let _ = child.kill();
                        let _ = child.wait();
                        return BackgroundTaskOutput {
                            response: format!(
                                "任务执行失败: 后台任务超过 {} 秒仍未完成，已自动终止。",
                                BACKGROUND_TASK_TIMEOUT.as_secs()
                            ),
                            ..Default::default()
                        };
                    }
                    Ok(None) => {}
                    Err(_) => break None,
                }
                drop(child);
                thread::sleep(Duration::from_millis(100));
            }
        };

        App::parse_background_task_output(&output, &stderr_output, exit_status)
    }

    fn parse_background_task_output(
        output: &str,
        stderr_output: &str,
        exit_status: Option<std::process::ExitStatus>,
    ) -> BackgroundTaskOutput {
        let exit_status = match exit_status {
            Some(status) => status,
            None => {
                return BackgroundTaskOutput {
                    response: "任务执行失败: 无法等待后台执行进程退出".to_string(),
                    ..Default::default()
                }
            }
        };

        let (_, json_output) = Self::split_stream_frames(output);
        let trimmed_output = json_output.trim();
        if trimmed_output.is_empty() {
            let stderr_preview = stderr_output.trim();
            if !stderr_preview.is_empty() {
                Self::append_raw_log("child_stderr", stderr_preview);
            }
            return BackgroundTaskOutput {
                response: if stderr_preview.is_empty() {
                    format!(
                        "任务执行失败: 后台进程没有返回 JSON 输出，退出码: {}。请查看日志定位启动错误。",
                        exit_status
                            .code()
                            .map(|code| code.to_string())
                            .unwrap_or_else(|| "signal".to_string())
                    )
                } else {
                    format!(
                        "任务执行失败: 后台进程没有返回结果，退出码: {}。stderr 已写入日志。",
                        exit_status
                            .code()
                            .map(|code| code.to_string())
                            .unwrap_or_else(|| "signal".to_string())
                    )
                },
                ..Default::default()
            };
        }

        let parsed: serde_json::Value = match Self::extract_last_json_value(trimmed_output) {
            Ok(value) => value,
            Err(error) => {
                Self::append_raw_log("child_stdout_invalid_json", trimmed_output);
                if !stderr_output.trim().is_empty() {
                    Self::append_raw_log("child_stderr", stderr_output.trim());
                }
                return BackgroundTaskOutput {
                    response: format!(
                        "任务执行失败: 解析后台输出失败: {}。原始输出已写入日志。",
                        error
                    ),
                    ..Default::default()
                };
            }
        };

        let pending_question = parsed
            .get("pending_question")
            .cloned()
            .filter(|value| !value.is_null());
        let task_run = Self::extract_task_run_value(&parsed)
            .cloned()
            .and_then(|value| serde_json::from_value::<TaskRun>(value).ok());
        let cli_events = Self::format_cli_events(parsed.get("events"));
        let task_run_output = Self::extract_task_run_output_text(&parsed);
        let provider_response = task_run_output
            .or_else(|| Self::extract_provider_response(&parsed))
            .or_else(|| Self::extract_summary_record_response(&parsed));
        let _state = Self::extract_task_run_state(&parsed)
            .or_else(|| {
                parsed
                    .get("state")
                    .cloned()
                    .and_then(|value| serde_json::from_value::<TaskRunState>(value).ok())
            })
            .unwrap_or_else(|| {
                if pending_question.as_ref().is_some_and(|question| {
                    question.get("kind").and_then(|value| value.as_str()) == Some("tool_approval")
                }) {
                    TaskRunState::WaitingForApproval
                } else if pending_question.is_some() {
                    TaskRunState::WaitingForUser
                } else if provider_response.is_some() {
                    TaskRunState::Completed
                } else {
                    TaskRunState::Failed
                }
            });
        let learned_facts = parsed
            .get("learned_facts")
            .cloned()
            .and_then(|value| {
                serde_json::from_value::<Vec<crate::learning::LearnedFact>>(value).ok()
            })
            .unwrap_or_default();
        if !stderr_output.trim().is_empty() {
            Self::append_raw_log("child_stderr", stderr_output.trim());
        }

        let orchestration_summary = Self::format_orchestration_details(&parsed);
        let response = Self::merge_cli_response(cli_events, provider_response)
            .or_else(|| pending_question.as_ref().map(Self::format_pending_question))
            .unwrap_or_else(|| {
                if exit_status.success() {
                    "任务执行异常: 模型未返回最终内容。请查看日志确认工具调用和后台输出。"
                        .to_string()
                } else {
                    format!(
                        "任务执行失败: 后台进程退出异常，退出码: {}。请查看日志确认原始输出。",
                        exit_status
                            .code()
                            .map(|code| code.to_string())
                            .unwrap_or_else(|| "signal".to_string())
                    )
                }
            });
        let plan = parsed
            .get("plan")
            .cloned()
            .and_then(|value| serde_json::from_value::<sacode_kernel::Plan>(value).ok())
            .filter(|_| Self::has_explicit_todo_signal(&parsed));
        let usage = parsed
            .get("usage")
            .cloned()
            .and_then(|value| serde_json::from_value::<ChatUsage>(value).ok());
        let api_duration_ms = parsed
            .get("api_duration_ms")
            .and_then(|value| value.as_u64())
            .unwrap_or(0);
        let tool_duration_ms = parsed
            .get("tool_duration_ms")
            .and_then(|value| value.as_u64())
            .unwrap_or(0);
        let total_duration_ms = parsed
            .get("total_duration_ms")
            .and_then(|value| value.as_u64())
            .unwrap_or(0);
        let hit_round_limit = parsed
            .get("hit_round_limit")
            .and_then(|value| value.as_bool())
            .unwrap_or(false);
        BackgroundTaskOutput {
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
        }
    }

    fn split_stream_frames(output: &str) -> (Vec<serde_json::Value>, String) {
        let mut frames = Vec::new();
        let mut remainder = Vec::new();

        for line in output.lines() {
            if let Some(payload) = line.strip_prefix(JSON_STREAM_PREFIX) {
                if let Ok(value) = serde_json::from_str::<serde_json::Value>(payload) {
                    frames.push(value);
                }
            } else {
                remainder.push(line);
            }
        }

        (frames, remainder.join("\n"))
    }

    fn extract_task_run_state(parsed: &serde_json::Value) -> Option<TaskRunState> {
        Self::extract_task_run_value(parsed)
            .and_then(|value| value.get("state"))
            .cloned()
            .and_then(|value| serde_json::from_value::<TaskRunState>(value).ok())
    }

    fn extract_task_run_output_text(parsed: &serde_json::Value) -> Option<String> {
        Self::extract_task_run_value(parsed)
            .and_then(|value| value.get("output_text"))
            .and_then(|value| value.as_str())
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(ToString::to_string)
    }

    fn extract_task_run_value(parsed: &serde_json::Value) -> Option<&serde_json::Value> {
        parsed.get("task_run").or_else(|| {
            parsed
                .get("payload")
                .and_then(|value| value.get("task_run"))
        })
    }

    pub(super) fn finish_active_task(&mut self) {
        if let Some(task_id) = self.queue.active_task_id {
            self.task_message_indices.remove(&task_id);
        }
        self.queue.active_child = None;
        self.queue.processing = false;
        self.queue.active_task_id = None;
        self.active_task_started_at = None;
        self.spinner_index = 0;
        self.assistant_pending_thinking = false;
        self.queue.busy_message.clear();
        #[cfg(test)]
        if self.suppress_side_effects {
            self.scroll_to_bottom();
            return;
        }
        self.refresh_git_changes();
        self.scroll_to_bottom();
    }

    pub(super) fn start_next_queued_message(&mut self) {
        if self.queue.processing {
            return;
        }

        if let Some(next) = self.queue.queued_messages.pop_front() {
            #[cfg(test)]
            if next.loop_state.is_some() {
                self.queue.queued_messages.push_front(next);
                return;
            }
            self.start_queued_message(next);
        }
    }

    pub(super) fn cancel_active_task(&mut self) {
        if let Some(task_id) = self.queue.active_task_id {
            self.canceled_task_ids.insert(task_id);
            self.queue.busy_message = format!("正在取消任务 #{}...", task_id);
            self.log_event("cancel_requested", &format!("#{}", task_id));
            if let Some(child) = &self.queue.active_child {
                let _ = child.lock().unwrap().kill();
            }
        }
    }

    pub(super) fn cancel_command(&mut self) {
        if self.queue.processing {
            self.cancel_active_task();
            return;
        }

        if self.queue.queued_messages.is_empty() {
            self.push_system_message("当前没有正在执行或等待中的任务。");
        } else {
            let count = self.queue.queued_messages.len();
            self.queue.queued_messages.clear();
            self.push_system_message(&format!("已清空等待队列，共移除 {} 项。", count));
        }
    }
}

#[cfg(test)]
mod tests {
    use super::App;
    use crate::cmd::ApprovalPolicy;
    use crate::cmd::JSON_STREAM_PREFIX;
    use sacode_kernel::ExecutionMode;
    use sacode_kernel::TaskRunState;
    use std::process::Command;

    /// Get a successful exit status in a cross-platform way.
    #[cfg(unix)]
    fn success_exit_status() -> std::process::ExitStatus {
        Command::new("true").status().expect("true exit status")
    }

    #[cfg(windows)]
    fn success_exit_status() -> std::process::ExitStatus {
        Command::new("cmd")
            .args(["/C", "exit", "0"])
            .status()
            .expect("cmd exit status")
    }

    #[test]
    fn extract_task_run_state_prefers_nested_task_run_state() {
        let parsed = serde_json::json!({
            "state": "Failed",
            "task_run": {
                "state": "Completed"
            }
        });

        let state = App::extract_task_run_state(&parsed);

        assert_eq!(state, Some(TaskRunState::Completed));
    }

    #[test]
    fn extract_task_run_output_text_reads_nested_output_text() {
        let parsed = serde_json::json!({
            "provider_response": "legacy output",
            "task_run": {
                "output_text": "  final answer from task run  "
            }
        });

        let output = App::extract_task_run_output_text(&parsed);

        assert_eq!(output.as_deref(), Some("final answer from task run"));
    }

    #[test]
    fn extract_task_run_output_text_ignores_blank_nested_output() {
        let parsed = serde_json::json!({
            "task_run": {
                "output_text": "   "
            }
        });

        let output = App::extract_task_run_output_text(&parsed);

        assert_eq!(output, None);
    }

    #[test]
    fn extract_task_run_state_reads_payload_nested_task_run_state() {
        let parsed = serde_json::json!({
            "payload": {
                "task_run": {
                    "state": "Completed"
                }
            }
        });

        let state = App::extract_task_run_state(&parsed);

        assert_eq!(state, Some(TaskRunState::Completed));
    }

    #[test]
    fn extract_task_run_output_text_reads_payload_nested_output_text() {
        let parsed = serde_json::json!({
            "payload": {
                "task_run": {
                    "output_text": "  payload final answer  "
                }
            }
        });

        let output = App::extract_task_run_output_text(&parsed);

        assert_eq!(output.as_deref(), Some("payload final answer"));
    }

    #[test]
    fn spawn_orchestrator_child_builds_process() {
        let workdir = std::env::current_dir().expect("current dir");
        let child = App::spawn_orchestrator_child(
            &workdir,
            "ULW[agents=tui] 分析仓库",
            ExecutionMode::Build,
            ApprovalPolicy::Prompt,
        );

        assert!(child.is_some());
        if let Some(mut child) = child {
            let _ = child.kill();
            let _ = child.wait();
        }
    }

    #[test]
    fn parse_background_task_output_prefers_task_run_fields() {
        let payload = serde_json::json!({
            "state": "Failed",
            "provider_response": "legacy output",
            "task_run": {
                "state": "Completed",
                "output_text": "final answer"
            }
        })
        .to_string();
        let exit_status = success_exit_status();

        let result = App::parse_background_task_output(&payload, "", Some(exit_status));

        assert_eq!(result.response, "final answer");
        assert_eq!(
            App::extract_task_run_state(
                &serde_json::from_str::<serde_json::Value>(&payload).expect("payload json")
            ),
            Some(TaskRunState::Completed)
        );
    }

    #[test]
    fn parse_background_task_output_falls_back_to_summary_record() {
        let payload = serde_json::json!({
            "state": "Completed",
            "summary_record": {
                "overview": "agents 已完成汇总",
                "sections": [
                    {
                        "title": "next",
                        "bullets": ["输出最终结果"]
                    }
                ]
            }
        })
        .to_string();
        let exit_status = success_exit_status();

        let result = App::parse_background_task_output(&payload, "", Some(exit_status));

        assert!(result.response.contains("agents 已完成汇总"));
        assert!(result.response.contains("输出最终结果"));
    }

    #[test]
    fn split_stream_frames_keeps_final_json_payload() {
        let output = concat!(
            "__SACODE_STREAM__{\"type\":\"chunk\",\"content\":\"hello\"}\n",
            "{\"provider_response\":\"final answer\",\"state\":\"Completed\"}\n"
        );

        let (frames, json_output) = App::split_stream_frames(output);

        assert_eq!(frames.len(), 1);
        assert_eq!(
            frames[0].get("type").and_then(|value| value.as_str()),
            Some("chunk")
        );
        assert!(json_output.contains("final answer"));
        assert!(!json_output.contains(JSON_STREAM_PREFIX));
    }

    #[test]
    fn parse_background_task_output_ignores_stream_prefix_lines() {
        let payload = concat!(
            "__SACODE_STREAM__{\"type\":\"chunk\",\"content\":\"hello\"}\n",
            "{\"provider_response\":\"final answer\",\"state\":\"Completed\"}\n"
        );
        let exit_status = success_exit_status();

        let result = App::parse_background_task_output(payload, "", Some(exit_status));

        assert_eq!(result.response, "final answer");
    }

    #[test]
    fn queue_message_shows_content_for_single_waiting_task() {
        let mut app = App::new();
        app.queue.processing = true;

        app.enqueue_or_start_message_with_approval(
            "修复模型列表加载".to_string(),
            ApprovalPolicy::Prompt,
        );

        let last = app.messages.last().expect("queue status message");
        assert!(last.content.contains("等待执行: 修复模型列表加载"));
    }

    #[test]
    fn queue_message_shows_count_for_multiple_waiting_tasks() {
        let mut app = App::new();
        app.queue.processing = true;

        app.enqueue_or_start_message_with_approval("任务一".to_string(), ApprovalPolicy::Prompt);
        app.enqueue_or_start_message_with_approval("任务二".to_string(), ApprovalPolicy::Prompt);

        let last = app.messages.last().expect("queue status message");
        assert!(last.content.contains("前方还有 1 项任务"));
    }
}
