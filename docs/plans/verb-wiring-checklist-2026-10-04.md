# 49 模块 verb 接入清单（供并发线落库后直接执行）

**目的**：把能力矩阵里 52 行 ◐（本会话新落 49 + 早前 3）升到 ✔ 所需的**入口侧接入工作**列成清单。每条给出：目标宿主 verb / 目标 CLI 子命令 / 断言集最小形态 / 会话日志事件 / 上游契约出处。并发线把 `apps/host/src/main.cj` 与 `apps/cli/src/main.cj` 的在飞改动落库后，按本表逐条推。

**为什么现在不做**：并发线两份 `main.cj` 分别有 41 / 46 行未落库改动；共享 worktree 纪律不吞并不 revert，只能等其落库。核心 `.cj` 文件由本会话独占，已全量提交。

## 通用形状

- **宿主 verb**：`<域>/<动作>` 命名；请求 `params` 逐字段校验；返回 `result` 或 `-32xxx` 错误码；能力清单 `initialize.capabilities` 里必须列上；stdout 只走协议帧，诊断走 stderr（AGENTS.md）。
- **CLI 子命令**：`main.cj` 加 `if (mode == "<名>")` 分派；断言式 `expect(名字, 条件)` 打印 `PASS` / `FAIL` 前缀；剥 SDK PATH 后能独立跑；返回码 = `FAIL` 计数。
- **桌面 IPC 通道**：`preload.cjs` 与 `test/bridge.test.mjs` 同步增删（AGENTS.md）；按动作命名，逐字段校验，不给「发任意方法」通道。
- **会话日志不变量**：所有 log-only 事件不进 `isSurfaceEvent` 白名单（system/developer/user/assistant/tool-result 才是）；`<verb>::<字段>::<字段>` 管道编码；未来放开需换长度前缀。

## 逐模块清单

### 基座类（M0）

| 模块 | 宿主 verb | CLI 子命令 | 断言最小集（4 条起） | 事件 / 内部状态 |
|---|---|---|---|---|
| `boot` | `boot/register` / `boot/run` / `boot/status` | `dsh boot` | 顺序、重名 `boot-duplicate-stage` 拒、run 后 register `boot-already-run` 拒、run 幂等 | 纯进程内注册表（本仓已定：不落 log） |
| `scope` | `scope/enter` / `scope/exit` / `scope/current` | `dsh scope` | LIFO 严格、exit 空栈拒、跨进程 replay、嵌套深度 | `scope/enter`+`scope/exit` log-only |
| `typert` | `type/register` / `type/lookup` | `dsh typert` | 注册即 lookup、重名拒、未知名抛、size 单调 | 纯进程内 |
| `invariants` | `invariant/register` / `invariant/check` | `dsh invariant` | 注册、check pass 记录、check fail 记录、初始 `unchecked` | `invariant/register` + `invariant/check` log-only |

### M1 会话与存储

| 模块 | 宿主 verb | CLI 子命令 | 断言最小集 | 事件 |
|---|---|---|---|---|
| `storage` | `storage/open` / `storage/put` / `storage/get` / `storage/delete` | `dsh storage` | open 域 + 版本严格、已 open 重开拒、版本不匹配拒、put/deleted 携新快照、close 后再开 | `domain/changed`（in-process only） |
| `spill` | `spill/record` / `spill/list` | `dsh spill` | 空 turn / reason 各自抛、多次 record 全 replay、跨进程 load | `spill/marker` log-only |
| `session-reference` | `session/reference-add` / `session/reference-list` | `dsh xref` | FileReference 候选、SessionReferenceMention 结构、7 ErrorCode 各一条、`session/reference` log-only 面 | `session/reference` log-only |

### M2 模型与上下文

| 模块 | 宿主 verb | CLI 子命令 | 断言最小集 | 事件 |
|---|---|---|---|---|
| `compaction` | `context/compact-record` / `context/compact-list` | `dsh compact` | 空 reason 抛、空 before/after 抛、log-only 表面、marker 计数 | `compaction/record` log-only |

### M3 loop 与目标

| 模块 | 宿主 verb | CLI 子命令 | 断言最小集 | 事件 |
|---|---|---|---|---|
| `schedule` | `schedule/add` / `schedule/fire` / `schedule/cancel` / `schedule/list` | `dsh schedule` | 三态迁移（pending→fired/cancelled）、fire 未存在抛、cancel 已 fire 抛、跨进程 replay | log-only |
| `jobs` | 已有 ✔ | 已有 | — | — |

### M4 工具与执行世界

| 模块 | 宿主 verb | CLI 子命令 | 断言最小集 | 事件 |
|---|---|---|---|---|
| `sandbox` | `sandbox/resolve` / `sandbox/confine` | `dsh sandbox` | 三档优先级、`danger-full-access` 拒 `SANDBOX_MODE_NOT_CONFINED`、无后端拒 `SANDBOX_UNAVAILABLE`、per-call policy 覆盖、ConfinedArgv 结构（上游校正：`ConfinedSandboxMode` 类型级收窄未做） | 纯进程内 |
| `shell` | `shell/exec-record` / `shell/exec-list` | `dsh shell` | 三字段全空各自抛、argv joined replay、cwd 空仍落、跨进程 load | `shell/exec` log-only |
| `skills` | `skill/register` / `skill/describe` / `skill/uninstall` | `dsh skill` | 注册即 describe、卸载后 describe 返 ""、重名 noop、空 name 抛 | `skill/register` + `skill/uninstall`（软删） |
| `lsp` | `lsp/define` / `lsp/lookup` / `lsp/rename` | `dsh lsp` | 空抛、重 define noop、rename 未知抛、count 单调 | 纯进程内 |

### M5/M6 客户端与前端装配

| 模块 | 宿主 verb | CLI 子命令 | 断言最小集 | 事件 |
|---|---|---|---|---|
| `settings` | `settings/update` / `settings/replace` / `settings/mutate` / `settings/get` | `dsh settings` | 三 prefix 各一条、`mutate` CAS 拒 stale、`replace` 先清空再应用、log-only `settings/document-updated`（不进 isSurfaceEvent） | `settings/document-updated`（log-only） |
| `slots` | `slot/register` / `slot/activate` / `slot/list` | `dsh slots` | 空抛、未知 activate 抛 `slots-unknown`、kind 白名单、replay 顺序 | `slots/register` + `slots/activate` log-only |
| `client-modules` | `module/register` / `module/activate` | `dsh cmod` | 空 id/version 抛、重 id 抛 `cmod-duplicate-id`、未知 activate 抛、isLoaded 单调 | 纯进程内 |
| `client-resources` | `resource/register` / `resource/lookup` / `resource/list` | `dsh resource` | 空 uri/mime 抛、重名 noop、未知 lookup 空、log-only | `resource/register` log-only |
| `attachment` | `attach/record` / `attach/list` | `dsh attach` | 空 name/mime 各自抛、size 允许空、replay 完整、log-only 面 | `attachment/record` log-only |
| `credentials` | `credential/register` / `credential/rotate` / `credential/revoke` / `credential/revision` | `dsh cred` | 元数据 register 拒明文、`revision = 1 + rotates`（避 Int64 parse）、revoke 后 rotate 抛 `cred-revoked`、log-only | `credentials/register`+`rotate`+`revoke` log-only |
| `sidebar-right` (tabs) | `tabs/register` / `tabs/unregister` / `tabs/list` | `dsh tabs` | kind 白名单 panel/view/widget、重 register 复活、unregister 软删、纯进程内 | 无（in-process） |
| `feedback` | `feedback/record` / `feedback/list` | `dsh feedback` | 空 turn/sentiment 抛、comment 允许空、replay、`<turn>::<sentiment>::<comment>` | `feedback/record` log-only |
| `user-questions` | `uxq/ask` / `uxq/answer` / `uxq/pending` | `dsh uxq` | ask 落 request 事件、answer 落 answer 事件、二次 answer 抛 `uxq-already-answered` 且不落 | `user-questions/request`+`answer` log-only |

### M7 委托与编排

| 模块 | 宿主 verb | CLI 子命令 | 断言最小集 | 事件 |
|---|---|---|---|---|
| `commands` | `command/register` / `command/resolve` / `command/list` | `dsh cmds` | 重名抛 `command-duplicate-name`、未知抛 `command-unknown-name`、空 name 抛、纯进程内 | 无（in-process） |
| `mcp` | `mcp/register` / `mcp/deregister` / `mcp/list` | `dsh mcp` | `register::<name>::<transport>` 事件、deregister 后 list 无、重名 noop、replay | `mcp/server` log-only |
| `agent-team` | `team/join` / `team/leave` / `team/broadcast` / `team/members` | `dsh team` | 空 id/role/text 各自抛、重名 join noop、leave 排除、broadcast count | `agent-team/membership`+`broadcast` log-only |
| `workflow` | `workflow/start` / `workflow/done` / `workflow/fail` | `dsh workflow` | running → done/failed 终态不可逆、二次 done 抛、fail reason 保留、replay | `workflow/step` log-only |
| `subagent` | `subagent/launch` / `subagent/settle` / `subagent/cancel` | `dsh subagent` | launch 落 spawn 事件、settle/cancel 终态、已 settle 再 cancel 抛、replay | `subagent/spawn`+`settle`+`cancel` log-only |
| `plan` | 已 ✔ | 已 | — | — |
| `goal` | 已 ✔ | 已 | — | — |

### M8 外部集成

| 模块 | 宿主 verb | CLI 子命令 | 断言最小集 | 事件 |
|---|---|---|---|---|
| `web` | `web/allow` / `web/deny` / `web/fetch` | `dsh web` | allow set + deny override、未 allow host fetch 抛 `web-host-not-allowed` 且不落事件、host 从 `://` + `/` split、replay | `web/allow`+`deny`+`fetch` log-only |
| `ssh` | `ssh/connect` / `ssh/disconnect` / `ssh/status` | `dsh ssh` | connect 落事件、disconnect 移除、status 未知抛 `ssh-unknown-host`、replay | `ssh/target` log-only |
| `browser-use` | `browser/navigate` / `browser/click` / `browser/type` / `browser/scroll` | `dsh bu` | verb 白名单四选一、非白名单抛 `browser-use-bad-verb`、空 target 抛、replay | `browser-use/action` log-only |
| `computer-use` | `computer/click` / `computer/drag` / `computer/scroll` / `computer/type` / `computer/press_key` | `dsh cu` | verb 白名单五选一、非白名单抛 `computer-use-bad-verb`、空 target 抛、replay | `computer-use/action` log-only |
| `office-to-pdf` | `pdf/start` / `pdf/done` / `pdf/fail` | `dsh opdf` | pending → done/failed 终态、二次 done 抛、fail reason 保留、replay | `office-to-pdf/task` log-only |
| `terminal` | `term/open` / `term/chunk` / `term/read` | `dsh term` | sessionId 空抛、chunk append、read 未知返空 ArrayList、跨进程 replay | `terminal/chunk` log-only |
| `web-server` | `webserver/register-route` / `webserver/list-routes` | `dsh wspace-server`（与 `workspace` 区分） | kind 白名单 exact/prefix、重 (method,path) noop、`lastIndexOf("::")` 提 key、replay | `webserver/route` log-only |
| `voice-input` | `voice/begin` / `voice/end` / `voice/utterance` | `dsh voice` | begin/end 本地开关不落事件、open 才能 utterance、close 时 utterance 抛、log-only | `voice/utterance` log-only |
| `webhook` | `webhook/fire` / `webhook/list` | `dsh webhook` | fire-and-forget 无返回、url 空抛、`<method>::<url>::<body>`、replay | `webhook/fire` log-only |
| `jobs` | 已 ✔ | 已 | — | — |
| `deliverables` | 部分 ◐ | 部分 ◐ | 补 `WorkspaceFileDiff` 三种 kind + `ctx.workspaceChanges.summary/diff` 服务 | 已 |
| `session-title` | 已 ✔ | 已 | — | — |
| `todo` | 已 ✔ | 已 | — | — |
| `plan` | 已 ✔ | 已 | — | — |
| `permission-presets` | 已 ✔ | 已 | — | — |
| `otel` | `otel/enable` / `otel/disable` / `otel/record` / `otel/spans` | `dsh otel` | enable/disable 本地开关、record 未开抛 `otel-not-enabled`、空 name 抛、replay 计数 | `otel/span` log-only |
| `product-telemetry` | `ptel/enable` / `ptel/disable` / `ptel/emit` | `dsh ptel` | 同 otel 形态、`emit` 未开抛、空 name 抛、replay 计数 | `product-telemetry/emit` log-only |
| `session-telemetry` | 已 ◐ → 待接 | 待接 | listener 顺序、throwing listener 中止 + 事件不落、`session-telemetry/record` log-only | 已 |
| `workspace` | 已 ◐ → 待接 | 已 ◐ → 待接 | `create/archive/pin` 三态、archived 从 list 排除、pinned ArrayList、重 id `ws-duplicate-id` | `workspace/change` log-only |
| `extensions` | 已 ✔ | 已 | — | — |
| `filesystem` | 部分 ◐ | 部分 ◐ | — | — |

## 计数

- **本清单覆盖**：49 模块（本会话批量切片）+ 3 早前 ◐ 行 = 52 行需从 ◐ 升 ✔。
- **不含**：已 ✔ 的 11 行（`approval` / `conversation` / `core` / `extensions` / `gateway` / `session-title` / `todo` / `plan` / `goal` / `permission-presets` / `token-meter`），已 ✔ 的 `jobs` / `webhook` 视具体状态另计。
- **每条升 ✔ 的判据**（沿用 `plan-deepseek-harness-replication.md` §6.1.2 A 档）：至少一条子系统级断言、上游校正段有出处、双入口各跑一次、变异反证不假绿。

## 提交顺序建议

1. 并发线把 `apps/host/src/main.cj` + `apps/cli/src/main.cj` 的在飞改动落库；
2. 按 M0 → M8 顺序逐批推：M0 四条、M1 三条、M2 一条、M3 一条、M4 五条、M5/M6 十条、M7 六条、M8 十二条；每批 ≤ 5 模块保持单 commit 可复核；
3. 每条 verb 上完后**同步改** `preload.cjs` + `bridge.test.mjs`（AGENTS.md 硬约束）；
4. 每批跑一次「HEAD worktree + 双入口断言 + NSIS 装包 smoke」，把计数增补进 `p0-status-2026-10-02.md` 与本清单。

## 未列入本清单的（另有归因）

- **代码签名**：`signExecutable:false` 显式关；主体不存在，走三档阶梯需先定档。
- **Ctrl+C 中断**：sig-mode 4 FAIL 属本机 ConPTY 不投递，真人按或换 CI 才能闭合。
- **真 provider 网络**：realstream 需 base URL + API key，行为面已在 `dsh-realstream-cli.log` 侧证；无凭证不测。
- **cjpm build 字节级不可复现**：跨环境判据用行为面（cjpm test 331 / CLI 175 PASS / 宿主 24 PASS / SaCode.exe SMOKE+UI_SMOKE），不用哈希相等。
