use crate::cmd::config;
use sacode_kernel::ExecutionMode;

use super::{App, InputMode, LoopState};

impl App {
    pub(super) fn loop_command(&mut self, input: &str) {
        let task = input.trim_start_matches("/loop").trim();
        if task.is_empty() {
            self.push_system_message("用法: /loop <任务描述>");
            return;
        }
        self.push_system_message(&format!(
            "已开始循环执行任务。每轮完成后会自动继续，直到你取消、任务失败，或任务进入等待用户状态：{}",
            task
        ));
        self.enqueue_or_start_message_with_approval_and_loop(
            format!(
                "循环执行下面的任务，持续检查结果并修复问题，直到任务达到可用完成态：{}",
                task
            ),
            self.current_task_approval_policy(),
            Some(LoopState {
                task: task.to_string(),
                iteration: 1,
                max_iterations: 10,
                error_count: 0,
            }),
        );
    }

    pub(super) fn confirm_mode_selection(&mut self) {
        let mode_name = self.mode_options.get(self.selected_mode_index).cloned();
        if let Some(name) = mode_name {
            self.input_mode = InputMode::Chat;
            self.apply_execution_mode(&name, true);
        }
    }

    pub(super) fn mode_command(&mut self, input: &str) {
        let parts: Vec<&str> = input.split_whitespace().collect();
        let sub = parts.get(1).copied().unwrap_or("");

        match sub {
            "plan" => self.apply_execution_mode("plan", true),
            "build" => self.apply_execution_mode("build", true),
            "yolo" => self.apply_execution_mode("yolo", true),
            "" => self.open_mode_selector(),
            _ => self.push_system_message("用法: /mode plan|build|yolo"),
        }
    }

    pub(super) fn apply_execution_mode(&mut self, mode_name: &str, persist: bool) {
        let (mode, selected_index, message) = match mode_name {
            "plan" => (
                ExecutionMode::Plan,
                0,
                "执行模式已切换为 Plan（规划模式）。\nAI 将先规划步骤，再等待确认执行。",
            ),
            "build" => (
                ExecutionMode::Build,
                1,
                "执行模式已切换为 Build（构建模式）。\nAI 将直接执行任务。",
            ),
            _ => (
                ExecutionMode::Yolo,
                2,
                "执行模式已切换为 Yolo（自动执行模式）。\nAI 将自动执行，减少确认步骤。",
            ),
        };

        self.execution_mode = mode;
        self.selected_mode_index = selected_index;
        self.input_mode = InputMode::Chat;

        if persist {
            if let Err(error) = config::set_value(
                &self.workdir,
                config::ConfigScope::User,
                "execution_mode",
                mode_name,
            ) {
                self.push_error_message(&format!("保存默认执行模式失败: {}", error));
            }
        }

        self.push_system_message(message);
    }

    pub(super) fn open_mode_selector(&mut self) {
        let current_mode = match self.execution_mode {
            ExecutionMode::Plan => 0,
            ExecutionMode::Build => 1,
            ExecutionMode::Yolo => 2,
        };
        self.selected_mode_index = current_mode;
        self.input_mode = InputMode::ModeSelect;
        self.push_system_message("已打开模式选择器，使用上下键选择，Enter 切换，Esc 取消。");
    }
}
