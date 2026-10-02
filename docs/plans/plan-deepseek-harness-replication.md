# DeepSeek Harness 全系统复刻总体方案草案

- 状态：v0.2，供架构评审；尚未开始实现。
- 已确定目标：仓颉共享运行时 + Vue 3/TypeScript + TinyVue/TinyRobot + Electron + Next SDK，独立交付桌面端与可通过 npm 安装的 CLI。
- 本次范围：总体方案、接口与动态扩展边界、首个可行性验证；不安装依赖、不替换实现、不发布。
- 复刻口径：功能、架构约束、格式兼容与插件源码兼容分开验收；不把其中一种等价宣称为全部兼容。完整能力保留在路线图中，分批交付不等于删项。

此前 DSH 文档研究用于整理系统地图和候选约束，不替代逐项源码与测试核验。实施前冻结上游 commit、依赖版本、许可证与证据路径，建立「能力 → 上游证据 → 本项目模块 → 入口 → 测试 → 差异」矩阵。研究代理有重复读取，页数相加不是覆盖完整性的证明。

- 本文 §1–§4 保留 DSH 研究背景；§5–§9 为本项目设计提案，接口名称不是已确认的上游 API。
- 证据入口为用户提供的 DSH 仓库与文档，以及 §10 所列研究限制。

---

## 1. DSH 到底是什么（先对齐认知）

DSH 不是「一个 agent CLI 带几个工具」，而是**四层结构**，且前后端共用同一套运行期语义：

| 层 | 内容 | 一句话本质 |
| --- | --- | --- |
| L0 框架层 | **Cordis**（Context / Registry / Fiber / Service / Events / effect） | 一个「按名服务定位 + 依赖驱动激活 + 注册即 effect 自动回滚」的 DI 容器 |
| L1 内核层 | `packages/core`：session log、system prompt、tool registry、agent 契约、默认 agent loop、scope | 会话是**不可变事件日志**，模型可见历史是日志的**投影** |
| L2 能力层 | ~60 个子系统，每个都是插件；可替换能力拆成 Service Definition / Provider / Consumer 三角色 | 「换一个后端 = 换 `cordis.yml` 一行」，不是改代码 |
| L3 交付层 | Web UI（浏览器里的 Cordis 应用）、CLI launcher（4 种 profile）、ACP、Python SDK、Electron | **前端也是插件树**，UI 组件本身是插件在 `apply` 里注册的槽位贡献 |

关键判断：**「由前端到后端」能统一复刻的根基就在 L0**。前后端跑同一套 fiber 生命期与事件派发语义，所以槽位注册、资源 provider、remote 端点、配置表单全都随插件卸载自动撤销。若把 L0 降级成「普通的服务单例 + 事件总线」，则 L2/L3 的一半设计会失去依托。

运行形态（`dsh` launcher 拥有 4 种 profile）：`web` / `headless` / `sdk` / `sdk-minimal` / `acp`，由 named profile + bundle 层 + patch 层合成决定加载哪些插件。

---

## 2. 复刻的硬规格：架构不变量表

「完整复刻」的可执行定义不是功能清单对齐，而是下列不变量对齐。**这 18 条就是复刻的验收标准**，逐条都能在文档里找到原文依据。

### 2.1 全局最高级

| # | 不变量 | 出处 |
| --- | --- | --- |
| 1 | **Model-visible means logged**：任何模型看到的内容都必须能从会话日志重建 | `/reference/`（Architecture） |
| 2 | 会话日志是**唯一真相源**；messages / UI 视图 / 投影都是 fold 出来的派生物，禁止第二业务真源 | `/reference/subsystems/session`、`/reference/subsystems/web-client` |
| 3 | **durable 会话记录 ≠ Cordis 事件**：`turn/*`、`step/*`、`tool/call`、`tool/result`、`compaction/*` 是日志条目，要经 `session/event` 观察 `event.type`；`agent/*`、`tools/*` 才是事件总线的成员 | `/develop/framework/events` |
| 4 | 一切注册都是 **effect**，随 fiber 卸载以 **LIFO** 回滚；有顺序依赖的清理必须塞进同一个 disposer | `/cordis-api/fiber`、`/develop/framework/` |
| 5 | 插件只能挂扩展点，**没有任何一行插件代码可以改写 agent loop**（microkernel 主张的可检验形式） | `/reference/cookbook/extension-cookbook`（feature→mechanism 全表） |

### 2.2 会话与持久化

| # | 不变量 | 出处 |
| --- | --- | --- |
| 6 | `seq` 从 0 连续单调、session-local；`next seq == 事件数`；未知且非 `ignorable` 的事件必须**中止重建** | `session`、`persistence` |
| 7 | 只有 5 类事件进模型对话（`system/message`、`developer/message`、`user/message`、`assistant/message`、`tool/result`），其余持久但不进历史 | `persistence-catalog` |
| 8 | `append` = 实例内可见，`flush` = 崩溃持久 + 跨进程可见；turn 结束**不**保证 flush，需显式 flush 屏障 | `persistence` |
| 9 | 投影函数必须同步、state 为纯 JSON、对无关事件返回**同一引用**（`Object.is` 门控下游）；checkpoint 可落后但不得超前未落盘事件 | `session-projection` |
| 10 | 崩溃恢复合成 `interruptedTurnClosers`（缺失的 tool-error / `step/end` / interrupted `turn/end`），只丢损坏物理尾帧，不丢未完成 turn | `persistence` |

### 2.3 能力可替换性与执行安全

| # | 不变量 | 出处 |
| --- | --- | --- |
| 11 | 「**The complete capability is its seam. No individual role is a seam.**」定义/提供者/消费者三者合起来才是缝，任一单独角色都不是 | `/develop/practice/` |
| 12 | 工具执行是固定序 9 段瀑布：`tools/pre-execute` → approval 解析 → 单调 guard → `tools/execute` → `projectContent` → `tools/post-execute` → 无损 snapshot + 失败归一化 → `finalizeContent` → `tools/result` | `/reference/tool-execution-pipeline`、`subsystems/tools` |
| 13 | **fail-closed 三处**：approval 只认 `allowed-once`，其余（无 provider／抛错／非法返回）一律拒；沙箱 `confine` 产不出 enforcing argv 就报 `SANDBOX_UNAVAILABLE`，禁止静默裸跑；并发工具只有 `isConcurrencySafe` 字面 `true` 才并行，缺失或抛错降级为 exclusive | `approval`、`sandbox`、`tools` |
| 14 | 写文件必须**先观察后修改**（read-before-edit）：Unseen → 拒 `FS_NOT_OBSERVED`，版本不符 → `FS_STALE_VERSION`；创建守卫禁替换（防 TOCTOU） | `filesystem` |
| 15 | 参数在整条流水线**不可被改写**；`guard` 的终局拒绝不可被后续撤销；presenters 必须是纯函数（禁 I/O／时钟／随机），同跑于流式与重放 | `tools`、`cookbook/adding-a-tool` |

### 2.4 前后端协议与前端

| # | 不变量 | 出处 |
| --- | --- | --- |
| 16 | 单向依赖链 `Host 权威 → Remote transport → Client model → UI adapter → Conversation → Slots → View`；表现层组件的签名里**永不出现** `ctx`、transport 对象或别的 feature 实现 | `web-client` |
| 17 | `InvocationDescriptor` 是本地反射**不上线**，请求只发 `namespace`/`method`/具名 `args`；取消是带外 carrier 信号，永不进 `args`；流是双向逻辑流（downlink 帧 + uplink `send/end`） | `typert`、`api-gateway` |
| 18 | 物理恢复与逻辑恢复分离：carrier 失败可重试，业务错误／首帧畸形／协议违例对**该逻辑流终局**；明确拒绝通用 `resync()`；普通事件转发**不回放** | `web-client` |

### 2.5 配置面（易被忽略但必须复刻）

- 配置优先级：bundle 声明序 → profile `cordis.patch.yml` → home patch → `--patch`（argv 序），后层赢。
- **patch 是整行 config 替换，不是深合并**——覆盖别人的行必须重述全部键。这是最容易照抄错的一条。
- 表单只投影 active profile entry 的 `Volatile` 字段；写入带 `expectedRevision` 乐观并发；`role('secret')` 字段**永不**出现在响应里；凭证与引用分离，每次操作即时 resolve（禁止缓存，以便免重启轮换密钥）。
- 无合法 manifest 的页面无法 boot；未知/篡改资源列表、缺 rev、过期 rev 一律 404（绝不让 SPA fallback 把 HTML 当 JS 返回）。

---

## 3. 系统地图：子系统清单与复刻分层

优先级：**P0** = 主干，缺了就跑不起来；**P1** = 完整产品；**P2** = 外部集成／可选，可最后做或砍。

### 3.1 基座（P0）

| 子系统 | 职责 | 备注 |
| --- | --- | --- |
| Cordis（`vendor/cordis`） | Context/Registry/Fiber/Service/Events/effect | 复刻的第一块，见 §5 |
| Loader / cordis.yml | 插件树装配、`insert`/`id`/`disabled`/`group`/`isolate`/`overlays`/`!!js` | 时间序由 `inject` 决定，列表顺序不承重 |
| Scope | identity routing + scoped registry layers + registration ownership 三合一；`ScopeKey` 按对象身份比较 | 让「agent 可见性」与「清理寿命」共用一个注册上下文 |
| Runtime invariants | 只校验**可观测 runtime 关系**，禁止校验 service/方法是否存在；每包一个 `./invariant` companion | 这是 DSH 防止插件树腐化的机制，复刻时别做反 |
| Boot / profile | profile 访问、`configEditor`、`ctx.hmr`、`pluginManager`（远程全 `@Remote`） | 文档在仓库侧 `docs/subsystems/boot.md` |
| Typert + API Gateway | 类型化远程调用、lookup/context wire 身份表、流式 mux | P0（前端依赖），Electron/IPC 场景可先只做 in-process carrier |

### 3.2 会话与上下文（P0）

Sessions、Session persistence（JSONL）、Session projections、Session query（SQLite FTS）、Session titles、Spill storage、Storage（hub + json/sqlite + domain）、LLM streaming、Token metering、System prompts、Compaction、Session telemetry（P1）。

### 3.3 执行与工具（P0 主干 + P1 补齐）

Tools、Filesystem、Bash execution、Subprocesses、PTY sessions、Background jobs、LSP、PTC runtime（P1）、Web access、Sandboxing、Approvals、Permission presets、Plan mode、User questions、Skills、Workflows（P1）、Subagents（P1）。

内置工具目录（照抄，约 70 个名字，`/reference/tool-catalog`）：
`plugin_manager`、`list_mcp_resource_templates`、`list_mcp_resources`、`read_mcp_resource`、`stagehand_act/extract/navigate/observe/screenshot/tabs`、`ask_user_question`、`run_code`、`exit_plan_mode`、`bash`、`pwsh`、`present`、`cordis_inspect_list/query`、`str_replace_editor`、`edit`、`read`、`read_image`、`write`、`glob`、`grep`、`terminal_close/list/open/read/send/signal`、`create_goal`、`get_goal`、`update_goal`、`schedule_create/delete/list/update`、`lsp`、`ralph`、`skill`、`session_event_read/search/trace`、`session_search`、`session_trace`、`subagent`（+ alias `subagent_fork`）、`list_subagent_models`、`interrupt_agent`、`list_agents`、`send_message`、`wait_agent`、`spawn_teammate`、`team_task_create/get/list/update`、`job_kill/list/output`、`todo_write`、`workflow`、`load_workspace_dependencies`、`web_fetch`、`web_search`。

注意两处语义：`mode: ptc` 下 `run_code` 是唯一直接暴露给模型的 transport（其余工具经 `await tools.<name>(args)` 桥接）；`bash`/`pwsh` 的 one-shot 与 persistent 后端**同名复用**。

### 3.4 前端（P0 最小闭环 + P1 完整）

| 子系统 | 职责 | 复刻判断 |
| --- | --- | --- |
| Web Client architecture | 分层与归属，四大基石：Client Modules / API Gateway / Slots / Conversation | 层与框架无关，可直译 |
| Client Modules | 扫 `dsh.client` 声明、装配 `WebBootGraph`、供 `/plugins` combo | **最 TS/Node 特化**，Rust 侧应整体替换为「单二进制 + 编译期插件清单 + 资产嵌入」，只保留 4 条语义：graph 是唯一真源、每 entry 带 rev、未知即 404、激活失败 fail-loud 而稳态失败隔离 |
| Client Slots | 类型化组合系统（React-free 注册表 + 唯一 renderer 绑 observable） | 核心不是换 UI 库，而是复刻「带生命期所有权的类型化贡献注册表」：约 70 个 slot key、cardinality(`single/list/keyed/chain`) × scope(`root/session-maybe/session`) 两轴、`priority` 遮蔽、声明即授权渲染、owner 卸载递归折叠 |
| Client Resources | `dsh-resource://<protocol>/…` 地址 → provider → 帧序列 | 纯协议，可直译（`async-stream` + `Arc<dyn ResourceProvider>`）；一协议一 provider、holder/pin 计数、失败是帧不是 throw、`failed` 保留上一个 `ok` 值 |
| Conversation assembly | 事件窗 → target-neutral 视图（节点 Definition/Group/Location） | **价值密度最高、最可原样搬**：纯函数折叠 + 复杂度硬约束（append 路径只做 D 次 match + O(1) key 查找，禁止扫窗）+ 文档明列 6 条验证义务（等价于现成验收表） |
| Right Sidebar / dockkit | 面/tab/pane、地址 claim、分裂浮动、history | `ui-dockkit` 文档自称内部依赖非稳定接口，可自选布局引擎 |
| HTTP Server（web-server） | 命名路由 + upgrade + 唯一 fallback + `tapIndex`/`webserver/index-inject` | axum/hyper 一对一 |
| Settings / Credentials 前端面 | 表单投影、revision CAS、secret 脱敏、`mutate(path ops)` | 三件套照搬 |

UI 一等公民面（用户可见入口）：Sidebar（brand/panellist/workspaces/directoryFlow/settings 触发）、Main（conversation header、composer bar：attachments-permission-plan-model；hero：workspace-agentPreset；plugins 列表与详情）、Rightbar（pane/tab/float/split、guide、文档预览）、Settings 窗（general/models provider-card/plugins tab）、Automation tasks 页、快捷键系统与共享 modal 原语（顶栏 Escape 仲裁 + 焦点归还）。

### 3.5 委托与编排（P1）

Subagents（6 类 provider：spawn-in-process / fork-in-process / acp / codex / claude-code / dsh-sdk；one-shot 与 continuable 两形态，`Activation` 三态派生自观察）、Agent team（lead/teammate 身份、可恢复 teammate、peer 消息持久化、共享任务依赖；experimental）、Workflows（模型现写 JS 脚本跑在 PTC 上，`phases` 只是进度标签不是调度结构）、Skills（kebab-case 目录，6 级 rank 遮蔽：100 `project-dsh` → 600 `bundled`，近者遮蔽）、MCP（**「MCP 即普通工具」**：每服务器一个连接插件，不发共享 `ctx.mcp`；公开名 `mcp__<serverName>__<rawName>`；不支持 prompt 模板／elicitation／资源订阅）、Goals（双轴状态机 `GoalPhase × activation`，session log 是唯一存储，activation 永不落盘）、Scheduled reminders（权威数据在 storage-domain 不在会话历史；at-least-once 投递，崩溃可重复投递；Cron 严格 5 字段 Vixie）、Human commands（slash 命令绕开模型，`command/run`→`command/done` 直写日志不开 turn）、Todo（整表 last-write-wins，无 id/priority）、Deliverables（`present` 声明的 `PresentedFile` + git 轮首尾快照算改动，摘要**不入库**）、Attachments（内容寻址 `sha512?…sha256:<digest>`，消费者禁止解析路径）、Feedback（严格乐观并发 + 7 类固定 category）、Extensions（动态插件内核：`define` 铸造不可变 `CordisDynamicPackageId` 版本序列 → 逐包审批、Plugin 级授权覆盖后续版本、Host/Client 半分离、渲染失败回收）、Webhook（fire-and-forget，无队列/重试/去重/状态/崩溃回放）、SSH（远端 FS/进程/沙箱 provider，**不重连不重放可能已执行的变更**）、Computer use / Browser use（**只提供注册槽**，provider 自带工具目录；第二个注册必拒）、Voice input（识别不写任何 Session 事件，转写经 `insertText()` 带 selection revision 校验入草稿）、Office-to-PDF、OTel / Product telemetry。

---

## 4. 事件目录基线（复刻时最容易搞错的一层）

DSH 把「事件」严格分成两类，复刻时必须从类型系统就分开：

**A. 会话持久记录（写入日志，参与 replay）**
进模型历史：`system/message`、`developer/message`、`user/message`、`assistant/message`、`tool/result`。
持久但不进历史：`turn/start`、`turn/end`、`step/start`、`step/end`、`tool/call`、`tool/ptc-dispatch`、`assistant/attempt`、`request/header`、`request/context`、`session/end-seed`、`session/title`、`compaction/start`、`compaction/summary`、`compaction/end`、`compaction/prune`、`image/offload`、`hook/invoked`、`hook/result`、`llm/retry`、`approval/asked`、`approval/decided`、`approval/policy`、`permission/preset`、`sandbox/mode`、`plan/mode`、`subagent/start`、`subagent/end`、`subagent/descriptor`、`todo/write`、`workspace/changes`、`deliverables/presented`、`command/run`、`command/done`、`goal/change`、`feedback/*`、`tool-workflow/run-start`/`run-end`、`team/*`。
每条：`{ type, seq, time(epoch ms), data }` + 可选 `ignorable: true`。
`TurnEndReason`: `completed/aborted/blocked/error/max-tokens/interrupted/forked`。

**B. Cordis 事件（进程内协调，不落盘）**
五种派发模式：`emit`（同步全调，弃返回值）、`bail`（非 null/false/undefined 即停）、`serial`（按注册序 await，同 bail 停止条件）、`parallel`（并发全等）、`waterfall`（环绕中间件，**监听器必须调 `next()`**，不调即视为故意 veto）。
关键：durable 的 `tool/result` ≠ Cordis 的 `tools/result`。命名约定 `namespace/action`。

**流式协议**（`llm-streaming`）：`block-start{index,blockType}` → `text-delta`/`reasoning-delta`/`tool-call-delta{index,id,name?,argumentsDelta}`（工具参数是裸 JSON 字符串分片，端到端不 parse）→ `block-end{index,block}` → `usage{TokenUsage}` → `finish{reason, replayState?}`。硬规则：usage 先于 finish、finish 后不得再有 chunk；`max-tokens` 移除全部 tool calls 及对应 replay 条目；装配删内容必删对应 metadata。

---

## 5. 新架构与仓颉实现边界

### 5.1 共享核心、双入口

```text
npm 启动包装 → 仓颉 CLI ──────────────┐
                                      │
Electron 主进程 → 仓颉 Host ───────────┼→ 共享仓颉核心
  │                                   │  插件/会话/agent/模型/工具/审批
preload                               └→ 独立 Node 扩展宿主
  │                                       CLI 与桌面都可启动
Vue 客户端模型/视图装配/槽位
  TinyVue + TinyRobot
  Next SDK 页面工具适配
```

CLI 在进程内调用公共服务，Host 把同一服务暴露给桌面；是否合并成带子命令的单个程序由 P0 构建实测决定。核心不依赖 Electron、Vue、TinyRobot 或 Next SDK。CLI 不需要浏览器或桌面安装包，桌面不调用全局安装 CLI。

| 模块 | 职责 | 不允许承担的职责 |
| --- | --- | --- |
| 仓颉核心 | 生命周期、会话事实、loop、模型、工具、策略、凭证 | 不依赖 GUI，不复制桌面业务 |
| CLI/Host | 终端交互与退出码 / 协议与身份适配 | 不复制 agent loop 或存储真源 |
| Electron | 窗口、托盘、更新、进程启动关闭、系统桥接 | 不执行核心 agent 业务，不成为 JS 插件默认宿主 |
| preload | 有限、类型化 IPC | 不暴露 raw ipcRenderer、fs、child_process 或任意 channel |
| Vue/OpenTiny | 投影、输入草稿、槽位、组件呈现 | TinyRobot 消息数组不替代日志，不另开模型对话链路 |
| Next SDK | 页面发现、路由、handler 适配 | 不绕过核心工具权限与审计 |
| 独立 Node 宿主 | 动态 JS 工具/provider、workflow/PTC 桥接 | 不依赖 Electron，也不把 worker/vm 当安全沙箱 |

Electron 开启 contextIsolation、关闭 nodeIntegration，采用沙箱化渲染设置；校验 IPC sender/参数，对外部内容另设策略，固定版本后实测。

### 5.2 路线比较

推荐「仓颉核心 + 独立 Node 扩展宿主」，保留 JS 动态能力并让 CLI/桌面共享，代价是双运行时分发与跨进程生命周期。纯仓颉扩展不能直接兼容 TS/npm；保留 TS/Cordis 核心虽然更易兼容，但不满足仓颉重写核心目标。

npm CLI 的 JS 宿主可使用满足版本要求的系统 Node；桌面携带其运行环境的方式须实测。不能因为 Electron 内有 Node，就宣称已解决独立宿主或隔离问题。

### 5.3 仓颉映射

| 机制 | 候选实现 | 必须验证 |
| --- | --- | --- |
| 服务与依赖 | interface/class、工厂、命名注册、owner/scope | 依赖消失、循环、隔离、重激活与清理 |
| 事件总线 | 类型事件域 + 五派发模式 | 重入、错误、瀑布和并发顺序 |
| 并发/取消 | spawn/Future、同步原语、取消上下文 | 阻塞 FFI、取消延迟、流式背压 |
| 模型通信 | stdx HTTP/TLS、增量读取与 SSE 解析 | 半帧、UTF-8 分片、异常流、超时 |
| schema/JSON | 共享契约、CJ 校验、生成 TS 类型 | 缺失/null、安全整数、未知事件、一致性 |
| 系统能力 | std 能力，必要 CFFI/helper | SQLite、fsync、原子替换、写锁、PTY、进程树、沙箱 |
| 动态配置 | 版本快照和变化通知 | secret、CAS、重新挂载、回滚 |
| 分发 | 固定 cjpm/cjc 与运行库清单 | 平台支持、运行库路径、干净环境安装 |

不机械搬用 Rust 的 crate/trait/Drop/tokio/serde；资源回收不依赖 GC/终结器时间。不预先承诺仓颉动态库 ABI、WASM 或任意原生热替换。

### 5.4 接口契约初稿

| 域 | 提案操作 | 契约关注点 |
| --- | --- | --- |
| Runtime | handshake/health/shutdown | 版本、能力集、生命周期 |
| Session | create/open/submit/follow/page/flush/close | 入箱回执不等于完成；cursor/generation/seq |
| Agent | start/cancel/status/inbox | 输入身份、父子关系、终态 |
| Approval/Question | followPending/answer | 授权者、单次应答、过期拒绝 |
| Tool | catalog/execute/result | scope、冻结输入、pipeline、领域错误 |
| Plugin | catalog/activate/deactivate/inspect | manifest、依赖、授权、清理 |
| Settings/Credentials | describe/mutate/setSecret | revision CAS、脱敏、来源与审计 |

最终签名与 schema 在后续契约设计冻结，保持 CJ/TS 生成与校验测试，不仅靠手写接口约定。

首轮推荐父子进程 stdio + JSON-RPC 2.0，按 UTF-8 字节长度加帧头，stdout 仅协议、stderr 诊断。限制帧大小和队列；握手有 protocolVersion/capabilities；可能超 JS 安全整数的 seq 线上为十进制字符串，附件另限大小。

取消为独立 request-ID 控制消息；请求/turn/job/进程终止区别对待。持久流有 cursor/baseline/generation/gap 修复，瞬时流明确标记并由 settled 事件确认。慢消费者用暂停或关闭后重放，不静默丢持久事件、不无限堆积。协议、业务、工具失败、取消和进程死亡分别表达。未知结果的变更不自动重试。

会话写者互斥，第二写者明确拒绝；首轮无透明多写者。stdio 不需浏览器 token，但必须校验 IPC/连接身份与会话归属。后续 HTTP/WebSocket 入口单独加入认证、Origin、网络绑定/TLS。

CLI 有交互/headless/结构化模式；stdout JSON 与 stderr 诊断分离，透传 argv/cwd/stdio/退出码，Windows/POSIX 单测 Ctrl+C。非交互无审批应答者则拒绝，不等 GUI。GUI 页面工具 CLI 不可用，同业务有 headless provider 可另提供。

### 5.5 动态扩展契约

三类扩展：内置仓颉工厂/profile；独立 JS 宿主已授权 bundle；Vue 生命周期化 UI 贡献。manifest 有 id/version/契约版本/依赖/贡献/权限/摘要；下载、安装构建脚本、激活分别授权，不自动跑未知 npm 安装脚本。

生命周期：prepare → authorize → activate → drain/cancel → dispose；宿主死亡结算 pending，撤销工具代理。句柄与 JSON/schema 跨进程，不声称保持原始 ctx 引用或同步对象身份。

兼容等级：自有协议 → 生命周期等价 → 选定未修改 DSH 插件桥接 → 扩大复杂对象/同步中间件/动态 UI 兼容。兼容层留在完整路线图，不把仅有工具 RPC 标成全部兼容。

同进程 Vue 插件视为已授权可信代码；API 白名单不是恶意 JS 隔离。非可信 UI 另用 sandbox iframe/独立环境，非可信 JS 需 OS 限制或拒绝执行。进程/worker/vm 不是安全沙箱。插件默认无凭证、父环境、任意 fs/命令权限。

Next SDK 路径：发现 → 核心注册 → 校验/审批/guard → 授权票据 → 页面路由/handler → 校验结果 → 核心记录。票据绑定 call/session/page generation/有效期，不可复用。卸载撤销描述和 handler，关闭/取消明确结算。SDK 是否有足够外部执行钩子需实测，缺钩子加适配或只保留发现，不能放宽授权。WebMCP 页面 API 不等于 MCP stdio 服务。

---

## 6. 首轮验证与分阶段路线

### 6.1 P0：双入口、持久化、动态扩展纵向切片

P0 是本地可撤回实验，不是缩小长期范围，也不是外部发布。缺工具链先报告，不静默安装。

| 验证项 | 正向与反向验收 |
| --- | --- |
| 仓颉构建 | 固定 cjpm/cjc/运行库版本，列依赖，干净环境不需用户安装编译器 |
| 日志与恢复 | create/submit/follow/flush；重启恢复已 flush 前缀，测试尾帧截断与未知 required 事件；未结算流明确 interrupted |
| 流式模型 | 假 provider 测半帧、UTF-8、错误、取消；授权凭证另做真模型烟测，不能把假响应标真接入 |
| 工具与审批 | temp workspace 文件工具；CLI/桌面批准和拒绝；无应答者拒绝，旧审批 ID 不可重用 |
| 插件 | 一个内置模块、一个 JS 动态工具；卸载注册/监听残留为零，宿主死亡结算 pending |
| 跨端 | 顺序打开同会话投影相同，同时写第二写者拒绝 |
| 取消与背压 | Ctrl+C/桌面 stop/慢客户端；不误杀已独立发布后台任务，不无限积压 |
| UI/Next SDK | TinyRobot 显示核心流，一个无副作用页面工具经核心授权；页面卸载撤销描述/handler |
| npm 本地包 | npm pack 后隔离安装；argv/cwd/stdio/退出码/取消正确；包不含 Electron，不需编译器 |
| 桌面本地包 | Electron 包携带程序/运行库，无仓库绝对路径/全局 CLI 依赖；退出无孤儿进程 |

结果用 PASS/FAIL/BLOCKED；失败调整对应设计，阻塞列前提，不能删动态扩展或 CLI 来宣布通过。测试命令、版本与容量/时间阈值在 P0 实施计划冻结。模型调用、依赖安装与打包依实际权限执行，签名和实际发布另行授权。

#### 6.1.1 P0 逐项结果登记（2026-10-03 实测，HEAD `8c79275` 之后的本批）

| 项 | 结论 | 证据与缺口 |
| --- | --- | --- |
| 构建 | PASS | `cjc/cjpm 1.1.3` + stdx 1.1.3.1（动态链接 5 包）；host/cli `cjpm build success`；`scripts/pack-host.mjs` 出 89 文件自包含目录，运行不拼 PATH |
| 会话与回放 | PASS | `core` `cjpm test` **75/75**（seq 编号、flush/load 往返、投影过滤与纯度、租约互斥、装配终态、尾帧截断三例、会话日志锁下的并发读快照 + **写者落盘与磁盘重放交错的撕裂检测**、**多行与制表符数据的转义往返 2 例**）；durability 屏障与分页由 bridge **30/30** 覆盖。**尾帧截断已按 DSH 语义收口**：半写尾帧只丢该帧并保留已提交前缀（CLI 实测尾行无 LF → `ok 2 2`，投影 2 条），`truncatedTail` 经 Host 投影帧透出以便上层把未结算流标 `interrupted`；中段缺帧仍整份拒绝，不静默前滚 |
| 模型流式 | PARTIAL | 假 provider 的半帧/分片/终态/max-tokens/usage 次序已由单测覆盖；**缺口**：真模型 HTTPS+SSE 烟测需用户授权凭证，未执行 |
| 工具与审批 | PASS | `apps/cli` `tool` 模式：`allowed-once` 才放行、无应答即拒、guard 拒绝计数；桌面审批卡片同由 core 的 `ToolRuntime` 裁决——只有「允许一次/拒绝」两个选项（没有永久授权按钮），两条路径的终态与日志记账均经 `--ui-smoke` 实测，反证是「拒绝」按钮改发 `allowed-once` 后界面与日志两条同时转红 |
| 扩展生命周期 | PASS | `core/src/ext.cj` 注册表 + `extjs/` 独立 Node 宿主 + `core/src/extproc.cj`（仓颉核心直接驱动 JS 宿主子进程）已落地：core `cjpm test` **75/75**（13 条 `ExtProcess`：握手帧必须来自子进程真实应答、`load→list→call→dispose` 全生命周期走真管道、未知方法回 `-32601`、优雅退出 `exit=0` 且 `forcedExit=false`、子进程收束后不得再有应答、永不应答的调用超时返回 `None` 而不编终态、强杀后读线程照样收束、命令不存在时 fail-closed 不起线程）；`extjs` `node --test` **14/14**（新增按 callId 取消只结算一帧、迟到的 handler 结果不补第二帧、重复 callId 回 `-32022`、取消不存在或已结算的 callId 回 `false`）；CLI `dsh extjs` **12 项断言 ALL PASS**；桌面入口 `bridge.test.mjs` **30/30**（新增 9 条：`extension/host/*` 经 core 子进程走真管道、未 spawn 与无应答分开失败、重复 spawn 被拒且原宿主不丢、父宿主退出后 JS 子进程不得存活、`extension/host/call` 立刻回执且转调期间读侧不排队、`extension/host/cancel` 只按 callId 结算一帧、`turn/cancel` 联动取消在途调用、宿主退出前主动取消并交 `host/settled` 账、**`turn/cancel` 只结算本轮发起的调用**（上一轮仍在途的与 epoch 0 的手动调用都不被误伤，反证：把取消改回「结算全部」该条立刻转红））。并发在途已按 id 配对收口（`core/src/reply.cj` `ReplyTable`）；**转调不再占住 Host 的 stdin 读侧**（`extension/host/call` 发出即回执，收帧交给独立线程 + `ThreadSafeDeliveryQueue`），turn 取消联动在途 `extension/call` 已实测。反证：把 `ExtHost.cancel()` 改成「不真正结算、直接返回 true」→ extjs 2 条与 bridge 2 条同时转红；去掉 EOF 的主动取消 → `extensionCancelled` 由 1 变 0，那条转红。**剩余**：在途调用与 turn 的归属仍建立在「同一时刻只有一个 turn」上，callId 集合未按 turn 粒度隔离 |
| 跨端一致 | PARTIAL | CLI 与桌面共享同一 `session.log`，投影与 seq 同源（bridge「投影与 CLI 同源」）；第二写者经协议拿到 `-32001 already-owned`；`WriteLease` 的 TOCTOU 已用 `File.createTemp` + `rename(overwrite:false)` 原子获取收口，`release()` 只认自己那份 owner 凭据（非持有者释放不得删掉别人的租约）。**缺口**：进程崩溃后留下的租约无自动接管路径（Windows 上取自身 pid 与判活需 CFFI） |
| 取消与背压 | PARTIAL | 桌面 stop 与慢消费者两条已实测：`TurnToken` 协作式取消跑在 `spawn` 出的仓颉线程上，`ThreadSafeDeliveryQueue`（Mutex+Condition）投不满只报 `overflow`、`dropped` 恒 0；已独立发布的 `detached()` 令牌不被父取消连带杀死（`futureCancelIsCooperativeNotForced` 钉住「`Future.cancel()` 只发请求」）。计数：core **75/75**、CLI `dsh cancel` 9 项断言裸 PATH rc=0、bridge **30/30**（含 turn 在途期间读侧照常应答、`extension/host/call` 在 turn 在途时进得去、**取消按轮次归属只结算本轮调用**）。**剩余**：Ctrl+C/SIGINT 仍未接（std 无信号 API，需 CFFI `sigaction`） |
| UI/Next SDK | PARTIAL | **Vue 3 已接入并真机验收**：`renderer/app.js` 用 `vue.runtime.global.prod.js`（CSP `script-src 'self'` 禁 `unsafe-eval`，所以取不带运行时编译器的 runtime 构建、视图用 `h()` 写，由 `scripts/pack-vendor.mjs` 落进 `renderer/vendor/`）；消息列表只渲染核心投影交出的 `messages`，流式文本只来自 `turn/poll`，工具与审批态只来自 `extension/list` 与 `extension/call` 的实际应答——渲染层不持有第二真源。设计令牌层 `renderer/styles.css`（`:root` 明暗两套 + 语义类，业务样式不写裸色值）。`electron . --ui-smoke --session-dir=<空目录>` **25 条断言全 `UI OK`**：多行带引号的消息经 IPC 逐字符往返且只算一条事件、`durable/pending/tail` 计数条、完整一轮渲回「你好，world」并落 `settled:stop`、可取消一轮点「停止」落 `cancelled`、审批浮层只有「允许一次/拒绝」两条路径且终态与日志记账都如实、放行前 `pending>0`（append 不等于已提交）、`window.require` 为 `undefined`、preload 只暴露 7 个固定动作。反证：把「拒绝」按钮改成发 `allowed-once` → 界面结果与日志记账两条同时转红。**缺口**：TinyVue/TinyRobot 组件库与 Next SDK 页面工具未接；设计系统只到令牌层，未做上游的槽位/组件呈现体系 |
| npm CLI 本地包 | PASS | `npm pack` → 隔离目录 `npm i -g` 运行；argv/cwd/stdio/退出码正确；主包不含 Electron；无编译器依赖 |
| 桌面本地包 | PARTIAL | Electron 官方二进制已到位（`registry.npmjs.org` 与 `github.com` 双双可达，按决策 9 只用官方源）；`electron-builder --win portable nsis` 出便携包与安装向导，宿主经 `extraResources` 落在 `process.resourcesPath/host/bin`（`paths.cjs` 在 packaged 分支拒绝回改进 asar）；打包后应用 `--smoke` 与 `--ui-smoke` 均 PASS；产物实测 `NotSigned`。**缺口**：签名与实际发布另行授权 |

### 6.2 长期阶段

| 阶段 | 内容 | 门禁与学习主题 |
| --- | --- | --- |
| S0 | 冻结上游/能力矩阵/schema 初稿/环境清单 | 事实、提案与兼容目标区分，评审 |
| P0 | 上表纵向实验 | 验证技术假设，不替代完整产品 |
| M0/M1 | lifecycle/scope/五模式事件/profile/log/recovery/projection/storage | Cordis 依赖与清理、append vs flush、确定性重放 |
| M2/M3 | adapters/流装配/token/prompt/loop/inbox/cancel/compaction | attempt/turn/step 边界、重试与回放 |
| M4 | tools/guard/approval/fs/shell/PTY/jobs/LSP/sandbox/完整 CLI | 权限归核心，npm 安装回归 |
| M5/M6 | Vue/OpenTiny/modules/slots/resources/conversation/sidebar/settings/Next SDK/Electron | 组件非第二真源，IPC 信任，桌面安装回归 |
| M7 | JS host/dynamic packages/PTC/workflow/subagent/team/skills/MCP/goals/schedule | CLI/桌面动态能力一致，DSH 插件兼容分级 |
| M8 | SSH/browser/computer/voice/office/webhook/telemetry/feedback/Web/ACP/SDK/迁移发布 | 完整能力矩阵无隐性删项，平台实测与发布授权 |

P0 先实现最小版本，不要求完整 M0 才能实验；模块按依赖可并行设计。每批循序：问题/失败示例 → DSH 文档/源码/测试 → 仓颉/TS 映射 → 实验 → 正反测试 → 学习回顾。每个子项目单独设计、计划、实施，避免一份巨型计划掩盖接口风险。

---

## 7. 交付形态与后置项

两个一等入口不是可选功能：**独立 CLI（npm 分发）与 Electron 桌面端**。Electron 属于交付层而非开发体验层，不能后置到「可最后」。

首批不实现但保留在矩阵中的项：

- `workspace`：DSH 文档明写为可选、不在 agent-loop 主干，模型看不到其工具/事件；复刻时仍归入完整范围，排在 M5/M6。
- `schedule`/`voice-input`/`office-to-pdf`/`computer-use`/`browser-use`/`ssh`/`webhook`/`otel`/`product-telemetry`/`feedback`：外部集成或上游实验 bundle，排在 M8。
- DSH `sdk-minimal` profile 证明上游自己也用「裁剪 profile」交付（无 compaction/settings/credentials/web tools 等，并 pin `danger-full-access`）；因此分阶段裁剪是合法手段，但裁剪组合必须显式命名，不能当作「完整」验收。
- `web` 取回在上游 shipped 预设下**免逐次确认**；是否照此默认属于产品决策，复刻时单独确认而非默认为 bug。
- HMR 与编译期资产之外的原生动态库/WASM 通道：待 P0/§8 实测后再定，不作为已具备能力。

## 8. 已定架构决策

| # | 决策 | 结论 |
| --- | --- | --- |
| 1 | 核心语言 | 仓颉实现共享运行时与核心业务；Electron/Node 侧只做桌面与 JS 扩展宿主 |
| 2 | 交付入口 | CLI 与桌面端双一等入口，共享同一核心与协议；CLI 包不含 Electron，桌面包不依赖全局 CLI |
| 3 | 前端栈 | Vue 3 + TypeScript + TinyVue + TinyRobot + Next SDK 页面工具接入 |
| 4 | 桌面壳 | Electron（contextIsolation、无 nodeIntegration、sandbox 渲染） |
| 5 | 落点 | 本分支删除既有 SaCode 代码与文档，重新开始；历史留在基线提交 |
| 6 | Cordis 语义照搬度 | 原样复刻语义（服务定位、依赖激活、owner 作用域、五模式派发、层级 patch），实现与命名自定；不简化 |
| 7 | 动态扩展 | 内置仓颉模块 + 独立 Node JS 宿主 + Vue UI 贡献三类并存；DSH 原有插件直接兼容为独立桥接目标，不混同 |
| 8 | 学习与实现顺序 | 先 P0 纵向切片（模型流 + 一个工具 + 日志回放 + 一个动态扩展 + 双入口打包），失败改设计而非删范围 |
| 9 | Electron 二进制来源 | **只用官方 GitHub Releases**，不用 `ELECTRON_MIRROR` 等第三方镜像；`node_modules/electron/dist/` 缺失期间 C10 固定记 **BLOCKED**，不得为凑绿把桌面包从验收范围里删掉。**2026-10-02 解除**：`github.com` 恢复 200，按本决策直接用官方 `install.js` 重装（未设任何镜像变量），`dist/` 就位 269 MB，`npx electron . --smoke` 输出 `SMOKE PASS`、rc=0，退出后无孤儿 `dsh-host.exe`；安装包本身仍未打——`electron-builder` 属新增第三方依赖，需另行授权 |
| 10 | 扩展注册表归属 | `core` 的 `ToolRegistry`/`ListenerRegistry` 是 CLI 与桌面**唯一真源**；内置仓颉工具在 core 登记，JS 动态工具经 `extension/*` 与独立 `extjs/` 宿主接入同一语义（未登记即拒、审批 fail-closed、卸载残留归 0） |
| 11 | 取消的载体 | 取消只认 `TurnToken`（协作式，检查点在帧间），**不认 `Future.cancel()`**——实测后者仅发请求、不停线程（`futureCancelIsCooperativeNotForced`）。turn 跑在 `spawn` 出的仓颉线程上，桌面 stop 才能在流式期间从同一条 stdin 读到；`detached()` 令牌代表已独立发布的后台任务，父取消不得连带杀死它 |
| 12 | 流式期间的写者 | 一个 session 同时只有一个写者：turn 在途时 Host 对其余读写日志的方法回 `-32001 turn-in-flight`，结算（join）后才落盘并归还租约。**这是串行化而非并发安全**——把 `SessionLog` 的并发读写收进锁是后续项，不假装已经做到 |
| 13 | 新会话的空日志 | `SessionLog.load()` 遇「文件不存在」= 零事件的合法回放（返回 true）；损坏只针对「已有内容但序号断裂/尾帧坏掉」。实测原实现把全新会话的第一次写入与第一个 turn 都判成 `replay-rejected`，桌面新会话进不去 |
| 14 | JS 宿主的优雅退出口 | core 侧只拿得到 `std.io.OutputStream` 接口（std 未文档化 `close()`），无法靠「关掉写端」给子进程造 EOF。故优雅退出走协议层 `host/shutdown`（宿主先应答 → 结算在途调用回 `-32002` → `process.exit(0)`），stdin EOF 只作崩溃兜底；`wait` 有界超时后才 `terminate(force: true)` 并如实记 `forcedExit`，「没被强杀」必须是断言而不是假设 |
| 15 | 并发在途的配对规则 | 子进程应答必须按 `"id"` 认领，`ReplyTable` 三条硬约束：表满回压不丢帧（丢帧计数结构性为 0）、等待方收手（`untrack`）之后到达的帧记**迟到账**、从来没人登记过的帧（如 `id: null` 的 parse-error）记**无主账**——两类都不许被任何在途请求认领。写侧整帧互斥（并发写 stdin 会交错出坏帧）。方法层面的一条实测教训：把配对改成「按到达顺序」的变异探针只让 3 条白盒登记表用例变红，子进程集成用例照样全绿——时序类黑盒用例钉不住这条不变量，据此把异步入账的断言改成有界轮询 |
| 16 | 租约的原子获取与归属凭据 | 用 `File.createTemp` 独占落盘 + `rename(..., overwrite:false)`（目标存在即抛）做原子获取，取代 `exists`+`writeTo` 的 TOCTOU；盘上写归属凭据而非裸标志，`release()` 只认自己那份，抢写失败方与「归属已易主的原持有者」都删不掉别人的租约（fail-closed）。崩溃持有者的自动接管**推迟到有自身 pid 与判活 API 时**：Windows 下 std 无此能力（`std.process` 只有 `findProcess(pid)`，`std.posix` 非跨平台），需 CFFI 绑 `GetCurrentProcessId`+`OpenProcess`；在那之前对外行为是明确拒绝，绝不悄悄抢走 |
| 17 | 会话日志的并发口径 | 跨进程仍然只认写租约（一个写者）+ `flush` 才跨进程可见；但**同进程内** turn 线程写、主线程读投影是常态，所以 `SessionLog` 的每个访问过 `Mutex`，生产路径只准用守护访问器（`eventCount/durableCount/pendingCount/snapshotEvents/isTruncatedTail`），不允许拿着内部列表边遍历边拼帧。Host 的 `-32001 turn-in-flight` 因此收窄成只拒**写**：桌面可以边流式边读状态，`pending` 如实报「内存可见但未落盘」。锁的收益只到「读写不撕裂」——**本批把这条主张分成了两半，一半有证据、一半没有**：
`appendFlushAndReplayInterleaveWithoutTearing`（3 个写者各 `append`+`flush`，另一线程持续从磁盘重放）在摘掉 `flush` 的锁后 **3/3 稳定转红，运行时报 `ConcurrentModificationException`** —— 这一条是证据；
而 `concurrentAppendersKeepSeqContiguous` 与「摘掉 `append` 的锁」这个变异体仍然全绿（`size→add` 的窗口太短，本运行时的 `spawn` 在纯 CPU 循环里没有抢占点，四个/三个写者不真交错）—— 这一条仍只是守卫断言，
所以「纯内存 append 的并发安全」在本运行时**无法构造可复现的竞争证据**，不许据绿灯宣称已验证 |
| 22 | 在途调用的轮次归属 | 每次 `turn/start` 递增一个 `epoch`，`extension/host/call` 在发起那一刻记下自己属于哪一轮（不在 turn 里就是 0）。`turn/cancel` **只结算本轮发起的那些**：跨轮误伤会把上一轮仍在途、已经没人在等的调用标成 `cancelled`，界面上分不清是谁干的。`accepted` 与 `started` 帧都回带 `epoch`，归属可被外部核对；EOF 结算仍覆盖全部轮次（进程要走，谁都得结算）。注意语义细节：取消只是发请求，`turn/poll` 结算前 `turnBusy` 不落地，此期间发起的调用仍记在当前轮 |
| 18 | 在途工具调用的取消联动 | 转调不得占住 Host 的 stdin 读侧：`extension/host/call` **发出即回执**（`ExtProcess.sendRequest` 只登记 + 写出，收帧交给独立线程经 `ThreadSafeDeliveryQueue` 交回），结果由 `extension/host/poll` 按 callId 取。取消的键是 `callId`，配对的键仍是 JSON-RPC `id`——两套 id 不混用，否则取消无法指名「哪一次调用」。`turn/cancel` 必须顺带取消它这一 turn 发起的在途调用；宿主退出前**由本端主动取消**、再收帧线程、最后才关子进程：顺序反了终态会混成子进程 shutdown 兜底的 `-32002 host-exiting`，分不出「本端取消」与「宿主没了」（去掉主动取消的变异体实测把 `extensionCancelled` 从 1 打到 0，用例转红） |
| 19 | 渲染层的数据来源与 IPC 面 | 渲染层只显示核心交出来的东西：消息列表 = `session/projection.messages`（尾部 64 条，计数仍为全量）、流式文本 = `turn/poll`、工具与审批态 = `extension/list`/`extension/call` 的真实应答；**前端不拼第二真源**。IPC 按动作命名并逐字段校验类型与范围，不提供「发任意方法」的通道，`dsh:userSend` 固定写 `user/message`——网页拿不到伪造 `system/message` 的口子。Vue 取 runtime 构建 + `h()` 写视图，因为 `script-src 'self'` 禁 `unsafe-eval` 会让带模板编译器的 global 构建整页空白 |
| 20 | 冒烟必须从空会话开始 | `--smoke`/`--ui-smoke` 支持 `--session-dir=<路径>`，验收一律指向新建的空目录。原因不是洁癖：默认的 sessionData 目录跨次累积，「这条写入真的落盘了」会被上一次运行的旧日志蒙混——本轮一条落盘断言就是这样假绿过一次，同一变异体在独立目录里才被抓住 |
| 21 | 会话日志的字段转义 | 落盘格式是按行的 `seq\ttype\tdata`，所以 `escField` 只转义会破坏帧结构的四个字符（`\`、LF、CR、TAB），`load` 对称还原；认不出的转义序列保留反斜杠原样，不做「猜一个字符」的降级。裸换行会把一条事件劈成两行，回放时被当成中段缺帧而**整份拒绝**——聊天输入天然多行，这条不成立就没有 durability 可言。宿主入口侧同步补了 JSON 转义的还原（此前 `jsonStr` 会在 `\"` 处把值截断） |

## 9. 历史参照与文档取代关系

- 既有 SaCode 实现、文档与设计资料已完整保存在基线提交 `428f030`，本分支瘦身后不再包含它们；需要对照时用 `git show 428f030:<路径>` 或从该提交建只读工作副本，不在本分支继续演进。
- `docs/architecture/ref-comparison-deepseek-harness.md` 的基线是 DSH 开发者预览 v0.1，只覆盖 5 个借鉴点，且其「坚决不借鉴」结论以「SaCode 保留稳定内核」为前提；本目标（完整复刻 + 仓颉重写）下该前提不成立，故其结论不再作为决策依据。
- 该文档未覆盖的部分已在 §7 能力地图补齐线索：Typert 网关、Client Slots/Resources/Conversation、extensions 动态插件、subagent/agent-team、workflow/PTC、compaction、invariants、spill、token-meter、sandbox 多平台、SSH、skills、jobs/PTY/LSP、多形态交付。

---

## 10. 证据与可信度

- **本机环境已实测（2026-10-02）**：`cjc 1.1.3 (cjnative)`，target `x86_64-w64-mingw32`；`cjpm 1.1.3`（装于 `D:\Program Files\HuaWei\Cangjie`）；`node v22.23.2`、`npm 10.9.8`。因此 S0/P0 的仓颉编译前提在本机成立；但 stdx（HTTP/TLS/JSON 等）是否随该版本安装、Windows 上的运行库分发方式仍未验证，属 P0 待测项。
- 已通读：文档站 `/reference/**`（19）、会话与持久化（15）、执行与工具（19）、平台与配置（5）、前端与指南（22）、插件开发与 Cordis 教程（21），合计约 101 页；仓库侧 `docs/subsystems/*.md` 16 页 + `docs/config-catalog.md`。
- **自行复核过的二手结论**：agent-lifecycle 页的持久/瞬时事件区分与 compaction 四步顺序，已与原文逐条对上；「文档站有 /zh 双语」经实测**推翻**（`/zh/` 与 `/zh/reference/...` 均 404）。
- **文档自身未覆盖 / 自相矛盾，复刻需自行裁决**：
  - `PTC` 缩写在读过的所有页面里**没有给出全称**（行为=宿主函数绑定的沙箱 JS 运行时 + `await tools.*` 自动桥 + 保留工具 `run_code`）。
  - `session` 页 live-fork 对 open-turn cut 的处理两处描述不一致（拒绝 vs 合成 closers）。
  - `shell` 页正文用 `run`/`start` + `sandboxMode` 能力，生成的 API 却是 `resolve`/`execute`，未解释。
  - `persistence`/`compaction` 页均声明「本页不给出具体配置键」；JSONL 逐字段行格式、Zstandard 压缩配置键未公开。
  - 精确事件签名与完整 schema 在**生成的 Cordis catalog**（`pnpm run gen-cordis-catalog`）里，文档站正文只有手工 prose —— 复刻时若要逐字段对齐，需要另行获取仓库源码或生成物。
  - 本组文档完全未出现 LSP server 侧的交付形态说明（只有 `subsystems/lsp` 的 4 个操作契约）。
- 未读：仓库源码本身、`docs/architecture.md` 全文（文档站 `/reference/` 是其摘要）、各 package README、Agent Notes 决策记录体制（`.agents/notes`，文档多处指向但未展开）。
