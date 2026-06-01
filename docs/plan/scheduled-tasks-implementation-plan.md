# SaCode Scheduled Tasks 实施方案

> 来源：`docs/plan/final-roadmap.md`
> 优先级：P1.5
> 前置依赖：runtime 统一化具备统一 TaskRunner，daemon/http api 具备后台任务宿主能力

---

## 一、目标

把当前 `TaskQueue` 和 `ScheduledTask` 基础能力升级为可持久化、可管理、可按时间触发执行的 Scheduled Tasks 系统。

Scheduled Tasks 在 SaCode 中的定位：

- 它是统一 runtime 的触发层
- 它依赖 daemon 提供常驻执行宿主
- 它不自带独立任务模型，直接复用统一 `TaskRun`

---

## 二、当前基础

当前已有：

- `runtime/src/queue/mod.rs`
- `ScheduledTask`
- 优先级、依赖、重试、取消、状态流转

当前仍缺：

- 真正的时间调度器
- 任务触发循环
- 调度持久化
- interval / one-shot / cron 语义
- CLI 管理命令
- daemon 集成触发面

---

## 三、设计原则

### 3.1 调度系统只负责触发，不负责另起执行语义

Scheduled Tasks 只决定何时触发，真正执行仍走统一 TaskRunner。

### 3.2 先做确定性时间模型，再做自然语言时间

实现顺序建议：

1. interval
2. one-shot at
3. cron
4. natural language time

### 3.3 先支持 daemon 级常驻调度

第一版应建立在 daemon 之上，不建议先做“CLI 进程存活期间临时调度”。

---

## 四、对象模型建议

建议在 runtime 中新增：

- `ScheduleSpec`
- `ScheduledInvocation`
- `SchedulerState`
- `ScheduleTriggerResult`

### 4.1 ScheduleSpec

表示用户定义的调度规则。

建议字段：

- `schedule_id`
- `name`
- `task_prompt`
- `mode`
- `approval_policy`
- `schedule_kind`
- `created_at`
- `expires_at`
- `enabled`
- `jitter`

### 4.2 schedule_kind

建议支持：

- `Interval { every_secs }`
- `OnceAt { timestamp }`
- `Cron { expr }`

第一版至少实现：

- `Interval`
- `OnceAt`

### 4.3 ScheduledInvocation

表示一次真实触发。

建议字段：

- `invocation_id`
- `schedule_id`
- `triggered_at`
- `task_id`
- `status`

---

## 五、模块落点建议

### runtime

建议新增：

- `runtime/src/scheduler/mod.rs`
- `runtime/src/scheduler/spec.rs`
- `runtime/src/scheduler/engine.rs`
- `runtime/src/scheduler/store.rs`
- `runtime/src/scheduler/trigger.rs`

### daemon

daemon 负责：

- 启动 scheduler loop
- 周期检查待触发 schedule
- 调用统一 TaskRunner 创建任务

### interfaces/cli

建议新增：

- `interfaces/cli/src/cmd/task.rs`
- 或扩展现有命令树支持 `loop` / `remind` / `task ls/rm/clear`

---

## 六、调度行为设计

### 6.1 Interval

示例：

- 每 3 分钟执行一次
- 每 1 小时执行一次

行为要求：

- 记录下一次触发时间
- daemon 周期轮询检查
- 触发后更新下一次执行时间

### 6.2 OnceAt

示例：

- 某个绝对时间点执行一次
- 相对当前时间延迟一段时间执行

行为要求：

- 触发一次后自动标记完成

### 6.3 Cron

建议放第二阶段。

### 6.4 Jitter

建议字段：

- `jitter_secs`

作用：

- 防止大量任务同时触发

第一版可以先默认关闭。

---

## 七、CLI 设计

建议命令：

- `sacode loop "每3分钟检查CI状态" --interval 3m`
- `sacode remind "下午四点半同步进展" --at 16:30`
- `sacode task ls`
- `sacode task show <schedule-id>`
- `sacode task rm <schedule-id>`
- `sacode task clear`

第一版建议先支持：

- `loop`
- `remind`
- `task ls`
- `task rm`

---

## 八、与统一 runtime 的关系

每次定时触发都应：

1. 创建一个新的 `TaskRun`
2. 绑定到 daemon session 或 scheduler session
3. 写入统一事件流
4. 通过统一状态机汇报结果

这样 Scheduled Tasks 不需要自建第二套结果模型。

---

## 九、与 daemon 的关系

daemon 是 Scheduled Tasks 的执行宿主。

daemon 需要承担：

- scheduler loop 生命周期
- schedule 持久化加载
- 触发任务提交
- 日志留存

如果 daemon 未运行：

- 第一版建议 Scheduled Tasks 不执行
- CLI 侧返回清晰提示，要求先启动 daemon

---

## 十、调度持久化建议

建议目录：

- `./.sacode/schedules/`
- `./.sacode/schedule-events/`

建议文件组织：

- 每个 schedule 一个主文件
- invocation 记录可按 schedule 分组

---

## 十一、实施阶段

### Phase 1：ScheduleSpec 与存储

工作内容：

- 定义 `ScheduleSpec`
- schedule 文件持久化
- `task ls/rm` 基础能力

验收标准：

- schedule 可创建、列出、删除

### Phase 2：daemon scheduler loop

工作内容：

- 周期检查 schedule
- 触发 interval / once-at
- 触发后创建统一 `TaskRun`

验收标准：

- daemon 可自动触发实际任务执行

### Phase 3：CLI 创建命令

工作内容：

- `loop`
- `remind`
- 时间参数解析

验收标准：

- 用户可通过 CLI 创建基本 schedule

### Phase 4：cron 与高级策略

工作内容：

- cron 表达式
- jitter
- 自动过期
- 最大数量限制

验收标准：

- schedule 能处理更多真实场景

---

## 十二、测试策略

### 单元测试

- interval 触发计算
- once-at 触发计算
- 存储读写
- 删除与禁用逻辑

### 集成测试

- daemon 加载 schedule 并触发任务
- CLI 创建后 daemon 能执行
- 触发结果写入统一任务状态

### 回归测试

- 不影响现有 `TaskQueue` 行为
- 不影响现有 daemon API 基础能力

---

## 十三、完成定义

1. 支持 interval 和 once-at 两类调度
2. 支持 schedule 持久化
3. 支持 daemon 自动触发任务
4. CLI 可创建、列出、删除 schedule
5. 每次触发结果都进入统一 runtime 状态流

---

## 十四、完成后的直接收益

- 把 `TaskQueue` 从内部能力升级为可见产品能力
- 为后续自动巡检、日报、CI 检查、提醒等场景提供统一基础
- 为 Channels 的外部事件触发和异步工作流铺平路径
