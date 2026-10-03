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

#### 6.1.1 P0 逐项结果登记（2026-10-03 实测，HEAD `e08b286` 之后的本批）

| 项 | 结论 | 证据与缺口 |
| --- | --- | --- |
| 构建 | PASS | `cjc/cjpm 1.1.3` + stdx 1.1.3.1（动态链接 5 包）；host/cli `cjpm build success`；`scripts/pack-host.mjs` 出 89 文件自包含目录，运行不拼 PATH |
| 会话与回放 | PASS | `core` `cjpm test` **103/103**（seq 编号、flush/load 往返、投影过滤与纯度（**缓存键＝surface 条数＋代次：无关事件不重算、直接交回同一份缓存对象，「不重算」与「不更新」两个方向的变异体都被抓**）、租约互斥、**残留租按持有者死活分别接管与拒绝 5 例**、装配终态、尾帧截断三例、会话日志锁下的并发读快照 + **写者落盘与磁盘重放交错的撕裂检测**、**多行与制表符数据的转义往返 2 例**）；durability 屏障与分页由 `bridge.test.mjs` **28/28** 覆盖。**尾帧截断已按 DSH 语义收口**：半写尾帧只丢该帧并保留已提交前缀（CLI 实测尾行无 LF → `ok 2 2`，投影 2 条），`truncatedTail` 经 Host 投影帧透出以便上层把未结算流标 `interrupted`；中段缺帧仍整份拒绝，不静默前滚 |
| 模型流式 | PARTIAL | 假 provider 的半帧/分片/终态/max-tokens/usage 次序已由单测覆盖；**缺口**：真模型 HTTPS+SSE 烟测需用户授权凭证，未执行 |
| 工具与审批 | PASS | `apps/cli` `tool` 模式：`allowed-once` 才放行、无应答即拒、guard 拒绝计数。**审批已补成显式协议往返**：`core/src/approval.cj` 的 `ApprovalDesk` 走 `ask → answer → 一次性 consume`，`approval/asked`、`approval/decided`、`approval/expired` 三类事件写进同一份会话日志（谁批的、批成什么，只能从日志回答），过期由**真实单调钟**（`MonoTime.now()` 差值折算整秒）决定，`ask`/`answer`/`consume`/`stateOf` 每次读前都扫一遍钟结算，协议面上不存在「推进时钟」的动作（`approval/tick` 已撤，能力表 4→3）；认得的决定只有 `allowed-once` 与 `denied`，其余不改判也不成功；已结算工单不接受第二次应答也不放行。桌面 `extension/call` **只认工单号 `approvalId`**，调用方自报的审批字符串在协议面上已无任何通路（bridge「自报审批不放行」钉住）；审批卡片仍是「允许一次/拒绝」两个选项，没有永久授权按钮。core `cjpm test` **103/103**（新增 `approval_test.cj` 8 条 + `pipeline_test.cj` 4 条 + 1 条真实钟过期接线用例）。工具管线已补段：`execute` 与 `executeWithApproval` 共用同一条 `pipeline`（guard → pre-execute 参数归一化 → snapshot → execute → post-execute 无损校验），各段在 `ToolDetail` 留痕，失败归一成互不相同的阶段码；顺带修掉旧 `runTool` 只取第一个空格前正文、静默丢内容的真缺陷。bridge **35/35**（新增 5 条审批用例 + 1 条「协议面没有可推进的时钟通道、ttl 只可缩短」反向用例 + 1 条读侧与版本过期的入口往返）。**读侧已补**：注册表内置 `read`（免审批，因为它不改盘），与 `write` 共用同一条管线——`pre-execute` 裁出路径、`post-execute` 交回盘上真实读到的字节（读不到归一成 `not-found`），并留下版本标记；此后同一路径的 `write` 若发现盘上已被第三方改成**另一份**（等长也算），在写入之前就被 `fs-stale-version` 拒掉且不改盘。回执正文现在可能含引号，所以宿主两处出帧（`okFrame` 的 result 与 `errFrame` 的 message）统一过 `jsonEscapeText`。反证两刀：删掉 `consume` 里的置 `used` → core `allowedOnceIsSingleUse` 与 bridge「只放行一次」同时转红（94→92、33→32）；删掉 `answer` 的决定白名单 → core `answerUnknownIdFailsAndIllegalDecisionIsRefused` 与 bridge「非法审批决定被拒且不改判」同时转红 |
| 扩展生命周期 | PASS | `core/src/ext.cj` 注册表 + `extjs/` 独立 Node 宿主 + `core/src/extproc.cj`（仓颉核心直接驱动 JS 宿主子进程）已落地：core `cjpm test` **103/103**（15 条 `ExtProcess`：握手帧必须来自子进程真实应答、`load→list→call→dispose` 全生命周期走真管道、未知方法回 `-32601`、优雅退出 `exit=0` 且 `forcedExit=false`、子进程收束后不得再有应答、永不应答的调用超时返回 `None` 而不编终态、强杀后读线程照样收束、命令不存在时 fail-closed 不起线程）；`extjs` `node --test` **14/14**（新增按 callId 取消只结算一帧、迟到的 handler 结果不补第二帧、重复 callId 回 `-32022`、取消不存在或已结算的 callId 回 `false`）；CLI `dsh extjs` **12 项断言 ALL PASS**；桌面入口 `bridge.test.mjs` **28/28**（其中 9 条为上一批新增：`extension/host/*` 经 core 子进程走真管道、未 spawn 与无应答分开失败、重复 spawn 被拒且原宿主不丢、父宿主退出后 JS 子进程不得存活、`extension/host/call` 立刻回执且转调期间读侧不排队、`extension/host/cancel` 只按 callId 结算一帧、`turn/cancel` 联动取消在途调用、宿主退出前主动取消并交 `host/settled` 账、**`turn/cancel` 只结算本轮发起的调用**（上一轮仍在途的与 epoch 0 的手动调用都不被误伤，反证：把取消改回「结算全部」该条立刻转红））。并发在途已按 id 配对收口（`core/src/reply.cj` `ReplyTable`）；**转调不再占住 Host 的 stdin 读侧**（`extension/host/call` 发出即回执，收帧交给独立线程 + `ThreadSafeDeliveryQueue`），turn 取消联动在途 `extension/call` 已实测。反证：把 `ExtHost.cancel()` 改成「不真正结算、直接返回 true」→ extjs 2 条与 bridge 2 条同时转红；去掉 EOF 的主动取消 → `extensionCancelled` 由 1 变 0，那条转红。**剩余**：在途调用的轮次归属已按 epoch 隔离（决策 22，`idsForEpoch`），但 Host 仍只允许**单轮 turn 在途**（`turnBusy` 串行），多轮并行时的归属与配额未做 |
| 跨端一致 | PASS | CLI 与桌面共享同一 `session.log`，投影与 seq 同源（bridge「投影与 CLI 同源」）；第二写者经协议拿到 `-32001 already-owned`；`WriteLease` 的 TOCTOU 已用 `File.createTemp` + `rename(overwrite:false)` 原子获取收口，`release()` 只认自己那份 owner 凭据（非持有者释放不得删掉别人的租约）。**崩溃残留租约已可自动接管**（本批补齐，决策 23）：租约凭据带持有者 pid（`writer=<pid>-<临时文件名>`），`core/src/procwin.cj` 用 CFFI 绑 `GetCurrentProcessId`/`OpenProcess`/`GetExitCodeProcess` 判活，`takeoverIfStale()` 只在确认持有者已死时清旧租约并重新独占落位。两入口都接了同一函数（Host 4 个获取点 + CLI `seed`），实测三条分向：死者留下的租 → Host `session/append` 成功写入（`events=durable=5`）、CLI 裸 PATH `seed` 出 `ok seeded 6` 且租约已归还；活者（`writer=<真实 pid>-live`）与旧格式无 pid 凭据 → 都回 `-32001 already-owned`/`err already-owned` 且盘上凭据**逐字节未变**。反证两个变异体：`takeoverIfStale` 一律拒绝 → 死者那条转红 `-32001`；去掉判活一律接管 → 活者那条转红 `Missing expected rejection`。**未做**：跨机共享目录下的租约（pid 只在单机内有意义）与 pid 复用导致的误判（策略上偏向「不接管」）|
| 取消与背压 | PARTIAL | 桌面 stop 与慢消费者两条已实测：`TurnToken` 协作式取消跑在 `spawn` 出的仓颉线程上，`ThreadSafeDeliveryQueue`（Mutex+Condition）投不满只报 `overflow`、`dropped` 恒 0；已独立发布的 `detached()` 令牌不被父取消连带杀死（`futureCancelIsCooperativeNotForced` 钉住「`Future.cancel()` 只发请求」）。计数：core **103/103**、CLI `dsh cancel` 9 项断言裸 PATH rc=0、`bridge.test.mjs` **28/28**（含 turn 在途期间读侧照常应答、`extension/host/call` 在 turn 在途时进得去、**取消按轮次归属只结算本轮调用**）。**Ctrl+C/SIGINT 本批已接线**（决策 24）：`core/src/sigwin.cj` 用 CFFI 绑 `SetConsoleCtrlHandler`，处理器体取消在册的在途 turn 令牌，CLI `sig` 模式跑完整链路（注册→租约→挂令牌→起 turn→握手→结算→归还→退 130）。**剩余**：只剩「系统确实调起了处理器」这一条腿未取证——`GenerateConsoleCtrlEvent` 的三种参数组合在本机全部 `ret=True` 却投递不到任何附属进程，同驱动同控制台下改测 `node` 的 `process.on('SIGINT')` 同样收不到，故判定为**本机交互式控制台缺失（非交互会话/ConPTY）**而非仓颉侧未接；解锁动作是在真能交互的控制台窗口里跑 `dsh sig` 按一次 Ctrl+C（期望无 FAIL 且 rc=130），驱动留在 `scripts/sigwin-e2e.ps1`，判决同时要求 `hits=1`、`kind=0`、`cancelled=true`、`code=130` 与 OS 退出码 |
| UI/Next SDK | PARTIAL | **Vue 3 已接入并真机验收**：`renderer/app.js` 用 `vue.runtime.global.prod.js`（CSP `script-src 'self'` 禁 `unsafe-eval`，所以取不带运行时编译器的 runtime 构建、视图用 `h()` 写，由 `scripts/pack-vendor.mjs` 落进 `renderer/vendor/`）；消息列表只渲染核心投影交出的 `messages`，流式文本只来自 `turn/poll`，工具与审批态只来自 `extension/list` 与 `extension/call` 的实际应答——渲染层不持有第二真源。设计令牌层 `renderer/styles.css`（`:root` 明暗两套 + 语义类，业务样式不写裸色值）。`electron . --ui-smoke --session-dir=<空目录>` **36 条断言全 `UI OK`**：多行带引号的消息经 IPC 逐字符往返且只算一条事件、`durable/pending/tail` 计数条、完整一轮渲回「你好，world」并落 `settled:stop`、可取消一轮点「停止」落 `cancelled`、审批浮层只有「允许一次/拒绝」两条路径且终态与日志记账都如实、放行前 `pending>0`（append 不等于已提交）、`window.require` 为 `undefined`、preload 只暴露 9 个固定动作（本批新增 `approvalAsk` 与 `approvalAnswer`）。反证：审批的自报字符串在协议面已没有任何通路——同一请求去掉工单号立刻被拒（bridge「自报审批不放行」）；把 `consume` 里的一次性置位删掉，core 用例与桌面「只放行一次」两条同时转红。**缺口**：TinyRobot 消息组件与 Next SDK 页面工具未接（TinyVue 本批接入首个组件 `Button`，走构建期折叠，见决策 27）；设计系统只到令牌层 + 组件令牌桥接，未做上游的槽位/组件呈现体系；§6.1.3 表里 Sidebar / Rightbar / Settings 窗 / Automation tasks 页 / 快捷键与 modal 原语这几个面仍未实现 |
| npm CLI 本地包 | PASS | `npm pack` → 隔离目录 `npm i -g` 运行；argv/cwd/stdio/退出码正确；主包不含 Electron；无编译器依赖。**2026-10-03 追加交付面（提交 `343ccd7`）**：CLI 补上方案冻的 headless/结构化面——`dsh tools [--json]` 清单出自 core 注册表、`dsh call <tool> [args] [--json]` 走核心工单（`ask`→标准输入一行应答→`executeWithApproval` 消费一次性凭据）、`dsh headless` 28 条自测并入 `all`；退出码按失败族分开（0/3 审批没过/4 工具不存在/8 执行期失败），stdout 只放结果、诊断走 stderr。安装态（剥掉 SDK 的 PATH，`cjpm` 不可见）实测：`all` 69、`stream` 21、`tool` 11、`ext` 8、`cancel` 9、`extjs` 12、`headless` 28 全 rc=0/0 FAIL；`call write … < /dev/null` rc=3 且盘上无文件、stdout 1 行 stderr 4 行；答 y rc=0 并写出正文；答 n rc=3 且日志留下 `approval/decided:denied`；免审批 `read` rc=0；未登记 rc=4 且不发工单；租约归还。变异反证（把「没人应答」当批过）：`headless` 4 条指定断言转红，且 `call` 真的写出了文件。**未做**：`sig` 仍 BLOCKED（`kind=-1 hits=0`，需真人按 Ctrl+C）。**工单号跨进程不复用已闭**（提交 `8289788`）：`askWithTtl` 发号前先读日志里 `approval/asked` 最大号，号从已落盘最大号往后接，CLI 每次 `dsh call` 重启不再从 1 重来；变异反证（读 `decided` 而非 `asked`）2 条独占受害用例转红；提交级 worktree core 130/130、CLI headless 33 PASS。**仍未解决**：在途未落盘的工单不在日志里，两个进程同时发号仍可能同号 |
| 桌面本地包 | PARTIAL | Electron 官方二进制已到位（`registry.npmjs.org` 与 `github.com` 双双可达，按决策 9 只用官方源）；`electron-builder --win portable nsis` 出便携包与安装向导，宿主经 `extraResources` 落在 `process.resourcesPath/host/bin`（`paths.cjs` 在 packaged 分支拒绝回改进 asar）；打包后应用 `--smoke` 与 `--ui-smoke` 均 PASS；产物实测 `NotSigned`。**缺口**：签名与实际发布另行授权 |

### 6.1.2 与 64 模块能力矩阵的逐 M 对照（2026-10-03 实测，HEAD `ff0d651`）

编号口径：矩阵没有逐条 M 号（M0–M8 是阶段标签），下文编号＝**表内行序**（1=`agent-team` … 63=`workspace`，64=README 行）。
分母已在本批定档（**2026-10-03 重取上游目录并逐名对照，不再是待决口径**）：`api.github.com/.../contents/docs/subsystems` 对
`ref=639ed01…`（冻结）与 `ref=master`（当日）各取一次，两边都是 **192 条目 = 64 `.md` + 64 `.zh.md` + 64 `.i18n.yaml`**，
而 **64 个 `.md` 里有一个是 `README.md`（索引页，不是能力）**，故子系统真分母＝**63 模块 + README 行 = 表体 64 行**。
此前写「64 个模块」是把索引页算进了能力数。逐名比对（不是数数对上，是集合对上）：**双向差集为空，没有缺行**；
`cordis`、`gateway` 在两个 ref 里都不存在，因此不当作「待补的缺行」，改按框架层/交付层显式裁决（`cordis` 整体出局、
`gateway` 由 Host+CLI+npm 平台包部分承接），详见矩阵「M0 基座的裁决」。另记一条漂移：`invariants` 只在冻结快照、
master 已无，master 新增 `claude-code-mods`、冻结快照里没有；本表按 S0 冻结口径，不跟 master 改行。

| 档 | 条数 | 行号 | 判据 |
| --- | --- | --- | --- |
| A 已实现且有可执行证据 | 10 | 12 core、27 persistence、34 session、35 session-projection（本批由 D 移入，见下）、54 tools、2 approval、15 extensions、21 llm-streaming、49 subprocess、59 web-client | 指得到具体名字：core `cjpm test` **86** 个 `@Test`（`extproc` 15 / `procwin` 5 / `sigwin` 5 / `inflight` 4 / `reply` 3 / `session` 22 / `thread` 9 / `cancel` 8 / `ext` 11 / `loglock` 4）、`bridge.test.mjs` 28 + `paths.test.mjs` 3、`extjs` 14、CLI 9 个子命令、Host 能力表 19 个方法、`--ui-smoke` 25 条 |
| B 已实现但无子系统级证据 | 3 | 11 conversation、50 system-prompt、53 token-meter | 代码在但只是切片：`renderer/app.js:10` 只按角色拆文本（无节点/分组/折叠，也无对应用例）；`apps/cli/src/main.cj:47` 系统提示是硬编一条事件；`core/src/agent.cj:52` 只把 usage 当字符串存着，无计量与预算 |
| C 未实现 | 50 | 1,3,4,5,6,7,8,9,10,13,14,16,17,18,19,20,22,23,24,25,26,28,29,30,31,32,33,36,37,38,39,40,41,42,43,44,45,46,47,48,51,52,55,56,57,58,60,61,62,63 | 全仓关键词 0 命中（compaction/mcp/subagent/agent-team/todo/goal/schedule/skills/lsp/sandbox/PTY/terminal/jobs/ssh/webhook/voice/browser/otel/sqlite/slots/sidebar/credentials/…）。唯一命中是假阳性（`ToolSpec` 含子串 `lSp`、`empty` 含 `pty`、Electron 自己的 `sandbox` 开关）。17 filesystem 归此档的依据：只有 `core/src/agent.cj:118-133` 一处 `File.writeTo`，无 read/edit/glob/grep，不变量 14 的 `FS_NOT_OBSERVED`/`FS_STALE_VERSION` 全仓 0 命中 |
| D 文档与代码不符 | 1 | 64 README | 见下（35 已在本批补实并移入 A） |

D 档明细（两条都已亲自复核，不是转抄子代理结论）：
1. **35 session-projection 的「纯度」此前被夸大——本批已补实**。方案不变量 9（`:53`）要求「对无关事件返回**同一引用**（`Object.is` 门控下游）」，
   而改动前 `deriveMessages()` 每次调用都新建 `ArrayList`，旧用例 `projectionIsPure` 只断言两次的 size 与首元素相等——引用是不是同一个，它管不着。
   现在 `core/src/session.cj` 的 `deriveMessages()` 按「surface 条数 + 代次」缓存，键没变就返回**同一个 `projCache` 对象**，
   并新增可观测的 `projectionBuilds()`（重算次数）与用例 `projectionRebuildsOnlyForSurfaceEvents`：
   追加 `turn/start`/`stream/chunk` 后重算次数不变且条数不变，追加 `assistant/message` 后重算次数 +1 且条数 +1。
   身份运算符在仓内文档里取不到（`Object.is` 无出处），所以钉的是它的**可观测等价物**：不重算 + 不重新分配。
   代价写进代码注释：返回的列表按约定只读，调用方就地改它等于改缓存（Host/CLI 现在都只读）。
   两个变异体实测：把键判断改成恒真 → 只有那条用例转红（`projectionBuilds() == builds` 左 1 右 2 之类）；
   改成「只算第一次」 → 同一条用例以 ERROR 报出「相关事件不再更新缓存」的两处断言。其余 85 条两种情况下都照常绿，
   说明这条不变量此前确实没有任何别的用例在守。据此 35 由 D 移入 A。
2. **README 行被算进了能力分母**（矩阵表体最后一行自注它是索引页、不是一条能力；本批已据此把分母改为 63 模块 + README 行）。

**本节表格的计数是 HEAD `ff0d651` 时点的快照**，不是当前值。截至本批（token 计量与预算之后）的当前计数：core `cjpm test` **116/116**、
`bridge.test.mjs` **35** 条（`node --test` 全目录 38 = 35 + paths 3）、extjs **14/14**、Host 能力表 **23** 个方法（审批面由 4 收为 3）、
内置工具集 **2 个**（`write` 需审批、`read` 免审批）、`--ui-smoke` **36** 条 `UI OK`。据此，A 档里的 `approval`、`tools` 两行本批又各自补上了子系统级的分段证据（工单过期改用真实单调钟并撤掉推进通道；工具管线补 pre/snapshot/post 段并归一失败码），
其余行的判据不变。**再往后本批补了读侧**：矩阵的 `filesystem` 由 ☐（C 档）移入 ◐，于是 A/B/C 三档变成 **10 / 4 / 49**（C 档 50→49），`tools` 行的阶段码多出 `not-found` 与 `fs-stale-version`。

另有两处「文档 vs 仓内实况」需要记账（不占矩阵行，但影响采信）：
`docs/evidence/dsh-upstream-freeze.md:3` 声称账本由 `coverage_ledger.cjs` 跑出（`GATE: PASS (9 checks)`），
但 `scripts/` 目录下现在只有 `pack-cli.mjs`/`pack-host.mjs`/`pack-vendor.mjs`/`sigwin-e2e.ps1` 四个文件，**该脚本不在仓内**；
§6.1.1「扩展生命周期」行此前记的「13 条 `ExtProcess`」也已过期，实测 `core/src/extproc_test.cj` 是 **15** 个 `@Test`。

矩阵自身缺行（本仓证据最足的三块在矩阵里反而没有归属行）：取消与背压（`TurnToken`/`ThreadSafeDeliveryQueue`，8 条用例）、
崩溃残留租约接管（`takeoverIfStale`，5 条）、Ctrl+C 接线（`sigwin` 5 条 + CLI `sig`）。
要么给它们补行，要么明确并入 `core`/`persistence`，否则「64 条分母」和实际实现面无法对齐。

补证顺序（按最省轮次排序，每条都是一个具体动作）：
1. ~~`deriveMessages` 加 checkpoint 且无关事件返回同一引用~~ —— **本批已完成**：缓存键为「surface 条数 + 代次」，
   用例 `projectionRebuildsOnlyForSurfaceEvents` 双向钉住，35 已从 D 移入 A。剩下的相关项是
   `session/projection` 帧回带 `checkpoint`（上游语义里 checkpoint 可落后于 durable，当前只有 `truncatedTail`）。
2. ~~审批补协议面：审批只是 `preload.cjs` 里 `dsh:toolCall` 的第三个参数，日志里只有 `tool/result denied:*`，全仓无 asked/decided 事件~~ —— **本批已完成**：`core/src/approval.cj` 落 `ApprovalDesk`（发号、应答、一次性消费、逻辑刻度过期），Host 增 `approval/ask|answer|status|tick` 四个方法并入能力表，`extension/call` 改为只认 `approvalId`（自报审批字符串无通路），渲染层「允许一次/拒绝」两张按钮背后是真的工单往返。剩下的相关项：矩阵里审批所在行的分档待按 §6.1.2 表体行号核对后再调（本批不擅自改分母）。~~把逻辑刻度换成真实单调时钟~~ —— **本批已完成**：`ApprovalDesk` 默认钟源改为 `MonoTime` 差值折算的整秒，`advance()` 与 Host 的 `approval/tick` 通道一并删除（能力表 4→3），`approval/ask` 的 `ttl` 只允许缩短、越界回落默认值。
3. ~~工具管线补段：`ToolRuntime.execute` 只有 5 段，缺 pre/post-execute、无损 snapshot、失败归一化~~ —— **本批已完成**：`execute` 与 `executeWithApproval` 现在共用同一条 `pipeline`（guard → pre-execute 参数归一化 → snapshot → execute → post-execute 无损校验），每段在 `ToolDetail` 上留痕，失败归一成互不相同的阶段码（`unregistered` / `approval-denied` / `guard-denied` / `unknown-tool` / `bad-args` / `io-error` / `threw` / `torn-write` / `ran`），四种新行为各有用例钉住（core 98/98）。顺带修掉一个真缺陷：旧 `runTool` 只取 `split(" ")[1]`，正文里第一个空格之后的内容被静默丢掉。剩下的相关项：矩阵 54 所在行的分档要按表体行号核对后再调（本批不擅自改分母），以及 `snapshotBefore` 目前是字节数而非内容指纹。
4. 真模型传输：`apps/host` 只 `import stdx.encoding.json.*`，全仓无 HTTP/SSE 客户端，21 目前永远只是假 provider。走 `stdx.net.http` + SSE 半帧/UTF-8 分片用例，再加一条真凭证烟测（待授权）。
5. ~~先定分母与 M0：把上面「63 vs 64」与三条缺行定掉，并写明 M0 基座（cordis/scope/invariants/boot/typert/gateway）是「要复刻」还是「显式出局」——否则 C 档 50 条没有收敛判据。~~ —— **本批已定档（2026-10-03 重取上游目录）**：分母＝**63 个模块 + 1 行 README**（192 条目里的 64 个 `.md` 含索引页 `README.md`），逐名双向差集为空、**没有缺行**；`cordis`/`gateway` 两个 ref 都不存在，故按框架层/交付层裁决（`cordis` 整体出局，`gateway` 由 Host+CLI+npm 平台包部分承接），写进矩阵的「M0 基座的裁决」。矩阵表体已按 §6.1.2 的 A/B/C 分档回填「已复刻」列（回填时 ✔ 9 / ◐ 4 / ☐ 50；`token-meter` 由 ◐ 升 ✔ 后为 ✔ 10 / ◐ 4 / ☐ 49；2026-10-03 对话面收口，`conversation` 由 ◐ 升 ✔，按表头名取列复算现为 **✔ 11 / ◐ 3 / ☐ 49**，README 不计数），「上游已核」保持全 ☐ 不假勾。**剩余**：63 个模块逐篇 en/zh 原文的阅读面仍未做（这是 `上游已核` 唯一的补法），以及 3 行 `◐` 切片要各自补子系统级用例。

### 6.1.3 桌面 UI 规格：按上游一等公民面复刻（2026-10-03 定稿）

**复刻口径先划死**：本节验收的是**行为等价**——每个面的数据来源通道、状态迁移、审批与取消路径、Escape/焦点语义；**不宣称像素级复刻**，依据是本仓没有上游的设计稿、令牌表或截图（`docs/evidence/dsh-upstream-freeze.md` 冻结的是 64 个 subsystems 文档与站点参考页，属能力契约而非视觉规格）。任何「外观照抄」的说法在没有一手视觉证据前一律不写。

面清单来自本方案 §3.4 已抄录的上游 UI 一等公民面，逐面对到我们的协议通道：

| 面 | 上游含什么 | 数据来源（只允许这些通道） | 交互与终态 | 现状 |
| --- | --- | --- | --- | --- |
| Sidebar（brand / panellist / workspaces / directoryFlow / settings 触发） | 会话列表面板与工作区切换 | `session/catalog` 扫描默认日志及 `sessions/<目录>/session.log`；`session/create` 与 `session/select` 调用 core，标题和所选会话均由日志回放得出 | 新建并打开会话；切换前 flush 旧写入，待审批/未消费工单、在途回合与扩展须先结算；选择持久化并在重启后恢复 | 部分：中文列表、新建和切换已接入；工作区选择、目录流程及 CLI 对应交互未实现 |
| Main · conversation header | 当前会话标题、模型、轮次状态 | `session/projection`（events/durable/pending/tail）+ `turn/poll` | 状态只随协议应答变，前端不自造 | **已实现**（计数条 + turn 条） |
| Main · composer bar（attachments / permission / plan / model） | 输入框上方的四个选择器 | 附件与权限档需 core 新增面；model 选择需真 provider | 无 provider 时不得显示可选模型凑数 | 仅输入框已实现；操作条的「跑一轮（完整）」已改由 TinyVue `Button` 渲染（构建期折叠），attachment/permission/plan/model 四个选择器未实现 |
| Main · hero（workspace-agentPreset） | 空会话时的 agent 预设卡 | 需 core 提供预设清单 | 预设不是第二真源，只产 `user/message` | 未实现 |
| Main · plugins 列表与详情 | 已登记扩展与贡献的工具 | `extension/list`（含 `misses`/`guardDenials` 计数） | 卸载后列表与监听残留归 0 | **已实现**（工具侧栏 + 计数） |
| 审批卡 | 一次性放行/拒绝 | `approval/ask` → `approval/answer` → `extension/call{approvalId}` | 工单号显示在卡上；消费即失效，过期即拒 | **已实现**（本批，打包态 29 条断言含此项） |
| Rightbar（pane/tab/float/split、guide、文档预览） | 多窗格与文档预览 | 需新的投影窗口（同一日志的不同切片） | 拆分不得复制真源 | 未实现 |
| Settings 窗（general / models provider-card / plugins tab） | 配置面 | 方案 §2.5 配置面尚未接 | 配置写入要落盘且可回放 | 未实现 |
| Automation tasks 页 | 定时任务列表 | 上游权威数据在 storage-domain 不在会话历史 | at-least-once 投递，崩溃可重复 | 未实现 |
| 快捷键 + 共享 modal 原语（顶栏 Escape 仲裁、焦点归还） | 全局键盘与弹层语义 | 纯前端，但**必须可断言** | Escape 只关最上层；关闭后焦点归还触发元素 | 部分（按钮可点，Escape/焦点边界未测） |

**验收增量口径**（每接一个面就加一条，不许只加代码不加断言）：该面的数据只能来自表里那一列的通道；界面上出现的每个数字/状态都能在 `session.log` 或协议应答里找到出处；`--ui-smoke` 的 `UI OK` 条数只增不减。

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
| 16 | 租约的原子获取与归属凭据 | 用 `File.createTemp` 独占落盘 + `rename(..., overwrite:false)`（目标存在即抛）做原子获取，取代 `exists`+`writeTo` 的 TOCTOU；盘上写归属凭据而非裸标志，`release()` 只认自己那份，抢写失败方与「归属已易主的原持有者」都删不掉别人的租约（fail-closed）。崩溃持有者的自动接管见决策 23（本批已落地）；凡是判不出归属的凭据一律退回「明确拒绝」，绝不悄悄抢走 |
| 17 | 会话日志的并发口径 | 跨进程仍然只认写租约（一个写者）+ `flush` 才跨进程可见；但**同进程内** turn 线程写、主线程读投影是常态，所以 `SessionLog` 的每个访问过 `Mutex`，生产路径只准用守护访问器（`eventCount/durableCount/pendingCount/snapshotEvents/isTruncatedTail`），不允许拿着内部列表边遍历边拼帧。Host 的 `-32001 turn-in-flight` 因此收窄成只拒**写**：桌面可以边流式边读状态，`pending` 如实报「内存可见但未落盘」。锁的收益只到「读写不撕裂」——**本批把这条主张分成了两半，一半有证据、一半没有**：
`appendFlushAndReplayInterleaveWithoutTearing`（3 个写者各 `append`+`flush`，另一线程持续从磁盘重放）在摘掉 `flush` 的锁后 **3/3 稳定转红，运行时报 `ConcurrentModificationException`** —— 这一条是证据；
而 `concurrentAppendersKeepSeqContiguous` 与「摘掉 `append` 的锁」这个变异体仍然全绿（`size→add` 的窗口太短，本运行时的 `spawn` 在纯 CPU 循环里没有抢占点，四个/三个写者不真交错）—— 这一条仍只是守卫断言，
所以「纯内存 append 的并发安全」在本运行时**无法构造可复现的竞争证据**，不许据绿灯宣称已验证 |
| 22 | 在途调用的轮次归属 | 每次 `turn/start` 递增一个 `epoch`，`extension/host/call` 在发起那一刻记下自己属于哪一轮（不在 turn 里就是 0）。`turn/cancel` **只结算本轮发起的那些**：跨轮误伤会把上一轮仍在途、已经没人在等的调用标成 `cancelled`，界面上分不清是谁干的。`accepted` 与 `started` 帧都回带 `epoch`，归属可被外部核对；EOF 结算仍覆盖全部轮次（进程要走，谁都得结算）。注意语义细节：取消只是发请求，`turn/poll` 结算前 `turnBusy` 不落地，此期间发起的调用仍记在当前轮 |
| 18 | 在途工具调用的取消联动 | 转调不得占住 Host 的 stdin 读侧：`extension/host/call` **发出即回执**（`ExtProcess.sendRequest` 只登记 + 写出，收帧交给独立线程经 `ThreadSafeDeliveryQueue` 交回），结果由 `extension/host/poll` 按 callId 取。取消的键是 `callId`，配对的键仍是 JSON-RPC `id`——两套 id 不混用，否则取消无法指名「哪一次调用」。`turn/cancel` 必须顺带取消它这一 turn 发起的在途调用；宿主退出前**由本端主动取消**、再收帧线程、最后才关子进程：顺序反了终态会混成子进程 shutdown 兜底的 `-32002 host-exiting`，分不出「本端取消」与「宿主没了」（去掉主动取消的变异体实测把 `extensionCancelled` 从 1 打到 0，用例转红） |
| 19 | 渲染层的数据来源与 IPC 面 | 渲染层只显示核心交出来的东西：消息列表 = `session/projection.messages`（尾部 64 条，计数仍为全量）、流式文本 = `turn/poll`、工具与审批态 = `extension/list`/`extension/call` 的真实应答；**前端不拼第二真源**。IPC 按动作命名并逐字段校验类型与范围，不提供「发任意方法」的通道，`dsh:userSend` 固定写 `user/message`——网页拿不到伪造 `system/message` 的口子。Vue 取 runtime 构建 + `h()` 写视图，因为 `script-src 'self'` 禁 `unsafe-eval` 会让带模板编译器的 global 构建整页空白 |
| 20 | 冒烟必须从空会话开始 | `--smoke`/`--ui-smoke` 支持 `--session-dir=<路径>`，验收一律指向新建的空目录。原因不是洁癖：默认的 sessionData 目录跨次累积，「这条写入真的落盘了」会被上一次运行的旧日志蒙混——本轮一条落盘断言就是这样假绿过一次，同一变异体在独立目录里才被抓住 |
| 21 | 会话日志的字段转义 | 落盘格式是按行的 `seq\ttype\tdata`，所以 `escField` 只转义会破坏帧结构的四个字符（`\`、LF、CR、TAB），`load` 对称还原；认不出的转义序列保留反斜杠原样，不做「猜一个字符」的降级。裸换行会把一条事件劈成两行，回放时被当成中段缺帧而**整份拒绝**——聊天输入天然多行，这条不成立就没有 durability 可言。宿主入口侧同步补了 JSON 转义的还原（此前 `jsonStr` 会在 `\"` 处把值截断） |
| 27 | 组件库的消费形态 | `@opentiny/vue@3.32.0` 实测为 **ESM-only**：`main` 与 `module` 都指向 `./index.js`，全文是 `import ... from "@opentiny/vue-xxx"` 的裸说明符，包内**没有 `dist/`、没有 `unpkg`、没有 global/UMD 构建**。我们的渲染层是 `file://` 下的经典脚本页（ES module 被 CORS 拦）且不带模块加载器，所以它**不能**被 `<script>` 直引。2026-10-03 的隔离探针（临时目录 `npm i @opentiny/vue esbuild`）证明可行路径是**构建期一次性折叠**：`esbuild --bundle --format=iife --alias:vue=./vue-global.cjs`（shim 只有一行 `module.exports = globalThis.Vue`，把 `vue` 指向我们已 vendor 的那一份 runtime）→ Button + Modal 产出 **572,850 字节**，产物里 `new Function(` **0** 处、`eval(` **0** 处、残留 `require("vue")` **0** 处，CSP `script-src 'self'` 不破。组件的 render 函数是预编译的（`createElementVNode`/`renderSlot`），不带运行时模板编译器。据此**在真正落地折叠脚本那一批**同步修订 AGENTS.md 里「无打包器」的措辞为**「运行时无模块加载器与模板编译器；第三方组件由构建期脚本折叠成单个经典脚本」**——esbuild 只作 devDependency，不进产物运行时。仍待实测：主题 CSS 与我们令牌层的冲突（上游用 `--tv-*` 变量族，不得让它成为第二套色值真源）。**本批已落地**：`scripts/pack-tinyvue.mjs` 折叠 `Button` 产出 309,044 B JS + 116,176 B CSS 进 `renderer/vendor/`（该目录 gitignore，属产物），`index.html` 先载组件 CSS 再载我们的令牌层（冲突由令牌层收尾），`styles.css` 末尾只桥接真用到的 35 个 `--tv-*` 色令牌到本仓语义令牌；`npm run vendor` 串起两个脚本。`--ui-smoke` 加两条专门断言（按钮类名须由 `tiny-button` 出、`--accent` 与 `--tv-color-act-primary-bg` 解析值必须一致），打包态 **31 条 `UI OK`、0 条 FAIL、rc=0**（原 29 条）。反证：删掉 `--tv-color-act-primary-bg: var(--accent)` 一行 → 断言两侧解析成 `rgb(126, 160, 255)` 与 `rgb(25, 25, 25)`，当场转红 |
| 28 | 桌面 UI 的复刻口径 | 验收只打**行为等价**：面清单、数据来源通道、状态迁移、审批/取消路径、Escape 与焦点归还，逐条能在 `session.log` 或协议应答里找到出处（§6.1.3 的表）。**不宣称像素级复刻**——本仓没有上游设计稿、令牌表或截图作为一等证据，`dsh-upstream-freeze.md` 冻结的是 64 个 subsystems 文档与站点参考页（能力契约，非视觉规格）。每接一个面必须同时加一条 `--ui-smoke` 断言，且 `UI OK` 条数只增不减 |
| 29 | 过期只由时间决定，不由调用方决定 | 逻辑刻度（`advance` + `approval/tick`）有一个方向性缺陷：**没人推进就永不过期**，而「谁来推进」只能做成协议面上的一条通道——等于把过期权交给调用方。据此改为 ttl→绝对 deadline，默认钟源 `MonoTime.now()` 差值折算整秒（单调：系统改时不能让未结算工单提前或无限延后过期），并且**读即结算**（`ask`/`answer`/`consume`/`stateOf`/`pendingCount` 每次先扫一遍钟），`advance()` 与 Host 的 `approval/tick` 通道整体删除，能力表由 4 个审批方法收为 3 个。协议面唯一新增的可达入口是 `approval/ask` 的 `ttl`，且**只允许缩短**：缺省（本宿主解析器对缺失数值键回 `-1`）或越出 `1..默认值` 一律回落默认值。可注入的钟只作为测试接缝存在，不承担生产语义；反证是一条把默认钟冻成常量的变异体——99 条里恰好只有那条「不注入任何钟、用真实时间跨过 1 秒窗口」的用例转红，证明钉的是生产接线而非假钟。仓颉侧一条硬约束记在这里：**捕获可变局部变量的 lambda 不能被当函数值传出去**（`lambda capturing mutable variables needs to be called directly`），所以假钟必须装进一个不可变引用（`class ApprovalTick { var now }`）由闭包读其字段；无参 lambda 的字面量是 `{ => expr }`，写成 `() => expr` 会报 `expected ';' or '<NL>', found '=>'` |
| 26 | 审批的凭据只能是工单号 | 审批从「调用方自带一个字符串自称批过了」改为 `ask → answer → 一次性 consume` 的显式往返（`core/src/approval.cj`）。三条 fail-closed 规则：认得的决定只有 `allowed-once` 与 `denied`（其余不改判也不成功）；一次性是字面意思的一次，消费即失效；过期即拒（**真实单调钟**：ttl 换算成绝对 deadline，读即结算，见决策 29；原逻辑刻度 `advance` 与 `approval/tick` 通道已删除）。`asked/decided/expired` 都写成会话日志事件——「谁批的、批没批、批过头没有」只能从唯一真源回答。协议面上：`extension/call` 对需审批工具只认 `approvalId`，桌面 IPC 的 `dsh:toolCall` 也只收工单号，渲染层没有自报审批的通路；未登记名由注册表按拒绝默认取值，检查顺序固定在审批之前。**参数命名硬约束**：本宿主按整帧字节扫描取值，参数不能叫 `id`（会先撞上 JSON-RPC 信封自己的 `id` 并被静默读成 `-1`），工单句柄统一叫 `approvalId` |
| 25 | 投影缓存的键与只读契约 | 不变量 9 要求「对无关事件返回同一引用（`Object.is` 门控下游）」，但仓内文档取不到身份比较运算符（`Object.is` 无出处），所以钉的是它的**可观测等价物**：`deriveMessages()` 以「surface 事件条数 + 代次」为键缓存，键没变就返回同一个 `projCache` 对象，并暴露 `projectionBuilds()` 让「有没有白重算」可被断言。两个方向都要钉——只测「不重算」会退化成永远不更新的假绿：`turn/start`/`stream/chunk` 只动 `events` 不动 surface 计数，故不触发重建；`assistant/message` 必须触发；`load()` 这类整体替换走 `generation += 1`，避免新旧表面条数恰好相同时端着旧缓存。代价写进注释：**返回的列表按约定只读**，调用方就地改它等于改缓存（Host/CLI 现在都只读其 size/元素）。防回归证据：把键判断改成恒真只有那条用例转红，改成「只算第一次」同一条以 ERROR 报出「不再更新」 |
| 24 | 中断的处理面 | std 无信号 API，Windows 的「有人按了 Ctrl+C」只有 kernel32 的 `SetConsoleCtrlHandler` 一条路。三条实测约束决定了形状：① 回调由**系统新起的线程**调起，且 `CFunc` **不得捕获环境**，所以在途 turn 的令牌只能经一张进程级在册表（`Mutex` + `ArrayList`）交接，回调体只做「记账 + 逐个 `cancel()`」；② 处理器必须**只注册一次**（`install()` 幂等），否则一次中断把同一批令牌取消多次，「这一轮被第几次中断取消」就无从判断；③ 返回 `TRUE` 表示「本进程已自行处理」，进程不按默认方式就地终止——这正是协作式取消要的：turn 在检查点收束、未 flush 的写入结算、写租约归还，都发生在同一个进程里，不会把半写状态留在盘上。退出码沿用 **130（128+SIGINT）**，且断言失败时退 1，避免「被杀也算过」。两处踩过的坑记在这里：stdout 被重定向时是**块缓冲**，握手行不 `getStdOut().flush()` 外部驱动永远等不到；provider 在帧间自旋用的 `sleep(1ms)` 在本运行时粒度远大于 1ms，等不到中断时不主动取消就是几十秒挂死。取证分级要诚实：`install()` 返回值与处理器体行为有用例（core 85/85 里占 5 条），**OS 真的调起处理器这一条在本机取不到证据**——`GenerateConsoleCtrlEvent` 三种参数组合全部 `ret=True err=0` 而目标计数恒 0，同一驱动同一控制台下换 `node` 的 `SIGINT` 也一样收不到，所以是环境（非交互会话/ConPTY）缺投递，不是接线缺失；补证动作是在可交互的控制台窗口里手按一次 Ctrl+C |
| 23 | 崩溃持有者的租约接管按「确认已死」判 | 租约凭据从裸标志升级为 `writer=<pid>-<临时文件名>`，`holderPid()` 只按字节扫 `writer=` 前缀到第一个 `-`，认不出就返回 0。判活用 `core/src/procwin.cj` 的 CFFI 绑定（`GetCurrentProcessId` 取自身 pid、`OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION)` + `GetExitCodeProcess` 看 `STILL_ACTIVE`），`takeoverIfStale()` 只在「有租约 + 能认出 pid + 确认该 pid 已死」三条同时成立时才清旧租约并重新独占落位；清不掉或重取失败都返回 false，绝不留下「接管成功但没有归属」的中间态。取舍方向是**宁可挡住也不抢错**：pid 复用让死者看起来活着 → 不接管；旧格式凭据没有 pid → 永不接管（实测维持 `-32001`）。CFFI 实测三条坑：`inout` 是**调用点**修饰符，写进 `foreign func` 声明会被判「expected declaration here」，故形参声明 `CPointer<UInt32>`、调用处传 `inout code`；Win32 的 `BOOL` 是 4 字节，映射成仓颉 `Bool`（C `bool`，1 字节）会读错宽度，故一律用 `Int32`；kernel32 的这四个符号在 Windows 上**不需要额外 `link-option`**，`cjpm build` 直接链上。跨机共享目录不在本实现范围内（pid 只在单机有意义，真要跨机得换带 `fcntl` 的锁服务）|

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
