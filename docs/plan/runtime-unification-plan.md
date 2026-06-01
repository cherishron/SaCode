# SaCode Runtime 统一化实施方案

> 来源：`docs/plan/final-roadmap.md`
> 优先级：P0
> 目标：把当前 CLI、orchestrator、daemon、queue 等分散执行路径收敛成同一套运行时内核、状态机和结构化结果真源。

---

## 一、问题定义

当前 SaCode 已具备以下能力：

- 单任务执行
- 角色驱动 orchestrator
- daemon 雏形
- 任务队列
- 结构化 route / summary / conflict 输出

当前关键问题是这些能力仍然通过多条执行路径拼接，缺少统一运行时真源。

当前主要路径包括：

- `run_task_with_stdin(...)`
- `run_with_orchestrator(...)`
- daemon 提交与执行路径
- queue 触发执行路径

这会带来三个问题：

1. 状态机不统一
2. 结构化结果不统一
3. 后续 Sub-agents、Daemon、Scheduled Tasks、Agent Teams 难以复用

---

## 二、目标

构建统一的 runtime execution kernel，覆盖：

- 单 Agent 任务
- Orchestrator 任务
- Sub-agent 任务
- Team 任务
- 后台 daemon 任务
- 定时任务触发任务
- 外部事件触发任务

统一后，CLI、TUI、daemon、HTTP API 都只消费 runtime 的统一对象和事件。

---

## 三、设计原则

### 3.1 真源在 runtime 和 kernel

- `kernel`：纯数据结构、状态定义、结构化输出
- `runtime`：生命周期管理、执行状态流转、持久化协调
- `interfaces/cli`：交互和展示

### 3.2 先统一状态，再统一功能入口

先定义统一状态和对象，再把已有执行路径逐个迁移。

### 3.3 兼容现有结构化输出

保留并扩展已有：

- `ExecutionReport`
- `SummaryRecord`
- `ConflictRecord`
- `RouteRecord`

---

## 四、统一对象模型

建议新增或正式化以下对象：

### 4.1 SessionRun

表示一次完整会话或一次后台执行会话。

建议字段：

- `session_id`
- `mode`
- `created_at`
- `updated_at`
- `status`
- `task_ids`
- `workspace`
- `entrypoint`

### 4.2 TaskRun

表示一个任务的统一执行对象。

建议字段：

- `task_id`
- `session_id`
- `prompt`
- `execution_kind`
- `status`
- `approval_policy`
- `max_iterations`
- `worker_ids`
- `report`

### 4.3 WorkerRun

表示单个执行节点。

建议字段：

- `worker_id`
- `task_id`
- `role_id`
- `status`
- `sandbox_policy_snapshot`
- `route_snapshot`
- `retry_count`
- `result_summary`

### 4.4 EventLog

统一 CLI/TUI/daemon/API 消费的事件流。

建议字段：

- `event_id`
- `session_id`
- `task_id`
- `worker_id`
- `kind`
- `timestamp`
- `payload`

---

## 五、统一状态机

建议统一状态：

- `pending`
- `planning`
- `waiting_user`
- `waiting_approval`
- `running`
- `retrying`
- `completed`
- `failed`
- `cancelled`

### 状态应用范围

- `SessionRun.status`
- `TaskRun.status`
- `WorkerRun.status`

允许不同层级有子状态，但主状态集合保持一致。

---

## 六、模块拆分建议

### kernel

建议新增或扩展：

- `kernel/src/execution/state.rs`
- `kernel/src/execution/session.rs`
- `kernel/src/execution/task_run.rs`
- `kernel/src/execution/worker_run.rs`

### runtime

建议新增：

- `runtime/src/run/mod.rs`
- `runtime/src/run/session_manager.rs`
- `runtime/src/run/task_runner.rs`
- `runtime/src/run/worker_runner.rs`
- `runtime/src/run/event_bus.rs`
- `runtime/src/run/store.rs`

### interfaces/cli

改造为统一调用 `runtime::run::*` 入口。

---

## 七、迁移顺序

### Phase 1：定义统一状态与对象

工作内容：

- 在 `kernel` 中定义统一状态枚举
- 定义 `SessionRun` / `TaskRun` / `WorkerRun`
- 为现有 `ExecutionReport` 建立挂接关系

验收标准：

- 新结构可以被序列化/反序列化
- 结构和当前测试体系兼容

### Phase 2：抽统一 runtime 入口

工作内容：

- 新增统一 `TaskRunner`
- 单 Agent 路径先迁移
- 把 `run_task_with_stdin(...)` 改成薄封装

验收标准：

- CLI 普通任务路径改走统一 runner

### Phase 3：迁移 orchestrator

工作内容：

- 把 `execute_role_driven_orchestration(...)` 改为产出 `TaskRun` / `WorkerRun`
- 当前 `WorkerRunResult` 与统一模型对齐

验收标准：

- orchestrator 路径结构化输出不回退

### Phase 4：迁移 daemon / queue

工作内容：

- daemon 提交执行改走统一 runner
- queue 的状态与统一状态机对齐

验收标准：

- daemon、queue、CLI 共享同一套状态真源

---

## 八、持久化建议

建议目录：

- `./.sacode/sessions/`
- `./.sacode/tasks/`
- `./.sacode/workers/`
- `./.sacode/events/`

建议文件策略：

- 每个 session 一个主文件
- 每个 task 一个主文件
- events 可按 task 或 session 分片

---

## 九、测试策略

### 单元测试

- 状态机转换
- 结构序列化
- report 到 snapshot 的转换

### 集成测试

- CLI 任务路径
- orchestrator 路径
- daemon 路径
- queue 路径

### 回归测试

- TUI 结构化消费不回退
- route/conflict/summary 输出不回退

---

## 十、完成定义

当以下条件全部满足时，本方案视为完成：

1. CLI、daemon、queue、orchestrator 使用统一 runtime 入口
2. `SessionRun` / `TaskRun` / `WorkerRun` 成为共享真源
3. 状态机统一
4. 结构化输出统一
5. TUI 和 HTTP API 可直接消费统一对象

---

## 十一、完成后的直接收益

完成 runtime 统一化后，后续功能会显著降本：

- Sub-agents 只需增加配置层和作用域层
- Daemon 只需增加宿主层和 API 层
- Scheduled Tasks 只需增加触发层
- Agent Teams 只需增加 team runtime
- Channels 只需增加事件适配层
