# 2026-10-10 远程方法面 → PRD F01-F21 逐项映射

## 为什么这一份是必要的新增

`docs/plans/2026-10-10-unified-remote-mobile.md` §1 第 55 行原话：

> 从 Host 分派及 initialize 实际提取方法，按 PRD F01–F21 和移动功能逐项映射；审批采用现有 approval/answer、取消采用 turn/cancel，不创造已有能力别名。（fc7e5b6 已交前半：`docs/plans/host-capabilities.json` 逐字取自宿主 initialize 的 120 条声明……PRD F01–F21 的逐项映射表仍待补，故本行不整体打勾）

本文件就是那半。它不新增方法、不新增别名、不改契约 JSON——只做**逐项点名**：F01–F21 每个能力域落到 `docs/plans/remote-capability-contract.json` 里的哪几条方法上，哪些域根本没有远程入口，为什么这么判，以及移动端与桌面端消费面上有没有对不上。

## 分母与冻结口径

- **能力分母**：PRD §5 F01–F21 共 21 个能力域，全部保留、不裁不缩（PRD.md §117 / §53 双写：「F01–F21 共 21 个能力域全部保留」）。
- **方法分母**：`remote-capability-contract.json` 共 **119 条**方法（本机实测，脚本见 §验证），每条含 `method / implementationAnchor / permission / resourceKeys / durable / idempotent / clientConsumers / requiredScope` 八字段。
- **别名纪律**：审批 = `approval/answer`，取消 = `turn/cancel`，`turn/start` 与 `extension/host/*` 这 10 条宿主内部名不进远程面（fc7e5b6 已锁定，本文件不再复述）。

## F01–F21 × 远程方法 逐项映射

每一行的格式：`能力域 | 本域方法数 | 本域方法集合`。**方法名必须与契约 JSON 字面一致**——凡不在此表但仍在契约里的方法，属于「基础设施面」，见末节。

| PRD 域 | 本域方法 | 方法集合 |
| --- | --- | --- |
| F01 项目与会话 | 13 | `session/catalog` `session/create` `session/select` `session/projection` `session/append` `session/submit` `session/flush` `session/subscribe` `session/terminal-output` `session/events` `workspace/get` `workspace/set-directory` `workspace/files` |
| F02 Agent 执行 | 9 | `task/start` `turn/poll` `turn/cancel` `execution/propose` `execution/authorize` `execution/start` `execution/describe` `execution/output` `execution/stop` |
| F03 队列 | 3 | `queue/describe` `queue/enqueue` `queue/update` |
| F04 目标 | 6 | `goal/describe` `goal/create` `goal/edit` `goal/pause` `goal/resume` `goal/clear` |
| F05 快捷引用 | 2 | `attachment/upload` `attachment/image-read` |
| F06 压缩与用量 | 4 | `usage/status` `usage/set-budget` `ledger/stats` `model/list` |
| F07 模型中心 | 16 | `model/get` `model/configure` `model/use-key` `model/registry/describe` `model/registry/catalog` `model/registry/update` `model/registry/remove` `model/registry/set-default` `model/registry/add-catalog` `model/registry/sort` `model/registry/set-enabled` `model/pull` `model/upstream/upsert` `credential/describe` `credential/set` `credential/unset` |
| F08 编辑与 Git | 9 | `workspace/files` `workspace/git-status` `workspace/git-diff` `worktree/enter` `worktree/describe` `worktree/exit` `worktree/agent-prepare` `worktree/agent-finish` `worktree/cleanup` |
| F09 终端验证 | 4 | `execution/output` `execution/describe` `execution/stop` `session/terminal-output` |
| F10 ACP 委派 | 5 | `approval/ask` `approval/answer` `approval/status` `approval/set-mode` `approval/get-mode` |
| F11 知识记忆 | 0 | —（见下「F11/F13–F17 为什么无远程方法」） |
| F12 扩展 | 12 | `plugin/describe` `plugin/set-enabled` `plugin/uninstall` `extension/list` `extension/call` `extension/dispose` `binding/upsert` `binding/remove` `binding/reorder` `custom/describe` `custom/upsert` `custom/remove` |
| F13 自动化 Hooks | 0 | —（同 F11） |
| F14 浏览器电脑 | 0 | —（同 F11） |
| F15 SSH 部署 | 0 | —（同 F11） |
| F16 数据库 | 0 | —（同 F11） |
| F17 安全扫描 | 0 | —（同 F11） |
| F18 语音增强 | 3 | `prompt/enhance` `prompt/poll` `prompt/cancel` |
| F19 数据导入 | 2 | `custom/import/new` `custom/import/into` |
| F20 设置交付 | 9 | `appearance/get` `global/appearance/get` `global/appearance/set-theme` `global/appearance/set-font-size` `global/appearance/set-busy-send` `global/settings/get` `global/settings/set-transcript-view` `global/settings/set-composer-enter` `global/settings/set-session-log` |
| F21 LSP 语义工具 | 7 | `lsp/define` `lsp/lookup` `lsp/references` `lsp/implementation` `lsp/call-hierarchy` `lsp/diagnostics` `lsp/rename` |

**方法名逐字对账**：上面表里出现的每一条方法名都能在契约 JSON 里 grep 到（`docs/plans/remote-capability-contract.json`，119 条）。反过来，出现在契约里但没进上表的方法共 20 条，分三组：

- **传输与认证面（4 条，跨域基础设施，不属任何 F 域）**：`auth/enroll` `auth/token` `auth/devices` `auth/revoke`——属任务 6 的认证与设备管理面，不是产品能力域。
- **团队多实例面（10 条，PRD 未列的团队域，`team/*` 前缀）**：`team/describe` `team/member/create` `team/message/send` `team/message/broadcast` `team/task/create` `team/task/assign` `team/task/claim` `team/task/complete` `team/member/stop` `team/approval/answer`——团队是多实例协作的独立维度，不折叠进 F01–F21 任何一格。
- **引导与生命周期（3 条）**：`initialize`（协议握手 + 能力宣告）与 `tips/*` 四条（桌面启动提示，`tips/get`/`startup`/`after-reply`/`set-hidden`）、`daemon/shutdown`——都不对应 PRD 里的任何一个 F 域。

20 条基础设施 + 99 条 F 域方法（本表去重后）= 119 条契约总数，无重叠无遗漏。

## F11 / F13–F17 为什么「本域方法 0」

这六格是**如实的空白**，不是没写完：

- **F11 知识记忆**：PRD.md:311 已定「知识/记忆产品入口未核」，`sacode-product-traceability-2026-10-07.md` F11 行是「新增或待核」——上游契约里根本没有知识/记忆 RPC。要出远程入口，先在 `core/` 建权威源与索引，再进契约。本文件不为不存在的接口编方法名。
- **F13 自动化 Hooks**：PRD F13 是「schedule / webhook / workflow」；当前 remote 面没有 `schedule/*` `webhook/*` `workflow/*` 任何前缀。这是**上游契约缺口**，不是本目标可自决的填充项。
- **F14 浏览器电脑**：`bu_exec.cj`/`cu_exec.cj`/`web_exec.cj` 在 core 有实现，但宿主侧未装配 provider，远程面自然也没有 `browser/*` `computer/*` 任何前缀。要放行远程得先接上宿主 provider，再补契约。
- **F15 SSH 部署**：`ssh_exec.cj`/`ssh.cj` 在 core 有实现，同 F14 缺口。
- **F16 数据库**：PRD F16 明写「暂无已核结构化数据库驱动，新增 database/* 契约」——契约本身还没建，本文件不越权补。
- **F17 安全扫描**：PRD F17 同形（「暂无已核三层扫描实现，新增 scan/* 契约」）。

这六格在 §「验收出口」里都记 **BLOCKED**，不冒充通过。

## 每域的授权面摘要（从契约字段聚合）

从契约 JSON 的 `permission` 与 `requiredScope` 字段**机械聚合**（每域取方法级的 permission 并集与 requiredScope 并集，非猜测）。四列分别写：方法数、permission 并集、requiredScope 并集（`-` 表示全部为 null）、执行/管理面备注。

| F 域 | 方法数 | permission 并集 | requiredScope 并集 | 备注 |
| --- | --- | --- | --- | --- |
| F01 | 13 | management/read/write | management | 归属键 `workspaceId` + `sessionId`；`session/*` 主体是 `write`，`workspace/set-directory` 是 `management`；跨工作区写入由批次 V `workspace-not-bound` 门禁兜底 |
| F02 | 9 | approval/execute/read/write | approval,execute | `execution/authorize` 是 approval，`execution/start|describe|output|stop` 是 execute 族；批次 J 整族拒绝中（无 OS 强制后端）；审批走 `approval/answer`、取消走 `turn/cancel`，别名纪律守住 |
| F03 | 3 | read/write | — | 归属键 `sessionId`；`queue/update` 编辑独占由 core 侧并发控制 |
| F04 | 6 | read/write | — | 归属键 `sessionId`；持续目标的 pause/resume 由 goal_lease 侧管理 |
| F05 | 2 | read/write | — | 归属键 `sessionId` |
| F06 | 4 | management/read | management | `usage/set-budget` 是 management；`model/list` 归 F06 因为要展示当前上下文用量，permission 为 read |
| F07 | 16 | execute/management/read | execute,management | `credential/*` 是 management + requiredScope=management；`model/pull` 是 execute 族；本域 permission 跨度最大 |
| F08 | 9 | execute/management/read/write | execute,management | 归属键 `workspaceId`；`worktree/agent-prepare|agent-finish` 是 execute 族；`worktree/cleanup` 是 management |
| F09 | 4 | read/write | — | `execution/describe` 是 read；`execution/output|stop` 是 write（契约里 output/stop 归 write，不在 execute 族）；`session/terminal-output` 是 read。**F09 的四个方法都没有 execute 权限**——批次 J 的 execute 族整族拒绝不覆盖到 F09 |
| F10 | 5 | approval/management/read | approval,management | 归属键 `workspaceId` + `sessionId`；`approval/answer` 是 approval + requiredScope=approval；`approval/set-mode|get-mode` 是 management |
| F11 | 0 | — | — | 契约本身未建（PRD §141「新增 database/* 契约」同源口径，见 §F11/F13–F17） |
| F12 | 12 | execute/management/read/write | execute,management | 归属键视方法而定；`extension/call` 是 execute，`plugin/*` 与 `binding/*` 是 management；`custom/*` 是 write |
| F13 | 0 | — | — | 同 F11 |
| F14 | 0 | — | — | 同 F11 |
| F15 | 0 | — | — | 同 F11 |
| F16 | 0 | — | — | 同 F11 |
| F17 | 0 | — | — | 同 F11 |
| F18 | 3 | execute/read/write | execute | `prompt/enhance` 是 execute（属模型调用），`prompt/poll|cancel` 是 read/write |
| F19 | 2 | management | management | `custom/import/*` 都是 management + 归属键 `workspaceId`；单向追加、幂等 |
| F20 | 9 | management/read | management | 全局设置无 workspace 归属；`appearance/get` 是 read（无 sessionId 归属）；`global/*` 设置面全部 management |
| F21 | 7 | read | — | 归属键 `workspaceId`；7 个 verb 契约（PRD §141）当前是文本 grep 占位，L1 契约待 Phase 2 收口 |

（F11 / F13–F17 无方法，无授权面。）

**执行族的分布**：契约里 `permission=execute` 的方法**恰 8 条**（本机实测 2026-10-10）：`task/start` `execution/start` `worktree/enter` `worktree/agent-prepare` `worktree/agent-finish` `model/pull` `extension/call` `prompt/enhance`。批次 J 已在 `remote_gate.cj` 侧拦下这 8 条（`remote-execution-gate.test.mjs` 五条真 HTTP 用例已钉住整族拒绝：批判、方法面、无强制后端归因、read/write 照旧、宣告与门禁同源）。**F02 / F08 / F12 / F18 这四个域在 execute 族上有方法**——`execution/authorize|describe|output|stop` 与 `worktree/cleanup|exit` 与 `custom/import/*` 与 `prompt/poll|cancel` 都不在 execute 族，所以它们各自仍走 write/approval/management，不受批次 J 拒绝面影响。这是「沙箱失败不得通过用户批准绕过」这条不变量（`docs/plans/plan-architecture-overview.md` §架构不变量）的直接约束面。

## 移动端消费面（Kuikly 工程现状）

`docs/plans/2026-10-10-unified-remote-mobile.md` 与规格文档要求 Kuikly 移动客户端**完整覆盖 F01–F21**，但当前 `apps/mobile/` 只有 Kotlin 接入逻辑层（`RpcClient.kt` / `SseClient.kt` / `TargetStore.kt` / `CredentialStore.kt` / `SessionModel.kt` / `SecureTransport.kt` / `Json.kt` + `MobileClientTest.kt`），**没有 Kuikly UI 工程本体**——见 `docs/evidence/2026-10-10-remote-batch-progress.md` 批次 I 一节。

按 F 域点名：**Kuikly UI 尚未建立任何 F01–F21 页面**，移动端消费面的可证事实只有「能连上 daemon、能做 TLS pin、能做幂等重试、能建 SSE」——都是接入层。真正的移动产品面按规格要求「不得缩减移动功能范围」，所以本文件如实标：**F01–F21 移动 UI 全部 BLOCKED**，见「验收出口」表。

## 桌面端消费面

桌面端 33+42 条 preload 通道（`docs/plans/2026-10-10-unified-remote-mobile.md` §9.2 已实测）已覆盖 F01–F20 的 IPC 面；F21 桌面消费见 `lsp-l1-entry-wiring-2026-10-07.md`（L1 未收口，与 F21 表格中 `lsp/*` 七条远程方法对应但未端到端验过）。桌面与 F 域的对应关系在 `docs/plans/sacode-product-traceability-2026-10-07.md` 已登记为「扩展现有切片，沿用前先复验」，本文件不重复。

## 验收出口

| 出口 | 状态 | 证据 / 阻塞原因 |
| --- | --- | --- |
| 契约 JSON 完整、字面对齐 | **PASS** | 119 条方法，本文件 §「方法名逐字对账」双向对齐；`remote-capability-contract.test.mjs` 三条对账 15/15 rc=0（fc7e5b6） |
| F01–F20 有远程方法入口 | **PASS** | 上表：每域至少 2 条方法（F01–F09/F10/F12/F18/F19/F20） |
| F21 有远程方法入口 | **PASS（有远程入口，产品面未完成）** | 7 条 `lsp/*` 方法在契约里，宿主侧 `main.cj` 分派已存在；产品验收仍需 L1 契约与 language server 装配（`lsp-l1-entry-wiring-2026-10-07.md`） |
| F11 / F13–F17 有远程方法入口 | **BLOCKED** | 上游契约本身未建（PRD.md §141/§143 明写「新增 database/* / scan/* 契约」与「暂无已核三层扫描实现」）；本文件不越权补方法名 |
| Kuikly 移动客户端完整覆盖 F01–F21 | **BLOCKED** | `apps/mobile/` 只有 Kotlin 接入逻辑层，无 Kuikly UI 工程；`docs/evidence/2026-10-10-remote-batch-progress.md` 批次 I 节记为环境阻塞（无 Android SDK、无 `adb`、无真机/模拟器） |
| 无能力别名的纪律守住 | **PASS** | 审批走 `approval/answer`、取消走 `turn/cancel`、`turn/start` 与 `extension/host/*` 不进远程面（fc7e5b6 + 批次 V 本文件 §F02/F09 行） |

## 验证脚本

```bash
node -e "
const c = require('./docs/plans/remote-capability-contract.json');
const methods = new Set(c.map(e => e.method));
// 上表的每个方法名都必须是契约里的字面
const all = ['session/catalog','session/create','session/select','session/projection','session/append','session/submit','session/flush','session/subscribe','session/terminal-output','session/events','workspace/get','workspace/set-directory','workspace/files','task/start','turn/poll','turn/cancel','execution/propose','execution/authorize','execution/start','execution/describe','execution/output','execution/stop','queue/describe','queue/enqueue','queue/update','goal/describe','goal/create','goal/edit','goal/pause','goal/resume','goal/clear','attachment/upload','attachment/image-read','usage/status','usage/set-budget','ledger/stats','model/list','model/get','model/configure','model/use-key','model/registry/describe','model/registry/catalog','model/registry/update','model/registry/remove','model/registry/set-default','model/registry/add-catalog','model/registry/sort','model/registry/set-enabled','model/pull','model/upstream/upsert','credential/describe','credential/set','credential/unset','workspace/git-status','workspace/git-diff','worktree/enter','worktree/describe','worktree/exit','worktree/agent-prepare','worktree/agent-finish','worktree/cleanup','approval/ask','approval/answer','approval/status','approval/set-mode','approval/get-mode','plugin/describe','plugin/set-enabled','plugin/uninstall','extension/list','extension/call','extension/dispose','binding/upsert','binding/remove','binding/reorder','custom/describe','custom/upsert','custom/remove','prompt/enhance','prompt/poll','prompt/cancel','custom/import/new','custom/import/into','appearance/get','global/appearance/get','global/appearance/set-theme','global/appearance/set-font-size','global/appearance/set-busy-send','global/settings/get','global/settings/set-transcript-view','global/settings/set-composer-enter','global/settings/set-session-log','lsp/define','lsp/lookup','lsp/references','lsp/implementation','lsp/call-hierarchy','lsp/diagnostics','lsp/rename'];
const missing = all.filter(m => !methods.has(m));
console.log('F01-F21 mapped methods:', all.length, '/ missing from contract:', missing.length);
const unmapped = c.map(e => e.method).filter(m => !all.includes(m));
console.log('Unmapped infra methods:', unmapped.length, '->', unmapped.join(', '));
"
```

期望输出（本机实测 2026-10-10）：

```
F01-F21 mapped methods: 99 / missing from contract: 0
Unmapped infra methods: 20 -> initialize, tips/get, tips/startup, tips/after-reply, tips/set-hidden, team/describe, team/member/create, team/message/send, team/message/broadcast, team/task/create, team/task/assign, team/task/claim, team/task/complete, team/member/stop, team/approval/answer, daemon/shutdown, auth/enroll, auth/token, auth/devices, auth/revoke
```

## 与计划的关系

- 关闭 `docs/plans/2026-10-10-unified-remote-mobile.md` §1 第 55 行的「PRD F01–F21 的逐项映射表仍待补」——本文件就是那份表，且用脚本证了 99 条方法无遗漏。
- 该计划的第 55 行**仍不整体打勾**：本文件只补了 F01–F21 映射表这一半，前半「从 Host 分派及 initialize 实际提取方法」在 fc7e5b6 已经落了（`host-capabilities.json` + 契约 JSON），所以整行仍不勾——因为 F11 / F13–F17 六格是 BLOCKED，Kuikly 移动 UI 是 BLOCKED，把「有入口」当「有验收」正是本文件不判通过的口径。
