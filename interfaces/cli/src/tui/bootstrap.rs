use std::{collections::HashSet, env, path::PathBuf, sync::mpsc};

use ratatui::layout::Rect;
use sacode_kernel::ExecutionMode;
use sacode_runtime::ProjectAccessConfigStore;

use crate::cmd::config;
use crate::provider_config::{ProviderConfigStore, SaCodeConfigStore};
use crate::provider_runtime::resolve_named_provider;
use crate::task_store::TaskStore;

use super::{
    get_level1_commands, App, InputMode, InteractionSession,
    PerformanceStats, PromptTemplate, QueueState, ThemePalette, UsageStats,
};

impl App {
    pub(super) fn new() -> Self {
        let now = chrono::Local::now();
        let workdir = env::current_dir().unwrap_or_else(|_| ".".into());
        let provider_store = ProviderConfigStore::new(&workdir);
        let sacode_store = SaCodeConfigStore::new(&workdir);
        let access_store = ProjectAccessConfigStore::new(&workdir);
        let task_store = TaskStore::new(&workdir);
        let current_provider = resolve_named_provider(&workdir);
        let log_path = user_sacode_dir().join("logs/tui.log");
        let (task_tx, task_rx) = mpsc::channel();
        let level1_commands = get_level1_commands();
        let session_id = format!("session-{}", now.format("%Y%m%d%H%M%S"));
        let prompt_template = user_prompt_template();

        let default_execution_mode = config::effective_config(&workdir)
            .map(|cfg| match cfg.execution_mode.as_str() {
                "plan" => ExecutionMode::Plan,
                "build" => ExecutionMode::Build,
                _ => ExecutionMode::Yolo,
            })
            .unwrap_or(ExecutionMode::Yolo);

        let mut app = Self {
            workdir,
            messages: Vec::new(),
            message_lines_cache: None,
            input_layout_cache: None,
            session_summary: None,
            input: String::new(),
            should_quit: false,
            scroll_offset: 0,
            follow_bottom: true,
            queue: QueueState::default(),
            input_mode: InputMode::Chat,
            provider_store,
            sacode_store,
            access_store,
            current_provider,
            pending_base_url: None,
            pending_provider_name: None,
            provider_options: Vec::new(),
            selected_provider_index: 0,
            model_options: Vec::new(),
            selected_model_index: 0,
            theme_options: vec!["github".to_string(), "vscode".to_string(), "idea".to_string()],
            selected_theme_index: 0,
            connect_options: vec![
                ("ollama".to_string(), "http://127.0.0.1:11434/v1".to_string(), false),
                ("deepseek".to_string(), "https://api.deepseek.com/v1".to_string(), true),
                ("mimo".to_string(), "https://token-plan-cn.xiaomimimo.com/v1".to_string(), true),
                ("longcat".to_string(), "https://api.longcat.chat/openai/v1".to_string(), true),
                ("openai".to_string(), "https://api.openai.com/v1".to_string(), true),
            ],
            selected_connect_index: 0,
            pending_connect_provider: None,
            task_tx,
            task_rx,
            execution_mode: default_execution_mode,
            level1_commands,
            filtered_level1: Vec::new(),
            selected_level1_index: 0,
            current_level1: None,
            filtered_sub_commands: Vec::new(),
            selected_sub_index: 0,
            skills_options: Vec::new(),
            selected_skills_index: 0,
            pending_skill_action: None,
            mcp_options: Vec::new(),
            selected_mcp_index: 0,
            pending_mcp_action: None,
            task_store,
            task_options: Vec::new(),
            selected_task_index: 0,
            pending_task_action: None,
            pending_task_edit_id: None,
            checkpoint_options: Vec::new(),
            selected_checkpoint_index: 0,
            pending_checkpoint_action: None,
            mode_options: vec!["plan".to_string(), "build".to_string(), "yolo".to_string()],
            selected_mode_index: match default_execution_mode {
                ExecutionMode::Plan => 0,
                ExecutionMode::Build => 1,
                ExecutionMode::Yolo => 2,
            },
            next_task_id: 1,
            active_task_started_at: None,
            canceled_task_ids: HashSet::new(),
            todo_plan: None,
            sent_history: Vec::new(),
            history_index: None,
            current_history_draft: String::new(),
            session_id,
            session_options: Vec::new(),
            selected_session_index: 0,
            prompt_template,
            last_input_optimization: None,
            pending_input_optimization: None,
            usage_stats: UsageStats::default(),
            perf_stats: PerformanceStats::default(),
            theme: ThemePalette::github(),
            config_scope: config::ConfigScope::Project,
            config_items: Vec::new(),
            selected_config_index: 0,
            config_enum_options: Vec::new(),
            selected_config_enum_index: 0,
            pending_config_key: None,
            interaction: InteractionSession::default(),
            session_auto_approve_edits: false,
            spinner_index: 0,
            log_path,
            git_changes: Vec::new(),
            orchestration_summary: None,
            message_viewport: Rect::default(),
            input_viewport: Rect::default(),
        };

        app.load_latest_session();
        app.refresh_git_changes();
        app.ensure_default_context7();
        app.spawn_version_check();
        app
    }
}

pub(super) fn user_sacode_dir() -> PathBuf {
    env::var_os("HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("."))
        .join(".sacode")
}

pub(super) fn encode_ppm(rgba_bytes: &[u8], width: usize, height: usize) -> Vec<u8> {
    let mut output = format!("P6\n{} {}\n255\n", width, height).into_bytes();
    for chunk in rgba_bytes.chunks(4) {
        if chunk.len() >= 3 {
            output.extend_from_slice(&chunk[..3]);
        }
    }
    output
}

fn user_prompt_template() -> PromptTemplate {
    PromptTemplate {
        optimize_input: "请将下面这段用户输入整理为更清晰、更可执行的编程任务描述，保留原始意图，直接输出改写后的任务文本：".to_string(),
    }
}
