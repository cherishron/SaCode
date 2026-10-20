# 目标持续执行调度接入方案（2026-10-20）

> 类别：③详细设计（接口 / 模块级）｜关联：**F04 持续目标**  
> 状态：**设计（待评审）**｜基线：工作区 `dev`（调研日 2026-10-20；含未提交桌面/Host 改动）  
> 边界：只读 DSH 解包源码 + 只读 SaCode `core/src/` 与 Host/桌面接线；**不写产品代码、不提交、不推送**  
> 触发：用户反馈「设置目标没有实际反应，自动跨轮执行尚未接通」。桌面目标栏现文案即写死此句（`apps/desktop/renderer/pages/goal-bar.ts`）。

---

## 0. 结论先行

DSH 的自动跨轮**不是** agent loop 在每轮结束时自己读 goal phase 再递归，而是独立插件 `dsh-goal-round-driver` 在 **agent 进入 idle** 与 **goal/changed** 两条边上，检查「active + armed + 未到轮上限 + 无竞争 inbox」，再 `agent.followup()` 塞一条 **goal-sourced** 续跑 user 消息。

SaCode **核心调度器已经存在**（`GoalScheduler` / `GoalDriver` / `GoalRunner`），Host 也已在 `task/start` 且 `phase==active` 时走 `HostGoalRun`。缺的是 DSH 那一层 **空闲边驱动**：

| 已有 | 没有 |
|---|---|
| `goal/*` 六动词 + CAS `revision` | Host 进程内持久的 `GoalActivation`（每次 RPC 都 new 一份，arm 立刻丢弃） |
| `GoalRunner` 在一次 Host 轮次句柄内循环多轮 | `goal/create` / `goal/resume` 之后若空闲，不会自己起跑 |
| 轮次边界重读 phase，暂停不杀当前轮 | `turn/poll` 结算后不回头看 goal |
| 桌面 GoalBar 保存目标 | 保存后不 `task/start`；UI 明确写「尚未接通」 |

**推荐路径：不新开 `goal/run` RPC，不复刻 DSH 的 followup/pre-step/reservation 状态机。** 在 Host 持有一份进程内 `GoalActivation`，于 create/resume 成功后与 `turn/poll` 结算空闲边调用现有 `HostGoalRun`。桌面只改展示，不双发起轮。

---

## 1. 调研问题（逐条）

### 1.1 轮次驱动：一轮结束后谁决定「继续下一轮」？

**是 round-driver 在 idle 边上决定，不是 agent loop 自己检查 goal phase，也不是 projection 事件触发执行。**

DSH 三层各管各的：

1. **`dsh-agent-loop`**：只跑当前物理 turn 的模型/工具循环，直到本 turn 终态。它不知道 goal。
2. **`dsh-goal-round-driver`**：订阅 `agent/status`（idle）、`goal/changed`、`agent/created`、inbox 插入/认领/丢弃、`session/event`（`user/message` / `turn/end`）。`drive()` 仅在 `fiber=running && agent===live && status==idle && !competingQueued` 时，读 `goals.get(agent)`：`phase==active && activation==armed && roundsStarted < maxGoalRounds` 才 `followup(goal-sourced message)`。
3. **`dsh-session-projection`**：给客户端看当前 goal 或 `null`。**不驱动续跑。**

同一轮内部：driver 把续跑消息送进 inbox 后，agent 自己从 idle 进入 running。本轮结束后再回到 idle，driver 再决定要不要预约下一轮。checkpoint（`sessions.flush`）失败则 `disarm()`，不写 durable phase。

SaCode 对照：`GoalDriver.run()` 把「下一轮」做成 **同一次 `TurnHandle` 内的 while 循环**（一轮 = 一次 `ModelAgentLoop.run`）。这在 `task/start` 已经选中 `HostGoalRun` 时等效于 DSH 的 idle→followup，但触发条件绑在「用户发了消息」上，没有独立 idle 监听。

### 1.2 epoch 守卫：三重纪元怎么防旧读覆盖新事件？CAS 对应哪个？

DSH 有两套完全不同的「代数」：

| 代数 | 作用域 | 持久？ | 对应 SaCode |
|---|---|---|---|
| `GoalRef.{id, revision}` | 服务端 CAS，每次 `goal/change` +1 | 是（事件条数/快照） | **`GoalSnapshot.revision`**（`goal/change` 条数） |
| `readEpoch` / `eventEpoch` / `projectionEpoch` | **仅** `dsh-client-ui-goal` 的 activation source | 否 | 桌面 `createGoalSurface` 的单一 `epoch` 计数器（读写共用） |

三重纪元（`dsh-client-ui-goal/lib/client.js`）只保护 **UI 快照**，不保护执行调度：

- `readEpoch`：每次 `getGoal()` 自增；回包时 `readEpoch !== current` 则丢弃（防过期 HTTP 覆盖新状态）。
- `eventEpoch`：`goal/changed`、`goal/activation-changed`、`session/switched` 自增；过期事件丢弃。
- `projectionEpoch`：`session/projection` 自增；过期投影丢弃。
- 切会话时三个一起 `++`，并 `publish({})` 清空。

**SaCode 的 CAS revision 对应 DSH 的 `GoalRef.revision`，不对应三重纪元。** 执行调度应继续以 `GoalService.snapshot().revision` + 进程内 `GoalActivation` 为准；不要把 UI epoch 抬进 Host。

桌面现有单一 epoch 已能丢掉「保存后迟到的 describe」。缺的是：describe 永远看不到真实 activation（见 §3.2），以及 `session/projection` 根本不含 goal，UI 只能 2s 轮询 `goal/describe`。

### 1.3 projection 权威边：如何清除已完成的目标？

DSH 这句话的原文语境是 **客户端 activation source**，不是执行器：

> projection drive is the authoritative clear edge; an active projection with no live goal is treated as transient.

含义分层：

1. **UI 快照清除（client-ui-goal）**  
   - 投影里 **没有** goal → 立刻 `publish({})`，这是唯一权威的「界面上目标消失」。  
   - 远程 `getGoal()` 返回 `undefined` **不能**清界面——若投影仍显示有目标，视为瞬时不一致。  
   - 投影仍有目标但远程读失败：保留本地，标 `unavailable`。

2. **耐久目标清除（dsh-goal fold）**  
   - `clear` 写 revisioned 墓碑；client view 变为 `null`。  
   - `complete` / `block` / `pause` 改 phase，投影仍可能展示（complete 通常不再当「当前目标」）。  
   - 投影 unit 的 client 值进 `session/projection` 推送帧。

3. **续跑停止（round-driver）**  
   - `drive()` 看到 `phase !== active` 或 `activation !== armed` 直接 return。  
   - 不依赖投影事件。完成是模型经 `update_goal(complete)` 或 driver `block(round-limit)` 写 durable phase，下一拍 idle 自然不再预约。

SaCode：`session/projection` 现回执只有 messages/todos/toolCalls 等，**不含 goal**。GoalBar 以 `goal/describe` 为真源；`phase` 为 `complete`/`none` 时 `visible=false`，栏隐藏。执行侧停靠 `GoalDriver` 在轮次边界重读 `GoalService.snapshot().phase`，同样不靠投影。

接入时：**不要**让投影成为 Host 起停的权威边。投影最多作 UI 推送；清除/完成仍走 `goal/change` 日志。

### 1.4 暂停 / 恢复：loop 怎么知道不再自动推进？恢复后怎么再触发？

DSH：

- **暂停**：`goals.pause` → durable `paused` + `activation=disarmed` + `goal/changed`。若暂停来自 **Host 路径**且 agent 正在 running、当前 initiator 不是自己，driver **立刻 `agent.cancel({kind:"user"}, {keepInbox:true})`**。模型路径的 pause 则让本轮跑完。idle 后 `drive()` 因 phase/activation 不满足而停。
- **取消中的预约**：idle 时若仍有 queued/claimed/cancelled 的 attempt 且 goal 仍 active+armed → **pause** 该目标（把「半截自动轮」收成暂停，而不是静默再约）。
- **恢复**：用户 Web / `/goal resume` 把 durable 拉回 `active` 并 **arm**。`goal/changed` → `requestDrive`。若此时 idle，立即预约下一轮。`resume` 也接受 **active 但 disarmed**（会话重启后的状态），不要求先经过 paused。
- **会话/fork 边**：`agent/created` 把 activation 置 `disarmed`。active 目标不会在重启后自己跑，必须显式 resume。

SaCode 已对齐的部分：

- `controlGoalJson` 在 create/resume 时 `arm()`，pause/clear 时 `disarm()`（但 Host **没持有** 这份 activation）。
- `GoalDriver` 轮次边界：`phase==active && !armed()` → `stopReason=disarmed`；否则 `decide(phase, …)`，paused 即停。
- **暂停不杀当前轮**（`goal_runner.cj` 口径，与 PRD / 2026-10-05 用户要求一致）。DSH Host 暂停会 cancel，**不要学**。

缺口：pause 只改 durable phase；若当前 `HostGoalRun` 的 `armed` 闭包是 `{ => !token.cancelled() }`，**暂停不能通过 activation 打断下一轮**，只能等边界读到 `paused`。这碰巧够用。真正坏在 **resume / create 之后没有 `requestDrive`**。

### 1.5 轮数 / 时长限制：如何限制无限循环？

DSH round-driver 自己只强制 **一轮上限**：

- `roundsStarted >= maxGoalRounds` → `goals.block(code: "round-limit")`。
- 默认 `maxGoalRounds=256`（`dsh-goal` README）。
- checkpoint flush 失败 → disarm（不停 phase）。
- `turn/end` reason `max-tokens` → disarm。
- `queue-failed` / `prompt-rejected` → block。
- **driver 没有墙钟超时、没有 token 预算。** 无进展连续 round 的硬下限在 `dsh-tool-goal`：`blockedAfterConsecutiveRounds` 默认 3，且只约束模型自报 `blocked`，不是 driver 强制停。

SaCode `HostGoalRun` / CLI 已有更紧的产品限额，建议保留：

| 限额 | 值 | 落点 |
|---|---|---|
| 最大准入轮 | 8 | `GoalScheduler.decide` / `roundsAdmitted` |
| 墙钟 | 3600s | `elapsedSeconds`（由 `goal/round` 重算） |
| 无进展连续轮 | 3 | `noProgressStreak`（本轮须有成功工具副作用才算 progressed） |
| 用量预算 | Host `meter` | `budgetExceeded` → `goal-budget` 阻塞 |
| 崩溃 | `GoalCheckpoint` | 失败则 `checkpoint-failed` 停，lease 保留 |

不要把 DSH 的 256 搬过来。自动起跑后限额是唯一的「用户没点停止也不会烧穿」的闸。

### 1.6 SaCode 对照：`goal/describe` 返回什么？`turn/start` 结束后有没有检查 goal？缺哪一环？

**`goal/describe` 回执**（`goalProjectionJson`）：

```text
id, revision, phase, objective, blockedReason,
roundsDone, elapsedSeconds, noProgressStreak, activation
```

Host 调用是 `goalProjectionJson(source)`，**不传** `activation`，因此该字段恒为 `"disarmed"`。桌面 `Goal` 类型甚至没接 `activation`。

**起轮入口：**

- 产品路径是 **`task/start`**，不是 `turn/start`。`turn/start` 仍是诊断/假提供方路径，不看 goal。
- `task/start`：`goalStart = (method=="task/start" && GoalService.snapshot().phase=="active")`。成立则 `HostGoalRun.start(...)`，回执带 `"goal": true/false`。
- `turn/poll` 结算：若 `turnGoal.isSome()` 则 `meter.rebuild()` + `GoalCheckpoint.checkpoint()`，然后 **`turnHandle=None; turnGoal=None`**。**没有**「若仍 active+armed 则再起一轮」。

**缺的一环（按因果顺序）：**

1. Host 没有跨 RPC 存活的 `GoalActivation` → create 的 `arm()` 随栈帧消失；describe 永远 disarmed。  
2. create/resume 不触发执行。  
3. 普通 `task/start`（创建目标前已在跑、或 phase 当时不是 active）结算后，即使中途 create 成功，也不会补起 `HostGoalRun`。  
4. 桌面保存目标只打 `goal/create`，不 `taskStart`；且文案声明未接通。  
5. 相邻：`GoalRunner.start()` 把 `claim` 写死 `{ => false }`，即便调度接通，完成闸仍可能永远关着，只能跑到限额 `blocked`（见 §6）。

---

## 2. DSH 机制摘要

解包根：`target/tmp/dsh-extract-20261019/dsh/node_modules/@deepseek-ai/`。

### 2.1 包职责

| 包 | 职责 | 与调度的关系 |
|---|---|---|
| `dsh-goal` | 事件源 + CAS + 四态 + **进程内 activation 缓存**；注册 projection unit | 状态真源；`agent/created` 强制 disarmed |
| `dsh-tool-goal` | 模型工具 `get_goal` / `create_goal` / `update_goal` | 人话才能 create/edit/pause/resume；goal-round 可 complete，blocked 须连续 N 轮；成功终态后停物理 turn |
| `dsh-goal-round-driver` | idle/goal-changed 驱动、预约、pre-step 双检、竞争 inbox 让路 | **执行调度本体** |
| `dsh-agent-loop` | 单 turn 模型循环 | 被 followup 拉起；不读 goal |
| `dsh-session-projection` | 把 fold 后的 current goal 放进投影 | UI 权威清除边，非调度边 |
| `dsh-client-ui-goal` | GoalBar + activation source（三重纪元） | 只展示与本地乐观；pause 走 Host 控制面 |

### 2.2 续跑授权（activation）

- `armed` / `disarmed` **不落盘**。  
- 新缓存、每次 `agent/created`、pause/complete/block/clear、driver 故障/拆卸 → disarmed。  
- create / 用户 resume → armed。  
- `disarm()` 不写 revision、不发 `goal/changed`，只发 `goal/activation-changed`。

### 2.3 round-driver 关键不变量（实现时应对齐语义，不必对齐 inbox 机器）

1. 同一 agent 上最多一个 in-flight `drive` 循环（`requested` 合并）。  
2. 预约的 goal-sourced 消息必须在 `pre-step` 前后两次 `validReservation`：live revision、armed、active、round == roundsStarted+1、内容未过期。失败则 reject 并恢复其它已认领消息。  
3. 人类/其它 inbox 插入 next-turn → `competingQueued`，自动预约标 stale，让路。  
4. Stop 后撤回仍停在 inbox 的自动续轮，避免堵住后续用户消息。  
5. 续跑提示是保留在历史里的 `<goal_round>` user 文本（`renderGoalRoundPrompt`）。

### 2.4 与 SaCode 产品策略已知冲突（保持 SaCode）

| 点 | DSH | SaCode 已拍板 |
|---|---|---|
| Host 暂停是否杀当前轮 | 是（keepInbox） | **否**，轮次边界重读 |
| 默认轮上限 | 256 | **8** |
| 墙钟 / 用量 | driver 无 | **3600s + meter** |
| 完成 | 模型 `update_goal(complete)` 即可 | **机械证据 ∧ 声明**，界面不能 complete |

---

## 3. SaCode 现状对照

### 3.1 分层 vs DSH activation source

```text
DSH:  UI activation source ──RPC/event──► GoalService (CAS+phase)
                                  └──► GoalActivation 缓存
                                  └──► round-driver (idle 边 followup)
                                  └──► agent-loop (单 turn)

SaCode 现：
  GoalBar ──goal/create|edit|pause|resume|clear──► Host controlGoalJson
                                                    ├── GoalService (CAS+phase)  ✓
                                                    ├── GoalActivation 默认参数  ✗ 用完即丢
                                                    └── 无 idle 驱动            ✗
  用户发送 ──task/start──► phase==active ? HostGoalRun : ModelAgentRunner
                           HostGoalRun.armed = !token.cancelled()  ✗ 不是 GoalActivation
  turn/poll 结算 ──checkpoint──► 结束                         ✗ 不回头
```

### 3.2 关键源码锚点（调研日）

| 位置 | 观察 |
|---|---|
| `core/src/goal.cj` | CAS + 四态 + `goal/change`；id 固定 `goal-1` |
| `core/src/goal_activation.cj` | 进程内 armed/disarmed，注释写明重启必须 disarmed |
| `core/src/goal_control.cj` | `controlGoalJson` / `goalProjectionJson` 已接 activation 参数 |
| `core/src/goal_scheduler.cj` | 限额切片；`goal/round` 崩溃重算 |
| `core/src/goal_runner.cj` | 内循环跨轮；`admitGoalRound` 写 `goal/round-prompt`（模型可见 developer） |
| `core/src/goal_claim.cj` | `update_goal` 声明；完成须同轮证据 |
| `apps/host/src/main.cj` ~1345 | describe/control **不传** activation |
| `apps/host/src/main.cj` ~2226 | 仅 `task/start` + active 才 `HostGoalRun` |
| `apps/host/src/main.cj` ~2366 | poll 结算清 `turnGoal`，无再调度 |
| `apps/host/src/goal_runtime.cj` | 「仅由显式 task/start 创建」——这正是产品缺口的注释化 |
| `apps/host/src/main.cj` ~1453 | `session/projection` 无 goal 字段 |
| `apps/desktop/renderer/pages/goal-bar.ts` | 「自动跨轮执行尚未接通」；adapter 无 activation |
| `apps/cli/src/goal_runtime.cj` | CLI 专用 `GoalRunner` 模式，不经过 Host idle 边 |

### 3.3 用户可感知的失败模式

1. **只设目标、不发消息**：日志里有 `goal/change`，栏显示「已启用」，模型 0 请求。  
2. **设目标时已有一轮在跑**（当时 phase 还不是 active）：本轮按普通 `ModelAgentRunner` 收束，之后仍不自动续。  
3. **暂停后再继续**：phase 回到 active，activation 仍无法被 describe 看见，且无 drive。  
4. **重启 Host**：即便补上 activation，按 DSH/SaCode 注释也必须 disarmed；若错误地按 phase==active 自动起跑，会违反 V02「重启未确认前不新开轮」。

---

## 4. 推荐接入路径

### 4.1 原则

1. **调度权威在 Host 进程，不在桌面、不在投影。** CLI/daemon 走同一 Host RPC 才能一起受益。  
2. **不新增 `goal/run`。** 复用 `HostGoalRun` + 现有 `task/start` 的提供方/工具冻结逻辑。  
3. **不复刻 DSH reservation/pre-step。** SaCode 没有 `Agent.followup` inbox 机器；`GoalDriver` 已在句柄内循环。  
4. **activation 进程内、phase 落盘**——与 DSH 一致，也与现有 `GoalActivation` 注释一致。  
5. **暂停不 cancel 当前轮**——保持已拍板口径。  
6. **会话 select / 进程启动 = disarmed**，必须用户 resume 或 create 才 armed。

### 4.2 建议改哪些仓颉源码（实施阶段，本文件不改）

**必改（调度闭环）**

| 文件 | 改什么 |
|---|---|
| `apps/host/src/main.cj` | 为当前会话持有 `GoalActivation`；`session/select` 与首次 load 换新实例（disarmed）。`goal/describe` / `controlGoalJson` 传入该实例。`goal/create`、`goal/resume` 成功后 `requestGoalDrive()`。`turn/poll` 在句柄清空、lease 处理后 `requestGoalDrive()`。 |
| `apps/host/src/goal_runtime.cj` | `HostGoalRun.start` 的 `armed` 改为 `activation.isArmed() && !token.cancelled()`；把 Host 持有的 activation 传进 `GoalRunner`。抽取「冻结模型/工具并启动 HostGoalRun」为可从 drive 调用的内部过程（与 `task/start` 同源，避免复制一份提供方解析）。 |
| `core/src/goal_runner.cj` | `GoalRunner.start` 增加 `armed` / `claim` 可覆写参数（或 Host 改走 `run()`）。至少让 Host 能注入真实 `armed` 与 `claim`。 |

**强烈建议同批（否则自动跑也完不成）**

| 文件 | 改什么 |
|---|---|
| `core/src/goal_runner.cj` `start()` | 现在 `claim: { => false }`。应改为读取 `GoalClaim(log).claimedFor(revision, round)`，或让 `HostGoalRun` 传入该闭包。否则调度接通后仍只会跑到 8 轮/`no-progress`/`budget` 再 `blocked`。 |
| `core/src/goal_control.cj` | 若 describe 需要 remaining\* 限额，与 `HostGoalRun` 的 8/3600/3 **单一真源**对齐（不要两处写死）。 |

**桌面（展示，不起第二枪）**

| 文件 | 改什么 |
|---|---|
| `apps/desktop/renderer/pages/goal-bar.ts` | 去掉「尚未接通」；`Goal` 增加 `activation`；`active+disarmed` 显示「继续」而不是「暂停」；armed+active 才显示暂停。 |
| `apps/desktop/renderer/app.js` | **不要**在 create 后再调 `taskStart`（会与 Host drive 双起轮）。最多订阅 poll/投影刷新栏。 |

**不要改**

- `GoalService` 四态与 CAS 语义。  
- 有限控制面（仍无 `goal/complete`）。  
- `turn/start` 诊断路径。  
- DSH 风格 256 轮。  
- 其他会话在途的桌面交互文件（本方案实施时应只动 goal-bar 与 Host 目标驱动相关行）。

### 4.3 RPC / 事件：加什么、不加什么

**不加新方法。** 现有六动词足够：

| 动词 | 调度副作用 |
|---|---|
| `goal/describe` | 只读；必须返回真实 `activation` |
| `goal/create` | arm + `requestGoalDrive` |
| `goal/edit` | 不动 activation；当前句柄内下一轮边界用新 objective（`admitGoalRound` 已按 snapshot） |
| `goal/pause` | disarm；不 cancel；drive 见到非条件即停 |
| `goal/resume` | arm + `requestGoalDrive`（含 active-disarmed） |
| `goal/clear` | disarm；不 cancel 当前轮（与暂停同一边界） |

可选后续（非 v1）：`session/projection` 增加 `goal` 对象，让 GoalBar 停 2s 轮询。这是 UI 推送，不是调度边。

`task/start` 保持：若已在 GoalRun 中 → 现有 `turn-in-flight`；若 idle 且 active+armed，现逻辑已会走 `HostGoalRun`（用户发话 = 带 inbox 的续跑，与 DSH competing 让路后的人工 turn 同类）。

### 4.4 `requestGoalDrive` 伪契约

```text
若 turnBusy 或 turnHandle 仍在跑 → 置 pendingDrive=true，return
若 !leaseHeld 且无法 takeover → return（只读进程不起跑）
snap = GoalService.snapshot()
若 snap.phase != "active" → return
若 !activation.isArmed() → return
若 decide() 已是限额/无进展 → 不要起跑（避免 drive 与 GoalDriver 双写 block）
冻结模型/工具（与 task/start 同一套失败码：model-not-configured 等）
失败：留下 armed+active，把错误经 turnSink/RPC 已有通道露出；create 本身已成功
成功：HostGoalRun.start；回执形态与 task/start 对齐（started/epoch/goal=true）
          以便桌面现有 poll 循环直接吃到「突然在跑」
poll 结算后：清 pendingDrive，再进 requestGoalDrive 一次
             （此时 GoalRunner 若已因完成/暂停/限额停，phase/armed 会挡住）
```

空 inbox 的第一轮：不造假 `user/message`。`GoalRunner.admitGoalRound` 已写 `goal/round-prompt`，`model_request.cj` 折成 `developer`。风险见 §6（部分提供方可能要求至少一条 user）。

### 4.5 建议实施顺序（供后续会话，非本文件执行）

1. Host 持有 `GoalActivation`，describe/control 传入 → 单测：create 后 describe 为 armed；select 后为 disarmed。  
2. `HostGoalRun.armed` 接 activation；pause 后下一轮不开（现有边界测试可扩）。  
3. `requestGoalDrive` 挂 create/resume/poll-settle。  
4. 修 `claim` 闭包。  
5. GoalBar 文案与 activation 展示。  
6. 真实 Host：create → 无需 user/message → 至少 1 次上游请求；pause → 本轮结束下一轮不起；resume → 再起；重启 Host → 不自动起，resume 才起。

---

## 5. 状态机

### 5.1 耐久 phase（已有，不变）

```text
none ──create──► active
active ──pause──► paused
paused|blocked|active(disarmed) ──resume──► active
active ──block──► blocked          （执行侧：限额/无进展/预算/错误）
active|paused|blocked ──complete──► complete   （仅执行侧，证据∧声明）
任一非 none ──clear──► none
complete|none 允许再 create
```

CAS：除 create 外均需 `expected == snapshot.revision`，否则 `stale-goal-revision`，不落事件。

### 5.2 进程内 activation（补齐后）

```text
默认 / session/select / Host 启动 / 驱动故障 / pause / clear / complete / blocked
        → disarmed

create / resume（成功）
        → armed

edit → 保持原值
```

`GoalDriver` 每轮边界：

```text
if phase==active && !armed → stop "disarmed"
else match decide(phase, maxRounds, maxElapsed, noProgress):
      continue | paused | completed | blocked:* | cancelled
```

### 5.3 Host 运行态

```text
          ┌─────────────┐  create/resume/poll-settle
          │ idle        │◄──────────────────────────┐
          └──────┬──────┘                           │
                 │ requestGoalDrive 条件满足          │
                 ▼                                  │
          ┌─────────────┐  GoalRunner 内循环 N 轮     │
          │ goal-running│  pause 不杀；cancel 杀后续  │
          └──────┬──────┘                           │
                 │ turn/poll 结算                    │
                 ▼                                  │
          ┌─────────────┐                           │
          │ settling    │──checkpoint──► idle ──────┘
          └─────────────┘     + requestGoalDrive
```

与普通 `task/start` 互斥：同一会话同一时间一个 `turnHandle`。用户在 goal-running 中发消息：走现有 inbox `claimTurn`（`GoalRunner` 每轮开头已 claim），**不要**再开第二句柄。

### 5.4 暂停 / 恢复时序

```text
用户 pause
  → GoalService.pause + activation.disarm
  → 当前 ModelAgentLoop 继续
  → 本轮 settle 后 GoalDriver 读到 paused → 句柄结束
  → poll 结算 → requestGoalDrive → phase!=active → noop

用户 resume
  → GoalService.resume + activation.arm
  → requestGoalDrive
  → idle 则 HostGoalRun；running 则 pendingDrive，本轮后再判
```

### 5.5 重启（V02）

```text
新 Host 进程 / session/select
  → 回放 goal/change 得到 phase（可能仍是 active）
  → GoalActivation() 默认 disarmed
  → 禁止 requestGoalDrive
  → UI：active + disarmed → 显示「继续」
  → 用户 resume 才 arm + drive
```

### 5.6 完成 / 清除

完成：仅 `GoalDriver.completeIfEvidenced`（证据∧claim）。成功则 phase=complete，activation 应 disarm（可在 applyStop 或 Host 见非 active 时 disarm）。下一拍 drive noop。GoalBar `visible=false`。

清除：phase=none + disarm；当前轮仍跑完；边界后停。

---

## 6. 风险与边界

| 风险 | 说明 | 处理 |
|---|---|---|
| 双起轮 | 桌面 create 后再 `taskStart`，同时 Host drive | 桌面不起第二枪；Host `turnBusy` 门闩 |
| 无 user 消息被提供方拒 | 部分 OpenAI 兼容端点要求 `messages` 含 user | 实施时用现网/夹具验证；若拒，再考虑最小合成 user（内容=round prompt），不要静默吞 |
| `claim` 恒假 | `GoalRunner.start` 写死 false | 同批修，否则自动跑=自动烧限额 |
| 自动起跑烧额度 | 这是功能本身 | 保留 8/3600/3 + meter；模型未配置时 create 仍成功、drive 失败可见 |
| 重启误跑 | 若错误用 phase==active 当 armed | 测试钉死 select 后 0 请求 |
| 暂停语义回退成 DSH cancel | 与用户要求冲突 | 禁止在 pause 路径调 `turn/cancel` |
| 投影当调度边 | 延迟/截断会漏跑或误清 | drive 只读 `GoalService` + `GoalActivation` |
| 远程 daemon | 若日后远程 `task/start` 被执行族拒绝 | drive 必须走与本机 `task/start` 同一授权；远程默认不应无人值守烧模型 |
| 与 F02 普通对话抢句柄 | 用户正在跑非 goal 轮时 create | pendingDrive，本轮结算后再起，不插队 cancel |
| 文档/PRD 过期表述 | PRD §8 写 F04「完整」 | 本方案视为 **入口接线缺口**；实施后另写 evidence，不改本文件当证据 |
| 并发会话在途桌面文件 | goal-bar.ts 本轮已有「尚未接通」文案 | 实施时只改目标栏与 Host 驱动，不顺手改其它交互批次 |

**明确不在 v1：**

- 复刻 DSH `pre-step` / `startsRequestSeries` / 256 轮。  
- 模型在非人 turn 里 `create_goal`（SaCode 控制面仍是用户 RPC；`update_goal` 只声明完成/进行中）。  
- 把 activation 写入 `goal/change`。  
- 新 RPC、新桌面 IPC。  
- 本文件实施或提交。

---

## 7. 调研问题 → 实施检查表

实施会话可用此表做验收，不必再翻 DSH：

- [ ] 只设目标、不发聊天：Host 在模型已配置时发出至少一轮请求；`goal/round-prompt` 进模型请求。  
- [ ] `goal/describe.activation` 在 create 后为 `armed`，select/重启后为 `disarmed`。  
- [ ] pause：当前轮跑完，下一轮不启动。  
- [ ] resume：空闲时自动再起；无需再发一条聊天。  
- [ ] 8 轮 / 3600s / 3 无进展 / 预算：到限 `blocked`，不再 drive。  
- [ ] 完成仍要证据∧声明，界面不能 complete。  
- [ ] 目标栏不再写「尚未接通」；active-disarmed 显示继续。  
- [ ] `turn/poll` 结算后不会在 disarmed 或非 active 时起跑。

---

## 8. 参考

DSH（解包）：

- `dsh-goal-round-driver/README.md`、`lib/index.js`（`drive` / `requestDrive` / `validReservation`）  
- `dsh-goal/README.md`、`lib/index.js`（activation 缓存、`agent/created` disarmed）  
- `dsh-client-ui-goal/lib/client.js`（三重纪元与 projection 权威清边）  
- `dsh-tool-goal/README.md`（人话权限、连续 round 才能自报 blocked）  
- `dsh-agent-loop/README.md`（单 turn，不读 goal）  
- `dsh-session-projection/README.md`（goal unit 进投影，非调度）

SaCode：

- `core/src/goal*.cj`、`apps/host/src/main.cj`、`apps/host/src/goal_runtime.cj`  
- `apps/desktop/renderer/pages/goal-bar.ts`  
- PRD F04 / V02；历史缺口：`docs/evidence/goal-control-2026-10-05.md`、`docs/evidence/backend-gap-audit-2026-10-05.md`

历史证据里「Host 已自动进入后续 goal 轮」指的是 **已进入 `HostGoalRun` 之后的内循环**，不能当作「设置目标即起跑」已接通。
