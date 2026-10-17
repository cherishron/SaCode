# PRD「进度对账」8 条缺口复核（2026-10-09 快照 → 2026-10-11 实测）

- 日期：2026-10-11
- 性质：**纯只读静态审计**。未编译、未运行测试、未写任何文件。全部结论基于代码形状与符号引用，行号仅用于定位。
- 审计基线：`HEAD` = `20b339e`；工作区 = tracked 修改 78 项 + 未跟踪 27 项源码/文档。
- 方法：符号搜索（`func X` / `class X` / `ipcMain.handle("sacode:Y")`）；主张提交态时一律用 `git show HEAD:<file>` 显式取，不用 `git grep` 的工作树命中冒充 HEAD 命中。
- 并发声明：审计期间另一 Agent 在跑测试并写 `apps/desktop/.tmp-test/`、`apps/desktop/dist/`，且 11:03 改过 `core/src/worktree_tools_test.cj`。本审计未读取、未修改、未清理 `.tmp-test/` 下任何内容。

---

## 汇总表

| # | 缺口 | PRD 原判（10-09） | HEAD 态实测 | 工作区态实测 | 判定 | 口径需更正 |
|---|---|---|---|---|---|---|
| 1 | 页面工具授权 | 直接执行，未走审批/守卫/结算 | **仍存在** | **仍存在**（逻辑逐字未改） | 仍存在 | 行号需改符号定位；需说明新增 IPC 文件是纯重构 |
| 2 | 远程会话归属 | 普通/团队进不同宿主实例 | **仍存在** | 主体仍存在；新增文件修的是**另一轴** | 部分解决 | 新增文件不属本条；需注明 scheduler 删除性质；覆盖实测缺 23 条 |
| 3 | 上下文压缩 | 仅 marker | **仍存在** | **仍存在**（逐字未改） | 仍存在 | 无需更正（连行号都准） |
| 4 | Git 工作台 | 明示未开放 | **仍存在** | **仍存在**；新增 core 模块只做只读，**不修本条** | 仍存在 | 新增文件不是修复，反而加剧提交态断裂 |
| 5 | 斜杠命令/技能/MCP | 菜单部分有，执行链未齐 | **仍存在** | **菜单层已接通，执行链仍断** | 部分解决 | **需改判**：拆成「菜单已完成 / 执行链未齐」两句 |
| 6 | ACP | 核心已有，入口与验收缺 | **仍存在** | **仍存在** | 仍存在 | 无需更正；可补「core 侧已入库，别据其存在推进展」 |
| 7 | P2 面板 + Hooks 调度 | 未成链、未闭环 | **仍存在** | 部分解决，调度半原样 | 部分解决 | 需更正三处（见 §7） |
| 8 | `cmds.cj` 语法阻断 | `:64` + `:70` 两处 | **确认仍坏，但描述不准** | **已解决** | 工作区已解 / HEAD 仍坏 | `:70` 归因错误；**`cmds.cj` 不是唯一阻断** |

---

## 1. 页面工具授权 —— 仍存在

**结论：仍存在，两栏皆同。**

- **HEAD 态**：`apps/desktop/main.cjs` 的 `sacode:pageToolCall` handler 在 HEAD 的**第 810 行**（PRD 写的 810–823 精确命中）。handler 体是 `target.webContents.executeJavaScript(...)` 直接把模板串送进渲染层执行 `tool.handler(...)`，全程**不接触 `withHost` / `bridge.request`**，因此不经 core 审批、不经 ledger 结算、不落审计。
- **工作区态**：同一 handler 现落在**第 553 行**（main.cjs 净减 273 行，抽出 5 个 `*-ipc.cjs`）。**`git diff HEAD -- apps/desktop/main.cjs` 对这段无任何 hunk**，逻辑逐字未变。
- **新增的 5 个 IPC 文件没有覆盖它**：`execution-ipc.cjs`（6 条 `execution/*`）、`lsp-ipc.cjs`、`models-ipc.cjs`、`customs-ipc.cjs`、`plugins-ipc.cjs` 全部走 `withHost(() => bridge.request(method, args))`，但**一个都没接 `pageToolsList` / `pageToolCall`**。
- 全仓 `grep pageTool` 在 `*.cj` 里**零命中**：core 侧不存在任何页面工具的定义、审批或审计入口。
- 现有测试 `test/page-tools-ipc.test.mjs` 只验证窗口解析、字段校验、注入防护、注册表枚举，**没有任何一条断言审批或审计**。测试名本身（「名字与参数仍是主进程逐字段校验」）就承认这层只做了参数校验。

**口径更正**：结论不变，但**行号已漂移**。PRD 的 `main.cjs:810–823` 是 HEAD 坐标，工作区是 553–570。建议改用符号定位（`main.cjs:sacode:pageToolCall`）。并注明新增 5 个 IPC 文件是**纯重构**（把已有 handler 平移到独立模块以满足 dispatch-size 门禁），不构成对本条的修复。

---

## 2. 远程会话归属 —— 部分解决

**结论：核心那半仍存在；新增文件修的是相邻但不同的轴。**

- **「进入不同宿主实例」这半，两栏皆成立**：`apps/daemon/src/daemon.cj` 持有两个独立桥单例——`teamHost = TeamHostBridge(bus)`（第 50 行）与 `hostProxy = HostProxyBridge(bus)`（第 51 行），两者各自 `launch` 同一个 `SACODE_HOST` 可执行文件，是**两个 OS 进程、两个 ReplyTable、两套 in-flight 计数**。分派在 `dispatchBusiness` 显式二分（先 `acceptsTeamMethod(method)`，再 `forwarded(method)`）。`daemon.cj` 工作区未动。
- **`scheduler.cj` 删除不改变归属结论**：HEAD 的 `DaemonScheduler` 在全仓**从未被实例化**（`git grep "DaemonScheduler(" HEAD` 退出码 1），且它引用的 `HostBridge` 类型在 HEAD 的 `core/src/` 里**根本不存在**（只有 `apps/desktop/host-bridge.cjs` 这个 JS 类）。即**死代码 + 编译期坏引用**，删除不损失任何运行时行为。它调用的 `core/src/schedule.cj:ScheduleStore.dueTasks` 仍在，库层未删。
- **`host_proxy.cj` 的 M 只有一行**：`acceptFrame` 里 `events.publish(jsonEscapeText(method), ...)`，与归属无关。
- **新增 `remote_identity_scope_test.cj` 修的是另一条轴**：`core/src/remote_identity.cj` 工作区新增 `DeviceRecord.scopes`、`DeviceAuthzView.scopes`、`grantScope(deviceId, scope)`、`rotateCredential`。它补的是「身份层从不产出 scope，导致 `auth/devices` / `auth/revoke` 语义上永远不可达」（测试文件第 12–15 行自陈此意）——属于**远程方法覆盖/授权判定**轴，不是**实例归属**轴。
- **会话目录归属仍是两套真源**：daemon 自答 `session/catalog`（`SessionCatalog(".")`，`current` 硬编码 `false`），而 `host_proxy.cj:hostMethods` 白名单**刻意不含** `session/catalog`（第 41 行注释明写「转调只会得到两个真源」）。PRD 说「会话目录待统一验收」属实且未变。
- **远程方法覆盖实测**：宿主 initialize capabilities 字面量 **131 条** vs `host_proxy.cj:hostMethods` **98 条**。宿主有而远程不可达共 **33 条**，其中 10 条 `team/*` 走另一条桥（设计上分派），**23 条是真实覆盖缺口**：`initialize`、`session/catalog`、`session/subscribe`、`turn/start`、`approval/set-mode`、`approval/get-mode`、`appearance/set-theme`、`extension/host/*`(7)、`plugin/install/*`+`plugin/bundle/*`+`plugin/entry/*`+`plugin/registries`+`plugin/inventory`(9)。反向（白名单有而宿主不声明）**0 条**。
- **另注**：`docs/plans/host-capabilities.json`（**已提交**，120 条）已落后于工作区宿主实际声明（131 条），差 11 条新 verb。`host_proxy.cj` 顶部注释声称该契约由 `remote-capability-contract.test.mjs` / `remote-method-surface.test.mjs` 三方钉住，但 json 本身未同步。

**口径更正**：(a) 新增的 scope 文件不属于本条，别算作本条进展；(b) 需注明 `scheduler.cj` 是从未接线的死代码 + 坏引用，删除不构成能力回退；(c) 补记远程方法覆盖实测缺 23 条。

---

## 3. 上下文压缩 —— 仍存在

**结论：仍存在，两栏逐字相同，PRD 判断精确。**

- `CompactionLedger` 只有 `record(reason, before, after)` 与 `entries()`，前者只做 `log.append("compaction/record", ...)`，注释自陈「投影读侧只放事件不做数值裁决」。**没有摘要生成、没有上下文替换、没有模型调用。**
- `git diff HEAD -- core/src/compact.cj` **输出为空** ⇒ 逐字未改。PRD 说的「16–23 行」正是这个 `record` 方法体，坐标也准。
- **调用方只有测试**：`grep CompactionLedger` 在全仓 `*.cj` 里只有定义处与 `compact_test.cj` 四处自测，**没有任何生产路径**（host、desktop、cli、daemon 均不引用）。
- **`compress` 命令也没有真摘要**：`core/src/agent.cj:executeCompress`（工作区新增）方法体只有一行 `recordResult("slash/compress")`，注释写着「骨架：后续批次替换为真实压缩逻辑」。
- 全仓无 `compaction/*` 的 host verb、preload 通道或 IPC handler。

**口径更正**：无。补充一条：工作区新增的 `executeCompress` 是又一处 marker，同样无生产调用方。

---

## 4. Git 工作台 —— 仍存在，且新增模块加剧了提交态断裂

**结论：仍存在。**

- HEAD 与工作区的 `git-workbench.ts` **逐字相同**（`git diff HEAD` 输出为空），`'只读查询。未跟踪项打开文件预览；暂存、提交、推送尚未开放。'` 仍在第 19 行。姊妹文案 `file-editor.ts` 的「暂存、提交和推送尚未接入」同样未变。
- **新增的 `core/src/git_workbench.cj` 只做只读查询**：`kind` 白名单是 `"status"|"diff"`，其他一律 `bad-git-query`；文件头注释明写「不经过 shell，不开放任意 argv，不获得 Git 写授权」。
- **无任何写动作存在**：全仓 `git/stage|git/commit|git/push|gitStage|gitCommit|gitPush` 在 `.cjs/.ts/.js/.cj` 里**零命中**。host 只声明 `workspace/git-status` 与 `workspace/git-diff`；`hostMethods` 也只含这两个。

**口径更正**：结论不变，但需更正两点——(a) 新增的 `git_workbench.cj` **不是本条的修复**，它只是把已有的只读 status/diff 抽成 core 侧带进程超时与输出限额的实现；(b) 它**加剧**了提交态断裂：`apps/host/src/main.cj:2164` 调用 `queryWorkspaceGit(...)`，而 `git grep queryWorkspaceGit HEAD -- core/` **退出码 1** ⇒ **HEAD 的宿主引用了一个 HEAD 的 core 里不存在的符号**。

---

## 5. 斜杠命令 / 技能 / MCP —— 需改判

**结论：菜单接线已完成，执行链仍断。**

**已完成的部分（工作区）**：

- `renderer/pages/composer-commands.ts`（未跟踪）导出 `BUILTIN_COMMANDS`：`help / review / compress / init / clear`，其中 `help` 与 `clear` 标 `frontendOnly: true`。
- `composer-menu.ts`（已修改）：新增 `slashTrigger` prop、`emits` 加 `'command'`、`watch(()=>props.slashTrigger, ...)` 在输入 `/` 时切到 `commands` section、渲染分支逐条 `emit('command', cmd.name)`。
- HEAD 态这两处**都不存在**（无 `command` 事件、无 `slashTrigger` prop、无 commands section）。

**执行链仍然断的四条**：

- `review` / `compress` / `init`：`app.js` 的 `onCommand`（**HEAD 与工作区逐字相同**）**只有 `clear` 一个分支**，这三条 emit 完就 `close(true)`，**事件被丢弃**——不发任何 IPC、不调任何 API。core 侧 `agent.cj:executeSlashCommand`（工作区新增）虽分派到 `executeReview/executeCompress/executeInit`，但三者**全是 `recordResult(...)` 骨架**，`executeReview` 上方注释直接写 `// TODO: 实际审查逻辑`。且 `executeSlashCommand` 在全仓**零调用方**，没有任何入口调到它。
- `clear`：**仍只清前端投影**，`app.js` 里就是 `proj.value.messages=[]`，不碰 `bridge.request('session/flush')`，不改 session.log。测试 `composer-commands.test.mjs` 的「clear 执行路径」用例是**在测试里手写 `mockSession.messages=[]` 后断言长度归零**，并不执行产品代码路径——这条测试无法证明产品闭环。
- **技能 / MCP 未接线**：`composer-menu.ts:63` 的 `skills` / `mcp` 两个 section 仍渲染「当前客户端尚未接入可引用的技能/MCP 清单」+ 一个跳插件管理的按钮。第 48 行「创建计划」仍是 `disabled:true` + `'待接入'`。

**两个 PRD 未提的新事实**：

1. `composer-commands.ts:1` 是 `import type { SlashCommand } from './composer-commands'` —— **文件自我导入**。因为是 `import type`（编译期擦除）才没成环，但应在评审里点出。
2. `composer-commands.ts` 未列入 `scripts/pack-pages.mjs` 的折叠清单，它靠 `composer-attachments.ts` → `composer-menu.ts` 的传递 import 打包（`composer-attachments` 在折叠清单里）。**能进产物，但缺一条显式锚点。**
3. `apps/cli/src/worktree_command.cj` 与本条**无关**：只 +4/-1 行，内容是 worktree 子命令解析，文件内还有一段自陈 ACP 标志 BLOCKED 的注释。

**口径更正**：PRD「部分菜单和引用已有代码，但执行链未齐」对菜单层已过期。建议拆成两句：**「菜单接线已完成 / 执行链未齐」**。

---

## 6. ACP —— 仍存在，PRD 判断准确且保守

- **核心协议实现存在，且两栏皆已入库**：`git ls-files core/src/acp*` 返回 16 个文件全部已跟踪，`git status --porcelain core/src/acp*.cj` 输出为空。覆盖 `acp_contract.cj`（15 相 / 10 类失败原因 / 3 类权限判定闭集）、`acp_delegation.cj`、`acp_approval_bridge.cj`、`acp_process.cj`、`acp_gate.cj`、`acp_settings.cj`、`acp_env.cj`、`acp_weight.cj`，每个都有配套 `*_test.cj`。**PRD 说「核心协议已有实现」是准确的。**
- **桌面委派入口不存在，两栏皆无**：`git grep -i acp HEAD -- apps/host/src/main.cj apps/desktop/preload.cjs apps/desktop/main.cjs apps/cli/src` 只有 `worktree_command.cj` 的 5 行**注释**，自陈「本仓三个原生入口都没有 ACP 启动标志」。工作区同样零命中。宿主 131 条能力里**无任何 `acp/*`**；daemon `hostMethods` 98 条里也没有。
- 唯一带 ACP 字样的桌面文件是 `test-support/acp-frame-probe*.mjs`，那是**驱动外部 ACP 二进制的探针**，不是本产品入口。
- 项目自己已登记此阻断：`apps/cli/test/worktree.test.mjs:482` 的 `t.skip('BLOCKED：本仓没有 ACP 启动标志…')`。
- **端到端验收缺**：无任何桌面端 ACP 委派路径测试。

**口径更正**：无。补充一条：`core/src/acp*.cj` 全部**已入库**，所以「核心协议已有实现」在提交态就已成立——但这也意味着**光靠 core 存在不能推出 F10 有进展**。

---

## 7. P2 面板链 / Hooks 调度 —— 部分解决，调度半原样

**终端：从零到有只读回放链，交互面未开放。**
已有：`preload.cjs:terminalOutput` → `main.cjs:sacode:terminalOutput`（逐字段校验 3 键）→ `bridge.request('session/terminal-output')` → host → `core/src/terminal_view.cj:terminalOutputJson`（**未跟踪**，带 8 KiB UTF-8 边界截断与 `more`/`malformed` 计数）→ `terminal-output.ts` + `execution-task.ts`。
未成：`terminal-output.ts:22` 自陈「以下为**旧终端记录回放；交互 PTY 与实时流尚未接入**」；`execution-task.ts:37` 「隔离与监督探针尚未通过，**启动未开放**」。F09 要求的输入、resize、中断、退出码在渲染层**无对应控件**，`hostMethods` 也不含任何交互终端 verb。

**数据库 / 扫描 / 知识：完全无源码。**
`grep database` 在 `.cj/.cjs/.ts` 里零命中，`workbench-tabs.ts` 的可用列表里没有数据库项；`security-scan|sast|vuln` 零命中，`['scan','安全扫描']` 被硬编码 `available:false`；`knowledgeBase|memoryStore` 零命中，`['memory','记忆']` 为 `available:false`。**`workbench-tabs.ts` 逐字未修改**，故这 7 个待接入项状态与 HEAD 完全一致。

**Hooks 磁盘加载：库层已提交且未修改，但生产路径不调用。**
`core/src/hook_settings.cj` **已提交**（不在未跟踪清单里）：读 `<repoRoot>/.sacode/settings.json` 与 `%USERPROFILE%/.sacode/settings.json`，security 整块项目优先回落用户、`hookRegisterFrom` 逐条注册带来源前缀、坏配置 fail-loud（`hook-settings-invalid-json` / `-unreadable` / `-unknown-event`），配 6 条测试。
**但生产调用方只有它自己**：`grep loadHookSettings` 只命中定义与 6 处自测。`session.cj` 的 `startSession/endSession/deleteSession` 每次**新建一个空 `HookRegistry(log: this)`** 再 dispatch（HEAD 396/411/426 行，工作区 458/472/486 行，形状未变）——**从不调用 `loadHookSettings`**。所以磁盘上配的 hook 在真实会话里**一条都不会被加载**。`main.cj` 中 `hook` 字样零命中。

**无人值守调度：调度循环已删除，库层留存、零消费方。**
HEAD 有 `apps/daemon/src/scheduler.cj:DaemonScheduler`（每分钟 tick → `store.dueTasks` → `host.request("task/start")`），工作区**已删除**。删除不损失运行时行为（从未实例化 + `HostBridge` 类型在 HEAD core 不存在）。但结果是：**两栏都不存在任何可运行的无人值守调度循环**。`core/src/schedule.cj:ScheduleStore` 的 7 个方法（已提交、未修改）现在**零生产调用方**（只有 `schedule_test.cj` 6 处自测）。`task/start` 只能由桌面、CLI、daemon 远程 RPC 手动触发。

**口径更正三处**：(a) Hooks 磁盘加载的**库层已提交**，缺口从「无实现」精确化为「有实现、无调用方」；(b) 终端**从零到有只读回放链**，从「未形成产品链」细化为「只读回放已成链，交互面未开放」；(c) 调度缺口的性质变了——不是「未闭环」而是「闭环代码段已删除，库层留存、生产无消费方」。数据库/扫描/知识三项完全无变化。

---

## 8. `core/src/cmds.cj` 语法阻断 —— 描述需更正，且它不是唯一阻断

### HEAD 态：§0.4 的「元组返回类型」成立，「未闭合分隔符」不成立

- `CommandRegistry.resolveWithArgs` 第 64 行返回类型写作 `{spec: CommandSpec, args: HashMap<String, String>}`，第 68 行 `return {spec: spec, args: parsed}`。仓颉没有这种匿名结构体字面量返回类型——**这一条确实非法**。
- **同函数第 67 行还有第二处非法形状**：`let parsed = if (...) ... else ...`（仓颉的 `if` 不是表达式，不能赋值给 `let`）与 `spec.parse!!.get()`（非本仓通用写法）。**PRD/§0.4 只点了第 64 行，漏了这一处。**
- **第 70 行是 `}`（类的收尾大括号）**。剥离字符串字面量后计数：**花括号 21 开 / 21 闭，圆括号 37 开 / 37 闭，完全配平**。**「`cmds.cj:70` 未闭合分隔符」不成立。**
- 另注：`parseSimpleArgs` 第 60 行 `raw.isEmpty`（无括号）、第 61 行 `.filter { it.size > 0 }`（无 `=>`）也是可疑形状。

### 工作区态：两处都改好了

- `core/src/agent.cj`（已修改）新增 `public struct CommandResolveResult { spec: CommandSpec; args: HashMap<String,String> }`，`resolveWithArgs` 改回返回该具名 struct，删除字面量。
- `if (let Some(parseFn) <- spec.parse) { parsed = parseFn(tokens) }` 取代 `spec.parse!!.get()`。
- `parseSimpleArgs` 改成 `raw.isEmpty()` 与 `.filter { s => s.size > 0 }`。
- 括号计数：花括号 22/22、圆括号 40/40，**配平**。
- 配套 `core/src/cmds_test.cj`（已修改）新增 `builtinCommandsRegistered` / `reviewCommandDispatched` / `slashCommandE2E`，均依赖工作区新增的 `agent.cj:registerBuiltinCommands`（155 行调用 + 261 行定义）——符号自洽。

### 必须一并上报的连带事实：`cmds.cj` 不是 HEAD 唯一的编译阻断

HEAD 的**已提交且未修改**代码，调用了一批 **HEAD 的 `core/` 里不存在的符号**：

| 调用方 | 缺失符号 |
|---|---|
| `core/src/team_runner.cj:74`、`team_board.cj` | `session.durableCheckpointBatched` / `isDurableFrozen` / `freezeAfterDurableFailure` |
| `apps/host/src/team_runtime.cj`、`apps/cli/src/goal_runtime.cj` | 同上 |
| `apps/host/src/main.cj` | `queryWorkspaceGit`（→ 未跟踪 `core/src/git_workbench.cj`） |
| `apps/host/src/main.cj:1279` | `terminalOutputJson`（→ 未跟踪 `core/src/terminal_view.cj`） |
| `apps/host/src/main.cj:1024,1038,1051` | `ExecutionApi` / `ExecutionService` / `ExecutionSupervisor`（→ 未跟踪的 5 个 core 文件） |

`git grep` 在 HEAD 的 `core/` 里**全部零命中**。

**这条修正了 §0.4「`cmds.cj` 两处错误阻塞 `cjpm test`」的单点归因**：HEAD 存在**一整类**「已提交代码调用未入库符号」的编译阻断，不止 execution 三件套，还包括 `git_workbench` / `terminal_view` / `session` 三方法。PRD 的 P0 段只提了 execution 三件套。

**口径更正四点**：(1) `:70` 归因错误，应为收尾大括号、括号配平；(2) 真正的第二处非法形状在同函数第 67 行；(3) `parseSimpleArgs` 也是同类形状问题，工作区已一并修；(4) **`cmds.cj` 不是 HEAD 唯一阻断**，须把「已提交代码调用未入库符号」整类登记。

---

## 未能确认的事项

1. **未运行任何编译或测试**（遵守只读约束）。全部结论基于代码形状与符号引用。「HEAD 的 `cmds.cj` 是非法仓颉」是语言语义判断，**未经编译器确认**；「HEAD 存在一批未定义符号调用」基于 `git grep` 交叉比对，**未经编译器确认错误条数与优先级**。
2. **HEAD 的 daemon 包是否真能编译通过无法确认**：`scheduler.cj` 引用了 core 里不存在的 `HostBridge`，静态上应当是编译错误，但未验证 `apps/daemon/cjpm.toml` 的实际编译单元范围。
3. **PRD 各条目的 2026-10-09 原始审计过程不可见**，只能核实当前 HEAD 与工作区的真实状态，无法核实当天审计者看到的是什么。若基线 SHA 不同，个别坐标可能本就对不上。
4. **`apps/desktop/renderer/vendor/` 全部是 gitignore 的构建产物**（`git ls-files` 计数 0），因此**未能核实 `composer-commands.ts` 是否真的打进了 `composer-attachments.iife.js`**——只确认它经传递 import 在折叠清单可达，未验证产物内容。
5. **本仓库有并发会话在跑测试与构建**，`.tmp-test/` 下有其他会话产物（`coreverify/`、`batchA-merged/`、`coreec/` 等），未读取、未修改、未清理，也未当作本仓真源。
6. **`docs/README.md` 本身是未跟踪文件**（`?? docs/README.md`），所以它的 §0.4 断言**从未进入提交态**——一份规定「阻塞口径」的治理文档尚未入库。这本身应上报。
