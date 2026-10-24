# A12「一切皆插件」差距审计（2026-10-06）

用户第 4 条目标追加的口径：「SaCode 的复刻必须遵循**一切皆插件**」。这一条在仓库里已经是强制验收条件
（`docs/product/PRD.md` A12），本文只做一件事：**用源码证据判它现在离条件有多远**，不写实现。

## 0. 判据（原文，不改写）

> A12 | 插件装配架构 | 工具/模型/业务服务/前端贡献各选代表插件，在两入口验证依赖激活、缺依赖拒绝、
> 配置变更、初始化失败回滚、停用卸载和作用域隔离；**安装新插件不修改 agent loop 或入口业务分派**；
> 固定硬编码能力或仅工具回调不得判通过

「仅工具回调不得判通过」这一句直接排除了用 `extjs` 现有 24 条用例交差的可能。

## 1. 决定性发现：安装态与运行态是两个互不相干的世界

| 世界 | 真源位置 | 它认识什么 |
| --- | --- | --- |
| 安装态 | `core/src/plugin_store.cj`（manifest 解析、四步原子安装、`plugins.log` 事件真源、租约互斥、逐包降级） | `sacode.plugin.json`、包名/版本/种类/依赖/工具声明 |
| 运行态 | `core/src/extproc.cj` + `extjs/host.cjs`（NDJSON JSON-RPC 子进程） | 一个**调用方直接给进来的文件路径** |

三条互锁的证据：

1. `extjs/host.cjs` 全文没有 `sacode.plugin.json` 这个字符串——它 `require(abs)` 装载，
   从不读包里的 manifest。装载依据是路径，不是包身份。
2. `PluginManifest.dependencies` 在整个仓库里**只有一处赋值**（`plugin_manifest.cj` 的 `init`），
   没有任何消费者。依赖表被解析、被存储、被丢弃。
3. `plugin-kind-not-wired`（装配层应当拒掉未接种类时用的码）**只存在于注释里**
   （`plugin_manifest.cj:22`），全仓无一处实现。装配层不存在。

结论：**装一个插件，对可调用工具集合没有任何影响**。因此 A12 现在判 `FAIL`，
且失败原因不是"覆盖不全"，而是"两个世界之间没有桥"。

## 2. 四类贡献逐类现状

| 贡献类型（manifest `kind` 闭集已定满五类） | 现在能力的真源 | 经插件吗 | 代表插件 |
| --- | --- | --- | --- |
| `tool` | `extjs` ToolRegistry；另有三个内置名 `todo_write/read/write` 硬编码在 `agent.cj` 的 ToolRuntime.pipeline | 半：能调，但入口是手填路径 | 测试夹具 `@local/sacode-tool-echo` |
| `model` | `ProviderRegistry` + `saCodeCatalog`（13 家供应商目录写在核心） | 否 | 无 |
| `service` | goal / usage-ledger / prompt-enhance / session-title 等，宿主侧全部是 `if (method == "...")` 硬分派 | 否 | 无 |
| `ui` | `renderer/pages/*.ts` 静态挂载 + 构建期折叠的 vendor 包；插件管理器本身也是一张内置页 | 否 | 无 |
| `preset` | `subagent-settings.ts` / `client-slots.ts` 的配置形态 | 否（没有按 `kind=preset` 走） | 无 |

「安装新插件不修改 agent loop 或入口业务分派」这条目前**连可证伪的条件都不具备**：
新增一个能力现在必然要改宿主的 `if (method == ...)` 链——那正是 A12 禁止的动作。

## 3. A12 六个验证维度逐条判定

| 维度 | 判定 | 依据 |
| --- | --- | --- |
| 依赖激活 | FAIL | `dependencies` 无消费者（§1 证据 2） |
| 缺依赖拒绝 | FAIL | 没有任何地方能拒：没有装配步骤 |
| 配置变更 | BLOCKED（面向插件）| 包级 `enabled` 有事实与事件，但改它不影响运行态 |
| 初始化失败回滚 | 部分（仅运行态） | `extjs/test/lifetime.test.mjs` 8 条覆盖 setup 失败撤销登记、迟到发布禁止、异常释放账目（见 `plugin-lifetime-architecture-2026-10-05.md`）；作用对象是"已加载的扩展"，不是"安装的包" |
| 停用卸载 | 部分 | `PluginStore.setEnabled/uninstall` 有事件与目录动作、修订号冲突分档；停用对运行态无效（§1） |
| 作用域隔离 | FAIL | 没有 Scope 概念；`RouteScope` 是路由健康用的，与插件无关 |

矩阵侧的对应关系：`core`、`extensions` 两行此前已从 ✔ 打回 ◐（`plugin-lifetime-architecture-2026-10-05.md`
记录了打回理由），本文不重复改矩阵状态，只补一条判据：**桥接层（装配内核）本身是矩阵里没有行的新面**，
上游有（Cordis Loader/Scope/Service/effect），本仓无，因此它属于复刻欠账而不是自有增量。

## 4. 最小可判通过的样子（判据，不是计划）

要判 A12 通过，至少需要一座桥，而不是更多页面：

1. 装配入口以**包身份**而非路径为输入：读 `PluginStore` 的清单 → 按 `dependencies` 拓扑定序 →
   缺依赖即整条拒并给出被拒的包与缺的那条依赖。
2. 激活有真实阶段并落事件：`pending → loading → active → failed → unloading`
   （清单视图的 `phase` 字段已经在等这个事实，现在只有 `active`/空串两种值）。
3. 四类贡献各有**一条**经装配层进入的代表插件，且两入口都能观察到；`kind` 未接时拒成
   `plugin-kind-not-wired`，不再是注释。
4. 一条反证：新增一个包，`agent.cj` 的 pipeline 与宿主的 `if (method == ...)` 链**一行不改**也能被调到。
   这一条是 A12 末句的直接执行，也是将来判"通过"最省事的门禁形态。

## 5. 与并发会话的冲突披露（重要）

本文写作期间（10:00 前后），另一条线正在往 `apps/host/src/main.cj` 加插件宿主方法，
`apps/desktop/main.cjs` 同一分钟被修改。本节只登记事实与后果，不改他们的文件：

| 他们的写法（工作区态） | 后果 |
| --- | --- |
| `PluginStore("plugins")` | 相对路径，落在宿主 CWD 里。用户目录被绕过，两入口各看一份安装态；卸载会去删应用目录下的 `plugins/` |
| `jsonStr(body, "enabled") == "true"` | `jsonStr`（`main.cj:53`）按字面量 `"key":"` 搜索，只认**带引号**的值；NDJSON 里 `enabled` 是布尔，永远匹配不到 ⇒ 取回空串 ⇒ `== "true"` 恒假 ⇒ **启用动作每次都等价于停用**，而界面看到的结果是"我点了启用，它变回停用" |
| `jsonNum(body, "expectedRevision")` | `jsonNum`（`main.cj:212`）在字段缺失时返回 **-1**，而核心的 `guardRevision` 把 -1 当「无条件写」⇒ 不带修订号的写照样成功，契约 §3.2 明令「-1 在协议面不可达」这条直接失效。宿主本来就有为此而写的 `revisionOrReject()`（同文件 `main.cj:405`），这一片没有用它 |
| 写动作回 `\"{}\"` | 与契约 §2「响应=写后清单视图」和上游"动作后重读"两条都相反，界面必须再发一次 describe 才看得见自己刚做的改动 |
| `error` 序列化成字符串、`phase`/`readOnlyReason` 给空串 | 契约 §3.1 要 `error: null 或 {code,reason}`、`phase: null 或枚举`；渲染层适配器是逐字段严格校验，类型不符**整份拒收**，清单会直接显示不出包。**机制已直读核实**（`renderer/pages/plugin-manager-adapter.ts`）：`normalizePackage` 第 106 行要求 `raw.error == null` 或带 `code` 的对象，字符串走 `reject('plugin-inventory-rejected')`；`normalizeRow` 第 91 行要求 `phase` 为 null 或落在 `PHASES` 集合内，空串同样整份拒收。也就是说这一版接上后，界面上一个包都不会出现，而不是"少显示几个字段" |
| 方法名 `plugin/describe`、`plugin/uninstall`、`plugin/set-enabled` | 与契约 §2 通道表（`plugin/inventory`、`plugin/bundle/remove`、`plugin/bundle/set-enabled`）不一致，而 preload 与 `plugin-manager-adapter.ts` 已按那张表接线 |
| 单个错误码 `-32030` 装下所有失败 | 契约 §3.2 要求冲突 `-32031` 与"未找到"分档；合并后界面丢掉了「别人先改过，请重读」这条唯一可执行的信息 |
| `initialize` 的 `capabilities` 数组未加插件方法 | 违反本仓已成型规则「能力声明与实现同步」（提交 `f088177`） |
| `kind`、`directory` 进协议面 | 本机目录布局交给界面；契约 §3.1 的 Package 没有这两个字段 |

本线的核心侧改法（`asJson()` 收在 `PluginInventory/PluginPackageView/PluginRowView` 上、
`inspectSource()` 零副作用、`PluginStore.forUser()` 走用户目录）已经在
`core/src/plugin_store_test.cj` 的 4 条新用例里先红了再实现，与上面每一行都相反。
两条线要合成一条，需要有人显式裁决方法名与序列化归属——**建议以契约 §2/§3 为准**，
因为它已经是 `preload.cjs` 与 `plugin-manager-adapter.ts` 的既成依赖面。
