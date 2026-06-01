# SaCode 最终演进方案

> 状态：最终方案
> 目标：将现有多角色编排、动态模型路由、沙箱、队列、wiki/memory、daemon 雏形收敛为一套统一运行时，并在此基础上分阶段完成 Sub-agents、Daemon、HTTP API、Scheduled Tasks、Agent Teams 和 Channels。

---

## 一、结论

SaCode 当前已经具备以下关键基础：

- 多角色编排：`runtime/src/agents/orchestrator.rs`
- 动态模型路由：`runtime/src/model_routing/`
- 结构化输出：`kernel/src/execution/report.rs`
- 能力化沙箱与 Docker backend：`runtime/src/sandbox/`
- 任务队列：`runtime/src/queue/`
- wiki / memory：`runtime/src/wiki/`、`runtime/src/memory/`
- daemon / HTTP API 雏形：`runtime/src/daemon/`

当前最优路线不是并行铺开所有高级功能，而是先统一运行时真源，再按依赖顺序向上叠加产品能力。

最终路线如下：

1. 统一运行时状态机与会话/任务持久化
2. 落地 Sub-agents
3. 落地 Daemon + HTTP API
4. 落地 Scheduled Tasks
5. 升级 Agent Teams
6. 最后接入 Channels

---

## 二、现状评估

### 2.1 已有能力

#### 编排与模型路由

- `execute_role_driven_orchestration(...)` 已支持并发组执行、结果折叠、冲突提取、总结输出
- `TaskProfile`、`NodeScore`、`FailoverContext` 已具备动态路由与失败接管所需基础
- `RouteRecord`、`SummaryRecord`、`ConflictRecord` 已提供结构化结果真源

#### 执行安全与隔离

- `SandboxPolicy` 已从模式化限制升级到 capability 模型
- `shell.exec` / `task.spawn` 已走 `SandboxBackend`
- `DockerSandboxBackend` 已具备首版命令组装、挂载映射、网络模式和最小安全基线

#### 队列与持久化

- `TaskQueue` 已支持优先级、依赖、重试、取消、状态查询
- wiki / memory 已支持用户级与项目级摘要、索引和结构化读取
- `CheckpointStorage` 已支持任务阶段性产物留存

#### 接口与入口

- CLI 命令入口集中在 `interfaces/cli/src/cmd/mod.rs`
- runtime 中已存在 daemon 和基础 HTTP API
- TUI 已可消费部分结构化编排输出

### 2.2 当前核心缺口

#### 运行时未完全统一

当前仍存在多条任务执行路径：

- `run_task_with_stdin(...)`
- `run_with_orchestrator(...)`
- daemon 路径
- queue 路径

这些路径共享部分能力，但没有统一的生命周期、状态机和持久化模型。

#### 会话与任务状态缺少单一真源

需要统一：

- task state
- session state
- worker state
- event stream schema
- result / summary schema

#### 多 Agent 还偏“编排结果”而非“统一运行时”

当前 orchestrator 更像“角色驱动汇总器”，距离可扩展的 Team runtime 还差：

- 独立成员状态
- 独立上下文
- 团队级消息
- 团队级共享记忆
- 团队级生命周期管理

---

## 三、目标架构

目标架构遵循现有分层：

- `kernel`：纯数据结构、状态模型、结构化输出
- `runtime`：统一任务运行内核、队列、沙箱、daemon、API、agent runtime
- `interfaces/cli`：CLI / TUI / attach / monitor 视图层与交互层

### 3.1 统一运行时内核

统一运行时应成为所有入口的真源，覆盖：

- 单 Agent 任务
- Orchestrator 任务
- Sub-agent 任务
- Agent Team 任务
- 后台 daemon 任务
- Scheduled Tasks 触发任务
- Channels 外部事件触发任务

### 3.2 统一状态机

建议统一状态为：

- `pending`
- `planning`
- `waiting_user`
- `waiting_approval`
- `running`
- `retrying`
- `completed`
- `failed`
- `cancelled`

### 3.3 统一持久化对象

建议统一以下对象模型：

- `SessionRun`
- `TaskRun`
- `WorkerRun`
- `EventLog`
- `SummarySnapshot`
- `RouteSnapshot`
- `ConflictSnapshot`

这些对象应优先落在 `runtime`，由 CLI、TUI、daemon、HTTP API 共同消费。

---

## 四、最终路线图

## Phase 0：统一运行时内核

### 目标

把当前分散的任务执行路径收敛成同一套生命周期、状态机和结构化结果。

### 主要工作

- 在 `runtime` 抽统一的任务运行抽象
- 统一 task/session/worker 状态模型
- 统一事件流输出格式
- 统一 summary / route / conflict / checkpoint 输出格式
- 让 CLI、orchestrator、daemon 共用同一套运行时入口

### 推荐模块归属

- `kernel/src/execution/`：状态和结构体
- `runtime/src/executor/` 或新增 `runtime/src/run/`
- `interfaces/cli` 只做调用与展示

### 优先级

- P0

### 完成标准

- CLI 与 daemon 不再各自维护不同的任务状态模型
- 所有任务类型都能输出统一结构化结果

---

## Phase 1：Sub-agents

### 目标

把当前角色/skills 能力升级成用户可配置、项目可持久化的专项专家系统。

### 设计原则

- 继承 SaCode 的动态模型路由优势
- 继承 SaCode 的模式化沙箱
- 独立上下文窗口
- 配置化工具白名单

### 文件格式

建议使用：

- `~/.sacode/agents/*.agent.md`
- `./.sacode/agents/*.agent.md`

建议字段：

- `name`
- `description`
- `role`
- `tools`
- `model`
- `permissionMode`
- `skills`

### 主要工作

- 新增 `SubAgentConfig` 与 agent registry
- 新增 agent scoped tool filtering
- 新增 agent scoped sandbox policy
- 新增 agent scoped memory scope
- 新增 CLI：`sacode agent ls/show/run`

### 优先级

- P1

### 原因

- 与当前架构贴合度最高
- 对 daemon 和 TUI 侵入最小
- 可为 Agent Teams 提供配置化专家层

---

## Phase 2：Daemon + HTTP API

### 目标

把 SaCode 从一次性 CLI 提升为可常驻、可异步、可外部访问的运行时宿主。

### 当前基础

- `runtime/src/daemon/mod.rs` 已存在
- 已有 `/health`、`/events`、`/queue/status`

### 主要工作

#### Daemon 管理命令

- `sacode daemon start`
- `sacode daemon status`
- `sacode daemon stop`
- `sacode daemon restart`

#### 最小 HTTP API

- `POST /tasks`
- `GET /tasks/:id`
- `POST /tasks/:id/cancel`
- `GET /events/:id`
- `GET /sessions`

#### 持久化目录建议

- `./.sacode/sessions/`
- `./.sacode/tasks/`
- `./.sacode/logs/`

### 优先级

- P1

### 原因

- Daemon 是 Scheduled Tasks 和 Channels 的宿主
- HTTP API 是外部集成的统一入口

---

## Phase 3：Scheduled Tasks

### 目标

基于现有 `TaskQueue` 把定时执行能力产品化。

### 当前基础

- `runtime/src/queue/mod.rs` 已支持 `ScheduledTask`
- 已有优先级、依赖、重试、状态查询

### 推荐实现顺序

#### 第一阶段

- fixed interval
- one-shot at
- scheduler loop
- 基础持久化

#### 第二阶段

- cron expression
- natural language time
- idle only
- jitter
- task retention / expiration

### CLI 建议

- `sacode loop ...`
- `sacode remind ...`
- `sacode task ls`
- `sacode task rm`
- `sacode task clear`

### 优先级

- P1.5

### 原因

- 队列基础已存在
- 比 Channels 更容易形成内生闭环

---

## Phase 4：Agent Teams

### 目标

把当前“角色驱动 orchestrator”升级成真正的 Team runtime。

### 设计原则

- Orchestrator 是调度器，不是人格 Agent
- TeamMember 具有独立上下文、独立 route state、独立 sandbox
- Sub-agents 是静态专项专家层
- Agent Teams 是运行时协作层

### 主要工作

- 从 `WorkerRunResult` 升级到 `TeamMemberState`
- 增加 team lifecycle
- 增加 failover handoff
- 增加 role-to-role message abstraction
- 增加 team scoped memory
- TUI 展示 team graph / member status / conflicts

### 优先级

- P1.5 到 P2

### 原因

- 差异化最强
- 成本也最高
- 依赖统一运行时和 daemon/session 能力先稳定

---

## Phase 5：Channels

### 目标

让 SaCode 可以接受外部事件并通过统一任务运行时执行。

### 设计原则

- Channels 是事件适配层，不是核心运行时
- 优先建立在 daemon + HTTP API 上
- 先通用 webhook，后 IM 通道

### 推荐顺序

1. Webhook
2. Telegram
3. 其他 IM / Bot 集成

### 优先级

- P2

### 原因

- 依赖 daemon、HTTP API、任务投递、会话模型和权限策略
- 放在后面成本更可控

---

## 五、跨阶段共性约束

### 5.1 状态与结构化输出必须只有一套真源

必须避免：

- CLI 一套状态机
- daemon 一套状态机
- TUI 一套展示语义

统一真源应放在 `kernel` 和 `runtime`。

### 5.2 Memory 先扩作用域，再扩共享复杂度

建议先支持：

- `Global`
- `Project`
- `Session`
- `Agent`
- `Team`

先解决“作用域隔离”，再做“共享写入策略”。

### 5.3 Linux first

由于当前已有现实约束：

- `shell.exec` 偏 Unix
- `fs.search` 偏 Unix
- daemon / signal / docker / tmpfs 也偏 Unix

建议阶段性策略：

- 先以 Linux 为主平台完成主路径
- Windows 作为兼容层逐步补齐

### 5.4 Token 成本必须作为一等约束

尤其是 Agent Teams 阶段，必须内置以下边界：

- 并发上限
- 路由评分阈值
- failover 次数上限
- reviewer 数量控制
- summary 压缩

---

## 六、模块级落点建议

### kernel

- 扩展统一 task/session/worker 状态结构
- 保持 `ExecutionReport`、`SummaryRecord`、`ConflictRecord` 作为结构化真源

### runtime

- 承担统一运行内核
- 承担 daemon、queue、scheduler、sub-agents、agent teams
- 承担 memory scope 和共享策略

### interfaces/cli

- 承担 CLI 命令、TUI、attach、monitor、agent/task/session 管理视图
- 不再承载核心状态机真源

---

## 七、最终优先级

### P0

- 统一运行时状态机与持久化真源

### P1

- Sub-agents
- Daemon + HTTP API

### P1.5

- Scheduled Tasks
- Agent Teams runtime 初版

### P2

- Channels
- TUI 多会话监控与高级团队视图

---

## 八、执行建议

下一步建议直接把本最终方案拆成三个实施文档：

1. `runtime-unification-plan.md`
2. `sub-agents-implementation-plan.md`
3. `daemon-http-api-implementation-plan.md`

这样可以把当前“研究方案”切换到“开发方案”，并且每个文档都能直接映射到模块与迭代顺序。
