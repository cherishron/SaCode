# 持续目标模式：核心调度器与跨轮驱动（2026-10-05）

目标（用户提交，视为数据）：复刻 Codex 式「设一个目标→持续执行到完成→途中可插话且不打断当前轮」的持续目标模式，采「第三种」方案——调度决策收进仓颉共享核心，桌面与 CLI 共用同一判据。本文件只记已实测的核心切片，以及被并发会话阻塞的剩余切片。

## 已实现并验证（core，隔离取证）

三个提交，逐文件 `git show --name-status` 复核只含本批两个文件，未混入并发会话改动：

- `37e1b1c` feat(core)：GoalScheduler 决策内核——轮次/时长从 `goal/round`（log-only）事件重算、崩溃恢复同源、`decide` 纯读不落事件、证据完成闸（无证据不收口、陈旧修订被 CAS 拒）。
- `a77e6ba` feat(core)：applyStop——把 budget/round-limit/elapsed-limit/no-progress 四类限额停止经 `GoalService.block` 落 `goal-<reason>` 阻塞；run=true 与非限额理由不动目标、不空写事件。
- `0d41f0e` feat(core)：GoalDriver 跨轮持续执行驱动——`run(maxRounds,maxElapsed,noProgressLimit,budgetExceeded,runRound)`；**只在轮次边界重读目标 phase**，故暂停/编辑/删除对下一轮生效、绝不强杀当前轮次；有证据才经 CAS 收口；限额停止经 applyStop 落阻塞防无限空转。`runRound`/`budgetExceeded` 由调用方注入，驱动不认识 inbox、不碰模型请求构造。
- `238247f` feat(core)：GoalRunner——把 GoalDriver 接进真实模型工具循环（新文件，不改并发改动的 `model_agent.cj`）。一轮 = 一次 `ModelAgentLoop.run`；进展判据取「本轮干净执行了工具调用」（`settledToolCalls>0 && !interrupted && !cancelled`），完成证据由调用方传入的 `evidence(TurnResult)` 判定（核心不臆造完成），限额停止经 applyStop 落阻塞。即时补充送达沿用 `ModelAgentLoop` 内部既有 `claimStep`，本层不重复。
- `34dfaaa` feat(core)：SystemPromptBuilder.build 增可选 `goal/rounds/elapsed`——`goal/change` 是 log-only（模型看不见目标正文），故目标必须由提示构造注入才能「每轮看到要追求什么」。active 注入 正文/状态/轮次/时长 + 「只有有实际证据才可提出完成」；暂停/受阻只展示不催促；无目标或墓碑逐字退回旧输出（`withNone==plain` 兼容反证）。sysprompt.cj/model_request.cj 当时均 clean，未与并发 prompt_enhance（自带请求、不碰这两个文件）冲突。

### 核心单测读数（固定流程：落盘→剥 ANSI→取最后一个 Summary）

在 `git worktree add --detach`（HEAD `a77e6ba`）隔离副本内跑，专治并发会话未落库的 `prompt_enhance_test.cj`（当前工作区该文件 `() -> Int64` 与 `Int64` 处 `==` 编译不过，会污染整树构建）：

| 命令 | 读数 |
| --- | --- |
| `cd core && cjpm test`（含 GoalScheduler 14 + applyStop 4 + GoalDriver 5） | **TOTAL 472 / PASSED 471 / FAILED 0 / ERROR 0 / SKIPPED 1**，rc=0 |
| 同法，HEAD 并入并发 `5ea299e`（+2 图片能力用例）后加 GoalRunner 3 条 | **TOTAL 477 / PASSED 476 / FAILED 0 / ERROR 0 / SKIPPED 1**，rc=0（worktree 基点 `583cc08`，仅拷 `goal_runner_test.cj` 时编译报 `undeclared identifier 'GoalRunner'`、无 Summary、rc=1 作红灯反证） |

- SKIPPED 1 为本仓既有基线读数（`core/src` 无 `@Bench`/`@Ignore`/skip 标记，非本批引入；本批 466→471 全部 `CASE: … PASSED`，含 5 条 `driver*` 用例逐条点名 PASSED）。
- 红灯反证：仅拷测试文件进 worktree（impl 无 GoalDriver）编译报 `undeclared identifier 'GoalDriver'`、无 Summary、rc=1——确认这 5 条用例钉的是新实现，不是既有行为。
- 关键不变量「边界重读不强杀当前轮」由 `driverAppliesPauseAtBoundaryWithoutKillingCurrentRound` 的 `runRound` 调用计数钉死（`calls.n==1` 且 `stopReason=="paused"`）：若把 phase 读取提到循环外，该计数会变，用例转红。未另跑变异周期（受整树构建预算限制），此项以计数断言直接控制输入顺序作白盒反证。

## 尚未做（被并发会话 / 未定 HEAD 阻塞）

以下切片全部落在并发会话正在改的文件，或需要 HEAD 稳定后重编宿主，本批不触碰以免吞并他人未提交改动：

1. ~~把 GoalDriver 接进模型工具循环~~：核心侧已完成（`238247f` GoalRunner）；剩余的是**宿主/CLI 改为调用 GoalRunner**（`apps/host/src/main.cj`、`apps/cli/src/main.cj`），并给 `evidence` 接一条真实的完成证据通道（如完成回执/测试通过信号），`budgetExceeded` 接用量闸。
2. **目标控制 IPC + 渲染层目标卡**（`apps/host/src/main.cj`、`apps/desktop/renderer/app.js` 正被并发改）——展示目标/状态/累计时长/轮次，编辑/暂停/恢复/删除且不打断当前轮；消息任何状态都能发（送达已由 `model_agent.cj:79 claimStep` 与 `apps/host/src/main.cj:1146 claimTurn` 既有实现覆盖，无需新建 inbox）。
3. ~~CLI 一致性~~：已完成（`d0eb842` `dsh goal` 模式，纳入 `all`）——隔离 worktree 构建 `apps/cli` 后跑 `dsh goal`，实测 **8 PASS / ALL PASS，rc=0**（断言生命周期 CAS、分隔符护栏、崩溃恢复 rev3、驱动连续跑到证据收口、goal/round 落 2 条 log-only、无证据撞轮数上限落 goal-round-limit 阻塞）。注：`apps/cli/src/main.cj` 提交时并发未脏该文件，落库独立无冲突。
4. **真实模型自动化测试**（step-5-preview，隔离工作区真改文件 + 运行中插话）。
5. **从稳定 HEAD 重编宿主 → 重打 NSIS → 双入口回归 → 无 SDK 装卸核查**。

并发会话已在本目录留证：其桌面包基于快照 `9d85b89`，明确「持续目标调度器等模块没有混入」，即两条线已按避让并行；接上面 1–3 前需与之协调或等其落库。
