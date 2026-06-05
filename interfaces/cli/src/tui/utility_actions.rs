use super::{block_on_cli_future, App, MessageRole, ThemePalette};
use crate::cmd::{
    diff, doctor, hooks, ide, insight, keybindings, memory, outstyle, prompt, status, vim, wiki,
};

impl App {
    pub(super) fn help_command(&mut self) {
        self.push_system_message(
            "SaCode 帮助:\n\
            \n一级命令:\n\
            /init      - 轻量初始化项目配置\n\
            /init-deep - 深度初始化项目配置\n\
            /new       - 创建新会话\n\
            /sessions  - 切换历史会话\n\
            /clear     - 清空当前上下文\n\
            /compress  - 压缩当前会话上下文\n\
            /profile   - 配置管理 (ls/use/show)\n\
            /plugin    - 插件管理 (list/install/remove/enable/disable)\n\
            /checkpoint - 检查点管理 (list/save/restore/delete)\n\
            /mode      - 执行模式 (plan/build/yolo)\n\
            /skills    - Skills 管理 (list/show/run/add/remove)\n\
            /mcps      - MCP 管理 (list/show/remove)\n\
            /providers - 管理 Provider\n\
            /models    - 选择模型\n\
            /login     - 配置 Provider 登录\n\
            /connect   - 快速接入 Provider\n\
            /add-dir   - 添加项目可访问目录\n\
            /status    - 查看 MCP 与插件状态\n\
            /doctor    - 诊断当前配置与可用性\n\
            /diff      - 查看当前 Git 差异摘要\n\
            /hooks     - 查看运行时 Hook 与生命周期\n\
            /ide       - 查看 IDE 接入向导或配置\n\
            /config    - 交互式管理分层配置\n\
            /keybindings - 查看快捷键说明\n\
            /outstyle  - 切换 AI 输出风格（默认用户级）\n\
            /vim       - 切换 Vim 风格导航\n\
            /memory    - 查看或管理分类项目记忆\n\
            /wiki      - 查看分层知识库加载状态\n\
            /insight   - 生成编程洞察\n\
            /tools     - 显示可用工具\n\
            /stats     - 查看 token 与费用统计\n\
            /copy last - 复制最后一条助手回复\n\
            /fold last - 折叠最后一条思考详情\n\
            /expand last - 展开最后一条思考详情\n\
            /fold all  - 折叠全部思考详情\n\
            /expand all - 展开全部思考详情\n\
            /theme     - 切换主题模板 (github/vscode/idea)\n\
            /todo      - 任务列表管理 (show/confirm/clear)\n\
            /answer    - 回答当前等待中的问题\n\
            /tasks     - 持久任务管理 (list/add/show/edit/start/done/cancel/clear/export)\n\
            /update    - 检查、更新或回滚当前 sacode 版本\n\
            /cancel    - 取消当前任务或清空等待队列\n\
            /help      - 显示帮助\n\
            /quit      - 退出\n\
            /exit      - 退出\n\
            \n快捷键:\n\
            Ctrl+Q - 等价于 /quit\n\
            Ctrl+A - 优化当前输入\n\
            Ctrl+S - 折叠或展开全部思考详情\n\
            Ctrl+T - 开启或关闭思考功能\n\
            Alt+M - 在 plan/build/yolo 间切换执行模式\n\
            Ctrl+Z - 撤回上次输入优化\n\
            Esc    - 取消当前任务或取消选择\n\
            上下键  - 浏览已发送输入历史\n\
            输入 /  - 显示命令列表",
        );
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
