# 面向大任务自治交付的 Loop 升级方案

## 背景

当前 SaCode 已经具备 `/loop <任务>` 的连续迭代能力。它可以围绕同一个目标多轮执行、失败后继续尝试、命中单轮迭代上限后缩小范围继续修复。

现有能力更适合：

- bug 修复
- 局部功能收敛
- 中等复杂度任务的连续迭代

现有能力还不适合直接完成“从想法到成品”的大任务自治交付，例如：

- 从零做一个俄罗斯方块游戏
- 从零做一个博客系统
- 从零做一个完整的前后端应用

原因在于当前 `/loop` 的外层控制逻辑仍然是“围绕同一目标持续重试”，还不是“按阶段推进、按验收停机”的工程闭环。

## 目标

把当前 `/loop` 升级为面向大任务的自治交付模式，使系统具备以下能力：

1. 自动把大目标拆成阶段任务
2. 按阶段持续推进，而不是每轮都从一个大目标重新尝试
3. 每阶段完成后自动验收
4. 验收通过后进入下一阶段
5. 全部阶段通过后自动停止
6. 遇到失败时优先在当前阶段内收敛，而不是无限发散

## 典型场景

### 场景 1：实现俄罗斯方块

用户输入：

```text
/loop 做一个俄罗斯方块游戏
```

系统理想行为：

1. 自动拆分任务
2. 先完成基础骨架
3. 再实现方块移动、旋转、下落
4. 再实现碰撞、堆叠、消行、计分
5. 每阶段完成后自动运行验证
6. 所有核心功能通过后自动终止

### 场景 2：实现中等规模 Web 功能

用户输入：

```text
/loop 为管理后台新增用户角色权限系统
```

系统理想行为：

1. 先识别前端、后端、数据层、校验层改动
2. 自动拆分阶段
3. 先落 schema 与 API
4. 再落权限逻辑
5. 再补 UI 和联调
6. 最后做验证并自动停机

## 当前实现局限

根据现有代码，`/loop` 已有以下机制：

- 支持多轮循环
- 支持失败后继续
- 支持 hit round limit 后注入反思信号
- 支持外层 `loop_max_iterations`

当前局限包括：

1. 没有显式阶段拆分
2. 没有阶段状态机
3. 没有结构化验收结果
4. `Completed` 当前更像“本轮结束”，不是“阶段完成”或“目标完成”
5. 没有最终交付停机判定器

## 设计原则

1. 大任务必须先拆分再执行
2. 执行必须围绕“当前阶段”进行，而不是围绕整个大目标发散
3. 停机条件必须结构化、可判断、可解释
4. 阶段切换必须依赖验收结果
5. 失败重试必须优先收敛当前阶段
6. 必须支持中途中断后恢复

## 总体架构

建议将新的 loop 能力拆成四层：

1. 目标规划层
2. 阶段执行层
3. 验收判定层
4. 外层循环编排层

### 1. 目标规划层

输入一个高层目标，输出一个结构化阶段计划。

输出示例：

```json
{
  "goal": "做一个俄罗斯方块游戏",
  "phases": [
    {
      "id": "phase-1",
      "title": "搭建可运行项目骨架",
      "objective": "完成基础页面、游戏容器、运行入口",
      "acceptance": [
        "项目可启动",
        "页面可正常渲染",
        "存在游戏主区域"
      ]
    },
    {
      "id": "phase-2",
      "title": "实现基础游戏循环",
      "objective": "方块可以生成和自动下落",
      "acceptance": [
        "方块会自动下落",
        "一局游戏可持续运行至少10秒"
      ]
    }
  ]
}
```

### 2. 阶段执行层

系统每次只聚焦当前阶段：

- 本轮目标
- 当前阶段验收标准
- 上一轮产出
- 当前阻塞项

模型不能直接跳过当前阶段去实现后续阶段。

### 3. 验收判定层

每轮结束后必须生成结构化验收结果：

```json
{
  "phase_id": "phase-2",
  "phase_completed": true,
  "verification_run": true,
  "verification_passed": true,
  "remaining_issues": [],
  "summary": "方块已可自动生成并稳定下落",
  "next_action": "advance"
}
```

### 4. 外层循环编排层

外层 loop 只负责：

- 是否继续当前阶段
- 是否进入下一阶段
- 是否触发反思收缩
- 是否终止整个任务

## 核心数据结构建议

### LoopProjectPlan

```rust
pub struct LoopProjectPlan {
    pub goal: String,
    pub phases: Vec<LoopPhase>,
    pub created_at: String,
}
```

### LoopPhase

```rust
pub struct LoopPhase {
    pub id: String,
    pub title: String,
    pub objective: String,
    pub acceptance: Vec<String>,
    pub status: LoopPhaseStatus,
    pub attempts: u32,
    pub summaries: Vec<String>,
}
```

### LoopPhaseStatus

```rust
pub enum LoopPhaseStatus {
    Pending,
    InProgress,
    Blocked,
    Completed,
    Failed,
}
```

### LoopPhaseResult

```rust
pub struct LoopPhaseResult {
    pub phase_id: String,
    pub phase_completed: bool,
    pub verification_run: bool,
    pub verification_passed: bool,
    pub remaining_issues: Vec<String>,
    pub summary: String,
    pub next_action: LoopNextAction,
}
```

### LoopNextAction

```rust
pub enum LoopNextAction {
    RetryCurrentPhase,
    AdvanceToNextPhase,
    StopSuccess,
    StopBlocked,
}
```

## 新的 Loop 生命周期

### 阶段 0：规划

当用户输入 `/loop <大任务>` 时：

1. 先生成结构化阶段计划
2. 将计划保存到当前任务状态中
3. 初始化当前阶段为第一阶段

### 阶段 1：执行当前阶段

当前轮 prompt 聚焦以下信息：

- 大目标
- 当前阶段标题
- 当前阶段 objective
- 当前阶段 acceptance
- 上一轮 summary
- 当前失败计数

### 阶段 2：阶段验收

本轮完成后要求模型输出：

- 当前阶段是否完成
- 是否运行验证
- 验证是否通过
- 还有哪些剩余问题
- 下一步动作建议

### 阶段 3：外层判定

外层 loop 根据结构化结果决定：

- 继续当前阶段
- 进入下一阶段
- 全部完成后停止
- 多次失败后停止

## 停机条件设计

### 成功终止

满足以下条件后自动停止：

1. 所有阶段 `Completed`
2. 当前阶段返回 `StopSuccess` 或最后阶段 `AdvanceToNextPhase` 后已无剩余阶段
3. 至少执行过验证
4. 最终没有关键剩余问题

### 阶段内继续

满足以下任一情况时继续当前阶段：

1. `phase_completed = false`
2. `verification_run = false`
3. `verification_passed = false`
4. `remaining_issues` 非空

### 阻塞终止

满足以下任一情况时停止并报告：

1. 连续失败达到上限
2. 当前阶段多轮无进展
3. 必须等待用户输入或审批
4. 工具或环境条件不足以继续

## Prompt 设计建议

当前 loop prompt 比较泛化。建议改造成三段式 prompt：

### A. 项目级目标

```text
当前长期目标：做一个俄罗斯方块游戏。
```

### B. 当前阶段上下文

```text
当前阶段：实现基础游戏循环
阶段目标：方块可以生成并自动下落
验收标准：
- 方块会自动生成
- 方块会自动下落
- 页面无致命错误
```

### C. 执行要求

```text
请只聚焦当前阶段，不要跳到后续阶段。
本轮结束前请运行验证，并输出结构化阶段结果：
- phase_completed
- verification_run
- verification_passed
- remaining_issues
- summary
- next_action
```

## 与当前实现的关系

### 现有可复用部分

以下能力可以直接复用：

- 外层 `LoopState`
- `loop_max_iterations`
- 失败重试逻辑
- hit round limit 后的反思提示
- TUI 后台执行与消息流

### 需要替换或增强的部分

1. `LoopState` 仅存 task / iteration / error_count 不够
2. `Completed` 不能再直接表示“继续下一轮”
3. 需要从“全文本循环”升级到“结构化阶段循环”

## 建议代码改动点

### 1. TUI 状态

文件：

- `interfaces/cli/src/tui/state.rs`

新增：

- `LoopProjectPlan`
- `LoopPhase`
- `LoopPhaseStatus`
- `LoopPhaseResult`

现有 `LoopState` 建议扩展为：

```rust
pub struct LoopState {
    pub task: String,
    pub iteration: u32,
    pub max_iterations: u32,
    pub error_count: u32,
    pub last_summary: String,
    pub plan: Option<LoopProjectPlan>,
    pub current_phase_index: usize,
}
```

### 2. loop 命令入口

文件：

- `interfaces/cli/src/tui/mode_actions.rs`

改动：

- `/loop` 第一次执行时，不直接进入普通任务执行
- 先生成阶段计划
- 将计划写入 `LoopState`

### 3. prompt 生成

文件：

- `interfaces/cli/src/tui/async_actions.rs`

新增：

- `build_loop_phase_prompt(...)`
- `parse_loop_phase_result(...)`

### 4. runner 输出结构

文件：

- `interfaces/cli/src/runner.rs`

改动：

- 增加 loop 专用结构化结果输出
- 支持模型在最终文本中嵌入机器可解析的 JSON 段

### 5. 任务完成后的状态迁移

文件：

- `interfaces/cli/src/tui/async_actions.rs`

改动：

- 当前代码在 `TaskRunState::Completed` 时会继续下一轮
- 需要改成：
  - 先看是否有 `LoopPhaseResult`
  - 再决定是重试当前阶段还是推进下一阶段

## 验收机制建议

建议为大任务 loop 增加三种验收模式：

### 1. 命令验收

例如：

- `cargo test`
- `npm run build`
- `node scripts/check-release.js`

### 2. 文件验收

例如：

- 关键文件是否存在
- 某段配置是否已落地

### 3. 行为验收

例如：

- 页面是否可打开
- 游戏是否能开始
- 控件是否有响应

P0 可以先支持“命令验收 + 文件验收”，P1 再补行为验收。

## 风险点

### 1. 模型规划质量不稳定

风险：阶段拆分可能不合理。

缓解：

- 限制阶段数
- 固定阶段模板
- 对常见任务类型预设规划框架

### 2. 验收结果不可靠

风险：模型可能口头说完成，但实际没有完成。

缓解：

- 强制运行验证命令
- 外层优先相信工具结果，不只相信模型描述

### 3. loop 过度迭代

风险：已经够好仍继续折腾。

缓解：

- 增加成功停机条件
- 增加阶段完成即切换或终止逻辑

### 4. 大任务上下文膨胀

风险：轮次太多，prompt 越来越长。

缓解：

- 每阶段只保留摘要
- 历史只保留最近几轮和阶段结论

## 分阶段实施

### P0：让 loop 具备“阶段推进”能力

范围：

1. 新增阶段计划结构
2. `/loop` 首轮先产出计划
3. 当前阶段 prompt 收窄
4. 结构化阶段结果输出
5. 成功推进到下一阶段

### P1：让 loop 具备“验收停机”能力

范围：

1. 命令验收
2. 文件验收
3. 成功停机条件
4. 无进展检测

### P2：让 loop 具备“工程闭环”能力

范围：

1. 会话恢复
2. 阶段模板库
3. 不同任务类型的规划器
4. 与项目知识系统联动

## 对项目知识系统的联动价值

这个方案和前面的项目知识沉淀系统是强耦合的。

联动方式包括：

1. `project-profile.md` 帮助 loop 规划阶段
2. `workflows.md` 帮助 loop 决定执行顺序
3. `pitfalls.md` 帮助 loop 避开历史失败模式
4. `modules.md` 帮助 loop 限定改动范围

因此，这个 loop 升级方案和项目知识系统适合并行推进。

## 成功标准

该方案落地后，以下任务应具备明显改善：

1. 从零搭建中小型 demo 项目
2. 为现有项目新增中等复杂度功能
3. 连续多阶段修复问题
4. 从 idea 到可用成品的自治推进

理想结果是：

- 用户给一个大目标
- 系统自动拆阶段
- 系统逐阶段完成
- 每阶段自动验证
- 全部通过后自动停止

## 结论

当前 `/loop` 已经有“连续迭代”能力，但还没有“分阶段自治交付”能力。

本方案的核心升级点是：

1. 目标拆分
2. 阶段状态机
3. 结构化验收
4. 成功停机条件

完成这些升级后，SaCode 的 `/loop` 会从“持续重试工具”升级成“面向大任务的自治交付控制器”。
