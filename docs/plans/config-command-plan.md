加入/config命令 交互式配置命令完整方案
1. 需求概述
在 SaCode TUI 中提供交互式配置管理界面，用户可通过键盘导航选择配置项，通过回车键快速切换或修改配置值，实现零命令行的配置管理体验。

2. 功能目标
提供统一的配置管理入口（TUI 内 /config 命令）
支持上下键导航选择配置项
支持三种配置类型的交互式修改：
枚举型：弹出选项列表，上下选择后确认
布尔型：回车直接切换 ON/OFF
数字型：进入输入模式，输入数字后确认
配置修改即时生效或提示保存
支持用户级和项目级配置分层管理
3. 配置项定义
3.1 配置项清单
配置键	显示名称	类型	可选值/范围	默认值	说明
language	交互语言	Enum	zh-CN, en-US	zh-CN	AI 回复和系统提示的语言
auto_compress	自动压缩	Bool	-	true	是否在对话达到阈值时自动压缩上下文
compress_threshold	压缩阈值	Number	5-50	15	触发自动压缩的对话轮数阈值
compress_tail_turns	保留轮数	Number	5-30	15	压缩后保留的最近对话轮数
max_iterations	循环次数	Number	1-10	1	工具执行循环的最大迭代次数
approval_policy	审批策略	Enum	auto, prompt, deny	prompt	工具执行的审批策略
output_style	输出风格	Enum	concise, explain, teach	concise	AI 输出内容的风格模式
vim_mode	Vim 模式	Bool	-	false	输入框是否启用 Vim 编辑模式
3.2 配置类型定义

#[derive(Debug, Clone)]
pub enum ConfigValueType {
    Enum {
        options: Vec<String>,
        labels: Vec<String>,  // 显示标签（可选，用于国际化）
    },
    Bool,
    Number {
        min: usize,
        max: usize,
        step: usize,  // 步进值（可选，用于 +/- 键调整）
    },
}
4. 配置数据结构
4.1 配置 Schema

// runtime/src/config/user_config.rs

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// 用户配置结构
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UserConfig {
    /// 交互语言
    #[serde(default = "default_language")]
    pub language: String,
    
    /// 上下文管理配置
    #[serde(default)]
    pub context: ContextConfig,
    
    /// 执行配置
    #[serde(default)]
    pub execution: ExecutionConfig,
    
    /// 输出风格
    #[serde(default = "default_output_style")]
    pub output_style: String,
    
    /// Vim 模式
    #[serde(default)]
    pub vim_mode: bool,
    
    /// 实验性配置（预留扩展）
    #[serde(default)]
    pub experimental: HashMap<String, serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ContextConfig {
    #[serde(default = "default_auto_compress")]
    pub auto_compress: bool,
    
    #[serde(default = "default_compress_threshold")]
    pub compress_threshold: usize,
    
    #[serde(default = "default_compress_tail_turns")]
    pub compress_tail_turns: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ExecutionConfig {
    #[serde(default = "default_max_iterations")]
    pub max_iterations: usize,
    
    #[serde(default = "default_approval_policy")]
    pub approval_policy: String,
}

// 默认值函数
fn default_language() -> String { "zh-CN".into() }
fn default_output_style() -> String { "concise".into() }
fn default_auto_compress() -> bool { true }
fn default_compress_threshold() -> usize { 15 }
fn default_compress_tail_turns() -> usize { 15 }
fn default_max_iterations() -> usize { 1 }
fn default_approval_policy() -> String { "prompt".into() }

impl Default for UserConfig {
    fn default() -> Self {
        Self {
            language: default_language(),
            context: ContextConfig::default(),
            execution: ExecutionConfig::default(),
            output_style: default_output_style(),
            vim_mode: false,
            experimental: HashMap::new(),
        }
    }
}
4.2 配置项元数据

// runtime/src/config/config_meta.rs

/// 配置项元数据，用于 UI 渲染
#[derive(Debug, Clone)]
pub struct ConfigItemMeta {
    pub key: String,
    pub display_name: String,
    pub description: String,
    pub value_type: ConfigValueType,
    pub category: ConfigCategory,
}

#[derive(Debug, Clone, Copy)]
pub enum ConfigCategory {
    General,    // 通用
    Context,    // 上下文管理
    Execution,  // 执行控制
    Editor,     // 编辑器
}

/// 所有配置项的元数据定义
pub fn get_all_config_items() -> Vec<ConfigItemMeta> {
    vec![
        ConfigItemMeta {
            key: "language",
            display_name: "交互语言",
            description: "AI 回复和系统提示的显示语言",
            value_type: ConfigValueType::Enum {
                options: vec!["zh-CN".into(), "en-US".into()],
                labels: vec!["中文".into(), "英文".into()],
            },
            category: ConfigCategory::General,
        },
        ConfigItemMeta {
            key: "context.auto_compress",
            display_name: "自动压缩",
            description: "对话达到阈值时自动压缩上下文",
            value_type: ConfigValueType::Bool,
            category: ConfigCategory::Context,
        },
        ConfigItemMeta {
            key: "context.compress_threshold",
            display_name: "压缩阈值",
            description: "触发自动压缩的对话轮数",
            value_type: ConfigValueType::Number {
                min: 5,
                max: 50,
                step: 1,
            },
            category: ConfigCategory::Context,
        },
        ConfigItemMeta {
            key: "context.compress_tail_turns",
            display_name: "保留轮数",
            description: "压缩后保留的最近对话轮数",
            value_type: ConfigValueType::Number {
                min: 5,
                max: 30,
                step: 1,
            },
            category: ConfigCategory::Context,
        },
        ConfigItemMeta {
            key: "execution.max_iterations",
            display_name: "循环次数",
            description: "工具执行循环的最大迭代次数",
            value_type: ConfigValueType::Number {
                min: 1,
                max: 10,
                step: 1,
            },
            category: ConfigCategory::Execution,
        },
        ConfigItemMeta {
            key: "execution.approval_policy",
            display_name: "审批策略",
            description: "工具执行的审批策略",
            value_type: ConfigValueType::Enum {
                options: vec!["auto".into(), "prompt".into(), "deny".into()],
                labels: vec!["自动批准".into(), "询问确认".into(), "自动拒绝".into()],
            },
            category: ConfigCategory::Execution,
        },
        ConfigItemMeta {
            key: "output_style",
            display_name: "输出风格",
            description: "AI 输出内容的详细程度",
            value_type: ConfigValueType::Enum {
                options: vec!["concise".into(), "explain".into(), "teach".into()],
                labels: vec!["简洁".into(), "解释".into(), "教学".into()],
            },
            category: ConfigCategory::General,
        },
        ConfigItemMeta {
            key: "vim_mode",
            display_name: "Vim 模式",
            description: "输入框启用 Vim 编辑模式",
            value_type: ConfigValueType::Bool,
            category: ConfigCategory::Editor,
        },
    ]
}
4.3 配置存储层

// runtime/src/config/config_store.rs

use std::path::{Path, PathBuf};
use anyhow::Result;

pub struct ConfigStore {
    user_config_path: PathBuf,
    project_config_path: PathBuf,
}

impl ConfigStore {
    pub fn new(workdir: &Path) -> Self {
        let user_dir = std::env::var_os("HOME")
            .map(PathBuf::from)
            .unwrap_or_else(|| PathBuf::from("."))
            .join(".sacode");
        
        Self {
            user_config_path: user_dir.join("config.json"),
            project_config_path: workdir.join(".sacode").join("config.json"),
        }
    }
    
    /// 加载合并后的配置（项目级覆盖用户级）
    pub fn load(&self) -> Result<UserConfig> {
        let mut config = UserConfig::default();
        
        // 先加载用户级配置
        if self.user_config_path.exists() {
            let content = std::fs::read_to_string(&self.user_config_path)?;
            if let Ok(user_config) = serde_json::from_str::<UserConfig>(&content) {
                config = user_config;
            }
        }
        
        // 再加载项目级配置（覆盖）
        if self.project_config_path.exists() {
            let content = std::fs::read_to_string(&self.project_config_path)?;
            if let Ok(project_config) = serde_json::from_str::<UserConfig>(&content) {
                config = merge_configs(config, project_config);
            }
        }
        
        Ok(config)
    }
    
    /// 保存配置到指定层级
    pub fn save(&self, config: &UserConfig, scope: ConfigScope) -> Result<()> {
        let path = match scope {
            ConfigScope::User => &self.user_config_path,
            ConfigScope::Project => &self.project_config_path,
        };
        
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        
        let content = serde_json::to_string_pretty(config)?;
        std::fs::write(path, content)?;
        
        Ok(())
    }
    
    /// 获取配置文件路径
    pub fn paths(&self) -> (PathBuf, PathBuf) {
        (self.user_config_path.clone(), self.project_config_path.clone())
    }
}

#[derive(Debug, Clone, Copy)]
pub enum ConfigScope {
    User,
    Project,
}

fn merge_configs(base: UserConfig, overlay: UserConfig) -> UserConfig {
    // 简单的字段覆盖合并
    UserConfig {
        language: overlay.language,
        context: ContextConfig {
            auto_compress: overlay.context.auto_compress,
            compress_threshold: overlay.context.compress_threshold,
            compress_tail_turns: overlay.context.compress_tail_turns,
        },
        execution: ExecutionConfig {
            max_iterations: overlay.execution.max_iterations,
            approval_policy: overlay.execution.approval_policy,
        },
        output_style: overlay.output_style,
        vim_mode: overlay.vim_mode,
        experimental: overlay.experimental,
    }
}
5. 交互界面设计
5.1 主界面布局

┌─ SaCode 配置管理 ────────────────────────────────────────────────┐
│                                                                    │
│  范围: [项目] ← Tab 切换用户/项目级                                 │
│                                                                    │
│  ─── 通用 ──────────────────────────────────────────────────────  │
│    交互语言      [中文] ←                                          │
│    输出风格      [简洁]                                            │
│                                                                    │
│  ─── 上下文 ────────────────────────────────────────────────────  │
│    自动压缩      [ON]                                              │
│    压缩阈值      15                                                │
│    保留轮数      15                                                │
│                                                                    │
│  ─── 执行 ──────────────────────────────────────────────────────  │
│    循环次数      1                                                 │
│    审批策略      [询问确认]                                        │
│                                                                    │
│  ─── 编辑器 ────────────────────────────────────────────────────  │
│    Vim 模式      [OFF]                                             │
│                                                                    │
│  ───────────────────────────────────────────────────────────────── │
│  ↑↓ 导航  Enter 修改  Tab 切换范围  s 保存  q/Esc 退出              │
│                                                                    │
└────────────────────────────────────────────────────────────────────┘

当前选中项（← 标记）会高亮显示
5.2 枚举型选择弹窗

┌─ 选择: 交互语言 ─────────────────────────────────────┐
│                                                      │
│    中文 ←                                            │
│    英文                                              │
│                                                      │
│    ↑↓ 选择  Enter 确认  Esc 取消                     │
│                                                      │
└──────────────────────────────────────────────────────┘
5.3 布尔型切换动画

修改前:  自动压缩      [ON]
按下 Enter 后:
         自动压缩      [OFF] ✓ 已更新
5.4 数字型输入框

┌─ 输入: 循环次数 ─────────────────────────────────────┐
│                                                      │
│    当前值: 1                                         │
│    新值: [___]                                       │
│    有效范围: 1 - 10                                  │
│                                                      │
│    Enter 确认  Esc 取消                              │
│                                                      │
└──────────────────────────────────────────────────────┘
6. 交互流程设计
6.1 状态流转图

┌─────────────┐
│   主列表    │ ← 初始状态
│  (导航)     │
└─────┬───────┘
      │ Enter (根据类型)
      ├────────────────────┬────────────────────┬─────────────────
      │                    │                    │
      ↓                    ↓                    ↓
┌─────────────┐    ┌─────────────┐      ┌─────────────┐
│ 枚举选择框  │    │ 值切换动画  │      │ 数字输入框  │
│ (上下选择)  │    │ (ON↔OFF)    │      │ (键盘输入)  │
└─────┬───────┘    └─────┬───────┘      └─────┬───────┘
      │ Enter            │ (自动完成)          │ Enter
      │ 确认             │                     │ 确认
      └──────────────────┴─────────────────────┘
                        │
                        ↓
              ┌─────────────┐
              │ 更新成功提示 │
              │ (短暂显示)   │
              └─────┬───────┘
                    │ (自动返回)
                    ↓
              ┌─────────────┐
              │   主列表    │
              │  (继续导航) │
              └─────────────┘
6.2 键盘操作定义
键位	功能	适用状态
↑ / k	向上移动选中项	主列表、枚举选择框
↓ / j	向下移动选中项	主列表、枚举选择框
Enter	进入修改/确认选择	所有状态
Esc / q	返回/取消/退出	所有状态
Tab	切换配置范围（用户/项目）	主列表
s	保存配置到文件	主列表
r	重置当前项为默认值	主列表
数字键	输入数字	数字输入框
Backspace	删除输入字符	数字输入框
7. 技术实现
7.1 状态机设计

// interfaces/cli/src/cmd/config.rs

use ratatui::{
    Frame,
    layout::{Constraint, Direction, Layout, Rect},
    style::{Color, Modifier, Style},
    text::{Line, Span},
    widgets::{Block, Borders, List, ListItem, Paragraph},
};

#[derive(Debug, Clone, Copy, PartialEq)]
enum ConfigScreenState {
    MainList,          // 主列表导航
    EnumSelect,        // 枚举选项选择
    NumberInput,       // 数字输入
    SavePrompt,        // 保存确认
    ExitPrompt,        // 退出确认
}

pub struct ConfigScreen {
    state: ConfigScreenState,
    config: UserConfig,
    scope: ConfigScope,
    
    // 主列表状态
    items: Vec<ConfigItemMeta>,
    selected_index: usize,
    
    // 枚举选择状态
    enum_options: Vec<String>,
    enum_labels: Vec<String>,
    enum_selected: usize,
    enum_target_key: String,
    
    // 数字输入状态
    number_input: String,
    number_target_key: String,
    number_range: (usize, usize),
    number_current: usize,
    
    // 修改标记
    modified: bool,
    
    // 存储
    store: ConfigStore,
}

impl ConfigScreen {
    pub fn new(workdir: &Path) -> Self {
        let store = ConfigStore::new(workdir);
        let config = store.load().unwrap_or_default();
        let items = get_all_config_items();
        
        Self {
            state: ConfigScreenState::MainList,
            config,
            scope: ConfigScope::Project,
            items,
            selected_index: 0,
            enum_options: Vec::new(),
            enum_labels: Vec::new(),
            enum_selected: 0,
            enum_target_key: String::new(),
            number_input: String::new(),
            number_target_key: String::new(),
            number_range: (0, 0),
            number_current: 0,
            modified: false,
            store,
        }
    }
    
    pub fn run(&mut self, terminal: &mut Terminal) -> Result<()> {
        loop {
            terminal.draw(|f| self.render(f))?;
            
            if let Event::Key(key) = event::read()? {
                self.handle_key(key);
            }
            
            if self.state == ConfigScreenState::ExitPrompt && self.should_exit() {
                break;
            }
        }
        
        Ok(())
    }
    
    fn handle_key(&mut self, key: KeyEvent) {
        match self.state {
            ConfigScreenState::MainList => self.handle_main_list_key(key),
            ConfigScreenState::EnumSelect => self.handle_enum_select_key(key),
            ConfigScreenState::NumberInput => self.handle_number_input_key(key),
            ConfigScreenState::SavePrompt => self.handle_save_prompt_key(key),
            ConfigScreenState::ExitPrompt => self.handle_exit_prompt_key(key),
        }
    }
    
    fn handle_main_list_key(&mut self, key: KeyEvent) {
        match key.code {
            KeyCode::Up | KeyCode::Char('k') => {
                if self.selected_index > 0 {
                    self.selected_index -= 1;
                }
            }
            KeyCode::Down | KeyCode::Char('j') => {
                if self.selected_index < self.items.len() - 1 {
                    self.selected_index += 1;
                }
            }
            KeyCode::Enter => {
                self.enter_edit_mode();
            }
            KeyCode::Tab => {
                self.toggle_scope();
            }
            KeyCode::Char('s') => {
                self.save_config();
            }
            KeyCode::Char('r') => {
                self.reset_current_item();
            }
            KeyCode::Esc | KeyCode::Char('q') => {
                if self.modified {
                    self.state = ConfigScreenState::ExitPrompt;
                } else {
                    self.state = ConfigScreenState::ExitPrompt;
                }
            }
            _ => {}
        }
    }
    
    fn enter_edit_mode(&mut self) {
        let item = &self.items[self.selected_index];
        
        match &item.value_type {
            ConfigValueType::Enum { options, labels } => {
                self.enum_options = options.clone();
                self.enum_labels = labels.clone();
                self.enum_target_key = item.key.clone();
                
                // 找到当前值的索引
                let current_value = self.get_config_value(&item.key);
                self.enum_selected = options.iter()
                    .position(|opt| opt == &current_value)
                    .unwrap_or(0);
                
                self.state = ConfigScreenState::EnumSelect;
            }
            ConfigValueType::Bool => {
                // 直接切换
                self.toggle_bool_value(&item.key);
            }
            ConfigValueType::Number { min, max, .. } => {
                self.number_target_key = item.key.clone();
                self.number_range = (*min, *max);
                self.number_current = self.get_config_value(&item.key)
                    .parse::<usize>()
                    .unwrap_or(*min);
                self.number_input = self.number_current.to_string();
                
                self.state = ConfigScreenState::NumberInput;
            }
        }
    }
    
    fn toggle_bool_value(&mut self, key: &str) {
        let current = self.get_config_value(key) == "true";
        self.set_config_value(key, if current { "false" } else { "true" });
        self.modified = true;
        // 布尔型直接切换后返回主列表
    }
    
    fn handle_enum_select_key(&mut self, key: KeyEvent) {
        match key.code {
            KeyCode::Up | KeyCode::Char('k') => {
                if self.enum_selected > 0 {
                    self.enum_selected -= 1;
                }
            }
            KeyCode::Down | KeyCode::Char('j') => {
                if self.enum_selected < self.enum_options.len() - 1 {
                    self.enum_selected += 1;
                }
            }
            KeyCode::Enter => {
                let new_value = self.enum_options[self.enum_selected].clone();
                self.set_config_value(&self.enum_target_key, &new_value);
                self.modified = true;
                self.state = ConfigScreenState::MainList;
            }
            KeyCode::Esc => {
                self.state = ConfigScreenState::MainList;
            }
            _ => {}
        }
    }
    
    fn handle_number_input_key(&mut self, key: KeyEvent) {
        match key.code {
            KeyCode::Char(c) if c.is_ascii_digit() => {
                self.number_input.push(c);
            }
            KeyCode::Backspace => {
                self.number_input.pop();
            }
            KeyCode::Enter => {
                if let Ok(value) = self.number_input.parse::<usize>() {
                    let (min, max) = self.number_range;
                    let clamped = value.clamp(min, max);
                    self.set_config_value(&self.number_target_key, &clamped.to_string());
                    self.modified = true;
                }
                self.state = ConfigScreenState::MainList;
            }
            KeyCode::Esc => {
                self.state = ConfigScreenState::MainList;
            }
            _ => {}
        }
    }
    
    fn get_config_value(&self, key: &str) -> String {
        match key {
            "language" => self.config.language.clone(),
            "context.auto_compress" => self.config.context.auto_compress.to_string(),
            "context.compress_threshold" => self.config.context.compress_threshold.to_string(),
            "context.compress_tail_turns" => self.config.context.compress_tail_turns.to_string(),
            "execution.max_iterations" => self.config.execution.max_iterations.to_string(),
            "execution.approval_policy" => self.config.execution.approval_policy.clone(),
            "output_style" => self.config.output_style.clone(),
            "vim_mode" => self.config.vim_mode.to_string(),
            _ => String::new(),
        }
    }
    
    fn set_config_value(&mut self, key: &str, value: &str) {
        match key {
            "language" => self.config.language = value.into(),
            "context.auto_compress" => self.config.context.auto_compress = value == "true",
            "context.compress_threshold" => {
                self.config.context.compress_threshold = value.parse().unwrap_or(15);
            }
            "context.compress_tail_turns" => {
                self.config.context.compress_tail_turns = value.parse().unwrap_or(15);
            }
            "execution.max_iterations" => {
                self.config.execution.max_iterations = value.parse().unwrap_or(1);
            }
            "execution.approval_policy" => self.config.execution.approval_policy = value.into(),
            "output_style" => self.config.output_style = value.into(),
            "vim_mode" => self.config.vim_mode = value == "true",
            _ => {}
        }
    }
}
7.2 渲染实现

impl ConfigScreen {
    fn render(&self, frame: &mut Frame) {
        match self.state {
            ConfigScreenState::MainList => self.render_main_list(frame),
            ConfigScreenState::EnumSelect => self.render_enum_select(frame),
            ConfigScreenState::NumberInput => self.render_number_input(frame),
            ConfigScreenState::SavePrompt => self.render_save_prompt(frame),
            ConfigScreenState::ExitPrompt => self.render_exit_prompt(frame),
        }
    }
    
    fn render_main_list(&self, frame: &mut Frame) {
        let chunks = Layout::default()
            .direction(Direction::Vertical)
            .constraints([
                Constraint::Length(3),   // 标题和范围
                Constraint::Min(10),     // 配置列表
                Constraint::Length(3),   // 底部提示
            ])
            .split(frame.area());
        
        // 标题区域
        let scope_text = match self.scope {
            ConfigScope::User => "用户级",
            ConfigScope::Project => "项目级",
        };
        let title = Paragraph::new(format!("SaCode 配置管理  |  范围: {} (Tab 切换)", scope_text))
            .block(Block::default().borders(Borders::ALL).title("配置"))
            .style(Style::default().fg(Color::Cyan));
        frame.render_widget(title, chunks[0]);
        
        // 配置列表
        let items: Vec<ListItem> = self.items
            .iter()
            .enumerate()
            .map(|(i, item)| {
                let value = self.get_config_value(&item.key);
                let display_value = self.format_display_value(&item.value_type, &value);
                
                let style = if i == self.selected_index {
                    Style::default().fg(Color::Yellow).add_modifier(Modifier::BOLD)
                } else {
                    Style::default().fg(Color::White)
                };
                
                let marker = if i == self.selected_index { "←" } else { " " };
                
                ListItem::new(Line::from(vec![
                    Span::styled(format!("  {}  ", item.display_name), style),
                    Span::styled(format!("[{}] ", display_value), Style::default().fg(Color::Green)),
                    Span::styled(marker, style),
                ]))
            })
            .collect();
        
        let list = List::new(items)
            .block(Block::default().borders(Borders::ALL));
        frame.render_widget(list, chunks[1]);
        
        // 底部提示
        let hints = Paragraph::new("↑↓ 导航  Enter 修改  Tab 切换范围  s 保存  r 重置  q/Esc 退出")
            .style(Style::default().fg(Color::Gray));
        frame.render_widget(hints, chunks[2]);
    }
    
    fn render_enum_select(&self, frame: &mut Frame) {
        let area = centered_rect(50, 50, frame.area());
        
        let items: Vec<ListItem> = self.enum_labels
            .iter()
            .enumerate()
            .map(|(i, label)| {
                let style = if i == self.enum_selected {
                    Style::default().fg(Color::Yellow).add_modifier(Modifier::BOLD)
                } else {
                    Style::default().fg(Color::White)
                };
                
                let marker = if i == self.enum_selected { "←" } else { " " };
                
                ListItem::new(Line::from(vec![
                    Span::styled(format!("    {} ", label), style),
                    Span::styled(marker, style),
                ]))
            })
            .collect();
        
        let list = List::new(items)
            .block(Block::default()
                .borders(Borders::ALL)
                .title("选择选项"));
        frame.render_widget(list, area);
    }
    
    fn render_number_input(&self, frame: &mut Frame) {
        let area = centered_rect(50, 50, frame.area());
        
        let (min, max) = self.number_range;
        
        let content = Paragraph::new(vec![
            Line::from(format!("当前值: {}", self.number_current)),
            Line::from(format!("新值:   [{}]", self.number_input)),
            Line::from(format!("范围:   {} - {}", min, max)),
        ])
        .block(Block::default()
            .borders(Borders::ALL)
            .title("输入数字"));
        
        frame.render_widget(content, area);
    }
    
    fn format_display_value(&self, value_type: &ConfigValueType, value: &str) -> String {
        match value_type {
            ConfigValueType::Bool => {
                if value == "true" { "ON" } else { "OFF" }
            }
            ConfigValueType::Enum { options, labels } => {
                let idx = options.iter().position(|opt| opt == value).unwrap_or(0);
                labels.get(idx).cloned().unwrap_or_else(|| value.into())
            }
            ConfigValueType::Number { .. } => value.into(),
        }
    }
}

fn centered_rect(percent_x: u16, percent_y: u16, r: Rect) -> Rect {
    let popup_layout = Layout::default()
        .direction(Direction::Vertical)
        .constraints([
            Constraint::Percentage((100 - percent_y) / 2),
            Constraint::Percentage(percent_y),
            Constraint::Percentage((100 - percent_y) / 2),
        ])
        .split(r);

    Layout::default()
        .direction(Direction::Horizontal)
        .constraints([
            Constraint::Percentage((100 - percent_x) / 2),
            Constraint::Percentage(percent_x),
            Constraint::Percentage((100 - percent_x) / 2),
        ])
        .split(popup_layout[1])[1]
}
8. TUI 集成
8.1 命令入口

// interfaces/cli/src/tui.rs

// 在 CommandDef 中添加
CommandDef::simple("/config", "打开交互式配置管理界面"),

// 在命令处理中添加
if trimmed == "/config" {
    self.open_config_screen();
    return;
}

fn open_config_screen(&mut self) {
    let mut config_screen = ConfigScreen::new(&self.workdir);
    
    // 保存当前 TUI 状态
    let saved_terminal = self.term.clone();
    
    // 运行配置界面
    if let Err(e) = config_screen.run(&mut saved_terminal) {
        self.show_error(format!("配置界面错误: {}", e));
    }
    
    // 配置界面退出后，重新加载配置
    self.reload_user_config();
    
    // 应用新配置
    self.apply_config_changes();
}

fn reload_user_config(&mut self) {
    let store = ConfigStore::new(&self.workdir);
    self.user_config = store.load().unwrap_or_default();
}

fn apply_config_changes(&mut self) {
    // 应用语言配置
    self.language = self.user_config.language.clone();
    
    // 应用自动压缩配置
    self.auto_compress_enabled = self.user_config.context.auto_compress;
    self.compress_threshold = self.user_config.context.compress_threshold;
    
    // 应用 vim 模式
    self.vim_mode = self.user_config.vim_mode;
    
    // 应用输出风格
    self.output_style = self.user_config.output_style.clone();
}
8.2 配置生效点
配置项	生效时机	修改模块
language	下一次 AI 调用的 system prompt	runner.rs, tui.rs
auto_compress	每条消息发送后检测	tui.rs::send_message
compress_threshold	自动压缩检测逻辑	tui.rs::check_auto_compress
max_iterations	任务执行初始化	runner.rs::run_task_with_stdin
approval_policy	工具调用审批	cmd/mod.rs, runner.rs
output_style	输出格式化	runner.rs::format_output
vim_mode	输入框进入时	tui.rs::InputMode
9. 文件结构

interfaces/cli/src/cmd/
├── config.rs              # 交互式配置界面主实现
└── mod.rs                 # 添加 Config 命令入口

runtime/src/config/
├── mod.rs                 # 配置模块导出
├── user_config.rs         # UserConfig 数据结构定义
├── config_meta.rs         # 配置项元数据定义
├── config_store.rs        # 配置存储层实现
└── config_scope.rs        # 配置范围（用户/项目）定义

interfaces/cli/src/
├── tui.rs                 # 集成 /config 命令入口
└── runner.rs              # 应用配置到任务执行
10. 测试用例
10.1 配置存储测试

#[test]
fn config_store_load_default() {
    let store = ConfigStore::new(&PathBuf::from("/tmp/test"));
    let config = store.load().unwrap();
    
    assert_eq!(config.language, "zh-CN");
    assert!(config.context.auto_compress);
    assert_eq!(config.execution.max_iterations, 1);
}

#[test]
fn config_store_save_and_load() {
    let temp_dir = tempfile::tempdir().unwrap();
    let store = ConfigStore::new(temp_dir.path());
    
    let mut config = UserConfig::default();
    config.language = "en-US".into();
    config.execution.max_iterations = 5;
    
    store.save(&config, ConfigScope::Project).unwrap();
    
    let loaded = store.load().unwrap();
    assert_eq!(loaded.language, "en-US");
    assert_eq!(loaded.execution.max_iterations, 5);
}
10.2 配置界面交互测试

#[test]
fn config_screen_toggle_bool() {
    let mut screen = ConfigScreen::new(&PathBuf::from("/tmp"));
    
    // 初始值
    assert!(screen.config.context.auto_compress);
    
    // 选中 auto_compress 项
    screen.selected_index = 1;
    screen.enter_edit_mode();
    
    // 应该变为 false
    assert!(!screen.config.context.auto_compress);
}

#[test]
fn config_screen_select_enum() {
    let mut screen = ConfigScreen::new(&PathBuf::from("/tmp"));
    
    // 选中 language 项
    screen.selected_index = 0;
    screen.enter_edit_mode();
    
    assert_eq!(screen.state, ConfigScreenState::EnumSelect);
    assert_eq!(screen.enum_options, vec!["zh-CN", "en-US"]);
    
    // 选择 en-US
    screen.enum_selected = 1;
    screen.handle_key(KeyEvent::new(KeyCode::Enter, KeyModifiers::NONE));
    
    assert_eq!(screen.config.language, "en-US");
}
11. 实现步骤
定义数据结构（user_config.rs, config_meta.rs, config_store.rs）
实现配置存储层（加载、保存、合并）
实现交互界面状态机（config.rs）
实现界面渲染（ratatui widgets）
集成 TUI 命令入口（tui.rs）
配置生效逻辑（各模块应用配置）
编写测试用例
文档和帮助信息