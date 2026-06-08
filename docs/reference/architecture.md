# SaCode 架构说明

本文档描述 SaCode 的 workspace 分层、主执行链路和关键运行数据。

## 1. 总体分层

SaCode 是一个 Rust workspace，当前成员包括：

- `kernel/`
- `runtime/`
- `interfaces/cli/`
- `interfaces/acp/`
- `interfaces/lsp/`

依赖方向：

```text
interfaces/* -> runtime -> kernel
```

## 2. 各层职责

### `kernel/` - 纯逻辑层

**设计原则**：
- 不依赖外部系统（文件系统、网络、数据库等）
- 只包含纯函数和数据结构
- 提供稳定的抽象和接口

**核心职责**：

#### Agent 抽象系统
```rust
// 核心数据结构
pub struct Agent {
    pub id: String,
    pub role: AgentRole,
    pub capabilities: Vec<Capability>,
}

pub struct Task {
    pub id: TaskId,
    pub description: String,
    pub context: TaskContext,
}
```

**职责说明**：
- 定义 agent 的基本抽象
- 提供任务执行的语义模型
- 定义 agent 间的协作协议

#### 编排与计划系统
```rust
pub struct OrchestrationPlan {
    pub steps: Vec<ExecutionStep>,
    pub dependencies: DependencyGraph,
    pub resources: ResourceRequirements,
}

pub struct ExecutionStep {
    pub id: StepId,
    pub agent: AgentId,
    pub action: Action,
    pub prerequisites: Vec<StepId>,
}
```

**职责说明**：
- 定义任务编排的语义
- 提供计划生成的抽象
- 定义执行步骤的依赖关系

#### 执行上下文与报告
```rust
pub struct ExecutionContext {
    pub task: Task,
    pub state: ExecutionState,
    pub resources: ResourceMap,
}

pub struct ExecutionReport {
    pub task_id: TaskId,
    pub status: ExecutionStatus,
    pub results: Vec<StepResult>,
    pub metrics: ExecutionMetrics,
}
```

**职责说明**：
- 定义执行过程中的上下文状态
- 提供执行结果的标准格式
- 定义审批和报告结构

#### 统一事件模型
```rust
pub enum Event {
    TaskStarted(TaskStartedEvent),
    TaskCompleted(TaskCompletedEvent),
    ToolInvoked(ToolInvokedEvent),
    ErrorOccurred(ErrorEvent),
}

pub trait EventHandler {
    fn handle(&self, event: &Event) -> Result<()>;
}
```

**职责说明**：
- 提供统一的事件模型
- 定义事件处理的接口
- 支持事件的序列化和反序列化

**依赖规则**：
```text
kernel 只能依赖：
- Rust 标准库
- 其他纯 Rust crate（如 serde, anyhow）

禁止依赖：
- 任何 I/O 操作
- 网络请求
- 文件系统操作
- 外部服务调用
```

### `runtime/` - 副作用层

**设计原则**：
- 封装所有外部系统交互
- 提供统一的副作用抽象
- 支持可测试和可模拟

**核心职责**：

#### Provider 客户端系统
```rust
pub struct ProviderClient {
    pub providers: HashMap<ProviderId, ProviderConfig>,
    pub default_provider: ProviderId,
}

impl ProviderClient {
    pub async fn chat(&self, prompt: &str) -> Result<String>;
    pub async fn chat_stream(&self, prompt: &str) -> impl Stream<Item = String>;
    pub async fn list_models(&self) -> Result<Vec<Model>>;
}
```

**职责说明**：
- 封装大模型 API 调用
- 提供统一的聊天接口
- 处理流式响应
- 管理 API 密钥和配置

#### Tool 注册与执行系统
```rust
pub struct ToolRegistry {
    pub tools: HashMap<ToolName, ToolSpec>,
}

pub trait Tool {
    fn spec(&self) -> ToolSpec;
    fn execute(&self, input: Value) -> Result<ToolOutput>;
}

pub enum SideEffectLevel {
    ReadOnly,
    Modify,
    Destructive,
}
```

**职责说明**：
- 注册和管理所有工具
- 提供统一的工具执行接口
- 定义工具的副作用级别
- 处理工具调用的权限和沙箱

#### Memory / Wiki 系统
```rust
pub struct MemorySystem {
    pub user_memory: MemoryStore,
    pub project_memory: MemoryStore,
    pub session_memory: MemoryStore,
}

pub struct WikiSystem {
    pub sources: Vec<WikiSource>,
    pub cache: WikiCache,
}
```

**职责说明**：
- 管理用户级、项目级、会话级记忆
- 提供记忆的存储和检索
- 支持 wiki 知识的加载和缓存
- 管理知识的版本和更新

#### MCP / Plugin / Skills 系统
```rust
pub struct McpManager {
    pub servers: HashMap<McpServerId, McpServer>,
}

pub struct PluginManager {
    pub plugins: Vec<Plugin>,
}

pub struct SkillHub {
    pub skills: HashMap<SkillId, Skill>,
}
```

**职责说明**：
- 管理 MCP 服务器连接
- 加载和执行插件
- 提供 skills 的注册和调用
- 处理扩展能力的生命周期

#### Workspace 扫描系统
```rust
pub struct WorkspaceScanner {
    pub root: PathBuf,
    pub config: ScanConfig,
}

pub struct ScanResult {
    pub files: Vec<File>,
    pub structure: ProjectStructure,
    pub metadata: ProjectMetadata,
}
```

**职责说明**：
- 扫描项目目录结构
- 识别项目类型和技术栈
- 生成项目元数据
- 支持增量扫描和缓存

#### Sandbox / Retry / Queue 系统
```rust
pub struct Sandbox {
    pub policy: SandboxPolicy,
}

pub struct RetryPolicy {
    pub max_attempts: usize,
    pub backoff: BackoffStrategy,
}

pub struct TaskQueue {
    pub pending: Vec<Task>,
    pub running: Vec<Task>,
    pub completed: Vec<Task>,
}
```

**职责说明**：
- 提供安全的代码执行环境
- 实现重试逻辑和错误恢复
- 管理任务队列和调度
- 处理并发执行和资源限制

#### 多 Agent 编排与模型路由
```rust
pub struct Orchestrator {
    pub agents: Vec<Agent>,
    pub router: ModelRouter,
}

pub struct ModelRouter {
    pub rules: Vec<RouterRule>,
    pub fallback: ModelSelector,
}
```

**职责说明**：
- 协调多个 agent 的执行
- 实现任务分发和结果汇总
- 提供动态模型路由
- 处理角色绑定和策略选择

**依赖规则**：
```text
runtime 可以依赖：
- kernel（核心抽象）
- 外部系统（文件系统、网络等）
- 第三方服务 API

必须实现：
- 错误处理和重试逻辑
- 资源清理和生命周期管理
- 可观察性（日志、指标）
```

### `interfaces/cli/` - 用户入口层

**设计原则**：
- 提供友好的用户界面
- 处理用户输入和输出
- 协调 runtime 和 kernel 的调用

**核心职责**：

#### CLI 命令处理
```rust
pub struct Cli {
    pub runtime: Runtime,
    pub config: CliConfig,
}

impl Cli {
    pub async fn run(&self, args: CliArgs) -> Result<()>;
    pub async fn execute_task(&self, task: Task) -> Result<TaskResult>;
}
```

**职责说明**：
- 解析命令行参数
- 分发到对应的处理函数
- 协调 runtime 的调用
- 处理用户配置和环境

#### TUI 界面
```rust
pub struct Tui {
    pub app: App,
    pub runtime: Runtime,
}

impl Tui {
    pub async fn run(&self) -> Result<()>;
    pub fn handle_input(&mut self, input: Input) -> Result<Action>;
}
```

**职责说明**：
- 提供终端用户界面
- 处理键盘和鼠标输入
- 渲染输出和状态
- 管理用户会话

#### REPL 交互
```rust
pub struct Repl {
    pub runtime: Runtime,
    pub history: History,
}

impl Repl {
    pub async fn run(&self) -> Result<()>;
    pub async fn eval(&mut self, input: &str) -> Result<String>;
}
```

**职责说明**：
- 提供交互式命令行
- 维护命令历史
- 支持命令补全
- 处理用户会话状态

#### 输出格式化
```rust
pub trait OutputFormatter {
    fn format_success(&self, result: &TaskResult) -> String;
    fn format_error(&self, error: &Error) -> String;
    fn format_progress(&self, progress: &Progress) -> String;
}
```

**职责说明**：
- 格式化不同类型的输出
- 支持多种输出格式（文本、JSON、Markdown）
- 处理彩色输出和终端特性
- 提供人类可读的错误消息

**依赖规则**：
```text
interfaces/cli 可以依赖：
- runtime（副作用执行）
- kernel（核心抽象）
- UI 库（终端、TUI 框架）

必须实现：
- 用户友好的错误消息
- 清晰的命令帮助
- 一致的输出格式
```

## 3. 主执行链路

### 3.1 基础执行链路

典型任务执行链路如下：

```text
用户输入
  ↓
CLI/TUI/REPL 解析
  ↓
任务创建与验证
  ↓
RuntimeOrchestrator 编排
  ↓
Provider 调用 + Tools 执行
  ↓
Memory/Wiki 知识注入
  ↓
Execution 生成
  ↓
事件发布与处理
  ↓
结果格式化
  ↓
TUI 或终端输出
```

#### 详细步骤说明

**步骤 1：用户输入**
```bash
# CLI 示例
sacode "分析代码结构" --mode build

# TUI 示例
用户输入：分析代码结构
```

**处理内容**：
- 解析用户输入文本
- 识别命令和参数
- 验证输入的合法性

**步骤 2：CLI/TUI/REPL 解析**
```rust
// interfaces/cli/src/cmd/mod.rs
pub async fn execute_command(args: CliArgs) -> Result<()> {
    let task = parse_task(args)?;
    let mode = determine_mode(&args);
    let config = load_config()?;
    
    execute_task(task, mode, config).await
}
```

**处理内容**：
- 命令参数解析
- 执行模式确定
- 配置加载和验证
- 环境检查

**步骤 3：任务创建与验证**
```rust
// runtime/src/execution/mod.rs
pub struct Task {
    pub id: TaskId,
    pub description: String,
    pub mode: ExecutionMode,
    pub context: TaskContext,
    pub constraints: TaskConstraints,
}

impl Task {
    pub fn validate(&self) -> Result<ValidationResult> {
        // 验证任务描述
        // 检查执行模式
        // 验证约束条件
        // 检查资源可用性
    }
}
```

**处理内容**：
- 创建任务对象
- 设置执行上下文
- 验证任务合法性
- 检查资源需求

**步骤 4：RuntimeOrchestrator 编排**
```rust
// runtime/src/agents/orchestrator.rs
pub struct RuntimeOrchestrator {
    pub agents: Vec<Agent>,
    pub router: ModelRouter,
    pub tool_registry: ToolRegistry,
}

impl RuntimeOrchestrator {
    pub async fn orchestrate(&self, task: Task) -> Result<OrchestrationResult> {
        let plan = self.create_plan(&task)?;
        let execution = self.execute_plan(plan).await?;
        let report = self.generate_report(execution)?;
        
        Ok(report)
    }
}
```

**处理内容**：
- 生成执行计划
- 选择合适的 agent
- 分配资源和模型
- 设置执行策略

**步骤 5：Provider 调用 + Tools 执行**
```rust
// runtime/src/provider/client.rs
pub struct ProviderClient {
    pub providers: HashMap<ProviderId, ProviderConfig>,
}

impl ProviderClient {
    pub async fn chat(&self, prompt: &str) -> Result<String> {
        let provider = self.select_provider(&prompt)?;
        let response = provider.call(prompt).await?;
        
        Ok(response)
    }
}

// runtime/src/tools/mod.rs
pub struct ToolExecutor {
    pub registry: ToolRegistry,
    pub sandbox: Sandbox,
}

impl ToolExecutor {
    pub async fn execute_tool(&self, tool_name: &str, input: Value) -> Result<ToolOutput> {
        let tool = self.registry.get_tool(tool_name)?;
        let result = tool.execute(input).await?;
        
        Ok(result)
    }
}
```

**处理内容**：
- 选择合适的模型 provider
- 调用大模型 API
- 执行相关工具
- 处理工具结果

**步骤 6：Memory/Wiki 知识注入**
```rust
// runtime/src/memory/mod.rs
pub struct MemoryInjector {
    pub user_memory: MemoryStore,
    pub project_memory: MemoryStore,
}

impl MemoryInjector {
    pub fn inject(&self, prompt: &str, context: &TaskContext) -> String {
        let relevant_memory = self.retrieve_relevant(prompt, context);
        format!("{}\n\nContext:\n{}", prompt, relevant_memory)
    }
}
```

**处理内容**：
- 检索相关记忆
- 加载 wiki 知识
- 注入项目上下文
- 构建完整 prompt

**步骤 7：Execution 生成**
```rust
// kernel/src/execution/mod.rs
pub struct Executor {
    pub context: ExecutionContext,
}

impl Executor {
    pub fn execute(&self, plan: ExecutionPlan) -> Result<ExecutionReport> {
        let mut state = ExecutionState::new();
        
        for step in plan.steps {
            let result = self.execute_step(&step, &mut state)?;
            state.record_result(result);
        }
        
        Ok(ExecutionReport::from(state))
    }
}
```

**处理内容**：
- 执行计划步骤
- 处理审批流程
- 记录执行状态
- 生成执行报告

**步骤 8：事件发布与处理**
```rust
// kernel/src/events/mod.rs
pub struct EventBus {
    pub subscribers: Vec<Box<dyn EventHandler>>,
}

impl EventBus {
    pub fn publish(&self, event: Event) {
        for subscriber in &self.subscribers {
            let _ = subscriber.handle(&event);
        }
    }
}
```

**处理内容**：
- 发布执行事件
- 处理订阅者回调
- 更新系统状态
- 触发后续动作

**步骤 9：结果格式化**
```rust
// interfaces/cli/src/output/formatter.rs
pub struct OutputFormatter {
    pub format: OutputFormat,
}

impl OutputFormatter {
    pub fn format(&self, report: &ExecutionReport) -> String {
        match self.format {
            OutputFormat::Text => self.format_text(report),
            OutputFormat::Json => self.format_json(report),
            OutputFormat::Markdown => self.format_markdown(report),
        }
    }
}
```

**处理内容**：
- 格式化执行结果
- 生成人类可读输出
- 处理错误消息
- 添加格式化元素

**步骤 10：TUI 或终端输出**
```rust
// interfaces/cli/src/tui/render.rs
pub struct TuiRenderer {
    pub theme: Theme,
}

impl TuiRenderer {
    pub fn render(&self, output: &str) {
        let formatted = self.apply_theme(output);
        println!("{}", formatted);
    }
}
```

**处理内容**：
- 渲染到终端
- 应用主题和样式
- 处理彩色输出
- 管理屏幕刷新

### 3.2 Role-Driven Orchestration 链路

在 role-driven orchestration 场景中，链路会扩展为：

```text
任务分析
  ↓
角色评分与路由
  ↓
子 agent 执行
  ↓
结果收集与汇总
  ↓
冲突检测与解决
  ↓
摘要生成
  ↓
CLI/TUI 展示
```

#### 详细步骤说明

**步骤 1：任务分析**
```rust
// runtime/src/agents/analyzer.rs
pub struct TaskAnalyzer {
    pub role_registry: RoleRegistry,
}

impl TaskAnalyzer {
    pub fn analyze(&self, task: &Task) -> TaskAnalysis {
        TaskAnalysis {
            complexity: self.assess_complexity(task),
            required_capabilities: self.identify_capabilities(task),
            suitable_roles: self.suggest_roles(task),
            estimated_resources: self.estimate_resources(task),
        }
    }
}
```

**处理内容**：
- 分析任务复杂度
- 识别所需能力
- 推荐合适的角色
- 估算资源需求

**步骤 2：角色评分与路由**
```rust
// runtime/src/agents/model_router.rs
pub struct ModelRouter {
    pub rules: Vec<RouterRule>,
    pub role_bindings: HashMap<Role, ModelBinding>,
}

impl ModelRouter {
    pub fn route(&self, task: &Task, analysis: &TaskAnalysis) -> RoutingDecision {
        let scores = self.score_roles(task, analysis);
        let selected_role = self.select_best_role(&scores);
        let model = self.select_model_for_role(selected_role);
        
        RoutingDecision {
            role: selected_role,
            model,
            confidence: scores[&selected_role],
        }
    }
}
```

**处理内容**：
- 为每个角色评分
- 选择最佳角色
- 绑定对应模型
- 生成路由决策

**步骤 3：子 agent 执行**
```rust
// runtime/src/agents/worker.rs
pub struct WorkerAgent {
    pub role: AgentRole,
    pub model: Model,
}

impl WorkerAgent {
    pub async fn execute(&self, task: &Task) -> AgentResult {
        let plan = self.create_plan(task)?;
        let execution = self.run_plan(plan).await?;
        
        AgentResult {
            role: self.role.clone(),
            plan,
            execution,
            summary: self.generate_summary(&execution),
        }
    }
}
```

**处理内容**：
- 创建子任务计划
- 执行具体任务
- 记录执行过程
- 生成执行摘要

**步骤 4：结果收集与汇总**
```rust
// runtime/src/agents/collector.rs
pub struct ResultCollector {
    pub agents: Vec<WorkerAgent>,
}

impl ResultCollector {
    pub fn collect(&self, results: Vec<AgentResult>) -> CollectedResults {
        CollectedResults {
            summaries: self.extract_summaries(&results),
            conflicts: self.detect_conflicts(&results),
            consensus: self.find_consensus(&results),
            gaps: self.identify_gaps(&results),
        }
    }
}
```

**处理内容**：
- 收集所有 agent 结果
- 提取关键摘要
- 检测冲突和分歧
- 寻找共识点

**步骤 5：冲突检测与解决**
```rust
// kernel/src/conflict/mod.rs
pub struct ConflictResolver {
    pub strategies: Vec<ResolutionStrategy>,
}

impl ConflictResolver {
    pub fn resolve(&self, conflicts: Vec<Conflict>) -> ResolutionResult {
        let resolved = conflicts.into_iter()
            .map(|conflict| self.resolve_single(conflict))
            .collect();
        
        ResolutionResult {
            resolved_conflicts: resolved,
            unresolved: vec![],
            strategy_used: self.select_strategy(),
        }
    }
}
```

**处理内容**：
- 识别冲突类型
- 应用解决策略
- 生成解决方案
- 记录解决过程

**步骤 6：摘要生成**
```rust
// runtime/src/agents/summary_compactor.rs
pub struct SummaryCompactor {
    pub compression_level: CompressionLevel,
}

impl SummaryCompactor {
    pub fn compact(&self, results: &CollectedResults) -> SummaryRecord {
        SummaryRecord {
            task: results.task.clone(),
            consensus: results.consensus.clone(),
            conflicts: results.conflicts.clone(),
            resolutions: results.resolutions.clone(),
            recommendations: self.generate_recommendations(results),
        }
    }
}
```

**处理内容**：
- 压缩冗余信息
- 提取关键结论
- 生成结构化摘要
- 提供建议和推荐

**步骤 7：CLI/TUI 展示**
```rust
// interfaces/cli/src/tui/render/summary.rs
pub struct SummaryRenderer {
    pub format: SummaryFormat,
}

impl SummaryRenderer {
    pub fn render(&self, summary: &SummaryRecord) -> String {
        match self.format {
            SummaryFormat::Detailed => self.render_detailed(summary),
            SummaryFormat::Concise => self.render_concise(summary),
            SummaryFormat::Visual => self.render_visual(summary),
        }
    }
}
```

**处理内容**：
- 渲染摘要内容
- 显示冲突和解决
- 展示建议和推荐
- 提供交互式查看

### 3.3 执行模式差异

不同执行模式在链路中的差异：

#### Plan 模式
```text
用户输入
  ↓
任务分析（深度）
  ↓
方案生成（多个）
  ↓
方案评估（详细）
  ↓
推荐方案展示
  ↓
用户选择
  ↓
详细计划输出
```

**特点**：
- 不实际执行修改
- 生成多个方案供选择
- 详细的评估和建议
- 适合规划和设计

#### Build 模式
```text
用户输入
  ↓
任务分析（适中）
  ↓
方案生成（推荐）
  ↓
执行计划确认
  ↓
逐步执行（带审批）
  ↓
每个步骤确认
  ↓
测试和验证
  ↓
最终确认
```

**特点**：
- 实际执行修改
- 每步都需要确认
- 保留审批节点
- 适合日常开发

#### Yolo 模式
```text
用户输入
  ↓
任务分析（快速）
  ↓
方案生成（直接）
  ↓
自动执行（无审批）
  ↓
批量处理
  ↓
结果汇总
  ↓
自动提交
```

**特点**：
- 完全自动执行
- 无需人工确认
- 批量处理
- 适合高确定性任务

### 3.4 错误处理链路

```text
错误发生
  ↓
错误分类
  ↓
错误上下文收集
  ↓
重试策略应用
  ↓
失败处理
  ↓
错误报告生成
  ↓
用户通知
  ↓
恢复策略执行
```

**错误类型**：
- **网络错误**：自动重试，指数退避
- **API 错误**：降级到备用模型
- **权限错误**：提示用户检查配置
- **逻辑错误**：记录错题本，建议修复方案
- **系统错误**：生成诊断报告

## 4. 命令入口

CLI 主入口在：

- `interfaces/cli/src/cmd/mod.rs`

二进制定义在：

- `interfaces/cli/Cargo.toml`

当前可执行文件：

- `sacode`
- `sacode-tui`

## 5. 运行时能力模块

### Tool 系统

`runtime/src/tools/` 当前包括：

- `fs`
- `shell`
- `git`
- `web`
- `browser`
- `media`
- `interaction`
- `task`
- `code`

每个工具通过统一 `ToolSpec` 和 `SideEffectLevel` 暴露给执行器。

### 模型与路由

模型相关能力分散在：

- `runtime/src/provider/`
- `runtime/src/model_routing/`
- `runtime/src/agents/model_router.rs`

当前方向包括：

- 任务画像 `TaskProfile`
- 节点级动态模型路由
- 失败切换上下文 `FailoverContext`
- 角色绑定模型策略

### 多 agent 编排

编排相关代码主要位于：

- `runtime/src/agents/orchestrator.rs`
- `runtime/src/agents/worker.rs`
- `runtime/src/agents/summary_compactor.rs`
- `runtime/src/agents/role_registry.rs`

当前重点包括：

- 结构化摘要 `SummaryRecord`
- 结构化冲突 `ConflictRecord`
- 角色结论压缩
- TUI 编排可视化

### Memory / Wiki

知识相关能力位于：

- `runtime/src/memory/`
- `runtime/src/wiki/`

目标是把用户级和项目级知识接到同一条上下文注入链路。

## 6. 配置与数据落点

项目级运行数据写入 `.sacode/`：

- `provider.json`
- `mcp.json`
- `profile.json`
- `mistakes.json`
- `project.json`
- `skills/`
- `checkpoints/`

调试日志常见位置：

- `~/.sacode/logs/tui.log`

## 7. 发布与分发

发布相关目录：

- `npm-package/`
- `scripts/`
- `docs/release/RELEASE.md`

版本真源：

- 根 `Cargo.toml` 的 `[workspace.package].version`

## 8. 当前架构重点

SaCode 当前的工程重点主要集中在：

1. 统一 CLI / REPL / TUI 执行状态机
2. 强化多 agent 编排摘要与冲突闭环
3. 收敛动态模型路由
4. 把 memory / wiki / insight 接入稳定知识链路
5. 持续提升 TUI 可观察性和可维护性

## 9. 相关文档

- [API 文档](API.md) — 工具系统、Daemon、MCP 接口说明
- [开发指南](development.md) — 本地开发与贡献
- [命令参考](command-reference.md) — CLI / TUI 命令速查
- [产品 PRD](../product/PRD.md) — 产品定位与能力全景
- [功能升级方案](../plans/capability-upgrade-plan.md) — 当前工具与架构补齐计划
