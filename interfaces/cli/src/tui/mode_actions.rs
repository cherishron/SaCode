use crate::cmd::config;
use sacode_kernel::{ExecutionMode, LoopState};
use sacode_runtime::RoleRegistry;

use super::{App, InputMode};

impl App {
    pub(super) fn agents_command(&mut self, input: &str) {
        let trimmed = input.trim();
        let parts: Vec<&str> = trimmed.split_whitespace().collect();
        let sub = parts.get(1).copied().unwrap_or("");

        match sub {
            "" | "list" => {
                let registry = RoleRegistry::builtin();
                let mut lines = vec!["内置 Agents 角色:".to_string(), "".to_string()];
                for role in registry.all() {
                    lines.push(format!(
                        "- {} ({})",
                        role.id,
                        role.stage
                            .as_ref()
                            .map(|stage| format!("{:?}", stage))
                            .unwrap_or_else(|| "Unknown".to_string())
                    ));
                    lines.push(format!("  {}", role.system_prompt));
                }
                lines.push(String::new());
                lines.push("用法: /agents list | /agents run <任务描述>".to_string());
                self.push_system_message(&lines.join("\n"));
            }
            "run" => {
                let task = trimmed.strip_prefix("/agents run").unwrap_or("").trim();
                if task.is_empty() {
                    self.push_system_message("用法: /agents run <任务描述>");
                    return;
                }

                self.push_system_message(&format!(
                    "已启动多角色编排执行。系统将按内置角色自动规划并协作完成任务：{}",
                    task
                ));
                self.enqueue_or_start_orchestrator_message(
                    format!("ULW[agents=tui] {}", task),
                    self.current_task_approval_policy(),
                );
            }
            _ => self.push_system_message("用法: /agents list|run <任务描述>"),
        }
    }

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
        let loop_max_iterations = config::effective_config(&self.workdir)
            .map(|cfg| cfg.loop_max_iterations)
            .unwrap_or(10) as u32;
        self.enqueue_or_start_message_with_approval_and_loop(
            format!(
                "循环执行下面的任务，持续检查结果并修复问题，直到任务达到可用完成态：{}",
                task
            ),
            self.current_task_approval_policy(),
            Some(LoopState {
                task: task.to_string(),
                iteration: 1,
                max_iterations: loop_max_iterations.max(1),
                error_count: 0,
                last_summary: String::new(),
                plan: None,
                current_phase_index: 0,
                last_phase_result: None,
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
            "auto" | "yolo" => self.apply_execution_mode("auto", true),
            "" => self.open_mode_selector(),
            _ => self.push_system_message("用法: /mode plan|build|auto"),
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
                "执行模式已切换为 Auto（自动执行模式）。\nAI 将自动执行，减少确认步骤。",
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn agents_command_lists_builtin_roles() {
        let mut app = App::new();
        app.agents_command("/agents");

        let last = app.messages.last().expect("agents list message");
        assert!(last.content.contains("内置 Agents 角色"));
        assert!(last.content.contains("implementer"));
        assert!(last.content.contains("code-reviewer"));
    }
}
