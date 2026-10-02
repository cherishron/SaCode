# DeepSeek Harness 全系统复刻蓝图（研究篇）

本文是把 deepseek-harness（下称 **DSH**）官方文档站约 90 页 + 仓库侧 16 页长尾子系统文档读完之后的合成产物，目标是给「由前端到后端完整复刻 DSH」这件事提供**系统地图、硬规格、依赖顺序与每层验收口径**。

- 性质：研究/规划文档，不含实现代码。
- 证据来源：`https://deepseek-harness.github.io/deepseek-harness/en/**`（文档站，仅英文）与仓库 `docs/subsystems/*.md`（16 个长尾页只存在于仓库）。各结论页脚注见 §10。
- 标注约定：`[待确认]` = 需要用户拍板的分叉；`文档未覆盖` = DSH 文档本身没说，复刻时必须自己裁决。

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

## 5. Rust 移植决策表

结论先行：**DSH 真正的价值在 L0 的机制（按名服务定位 + inject 依赖驱动状态机 + 注册即 effect 自动回滚 + 五模式派发 + 层级 patch 合成），这一层全部可以照搬为 Rust trait 设计。不可照搬的只有「运行时任意装载 TS 模块」。**

| TS 依赖点 | 为什么依赖 TS | Rust 替代 | 风险 |
| --- | --- | --- | --- |
| `cordis.yml` 里写字符串路径/包名 → 运行时 `import` | 动态模块装载 | `inventory`/`linkme` 分布式注册 + 名称→工厂 map；yml 只决定**启用**不决定**链接** | 失去「装新代码不重编译」；真正的动态扩展边界要下移到 WASM |
| declaration merging（`Context`/`Events`/`SessionEventMap`/`ChatNodeDataMap`/`ResourceProtocolMap`/`TypertRemoteNamespaceMap`） | 跨包拼接类型全景 | build.rs/proc-macro **codegen 聚合**各 crate 声明 + `TypeId → Box<dyn Any>` typemap 兜底 | 开闭性下降：新增服务键要过 codegen，不再是「任意包可加一行」 |
| `StreamChunk` async generator | `async function*` | `Stream<Item=Chunk>` / mpsc 通道 | 低 |
| `Volatile<T>` + `!!js <expr>` | 类型级标记 + 任意 JS 表达式 | `tokio::sync::watch` + 表单投影；表达式降级为 env 插值或嵌 `rhai` | 语义等价但表达力下降 |
| `Branded<'X'>` / exact-one union / `StandardSchema` | 结构化类型 | newtype + `schemars`/`serde` 校验 | 低（Rust 更强） |
| HMR（模块缓存重置） | Node loader | 进程内可换 dyn 图（卸 fiber → 重跑注册）；换**代码本体**需 `dylib`（不稳定 ABI）或 WASM | WASM 要跨序列化边界，丢掉「注册借用同一对象」的零成本 |
| `Drop` vs async disposer | TS  disposer 可 await | 不能用 `Drop`（非 async），要显式 `async fn dispose()` + 注册序栈 | 忘记 dispose 就是资源泄漏，需在 invariants 层设检测 |
| React + `useSyncExternalStore` + tsx + zod + picomatch + `node:http` | 纯实现细节 | Leptos/Dioxus/Tauri 任一 + `serde` + `globset` + `axum` | 低 |

扩展边界的现实取舍：**核心服务图编译期组合（crate 集合），窄接口数据驱动的（`LlmAdapter`、`Tool` 定义、provider）适合做 WASM 缝。** `[待确认]`

---

## 6. 里程碑与依赖顺序

顺序不可打乱：M0/M1 是 L0/事件溯源，**后三层的每条不变量都押在它上面**；先做 UI 会返工。

| 里程碑 | 内容 | 验收口径（可证伪） |
| --- | --- | --- |
| **M0 基座** | Cordis 等价物（Context/Service/Registry/Fiber 状态机 `PENDING→LOADING→ACTIVE→FAILED/UNLOADING→DISPOSED`/Events 五模式/effect LIFO）+ loader + profile/bundle/patch 合成 + `--dump-config` | ① 插件按 `inject` 就绪才激活，服务消失依赖者自动卸载、回来自动重载；② 卸载后注册表全空（断言残留为 0）；③ patch 整行替换语义有专测；④ invariants 注册表可拒绝「检查方法存在」型断言 |
| **M1 会话真相源** | `SessionEvent` 目录 + `seq` + JSONL 持久化 + `deriveMessages` + projections + storage domain + spill | ① 任意会话 kill -9 后重启，模型可见历史与崩溃前逐字节一致（缺失 closer 由 `interruptedTurnClosers` 合成）；② 未知非 `ignorable` 事件使重建失败（反向测试）；③ 投影对无关事件返回同一引用；④ checkpoint 不超前未落盘事件 |
| **M2 模型层** | `LlmAdapter` 契约 + StreamChunk 装配 + `ReplayEnvelope` + token-meter + retry + system-prompt 装配 | ① 一次 adapter 调用 = 一次 provider attempt（库内 retry 关闭）；② `max-tokens` 后 tool calls 全消；③ prompt 作为 `system/message` surface 节点**进历史**（模型经消息历史而非请求属性看到 prompt）；④ token 测量所有字段同一 `logRevision` |
| **M3 agent loop** | turn/step 边界 + `agent/*` + inbox 四投递（`send`/`followup`/`steer`/`inject`）+ cancel cause + `pre-step`/`request`/`request-error` 瀑布 + compaction 接线 | ① headless profile 能自主跑完「多轮工具调用 + 一次压缩」；② 重复 `MessageId` 被拒；③ `whenIdle()` 语义可测；④ 压缩未闭合 `start` 阻断所有入口 |
| **M4 工具与执行世界** | 9 段流水线 + `guard`/`restrict` + fs 观察策略 + shell/subprocess/jobs/PTY + sandbox + approval + permission presets + plan mode + 核心工具集（read/write/edit/glob/grep/bash/present） | ① 三层裁决（preset 只写事件、plan 咨询、pre-execute+approval 终局）有集成测试；② 无 approval provider 时任何 `ask` 操作被拒；③ 未观察文件写入必 `NOT_OBSERVED`；④ 沙箱不可用报 `SANDBOX_UNAVAILABLE` 而非裸跑；⑤ 非 `isConcurrencySafe` 字面 true 走 exclusive |
| **M5 前端最小闭环** | web-server + typert 网关（in-process + WS 双 carrier）+ 编译期资产嵌入 + slots 注册表 + conversation 装配 + 输入/审批/工具卡 | ① 单向链有静态断言：组件 props 类型里不出现 `ctx`/transport；② 卸载 slot owner 后其声明的子槽递归消失；③ conversation 满足文档 6 条重放等价测试；④ 断线重连从 baseline 整体替换窗口，无通用 `resync` |
| **M6 前端完整** | right sidebar/资源协议/settings 表单/credentials/workspaces/快捷键/文档预览 | ① secret 字段永不出现在响应；② `expectedRevision` 冲突返回权威当前值；③ 未知资源地址即 404/`none` 态 |
| **M7 委托与编排** | subagents(+fork/acp)/agent-team/workflow+PTC/skills/mcp/commands/goal/schedule/todo/deliverables/attachments | ① subagent 深度用「非递减下限 + 绝对帽」；② MCP 工具名 `mcp__<server>__<tool>` 且 serverName 约束 `[A-Za-z0-9_-]{1,32}`；③ schedule at-least-once 有显式测试 |
| **M8 外部集成** | ssh/browser-use/computer-use/voice-input/office-to-pdf/webhook/otel/feedback/extensions(动态插件) | 按需要逐个进；`extensions` 若要「插件市场」则提前 |

**最小可跑通全链路 = M0 + M1 + M2 + M3 + M4 的核心工具**——到 M3 结束就应该有一个能用的 headless agent，别等到前端。

---

## 7. 明确后置 / 可砍清单

文档自己标注为可选或主干外的，复刻时不必第一批做：

- `workspace`：文档明写「可选子系统，不在 agent-loop 主干」，模型看不到任何 workspace 工具/事件。
- `web` 取回默认**免逐次确认**（需确认要自己加 `tools/pre-execute`）——复刻时若默认要确认会明显更难用，这条是产品决策不是 bug。
- `schedule`/`voice-input`/`office-to-pdf`/`computer-use`/`browser-use`/`ssh`/`webhook`/`otel`/`product-telemetry`/`feedback`：外部集成或实验 bundle（`dsh-experimental-*`）。
- `sdk-minimal` profile 明示无 compaction/settings/credentials/OTel/web tools/subagents/filesystem tools，且 pin `danger-full-access`——说明 DSH 自己也接受「裁剪 profile」作为交付形态，复刻时不必一上来全量。
- HMR / Electron：开发体验层，可最后。

---

## 8. 与 SaCode 现有文档的关系

- `docs/architecture/ref-comparison-deepseek-harness.md` 的基线是 **DSH 开发者预览 v0.1**，只覆盖 5 个借鉴点（§3.1 事件投影 / §3.2 工具流水线 / §3.3 执行世界 / §3.4 Profile-Bundle-Patch / §3.5 Agent Loop），且 §5 已记录这些点在 SaCode 内**均已落地**。
- 该文档 §4「坚决不借鉴」的全盘插件化 / Cordis 范式 / TypeScript 技术栈三条，前提是「SaCode 保留稳定内核」。在「复刻 DSH」这个新目标下这三条结论**不再成立**，需要重写而不是沿用。
- 该文档缺失的部分（本次读到的）：Typert 网关、Client Slots/Resources/Conversation、extensions 动态插件、subagent/agent-team、workflow/PTC、compaction、invariants、spill、token-meter、sandbox 四平台、SSH、skills、jobs/PTY/LSP、web 交付形态（web/headless/sdk/acp + Python SDK + Electron）。
- 因此本文与它是**取代关系而非补充关系**。 `[待确认]` 是否把它移到 `docs/plans/archive/`。

---

## 9. 待用户拍板的三个分叉

| # | 分叉 | 我的默认推荐 |
| --- | --- | --- |
| 1 | **落点**：新开独立仓库从零复刻，还是在 SaCode workspace 内新增 crate 渐进替换内核？ | 独立新仓库。SaCode 的 `kernel/runtime/interfaces` 静态分层与「一切皆插件」的 L0 语义冲突（见 §8），在旧壳里改会两头不讨好 |
| 2 | **前端栈**：Rust 全栈（Leptos/Dioxus over WASM）还是 Rust 内核 + TS 前端？ | Rust 内核 + **Tauri 或 Leptos**。依据：`TypertGateway.wireStream` 是「WebSocket 与 in-process transport 共用」的 carrier adapter，且 `InvokeRemoteRequest.peer` 缺省即 in-process carrier——换 IPC 载体是**架构内置许可**，有官方先例 |
| 3 | **Cordis 语义照搬度**：原样复刻五模式派发 + fiber 状态机 + effect 回滚，还是只借概念做简化版？ | 原样复刻语义、重写实现、命名可换。§2 的 18 条不变量里 8 条押在 L0，简化版会让上层返工 |

---

## 10. 证据与可信度

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
