use super::{block_on_cli_future, App, MessageRole, ThemePalette};
use crate::cmd::{
    diff, doctor, hooks, ide, insight, keybindings, memory, outstyle, prompt, status, vim, wiki,
};

impl App {
    pub(super) fn help_command(&mut self) {
        let mode = match self.execution_mode {
            sacode_kernel::ExecutionMode::Plan => "plan",
            sacode_kernel::ExecutionMode::Build => "build",
            sacode_kernel::ExecutionMode::Yolo => "auto",
        };
        let msg = format!(
            "SaCode 帮助（当前模式: {}）\n\n            📌 一级命令（5 个常用入口）：\n            /login   - 配置 Provider 登录\n            /models  - 选择 AI 模型\n            /mode    - 切换执行模式（plan/build/auto）\n            /agents  - 多 Agent 编排\n            /help    - 显示帮助（支持 /help plan/build/auto）\n\n            📋 配置与初始化：\n            /init        /init-deep  /new  /sessions  /clear  /compress\n            /profile     /plugin     /checkpoint /config  /keybindings\n            /add-dir     /status     /doctor    /outstyle /vim /theme\n\n            📦 技能与扩展：\n            /skills      /mcps       /providers /connect /models\n\n            🧠 知识与记忆：\n            /memory      /wiki       /insight   /tools /prompt\n\n            ✏️  代码与 Git：\n            /diff        /hooks      /ide       /goal\n\n            📊 任务与工作流：\n            /todo        /tasks      /answer    /stats  /cancel\n\n            🔧 视图控制：\n            /copy last   /fold last  /expand last /fold all /expand all\n\n            ⚙️  系统：\n            /update      /quit  /exit\n\n            ⌨️  快捷键：\n            Ctrl+Q - 退出   Ctrl+A - 优化输入   Ctrl+S - 折叠/展开\n            Ctrl+T - 思考开关   Alt+M - 模式切换   Ctrl+Z - 撤回优化\n            Esc - 取消   上下键 - 历史   / - 命令列表",
            mode,
        );
        self.push_system_message(&msg);
    }

    pub(super) fn show_usage_stats(&mut self) {
        let mut lines = vec![
            "Token 与费用统计".to_string(),
            "".to_string(),
            format!(
                "{:<28} {:>6} {:>12} {:>12} {:>12} {:>12}",
                "模型", "请求", "输入", "输出", "总 Token", "费用(USD)"
            ),
            format!(
                "{:-<28} {:-<6} {:-<12} {:-<12} {:-<12} {:-<12}",
                "", "", "", "", "", ""
            ),
        ];

        for (model_name, stats) in &self.usage_stats.models {
            lines.push(format!(
                "{:<28} {:>6} {:>12} {:>12} {:>12} {:>12.6}",
                truncate_label(model_name, 28),
                stats.requests,
                stats.prompt_tokens,
                stats.completion_tokens,
                stats.total_tokens,
                stats.estimated_cost_usd,
            ));
        }

        if self.usage_stats.models.is_empty() {
            lines.push("暂无模型调用记录".to_string());
        } else {
            lines.push(format!(
                "{:=<28} {:=<6} {:=<12} {:=<12} {:=<12} {:=<12}",
                "", "", "", "", "", ""
            ));
            lines.push(format!(
                "{:<28} {:>6} {:>12} {:>12} {:>12} {:>12.6}",
                "总计",
                self.usage_stats.requests,
                self.usage_stats.prompt_tokens,
                self.usage_stats.completion_tokens,
                self.usage_stats.total_tokens,
                self.usage_stats.estimated_cost_usd,
            ));
        }

        self.push_system_message(&lines.join("\n"));
    }

    pub(super) fn ensure_default_context7(&mut self) {
        match block_on_cli_future(status::ensure_default_context7(&self.workdir)) {
            Ok(true) => self.push_system_message("已默认安装 Context7 MCP [official remote]。"),
            Ok(false) => {}
            Err(error) => self.push_error_message(&format!("默认安装 Context7 失败: {}", error)),
        }
    }

    pub(super) fn status_command(&mut self) {
        match block_on_cli_future(status::render_status(&self.workdir)) {
            Ok(output) => self.push_system_message(&output),
            Err(error) => self.push_error_message(&format!("读取状态失败: {}", error)),
        }
    }

    pub(super) fn doctor_command(&mut self) {
        match block_on_cli_future(doctor::render_doctor(&self.workdir)) {
            Ok(output) => self.push_system_message(&output),
            Err(error) => self.push_error_message(&format!("诊断失败: {}", error)),
        }
    }

    pub(super) fn diff_command(&mut self, input: &str) {
        let args = input
            .split_whitespace()
            .skip(1)
            .map(|value| value.to_string())
            .collect::<Vec<_>>();
        match diff::render_diff(args) {
            Ok(output) => self.push_system_message(&output),
            Err(error) => self.push_error_message(&format!("读取 diff 失败: {}", error)),
        }
    }

    pub(super) fn hooks_command(&mut self) {
        self.push_system_message(&hooks::render_hooks());
    }

    pub(super) fn memory_command(&mut self, input: &str) {
        let args = input
            .split_whitespace()
            .skip(1)
            .map(|value| value.to_string())
            .collect::<Vec<_>>();
        match memory::render_memory(&self.workdir, &args) {
            Ok(output) => self.push_system_message(&output),
            Err(error) => self.push_error_message(&format!("读取记忆失败: {}", error)),
        }
    }

    pub(super) fn wiki_command(&mut self, input: &str) {
        let args = input
            .split_whitespace()
            .skip(1)
            .map(|value| value.to_string())
            .collect::<Vec<_>>();
        match wiki::render_wiki(&self.workdir, &args) {
            Ok(output) => self.push_system_message(&output),
            Err(error) => self.push_error_message(&format!("读取 wiki 失败: {}", error)),
        }
    }

    pub(super) fn prompt_command(&mut self, input: &str) {
        let args = input
            .split_whitespace()
            .skip(1)
            .map(|value| value.to_string())
            .collect::<Vec<_>>();
        match prompt::render_prompt(&self.workdir, &args) {
            Ok(output) => self.push_system_message(&output),
            Err(error) => self.push_error_message(&format!("读取 prompt 失败: {}", error)),
        }
    }

    pub(super) fn insight_command(&mut self) {
        let messages: Vec<(String, String)> = self
            .messages
            .iter()
            .filter(|message| matches!(message.role, MessageRole::User | MessageRole::Assistant))
            .map(|message| {
                let role = match message.role {
                    MessageRole::User => "user",
                    MessageRole::Assistant => "assistant",
                    MessageRole::System => "system",
                };
                (role.to_string(), message.content.clone())
            })
            .collect();

        if messages.is_empty() {
            self.push_system_message("当前会话没有对话记录，请先发送一些消息再生成洞察。");
            return;
        }

        let messages_ref: Vec<(&str, &str)> = messages
            .iter()
            .map(|(role, content)| (role.as_str(), content.as_str()))
            .collect();

        self.push_system_message(&format!(
            "正在分析 {} 条消息并生成用户级 insight 网页报告...",
            messages.len()
        ));

        match insight::analyze_messages(&messages_ref, &self.workdir) {
            Ok(insight_report) => {
                self.push_system_message(&insight::render_success_message(&insight_report));
            }
            Err(error) => {
                self.push_error_message(&format!("生成洞察失败: {}", error));
            }
        }
    }

    pub(super) fn ide_command(&mut self, input: &str) {
        let args = input
            .split_whitespace()
            .skip(1)
            .map(|value| value.to_string())
            .collect::<Vec<_>>();
        match ide::render_ide(&self.workdir, &args) {
            Ok(output) => self.push_system_message(&output),
            Err(error) => self.push_error_message(&format!("读取 IDE 配置失败: {}", error)),
        }
    }

    pub(super) fn outstyle_command(&mut self, input: &str) {
        let args = input
            .split_whitespace()
            .skip(1)
            .map(|value| value.to_string())
            .collect::<Vec<_>>();
        match outstyle::render_outstyle(&self.workdir, &args) {
            Ok(output) => self.push_system_message(&output),
            Err(error) => self.push_error_message(&format!("设置输出风格失败: {}", error)),
        }
    }

    pub(super) fn keybindings_command(&mut self) {
        match keybindings::render_keybindings(&self.workdir) {
            Ok(output) => self.push_system_message(&output),
            Err(error) => self.push_error_message(&format!("读取快捷键失败: {}", error)),
        }
    }

    pub(super) fn vim_command(&mut self, input: &str) {
        let args = input
            .split_whitespace()
            .skip(1)
            .map(|value| value.to_string())
            .collect::<Vec<_>>();
        match vim::render_vim(&self.workdir, &args) {
            Ok(output) => self.push_system_message(&output),
            Err(error) => self.push_error_message(&format!("设置 Vim 模式失败: {}", error)),
        }
    }

    pub(super) fn add_dir_command(&mut self, input: &str) {
        let mut parts = input.split_whitespace();
        let _ = parts.next();
        let Some(raw_path) = parts.next() else {
            self.push_system_message("用法: /add-dir <绝对路径>");
            return;
        };

        match self.access_store.add_dir(std::path::Path::new(raw_path)) {
            Ok(path) => self.push_success_message(&format!(
                "已添加目录访问权限: {}\n后续当前项目可持续读取和修改该目录，配置保存在 .sacode/dirs.json。",
                path.display()
            )),
            Err(error) => self.push_error_message(&format!("添加目录失败: {}", error)),
        }
    }

    pub(super) fn theme_command(&mut self, input: &str) {
        let mut parts = input.split_whitespace();
        let _ = parts.next();
        let Some(theme_name) = parts.next() else {
            self.open_theme_selector();
            return;
        };

        self.apply_theme_by_name(theme_name);
    }

    pub(super) fn open_theme_selector(&mut self) {
        self.selected_theme_index = self
            .theme_options
            .iter()
            .position(|theme| theme.eq_ignore_ascii_case(self.theme.name))
            .unwrap_or(0);
        self.input_mode = super::InputMode::ThemeSelect;
        self.push_system_message("已打开主题选择器，使用上下方向键选择，回车确认，Esc 取消。");
    }

    pub(super) fn confirm_theme_selection(&mut self) {
        let Some(theme_name) = self.theme_options.get(self.selected_theme_index).cloned() else {
            self.input_mode = super::InputMode::Chat;
            self.push_system_message("当前没有可选主题。");
            return;
        };

        self.input_mode = super::InputMode::Chat;
        self.apply_theme_by_name(&theme_name);
    }

    pub(super) fn apply_theme_by_name(&mut self, theme_name: &str) {
        match ThemePalette::from_name(theme_name) {
            Some(theme) => {
                self.theme = theme;
                self.push_system_message(&format!("主题已切换为 {}。", self.theme.name));
            }
            None => {
                self.push_system_message(&format!(
                    "未知主题: {}\n可用主题: {}",
                    theme_name,
                    ThemePalette::names(),
                ));
            }
        }
    }
}

fn truncate_label(value: &str, max_chars: usize) -> String {
    let mut chars = value.chars();
    let preview: String = chars.by_ref().take(max_chars).collect();
    if chars.next().is_some() && max_chars > 1 {
        format!(
            "{}~",
            preview.chars().take(max_chars - 1).collect::<String>()
        )
    } else {
        preview
    }
}
