use std::collections::HashSet;

use serde_json::Value;

use crate::cmd::ApprovalPolicy;

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
        self.interaction.selected_pending_question_index = 0;
        self.interaction.selected_pending_option_index = 0;
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
            self.interaction.pending_question_items.push(PendingQuestionItem {
                question: Self::pending_question_title(&question),
                options: Vec::new(),
                allow_multiple: false,
            });
        }
        self.interaction.selected_pending_question_index = 0;
        self.interaction.selected_pending_option_index = 0;
        self.interaction.selected_pending_answers =
            vec![HashSet::new(); self.interaction.pending_question_items.len()];
        self.input.clear();
        self.input_mode = InputMode::PendingQuestion;
    }

    pub(super) fn parse_pending_approval_request(
        question: &serde_json::Value,
    ) -> Option<PendingApprovalRequest> {
        if question
            .get("kind")
            .and_then(|value| value.as_str())
            != Some("tool_approval")
        {
            return None;
        }

        Some(PendingApprovalRequest {
            task_prompt: String::new(),
            tool_name: question
                .get("tool_name")
                .and_then(|value| value.as_str())
                .unwrap_or_default()
                .to_string(),
        })
    }

    pub(super) fn parse_pending_question_items(
        question: &serde_json::Value,
    ) -> Vec<PendingQuestionItem> {
        if let Some(questions) = question.get("questions").and_then(|value| value.as_array()) {
            return questions.iter().map(Self::parse_pending_question_item).collect();
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
            .map(|items| items.iter().map(Self::parse_pending_question_option).collect())
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
        let len = self.interaction.pending_question_items.len() as isize;
        let next = (self.interaction.selected_pending_question_index as isize + delta)
            .rem_euclid(len) as usize;
        self.interaction.selected_pending_question_index = next;
        self.interaction.selected_pending_option_index = self
            .interaction
            .selected_pending_option_index
            .min(
                self.current_pending_question()
                    .map(|question| question.options.len().saturating_sub(1))
                    .unwrap_or(0),
            );
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

        let custom_answer = self.input.trim().to_string();
        let answer = if !custom_answer.is_empty() {
            custom_answer
        } else {
            self.interaction
                .pending_question_items
                .iter()
                .enumerate()
                .map(|(question_index, question)| {
                    let labels = self
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

                    if labels.is_empty() {
                        format!("{}: 未选择", question.question)
                    } else {
                        format!("{}: {}", question.question, labels.join(", "))
                    }
                })
                .collect::<Vec<_>>()
                .join("\n")
        };

        if answer.trim().is_empty() || answer.contains("未选择") && self.input.trim().is_empty() {
            self.push_system_message(
                "请选择选项，或输入自定义回答后按 Enter。普通消息可按 Esc 返回聊天后发送。",
            );
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
                self.push_system_message(&format!("已拒绝工具 {} 的修改授权。", request.tool_name));
            }
            1 => {
                self.push_system_message(&format!(
                    "已允许工具 {} 本次执行，正在继续任务。",
                    request.tool_name
                ));
                self.enqueue_or_start_message_with_approval(
                    request.task_prompt,
                    ApprovalPolicy::AutoApprove,
                );
            }
            2 => {
                self.session_auto_approve_edits = true;
                self.push_system_message(&format!(
                    "已允许工具 {} 在本会话内自动执行修改操作，正在继续任务。",
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
