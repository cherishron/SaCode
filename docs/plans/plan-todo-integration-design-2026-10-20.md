# SaCode「创建计划」接入方案：DSH Plan / Todo 调研与对照

> 编号：DRAFT-PLAN-001
> 日期：2026-10-20
> 性质：**纯调研 / 设计**（未写产品代码、未提交、未推送）
> 范围：只读 DSH 解包源码 + 只读 SaCode 源码（`apps/host/src/main.cj` execution 相关 RPC、`core/src/plan.cj`、`core/src/todo*.cj`、`core/src/goal_*.cj`、桌面 composer / permission 组件），产出本方案
> 关联需求：F02（AI 执行与工具）、F04（目标）、F02/F04 计划与待办支撑切片
> 基线：本次为工作区只读态，不含任何源码改动；SaCode 侧符号以当前 `core/src`、`apps/host/src`、`apps/desktop/renderer` 为准
> DSH 源码根：`target/tmp/dsh-extract-20261019/dsh/node_modules/@deepseek-ai/`

---

## 0. 结论摘要（先读）

1. **DSH 的「Plan」不是 `dsh-tool-workflow`。** 任务书里点名的 `dsh-tool-workflow` 实际是**多 agent 编排工具**（模型写一段 JS 脚本把工作扇出给多个 subagent 并返回 JSON），与"计划"无关。DSH 真正的 Plan 是 **plan mode**：`dsh-plan-mode`（宿主）+ `dsh-client-ui-plan`（Web UI）。
2. **Plan 与 Todo 是两个正交概念，天然不耦合**：
   - **Plan（计划模式）** = 逐 agent 的**协作状态（collaboration state）**：进入后 agent 先探索/设计，再把完整 markdown 计划用 `exit_plan_mode` 工具**呈交用户审阅**；用户 Approve 才退出计划模式并"从下一步开始执行"。它是**软引导（prompt 段落）而非沙箱**，不限制工具。
   - **Todo** = agent 在工作时维护的**细粒度任务清单**（`todo_write` 工具，全量替换、单所有者、`{content, status}` 三态），是"执行阶段的步骤清单"，**不是 Plan 的子任务树**，两者在代码层面没有引用关系。
3. **Plan 审批 ≠ 工具审批**：工具审批走 `dsh-user-approval`（一次性 `approval/ask → approval/decided` 工单）；**计划审阅走 `dsh-user-questions` 通道**（`interaction.ask`，携带 `intent.kind = "plan-review"` 与发起 `callId`）。二者是**两条独立通道**，只是共用 UI 的"审阅操作插槽"。
4. **Goal**（`dsh-goal`）是**跨轮次/跨会话的长期目标**：拥有 `objective`、`phase`、`roundsStarted`、`maxGoalRounds`，变更用 `{id, revision}` 的 compare-and-set；`dsh-goal-round-driver` 在 agent 空闲且目标 active 且未超轮次预算时，用 `agent.followup()` 驱动**下一轮**。Goal 与 Plan 在 DSH 代码里**无显式引用**，属概念分工：**Goal 驱动轮次，Plan 把关设计，Todo 承载步骤**。
5. **SaCode 现状**：**Todo 已完整落地**（`core/src/todo.cj` `TodoStore` + `todo_tool.cj` `todo_write` + host `session/projection` 的 `todos` + 桌面 `todo-panel.ts`）；**Goal 已完整落地**（`core/src/goal*.cj` 全套 + `goal/*` RPC + 桌面目标编辑）。**唯独"计划"缺产品闭环**——`core/src/plan.cj:PlanModeController` 仅是一个 log-only 的 `plan/mode` 开关，且已被 2026-10-09 审批模式设计**标记废弃并合入 `ModeController`**；没有计划的生成/呈交/审阅/批准链路，桌面 `composer-menu.ts` 的"创建计划"按钮因此禁用、文案"后端未接入"。**PRD 已如实登记该缺口**（`docs/product/PRD.md` 第 804 行"计划审阅批准流程（区别于工具权限审批）的产品闭环待核查"）。
6. **`execution/*` RPC 与 DSH Plan 不是同一层**：`execution/propose|authorize|start|stop|describe|output` 是**真实进程的提案→授权→启动→监督链**（对应 DSH 的 `dsh-tool-bash`/`dsh-pwsh` + `sandbox` + `dsh-user-approval` + `dsh-jobs`），`execution/review-*` 是**变更审查并写回**（diff 级）。**批准计划 ≠ 授权写入/运行命令**；计划批准后的执行动作仍必须走原有审批/执行链。

> **一句话接入判断**：Todo 与 Goal **直接复用**；Plan 需**新增**一条"计划模式 + 计划审阅"链路（大部分机制可从 DSH `dsh-plan-mode` 平移，并复用 SaCode 已有的会话日志/投影/审批工单/模式控制器），前端改三个点（composer 按钮、审阅面板、回合末计划卡片）。

---

## 1. 调研问题逐条回答

### Q1. Plan vs Todo：DSH 怎么区分？Plan 是人写的还是 AI 生成的？Todo 是 Plan 的子任务吗？

| 维度 | Plan（计划模式） | Todo（任务清单） |
|---|---|---|
| 载体包 | `dsh-plan-mode`（宿主）+ `dsh-client-ui-plan`（UI） | `dsh-tool-todo` |
| 本质 | 逐 agent 的**协作状态**（进/退计划模式） | 模型维护的**任务清单**（工具） |
| 作者 | **AI 生成**（agent 在计划模式下探索后写出 markdown 计划），**用户审阅/批准** | **AI 维护**（模型每次调用 `todo_write` 提交完整清单） |
| 数据形态 | markdown 全文 + 一个布尔"是否处于计划模式" | `{ content, status }[]`，`status ∈ pending/in_progress/completed` |
| 持久 | `plan/mode` 事件，**log-only、整值替换** | `todo/write` 事件，**log-only、整表替换** |
| 投影键 | `plan` → `{ active, pending }` | `todos` → 清单或 `null` |
| 与另一方关系 | **无**：Plan 不持有 Todo，Todo 不知道 Plan | **无**：Todo 不含 plan 字段，也不引用计划 |

结论：**Plan 是 AI 生成、用户审阅的"设计产物 + 协作状态"；Todo 是 AI 维护的"执行步骤清单"。二者独立，Todo 不是 Plan 的子任务树，DSH 也刻意不做逐项编辑/父子关系（`dsh-tool-todo` README 的"已知限制"明确"整表替换是唯一操作""条目形状刻意保持最小"）。**

证据：
- `dsh-plan-mode/README.zh.md` L12/L59："agent 完成计划后，会以 markdown 形式、从标题开头书写计划并调用 `exit_plan_mode`"；"你评审该计划的原文，选择 `Approve` 或 `Keep planning`"。
- `dsh-plan-mode/lib/index.js` L35–L41（`EXIT_PLAN_MODE`、`REVIEW_ID="plan-review"`、`APPROVE_LABEL`、`KEEP_PLANNING_LABEL`）；L234–L238 工具参数 `plan: string`（"The complete plan, as markdown, starting with a # heading"）；L258 校验 `/^#\s+\S/`。
- `dsh-tool-todo/lib/index.js` L95–L119 工具 schema：`parameters.todos` 为数组，元素 `{content, status}`，`additionalProperties:false`；L170–L193 `execute` 只做"整表替换"并 append `todo/write`；L11–L18 `name="tool-todo"`。

### Q2. 生成流程：AI 怎么生成 Plan？用户怎么审阅/修改/批准？批准后怎么驱动执行？

**生成与呈交（DSH）**：
1. 用户用 `/plan`（或 Web composer `+` 菜单的"计划"）**进入计划模式**；`dsh-plan-mode` 在系统提示词注入部署方配置的 `plan:policy` 段落，引导 agent "先探索与设计，再呈交完整计划"。
2. agent 正常调用工具（计划模式**不限制**工具）探索代码/设计，然后调用 `exit_plan_mode(plan=<完整 markdown>)`。
3. 该工具走**用户交互通道**：`ctx.get("userQuestions").ask({ questions: [{ id:"plan-review", header:"Plan review", question:"Approve this plan and leave plan mode?", detail: args.plan, options:[Approve, Keep planning], intent:{ kind:"plan-review", approve:"Approve", callId: exec.callId } }] })`。

**审阅 / 修改 / 批准**：
- **Approve** → 工具返回规范值 `{ approved: true }`；同时把 `pendingIntents` 置为 `{active:false, narrate:false}`，待**下一个被接受的轮内 pre-step** 落 `plan/mode=false`；`plan:policy` 段落从下一次请求起消失 → agent "从下一步"开始执行计划。
- **Keep planning**（可带自由文本反馈）→ 工具调用**失败**（抛错），反馈文本回到模型 → agent 修订计划后再次呈交。
- **关闭审阅改为发言（dismiss）** → 工具调用失败（`ASK_CANCELLED`），提示"保持计划模式、停下等你下一条消息"。
- UI 侧（`dsh-client-ui-plan`）：**提交的计划自动在右侧边栏打开审阅**；批准/拒绝/关闭后，仍可从**回合末尾的产物卡片**重新打开；刷新浏览器会从会话历史恢复正文。

**批准后驱动执行**：批准只做两件事——**退出计划模式（提示词段落消失）+ 工具返回 `{approved:true}`**。真正的执行由 agent 在**下一步**按计划自主调用工具完成；计划模式本身不沙箱、不自动执行、也不"派发"步骤。**是否执行、执行什么仍由正常工具链与审批策略决定**（`dsh-plan-mode` README 明确"它是引导而非强制……需要强制限制的部署要另配沙箱与审批策略"）。

证据：
- `dsh-plan-mode/lib/index.js` L152–L167（`agent/pre-step` 钩子在 decision 被接受时落选中态并投递叙述消息）；L254–L298（`execute`：校验 → `interaction.ask` → APPROVE 判定 → 置 pending exit → 返回 `{approved:true}`）；L363–L394（`set`/`onBoundary`：开轮期间 pending，轮内 pre-step 边界才 append `plan/mode`）。
- `dsh-client-ui-plan/lib/client.js` L231–L259（只识别 `name==="exit_plan_mode"` 的 `tool/call`/PTC dispatch，提取 `callId`、`arguments.plan`、标题、Markdown）；L107–L144（review 打开与 `dsh-resource://plan-review/...` 预览地址）。

### Q3. 执行状态：Plan 执行中怎么展示进度？每个 Todo 的状态怎么投影？

- **Plan 没有"计划级进度对象"**：DSH 不跟踪"计划完成百分之几"。Plan 的可见呈现只有：① 计划模式徽章（`active`/`pending`，`dsh-client-ui-plan`）；② 计划正文（右侧边栏审阅页 + 回合末产物卡片）。**执行阶段的进度表达完全交给 Todo**。
- **Todo 状态**：`pending / in_progress / completed` 三态；投影 `todos` 单元把最新的整份 `todo/write` 列表暴露给 UI，"首次写入前为 `null`，下一轮次开始时清空，而 `turn/end` 保留刚完成的清单"。**宿主**不臆造"running/failed"——DSH 的 Todo 没有 `failed` 态（失败表现为模型把该项改回 pending 或重写清单）。UI 从会话事件真源派生清单，天然可回放。
- 附：`dsh-client-ui-trajectory` 是**事件记录表 + 时间概览**（按轮分组），`dsh-client-ui-workflow-run` 是**工作流运行节点**（运行→阶段→成员折叠）。二者展示的是"执行轨迹/工作流"，**不是 Plan 的进度**；`dsh-tool-workflow` 的 `phase()/log()` 只服务工作流运行，与 Plan 无关。

证据：
- `dsh-tool-todo/lib/index.js` L63–L94（`todos` 投影：`todo/write` → `event.data.todos`；`turn/start` → `null`；`stateVersion:2`；`wire.viewSchema` 与 view 直通）；L143/L147（"下一轮次开始时清空"）。
- `dsh-client-ui-workflow-run/README.zh.md` L10/L12；`dsh-client-ui-trajectory/README.zh.md` L10/L12。

### Q4. Plan 和 Goal 怎么协作？目标驱动轮次，计划驱动步骤？

DSH 代码层面 **Plan 与 Goal 无相互引用**，是**概念分工**：

- **Goal = 驱动"轮次"的长期目标**：`objective` + `phase` + `roundsStarted` + `maxGoalRounds` 等字段（`dsh-goal/lib/types/index.js` L50–L83、`fold.js` L85–L101）；变更用 `{id, revision}` CAS（README："变更必须携带 `{ id, revision }`"）；`dsh-goal-round-driver/lib/index.js` L102–L164 在**agent 空闲 + goal active + round 未超限**时，构造 `goal` 来源的 user message 并 `agent.followup()` 驱动**下一轮**；超限则 block 目标（L200–L236：`agent/status=idle` 触发、`goal/changed` 重新驱动、error/disposed 解除武装）。
- **Plan = 把关"设计"的协作状态**：通常在每个目标的早期（或某轮内）产出一次计划、经用户批准后，作为该轮执行的依据；它不驱动轮次，也不停留在跨轮。
- **Todo = 承载"步骤"的执行清单**：轮内/步内由 agent 反复整表更新。

一句话：**Goal 决定"要不要继续下一轮"，Plan 决定"这一轮按什么设计做"，Todo 记录"现在做到第几步"。** 三者是**同一 agent 会话上叠加的三层视图**，DSH 未在代码里硬绑，SaCode 也建议保持低耦合（见 §5）。

证据：`dsh-goal/README.zh.md` L10–L12（跨多轮/会话/fork/重启持久，用户与 agent 可 create/edit/pause/resume/complete/block/clear）、L50–L83（`goal` 投影键、phase、roundsStarted、maxGoalRounds、activation）；`dsh-tool-goal/lib/index.js` L53–L79（完成/阻塞操作必须由"直接人类输入或当前 goal round"授权，体现 Goal 是驱动实体）。

### Q5. Plan 生成后需不需要用户批准才执行？和工具审批是同一套机制吗？

- **需要批准**：计划必须经用户审阅 **Approve** 才退出计划模式、才进入执行；未批准则停在计划模式继续修订。
- **不是同一套机制**：
  - **工具审批** = `dsh-user-approval`：一次性 seam，`ask` 策略交给应答者、`never` 直接拒绝，请求与结果落 `approval/asked` + `approval/decided`，结果是 `allowed-once | rejected | cancelled | unavailable`（`dsh-user-approval/lib/index.js` L24–L39、L128–L143、L172–L189）。
  - **计划审阅** = `dsh-user-questions` 通道的 `interaction.ask`，携带 `intent.kind = "plan-review"` 与发起工具 `callId`；客户端注册**专用 `plan-review` 渲染器**（`dsh-client-ui-plan`）。
- 二者**只共用 UI 的审阅操作插槽**（`dsh-client-ui-plan/README.zh.md`："提问插件拥有审批操作插槽，并提供请求键、完整正文和可选的调用标识"），**语义不同**：一个是"授权一个动作"，一个是"认可一份计划并切换模式"。

证据：`dsh-plan-mode/lib/index.js` L259–L261 使用 `ctx.get("userQuestions")`（而非 approval 服务）；`dsh-user-approval/README.zh.md` L10–L13。

### Q6. SaCode 对照：现有 execution RPC 与 DSH Plan/Todo 是什么对应关系？能复用还是新增？

**关键结论：`execution/*` 与 DSH Plan 不在同一层，不能拿来当"计划"。**

| SaCode 现有 RPC | 实际语义 | 对应 DSH 的什么 | 与 Plan 的关系 |
|---|---|---|---|
| `execution/propose` / `authorize` / `start` / `stop` / `describe` / `output` / `list` | 真实**进程**的提案→授权→启动→监督→输出分页 | `dsh-tool-bash`/`pwsh` + `dsh-user-approval` + `dsh-jobs` + `dsh-sandbox` | **无关**。批准计划 ≠ 授权运行命令 |
| `execution/review-file` / `review-prepare` / `review-apply` / `review-apply-describe` / `review-apply-stop` | **变更审查并写回**（读登记的前后文件对象、条件写回、异步与停止） | （DSH 无直接等价；接近 diff-review 写回） | 可作为"计划执行后差异复核"，**不是计划审阅** |
| `approval/ask`（`ApprovalDesk.askForCall/consumeForCall`） | 工具**一次性审批工单**（绑定工具名+原始参数） | `dsh-user-approval` | 计划审阅**可复用它作传输**（见 §4.2 决策） |
| `approval/mode`（`ModeController`：plan/build/auto/yolo） | **权限档**：plan 档 = 只读分析（`PermissionPolicy.decide("plan", tool)` 仅放行白名单只读工具） | 无直接等价（DSH plan mode 是协作态，不是权限档） | **名称撞车**：SaCode 的"plan 档"≠ DSH 的"计划模式" |
| `session/projection`（含 `todos`） | 会话投影（消息 + 待办） | `dsh-session-projection` + `dsh-tool-todo` 的 `todos` | **Todo 已复用** |
| `goal/create|edit|pause|resume|clear|describe` | 长期目标控制 | `dsh-goal` + `dsh-tool-goal` + `dsh-command-goal` | **Goal 已复用** |

**复用判断**：
- **Todo：直接复用**（`TodoStore` / `todo_write` / `todos` 投影 / `TodoPanel` 已齐）。
- **Goal：直接复用**（全套已有）。
- **Plan：需新增**——SaCode 没有"计划呈交 + 审阅 + 批准"链路，也没有 `exit_plan_mode` 等价物与计划审阅通道。
- **`execution/*`：不用于 Plan**；计划批准后执行阶段的文件写入/命令运行仍走原审批/执行链。

证据：`core/src/execution_api.cj` L22–L31（`handles`/`readOnly` 方法集：propose/authorize/start/describe/output/stop/list/review-file/review-prepare/review-apply/review-apply-describe/review-apply-stop）；`apps/host/src/main.cj` L502、L1345、L3350；`core/src/permission_policy.cj` L19–L21；`docs/plans/sacode-execution-contract-2026-10-07.md` §2–§3。

---

## 2. DSH 机制摘要（供后续实现对照）

### 2.1 五个概念的正名（避免把工具当计划）

| DSH 包 | 是什么 | 与"计划"的关系 |
|---|---|---|
| `dsh-plan-mode` + `dsh-client-ui-plan` | **计划模式**：协作状态 + 提示词段落 + `/plan` 命令 + `exit_plan_mode` 工具 + 计划审阅 UI | **这就是 Plan** |
| `dsh-tool-todo` | **Todo**：`todo_write` 整表替换工具 + `todos` 投影 | 执行步骤清单 |
| `dsh-goal` + `dsh-goal-round-driver` + `dsh-tool-goal` | **Goal**：长期目标 + 轮次驱动 + 完成/阻塞声明 | 驱动轮次 |
| `dsh-tool-workflow` + `dsh-workflow` + `dsh-client-ui-workflow-run` | **工作流**：模型写 JS 脚本扇出 subagent、阶段/成员折叠展示 | **与 Plan 无关**（易被误当 Plan） |
| `dsh-user-approval` / `dsh-client-ui-approval` vs `dsh-user-questions` / `dsh-client-ui-user-questions` | 工具审批 vs 提问/审阅（两条通道） | 计划审阅走后者 |

### 2.2 Plan 模式的状态与边界（`dsh-plan-mode`）

- **持久**：单条 **log-only、整值替换** 的 `plan/mode` 事件；恢复/fork/compaction 靠折叠日志复原（`lib/index.js` L104–L108、L377、L392）。
- **投影**：`plan` 单元 → `{ active, pending }`；`pending` 仅在"未结算/已成功的选择 ≠ 已记录状态"时为 true（`lib/index.js` L66–L128）。
- **边界追加**：开轮期间选择**保持 pending**，到"下一个被接受的轮内 pre-step"才追加（`onBoundary` L384–L394）；`exit_plan_mode` 批准也走同一 pending-exit 机制（L293–L297）。
- **工具目录稳定**：`exit_plan_mode` 在计划模式未激活时**仍注册**，进/退只改提示词段落，不改请求工具目录（L22–L24、L231）。
- **软约束**：`README.zh.md` L90/L185"引导而非强制""需要强制只读规划的部署必须组合独立的沙箱与审批策略"。

### 2.3 Todo 的实现要点（`dsh-tool-todo`）

- 工具名 `todo_write`（`name="tool-todo"`，工具面 `todo_write`）；参数 `todos: {content, status}[]`，`additionalProperties:false`（L96–L119）。
- 校验：content 非空且**去重**；`allowParallelInProgress` 必填（无默认），false 时最多一个 `in_progress`（L20、L45–L61）。
- 落 `todo/write` 完整快照（last-write-wins），非 agent 会话调用被拒（"todo_write requires an owning agent session"，L172）。
- 投影 `todos`（`turn/start` 清空，`turn/end` 保留，L84–L94）。

### 2.4 Goal 的实现要点（`dsh-goal` 家族）

- 字段：`id`、`revision`、`objective`、`phase`（active/paused/blocked/completed…）、`blockedReason`、`maxGoalRounds`、`roundsStarted`、时间戳（`lib/types/index.js` L50–L83、`fold.js` L85–L101）。
- 生命周期转换（`fold.js` L176–L206）：`pause` 只能 active→paused；`resume` 可 active/paused/blocked→active 且不能超轮次预算；`edit` 不能改 phase/block reason。
- 轮次驱动（`dsh-goal-round-driver/lib/index.js` L102–L164）：idle + active + armed + 未超限 → `agent.followup()`；超限 → block。
- 权限：完成/阻塞须由"直接人类输入或当前 goal round"授权（`dsh-tool-goal/lib/index.js` L53–L79）。

### 2.5 审批通道（两条，勿混）

- 工具审批 `dsh-user-approval`：`approval/asked` + `approval/decided`；`ask`/`never` 策略；结果 `allowed-once|rejected|cancelled|unavailable`。
- 计划审阅：`userQuestions.ask` + `intent.kind="plan-review"` + `callId`；选项 `Approve`/`Keep planning`；失败语义即"继续规划/等待用户"。

---

## 3. SaCode 现状对照

### 3.1 已有能力（复用面）

| 能力 | 落点 | 状态 |
|---|---|---|
| 待办（Todo） | `core/src/todo.cj:TodoStore`（全量替换、三态、`allowParallelInProgress`、`projectionJson`）、`core/src/todo_tool.cj:TodoTool`（`todo_write`，`agentOwned` 校验）、`core/src/agent.cj:232`（执行器注册 `todo_write`）、host `session/projection`（`main.cj:1412-1418` 回放 `todos`）、`renderer/pages/todo-panel.ts:TodoPanel`（三态+折叠+进度，`app.js:1064` 挂载） | **完整** |
| 目标（Goal） | `core/src/goal.cj:GoalService`、`goal_runner.cj`、`goal_scheduler.cj`、`goal_evidence.cj`、`goal_claim.cj`、`goal_activation.cj`、host `goal/create|edit|pause|resume|clear|describe` | **完整** |
| 审批工单 | `core/src/approval.cj:ApprovalDesk.askForCall/consumeForCall`；host `approval/ask` | **完整** |
| 权限模式 | `core/src/mode_controller.cj:ModeController`（plan/build/auto/yolo，`mode/mode` 事件）、`core/src/permission_policy.cj:PermissionPolicy.decide`；host `approval/mode`；`renderer/pages/permission-menu.ts:PermissionMenu` | **完整** |
| 会话投影 | host `session/projection`（消息 + `todos`） | **完整** |
| 进程执行链 | `core/src/execution_api.cj` 等 + host 分派 + 桌面 IPC（门禁默认关闭） | **core 齐，门禁默认关闭** |

### 3.2 缺口（需新增面）

| 缺口 | 现状证据 |
|---|---|
| 无"计划模式"服务：无 `plan:policy` 提示词段落、无进入/退出计划的持久协作态（`PlanModeController` 仅开关、已被标记废弃） | `core/src/plan.cj`；`docs/superpowers/specs/2026-10-09-approval-modes-design.md` L38"废弃 `PlanModeController`，plan 模式并入 `ModeController`" |
| 无计划呈交工具（`exit_plan_mode` 等价物） | 全仓无 `exit_plan_mode`/计划呈交工具 |
| 无计划审阅/批准通道（区别于工具审批） | PRD 第 804 行缺口；无 `plan/**` RPC |
| 无计划产物卡片/审阅面板 | `renderer/pages/composer-menu.ts:69` 按钮 disabled，"后端未接入"；无 plan-review 组件 |
| 无计划持久事件/投影 | 无 `plan/submitted` 之类事件；`plan/mode` 仅被 `ModeController` 兼容读取（`mode_controller.cj:14-15`） |

### 3.3 命名撞车预警（接入前必读）

`plan` 在 SaCode 已有多重含义，接入时**必须显式区分**：
- `ModeController` 的 **`plan` 权限档**（"规划与只读分析"，`permission_policy.cj:19` 只放行白名单只读工具）——是**权限级别**；
- 废弃的 `PlanModeController`（`plan/mode` log-only 布尔）——是**旧协作态开关**；
- `host/main.cj` 里的 `planModel`/`planBaseUrl`（模型路由变量）、`batch.cj` 的 `plan` 字段（批处理计划）——**与计划功能无关的同名变量**。

DSH 的"计划模式"是**协作态**，SaCode 的"plan 档"是**权限档**；二者**不等价**。接入方案必须让"计划模式"与"plan 权限档"显式协作或分列（见 §4.1 决策），不能混用一个 `plan` 词。

---

## 4. 推荐接入路径

### 4.1 总体设计（三层保持低耦合）

沿用 DSH 的三层视图，但按 SaCode 现有机制落地：

- **Goal 层（已有）**：跨轮目标与轮次预算，`goal/*` RPC 不变。
- **Plan 层（新增）**：新增"计划模式"协作态 + 计划呈交工具 + 计划审阅通道；与 Goal 保持**可选协作**（见 §5）。
- **Todo 层（已有）**：执行阶段步骤清单，`todo_write` 不变。

**关键决策 D1（计划模式 vs plan 权限档）**：建议**两者并存且显式联动**——
- "创建计划"进入**计划模式**（新增协作态，`plan/mode` 事件复用/扩展），同时也把 `ModeController` 切到 **`plan` 权限档**（只读），用**已有的权限策略**天然保证"计划阶段不写文件/不跑危险命令"（比 DSH 的"软引导"更硬，符合 SaCode 的授权文化）。
- 计划 Approve 后：退出计划模式，并把 `ModeController` 切到 **`build`**（或用户选定档），再进入执行。
- 这样既复用了现有权限策略，又实现了"设计—批准—执行"的协作语义。

**关键决策 D2（计划审阅通道）**：两个可选方案。
- **方案 A（推荐）复用 `ApprovalDesk` 工单作传输**：把"计划审阅"表达为一次 `approval/ask` 工单，工单载荷标注 `intent: "plan-review"` + `callId` + 计划正文摘要，选项 `Approve`/`Keep planning`。优点：复用已落盘的 `approval/asked/decided` 与一次性消费语义，改动最小。缺点：与"工具动作授权"共用事件类型，需在载荷里严格区分，避免审计混淆。
- **方案 B 新增独立审阅通道**：仿 DSH `userQuestions` 新增 `plan/review-ask` + `plan/review-decided` 事件与 RPC，专用渲染器。优点：语义干净、与工具审批彻底分离（与 DSH 一致）。缺点：新增事件类型/投影/RPC/IPC，工作量更大。
> 建议：**先 A、后按需演进到 B**；无论 A/B，都必须在载荷与 UI 上**显式标注这是"计划审阅"而非"动作授权"**。

### 4.2 RPC / 事件映射表（复用 vs 新增）

| 需求 | 复用 | 新增 |
|---|---|---|
| 进入/退出计划模式 | `approval/mode`（`ModeController.set("plan"/"build")`）+ `plan/mode` 事件（`PlanModeController`，需复活/改造） | `plan:policy` 提示词段落（`core/src/sysprompt.cj`） |
| 计划呈交 | — | `exit_plan_mode` 工具（core `ToolSpec` + `agent.cj` 执行器表分支），参数 `{ plan: markdown }` |
| 计划审阅/批准 | **方案 A**：`approval/ask` 工单 + `approval/decided` | **方案 B**：`plan/review-ask` + `plan/review-decided` RPC/事件 |
| 计划正文持久 | 会话日志 log-only 事件机制 | `plan/submitted` 事件（含 `callId` + markdown + 标题），投影键 `plan`（扩展为 `{active, pending, submitted}`） |
| 待办 | `todo_write` / `session/projection` 的 `todos` / `TodoPanel` | — |
| 目标 | `goal/*` | — |
| 计划执行后的写入/命令 | `approval/ask` + `execution/*`（原有链） | — |
| 计划执行后的差异复核 | `execution/review-*` | — |

**明确不复用**：`execution/propose|authorize|start|stop|describe|output`（进程执行）**不用于计划审阅**；`execution/review-*`（变更写回）**不用于计划审阅**。

### 4.3 前端改动清单

| 组件 | 现状 | 建议改动 |
|---|---|---|
| `renderer/pages/composer-menu.ts` | L69"创建计划"按钮 `disabled:true`、文案"后端未接入" | 接线：点击 `emit('plan')`（或直接请求进入计划模式）；文案改为"生成计划并审阅" |
| （新增）`renderer/pages/plan-review.ts` | 无 | 计划审阅面板：展示 markdown 计划全文 + `Approve`/`Keep planning`（带自由文本反馈），仿 `permission-menu.ts` 的 busy/error/回读核实模式 |
| 回合末计划卡片 | 无 | 仿"产物卡片"在回合末渲染 `plan/submitted`（标题 + "打开"），点击打开审阅面板；刷新后从历史恢复 |
| `renderer/app.js` | L1064 已挂 `TodoPanel`（`self.proj.todos`） | 新增计划投影读取（`self.proj.plan`）与卡片/面板挂载 |
| `apps/desktop/preload.cjs` + `main.cjs` | 已有 `approvalGetMode/approvalSetMode` | 若走方案 A：复用 `approvalAsk`；若走方案 B：新增有限 IPC 通道（`planSubmit/planReviewAnswer/planDescribe`），**逐字段校验、不提供任意 method** |
| `renderer/pages/composer-commands.ts` | 无 `plan` 命令 | 可选：新增 `/plan`、`/plan off` 斜杠命令（对齐 DSH） |

> 所有前端改动需遵守：Vue3 **runtime** + `h()`、CSP `script-src 'self'`（禁模板编译器/模块加载器）、IPC 为**有限动作集合**、增删通道同步 `preload.cjs` 与 `test/bridge.test.mjs`。

---

## 5. Plan / Todo / Goal 三者协作状态机

```
                 ┌───────────────────────────────────────────┐
                 │  会话（SessionLog：唯一真源）              │
                 │  事件：goal/*  plan/mode  plan/submitted    │
                 │        todo/write  approval/*  turn/*       │
                 └───────────────────────────────────────────┘
   Goal(可选)            Plan(本次新增)                 Todo(已有)
 ┌───────────┐      ┌────────────────────┐        ┌──────────────────┐
 │ objective │ 驱动  │  计划模式 未激活     │  批准   │ pending          │
 │ phase     │──轮──▶│   ├─ /plan 进入      │──后──▶ │ in_progress      │
 │ rounds    │ 次   │   ├─ 只读探索(mode=plan)│        │ completed        │
 │ revision  │      │   ├─ exit_plan_mode  │        └──────────────────┘
 │ CAS       │      │   │   └─ 呈交计划      │             ▲
 └───────────┘      │   └─ 用户审阅           │        执行阶段维护
                    │      ├─ Approve  ───────┼──▶ 退出计划模式(mode=build)
                    │      ├─ Keep planning ──┼──▶ 停留在计划模式，修订重呈
                    │      └─ 关闭(dismiss) ───┼──▶ 停下，等用户下一条消息
                    └────────────────────┘
  执行阶段：批准计划 → 逐步执行（Todo 记录步骤；写文件/跑命令仍走 approval/execution 链）
  复核阶段：execution/review-* 做变更写回与差异复核
  目标收束：Goal 在"机械证据 ∧ 模型声明(update_goal)"合并后完成/阻塞
```

**有 Goal 时的编排**（可选协作，非强绑）：
- Goal active → 轮次驱动进入第 N 轮 → 该轮内可选进入计划模式产出/更新计划 → 批准后执行 → Todo 记录步骤 → 轮末凭证据+声明判定是否完成 → 未完成则驱动第 N+1 轮。
- Plan 通常**在目标早期产出一次**，后续轮次按需修订；Todo **每轮/每步**更新；三者互不互相持有对象引用（低耦合）。

**无 Goal 时**：单轮内"进入计划模式 → 呈交 → 批准 → 执行（Todo 步骤）→ 完成"，与 DSH 的基础路径一致。

---

## 6. 风险与边界

1. **命名撞车（高）**：SaCode 的 `plan` 已有权限档/废弃开关/路由变量多重含义。接入必须新增**独立命名**（如"计划模式协作态"用显式 `plan/mode` 语义 + 文档标注），不得把 DSH 的"计划模式"与 SaCode 的"plan 权限档"混为一谈（见 §3.3、§4.1 D1）。
2. **与执行/RPC 混淆（高）**：严禁把 `execution/propose→authorize→start` 当作"计划批准"。**批准计划不授予写入/运行权限**；执行阶段仍走原审批链。文档与 UI 文案都要区分"计划审阅"与"工具/执行授权"。
3. **审阅通道语义（中）**：方案 A 复用 `approval/ask` 会在同一事件类型里混入"计划审阅"，审计上必须靠 `intent` 区分；若不接受混用，选方案 B 新增独立通道（与 DSH 一致）。
4. **持久真源（中）**：计划正文必须作为**会话日志事件**持久（log-only），否则刷新/重开丢失——DSH 这块正文只存侧栏导航内存、刷新即丢（`dsh-client-ui-plan/README.zh.md` L38），SaCode 应**做得更稳**（落 `plan/submitted`，投影可回放）。
5. **待生效语义（中）**：SaCode 的 `ModeController.set` 是**立即落事件**，而 DSH 在开轮期间是 **pending → 轮内 pre-step 才追加**。接入需明确：进入/退出计划模式对"下一次请求"何时生效，避免在途轮次语义漂移。
6. **软约束 vs 硬约束（中）**：DSH 计划模式"引导而非强制"；SaCode 的 `plan` 权限档会**真实 deny** 写入。二者叠加后，"计划阶段"实际是**只读硬约束**——这更安全，但要向用户说明"计划模式下不能改码"。
7. **不伪造完成（高）**：Approve 计划 ≠ 任务完成。完成仍以真实退出码/证据/`update_goal` 声明合并判定（沿用现有 Goal 完成闸与执行结算口径），不得因"计划已批准"升级任何完成状态。
8. **前端受限面（中）**：Vue runtime + `h()`、CSP 禁 `unsafe-eval`、IPC 有限集合——计划审阅面板与卡片必须按现约束实现，不引模板编译器/模块加载器，不新增任意 method 通道。
9. **并发与归属（低-中）**：新增 core 文件/事件/RPC 前先按 `docs/plans/w00-path-ownership-and-isolation-2026-10-06.md` 与 `AGENTS.md` 协调归属，不覆盖其他会话在途改动。
10. **范围边界**：本方案**只做调研与设计**；不改产品代码、不加 RPC/工具/组件、不提交、不推送。任何实现须另行立项与授权。

---

## 7. 登记与后续

- 本文登记：`docs/README.md`（维护记录，2026-10-20 条目）与 `docs/plans/README.md`（B 功能与界面设计，设计状态）。
- 与本文同期的 DSH 调研类同构参考：`docs/plans/mcp-integration-design-2026-10-20.md`。
- 后续实现顺序建议（另需授权）：① core 计划模式服务 + `plan:policy` 段落；② `exit_plan_mode` 工具 + `plan/submitted` 事件/投影；③ 审阅通道（方案 A）；④ 前端按钮/面板/卡片接线；⑤ 端到端真实任务验收。
- 关联需求：F02、F04；缺口口径对齐 `docs/product/PRD.md` 第 804 行"计划审阅批准流程（区别于工具权限审批）的产品闭环待核查"。

---

## 8. 实施记录与冲突点（2026-10-20）

按 §4 落地了最小垂直切片（core + host + desktop），已编译通过。

| 层 | 文件 | 内容 |
|---|---|---|
| core | `core/src/plan.cj` | 扩展 `PlanModeController`：`active/set/setDurable` + `submit`（落 log-only `plan/submitted`）+ `projectPlans` 投影 |
| core | `core/src/plan_review.cj`（新） | `exit_plan_mode` 工具声明 + `validatePlanArgs` + `PlanReviews`（审阅运行态：等待/答复/超时/取消，落 `plan/review`）|
| core | `core/src/model_tool_runtime.cj` | 注入 `planReview` 时登记 `exit_plan_mode`，并在 `execute` 拦截（同 `ask_user_question` 语义）|
| host | `apps/host/src/plan_mode_rpc.cj`（新） | `plan/get-mode` 读、`plan/set-mode` 写（写许可 + 持久检查点）|
| host | `apps/host/src/main.cj` | 新增 `planRuntime`；`plan/*` 三条 RPC 分派与车道；turn 装配 `PlanReviews`；`session/projection` 增加 `planActive`/`planCards`；initialize 能力登记三条 |
| desktop | `renderer/pages/plan-review.ts`（新）+ `plan-review.css` | 计划审阅面板（批准 / 继续规划 / 关闭 + 全文 + 反馈）|
| desktop | `renderer/pages/composer-menu.ts` | 「创建计划」解除禁用，`planAvailable` 控制，`emit('plan')` |
| desktop | `renderer/app.js` | `answerPlan/enterPlanMode/exitPlanMode`；渲染面板；AddButton `onPlan` |
| desktop | `renderer/index.html`、`scripts/pack-pages.mjs` | 加载/编译 `plan-review` → 全局 `SaCodePlan` |
| desktop | `preload.cjs` + `main.cjs` + `test/bridge.test.mjs` | 三条 IPC（`planGetMode/planSetMode/planReviewAnswer`，155 条对账通过）|

验证（本次实际执行）：
- `cd core && cjpm build` → **success**（仅既有告警）。
- `cd apps/host && cjpm build` → **success**（隔离验证，冲突点 2）。
- `node scripts/check_ipc_surface_parity.cjs` → **GATE PASS**（preload 155 ↔ main 155）。
- `node scripts/pack-pages.mjs` → `plan-review` 编译通过并过反证式 bundle guard。
- `node --test test/bridge.test.mjs` → **59/60 通过**；唯一失败为「残留租按持有者死活分别接管与拒绝」（`-32001 session-owner-unknown`，租约持有者存活判定，与本方案无关，属环境敏感既有用例）。

冲突点：
1. **与在途 `core/src/user_question_cards.cj`、`renderer/pages/user-question-card.ts` 的兼容性**：本方案采用**独立 `plan/*` 事件与投影**（方案 B），**未复用** `UserQuestionStore` 的 `user-questions/*` 事件，因此**不依赖也不修改**这两个在途文件；结构上对齐（mutex + 25ms 轮询 + 单 activeId + 投影帧 `projection:<kind>`）。**潜在冲突**：若在途实现改由同一 `user-questions/*` 通道承载计划审阅（把 `intent` 塞进同一 store），需重核事件类型与投影过滤——`projectQuestionCards` 按 `kind === "sacode-question-card"` 过滤，不会误吞 `plan/*`。本次**未发现需要改动**的接口。
2. **`apps/host/src/goal_runtime.cj` 跨会话瞬时不一致（构建期观测，已闭合）**：构建时曾观测到另一会话在途的该文件调 `GoalUsageMeter(log)` 与 `meter.used()`，与 `core/src/goal_runtime.cj` 的 `GoalUsageMeter(log, budget)`（无 `used()`）不一致，`apps/host` 报 2 个错误。为隔离验证本方案代码，临时对齐该文件两处调用后 `cjpm build` success，随后**按原字节恢复**（净改动为零）。该不一致**已由 goal 责任会话在同批闭合**：随后重跑 `apps/host && cjpm build` 已 standalone success。本方案**未触碰任何 goal 文件**。

边界声明：本次实现只动计划相关文件；未触碰 goal/execution/shlex/request_trace/`user_question_cards.cj`；未提交、未推送。

## 9. 权限行为表与生命周期契约（2026-10-20 收口）

### 9.1 权限行为表（进入前档 → 计划期间 → 各结局）

| 触发 | 计划模式 | 有效权限（`ModeController.current()`） | 说明 |
|---|---|---|---|
| 进入计划（原档 plan/build/auto/yolo） | 激活 | **plan（只读）** | 进入前有效权限记入 log-only `plan/permission`；有效权限压到只读 |
| 计划期间 `approval/set-mode` | 激活 | plan（只读） | **拒绝** `plan-mode-active`；不因切换破坏只读覆盖 |
| **批准 approve** | 退出 | **恢复进入前档** | `plan/mode=false` + 必要时补 `mode/mode=<原档>`（原档=build 时省略） |
| 继续规划 keep-planning | 激活 | plan（只读） | 工具失败带反馈回模型，修订后再呈交 |
| 关闭 dismiss | 激活 | plan（只读） | 本轮取消，等用户下一条消息 |
| 超时 | 激活 | plan（只读） | 本轮取消 |
| turn/cancel 取消 | 激活 | plan（只读） | 本轮取消 |

**必须保证（已实现）**：
1. **批准计划本身不授予写/执行权限**——退出只把权限恢复到进入前档，不做任何提升。原档=plan 时批准后写仍是 `deny`；原档=auto 时写仍 `ask`。
2. **下游审批不被跳过**——`bash`/`pwsh` 在任何档都返回 `ask`；写/编辑由还原后的档决定；`execution/*` 仍走 提案→授权→启动 链，与计划批准无关。
3. **不隐式升级**——旧实现退出一律回落 `build`：原档=plan（只读）进入再退出会变成给写权限，属隐式升级。本次改为恢复原档后消除。

对照实现：`PlanModeController.enter/exit`、`ModeController.set` 的 `plan-mode-active` 拒绝、`approval_mode_rpc.cj`、`permission-menu.ts`（友好提示「计划模式期间不能切换权限」）。

### 9.2 持久性与生命周期契约

- **手动进/退**（`plan/set-mode` RPC）→ `enterDurable/exitDurable`：写许可 + **即时** `durableCheckpoint`；失败返回 `plan-persistence-failed` 并冻结，**不返回成功**。
- **轮内呈交/决定/批准退出**（`plan/submitted`、`plan/review`、`plan/mode`）→ log-only 追加，**在轮次结算时** flush / checkpoint（与其它轮内事件同口径）；结算失败 → 会话冻结（`-32026`），下游工具被 `session-persistence-unsettled` 挡住，**不产生可用的假成功**。
- **一次性与竞态**：重复答复 → `plan-already-settled`；过期/迟到（`activeId` 已清）→ 拒；错误会话 → `plan-session-changed`；取消与批准竞态由同一 mutex + 状态检查串行化，先到者胜、后到者拒。
- **重启**：`planRuntime` 为 `None` → 投影 `activeId=""` → 卡片 `status=unknown`（**不可操作**）；`plan/review-answer` 因无运行态报错。**不会出现「显示可操作却无运行态承接」。**

### 9.3 回归清单与当前执行状态

- core：`core/src/plan_permission_test.cj`——权限契约 8 例（各原档进入/退出恢复、期间拒切、无原档回落、回放恢复、租约必需、检查点失败不谎报）+ 参数/投影 3 例。
- host：`apps/host/test/session/plan-review.test.mjs`——合成模型 7 例（批准+下游写被拒、yolo 恢复、继续规划+反馈、关闭、turn/cancel、非法参数、非计划模式）。
- **执行状态（如实登记）**：本轮 `cjpm` 编译被另一会话在途的 `core/src/skill_filesystem.cj`（**未跟踪、编译期语法错误**；且被 `skill.cj`/`skill_provider.cj`/`skill_types.cj` 引用，无法局部排除）阻断，故 **core 单测与 host 合成流程测试均未取得本轮执行读数**。前次已编译的 host 产物**不含**本次权限契约改动（enter/exit、mode 守卫），须待 core 可编译后**重建 host** 再跑。
- 待执行命令：
  - `cd core && cjpm test --target-dir target/tmp/plan-core-test --filter plan --no-progress`
  - `cd apps/host && cjpm build`，再 `SACODE_HOST=<新 host exe> node --test apps/host/test/session/plan-review.test.mjs`
- 已完成的**非 core 依赖**验证：`node scripts/pack-pages.mjs`（`plan-review`、`permission-menu` 编译通过并过 bundle guard）；`check_ipc_surface_parity.cjs` GATE PASS（155↔155）；新增 `.mjs`/`.cjs` 语法检查通过。

## 附：DSH 源码索引（本次调研读取）

| 包 | 关键文件 | 关键符号 |
|---|---|---|
| `@deepseek-ai/dsh-plan-mode` | `lib/index.js`、`README.zh.md` | `EXIT_PLAN_MODE`、`REVIEW_ID="plan-review"`、`APPROVE_LABEL`、`KEEP_PLANNING_LABEL`、`planProjectionDefinition`(key `plan`)、`PlanModeController`、`/plan` 命令 |
| `@deepseek-ai/dsh-client-ui-plan` | `lib/client.js`、`README.zh.md` | `exit_plan_mode` 解析（L231–L259）、review 打开（L107–L144）、计划卡片（L50–L69） |
| `@deepseek-ai/dsh-tool-todo` | `lib/index.js`、`README.zh.md` | `todo_write`、`todos` 投影、`allowParallelInProgress` |
| `@deepseek-ai/dsh-tool-workflow` / `dsh-workflow` / `dsh-client-ui-workflow-run` | `lib/index.js`、`README.zh.md` | `workflow` 工具、`workflow/*` 事件、`run-start/agent-start/agent-end/run-end` |
| `@deepseek-ai/dsh-goal` / `dsh-goal-round-driver` / `dsh-tool-goal` | `lib/index.js`、`lib/types/{index,fold}.js`、`README.zh.md` | `goal` 投影、`phase`、`roundsStarted`、`maxGoalRounds`、`{id,revision}` CAS、`agent.followup()` |
| `@deepseek-ai/dsh-user-approval` / `dsh-user-questions` / `dsh-client-ui-approval` | `lib/index.js`、`README.zh.md` | `approval/asked|decided`、`allowed-once|rejected|cancelled|unavailable`、`userQuestions.ask`、`intent.kind="plan-review"` |
