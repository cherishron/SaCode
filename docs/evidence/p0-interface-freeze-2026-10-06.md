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
| 真死通道 | `globalSettingsGet`、`globalSettingsSet`、`pageToolsList`、`pageToolCall` | 只有 `main.cjs` 自身 | handler 在、无前端入口、无测试触达 |
| 仅冒烟 | `appearanceGet`、`appearanceSetTheme` | `test-support/ui-smoke.cjs` | 冒烟脚本替用户按了按钮，产品页面无入口 |
| 仅测试 | `modelPull`、`modelUpstreamUpsert` | `test/custom-models-ipc.test.mjs`、`test-support/ui-smoke.cjs` | 有契约测试、无 UI 入口 |

**冻结裁定**：新增/删除通道必须同时改 `preload.cjs` 与 `main.cjs` 并过门禁（AGENTS.md 已把该通道集合定为唯一权威，本批把它从文档说法变成机械判据）。上表 8 条**不删除**——它们是 P3「按 54 包清单补齐页面交互」的待接面，删除属于缩范围。

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

**本面尚无门禁**：77/5 的取数逻辑目前只在一次性探针里（且它按正则取字面量，若将来出现 `match` 分派就会漏取）。当前分派全是 `if (method == …)` 链——复跑 `grep -c "match method" apps/host/src/main.cj` 与 `grep -c "match[[:space:]]*{" apps/host/src/main.cj`，两者均 **0**。把 82 收成常驻门禁列为剩余项（§5）。

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

## 5. 面五：工具执行器与面六：目标起轮（只登记，不在本批收口）

- **工具执行器**：Host 面已有 `tool/*`（`toolsList`、`toolCall` 通道在 67 集内，且有渲染层引用）。执行侧仍是「注册表 + 按工具名硬编码分支」并存，未收成注册表持真实执行器。属 W40/E，且**去硬编码前必须先冻结执行器接口**（Schema→审批→guard→执行→project/finalize→结果日志），否则 E 每加一个工具都要 A 改公共入口。
- **目标起轮**：控制面 5 方法 + `goal/describe` 已冻结（§2），CAS 字段名 `revision`，投影字段集见 `goalProjectionJson`（`id`/`revision`/`phase`/`objective`/`blockedReason`/`roundsDone`/`elapsedSeconds`/`noProgressStreak`）。跨轮自动续跑在 Host/CLI 的接线属 W50/F。

## 6. 本批踩到并已固化的两个假缺口（写进门禁注释）

1. **引号形态不是语法差异**：`main.cjs` 有 7 个 handler 用单引号写通道名。`grep 'ipcMain.handle("sacode:'` 只数得出 60，据此会判出「7 个 preload 方法无后端」的假缺口。门禁改为按语法结构取集，并用 `handler-count-matches-names` 检查「每个 `handle(` 都能被按名取到」，把第四种书写形态变成红灯。
2. **朴素点号匹配造出假零引用**：`--consumers` 第一版只认 `window.sacode.<name>`，把 `customsDescribe` 报成零引用，而它实际被 `renderer/vendor/client-slots.iife.js` 与 `pages/model-center-adapter.ts` 引用（形态是 `const api = window.sacode`；`.ts` 源里是对象键）。改为宽松 token 匹配后，零引用从 25 条降到 8 条。**不对称是刻意的**：非零只说明「有引用」，零才说明「渲染层完全没提到」。

## 7. 剩余项与 BLOCKED（不缩范围，逐条带解锁动作）

| 项 | 状态 | 解锁动作 / 归属 |
|---|---|---|
| Host 82 方法面常驻门禁 | 未做 | 写 `scripts/check_host_method_surface.cjs`，含自证探针；A 自有路径，不需构建 |
| 两个新门禁接入 `scripts/verify-all.mjs` | 未做 | 公共构建文件，同一时刻不得既重构又接线；等 W10/W20 线停止改 verify-all 后由 A 单批接入 |
| P0 步骤 3 固定提交基线回归 | **BLOCKED** | 检测到并发 `cjc.exe`/`cjpm.exe` 在飞即会撞链接互锁。等并发结束后在隔离 worktree 跑 `node scripts/verify-all.mjs`，并把 `verification-run-2026-10-06.md` 的四条红（core ERROR6/FAILED2、desktop fail3、ui-smoke FAIL2、pack-cli 缺 `libgcc_s_seh-1.dll`）逐条复现或归因 |
| `pageToolsList`/`pageToolCall` 裸 `window` | 未修（本批只登记） | 主进程无 `window` 声明，调用即 ReferenceError；且 `pageToolCall` 把 `name` 插进 `executeJavaScript` 字符串，只转义单引号、未转义反斜杠，存在字符串提前闭合面。**必须在下一次接线时改为具名常量 + `executeJavaScript` 传参，不得原样接 UI** |
| `pluginsInstallCancel` 恒 `cancelled:true` | 未修 | 与 `pluginsSetRowEnabled` 的写意图丢失同属「装配状态机」批次：先交契约设计给用户评审（W20/C + A） |
| `globalSettingsSet` 动态方法名 | 未修 | `const method = "global/settings/set-" + key`，key 只校验非空字符串，等于给渲染层开了「拼任意方法名」通道；与 §2「Host 方法名必须封闭」的不变量冲突，应收口成有限具名集 |
| 责任映射门禁反证 | 已完成 | 17/17 CAUGHT（上一批） |
| 桌面 IPC 门禁反证 | 已完成 | 7/7 CAUGHT + baseline green |
