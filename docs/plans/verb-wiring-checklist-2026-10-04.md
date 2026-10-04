# 51 行 ◐ 的 verb 接入清单（供并发线落库后直接执行）

**目的**：把能力矩阵里 **51 行 ◐**（按表头名「已复刻」列机械复算）升到 ✔ 所需的**入口侧接入工作**列成清单。每条给出：目标宿主 verb / 目标 CLI 子命令 / 断言集最小形态 / 会话日志事件 / 上游契约出处。并发线把 `apps/host/src/main.cj` 与 `apps/cli/src/main.cj` 的在飞改动落库后，按本表逐条推。

> **本文首版有两处凭记忆写错**：把 `session-title` / `todo` / `plan` / `goal` / `permission-presets` / `jobs` / `webhook` 当已 ✔、把不在表里的 `gateway` 当一行，漏了 `llm-streaming` / `session-query`，且把 `agent-team` / `user-questions` / `web-server` / `product-telemetry` 放错阶段。现全部按矩阵「阶段」+「已复刻」两列机械重生成。教训同用户记忆「markdown 表格读写陷阱：读表必须按表头名取列」——**凡报数与分组一律取列，不照叙述累加**。

**为什么现在不做**：并发线两份 `main.cj` 分别有 41 / 46 行未落库改动；共享 worktree 纪律不吞并不 revert，只能等其落库。核心 `.cj` 文件由本会话独占，已全量提交。

## 通用形状

- **宿主 verb**：`<域>/<动作>` 命名；请求 `params` 逐字段校验；返回 `result` 或 `-32xxx` 错误码；能力清单 `initialize.capabilities` 里必须列上；stdout 只走协议帧，诊断走 stderr（AGENTS.md）。
- **CLI 子命令**：`main.cj` 加 `if (mode == "<名>")` 分派；断言式 `expect(名字, 条件)` 打印 `PASS` / `FAIL` 前缀；剥 SDK PATH 后能独立跑；返回码 = `FAIL` 计数。
- **桌面 IPC 通道**：`preload.cjs` 与 `test/bridge.test.mjs` 同步增删（AGENTS.md）；按动作命名、逐字段校验，不给「发任意方法」通道。
- **会话日志不变量**：所有 log-only 事件不进 `isSurfaceEvent` 白名单（system/developer/user/assistant/tool-result 才是）；`<verb>::<字段>::<字段>` 管道编码；未来放开需换长度前缀。
- **升 ✔ 判据**（沿用 `plan-deepseek-harness-replication.md` §6.1.2 A 档）：至少一条子系统级断言、上游校正段有出处、双入口各跑一次、变异反证不假绿。

## 逐模块清单（51 行，按矩阵「阶段」列分组）

### M0 基座（4）

| 模块 | 目标宿主 verb | 目标 CLI 子命令 | 断言最小集 | 事件 / 状态 |
|---|---|---|---|---|
| `boot` | `boot/register` / `boot/run` / `boot/status` | `dsh boot` | 顺序、重名 `boot-duplicate-stage` 拒、run 后 register `boot-already-run` 拒、run 幂等 | 纯进程内注册表（本仓已定：不落 log） |
| `scope` | `scope/enter` / `scope/exit` / `scope/current` | `dsh scope` | LIFO 严格、exit 空栈拒、跨进程 replay、嵌套深度 | `scope/enter`+`scope/exit` log-only |
| `typert` | `type/register` / `type/lookup` | `dsh typert` | 注册即 lookup、重名拒、未知名抛、size 单调 | 纯进程内 |
| `invariants` | `invariant/register` / `invariant/check` | `dsh invariant` | 注册、check pass 记录、check fail 记录、初始 `unchecked` | `invariant/register`+`invariant/check` log-only |

### M1 会话与存储（7）

| 模块 | 目标宿主 verb | 目标 CLI 子命令 | 断言最小集 | 事件 |
|---|---|---|---|---|
| `storage` | `storage/open` / `storage/put` / `storage/get` / `storage/delete` | `dsh storage` | open 域 + 版本严格、已 open 重开拒、版本不匹配拒、put/deleted 携新快照、close 后再开 | `domain/changed`（in-process only） |
| `spill` | `spill/record` / `spill/list` | `dsh spill` | 空 turn / reason 各自抛、多次 record 全 replay、跨进程 load | `spill/marker` log-only |
| `session-reference` | `session/reference-add` / `session/reference-list` | `dsh xref` | FileReference 候选、SessionReferenceMention 结构、7 ErrorCode 各一条、不进 isSurfaceEvent | `session/reference` log-only |
| `session-title` | `session/title-set` / `session/title-get` | `dsh session-title` | 空标题抛、多次 set 取最后一条、replay、不进 isSurfaceEvent | `session/title` log-only |
| `session-telemetry` | `telemetry/emit-record` / `telemetry/records` | `dsh telem` | listener 按订阅顺序执行、throwing listener 中止且事件不落、卸载后残留归 0、replay | `session-telemetry/record` log-only |
| `session-query` | `session/query-by-type` / `session/query-by-keyword` / `session/count-all` | `dsh sq` | byType 精确筛、byKeyword 子串命中、countAll 与 append 数一致、空会话返空 | 只读投影（不落新事件） |
| `product-telemetry` | `ptel/enable` / `ptel/disable` / `ptel/emit` | `dsh ptel` | enable/disable 本地开关、`emit` 未开抛、空 name 抛、replay 计数 | `product-telemetry/emit` log-only |

### M2 模型与上下文（2）

| 模块 | 目标宿主 verb | 目标 CLI 子命令 | 断言最小集 | 事件 |
|---|---|---|---|---|
| `compaction` | `context/compact-record` / `context/compact-list` | `dsh compact` | 空 reason 抛、空 before/after 抛、log-only 表面、marker 计数 | `compaction/record` log-only |
| `llm-streaming` | `llm/stream-start` / `llm/stream-chunk` / `llm/stream-finish` | `dsh llm-stream` | 三帧顺序、DONE 前无 finish、正文不被 usage 吞、中断时部分正文结算 | `assistant/live-chunk`（上游概念，本仓是否引入待裁决） |

### M3 loop 与目标（3）

| 模块 | 目标宿主 verb | 目标 CLI 子命令 | 断言最小集 | 事件 |
|---|---|---|---|---|
| `schedule` | `schedule/add` / `schedule/fire` / `schedule/cancel` / `schedule/list` | `dsh schedule` | 三态迁移（pending→fired/cancelled）、fire 未存在抛、cancel 已 fire 抛、跨进程 replay | log-only（软删 `active`） |
| `goal` | `goal/create` / `goal/update` / `goal/complete` / `goal/get` | `dsh goal` | `revision` 由事件计数派生（避 Int64 parse）、CAS stale 拒、complete 终态不可逆、replay | `goal/*` log-only |
| `agent-team` | `team/join` / `team/leave` / `team/broadcast` / `team/members` | `dsh team` | 空 id/role/text 各自抛、重名 join noop、leave 排除、broadcast count | `agent-team/membership`+`broadcast` log-only |

### M4 工具与执行世界（11）

| 模块 | 目标宿主 verb | 目标 CLI 子命令 | 断言最小集 | 事件 |
|---|---|---|---|---|
| `sandbox` | `sandbox/resolve` / `sandbox/confine` | `dsh sandbox` | 三档优先级、`danger-full-access` 拒 `SANDBOX_MODE_NOT_CONFINED`、无后端拒 `SANDBOX_UNAVAILABLE`、per-call policy 覆盖（上游校正：`ConfinedSandboxMode` 类型级收窄与 `SandboxEnforcement` full/partial 未做） | 纯进程内 |
| `shell` | `shell/exec-record` / `shell/exec-list` | `dsh shell` | 三字段全空各自抛、argv joined replay、cwd 空仍落、跨进程 load | `shell/exec` log-only |
| `skills` | `skill/register` / `skill/describe` / `skill/uninstall` | `dsh skill` | 注册即 describe、卸载后 describe 返 ""、重名 noop、空 name 抛 | `skill/register`+`skill/uninstall`（软删） |
| `lsp` | `lsp/define` / `lsp/lookup` / `lsp/rename` | `dsh lsp` | 空抛、重 define noop、rename 未知抛、count 单调 | 纯进程内 |
| `filesystem` | `fs/write` / `fs/read` / `fs/delete`（已有部分通道） | `dsh fs` | 版本过期 `fs-stale-version`、`not-found`、写后读回同版本、delete 后读抛 | 已有部分 |
| `permission-presets` | `permission/preset-list` / `permission/preset-register` / `permission/registerAuto` | `dsh presets` | 预设读取、重名注册、`registerAuto` 与 catalog 联动、未知 preset 抛 | 纯进程内 + catalog |
| `plan` | `plan/create` / `plan/update` / `plan/get` | `dsh plan` | revision 由事件数派生、CAS stale 拒、多步 plan 顺序 replay、空 plan 抛 | `plan/*` log-only |
| `ptc-runtime` | `ptc/begin` / `ptc/end` / `ptc/status` | `dsh ptc` | `ptc/begin` 落 callId+toolName、`end` 落 outcome、终态不可逆、重 callId 抛 `ptc-duplicate-call` | `ptc/begin`+`ptc/end` log-only |
| `jobs` | `jobs/submit` / `jobs/status` / `jobs/cancel` | `dsh jobs` | submit 落 job id、status 未知抛、cancel 终态、跨进程 replay | `jobs/*` log-only |
| `terminal` | `term/open` / `term/chunk` / `term/read` | `dsh term` | sessionId 空抛、chunk append、read 未知返空 ArrayList、跨进程 replay | `terminal/chunk` log-only |
| `web` | `web/allow` / `web/deny` / `web/fetch` | `dsh web` | allow set + deny override、未 allow host fetch 抛 `web-host-not-allowed` 且不落事件、host 从 `://` + `/` split、replay | `web/allow`+`deny`+`fetch` log-only |

### M5/M6 客户端与前端装配（11）

| 模块 | 目标宿主 verb | 目标 CLI 子命令 | 断言最小集 | 事件 |
|---|---|---|---|---|
| `settings` | `settings/update` / `settings/replace` / `settings/mutate` / `settings/get` | `dsh settings` | 三 prefix 各一条、`mutate` CAS 拒 stale、`replace` 先清空再应用、log-only 不进 isSurfaceEvent | `settings/document-updated` |
| `slots` | `slot/register` / `slot/activate` / `slot/list` | `dsh slots` | 空抛、未知 activate 抛 `slots-unknown`、kind 白名单、replay 顺序 | `slots/register`+`slots/activate` log-only |
| `client-modules` | `module/register` / `module/activate` | `dsh cmod` | 空 id/version 抛、重 id 抛 `cmod-duplicate-id`、未知 activate 抛、isLoaded 单调 | 纯进程内 |
| `client-resources` | `resource/register` / `resource/lookup` / `resource/list` | `dsh resource` | 空 uri/mime 抛、重名 noop、未知 lookup 空、log-only | `resource/register` log-only |
| `attachment` | `attach/record` / `attach/list` | `dsh attach` | 空 name/mime 各自抛、size 允许空、replay 完整、log-only 面 | `attachment/record` log-only |
| `credentials` | `credential/register` / `credential/rotate` / `credential/revoke` / `credential/revision` | `dsh cred` | register 只存元数据拒明文、`revision = 1 + rotates`、revoke 后 rotate 抛 `cred-revoked`、log-only | `credentials/register`+`rotate`+`revoke` |
| `sidebar-right` | `tabs/register` / `tabs/unregister` / `tabs/list` | `dsh tabs` | kind 白名单 panel/view/widget、重 register 复活、unregister 软删 | 纯进程内（非渲染面） |
| `feedback` | `feedback/record` / `feedback/list` | `dsh feedback` | 空 turn/sentiment 抛、comment 允许空、replay、`<turn>::<sentiment>::<comment>` | `feedback/record` log-only |
| `web-server` | `webserver/register-route` / `webserver/list-routes` | `dsh webserver` | kind 白名单 exact/prefix、重 (method,path) noop、`lastIndexOf("::")` 提 key、replay | `webserver/route` log-only |
| `workspace` | `workspace/change` / `workspace/list` / `workspace/pin` | `dsh workspace` | `create/archive/pin` 三态、archived 从 list 排除、pinned ArrayList、重 id `ws-duplicate-id` | `workspace/change` log-only |
| `deliverables` | `deliverable/present` / `deliverable/last` / `workspace-changes/record` | `dsh deliverables` | 逐轮记录不合并、空 files 仍落事件；**仍缺** `ctx.workspaceChanges.summary/diff` 服务、`WorkspaceFileDiff` 三种 kind、git 快照 turn-start/turn-end 捕获、`projectContent` 集成 | `deliverables/presented`+`workspace/changes` |

### M7 委托与编排（6）

| 模块 | 目标宿主 verb | 目标 CLI 子命令 | 断言最小集 | 事件 |
|---|---|---|---|---|
| `commands` | `command/register` / `command/resolve` / `command/list` | `dsh cmds` | 重名抛 `command-duplicate-name`、未知抛 `command-unknown-name`、空 name 抛 | 纯进程内 |
| `mcp` | `mcp/register` / `mcp/deregister` / `mcp/list` | `dsh mcp` | `register::<name>::<transport>` 事件、deregister 后 list 无、重名 noop、replay | `mcp/server` log-only |
| `subagent` | `subagent/launch` / `subagent/settle` / `subagent/cancel` | `dsh subagent` | launch 落 spawn 事件、settle/cancel 终态、已 settle 再 cancel 抛、replay | `subagent/spawn`+`settle`+`cancel` |
| `workflow` | `workflow/start` / `workflow/done` / `workflow/fail` | `dsh workflow` | running → done/failed 终态不可逆、二次 done 抛、fail reason 保留、replay | `workflow/step` log-only |
| `user-questions` | `uxq/ask` / `uxq/answer` / `uxq/pending` | `dsh uxq` | ask 落 request 事件、answer 落 answer 事件、二次 answer 抛 `uxq-already-answered` 且不落 | `user-questions/request`+`answer` |
| `todo` | `todo/add` / `todo/update` / `todo/list` / `todo/complete` | `dsh todo` | add 落项、update 按 id、complete 终态、list 顺序 replay、空内容抛 | `todo/*` log-only |

### M8 外部集成（7）

| 模块 | 目标宿主 verb | 目标 CLI 子命令 | 断言最小集 | 事件 |
|---|---|---|---|---|
| `browser-use` | `browser/navigate` / `browser/click` / `browser/type` / `browser/scroll` | `dsh bu` | verb 白名单四选一、非白名单抛 `browser-use-bad-verb`、空 target 抛、replay | `browser-use/action` log-only |
| `computer-use` | `computer/click` / `computer/drag` / `computer/scroll` / `computer/type` / `computer/press_key` | `dsh cu` | verb 白名单五选一、非白名单抛 `computer-use-bad-verb`、空 target 抛、replay | `computer-use/action` log-only |
| `office-to-pdf` | `pdf/start` / `pdf/done` / `pdf/fail` | `dsh opdf` | pending → done/failed 终态、二次 done 抛、fail reason 保留、replay | `office-to-pdf/task` log-only |
| `otel` | `otel/enable` / `otel/disable` / `otel/record` / `otel/spans` | `dsh otel` | enable/disable 本地开关、record 未开抛 `otel-not-enabled`、空 name 抛、replay 计数 | `otel/span` log-only |
| `ssh` | `ssh/connect` / `ssh/disconnect` / `ssh/status` | `dsh ssh` | connect 落事件、disconnect 移除、status 未知抛 `ssh-unknown-host`、replay | `ssh/target` log-only |
| `voice-input` | `voice/begin` / `voice/end` / `voice/utterance` | `dsh voice` | begin/end 本地开关不落事件、open 才能 utterance、close 时 utterance 抛、log-only | `voice/utterance` log-only |
| `webhook` | `webhook/fire` / `webhook/list` | `dsh webhook` | fire-and-forget 无返回、url 空抛、`<method>::<url>::<body>`、replay | `webhook/fire` log-only |

## 计数

- **本清单覆盖**：**51 行 ◐**（M0 4 + M1 7 + M2 2 + M3 3 + M4 11 + M5/M6 11 + M7 6 + M8 7 = 51）。
- **不含已 ✔ 的 12 行**：`approval` / `conversation` / `core` / `extensions` / `persistence` / `session` / `session-projection` / `subprocess` / `system-prompt` / `token-meter` / `tools` / `web-client`。
- **README 行**：不在 63 模块分母内，`已复刻` 列的 ☐ 不计数。
- `cordis` / `gateway` **不在 subsystems 表里**（框架层/交付层裁决，见矩阵「M0 基座的裁决」），本清单不单列。

## 提交顺序建议

1. 并发线把 `apps/host/src/main.cj` + `apps/cli/src/main.cj` 的在飞改动落库；
2. 按 M0 → M8 顺序逐批推：M0 四条、M1 七条、M2 两条、M3 三条、M4 十一条、M5/M6 十一条、M7 六条、M8 七条；每批 ≤ 5 模块保持单 commit 可复核；
3. 每条 verb 上完后**同步改** `preload.cjs` + `bridge.test.mjs`（AGENTS.md 硬约束）；
4. 每批跑一次「HEAD worktree + 双入口断言 + NSIS 装包 smoke」，把计数增补进 `docs/evidence/p0-status-2026-10-02.md` 与本清单。

## 未列入本清单的（另有归因）

- **代码签名**：`signExecutable:false` 显式关；主体不存在，走三档阶梯需先定档。
- **Ctrl+C 中断**：sig-mode 4 FAIL 属本机 ConPTY 不投递，真人按或换 CI 才能闭合。
- **真 provider 网络**：`realstream` 需 base URL + API key；`llm-streaming` 行的接入与本条相关，无凭证时子系统断言只能到「夹具级」。
- **cjpm build 字节级不可复现**：跨环境判据用行为面（cjpm test 331 / CLI 175 PASS / 宿主 NDJSON 24 PASS / SaCode.exe SMOKE+UI_SMOKE），不用哈希相等。
