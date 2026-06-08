# SaCode Agent Teams 实施方案

> 来源：`docs/plans/archive/final-roadmap.md`
> 优先级：P1.5 到 P2
> 前置依赖：runtime 统一化建立统一 TaskRun / WorkerRun 真源，Sub-agents 完成配置化专家层，daemon 提供多任务会话宿主能力

---

## 一、目标

把当前的角色驱动 orchestrator 升级为真正的 Team runtime，使 SaCode 具备按任务复杂度动态创建协作团队、分配成员、并行执行、冲突汇总和失败接管的能力。

Agent Teams 在 SaCode 中的定位：

- 它是运行时协作层
- 它不是静态配置的人格层
- 它建立在 Sub-agents 和统一 runtime 之上

---

## 二、当前基础

当前已有：

- `runtime/src/agents/orchestrator.rs`
- 角色驱动执行计划
- 并发组执行
- `WorkerRunResult`
- `RouteRecord` / `SummaryRecord` / `ConflictRecord`
- `TaskProfile` / `NodeScore` / `FailoverContext`

当前仍缺：

- 真正的 team runtime
- 团队成员生命周期模型
- 成员间消息抽象
- team scoped memory
- 明确的 team 级 failover handoff
- daemon / TUI 多会话 team 视图

---

## 三、设计原则

### 3.1 Orchestrator 是调度器，不是人格 Agent

Orchestrator 负责：

- 分析任务复杂度
- 选择执行模式
- 生成 team 结构
- 汇总结果

Orchestrator 不应承担成员人格本身。

### 3.2 TeamMember 是独立运行单元

每个成员必须具备：

- 独立上下文
- 独立 route state
- 独立 sandbox snapshot
- 独立 status
- 独立 result

### 3.3 Sub-agents 与 Agent Teams 分层

- Sub-agents：静态配置的专项专家层
- Agent Teams：运行时动态协作层

两者关系：

- Team 成员可以调用 Sub-agents
- Team 本身不等于 Sub-agent 集合

### 3.4 Team runtime 建立在统一 TaskRun / WorkerRun 上

Agent Teams 不能创建第二套执行状态模型，必须复用统一 runtime。

---

## 四、对象模型建议

建议新增：

- `TeamRun`
- `TeamMemberState`
- `TeamExecutionPlan`
- `TeamMessage`
- `TeamConflict`

### 4.1 TeamRun

表示一个运行中的团队。

建议字段：

- `team_id`
- `task_id`
- `session_id`
- `mode`
- `status`
- `members`
- `topology`
- `summary`

### 4.2 TeamMemberState

表示一个团队成员的实时状态。

建议字段：

- `member_id`
- `role_id`
- `status`
- `route_snapshot`
- `sandbox_snapshot`
- `retry_count`
- `worker_id`
- `last_summary`

### 4.3 TeamExecutionPlan

建议字段：

- `mode`
- `parallel_groups`
- `member_specs`
- `handoff_rules`
- `summary_strategy`

### 4.4 TeamMessage

第一版建议先抽象，不需要一开始就做复杂 mailbox。

建议类型：

- `RoleDirective`
- `FailoverContext`
- `ConflictNotice`
- `OrchestratorSummary`

---

## 五、团队运行模式建议

建议支持三层模式：

### 5.1 Single Agent

适用于简单任务。

### 5.2 Role-driven Orchestration

适用于中等复杂任务。

### 5.3 Agent Teams

适用于高复杂度任务。

这样可以与现有 orchestrator 平滑兼容，而不是一次性替换所有路径。

---

## 六、成员角色建议

第一版建议以内置核心角色为主：

- `planner`
- `implementer`
- `code-reviewer`
- `test-engineer`
- `reporter`

后续可扩展：

- `system-architect`
- `ops-engineer`
- `docs-writer`

---

## 七、动态模型路由策略

### 7.1 每个 TeamMember 独立路由

规则：

- 依据 `TaskProfile`
- 依据角色
- 依据历史 route health
- 依据失败历史与评分

### 7.2 节点评分驱动切换

每个成员执行结束后评分：

- 低分：切换模型并重试
- 高分：接受结果并进入汇总

### 7.3 Failover Context

失败接管时注入：

- 原任务摘要
- 已完成步骤
- 工具调用摘要
- 上轮错误
- 低分原因

---

## 八、与 Sub-agents 的关系

建议采用分层模型：

- TeamMember 是主执行者
- Sub-agent 是可调用的专项专家

示例：

- `code-reviewer` TeamMember 可以调用 `security-review` Sub-agent
- `implementer` TeamMember 可以调用 `test-generator` Sub-agent

第一版建议先不做成员内部嵌套多次调用链，避免复杂度失控。

---

## 九、memory 设计

Agent Teams 需要支持 team scoped memory。

建议先支持：

- `MemoryScope::Team(team_id)`

建议规则：

- 每个成员可读 team scope
- 每个成员保留自身 worker scope
- 汇总器负责决定哪些信息写回 team scope

第一版不建议开放所有成员自由写共享 memory。

---

## 十、与 daemon 的关系

daemon 是 Team runtime 的天然宿主。

daemon 负责：

- 多团队并存
- 多任务并发
- 团队状态持久化
- 团队事件流输出

这也是后续 TUI attach / monitor 的前提。

---

## 十一、TUI 设计建议

TUI 不应一开始承担复杂调度逻辑，应该只做 team 视图消费。

建议分两步：

### 11.1 第一版

展示：

- team 基本信息
- 成员列表
- 成员状态
- route 概览
- conflicts
- final summary

### 11.2 第二版

展示：

- 团队拓扑图
- handoff timeline
- failover timeline
- team message trace

---

## 十二、模块落点建议

### runtime

建议新增：

- `runtime/src/agents/team.rs`
- `runtime/src/agents/team_member.rs`
- `runtime/src/agents/team_runtime.rs`
- `runtime/src/agents/team_message.rs`

### kernel

建议扩展：

- team 级结构化记录
- 成员状态快照结构

### interfaces/cli

建议扩展：

- TUI team 视图
- daemon attach / monitor 团队展示

---

## 十三、实施阶段

### Phase 1：TeamRun 与成员状态模型

工作内容：

- 定义 `TeamRun`
- 定义 `TeamMemberState`
- 把现有 `WorkerRunResult` 映射到成员状态模型

验收标准：

- runtime 能持有 team 级状态对象

### Phase 2：Team runtime 初版

工作内容：

- 由 orchestrator 生成 team plan
- 成员并发执行
- 结果汇总仍复用现有 summary / conflict 体系

验收标准：

- 复杂任务可由 team 模式执行

### Phase 3：failover 与 handoff

工作内容：

- 低分成员模型切换
- 失败上下文注入
- 简化版 `TeamMessage` 抽象

验收标准：

- team 成员可在失败后自动接管重试

### Phase 4：TUI / daemon 集成

工作内容：

- daemon 可持有多个 team session
- TUI 展示 team 成员与冲突信息

验收标准：

- team 信息可在 attach / monitor 中被消费

### Phase 5：Sub-agent 内部调用集成

工作内容：

- TeamMember 可调用专项 Sub-agent

验收标准：

- 至少支持 1 到 2 个专项专家集成路径

---

## 十四、测试策略

### 单元测试

- team 计划构造
- 成员状态流转
- failover 评分与切换
- conflict 聚合

### 集成测试

- 单 team 多成员并发执行
- failover 注入路径
- daemon 中 team 状态可查询

### 回归测试

- 现有 orchestrator 路径不回退
- 现有 summary / conflict / route 展示不回退

---

## 十五、完成定义

1. 团队级状态对象可持久化
2. 团队成员具备独立状态与路由快照
3. 复杂任务可切到 team 模式运行
4. 失败成员可触发自动 failover
5. daemon / TUI 可展示团队状态
6. 可选调用 Sub-agent 专项能力

---

## 十六、完成后的直接收益

- SaCode 从“角色驱动汇总器”升级为真正的协作执行系统
- 动态模型路由的优势可以被团队级放大
- 复杂任务的稳定性、可解释性和结果质量都能明显提升
