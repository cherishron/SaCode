use std::collections::HashSet;
use std::path::{Path, PathBuf};

use serde_json::Value;

use crate::cmd::ApprovalPolicy;
use sacode_runtime::{
    install_current_mode, install_global_policy, SandboxConfigStore, SandboxPolicy,
};

use super::{App, InputMode, TodoPlan};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum InteractionState {
    Idle,
    TodoConfirmation,
    WaitingForQuestion,
    WaitingForApproval,
}

#[derive(Debug, Clone)]
pub struct PendingQuestionItem {
    pub question: String,
    pub options: Vec<PendingQuestionOption>,
    pub allow_multiple: bool,
}

#[derive(Debug, Clone)]
pub struct PendingQuestionOption {
    pub label: String,
    pub description: String,
}

#[derive(Debug, Clone)]
pub struct PendingApprovalRequest {
    pub task_prompt: String,
    pub tool_name: String,
    pub allowed_dir: Option<PathBuf>,
    /// 操作摘要：shell 命令文本或文件路径，用于审批面板展示
    pub input_summary: Option<String>,
}

#[derive(Debug, Clone)]
pub struct InteractionSession {
    pub state: InteractionState,
    pub todo_plan: Option<TodoPlan>,
    pub pending_question: Option<Value>,
    pub pending_question_items: Vec<PendingQuestionItem>,
    pub selected_pending_question_index: usize,
    pub selected_pending_option_index: usize,
    pub selected_pending_answers: Vec<HashSet<usize>>,
    pub pending_custom_answers: Vec<String>,
    pub pending_confirm_submission: bool,
    pub pending_approval_request: Option<PendingApprovalRequest>,
}

impl Default for InteractionSession {
    fn default() -> Self {
        Self {
            state: InteractionState::Idle,
            todo_plan: None,
            pending_question: None,
            pending_question_items: Vec::new(),
            selected_pending_question_index: 0,
            selected_pending_option_index: 0,
            selected_pending_answers: Vec::new(),
            pending_custom_answers: Vec::new(),
            pending_confirm_submission: false,
            pending_approval_request: None,
        }
    }
}

impl App {
    pub(super) fn format_pending_question(question: &serde_json::Value) -> String {
        let title = question
            .get("question")
            .and_then(|value| value.as_str())
            .unwrap_or("需要用户回答后继续执行。");
        let options = question
            .get("options")
            .and_then(|value| value.as_array())
            .map(|items| {
                items
                    .iter()
                    .filter_map(|item| item.get("label").and_then(|value| value.as_str()))
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default();

        if options.is_empty() {
            format!("[等待用户回答] {}", title)
        } else {
            format!("[等待用户回答] {}\n可选项: {}", title, options.join(", "))
        }
    }

    pub(super) fn pending_question_title(question: &serde_json::Value) -> String {
        question
            .get("question")
            .and_then(|value| value.as_str())
            .unwrap_or("需要用户回答后继续执行。")
            .to_string()
    }

    pub(super) fn decorate_pending_answer(&mut self, prompt: &str) -> String {
        if self.interaction.pending_approval_request.is_some() {
            return prompt.to_string();
        }
        let Some(question) = self.interaction.pending_question.take() else {
            return prompt.to_string();
        };
        format!(
            "你上一轮通过 interaction.ask 提出了这个问题：\n{}\n\n用户给出的回答是：\n{}\n\n请基于这个回答继续完成原任务。",
            Self::pending_question_title(&question),
            prompt.trim()
        )
    }

    pub(super) fn resume_pending_question_with_answer(&mut self, answer: &str) {
        let resumed = self.decorate_pending_answer(answer);
        self.clear_pending_question_state();
        self.input_mode = InputMode::Chat;
        self.enqueue_or_start_message(resumed);
        self.save_current_session();
        self.scroll_to_bottom();
    }

    pub(super) fn clear_pending_question_state(&mut self) {
        self.interaction.state = InteractionState::Idle;
        self.interaction.pending_question = None;
        self.interaction.pending_question_items.clear();
        self.interaction.selected_pending_answers.clear();
        self.interaction.pending_custom_answers.clear();
        self.interaction.selected_pending_question_index = 0;
        self.interaction.selected_pending_option_index = 0;
        self.interaction.pending_confirm_submission = false;
        self.interaction.pending_approval_request = None;
    }

    pub(super) fn set_pending_question_state(&mut self, question: serde_json::Value) {
        self.interaction.pending_approval_request = Self::parse_pending_approval_request(&question);
        self.interaction.state = if self.interaction.pending_approval_request.is_some() {
            InteractionState::WaitingForApproval
        } else {
            InteractionState::WaitingForQuestion
        };
        self.interaction.pending_question = Some(question.clone());
        self.interaction.pending_question_items = Self::parse_pending_question_items(&question);
        if self.interaction.pending_question_items.is_empty() {
            self.interaction
                .pending_question_items
                .push(PendingQuestionItem {
                    question: Self::pending_question_title(&question),
                    options: Vec::new(),
                    allow_multiple: false,
                });
        }
        self.interaction.selected_pending_question_index = 0;
        self.interaction.selected_pending_option_index = 0;
        self.interaction.selected_pending_answers =
            vec![HashSet::new(); self.interaction.pending_question_items.len()];
        self.interaction.pending_custom_answers =
            vec![String::new(); self.interaction.pending_question_items.len()];
        self.interaction.pending_confirm_submission = false;
        self.input = self.current_pending_custom_answer().unwrap_or_default();
        self.input_mode = InputMode::PendingQuestion;
    }

    pub(super) fn parse_pending_approval_request(
        question: &serde_json::Value,
    ) -> Option<PendingApprovalRequest> {
        if question.get("kind").and_then(|value| value.as_str()) != Some("tool_approval") {
            return None;
        }

        Some(PendingApprovalRequest {
            task_prompt: question
                .get("task_prompt")
                .and_then(|value| value.as_str())
                .unwrap_or_default()
                .to_string(),
            tool_name: question
                .get("tool_name")
                .and_then(|value| value.as_str())
                .unwrap_or_default()
                .to_string(),
            allowed_dir: Self::extract_allowed_dir(question.get("args").unwrap_or(&Value::Null)),
            input_summary: Self::extract_input_summary(
                question.get("args").unwrap_or(&Value::Null),
            ),
        })
    }

    fn extract_input_summary(args: &Value) -> Option<String> {
        // shell.exec: args.command
        if let Some(cmd) = args.get("command").and_then(|v| v.as_str()) {
            return Some(cmd.to_string());
        }
        // fs.write/fs.edit: args.path
        if let Some(path) = args.get("path").and_then(|v| v.as_str()) {
            return Some(path.to_string());
        }
        None
    }

    fn extract_allowed_dir(args: &Value) -> Option<PathBuf> {
        let path = args.get("path").and_then(|value| value.as_str())?;
        let path = PathBuf::from(path);
        let target = if path.is_dir() {
            path
        } else {
            path.parent().map(Path::to_path_buf)?
        };

        target.canonicalize().ok().or(Some(target))
    }

    pub(super) fn parse_pending_question_items(
        question: &serde_json::Value,
    ) -> Vec<PendingQuestionItem> {
        if let Some(questions) = question.get("questions").and_then(|value| value.as_array()) {
            return questions
                .iter()
                .map(Self::parse_pending_question_item)
                .collect();
        }
        vec![Self::parse_pending_question_item(question)]
    }

    pub(super) fn parse_pending_question_item(value: &serde_json::Value) -> PendingQuestionItem {
        let question = value
            .get("question")
            .or_else(|| value.get("title"))
            .and_then(|value| value.as_str())
            .unwrap_or("需要用户回答后继续执行。")
            .to_string();
        let options = value
            .get("options")
            .and_then(|value| value.as_array())
            .map(|items| {
                items
                    .iter()
                    .map(Self::parse_pending_question_option)
                    .collect()
            })
            .unwrap_or_default();
        let allow_multiple = value
            .get("allow_multiple")
            .or_else(|| value.get("multiple"))
            .and_then(|value| value.as_bool())
            .unwrap_or(false);
        PendingQuestionItem {
            question,
            options,
            allow_multiple,
        }
    }

    pub(super) fn parse_pending_question_option(
        value: &serde_json::Value,
    ) -> PendingQuestionOption {
        if let Some(text) = value.as_str() {
            return PendingQuestionOption {
                label: text.to_string(),
                description: String::new(),
            };
        }
        PendingQuestionOption {
            label: value
                .get("label")
                .or_else(|| value.get("value"))
                .or_else(|| value.get("text"))
                .and_then(|value| value.as_str())
                .unwrap_or("选项")
                .to_string(),
            description: value
                .get("description")
                .or_else(|| value.get("desc"))
                .and_then(|value| value.as_str())
                .unwrap_or("")
                .to_string(),
        }
    }

    pub(super) fn current_pending_question(&self) -> Option<&PendingQuestionItem> {
        self.interaction
            .pending_question_items
            .get(self.interaction.selected_pending_question_index)
    }

    pub(super) fn move_pending_question_tab(&mut self, delta: isize) {
        if self.interaction.pending_question_items.is_empty() {
            return;
        }
        self.persist_pending_question_input();
        let len = self.interaction.pending_question_items.len() as isize;
        let next = (self.interaction.selected_pending_question_index as isize + delta)
            .rem_euclid(len) as usize;
        self.interaction.selected_pending_question_index = next;
        self.interaction.pending_confirm_submission = false;
        self.interaction.selected_pending_option_index =
            self.interaction.selected_pending_option_index.min(
                self.current_pending_question()
                    .map(|question| question.options.len().saturating_sub(1))
                    .unwrap_or(0),
            );
        self.restore_pending_question_input();
    }

    pub(super) fn move_pending_option(&mut self, delta: isize) {
        let Some(question) = self.current_pending_question() else {
            return;
        };
        if question.options.is_empty() {
            return;
        }
        let len = question.options.len() as isize;
        self.interaction.selected_pending_option_index =
            (self.interaction.selected_pending_option_index as isize + delta).rem_euclid(len)
                as usize;
    }

    pub(super) fn toggle_pending_option(&mut self) {
        let Some(question) = self.current_pending_question() else {
            return;
        };
        if question.options.is_empty() {
            return;
        }
        let index = self.interaction.selected_pending_question_index;
        let option = self.interaction.selected_pending_option_index;
        if question.allow_multiple {
            if !self.interaction.selected_pending_answers[index].insert(option) {
                self.interaction.selected_pending_answers[index].remove(&option);
            }
        } else {
            self.interaction.selected_pending_answers[index].clear();
            self.interaction.selected_pending_answers[index].insert(option);
        }
        self.interaction.pending_confirm_submission = false;
    }

    pub(super) fn persist_pending_question_input(&mut self) {
        let index = self.interaction.selected_pending_question_index;
        if let Some(answer) = self.interaction.pending_custom_answers.get_mut(index) {
            *answer = self.input.clone();
        }
    }

    pub(super) fn restore_pending_question_input(&mut self) {
        self.input = self.current_pending_custom_answer().unwrap_or_default();
        self.input_scroll_follows_cursor = true;
    }

    pub(super) fn current_pending_custom_answer(&self) -> Option<String> {
        self.interaction
            .pending_custom_answers
            .get(self.interaction.selected_pending_question_index)
            .cloned()
    }

    pub(super) fn pending_question_answer_lines(&self) -> Vec<String> {
        self.interaction
            .pending_question_items
            .iter()
            .enumerate()
            .map(|(question_index, question)| {
                let custom = self
                    .interaction
                    .pending_custom_answers
                    .get(question_index)
                    .map(|value| value.trim())
                    .unwrap_or("");
                if !custom.is_empty() {
                    return format!("{}: {}", question.question, custom);
                }

                let mut labels = self
                    .interaction
                    .selected_pending_answers
                    .get(question_index)
                    .map(|answers| {
                        let mut selected = answers
                            .iter()
                            .filter_map(|index| {
                                question
                                    .options
                                    .get(*index)
                                    .map(|option| option.label.clone())
                            })
                            .collect::<Vec<_>>();
                        selected.sort();
                        selected
                    })
                    .unwrap_or_default();
                labels.sort();

                if labels.is_empty() {
                    format!("{}: 未回答", question.question)
                } else {
                    format!("{}: {}", question.question, labels.join(", "))
                }
            })
            .collect()
    }

    pub(super) fn current_pending_question_answered(&self) -> bool {
        let index = self.interaction.selected_pending_question_index;
        self.pending_question_answered(index)
    }

    pub(super) fn pending_question_answered(&self, index: usize) -> bool {
        let custom_answer = self
            .interaction
            .pending_custom_answers
            .get(index)
            .map(|value| !value.trim().is_empty())
            .unwrap_or(false);
        let has_selected_option = self
            .interaction
            .selected_pending_answers
            .get(index)
            .map(|answers| !answers.is_empty())
            .unwrap_or(false);
        custom_answer || has_selected_option
    }

    pub(super) fn advance_pending_question_or_confirm(&mut self) {
        self.persist_pending_question_input();

        if self.interaction.pending_confirm_submission {
            self.submit_pending_question_answers();
            return;
        }

        if !self.current_pending_question_answered() {
            self.push_system_message("请先为当前问题选择选项或输入自定义回答，然后再继续。");
            return;
        }

        let last_index = self
            .interaction
            .pending_question_items
            .len()
            .saturating_sub(1);
        if self.interaction.selected_pending_question_index < last_index {
            self.interaction.selected_pending_question_index += 1;
            self.interaction.selected_pending_option_index =
                self.interaction.selected_pending_option_index.min(
                    self.current_pending_question()
                        .map(|question| question.options.len().saturating_sub(1))
                        .unwrap_or(0),
                );
            self.restore_pending_question_input();
            return;
        }

        if self
            .interaction
            .pending_question_items
            .iter()
            .enumerate()
            .any(|(index, _)| !self.pending_question_answered(index))
        {
            self.push_system_message("仍有未回答的问题，请补全后再确认提交。");
            return;
        }

        self.interaction.pending_confirm_submission = true;
        self.input.clear();
    }

    pub(super) fn submit_pending_question_answer(&mut self) {
        if self.interaction.pending_question.is_none() {
            self.input_mode = InputMode::Chat;
            self.push_system_message("当前没有等待回答的任务。");
            return;
        }

        if self.interaction.pending_approval_request.is_some() {
            self.submit_pending_approval_answer();
            return;
        }

        self.advance_pending_question_or_confirm();
    }

    pub(super) fn submit_pending_question_answers(&mut self) {
        let answer = self.pending_question_answer_lines().join("\n");
        if answer.trim().is_empty() {
            self.push_system_message("当前没有可提交的回答内容。");
            return;
        }

        self.input.clear();
        self.resume_pending_question_with_answer(&answer);
    }

    pub(super) fn submit_pending_approval_answer(&mut self) {
        let selection = self
            .interaction
            .selected_pending_answers
            .first()
            .and_then(|answers| answers.iter().next().copied());
        let Some(selection) = selection else {
            self.push_system_message("请选择审批结果后再继续。");
            return;
        };

        let Some(request) = self.interaction.pending_approval_request.clone() else {
            self.push_system_message("当前没有待处理的审批请求。");
            return;
        };

        self.clear_pending_question_state();
        self.input.clear();
        self.input_mode = InputMode::Chat;

        match selection {
            0 => {
                self.push_system_message(&format!(
                    "已拒绝工具 {} 的权限授权请求。",
                    request.tool_name
                ));
            }
            1 => {
                self.push_system_message(&format!(
                    "已允许工具 {} 本次请求授权并继续执行，正在继续任务。",
                    request.tool_name
                ));
                self.enqueue_or_start_message_with_approval(
                    request.task_prompt,
                    ApprovalPolicy::AutoApprove,
                );
            }
            2 => {
                self.session_auto_approve_edits = true;
                if let Some(path) = request.allowed_dir.as_ref() {
                    match self.access_store.add_dir(path) {
                        Ok(_) => {
                            let refreshed = SandboxConfigStore::new(&self.workdir)
                                .policy_for_mode(self.execution_mode)
                                .unwrap_or_else(|_| SandboxPolicy::for_mode(self.execution_mode));
                            install_current_mode(self.execution_mode);
                            install_global_policy(refreshed);
                        }
                        Err(error) => {
                            self.push_error_message(&format!(
                                "会话授权已开启，但目录白名单写入失败: {}",
                                error
                            ));
                        }
                    }
                }
                self.save_current_session();
                self.push_system_message(&format!(
                    "已允许工具 {} 在本会话内继续请求并执行授权操作，正在继续任务。",
                    request.tool_name
                ));
                self.enqueue_or_start_message_with_approval(
                    request.task_prompt,
                    ApprovalPolicy::AutoApprove,
                );
            }
            _ => {
                self.push_system_message("未识别的审批结果。");
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn pending_question_enter_advances_then_enters_confirm_state() {
        let mut app = App::new();
        app.set_pending_question_state(serde_json::json!({
            "questions": [
                {"question": "Q1", "options": [{"label": "A"}]},
                {"question": "Q2", "options": [{"label": "B"}]}
            ]
        }));

        app.toggle_pending_option();
        app.submit_pending_question_answer();
        assert_eq!(app.interaction.selected_pending_question_index, 1);
        assert!(!app.interaction.pending_confirm_submission);

        app.toggle_pending_option();
        app.submit_pending_question_answer();
        assert!(app.interaction.pending_confirm_submission);
    }

    #[test]
    fn pending_question_submit_collects_all_answers() {
        let mut app = App::new();
        app.set_pending_question_state(serde_json::json!({
            "questions": [
                {"question": "Q1", "options": [{"label": "A"}]},
                {"question": "Q2"}
            ]
        }));

        app.toggle_pending_option();
        app.submit_pending_question_answer();
        app.input = "自定义回答".to_string();
        app.submit_pending_question_answer();

        let answer = app.pending_question_answer_lines().join("\n");
        assert!(app.interaction.pending_confirm_submission);
        assert!(answer.contains("Q1: A"));
        assert!(answer.contains("Q2: 自定义回答"));
    }

    #[test]
    fn parse_pending_approval_request_extracts_allowed_dir_from_args() {
        let temp = tempdir().expect("create temp dir");
        let file_path = temp.path().join("nested").join("file.txt");
        let question = serde_json::json!({
            "kind": "tool_approval",
            "task_prompt": "读取 pnpm store 并修复依赖问题",
            "tool_name": "fs.read",
            "args": {
                "path": file_path.to_string_lossy().to_string()
            }
        });

        let request = App::parse_pending_approval_request(&question).expect("approval request");

        assert_eq!(request.tool_name, "fs.read");
        assert_eq!(request.task_prompt, "读取 pnpm store 并修复依赖问题");
        assert_eq!(request.allowed_dir.as_deref(), file_path.parent());
    }
}
