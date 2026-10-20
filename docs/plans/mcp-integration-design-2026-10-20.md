# SaCode MCP 接入方案设计（2026-10-20）

> 纯调研 + 设计。DSH 源码只读（`target/tmp/dsh-extract-20261019/dsh/node_modules/@deepseek-ai/`）。本文件不改产品代码、不碰在途文件、不构成实施授权。

## 0. 背景与目标

调研 DSH（DeepSeek Harness）的 MCP 客户端实现，给出 SaCode 的 MCP 接入路径：哪些复用 DSH 设计、哪些按 SaCode 既有架构（仓颉 core 共享业务 + Host/CLI/桌面三入口）改写、哪些 RPC 与前端组件要新增。

DSH 是 Node + React + cordis 插件体系；SaCode 是仓颉静态库共享核心 + Electron（Vue runtime，无模块加载器）+ NDJSON/JSON-RPC Host。两边语言与运行时不同，**不能直接移植包**，但 MCP 协议层（stdio + JSON-RPC）与命名/状态语义可对齐。

---

## 1. DSH 实现摘要（逐条回答 6 个调研问题）

证据来自 `@deepseek-ai/dsh-mcp-client`（`lib/index.js` bundled）、`dsh-acp`、`dsh-client-ui-plugin-manager`、`dsh-client-ui-settings-plugin-inventory`、`dsh-plugin-manager`、`dsh-host-plugin-inventory`、`dsh-package-manifest`、`dsh-user-approval`。行号均指各包 `lib/index.js`（或 `lib/client.js`/`lib/types/index.js`）。

### 1.1 服务发现：静态配置，不做注册表/动态扫描

DSH 有**两条 MCP 声明路径**，都是静态配置：

- **profile 级（cordis 插件配置）**：`dsh-mcp-client` 作为 cordis 插件，每台 MCP 服务器是 `Config` 一条实例。schema 是 `z.union` 按 `transport` 判别（`dsh-mcp-client/lib/index.js:780-800`）：
  - stdio：`{transport:"stdio", serverName, command, args[], env{}, cwd, toolCallTimeoutMs(默认60000), failOnStartupError, maxInstructionBytes, reconnect}`
  - streamable-http：`{transport:"streamable-http", serverName, url, headers{}, …}`
  - `serverName` 唯一性由 `activeServerNames` WeakMap 在 `apply()` 里预留（`:809-822`），`SERVER_NAME_PATTERN=/^[A-Za-z0-9_-]{1,32}$/`（`:766`）。
- **ACP 会话级（`mcpServers` 参数）**：`dsh-acp/lib/index.js:216` `mountAcpMcpServers(agentCtx, servers, sessionCwd)` 校验 `mcpServers[]`（`type`/`command`（必须绝对路径）/`args`/`env`/`url`/`headers`），逐台调 `McpClient.apply` 挂载（`:228-257`、`:702`、`:721`）。ACP 请求可带 `params.mcpServers`（`:1177`、`:1223`），即**按会话/按任务**指定 MCP 服务器。

无文件系统扫描、无 mDNS/registry。发现＝读配置。MCP 服务**不在** `dsh-plugin-manager`/`dsh-package-manifest` 的 plugin/bundle manifest 里声明（五个目标包 grep `mcp` 0 命中）；MCP 与插件清单是两条独立机制。

### 1.2 连接握手：复用官方 MCP SDK，stdio + Streamable HTTP

- 传输工厂 `createTransport`（`dsh-mcp-client/lib/index.js:38-48`）：stdio→`StdioClientTransport`（SDK 负责 spawn 子进程）；http→`StreamableHTTPClientTransport(new URL(url), {requestInit:{headers}})`。
- 握手由 SDK `Client.connect(transport)` 完成（`:595-644`），本包传入 `versionNegotiation:{mode:"auto"}`（自动选最新协议并回退旧版）、`listChanged:{tools:{autoRefresh:false, onChanged:()=>refreshTools()}}` 订阅工具列表变更。本包自身不写 initialize/initialized 消息。
- Client 身份 `{name:"dsh-mcp-client", version:"0.0.1"}`，`capabilities:{}`。
- stdio 子进程环境 `scrubbedParentEnv()`（剔除 `KEY|PASSWORD|SECRET|TOKEN/i` 与 `DSH_*`）再叠加配置 `env`（`:26-31`）——不把父进程敏感变量泄给 MCP 子进程。
- README.zh.md:28：stdio 协商会先启动临时探测进程，再启动实际服务进程（实现细节在 SDK 内）。

### 1.3 工具列表：原子世代交换，`mcp__<server>__<rawName>` 命名

- 连接后 `client.listTools(undefined, {cacheMode:"refresh"})` 强制刷新（`dsh-mcp-client/lib/index.js:103-105`）。
- **原子世代交换** `syncTools`（`:127-161`）：先整批 fetch 构建下一代 `ToolDefinition` Map → dispose 上一代 → 注册新一代；fetch 失败保留旧工具；注册冲突（重名）回滚整批并返回空 Map（不让半批污染工具表）。
- 工具变更通过 SDK `listChanged` 通知触发 `refreshTools()` → `enqueueSync(generation)` 串行重同步（`:601-640`），避免并发世代交错。
- 命名 `publicToolName`（`:96-101`）：`mcp__<serverName>__<rawName>`；超长或含非法字符时 normalize 后追加 12 位 SHA-256 hash。与内置工具靠 `mcp__` 前缀天然区分，**公开名绝不发给服务器**——线上协议始终用 `rawName`。
- 工具定义 `createMcpToolDefinition` 把 `call` 回调绑成 `client.callTool({name:tool.name(rawName), arguments}, {signal, timeout, toolDefinition})`（`:109`、`:140-148`）。

### 1.4 工具调用：直通 SDK，取消/超时委托，不接审批

链路：模型 `tool_call` → ToolRuntime 执行 `createMcpToolDefinition` 返回的 `execute`（`:226-254`）→ `options.call(args, exec)` → `client.callTool({name:rawName, arguments}, {signal:exec.signal, timeout:toolCallTimeoutMs, toolDefinition})`。

- **取消**：`exec.signal`（ToolRuntime 传入的 AbortSignal）直接交 SDK，SDK 在协议层中断。
- **超时**：`toolCallTimeoutMs` 默认 `60000`（`DEFAULT_TOOL_CALL_TIMEOUT_MS=6e4`，`:764-765`），交 SDK 协议层执行。
- **结果校验**：`specTypeSchemas.CallToolResult` 校验返回；`result.isError===true` 抛 `Error(text)`（`:156-158`），把服务端语义错误当工具异常上抛，不伪装成功。
- **不接 dsh-user-approval**：`lib/index.js` grep `approval/approve` 0 命中，peerDeps 无 `dsh-user-approval`。取消/超时都委托 MCP SDK，本包不额外包 dsh-timeout（`dsh-timeout` 仅用于校验 reconnect 定时器上界 `MAX_TIMER_DELAY_MS`）。

### 1.5 连接状态：无显式状态机，supervisor 变量隐含 + 指数退避重连

- **没有面向 UI 的状态枚举**。状态隐含在 supervisor 变量：`client`/`closeClient`（有＝已连接）、`connectedAt`（有＝established）、`failedAttempts`、`reconnectTimer`（有＝backoff 等待）、`disposed`。状态变化只走 `ctx.logger` 的 `warn/info/error`，不暴露结构化 `status` 字段。
- **指数退避重连** `scheduleReconnect`（`:557-584`）：`delayMs=min(maxDelayMs, initialDelayMs*2^(failedAttempts-1))`，默认 `RECONNECT_DEFAULTS={enabled:true, initialDelayMs:500, maxDelayMs:30000, maxAttempts:10}`（`:433-439`）。
  - 连续失败 `maxAttempts` 次后**注销所有工具并停止重连**（`:195-197`）。
  - 连接持续超过 `maxDelayMs` 重置 `failedAttempts`（`:192`）。
  - 重连成功 `info` 日志（`:674`）；禁用重连时 `error` 日志并停（`:560-562`）。
- **UI 侧状态展示**（由 `dsh-client-ui-plugin-manager` + `dsh-host-plugin-inventory` 提供，与 mcp-client 解耦）：
  - Host 侧 `pluginInventory.list()` 即时读 `ctx.loader.entries()`（`dsh-host-plugin-inventory/lib/types/index.js:92-118`），返回 `fiberPhase ∈ {pending,loading,active,failed,unloading,null}` + `enabled`。
  - 前端 `PHASE_STATES` 把 fiber 阶段映射 4 色状态点：`idle/ongoing/done/error`（`dsh-client-ui-plugin-manager/lib/client.js:1884-1890`）。
  - 安装中状态前端自管：`idle→checking→starting→running→done|failed|cancelling|applying|unconfirmed|unknown`（`client.js:812-830`），由 `plugin-manager/install-state` 推送 + `plugin-manager/install-log` 流式日志驱动（`client.js:3688-3696`）。
  - **MCP 连接状态不单独建模**——MCP 客户端是 cordis 插件 fiber，其加载/失败走通用 fiber 状态机；mcp-client 自身的重连状态只在日志里，不进 `pluginInventory.list()`。

### 1.6 权限：本包不实现 MCP 审批，命名锚点留给上层

- `dsh-mcp-client/lib/index.js` grep `approval/allowlist/blocklist` **0 命中**，peerDeps 无 `dsh-user-approval`。
- `dsh-user-approval` 自身：会话级 `ask`/`never` 策略 + **仅一次性授权** `allowed-once`，**无 allow-always、无 allowlist/blocklist、无 per-tool-name 规则**（`dsh-user-approval/README.zh.md:12,28,155`）。其 README 说"工具流水线与沙箱 bash 工具会通过此 seam 路由 `ask`"——**没提 MCP 工具**。
- **稳定命名锚点**：README 多处强调 `mcp__<serverName>__<rawName>` 名 survive HMR/重新同步，权限规则可据此跨重启生效——但**锚点由谁消费、MCP 工具默认是否触发审批，不在本包源码内**（由 `dsh-tools`/ToolRuntime 决定，未读到直接证据，列为未决项）。

### 1.7 UI / 清单 / typert 协议（插件管理面，与 MCP 解耦）

- **插件清单**：DSH 无"一份 manifest 文件"概念。`dsh-package-manifest/lib/index.js` 是 `export {};`（纯 `package.json.dsh` 字段类型声明，类型在未发布的 `src/types.ts`）。profile 装哪些插件由 profile 目录 `package.json` 的 `dsh.profile.bundles`（有序列表）+ `cordis.patch.yml`（YAML 序列，条目 `{id, name?, insert?, disabled?}`）决定。启停写 `cordis.patch.yml` 的 `disabled` 字段（`dsh-plugin-manager/lib/types/patch.js:13-49`）；bundle 选择写 `package.json.dsh.profile.bundles`（`lib/types/index.js:755-780`）。
- **侧栏 Plugins 面板**（`dsh-client-ui-plugin-manager/lib/client.js`，React）：`PluginManagerPage` + `PackageCard`/`ItemCard`/`PackageDetail`/`RowsSection`/`InstallDialog`。卡片字段：包名/标题/描述/图标/版本 Tag/实验性 Tag/问题 Tag/启用开关。列表分"官方"（`optional && !installed`）与"已安装"两组，按短名排序，启停不挪动卡片。
- **设置页清单**（`dsh-client-ui-settings-plugin-inventory`）：**纯只读**，注册 `settings.plugins.tab`（id="all"），懒调 `ctx.remote.pluginInventory.list()` 取快照，不订阅变更、不调任何写入方法。与侧栏的区别：侧栏**写**（启停/安装/卸载/配置），设置页**读**（看所有 Loader 行状态/失败/出处 + agent preset 组合）。
- **typert 协议**：`typert.host.js`/`typert.remote-client.js` 是 `dsh-typert-generator` 从 FaceModel 生成的协议元数据（service/namespace/method/参数 zod/结果 zod），不是可调用对象。Host 用 `@Remote` 装饰器标注方法，Client 用 `ctx.remote.<namespace>.<method>` 调用。`dsh-plugin-manager` 暴露 `pluginManager/{listPlugins,listBundles,registries,inspect,setPluginEnabled,setBundleEnabled,installBundle,waitForInstall,cancelInstall,removeBundle,listVersionExemptions,setVersionExemption}`；`dsh-host-plugin-inventory` 暴露 `pluginInventory/list`；`dsh-client-ui-plugin-manager` 暴露 `pluginRegistryProbe/fastest`。重试不是独立 RPC，是前端再发 `installBundle`。

---

## 2. SaCode 现状对照

| 维度 | DSH | SaCode 现状 | 差距 |
|---|---|---|---|
| MCP 客户端（执行面） | `dsh-mcp-client`（Node，复用官方 SDK） | `core/src/mcp_client.cj`（仓颉，**自写** stdio + NDJSON JSON-RPC：`connect`/`listTools`/`callTool`/`close`，TurnToken 取消、单调钟 deadline 超时、fail-closed `McpOpResult`） | SaCode 已有等价执行面，**不依赖官方 SDK**（仓颉无 npm）；stdio only，无 streamable-http |
| 注册表（权限面） | cordis 插件 fiber + `activeServerNames` | `core/src/mcp.cj` `McpRegistry`（`register`/`deregister`/`list`/`isRegistered`，log-only `mcp/server` 事件） | 已有；但 register 只记名+transport，未持配置（command/args/env） |
| 工具命名 | `mcp__<server>__<rawName>`（+hash 兜底） | `core/src/mcp.cj:86` `mcpPublicToolName(serverName, rawName)` **同款** | 已对齐 |
| 重连 | supervisor + 指数退避（500ms→30s×2，maxAttempts 10，失败注销工具） | `core/src/mcp.cj:6` `McpReconnectPolicy.delayForAttempt(attempt)` **退避算法脚手架已有** | 算法在，**无运行中的 supervisor 循环**、无失败后注销工具的接线 |
| 配置加载 | cordis 插件配置 + ACP `mcpServers` 参数 | `apps/cli/worktree_command.cj:314-318` `--mcp-config` 路径冻结但 **BLOCKED（退 69）**，注释明说"本仓 CLI 至今没有 MCP 文件配置加载器" | **缺**：JSON 配置解析、`mcpServers[]` schema、Host/CLI 消费 |
| Host RPC 面 | typert `pluginManager/*`/`pluginInventory/list`（插件面，MCP 不单独建模） | Host 能力表（`docs/plans/host-capabilities.json`）有 `approval/*`/`extension/*`/`page/tool/*`/`team/approval/*`，**无 `mcp/*`** | **缺**：`mcp/*` RPC（list/connect/disconnect/tools/call/status） |
| 工具桥（MCP 工具进模型工具表） | `ctx.tools.register(definition)` 原子世代交换 | core 有 `McpToolInfo`，但**未接入模型 ToolRuntime**（模型工具表无 `mcp__*` 条目） | **缺**：McpToolInfo → ToolRuntime 注册桥、世代交换 |
| 审批 | 本包不接；`dsh-user-approval` 仅 `allowed-once`/`ask`/`never` | SaCode 有 `approval/ask`/`approval/answer`/`approval/set-mode`（plan/build/auto/yolo） | **未接**：MCP 工具调用是否走 `approval/ask` 未定义；建议与内置工具一致走工单 |
| UI | React 侧栏 Plugins 面板 + 设置页只读清单 | 桌面渲染层 Vue runtime，有插件页但**无 MCP 服务列表/状态** | **缺**：MCP 服务卡片、连接状态点、启停开关 |
| 子进程环境净化 | `scrubbedParentEnv()`（剔 KEY/PASSWORD/SECRET/TOKEN/DSH_*） | core spawn 未显式净化 MCP 子进程环境 | **缺**：env 白名单/黑名单 |

SaCode 已有的可复用资产：`McpClient`（执行面）、`McpRegistry`（权限面）、`mcpPublicToolName`（命名）、`McpReconnectPolicy`（退避）、`McpResourceRequest`（资源脚手架）。**核心闭环差四段**：配置加载、Host `mcp/*` RPC、工具桥（MCP 工具进模型表 + 审批）、UI + 重连 supervisor。

---

## 3. 推荐接入路径

按 SaCode「共享 core + Host/CLI/桌面三入口」架构组织，不引入 npm 依赖（仓颉 core 自写 MCP 协议层已在）。

### 3.1 配置加载（core + CLI/Host）

- 在 core 新增 `McpServerConfig`（对齐 DSH `Config`）：`{serverName, transport:"stdio"|"streamable-http", command, args[], env{}, cwd, toolCallTimeoutMs(默认60000), reconnect:{enabled,initialDelayMs:500,maxDelayMs:30000,maxAttempts:10}, failOnStartupError}`。`serverName` 正则 `^[A-Za-z0-9_-]{1,32}$`，重名拒绝。
- core 新增 `McpConfigLoader.parse(jsonText)`：解析 `mcpServers[]`（采用 DSH ACP 的会话级数组形态，最贴近实际用法），返回 `ArrayList<McpServerConfig>`。schema 校验失败 fail-closed，不静默丢条目。
- CLI `--mcp-config <path>` 接 `McpConfigLoader`：读取文件→解析→随会话注入 core `McpRegistry`。当前 `worktree_command.cj` 的 BLOCKED（退 69）改为真实消费；路径已在 chdir 前转绝对（既有逻辑保留）。
- Host `initialize` 时按会话注入 `mcpServers`（对应 DSH ACP `params.mcpServers`），会话级隔离。

### 3.2 Host RPC 面（新增 `mcp/*` 命名空间）

参照现有 `approval/*`/`extension/*` 命名约定，新增（写入 `docs/plans/host-capabilities.json` 与 `apps/host/src/main.cj` 分派）：

| RPC | 作用 | 对应 DSH |
|---|---|---|
| `mcp/list` | 列已注册 MCP 服务器及连接状态（serverName/transport/status/toolsCount/lastError） | `pluginInventory/list`（只读投影） |
| `mcp/connect` | 按配置 connect 一台服务器（spawn+握手+listTools） | `McpClient.apply` |
| `mcp/disconnect` | 关闭一台服务器（dispose 子进程，不留孤儿） | `connection.dispose` |
| `mcp/tools` | 拉取某服务器的工具清单（强制 refresh） | `client.listTools({cacheMode:"refresh"})` |
| `mcp/call` | 调用某工具（serverName+rawName+argumentsJson） | `client.callTool` |
| `mcp/status` | 查单台连接状态（connected/reconnecting/failed/lastAttempt） | supervisor 变量结构化暴露（DSH 没有，SaCode 需补） |

约束：`mcp/call` 只收 `approvalId`（与 `toolCall`/`extension/call` 一致），渲染层传自报审批字符串没有通路——审批走工单。`mcp/call` 的取消复用现有 `turn/cancel`/`TurnToken`；超时用 `toolCallTimeoutMs`。

### 3.3 工具桥（MCP 工具进模型工具表 + 审批）

- core 新增 `McpToolBridge`：`McpClient.listTools` 返回的 `McpToolInfo[]` 经 `mcpPublicToolName` 命名后，注册进模型 ToolRuntime 的工具表（`mcp__<server>__<rawName>`）。**原子世代交换**：先整批构建下一代 → dispose 上一代 → 注册新一代；fetch 失败保留旧工具；重名回滚整批（对齐 DSH `syncTools`）。
- 模型 `tool_call` 命中 `mcp__*` 前缀时，`McpToolBridge` 路由到 `McpClient.callTool(rawName, args)`；`isError===true` 抛错不伪装成功（core 已有该语义）。
- **审批**：MCP 工具调用走现有 `approval/ask` 工单（与内置 write/edit 一致），按工具名粒度（`mcp__<server>__<rawName>`）发审批；`plan` 模式禁所有 `mcp__*`，`build` 模式按工单，`auto`/`yolo` 按档位。**不另建 allowlist/blocklist**（DSH 也没有；SaCode 现有 `approval/set-mode` 已足够）。命名稳定即可跨重启复用审批状态（对齐 DSH 锚点思路）。
- MCP 工具的 `toolCallTimeoutMs` 默认 60000，可被配置覆盖；取消信号经 `TurnToken` 传到 `McpClient`（core 已实现）。

### 3.4 重连 supervisor（core）

- core 新增 `McpConnectionSupervisor`：包住 `McpClient`，按 `McpReconnectPolicy.delayForAttempt` 调度重连（已有算法）；连续失败 `maxAttempts` 次后**注销该服务器的所有工具**（对齐 DSH `:195-197`）；连接持续超过 `maxDelayMs` 重置计数。
- 状态结构化暴露（DSH 未做、SaCode 需补）：`{status:"connected"|"reconnecting"|"failed"|"disconnected", failedAttempts, lastError, connectedAt}`，供 `mcp/status` 与 UI 读。这是相对 DSH 的改进点（DSH 只进日志）。
- 重连只针对 stdio（子进程崩溃）；streamable-http 的传输恢复归 SDK/传输层（首版可只支持 stdio）。

### 3.5 子进程环境净化（core）

- core spawn MCP 子进程前 `scrubParentEnv`：剔除名匹配 `KEY|PASSWORD|SECRET|TOKEN`（不区分大小写）与 `SA_CODE_*`/`SACODE_*` 敏感前缀的变量，再叠加配置 `env`。对齐 DSH `:26-31`，避免把宿主凭据泄给 MCP 子进程。

### 3.6 前端组件（桌面渲染层，Vue runtime）

桌面是 Vue runtime + `h()`（无模块加载器、无模板编译器），新增页面遵循既有 `renderer/pages/` 模式（构建期 esbuild 折叠）：

- **MCP 服务列表页**（`renderer/pages/mcp-servers.ts`）：卡片列表，每台展示 `serverName`/transport/状态点（`connected`绿/`reconnecting`琥珀/`failed`红/`disconnected`灰）/工具数/`lastError`/启用开关。状态从 Host `mcp/list` 投影读（订阅 `mcp/changed` 事件）。启停调 `mcp/connect`/`mcp/disconnect`。
- **连接状态点**：复用现有权限菜单的配色语言（plan 蓝/build 绿/auto 琥珀/yolo 红）做状态点，不引入新设计系统。
- **工具调用展示**：MCP 工具结果走现有消息渲染器的 `role==="tool"` 分支（已有 ToolRole），审批工单走现有 `approval/ask` UI。
- **设置页 MCP 标签**（只读清单，可选二期）：对齐 DSH `ui-settings-plugin-inventory` 的只读姿态，调 `mcp/list` 取快照，不订阅、不写。

### 3.7 IPC 面（桌面 preload）

新增 IPC key（`apps/desktop/preload.cjs` 顶层，门禁 138→扩充）：`sacode.mcpList`/`mcpConnect`/`mcpDisconnect`/`mcpStatus`（`mcp/call` 走现有 `toolCall`+`approvalId`，不另开通道）。同步改 `test/bridge.test.mjs` 与 `check_ipc_surface_parity.cjs`。

---

## 4. 风险与边界

- **stdio 优先，streamable-http 二期**：DSH 的 streamable-http 重连归属 README 标"未决定"（开源设计问题）；SaCode 首版只做 stdio，HTTP 传输恢复留待二期，避免引入未决设计。
- **不引官方 MCP SDK**：仓颉 core 无 npm，`McpClient` 已自写 stdio+JSON-RPC；继续自维护，不偏离。代价：协议版本协商需手动跟 MCP 规范演进（DSH 靠 SDK `versionNegotiation:"auto"`，SaCode 需自己实现回退）。
- **审批一致性**：MCP 工具走 `approval/ask` 工单，与内置工具同档位同语义；**不**给 MCP 工具开后门（`auto`/`yolo` 仍按档位放行，`plan` 全禁）。DSH 不接审批是 DSH 的选择，SaCode 这里**比 DSH 更严**（SaCode 全程审批是核心卖点）。
- **工具世代交换并发**：`listChanged` 通知 + 重连可能并发触发 syncTools；core 须串行化（DSH 用 `enqueueSync` 队列），SaCode 用现有 turn/lease 机制串行，不并发注册。
- **子进程孤儿**：`McpClient.close()` 已强杀子进程（core 注释"断开时强杀，不留孤儿"）；重连失败路径要保证旧子进程 dispose，再启新世代。
- **环境净化不能误删 MCP 自身所需变量**：`scrubParentEnv` 黑名单只剔敏感命名，保留 `PATH`/`SystemRoot`/`TEMP` 等；MCP 配置 `env` 覆盖最后生效。
- **`--mcp-config` 与会话级 `mcpServers` 两入口**：CLI 文件配置用于长期；Host 会话级 `mcpServers` 用于按任务注入。两路径都经 `McpConfigLoader` + `McpRegistry`，不各写一套。
- **UI 不是 cordis fiber**：DSH 的 fiber 状态机不适用 SaCode；SaCode 用 `mcp/list` 投影 + supervisor 结构化 status 字段，前端按 4 色点渲染。这是架构差异，不是缺陷。
- **命名冲突**：`mcp__<server>__<rawName>` 超长时 SaCode `mcpPublicToolName` 已有 hash 兜底（与 DSH 同款）；重名整体回滚。
- **未验证项（DSH 源码未答）**：MCP 工具在 DSH 是否实际触发审批（由 `dsh-tools`/ToolRuntime 决定，不在 mcp-client 包内）；DSH 连接状态机是否对外暴露结构化字段（supervisor 只返回 `{ready,instructions,resources,dispose}`，无 status）；stdio "临时探测进程"细节在 SDK 内。SaCode 设计上对这两项**主动补齐**（审批走工单、status 结构化）。

## 5. 不在范围

- 不实施、不写产品代码、不改 core/Host/CLI/桌面源码。
- 不碰其他方在途文件（`renderer/pages/permission-menu.ts`、`product-design.css` 等）。
- 不提交、不推送。
- MCP resources/prompts（DSH README 标"不受支持"）首版不做。
- streamable-http 传输、MCP OAuth 元数据发现首版不做。
- 插件市场（`docs/interfaces/README.md:21` 的"Skill/MCP 宿主分派缺口"）是更大范围，本方案只覆盖 MCP 客户端接入，不覆盖市场分发。

## 6. 取证索引

DSH（`target/tmp/dsh-extract-20261019/dsh/node_modules/@deepseek-ai/`）：
- `dsh-mcp-client/lib/index.js`：Config schema `:780-800`、`createTransport` `:38-48`、Client/connect `:595-644`、`syncTools` `:127-161`、`publicToolName` `:96-101`、call 回调 `:140-148`、`createExecutor` `:226-254`、`RECONNECT_DEFAULTS` `:433-439`、`scheduleReconnect` `:557-584`。
- `dsh-acp/lib/index.js`：`mountAcpMcpServers` `:216-257`、`mcpServers` 参数 `:702,721,1177,1223`。
- `dsh-host-plugin-inventory/lib/types/index.js:46-62,92-118`：fiber 状态映射 + `pluginInventory.list`。
- `dsh-client-ui-plugin-manager/lib/client.js`：`PluginManagerPage` `:3307-3754`、`PackageCard` `:2217-2252`、`PHASE_STATES` `:1884-1890`、安装 store `:812-830`、事件订阅 `:3688-3696`、RPC 调用 `:1044-1083,1339-1522`。
- `dsh-client-ui-settings-plugin-inventory/lib/client.js:760-799`：只读 `settings.plugins.tab`。
- `dsh-plugin-manager/lib/types/patch.js:13-49`、`lib/types/index.js:755-780,161-186`、`lib/typert.host.js:386-391`。
- `dsh-user-approval/README.zh.md:12,28,155`。

SaCode：
- `core/src/mcp_client.cj:221-371`（`McpClient` connect/listTools/callTool/close）、`core/src/mcp.cj:6-199`（`McpReconnectPolicy`/`mcpPublicToolName`/`McpRegistry`）、`core/src/mcp_client_test.cj`（真 Node MCP 服务器夹具）。
- `apps/cli/src/worktree_command.cj:28-32,314-318,680`（`--mcp-config` BLOCKED）。
- `docs/plans/host-capabilities.json:16-58,107-113`（现有 RPC 命名空间）。
- `docs/interfaces/README.md:21`（MCP 宿主分派缺口登记）。
