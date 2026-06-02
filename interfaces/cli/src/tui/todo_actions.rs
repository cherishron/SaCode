use sacode_kernel::ExecutionMode;

use super::{
    App, InputMode, InteractionState, Message, MessageRole, TodoItem, TodoPlan, TodoStatus,
};

impl App {
    pub(super) fn todo_command(&mut self, input: &str) {
        let parts: Vec<&str> = input.split_whitespace().collect();
        let sub = parts.get(1).copied().unwrap_or("show");

        match sub {
            "show" => self.show_todo_plan(),
            "confirm" => self.confirm_todo_plan(),
            "clear" => {
                self.interaction.todo_plan = None;
                self.push_system_message("已清空当前待办列表。");
            }
            _ => self.push_system_message("用法: /todo show|confirm|clear"),
        }
    }

    pub(super) fn capture_todo_plan(&mut self, source_task: &str, plan: sacode_kernel::Plan) {
        let items = plan
            .steps
            .iter()
            .map(|step| TodoItem {
                id: step.id,
                description: step.description.clone(),
                status: TodoStatus::Pending,
            })
            .collect::<Vec<_>>();

        self.interaction.todo_plan = Some(TodoPlan {
            source_task: source_task.to_string(),
            items,
            confirmed: self.execution_mode != ExecutionMode::Plan,
        });

        if self.execution_mode == ExecutionMode::Plan {
            self.interaction.state = InteractionState::TodoConfirmation;
            self.input_mode = InputMode::TodoConfirm;
            self.push_system_message(&format!(
                "已生成 todo 计划，共 {} 项。按 Enter 或输入 /todo confirm 后会自动切换到 Yolo 模式执行。",
                self.interaction
                    .todo_plan
                    .as_ref()
                    .map(|plan| plan.items.len())
                    .unwrap_or(0)
            ));
        } else {
            self.push_system_message(&format!(
                "已生成 todo 计划，共 {} 项。后续由 AI 在回复中自行推进；右侧面板可查看进度。",
                self.interaction
                    .todo_plan
                    .as_ref()
                    .map(|plan| plan.items.len())
                    .unwrap_or(0)
            ));
        }
    }

    pub(super) fn show_todo_plan(&mut self) {
        let Some(plan) = &self.interaction.todo_plan else {
            self.push_system_message("当前没有待办列表。先发送一个需要规划的任务。");
            return;
        };

        let mut lines = vec![format!("任务规划: {}", plan.source_task)];
        for item in &plan.items {
            let status = match item.status {
                TodoStatus::Pending => "pending",
                TodoStatus::Running => "running",
                TodoStatus::Completed => "completed",
            };
            lines.push(format!("{}. [{}] {}", item.id, status, item.description));
        }
        lines.push(format!(
            "确认状态: {}",
            if plan.confirmed { "已确认" } else { "待确认" }
        ));
        self.push_system_message(&lines.join("\n"));
    }

    pub(super) fn confirm_todo_plan(&mut self) {
        if self.interaction.todo_plan.is_none() {
            self.input_mode = InputMode::Chat;
            self.push_system_message("当前没有待办列表可确认。");
            return;
        }

        if self
            .todo_plan
            .as_ref()
            .map(|plan| plan.confirmed)
            .unwrap_or(false)
        {
            self.input_mode = InputMode::Chat;
            self.push_system_message("当前待办已经处于自动执行状态。右侧面板会持续展示进度。");
            return;
        }

        self.apply_execution_mode("yolo", false);
        self.interaction.state = InteractionState::Idle;
        self.input_mode = InputMode::Chat;

        let Some(plan) = &mut self.interaction.todo_plan else {
            return;
        };
        plan.confirmed = true;
        let pending_items = plan
            .items
            .iter_mut()
            .filter(|item| item.status == TodoStatus::Pending)
            .map(|item| {
                item.status = TodoStatus::Running;
                (item.id, item.description.clone())
            })
            .collect::<Vec<_>>();

        for (_, description) in &pending_items {
            self.enqueue_or_start_message(description.clone());
        }

        if pending_items.is_empty() {
            self.push_system_message("待办列表中没有可执行项。");
        } else {
            self.push_system_message(&format!(
                "已确认待办，已切换到 Yolo 模式并加入执行队列 {} 项。",
                pending_items.len()
            ));
        }
    }

    pub(super) fn mark_todo_completed(&mut self, prompt: &str) {
        if let Some(plan) = &mut self.interaction.todo_plan {
            for item in &mut plan.items {
                if item.description == prompt && item.status == TodoStatus::Running {
                    item.status = TodoStatus::Completed;
                    break;
                }
            }
        }
    }

    pub(super) fn compress_current_context(&mut self) {
        if self.queue.processing {
            self.push_system_message("当前有任务正在执行，请等待完成后再压缩会话。");
            return;
        }

        let summary = self.build_session_summary();
        if summary.is_empty() {
            self.push_system_message("当前会话内容较少，暂时无需压缩。");
            return;
        }

        self.session_summary = Some(summary.clone());
        let now = chrono::Local::now();
        self.replace_messages(vec![Message {
            role: MessageRole::System,
            content: format!(
                "当前会话已压缩。后续任务会自动携带历史摘要。\n\n摘要预览:\n{}",
                summary
            ),
            timestamp: now.format("%Y-%m-%d %H:%M").to_string(),
            collapsed: false,
        }]);
        self.queue.queued_messages.clear();
        self.interaction.todo_plan = None;
        self.queue.processing = false;
        self.queue.active_task_id = None;
        self.active_task_started_at = None;
        self.queue.busy_message.clear();
        self.save_current_session();
        self.scroll_to_bottom();
    }

    pub(super) fn build_session_summary(&self) -> String {
        let messages = self
            .messages
            .iter()
            .filter(|message| matches!(message.role, MessageRole::User | MessageRole::Assistant))
            .collect::<Vec<_>>();

        if messages.len() <= 2 {
            return String::new();
        }

        let mut lines = Vec::new();
        if let Some(existing) = self
            .session_summary
            .as_ref()
            .filter(|value| !value.trim().is_empty())
        {
            lines.push("已有摘要:".to_string());
            lines.push(existing.trim().to_string());
        }

        lines.push("本轮对话摘要:".to_string());
        for message in messages.iter().take(12) {
            let role = match message.role {
                MessageRole::User => "用户",
                MessageRole::Assistant => "助手",
                MessageRole::System => continue,
            };
            let compact = message.content.split_whitespace().collect::<Vec<_>>().join(" ");
            let snippet = compact.chars().take(220).collect::<String>();
            lines.push(format!("- {}: {}", role, snippet));
        }

        lines.join("\n")
    }
}
