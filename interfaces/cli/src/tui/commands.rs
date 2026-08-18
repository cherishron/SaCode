#[derive(Clone)]
pub(super) struct CommandDef {
    pub(super) name: String,
    pub(super) description: String,
    pub(super) sub_commands: Vec<SubCommandDef>,
    pub(super) direct_execute: bool,
}

#[derive(Clone)]
pub(super) struct SubCommandDef {
    pub(super) name: String,
    pub(super) description: String,
    pub(super) needs_input: bool,
}

impl CommandDef {
    fn simple(name: &str, description: &str) -> Self {
        Self {
            name: name.to_string(),
            description: description.to_string(),
            sub_commands: Vec::new(),
            direct_execute: true,
        }
    }

    fn with_subs(name: &str, description: &str, subs: Vec<SubCommandDef>) -> Self {
        Self {
            name: name.to_string(),
            description: description.to_string(),
            sub_commands: subs,
            direct_execute: false,
        }
    }
}

impl SubCommandDef {
    fn new(name: &str, description: &str) -> Self {
        Self {
            name: name.to_string(),
            description: description.to_string(),
            needs_input: false,
        }
    }

    fn with_input(name: &str, description: &str) -> Self {
        Self {
            name: name.to_string(),
            description: description.to_string(),
            needs_input: true,
        }
    }
}

pub(super) fn get_level1_commands() -> Vec<CommandDef> {
    vec![
        CommandDef::simple("/init", "轻量初始化项目配置"),
        CommandDef::simple("/init-deep", "深度初始化项目配置"),
        CommandDef::simple("/new", "创建新会话"),
        CommandDef::simple("/sessions", "切换历史会话"),
        CommandDef::simple("/clear", "清空当前上下文"),
        CommandDef::simple("/compress", "压缩当前会话上下文"),
        CommandDef::with_subs(
            "/profile",
            "配置管理",
            vec![
                SubCommandDef::new("ls", "列出所有配置"),
                SubCommandDef::new("use", "切换当前配置"),
                SubCommandDef::new("show", "显示当前配置详情"),
            ],
        ),
        CommandDef::with_subs(
            "/plugin",
            "插件管理",
            vec![
                SubCommandDef::new("list", "列出已安装插件"),
                SubCommandDef::new("install", "安装插件"),
                SubCommandDef::new("remove", "删除插件"),
                SubCommandDef::new("enable", "启用插件"),
                SubCommandDef::new("disable", "禁用插件"),
            ],
        ),
        CommandDef::with_subs(
            "/checkpoint",
            "检查点管理",
            vec![
                SubCommandDef::new("list", "列出检查点"),
                SubCommandDef::with_input("save", "保存检查点"),
                SubCommandDef::new("restore", "恢复检查点"),
                SubCommandDef::new("delete", "删除检查点"),
            ],
        ),
        CommandDef::with_subs(
            "/mode",
            "执行模式",
            vec![
                SubCommandDef::new("plan", "规划模式"),
                SubCommandDef::new("build", "构建模式"),
                SubCommandDef::new("auto", "自动执行模式"),
            ],
        ),
        CommandDef::with_subs(
            "/skills",
            "Skills 管理",
            vec![
                SubCommandDef::new("list", "列出可用 Skills"),
                SubCommandDef::with_input("show", "查看 Skill 详情"),
                SubCommandDef::with_input("run", "运行 Skill"),
                SubCommandDef::with_input("add", "添加 Skill"),
                SubCommandDef::with_input("remove", "删除 Skill"),
            ],
        ),
        CommandDef::with_subs(
            "/mcps",
            "MCP 管理",
            vec![
                SubCommandDef::new("list", "列出 MCP 服务"),
                SubCommandDef::with_input("show", "查看 MCP 详情"),
                SubCommandDef::with_input("remove", "删除 MCP 服务"),
            ],
        ),
        CommandDef::simple("/providers", "管理 Provider"),
        CommandDef::simple("/models", "选择模型"),
        CommandDef::simple("/login", "配置 Provider 登录"),
        CommandDef::simple("/connect", "快速接入 Provider"),
        CommandDef::simple("/add-dir", "添加项目可访问目录"),
        CommandDef::simple("/status", "查看 MCP 与插件状态"),
        CommandDef::simple("/doctor", "诊断当前配置与可用性"),
        CommandDef::simple("/prompt", "查看提示词链路与诊断"),
        CommandDef::simple("/diff", "查看当前 Git 差异摘要"),
        CommandDef::simple("/hooks", "查看运行时 Hook 与生命周期"),
        CommandDef::simple("/ide", "查看 IDE 接入向导或配置"),
        CommandDef::simple("/config", "交互式管理用户级与项目级配置"),
        CommandDef::simple("/keybindings", "查看快捷键说明"),
        CommandDef::simple("/outstyle", "切换 AI 输出风格（默认用户级）"),
        CommandDef::simple("/vim", "切换 Vim 风格导航"),
        CommandDef::simple("/memory", "查看或管理分类项目记忆"),
        CommandDef::simple("/wiki", "查看分层知识库加载状态"),
        CommandDef::simple("/insight", "生成并打开用户级 insight 网页报告"),
        CommandDef::simple("/tools", "显示可用工具"),
        CommandDef::simple("/stats", "查看 token 与费用统计"),
        CommandDef::simple("/theme", "切换主题模板"),
        CommandDef::simple("/agents", "查看内置角色或启动多角色编排"),
        CommandDef::simple("/loop", "循环执行任务直到完成"),
        CommandDef::with_subs(
            "/todo",
            "任务列表管理",
            vec![
                SubCommandDef::new("show", "显示当前待办"),
                SubCommandDef::new("confirm", "确认并执行待办"),
                SubCommandDef::new("clear", "清空待办"),
            ],
        ),
        CommandDef::with_subs(
            "/tasks",
            "持久任务管理",
            vec![
                SubCommandDef::new("list", "列出所有任务"),
                SubCommandDef::with_input("add", "添加新任务"),
                SubCommandDef::with_input("show", "查看任务详情"),
                SubCommandDef::with_input("edit", "编辑任务描述"),
                SubCommandDef::with_input("start", "开始执行任务"),
                SubCommandDef::with_input("done", "标记任务完成"),
                SubCommandDef::with_input("cancel", "取消任务"),
                SubCommandDef::new("clear", "清理已完成任务"),
                SubCommandDef::new("export", "导出任务列表"),
            ],
        ),
        CommandDef::simple("/cancel", "取消当前任务"),
        CommandDef::simple("/help", "显示帮助"),
        CommandDef::simple("/quit", "退出"),
        CommandDef::simple("/exit", "退出"),
    ]
}
