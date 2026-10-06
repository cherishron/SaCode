# 后端能力缺口只读审计（2026-10-05）

> 性质：**只读审计**。本文件未运行 `cjpm build` / `cjpm test` / `npm` / `node`，未修改任何 `.cj` / `.cjs` / `.ts` / `.mjs` 源码。
> 全部结论来自对 `core/src/*.cj`、`apps/host/src/main.cj`、`apps/cli/src/main.cj`、`apps/desktop/preload.cjs`、`extjs/` 的逐行阅读，以及对冻结上游树 `D:\Temp\SaCode-official-639ed015\tree.json` 的路径检索。
> 上游契约正文只读过 [能力矩阵](../plans/dsh-capability-matrix.md) 已登记的那部分（63 模块 en/zh 直读账在 `docs/evidence/upstream-module-reads-2026-10-04.md`）；**未下载的上游源码正文（尤其 `packages/session-query/session-log-export/*`、`packages/boot/plugin-manager/*`）一律标「待核」，不替它编造格式**。

---

## 1. 审计口径（先说清楚「状态」这四个字在这里怎么判）

| 状态 | 判据 |
| --- | --- |
| **已接** | 上游该子系统的后端主干在本仓有实现，**且在产品路径上可达**（Host 的 `task/start` / 交付面子命令 / 桌面有限 IPC），关键行为有用例钉住；上游没有大段契约缺失 |
| **部分接** | 有核心切片或注册表面，但产品路径缺主干、或上游明确有的大段契约本仓没有 |
| **未接** | 全仓无对应实现，或只有占位/自测代码 |
| **上游不存在** | 上游确无该能力（本表仅 README 一行） |

**与能力矩阵的差异要显式说明**：矩阵 `已复刻` 列的 ✔ 门槛是「指得到具体用例名/计数」（方案 §6.1.2 A 档）。本审计的门槛是「**产品路径可达 + 上游大段契约不缺**」，因此更严。矩阵记 ✔ 的 10 行里，本审计只承认为 **已接 7 行**（conversation / persistence / session / session-projection / subprocess / token-meter / web-client）；`approval`、`tools` 两行本审计降为 **部分接**，理由见第 4 节第 1、2 条。矩阵 ☐ 为 0 行，本审计同样为 0 行——**没有整模块空白，但「接了薄薄一片」和「接通了」是两件事，这个区别正是本审计要交付的东西**。

---

## 2. 本仓后端落点盘点（实测，不是目录名猜的）

### 2.1 共享核心 `core/`

- `core/src/` 共 **193 个 `.cj`**：**93 个实现文件 + 100 个 `*_test.cj`**。
- 与 63 个上游子系统**能指到具体实现文件**的约 55 个（其余是 `conversation` / `core` / `web-client` 这种「整库/整壳」型，以及 README 行）；剩下约 38 个实现文件属本仓自有、上游 subsystems 目录里没有对应模块名，例如：`catalog.cj` 会话目录、`inbox.cj` 运行中队列、`lease.cj` 写租约、`procwin.cj` 崩溃接管、`sigwin.cj` Ctrl+C、`model_request.cj` 请求装配、`provider_registry.cj` / `custom_model_registry.cj` / `model_catalog.cj` / `model_settings.cj` 模型中心四层、`prompt_enhance.cj` / `enhance_charge.cj` 提示词增强与计费、`attempt_log.cj` / `route_health.cj` / `transport_failure.cj` 路由健壮性、`principal.cj` 本地身份、`upstream_pull.cj` 上游拉取、`request_trace.cj` 请求取证、`message_projection.cj` / `attachment_image.cj` 投影与图片读取、`goal_scheduler.cj` / `goal_runner.cj` / `goal_control.cj` 持续目标三件套等。
- **全仓 `core/src` 搜 `plugin|Plugin` 只有 2 处命中，且都在 `boot_actions_test.cj` 里给 `BootSequence` 注册了一个名为 `"plugins"` 的 stage 名**——`core` 侧**没有任何插件管理器、插件包、插件装配、插件清单**。这是本次审计最硬的一条负面证据。

### 2.2 宿主 `apps/host/src/main.cj`（1990 行）

`initialize` 回的能力表**实际声明 73 个方法**（`main.cj:778`），逐个核对均有处理分支：

| 分组 | 方法 |
| --- | --- |
| 外观 | `global/appearance/get` · `global/appearance/set-theme` · `global/appearance/set-font-size` · `appearance/get` · `appearance/set-theme` |
| 会话日志 | `session/projection` · `session/append` · `session/submit` · `session/flush` · `session/subscribe` |
| 会话目录 | `session/catalog` · `session/create` · `session/select` |
| 工作区 | `workspace/get` · `workspace/set-directory` |
| 起轮 | `turn/start` · `task/start` · `turn/cancel` · `turn/poll` |
| 队列 | `queue/describe` · `queue/enqueue` · `queue/update` |
| 附件 | `attachment/upload` · `attachment/image-read` |
| 审批 | `approval/ask` · `approval/answer` · `approval/status` |
| 工具/扩展 | `extension/list` · `extension/call` · `extension/dispose` · `extension/host/{spawn,load,list,call,dispose,poll,cancel,close}` |
| 用量 | `usage/status` · `usage/set-budget` |
| 目标 | `goal/describe` · `goal/create` · `goal/edit` · `goal/pause` · `goal/resume` · `goal/clear` |
| 提示词增强 | `prompt/enhance` · `prompt/poll` · `prompt/cancel` |
| 模型中心 | `model/get` · `model/configure` · `model/use-key` · `model/list` · `model/pull` · `model/registry/{describe,catalog,update,remove,set-default,add-catalog}` · `model/upstream/upsert` · `custom/{describe,upsert,remove}` · `custom/import/{new,into}` · `binding/{upsert,remove,reorder}` · `credential/{describe,set,unset}` |

> **文档漂移（顺手记）**：`AGENTS.md` 与能力矩阵都还写着「能力表 **23** 个方法」，实际已是 **73**。分母变了但文档没跟上，后续按 23 估算工作量的排期会偏。

### 2.3 CLI `apps/cli/src/main.cj`（1008 行）

15 个子命令：`seed|projection|all|stream|tool|ext|cancel|extjs|sig|headless|tools|call|realstream|att|goal`。
其中**只有 `tools` 与 `call` 是产品面**（列工具清单 / 带审批工单调一次工具），其余 13 个都是**断言式自测**（`expect(...)` 计数后 `ALL PASS`）。`realstream` 也是自测：它手搓请求体、对**本机夹具**跑一轮并断言正文等于 `"first"`（`main.cj:891-903`）。

### 2.4 桌面有限 IPC（`apps/desktop/preload.cjs`，66 行）

`contextBridge.exposeInMainWorld("sacode", {...})` 顶层 key 共 **52 个**（`preload.cjs:5-65`，与 `AGENTS.md` 记的「提交态 33 / 工作区态 42」又已经不一致，同样属文档漂移）。其中与后端能力直接相关的缺口：**没有 `sessionExport`（日志导出）、没有 `sessionRename` / `sessionDelete`（会话重命名/删除）、没有 `goalRun`（持续目标起跑）、没有 `pluginInstall` / `pluginList`（插件管理）**。

### 2.5 全仓工具实现清单（这是「一切皆插件」的硬分母）

`core/src/agent.cj` 的 `ToolRuntime.pipeline`（`:193-221`）**只实现三个工具名**：

| 工具名 | 实现位置 | 说明 |
| --- | --- | --- |
| `todo_write` | `TodoTool`（`core/src/todo_tool.cj`） | 唯一带 JSON Schema 的模型工具 |
| `read` | `ToolRuntime.readStep` | 读文件并登记观察值 |
| `write` | `ToolRuntime` write 段 | 先观察后写、写后逐字节复核 |
| 其它任何名字 | `:216-221` | 一律 `unknown-tool:<name>` 阶段码 |

`core/src/pipeline_test.cj:96` 白纸黑字写着 `reg.register(ToolSpec("edit", "还没实现的工具", "path", false))`——`edit` 至今是占位名。
`extjs/example/` 只有 5 个**测试夹具**（`echo` / `broken` / `slow` / `delayed` / `watchful`），没有一个是产品工具。

对照上游（冻结树可证的 tool 包，每个都是一个 Cordis 插件）：`packages/fs/tool-fs`、`tool-fs-search`、`tool-str-replace-editor`；`packages/shell/tool-bash`、`tool-bash-persistent`、`tool-pwsh`、`tool-pwsh-persistent`；`packages/web/tool-web`；`packages/todo/tool-todo`；`packages/skill/tool-skill`、`tool-workspace-dependencies`；`packages/subagent/tool-subagent`、`tool-subagent-control`；`packages/jobs/tool-jobs`；`packages/lsp/tool-lsp`；`packages/terminal/tool-terminal`；`packages/interaction/tool-ask-user`；`packages/session-query/tool-session-query`；`packages/goal/tool-goal`；`packages/workflow/tool-workflow`、`tool-ralph`；`packages/experimental/tool-agent-team`——**上游至少 19 个 tool 包，本仓 3 个工具实现**。

---

## 3. 逐子系统缺口表（63 模块 + README 行）

「上游证据」列只写**能指到具体路径的**；只从能力矩阵转引、本次未亲自复核正文的，标「（矩阵转引）」。

| 子系统 | 上游证据 | 本仓落点 | 状态 | 差距 | 复刻步骤与验收 |
| --- | --- | --- | --- | --- | --- |
| agent-team | `packages/experimental/agent-team/src/index.ts`、`packages/experimental/tool-agent-team/src/index.ts` | `core/src/team.cj` `AgentTeam` | 部分接 | 只有 roster + broadcast marker（`agent-team/membership`、`agent-team/broadcast` 两个 log-only 事件）；上游 task 分派、跨代理状态同步、`@Remote team/*` 通道全无 | 先补 `agent-team/task` 事件与 `TaskHandle` 状态机；再接 Host `team/*` 有限方法。验收：一条任务从 create → dispatch → settle 全落日志，重启回放状态一致 |
| approval | `packages/interaction/user-approval/src/index.ts` | `core/src/approval.cj` + Host `approval/{ask,answer,status}` + 桌面 `approvalAsk/Answer` | 部分接 | 上游四档（allow/deny/ask/open-turn）+ waterfall（pre-execute 允许 ask），本仓两档（allowed-once / denied）；**open-turn 未实现**；在途未 flush 工单跨进程仍可能同号（`p0-status` 第 408 行自记未解决） | 补 `open-turn` 档与 pre-execute ask 钩子；把 `approval/asked` 的发号与 flush 绑在同一持租约窗口。验收：open-turn 一轮内多次放行不重发工单；两进程同时发号不同号 |
| attachment | `packages/attachment/attachment/src/index.ts`、`attachment-local/src/index.ts` | `core/src/attach.cj`、`attachment_image.cj`、`sha256.cj` + Host `attachment/{upload,image-read}` | 部分接 | 无规范化阶段（无图像编解码器，超限改为拒绝）；`image/webp` 三种 RIFF 变体未核验；历史逐条附件展示、文件下载、历史翻页未接（矩阵已记） | 引一个纯仓颉 PNG/JPEG 解码写回（或缩到「只做尺寸读取」并显式记为裁剪）；补 webp 夹具。验收：超限图被拒且日志有 `attachment-rejected`；webp 图能进 vision part |
| boot | `packages/boot/app-boot/src/index.ts` | `core/src/boot.cj` `BootSequence` | 部分接 | 纯进程内注册表；上游 `ctx.boot` 的 `dependencies` 与 `phases`（config/workspace/providers/telemetry）拓扑排序、`@Remote boot` 装配面均未做，且不落 log 事件 | 给 `BootSequence` 加 `dependsOn` 与拓扑排序 + `boot/stage` log-only 事件。验收：声明倒序依赖时 run 顺序仍正确；缺依赖显式抛 `boot-missing-dependency` |
| browser-use | `packages/experimental/browser-use-runtime/src/index.ts` 等 5 包 | `core/src/bu.cj` `BrowserUseLedger` | 部分接 | 只有动作 marker；真浏览器驱动、DOM 选择器解析、截图与 a11y 快照未接 | 属 M8 外围，建议排在工具面之后；先接 `tool-browser-use` 的最小闭环（navigate + 截图回传） |
| client-modules | `packages/client/modules/src/index.ts` | `core/src/cmod.cj` `ClientModuleRegistry` | 部分接 | 只做 (id,version) 加载状态表；未接真模块装载、生命周期钩子与 prompt 注入；上游 `@Remote modules/*` 未做 | 与插件管理器同一批做（见第 4 节第 6 条） |
| client-resources | `packages/client/resources/src/index.ts` | `core/src/resource.cj` `ResourceRegistry` | 部分接 | 只做 URI 命名空间登记；`dsh-resource://` 请求解析与内容流未接 | 补 `resource/read` 面：按 uri 回字节 + mime，未登记显式拒。验收：渲染层引用的资源 id 在冷启动后仍可取回 |
| commands | `packages/interaction/commands/src/index.ts` | `core/src/cmds.cj` `CommandRegistry` | 部分接 | 只做注册表面；slash 语法糖、参数 Schema 校验、`@Remote commands/list` 与 prompt 注入均未接 | 补参数 schema 校验 + `/` 前缀解析；再接 Host `commands/list`。验收：未知命令返回建议列表而非静默忽略 |
| compaction | `packages/compaction/compaction/src/index.ts`（另有 `compaction-basic`、`compaction-image-offload`、`compaction-tool-result-pruner`、`command-compact` 共 5 包） | `core/src/compact.cj` `CompactionLedger` | 部分接 | **只落 marker 事件**；实际摘要生成、阈值触发、被压缩消息 tombstone 与 prompt 重组全未做（矩阵 2026-10-05 主线亦点名「compaction 仍只有 marker」） | 这是用户四条主线之一，优先级高。步骤：阈值（token 占比）→ 选段 → 摘要请求 → 落 `compaction/record` + tombstone → `modelRequestJson` 跳过 tombstone。验收：真实模型回合在阈值触发后请求体消息数下降、被压缩段不再出现、日志可追问压了哪几段 |
| computer-use | `packages/experimental/computer-use-cua-driver-{native,mcp}/src/index.ts` | `core/src/cu.cj` `ComputerUseLedger` | 部分接 | 只有动作 marker；真屏幕截图、坐标命中、剪贴板与窗口管理未接 | 同 browser-use，排后期 |
| conversation | （矩阵转引）`packages/client/ui-conversation/src/index.ts` | `core/src/session.cj` `deriveMessages()` + `message_projection.cj` + 桌面 `BubbleProvider+BubbleList` | 已接 | 上游 `live-chunk` 概念本仓无；落盘正文出自假 provider 的装配结果（真 provider 路径已由 `real-provider-tools.test.mjs` 补上，见 llm-streaming 行） | 保持；如需贴上游可补 live-chunk 投影 |
| core | （矩阵转引）`packages/core/{agent,session,scope,tools,system-prompt,agent-default-model}/src/index.ts` | `core/` 整个静态库 | 部分接 | 上游 `SessionEventMap` 13 类事件，本仓主动裁剪到 5 类（session/system/user/assistant/tool-result）+ developer；上游 surface 类型系统（current/shadowed/log-only）、`SessionRecord{header,live,persisted}` 未实现投影层区分 | 若要贴上游，先补 `SessionEventSurface` 三态与 `SessionRecord`；本仓的 log-only 约定是自洽的，也可显式记为裁剪 |
| credentials | `packages/credentials/credentials/src/index.ts`、`credentials-local/src/index.ts`、`authorization/src/index.ts`、`deepseek-account*/src/index.ts` | `core/src/credential.cj`（分层 provider）+ `cred.cj`（元数据登记） | 部分接 | 引用 + env/user-file 分层 + 每次重新解析 + 活环境引用不可写，这四条已接；**`AuthorizationFlow` 与 `DeepSeekAccount` 按 C01 明确裁剪**（矩阵已核） | 裁剪已裁决，不补；保留第三方凭证安全存取即可 |
| deliverables | `packages/deliverables/tool-present/src/index.ts`、`workspace-changes/src/index.ts` | `core/src/deliverables.cj` | 部分接 | 只有 `deliverables/presented` 与 `workspace/changes` 两个 log-only 事件；**无 present 工具**、无 `workspaceChanges.summary/diff` 服务、无 git 快照 turn-start/turn-end 捕获 | 补 `present` 工具（带 callId 与 files）；turn 结束时做 git 快照差落 `workspace/changes`。验收：真实改文件的一轮在日志里有 diff 摘要 |
| extensions | `packages/extensions/{cordis-host-runner,cordis-client-runner,tool-cordis,ui-cordis}/src/index.ts` | `core/src/ext.cj` + `extproc.cj` + `extjs/`（Node CJS 宿主） | 部分接 | 本仓是「外部脚本宿主（NDJSON JSON-RPC 子进程）」，**不是 Cordis 动态包加载**；无 plugin manager、无 HMR、无包 manifest/依赖激活/安装态。矩阵已据此把本行从 ✔ 降 ◐ | 见第 4 节第 6 条（这是用户「一切皆插件」的主战场） |
| feedback | `packages/feedback/message-feedback/src/index.ts`、`command-feedback/src/index.ts` | `core/src/feedback.cj` | 部分接 | 只有 marker 事件；上游分类标签（正/负/建议）、上报目的地、工单联动未接 | 补消息级 CAS/撤回与分类弹窗数据面（矩阵 2026-10-05 主线已点名） |
| filesystem | `packages/fs/{fs,fs-local,fs-observation-policy,fs-sandbox}/src/index.ts` + `tool-fs` / `tool-fs-search` / `tool-str-replace-editor` | `core/src/agent.cj` `ToolRuntime`（read/write） | 部分接 | read/write 两件已接且 fail-closed 扎实；**`edit` / `glob` / `grep` 三个上游工具一个都没实现**；provider/consumer 拆分、有界读取、受保护原子替换未做 | 按上游三包分别落：`str-replace-editor`（edit）、`fs-search`（glob+grep）。验收：模型能用 edit 做一次精确替换并被 `fs-stale-version` 挡住陈旧替换 |
| goal | `packages/goal/{goal,goal-round-driver,tool-goal,command-goal}/src/index.ts` | `core/src/goal.cj`、`goal_control.cj`、`goal_scheduler.cj`、`goal_runner.cj` + Host `goal/*` 6 个方法 | 部分接 | 核心四层齐备且有用例，**但 `GoalRunner` 未接任何产品入口**（Host 无 `goal/run`，CLI `goal` 模式是断言自测）；`goal/complete` / `goal/block` 按设计不出现在有限控制面；`tool-goal` 未实现（模型不能自己建/改目标）；恢复 activation、准入计数未接 | 见第 4 节第 4 条 |
| invariants | `packages/runtime-diagnostics/invariants/src/index.ts` | `core/src/inv.cj` | 部分接 | 本切片是可登记/可复核的快照；上游 `@Invariant` 注解 + 结构等价检查未接；且该行只存在于冻结快照，master 已无 | 低优先；若要接，先定义注解形态 |
| jobs | `packages/jobs/{jobs,jobs-local,tool-jobs}/src/index.ts` | `core/src/jobs.cj` `JobStore` | 部分接 | 只有五态状态机；`JobHandle.append/updateProgress`、output ring、`JobHooks.cancel/done`、`JobRegistry.read/readAt/wait/attachController`、`JobController` @Remote、六类事件全未接 | 与 shell/bash 工具同一批做（长任务必须先有 Job 才能有工具） |
| llm-streaming | `packages/llm/llm/src/index.ts`、`llm-retry/src/index.ts` | `core/src/sse.cj` `RealSseProvider`、`deferred_provider.cj`、`transport_failure.cj`、`attempt_log.cj`、`route_health.cj` | 部分接 | **真 HTTPS+SSE 已接且有真实模型用例**（`sse_test.cj:364` 起、`model_tool_runtime_test.cj:125-152`、桌面 `real-provider-{e2e,tools,enhance}.test.mjs` 三条真实往返）；但 `RealSseProvider` 是**单发 POST、无重试、无熔断、无 attempt 账本**，`RouteHealth` / `AttemptLog` / `TransportFailure` 三个文件在 core 里**一个都没被 Host 或 CLI 引用**（grep 0 命中）；结构化失败被 `throw Exception(f.message())` 丢掉；协议只支持 `openai-completions`（Host `main.cj:1308-1313` 显式拒另两种） | 见第 4 节第 5 条 |
| lsp | `packages/lsp/{lsp,lsp-stdio,tool-lsp}/src/index.ts` | `core/src/lsp.cj` `LspSymbolRegistry` | 部分接 | 只有符号表；LSP 协议（definition/hover/rename）与语言服务器进程通信未接 | 排后期 |
| mcp | `packages/mcp/{mcp-client,mcp-resources}/src/index.ts` | `core/src/mcp.cj` `McpRegistry` | 部分接 | 只有注册表面；MCP JSON-RPC 通道、tools/resources 发现、waterfall 授权、`dsh-resource://` 地址未接 | 若要接 MCP，先有 stdio JSON-RPC 客户端（`extproc.cj` 的字节扫描可复用） |
| office-to-pdf | `packages/document/office-to-pdf/src/index.ts` | `core/src/opdf.cj` | 部分接 | 只有任务 marker；真异步转换、LibreOffice 调用、结果落盘未接 | 排后期 |
| otel | `packages/telemetry/otel/src/index.ts`、`packages/host/product-telemetry-otel/src/index.ts` | `core/src/otel.cj` | 部分接 | 本地开关 + marker；上游 exporter、配置、账号依赖已核（C04），本仓无可替换遥测服务，默认关闭 | 按 C04 保留「仅用户明确启用的可替换服务」，不整模块复刻 |
| permission-presets | `packages/interaction/permission-presets/src/index.ts` | `core/src/permission_presets.cj` | 部分接 | 默认表 + set/current 已接；`registerAuto` 固定 auto 预设、`PresetSpec.sandbox/approval` 双 knob 捆绑、`catalog-changed` emit、与 `ctx.sandbox`/`ctx.approval` 的 compose 契约未接 | 与 sandbox 行一起做：preset 改了要能同时改沙箱档与审批档 |
| persistence | （矩阵转引）`packages/session/session-persistence*/src/index.ts` 等 8 包 | `core/src/session.cj`（append/flush/load、尾帧截断、中段缺帧拒）+ `lease.cj` + `procwin.cj` | 已接 | 上游多 backend / facet / `malformed-medium` / `invalid-record` 分类无（本仓单 jsonl 真源，属显式裁剪） | 保持 |
| plan | `packages/plan/plan-mode/src/index.ts` | `core/src/plan.cj` | 部分接 | 只有 `active: Bool` 全值替换；上游 `'queued'` / `'cancelled'` 两态（pre-step 边界落地）、`exit_plan_mode` 工具、`/plan` 命令、`plan:policy` prompt section、`PlanModeConfig` 加载期校验全未接（矩阵 2026-10-05 主线点名「plan 仍缺 /plan 命令、边界状态、提交与审阅」） | 用户四条主线之一。步骤：三态状态机 → pre-step 边界落 `plan/mode` → `exit_plan_mode` 工具 → 系统提示注入 plan 段。验收：模型在 plan 态只能读不能写，调用 write 被显式拒且日志可追问 |
| product-telemetry | `packages/client/product-analytics/src/index.ts` | `core/src/ptel.cj` | 部分接 | 同 otel；上游 `ctx.productAnalytics` @Remote（enabled/watchPolicy/report）未接 | 同 C04 处置 |
| ptc-runtime | `packages/ptc-runtime/{ptc-runtime,ptc-runtime-node}/src/index.ts`、`packages/experimental/ptc-runtime-python/src/index.ts` | `core/src/ptc.cj` | 部分接 | 只有 marker；per-tool-call 上下文、attribute 挂属性、waterfall 授权、span 上报未接 | 排后期 |
| sandbox | `packages/sandbox/{sandbox,sandbox-policy,sandbox-local,sandbox-windows-acl}/src/index.ts` | `core/src/sandbox.cj` | 部分接 | 三档优先级 + `confine` fail-closed 已接；上游 `ConfinedSandboxMode` 类型级收窄、`SandboxEnforcement = full｜partial` 与 `signal?` 中止传播未接；**不接 OS 级沙箱后端** | 补 enforcement 分级与 signal 传播；OS 后端（Windows ACL）单独立项 |
| schedule | `packages/schedule/schedule/src/index.ts` | `core/src/schedule.cj` | 部分接 | 只有 fire 计数；无 cron 引擎、时区/去重/重放策略；`@Remote schedule/list｜create｜delete` 与 `schedule/fire` 通道未接 | 排后期 |
| scope | `packages/core/scope/src/index.ts` | `core/src/scope.cj` `ScopeStack` | 部分接 | 只有栈与 LIFO；scope-kind（session/workspace/global）分层与 `scope/policy` prompt section 未接 | 与 system-prompt 行同批（prompt section 是同一处装配点） |
| session | （矩阵转引）`packages/core/session/src/index.ts` 等 | `core/src/session.cj` | 已接 | 上游 surface 类型系统未实现（见 core 行） | 保持 |
| session-projection | （矩阵转引）`packages/session/session-projection*/src/index.ts` | `core/src/session.cj` `deriveMessages()` + `message_projection.cj` | 已接 | 上游 `SessionProjectionMap` 支持多投影注册，本仓单一投影；上游持久化缓存键本仓用内存缓存 | 若要接，把 `deriveMessages` 泛化成可注册投影表 |
| session-query | `packages/session-query/session-query/src/index.ts`、`session-query-sqlite/src/index.ts`、`tool-session-query/src/index.ts`、**`session-log-export/src/{index,archive,routes}.ts` + `client/{controller,Dialog,HeaderAction}.tsx` + 9 个测试** | `core/src/sq.cj` `SessionQuery` | 部分接 | **（1）查询面**：只有 `byType` / `byKeyword` / `countAll` 全量扫描；时间窗、分页、按 surface 过滤、`@Remote query/*` 未接。**（2）日志导出完全未接**——全仓 `.cj` 搜 `export` 只命中 `otel_test.cj` 的一句注释；Host 73 个方法里没有导出方法，桌面 52 个 IPC key 里没有 `sessionExport`。上游导出包有 `archive.ts` / `routes.ts` / `controller.ts` / `Dialog.tsx` / `HeaderAction.tsx` 与 `archive.host` / `route.host` / `command.host` / `controller.client` / `dialog.client` / `header-action.client` / `loader-composition.host` / `client-apply.client` 共 9 个测试 | 见第 4 节第 3 条（用户四条主线之一） |
| session-reference | `packages/context/session-reference/src/index.ts`、`file-reference/src/index.ts` | `core/src/xref.cj` | 部分接 | 只有 add+list；上游 7 个 ErrorCode（stale-version / outside-workspace / denied / malformed / too-large）未逐一落码；`SessionReferenceMention` 与 prompt 装配未接 | 补 error code 分族 + `@` 提及解析 |
| session-telemetry | `packages/session/session-telemetry/src/index.ts`、`session-telemetry-otel/src/index.ts` | `core/src/telemetry.cj` | 部分接 | 两 channel（ledger 镜像 + ops）只近似 ledger 一侧；ops 侧、脱敏扩展点、外发边界未做 | 同 C04 |
| session-title | `packages/session/session-title/src/index.ts`、`session-title-llm/src/index.ts`、`session-title-{first-prompt,all-prompts}-llm/src/index.ts` | `core/src/title.cj` | 部分接 | 核心 rename / 单槽 provider / 60 字截断 fallback 已接；**Host 无 `session/title-*` 通道**（73 个方法里没有）、**CLI 无 `dsh title`**、无 `first-prompt`/`all-prompts` 自动模式、无 branded `SessionTitleProviderId` | 补 Host `session/rename` + 首条用户消息后自动命名。验收：新建会话发一句话，目录列表标题自动变为摘要 |
| settings | `packages/settings/settings/src/index.ts`、`packages/api/settings-controller/src/index.ts` | `core/src/settings.cj`、`appearance.cj`、`global_appearance.cj` | 部分接 | 三种变更（合并/整替/CAS）+ `settings/document-updated` 已接；完整配置域未实现，模型/凭证/扩展管理分区未开放（矩阵已记） | 与模型中心组合同批做 |
| shell | `packages/shell/{shell,bash-local,bash-sandbox,pwsh-local,pwsh-sandbox,shell-env}/src/index.ts` + `tool-bash` / `tool-bash-persistent` / `tool-pwsh` / `tool-pwsh-persistent` | `core/src/shl.cj` `ShellLedger` | 部分接 | **只有 marker 事件，没有任何 shell 派生能力**；stdin/stdout 流、退出码、非零终态判定在 `subprocess` 行也不覆盖（`extproc.cj` 只驱动 extjs 一个子进程协议） | 用户「安装即用」的关键短板：没有 bash 工具，产品基本不可用。见第 5 节优先级 2 |
| sidebar-right | `packages/client/ui-sidebar-right/src/index.ts`、`ui-dockkit/src/index.ts` | `core/src/tabs.cj` `TabTypeRegistry` | 部分接 | 只做非渲染 tab-type 元数据登记；dockkit 布局与 `dsh-resource://` 内容流未接；上游 zh 版在冻结 commit 不存在（404） | 前端向，排后期 |
| skills | `packages/skill/{skill,skill-filesystem,skill-office,tool-skill}/src/index.ts` | `core/src/skill.cj` | 部分接 | 只有注册表面；skill 生命周期、加载期校验、`skill.md` 装配未接 | 与插件管理器同批（skill 本质是本地插件包） |
| slots | `packages/client/ui-slots/src/index.ts` | `core/src/slots.cj` + 桌面 `SlotCore` | 部分接 | 核心 SlotCore + Vue runtime/h() 注入已接（低优先级遮蔽、身份校验、卸载坍缩、重建自动注入有单测与真实 DOM 证据，`docs/evidence/client-slots-2026-10-05.md`）；完整 Factory/Store、异步客户端模块、核心 profile 装配、**本地插件加载**未接 | 前端贡献面已有一半；剩下一半必须等插件包格式定稿 |
| spill | `packages/spill/{spill,spill-local,spill-policy}/src/index.ts` | `core/src/spill.cj` | 部分接 | 只有 marker；实际 spill 落地（写到仓外文件、内容寻址、清理策略）与 spill 目录管理未做 | 与大工具输出同一批做（output ring + spill 是配对能力） |
| ssh | `packages/ssh/{ssh,fs-ssh,sandbox-ssh,subprocess-ssh}/src/index.ts` | `core/src/ssh.cj` | 部分接 | 只有注册表面；真 SSH 通道、密钥管理、远端 shell 未接 | 排后期 |
| storage | `packages/storage/{storage,storage-domain,storage-json,storage-sqlite}/src/index.ts` | `core/src/storage.cj` | 部分接 | 真源仍是追加式 `session.log`；上游多 backend / facet / `malformed-medium` / `invalid-record` 分类无；`domain/changed` 跨进程推送未做 | 显式记为裁剪（C03 已核） |
| subagent | `packages/subagent/subagent/src/index.ts` + 7 个 driver 包 + `tool-subagent` / `tool-subagent-control` | `core/src/subagent.cj` `SubagentLedger` | 部分接 | 只有状态机；实际子代理分派、独立上下文、结果传递未接；`tool-subagent` 未实现 | 需要先有可复用的 turn 执行面（已有 `ModelAgentLoop`），工程量中等，价值高 |
| subprocess | `packages/subprocess/{subprocess,subprocess-local,win32-process}/src/index.ts` | `core/src/extproc.cj` `ExtProcess` | 已接 | 本仓只实现 NDJSON JSON-RPC 一种子进程协议（够驱动 extjs）；上游任意进程管理未做 | 保持；bash 工具可复用其字节扫描与取消 |
| system-prompt | `packages/core/system-prompt/src/index.ts`、`packages/context/agent-instructions/src/index.ts` | `core/src/sysprompt.cj` `SystemPromptBuilder`、`request_trace.cj` | 部分接 | **Host 完全未接**（详见第 4 节第 1 条）：`apps/host/src/main.cj` 全文搜 `SystemPromptBuilder` / `system/message` / `sysprompt` **0 命中**，`task/start` 直接拿 `shared.snapshotEvents()` 装配请求，日志里没有 system 事件时模型收到的是**空系统提示**；`SystemPromptBuilder.build()` 本体也只有 30 行（`you are SaCode` + 工具清单 + goal 段），上游的 persona / 环境 / 权限 / plan 等 prompt section 装配未接 | 见第 4 节第 1 条（用户四条主线之一） |
| terminal | `packages/terminal/{terminal,terminal-bash,tool-terminal}/src/index.ts` | `core/src/term.cj` `TerminalBuffer` | 部分接 | 无 PTY 窄化，只有 chunk buffer；真 PTY、控制字符转义、渲染、resize 事件未接；Ctrl+C 走 `SetConsoleCtrlHandler`（`sigwin.cj`），不命中终端子系统 | 排后期 |
| todo | `packages/todo/tool-todo/src/{index,types}.ts`（已下载可读） | `core/src/todo.cj`、`todo_tool.cj` + Host `session/projection.todos` | 部分接 | `TodoStore` 全量替换/三态/并行策略 + `TodoTool` 严格 schema + Host 投影 + 桌面面板已接；**`todo_write` 是产品路径上唯一能被真实模型调用的工具**（这本身说明工具面太薄）；上游 invariant companion（一次校验既有 + 增量跟踪 turn 边界）未接 | 保持；把 invariant companion 补上 |
| token-meter | `packages/llm/token-meter/src/index.ts` | `core/src/meter.cj` + Host `usage/{status,set-budget}` + CLI `stream` 断言 | 已接 | 上游 `TokenSurfaceNode` 的 route-priced request-image pricing（`ctx.llm.imageRequestPricing`）与 `heuristicTokens` 影子定价无节点级实现；本仓另有 `enhance_charge.cj` 自建计费，未与 token-meter 合流 | 记账主干保持；定价节点若要接，与模型中心组一起做 |
| tools | `packages/core/tools/src/index.ts` + 19 个 tool 包（见 2.5） | `core/src/agent.cj` `ToolRegistry`/`ToolRuntime`、`model_tools.cj`、`model_tool_runtime.cj` | 部分接 | 四段管线契约（guard → 参数归一化 → snapshot → 执行 → 无损校验）与失败归一码一致；**但模型可见工具面只有 `todo_write` 一个**（详见第 4 节第 2 条）；上游 `ToolRestriction`(per-scope allow/deny) 与 `defineTool` DSL(`ValueSchemaSpec`) 未实现；`projectContent`/`finalizeContent` 分段缺 | 见第 4 节第 2 条（用户「一切皆插件」的第一硬骨头） |
| typert | `packages/typert/{protocol,registry,loader,generator}/src/index.ts` | `core/src/typert.cj` `TypeRegistry` | 部分接 | 纯进程内注册表，不落 log 事件；上游 branded type 名义化、泛型型变（协变/逆变）、结构等价比较均未做；`ctx.typer` 与工具参数 Schema 联动待补 | 若要接，先把 `defineTool` 的 `ValueSchemaSpec` 落到 typert 上 |
| user-questions | `packages/interaction/user-questions/src/index.ts`、`tool-ask-user/src/index.ts` | `core/src/uxq.cj` | 部分接 | ask/answer 一次性 consume 已接；`AskUserQuestionItem` 六字段（detail/header/options/multiSelect/intent）、`askTimed` 计时、`REPLY_QUEUED` 状态、waterfall 脱敏扩展点未接；`tool-ask-user` 未实现 | 与 approval 同批补（共用一次性 consume 语义） |
| voice-input | `packages/experimental/speech-to-text*/src/index.ts` | `core/src/voice.cj` | 部分接 | 只有转写 marker；ASR 通道、音频流、语言检测、纠错 waterfall 未接 | 排后期 |
| web | `packages/web/{web,web-fetch-http,tool-web,web-search-*}/src/index.ts` | `core/src/web.cj` | 部分接 | **本仓无真 HTTP 客户端**（`sse.cj` 的 `Client` 只被 SSE 用，未抽象成 fetch 面）；上游 fetch/response/SSE/timeout 与凭证注入未接；`tool-web`、`web-search-*` 三个搜索 provider 未接 | 把 `sse.cj` 的 stdx Client 抽成 `WebFetch`，再落 `tool-web` |
| web-client | `packages/client/web/src/index.ts`、`ui-*` 一族 60+ 包 | `apps/desktop/`（Electron 壳 + Vue runtime 渲染层 + 49 个 IPC key） | 已接 | 上游 Web Client 是浏览器侧 Cordis 应用（Client Modules + API Gateway + Slots + Conversation 四底座），本仓是壳层复刻非架构复刻（矩阵已判） | 保持壳层；架构面靠 slots / client-modules / 插件管理器逐块补 |
| web-server | `packages/host/webserver/src/index.ts`、`packages/api/gateway/src/index.ts` | `core/src/wsrv.cj` | 部分接 | 本仓宿主仍是 stdio NDJSON JSON-RPC；上游多传输/多客户端（HTTP/WebSocket + Origin/TLS 控制）未做；C01/C03 已核这部分必须保留 | 若要远程访问，单独立项（含认证与 Origin 控制） |
| webhook | `packages/webhook/webhook/src/index.ts`、`webhook-github/src/index.ts` | `core/src/webhook.cj` | 部分接 | 按 kind 计数已接；`VerifiedWebhookDelivery` freeze、`WebhookRule.run(delivery,signal)` 真回调、GitHub adapter route 注册与 `202` 立即应答、`WebhookSessionRequest` 必填字段未接 | 排后期 |
| workflow | `packages/workflow/{workflow,workflow-ptc,tool-workflow,tool-ralph}/src/index.ts` | `core/src/workflow.cj` | 部分接 | 只有步骤状态 marker；多步依赖图、重试策略、`@Remote workflow/run` 未接 | 排后期 |
| workspace | `packages/workspace/workspace/src/index.ts`、`packages/api/workspace-{controller,files}/src/index.ts` | `core/src/wspace.cj`、`workspace.cj` `SessionWorkspace` + Host `workspace/{get,set-directory}` | 部分接 | 会话级工作区目录已接（`set-directory` 有存在性校验 + 在途资源拒改 + flush）；上游 `WorkspaceId` 是 Branded uuid + `realpathNormalize` 唯一 canon，本切片用 `String` 由调用方保证唯一；`archiveSession`/`pinSession` 的 `sessionPersistence` 强制依赖未接；`SessionCatalog` 只有 create/select/list，**无重命名/删除/归档**（上游是否有待核） | 补 catalog 的 rename/delete（先核上游契约）；把 `WorkspaceId` 收成 branded + canonicalize |
| README | 子系统目录索引页（`docs/subsystems/README.md`） | — | 上游不存在 | 不是一条能力；2026-10-03 已从分母剔除（63 + 1） | 不动作 |

**本表机械复算**：已接 **7** / 部分接 **56** / 未接 **0** / 上游不存在 **1**（README 行）。矩阵原为 ✔ 10 / ◐ 53 / ☐ 0——差值全在门槛，不在事实。

---

## 4. 文档里没记的缺口（本次审计的主要增量）

以下 6 条是逐行读代码才发现的，**能力矩阵与 `p0-status` 的备注里都没有**。按严重度排序。

### 4.1 【严重】Host 的 `task/start` 根本不发系统提示

- 证据：`apps/host/src/main.cj` 全文检索 `SystemPromptBuilder` / `system/message` / `sysprompt` / `you are` / `系统提示` → **0 命中**。
- 真实起轮路径（`main.cj:1374-1408`）只做一件事：`modelRequestJson(model, shared.snapshotEvents().toArray(), tools: [TodoTool(shared, false).spec()], ...)`。`modelRequestJson`（`core/src/model_request.cj:7-78`）**只从会话日志事件重建 messages**，自己不注入 system。
- 后果：桌面端每次真实提问，模型收到的 `messages` 里**没有 system 消息**（除非会话日志里恰好有一条 `system/message` 事件，而桌面 IPC 没有这条通道、`session/submit` 也不被渲染层调用）。身份、工具使用约定、目标注入、权限说明全部缺失。
- 反证「这不是我漏看」：`SystemPromptBuilder` 的全部调用点只有 `apps/cli/src/main.cj:219`（`seed` 自测种子的 system 行）、`:666`、`:989`、`:994`（`goal` 自测的两条对照），以及 `core/src/sysprompt_test.cj`。**没有一处是产品起轮**。
- 而矩阵的 system-prompt 行备注写的是「Builder、自测及观测切片不能判整模块完成」——它猜到了 Builder 是切片，但**没记录「Host 一次都没接」这个事实**。
- 复刻步骤：在 `task/start` 取到 `baseUrl` 之后、构造 `reqBody` 之前，用当前 registry 的 spec 列表 + `goalProjectionJson` 的 phase/rounds/elapsed 调 `SystemPromptBuilder(...).build(goal:, rounds:, elapsed:)`，并把它 **append 成一条 `system/message`**（而不是只塞进请求体——贴上游「prompt 是日志事实」的做法，重启后可追问）。同时把 `SystemPromptBuilder` 从 30 行扩成多 section 装配（persona / 环境 / 工具 / 权限 / plan / goal）。
- 验收：真实模型回合后 `session.log` 里有 `system/message`；冷进程回放的请求体与热进程一致；`RequestTraceProvider` 记下的 `prompts[0].content` 就是那条 system（`core/src/model_tool_runtime_test.cj:150` 已有同形断言可搬）。

### 4.2 【严重】真实模型能调用的工具只有 `todo_write` 一个；人能调 `read`/`write`，模型不能

- `apps/host/src/main.cj:1388`：`ModelAgentRunner().start(real, continuation, model, tk, shared, turnSink, false, attach: turnAtt, supportsImages: imageCapability)`——**没有传 `toolRuntime`**。
- 于是走 `core/src/model_agent.cj:14` 的默认值 `ModelToolRuntime(log, allowParallel)`，即 `core/src/model_tool_runtime.cj:11-28` 的 `files: Bool = false` 分支 → **只注册 `TodoTool`**。
- 首个请求体（`main.cj:1383`）同样只放 `tools: [TodoTool(shared, false).spec()]`；续跑请求用 `executor.specs()`，默认 runtime 下也只有 `todo_write`。
- `read` / `write` 在 `ToolRuntime.pipeline`（`core/src/agent.cj:213-221`）里**实现是有的**，但注册它们的那行（`model_tool_runtime.cj:18-21`）被 `if (files)` 包着，而 `files: true` **只在 `core/src/model_tool_runtime_test.cj` 的 5 处出现**——产品路径一次都没有。
- 更割裂的是：桌面的 `toolsList` / `toolCall` 走 Host 的 `extension/list` / `extension/call`（`main.cj:1004-1050`），那两个用的是 `extReg`，里面**注册了 `read` 和 `write`**（`main.cj:653-656`）。所以**用户在界面上能手动调 read/write，模型却不能**——两个工具面不一致，而且这正是 `apps/desktop/test/real-provider-tools.test.mjs` 只敢验收 `todo_write` 的原因（第 35 行的提示词专门要求「务必实际调用一次 todo_write」）。
- 复刻步骤：把 `task/start` 里的 `ModelAgentRunner().start(...)` 显式传 `toolRuntime: ModelToolRuntime(shared, allowParallel, files: true, workingDirectory: SessionWorkspace(shared).effectiveDirectory())`，并把首个请求的 `tools:` 换成 `runtime.specs()`。`edit` / `glob` / `grep` 先在 `ToolRuntime.pipeline` 落实现再进 specs。
- 验收（必须真实模型）：照 `real-provider-tools.test.mjs` 的形态加一条「模型调用 read 读一个真文件、据内容续答」与一条「模型调用 write 落盘、重启后文件在」；再加一条反证——把 `files: true` 改回 false，这两条必须转红。

### 4.3 【严重】会话日志导出完全未接，且上游契约正文读不到

- 上游（冻结树可证）：`packages/session-query/session-log-export/src/{index,archive,routes}.ts`、`src/client/{controller,Dialog,HeaderAction,index,locales}.ts`、`tests/` 下 9 个 spec（`archive.host` / `route.host` / `command.host` / `controller.client` / `dialog.client` / `header-action.client` / `loader-composition.host` / `client-apply.client`）。
- 本仓：`.cj` 全文搜 `export` → 只有 `core/src/otel_test.cj:7` 一句注释；Host 73 个方法、桌面 52 个 IPC key 里都没有导出面。`SessionQuery`（`core/src/sq.cj`）只有 `byType` / `byKeyword` / `countAll`。
- **待核**：`archive.ts` / `routes.ts` / `controller.ts` 的正文本次读不到（本机 DSH 安装路径不可访问、raw.githubusercontent.com TLS 失败、上游 zip 无有效中央目录），所以**导出格式（zip？jsonl？markdown？目录结构？文件名规则？）一律不许猜**。`docs/evidence/plugin-manager-backend-gap-2026-10-05.md` 第 17-19 行已如实记录同样的取证失败。
- 复刻步骤：先解锁上游正文（找一份能用的网络出口或本地安装副本），再定 `session/export` 的 Host 方法与产物契约；在拿到正文之前，只允许做「与格式无关」的部分——把 `SessionQuery` 扩成带时间窗/分页/按 surface 过滤，并加 `session/query` 有限方法。
- 验收：导出一份含附件的会话 → 冷进程导入 → 投影逐条一致；导出文件不含模型凭据（照 `real-provider-tools.test.mjs:57` 的断言形态）。

### 4.4 【高】持续目标的自动驱动引擎写好了，但一个产品入口都没接

- `core/src/goal_runner.cj` 的 `GoalRunner.run(...)` 把 `GoalDriver` 接进真实 `ModelAgentLoop`，注释里自称「这正是基线点名的缺口……落到执行」；`core/src/goal_runner_test.cj`、`goal_scheduler_test.cj`、`goal_contract_test.cj` 都在。
- 但 `apps/host/src/main.cj` 检索 `GoalRunner` / `GoalDriver` / `GoalScheduler` → **只在 `goal/describe` 与 `isGoalControlMethod` 两处出现，且都是控制面**（`main.cj:269`、`:781`）；**没有 `goal/run`、没有自动起下一轮的任何路径**。
- `apps/cli/src/main.cj:920-996` 的 `goal` 模式是断言自测（`expect("goal 驱动连续跑到有证据收口", ...)`），不是产品入口。矩阵 2026-10-05 增量自己也记了「现有 `dsh goal` 为断言自测，不等同可操作产品入口」——但没记「Host 也没接」。
- 另外 `core/src/goal_control.cj:5` 的注释明说「完成不在此列，界面不能把自报结论当成完成证据」，所以 `goal/complete` / `goal/block` 只能由 `GoalRunner` 的 `evidence` 回调走——**而 evidence 回调目前只有测试在喂**。也就是说：产品里没有任何东西能让一个目标从 `active` 变成 `complete`。
- 复刻步骤：Host 加 `goal/run`（入参只有 maxRounds / maxElapsed / noProgressLimit，证据判定器由宿主注入：本轮 `successfulToolCalls > 0 && !interrupted && !cancelled` 且无 over-budget），跑在独立线程、受 `TurnToken` 与 `goal/pause` 的轮次边界重读约束；桌面加 `goalRun` / `goalPoll` 两个 IPC key。
- 验收：真实模型 + 真实文件改动，目标在 2 轮内被 evidence 收口落 `goal/round` 两条；中途 `goal/pause` 当前轮跑完但不启下一轮；撞轮数上限落 `goal-round-limit` 阻塞且不空转。

### 4.5 【高】模型路由健壮性三层（熔断 / 重试 / 尝试账本）在 core 里写好了，产品路径一个都没用

- core 有：`core/src/route_health.cj`（三档作用域熔断 upstream / route-set / channel，墙钟 epoch 持久化 + 最大时间戳下界）、`core/src/attempt_log.cj`（先发标记落 `usage-ledger.log`，fail-closed：标记写不下去就不发请求）、`core/src/transport_failure.cj`（结构化失败 + `Retry-After` 白名单头解析 + 正文脱敏摘要）。
- `apps/host/src/main.cj` 与 `apps/cli/src/main.cj` 检索 `RouteHealth` / `AttemptLog` / `TransportFailure` → **两边都 0 命中**。
- `RealSseProvider` 的生产构造器（`core/src/sse.cj:67-78`）是**单发 POST**：失败即 `throw Exception(f.message())`，把 `SseOpenResult` 里已经结构好的 `reachedUpstream` / `status` / `retryAfter` 全丢掉；Host 在 `main.cj:1390-1405` 只能回一个 `provider-init-failed:<message>`。
- 上游对应物是 `packages/llm/llm-retry/src/index.ts`（冻结树可证存在）。
- 复刻步骤：Host 起轮前查 `RouteHealth`（命中冷却期直接 `-32016 route-cooling` 回给界面，不烧用户额度）；发请求前 `markDispatched`；失败后按 `failureOf(...)` 的 kind + `reachedUpstream` + `retryAfter` 决定重试/冷却，并把结果写回 `RouteHealth`。
- 验收：夹具回 429 + `Retry-After: 60` → 第二次请求被拒且日志有冷却记录，不真发第二次；反证：把 `markDispatched` 挪到发送之后，重放闸用例必须转红（`attempt_log_test.cj:23` 已有同形断言）。

### 4.6 【高】「一切皆插件」在后端是 0：没有插件管理器、没有插件包、没有装配

- `core/src` 搜 `plugin|Plugin` → 2 命中，都在 `boot_actions_test.cj`（给 `BootSequence` 注册了一个名叫 `"plugins"` 的 stage）。**没有 PluginManager、没有 manifest 解析、没有依赖激活、没有安装态、没有 HMR。**
- 上游（冻结树可证）是一整套：`packages/boot/plugin-manager/src/{index,build-approval,failure,github-connection,install-failure,install-spec,operations,patch,registry,run-tree,tools,types}.ts` + 11 个测试；`packages/host/plugin-inventory/src/index.ts`；`packages/extensions/{tool-cordis,ui-cordis,cordis-host-runner,cordis-client-runner}/src/index.ts`；`packages/llm/plugin-package-inventory-deepseek/src/index.ts`；`packages/preset/{agent-preset,agent-preset-registry,persona}/src/index.ts`；`snapshots/session/plugin-manager{,-mcp}/` 两组 cordis 快照。
- 本仓桌面侧的插件管理器是**夹具页面**：`apps/desktop/test-support/plugin-manager-smoke.cjs` 自己造 `managerFixture.snapshot`，产品入口断言的是 `unconnected: ...textContent.includes('尚未接入')` 与 `disabled: ...find(b=>b.textContent==='添加插件').disabled`——**即页面自己承认没接**。另一位成员已把这条写进 `docs/evidence/plugin-manager-backend-gap-2026-10-05.md` 与 `plugin-lifetime-architecture-2026-10-05.md`，本审计只做后端侧的正面确认：**后端也是 0**。
- 上游 `packages/boot/plugin-manager/src/*` 的正文本次读不到 → **manifest 字段、安装态目录、依赖激活算法一律待核，不许先设计再对账**。
- 复刻步骤（顺序不能反）：① 先解锁上游 `plugin-manager` 与 `plugin-inventory` 正文；② 在 core 定「本地插件包」最小 manifest（name / version / entry / contributes）与安装目录；③ 落 `PluginRegistry`（安装 / 启用 / 停用 / 卸载，全部落 log-only 事件，与其它 registry 同一套纪律）；④ 让 `ToolRegistry` 从插件取 spec（工具即插件）；⑤ `ModelToolRuntime` 的 specs 从插件表出（模型面即插件）；⑥ Host 加 `plugin/{list,install,enable,disable,uninstall}` 有限方法；⑦ 桌面把夹具 adapter 换成真 adapter。
- 验收：写一个本地 `.cj`-无关的最小插件包（一个 CJS 工具 + 一份 manifest）→ `plugin/install` → 它声明的工具出现在 `extension/list` 且**能被真实模型调用** → 卸载后从列表消失且不能再调。

### 4.7 【中】npm CLI 没有真实模型产品入口

- 15 个子命令里 13 个是断言自测；`tools` / `call` 是产品面但**只到工具级，不起模型轮**；`realstream` 是对本机夹具的自测（断言正文 `"first"`）。
- 上游有 `packages/bundle/headless/src/index.ts`、`packages/boot/cmdline/src/index.ts`、`packages/bundle/{base,sdk-app,sdk-minimal,acp-app,web-app}` 一整排交付面包。
- 后果：`npm i -g @dsh/cli` 装完之后**没有办法就一个 prompt 跑一轮真实模型**，与「安装即用的完整产品」直接冲突。
- 复刻步骤：加 `sacode run "<prompt>"`（读 `ModelSettings` / `ProviderRegistry` 默认档 → `RealSseProvider` → `ModelAgentLoop` → 正文走 stdout、诊断走 stderr，退出码按失败族分开）。可在 CLI 内复用 Host 那段起轮逻辑，或让 CLI spawn Host 走 NDJSON（后者与桌面同源，推荐）。
- 验收：剥掉仓颉 SDK PATH 的安装态，`echo "你好" \| sacode run` 出真实模型正文且 rc=0；无凭据时 rc 明确且不演假成功。

---

## 5. 按用户四条目标排序的下一步建议

用户四条目标（`docs/product/PRD.md`）：① 复刻前端页面、去账号与 dsh 命名改 SaCode；② 所有功能接仓颉后端、后端不完善的用仓颉补起来；③ 自动化测试（真实模型 `step-5-preview` @ `https://api.stepfun.com/step_plan/v1`）；④ 安装即用的完整产品，且必须「一切皆插件」。

**优先级 1 — 先把「真实模型这一轮」补到能用的最低集（对应目标 ②③④，也是其它一切的前置）**
1. Host `task/start` 注入系统提示（4.1）——没有它，模型不知道自己是 SaCode、不知道有哪些工具、不知道目标。
2. `task/start` 显式传 `files: true` 的 `ModelToolRuntime`，让 `read` / `write` 进模型面（4.2）——没有它，产品只能记待办，不能动文件。
3. 在 `ToolRuntime.pipeline` 落 `edit` / `glob` / `grep`（上游 `tool-str-replace-editor` + `tool-fs-search`），并各自配 JSON Schema 后进 specs。
4. 每加一个工具，照 `apps/desktop/test/real-provider-tools.test.mjs` 的形态补一条**真实模型**用例（模型决定调用 → 仓颉执行 → 结果续答 → 冷进程回放），并配一条「把注册改回去就转红」的反证。

**优先级 2 — bash/shell 工具（对应目标 ④「安装即用」）**
没有 shell 工具，产品无法跑测试、无法构建、无法做任何真实副作用，目标 ④ 不成立。复用 `extproc.cj` 的字节扫描与 `TurnToken` 取消，落 `tool-bash`（Windows 上先 `pwsh` 或 `cmd`，照上游 `tool-pwsh` 的切法），输出接 output ring + `spill`（上游 `packages/util/output-retention`、`packages/spill/*`）。

**优先级 3 — 插件化（对应用户明确的强制要求「一切皆插件」，也是最容易被薄切片蒙混过关的一条）**
按 4.6 的七步走，**顺序不能反**：先拿上游正文，再定 manifest，再落 registry，再让 `ToolRegistry` / `ModelToolRuntime` 从插件取 spec。判定「插件化成立」的唯一标准是：**一个本地插件包声明的工具能出现在 `extension/list` 并被真实模型调用**；工具回调数量、`extjs` 用例条数、桌面夹具页的按钮样式都不算。

**优先级 4 — 持续目标自动驱动（对应目标 ②，core 已写好一半）**
按 4.4 接 Host `goal/run` 与桌面 `goalRun` / `goalPoll`，并补 `tool-goal`（让模型能自己建/改目标）。这是本仓**投入产出比最高**的一块：`goal_scheduler.cj` / `goal_runner.cj` / `goal_control.cj` 三件套加测试都已经在库里，差的只是接线。

**优先级 5 — 健壮性与可观测（对应目标 ③④）**
按 4.5 把 `RouteHealth` / `AttemptLog` / `TransportFailure` 接进起轮路径；按 4.1 把 `RequestTraceProvider` 接进 Host/CLI 产品起轮（现在只有核心自测用），这样「模型到底看到了什么」在产品里可追问。

**优先级 6 — 会话日志导出（对应用户四条主线之一，但被上游取证卡住）**
先解锁 `packages/session-query/session-log-export` 正文；解锁前只做格式无关的 `session/query` 扩展（时间窗 / 分页 / surface 过滤）。**在拿到正文前，任何「导出格式」的设计都是猜，不要写进代码。**

**优先级 7 — 外围 M8 子系统（browser-use / computer-use / ssh / lsp / office-to-pdf / voice / web-server / webhook / workflow / schedule / mcp）**
这些在矩阵里全是 ◐ 且都只有 marker。建议明确记为「裁剪/远期」，不要每轮都从 ◐ 推一点点——`bu.cj` / `cu.cj` / `opdf.cj` / `ssh.cj` / `voice.cj` 这五个体积都在 30 行上下、形态完全一样（log-only marker + 白名单 + 回放），继续推它们对用户四条目标没有边际价值。

---

## 6. 待核清单（因读不到上游源码，只能标「待核」的结论）

| # | 待核项 | 为什么待核 | 解锁动作 |
| --- | --- | --- | --- |
| 1 | `session-log-export` 的导出格式、产物结构、文件名规则、Dialog/HeaderAction 的交互契约 | 上游 `packages/session-query/session-log-export/src/*.ts` 正文未下载；本机 DSH 安装路径不可访问；`raw.githubusercontent.com` TLS/连接重置；现有 upstream.zip 无有效 ZIP 中央目录 | 找可用网络出口，或取一份官方安装/发行副本；只读这一处 |
| 2 | `packages/boot/plugin-manager` 的 manifest 字段、安装态目录、依赖激活算法、build-approval 流程 | 同上，正文未下载 | 同上 |
| 3 | `packages/host/plugin-inventory` 与 `packages/extensions/tool-cordis` 的 Host 侧协议（插件清单怎么过 IPC） | 同上 | 同上 |
| 4 | 上游 `session-query` 家族是否有会话重命名 / 删除 / 归档（本仓 `SessionCatalog` 只有 create/select/list） | 只从冻结树看到 4 个包名，未读正文 | 读 `packages/session-query/session-query/src/index.ts` |
| 5 | 上游 `system-prompt` 的 section 清单与顺序（ persona / 环境 / 工具 / 权限 / plan / goal 到底有哪几段、什么次序） | 矩阵登记了「已直读 en/zh」，但本审计未重读原文，不敢据 30 行仓颉实现反推段落 | 重读 `docs/subsystems/system-prompt.md`（矩阵账在 `upstream-module-reads-2026-10-04.md`） |
| 6 | 上游 `llm-retry` 的重试策略细节（退避曲线、哪些 kind 可重试、`reachedUpstream` 白名单） | 只确认包存在，未读正文 | 读 `packages/llm/llm-retry/src/index.ts` |
| 7 | `snapshots/session/plugin-manager{,-mcp}/` 里的 `cordis.yml` / `system-prompt.expected.md` / `tool-schemas.expected.json` | 冻结树可见但内容未读；这是「插件装配后系统提示与工具 schema 到底长什么样」的唯一现成参照 | 下载这三个快照文件 |

---

## 7. 一句话结论

**分母 63 个上游子系统里，本仓没有一个是空白（☐ = 0），但真正「接通」的只有 7 个；真正卡住用户四条目标的不是那 56 个 ◐ 的平均厚度，而是四件具体的事：真实模型这一轮既没有系统提示、也只有一个 `todo_write` 工具可用（4.1 / 4.2），后端插件化是 0（4.6），以及 core 里已经写好的目标自动驱动、路由熔断、尝试账本三层没有一个接进产品路径（4.4 / 4.5）。**
