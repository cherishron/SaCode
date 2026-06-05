use super::{App, InputMode, TaskAction};
use crate::task_store::{TaskPriority, TaskStatus};

impl App {
    pub(super) fn tasks_command(&mut self, input: &str) {
        let parts: Vec<&str> = input.split_whitespace().collect();
        let sub = parts.get(1).copied().unwrap_or("list");

        match sub {
            "list" => self.show_tasks_list(),
            "add" => {
                let description = input
                    .split_whitespace()
                    .skip(2)
                    .collect::<Vec<_>>()
                    .join(" ");
                if description.trim().is_empty() {
                    self.pending_task_action = None;
                    self.pending_task_edit_id = None;
                    self.input_mode = InputMode::TaskInput;
                    self.push_system_message("请输入新任务描述，按 Enter 保存。")
                } else {
                    self.create_task(&description);
                }
            }
            "show" => self.handle_task_action_arg(parts.get(2).copied(), TaskAction::Show),
            "edit" => {
                let edit_text = input
                    .split_whitespace()
                    .skip(3)
                    .collect::<Vec<_>>()
                    .join(" ");
                if let Some(id_text) = parts.get(2).copied() {
                    match id_text.parse::<u64>() {
                        Ok(id) if !edit_text.trim().is_empty() => self.edit_task(id, &edit_text),
                        Ok(id) => {
                            self.pending_task_action = Some(TaskAction::Edit);
                            self.pending_task_edit_id = Some(id);
                            self.input_mode = InputMode::TaskInput;
                            self.push_system_message(&format!(
                                "请输入任务 #{} 的新描述，按 Enter 保存。",
                                id
                            ));
                        }
                        Err(_) => self.push_error_message("任务 ID 必须是数字。"),
                    }
                } else {
                    self.open_task_selector(TaskAction::Edit);
                }
            }
            "start" => self.handle_task_action_arg(parts.get(2).copied(), TaskAction::Start),
            "done" => self.handle_task_action_arg(parts.get(2).copied(), TaskAction::Done),
            "cancel" => self.handle_task_action_arg(parts.get(2).copied(), TaskAction::Cancel),
            "clear" => self.clear_completed_tasks(),
            "export" => self.export_tasks(),
            _ => self.push_system_message(
                "用法: /tasks list|add|show|edit|start|done|cancel|clear|export",
            ),
        }
    }

    pub(super) fn show_tasks_list(&mut self) {
        match self.task_store.list() {
            Ok(tasks) => {
                self.task_options = tasks.clone();
                self.selected_task_index = 0;
                if tasks.is_empty() {
                    self.push_system_message(
                        "当前没有持久化任务。使用 /tasks add <desc> 创建新任务。",
                    );
                    return;
                }

                let mut lines = vec![format!("任务列表 ({})", self.task_store.path().display())];
                for task in tasks {
                    lines.push(format!(
                        "[{}] {:<11} {:<6} {}",
                        task.id,
                        task.status.label(),
                        task.priority.label(),
                        task.description,
                    ));
                }
                self.push_system_message(&lines.join("\n"));
            }
            Err(error) => self.push_error_message(&format!("读取任务失败: {}", error)),
        }
    }

    pub(super) fn create_task(&mut self, description: &str) {
        match self.task_store.add(description, TaskPriority::Medium) {
            Ok(task) => {
                self.push_success_message(&format!(
                    "已创建任务 #{}: {}",
                    task.id, task.description
                ));
                self.refresh_task_options();
            }
            Err(error) => self.push_error_message(&format!("创建任务失败: {}", error)),
        }
    }

    pub(super) fn edit_task(&mut self, id: u64, description: &str) {
        match self.task_store.update_description(id, description) {
            Ok(task) => {
                self.push_success_message(&format!(
                    "已更新任务 #{}: {}",
                    task.id, task.description
                ));
                self.refresh_task_options();
            }
            Err(error) => self.push_error_message(&format!("更新任务失败: {}", error)),
        }
    }

    pub(super) fn show_task_detail(&mut self, id: u64) {
        match self.task_store.get(id) {
            Ok(Some(task)) => {
                let detail = format!(
                    "任务 #{}\n描述: {}\n状态: {}\n优先级: {}\n创建时间: {}\n更新时间: {}\n完成时间: {}\n标签: {}\n备注: {}",
                    task.id,
                    task.description,
                    task.status.label(),
                    task.priority.label(),
                    task.created_at,
                    task.updated_at,
                    task.completed_at.as_deref().unwrap_or("-"),
                    if task.tags.is_empty() { "-".to_string() } else { task.tags.join(", ") },
                    task.notes.unwrap_or_else(|| "-".to_string()),
                );
                self.push_system_message(&detail);
            }
            Ok(None) => self.push_error_message(&format!("任务不存在: {}", id)),
            Err(error) => self.push_error_message(&format!("读取任务失败: {}", error)),
        }
    }

    pub(super) fn set_task_status(&mut self, id: u64, status: TaskStatus) {
        match self.task_store.set_status(id, status) {
            Ok(task) => {
                self.push_success_message(&format!(
                    "任务 #{} 已更新为 {}: {}",
                    task.id,
                    task.status.label(),
                    task.description,
                ));
                self.refresh_task_options();
            }
            Err(error) => self.push_error_message(&format!("更新任务状态失败: {}", error)),
        }
    }

    pub(super) fn clear_completed_tasks(&mut self) {
        match self.task_store.clear_completed() {
            Ok(count) => {
                self.refresh_task_options();
                self.push_success_message(&format!("已清理 {} 个已完成任务。", count));
            }
            Err(error) => self.push_error_message(&format!("清理任务失败: {}", error)),
        }
    }

    pub(super) fn export_tasks(&mut self) {
        match self.task_store.export_markdown() {
            Ok(output) => self.push_system_message(&output),
            Err(error) => self.push_error_message(&format!("导出任务失败: {}", error)),
        }
    }

    pub(super) fn handle_task_action_arg(&mut self, id_text: Option<&str>, action: TaskAction) {
        if let Some(id_text) = id_text {
            match id_text.parse::<u64>() {
                Ok(id) => self.execute_task_action(action, id),
                Err(_) => self.push_error_message("任务 ID 必须是数字。"),
            }
        } else {
            self.open_task_selector(action);
        }
    }

    pub(super) fn execute_task_action(&mut self, action: TaskAction, id: u64) {
        match action {
            TaskAction::Show => self.show_task_detail(id),
            TaskAction::Edit => {
                self.pending_task_action = Some(TaskAction::Edit);
                self.pending_task_edit_id = Some(id);
                self.input_mode = InputMode::TaskInput;
                self.push_system_message(&format!("请输入任务 #{} 的新描述，按 Enter 保存。", id));
            }
            TaskAction::Start => self.set_task_status(id, TaskStatus::InProgress),
            TaskAction::Done => self.set_task_status(id, TaskStatus::Completed),
            TaskAction::Cancel => self.set_task_status(id, TaskStatus::Cancelled),
        }
    }

    pub(super) fn open_task_selector(&mut self, action: TaskAction) {
        match self.task_store.list() {
            Ok(tasks) => {
                if tasks.is_empty() {
                    self.push_system_message("当前没有可选择的任务。先使用 /tasks add 创建任务。");
                    return;
                }
                self.task_options = tasks;
                self.selected_task_index = 0;
                self.pending_task_action = Some(action);
                self.pending_task_edit_id = None;
                self.input_mode = InputMode::TasksSelect;
                self.push_system_message(
                    "已打开任务列表，使用上下方向键选择，Enter 确认，Esc 取消。",
                );
            }
            Err(error) => self.push_error_message(&format!("读取任务失败: {}", error)),
        }
    }

    pub(super) fn confirm_task_selection(&mut self) {
        let selected = self.task_options.get(self.selected_task_index).cloned();
        self.input_mode = InputMode::Chat;
        if let (Some(task), Some(action)) = (selected, self.pending_task_action.take()) {
            self.execute_task_action(action, task.id);
        }
    }

    pub(super) fn finish_task_input(&mut self) {
        let content = self.input.trim().to_string();
        self.input.clear();
        self.input_mode = InputMode::Chat;

        if content.is_empty() {
            self.push_system_message("任务描述不能为空。已取消输入。");
            self.pending_task_action = None;
            self.pending_task_edit_id = None;
            return;
        }

        match self.pending_task_action.take() {
            Some(TaskAction::Edit) => {
                if let Some(id) = self.pending_task_edit_id.take() {
                    self.edit_task(id, &content);
                }
            }
            _ => {
                self.pending_task_edit_id = None;
                self.create_task(&content);
            }
        }
    }

    pub(super) fn refresh_task_options(&mut self) {
        if let Ok(tasks) = self.task_store.list() {
            self.task_options = tasks;
            if self.selected_task_index >= self.task_options.len() {
                self.selected_task_index = self.task_options.len().saturating_sub(1);
            }
        }
        self.refresh_git_changes();
    }
}
