# P0 步骤 4：接口冻结与消费者登记（2026-10-06，A 主责）

取证态：**工作区态**，基线提交 `4eb235e`（共享工作区仍有其他会话在飞，本文所有计数只对该工作区态负责，不代表提交级取证）。全部结论零构建、只读得出，每条都附可复跑命令。

## 0. 判据与复跑命令

| 面 | 分母 | 复跑命令 | 本次读数 |
|---|---|---|---|
| 桌面 IPC（渲染层 ↔ 主进程） | preload 顶层方法 ↔ `ipcMain.handle` 通道 | `node scripts/check_ipc_surface_parity.cjs` | `GATE: PASS (7 checks, fail=0)` rc=0，67 ↔ 67 |
| 桌面 IPC 门禁自证 | 7 项检查各一处独占违规 | `node scripts/check_ipc_surface_parity.cjs --selftest` | `SELFTEST: PASS (probes=7, missed=0, baseline=green)` rc=0 |
| 渲染层消费者登记 | 67 个方法在 `apps/desktop/renderer/` 的引用点 | `node scripts/check_ipc_surface_parity.cjs --consumers` | `REGISTER: 59/67 有渲染层引用；零引用 8 条` rc=0 |
| Host JSON-RPC 方法面 | `method ==` 字面量 + goal 控制白名单 | `node target/host_methods_probe.cjs .`（一次性探针，不入库） | 77 + 5 = **82** |
| 责任映射（63+54） | 矩阵与前端清单表体 | `node scripts/check_p0_ownership.cjs` | `GATE: PASS (17 checks, fail=0)`（上一批已提交，见 `p0-ownership-gate-2026-10-06.md`） |

## 1. 面一：桌面 IPC 契约（本批冻结）

**权威真源**：`apps/desktop/preload.cjs` 里 `contextBridge.exposeInMainWorld("sacode", {…})` 的顶层键，实测 **67** 条，命名空间唯一。`apps/desktop/main.cjs` 逐名 `ipcMain.handle("sacode:<key>")`，实测 **67** 处、全部带 `sacode:` 前缀、双向差集为空。

**已冻结的结构不变量**（由 `check_ipc_surface_parity.cjs` 钉住，改任一通道都要重跑）：

1. 单命名空间：只允许一次 `exposeInMainWorld`，且只暴露 `sacode`。
2. 前缀封闭：`ipcMain.handle` 的通道名必须全在 `sacode:` 下。
3. 1:1 对账：preload 有而 main 无 = 前端按钮无后端；main 有而 preload 无 = 渲染层拿不到的死通道。两个方向都判 FAIL。
4. 无重名、无「计数对不上名字的书写形态」——第 4 项检查的存在理由见本文件 §6 的假缺口记录。

**已冻结的运行时语义**（读源确认，非推断）：

| 语义 | 现值 | 出处（符号锚点） |
|---|---|---|
| 交互形态 | **只有请求-响应**。`main.cjs` 里 `ipcMain.on(`、`sender.send(`、`webContents.send(` 三种推送/单向形态检索均 **0 命中**（复跑：`grep -cE "sender\.send\(|webContents\.send\(|ipcMain\.on\(" apps/desktop/main.cjs`） | `apps/desktop/main.cjs` |
| 请求配对 | 按帧 `id` 配对，非到达顺序 | `apps/desktop/host-bridge.cjs` `HostBridge.request` |
| 超时 | 5000ms，定时器 `.unref()`（不阻止进程退出） | `HostBridge.request` 内 `}, 5000).unref();` |
| 宿主失联 | `host-gone` / `host-spawn-error` 两类错误回到调用方 | `apps/desktop/host-bridge.cjs` |
| 停止 | `stop(timeoutMs = 3000)`：先 `stdin.end()`，超时才 kill；`killNow` 挂 `before-quit` | `HostBridge.stop` |
| 授权凭据 | 审批只认 `approvalId`（工单号），渲染层自报审批字符串无通路 | `preload.cjs` `toolCall` ↔ `main.cjs` 对应 handler |

**消费者登记**（口径：`apps/desktop/renderer/**` 的 `.js/.mjs/.ts/.html`，含折叠前 `.ts` 源与已折叠 `vendor/*.iife.js`；匹配放宽到方法名 token，见 §6）。渲染层零引用的 8 条，按「仓库内还有谁提到它」分三档：

| 档 | 通道 | 除渲染层外的引用 | 判读 |
|---|---|---|---|
| 真死通道 | `globalSettingsGet`、`globalSettingsSet`、`pageToolsList`、`pageToolCall` | `preload.cjs` + `main.cjs`（2026-10-06 复测；本文初稿记的「只有 `main.cjs` 自身」已被 `6fc3fbe` 推翻） | 渲染层零引用（用户入口仍缺，接 UI 是 P3/G 的活）。四条里 `pageTools*` 两条**已可用**（`42debe9` 起，见 §1 末冻结口径与 `test/page-tools-ipc.test.mjs`），`globalSettings*` 两条仍是死通道且带动态方法名风险（见 §7）—— 已接线 ≠ 已可用，这条判据保留 |
| 仅冒烟 | `appearanceGet`、`appearanceSetTheme` | `test-support/ui-smoke.cjs` | 冒烟脚本替用户按了按钮，产品页面无入口 |
| 仅测试 | `modelPull`、`modelUpstreamUpsert` | `test/custom-models-ipc.test.mjs`、`test-support/ui-smoke.cjs` | 有契约测试、无 UI 入口 |

**冻结裁定**：新增/删除通道必须同时改 `preload.cjs` 与 `main.cjs` 并过门禁（AGENTS.md 已把该通道集合定为唯一权威，本批把它从文档说法变成机械判据）。上表 8 条**不删除**——它们是 P3「按 54 包清单补齐页面交互」的待接面，删除属于缩范围。

**页面工具面冻结口径**（`42debe9` 收口，守卫 `apps/desktop/test/page-tools-ipc.test.mjs`）：清单的唯一真源是渲染层 `renderer/page-tools.js` 挂出的 `window.DshPageTools.list()`——主进程不持有工具名，也不许以空数组代替「没枚举到」。窗口解析走具名 `win` + `isDestroyed()` 守卫；无窗口与页面已关都**不抛**：`pageToolsList` 出 `[]`、`pageToolCall` 回 `{error:"no-window"}`。业务错误词表固定三个值：`no-window`、`page-tools-not-loaded`、`tool-not-found`；`bad-page-tool-name` / `bad-page-tool-args` 属主进程侧参数校验，走 IPC reject，不与业务结果混在一个返回形状里。名字与参数进 `executeJavaScript` 只能经 `JSON.stringify` 成为字面量：把值拼进源码就是注入口，这一条由「名字里带引号与反斜杠的工具仍按值命中、且页面不多执行一句」的用例钉住，不是靠注释承诺。

**页面工具面消费者修订**（2026-10-06，`9fab010`，A/W90 —— 上面那段口径**不变**，这里只补消费者与新增字段）：`pageToolCall` 的调用方从 1 个变成 2 个。第二个不是新通道，而是页面里那份 WebMCP 注册交出的 `execute`：`document.modelContext.registerTool({ name, description, inputSchema, execute })` 的 `execute` 转手就调 `window.sacode.pageToolCall(name, args)`，所以模型侧发起的调用与渲染层手工发起的调用过**同一道**主进程逐字段校验，谁也没有旁路授权/审计面。**形状是硬约束**：那份校验器只认 `name`/`description` 必填、`inputSchema`/`outputSchema` 可选、`execute` 必须是函数；交 `parameters`/`handler` 会被当成未知键**静默丢掉**，接着因 `execute` 缺席抛 `TypeError: Tool "execute" must be a function` —— 抛错本身不响，因为原先那里是个注释成「未初始化时忽略」的 `catch`。`pageToolsList` 的每一项因此多两个事实位：`registered`（模型侧到底收没收到）与 `error`（没收到的原因）；判据与本文反复用的那条一致 —— **已接线 ≠ 已可用**，本地注册表有条目不等于贡献生效，清单不许把 `registered:false` 的工具报成可用。错误词表**仍是三个**，`no-window`/`page-tools-not-loaded`/`tool-not-found` 都出自 `main.cjs` 的 `ipcMain.handle("sacode:pageToolsList"/"sacode:pageToolCall", …)` 两个 handler 体内（不是 `preload.cjs`，也不是渲染层），新增的第四个词 `page-tools-unavailable` 只在 `renderer/page-tools.js` 的 `publishToModelContext` 内出现，是宿主桥缺席时 `execute` 自己的返回值，不进 IPC 返回，别把它读成第五条主进程错误词。守卫面：`apps/desktop/test/page-tools-ipc.test.mjs` 现有 10 条，其中 3 条钉这次（形状与实收条数、被拒时如实登记、`execute` 必须经主进程），夹具 `sdkModelContext` 只复刻校验器真正执行的那几条判定，没有发明要求；变异反证三个，各由指定的一条杀掉。

## 2. 面二：Host JSON-RPC 方法面（分母与语义）

分母构成（机械可复跑）：
- `apps/host/src/main.cj` 中与 `method` 比较的**字面量方法名 77** 个（去重后）；
- `core/src/goal_control.cj` `isGoalControlMethod` 白名单再贡献 **5** 个：`goal/create`、`goal/edit`、`goal/pause`、`goal/resume`、`goal/clear`（`goal/describe` 已在前 77 个里）。
- 合计 **82**。

**注意这个分母的口径边界**：它统计的是「按名字面判定」的方法，动态拼名的通路不在其中。目前唯一一处动态拼名在桌面侧（§4 面三第 3 条），Host 侧方法名仍是封闭字面集——这正是本面可机械对账的前提，列为不变量：**Host 不得引入动态拼出的方法名**。

| 语义 | 冻结口径 | 出处（符号锚点） |
|---|---|---|
| 成功/错误帧 | `okFrame(id, result)` / `errFrame(id, code, message)` 两种，异常不外泄为超时 | `apps/host/src/main.cj` `errFrame`、`okFrame` |
| 在轮内允许集 | `allowedDuringTurn` 显式枚举：turn 读侧（`turn/poll`、`turn/cancel`、`initialize`）、读侧（投影/订阅/目录/工作区/附件/外观）、扩展宿主 call/poll/cancel、审批三方法、用量两方法、提示增强三方法，再加 `isQueueMethod`、`goal/describe`、`isGoalControlMethod` | `apps/host/src/main.cj` `allowedDuringTurn` |
| 修订 CAS | **三种字段口径并存**，属本批登记的技术债：严格版 `revisionOrReject`、裸取 `expectedRevision`、goal 面用字段名 `revision` | `apps/host/src/main.cj` goal 分支 `jsonNum(body, "revision")`；`core/src/goal_control.cj` `controlGoalJson` |
| 取消 | 三条独立通道：`turn/cancel`（当前轮）、`prompt/cancel`（增强）、`extension/host/cancel`（扩展调用）；`goal/pause` 是**按轮边界暂停**，不是取消 | `allowedDuringTurn` 三组 + `isGoalControlMethod` |
| 恢复 | 跨进程互斥靠 `WriteLease`（`acquire`/`release`/`takeoverIfStale`/`ownerToken`/`holderPid`），持久化屏障是 `SessionLog.flush`（`append` 只在实例内可见） | `core/src/lease.cj`、`core/src/session.cj` |
| 完成证据 | `goal/complete` **不在**用户控制面白名单里；`goal_control.cj` 顶部注释明确「界面不能把自报结论当成完成证据」 | `core/src/goal_control.cj` `isGoalControlMethod` 与其上方注释 |

**本面已有常驻门禁**（2026-10-06 本批收口）：`scripts/check_host_method_surface.cjs`。77/5 的取数从一次性探针挪进了静态门禁，并把它原来那个弱点显式钉住——`literal-shape-coverage` 要求「按名取到的字面量条数」与「去注释去字符串后的 `method ==` 出现次数」相等（实测 157 对 157），所以将来出现 `match` 分派或第四种写法会直接红灯而不是静默漏取；另有 `no-match-dispatch`（当前分派全是 `if (method == …)` 链，复跑 `grep -c "match method" apps/host/src/main.cj` 与 `grep -c "match[[:space:]]*{" apps/host/src/main.cj`，两者均 **0**）与 `no-dynamic-method-name`（Host 侧方法名必须封闭）两条。基线 `GATE: PASS (9 checks, fail=0)`，`--selftest` 9 探针全 CAUGHT，并已作为 `gates` 步接进 `scripts/verify-all.mjs`（判绿要求 `GATE: PASS` 与 `SELFTEST: PASS` 同时出现）。分母仍 **82**，未改。

## 3. 面三：插件状态与贡献（一切皆插件的硬门槛面）

Host 侧只有 **3** 个 `plugin/*` 方法：`plugin/describe`、`plugin/set-enabled`、`plugin/uninstall`（复跑：`grep -nE '"plugin/[a-z-]+"' apps/host/src/main.cj`）。**没有** `plugin/install*`、`plugin/assembly`、`plugin/registries`、`plugin/inspect`。

桌面侧有 **9** 条 `plugins*` 通道，映射关系逐条读源：

| 通道 | 是否到 Host | 实测形态 |
|---|---|---|
| `pluginsDescribe` | 是 | `bridge.request("plugin/describe")` |
| `pluginsSetEnabled` | 是 | 带 `name`、`enabled`、`expectedRevision`（有 CAS） |
| `pluginsUninstall` | 是 | 带 `name`、`expectedRevision`（有 CAS） |
| `pluginsSetRowEnabled` | 到 Host 但**降级** | 收 `args` 后**不使用**，直接 `request("plugin/describe")`。源码注释自称「返回空清单让适配器 fail-loud（不静默）」——从调用方视角拿到的是一次正常清单读回，写意图被丢弃 |
| `pluginsRegistries` | 否 | 返回硬编码常量（`registry.npmjs.org` + `npmmirror` 备用 + `resolved`）。目前无安装链消费它，故无实际改源副作用；`npmmirror` 只作为展示值存在 |
| `pluginsInspect` | 否 | 只做 spec 正则格式校验，返回 `{status,name,version}`，不查任何真实注册表 |
| `pluginsInstall` | 否 | `{requestId:"", phase:"failed", output:"plugin-install-not-implemented"}`，源码注释「安装尚未接后端」 |
| `pluginsInstallPoll` | 否 | 恒 `phase:"failed"`，`output` 区分 `unknown-request` 与未实现 |
| `pluginsInstallCancel` | 否 | **无条件** `cancelled: true`，`output: "install-was-not-running"` 自述并未在跑 —— 状态字段与自述不一致 |

**更正一条历史记录**：上一批本子代理盘点写的是「install/poll/cancel 伪造成功」。按 `810a6f4` 之后的工作区实读，install 与 poll **已改为显式 `failed`**，不再伪造成功；剩下的只有 `pluginsInstallCancel` 的 `cancelled: true` 与 `pluginsSetRowEnabled` 的写意图丢失。**判据**：本面「一切皆插件」未达门槛——安装/装配在宿主侧根本没有对应方法，能力链在 `main.cjs` 内终止。

**冻结口径**（供 W20/C 实现时对齐，不预先替 C 定实现）：
- 事实状态分离：`installed` / `enabled` / `activating` / `active` / `degraded` 各自独立，只有贡献注册成功才算 `active`；
- 装配必须是有限动作集：新增 `plugin/assembly`（或等价）一类方法要先出契约设计交用户评审（计划红线：完整插件装配状态机属跨域变更）；
- 取消与 drain 语义复用 `ExtHost` 在途结算，JS 扩展宿主已具备 `extension/host/cancel` + `poll` 的形状，安装态的取消应与之同构（`requestId` + 有界轮询 + 终态）。

## 4. 面四：模型中心适配器

Host 侧模型/凭证/绑定方法（取自 77 字面集，均在 `providerSurfaceRequest` 分支内）：
`model/registry/describe|update|remove|set-default|add-catalog|catalog`、`model/list`、`model/pull`、`model/upstream/upsert`、`model/configure|get|use-key`、`credential/describe|set|unset`、`custom/describe|upsert|remove|import/new|import/into`、`binding/upsert|remove|reorder`。

页面侧现状（W30/D 与 W60/G 的接面）：
- 折叠前源 `apps/desktop/renderer/pages/model-center-adapter.ts` 与 `plugin-manager-adapter.ts` 是真实消费者（`--consumers` 输出中 `customsDescribe`、`pluginsInstall` 等引用点即来自这两处及其 vendor 折叠产物）；
- 缺口：`modelPull`、`modelUpstreamUpsert` 两条通道**只有测试与冒烟在调**（§1 表），说明拉取模型/上游写入的 UI 入口未接；
- 供应商页 `describe/reorder/pullModels` 与当前 `modelsAdapter.load/save/remove/listModels` 的形状错配仍属 W30/D 的第一批（计划原文即列于此），本批不代修。

**冻结口径**：模型中心一切写操作必须带 `expectedRevision`，读回必须来自 Host 而不是页面本地缓存；凭证只经 `credential/*` 一条面，渲染层与日志都不落地（`STEPFUN_API_KEY` 等只检查是否设置）。

## 5. 面五：工具执行器与面六：目标起轮（P0 步骤 4 收口）

两条面的事实全部按符号锚点实读（引用只给 `文件:符号`，不给行号——本工作区同文件多会话并改，行号必漂）。

**面五 工具执行器**

- **分派已收成表，但执行器注册面是私有的**：`core/src/agent.cj:ToolRuntime.executors`（`HashMap<工具名, (name, args) -> 闭包>`）由 `ToolRuntime.registerBuiltinExecutors` 登记 10 个名字（`todo_write`/`read`/`write`/`edit`/`glob`/`grep`/`bash`/`pwsh`/`run_code`/`lsp`），`ToolRuntime.pipeline` 只做 `match (executors.get(name))`——不存在长 if 链。残留按名分支两处：`ToolRuntime.shellStep`（`toolName == "pwsh"`）与 `core/src/model_agent.cj:ModelAgentLoop.run`（`call.name == "todo_write"` 走 `projection:todos`）。元数据面有公开注册方法 `core/src/ext.cj:ToolRegistry.register(ToolSpec)`，**执行器面没有公开注册方法**：外部/插件加不进执行器，JS 工具另走 `core/src/extproc.cj:ExtProcess.call` 一条不同的链。⇒ 「一切皆插件」在这一面是**结构性未达**，不是夹具问题。
- **阶段链（冻结口径）**：`ToolRegistry.has` → 审批 `core/src/approval.cj:ApprovalDesk.ask|consume|stateOf|toolOf`（宿主发号 `apps/host/src/main.cj:modelApproval`）→ 守卫 `core/src/model_tool_runtime.cj:ModelToolRuntime.guard` → `ToolRuntime.pipeline` → 各 `*Step` → `ToolRuntime.recordCall|recordResult` 落 `tool/call|result` → `core/src/model_tools.cj:modelToolResultData` 回写 → `core/src/message_projection.cj:projectMessageRows`。真实副作用只在 `writeStep|editStep|readStep|shellStep|runCodeStep|todoStep`（`replaceFileAtomically`、`publishNewFile`、`ShellExecutor`）；审批、guard、`agent.cj:ToolDetail.stage`、`guardDenials|registryMisses` 全是记录面。`SessionLog.append` 只在进程内可见，`flush` 才跨进程持久。
- **错误契约**：不抛异常、不用 Option，统一 `agent.cj:ApprovalOutcome(allowed, why)`，`why` 双义（成功=正文/回执，失败=错误码串）。固定码集含 `unregistered-tool:<n>`、`unknown-tool:<n>`、`guard-denied`、`bad-args`、`approval-not-granted:<state>`、`approval-tool-mismatch:<bound>`、`io-error:<path>`、`threw:<path>`、`torn-write:<path>`、`fs-stale-version:`/`post-read-error:`（`ToolRuntime.failFile`）；成功前缀 `ok:`/`ok-grep:`/`ok-shell:`。对模型包成 `{"error":"…"}`，对宿主是 `errFrame(-32010)`。唯一抛异常处是分片装配 `model_tools.cj:ModelToolCalls.push|complete`。
- **取消**：`core/src/cancel.cj:TurnToken.cancel|cancelled` 与 `TurnHandle.cancel()`；轮询点在 `ModelAgentLoop.run`（步顶/每帧/批后）、`modelApproval` 等待循环、`core/src/sse.cj:RealSseProvider`。**执行器内部拿不到 token**（现状缺口）：置位后同批剩余调用直接以 `{"error":"cancelled"}` 结算。`cancel.cj:TurnLoop.run` 给未完成项补 `tool/result cancelled:<name>`；宿主 `turn/cancel` 用 `InflightCalls.idsForEpoch` + `ExtProcess.cancelCall` 结算在途，终态经 `turn/poll` join 后报 `settledToolCalls|pendingToolCalls`。`core/src/web_exec.cj:WebExecutor` 自带 token 检查但未接进注册表。
- **Schema 现在是两份真源**：`ModelToolRuntime.init` 写死 9 条 `ToolSpec` 字面量 + `core/src/todo_tool.cj:TodoTool.spec()`，对外由 `ModelToolRuntime.specs()` 产出，与 `core/src/sysprompt.cj:SystemPromptBuilder`、执行期 `ToolRegistry.requiresApproval` 三处同源；而 `apps/cli/src/main.cj` 另有一份独立硬编码清单，宿主 extension 面只登记 write/read。⇒ 冻结不变量：**两入口的工具清单必须同源**，否则 CLI 与桌面会各自漂移。
- 已有定向钉子（交 I 复核时按这些断言点验）：`apps/desktop/test/model-write-approval.test.mjs`（请求 tools 恰为 `[todo_write,read,write]`、`approval/asked` 的 `source==='model'` 且 `approvalId>0`、拒绝后 `approval-not-granted` 且不写盘）、`test/bridge.test.mjs`（`unregistered-tool:no.such`；自报 `approval:"allowed-once"` 不放行；工单复用被拒）、`test/turn-settle.test.mjs`（`turn/cancel` 后 `cancelled===true` 且日志含 `turn/cancelled`）。

**面六 目标起轮**

- **现状：没有任何生产调用方会自动起轮。** 唯一跨轮循环是 `core/src/goal_scheduler.cj:GoalDriver.run`，唯一把它包成真实模型轮的是 `core/src/goal_runner.cj:GoalRunner.run`，二者只被 `goal_runner_test.cj`、`model_tool_runtime_test.cj` 引用。协议面按 `core/src/goal_control.cj:isGoalControlMethod` 只有 6 个 goal 动词（`describe|create|edit|pause|resume|clear`），**没有 `goal/run`，也没有 `goal/complete`**。宿主 `task/start` 走 `core/src/model_agent.cj:ModelAgentRunner`，单轮且完全不读 goal phase；CLI `mode == "goal"` 是手搭 `GoalDriver(dsched, gsvc).run(...)` 并传合成 `runRound` 的**断言自测**，不经 `GoalRunner`。
- **状态机**：字符串常量 5 值 `"none"|"active"|"paused"|"blocked"|"complete"`（`core/src/goal.cj:GoalSnapshot.phase`）。转换由 `GoalService.create|edit|pause|resume|complete|block|clear` 负责，非法迁移经 `GoalService.requirePhase` 抛 `invalid-goal-transition`。`GoalService.snapshot()` 从 `goal/change` 事件回放重算 ⇒ 恢复语义天然走「日志重放」，与「会话日志是唯一真源」一致。
- **CAS**：`GoalService.cas`，control 面参数名即 `expectedRevision`；冲突抛 `stale-goal-revision` 且**不落事件**；无目标 `no-active-goal`，重复建立 `goal-already-exists`；宿主统一吞成 `errFrame(-32025, e.message)`。
- **`-32025` 是一码两义（登记，本批不收口）**：`apps/host/src/main.cj` 的 goal 面有三处发 `-32025`——两处把 CAS/非法迁移的 `e.message` 吞成该码，另一处是 `sessionId` 与活动会话不符时发 `goal-session-changed`。调用方只能靠 message 文本区分，与本面「同一失败在两面的形状各自唯一」的口径不符。收口责任属 F/A（要动协议面就要先交契约设计），这里只把事实钉住。
- **暂停与紧急取消是两条互不相交的通路（刻意设计，冻结）**：暂停只写一条 `goal/change="paused"` 标志事件，由 `GoalScheduler.decide` 在**轮次边界**读到才停下一轮，绝不打断当前轮；紧急取消是 `apps/host/src/main.cj:turn/cancel` → `TurnToken.cancel`，立即断流、按 `inflight.idsForEpoch` 结算在途、落 `turn/cancelled`。goal 控制面对在途 turn 无任何杀伤力。
- **准入计量有接缝、生产链路未接**：判据是 `GoalScheduler.decide` 的 `budgetExceeded` 参数 → `reason="budget"` → `GoalScheduler.applyStop` 落 `goal-budget` 阻塞；真实读数源 `core/src/meter.cj:TokenMeter.over`。但因 `GoalRunner` 无人调用，**起轮前不存在任何预算检查路径**；`TokenMeter` 只在 `task/start` 入口拦一次（`-32014 over-budget`）；CLI 自测把 `budgetExceeded` 硬编成 `{ => false }`。
- **完成判定不采信模型自报**：收口点 `GoalScheduler.completeIfEvidenced`——无证据直接 `return false`、目标照旧 active；有证据才经 CAS 调 `GoalService.complete`。证据本身是调用方注入的谓词 `GoalRunner.run(evidence: (TurnResult) -> Bool)`，进展侧另有 `result.successfulToolCalls > 0`。控制面刻意不含 `goal/complete`。

**跨面语义表（P0 步骤 4 要求的取消 / CAS / 授权 / 错误 / 恢复五项）**

| 语义 | 冻结口径 | 消费者 | 现状判定 |
|---|---|---|---|
| 取消 | 轮级取消 = `TurnToken`，轮边界停 = `GoalScheduler.decide`；两者不得合并成一条通路 | E（执行器内要拿得到 token）、F | 接缝在，执行器内部未接 ⇒ 缺口 |
| 修订 CAS | 写动作一律带 `expectedRevision`，冲突不落事件、错误码 `stale-*` | B/C/D/F/G 全部写面 | 已一致（goal `-32025`、plugin 面见 §3） |
| 授权 | 审批凭据只能是宿主发的工单号（`approvalId`），调用方自报字符串无通路 | E/D、桌面渲染层 | 已钉住（`bridge.test.mjs` 反证） |
| 错误 | 宿主侧有限错误码集 + 模型侧 `{"error": 码串}`；同一失败在两面的形状各自唯一 | 全成员 | 已冻结，新增码要登记进本行 |
| 恢复 | 投影从事件回放（`snapshot()`、冷进程读 `session.log`），不引入影子状态 | B、I | 回放路径在；未完成 turn/tool 的恢复属 W10，待契约评审 |

- **步骤 4 门槛判定**：六条面（桌面 IPC、Host 方法面、插件状态与贡献、模型中心适配器、工具执行器、目标起轮）全部读过源码并给出冻结口径 ⇒ **P0 步骤 4 收口 PASS**。两个结构性缺口据此派单：**执行器注册面公开化 + 两入口工具清单同源 + `WebExecutor` 接进注册表**属 W40/E；**自动起轮接线（含起轮究竟是新协议动词还是宿主内部驱动）与准入计量入生产链**属 W50/F，且因触及协议面，按红线**必须先出契约设计交用户评审**，不由本计划宽泛授权直接实现。


## 6. 本批踩到并已固化的两个假缺口（写进门禁注释）

1. **引号形态不是语法差异**：`main.cjs` 有 7 个 handler 用单引号写通道名。`grep 'ipcMain.handle("sacode:'` 只数得出 60，据此会判出「7 个 preload 方法无后端」的假缺口。门禁改为按语法结构取集，并用 `handler-count-matches-names` 检查「每个 `handle(` 都能被按名取到」，把第四种书写形态变成红灯。
2. **朴素点号匹配造出假零引用**：`--consumers` 第一版只认 `window.sacode.<name>`，把 `customsDescribe` 报成零引用，而它实际被 `renderer/vendor/client-slots.iife.js` 与 `pages/model-center-adapter.ts` 引用（形态是 `const api = window.sacode`；`.ts` 源里是对象键）。改为宽松 token 匹配后，零引用从 25 条降到 8 条。**不对称是刻意的**：非零只说明「有引用」，零才说明「渲染层完全没提到」。

## 7. 剩余项与 BLOCKED（不缩范围，逐条带解锁动作）

| 项 | 状态 | 解锁动作 / 归属 |
|---|---|---|
| Host 82 方法面常驻门禁 | 已做（本批） | 新增 `scripts/check_host_method_surface.cjs`，9 项检查：基线 `GATE: PASS (9 checks, fail=0)`，`--selftest` 9 个探针全 CAUGHT。三条取数口径都按本会话实测过的漏取形态设的：按名取到的字面量条数须与去注释去字符串后的 `method ==` 出现次数相等（实测 157 对 157，出现第四种写法即红）、出现 `match` 分派即红、出现拼出来的方法名即红（封闭字面集不变量） |
| 门禁接入 `scripts/verify-all.mjs` | 已做（本批） | 新增 `gates` 步并排在第一步（静态、不构建，实测 0.6s 跑完 4 条）。判绿要求同一段输出里 `GATE: PASS` 与 `SELFTEST: PASS` 同时出现，任一段含 FAIL 即红；只有 GATE 绿而没自证，按「门禁可能没在执行」判未验完。读数逻辑落在 `scripts/gate-verdict.mjs`（纯函数，可注入假输出直判），守卫 `apps/desktop/test/gate-verdict.test.mjs` 3/3。verify-all 本轮只有 A 一条线在改，未与公共文件重构并行 |
| 第五条门禁 `check_verb_checklist_cover.cjs` 无人接线 | 本批发现，未接线（带理由登记） | 它由 `582b251` 落库，对账矩阵 ◐ 清单与 verb 清单，2026-10-06 工作区读数 `RESULT: FAIL`、rc=1（漏 `core`、`extensions`、`system-prompt`），而 `dsh-capability-matrix.md` 当时还有未落库改动。归该线自己把矩阵与清单对上后再收；A 不在别人的红态上按接线键。已在 `gate-verdict.mjs` 的 `UNWIRED_GATES` 里登记，守卫用例要求磁盘上每条 `check_*.cjs` 要么接线、要么带理由登记（理由少于 20 字按漏项处理） |
| `cjpm test` 需要专用 TMP 目录 | 已做（本批） | 新增 `scripts/verify-tmp.mjs`：建一份 `target/sacode-verify-tmp-*` 一次性空目录并给出 `env`；`verify-all.mjs` 在跑任何步骤前把它写回 `process.env` 的 `TMP`/`TEMP`/`TMPDIR`（下面每个 `run()` 与 `envWithoutElectronRunAsNode()` 都从它拷贝，故九类步骤全部继承），`process.on("exit")` 里删除。防回归 `apps/desktop/test/verify-all-private-tmp.test.mjs`：先红 2/2（缺「临时目录」行 + 缺模块），接线后 2/2 绿 rc=0，断言含「子进程 `os.tmpdir()` 真指进来」「两次调用各拿一份」「退出后目录不存在」 |
| 桌面真宿主用例的共享 TMP 假红 | 已定性，修法同上一步 | 提交态实测 `npm test` 的 58 条红里 **52 条**是同一个环境形态：`Failed to (recursive) create directory … return -13: "Permission denied"` 17 条、`-32001 already-owned` 17 条、`host-gone: exit code 1` 11 条、`-32024 attachments/v1` 7 条。只把 TMP 换成本轮独占空目录、不动任何代码：取样 7 个文件 **30/30 全绿 rc=0**，全套 **fail 58 → 6**。**这几类红不得再当业务红灯派单给成员**，先确认那轮是否跑在共享 TMP 下 |
| Electron 在本机会话内起不动 | BLOCKED | 私有 TMP 复跑后剩 6 条红里 2 条（`model-pages-render`、`plugin-inventory-lifecycle`）是 Electron 子进程退出码 `2147483651`（0x80000003）、stdout 与 stderr 全空。对照实验不走任何仓库代码：`spawnSync(<electron.exe>, ["--version"])` 在主树与提交级副本**各退一次 2147483651 且零输出**，故与本批源码无关，是环境前提缺失。解锁动作：在有交互桌面会话的终端里先确认 `electron --version` 有输出，再复跑这两条与 `smoke`/`ui-smoke`；不得为过这两条改用模拟渲染 |
| Host `initialize` 能力清单与源码分派不等 | 已修（本批） | 提交态实测 8 个动词分派了但未声明：`global/settings/get`、`global/settings/set-transcript-view`、`global/settings/set-composer-enter`、`global/settings/set-session-log`、`workspace/files`、`plugin/describe`、`plugin/set-enabled`、`plugin/uninstall`。逐条回源码核过是真副作用（`PluginStore` 带 `expectedRevision` 的 CAS 写、settings 跨落盘屏障），不是夹具，故补齐声明而不是撤分派。补完声明面 = 冻结分母 **82**（77 字面量 + 5 goal），双向差 0/0 |
| 页面 `.ts` 源在单测面无人解析 | 已钉住 | 提交态实测出并发线 `6cc063a` 在 `renderer/pages/budget-stats.ts` 写坏 3 行括号，`npm run vendor` rc=1，而 `npm test` 一路绿——因为页面源只在 `pack-pages.mjs` 的 esbuild 折叠时才被解析。新增 `apps/desktop/test/page-sources-parse.test.mjs` 把每个页面源过一遍 `transformSync(loader:'ts')`，红→修→绿全过程见 `p0-status-2026-10-02.md` 的「P0 步骤 3 提交级基线回归」节 |
| P0 步骤 3 固定提交基线回归 | 核心/extjs/桌面 PASS，桌面面已收口；打包冒烟 BLOCKED | 在 `.qoder/worktrees/p0-head-b9dc4e3-20261006`（只含提交态）跑：**core TOTAL 718 / PASSED 716 / SKIPPED 2 / FAILED 0 / ERROR 0，rc=0**；**extjs 24/24，rc=0**；**桌面全套（私有 TMP + 副本内重建 vendor 与宿主）tests 251 / pass 240 / fail 6 / skipped 5，rc=1**。52 条红是共用 `%LOCALAPPDATA%\Temp` 的环境假红，逐条归属见 `p0-status-2026-10-02.md` 的「P0 步骤 3 桌面面收口」节。剩余 6 条：1 条 A 自有（Host `initialize` 能力清单与分派不等）已在提交级复跑 **15/15，fail 0，rc=0** 收口；3 条归 **C（W20）**（`plugin/install`/`poll`/`cancel` 宿主侧未落地，`-32601`）；2 条 **BLOCKED（环境）**（Electron 子进程退 `2147483651`，主树与提交级副本的无代码对照实验同证，见同节）。`npm run smoke`/`ui-smoke` 同受 Electron 限制，未据沉默判通过；`pack-cli`/`npm-install`/`real-model` 三步本轮未在提交级跑 |
| P0 步骤 3 工作区态 11 条红逐条归因 | 已做（本批），无未解释红 | HEAD 推进到 `149fc24` 后在私有 TMP 定向重跑 6 个文件：**tests 17 / pass 6 / fail 11 / skipped 0，rc=1**。四类归因与判据见 `p0-status-2026-10-02.md` 新增的「P0 步骤 3 工作区态 11 条红逐条归因」节：1 条过期宿主产物（同刻实测 74 条声明 vs 重打的 82 条）、4 条 `-32601` 归 C/W20、5 条归 D/W30、1 条 Electron BLOCKED |
| 真模型面是外部前提缺失还是本仓缺陷 | **FAIL，归 D（W30）**，本轮改判 | 上表把 `real-model` 记作「未跑」，本轮跑了并拿到定档判据：用例经 `credential/set` 自行把密钥递进宿主（`apps/desktop/test/real-provider-e2e.test.mjs` 符号 `CRED_REF`），宿主塌在 `core/src/sse.cj` 的 `http-request-error`；同机同密钥同 `BASE_URL` 同 model 直连，非流式 `http=200`、流式 `http=200 content_type=text/event-stream` 且收到 `[DONE]`。服务商/端点/模型/密钥/网络五项全好 ⇒ **不许再记 BLOCKED（凭据不可用）**，红在本仓 SSE 打开与传输路径 |
| `pageToolsList`/`pageToolCall` 裸 `window` + 恒空清单 | **已修 `42debe9`（A/W90），红→绿→变异反证全过程留档** | 修前实测：主进程无 `window` 声明，两条 handler 调用即 `ReferenceError: window is not defined`（`main.cjs` 面 6/7 红都落在这两个点位）；`pageToolsList` 写成 `return window.webContents ? [] : []`——两分支都空，即「组件夹具冒充能力」；`pageToolCall` 把 `name` 只转义单引号拼进 `executeJavaScript`。改法见 §1 末冻结口径。**变异反证**：同一轮施加两个变异（list 退回写死 `[]`、name 退回单引号转义），红集恰为指定的两条独占受害用例 `{1,4}`，其余五条不受牵连；奇名变异下读回的错文是 `Invalid or unexpected token`，即名字确实挪动了字面量边界。回归面：所有 vm 加载 `main.cjs` 的 5 个测试文件 16/16、rc=0，`verify-all gates` 4 条（含通道 1:1 对账）绿。**剩余**：渲染层仍无用户入口（P3/G 接 UI），本批只把「已接线」变成「已可用」 |
| `pluginsInstallCancel` 恒 `cancelled:true` | 未修 | 与 `pluginsSetRowEnabled` 的写意图丢失同属「装配状态机」批次：先交契约设计给用户评审（W20/C + A） |
| `globalSettingsSet` 动态方法名 | 未修 | `const method = "global/settings/set-" + key`，key 只校验非空字符串，等于给渲染层开了「拼任意方法名」通道；与 §2「Host 方法名必须封闭」的不变量冲突，应收口成有限具名集 |
| P0 步骤 4 接口冻结（六条面全收口） | **PASS（本批）** | §3–§5 六条面逐条读过源码并给出冻结口径；§5 新增跨面语义表覆盖计划点名的取消/CAS/授权/错误/恢复五项。判定要读回源码，不是照抄目录名：`GoalRunner()` 全仓只出现在 `goal_runner_test.cj` 与 `model_tool_runtime_test.cj`，`ToolRuntime.registerBuiltinExecutors` 是 `private func`，两条都是实 grep 出来的 |
| P0 步骤 3 提交级产物检查补齐 | **PASS（本批）** | 在只含提交的副本里跑 `node scripts/verify-all.mjs pack-cli npm-install`：`pack-cli` 通过 19.5s（`bin` 实到 83 个条目；脚本自报的 `packed 45` 是局部计数，别拿它当分母）、`npm-install` 通过 7.0s `NPM_INSTALL_SMOKE PASS`，汇总 `2/2 通过，失败 0，跳过 0`。core/extjs/桌面全套的提交级读数见 `p0-status-2026-10-02.md` |
| 提交态 CLI 编译红（本批撞出并已修） | **已修 `56f3ffe`，FAIL→PASS 全过程留档** | `6cc063a` 往 A 拥有的 `apps/cli/src/main.cj` 追加的装配断言按 `PluginUnit` 形状写了 `units[i].name`，而 `PluginAssemblyPlan.units` 是 `Array<String>` ⇒ 提交态 `cjpm build` rc=1、6 个 `'name' is not a member of struct 'String'`，两条断言（`装配序把依赖排在前面`、`装配序与输入顺序无关`）**从落库起从未运行过**。只取 `.name`、断言文本一字未动 ⇒ `cjpm build` rc=0、`main.exe plugin` **16 PASS / 0 FAIL** 含这两条。教训面：`npm test` 与 `cjpm test` 都读不到入口侧的编译错，仓颉入口只有真编译一次才暴露，提交级产物检查不可省；跑覆盖时先确认分支——`ext` 模式 8 PASS 里没有这两条，它们在 `plugin` 分支 |
| 执行器注册面私有 + 两入口工具清单不同源 | 派单 **E（W40）**，本批不代修 | `executors` 无公开注册方法 ⇒ 插件加不进执行器（「一切皆插件」结构性未达）；`apps/cli/src/main.cj` 另有一份独立硬编码 `ToolSpec` 清单，`web_exec.cj:WebExecutor` 有 token 检查但未接进注册表；执行器内部拿不到取消 token。消费者：C（插件贡献工具）、H（provider 工具）都等这条 |
| 自动起轮与准入计量未进生产链 | 派单 **F（W50）**，且**须先交契约设计给用户评审** | 协议面无 `goal/run`，宿主 `task/start` 单轮且不读 goal phase，CLI 的 goal 自测把 `budgetExceeded` 硬编成 `{ => false }`（源码即 `{ => false }` 字面量）。要接自动跨轮就必然动协议面 ⇒ 命中计划红线，不由宽泛任务直接实现 |
| 责任映射门禁反证 | 已完成 | 17/17 CAUGHT（上一批） |
| 桌面 IPC 门禁反证 | 已完成 | 7/7 CAUGHT + baseline green |
