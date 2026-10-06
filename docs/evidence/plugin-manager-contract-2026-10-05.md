# 插件管理器有限 IPC 契约与分步接线方案（2026-10-05）

本文定义「插件管理器」页面到仓颉后端的契约面：Electron 通道、逐字段校验规则、错误码、仓颉侧需要新增的 Host 方法，以及分几步落地、每步验收什么。渲染层适配器与单测已在本轮落地；仓颉真源与主进程通道尚未落地，本文不将其称作完成。

## 0. 结论摘要

| 项 | 状态 |
| --- | --- |
| 渲染层适配器（`read`/`dispatch`/`subscribe`） | ✅ 本轮已接 `window.sacode.*` 有限通道，见 `apps/desktop/renderer/pages/plugin-manager-adapter.ts` |
| 页面挂载传入 adapter | ✅ `apps/desktop/renderer/app.js` 第 1418 行一带已传 `adapter:self.pluginManagerAdapter` |
| 适配器单测（13 条，`node --test` 可跑） | ✅ `apps/desktop/test/plugin-manager-adapter.test.mjs`，**13 tests / 13 pass / rc=0** |
| 契约文档（本文件） | ✅ |
| 主进程 `preload.cjs` / `main.cjs` 通道 | ⬜ Step A，改动清单见 §9（由 Lead 落地，本会话不改这两个文件） |
| 仓颉 `plugin/*` Host 方法与插件档案真源 | ⬜ Step B/C，方法名与真源要求见 §8 |
| `plugin-manager/changed` 事件推送 | ⬜ Step D，§7 |

硬约束（本轮已遵守）：**没有伪造 packages 快照，没有用 JS 本地存储保存 enabled 状态冒充已接后端。** 通道缺失时适配器整体不接线（`createSacodePluginManagerAdapter` 返回 `null`），页面保持 `unconnected` 并显示「仓颉插件安装管理接口尚未接入」；通道不齐时缺哪条就拒哪条（`plugin-channel-missing:<capability>`），界面按钮照实禁用并列出缺哪些通道。适配器与单测里出现的所有包数据都是**测试用例在通道边界上现造的桩**，不是产线快照，也不被产线代码引用。

## 1. 上游契约依据

冻结提交 `639ed015397290b3745d163aafe02ffee4aa3f84`，已下载源码 `D:\Temp\SaCode-official-639ed015\plugin-manager-manager-store.ts`：

- 开头注释即硬规则：**“Every fact comes from the Host — the store re-reads after each action and after every `plugin-manager/changed` event, so a change made on another surface shows here without a manual refresh.”**
- 快照由 `pluginInventory.list()`、`pluginManager.listBundles()`、`pluginManager.listPlugins()` 三块拼成；`managementAvailable !== true` 时状态为 `unavailable` 且 `packages: []`（**不是错误**）。
- 行视图 `packageView(bundle, plugins)`：`enabled = live?.enabled ?? false`、`phase = live?.fiberPhase ?? null`，无 live entry 的行 `entryId` 缺席。
- 安装是独立状态机：`idle → checking → starting → running → applying → done | failed | cancelled`，外加 `unconfirmed`（应答丢失）/`unknown`（宿主已无此任务）。`unconfirmed` 与 `unknown` **都不是取消**。
- 关闭进行中的安装**保留 request 与输出**供重开；确认取消与返回编辑都**保留 spec**。
- 装机脚本授权（`pendingBuilds` / `approvedBuilds`）与安装、激活彼此独立；授权保存在 profile，之后不再询问。
- `installed`（安装）与 `enabled`（激活）是两个结果：装完默认不启用，由用户在「已安装」页显式启用。
- busy 列表按包名与 `row:<entryId>` 记账，只表示「这个动作正在过网」。

本仓 `apps/desktop/renderer/pages/plugin-manager.ts` 的 `Snapshot`/`Command` 形状与上述语义一一对应，适配器负责把宿主事实映射成该形状，**不新增页面字段**（只新增 `unwired?: string[]` 用于如实报告能力缺口）。

## 2. 通道总表

沿用 `sacode:` 前缀，「一个动作一条通道、逐字段校验」的有限集合；**不提供发任意方法的通道**。共 9 条。

| # | preload 顶层 key | 主进程 handler | Host 方法 | 方向 | 请求字段 | 响应 |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | `pluginsDescribe` | `sacode:pluginsDescribe` | `plugin/inventory` | 渲染层 → 宿主持久事实 | 无 | 清单视图 §3.1 |
| 2 | `pluginsSetEnabled` | `sacode:pluginsSetEnabled` | `plugin/bundle/set-enabled` | 写 profile | `{name, enabled, expectedRevision}` | 写后清单视图 |
| 3 | `pluginsSetRowEnabled` | `sacode:pluginsSetRowEnabled` | `plugin/entry/set-enabled` | 写 profile | `{entryId, enabled, expectedRevision}` | 写后清单视图 |
| 4 | `pluginsUninstall` | `sacode:pluginsUninstall` | `plugin/bundle/remove` | 写 profile | `{name, expectedRevision}` | 写后清单视图 |
| 5 | `pluginsRegistries` | `sacode:pluginsRegistries` | `plugin/registries` | 读安装源配置 | 无 | `{registry, fallbackRegistries, resolved}` |
| 6 | `pluginsInspect` | `sacode:pluginsInspect` | `plugin/install/inspect` | 读远端/本地规格 | `{spec, registry}` | `{status:'accepted'\|'refused', …}` |
| 7 | `pluginsInstall` | `sacode:pluginsInstall` | `plugin/install/start` | 起一次安装 | `{spec, registry, requestId, approvedBuilds}` | `{requestId, phase}` |
| 8 | `pluginsInstallPoll` | `sacode:pluginsInstallPoll` | `plugin/install/progress` | 轮询安装态 | `{requestId}` | 运行态视图 §3.4 |
| 9 | `pluginsInstallCancel` | `sacode:pluginsInstallCancel` | `plugin/install/cancel` | 请求取消 | `{requestId}` | `{cancelled}` |

通道 1–4 属 Step A/B（读 + 已装包启停卸载），5–9 属 Step C（安装能力）。渲染层已按 9 条全部接线；缺哪条，适配器就在 `unwired` 里报哪条。

### 2.1 为什么不设通用通道

`preload.cjs` 顶部注释已定调：「没有通用的 request(everything) 通道——那等于把宿主协议面整个交给网页。」插件面同理：`spec` 是**数据**不是命令行，宿主自己决定怎么解析（npm 名 / git 地址 / 本地目录）与怎么调 pnpm；渲染层说不出 `--registry`、`--unsafe-perm`、环境变量或工作目录。

### 2.2 凭据与授权边界

- 没有任何通道接收模型 baseUrl、API key、env、install script 内容或任意 Host 方法名。
- `registry` 只收 http(s) URL 或空串（空串 = 「pnpm 自己配置里那个源」）；私有源凭据仍留在本机 `.npmrc`，与安装对话框里的既定提示一致。
- `approvedBuilds` 只回传 pnpm 自己报上来的待授权包名，宿主**必须**拿它和自己的 pending 名单核对，不拿渲染层的数组当授权依据。
- `requestId` 由渲染层铸造（`crypto.randomUUID()`，失败退化成 `p<时间戳>-<随机>`），仅用于关联这一次安装；它**不是**授权凭据，宿主不得仅凭它放行任何 profile 写入。

## 3. 载荷逐字段规则

以下规则同时是宿主实现与适配器校验的依据。适配器侧已在 `normalizeInventory/normalizeRegistries/normalizeSubject/normalizeProgress` 实现；**缺字段、类型不符、出现重名包或重复 `entryId` 一律整份拒收，不猜默认值**（猜出来的清单就是伪造快照）。

### 3.1 清单视图（通道 1、2、3、4 的响应）

```jsonc
{
  "available": true,          // bool：本部署是否管理插件档案。false 时 packages 必须为 []
  "revision": 7,              // 非负安全整数：profile 修订号，写动作必须原样带回
  "packages": [ Package ]     // 数组；同名包不允许出现两次
}
Package = {
  "name": "@sample/plugin",              // 1..214，包身份（scope/name）
  "title": "示例插件",                   // <=214，展示名；缺省时由适配器取末段
  "version": "1.2.0",                    // <=64 或 null
  "description": "…",                    // <=2000 或 null
  "descriptionZhCN": null,               // <=2000 或 null
  "installed": true,                     // bool：profile 自己的依赖是否持有它
  "optional": false,                     // bool：是否为「官方、可启用、不可移除」
  "enabled": false,                      // bool：是否在 profile 的 layer 列表里
  "readOnlyReason": null,                // <=400 或 null：宿主为何拒绝停用/移除
  "error": null,                         // null 或 {"code":<=64, "reason":<=2000}
  "rows": [ Row ]                        // 数组；同一包内 entryId 不得重复
}
Row = {
  "rowId": "row0",                       // 1..214，bundle 声明的行 id
  "title": "组件0",                      // <=214 或 null
  "moduleName": "@sample/mod-0",         // <=214 或 null
  "entryId": null,                       // <=214 或 null：bundle 关闭时缺席
  "description": null, "descriptionZhCN": null,
  "enabled": false,                      // bool：无 live entry 时为 false
  "phase": null,                         // null | pending | loading | active | failed | unloading
  "readOnlyReason": null
}
```

映射到页面形状：`rowId → Row.id`、`title → Row.name`、其余同名；`error` 取 `reason || code` 作为页面上的错误文案。

### 3.2 写动作（通道 2/3/4）

| 字段 | 规则 |
| --- | --- |
| `name` | 1..214，非空、无控制字符；与清单里的包名精确匹配 |
| `entryId` | 1..214，非空、无控制字符；必须是清单里某个 row 的 live entryId |
| `enabled` | 必须为布尔；不接受 `"true"`/`1` |
| `expectedRevision` | **必填**，安全整数且 ≥ 1。缺失、`0`、负数、非整数、`Infinity` 一律 `-32020 missing-revision`；核心侧 `-1 = 无条件写` 只给 CLI 自测，**协议面不可达** |

冲突：修订号不匹配 → `-32031 plugin-conflict`。渲染层收到后重读清单再让用户重试，**不自动重放写动作**（自动重放会把「别人先改过」变成一次无声覆盖）。

### 3.3 安装源与规格（通道 5/6）

```jsonc
// plugin/registries
{ "registry": null, "fallbackRegistries": ["https://registry.npmmirror.com/"], "resolved": null }
// plugin/install/inspect
{ "status": "accepted", "name": "新插件", "host": null, "version": "2.0.0", "description": "…" }
{ "status": "refused", "problem": "no-matching-version", "reason": "没有 9.x" }
```

- `registry`：http(s) URL（≤300）或 `null`；`null` 表示「pnpm 自己配置里那个源」，界面上对应「默认安装源」。`resolved` 是宿主读到的 pnpm 实际源 URL，用于去重与展示。
- `fallbackRegistries`：≤ 20 个 http(s) URL；适配器按规范化 URL 去重后交给安装源选择器。
- `spec`：1..500，trim 后非空，无控制字符。**渲染层不解析它**，只做长度与空值校验。
- `problem` 取值（与页面上既有文案一一对应）：`already-installed`、`shipped`、`not-found`、`no-matching-version`、`invalid`、`unknown`。

### 3.4 安装运行态（通道 7/8 的响应）

```jsonc
// plugin/install/start
{ "requestId": "p…", "phase": "starting" }
// plugin/install/progress  —— 一次返回当前完整运行态（不是增量 chunk）
{
  "requestId": "p…",                       // 必须与请求里的 requestId 一致，否则视为答非所问
  "phase": "installing",                   // checking|installing|applying|cancelled|done|failed|unknown
  "subject": { "name": "新插件", "host": null, "version": "2.0.0", "description": null },
  "runs": [ { "jobId": "job1", "command": "pnpm add …", "cwd": "…", "output": "…", "exitCode": null } ],
  "registries": ["https://registry.npmjs.org/"],   // 本次已尝试的源，按顺序
  "total": 2,                              // 最多可能尝试几个源
  "failure": null,
  "installed": null, "restartRequired": false, "approvedBuilds": []
}
failure = {
  "code": "…", "reason": "…",              // reason <=2000，宿主诊断，界面原样呈现
  "kind": "network|timeout|disk-full|permission|integrity|build-blocked|…",
  "failedAt": "registry|spec-host",
  "pendingBuilds": ["@sample/build"],      // pnpm 留下待授权的安装脚本所属包
  "incompatible": [ { "name": "…", "version": "…", "runtimeVersion": "…", "peers": { "sacode": ">=2.0.0" } } ]
}
```

- `runs[].command` 是**已拼好的命令行字符串**（≤4000），不是 argv 数组；`output` ≤ 262144（宿主自带截断上限，超限必须显式标注，不能静默丢尾部）。
- `exitCode`：运行中缺席；被信号终止或从未启动时为 `null`；否则为非负整数。
- `phase: "unknown"` 表示**宿主已无此 requestId 的活跃任务且原始应答已丢失**；`phase: "cancelled"` 表示宿主确认已停止。
- 传输层失败（IPC 断、宿主无应答）**不是** `failed`：适配器把它落成 `unconfirmed` + `uncertainty`，等用户点「核对安装状态」。

## 4. 错误码

宿主 JSON-RPC 错误（主进程经 `HostBridge` 原样转成 `Error("<code> <message>")`，渲染层解析出稳定 code）：

| code | 数值建议 | 含义 | 界面行为 |
| --- | --- | --- | --- |
| `plugin-rejected` | -32030 | 参数/规格不合法 | 输入框下报错，不启动 |
| `plugin-conflict` | -32031 | `expectedRevision` 不匹配 | 提示「已被其他入口改过」，重读后可重试 |
| `plugin-not-found` | -32032 | 包或条目不存在 | 提示后重读清单 |
| `plugin-read-only` | -32033 | 官方/只读，不能停用或移除 | 界面本就把开关置灰，双保险 |
| `plugin-unavailable` | -32034 | 本部署不管理插件档案 | 等同于 `available:false` |
| `plugin-install-lost` | -32035 | 安装应答丢失/未确认 | `unconfirmed`，提供「核对安装状态」 |
| `plugin-install-not-running` | -32036 | 取消/核对一个不存在的任务 | 落到 `unknown` |
| `missing-revision` | -32020（既有） | 写动作没带修订号 | 同 `plugin-conflict` 的处理 |
| `turn-in-flight` | -32001（既有） | 轮次在途时禁写 | 提示先结算当前任务 |

`-32601 method not found` / `-32602 invalid params` / `-32700 parse error` 沿用既有语义。**`-32011/-32013`（js-host 相关）不得复用到插件面**，那会让「扩展宿主没起来」和「插件档案不可用」糊成一句错。

## 5. 渲染层适配器行为契约（本轮已实现）

文件：`apps/desktop/renderer/pages/plugin-manager-adapter.ts`；页面经 `plugin-manager.ts` 再导出 `createPluginManagerAdapter` / `createSacodePluginManagerAdapter`，`app.js` 只调用后者（内部用 `window.sacode` 绑定）。

1. **出厂绑定**：`createSacodePluginManagerAdapter(api)` 在没有 `api.pluginsDescribe` 时返回 `null` → `app.js` 传 `adapter: undefined` → 页面 `unconnected`。**不造一个只会报错的适配器冒充已接线。**
2. **能力清单**：依据 preload 顶层 key 是否真实存在，产出 `unwired: ['enable'|'uninstall'|'install']`；页面据此禁用对应按钮并写明缺哪些通道。
3. **读合并**：`read()` 只在「首次 / 有脏标记 / 显式 refresh」时穿透宿主；纯本地编辑（改 spec、选源、开关详情、关提示、取消确认）不产生 IPC。每次穿透都按整份视图重算，**不做增量合并**。
4. **脏标记**：任何可能改动宿主事实的动作后置脏，页面随后那次 `read()` 必然重读——对应上游「after each action」。
5. **修订号**：写动作一律带最近一次成功读到的 `revision`；冲突时先重读再抛出带 `code` 的错误，交由页面提示。
6. **busy**：动作在途期间把包名 / `entryId` 放进 `busy`，失败与成功都清掉；busy 只是「正在过网」，不是状态。
7. **安装轮询**：`plugin/install/progress` 每 750ms 一次，最多 800 次（≈10 分钟）后落 `unconfirmed`；每次有变化都通过 `subscribe` 通知页面重读。`dispose()` 必须停表（页面 `onBeforeUnmount` 已调用）。
8. **关窗即取消（pending 相位）**：`starting/running/cancelling/unconfirmed` 下关窗会发一次 `plugin/install/cancel` 并把相位改成 `cancelling`；取消请求失败不影响关窗本身，相位原样保留等核对。非 pending 相位关窗只隐藏。
9. **实例生命周期**：适配器由 `app.js` 单例持有；`dispose()` 只表示「当前视图走了」——停轮询、清订阅；下一次 `read`/`dispatch` 自动重新武装。重 mount 不自动重读宿主（没有新事实就不穿透，与上游 `ensure()` 只在 `idle` 时加载一致），要新事实就走显式「刷新」。
10. **失败措辞**：宿主错误码翻成固定中文（§4 的界面行为列）；未知码原样带出，不吞。跨 realm/IPC 回来的错误对象也按 `message` 解析，**不用 `instanceof Error`**（认不出来会把宿主的拒绝码降级成一句「传输失败」）。
11. **禁用写法**：`available:false` → `packages: []`；没有任何分支会用默认包、示例包或上次读取冒充当前事实。

## 6. 单测（已交付，`node --test` 可跑）

`apps/desktop/test/plugin-manager-adapter.test.mjs`，用 esbuild 把 `.ts` 编成 cjs 后在同一进程内以 `vm` 运行（与 `client-slots.test.mjs` 同法），**不加载 Vue、不起 Electron、不 spawn 宿主**：

```
node --test test/plugin-manager-adapter.test.mjs
→ # tests 13 / # pass 13 / # fail 0 / rc=0
```

覆盖：载荷逐字段校验（含重名包、重复 entryId、非法 phase）；`available:false` 不伪造；字段映射；本地编辑不穿透；显式刷新必穿透；修订号透传与冲突自愈；卸载先本地确认；安装全流程（含「列表里已有的名字问宿主之前就拒」、规格被拒不启动、脚本授权重试、完成高亮与重读清单）；取消未确认保留 spec；结果丢失与 `unknown`；pending 相位关窗即请求取消；标签页关掉再打开不永久停在读取失败；定时轮询通知订阅方且 `dispose` 后停止；通道不齐时 fail-loud 且不写本地状态；出厂绑定把 9 个 preload key 逐一接到通道上；以及静态守卫（三份源码不出现 `localStorage`/`sessionStorage`/`indexedDB`/`eval`/`new Function`，`app.js` 必须传 adapter）。

## 7. 分步落地与每步验收

### Step A —— 主进程通道 + 宿主读面（最小可用）

改动：`preload.cjs` 加 `pluginsDescribe`；`main.cjs` 加 `sacode:pluginsDescribe`；仓颉加 `plugin/inventory`。

验收：
1. `node --test test/models-ipc.test.mjs test/plugin-manager-adapter.test.mjs` 全绿（前者确认没碰坏既有 IPC 面）。
2. `apps/desktop/test/bridge.test.mjs` 增补一条：`initialize` 的 capabilities 含 `plugin/inventory`；`plugin/inventory` 在无 profile 时返回 `{"available":false,"revision":0,"packages":[]}`。
3. 手工打开插件管理器：`unconnected` 文案消失，显示「本部署没有可管理的配置，无法安装或启停插件。」，`document.querySelectorAll('[data-package-name]').length === 0`。**这一步的正确表现就是「一个包都没有」**，任何包出现都说明在伪造。
4. 冒烟：`test-support/plugin-manager-smoke.cjs` 第一条断言里的 `unconnected:…includes('尚未接入')` 需改为「无 profile 文案 + 无 data-package-name」；在改之前 Step A 不算过（否则是拿旧断言蒙混）。

### Step B —— 已装包的启停与卸载

改动：通道 2/3/4 + Host 方法 `plugin/bundle/set-enabled`、`plugin/entry/set-enabled`、`plugin/bundle/remove`，落到带修订号的 profile 持久化。

验收：
1. 写一个真实 profile（目录或内置 bundle 均可），`available:true`，卡片与行开关出现；`卸载` 按钮可点。
2. 关掉一个 bundle：宿主真的把它移出 layer 列表，**重开应用后仍是关的**（证明写在 profile，不在内存或 localStorage）。
3. 制造一次修订号冲突（两个入口同时改）：界面得到 `plugin-conflict`，重读后能重试；**不存在无声覆盖**。
4. `node --test` 全量绿（不得破坏既有用例）。

### Step C —— 安装能力

改动：通道 5–9 + `plugin/registries`、`plugin/install/inspect`、`plugin/install/start`、`plugin/install/progress`、`plugin/install/cancel`；仓颉侧需要 pnpm 子进程管理（输出捕获、取消、退出码结算）与 `pnpm-workspace.yaml` 的 build 审批名单。

验收：
1. 装一个真实 npm 包：`installed:true` 且**默认未启用**；点「立即启用」后重开应用仍启用。
2. `spec-host` 网络失败时界面给出 GitHub 恢复入口且**不自动切源**；`registry` 全失败时列出真实尝试过的源。
3. `pendingBuilds` 出现时必须显式授权；授权后重试成功，且授权写入 profile（下次不再问）。
4. 取消在 `starting` 与 `running` 都不得宣称「已停止」；宿主回 `too-late` 时进入 `applying` 且取消按钮消失。
5. 杀掉宿主进程：轮询落 `unconfirmed`，不落 `failed`；重启后「核对安装状态」能拿到真实结果。
6. 装机输出超过 12 行时折叠、可展开；`exitCode` 未确认时明说「退出码未确认」。

### Step D —— 跨界面变更可见（`plugin-manager/changed`）

两个可选实现，任选其一，**都不新增「任意方法」通道**：

- D-1 事件推送：宿主在 profile 变更后发出 `plugin-manager/changed` 通知 → 主进程把 `HostBridge.notifications` 排空（当前该数组无人消费）→ `webContents.send('sacode:pluginsChanged')`；`preload.cjs` 加 `pluginsSubscribe(cb)`，适配器 `subscribe` 收到即重读。这是上游语义的对应物。
- D-2 轻量轮询：页面挂载期间适配器每 5s 读一次 `pluginsDescribe`，卸载即停。实现最小，代价是常开时有持续 IPC。

当前唯一的其他界面（设置 → 内置插件）是只读投影，因此**在 Step D 之前，「另一个界面改了这里不刷新」这条缺口是已知的**，界面保留手动「刷新」按钮；不得因此宣称已完成上游事件语义。

## 8. 仓颉侧需要新增的 Host 方法

宿主面（`apps/host/src/main.cj`）需新增一组 `plugin/*` 方法，并登记进 `initialize` 的 `capabilities`。派发风格沿用 `providerSurfaceRequest`：一个函数收口、逐字段取值、失败原样带码回传。

| Host 方法 | 需要的 core 真源 | 返回 | 备注 |
| --- | --- | --- | --- |
| `plugin/inventory` | 插件档案（bundle 列表 + 每个 bundle 的行 + live entry 的 enabled/phase） | §3.1 | 读侧；与 `model/registry/describe` 同级，不依赖会话租约 |
| `plugin/registries` | 安装源配置（当前源、回退源、pnpm 实际解析值） | §3.3 | 读侧 |
| `plugin/install/inspect` | 规格解析（npm 名 / git / 本地目录） | §3.3 | 不写盘 |
| `plugin/install/start` | 安装任务账目 + pnpm 子进程 | §3.4 | 一次一任务；`enabled:false` 起步 |
| `plugin/install/progress` | 安装任务账目（含输出缓冲与退出码） | §3.4 | **一次返回完整运行态**，省掉 chunk 缝合 |
| `plugin/install/cancel` | 安装任务账目 | `{cancelled}` | 已进收尾则回 `too-late` |
| `plugin/bundle/set-enabled` | profile 写入 + 修订号 | 写后清单 | 需 `expectedRevision` |
| `plugin/entry/set-enabled` | profile 写入 + 修订号 | 写后清单 | 需 `expectedRevision` |
| `plugin/bundle/remove` | profile 写入 + 修订号 | 写后清单 | 需 `expectedRevision` |

core 侧（`core/src/`，唯一业务真源）需要的最小新增：

1. **PluginProfile**：用户级档案文档（YAML/JSON 均可，风格对齐 `ProviderRegistry`/`GlobalAppearanceSettings`），带单调 `revision`；用 `WriteLease` 或同級租约防并发覆盖；损坏时拒绝加载而不是回退空档案。
2. **Bundle / Entry 投影**：bundle 的 `rows` 声明 + live entry 的 `enabled`/`fiberPhase`，`packageView` 那条 join 规则在 core 做（**不在渲染层做**），保证两个入口看到同一份 join 结果。
3. **装配**：启停 bundle/entry 要真的改 live 注册表（当前 `extReg` 那一层），不是只改档案。卸载要撤销工具、监听、界面贡献与所属进程——这条与 `docs/evidence/plugin-lifetime-architecture-2026-10-05.md` 记录的生命期要求是同一条。
4. **安装执行**：spawn pnpm、按 chunk 收 stdout/stderr、可取消、退出码结算；`pnpm-workspace.yaml` 的 build 审批名单读写；输出缓冲带上限（§3.4 的 262144）。
5. **不变量**：`installed` 与 `enabled` 分离；官方/optional 包 `readOnlyReason` 必须给出；turn 在途时**读面与安装族放行、写面（启停/卸载）以 `-32001 turn-in-flight` 拒绝**（与模型配置面在途策略一致，避免在跑的轮次脚下换工具集）。

## 9. 主进程改动清单（交给 Lead）

> 本会话不改 `preload.cjs` / `main.cjs`（与模型中心会话共享）。以下为可直接落地的逐条改动，落地后需同步 `apps/desktop/test/bridge.test.mjs`。

### 9.1 `apps/desktop/preload.cjs`

在 `contextBridge.exposeInMainWorld("sacode", { … })` 里追加（第 66 行 `});` 之前）：

```js
  // 插件管理器：一个动作一条通道，字段形状由主进程守卫；没有「发任意方法」通路。
  pluginsDescribe: () => ipcRenderer.invoke("sacode:pluginsDescribe"),
  pluginsSetEnabled: (name, enabled, expectedRevision) => ipcRenderer.invoke("sacode:pluginsSetEnabled", { name, enabled, expectedRevision }),
  pluginsSetRowEnabled: (entryId, enabled, expectedRevision) => ipcRenderer.invoke("sacode:pluginsSetRowEnabled", { entryId, enabled, expectedRevision }),
  pluginsUninstall: (name, expectedRevision) => ipcRenderer.invoke("sacode:pluginsUninstall", { name, expectedRevision }),
  pluginsRegistries: () => ipcRenderer.invoke("sacode:pluginsRegistries"),
  pluginsInspect: (spec, registry) => ipcRenderer.invoke("sacode:pluginsInspect", { spec, registry }),
  pluginsInstall: (request) => ipcRenderer.invoke("sacode:pluginsInstall", { spec: request.spec, registry: request.registry, requestId: request.requestId, approvedBuilds: request.approvedBuilds }),
  pluginsInstallPoll: (requestId) => ipcRenderer.invoke("sacode:pluginsInstallPoll", { requestId }),
  pluginsInstallCancel: (requestId) => ipcRenderer.invoke("sacode:pluginsInstallCancel", { requestId }),
```

（Step D 若选事件推送，再加 `pluginsSubscribe: (callback) => { const handler = () => callback(); ipcRenderer.on("sacode:pluginsChanged", handler); return () => ipcRenderer.removeListener("sacode:pluginsChanged", handler); }`。）

### 9.2 `apps/desktop/main.cjs`

在 `sacode:modelsList` 一带之后追加：

```js
// 插件管理器：读面与写面分开。写面一律要求修订号，缺失/非法在主进程就拒。
const PLUGIN_NAME_RE = /^[^\x00-\x1f\x7f]{1,214}$/;
const REGISTRY_URL_RE = /^https?:\/\/\S{1,300}$/;
const REQUEST_ID_RE = /^p[0-9A-Za-z-]{8,64}$/;
function pluginRevision(args) {
  if (!args || !Number.isSafeInteger(args.expectedRevision) || args.expectedRevision < 1) throw new Error("bad-revision");
  return args.expectedRevision;
}
ipcMain.handle("sacode:pluginsDescribe", async () => withHost(() => bridge.request("plugin/inventory")));
ipcMain.handle("sacode:pluginsRegistries", async () => withHost(() => bridge.request("plugin/registries")));
ipcMain.handle("sacode:pluginsSetEnabled", async (_e, args) => {
  if (!args || !PLUGIN_NAME_RE.test(args.name) || typeof args.enabled !== "boolean") throw new Error("bad arguments");
  return withHost(() => bridge.request("plugin/bundle/set-enabled", { name: args.name, enabled: args.enabled, expectedRevision: pluginRevision(args) }));
});
ipcMain.handle("sacode:pluginsSetRowEnabled", async (_e, args) => {
  if (!args || !PLUGIN_NAME_RE.test(args.entryId) || typeof args.enabled !== "boolean") throw new Error("bad arguments");
  return withHost(() => bridge.request("plugin/entry/set-enabled", { entryId: args.entryId, enabled: args.enabled, expectedRevision: pluginRevision(args) }));
});
ipcMain.handle("sacode:pluginsUninstall", async (_e, args) => {
  if (!args || !PLUGIN_NAME_RE.test(args.name)) throw new Error("bad arguments");
  return withHost(() => bridge.request("plugin/bundle/remove", { name: args.name, expectedRevision: pluginRevision(args) }));
});
ipcMain.handle("sacode:pluginsInspect", async (_e, args) => {
  // spec 是数据不是命令行；registry 只接受 http(s) 或空串（空 = pnpm 自己配置里那个源）
  if (!args || typeof args.spec !== "string" || !args.spec.trim() || args.spec.length > 500
    || (args.registry !== undefined && args.registry !== "" && !REGISTRY_URL_RE.test(args.registry))) throw new Error("bad arguments");
  return withHost(() => bridge.request("plugin/install/inspect", { spec: args.spec.trim(), registry: args.registry ?? "" }));
});
ipcMain.handle("sacode:pluginsInstall", async (_e, args) => {
  if (!args || typeof args.spec !== "string" || !args.spec.trim() || args.spec.length > 500
    || !REQUEST_ID_RE.test(args.requestId)
    || (args.registry !== undefined && args.registry !== "" && !REGISTRY_URL_RE.test(args.registry))
    || !Array.isArray(args.approvedBuilds) || args.approvedBuilds.length > 50
    || !args.approvedBuilds.every((b) => PLUGIN_NAME_RE.test(b))) throw new Error("bad arguments");
  return withHost(() => bridge.request("plugin/install/start", { spec: args.spec.trim(), registry: args.registry ?? "", requestId: args.requestId, approvedBuilds: args.approvedBuilds }));
});
ipcMain.handle("sacode:pluginsInstallPoll", async (_e, args) => {
  if (!args || !REQUEST_ID_RE.test(args.requestId)) throw new Error("bad arguments");
  return withHost(() => bridge.request("plugin/install/progress", { requestId: args.requestId }));
});
ipcMain.handle("sacode:pluginsInstallCancel", async (_e, args) => {
  if (!args || !REQUEST_ID_RE.test(args.requestId)) throw new Error("bad arguments");
  return withHost(() => bridge.request("plugin/install/cancel", { requestId: args.requestId }));
});
```

### 9.3 测试同步（Lead 执行）

- `apps/desktop/test/bridge.test.mjs`：按 2026-10-05 实测重数 preload 顶层 key 数（改前 42），新增插件 9 条后应为 51；补 `initialize` capabilities 含 9 个 `plugin/*` 方法；补一条「无 profile 时 `plugin/inventory` 返回 `available:false` 且 `packages: []`」。
- `apps/desktop/test-support/plugin-manager-smoke.cjs` 第 6 行 `unconnected:` 断言需按 Step A 验收第 4 条改写；否则 Step A 无法被冒烟捕获。
- `docs/plans/dsh-capability-matrix.md` 与 `docs/evidence/plugin-manager-backend-gap-2026-10-05.md` 在 Step A 落地后需要回写状态。

### 9.4 不需要主进程改动的地方

- 卸载确认对话框、安装对话框的开关与折叠、toast/notice、`busy` 记账都在适配器与页面里，**不占通道**。
- 安装源选择器的自定义地址校验（`validRegistry`）已在渲染层，主进程按 §9.2 再校一次（纵深，不重复实现语义）。

## 10. 明确不做 / 禁止

- 不用 JS 本地存储或内存变量保存 `enabled` 冒充已接后端；单测第 11 条对此有静态守卫。
- 不预制 packages 快照，不用示例包填充列表；唯一允许出现包数据的地方是测试桩。
- 不提供 `request(method, params)` 式通用通道，不把 `spec` 当命令行执行，不让渲染层指定工作目录、环境变量或 pnpm 参数。
- 不在仓颉真源缺失时宣称插件管理器已接通；未完成步骤按 §7 的验收逐条核。
