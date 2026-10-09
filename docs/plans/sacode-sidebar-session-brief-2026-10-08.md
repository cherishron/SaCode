# SaCode 侧边会话历史记录 开发简报（交 codex 执行）

基线：2026-10-08 工作区态，分支 `refactor/dsh-learning`，HEAD `35a69ca`。工作区存在**并发会话的未提交改动**（`git status` 有 30+ 条），逐文件精确暂存，不要 `git add -A`，不要 revert 他人改动。

所有源码引用用**符号锚点**（行号会随并发会话漂移，只当本轮定位参考）。本文中标「当轮实测」的，都已直读代码；标「待自证」的不许当成事实开工。

## 0. 权威口径（先读，不要另立命名）

| 出处 | 约束本简报的内容 |
| --- | --- |
| `docs/product/PRD.md` §3.1 左侧导航 | 顶部为搜索、新建会话；主体为可展开的项目会话树，支持**置顶、重命名、归档**及状态提示；按工作模式筛选只改对话列表，工作区始终共享；隐藏会话中的待审批事项仍有提醒 |
| PRD §4 表 F01 行 | 会话新建/切换/**命名**/归档，草稿按会话保留；项目不可访问时不假装就绪；切换后旧结果不能覆盖新会话 |
| PRD §7 表 F01 行 | 三类最低验收：正向 / 失败·越权 / 恢复·并发 |
| `docs/plans/sacode-product-interfaces-2026-10-07.md` §3 表 F01 行 | Host 现有面 `session/catalog`、`session/create`、`session/select`；**新增是 `session/archive`**（不是 delete） |
| 同文件 §2 | 新增变更请求携带 `sessionId`/适用时 `taskId`/`requestId`（幂等键）/`expectedRevision`；响应含业务身份、当前 revision、实际状态；失败原因只能取固定十值：invalid-input、revision-conflict、not-authorized、unsupported、busy、not-found、cancelled、provider-unavailable、persistence-failed、outcome-unknown；Host 映射到 JSON-RPC `error.data` 的 `reason`/`retryable`/`currentRevision` |
| 同文件 §5（“接口实施必须覆盖”段） | 版本冲突、重复 requestId、跨会话迟到、权限拒绝、取消竞态、持久失败、断连恢复、提供方不支持 —— 八项都要有用例 |
| `docs/plans/sacode-product-traceability-2026-10-07.md` F01 行 | 现有核心候选与测试候选已点名：`catalog.cj`/`session.cj`/`workspace.cj`、`renderer/app.js`、`catalog.test.mjs`/`session-management.test.mjs`/`workspace.test.mjs`；状态是「待验收，未核部分保持待核」 |
| `apps/desktop/prototype/`（`prototype.js`、`README.md` F01 行、`smoke.cjs`） | 已演示左侧搜索、新建/切换、会话树置顶/重命名/归档与恢复，README 明写「已演示（**模拟**，本机偏好）」、smoke 是 30 项断言。**它是交互参照，不是实现依据**；不许把原型里的本机显示名口径搬进核心 |

## 1. 现状（当轮实测，逐层）

### 1.1 核心 `core/src/catalog.cj`

`SessionCatalogEntry` 五字段：`id`、`title`、`durable`、`status`、`workspaceDirectory`（无时间戳、无归档/置顶态、无 revision）。

`list()` 扫描规则（安全边界已实现，改动时不要削弱）：
- 根 `session.log` 仅当 `exists` 且 `FileInfo(...).isRegular()` 且 `canonicalize(legacy).parent == base` 才作为 `current` 入列 —— 符号链接不能把扫描扩到目录外。
- `sessions/` 必须直接位于 root 且是目录；每个子目录只认 `<dir>/session.log`（存在且 isRegular 且父目录恰为该 dir）。
- 目录 ID 形如 `sessions/<name>`，`pathFor(id)` 只接受清单内的不透明 ID，客户端不能传任意路径；`replay-rejected` 的条目 `pathFor` 直接抛。

`entry(id, path)` 回放：
- `SessionLog(path).load()` 失败 → `SessionCatalogEntry(id, "", 0, "replay-rejected")`。
- 标题取 **第一条** `session/title` 事件的**原始 `event.data`**；否则取第一条非空 `user/message`。
- `status` = `isTruncatedTail()` ? `truncated-tail` : `ready`。
- `workspaceDirectory` = `SessionWorkspace(log).directory()`（与打开会话同一投影，注释明确「不能因标题已找到而漏掉后续目录变更」）。

其余：`selectedId()` 从根索引日志最后一条 `workspace/session-selected` 取 ID，无则 `current`；`select(index, id)` 先 `pathFor(id)` 校验再 `append`，调用方须自行 flush 才算持久；`create(title)` 校验标题字符/长度（≤512）、`File.createTemp` 取令牌 + 独占 `Directory.create` 占位（最多 1024 次尝试）、写 `session/title` 后 `flush()` 失败即抛 `session-create-flush-failed`。

### 1.2 核心 `core/src/title.cj`（重命名的真源在这）

`SessionTitleService`：事件 data 编码 `<sourceKind>::<title>`（首个 `::` 前是来源，之后整段是标题）。
- `get()` 取 **最后一条** `session/title` 并**剥前缀**。
- `rename(title)` trim 后为空则抛 `bad-session-title`，否则 `append("session/title", "user::<title>")`。
- `generateFrom(seed)` 落 `provider::<prefix>::<seed>` 或 `fallback::<seed[0..60]>`。
- `session/title` 是 log-only 事件（不进 `isSurfaceEvent`），持久但不进模型历史。

### 1.3 其他相关核心切片

- `core/src/session.cj`：`SessionEvent` 只有 `(seq, eventType, data)`，**日志行格式 `<seq>\t<type>\t<esc(data)>` 没有任何时钟字段**；`durableCount()` 返回 `flushedCount`（append 只在实例内可见，flush 才计数）。
- `core/src/settings.cj`：`SettingsStore` 是通用 KV，log-only `settings/document-updated`，三种变更 `update::<k>::<v>`、`replace::<k=v,...>`、`mutate::<k>::<expected>::<new>`（**已具备 CAS 原语**）。当轮实测：除自身与其测试外**无任何入口消费**，且它按 `SessionLog` 构造，作用域是单份日志。
- `core/src/wspace.cj`：**项目/工作区**级已有 `create::<id>::<path>` / `archive::<id>` / `pin::<id>::<sessionId>` 事件编码，`list()` 只回未归档者。会话级 archive/pin 的命名先例照它，不要另发明一套编码。

### 1.4 宿主 `apps/host/src/main.cj`

三个 verb 真实存在，放行闸门（照抄代码，别改语义）：
- `session/catalog` 属 `readSide` 白名单，turn 在途也能放行。
- `startupFault` 时只放行 `initialize`、`session/catalog`、`session/create`、`session/select`。
- `workspaceFault` 时放行 `initialize`、`session/projection`、`session/catalog`、`appearance/get`、`usage/status`、`workspace/get` —— **不含 create/select**。
- `selectionFault` 时不放行 create/select。

`session/catalog` 响应：`{"root":<canonicalize(".")>,"entries":[{id,title,durable,status,workspaceDirectory,current}],"source":"durable-log"}`。**没有 lastModified、没有 archived/pinned、没有 revision**。`current` 由 host 侧 `activeId` 比对得出。

`session/select` 的既有不变量（新功能不得绕过）：在途审批 open tickets / `inflight.count()>0` / `jsAlive` → `-32001 session-resources-in-flight`，要求用户先结算；先作废在途提示词增强；目标 `load()` 失败 → `-32002 replay-rejected`；根索引要 `WriteLease.takeoverIfStale()`，占用 → `already-owned`；`index.flush()` 失败置 `selectionFault=true` 并回 `-32003 selection-flush-failed`，**保留根租约、不声称切换成功**；成功后重建 `lease/shared/extRt/approvalDesk/executionService/meter/turnHandle/turnSink/callSink/inflight`。

`session/create` 失败路径当前是 `errFrame(idText, -32004, e.message)` —— **直接把核心异常 message 透出**，新 verb 不许照抄这个形状（见 §4 错误契约）。

`initialize` 的 `capabilities` 是硬编码字符串清单，含 `session/catalog`、`session/create`、`session/select`，**不含任何 rename/archive/pin**。新 verb 只有真实现后才进这张表，客户端按协商结果决定是否显示可执行动作。

### 1.5 桌面

- IPC 面：`preload.cjs` 暴露 `sessionCatalog()` / `sessionCreate(title)` / `sessionSelect(sessionId)`；`main.cjs` 三个 `ipcMain.handle`，其中 `sacode:sessionCatalog` 无参数守卫直转 `bridge.request("session/catalog")`。`test/bridge.test.mjs` 已确立「逐字段守卫 + 断言不存在万能通道（request/call/invoke/send/hostRequest…）」的写法，新增通道必须同步这两处。
- 渲染层 `renderer/app.js`（`nav` 一节）当轮实测**已实现**：`sidebarWidth` 280、拖拽 clamp 264–420、窄窗阈值 1024 自动折叠；`sidebarSessions` 过滤 `durable>0`；`workspaceGroups` 以 `workspaceDirectory` 为键（空串归「未分组」，当前已配置工作区即使无会话也占一组）；`workspaceGroupExpanded`（`Set`）控制分组折叠；`workspaceSessionLimits`（`Map`）默认每组 5 条 + `workspace-overflow`「显示更多（N）」/「收起会话」，且当前会话在 turn running 时豁免限额；`renderSession` 的 `disabled = sessionLocked || status==='replay-rejected'`、`aria-current`、`title` 提示、`data-sidebar-session` 锚点；空态「暂无会话」；`catalogNote` 含「失败」才在侧栏出提示。
- 渲染层**没有**：侧栏搜索框、状态筛选、重命名、归档/取消归档、置顶、时间戳、右键菜单（全仓 `app.js` 无 `contextmenu` 处理器）、多选与批量、任何展开/偏好的持久化。
- `catalogDialog` 提供全量列表 + 刷新 + 新建（`#new-session-title` maxlength 80）+ 元信息文案（`已保存 N 条事件` / `· 尾帧不完整` / `日志回放失败，摘要不可用`）+ `打开会话`（`disabled = sessionLocked || item.current || replay-rejected`）。
- CSS：`.workspace-group`/`.workspace-folder`/`.sidebar-session`/`.workspace-overflow`/`.sidebar-empty` 在 `renderer/styles.css` 与 `renderer/frame.css` **两处都有定义**（部分属性重叠）。新样式先定一处落点，别再加第三处。
- 门禁：`test/renderer-el-shape.test.mjs` 钉 `el(tag, class, children, props)` 四参形状，并带「三种历史错误形状必须为红」的反证用例，以及 `el(` 命中数 ≥200 的空转防线。新增渲染代码违反四参形状会红。

### 1.6 验证通道（当轮实测）

| 目的 | 命令 | 注意 |
| --- | --- | --- |
| 核心单测 | `cd core && cjpm test` | 必须私有 `TMP/TEMP/TMPDIR`（`scripts/verify-tmp.mjs`）；只认剥 ANSI 后最后一个 Summary 块的五个计数，`TOTAL: 0` 记 FAIL |
| 桌面单测 | `cd apps/desktop && npm test` | 即 `node --test` 自动发现；**不要写成 `node --test test/`** |
| 宿主 verb 集成 | `apps/desktop/test/catalog.test.mjs` | 已有范式：`HostBridge` + `dist/host/bin/sacode-host.exe` + `mkdtemp` 私有目录，含中文目录名、损坏日志、`parent/nested` 越界、符号链接用例。核心 `catalog_management_test.cj` 只有 2 条（新建命名空会话 + 拒绝非法 id/标题且不写盘） |
| 真实渲染断言 | `cd apps/desktop && npm run ui-smoke` | 侧栏已有断言落点：`test-support/ui-smoke.cjs` 用 `note(cond, '中文描述')`，`#open-catalog` 的点击与关闭后焦点归还也在测；`layout-smoke.cjs` 核图标尺寸与几何 |
| 打包态 | 先 `node scripts/pack-host.mjs apps/host/target/release/bin/main.exe apps/desktop/dist/host <stdx-dll> <runtime-dll>` | dev 态宿主固定 `apps/desktop/dist/host/bin/sacode-host.exe`；重打前查有无活的宿主进程（并发会话锁 `bin/*.dll` → `EPERM: unlink`） |

## 2. 差距表（并纠正一版过期判断）

三档：`已有` / `部分` / `缺失`。**旧简报草稿把「分组、折叠、显示更多」列成待做（B1），实际已经实现，不要重做**；草稿把「删除」当成需求，实际 F01 定的是 `session/archive`。

| 能力 | 状态 | 依据 |
| --- | --- | --- |
| 按工作区分组 + 折叠 + 每组限 5 + 显示更多 | 已有 | `app.js` `workspaceGroups` / `workspaceGroupExpanded` / `workspaceSessionLimits`；官方同样是「按工作区分组 + `COLLAPSED…=5` + 展开其余」（§8），**口径已对齐，不要重做** |
| 空会话不占位 | 已有 | `sidebarSessions` 过滤 `durable>0`；官方对应 `node.blank → 「新建会话」文案` |
| 切换原子性与 busy 保护 | 已有 | host `session/select` + 渲染层 `sessionLocked` |
| 分组展开状态持久化 | 缺失 | 无本机偏好通道（§5 B1） |
| 侧栏搜索 | 缺失（本期只做官方口径的第一段） | 官方是本地标题/工作区子串 + Host 内容匹配混合（§8）；我们本期只做第一段，内容搜索另批 |
| 状态筛选 / 视图选项（groupBy 三档 + orderBy 两档） | 缺失 | 官方有 `ViewOptionsMenu`；PRD §3.1 也要求「按工作模式筛选只改对话列表」 |
| 会话行**状态提示**（进行中/待审批/待回答/完成） | 缺失，且**上游契约 + PRD §3.1 都要求** | 官方 `StateDot` 四态与 `pendingInteraction` 三分类（§8）；我们 `session/catalog` 只有 `status: ready/truncated/replay-rejected`（那是**日志完整性**状态，不是会话运行状态，两者不许混用） |
| 重命名 | 缺失（且核心有真缺陷，见 §3-A） | 无 verb、无 UI；`title.cj rename()` 已存在 |
| 归档 / 取消归档 | 缺失 | `wspace.cj` 只有工作区级 archive 先例；官方会话级是 `workspace_archiveSession/unarchiveSession` |
| 置顶 / 取消置顶 | 缺失 | 官方由 **Host 持久化**且与归档互斥（§8）；`wspace.cj` 有 `pin::` 但**没有 unpin** |
| 时间戳 | 缺失（受 §3-B 约束） | `session/catalog` 无该字段；官方来源是 `max(createdAt, lastPromptAt)` |
| 会话分叉 fork | 缺失，另批 | 官方菜单有 `fork(300)` 与 wire `session_fork`；本仓 `catalog.cj` 无对应能力，属上游契约缺口，**不入本批**（登记即可） |
| 消息摘要/预览 | 上游**没有**，属自有增量 | §8 确证行内无预览、`snippet` 只在搜索结果；不占 63 行上游分母，本批不做 |
| 右键菜单 | 上游**没有**，属自有增量 | §8 确证无 `onContextMenu`；官方只有 `...` 行内菜单 → 本批做 `...`，右键菜单降为可选 |
| 多选与批量删除、导出日志 | 契约未定 | 批操作语义（部分失败归因、幂等）接口规格没有定义，不自造 |
| 委派/子智能体进行中徽章 | 上游有对应事实、入口依赖 F10 | §8 的 `runningSubagentCount` / `origin:"subagent"` 是上游呈现口径；F10 `delegation/*` 尚未实施 → 保持待办，不许用假状态占位 |

## 3. 三个必须先解决的问题（不解决就会做出错功能）

### A. 标题投影分叉 —— 现存缺陷，先修

`SessionCatalog.entry()` 取 **第一条** `session/title` 且不剥 `<source>::` 前缀；`SessionTitleService.get()` 取 **最后一条** 并剥前缀。后果两条，都是当轮直读得出、不是推测：

1. 任何经 `rename()` / `generateFrom()` 落标题的会话，侧栏与 catalog 显示的是 `user::…` / `fallback::…` 字面串；
2. 重命名追加新事件后，侧栏与 catalog **永远不变**（第一条已存在）。

要求：`entry()` 的标题改为复用 `SessionTitleService(log).get()` 的「最后一条 + 剥前缀」语义（或把 decode 逻辑抽成一个共用入口，两处共用，避免第三处漂移）。补一条红先用例：`rename` 后 `session/catalog` 返回的 `title` 是新标题且不含 `::`。这条本身是缺陷修复，作为 A2 的第一批，不许和 UI 混在一批里提交。

### B. 日志没有时钟 —— 时间戳只能取文件 mtime

`SessionEvent` 无时间字段，`session.log` 行格式是 `<seq>\t<type>\t<esc(data)>`。给事件加时间列会动 append-only 的前缀复用校验与既有回放兼容，且接口规格明写「不能通过更改旧事件含义修复兼容」「未知事件迁移…先评审后落库」——**本期不许改日志编码**。

`lastModified` 取会话 `session.log` 的文件 mtime。注意：
- 仓内 `FileInfo` 目前只用过 `isRegular()` / `isDirectory()`；`std.fs.FileInfo.lastModificationTime` 出自二手速查文档，**落地前必须自证**（按仓内三步：grep 已编译形态 → 查官方插件文档 → 临时 cjpm 包跑一次）。自证失败就写 BLOCKED 并说明，**不许退回「用 seq 猜时间」或拿 `Date()` 当前值冒充**。
- mtime 缺失/为 0/异常 → 渲染「未知时间」，不崩溃。
- 相对时间格式化在渲染层做（刚刚 / N 分钟前 / N 小时前 / 昨天 / 绝对日期），阈值在代码里单点定义并给用例。

### C. 归档不能破坏选择指针 —— 所以本期是 archive，不是 delete

根索引 `session.log` 里的 `workspace/session-selected` 是 append-only 历史。若物理删除会话目录：`selectedId()` 仍会返回已消失的 ID → `pathFor()` 抛 `unknown-session` → 宿主 `main` 启动即置 `startupFault=true`（`startupFault` 后只放行 `initialize`/`session/catalog`/`session/create`/`session/select`），桌面表现为「旧会话打不开、只能新建」的半瘫态。

因此本期语义：**archive = 移出 `list()` 默认结果与导航，日志文件与目录原样保留，可 `unarchive` 恢复**。不实现 `rmdir`。真要物理删除，必须先单独设计出「指针指向已消失会话」的恢复路径并评审，另立批次。

这条不只是我们的保守选择 —— 官方 `dsh-client-ui-workspace/README.zh.md` 原文写明「**没有 Session 删除**：会话可以归档但绝不会被删除」，连工作区删除也只「从工作区列表中移除，文件夹与会话记录会保留」。接口规格 F01 行选的 `session/archive` 与上游一致；旧草稿里的 `session/delete` 应当作废。

current 会话不许归档：先打开别的会话。返回 `busy`（或 `not-authorized`）配中文提示「请先打开其他会话再归档当前」。官方另有一条要一并复刻的不变量：**Host 规定置顶与归档互斥**（§8），取消归档前不能同时是 pinned。

## 4. 新增 Host verb 契约

统一形状（接口规格 §2）：请求带 `sessionId`（活动会话操作时）、目标 `id`、`requestId` 幂等键、适用时 `expectedRevision`；成功响应带业务身份 + 当前 revision + 实际状态；失败走 `error.data = {reason, retryable, currentRevision}`，`reason` **只能**取那十个固定值。`session/create` 现在把核心异常 message 直插 `errFrame`，新 verb 不许照抄——`bad-session-title` 之类内部串一律映射到 `invalid-input`。

| verb | 参数 | 成功响应 | 失败 reason | 落地要点 |
| --- | --- | --- | --- | --- |
| `session/rename` | `id`, `title`, `expectedRevision`, `requestId` | `{id,title,revision,status:"updated"}` | `not-found` / `revision-conflict` / `invalid-input` / `busy` / `persistence-failed` | 写目标会话日志 `session/title` = `user::<title>`（复用 `SessionTitleService.rename`，空/纯空白 → `invalid-input`）；`expectedRevision` 本批用该会话 `durableCount()` 作弱版本，不匹配回 `revision-conflict` + `currentRevision`；非活动会话要 `WriteLease` + `takeoverIfStale()` + `append` + `flush()` 全成功才报 updated，flush 失败 → `persistence-failed` 且不得声称成功；活动会话复用已持有的 `lease`/`shared` |
| `session/archive` | `id`, `requestId` | `{id,archived:true,revision}` | `not-found` / `busy` / `unsupported` / `persistence-failed` | 归档态落**根索引日志**，事件编码沿用 `wspace.cj` 先例：`session/catalog-change` = `archive::<id>`；`SessionCatalog.entry()` 回放该事件填 `archived`；`list()` 默认只回未归档 |
| `session/unarchive` | `id`, `requestId` | `{id,archived:false,revision}` | `not-found` / `persistence-failed` | 同上，`unarchive::<id>` |
| `session/pin`、`session/unpin` | `id`, `pinned`, `requestId` | `{id,pinned,revision}` | `not-found` / `unsupported`（对已归档会话置顶 → 与「置顶归档互斥」冲突）/ `persistence-failed` | 官方由 **Host 持久化**（§8），所以置顶**必须进核心事件**，不能只做渲染层内存态。落法同 archive：根索引日志的 log-only 事件，编码沿用 `wspace.cj` 的 `pin::<id>::<sessionId>` 风格，并**新增 `unpin::<id>::<sessionId>` 事件体**（`WorkspaceRegistry.pin` 目前只有加、没有减，且它按 workspace id 索引，不是会话目录 id —— 照搬前先确认这两点） |

`session/catalog` 响应扩字段（保持向后兼容，只加不改）：`lastModified`（B）、`archived`（C）、`pinned`、`revision`（供 rename 的 CAS 用，取 `durableCount()`）。

三个新 verb 实现落地后才加进 `initialize` 的 `capabilities` 清单；在此之前渲染层不得显示为可执行。

两条与上游口径的**有意差异**，写码前先认下：
- 官方 `session_rename` 出参是 `{title, seq}`、**没有 CAS**（后写覆盖）。本仓接口规格 §2 要求 `expectedRevision`，所以 `revision-conflict` 这档是**自有增量**，别在文档里写成「对齐官方」。
- 官方置顶/归档在 **workspace 控制器**命名空间（`workspace_pinSession`/`workspace_archiveSession`），归档与取消也是。本仓接口规格 F01 行把它们定在 `session/` 命名空间，按 F01 走；`WorkspaceRegistry` 的接线是另一批工作，本批不顺手接。

## 5. 分期与依赖（保留完整范围，按依赖排批，不是删功能）

**A1 侧栏搜索与筛选** —— 纯渲染层，不动 core/host，可立即开工。
- 顶部搜索输入（PRD「顶部为搜索、新建会话」；沿用原型口径 `aria-label`/placeholder 均为「搜索会话」，官方 placeholder 是「搜索会话名称」，取一即可但要一致）。
- 匹配 `title` **与工作区名**（trim + 大小写不敏感子串）—— 这正是官方 `deriveSearchResults` 的第一段；官方第二段是 Host 内容匹配（`session_search` 返 `snippet`），本仓核心没有内容索引，**另批**再开 `session/search`，本批不许假装做了内容搜索。
- 官方口径里的 `250ms` 防抖与「新查询 `abort()` 掉前一个」**本批不做，且是有意的**：官方那两段服务于 Host 内容搜索（异步、可取消），而本批只有本地同步过滤——没有可中断的请求，加防抖只会把可证的行为改成不可证的时序。要做的是「没有可中断的活就同步出结果，也不显示骨架行」（官方 `skeletonRow` 同理不需要）。等真开 `session/search` 那批时再一并引入防抖与取消。
- 命中时自动展开所在分组、无命中的分组不渲染；空结果显示「无匹配会话」，与既有「暂无会话」（无任何落盘会话）分开，两者不得混用。
- `sessionLocked` 时输入禁用；筛选条件为 全部 / `ready` / `truncated-tail` / `replay-rejected`（这是**日志完整性**筛选；运行态筛选属 A5，别在这里混）。
- 定一条：切换会话后查询词保留还是清空。推荐保留（与「结果不残留」不冲突——残留指旧会话的命中/高亮，不是输入框文本），并把选定写进用例名，别留给后人猜。
- 全量拉取 + 本地过滤（数据源仍是 `session/catalog`），不为搜索新增 IPC。
- 快捷键 `Mod+K` 聚焦搜索、`Mod+Alt+G` 重命名（官方口径），按钮上带 `aria-keyshortcuts`。

**A2 标题面修复 + `session/rename` + UI** —— 先 §3-A 的缺陷批（独立提交），再 verb + 渲染层入口。入口两个：行内 `...` 菜单项 + **标题双击**（官方两处都有）。

**A3 时间戳与状态可视化** —— 依赖 §3-B 的 API 自证结论；`truncated-tail` 与 `replay-rejected` 的视觉标记复用现有 `badge-warn` 系与 catalog 文案，不新造一套色。相对时间档位照 §8 官方阈值实现（**无「昨天」档**，行内不带「前」字，绝对日期只在悬停卡）。

**A4 `session/archive` / `unarchive` + 归档分组 + 恢复** —— 依赖 §3-C；导航底部单独一段「已归档 N」，可展开、可恢复。归档有活动工作时先给确认（官方只在有活动工作时弹，并逐项列出进行中回合/子智能体/后台任务）；成功提示给「撤销」。守住「置顶与归档互斥」。

**A5 会话行运行状态提示** —— PRD §3.1 明确要求「状态提示」，官方有完整契约（`StateDot` 四态 + `pendingInteraction` 三分类替换时间位）。前置：`session/catalog` 目前只有日志完整性 `status`，**没有运行态**；要新增 `running`/`pendingInteraction` 字段，来源是宿主已持有的 `turnHandle`、`approvalDesk.hasOpenTickets()`、`inflight`。这批依赖宿主投影，不在 A1–A4 内顺手做。

**B1 视图选项与展开状态持久化** —— `groupBy`（按工作区 / 单列表）与 `orderBy`（最近更新 / 手动）的切换入口，加分组展开状态的持久化。

上游把归属切得很清（§8 细则原文），照此分家：**视图模式与排序模式的选择由浏览器本地记住**，而**完整会话序列（含隐藏的归档成员）持久化在宿主侧** —— 不许把序列塞进渲染层当第二真源。排序判据是「最近一次用户提示词或 steering（中途引导）时间」，**置顶时间不参与排序**；置顶不切换视图模式、取消置顶不改已保存位置、拖拽即切手动模式、fork 不继承置顶关系 —— 这四条各要一条独立断言，别糊成一条。

现状事实：`global/settings` 只有三个具名字段（transcript-view / composer-enter / session-log）；`core/src/settings.cj SettingsStore` 虽是通用 KV 且自带 CAS 的 `mutate`，但**当前无任何入口消费**；`core/src/wspace.cj WorkspaceRegistry` 同样未被宿主接线。所以本机偏好这条路**要么新增一条具名 `global/settings/set-sidebar-view`（host 的 `global/settings` 一族 + `core/src/global_appearance.cj` 存储 + `preload.cjs` + `main.cjs` + `test/bridge.test.mjs`），要么就明写「本会话内不持久」**。不自造第五个散装字段、不把 `SettingsStore` 悄悄接成通用后门。
- 注意：置顶/归档的持久化**不在本条**，它们走核心事件（§4 已改判，官方由 Host 持久化）。B1 只管「展开状态 + 视图与排序选择」这类纯布局偏好。

**B2 会话项操作菜单** —— 做官方形态：左键 `...`（`IconEllipsisOutlineRegular`）+ 键盘可达，动作集合按官方 slot 序 `置顶(100) → 重命名(200) → 归档(400)`（`fork` 属上游缺口，另批）。**右键菜单上游不存在**（§8 确证），因此右键只是自有增量，默认不做；真要加，另立批次并注明不占上游能力分母。多选与批量、复制 ID、导出日志同属契约未定的增量，本期不做。

**C1 委派/子智能体会话的呈现** —— 简报初稿把它写成「委派中徽章 + 可切换」，**与上游口径不符**：上游 `README.zh.md` 原文是「**subagent 来源的 Session 则保持隐藏**」，同时 `runningSubagentCount` 只作为来源会话行的状态优先级之一参与 `StateDot`。所以这里先要重定口径，三选一（隐藏 / 折叠到来源会话 / 单列可切换并加徽章），不要边写边定。另外入口依赖 F10 `delegation/create/describe/cancel` 与 `acp/probe`，F10 本身尚未实施。保持待办，不许先接一个假状态；A5 落地时把这一位留成同一个状态点，不要另开一套徽章。

## 6. 验收标准（每条都要跑出可复现计数，不接受「看着对」）

按 PRD §7 F01 三类 × 接口规格 §5 八项铺开：

| ID | 正向 | 失败/越权 | 恢复/并发 |
| --- | --- | --- | --- |
| A1 | 输入查询词 → 只显示命中标题、所在分组自动展开、无命中分组消失 | 无任何匹配 → 「无匹配会话」；`sessionLocked` → 搜索框与筛选禁用 | 搜索中切换会话 → 列表按新会话 catalog 重算，旧命中/高亮不残留 |
| A2 | rename 成功 → catalog 与侧栏标题即刻更新，且**不含 `::` 前缀** | 空/纯空白标题 → `invalid-input`；`expectedRevision` 过期 → `revision-conflict` 且带回 `currentRevision`；未知 id → `not-found` | `flush` 失败 → `persistence-failed`，UI 不得报成功、标题保持旧值；同一 `requestId` 重放不产生第二条 `session/title` 事件 |
| A3 | 会话项显示相对时间；`truncated-tail` 与 `replay-rejected` 各有视觉标记 | mtime 取不到/为 0 → 「未知时间」，不崩溃；`replay-rejected` 仍显示「日志回放失败，摘要不可用」，不外泄内部堆栈 | 刷新 catalog 后时间戳与状态同步；状态变化即刻反映 |
| A4 | 归档 → 该会话移出导航、目录与日志原样存在；取消归档 → 回到原分组 | 归档当前活动会话 → 拒绝并提示先打开其他会话；对 `replay-rejected` 会话归档 → 明确拒绝 | 归档后**重启宿主**，`selectedId()` 仍指向有效会话、不进 `startupFault`；归档不进 `list()` 默认结果但 `pathFor` 仍可解析 |
| A4·置顶 | 置顶 → 标记出现且**重启后仍在**（核心事件回放得出）；取消置顶 → 标记消失 | 对已归档会话置顶 → 按「互斥」拒绝并给中文原因；对未知 id → `not-found` | 置顶与取消置顶各自重放同 `requestId` 不产生重复事件；先置顶再归档 → 后者被拒或前者被清，二者不能同时为真 |
| A5 | 会话有在途轮次/待审批 → 行上出现对应状态标记，且**替换**时间位（官方口径） | 无运行态数据（字段缺失或未协商）→ 不显示标记，也不显示假的「空闲」 | 结算后状态即刻回落到时间位；切会话后上一会话的状态不残留 |
| B2 | `...` 菜单项集合与 `capabilities` 一致；Escape 只关本层、关闭后焦点归还触发的 `...` 按钮 | 未协商到该 verb（`capabilities` 缺失）→ 动作显示为不可用而不是点了报错；`sessionLocked` → 菜单动作全部禁用 | 菜单打开时切会话/关窗不遗留可点击残影；键盘 Tab 环内不逃逸到侧栏外的真实控件 |

UI 面：新增断言进 `test-support/ui-smoke.cjs`（现有 `note(cond, '中文描述')` 范式），布局与图标几何进 `layout-smoke.cjs`，四参形状门禁 `node --test test/renderer-el-shape.test.mjs` 必须保持绿。

防假绿纪律（本仓既定）：结论必须带用例条数；`TOTAL: 0` 按 FAIL；不许缩范围凑绿，只做 PASS/FAIL/BLOCKED 三态，BLOCKED 要写清缺的前提与解锁动作；绿灯前对新增不变量做变异反证（把「取最后一条 session/title」改回「取第一条」应立刻打红，把 archive 事件回放改成 no-op 应让 A4 归档用例打红）。

## 7. 红线（违反任一条即返工）

- 会话日志是唯一真源：侧栏与 catalog 只投影事件，不建第二份会话索引；`append` 不等于持久，必须 `flush`。
- 不改 `session.log` 事件编码、不给既有事件（含 `session/title`）换含义；新增事件类型先过持久化设计。
- `stdout` 只走协议帧，诊断走 `stderr`。
- IPC 面是逐字段校验的有限集合：增删通道同步改 `preload.cjs`、`main.cjs`、`test/bridge.test.mjs`，不提供「发任意方法」通路。
- 新 verb 真实现后才进 `initialize` 的 `capabilities`。
- 打包态宿主路径只从 `process.resourcesPath` 解析，缺则 fail-loud，绝不回退 asar 内路径。
- 注释、文档、commit 一律中文；commit 形如 `feat(core,host,desktop): 描述`，scope 用 `core/host/cli/desktop/extjs/scripts/docs`。
- 不提交产物：`target/`、`apps/desktop/dist/`、`npm/dsh-cli-*/bin/`、`*.log`。
- 开发态绿了要在打包态复验；`dist/host` 可能是上一轮旧产物，核 exe 的 mtime/体积再下结论。

## 8. 官方 DSH 侧边栏基准（从安装态 asar 原文读取）

**取法补正**：`A.listPackage(P)` 返回的是 win32 原生反斜杠串，且**首字符是前导分隔符**（一个反斜杠）；原串直接交给 `extractFile` 会报 `was not found`，必须 `.slice(1)` 去掉它（`searchNodeFromDirectory` 会把空首段当目录名查）。不要 `extractAll`。

**组件归属（重要，别找错包）**：`@deepseek-ai/dsh-client-ui-sidebar` 只是**外壳**（slot 与 dict：`sidebar.brand.mark/name`、`sidebar.workspaces`、`sidebar.panellist`、`sidebar.settings`、`sidebar.toggle.badge`，动作 `session.new`、`toggle.open/collapse`）。**会话列表全部在 `dsh-client-ui-workspace`**，它把自己注册进 `sidebar.workspaces` 席位。找侧栏行为要去 ui-workspace，不是 ui-sidebar。

**证据分档**：来源是安装包内 `README.zh.md` 原文 + `lib/*.js` 打包代码，版本 `@deepseek-ai/dsh-desktop` **0.2.0-rc.2、channel=nightly**（Electron 44.0.0）。这**不等于**能力矩阵冻结的 `639ed01`，存在版本漂移；且本次**没有运行官方桌面**做运行态对照。下面每条是「文档+代码原文确证」，不是「官方实际行为确证」。据此写方案时按上游契约复刻，但不要在验收里声称官方实测通过。

**独立复核（本轮第二次直读，非转述）**：另跑了一次只读探针，逐条取原文行核对以下六项，全部确证 ——
`ui-workspace/lib/client.js`（198642 字节）中 `session_delete/deleteSession/removeSession/session_remove` **0 命中**、`onContextMenu/contextMenu` **0 命中**、`preview` **0 命中**；`ui-sidebar/lib/client.js`（32107 字节）中 `SessionNodeItem/session_list` **0 命中**（证实外壳不渲染列表）；`ui-sidebar/README.zh.md` 原文「侧边栏是导航外壳……**ui-workspace 填充 `sidebar.workspaces`**」；`ui-primitives/lib/index.js` 原文 `const MIN = 6e4; const HOUR = 36e5; const DAY = 864e5;`。

**排序与置顶细则**（`dsh-client-ui-workspace/README.zh.md` 原文，B1/A4 直接照此实现）：
- 分组与平铺视图都**先显示置顶会话，再显示普通会话**。
- **最近更新**：分区内严格按「最近一次用户提示词或 steering（中途引导）时间」降序；**置顶时间不参与排序**。
- **手动排序**：用同一条完整会话序列里的相对位置，**序列包含隐藏的归档项**。
- **视图模式（分组/平铺 + 最近更新/手动）由浏览器本地记住，重新加载后恢复**；而工作区与完整序列由 Host 持久化 —— 两条路的归属不同。
- 置顶把会话移到完整保存序列首位，但**不切换视图模式**；取消置顶不改变已保存的位置；拖拽置顶行或普通行都改同一条完整序列并切到手动模式；缺失的置顶成员按置顶数组顺序补到头部；新增的普通 fork 插在来源会话之前且**不继承置顶关系**；「补齐」只在内存中完成，直到一次顺序写入才保存完整结果。
- 同一原文还写明：**subagent 来源的会话在侧栏保持隐藏**（不是加徽章）。

**另记一条口径修正（影响 §5 C1）**：简报初稿设想的「委派中徽章 + 可切到委派会话」与上游不同 —— 上游把 subagent 来源会话**从列表隐藏**，只在状态优先级里保留 `runningSubagentCount`。C1 因此要先重定口径（隐藏 / 折叠到来源 / 加徽章是三选一），见 §5 C1。

| 官方能力 | 原文契约（可复刻的最小事实） |
| --- | --- |
| 搜索 | **本地 + 后端混合**，不是纯前端：`deriveSearchResults` 先做不区分大小写的「标题与 Workspace 子串匹配」，再并上 Host 内容匹配。`SEARCH_DEBOUNCE_MS = 250`、查询上限 `SEARCH_QUERY_MAX_CODE_UNITS = 500`、每次新查询 `controller.abort()` 中止前一个、结果上限 `SESSION_SEARCH_RESULT_LIMIT = 20`、摘要 `SESSION_SEARCH_SNIPPET_MAX_CODE_POINTS = 240`。后端是**字面 token/短语匹配，无模糊搜索** |
| 重命名 | wire `session_rename`，入参 `{sessionId, title}`，出参 **`{title, seq}`**。调用走 `sessions.using(sessionId, {source:"workspaceOperation"}, ref => ref.binding.session.rename(title))`。入口两个：行 `...` 菜单 order 200 + **标题双击**；对话框注册在 `shell.overlay`。快捷键 `Mod+Alt+G`。**官方无 CAS**，靠返回的 `seq` 回执 |
| 删除 | **官方明示没有**：`README.zh.md` 原文「**没有 Session 删除**：会话可以归档但绝不会被删除」；263 个 lib js 扫 `session_delete/session_remove/deleteSession/removeSession` 命中 0。只有工作区删除，其确认文案是「将把 "…" 从工作区列表中移除。文件夹与会话记录会保留，其会话将显示在"未分组"下」——**连工作区删除也不落盘删数据** |
| 归档 | wire `workspace_archiveSession {sessionId, stopActivity?}` / `workspace_unarchiveSession`。归档活动会话时 Host 侧 `archiveSession` 成功后才 `clearMain()`。归档确认框**只在有活动工作时出现**，逐项列出进行中的回合/子智能体/后台任务/定时提醒；成功 toast 带「撤销」与「筛选已归档会话」 |
| 置顶 | wire `workspace_pinSession/unpinSession {sessionId}`；集合来自快照 `pinnedSessionIds`，`pinnedSet = derive(workspaces.list, s => new Set(s.pinnedSessionIds))` —— **官方置顶由 Host 持久化**（不是浏览器本地）。行内 `PinnedIndicator`（`IconPinFillRegular`）。**Host 规定置顶与归档互斥** |
| 时间戳 | 相对时间，**没有「昨天」这一档**：`relativeTime(at, now)`，阈值 `MIN=6e4 / HOUR=36e5 / DAY=864e5`，档位 `diff<MIN→刚刚`、`<HOUR→{n}分钟`、`<DAY→{n}小时`、`<30*DAY→{n}天`、`<365*DAY→{n}个月`、否则 `{n}年`；行内**不带「前」**，悬停卡才套 `{t}前`。绝对日期只在悬停卡的创建时间：`{y}年{m}月{d}日` + `HH:mm`。时间来源 `updatedAt = Math.max(header.createdAt, metadata.lastPromptAt)` |
| 摘要/预览 | **行内没有消息预览**（`preview` 关键词在 ui-workspace 0 命中）。标题来自投影 `projections.values.title`；`displayTitle = node.blank ? t("session.new") : (node.title \|\| t("session.untitled"))`，注释明写「不使用目录名兜底」。`snippet` **只出现在搜索结果行**（`session_search` 出参 `{items:[{sessionId, snippet}], hasMore}`） |
| 菜单 | **右键菜单不存在**（`onContextMenu`/`contextMenu` 各 0 命中）。只有左键 `...`（`IconEllipsisOutlineRegular`）触发的 `Menu portal closeOnPointerLeave`。会话项按 slot 序：`pin(100)`、`rename(200)`、`fork(300)`、`archive(400)`（归档行文案切成「取消归档」）；行悬停按钮 slot `sidebar.workspaces.session.row.action`（archive 100 / pin 200） |
| 分组与视图 | 按 `workspaceId` + 其 `sessionIds` 成员关系分组（**不是按 cwd**），未注册成员兜底进 `group.ungrouped`「未分组」。三种 `groupBy`：按工作区 / 按工作区树（子工作区挂到「最近的已注册祖先」，用规范化路径 `folderPath()` 比较）/ 单列表 flat；入口是 `ViewOptionsMenu`。排序 `orderBy` 手动/最近更新；拖拽 `workspace_insertSessionBefore {workspaceId, sessionId, beforeSessionId?}`，工作区分组顺序由 Host 持久化（`workspace_insertBefore`），单列表/未分组顺序存浏览器本地 |
| 状态提示 | `StateDot` 四态 `ongoing/warning/done/idle`，优先级 `pendingInteraction(warning) > running(ongoing) > runningSubagentCount > completed(done) > idle`；`pendingInteraction` 三分类 `approval / plan-review / question`，此时**行尾时间被 `待审批/计划待审/待回答` 替换** |
| 折叠配额 | `COLLAPSED…=5` + 「展开其余 {n} 个会话」/「收起」 |
| 数据面 | `session_list` item：`agentAvailable, sessionId, updatedAt(number), running, blank, parentSessionId?, origin?("subagent"), cwd?, projections{kind:"cached"\|"sequenced", asOfSeq, values{title\|null, sessionListMetadata{blank,lastPromptAt}, inbox, agentPreset, todos, modelSelection, permissions, subagentCatalog, imageLimits}}`。`workspace_follow` baseline：`items[{workspaceId, path, title, sessionIds, createdAt, updatedAt}] + archivedSessionIds[] + pinnedSessionIds[]`，增量类型 `upsert / remove / order / archived / pinned` |
| 其他确证存在 | 未读 `completionUnread`（**浏览器本地 `new Set()`，官方注释称「完成时间>上次查看时间这一事实永远不会到达宿主」**）、活动定时任务时钟标记（`sidebar.session.row.leading` 席位，仅 idle 行渲染、非 Tab stop）、HTML5 拖拽排序、标题省略裁切 + 悬停 marquee、悬停卡 `openDelayMs: 800` 与复制标题、`AnimatedRows`（`ROW_FADE_MS=100`）、`Mod+K` 搜索、收起轨道 56px + `sidebar.toggle.badge`、埋点 `branch_session_click` |
| 确证**不存在** | 会话删除、右键菜单、消息摘要预览、收藏/星标/tag（`favorite`/`收藏`/`label:"star"` 均 0 命中，`star` 命中全是 start/restart 词干）、**虚拟滚动与分页/加载更多**（`loadMore`/`pagination`/`virtual`/`Virtuoso`/`overscan`/`IntersectionObserver` 全部 0 命中） |

**据此得到的三条复刻裁决**（按本仓「先判上游有没有这能力」的既定纪律）：

1. **archive 不是我们的发明，是上游契约**；`delete` 上游明确不做。§3-C 的结论与官方一致，可以照 §4 落地。
2. **消息摘要、右键菜单、批量操作是自有增量**，上游没有 → 不占 63 行上游能力分母，也不该写成「对齐官方」。默认撤出本批范围（§5 B2 相应改口径）。
3. **置顶由 Host 持久化、且与归档互斥**，官方还给了 `unpin`。因此简报初稿里「置顶只做本机布局偏好、重启不保留」的口径**低于上游契约，属缩范围**，已改判：置顶与归档一样落核心事件（§4 的 `session/pin`/`session/unpin`、§6 的 A4·置顶行），内存态只能作临时兜底，不作为交付完成态。展开状态与视图选择才是真正的本机偏好，留在 §5 B1 处理。

## 9. 给 codex 的开工顺序

1. 先读 `core/src/catalog.cj`（`SessionCatalog.list/entry/pathFor/selectedId/select/create`）与 `core/src/title.cj`（`get/rename/generateFrom`），撞见 §3-A 的标题投影分叉。
2. 读 `apps/host/src/main.cj` 的 `session/catalog`、`session/create`、`session/select` 三个分支，以及 `readSide`/`startupFault`/`workspaceFault`/`selectionFault` 四道闸门和 `initialize` 的 capabilities 清单。
3. 读 `apps/desktop/renderer/app.js` 的 `sidebarSessions`/`workspaceGroups`/`workspaceGroupExpanded`/`workspaceSessionLimits`/`renderSession`/`catalogDialog`，和 `preload.cjs` 三个 session 通道 + `main.cjs` 对应 `ipcMain.handle`。
4. **A1 立即可做**（纯渲染层：搜索 + 状态筛选），不碰 core/host，先把 §6 A1 行的断言补进 `test-support/ui-smoke.cjs` 再实现。
5. A2 拆两批提交：第一批只修 §3-A 标题投影（红先 + 变异反证），第二批才是 `session/rename` + UI。
6. A3 前先自证 `FileInfo.lastModificationTime`（§3-B），自证不过就 BLOCKED，不要改日志编码。
7. A4 归档 + 恢复，按 §3-C、§4 与 §8 的「Host 持久化、置顶与归档互斥」口径。

## 10. 口径更正与新增面：会话内历史对话侧栏（2026-10-08 实现期）

用户在本批开工后纠正了口径：要的**不是**左侧栏的会话列表（本文 §1–§9 通篇在说它），而是「点开左侧栏某条会话之后，会话内部的一条历史对话侧栏——鼠标悬浮出现具体的标题和内容，点击进去跳转到具体那条消息，会话可以点击回到最新的消息」。中文「侧边历史记录」在本仓至少指两个面，以后接到这种说法先确认是哪一个再写码。

已按此实现并验证的增量（记为 **N1**，与 A 系列表面互不替代）：

- **上游有没有**：无。官方 DSH 的会话面在 `ui-workspace` 的会话列表，既没有对话内导航也没有消息摘要（见 `reference-dsh-official-desktop-ui-baseline` 与本文 §8）→ **自有增量，不占 63 行上游能力分母**。
- **条目粒度=轮次**：每条 `user/` 投影行一条，标题取提问首行（60 字符截断），内容取该轮全文（120 字符截断），回复计数与该轮首条回复摘要进悬浮卡。纯派生落点 `renderer/msgfold.js` 的 `turnOutline(lines, rows)`，锚点 id 与 `toBubbleMessages` 同一取法——侧栏不许造界面上跳不到的锚点；第一条提问之前的 system/developer 行不建条目。
- **定位仍然只有一个所有者**：`renderer/conversation-scroll.js` 加 `jumpTo(node, id)` 与 `onAnchor` 播报；渲染层只交锚点，绝不自取 `scrollTop`。跳到未知 id 如实返回 false 且不动位置、不解除跟随；在尾部时宿主交还 `null` 锚点，高亮回落到最后一轮。
- **呈现**：`nav.turn-nav` 覆盖在对话区右缘，**不改 `.conversation` 的盒子**（`layout-smoke.cjs` 拿的是 `.conversation.right === .conversation-center.right` 这条判据）；对话列宽 `<760px` 让位不压正文，不足两轮不出现。悬浮卡用 CSS `:hover`/`:focus-visible` 出，键盘可达，条目带中文 `aria-label` 与 `aria-current`。
- **验证**（都是当轮实跑，不是推断）：
  - `test/msgfold.test.mjs` 新增 5 条，单独跑 `# tests 18 / pass 18 / fail 0`。
  - `test/conversation-scroll.test.mjs` 新增 4 条，`# tests 8 / pass 8 / fail 0`。
  - `test-support/ui-smoke.cjs` 的 `turnNavChecks()`：另开一条会话、`session/append` 写满三轮真实日志事件、靠「切走再切回」的产品路径重取投影，8 条 DOM 断言全 `UI OK`（锚点对应 3/3、悬浮卡 display=flex 且标题/正文/回复数正确、`gap:0` 钉顶并交出跟随、回到最新后高亮回落第 3 条、窄列 460px 时不出现、切回单轮默认会话后不残留）。
  - 变异反证两条：可见性条件改恒真 → 窄列断言红；条目粒度改成「任何角色都建条目」→ 锚点对应断言红（实测导航 5 条 vs 消息流 3 条）。改完按 `diff` 空输出证回逐字一致，再跑回 `28/28 pass`。
- **踩到并修掉的两个假红**：`session/append` 自带持久屏障（写入即 flush），再补一次空 `session/flush` 宿主如实回 `-32004 no-pending-writes`；夹具改窗口宽度前用 `#toggle-side` 关开右侧面板会重取工具列表、把后面「弹窗关闭后焦点归还详情按钮」那条断言的触发节点换掉——实测去掉该动作即回 OK，故宽度分支改用 `win.setContentSize`。
- **A1（左侧栏搜索 + 状态筛选）已实现并实测**：`ui-smoke` 里 15 条 `UI OK`（含折叠态自动展开、无命中分组隐藏、「无匹配会话」与「暂无会话」分列、`Ctrl/⌘+K` 聚焦、检索中真实切两次会话后命中集重算）。§5 A1 那条「250ms 防抖 + abort 前一个」按上面的理由本批不做。
