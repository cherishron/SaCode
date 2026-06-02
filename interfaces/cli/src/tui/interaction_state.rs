use super::{App, ApprovalPolicy, ExecutionMode, InputMode, InteractionState};

impl App {
    pub(super) fn cancel_todo_confirmation(&mut self) {
        self.interaction.state = InteractionState::Idle;
        self.input_mode = InputMode::Chat;
        self.push_system_message("已退出待办确认态。输入 /todo confirm 可继续执行该计划。");
    }

    pub(super) fn should_resume_pending_question_on_enter(&self) -> bool {
        matches!(
            self.interaction.state,
            InteractionState::WaitingForQuestion | InteractionState::WaitingForApproval
        ) && self.input_mode == InputMode::Chat
            && self.input.trim().is_empty()
    }

    pub(super) fn current_task_approval_policy(&self) -> ApprovalPolicy {
        match self.execution_mode {
            ExecutionMode::Plan => ApprovalPolicy::AutoDeny,
            ExecutionMode::Build => {
                if self.session_auto_approve_edits {
                    ApprovalPolicy::AutoApprove
                } else {
                    ApprovalPolicy::Prompt
                }
            }
            ExecutionMode::Yolo => ApprovalPolicy::AutoApprove,
        }
    }
}
