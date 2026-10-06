# 后端「一切皆插件」契约设计（2026-10-05）

> 任务：task-8。前置结论来自本次会话的只读审计 `backend-gap-audit-2026-10-05.md` §4.6：**后端插件化是 0**（`core/src` 搜 `plugin|Plugin` 只有 2 处命中，都在 `boot_actions_test.cj` 给 `BootSequence` 注册了个叫 `"plugins"` 的 stage 名）。
> 用户把「一切皆插件」定为**强制复刻要求**，涵盖工具、模型、业务能力、前端贡献及预设装配（`docs/product/PRD.md` §5 与 A12）。
>
> **本文件是契约设计，不是实现报告。** 已落地代码只有 step-1 两个新文件（`core/src/plugin_manifest.cj` + `plugin_manifest_test.cj`），**未经编译验证**——首次构建门禁见 §7.0。`apps/host/src/main.cj` 一行未改（见 §6 的理由）。

---

## 1. 取证结论：哪些是上游读到的，哪些是待核

这一节决定后面每一行的可信度，先把它钉住。

### 1.1 已拿到的上游证据（可用）

| 来源 | 形态 | 拿到了什么 |
| --- | --- | --- |
| 冻结目录树 `D:\Temp\SaCode-official-639ed015\tree.json` | 直接检索 | `packages/boot/plugin-manager`（12 src + 11 tests）、`packages/host/plugin-inventory`（2 src + 1 test）、`packages/extensions/{tool-cordis,ui-cordis,cordis-host-runner,cordis-client-runner}`、`packages/preset/{agent-preset,agent-preset-registry,persona}`、`packages/util/package-manifest`（2 src）的全部文件路径 |
| 2026-10-04 上游 63 模块直读账 `docs/evidence/upstream-module-reads-2026-10-04.md` | 直读摘要（14 模块 A 档 + 49 模块二手已复核，4 篇抽样对账） | boot / extensions / commands / skills / slots / scope / invariants / tools / system-prompt 九个相关模块的契约要点（下文逐条引用） |
| 已下载上游源码 `D:\Temp\SaCode-official-639ed015\` | 直接读 | `plugin-manager-manager-store.ts`（1169 行，客户端 store，含全部类型导入与 remote 调用点）、`PluginManagerPage.tsx`、`plugin-manager-presentation.ts`、`ui-settings-plugin-inventory-PluginInventorySettingsTab.tsx`、`ui-settings-plugins-*.tsx` |
| **本仓自己的** `apps/desktop/renderer/pages/plugin-manager-adapter.ts`（430 行）+ `plugin-manager.ts`（140 行）+ `apps/desktop/test/plugin-manager-adapter.test.mjs`（390 行） | 直接读 | **本研究里唯一可指认的、已经被测试钉住的契约面**：9 条通道、视图形状、错误码词表、`unwired` 降级纪律 |

### 1.2 读不到的上游正文（一律待核，不许猜）

| 待核项 | 为什么待核 | 对设计的影响 |
| --- | --- | --- |
| `packages/util/package-manifest/src/{index,types}.ts` | 未下载；本机 DSH 安装路径不可访问；`raw.githubusercontent.com` TLS/连接重置；`upstream.zip` 无有效 ZIP 中央目录 | **manifest 的字段名、类型、必填性是 SaCode 设计，不是上游复刻**。§2 的每一行都要在拿到正文后逐字段对账 |
| `.agents/notes/implemented/architecture/2026-09-05-package-manifest-types.md`、`2026-09-10-public-package-manifest.md` | 同上 | 同上；这两篇笔记最可能记录 manifest 的定型理由 |
| `packages/boot/plugin-manager/src/*.ts` 12 个文件 | 同上 | **安装态目录布局、原子性手法、`installBundle` 的连接检查与 `package.json` 还原、`cancelInstall` 三态、`ChangeResult.changed` 四值**只能从 2026-10-04 直读账转引（§3.2、§5.2），实现细节待核 |
| `packages/host/plugin-inventory/src/{index,types}.ts` | 同上 | Host 侧清单协议的字段名待核 |
| `packages/extensions/tool-cordis/src/*.ts`、`cordis-host-runner/src/*.ts` | 同上 | 插件工具如何过 Host 到达模型，协议待核 |
| `snapshots/session/plugin-manager{,-mcp}/cordis.yml`、`system-prompt.expected.md`、`tool-schemas.expected.json` | 冻结树可见，内容未读 | 「插件装配后系统提示与工具 schema 到底长什么样」的唯一现成参照，待核 |
| `packages/preset/agent-preset*/src/*.ts` | 未下载 | 「预设装配」这一支完全待核，本文只给接口占位 |

**因此本文件的定位**：契约的**消费面**（桌面 adapter 已经承诺的 9 条通道与视图形状）是硬的、可指认的；契约的**生产面**（manifest 字段、安装态布局）是 SaCode 设计，标了「待核」的地方在拿到上游正文后必须回头对账，对不上就改设计而不是改上游。

---

## 2. 插件 manifest 字段清单

文件：`<插件目录>/sacode.plugin.json`。格式选 JSON 而不是 npm `package.json`：本地包由用户手写或模型协助生成，需要一份**只描述插件自己**的文件；`package.json` 的 npm 专属字段（scripts/dependencies/devDependencies/peerDependencies）在本地安装路径上全是噪声，而 `sacode.plugin.json` 缺了就一定是缺了。**上游对应物 `packages/util/package-manifest` 待核**——若上游正文显示 manifest 就是 `package.json` 加少量扩展字段，则本表整体改为「读 `package.json` + 扩展字段」，§2 的校验规则不变。

### 2.1 字段表

| 字段 | 必需 | 类型 | 默认 | 校验规则 | 桌面侧对应 |
| --- | --- | --- | --- | --- | --- |
| `name` | ✅ | string | — | 非空；≤214；不含空白（32/9/10/13）与反斜杠（92，Windows 路径分隔符，永远禁）；不以 `.` 开头；**`/` 只允许作用域形态**——以 `@` 开头时必须恰好一个 `/` 且两侧非空，不以 `@` 开头时一个 `/` 都不许有 | `Package.name`（`isStr(raw.name, 214)`） |
| `version` | ✅ | string | — | 三段十进制 `x.y.z`，每段 ≤5 位；不带 prerelease/build 元数据 | `Package.version`（≤64） |
| `entry` | ✅ | string | — | 相对路径；≤300；**不含 `..`**；不含 `\`；必须以 `.cjs` 结尾 | 无对应（宿主私有） |
| `kind` | ◐ | enum | `"tool"` | 闭集 `tool`/`model`/`service`/`ui`/`preset`；未知值拒 | 无对应（宿主私有，装配分阶段接） |
| `title` | ◐ | string | 从 `name` 去 scope 派生 | ≤214 | `Package.title`（缺省时桌面同样做 `name.replace(/^@[^/]+\//,'')`） |
| `description` | ◐ | string | `""` | ≤2000 | `Package.description`（≤2000） |
| `descriptionZhCN` | ◐ | string | `""` | ≤2000 | `Package.descriptionZhCN`（≤2000） |
| `optional` | ◐ | bool | `false` | — | `Package.optional` |
| `enabled` | ◐ | bool | `true` | — | `Package.enabled` |
| `order` | ◐ | int | `0` | 未强制非负（与 provider 的 `sortOrder` 不同：这里的顺序只影响展示，不影响激活序） | 无对应 |
| `dependencies` | ◐ | string[] | `[]` | 每项非空 ≤214；**不得重复** | 无对应（激活序依据） |
| `sacode.runtime` | ◐ | string | `">=0.1.0"` | **只支持 `>=x.y.z` 一种形态**；`^`/`~`/`*`/区间一律拒 | `IncompatibleView.{name,version,runtimeVersion,peers}` |
| `tools` | ◐ | array | `[]` | 见 §2.2 | `Package.rows[]` |

◐ = 可选，但**缺省值只给「老包没有这个字段」的兼容位**；结构位（`name`/`version`/`entry`）一个默认值都不给。

### 2.2 `tools[]` 每项

| 字段 | 必需 | 校验 |
| --- | --- | --- |
| `name` | ✅ | 非空 ≤100；**不得与核心内置 `todo_write`/`read`/`write` 撞名**（独立错误码 `plugin-tool-shadowing`） |
| `description` | ✅ | ≤2000 |
| `params` | ◐ | 给了就必须是**合法 JSON 对象**；旧的空格参数声明（`"path content"`）一律拒 |
| `needsApproval` | ◐ | bool，默认 `false` |

`tools` 是**声明**，`entry` 模块的导出是**真源**（extjs 宿主要求模块导出 `{name, description, params, handler}`）。装配层必须逐字核对两者：名字对不上、描述对不上、`needsApproval` 对不上，整包拒（`plugin-declaration-mismatch`）。**声明与导出两张皮是插件化最容易出现的静默故障**——manifest 说免审批、模块说需要，模型侧看到的是前者，执行侧走的是后者。

### 2.3 禁字段时间

`apiKey` / `api_key` / `key` / `token` / `secret` / `value` / `password` / `authorization` 任一以非 null 出现 → 整份拒（`plugin-rejected`）。显式 `null` 合法（老包留着空键）。与 `provider_registry.cj` 同一份名单、同一条理由：**这份文档面上根本没有能承载明文的槽位**，而不是「存了但读的时候删掉」。

### 2.4 错误码

| 码 | 含义 | 桌面已有中文说明？ |
| --- | --- | --- |
| `plugin-rejected` | 结构/字段/禁字段/长度/版本/入口/schema 非法 | ✅（`plugin-manager-adapter.ts` 的 `REASONS`） |
| `plugin-tool-shadowing` | 工具名撞核心内置 | ❌ **待补**（见 §6.3） |
| `plugin-declaration-mismatch` | manifest 声明与模块导出不一致 | ❌ 待补 |
| `plugin-kind-not-wired` | 种类合法但本阶段不装配 | ❌ 待补 |

新码在桌面侧落到 `REASONS[m[2]] || m[2]`，会显示成原始码串。**这三个码必须由桌面 owner 补进 `REASONS`**——不在本次可写范围（§6.3）。

### 2.5 step-1 已落地的代码

`core/src/plugin_manifest.cj`（483 行）+ `core/src/plugin_manifest_test.cj`（208 行，15 条 `@Test`）。

- 解析层**不碰文件系统、不加载模块**：纯 `String` → `PluginManifest`。这样它能在没有 Node、没有插件的环境里被单测钉住，也是整个契约里唯一现在就能验证的一段。
- 全部只用本仓已证明的仓颉习语（`JsonValue.fromStr(...).asObject()`、`if (let Some(v) <- obj.get(k))`、`?? Int64(-1)`、`match (v.kind()) { case JsNull => ... }`）。**没有**把捕获循环变量的 lambda 递出去——宿主侧 `main.cj:1384` 已经踩过「仓颉不允许间接调用捕获可变变量的 lambda」这个坑，测试侧的取码助手因此改成收字符串参数而不是收 lambda。
- 反证用例写在同文件里：缺字段那条同时断言「补上 entry 就过」；撞名那条同时断言「不撞名的工具照过」；斜杠那条同时断言「`@local/x` 与无 scope 的 `echo-tool` 都照过」——转红归因于被测规则本身，不是整段代码挂掉。

**一次真 bug 与它的教训（2026-10-05 由统一验收抓出，已修）**：第一版把 `/`（47）无条件禁掉，注释写「路径分隔符必须禁，它会被当成目录用」。可 `@scope/name` 本身就含 `/`，那是 npm 包名语法。于是一切作用域包名都在最前面被通用码 `plugin-rejected` 拒掉，连锁两件事：3 条合法包用例抛异常（ERROR），6 条「拒绝类」用例断言的具体错误码被通用码盖住（FAILED）——**包括 `plugin-tool-shadowing` 那条，它本该转绿却拿着通用码**。根因是「一个判据承担了两件不相关的事」：`/` 既是路径分隔符也是包名分隔符，禁它的理由只对前者成立。修法是把判据拆成三条（无 `@` 不许有 `/`、有 `@` 必须恰好一个 `/` 且两侧非空、`\` 永远禁），并给每条单独一条用例，使三处变异各自只杀一条指名用例。**可迁移的教训：当一个字符/字段有两类语义时，把它写成一条禁令，前面那条通用拒绝会把后面所有具体规则都测不出来。**

---

## 3. 安装态落点

### 3.1 目录布局

```
<用户设置目录>/                      与 providers.log、credentials.env、外观设置同一个目录
├── providers.log                    既有：模型提供商注册表（事件日志即真源）
├── credentials.env                  既有：凭证分层
├── plugins.log                      新增：插件安装/启停/卸载的事件日志（真源）
├── plugins.log.lease                新增：写租约（与 session.log.lease 同机制）
└── plugins/                         新增：插件包内容
    ├── .staging-<pid>-<单调钟>/      安装中暂存（用完即删）
    └── <包名>/                       已安装包（包名即目录名，含 @ 与 / 需规整）
        ├── sacode.plugin.json
        └── *.cjs
```

包名到目录名的规整规则：`@local/sacode-tool-echo` → `local-sacode-tool-echo`（`@` 与 `/` 换 `-`，连续分隔符合一）。**规整必须可逆地记录在 `plugins.log` 事件里**（事件带原始 `name`），否则卸载时答不出「哪个目录是这个包的」。

### 3.2 原子性：四步，顺序不能反

上游 boot 模块（2026-10-04 直读，A 组）记了两条可直接采纳的纪律：`installBundle` **做连接检查**、**失败还原 `package.json`**。结合本仓 `attachment` 的 `persist-before-event`（先落对象、后追加事件）与 `publishNewFile`（落位时拒绝覆盖），落成：

1. **拷贝到 `.staging-<pid>-<ts>`**。中途失败 → 删 staging，**什么都不落**：日志里没有这个包，目录里也没有。
2. **在 staging 里解析并校验 manifest**（`parsePluginManifest`）。解析不过 → 删 staging，同上。校验不过绝不在落盘之后才发现——那时日志里已经有一条 `plugin/install`，回放会得到一个装不起来的包。
3. **原子落位**：`publishNewFile(staging, final)`。目标已存在 → `plugin-already-installed`，删 staging。**不覆盖**：覆盖等于把用户可能改过的插件内容悄悄换掉。
4. **拿租约、追加事件、flush、还租约**：`WriteLease(plugins.log).acquire()` → `plugin/install` → `flush()` → `release()`。拿不到租约 → `plugin-busy`（此时文件已落位但日志无记录，进入 §3.3 的孤儿处理）。

**为什么事件在文件之后**：与 attachment 同一条纪律。崩在 3 和 4 之间 → 目录里有一个没有事件的孤儿包，下一次安装同名会被 `publishNewFile` 挡下并报 `plugin-orphan-directory`；反过来（先事件后文件）会得到一条指向不存在目录的记录，**清单里永远显示一个「装了但打不开」的插件**，而用户没有任何办法修好它。前者是可见的、可清理的；后者是静默的、永久的。

**为什么必须用 `WriteLease`**：`ProviderRegistry.commit` 没用租约（`provider_registry.cj:562-572` 直接 load/append/flush），两个入口同时改 `providers.log` 会互相覆盖。插件安装期间有子进程在跑、界面在轮询，并发窗口比提供商配置大得多，所以这里**要**用租约，并且把「没用租约」列为 provider 侧的已知欠账而非可效法的先例。

### 3.3 损坏与孤儿处理

| 情形 | 检出点 | 行为 |
| --- | --- | --- |
| `plugins.log` 回放被拒（中段缺帧/尾帧撕裂） | `plugin/describe` | 回 `-32004 plugin-replay-rejected`，**不从空开始**。宿主在 `initialize` 即报 fault，不提供半份清单 |
| 有目录、无事件（崩在 3↔4 之间） | 安装时 `publishNewFile` 撞名 | `plugin-orphan-directory` + 提示清理命令；**不自动删**——那可能是用户刚装到一半的包 |
| 有事件、无目录 | `plugin/describe` 逐包核在 | 该包 `error: {code:'plugin-not-found'}`，其余包正常出。**不阻塞整份清单** |
| 有事件、有目录、manifest 解析失败 | 同上 | 该包 `error: {code:'plugin-rejected'}`，其余包正常出 |
| `entry` 模块 `require` 失败 | 装配时 | 该包 `phase:'failed'`（对应桌面 `PluginEntry.phase` 的 `failed`），不出现在工具表里 |
| 声明与导出不一致 | 装配时 | 整包拒装 `plugin-declaration-mismatch`，不出现在工具表里 |

**逐包降级、不连坐**：一个坏包只让自己坏。上游 skills 模块（直读，C 组）的 rank 分层与本仓 `plugins-page.ts` 的「失败优先排序」都要求坏包可见而不是消失——所以 `plugin/describe` 返回的 `packages[]` 里必须留着它并带 `error`。

---

## 4. 依赖激活规则（接 `BootSequence` 与 LIFO 回滚）

### 4.1 上游可采纳的四条

来自 2026-10-04 直读账：

- **boot**（A 组，322 行）：`PluginEntryId` 从 `listPlugins` 获取；`ChangeResult.changed` 报 `applied`/`restart-required`/`overridden`/`failed`。
- **scope**（C 组，60 行）：`Scope{ctx, rawDispose, dispose}`；`ScopedLayers` eager 全局层 + 惰性 exact-scope 层；`merge()` 按插入序全局具名条目后 scoped 遮蔽。
- **invariants**（B 组，88 行）：`Config{enabled?, package_allowlist?, package_blocklist?}`；**blocklist 优先于 allowlist**；每个工作区包拥有 `./invariant` 配套插件。
- **slots**（C 组，200 行）：`SlotMap` 编译期注册表；cardinality 四值 `single`/`list`/`keyed`/`chain`；scope 三值 `root`/`session-maybe`/`session`；`ctx.slots.renderSlot/inject`。

### 4.2 激活序：拓扑排序 + 一个 stage 一个插件

`dependencies: string[]` 声明依赖的插件名。激活时：

1. **Kahn 拓扑排序**。有环 → `plugin-dependency-cycle`，整批拒（不部分激活）。
2. **依赖未满足**（声明了但没安装/没启用）→ `plugin-dependency-missing`，整批拒。**不部分激活**：半激活态的插件集合并发起来，模型会看到一套互相引用但少了一半的工具。
3. 排序结果灌进**已有的** `BootSequence`：`boot.register("plugin:<name>", action)`，一个插件一个 stage，stage 名即 `plugin:<name>`。这直接复用 `boot.cj` 已经验证过的四条：按序执行、失败阶段不记成功且阻止重放（`boot-previously-failed`）、`run()` 幂等、`history()` 返回副本。
4. 每次激活/停用落 log-only 事件 `plugin/activate` / `plugin/deactivate`（对齐 `slots.cj` 的 `slots/register` + `slots/activate` 形态，事件不进 `isSurfaceEvent`）。

### 4.3 LIFO 回滚：`BootSequence` 不替我们回滚，必须自己来

`BootSequence.run()` 在任一 stage 抛异常时置 `failed = true` 并重抛，**已成功的 stage 不会被撤销**（`boot.cj:51-53`，`boot_actions_test.cj` 第二条用例正是钉这个：`observed.size` 停在 1）。所以插件层必须自己记 disposer 并**逆序**调用：

```
激活期：let disposers = ArrayList<() -> Unit>()
  for (name in 拓扑序) {
      let d = 激活一个插件(name)          // 成功才 push
      disposers.add(d)
  }
失败时：for (i in  disposers.size - 1 .. 0) { disposers[i]() }   // 严格 LIFO
```

与 `scope.cj` 的 `exit` 严格 LIFO（非栈顶抛 `scope-non-lifo`）是同一条纪律。**逆序而不是正序**：后激活的插件可能持有先激活者的引用，正序撤销会让前者在还有消费者时被拆掉。

### 4.4 allowlist / blocklist

采纳上游 invariants 模块的两条：`package_allowlist` 与 `package_blocklist` 都可选，**blocklist 优先于 allowlist**。落在插件配置里而不是 manifest 里——它是部署策略，不是包的自述。命中 blocklist → `plugin-blocked`，安装阶段就拒，不等激活。

---

## 5. 与 `ToolRegistry` / `ModelToolRuntime` 的接法

### 5.1 工具 spec 如何从插件表出来

链路（每一步都指向本仓已存在的具体位置）：

```
plugins/<包>/sacode.plugin.json
   │  ① parsePluginManifest（已落地，core/src/plugin_manifest.cj）
   ▼
PluginManifest.tools[]  ← 声明
   │  ② 装配层核对声明 vs 模块导出（extjs host.cjs 的 load() 要求
   │     {name, description, params, handler}，host.cjs:22-24）
   ▼
extjs ExtProcess.load(<包>/index.cjs)  →  describe(name) 拿回 {name, description, params}
   │  ③ 两边逐字一致才继续，否则 plugin-declaration-mismatch
   ▼
ToolSpec(name, description, params, needsApproval)     ← core/src/ext.cj:7
   │  ④ ToolRegistry.register(spec)                    ← core/src/ext.cj:25（重名返回 false）
   ▼
ModelToolRuntime.specs()                              ← core/src/model_tool_runtime.cj:29
   │  ⑤ 进 modelRequestJson 的 tools 段                ← core/src/model_request.cj:69-76
   ▼
真实模型看到的工具定义
```

### 5.2 需要改的两处（最小侵入）

**改动一：`ModelToolRuntime` 加 `plugins: Bool = false`**（对齐已有的 `files: Bool = false` 写法，`model_tool_runtime.cj:11`）。为 true 时把插件工具 spec 一并注册。宿主起轮时显式传 `files: true, plugins: true`——这同时修掉审计 §4.2 的「真实模型只能调 `todo_write`」。

**改动二：`ToolRuntime.pipeline` 加外部执行器注入点**（`agent.cj:193-221`）。现在 `pipeline` 只认 `todo_write`/`read`/`write`，其余名字落 `unknown-tool`。插件工具名会全部落进这个分支。所以要在内置三名之后、`unknown-tool` 之前插一段：

```
private func pipeline(name, args, allowedByGuard) {
    if (!allowedByGuard) { ...guard-denied... }
    if (name == "todo_write") { ... }
    if (name == "read") { return readStep(args) }
    if (name != "write") {
        // 插件工具：先问外部执行器，再判 unknown-tool。
        // 顺序不能反——反了就把「装了但执行器没接」伪装成「工具不存在」。
        if (let Some(out) <- pluginExecutor) { return pluginExecutor(name, args) }
        ...unknown-tool...
    }
    ...write 段...
}
```

`pluginExecutor` 由宿主注入：把 `(name, args)` 转成 extjs `ExtProcess.request(...)`，拿回的结果包成 `ApprovalOutcome`。**取消与在途记账必须走 `extproc.cj` 已有的 `callId` 配对**，不能新造一套——否则取消一个插件工具时，`turn/cancel` 的「顺带结算在途工具调用」那条腿（`main.cj:1424-1432`）对它无效。

审批：`needsApproval == true` 的插件工具必须走 `executeWithApproval`（`agent.cj:160`）的工单路径，与 `read`/`write` 同一条。**不能让插件工具绕过工单**——插件以用户权限运行，这是唯一能回答「谁批的」的地方。

### 5.3 上游 tools 模块的对账点（2026-10-04 直读，A 档）

上游 `ToolDefinition` = `ToolSchema` + `output: ToolOutputDefinition` + `execute` + `projectContent?`/`finalizeContent?`/`presentCall?`/`presentResult?`；waterfall 是 `tools/pre-execute`（allow/deny/ask）→ `tools/execute` → `tools/post-execute` → `tools/ptc-dispatch-log` → `tools/result` emit。

本仓四段管线（guard → 参数归一化 → snapshot → 执行 → 无损校验）与之意图一致，缺的是 `ToolRestriction`（per-scope allow/deny）与 `defineTool` DSL。**`ToolRestriction` 应该在做插件化时就接**：插件工具正是最需要按 scope 收窄的一类，否则「装了个插件」等于「所有会话都能用它」。

---

## 6. Host 侧 `plugin/*` 有限方法清单

原则与全仓一致：**按动作命名、逐字段校验、没有「发任意方法」通道**。方法名与桌面 `plugin-manager-adapter.ts` 已承诺的 9 条通道一一对应——那张表是上游 `ui-plugin-manager/manager-store.ts` 的移植，是本研究里唯一可指认的契约面，Host 必须长成它要的形状，而不是另发明一套让桌面再改。

| # | 方法 | 入参（逐字段校验） | 出参 | 失败码 |
| --- | --- | --- | --- | --- |
| 1 | `plugin/describe` | — | `{available, revision, packages[]}`，见 §6.1 | `-32004 plugin-replay-rejected` |
| 2 | `plugin/registries` | — | `{registry, fallbackRegistries[], resolved}` | 读不到不致命：回全 null/空数组，桌面退化成「默认安装源」 |
| 3 | `plugin/inspect` | `{spec, registry}` | `{status:'accepted', name, host?, version?, description?}` 或 `{status:'refused', problem, reason?}` | `-32020 plugin-rejected` |
| 4 | `plugin/install` | `{spec, registry, requestId, approvedBuilds[]}` | `{requestId, accepted:true}` | `-32020` 内容非法 / `-32001` 已有安装在飞 / `-32016 plugin-orphan-directory` |
| 5 | `plugin/install-poll` | `{requestId}` | `{requestId, phase, subject?, runs[], registries?, total?, failure?, installed?, restartRequired?, approvedBuilds?}` | `-32016 plugin-install-lost` |
| 6 | `plugin/install-cancel` | `{requestId}` | `{cancelled:true}` / `{tooLate:true}` / `{notRunning:true}`（上游 boot 三态） | — |
| 7 | `plugin/set-enabled` | `{name, enabled, expectedRevision}` | `{changed, revision}` | `-32020 settings-rejected` / `settings-conflict` |
| 8 | `plugin/set-row-enabled` | `{entryId, enabled, expectedRevision}` | 同上 | 同上 |
| 9 | `plugin/uninstall` | `{name, expectedRevision}` | 同上 | 同上 |

外加一条**事件通道**：`plugin-manager/changed`（上游 manager-store 注释原文：「re-reads after each action and after every `plugin-manager/changed` event, so a change made on another surface shows here without a manual refresh」）。桌面 adapter 的 `subscribe` 已经留了入口，只差宿主往订阅帧里推。

### 6.1 `plugin/describe` 的返回形状（逐字段对齐桌面 `normalizeInventory`）

```
{
  "available": true,
  "revision": 3,                       // = plugins.log 事件条数，CAS 用
  "packages": [
    {
      "name": "@local/sacode-tool-echo",     // ≤214，必填
      "title": "回声",                        // ≤214，缺省从 name 派生
      "version": "0.1.0",                     // ≤64
      "description": "...",                   // ≤2000
      "descriptionZhCN": "...",               // ≤2000
      "installed": true,                      // 必填 bool
      "optional": false,                      // 必填 bool
      "enabled": true,                        // 必填 bool
      "readOnlyReason": null,                 // ≤400，内置提供时非空
      "error": null,                          // 或 {code, reason?}
      "rows": [                               // 包内组件（entryId = 插件条目 id）
        {
          "rowId": "echo",
          "title": "回声",
          "moduleName": "@local/sacode-tool-echo",
          "entryId": "echo",
          "description": "...",
          "descriptionZhCN": "...",
          "enabled": true,
          "phase": "active",                  // pending/loading/active/failed/unloading/null
          "readOnlyReason": null
        }
      ]
    }
  ]
}
```

**host 侧也必须做同一套长度与去重校验**：桌面 `normalizeInventory` 对重名包、重复 `entryId`、越界长度一律整份拒收（`plugin-inventory-rejected`）。宿主放宽一点，用户看到的就是「读不到插件」而不是「这个包名太长」。§2.1 的上限表就是为此逐字段对齐的。

### 6.2 安装阶段机（对齐桌面 `InstallProgressView.phase` 闭集）

宿主相位 → 桌面相位（`HOST_PHASE` 已在 `plugin-manager-adapter.ts:195-197` 定死，不可改）：

| 宿主 | 桌面 | 说明 |
| --- | --- | --- |
| `checking` | `checking` | 解析 spec、做「连接检查」（上游 `installBundle` 纪律） |
| `installing` | `running` | 拷贝 + 校验 + 落位 + 追加事件 |
| `applying` | `applying` | 已进入收尾，**不可取消**（上游 `cancelInstall` 的 `too-late`） |
| `cancelled` | `idle` | 取消完成，回到可编辑 |
| `done` | `done` | 装好；`restartRequired` 决定要不要重启 |
| `failed` | `failed` | `failure` 带 `{code, reason?, kind?, failedAt?, pendingBuilds?, incompatible?}` |
| `unknown` | `unknown` | 后端没有这个安装任务（崩溃后重启的既有形态） |

`failedAt` 闭集 `registry`/`spec-host`；`incompatible[]` 每项 `{name, version, runtimeVersion, peers{}}`。**`pendingBuilds` 是安装脚本授权面**：未经显式授权绝不让安装脚本以用户权限运行（上游 manager-store 的 `approve-builds` 流程，桌面 `plugin-manager.ts:119` 已实现交互）。

### 6.3 桌面侧接线（不在本次可写范围，列给 desktop owner）

`apps/desktop/renderer/pages/plugin-manager-adapter.ts:412-429` 的 `createSacodePluginManagerAdapter(api)` **已经写好**，只认 9 个 preload 顶层 key：

```
pluginsDescribe  pluginsSetEnabled  pluginsSetRowEnabled  pluginsUninstall
pluginsRegistries  pluginsInspect  pluginsInstall  pluginsInstallPoll  pluginsInstallCancel
```

缺任一 → 工厂整体返回 `null` → `app.js:187-189` 传 `undefined` → 页面保持 `unconnected` 并列出缺哪条（`plugin-manager.ts:132-133`）。**所以桌面侧要做的只有两件事**：

1. `preload.cjs` 加这 9 个 key（一个动作一条 `ipcRenderer.invoke`，逐字段校验），`main.cjs` 加对应 handler 转 Host NDJSON；
2. 把 §2.4 的三个新错误码补进 `REASONS`（`plugin-manager-adapter.ts:46-54`），否则用户看到原始码串。

`test/plugin-manager-adapter.test.mjs:340-370` 已经钉住「9 个 key 全部被适配器使用」和「缺 key 时 unwired 列出 enable/uninstall/install」——**preload 一接上，这两条就是现成的验收**。

---

## 7. 实现顺序与每步验收（顺序不能反）

### 7.0 第一道门禁（**在任何后续步骤之前**）

```
cd core && cjpm test --no-progress
```

必须全绿，且新增的 12 条 `plugin*` 用例在列。**这两个新文件未经编译验证**——本次会话按约束没有运行构建。若编译不过，先修这两个文件再往下走；**不要**带着编译不过的 manifest 层去写安装层。

验收口径：`TOTAL` 中 `plugin*` 前缀 12 条全 PASS、0 FAIL、0 ERROR；`cjpm test success`、rc=0。反证：把 `builtinToolNames` 里的 `"read"` 删掉，`pluginManifestRejectsToolShadowingCoreName` 必须转红而其余 11 条照绿。

### 7.1 step-2：安装态（`core/src/plugin_store.cj`）

**做什么**：目录布局（§3.1）+ 四步原子安装（§3.2）+ 损坏处理（§3.3）+ `plugins.log` 事件回放 + `revision` CAS。

**做到什么算完成**：
- 一条 `plugin/install` 事件落盘后，新建 `PluginStore` 实例能回放出同一个包（不依赖进程内状态）；
- 安装到第 2 步失败（manifest 非法）时，目录里没有 `.staging`、`plugins.log` 一条事件都没有；
- 崩在 3↔4 之间（手工造出有目录无事件）时，`describe()` 不列这个包，再次安装同名报 `plugin-orphan-directory`；
- `plugins.log` 中段挖掉一帧后 `describe()` 回 `plugin-replay-rejected`，不返回半份清单；
- 两个实例同时安装不同包，只有一个成功，另一个 `plugin-busy`。

### 7.2 step-3：依赖激活（`core/src/plugin_activation.cj`）

**做什么**：拓扑排序 + `BootSequence` 灌 stage + LIFO disposer 回滚 + allowlist/blocklist。

**做到什么算完成**：
- A 依赖 B，只装 A → `plugin-dependency-missing`，**B 也没有被激活**；
- A→B→C 成环 → `plugin-dependency-cycle`，一个都没激活；
- C 的 setup 抛异常 → A、B 已激活的都被逆序撤销，`boot.history()` 里没有 C，且再次 `run()` 抛 `boot-previously-failed` 而不是重试；
- blocklist 命中 → 安装阶段就 `plugin-blocked`。

### 7.3 step-4：工具装配（`core/src/plugin_tools.cj` + 改 `model_tool_runtime.cj` / `agent.cj`）

**做什么**：§5 的链路 + 两处最小侵入改动。

**做到什么算完成**：
- 装一个本地包 → `extension/list` 里出现它声明的工具，`needsApproval` 与 manifest 一致；
- manifest 声明 `echo`、模块导出 `echo2` → 整包拒 `plugin-declaration-mismatch`，工具不出现在列表里；
- `ModelToolRuntime(log, false, files: true, plugins: true)` 的 `specs()` 含内置三名 + 插件工具；
- **反证**：把 `plugins: true` 改回 `false`，真实模型用例必须转红（这是审计 §4.2 的同一条反证，一次做两用）。

### 7.4 step-5：Host `plugin/*` 九个方法 + `plugin-manager/changed`

**做什么**：§6 全表 + 能力表登记。宿主已有 `providerSurfaceRequest` 那套 `expectedRevision`/`settings-conflict`/`settings-rejected` 的模式（`main.cj:401-572`）可直接照抄。

**做到什么算完成**：
- `initialize` 能力表新增 9 条；`plugin/describe` 的返回能通过桌面 `normalizeInventory` 的逐字段校验（把那份 normalize 逻辑在宿主测试里复述一遍，或直接调 node 侧单测）；
- `set-enabled` 带过期 `expectedRevision` → `settings-conflict`，且盘上 `revision` 没变；
- 安装跑到 `applying` 时取消 → `tooLate`；
- 崩溃后重启，`plugin/install-poll` 对旧 `requestId` 回 `unknown`。

### 7.5 step-6：真实模型闭环（**总验收**）

> **本地插件包声明的工具能进 `extension/list` 并被真实模型调用。**

拆成可执行的一句：用 `step-5-preview` @ `https://api.stepfun.com/step_plan/v1`，装一个本地插件包（声明一个 `echo` 工具），发一句「请调用 echo，参数 text=你好」，然后：

1. `extension/list` 里有 `echo`，`needsApproval` 与 manifest 一致；
2. `session.log` 里有 `tool/call`（`echo`）与 `tool/result`，且 `tool/result` 正文是模块真实返回值；
3. `turn/poll` 结算 `finishReason == "stop"`、`interrupted == false`、模型续答非空；
4. 冷进程重启后 `session/projection` 仍能回放这条 `tool/result`；
5. 日志里不含模型凭据；
6. 卸载该包后 `extension/list` 里没有 `echo`，且再调它回 `unregistered-tool`。

**反证**（每条都必须让上面某一条转红）：
- 把 `plugins: true` 摘掉 → 第 1、2 条红；
- 把 `pluginExecutor` 注入删掉 → 第 2 条红在 `unknown-tool:echo`；
- 把 LIFO 回滚改成正序 → step-3 的那条红。

### 7.6 step-7 及以后（不在本次范围，只登记）

- `model`/`service`/`ui`/`preset` 四类种类的装配（§2.1 的 `kind` 闭集已留位）；
- `ToolRestriction` per-scope 收窄（§5.3）；
- 前端贡献：插件经 `slots` 注入 Vue 组件（接 `core/src/slots.cj` 与桌面 `SlotCore`）；
- 预设装配：`agent-preset` / `persona`（上游 `packages/preset/*` **完全待核**，拿到正文前不动手）；
- HMR：上游 `packages/boot/hmr`、`packages/client/hmr`，待核。

---

## 8. 总验收标准（一句话）

> **本地插件包声明的工具能进 `extension/list` 并被真实模型调用。**

在此之前的所有步骤都只是让这句话可被执行；这句话本身不可再拆成「接口通了」或「测试条数够了」——它要求一次真实的 `step-5-preview` 往返，模型自己决定调用一个由本地插件包提供的工具，仓颉执行它，结果落进 `session.log`，冷进程能回放。

---

## 9. 本次实际改动与未做事项

### 9.1 已写（4 个新文件）

| 文件 | 行数 | 内容 |
| --- | --- | --- |
| `core/src/plugin_manifest.cj` | 483 | `PluginManifest` / `PluginToolDecl` / `parsePluginManifest` / `shortPluginName` + 全部校验。**不碰文件系统、不加载模块** |
| `core/src/plugin_manifest_test.cj` | 208 | 15 条 `@Test`，含 6 处反证 |
| `core/src/plugin_store.cj` | 535 | 安装态（step-2）：`PluginStore` / `PluginRecord` / `PluginPackageView` / `PluginInventory` / `slugOf` + 四步原子安装 + 事件回放 + 逐包降级 |
| `core/src/plugin_store_test.cj` | 283 | 8 条 `@Test`，覆盖契约 §3 的六类行为，每类带反证 |

只用了本仓已证明的仓颉习语；刻意避开了三处没有先例的写法：`Option` 与 `nil` 的比较（改用 `?? Int64(-1)`）、把捕获循环变量的 lambda 递出（取码助手改收字符串/收参数）、丢弃有值表达式（读一次字段让「结果被使用」成立）。

### 9.2 门禁状态（2026-10-05，由 Lead 统一执行）

- **manifest 层：15/15 全绿**（`cd core && cjpm test --no-progress`，TOTAL 630 / PASSED 628 / SKIPPED 2 / FAILED 0 / ERROR 0）。第一版曾把 `/` 无条件禁掉，导致 9 条红（3 ERROR + 6 FAILED），根因与修法见 §2.5。
- **store 层：未过门禁**。`plugin_store.cj` + `plugin_store_test.cj` 落盘晚于那次 630 的绿跑，**下一次 `cjpm test` 才第一次覆盖它们**。

### 9.3 与契约的一处有意偏离（落码时定型）

契约 §3.2 的字面顺序是「落位 → 拿租约 → 追加事件 → 还租约」。`plugin_store.cj` 实际把租约提前到 `rename` 之前持有，跨过 rename + append + flush 再释放。理由：字面顺序下 `acquire()` 失败时目录已经落位，一次「忙」会永久变成一个孤儿包；持有租约后 acquire 失败时盘上什么都不留，回 `plugin-busy`。「事件在文件之后」这条实质纪律两种顺序都满足。

另一处小的：`leaseForLog()` 在拿租约前先 `Directory.create(base)`。少了这一行，第一次安装前拿租约会因目录不存在而失败，却被报成 `plugin-busy`——一个和「忙」无关的误导性错误。

### 9.4 未做（及理由）

- **`apps/host/src/main.cj` 一行未改**：宿主侧改动排在 step-5（§7.4），前面有 step-2/3/4 三道可单独验证的闸。带着未验证的新增面改宿主，任何一次红灯都分不清是谁的。
- **`apps/desktop/` 一行未改**：硬性约束。桌面侧只缺 preload key 与错误码文案，已由 plugin-manager-wire 落地（9 条通道已进 preload 顶层 key）。
- **未运行任何构建/测试**：约束要求，由 Lead 统一执行。
- **未编造上游契约**：§1.2 的七项待核在拿到正文前不写实现。特别是 manifest 字段名——若上游 `packages/util/package-manifest` 显示用的是 `package.json`，§2 整体改读 `package.json`，校验规则不变。
