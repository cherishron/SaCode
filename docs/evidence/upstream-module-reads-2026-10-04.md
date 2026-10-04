# 上游 63 模块逐篇直读证据（2026-10-04）

按 `official-docs-evidence-reconciliation` 技能规程执行。冻结快照：`deepseek-ai/deepseek-harness` @ `639ed015397290b3745d163aafe02ffee4aa3f84`（2026-09-29T09:21:31Z，默认分支 `master`，SPDX `MIT`）。本页只记证据与契约校正，不复刻实现。

## 0. 入口身份确证

- 仓库 `deepseek-ai/deepseek-harness`：`user-provided`（AGENTS.md 与 `dsh-upstream-freeze.md` 记载，非按域名推断）。
- `git ls-remote https://github.com/deepseek-ai/deepseek-harness.git HEAD` → `5badb150…`（2026-10-04 实测，git 通道通）。
- `api.github.com/repos/deepseek-ai/deepseek-harness/contents/docs/subsystems?ref=639ed01…` → HTTP 200（2026-10-04 复核，`X-RateLimit-Remaining: 56`）。
- 官方文档站 `https://deepseek-harness.github.io/deepseek-harness/` → HTTP 200（2026-10-04 实测）。
- 历史反例（技能 §0）：由文档站域名推出仓库 `deepseek-harness/deepseek-harness` + 分支 `main` → 双 404。本次身份来源仍是 `user-provided`，不据此推断否定性结论。

## 1. 覆盖分母

- 目录列表 192 条目 = 64 `.md` + 64 `.zh.md` + 64 `.i18n.yaml`（`api.github.com` 一次返回，无分页）。
- 64 个 `.md` 含 1 个 `README.md`（子系统目录索引页，非能力），故真分母 = **63 模块 + 1 README**。
- 完整性证明（技能 §1 三条之一）：条目数 192 与矩阵独立记载吻合 + 末项 `workspace` 接近字母序终点 + 单次返回无分页截断。`completeness: proven`。
- `cordis` 与 `gateway` 在两个 ref 的 subsystems 目录里都不存在（矩阵 M0 裁决已闭合）。
- 冻结与当日 master 漂移：`invariants` 只在冻结快照、master 已无；master 新增 `claude-code-mods`。本批按 S0 冻结口径，不加 `claude-code-mods` 行。

## 2. 抓取结果三分

| 通道 | 形态 | 结论 |
| --- | --- | --- |
| `raw.githubusercontent.com` | HTTP 200，正文完整 | 主取数通道（每篇 9-74KB） |
| `api.github.com` contents | HTTP 200，限速 60/h | 仅用于目录列表复核，不逐文件取数（126 篇超限速） |
| `git clone --filter=blob:none` + on-demand fetch | fetch-pack 超时（300s） | 不可用，改用 raw |
| `git archive FETCH_HEAD` | 触发 promisor on-demand fetch 超时 | 不可用 |
| 文档站 `deepseek-harness.github.io` | HTTP 200 | 抽样复核通道（备用） |

## 3. 已直读 14 模块（A 档：直接证据）

本仓「已复刻」判定为 ✔/◐ 的 14 个相关模块，逐篇直读 en+zh 原文。契约校正如下（仅记与矩阵备注有出入或需补充的；完全一致的不再罗列）。

### approval（✔，校正：本仓是简化版）

- 上游 `ApprovalOutcome = 'allowed-once' | 'rejected' | 'cancelled' | 'unavailable'`（四档），本仓两档（`allowed-once`/`denied`）——本仓把 `rejected`/`cancelled`/`unavailable` 都归到 `denied`。
- 上游 `ApprovalPolicy = 'ask' | 'never'`（按会话策略），本仓没有此概念。
- 上游 `ctx.approval.request(req)` **要求发起请求的会话处于一个尚未结束的轮次内**（"requires the requesting session to be inside an open turn"），本仓审批工单可在任意时刻 ask/answer，不要求 turn 在途。**契约差异**。
- 上游 `approval/request` 是 waterfall（应答者链，`next()` 委托），本仓是单点 ask→answer。
- 上游 `approval/policy` 事件（生效策略变化落日志），本仓没有。
- 一致点：`approval/asked` + `approval/decided` 审计事件对、一次性消费（`allowed-once` 仅供所询问的那一个操作）、审计事件不进模型 transcript（`isSurfaceEvent` 不含 approval）。

### conversation（✔，校正：命名占用，架构层不同）

- 上游 conversation 是 **React-based target-neutral assembly**：`SessionEventLikeEntry` window + `ProjectionDefinition`（match/start/update）+ `Context` + `Location` + `GroupUpdate` 协议。
- 上游「`assistant/live-chunk` 是 Client-only transient 事件；持久 `assistant/message` 与 `assistant/attempt` 嵌入完整紧凑 stream 供历史回放」——本仓 `assistant/message` 是落盘的整段文本，**不嵌入紧凑 stream**。
- 本仓用 `BubbleProvider + BubbleList`（`groupStrategy: consecutive`）渲染，是 Vue 视图，**非上游的 Definition/Context/Location assembly 层**。
- 矩阵备注「落盘正文出自假 provider、tool/call/result 仍不落盘」仍准；但应明确：本仓 conversation 是**消息列表视图**，上游 conversation 是**事件关联与 target snapshot 组装层**，命名占用但架构层不同。

### core（✔，校正：主动裁剪到 5 类，缺 agent 抽象）

- 上游 `core` 子系统含 6 包：`session`/`system-prompt`/`tools`/`agent`/`agent-loop`/`agent-presets`（`agentDefaultModel`/`agentPresets`）。
- 上游 `SessionEvent` 13 类变体：`turn/start`/`turn/end`/`step/start`/`step/end`/`user/message`/`system/message`/`assistant/message`/`assistant/attempt`/`tool/call`/`tool/result`/`request/header`/`request/context`/`session/end-seed`。本仓主动裁剪到 5 类进模型历史（不变量 7）+ `turn/cancelled`。
- 上游有 `agent/*` 事件族（created/disposed/error/inbox/pre-step/request/turn-stopping/status）、`agent-loop/*`、`agent-preset/*`。本仓没有 `Agent` 抽象，也没有这些事件。
- 上游取消：`AgentCancelCause` + `AbortSignal.reason` + `turn/end { kind: 'aborted', reason: TurnEndCancelCause }`。本仓是 `turn/cancelled` 终态。**事件名与终态结构都不同**。
- 上游 ID 品牌化（`ToolCallId`/`SessionId` 用 `brandString<T>()`），本仓用整数 seq。

### extensions（✔，校正：命名占用，上游是 cordis 动态包）

- 上游 `extensions` 是 `cordis/*` 事件 + `ctx.cordisInspect`/`ctx.dynamicCordisRunner`/`ctx.inspector`，**动态 cordis 包加载机制**（`@Remote('runHostHalf')`、`resolveRequestRun`）。
- 本仓 `extensions` 是 `ToolRegistry` + `extjs/` NDJSON 宿主 + `extproc.cj` 子进程驱动。**两者是不同概念**：上游是同进程动态包加载，本仓是外部脚本宿主。
- 本仓的「外部 JS 扩展」语义可能对应上游的 `subprocess` + 自造扩展，**不是上游 `extensions` 模块的复刻**。矩阵备注应明确这是命名占用。

### filesystem（◐，校正：契约一致点确认）

- 上游 `FileSystem` 抽象 seam：`resolve`/`processPath`/`stat`/`readText`/`streamText`/`readBytes`/`listDir`/`writeText`/`editText`/`watch`。
- 上游 `fs/*` 事件（`fs/write-intent`/`fs/edit-intent`/`fs/observed`）是 **single-slot decision waterfall**，本仓是 `fs-stale-version`/`fs-not-observed` 阶段码。
- 上游 `Observed-file state` 是 `WeakMap<owner, Map<targetKey, FsObservation>>` 进程内，本仓也是进程内 HashMap——**一致**。
- 上游「`read`/`write`/`edit` 不带 `timeoutMs`，提供方约定也不设截止时间」，本仓一致。
- 上游 `FsErrorCode` 稳定错误码字符串 + `HarnessError`，本仓 `fs-stale-version`/`fs-not-observed`/`not-found`/`torn-write` 阶段码——**契约形态不同但失败归一意图一致**。
- 缺口（矩阵已记）：`edit`/`glob`/`grep`/`listDir`/`streamText`/`watch`。

### llm-streaming（◐，校正：契约差异大但缺口已记）

- 上游 `StreamChunk` 是判别联合：`text-delta`/`reasoning-delta`/`tool-call-delta`/`block-end`/`usage`/`finish`。本仓是 `stream/chunk` 文本帧。
- 上游 `LlmFailure`（两条错误路径：throw 或 `finish {kind:'error'|'aborted'}`），本仓没有。
- 上游 `TokenUsage`：`inputTokens`/`cacheReadTokens`/`cacheWriteTokens`/`totalTokens`/`reasoningTokens`（互不重叠）。本仓只有累计 used + budget。
- 上游 `BlockAssembler`/`AssistantStreamAccumulator`/`expandAssistantStream()`（严格校验 record key/成员数/index/时间戳/无损 JSON）。本仓没有。
- 上游适配器约定：「`usage` 在 `finish` 之前，`finish` 之后不再有分片」「工具调用 `arguments` 全程保持原始 JSON 字符串」「每个提供方 HTTP 请求都携带应用归属头」。本仓假 provider 不涉及。
- 缺口（矩阵已记）：真模型 HTTPS+SSE 待用户凭证。

### persistence（✔，校正：契约高度一致）

- 上游 `SessionPersistence` 抽象 seam + `SessionHandle`（读写同一种句柄类型）+ flush 检查点 + 崩溃恢复保留中断轮次。
- 上游「`append` 只在实例内可见，`flush` 才跨进程持久」——本仓一致。
- 上游「崩溃恢复不截断只丢撕裂尾：持久化不修复活跃轮次，只丢弃从未完成的 append 的不完整碎片」——本仓 `尾帧截断` 一致。
- 上游 `SessionAlreadyOwnedError`（写句柄互斥），本仓 `-32001 already-owned`——**契约一致**。
- 上游 `SessionFormatUnsupportedError` vs `SessionPersistenceCorruptionError`（区分格式不支持与损坏），本仓 `replay-rejected` 单一码——**本仓未区分**。
- 上游 header 与 body 分离存储（`SessionHeader` 在日志旁），本仓单文件 `session.log`——**存储形态不同但事件真源一致**。

### session（✔，校正：主动裁剪到 5 类，缺 surface 类型系统）

- 上游 `SessionEventMap` 13 类事件（同 core 校正），本仓 5 类 surface + `turn/cancelled`。
- 上游 `SurfaceEventType`/`SurfaceOp`/`SurfaceIntent`/`SessionSurface`/`SurfaceFoldReplacement`/`SurfaceFoldResult`——**完整的 surface 类型系统**。本仓只有 `deriveMessages()` 纯函数 + 缓存。
- 上游 `TurnEndReasonMap`（轮次结束原因分类），本仓是 `turn/cancelled` 单一终态。
- 上游 live-session fork API（`buildForkSeed`/`inheritedEventCount`/`session/end-seed`），本仓没有。
- 一致点：seq 连续性、`deriveMessages()` 从日志派生而非单独存储、`request/header` 是日志状态而非派生历史。

### session-projection（✔，校正：契约对一条，缺多投影与持久化缓存）

- 上游 `ProjectionDefinition`/`SessionProjectionStateMap`/`SessionProjectionMap`——**多投影注册表**（每个领域贡献一个 `ProjectionDefinition`）。本仓只有单一 `deriveMessages()`。
- 上游 `apply(state, event)` 返回同引用（"A unit uninterested in an event MUST return the same state reference"）——本仓「无关事件不重算并交回同一份缓存对象」**契约一致**。
- 上游 `SessionProjectionCache`（`cachedSnapshot`/`cachedPredecessorTitle`/`hydratePrepared`）——持久化投影缓存。本仓没有。
- 上游 `viewSchema`（Zod 校验），本仓没有。
- 上游 `asOfSeq` 水位线，本仓「surface 条数 + 代次」缓存键——**水位线意图一致**。

### subprocess（✔，校正：契约一致点确认）

- 上游 `SubprocessRuntime` 抽象 seam + `SubprocessHandle` + stdio dispositions（raw pipe/inherit/collect）。
- 上游「`done` 报告 Node close 事件词汇，不携带原因分类：服务在中止时终止进程，但绝不判定原因」——本仓 `forcedExit` 如实记，**契约一致**。
- 上游「每条流的处置方式都显式给出」（LSP JSON-RPC/ACP ndjson 用 raw pipe），本仓用 `Pipe`——**一致**。
- 上游 terminal-process primitive（PTY），本仓没有（矩阵 terminal 行已记 ☐）。

### system-prompt（✔，校正：契约对一条，缺注册与 waterfall）

- 上游 `SystemPrompt` + `PromptSection`（只读同进程注册）+ `ToolProviderResult`（`schemas` + `knownNames`）。
- 上游 `system-prompt/assemble` waterfall（expert waterfall over sections/contexts/tools/variables）+ `system-prompt/change` emit。本仓没有。
- 上游「system prompt 是 surface node 0，一个 `system/message` 事件」——本仓 `SystemPromptBuilder` 从 `ToolRegistry` 读工具名与描述组装，**角色定义在前、工具清单在后**——**契约一致**。
- 缺口：`PromptSection` 注册、`assemble` waterfall、`knownNames` pre-restriction、`getContextOrder()`/`getSectionOrder()` 动态上下文。

### token-meter（✔，校正：契约对一条，缺节点定价）

- 上游 `TokenMeter` + `TokenMeasurement`（`baseline`/`surfaceDeltaTokens`/`totalTokens`/`surfaceTokens`/`nodes`）+ `TokenSurfaceNode`（`tokens`/`heuristicTokens`）。
- 上游 `measure(session, requestHeader?)` 返回 detached deeply immutable snapshot——本仓 `TokenMeter.rebuild()` 从日志重算，**detached replay snapshot 意图一致**。
- 上游 `logRevision` = next unread event seq——本仓 `rebuild()` 取日志重算，**一致**。
- 上游 route-priced request-image pricing（`ctx.llm.imageRequestPricing`），本仓没有。
- 上游 `baseline.kind === 'usage'`（最近成功调用的规范请求 envelope），本仓 `usage/over-budget`/`usage/bad-usage`/`usage/budget` 事件——**契约形态不同但「从日志重算」一致**。

### tools（✔，校正：契约一致点确认）

- 上游 `ToolDefinition`（`ToolSchema` + `output: ToolOutputDefinition` + `execute` + `projectContent?`/`finalizeContent?`/`presentCall?`/`presentResult?`）。
- 上游 `tools/*` waterfall：`tools/pre-execute`（allow/deny/ask）→ `tools/execute` → `tools/post-execute` → `tools/ptc-dispatch-log` → `tools/result` emit。本仓 `pipeline`（guard → 参数归一化 → snapshot → execute → 无损校验）——**四段管线契约一致**。
- 上游 `ToolRestriction`（per-scope 过滤，allow/deny 列表），本仓没有。
- 上游 `defineTool` DSL（`ValueSchemaSpec`/`ParameterSchemaSpec` 类型化 schema），本仓用字符串 args + 手动解析。
- 上游 `ToolExecutionToken`（symbol branded），本仓用整数 callId。
- 缺口（矩阵已记）：`projectContent`/`finalizeContent`、`ToolRestriction`、`presentCall`/`presentResult` UI 回调。

### web-client（✔，校正：壳层复刻非架构复刻）

- 上游 Web Client 是**浏览器侧 Cordis 应用**：Client Modules + API Gateway + Slots + Conversation 四底座。
- 上游 `SessionManager`/`Session`（`SessionEventLikeEntry` window）/`ClientWorkspaceModel`/`ui-session`/`ui-conversation`/`ui-slots`/`ui-renderer`（React + `useSyncExternalStore`）。
- 上游「`ui-conversation` 把持久 Session event 与 Client-only `assistant/live-chunk` 关联成稳定业务 Context」——本仓没有 `live-chunk` 概念。
- 上游「没有统一 Client `Runtime`/`HostFrame`/`events.mux`/`resync()` API」——本仓也没有（但本仓是 Electron 壳，不是 Cordis 应用）。
- **本仓 web-client 实现是 Electron 桌面壳 + Vue 渲染层 + IPC 有限面，不是上游「Web Client architecture」的复刻**。矩阵备注应明确这是壳层复刻（入口与隔离面）而非架构复刻（Cordis 插件图 + API Gateway + Slots）。

## 4. 其余 49 模块（子代理直读回传 + 抽样对账）

4 个只读子代理分组直读 A/B/C/D 四组共 49 个模块的 en+zh 原文（每篇全文读取，非摘要）。回传摘要属二手（技能 §4），本会话对每组抽 1 篇直读原文对账：

| 组 | 抽样模块 | 行/字节 | 对账结果 |
|---|---|---|---|
| A | browser-use | 68 行/5395 B | 逐条契约点一致（register 单槽拒绝重复、Session 所有权、cancel 不撤销已交付、MCP 串行 agent/created） |
| B | otel | 45 行/2939 B | 逐条契约点一致（createEventReporter count-based、createSessionLogReporter byte-bounded、通道不共享队列、仅挂载不分配 provider） |
| C | todo | 33 行/1808 B | 逐条契约点一致（TodoItem 无 id/priority/activeForm、三态 status、last-write-wins、todo/write log-only declaration-merged、invariant companion 增量校验） |
| D | webhook | 71 行/5685 B | 逐条契约点一致（三 opaque id、VerifiedWebhookDelivery freeze、fire-and-forget 无队列/重试/去重、WebhookSessionRequest 必填字段、follow-up source.kind="webhook"、GitHub adapter 验证 application/json 返回 202） |

对账结论：4 篇全部逐条对上，子代理回传准确。以下 49 模块摘要标为「二手已复核」。

### A 组（12 模块）

- **agent-team**（231 行）：TeamId=Root SessionId（brand）、TeamTaskId 单调、TeamMessageId 随机；持久 mailbox（先存 queued 再 ack）；TeamTaskSnapshot.revision 是 CAS、blockedBy 无环；interrupt(caller=Lead) 只中断 turn 不清 inbox。**本仓未实现**。
- **attachment**（361 行）：附件事件只含引用+元数据，绝不含 blob/URL/base64；AttachmentId 不透明（sha256:digest）；persist-before-event（先移到 attachments/v1 再追加事件）；每消息最多 20 图/200MiB/单图 20MiB。**本仓未实现**。
- **boot**（322 行）：PluginEntryId 从 listPlugins 获取；ChangeResult.changed 报 applied/restart-required/overridden/failed；installBundle 做连接检查、失败还原 package.json；cancelInstall 返回 cancelled/too-late/not-running。**本仓未实现**（无插件管理器/profile/HMR）。
- **browser-use**（68 行，已对账）：DSH 拥有任务循环；provider 供应浏览器操作；register 单槽拒绝第二次注册；cancel 不撤销已交付动作。**本仓未实现**。
- **client-modules**（184 行）：图是 Node/浏览器协议唯一真源；window.__DSH_BOOT__ combo-script 注入；rev 从 mtime/ctime/size 派生；GET /plugins/??a/client.js,b/client.js&rev=；启动 URL ≤3 KiB 按字节贪心切分。**本仓架构不同**（构建期折叠 vendor + CSP self，非 HMR combo 路由）。
- **client-resources**（92 行）：dsh-resource://\<type\>/… URL；一个协议一个 provider、第二次注册抛错；open 返回帧流（首帧当前态，之后每次变化）；status: none/loading/live/failed。**本仓未实现**。
- **commands**（223 行）：命令是插件注册、不创建模型消息、直接对确切 agent 执行；CommandDefinition 含 name(小写无斜杠)/handler；command/run 在 handler 前追加、command/done 在 settle 后；admission miss 不 log。**本仓未实现**。
- **compaction**（284 行）：三事件 compaction/start|summary|end 仅写日志不进 surface；surfaceOp:{op:'replace'} 在 user/message 上；锁括住整个操作；compactNow 轮间维护、无范围返回 null；ManualCompactionErrorCode: busy/cancelled/changed/summary/commit/persistence。**本仓未实现**。
- **computer-use**（56 行）：模型经 provider 观察/操作桌面；两 provider（Cua Driver MCP/native）实验性；register 单槽拒绝重复；cancel 不撤销已收到的输入。**本仓未实现**。
- **credentials**（495 行）：settings/cordis.yml 携带引用（环境变量名），值归 provider；CredentialRef=Branded（POSIX 名）；describe 暴露 configured/source/writable 不暴露值；credentials/reference-updated(ref) emit；authorization begin 一次一个 attempt（ALREADY_IN-flight 拒绝）；deepseekAccount.getPlatformSession 返回 Host-only 快照。**本仓未实现**（C01 裁剪核验：上游有官方账号绑定，本仓已排除）。
- **deliverables**（178 行）：PresentedFile 是模型经 present 工具声明的文件；deliverables/presented log-only 事件；workspace/changes 在顶层轮停止追加；summary/diff 在 Session 存活期保留，不进模型请求。**本仓未实现**。
- **feedback**（400 行）：feedback/message-put 与 message-delete 存于权威 Session 日志；MessageFeedbackVersion=Branded（CAS token）；put 用严格乐观并发（ifVersion）；只接受非空 append-origin assistant/message 作目标；feedback/committed parallel。**本仓未实现**。

### B 组（12 模块）

- **goal**（313 行）：GoalRef{id,revision} CAS；GoalPhase=active/paused/blocked/complete；GoalMessageSource kind='goal'；goal/changed 与 goal/activation-changed emit；edit/pause/resume/complete/clear 标 @Remote；completed 可被替换。**本仓未实现**。
- **invariants**（88 行）：Config{enabled?,package_allowlist?,package_blocklist?}；blocklist 优先于 allowlist；InvariantFailure=(message)=>never 抛 InvariantError(code:'INVARIANT')；每个工作区包拥有 ./invariant 配套插件；检查只能断言权威事件流。**本仓未实现**（本仓 §4 的 18 条不变量是复刻口径，非该模块运行实现）。
- **jobs**（499 行）：JobId=\<kind\>-N；JobStatus=running/stopping/completed/killed/failed；JobSpec{kind,label,owner?,outputLimitBytes?,run(job:JobHandle)}；JobHandle.append 同步；cancel 幂等；JobRegistry abstract: start/list/get/read/kill/wait/remove；JobController @Remote: list/follow/kill。**本仓未实现**（本仓 cancel/背压非此完整 job registry 抽象）。
- **lsp**（202 行）：LspOperation=goToDefinition/findReferences/goToImplementation/hover（闭合联合）；LspPosition 零基 UTF-16；LspRange 半开；LspQueryRequest 全必填；LspQueryResult 闭合联合 locations/hover；registerProvider 原子预留 id+扩展。**本仓未实现**。
- **mcp**（139 行）：MCP 服务器按 Cordis scope 配置 dsh-mcp-client 条目；客户端不发布共享 ctx.mcp；serverName scope 内唯一；McpResourceRequest method=resources/list|resources/templates/list|resources/read；不支持 prompt 模板/elicitation/task-based/subscriptions。**本仓未实现**。
- **office-to-pdf**（87 行）：ctx.officeToPdf 共享 LibreOffice 转换、有界准入、PDF 缓存；OfficeExtension: doc/docx/xls/xlsx/ppt/pptx；convert 返回完整 PDF Uint8Array+missingFonts+cacheKey；@Remote render 经 Session Workspace Files 校验。**本仓未实现**。
- **otel**（45 行，已对账）：ctx.otel 共享工厂；createEventReporter count-based、createSessionLogReporter byte-bounded；通道不共享队列/请求；仅挂载不分配 provider/transport。**本仓未实现**（C04 裁剪核验：上游有 OTel exporter，本仓默认关闭外发）。
- **permission-presets**（167 行）：PresetSpec{sandbox,approval,name?,description?}；默认 workspace-write 与 danger-full-access；registerAuto 固定 auto=danger-full-access+ask；set 先 append permission/preset 事件再写 knob；permission/preset 是 log-only 不在 model transcript。**本仓未实现**（本仓审批只有允许一次/拒绝）。
- **plan**（87 行）：plan/mode{active:boolean} log-only 全值替换；set 返回 committed/queued/cancelled/noop；exit_plan_mode 工具要求 # 开头 markdown plan 经 user-questions 呈审；plan mode 是软引导，sandbox 与 approval 独立执行限制。**本仓未实现**。
- **product-telemetry**（79 行）：ProductTelemetryRecord=OTelEventRecord；emit(record) 同步入队不确认投递；ctx.productAnalytics @Remote enabled/watchPolicy/report；导出器不自动收集 Session 数据或标识；Desktop analytics consumers 受启动时采集开关控制。**本仓未实现**（C04 裁剪核验：上游有产品遥测上报，本仓无任何上报）。
- **ptc-runtime**（232 行）：PtcRunRequest{program,bindings,cwd?,timeoutMs?,sandboxPolicy?}；PtcRunResult.logs+error（error 是字段非 rejection）；PtcRunFailure.kind=exception/timeout/abort/worker-exit/invalid-output/output-limit/protocol/sandbox-unavailable（正交）；PtcBindingNamespace.global 须匹配 [A-Za-z_][A-Za-z0-9_]*。**本仓未实现**。
- **sandbox**（221 行）：SandboxMode=read-only/workspace-write/danger-full-access；ConfinedSandboxMode 排除 danger-full-access；SandboxEnforcement=full/partial；confine(argv,policy,signal) 无后端时 reject SANDBOX_UNAVAILABLE（禁止静默 unconfined passthrough）；resolve({session?,mode?}) 显式>session 最后事件>部署默认。**本仓未实现**。

### C 组（13 模块）

- **schedule**（543 行）：ScheduleRecord 五种 kind（after/at/every/daily/weekly/cron）；title 必填（缺失/空白/超 120 字符拒绝整个 domain open）；schedule/changed emit 无载荷；四个模型工具 create/list/delete/update；ScheduleUpdateRequest.expected 完整记录 CAS；投递非原子（inbox 持久化后崩溃可能重复投递）；history limit 1-100 safe integer。**本仓未实现**。
- **scope**（60 行）：ScopeKey=object（opaque identity-compared）；Scoped\<T\> 编译期 brand；Scope{ctx,rawDispose,dispose}；ScopedLayers eager 全局层+惰性 exact-scope 层；peek(undefined) 不创建层；merge() 按插入序全局具名条目后 scoped 遮蔽。**本仓未实现**。
- **session-query**（510 行）：ctx.sessionQuery abstract seam；SessionRecord{header,live,persisted}；SessionEventSurface=current/shadowed/log-only；filter 数组 ANDed、子句内 ORed；SessionSearchCursor=Branded；17 个封闭 ErrorCode；observeSession/readSession/readSurface/traceSession 等 11 concrete+2 abstract。**本仓未实现**。
- **session-reference**（225 行）：FileReferenceCandidate{path,kind:file/directory}（仅路径补全）；SessionReferenceInput{sessionId,label?}；SessionReferenceSource kind='session-reference' form='recall'；capturedThroughSeq 是被引用 Session 原始 generation；prepare 缺模型容量用 64 KiB；7 个 ErrorCode。**本仓未实现**。
- **session-telemetry**（213 行）：SessionTelemetryRecord 两 channel（ledger 镜像 + ops）；severity=info/warn/error；sharingStatus=full/feedback-only/disabled；capture=live/on-demand；Sink.emit 非阻塞 enqueue；session-telemetry/record waterfall 是唯一脱敏扩展点；fail-closed：抛异常的监听器扣下该条记录。**本仓未实现**（C04 裁剪核验：上游有本地诊断 channel，本仓无遥测后端）。
- **session-title**（205 行）：SessionTitleProviderId=Branded；SessionTitleSource kind=fallback/provider/user；session/title log-only；SessionTitleAutomaticMode=first-prompt/all-prompts；rename 空 title 抛 InvalidError；refresh 重试 provider 或 materialize fallback；register 唯一可选 provider。**本仓未实现**（本仓桌面新建名称已保存为 session/title 但未核验上游 provider 契约）。
- **settings**（156 行）：ctx.settings Service Definition configure/prepareDocument/describe/update/replace/mutate；update 合并、replace 先重置再应用、mutate 按路径编辑保留 secret；settings/document-updated emit；ctx.settingsController 每次读 redactSecrets:true；provider refusal 分类 settings/conflict 或 settings/rejected。**本仓未实现**（本仓设置窗只接当前会话预算与持久外观）。
- **shell**（315 行）：ctx.shell abstract seam resolve(request)+execute(spec)；DSH_* 变量归 Harness；ShellRunResult.timedOut/aborted 互斥单一 first-cause；SANDBOX_UNAVAILABLE 错误码；模型可经 sandbox_permissions+justification 请求一次性严格更宽重试；ShellProcess.readOutput 增量消费；ctx.shellEnv register/collect/list。**本仓未实现**。
- **sidebar-right**（158 行，zh 缺失 404）：每 Session 一个 docking surface；ctx.sidebarRightTabs.register 返回 disposer；资源 dsh-resource://\<type\>/…；tab 身份=(kind,address)；priority 三档 extension/builtin/fallback；useResource\<P\>(address) 全局 prop none/loading/live/failed。**本仓未实现**（上游 React 组合系统，本仓 Vue runtime）。
- **skills**（353 行）：ctx.skills host+per-scope 分层；重名按 rank→provider→本地序；本地 rank project-dsh(100)…bundled(600)；skill 名 kebab-case；skills/change emit 无效化通知；dsh-tool-skill 在首个 agent/pre-step 注入 system-reminder；skill({name}) 工具校验→查摘要→isModelInvocable→重读完整定义。**本仓未实现**。
- **slots**（200 行）：SlotMap 编译期注册表；cardinality 四值 single/list/keyed/chain；scope 三值 root/session-maybe/session；root 是唯一内建声明；ctx.slots.renderSlot/inject；组件绝不收 ctx；PropsRenderSlots 含 SessionProvider。**本仓未实现**（上游 React 组合系统，本仓 Vue runtime）。
- **spill**（125 行）：ctx.spillStore 一方法抽象 saveText(input)；SaveTextSpill{suggestedName 是命名提示非路径}；SpillOwner{sessionId}；fork 继承 locator 不复制；SpillRef{locator,bytes,retrievalHint}；本地 backend 写 0700 root + sha256(sessionId) 子目录 + open('wx',0o600) 防符号链接；seam 只管存储无保留策略/检索 API。**本仓未实现**。
- **ssh**（136 行）：SSH 提供方家族实现 filesystem/subprocess/sandbox API；Config{host,node,helper,helperHash,workspace}；helperHash 不匹配拒绝；非 reconnect；connectStream 返回 paused socket；dispose 先 teardown helper 再释放 SSH master；processPathFromHostPath 不可用。**本仓未实现**。

### D 组（12 模块）

- **storage**（260 行）：StorageBackend{kv?,close()}；DomainSpec name/version/layout/compatibleVersions/invalidRecords/global/tables；写排队 per-domain chain→backend 持久→内存→domain/changed emit；open 严格序列失败整体回滚；put 携带新快照不携旧值；domain/changed 是 in-process only（跨进程推送是 recorded limitation）。**本仓未实现**。
- **subagent**（760 行）：SubagentCapabilities{agentOptions,outputSchema,depthLimit,toolFilter,persona} 启动前检查（fail loud no silent degradation）；SubagentStartRequest{prompt,parent(必填),signal}；continuable child=durable child Session+≤1 Activation；sendMessage 只允许直接父子/直接 continuable 子；interrupt fire-and-return 发 cancel(keepInbox:true)；SubagentRun.result 永不 reject（child 失败→stopReason:'error'）；SubagentStopReasonMap 可扩展联合 completed/aborted/error/max-tokens/refusal。**本仓未实现**。
- **terminal**（184 行）：TerminalWaitReason=stdin_read/inferred_idle/timeout/session_exit；TerminalSessionStatus=running/exited；TerminalBackend.spawn 返回 TerminalBackendSession；TerminalSendOperation 每 PTY 恰一个 active；授权比对确切 owning Agent；PTY 状态/raw bytes 进程本地、不进 Session 事件（用现有 tool/call/tool/result）。**本仓未实现**（本仓 Ctrl+C 走 SetConsoleCtrlHandler 不等于终端子系统）。
- **todo**（33 行，已对账）：TodoItem{content,status:pending/in_progress/completed}（无 id/priority/activeForm）；last-write-wins；todo/write log-only declaration-merged；invariant companion 一次校验后增量跟踪 turn 边界。**本仓未实现**。
- **typert**（487 行）：TypertLookupMap/TypertContextMap 可声明合并；TypertCodec strict{typeSymbol,create,decode?,encode?}|src-json；InvocationDescriptor{id,service,namespace,method,mode?,invocation,cancellation:{parameter:'signal'}}；RemoteStream\<Out,In\>；ctx.typert register/get/resolve/list/toJSONSchema；ctx.typertGateway hasLiveClient/registerRemoteEvents/invoke/stream；TypertGatewayErrorCode 闭合联合 gateway/*。**本仓未实现**。
- **user-questions**（307 行）：AskUserQuestionItem{id(稳定 caller-provided),question,detail?,header?,options?,multiSelect?,intent?}；AskUserQuestionIntent kind=plan-review（approve 命名肯定选项，非位置）；AskUserQuestionAnswerItem{id,selected,custom?}；askTimed 返回 TimedUserQuestionResult（pending=仍可答非空/拒绝/确认）；@Remote answer 返回 boolean（REPLY_QUEUED 拒绝第二次）；user-questions/request waterfall scope-filtered。**本仓未实现**。
- **voice-input**（164 行）：SpeechProviderId branded；Provider.transcribe 接受 SpeechInput+AbortSignal；Transcript 返回 text/audioSeconds/inferenceSeconds；浏览器拥有麦克风 tracks+unsent draft；Recognition 不写 Session 事件（普通 user submission 拥有最终文本）；ctx.speechController @Remote catalog/follow/configure/prepare/transcribe。**本仓未实现**。
- **web**（206 行）：ctx.web 一个服务两操作（search+fetch）；provider 注册 CAPABILITIES 非 tools；WebFetchBody{kind:html|text}（CLOSED union）；HTTP non-2xx 是 RESULT 非 error；available() 不做网络调用；选择规则在执行时解析（configured missing/unavailable/ambiguous）；fetch 拒绝私有 IPv4（SSRF 防护）。**本仓未实现**。
- **web-server**（226 行）：WebRoute kind=exact/prefix（匹配序 exact→最长 prefix→fallback）；register 重复 (kind,path) 抛错；Config{host,port}（carrier 不拥有 TLS/auth/Origin）；listen 失败 EADDRINUSE 拒绝初始化；tapIndex 逃逸 hatch；请求 throw→400 或 socket destroyed；close()+closeAllConnections()；connection/request waterfall。**本仓未实现**（本仓宿主是 stdio NDJSON，非 HTTP）。
- **webhook**（71 行，已对账）：三 opaque id；WebhookEventMap 可声明合并；VerifiedWebhookDelivery freeze 整值；dispatch fire-and-forget（无队列/重试/去重/崩溃回放）；WebhookSessionRequest 必填 workspacePath/title/prompt/agent preset/permission preset；follow-up 是普通 durable user-role message source.kind="webhook"；GitHub adapter 验证 application/json 返回 202。**本仓未实现**。
- **workflow**（278 行）：ctx.workflowEngine 一个引擎（无 named-provider registry）；WorkflowStartRequest{script,meta,args?,subagentProvider?,maxTotalAgents?,parent(必填),signal?}；WorkflowMeta{name(kebab-case),description,whenToUse?,phases?}；WorkflowResult{value,stopReason:completed/cancelled/error}；WorkflowRun.result 永不 reject；WorkflowError.fatal:true 时 parallel/pipeline 重抛；workflow/* 6 个 emit 事件携带数据快照非 live run；Durable Chat tool-workflow/run-start + run-end 配对。**本仓未实现**。
- **workspace**（659 行）：WorkspaceId=Branded（uuid 非 path）；realpathNormalize 是唯一唯一性 canon；Workspace{path(canonical),title,sessionIds(手动有序)}；create 拒绝非目录、canonical path owned 返回 unchanged；initializeDefault 固定 default-workspace 名；archiveSession 先 waterfall 询问再写（with stopActivity 先写后 parallel dispatch）；delete 只删注册/顺序/账户（不删目录/文件/Session/日志）；startup 等 sessionPersistence（强制依赖）。**本仓未实现**（本仓桌面项目目录选择已接入共享核心日志，但无 workspace registry）。

### C01-C04 裁剪核验结论

| 裁剪编号 | 上游核验结果 | 本仓保留要求 |
|---|---|---|
| C01（官方注册/登录/账号绑定） | **已核**：credentials 模块 495 行确证上游有 CredentialRef/AuthorizationFlow/DeepSeekAccount（getPlatformSession 返回 origin+token+userId）。属上游官方账号绑定体系。 | 保留第三方凭证安全存取、IPC/会话身份、远程访问认证。本仓审批凭据只用工单号（明确简化），未实现账号绑定。 |
| C02（官方订阅/支付/商业权益/云端额度） | **部分核**：token-meter 模块确证上游 route-priced request-image pricing（`ctx.llm.imageRequestPricing`），但未发现订阅/支付/商业权益字段。 | 保留 token 用量与本地预算。本仓 TokenMeter 从日志重算，不涉及云端额度校验。 |
| C03（官方账号绑定同步/云存储/云会话） | **已核**：storage（260 行）、session-query（510 行）、session-reference（225 行）确证上游有 storage backend、跨会话语料库查询、SessionReference 提及。这些是本地持久化之上的云端形态。 | 保留本地持久化、恢复、双入口一致性。本仓会话日志是唯一真源（append-only session.log），无上游 storage 后端形态。 |
| C04（官方遥测/默认官方上报） | **已核**：otel（45 行）、product-telemetry（79 行）、session-telemetry（213 行）确证上游有 OTel exporter、产品遥测上报、Session 遥测 channel。 | 保留本地诊断需求，启用和关闭均需两入口验收。本仓无任何上报，默认关闭。不等于裁剪已验收——上游 exporter、配置与账号依赖已核，本仓未实现对应可替换服务。 |

## 5. 覆盖账本

账本文件：`docs/evidence/upstream-ledger-2026-10-04.json`。63 模块 × (en + zh) = 126 entries（sidebar-right.zh.md 在冻结 commit 不存在，实际 125 entries + 1 个 404 条目）。`identity_source: user-provided`，`channel: repo-raw`，`status: 200`（sidebar-right.zh.md 为 404），`body: full`，`list_complete: true`，`secondhand: false`（所有原文经直读：主线程 14 模块 + 子代理 49 模块 Read 全文 + 4 篇抽样对账）。门禁结果：**GATE: PASS（9/9 checks）**——`node coverage_ledger.cjs --file docs/evidence/upstream-ledger-2026-10-04.json` 输出 `GATE: PASS`，九项检查（UNCLASSIFIED_FETCH/DUPLICATE_KEYS/DANGLING_REF/SECONDHAND_ONLY_CLAIM/EMPTY_BODY_AS_EVIDENCE/TRUNCATED_AS_FULL/INFERRED_IDENTITY_SUPPORTS_NEGATIVE/COVERAGE_SHORTFALL/ASSUMED_DENOMINATOR）全 PASS。

## 6. 证据类型与四档分级

- **直接证据**：本会话直读的 14 模块 en+zh 原文（§3）+ 4 篇抽样对账原文（§4 表）。可用于硬规格校正。
- **二手已复核**：子代理回传并经 4 篇抽样直读对账的 49 模块摘要（§4）。可标注复核方式使用。
- **矛盾或未覆盖**：sidebar-right.zh.md 在冻结 commit 不存在（404），zh 列对该行记为「冻结快照无中文版」。
- **未读取或未核实**：`.i18n.yaml` 文件未读（矩阵 `zh` 列通过目录列表确认存在，不逐篇读 i18n）；master 分支的 `claude-code-mods`（S0 口径不加行）。
