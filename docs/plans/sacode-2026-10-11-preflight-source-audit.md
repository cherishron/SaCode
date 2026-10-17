# 三份 2026-10-11 设计方案的实施前源码审计

- 日期：2026-10-11
- 性质：**纯只读静态审计**。本轮未运行构建、未运行测试、未打包，因此下文所有结论只证明「源码形状」，不证明任何东西可构建、可运行或已验收。
- 审计对象（均为 2026-10-11 新建的设计文档）：
  - [扩展市场方案](sacode-extension-market-2026-10-11.md)
  - [本地 Agent 预设方案](sacode-local-agent-presets-2026-10-11.md)
  - [自身性能监控方案](sacode-self-performance-monitoring-2026-10-11.md)
- 定位方法：一律按**符号**定位，不依赖固定行号——三份方案本身也要求「实施前按符号重新核对源码，不依赖固定行号」。行号仅在需要指出与方案原文的具体差异时引用。
- 状态判定用三分：**依据准确** / **依据需更正** / **缺口比方案设想更大**。

---

## 0. 三句话结论

1. **三份方案的「当前源码依据」段落基本准确**，没有捏造不存在的文件或符号——这一点比多数设计稿好，值得肯定。
2. **但 Skill 与 MCP 的实际成熟度远低于方案 §8 隐含的假设**：两者在 `core/` 里都有实现，而 `apps/host/src/main.cj` 与 `apps/desktop/preload.cjs` 中 **`mcp` / `skill` 各有 0 个命中**。也就是说它们**连宿主分派动词都没有**，接通线排在「装市场」之前，不是之后。
3. **Agent 预设不能挂在 `ModeController` 上**：那是一个单值全局审批开关，与「多份并存、有作用域的预设」不是同一个形状的物。方案 §6「需逐项核现有实现，避免重复开发」这条纪律救了这次——现有实现确实不是可复用底座。

---

## 1. 扩展市场方案

### 1.1 Skill：`SkillRegistry` 存在，但是 log-only 登记簿，不是 Skill 加载器

**符号**：`core/src/skill.cj` → `public class SkillRegistry`

实测形状（`core/src/skill.cj` 全部 114 行）：

| 成员 | 实际形状 |
| --- | --- |
| `register(name, description)` | 只存两个字符串；空名/空描述抛错 |
| `list()` | 只返 `ArrayList<String>` 的**名字** |
| `describe(name)` | 只返描述字符串 |
| `uninstall(name)` | 写 `skill/uninstall` 事件做软删（`active=false`） |
| 持久化 | `skill/register` 事件，载荷是 `<name>::<description>` |

**结论：缺口比方案设想更大。** 方案 §6 对 Skill 的要求逐条对照：

| 方案 §6 要求 | 当前状态 |
| --- | --- |
| 核验 SKILL.md 元数据 | **不存在**。没有文件解析器，`SKILL.md` 三个字在 `core/` 中无任何引用 |
| 资源相对路径与大小限制 | **不存在** |
| 分离发现元数据与按需加载正文 | **不存在**。`describe()` 直接回注册时那一句，没有正文概念 |
| 用户级/项目级作用域、同名遮蔽可追溯 | **不存在**。`indexOf(name)` 全局线性查找，重名直接覆盖，无作用域维度 |
| 运行时记录实际解析版本 | **不存在**。无版本字段 |

**一处方案未提及的已知天花板**：`skill/register` 用 `::` 做字段分隔符，因此 `name` 或 `description` 含 `::` 会在注册处被拒（`skill-delimiter-in-name` / `skill-delimiter-in-name` 同族错误码）。这是既有设计注释明确写下的约束。若市场要承载真实 SKILL.md 的描述文本，**描述里出现 `::` 是完全正常的**——这意味着扩展市场落地前必须先换掉这套编码（改长度前缀编码，或改走结构化事件），否则会在最基础的字段上撞墙。方案 §8「实现安装事务 → 接 Skill 加载」的顺序里，**这一步应当排在安装事务之前**，否则会先装出一批装不进去的技能。

### 1.2 MCP：执行面真实存在，但 Schema 未接、命名空间缺失、宿主未连线

**符号**：`core/src/mcp_client.cj` → `public class McpClient`；`core/src/mcp.cj` → `McpReconnectPolicy` / `McpRegistry`

分工作树的实测形状：

| 能力 | 状态 | 证据形状 |
| --- | --- | --- |
| 真实 spawn 子进程做 stdio JSON-RPC | **有** | `McpClient.launchServer(cmd, args)` → `SubProcess`；`mcp_client.cj` 顶部注释自述为「执行面」 |
| 握手 / 版本协商 | **有** | `McpOpResult.protocolVersion` / `serverName` / `serverVersion` |
| 超时与取消 | **有**，且设计得当 | `McpLineQueue` + 5ms 轮询（`mcpPollSleepMs`），使取消/超时在有限时间内可见而非卡在阻塞 `readln` 上 |
| 结构化失败 | **有**，8 类 | `failureKind`: `""`/not-registered/bad-args/spawn-failed/transport/timeout/cancelled/protocol |
| 调用审计 | **有** | `mcp/call` 事件 `<name>::<method>::<verdict>` |
| 重连策略 | **部分** | `McpReconnectPolicy` 的**退避算法**已实现且有边界校验；`mcp.cj` 顶部注释自述「这里只解析 typed policy，**不启动重连**」——重连执行未做 |
| **Streamable HTTP 远程传输** | **不存在** | 全仓只有 `launchServer` 一条 spawn 路径 |
| **工具 inputSchema** | **不存在** | `McpToolInfo` 只有 `name` 和 `description` 两个字段，**连 schema 字段都没占位** |
| **工具分页** | **不存在** | `listTools()` 单次返回 |
| **服务器命名空间** | **不存在** | `McpToolInfo.name` 是裸名。方案 §6 要求「工具身份包含服务器命名空间，重名不串服务」——当前两台服务器各有同名工具时无法区分 |
| **宿主分派动词** | **不存在** | `apps/host/src/main.cj` 中 `mcp`（忽略大小写）**0 命中** |
| **桌面 IPC 通道** | **不存在** | `apps/desktop/preload.cjs` 中 `mcp` **0 命中** |

**结论：缺口比方案设想更大。** 方案 §8 写的依赖顺序是「核现有插件/Skill/MCP 链路 → 定格式与来源契约 → 实现安装事务 → 接 Skill 加载与 MCP 工具运行」。实测把第一步的结果钉死了：

> 现有 MCP 链路是一个**没有出口的核心库**。它离「可被用户使用的 MCP」之间，缺的不是市场 UI，而是**宿主动词 + 有限 IPC + Schema 承载 + 命名空间**这四件事。这四件必须在「安装事务」之前完成，否则装进来的 MCP 服务器没有任何地方能连。

**范围澄清（避免方案被误读为缩小）**：方案 §8 末尾已写「已有 SkillRegistry 登记、MCP 类或插件页面不证明市场生命周期闭环」。本节不是推翻该判断，而是把缺口**定到具体符号**，好让排期时不再把这一格当成「已有类，只需加 UI」。市场范围不变，是起点被更正了。

### 1.3 Plugin：本地安装路径已有，且带诚实拒绝

**符号**：`core/src/plugin_store.cj` → `PluginStore`

实测已有能力：

| 方案 §5 要求 | 状态 |
| --- | --- |
| 绝对路径限制 | **有**，且拒绝话术诚实：`inspectSource()` 对非绝对路径返回「本地目录安装只接受绝对路径；**npm 名与 git 地址这类远端源还没接**」 |
| manifest 校验与逐条错误码 | **有**：`parsePluginManifest` 抛错被原样带出（注释明确说明「压成 unknown 就只剩『装不上』这三个字」） |
| 重复安装检测 | **有**：`already-installed` |
| 修订号并发控制 | **有**：`revisionOf()` / `install` / `uninstall(name, expectedRevision)` / `setEnabled(name, on, expectedRevision)` |
| 每次操作从盘上重放 | **有**：`reload()` 纪律，注释类比 `providers.log` |

**远端源确实未接**，且是具名拒绝而非假成功——这与 `docs/evidence/2026-10-11-windows-tls-anchor-audit.md` §41 刚统一的定级判据（「只有返回体让调用方读到『你要的结果已经拿到』才算模拟成功」）一致。`plugin/registries` 动词虽返回 `{"registry":null,"fallbackRegistries":[]}`，但那读作「没有可用注册表」，不声称取到了远程源，按该判据属**后端未实现**而非模拟成功。

**结论：依据准确。** Plugin 是三类扩展里现状最好的一条，方案 §8 把「接 Plugin 装配」排在最后是合理的。

### 1.4 来源调研：一条不可复用的证据需要降级

方案 §3 表格里 skills.sh 一行写「网站与固定版本 CLI 的只读查询可用」。该结论的证据链是本会话的联网搜索，**不在仓库内**。本轮未复验。

**建议**：实施前若要依赖某个来源做真实安装适配，必须把该来源的接口证据**落成仓库内的一份记录**（含日期戳与实际请求样例），否则下次接手的人无法区分「已验证的接口」与「搜索结果摘要」。方案 §9 验收表已有「各来源分别报告成功/失败」一条，但缺「来源接口证据的存放位置」这一环。

---

## 2. 本地 Agent 预设方案

### 2.1 关键发现：`ModeController` 是审批开关，不是预设底座

**符号**：`core/src/mode_controller.cj` → `public class ModeController`

实测形状：

- `current()`：遍历**全量**事件重放，取 `mode/mode` / `plan/mode` / `permission/preset` 三种历史事件的最后一个；默认返回 `"build"`。
- `set(mode)`：只接受 `plan` / `build` / `auto` / `yolo` 四个字符串，其他一律抛 `unknown-approval-mode`；同值返回 `noop`，否则写 `mode/mode` 事件。

桌面侧消费点：`apps/desktop/renderer/pages/permission-menu.ts` → `modes` 常量 `[['plan','规划与只读分析'],['build','在工作区内实施'],['auto','自动审查授权请求'],['yolo','自动执行模式']]`，经 `window.sacode.approvalSetMode` / `approvalGetMode` 往返。

宿主侧：`apps/host/src/mode_rpc.cj`（**未跟踪新文件**，17 行）提供 `handleApprovalSetMode` / `handleApprovalGetMode`，`apps/host/src/main.cj` 的 `approvalSide` 判定已包含这两个动词。

**为什么这条对方案要紧**：Agent 预设方案 §2 的四种内置模式是 `standard` / `ptc` / `minimal` / `creator`，而 `ModeController` 的四个是 `plan` / `build` / `auto` / `yolo`。两组**语义正交且无交集**：

| | `ModeController`（审批模式） | Agent 预设（方案 §2） |
| --- | --- | --- |
| 回答的问题 | 这个动作要不要问人 | 这个任务用什么工具、按什么方式干 |
| 基数 | 单值全局，四选一 | 多份并存，有作用域（用户级/项目级） |
| 内容 | 一个字符串 | 指令 + 工具集合 + Skill/MCP 引用 + 模型 + 预算 |
| 可并存 | 不行 | 行；仅「默认预设」是单值 |

**结论：依据需更正。** 方案 §6 写「候选接入域：…及现有模式控制器；需逐项核现有实现，避免重复开发」。按上面的实测，**「现有模式控制器」不是可复用底座，反而是命名陷阱**：若实施者看到 `ModeController` 就把预设塞进去，会得到一个只能存一个字符串的全局开关，与 §4「用户级与项目级同名预设在 UI 中保留来源区分」直接冲突。

**建议**：预设在实现时应是与 `ModeController` **并列**的第二个概念（可考虑 `preset/` 事件族，与 `mode/mode` 并存），并在方案里显式写一句「审批模式与 Agent 预算是正交两层：预设不得放宽审批模式」。这同时是 §3「有效权限取系统策略、用户授权、会话策略与预设工具集合的交集」的必要前提——若两者共用一个槽位，「交集」就无从计算。

### 2.2 PTC：四种模式中唯一已有真实执行面的

**符号**：`core/src/ptc.cj` → `PtcRuntime`；`core/src/ptc_exec.cj` → `PtcExecResult`；`core/src/agent.cj` → 字段 `ptcExecutor: PtcExecutor`；`core/src/model_tool_runtime.cj` → 注册 `run_code`

实测：

- `run_code` 已作为**模型可见工具**登记在 `ModelToolRuntime` 里，`requiresApproval` 为 `true`（描述原文「执行 JavaScript 代码（PTC 运行时，需审批）」）。→ 方案 §2 PTC 模式那条门槛「有实际受控编排运行时和工具桥接」**基本达到**。
- `PtcRuntime` 本身是 log-only 状态机：`ptc/begin` → `running`，`ptc/end` → `outcome`，对空 callId / 空 toolName / 重复 callId / 未知 call / 重复 end 均抛具名错误。
- 真实执行在 `ptc_exec.cj`，`agent.cj` 中调用形如 `ptcExecutor.runCode(code, timeoutMs: 30000, sandboxMode: "workspace-write", ...)`。

**结论：依据准确，PTC 是起点最高的一种模式。** 但方案 §9 对 PTC 的验收要求「预算、取消和子调用授权生效」中，**「预算」在 `PtcRuntime` 的事件形状里没有对应字段**（`ptc/begin` 只载 `<callId>::<toolName>`，`ptc/end` 只载 `<callId>::<outcome>`），实施时需要决定预算记在哪里。

### 2.3 极简模式：有一条现成的正面对照面可用

`ModelToolRuntime` 的注册是**按入口注入开关**的：`files` / `browser` / `computer` / `team` / `worktree` 各自 `if` 包裹，注释明确写着「入口注入了执行器才登记声明面。没真驱动可接时既没有 schema 也没有派发，模型看不到也调不动——**不能声明一条跑不通的能力骗模型去点真人鼠标**」。

**这条纪律正是方案 §9 极简模式验收「模型实际仅获允许的终端目录，其他工具直接和间接路径均不能越权」所需要的**，且它已有可复用的实现形态。方案 §8「四种真实执行路径」里，极简模式的落地成本因此低于表面看起来的——但仍需证明**间接路径**（MCP 工具、插件贡献的工具、worktree 工具）也一并被关掉，方案 §8 已正确地把这点写进了验收表，本审计确认它是真难点而非形式条款。

### 2.4 预设存储：与既有存储纪律同构，可直接沿用

`PluginStore` 已确立的纪律——修订号（`expectedRevision`）乐观并发、每次操作从盘上重放而非用内存旧视图——正是方案 §4 对预设存储的要求（「保存使用 expectedRevision 检查与原子写入，避免桌面、CLI 或 AI 同时编辑互相覆盖」）。**方案 §4 是准确的，且 core 里已有可直接照抄的范式**，无需另立机制。

---

## 3. 自身性能监控方案

### 3.1 依据逐条核实：全部准确

| 方案 §2 陈述 | 实测 | 判定 |
| --- | --- | --- |
| `general-settings.ts` 的 `SaCodePerformanceSetting` 只展示「用量统计由模型中心管理」，不提供性能采集 | 命中。该组件 class 为 `read-only-setting`，`setup` 返回一个静态 `section`，正文即该字符串，无任何采集、无 props 消费（`props:['owner']` 声明了但 setup 未用） | **依据准确** |
| `workbench-tabs.ts` 已提供右侧资源标签入口，可接入监控页 | 命中。`export const resources: Resource[]`，元素形状 `{id, label, icon, available}`，当前 12 项（files / search / preview / editor / diff / git / inspect / trace / guide / terminal / agents …），**无性能监控项** | **依据准确** |
| `package.json` 定义 Electron、页面构建与打包清单；新增运行时模块必须纳入载荷检查 | 成立，且有对应契约测试 `test/package-runtime-files.test.mjs`（见 PRD §进度对账 P0 第 2 条曾用它验 `build.files` 补列） | **依据准确** |

**一个方案未点明、但会直接影响实施的结构约束**：`Resource.available` 是**硬编码布尔字段**，不是运行时探测结果。这意味着方案 §3 要求的「尚无执行能力的模式显示未就绪及原因」在现有资源标签结构里**没有表达位**——要么把 `available` 改成可计算值，要么为监控页单开一套就绪态。实施前应先定这个，否则 UI 层会出现「标签能点但功能没接」的假就绪。

### 3.2 方案 §8 接入点核验

`apps/desktop/main.cjs`、`preload.cjs`、`host-bridge.cjs`、两个页面文件均存在。方案 §8 已自我限定「新模块的具体路径在实施前按现有装配机制确定；本文件不声称这些文件已有监控实现」——这句限定是准确的，本审计确认当前**没有任何监控相关实现**。

### 3.3 一处必须提前处理的架构约束

方案 §3 表格要求平台采集器「读取所管理进程资源」，§5 要求「绑定以启动时持有的进程对象和实例身份为准，考虑 PID 复用」。这条在桌面侧的落点是 Electron 主进程对**自己 spawn 出来的 host 子进程**的持有关系。

按 `AGENTS.md` 的既有记载，宿主生命周期管理集中在 `apps/desktop/host-bridge.cjs`，且存在**多实例**场景（并发会话各自持有宿主进程）。因此进程身份不能只取 PID，必须是 `(角色, 实例 id, 启动时刻)` 三元组才能满足 §4「进程退出后终止该实例采样，旧样本不得串给新实例」。这是本方案里**唯一一处需要改动既有宿主管理代码**的要求，建议在实施顺序中显式登记，不要留到第 4 步才发现。

---

## 4. 对三份方案实施顺序的修正建议

三份方案的 §8/§9 依赖顺序总体合理。基于本审计，只提出三处**次序前移**，不删任何范围：

| 方案 | 原顺序 | 建议前移 | 理由 |
| --- | --- | --- | --- |
| 扩展市场 | 装 Skill 加载与 MCP 运行排在安装事务之后 | **把「宿主动词 + 有限 IPC + MCP Schema/命名空间」前移到安装事务之前**；把「替换 `skill/register` 的 `::` 编码」前移到 Skill 加载之前 | 否则装进来的 MCP 无处可连；含 `::` 的描述装不进技能 |
| Agent 预设 | — | **先定「审批模式与预设正交」的存储分离**，再动存储层 | 与 `ModeController` 共槽会直接违反 §4 的作用域要求，且此时改存储比改完再改便宜 |
| 性能监控 | — | **先定 `Resource.available` 是硬编码还是运行时探测** | 决定 UI 能否表达「未就绪及原因」，是 §3 硬要求 |

---

## 5. 构建链完整性抽查（顺带发现，与三份方案无关但需立即处理）

审计过程中顺手核实了「新增未跟踪文件是否已接入构建清单」，结论分两半：

**好消息 —— 5 个新增 IPC 模块已完整接入。** `apps/desktop/package.json` 的 `build.files` 已列 `customs-ipc.cjs` / `execution-ipc.cjs` / `lsp-ipc.cjs` / `models-ipc.cjs` / `plugins-ipc.cjs`；`apps/desktop/main.cjs` 也确实逐个 `require` 并 `register*_Ipc`。清单与代码两侧对齐，没有「代码写了但打包漏掉」的洞。

**问题 —— `apps/desktop/after-pack.cjs` 是未跟踪文件，却挂在 `build.afterPack` 上。**

- `package.json` 第 27 行：`"afterPack": "./after-pack.cjs"`
- 该文件仅 8 行，作用是打包后删除 `debug.log` 与 `resources/default_app.asar`
- `git status` 中它是 `??`（未跟踪）

**后果**：当前工作区打包能过（文件在盘上），但**任何从干净检出或从固定提交发起的构建，都会因 `afterPack` 钩子目标文件缺失而失败或行为不确定**。这正是「工作区悬空实现」最具体的危害形态——不是理论风险，是一个 8 行文件挂在构建链关键路径上。

**处置建议**：随工作区收口一并入库（与 `scripts/pack-*.mjs` 同批），并在收口后**从固定提交重跑一次 electron-builder** 作为该风险的证伪——只在本机打包成功不足以证明钩子已落库。

---

## 6. 本轮未能确认的事项

诚实登记，避免下次误当作已验证：

1. **本轮未编译、未测试、未打包**。上述所有结论均为源码静态形状，不代表 `core` 能编译或任何行为可运行。
2. **并发写入存在**：审计期间（2026-10-11 11:38–11:53）另一 Agent 正在跑测试并写入 `apps/desktop/.tmp-test/`、`apps/desktop/dist/ts/`，且在 11:03 修改过 `core/src/worktree_tools_test.cj`。若那之后有源码变动，本文档对应结论需重新核对符号。
3. **skills.sh 等来源的接口证据不在仓库内**，本轮未复验（见 §1.4）。
4. **`core/src/cmds.cj` 的已知语法阻断未在本轮核实**（由另一条审计线负责）。
