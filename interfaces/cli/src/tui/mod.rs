use std::{
    collections::{BTreeMap, HashMap, HashSet},
    path::PathBuf,
    sync::mpsc::{Receiver, Sender},
};

use ratatui::{layout::Rect, text::Line};
use sacode_kernel::ExecutionMode;
use serde::{Deserialize, Serialize};

use crate::agent_harness;
use crate::cmd::{config, init::InitMode, ApprovalPolicy};
use crate::provider_config::{NamedProviderConfig, ProviderConfigStore, SaCodeConfigStore};
use crate::provider_runtime::resolve_provider;
use crate::task_store::{PersistentTask, TaskStore};
use crate::version_check::update_prompt;
use sacode_runtime::ProjectAccessConfigStore;

mod app_helpers;
mod async_actions;
mod async_types;
mod bootstrap;
mod checkpoint_actions;
mod command_palette;
mod commands;
mod config_actions;
mod event_loop;
mod formatting;
mod git_state;
mod input;
mod input_optimization;
mod interaction;
mod interaction_state;
mod key_handlers;
mod lifecycle_actions;
mod local_commands;
mod mcp_actions;
mod message_ops;
mod mode_actions;
mod mode_cancel;
mod orchestration_summary;
mod plugin_actions;
mod prompt_response;
mod provider_actions;
mod render;
mod runtime_support;
mod send_actions;
mod session_stats;
mod session_store;
mod skills_actions;
mod state;
mod task_actions;
mod task_runtime;
mod theme;
mod todo_actions;
mod tool_actions;
mod tui_entry;
mod utility_actions;

use async_types::{AsyncContext, AsyncResult};
use bootstrap::{encode_ppm, user_sacode_dir};
use commands::{get_level1_commands, CommandDef, SubCommandDef};
use formatting::{format_duration_ms, fuzzy_match};
use interaction::{InteractionSession, InteractionState};
use orchestration_summary::parse_orchestration_summary;
use render::relative_to_workdir;
pub(crate) use runtime_support::block_on_cli_future;
use state::{LoopState, QueueState};
use theme::ThemePalette;
pub use tui_entry::run_tui;

const SPINNER_FRAMES: [&str; 10] = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

#[derive(Debug, Clone)]
struct ModelOptionEntry {
    label: String,
    provider_name: String,
    model_name: String,
}

impl From<agent_harness::ModelOption> for ModelOptionEntry {
    fn from(value: agent_harness::ModelOption) -> Self {
        Self {
            label: format!("{} / {}", value.provider_name, value.model_name),
            provider_name: value.provider_name,
            model_name: value.model_name,
        }
    }
}

struct Message {
    role: MessageRole,
    content: String,
    thinking: String,
    timestamp: String,
    collapsed: bool,
}

#[derive(Debug, Clone)]
struct RenderedMessageLine {
    line: Line<'static>,
}

#[derive(Debug, Clone)]
struct CachedRenderedMessages {
    width: usize,
    lines: Vec<RenderedMessageLine>,
}

#[derive(Debug, Clone)]
struct CachedInputLayout {
    text: String,
    width: usize,
    lines: Vec<String>,
    cursor_line: usize,
    cursor_col: usize,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum MessageRole {
    User,
    Assistant,
    System,
}

struct App {
    workdir: PathBuf,
    messages: Vec<Message>,
    message_lines_cache: Option<CachedRenderedMessages>,
    input_layout_cache: Option<CachedInputLayout>,
    session_summary: Option<String>,
    input: String,
    input_scroll_offset: usize,
    input_scroll_follows_cursor: bool,
    should_quit: bool,
    scroll_offset: usize,
    follow_bottom: bool,
    queue: QueueState,
    input_mode: InputMode,
    provider_store: ProviderConfigStore,
    sacode_store: SaCodeConfigStore,
    access_store: ProjectAccessConfigStore,
    current_provider: Option<NamedProviderConfig>,
    pending_base_url: Option<String>,
    pending_provider_name: Option<String>,
    provider_options: Vec<String>,
    selected_provider_index: usize,
    model_options: Vec<ModelOptionEntry>,
    selected_model_index: usize,
    theme_options: Vec<String>,
    selected_theme_index: usize,
    connect_options: Vec<(String, String, bool)>,
    selected_connect_index: usize,
    pending_connect_provider: Option<(String, String)>,
    task_tx: Sender<AsyncResult>,
    task_rx: Receiver<AsyncResult>,
    execution_mode: ExecutionMode,
    level1_commands: Vec<CommandDef>,
    filtered_level1: Vec<CommandDef>,
    selected_level1_index: usize,
    current_level1: Option<CommandDef>,
    filtered_sub_commands: Vec<SubCommandDef>,
    selected_sub_index: usize,
    skills_options: Vec<(String, String)>,
    selected_skills_index: usize,
    pending_skill_action: Option<String>,
    mcp_options: Vec<(String, String, bool)>,
    selected_mcp_index: usize,
    pending_mcp_action: Option<String>,
    task_store: TaskStore,
    task_options: Vec<PersistentTask>,
    selected_task_index: usize,
    pending_task_action: Option<TaskAction>,
    pending_task_edit_id: Option<u64>,
    checkpoint_options: Vec<String>,
    selected_checkpoint_index: usize,
    pending_checkpoint_action: Option<String>,
    mode_options: Vec<String>,
    selected_mode_index: usize,
    next_task_id: u64,
    active_task_started_at: Option<chrono::DateTime<chrono::Local>>,
    canceled_task_ids: HashSet<u64>,
    task_message_indices: HashMap<u64, usize>,
    todo_plan: Option<TodoPlan>,
    sent_history: Vec<String>,
    history_index: Option<usize>,
    current_history_draft: String,
    session_id: String,
    session_options: Vec<SessionInfo>,
    selected_session_index: usize,
    prompt_template: PromptTemplate,
    last_input_optimization: Option<InputOptimizationSnapshot>,
    pending_input_optimization: Option<PendingInputOptimizationPreview>,
    usage_stats: UsageStats,
    perf_stats: PerformanceStats,
    theme: ThemePalette,
    config_scope: config::ConfigScope,
    config_items: Vec<ConfigEntry>,
    selected_config_index: usize,
    config_enum_options: Vec<(String, String)>,
    selected_config_enum_index: usize,
    pending_config_key: Option<String>,
    interaction: InteractionSession,
    session_auto_approve_edits: bool,
    spinner_index: usize,
    assistant_pending_thinking: bool,
    log_path: PathBuf,
    git_changes: Vec<String>,
    orchestration_summary: Option<String>,
    message_viewport: Rect,
    input_viewport: Rect,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum FoldAction {
    Collapse,
    Expand,
}

#[derive(Debug, Clone, Default)]
struct UsageStats {
    requests: u64,
    prompt_tokens: u64,
    completion_tokens: u64,
    total_tokens: u64,
    estimated_cost_usd: f64,
    models: BTreeMap<String, ModelUsageStats>,
}

#[derive(Debug, Clone, Default)]
struct ModelUsageStats {
    requests: u64,
    prompt_tokens: u64,
    completion_tokens: u64,
    total_tokens: u64,
    estimated_cost_usd: f64,
}

#[derive(Debug, Clone, Copy)]
struct PricingRule {
    input_per_million: f64,
    output_per_million: f64,
}

#[derive(Debug, Clone)]
struct PerformanceStats {
    session_started_at: chrono::DateTime<chrono::Local>,
    total_task_duration_ms: u64,
    api_duration_ms: u64,
    tool_duration_ms: u64,
}

impl Default for PerformanceStats {
    fn default() -> Self {
        Self {
            session_started_at: chrono::Local::now(),
            total_task_duration_ms: 0,
            api_duration_ms: 0,
            tool_duration_ms: 0,
        }
    }
}

#[derive(Debug, Clone)]
struct SessionInfo {
    id: String,
    updated_at: String,
    title: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct StoredMessage {
    role: String,
    content: String,
    #[serde(default)]
    thinking: String,
    timestamp: String,
    collapsed: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct StoredSessionSummary {
    content: String,
    compressed_at: String,
}

#[derive(Debug, Clone)]
struct PromptTemplate {
    optimize_input: String,
    compress_context: String,
}

#[derive(Debug, Clone)]
struct InputOptimizationSnapshot {
    original: String,
    optimized: String,
    model_name: String,
}

#[derive(Debug, Clone)]
struct PendingInputOptimizationPreview {
    original: String,
    optimized: String,
    model_name: String,
}

#[derive(Debug, Clone)]
struct TodoPlan {
    source_task: String,
    items: Vec<TodoItem>,
    confirmed: bool,
}

#[derive(Debug, Clone)]
struct TodoItem {
    id: usize,
    description: String,
    status: TodoStatus,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum TodoStatus {
    Pending,
    Running,
    Completed,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum InputMode {
    Chat,
    LoginBaseUrl,
    LoginApiKey,
    ProviderSelect,
    ProviderRename,
    ModelSelect,
    ThemeSelect,
    ConnectSelect,
    ConnectApiKey,
    CommandLevel1,
    CommandLevel2,
    SkillsSelect,
    McpSelect,
    TasksSelect,
    CheckpointSelect,
    TaskInput,
    ModeSelect,
    SessionSelect,
    InputOptimizePreview,
    TodoConfirm,
    PendingQuestion,
    ConfigSelect,
    ConfigEnumSelect,
    ConfigNumberInput,
}

#[derive(Debug, Clone)]
struct ConfigEntry {
    key: String,
    name: String,
    description: String,
    category: String,
    value: String,
    scope_value: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum TaskAction {
    Show,
    Start,
    Done,
    Cancel,
    Edit,
}

impl App {
    fn reset_orchestration_summary(&mut self) {
        self.orchestration_summary = None;
    }

    pub(super) fn is_messages_empty(&self) -> bool {
        self.messages.is_empty()
    }
}

#[cfg(test)]
mod tests {
    use super::render::modals::render_pending_question_panel;
    use super::render::orchestration_panel::render_orchestration_panel;
    use super::App;
    use crate::cmd::ApprovalPolicy;
    use crate::tui::async_types::StreamChunkKind;
    use crate::tui::interaction::{
        PendingApprovalRequest, PendingQuestionItem, PendingQuestionOption,
    };
    use crate::tui::render::{
        render_footer, render_header, render_input_panel, render_messages_panel,
    };
    use crate::tui::InteractionState;
    use ratatui::{backend::TestBackend, layout::Rect, Terminal};
    use sacode_kernel::ExecutionMode;
    use std::path::PathBuf;
    use tempfile::TempDir;

    struct HomeEnvGuard {
        old_home: Option<std::ffi::OsString>,
    }

    impl HomeEnvGuard {
        fn set(path: &std::path::Path) -> Self {
            let old_home = std::env::var_os("HOME");
            unsafe { std::env::set_var("HOME", path) };
            Self { old_home }
        }
    }

    impl Drop for HomeEnvGuard {
        fn drop(&mut self) {
            match self.old_home.take() {
                Some(value) => unsafe { std::env::set_var("HOME", value) },
                None => unsafe { std::env::remove_var("HOME") },
            }
        }
    }

    struct TestAppContext {
        _workdir: TempDir,
        _home_dir: TempDir,
        _home_guard: HomeEnvGuard,
        app: App,
    }

    impl TestAppContext {
        fn new() -> Self {
            let workdir = tempfile::tempdir().expect("create temp workdir");
            let home_dir = tempfile::tempdir().expect("create temp home");
            let home_guard = HomeEnvGuard::set(home_dir.path());
            let previous_dir = std::env::current_dir().expect("current dir");
            std::env::set_current_dir(workdir.path()).expect("enter temp workdir");
            let app = App::new();
            std::env::set_current_dir(previous_dir).expect("restore current dir");
            Self {
                _workdir: workdir,
                _home_dir: home_dir,
                _home_guard: home_guard,
                app,
            }
        }
    }

    fn test_app() -> TestAppContext {
        TestAppContext::new()
    }

    fn backend_text(terminal: &Terminal<TestBackend>) -> String {
        let buffer = terminal.backend().buffer();
        let mut lines = Vec::new();
        for y in 0..buffer.area.height {
            let mut line = String::new();
            for x in 0..buffer.area.width {
                line.push_str(buffer[(x, y)].symbol());
            }
            lines.push(line);
        }
        lines.join("\n")
    }

    #[test]
    fn format_orchestration_details_includes_all_sections() {
        let parsed = serde_json::json!({
            "summary_record": {
                "reporter_summary": "主裁决结论",
                "items": [
                    {
                        "role_id": "system-architect",
                        "route": "deepseek/deepseek-reasoner",
                        "output": "设计评估完成"
                    },
                    {
                        "role_id": "reporter",
                        "route": "deepseek/deepseek-reasoner",
                        "output": "汇总结论完成"
                    }
                ]
            },
            "orchestration_plan": {
                "roles": [
                    {
                        "role_id": "system-architect",
                        "preferred_model": "deepseek/deepseek-reasoner",
                        "needs_thinking": true
                    },
                    {
                        "role_id": "reporter",
                        "preferred_model": "deepseek/deepseek-reasoner",
                        "needs_thinking": true
                    }
                ]
            },
            "route_records": [
                {
                    "role_id": "system-architect",
                    "primary": {
                        "provider_name": "deepseek",
                        "model_name": "deepseek-reasoner",
                        "route_score": 65,
                        "needs_thinking": true
                    }
                }
            ],
            "conflict_records": [
                {
                    "kind": "validation_conflict",
                    "summary": "implementation completion conflicts with validation findings"
                }
            ]
        });

        let summary = App::format_orchestration_details(&parsed).expect("summary should exist");

        assert!(summary.contains("[主裁决摘要]"));
        assert!(summary.contains("- reporter: 主裁决结论"));
        assert!(summary.contains("[编排角色]"));
        assert!(summary.contains("[角色路由]"));
        assert!(summary.contains("[冲突]"));
        assert!(summary
            .contains("- [验证冲突] implementation completion conflicts with validation findings"));
        assert!(summary.contains("- system-architect [deepseek/deepseek-reasoner]: 设计评估完成"));
        assert!(summary.contains("- reporter [deepseek/deepseek-reasoner]: 汇总结论完成"));
    }

    #[test]
    fn merge_cli_response_prefers_provider_response_and_ignores_events_when_present() {
        let response = App::merge_cli_response(
            Some("event fallback".to_string()),
            Some("final answer".to_string()),
        );

        assert_eq!(response.as_deref(), Some("final answer"));
    }

    #[test]
    fn merge_cli_response_falls_back_to_events() {
        let response = App::merge_cli_response(Some("event fallback".to_string()), None);

        assert_eq!(response.as_deref(), Some("event fallback"));
    }

    #[test]
    fn reset_orchestration_summary_clears_previous_value() {
        let mut app = App::new();
        app.orchestration_summary = Some("old summary".to_string());

        app.reset_orchestration_summary();

        assert!(app.orchestration_summary.is_none());
    }

    #[test]
    fn render_orchestration_panel_renders_titles_and_content() {
        let mut app = App::new();
        app.orchestration_summary = Some(
            "[主裁决摘要]\n- reporter: reporter-summary\n- reporter [deepseek/deepseek-reasoner]: final-summary\n[编排角色]\n- system-architect: deepseek/deepseek-reasoner thinking=true\n[角色路由]\n- system-architect: deepseek/deepseek-reasoner score=65 thinking=true\n[冲突]\n- [验证冲突] implementation completion conflicts with validation findings".to_string(),
        );

        let backend = TestBackend::new(100, 22);
        let mut terminal = Terminal::new(backend).expect("terminal");
        terminal
            .draw(|frame| {
                render_orchestration_panel(frame, &app, Rect::new(0, 0, 100, 22));
            })
            .expect("draw panel");

        let rendered = backend_text(&terminal);

        assert!(rendered.contains("reporter-summary"));
        assert!(rendered.contains("final-summary"));
        assert!(rendered.contains("system-architect"));
        assert!(rendered.contains("deepseek/deepseek-reasoner"));
        assert!(rendered.contains("implementation completion conflicts with validation findings"));
    }

    #[test]
    fn render_orchestration_panel_routes_next_action_into_next_section() {
        let mut app = App::new();
        app.orchestration_summary = Some(
            "[主裁决摘要]\n- reporter: reporter-summary\n- overall: continue after validation\n- next: rerun tests after patching\n[角色路由]\n- reporter: deepseek/deepseek-reasoner score=80 thinking=true"
                .to_string(),
        );

        let backend = TestBackend::new(110, 22);
        let mut terminal = Terminal::new(backend).expect("terminal");
        terminal
            .draw(|frame| {
                render_orchestration_panel(frame, &app, Rect::new(0, 0, 110, 22));
            })
            .expect("draw panel");

        let rendered = backend_text(&terminal);
        assert!(rendered.contains("next"));
        assert!(rendered.contains("rerun tests after patching"));
        assert!(rendered.contains("overall"));
        assert!(rendered.contains("continue after validation"));
    }

    #[test]
    fn render_input_panel_renders_typed_content_and_updates_viewport() {
        let mut app = App::new();
        app.input = "hello world".to_string();
        let backend = TestBackend::new(100, 8);
        let mut terminal = Terminal::new(backend).expect("terminal");

        terminal
            .draw(|frame| {
                render_input_panel(frame, &mut app, Rect::new(0, 0, 100, 8), 96, true);
            })
            .expect("draw input panel");

        let rendered = backend_text(&terminal);
        assert!(rendered.contains("hello world"));
        assert!(rendered.contains("> "));
        assert!(app.input_viewport.width > 0);
        assert!(app.input_viewport.height > 0);
    }

    #[test]
    fn render_input_panel_keeps_cursor_near_latest_visible_lines() {
        let mut app = App::new();
        app.input = ["line 1", "line 2", "line 3", "line 4", "line 5", "line 6"].join("\n");
        let backend = TestBackend::new(60, 6);
        let mut terminal = Terminal::new(backend).expect("terminal");

        terminal
            .draw(|frame| {
                render_input_panel(frame, &mut app, Rect::new(0, 0, 60, 6), 56, true);
            })
            .expect("draw scrolling input panel");

        let rendered = backend_text(&terminal);
        assert!(rendered.contains("line 6"));
        assert!(!rendered.contains("line 1"));
    }

    #[test]
    fn render_header_shows_project_name() {
        let app = App::new();
        let backend = TestBackend::new(120, 2);
        let mut terminal = Terminal::new(backend).expect("terminal");

        terminal
            .draw(|frame| {
                render_header(frame, &app, Rect::new(0, 0, 120, 2));
            })
            .expect("draw header");

        let rendered = backend_text(&terminal);
        assert!(rendered.contains("CodeBuddy") || rendered.contains("SaCode"));
    }

    #[test]
    fn render_messages_panel_updates_viewport_and_renders_messages() {
        let mut app = App::new();
        app.messages.push(super::Message {
            role: super::MessageRole::User,
            content: "ping".to_string(),
            thinking: String::new(),
            timestamp: "12:00:00".to_string(),
            collapsed: false,
        });
        let backend = TestBackend::new(80, 12);
        let mut terminal = Terminal::new(backend).expect("terminal");

        terminal
            .draw(|frame| {
                render_messages_panel(frame, &mut app, Rect::new(0, 0, 80, 12));
            })
            .expect("draw messages panel");

        let rendered = backend_text(&terminal);
        assert!(rendered.contains("ping"));
        assert!(app.message_viewport.width > 0);
        assert!(app.message_viewport.height > 0);
        assert!(app.follow_bottom);
        assert!(app.scroll_offset <= app.rendered_message_lines().len());
    }

    #[test]
    fn render_messages_panel_groups_thinking_and_status_messages() {
        let mut app = App::new();
        app.messages.push(super::Message {
            role: super::MessageRole::Assistant,
            content: "[工具] grep 已完成".to_string(),
            thinking: "分析调用链".to_string(),
            timestamp: "12:00:01".to_string(),
            collapsed: false,
        });
        app.messages.push(super::Message {
            role: super::MessageRole::System,
            content: "[成功] 已刷新模型列表".to_string(),
            thinking: String::new(),
            timestamp: "12:00:02".to_string(),
            collapsed: false,
        });
        let backend = TestBackend::new(140, 16);
        let mut terminal = Terminal::new(backend).expect("terminal");

        terminal
            .draw(|frame| {
                render_messages_panel(frame, &mut app, Rect::new(0, 0, 140, 16));
            })
            .expect("draw messages panel");

        let _rendered = backend_text(&terminal);
        let line_dump = app
            .rendered_message_lines()
            .iter()
            .map(|line| line.line.to_string())
            .collect::<Vec<_>>()
            .join("\n");
        assert!(line_dump.contains("思考"));
        assert!(line_dump.contains("分析调用链"));
        assert!(line_dump.contains("grep"));
        assert!(line_dump.contains("...running"));
        assert!(line_dump.contains("已刷新模型列表"));
        assert!(!line_dump.contains("[思考]"));
    }

    #[test]
    fn render_messages_panel_collapses_thinking_details() {
        let mut app = App::new();
        app.messages.push(super::Message {
            role: super::MessageRole::Assistant,
            content: String::new(),
            thinking: "分析调用链".to_string(),
            timestamp: "12:00:01".to_string(),
            collapsed: true,
        });
        let backend = TestBackend::new(140, 16);
        let mut terminal = Terminal::new(backend).expect("terminal");

        terminal
            .draw(|frame| {
                render_messages_panel(frame, &mut app, Rect::new(0, 0, 140, 16));
            })
            .expect("draw collapsed thinking panel");

        let line_dump = app
            .rendered_message_lines()
            .iter()
            .map(|line| line.line.to_string())
            .collect::<Vec<_>>()
            .join("\n");
        assert!(line_dump.contains("思考 [已折叠]"));
        assert!(!line_dump.contains("分析调用链"));
    }

    #[test]
    fn render_messages_panel_groups_waiting_system_messages() {
        let mut app = App::new();
        app.messages.push(super::Message {
            role: super::MessageRole::System,
            content: "[等待用户回答] 请选择部署环境\n可选项: staging, production".to_string(),
            thinking: String::new(),
            timestamp: "12:00:03".to_string(),
            collapsed: false,
        });
        let backend = TestBackend::new(140, 16);
        let mut terminal = Terminal::new(backend).expect("terminal");

        terminal
            .draw(|frame| {
                render_messages_panel(frame, &mut app, Rect::new(0, 0, 140, 16));
            })
            .expect("draw waiting messages panel");

        let _rendered = backend_text(&terminal);
        let line_dump = app
            .rendered_message_lines()
            .iter()
            .map(|line| line.line.to_string())
            .collect::<Vec<_>>()
            .join("\n");
        assert!(line_dump.contains("请选择部署环境"));
        assert!(line_dump.contains("可选项: staging, production"));
    }

    #[test]
    fn render_messages_panel_wraps_long_error_messages_to_viewport_width() {
        let mut app = App::new();
        app.messages.push(super::Message {
            role: super::MessageRole::System,
            content: "[错误] 任务执行失败: 后台进程没有返回结果，退出码: 1。stderr 已写入日志，日志内容较长，需要在消息区域内稳定换行显示。".to_string(),
            thinking: String::new(),
            timestamp: "12:00:04".to_string(),
            collapsed: false,
        });
        let backend = TestBackend::new(40, 12);
        let mut terminal = Terminal::new(backend).expect("terminal");

        terminal
            .draw(|frame| {
                render_messages_panel(frame, &mut app, Rect::new(0, 0, 40, 12));
            })
            .expect("draw wrapped error panel");

        let rendered_lines = app
            .rendered_message_lines()
            .iter()
            .map(|line| line.line.to_string())
            .filter(|line| !line.trim().is_empty())
            .collect::<Vec<_>>();

        assert!(rendered_lines.len() >= 2);
        assert!(rendered_lines
            .iter()
            .any(|line| line.contains("任务执行失败")));
        assert!(rendered_lines
            .iter()
            .any(|line| line.contains("stderr 已写入日志")));
    }

    #[test]
    fn render_messages_panel_formats_queue_status_messages() {
        let mut app = App::new();
        app.messages.push(super::Message {
            role: super::MessageRole::System,
            content: "[队列] #4 已排队，等待执行: 修复模型列表加载".to_string(),
            thinking: String::new(),
            timestamp: "12:00:05".to_string(),
            collapsed: false,
        });
        let backend = TestBackend::new(50, 8);
        let mut terminal = Terminal::new(backend).expect("terminal");

        terminal
            .draw(|frame| {
                render_messages_panel(frame, &mut app, Rect::new(0, 0, 50, 8));
            })
            .expect("draw queue status panel");

        let line_dump = app
            .rendered_message_lines()
            .iter()
            .map(|line| line.line.to_string())
            .collect::<Vec<_>>()
            .join("\n");

        assert!(line_dump.contains("#4 已排队"));
        assert!(line_dump.contains("等待执行"));
        assert!(line_dump.contains("修复模型列表加载"));
    }

    #[test]
    fn render_messages_panel_formats_markdown_headings_and_lists() {
        let mut app = App::new();
        app.messages.push(super::Message {
            role: super::MessageRole::Assistant,
            content: "# 发布说明\n\n- 修复路径显示\n- 优化 Thinking 展示\n\n> 需要复测".to_string(),
            thinking: String::new(),
            timestamp: "12:00:06".to_string(),
            collapsed: false,
        });
        let backend = TestBackend::new(80, 16);
        let mut terminal = Terminal::new(backend).expect("terminal");

        terminal
            .draw(|frame| {
                render_messages_panel(frame, &mut app, Rect::new(0, 0, 80, 16));
            })
            .expect("draw markdown heading panel");

        let line_dump = app
            .rendered_message_lines()
            .iter()
            .map(|line| line.line.to_string())
            .collect::<Vec<_>>()
            .join("\n");

        assert!(line_dump.contains("# 发布说明"));
        assert!(line_dump.contains("• 修复路径显示"));
        assert!(line_dump.contains("• 优化 Thinking 展示"));
        assert!(line_dump.contains("│ 需要复测"));
    }

    #[test]
    fn render_messages_panel_formats_markdown_code_blocks() {
        let mut app = App::new();
        app.messages.push(super::Message {
            role: super::MessageRole::Assistant,
            content: "```rust\nfn main() {\n    println!(\"hi\");║\n}\n```".to_string(),
            thinking: String::new(),
            timestamp: "12:00:07".to_string(),
            collapsed: false,
        });
        let backend = TestBackend::new(80, 16);
        let mut terminal = Terminal::new(backend).expect("terminal");

        terminal
            .draw(|frame| {
                render_messages_panel(frame, &mut app, Rect::new(0, 0, 80, 16));
            })
            .expect("draw markdown code block panel");

        let line_dump = app
            .rendered_message_lines()
            .iter()
            .map(|line| line.line.to_string())
            .collect::<Vec<_>>()
            .join("\n");

        assert!(line_dump.contains("┌─ rust"));
        assert!(line_dump.contains("│ fn main() {"));
        assert!(line_dump.contains("println!(\"hi\")"));
        assert!(!line_dump.contains("║"));
        assert!(line_dump.contains("└─"));
    }

    #[test]
    fn render_messages_panel_formats_markdown_tables() {
        let mut app = App::new();
        app.messages.push(super::Message {
            role: super::MessageRole::Assistant,
            content: "| Model | Input | Output |\n| :-- | --: | :-: |\n| gpt-4o-mini | 100 | 50 |\n| deepseek-chat | 200 | 80 |".to_string(),
            thinking: String::new(),
            timestamp: "12:00:08".to_string(),
            collapsed: false,
        });
        let backend = TestBackend::new(100, 16);
        let mut terminal = Terminal::new(backend).expect("terminal");

        terminal
            .draw(|frame| {
                render_messages_panel(frame, &mut app, Rect::new(0, 0, 100, 16));
            })
            .expect("draw markdown table panel");

        let line_dump = app
            .rendered_message_lines()
            .iter()
            .map(|line| line.line.to_string())
            .collect::<Vec<_>>()
            .join("\n");

        assert!(line_dump.contains("Model"));
        assert!(line_dump.contains("gpt-4o-mini"));
        assert!(line_dump.contains("deepseek-chat"));
        assert!(line_dump.contains("│"));
        assert!(line_dump.contains("┼") || line_dump.contains("┤"));
    }

    #[test]
    fn render_pending_question_panel_highlights_approval_state() {
        let mut app = App::new();
        app.interaction.state = InteractionState::WaitingForApproval;
        app.interaction.pending_approval_request = Some(PendingApprovalRequest {
            task_prompt: "修复模型列表加载".to_string(),
            tool_name: "bash".to_string(),
            allowed_dir: None,
        });
        app.interaction
            .pending_question_items
            .push(PendingQuestionItem {
                question: "允许执行 bash 工具吗？".to_string(),
                options: vec![
                    PendingQuestionOption {
                        label: "批准".to_string(),
                        description: "允许本次执行".to_string(),
                    },
                    PendingQuestionOption {
                        label: "拒绝".to_string(),
                        description: "终止本次执行".to_string(),
                    },
                ],
                allow_multiple: false,
            });
        app.interaction.selected_pending_answers = vec![std::collections::HashSet::new()];
        let backend = TestBackend::new(140, 30);
        let mut terminal = Terminal::new(backend).expect("terminal");

        terminal
            .draw(|frame| {
                render_pending_question_panel(frame, &app);
            })
            .expect("draw pending approval panel");

        let rendered = backend_text(&terminal);
        assert_eq!(app.interaction.state, InteractionState::WaitingForApproval);
        assert_eq!(
            app.interaction
                .pending_approval_request
                .as_ref()
                .map(|request| request.tool_name.as_str()),
            Some("bash")
        );
        assert_eq!(
            app.current_pending_question()
                .map(|item| item.question.as_str()),
            Some("允许执行 bash 工具吗？")
        );
        assert!(rendered.contains("bash"));
    }

    #[test]
    fn session_store_restores_auto_approve_flag() {
        let mut ctx = test_app();
        ctx.app.session_auto_approve_edits = true;
        ctx.app.save_current_session();
        ctx.app.session_auto_approve_edits = false;

        let path = ctx.app.project_current_session_path();
        ctx.app.load_session_from_path(path, false);

        assert!(ctx.app.session_auto_approve_edits);
    }

    #[test]
    fn plan_mode_uses_builtin_approval_policy() {
        let mut ctx = test_app();
        ctx.app.execution_mode = ExecutionMode::Plan;

        assert_eq!(
            ctx.app.current_task_approval_policy(),
            ApprovalPolicy::AutoApprove
        );
    }

    #[test]
    fn render_header_shows_git_queue_and_todo_status() {
        let mut app = App::new();
        app.git_changes = vec!["M interfaces/cli/src/tui/render/sidebar_queue.rs".to_string()];
        let backend = TestBackend::new(120, 2);
        let mut terminal = Terminal::new(backend).expect("terminal");

        terminal
            .draw(|frame| {
                render_header(frame, &app, Rect::new(0, 0, 120, 2));
            })
            .expect("draw header with git status");

        let rendered = backend_text(&terminal);
        assert!(rendered.contains("SaCode"));
        assert!(rendered.contains("git"));
    }

    #[test]
    fn render_header_shows_thinking_status() {
        let mut test_ctx = test_app();
        let app = &mut test_ctx.app;
        let provider_name = "test-provider".to_string();
        let model_name = "test-model".to_string();
        let mut spec = sacode_kernel::model::ProviderSpec {
            name: provider_name.clone(),
            base_url: "https://example.com/v1".to_string(),
            api_key: String::new(),
            models: std::collections::BTreeMap::new(),
        };
        spec.models.insert(
            model_name.clone(),
            sacode_kernel::model::ModelRule {
                name: model_name.clone(),
                thinking: true,
                ..Default::default()
            },
        );
        app.sacode_store
            .upsert_provider(&provider_name, spec)
            .expect("persist provider spec");
        app.current_provider = Some(crate::provider_config::NamedProviderConfig {
            name: provider_name,
            config: crate::provider_config::ProviderConfig {
                base_url: "https://example.com/v1".to_string(),
                api_key: String::new(),
                model: model_name,
            },
        });

        let backend = TestBackend::new(220, 2);
        let mut terminal = Terminal::new(backend).expect("terminal");
        terminal
            .draw(|frame| {
                render_header(frame, &app, Rect::new(0, 0, 220, 2));
            })
            .expect("draw header");

        let rendered = backend_text(&terminal);
        assert!(rendered.contains("think:on"));
        assert!(rendered.contains("主模型"));
        assert!(rendered.contains("Ctrl+Q: quit"));
    }

    #[test]
    fn render_header_shows_core_status_fields() {
        let mut app = App::new();
        app.session_summary = Some("[会话目标]\n- 修复 compress 命令".to_string());
        app.messages.push(super::Message {
            role: super::MessageRole::User,
            content: "请继续优化 TUI header".to_string(),
            thinking: String::new(),
            timestamp: "12:00:00".to_string(),
            collapsed: false,
        });

        let backend = TestBackend::new(220, 2);
        let mut terminal = Terminal::new(backend).expect("terminal");
        terminal
            .draw(|frame| {
                render_header(frame, &app, Rect::new(0, 0, 220, 2));
            })
            .expect("draw header");

        let rendered = backend_text(&terminal);
        assert!(rendered.contains("~/"));
        assert!(rendered.contains("SaCode v"));
        assert!(rendered.contains("模式"));
        assert!(rendered.contains("主模型"));
    }

    #[test]
    fn render_header_trims_trailing_slash_from_windows_style_path() {
        let mut app = App::new();
        app.workdir = PathBuf::from("E:/test/");

        let backend = TestBackend::new(220, 2);
        let mut terminal = Terminal::new(backend).expect("terminal");
        terminal
            .draw(|frame| {
                render_header(frame, &app, Rect::new(0, 0, 220, 2));
            })
            .expect("draw header");

        let rendered = backend_text(&terminal);
        assert!(rendered.contains("~E:/test"));
        assert!(!rendered.contains("~E:/test/"));
    }

    #[test]
    fn render_footer_shows_shortcuts_hint() {
        let mut app = App::new();
        app.queue.processing = true;
        app.spinner_index = 2;
        app.active_task_started_at = Some(chrono::Local::now());
        app.session_summary = Some("[摘要]\n- 修复 footer".to_string());
        let backend = TestBackend::new(120, 2);
        let mut terminal = Terminal::new(backend).expect("terminal");

        terminal
            .draw(|frame| {
                render_footer(frame, &app, Rect::new(0, 0, 120, 2));
            })
            .expect("draw footer");

        let rendered = backend_text(&terminal);
        assert!(rendered.contains("Running"));
        assert!(!rendered.contains("ctx"));
        assert!(!rendered.contains("tok"));
        assert!(rendered.contains("%"));
        assert!(rendered.contains("Alt+M: mode"));
    }

    #[test]
    fn render_footer_shows_thinking_shortcut_status() {
        let app = App::new();
        let backend = TestBackend::new(120, 2);
        let mut terminal = Terminal::new(backend).expect("terminal");

        terminal
            .draw(|frame| {
                render_footer(frame, &app, Rect::new(0, 0, 120, 2));
            })
            .expect("draw footer");

        let rendered = backend_text(&terminal);
        assert!(rendered.contains("Ctrl+T: think:"));
    }

    #[test]
    fn stats_output_lists_multiple_models_and_total() {
        let mut app = App::new();
        app.usage_stats.requests = 3;
        app.usage_stats.prompt_tokens = 300;
        app.usage_stats.completion_tokens = 150;
        app.usage_stats.total_tokens = 450;
        app.usage_stats.estimated_cost_usd = 0.123456;
        app.usage_stats.models.insert(
            "deepseek:deepseek-chat".to_string(),
            super::ModelUsageStats {
                requests: 2,
                prompt_tokens: 200,
                completion_tokens: 100,
                total_tokens: 300,
                estimated_cost_usd: 0.100000,
            },
        );
        app.usage_stats.models.insert(
            "openai:gpt-4o-mini".to_string(),
            super::ModelUsageStats {
                requests: 1,
                prompt_tokens: 100,
                completion_tokens: 50,
                total_tokens: 150,
                estimated_cost_usd: 0.023456,
            },
        );

        app.show_usage_stats();

        let last = app.messages.last().expect("stats message");
        assert!(last.content.contains("Token 与费用统计"));
        assert!(last.content.contains("deepseek:deepseek-chat"));
        assert!(last.content.contains("openai:gpt-4o-mini"));
        assert!(last.content.contains("总计"));
        assert!(last.content.contains("0.123456"));
    }

    #[test]
    fn build_session_compression_source_includes_existing_summary_and_dialogue() {
        let mut app = App::new();
        app.session_summary = Some("[会话目标]\n- 修复代码问题".to_string());
        app.messages.push(super::Message {
            role: super::MessageRole::User,
            content: "修复代码问题，并实现 md 文件打开功能".to_string(),
            thinking: String::new(),
            timestamp: "12:00:00".to_string(),
            collapsed: false,
        });
        app.messages.push(super::Message {
            role: super::MessageRole::Assistant,
            content: "已定位到 Rust 官网链接相关逻辑".to_string(),
            thinking: String::new(),
            timestamp: "12:01:00".to_string(),
            collapsed: false,
        });
        app.messages.push(super::Message {
            role: super::MessageRole::User,
            content: "继续处理 compress 命令".to_string(),
            thinking: String::new(),
            timestamp: "12:02:00".to_string(),
            collapsed: false,
        });

        let source = app.build_session_compression_source();
        assert!(source.contains("[已有摘要]"));
        assert!(source.contains("修复代码问题"));
        assert!(source.contains("md 文件打开功能"));
        assert!(source.contains("Rust 官网链接"));
        assert!(source.contains("继续处理 compress 命令"));
    }

    #[test]
    fn apply_session_summary_replaces_messages_with_semantic_summary_notice() {
        let mut app = App::new();
        app.messages.push(super::Message {
            role: super::MessageRole::User,
            content: "原始消息".to_string(),
            thinking: String::new(),
            timestamp: "12:00:00".to_string(),
            collapsed: false,
        });

        app.apply_session_summary("[会话目标]\n- 修复代码问题".to_string(), "test-model");

        assert_eq!(app.messages.len(), 1);
        assert_eq!(
            app.session_summary.as_deref(),
            Some("[会话目标]\n- 修复代码问题")
        );
        assert!(app.messages[0].content.contains("test-model"));
        assert!(app.messages[0].content.contains("语义压缩"));
    }

    #[test]
    fn chat_up_key_navigates_history_only_on_first_visible_line() {
        let mut app = App::new();
        app.input_mode = super::InputMode::Chat;
        app.sent_history = vec!["上一条消息".to_string()];
        app.input = ["line1", "line2", "line3", "line4", "line5", "line6"].join("\n");
        app.input_viewport = Rect::new(0, 0, 40, 3);
        app.input_scroll_offset = 2;

        use crossterm::event::{KeyCode, KeyEvent, KeyModifiers};
        app.handle_key_event(KeyEvent::new(KeyCode::Up, KeyModifiers::NONE));
        assert_eq!(app.input_scroll_offset, 1);
        assert_ne!(app.input, "上一条消息");

        app.input = ["line1", "line2", "line3", "line4", "line5", "line6"].join("\n");
        app.input_scroll_offset = 5;
        app.handle_key_event(KeyEvent::new(KeyCode::Up, KeyModifiers::NONE));
        assert_eq!(app.input, "上一条消息");
    }

    #[test]
    fn chat_down_key_navigates_history_only_on_last_visible_line() {
        let mut app = App::new();
        app.input_mode = super::InputMode::Chat;
        app.sent_history = vec!["旧消息一".to_string(), "旧消息二".to_string()];
        app.input_viewport = Rect::new(0, 0, 40, 4);

        app.input = ["line1", "line2", "line3", "line4", "line5", "line6"].join("\n");
        app.history_index = Some(0);
        app.input_scroll_offset = 0;

        use crossterm::event::{KeyCode, KeyEvent, KeyModifiers};
        app.handle_key_event(KeyEvent::new(KeyCode::Down, KeyModifiers::NONE));
        assert_eq!(app.input_scroll_offset, 1);

        app.input = ["line1", "line2", "line3", "line4", "line5", "line6"].join("\n");
        app.history_index = Some(0);
        app.input_scroll_offset = 2;
        app.handle_key_event(KeyEvent::new(KeyCode::Down, KeyModifiers::NONE));
        assert_eq!(app.input, "旧消息二");

        app.input = "旧消息一".to_string();
        app.history_index = Some(0);
        app.input_scroll_offset = 0;
        app.handle_key_event(KeyEvent::new(KeyCode::Down, KeyModifiers::NONE));
        assert_eq!(app.input, "旧消息二");
    }

    #[test]
    fn chat_arrow_keys_do_not_scroll_message_history() {
        let mut app = App::new();
        app.input_mode = super::InputMode::Chat;
        app.input = "draft".to_string();
        app.scroll_offset = 7;
        app.input_viewport = Rect::new(0, 0, 40, 3);

        use crossterm::event::{KeyCode, KeyEvent, KeyModifiers};
        app.handle_key_event(KeyEvent::new(KeyCode::Down, KeyModifiers::NONE));
        assert_eq!(app.scroll_offset, 7);
        app.handle_key_event(KeyEvent::new(KeyCode::Up, KeyModifiers::NONE));
        assert_eq!(app.scroll_offset, 7);
    }

    #[test]
    fn mouse_wheel_scrolls_input_when_chat_input_is_editable() {
        let mut app = App::new();
        app.input_mode = super::InputMode::Chat;
        app.input = [
            "line1", "line2", "line3", "line4", "line5", "line6", "line7",
        ]
        .join("\n");
        app.input_viewport = Rect::new(0, 10, 40, 3);
        app.message_viewport = Rect::new(0, 0, 40, 8);
        app.scroll_offset = 4;

        use crossterm::event::{KeyModifiers, MouseButton, MouseEvent, MouseEventKind};
        app.handle_mouse_event(MouseEvent {
            kind: MouseEventKind::ScrollDown,
            column: 1,
            row: 10,
            modifiers: KeyModifiers::NONE,
        });
        assert!(app.input_scroll_offset > 0);
        assert_eq!(app.scroll_offset, 4);

        app.handle_mouse_event(MouseEvent {
            kind: MouseEventKind::ScrollUp,
            column: 1,
            row: 10,
            modifiers: KeyModifiers::NONE,
        });
        let _ = MouseButton::Left;
        assert_eq!(app.scroll_offset, 4);
    }

    #[test]
    fn mouse_wheel_over_message_panel_still_scrolls_messages() {
        let mut app = App::new();
        app.input_mode = super::InputMode::Chat;
        app.input = [
            "line1", "line2", "line3", "line4", "line5", "line6", "line7",
        ]
        .join("\n");
        app.input_viewport = Rect::new(0, 10, 40, 3);
        app.message_viewport = Rect::new(0, 0, 40, 8);
        for index in 0..20 {
            app.messages.push(super::Message {
                role: super::MessageRole::Assistant,
                content: format!("message {}", index),
                thinking: String::new(),
                timestamp: "12:00:00".to_string(),
                collapsed: false,
            });
        }
        app.scroll_offset = 4;

        use crossterm::event::{KeyModifiers, MouseEvent, MouseEventKind};
        app.handle_mouse_event(MouseEvent {
            kind: MouseEventKind::ScrollUp,
            column: 1,
            row: 1,
            modifiers: KeyModifiers::NONE,
        });

        assert_eq!(app.input_scroll_offset, 0);
        assert!(!app.follow_bottom);
    }

    #[test]
    fn message_scroll_up_moves_offset_when_following_bottom() {
        let mut app = App::new();
        app.message_viewport = Rect::new(0, 0, 40, 5);
        for index in 0..20 {
            app.messages.push(super::Message {
                role: super::MessageRole::Assistant,
                content: format!("message {}", index),
                thinking: String::new(),
                timestamp: "12:00:00".to_string(),
                collapsed: false,
            });
        }

        app.scroll_to_bottom();
        let bottom = app.scroll_offset;
        app.scroll_up();

        assert!(!app.follow_bottom);
        assert_eq!(app.scroll_offset, bottom.saturating_sub(1));
    }

    #[test]
    fn streaming_chunk_keeps_user_scroll_position_when_not_following_bottom() {
        let mut app = App::new();
        app.queue.processing = true;
        app.queue.active_task_id = Some(1);
        app.follow_bottom = false;
        app.scroll_offset = 3;
        app.append_message(super::Message {
            role: super::MessageRole::Assistant,
            content: String::new(),
            thinking: String::new(),
            timestamp: "12:00:00".to_string(),
            collapsed: false,
        });

        app.handle_chat_stream_chunk(1, StreamChunkKind::Message, "hello".to_string());

        assert_eq!(app.scroll_offset, 3);
        assert!(!app.follow_bottom);
    }

    #[test]
    fn thinking_indicator_visible_before_first_chunk_and_hidden_after_chunk() {
        let mut app = App::new();
        app.queue.processing = true;
        app.queue.active_task_id = Some(2);
        app.assistant_pending_thinking = true;
        app.append_message(super::Message {
            role: super::MessageRole::Assistant,
            content: String::new(),
            thinking: String::new(),
            timestamp: "12:00:00".to_string(),
            collapsed: false,
        });

        let line = app.thinking_indicator_line();
        assert!(line.is_some());
        assert!(line
            .as_ref()
            .map(|item| item.line.to_string())
            .unwrap_or_default()
            .contains("Thinking"));

        app.handle_chat_stream_chunk(2, StreamChunkKind::Message, "answer".to_string());
        assert!(app.thinking_indicator_line().is_none());
    }

    #[test]
    fn compress_failure_resets_busy_state() {
        let mut app = App::new();
        app.queue.processing = true;
        app.queue.busy_message = "正在压缩".to_string();
        app.active_task_started_at = Some(chrono::Local::now());

        app.handle_failed_async_result(
            super::AsyncContext::CompressContext,
            "压缩失败".to_string(),
        );

        assert!(!app.queue.processing);
        assert!(app.queue.busy_message.is_empty());
        assert!(app.active_task_started_at.is_none());
    }

    #[test]
    fn render_input_panel_shows_thinking_indicator_when_enabled() {
        let mut test_ctx = test_app();
        let mut app = &mut test_ctx.app;
        let provider_name = "test-provider-input".to_string();
        let model_name = "test-model-input".to_string();
        let mut spec = sacode_kernel::model::ProviderSpec {
            name: provider_name.clone(),
            base_url: "https://example.com/v1".to_string(),
            api_key: String::new(),
            models: std::collections::BTreeMap::new(),
        };
        spec.models.insert(
            model_name.clone(),
            sacode_kernel::model::ModelRule {
                name: model_name.clone(),
                thinking: true,
                ..Default::default()
            },
        );
        app.sacode_store
            .upsert_provider(&provider_name, spec)
            .expect("persist provider spec");
        app.current_provider = Some(crate::provider_config::NamedProviderConfig {
            name: provider_name,
            config: crate::provider_config::ProviderConfig {
                base_url: "https://example.com/v1".to_string(),
                api_key: String::new(),
                model: model_name,
            },
        });
        app.input = "hello world".to_string();

        let backend = TestBackend::new(100, 8);
        let mut terminal = Terminal::new(backend).expect("terminal");

        terminal
            .draw(|frame| {
                render_input_panel(frame, &mut app, Rect::new(0, 0, 100, 8), 96, true);
            })
            .expect("draw input panel");

        let rendered = backend_text(&terminal);
        assert!(rendered.contains("[T]"));
    }
}
