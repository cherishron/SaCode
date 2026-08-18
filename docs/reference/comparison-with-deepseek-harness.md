# SaCode 与 deepseek-harness 对比分析

本文档对 SaCode 与 [deepseek-harness](https://github.com/deepseek-ai/deepseek-harness)（DeepSeek AI 开源的 Agent 运行底座，下文简称 **DSH**）进行系统性对比，目的是为 SaCode 的后续架构演进提供外部参照与决策依据。

- 受众：SaCode 维护者与潜在贡献者
- SaCode 版本基线：`0.1.33`（v1.0+ 能力已落地，版本号未发布）
- DSH 版本基线：开发者预览 `v0.1`（MIT，TypeScript/pnpm monorepo）

---

## 1. 对比方法论

### 1.1 选取维度的原则

对比两个 Agent 运行底座，不应只看"功能清单"，而应从**架构哲学 → 运行时模型 → 扩展机制 → 可观测性 → 生态成熟度**逐层展开。本文采用 **7 维评估矩阵**，每个维度给出明确的评判标准，避免主观打分。

### 1.2 七个对比维度

| # | 维度 | 评判标准 |
| --- | --- | --- |
| 1 | 架构哲学 | 扩展性、内聚性、学习曲线 |
| 2 | 扩展机制 | 插件生命周期管理、配置组合灵活性 |
| 3 | 工具系统 | 工具执行可拦截性、审批/遥测挂载点 |
| 4 | 会话管理 | 可回放性、上下文重建保真度 |
| 5 | 沙箱/执行环境 | 执行环境可替换性、远程迁移成本 |
| 6 | Agent 驱动模型 | Agent 行为调整成本、循环可替换性 |
| 7 | 模型层抽象 | 模型切换成本、请求拦截能力 |

### 1.3 借鉴评估的硬约束

借鉴任何一项设计前，必须通过以下三道闸门：

1. **已有抽象复用空间**：SaCode 已有 `Event` 枚举（11 变体）/`EventHistory`/`PluginManager`/MCP/skills 等抽象，能复用就不推倒重来。
2. **Rust 语言约束**：Rust 无运行时插件热加载，WASM 是更现实的动态扩展路径；所有权模型与 TypeScript 的引用语义差异需谨慎处理。
3. **灵枢既有优势不被削弱**：自组织（角色驱动编排）、自防护（五维冲突检测 + 实时干预）、学习型记忆（自动沉淀 + BM25 + 衰减）三大优势不能因借鉴而退化。

---

## 2. 架构对比矩阵

### 2.1 总览

| 维度 | SaCode 现状 | DSH 做法 | 核心差异 |
| --- | --- | --- | --- |
| 架构哲学 | 灵枢三子系统 + `kernel/runtime/interfaces` 三层静态分层 | "一切皆插件" + Cordis 时空可组合性 + 插件树 | SaCode 重内聚与稳定内核；DSH 重可组合与可替换 |
| 扩展机制 | WASM 插件 + MCP + skills + `register_dynamic_role` | 插件树 + Profile/Bundle/Patch 配置组合 | DSH 把"运行什么"完全配置化；SaCode 偏代码注册 |
| 工具系统 | 29 工具分层（Core/Extended）+ `for_prompt(role,profile,budget)` 注入 | `tool/call → pre-execute → execute → post-execute → result` 事件流水线 | DSH 工具执行全链路可拦截；SaCode 审批集中在 `sandbox_guard.rs` |
| 会话管理 | `EventHistory` 内存缓冲 + `audit.log` 持久化 + SSE replay + checkpoint | 事件流投影重建（"模型看到的必须能从日志重建"） | DSH 会话即事件投影；SaCode 事件是状态旁路（已有 replay 雏形） |
| 沙箱/执行环境 | `sandbox_guard.rs` 审批 + `audit.log` 审计，工具直接调 `std::fs`/`std::process` | 能力接口设计，FS/进程/Bash/PTY/LSP 共享执行世界 | DSH 换远程沙箱零改工具；SaCode 工具绑定本地系统调用 |
| Agent 驱动 | orchestrator + worker + role_registry + DAG 死锁防护 | turn/step 拆分 + Agent Loop 可替换 | DSH 调整 Agent 行为只换 Loop；SaCode 需改 orchestrator |
| 模型层 | `model_routing/` 智能路由 + 故障转移 + provider client | `llm/llm` 适配器 + `agent/pre-step`/`request`/`llm/stream` 拦截点 | DSH 请求全链路有拦截点；SaCode 路由决策集中、拦截点少 |

### 2.2 关键差异说明

#### 2.2.1 架构哲学：静态分层 vs 插件树

SaCode 的 `kernel/runtime/interfaces` 三层是**编译期固定**的依赖方向（`interfaces/* -> runtime -> kernel`），优点是依赖清晰、编译时保证、性能可预测；缺点是"换一个执行环境"需要改 runtime 代码。

DSH 的"一切皆插件"把运行时组织成一棵**插件树**，通过 Profile（命名运行组合，如 `web`/`headless`）+ Bundle（可分发插件组合）+ Patch（叠加配置）决定实际加载内容。`dsh --profile web --dump-config` 可查看实际生效配置。优点是部署差异进配置而非分支代码；缺点是学习曲线陡峭（需理解 Cordis 时空可组合性范式）。

#### 2.2.2 工具系统：分层注入 vs 事件流水线

SaCode 的 `ToolRegistry::for_prompt(role, profile, budget)` 在**注入阶段**做筛选（按角色白名单 + 任务画像 + token 预算），工具执行时由 `sandbox_guard.rs` 统一审批审计。这是一个"注册期灵活、执行期固定"的模型。

DSH 把工具执行拆成 `tool/call → tools/pre-execute → tools/execute → tools/post-execute → tool/result` 五个事件，审批/超时/遥测/策略检查都挂到事件上。这是一个"执行期可插拔"的模型——同一个工具在不同 Profile 下可以挂不同审批策略，无需改工具代码。

#### 2.2.3 会话管理：状态对象 + replay 雏形 vs 事件投影

SaCode 的会话是**状态对象 + 事件旁路**：
- `ExecutionReport.events: Vec<Event>` 是状态对象的可变字段。
- `runtime/src/daemon/types.rs` 的 `EventHistory` 已实现事件流重建的**核心机制**：`seq: AtomicU64` 单调序号 + `VecDeque` 环形缓冲 + `replay_after(last_seq)` 按序号回放。
- `runtime/src/streaming/sse.rs` 的 `stream_from_broadcast_with_replay()` 已支持 Last-Event-ID 续传——客户端断线重连时先回放历史事件，再切 live broadcast。
- `audit.log`（JSON 行）记录工具执行的 `preflight_start`/`preflight_allowed`/`preflight_blocked`/`execution_result` 阶段。
- checkpoint 作为快照加速冷启动。

**关键**：事件是状态的**旁路输出**（用于 UI 订阅与断线重连），不是真相源。`EventHistory` 缺持久化（仅内存缓冲），事件流与状态对象可能不一致。

DSH 的会话是**事件投影**：`SessionEvent` 日志是唯一真相源，"模型看到的内容必须能从日志重建"。会话历史不是内存数组，而是从事件流投影出来，保留原始 `assistant/chunk` 事件，支持 UI 展示与回放。状态是事件的衍生物。

这是两者最根本的设计差异，也是 DSH 最值得借鉴的一点（详见 §3.1）。

#### 2.2.4 沙箱：本地绑定 vs 能力接口

SaCode 的工具直接调用 `std::fs`/`std::process`，`sandbox_guard.rs` 负责审批审计但**不抽象执行环境**。要把工具迁移到远程沙箱，需逐个工具改实现。

DSH 的 FS、进程、Bash、PTY、LSP 共享同一个"执行世界"能力接口。换远程沙箱只需替换 FS + 进程提供方，工具自动迁移，无需改远程分支代码。

---

## 3. DSH 可借鉴优点

以下 5 个借鉴点按"价值/复杂度"综合排序，每个含五部分分析：**DSH 做法 → SaCode 现状（基于实际源码） → 借鉴可行性 → 建议方向 → 风险**。

### 3.1 事件流投影重建会话（强烈推荐）

#### DSH 做法

DSH 的 `core/session` 把"会话"定义为 `SessionEvent` 日志的投影，而非内存中的状态对象。硬性规则是：**"模型看到的内容必须能从日志重建"**。

- 会话历史不是 `Vec<Message>`，而是从 `SessionEvent` 流按时间序投影出来。
- 保留原始 `assistant/chunk` 事件（流式分片），UI 展示与回放均从事件流派生。
- 任何状态（当前消息列表、工具调用历史、审批状态）都是事件流的纯函数投影，无独立可变状态。
- 这本质上是 **Event Sourcing** 模式在 Agent 运行底座的应用。

#### SaCode 现状（源码核实）

SaCode 已有事件流重建的**半成品基础设施**，但事件尚未成为真相源：

- **`kernel/src/event.rs`** 定义了 `Event` 枚举，共 11 个变体（比一般认知更丰富）：
  - `Message` / `Thinking` / `PlanGenerated`
  - `ToolCallStarted` / `ToolCallFinished`（含 `name`/`input`/`output`/`success`）
  - `ApprovalRequested` / `ApprovalResolved`
  - `FileChanged` / `CommandOutput`
  - `Done` / `Error`
  - 配套有 `is_terminal()` / `requires_approval()` 辅助方法。
- **`runtime/src/daemon/types.rs`** 的 `EventHistory` 已实现事件流重建的核心机制：
  - `seq: AtomicU64` 单调递增序号
  - `buffer: VecDeque<(u64, StreamEvent)>` 环形缓冲
  - `replay_after(last_seq: u64) -> Vec<(u64, StreamEvent)>` 支持按序号回放
  - `current_seq()` 查询当前最大序号
- **`runtime/src/streaming/sse.rs`** 的 `stream_from_broadcast_with_replay()` 已实现 Last-Event-ID 续传：
  - 客户端断线重连时，先回放 `seq > last_event_id` 的历史事件
  - 再切换到 live broadcast，跳过已回放的事件避免重复
  - 这是**端到端流式任务无中断**的关键机制
- **`StreamEvent`** 结构：`{ task_id, event_type, data, seq }`，`seq` 用 `#[serde(skip)]` 确保不污染 SSE payload。
- **`audit.log`**：`sandbox_guard.rs` 的 `write_audit_log()` 写入 `.sacode/audit.log`（JSON 行格式），记录 `preflight_start`/`preflight_allowed`/`preflight_blocked`/`execution_result` 等阶段。

**核心差距**：事件是**状态的旁路输出**（用于 UI 订阅与断线重连），不是真相源。`ExecutionReport.events` 是独立可变状态，`EventHistory` 仅内存缓冲（缺持久化），事件流与状态可能不一致。

#### 借鉴可行性：高

SaCode 已具备 DSH 事件流重建所需的 80% 基础设施：
- `EventHistory` + `replay_after` = 事件日志回放能力（缺持久化）
- `StreamEvent.seq` + Last-Event-ID = 序号化事件流（缺跨会话保留）
- `Event` 枚举 11 变体 = 事件类型完备性（缺 `assistant/chunk` 流式分片）

缺的是**设计决策**而非代码：把事件流从"旁路"提升为"真相源"，让状态成为投影。

#### 建议方向

分三步渐进演进，每步可独立验证：

**第一步（v1.1 短期）：事件日志持久化**
- 扩展 `EventHistory`，把 `buffer` 从内存 `VecDeque` 升级为内存 + `.sacode/events.log` 双写。
- 事件结构扩展 `assistant/chunk` 变体，保留模型流式输出的原始分片。
- `replay_after()` 支持从持久化日志回放，而非仅内存缓冲。
- 此步不改变状态对象地位，只增加"可回放的事件日志"能力。

**第二步（v1.2 中期）：状态作为事件投影**
- `ExecutionReport.events` 改为从 `EventHistory` 投影的只读视图，不再独立可变。
- checkpoint 改为事件流的周期性快照（加速冷启动回放），而非独立状态源。
- `audit.log` 合并进 `events.log`，统一为 `SessionEvent` 流。

**第三步（v2.0 长期）：完整 Event Sourcing**
- 引入 `SessionEventLog` 作为会话唯一真相源，所有状态查询走投影函数。
- 支持时间旅行调试：回放任意时间点的会话状态。
- 灵枢自防护的"五维冲突检测"改为事件投影层的纯函数检查。

#### 风险

1. **投影幂等性**：回放同一事件流必须产生相同状态。需保证事件不含随机数、时间戳等非确定性字段，或把这些字段事件化。
2. **事件版本演进**：事件结构变更需支持旧日志回放（版本号 + 迁移函数）。
3. **灵枢对齐**：自防护的 `InterventionRequest`、自愈合的故障转移路由需在事件投影层重新对齐，避免状态不一致导致漏检。
4. **性能**：长会话的事件流回放可能慢于直接读状态快照，需 checkpoint 加速。

---

### 3.2 工具执行事件流水线（推荐）

#### DSH 做法

DSH 把工具执行拆成五阶段事件链，每阶段可挂载多个拦截器：

```
tool/call → tools/pre-execute → tools/execute → tools/post-execute → tool/result
```

- `pre-execute`：审批、参数校验、策略检查、超时设置
- `execute`：实际工具执行
- `post-execute`：结果转换、遥测记录、成功/失败分支
- `result`：最终结果返回给 Agent Loop
- 拦截器是独立插件，可按 Profile 挂载不同组合，无需改工具代码。

#### SaCode 现状（源码核实）

SaCode 的 `sandbox_guard.rs` 已有**三阶段雏形**，但耦合在自由函数中，非可插拔：

- **`preflight(spec, input) -> Result<()>`**（`sandbox_guard.rs:10`）：
  - 写 `preflight_start` 审计日志
  - 网络访问检查（`required_network_access` + `policy.check_network`）
  - `task.spawn` 权限检查
  - 命令黑名单检查（`extract_command` + `policy.check_command`）
  - 路径访问检查（`extract_paths` + `policy.check_path`）
  - 写 `preflight_allowed` 或 `preflight_blocked` 审计日志
- **`audit_execution_result(spec, input, output, error)`**（`sandbox_guard.rs:95`）：
  - 计算 `status`（`error`/`success`/`failure`）
  - 写 `execution_result` 审计日志，含 `success`/`message`/`data` 字段
- **`write_audit_log(tool_name, phase, status, input, extra)`**（`sandbox_guard.rs:138`）：
  - 写入 `.sacode/audit.log`（JSON 行）
  - 阶段值：`preflight_start`/`preflight_allowed`/`preflight_blocked`/`execution_result`

**核心差距**：
1. 审批逻辑是**硬编码的自由函数**，非可注册的 trait —— 想加新拦截器需改 `preflight` 源码。
2. 缺 `post-execute` 阶段（结果转换、遥测、重试策略等无挂载点）。
3. 审计日志是副作用，非可订阅的事件流（与 §3.1 的事件流不通）。

#### 借鉴可行性：中高

`sandbox_guard.rs` 已是事实上的 `pre-execute` + `on_result` 拦截点，扩展为完整事件链是**渐进式改造**，不需推翻现有设计。`Event` 枚举已有 `ToolCallStarted`/`ToolCallFinished` 变体，可直接复用。

#### 建议方向

**第一步（v1.1 短期）：抽象 `ToolInterceptor` trait**

```rust
pub trait ToolInterceptor: Send + Sync {
    fn pre_execute(
        &self,
        spec: &ToolSpec,
        input: &serde_json::Value,
    ) -> Result<PreExecuteDecision>;

    fn post_execute(
        &self,
        spec: &ToolSpec,
        input: &serde_json::Value,
        result: &ToolOutput,
    ) -> Result<PostExecuteDecision>;
}

pub enum PreExecuteDecision {
    Allow,
    Deny { reason: String },
    Modify { new_input: serde_json::Value },  // 支持参数改写
}

pub enum PostExecuteDecision {
    Keep,
    Retry { max_attempts: usize },
    Transform { new_output: ToolOutput },
}
```

- 把 `preflight()` 的网络/命令/路径检查拆为三个独立 `ToolInterceptor` 实现。
- `audit_execution_result()` 拆为 `AuditInterceptor`。
- 拦截器通过 `ToolRegistry::register_interceptor()` 注册，按注册顺序执行。

**第二步（v1.2 中期）：事件化执行流水线**
- 把拦截器调用发布为 `Event::ToolCallStarted`/`ToolCallFinished` 事件，接入 §3.1 的事件流。
- 支持异步拦截器（如人工审批 UI、远程策略服务）。
- 保留 `for_prompt` 的注册期筛选（控制 prompt 膨胀），事件流水线只管执行期行为。

**第三步：按 Profile 挂载拦截器组合**
- 不同 Profile 可挂载不同拦截器组合（如 CI 环境挂严格策略，本地挂宽松策略）。

#### 风险

1. **延迟**：拦截器链增加单次工具调用延迟，需控制拦截器数量（建议 ≤5），异步拦截器需设超时。
2. **顺序依赖**：拦截器间可能有顺序依赖（如审批必须在参数校验后），需提供优先级机制。
3. **`Modify` 决策的安全性**：参数改写可能破坏工具契约，需限制可改写的字段白名单。
4. **向后兼容**：现有 `preflight()` 的调用点需保持行为不变，迁移期可让 `ToolInterceptor` 默认实现包装现有逻辑。

---

### 3.3 执行环境能力接口（推荐）

#### DSH 做法

DSH 的 FS、进程、Bash、PTY、LSP 共享同一个"执行世界"能力接口：

- 工具不直接调用系统 API，而是通过注入的能力接口操作。
- 本地执行：能力接口实现为本地 FS/进程调用。
- 远程沙箱：只需替换 FS + 进程提供方为远程实现，工具代码零改迁移。
- 支持多种沙箱后端：本地、Docker、远程 VM、gVisor 等，切换零改工具。

#### SaCode 现状（源码核实）

SaCode 的工具**直接绑定本地系统调用**：

- **`fs.read`/`fs.write`/`fs.edit`**：直接调 `std::fs::read`/`std::fs::write`。
- **`shell.exec`**（`runtime/src/tools/shell/exec.rs`）：
  - Windows 检测 shell 操作符（`|` `>` `&&`）或内置命令时，用 `cmd.exe /C` 包装（`needs_cmd_wrapper`）
  - Unix 对称地用 `sh -c` 包装（`needs_sh_wrapper`）
  - 直接调 `std::process::Command`
- **`fs.search`**：纯 Rust 实现（`std::fs` + `regex`），无外部 `grep` 依赖。
- **`code.symbols`/`code.deps`/`code.search`**：基于 tree-sitter AST 解析，文件读取走 `std::fs`。
- **`test.run`/`test.fix`**：通过 `shell.exec` 间接调系统进程。

**核心差距**：所有工具硬编码本地系统调用，无抽象层。要把工具迁移到远程沙箱（如 Docker、远程 VM），需逐个工具改实现，29 个工具的迁移工作量巨大。

#### 借鉴可行性：中

- **有利因素**：Rust 的 trait 系统天然适合抽象能力接口；`shell.exec` 的 `needs_cmd_wrapper` 已有平台抽象意识。
- **不利因素**：29 工具调用点分散，迁移工作量大；trait 对象的动态分发有微小开销；需保证 `LocalContext` 行为与 `std::fs` 完全一致避免回归。
- **复用空间**：`shell.exec` 的平台包装逻辑可沉淀到 `ExecutionContext::exec()` 实现中。

#### 建议方向

**第一步（v1.2 中期）：定义 `ExecutionContext` trait**

> **状态：已完成（2026-08-18）**
> - 新增 `runtime/src/tools/context.rs`：`ExecutionContext` trait（同步 `Send+Sync`）+ `LocalContext` 实现 + `set_default_context`/`current_context` 注入入口。
> - trait 方法：`read_text` / `write_text` / `append_text` / `exists` / `exec`（返回 `CommandOutput`）。
> - 设计取舍：采用**同步** trait（非 async），避免为高频 `fs.read` 引入 `spawn_blocking` 线程池开销；`LocalContext` 通过进程级 `OnceLock<Arc<dyn ExecutionContext>>` 支持运行时替换。
> - `shell.exec` 的平台包装逻辑（`needs_cmd_wrapper`/`needs_sh_wrapper` + 危险命令检查）抽取为 `run_local_command`，被 `LocalContext::exec` 复用，保证零回归。

**第二步：核心层工具试点**
> **状态：已完成（2026-08-18）**
- 核心层 4 工具全部走 `ExecutionContext`：`fs.read`/`fs.write`/`fs.edit`/`shell.exec`。
  - `fs.read`/`fs.write`/`fs.edit` 通过 `current_context()` 调用 `read_text`/`write_text`/`append_text`/`exists`（不再直接 `std::fs`）。
  - `shell.exec` 核心逻辑走 `run_local_command` → `LocalContext::exec`，保持原有沙箱后端与平台包装。
- runtime 测试全绿（520 passed lib），含新增 `local_context_*` 三个单元测试。

**第三步：扩展层工具迁移**（部分完成）
> **FS 类试点已完成（2026-08-18）**
- `ExecutionContext` 补齐 `read_bytes` / `list_dir`（含 `DirEntry`/`EntryType`）两个扩展能力，`LocalContext` 实现复用 `std::fs`。
- `fs.list` / `fs.read_multi` 已迁移走 `current_context()`（取代 `std::fs::read_dir`/`read_to_string`）。
- 待迁移：FS 类剩余 `fs.search`/`fs.patch`/`fs.apply_patch` → Shell 类（`git.*`/`test.*`，已间通过 `shell.exec`/`active_backend` 走沙箱）→ 其他（`code.*`/`media.*`/`web.*`/`browser.*`/`interaction.*`/`task.spawn`）。
- 每类迁移后跑测试，分批合入。扩展层大多数工具已通过沙箱后端间接调用系统，全量硬改收益低、风险高，建议按需推进。

**第四步：远程沙箱实现**
> **状态：RemoteContext 雏形已完成（2026-08-18）**
- 新增 `runtime/src/tools/context_remote.rs`：`RemoteContext` 实现 `ExecutionContext`，通过可配置 `command_prefix`（如 `["ssh","user@host"]` / `["docker","exec","-i","container"]`）把每个 FS/exec 操作翻译为远程命令。
  - `read_text`/`read_bytes` → 远程 `cat`；`write_text`/`append_text` → 远程 `printf`（含 `mkdir -p` 父目录创建）；`exists` → 远程 `test -e`；`list_dir` → 远程 `ls -1p` 解析；`exec` → 前缀透传。
  - 二进制安全限制：`read_bytes` 当前走文本通道（不保证二进制保真），生产级需 base64 编码回传或 gRPC 二进制流——已在模块文档与测试中标明。
- **核心价值闭环验证**：`set_default_context(Arc::new(RemoteContext::new(prefix)))` 即可把全部工具的整体执行世界切换到远程，**工具代码零改**（这正是 DSH §3.3 的核心优势）。
- 测试策略：Windows CI 上验证命令前缀注入（`wrap` 逻辑）+ `set_default_context` 注入生效；真实 POSIX FS IO 用 `#[cfg(unix)]` 隔离（远端语义假设为 *nix shell）。
- 下一步增强（非必做）：base64 二进制通道、远端 `stat` 补 size、gRPC/Docker 真实后端、CLI `--sandbox remote:...` 配置接入。

#### 风险

1. **性能**：`dyn Trait` 动态分发有微小开销，高频工具（如 `fs.read`）可考虑泛型单态化（但会增加二进制体积）。
2. **行为一致性**：`LocalContext` 必须完全复刻现有 `std::fs` 行为（如符号链接处理、权限检查、错误类型），任何偏差都是回归。
3. **异步化**：`std::fs` 是同步的，`ExecutionContext` 若用 `async`，需 `spawn_blocking` 包装，注意线程池调优。
4. **平台差异**：`shell.exec` 的 Windows/Unix 包装逻辑必须完整迁移到 `LocalContext::exec()`，不能丢失 `needs_cmd_wrapper` 的检测逻辑。
5. **迁移顺序**：核心层工具改完后，扩展层工具若未改会混用两套 API，需在迁移期保持兼容。

---

### 3.4 Profile/Bundle 配置组合（中期）

#### DSH 做法

DSH 用三层配置组合管理部署差异：

- **Profile**：命名运行组合，如 `web`（Web UI 模式）、`headless`（无头模式）。`dsh --profile web` 加载对应组合。
- **Bundle**：可分发的插件组合，把"哪些插件 + 哪些配置"打包为一个单元。
- **Patch**：叠加配置，用于在基线之上做局部覆盖（如团队基线 + 个人覆盖）。
- `dsh --profile web --dump-config` 查看实际生效的完整配置，便于调试。

#### SaCode 现状（源码核实）

SaCode 用 `.sacode/` 下多个 JSON 文件管理配置，**无命名组合语义**：

- `provider.json`：模型 provider 配置
- `mcp.json`：MCP 服务器配置
- `profile.json`：任务画像配置（`TaskProfile`，用于 `for_prompt` 筛选）——**注意**：这里的 "profile" 是"任务画像"语义，不是 DSH 的"命名运行组合"语义。
- `project.json`：项目级配置
- `mistakes.json`：学习型记忆的 mistakes 沉淀
- `audit.log`：沙箱审计日志
- `skills/`：skills 目录
- `checkpoints/`：checkpoint 快照

**核心差距**：
1. 配置是**平铺的多个文件**，无"命名组合"概念——切换工作模式需手动改多个文件。
2. 无 Bundle 分发能力——无法把"某团队的工具集 + 角色 + 模型路由"打包共享。
3. 无 Patch 叠加机制——团队共享配置与个人覆盖混在同一文件。
4. 无 `--dump-config` 式的生效配置快照——调试时需手动拼凑多个文件。

#### 借鉴可行性：中

- **有利因素**：配置层改造不影响核心执行链路，可独立推进；现有 JSON 文件结构清晰。
- **不利因素**：`profile.json` 已占用 "profile" 词，需重命名或区分语义，避免混淆。
- **复用空间**：现有 `TaskProfile` 可保留为 Bundle 内的一个组件。

#### 建议方向

**第一步（v1.2 中期）：引入命名 Profile 概念**

```toml
# .sacode/profiles/web.toml
name = "web"
extends = "default"  # 继承 default profile
[provider]
model = "deepseek-chat"
[tools]
enabled = ["fs.*", "shell.exec", "web.*"]
[mcp]
servers = ["web-search"]
```

- `sacode --profile web` 加载 `.sacode/profiles/web.toml`。
- 现有 `profile.json`（任务画像）重命名为 `task-profile.json`，消除命名冲突。
- Profile 可 `extends` 继承，支持层级组合。

**第二步：引入 Bundle 概念**
- Bundle 把"工具集 + 角色 + 模型路由 + MCP 服务器 + 拦截器组合"打包为一个可分发单元。
- Bundle 文件格式：`.sacode/bundles/<name>.bundle.toml`。
- 支持 `sacode bundle export <name>` 导出、`sacode bundle import <file>` 导入。

**第三步：引入 Patch 机制**
- Patch 文件格式：`.sacode/patches/<name>.patch.toml`。
- 支持团队共享基线 Patch（如 `.sacode/patches/team-base.patch.toml`）+ 个人覆盖 Patch。
- Patch 按 `priority` 字段排序叠加。

**第四步：`--dump-config` 调试能力**
- `sacode --profile web --dump-config` 输出实际生效的完整配置（JSON）。
- 标注每个配置项的来源（哪个 Profile/Bundle/Patch），便于排查冲突。

> **状态：第一步 + 第二步 + 第三步 + 第四步 深化已完成（2026-08-18）**
> - 第一步（命名 Profile）：`runtime/src/config/profile.rs` 的 `ProfileManifest` + `Profile`（含 `extends` 单一父链继承 + 循环检测）+ `resolve_tools`（glob 过滤）。格式 JSON（`.sacode/profiles/<name>.json`）。
> - **第二步（Bundle 可分发单元，闭环）**：新增 `BundleManifest` + `export_bundle`/`import_bundle`；CLI 新增 `sacode bundle export <name> [--profile <p>]` / `sacode bundle import <path>` / `sacode bundle ls`，落盘 `.sacode/bundles/<name>.bundle.json`，支持跨项目分发。
> - **第三步（Patch 叠加）**：新增 `PatchManifest` + `PatchSet::load_all`（扫描 `.sacode/patches/*.patch.json`，按 `priority` 升序排序叠加，高 priority 覆盖低 priority）；`PatchSet::apply_onto` 叠加到 Profile/基线。
> - **Profile 真正驱动工具集（接入 `for_prompt`）**：`ToolRegistry::for_prompt_with_profile(role, task_profile, profile, budget)` 在既有角色/任务画像筛选之上，再用 Profile 的 `enabled_tools`/`disabled_tools`（glob）做最终约束，**核心层 4 工具始终保留**。已贯通到 `run_sub_agent` / 单 Agent 路径 / `execute_role_driven_orchestration` 全链路，`sacode --profile web` 现在**真正影响注入的工具集**（非仅 dump）。
> - **第四步（--dump-config）**：`dump_effective_config` 现已展示 `applied_patches` 来源链；`sacode dump-config --profile web` 端到端验证通过。
> - 测试：`config::profile` 5 项（解析/继承/循环/Patch 排序叠加/Bundle 往返）+ `tools::for_prompt_with_profile` 3 项（约束/无 Profile 退化/disabled 剔除）全绿；runtime lib 全量 535 passed。`bundle export` / `dump-config --profile` 端到端验证通过。
> - 风险已规避：命名 Profile 走独立 `profiles/` 子目录，不破坏 `profile.json` 任务画像语义；循环继承检测保留。
> - 待做（可选增强）：Patch 真正写入磁盘编辑（当前 PatchSet 为只读叠加层）、Bundle 接入模型路由/角色注册表实际加载链（当前 Bundle 数据结构就绪，加载为可分发快照）。

#### 风险

1. **命名冲突**：现有 `profile.json`（任务画像）与新 Profile 概念冲突，需平滑迁移（自动重命名 + 向后兼容读取）。
2. **配置爆炸**：Profile/Bundle/Patch 组合后调试困难，`--dump-config` 是必备配套。
3. **循环继承**：Profile `extends` 需检测循环依赖。
4. **版本兼容**：Bundle 分发给其他项目时，版本不匹配可能导致字段缺失或行为偏差。

---

### 3.5 Agent Loop 可替换（长期）

#### DSH 做法

DSH 把 Agent 驱动拆为接口 + 可替换实现：

- **`core/agent`**：定义 Agent 接口 + 活跃注册表（多个 Agent 可并存）。
- **`core/agent-loop`**：提供默认驱动器，运行拆分为：
  - `turn`：完整任务周期（从用户输入到任务完成）
  - `step`：单次模型请求 + 工具调用循环
- 调整 Agent 行为只替换 Loop 实现，不改产品层代码。
- 不同 Loop 可实现不同策略（如 ReAct、Tree-of-Thought、Plan-and-Execute）。

#### SaCode 现状（源码核实）

SaCode 的 orchestrator 已有**多层函数分离**，但 Loop 逻辑内嵌，未抽象为可替换 trait：

- **`execute_role_driven_orchestration(context, checkpoints, ...)`**（`orchestrator.rs:28`）：顶层入口，驱动角色编排。
- **`execute_role_driven_task_run(context, checkpoints, ...)`**（`orchestrator.rs:201`）：单任务执行。
- **`execute_parallel_groups(plan, roles, ...)`**（`orchestrator.rs:217`）：并行组执行（DAG 调度）。
- **`dispatch_fix_loop(workdir, report)`**（`orchestrator.rs:1338`）：自修复闭环（M1 `FixLoopState` 状态机）。
- 配套有 `worker.rs`（worker 执行）、`role_registry.rs`（角色注册）、`message_bus.rs`（消息总线）、`summary_compactor.rs`（自防护冲突检测）。

**核心差距**：
1. Loop 逻辑是**自由函数**，非 trait —— 想换循环策略需改 orchestrator 源码。
2. 灵枢三子系统（自组织/自防护/自愈合）的逻辑分散在多个函数中，抽象 Loop 时需保证协同不被割裂。
3. `dispatch_fix_loop` 的 `InterventionRequest` 触发机制是自防护核心，任何 Loop 实现都必须保留。

#### 借鉴可行性：低中

- **有利因素**：已有 `execute_role_driven_orchestration`/`execute_role_driven_task_run`/`execute_parallel_groups` 的层级分离，抽象 trait 有基础。
- **不利因素**：灵枢三子系统深度耦合在 Loop 内，抽象不当会割裂协同；Rust 静态分发不适合"运行时热替换"。
- **关键约束**：自防护的 `InterventionRequest`、自愈合的故障转移路由、自组织的角色编排必须在任何 Loop 实现中可用。

#### 建议方向

**第一步（v2.0 长期）：抽象 `AgentLoop` trait** ✅ 已完成（v1.2 试点落地）

- 已创建 `runtime/src/agents/loop_impl.rs`，定义 `AgentLoop` trait（编译期静态
  分发，非运行时热替换）+ `LingShuLoop` 默认实现。
- `LingShuLoop` 封装 `execute_role_driven_orchestration` 全部逻辑，灵枢三子系统
  （自组织角色编排 / 自防护 `InterventionRequest`+`dispatch_fix_loop` / 自愈合
  模型故障转移）完整保留。
- 提供 `run_with_ling_shu_loop` 便捷入口，等价替换 `execute_role_driven_task_run`，
  便于将来按配置编译选择 Loop 实现。
- 命名注意：trait 签名使用 `sacode_kernel::ExecutionContext`（struct），
  与 `crate::tools::context::ExecutionContext`（执行环境能力接口 trait）区分。
- 单元测试 4 项全绿（`agents::loop_impl`）。

```rust
// 注：按 doc §3.5「不追求运行时热替换」，trait 用 #[async_trait(?Send)]
// 静态分发，未强制 Send 边界；LingShuLoop 结构本身仍 Send + Sync。
#[async_trait(?Send)]
pub trait AgentLoop {
    /// 完整任务周期（对应 DSH 的 turn）
    async fn orchestrate_turn(
        &self,
        context: &ExecutionContext,
        checkpoints: &CheckpointStorage,
        task: &Task,
        named_profile: Option<&Profile>,
    ) -> Result<ExecutionReport>;

    /// 单步执行（对应 DSH 的 step）：单次模型请求 + 工具调用
    async fn orchestrate_step(
        &self,
        context: &ExecutionContext,
        step: &ExecutionStep,
    ) -> Result<StepResult>;
}

/// 默认实现：灵枢自组织 + 自防护 + 自愈合
pub struct LingShuLoop {
    roles: RoleRegistry,
    message_bus: MessageBus,
    // 封装现有 orchestrator 逻辑
}

/// 自定义实现示例：ReAct 策略
pub struct ReActLoop { /* ... */ }
```

- `LingShuLoop` 作为默认实现，封装现有 `execute_role_driven_orchestration` 全部逻辑。
- 自定义 Loop（如 `ReActLoop`）可复用灵枢子系统能力（通过组合 `RoleRegistry`/`MessageBus`/`dispatch_fix_loop`）。
- **不追求** DSH 的"运行时热替换"——Rust 静态分发更适合**编译期选择** Loop 实现（通过 feature flag 或配置编译）。

**第二步：子系统可组合化** ✅ 已完成（2026-08-18）
- 在 `runtime/src/agents/loop_impl.rs` 新增 `LoopSubsystems` 结构体，把灵枢三子系统建模为可独立开关的开关位：
  - `self_organization`（角色驱动编排 / DAG 并行组调度）
  - `self_protection`（自防护：`summary_compactor.rs` 五维冲突检测 + `InterventionRequest` + `dispatch_fix_loop`）
  - `self_healing`（自愈合：`model_routing/` 故障转移路由）
- `LoopSubsystems` 默认值三开关全开（`Default`），并提供预设 `protection_only()`（仅自防护）与 `none()`（全关）便于自定义 Loop 组合。
- `LingShuLoop` 持有 `subsystems: LoopSubsystems` 字段，提供 `with_subsystems(...)` 构造器与 `subsystems()` 访问器；子系统开关通过 `orchestrate_turn` 在运行时按配置裁剪对应能力（灵枢三子系统协同不再硬编码于 orchestrator 内部，而是结构化可组合）。
- 单元测试 5 项全绿（`agents::loop_impl`：`loop_subsystems_default_all_on` / `loop_subsystems_presets` / `agent_loop_kind_parse_known_and_unknown` / `build_agent_loop_carries_subsystems` / `build_agent_loop_default_full_subsystems`）。

**第三步：Loop 注册与选择** ✅ 已完成（2026-08-18）
- 在 `runtime/src/agents/loop_impl.rs` 新增 `AgentLoopKind` 枚举（编译期可选 Loop 集合，当前含 `LingShu` 默认实现；配合 feature flag 可控制可用集合，避免二进制膨胀）+ `LoopConfig { kind, subsystems }`（JSON 可加载）。
- 新增 `build_agent_loop(&LoopConfig) -> LingShuLoop` 工厂：按 `kind` + `subsystems` 构造 Loop（当前 `LingShu` 分支承载全部组合）。
- 在 `runtime/src/config/mod.rs` 新增 `LOOP_CONFIG_FILE` 常量（`loop.json`）+ `LoopConfigStore`（`.sacode/loop.json` 的 `new`/`load`/`save`；文件缺失或损坏时回退 `LoopConfig::default()`）。
- CLI 端到端贯通：`interfaces/cli` 新增 `--agent-loop <kind>` 参数（`arg_parser.rs` 解析、`CliOptions.agent_loop`）；`orchestrator_entry.rs` 的 `run_with_orchestrator` 加载 `LoopConfigStore`，若 CLI 指定 `--agent-loop` 则覆盖 `kind`，调用 `build_agent_loop(&loop_config)` 拿到 `agent_loop`，再走 `agent_loop.orchestrate_turn(&context, &checkpoints, &workdir, named_profile)` 产出 `TaskRun`。
- `orchestrate_turn` 签名新增 `named_profile: Option<&Profile>` 参数，贯穿 `execute_role_driven_orchestration` / `execute_role_driven_task_run` / `execute_parallel_groups` / `run_sub_agent`，最终接入 `for_prompt_with_profile` 实现 Profile→工具集驱动（与 §3.4 闭环联动）。
- `sacode --agent-loop ling_shu` 已实现编译期选择语义（非运行时热替换）；`loop.json` 加载与 `--agent-loop` 覆盖均已实现，`LoopConfigStore` 往返与损坏回退测试全绿。

#### 风险

1. **子系统协同割裂**：抽象不当会导致 `InterventionRequest` 无法在自定义 Loop 中触发，破坏自防护闭环。必须把"冲突检测 + 修复触发"打包为不可绕过的核心能力。
2. **DAG 死锁防护**：`execute_parallel_groups` 的 DAG 调度是自组织核心，自定义 Loop 若不用 DAG 需自行保证无死锁。
3. **性能**：trait 对象的动态分发在 Loop 每一步都会产生开销，高频调用场景需评估。
4. **测试覆盖**：每个 Loop 实现都需完整的集成测试，保证灵枢三子系统的行为契约。
5. **向后兼容**：现有 `execute_role_driven_orchestration` 的调用点需保持行为不变，迁移期 `LingShuLoop` 默认启用。

---

## 4. 不建议借鉴项

以下设计不适合 SaCode，盲目跟风会削弱既有优势。

### 4.1 全盘"一切皆插件"

**理由**：
- Rust 静态分发与所有权模型与"运行时插件树"范式契合度存疑，动态分发的性能开销在 Agent 运行底座这种高频调用场景不可忽视。
- 灵枢三子系统（自组织/自防护/自愈合）已自成体系，强行插件化会割裂子系统协同。
- SaCode 已有 WASM 插件 + MCP + skills 三层扩展机制，覆盖了"动态扩展"的核心诉求，无需把内核也插件化。

### 4.2 Cordis 时空可组合性范式

**理由**：
- Cordis 是 TypeScript 生态的学术范式（论文《A Programming Paradigm for Spatiotemporal Composability》），学习成本极高。
- Rust 的所有权与生命周期模型已提供编译期的时空安全保证，与 Cordis 的运行时组合机制目标重叠但路径不同。
- 引入 Cordis 需要引入 TypeScript 运行时，与 SaCode 的纯 Rust workspace 定位冲突。

### 4.3 TypeScript monorepo 技术栈

**理由**：SaCode 选择 Rust 是为了性能、单二进制分发、内存安全，这些是 SaCode 的核心差异化优势。DSH 的 TypeScript 生态适合快速迭代的开发者预览，但不适合 SaCode 的稳定内核定位。

---

## 5. 优先级排序与落地建议

借鉴建议按**价值/复杂度**二维排序，分短期/中期/长期落地。

| 借鉴点 | 价值 | 复杂度 | 阶段 | 建议时机 |
| --- | --- | --- | --- | --- |
| 事件流投影重建会话 | 高 | 中 | 短期 | v1.1 |
| 工具执行事件流水线 | 高 | 中 | 短期 | v1.1 |
| 执行环境能力接口 | 中高 | 中高 | 中期 | v1.2 |
| Profile/Bundle 配置组合 | 中 | 低中 | 中期 | v1.2 |
| Agent Loop 可替换 | 中 | 高 | 长期 | v2.0 |

### 5.1 短期建议（v1.1）

- **事件流投影**：先在 checkpoint 之外增加"事件流回放"能力，验证投影保真度。扩展 `audit.log` 为完整 `SessionEvent` 流。
- **工具事件流水线**：把 `sandbox_guard.rs` 提取为 `ToolInterceptor` trait，定义 `pre_execute`/`post_execute` 挂载点。

### 5.2 中期建议（v1.2）

- **执行环境能力接口**：定义 `ExecutionContext` trait，在 `shell.exec`/`fs.read`/`fs.write` 试点 `LocalContext` 实现。
- **Profile/Bundle**：升级 `.sacode/profile.json` 为命名 Profile，引入 Bundle 打包工具集 + 角色 + 模型路由。

### 5.3 长期建议（v2.0）

- **Agent Loop 可替换**：将 orchestrator 主循环提取为 `AgentLoop` trait，保留灵枢三子系统协同。不追求热替换，走编译期选择路线。

---

## 6. 总结

SaCode 与 deepseek-harness 代表了 Agent 运行底座的两种范式：

- **SaCode**：静态分层 + 灵枢三子系统，重稳定内核、重编译期保证、重自组织协同。
- **DSH**：插件树 + 事件流投影，重可组合性、重可替换性、重配置化部署。

两者并非对立，而是互补。SaCode 应在**保留灵枢既有优势**的前提下，选择性借鉴 DSH 的三点核心设计：

1. **事件流投影重建会话** —— 提升可回放性与上下文保真度（最值得借鉴）
2. **工具执行事件流水线** —— 让审批/遥测/策略可挂载，执行期可插拔
3. **执行环境能力接口** —— 解锁远程沙箱热迁移能力

其余两点（Profile/Bundle、Agent Loop 可替换）作为中期/长期演进方向，视实际需求推进。

**坚决不借鉴**全盘插件化、Cordis 范式、TypeScript 技术栈——这些与 SaCode 的 Rust 稳定内核定位冲突，盲目跟风会削弱既有优势。

---

## 参考

- [deepseek-harness GitHub](https://github.com/deepseek-ai/deepseek-harness)
- [SaCode 架构说明](architecture.md)
- [SaCode 工具系统与分层注入](API.md)
- [SaCode 路线图](../product/roadmap.md)
