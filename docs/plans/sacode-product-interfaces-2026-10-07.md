# SaCode 自主产品接口与状态设计

基线 `35a69ca9e0f8b7b6ac51271ec76eff3515eaa820`。以下是增量设计，不是接口已实现声明；现有 Host 使用 NDJSON JSON-RPC，保持 `initialize` 能力协商，新增动作只有经协商支持才能显示可执行。需求 ID 对齐 [追踪表](sacode-product-traceability-2026-10-07.md)。

## 1. 层次与权威数据

核心定义业务类型、状态机、授权、取消、版本裁决和持久屏障；Host 做 RPC/进程/平台适配；CLI 直接调用同一业务服务，不依赖桌面或另写判据。渲染层仅保存编辑缓冲、焦点和布局，凭据不进入普通 owner 对象。提供方不得绕过统一工具执行、审批与结算。

| 对象 | 权威源 | 状态与控制边界 |
| --- | --- | --- |
| 会话/轮次/工具事实 | SessionLog 与持久化服务 | idle→running→settling→completed/failed/interrupted；落盘确认后才报告提交成功；重启中间态恢复为待核，不能重做未知副作用 |
| 草稿 | 本机按会话保存的草稿服务；UI 编辑缓冲有单调 editRevision | draft→submitting→accepted 或 draft+error；发送回执只清理所提交版本，不能清后来的编辑 |
| 队列 | AgentInbox 既有 splice 事实 + 增量控制投影 | queued/editing/submitting/accepted/processed/failed/cancelled；消费和编辑互斥；移除已接收条目拒绝；排序保留附件身份 |
| 目标 | GoalService/GoalRunner 与日志 | inactive/active/paused/blocked/completed/ended；边界准入读最新修订；完成证据绑定 goalId+revision，编辑重置旧证据 |
| 计划 | 独立 PlanService 与日志 | draft/proposed/approved/executing/completed/rejected；批准不替代工具授权；步骤结算引用工具证据 |
| 待办 | TodoService 投影 | pending/in_progress/completed；状态是工作提示，不能单独证明目标完成 |
| 文件/Git | 文件系统、编辑缓冲、Git index/HEAD | 磁盘版本、缓冲版本、AI 本轮版本分开；暂存与提交结果由 Git 读回确认 |
| 模型/计量 | 注册表、凭据库、账本与在途预约 | 请求启动固定 model/provider；容量/价格未知显示 unknown；累计消耗不得当作当前上下文 |
| 标签/布局 | 本机偏好与项目布局 | 标签仅持资源引用，任务和连接另有生命周期；恢复不自动执行/连接/授权 |

## 2. 公共协议和失败语义

保留已有方法参数与错误，新增接口采用具名参数对象，禁止用同一方法悄悄改旧输入格式。新增变更请求携带 `sessionId`、适用时 `taskId`、`requestId`（幂等键）、`expectedRevision`；响应含业务对象身份、当前 revision 和实际状态。RPC id 只做传输关联，不能替代持久幂等键。

变更失败返回具名原因：invalid-input、revision-conflict、not-authorized、unsupported、busy、not-found、cancelled、provider-unavailable、persistence-failed、outcome-unknown。Host 映射到 JSON-RPC error.data 的 reason/retryable/currentRevision，CLI 返回非零退出码及同一原因。诊断走 stderr；stdout 仅协议/机器结果。不得把文件读取异常归为参数错误，或把底层秘密带入诊断。

取消分两层：请求取消仅阻止该请求后续动作；任务取消请求 TurnToken 协作停止并等待结算。已送达外部输入不能撤回；状态未知显示 outcome-unknown，禁止自动重试。写操作在持久屏障失败时保留待核状态，不能报告 accepted。

异步结果匹配会话/任务/操作身份和草稿修订。轮内模型切换只影响后续请求。订阅带可恢复游标，断连重取快照后续接事件；序列间隙不能凭增量猜状态。所有新增事件版本在持久化设计评审后定稿，不直接迁移现有日志格式。

## 3. 双入口动作表

现有 Host 方法沿用；下表标“新增”的动词是设计目标，不在 initialize 中冒报。CLI 采用 `sacode <域> <动作> --session <id> --json`，人机输出共用结果对象；无 `--json` 时输出中文。只读缺授权也须拒绝跨作用域取数。机器模式不交互授予权限，缺授权返回 not-authorized。

| ID | Host 现有/新增面 | CLI 对应动作 | 输入→输出 / 权限 / 持久化 / 首要用例 |
| --- | --- | --- | --- |
| F01 | 现有 session/catalog/create/select；新增 session/archive、draft/get/save | session list/create/select/archive；draft get/save | 项目/会话、修订→目录或草稿；项目作用域；草稿本机保存；旧响应不串会话 |
| F02 | 现有 task/start、turn/cancel/poll；新增 task/describe、trace/describe | task run/status/cancel；trace show | 任务文本、引用、权限→任务状态与事件；工具逐项授权；起轮/结算持久；模型失败无假完成 |
| F03 | 现有 queue/*；新增 queue/begin-edit、commit-edit、abort-edit、reorder | queue list/add/edit/remove/steer/reorder | 条目 id、版本、编辑租约、完整引用→队列修订；本会话；splice 与引用一起提交；编辑/消费竞争 |
| F04 | 现有 goal 控制；新增 goal/end、evidence/submit | goal show/create/edit/pause/resume/end | 目标修订、证据身份→状态；核心核证据，不接受 UI 自报完成；日志持久；暂停不杀当前轮 |
| F05 | 新增 reference/search、command/list/execute、project/init-draft/apply | reference search；command list/run；init preview/apply | 查询、来源、版本→引用/草案；读取范围及命令执行权限；init CAS 合并；输入法与失效来源 |
| F06 | 现有 usage/status、ledger/stats；新增 context/describe、compact/request/status | context show；compact run/status；usage show | 任务+模型容量来源→占用/预留；摘要独立请求；保留旧历史并原子切换；安全点/失败不替换 |
| F07 | 沿用 model/registry、custom、credential、model/pull | model list/select/configure；credential set/unset | 模型/供应商/修订→公开配置；凭据仅 Host/CLI 安全输入；注册表保存；请求启动固定供应商 |
| F08 | 新增 file/open/save、diff/describe、git/status/stage/unstage/commit/push/history | file open/save；diff show；git status/stage/unstage/commit/push | 文件版本、Git index 指纹→版本/差异/结果；写/提交/推送分别授权；文件保护替换；冲突不覆盖 |
| F09 | 新增 terminal/create/input/resize/interrupt/describe/close、action/run | terminal open/send/resize/interrupt/status/close；action run | 目标、cwd、环境、实例→PTY/退出码；执行授权；进程事实记录、输出有界；关闭标签不杀进程 |
| F10 | 新增 delegation/create/describe/cancel、acp/probe | agent probe/delegate/status/cancel | 协作者+能力+目标→执行标识与边界；外部授权披露；委派结算持久；三产品逐个协议探针 |
| F11 | 新增 knowledge/query/upsert/delete/reindex、memory/*、note/*、annotation/* | knowledge/memory/note/annotation 各自 query/edit/remove | 来源与作用域→引用/修订；跨项目需授权；原文与索引分源；重建失败不丢原文 |
| F12 | 现有 plugin/* 与 extension/host/*；新增 plugin/install/update/reload | plugin list/install/enable/disable/update/reload/uninstall | 清单、依赖、摘要→installed/enabled/active；代码执行授权；事务装配；失败回滚全部贡献 |
| F13 | 新增 automation/list/update/pause/run/history、hooks/describe | automation list/edit/pause/run/history；hooks show | 作用域、触发、错过策略→声明与运行分列；无人值守不能扩大权限；幂等触发持久；重复/重启 |
| F14 | 新增 control/describe/authorize/observe/act/stop、browser/open | control status/observe/act/stop；browser open | 目标身份、快照版本、租约→实际结果；截图/输入分别授权；记录操作不存秘密；越权/断连停止 |
| F15 | 新增 ssh/connect/describe/execute/disconnect、deployment/run/status | ssh connect/status/exec/disconnect；deploy run/status | 主机指纹、cwd、任务→远程结果；信任/命令/部署授权；状态事实持久；未知不能盲重试 |
| F16 | 新增 database/connect/objects/query/cancel/transaction/export | db connect/objects/query/cancel/transaction/export | 引用凭据、方言、参数、页界→结果/事务状态；默认只读，写单独授权；事务结果由驱动确认；断连 unknown |
| F17 | 新增 scan/run/status/fix | scan run/status/fix | 文件版本、静态/增量/深度→范围和结果；修复需写授权；报告与补丁关联；并发修改拒绝覆盖 |
| F18 | 现有 prompt/enhance/poll/cancel；新增 voice/start/stop/transcribe | prompt enhance/cancel；voice record/transcribe | 仅当前草稿、模型固定→文本+实际用量；不进入 Agent；草稿不落消息；编辑改回同文也丢迟到结果 |
| F19 | 现有 custom/import 仅模型；新增 import/preview/apply/status/cancel | import preview/apply/status/cancel | 来源类型/映射/摘要→去重计划/报告；只读来源，剔秘密；新增条目事务与游标；重复导入不重复 |
| F20 | 现有 global/settings/appearance；新增 settings/describe/update、diagnostics/export | settings show/set；doctor/export | 设置键、作用域、修订→保存值/有效值/加载值；秘密不回显；原子保存；代理保存后重启生效 |

新 CLI 动作不能复用当前 `all/goal/tool` 自测语法冒充产品入口。实现按能力协商区分产品命令与诊断命令，既有自测作为回归保留。

## 4. 工作台贡献与编辑状态

复用 SlotCore/ClientScope 的声明、作用域、effect 清理。增加工作台标签类型贡献，要求 typeId、中文 label、instanceKey、资源身份、所属项目/任务、可序列化布局引用、组件和 dispose。不得在布局保存凭据或正文。

标签同资源默认聚焦，终端/查询可显式新实例；每实例有 clean/dirty/running/disconnected 状态。关闭 dirty 时提供保存/放弃/取消；关闭 running 提供仅关视图/停止并关/取消。卸载插件先停止接纳新调用，结算在途，再撤销槽位与释放资源；失败展示卸载错误，不遗留可执行按钮。

上下双组保存标签归属、顺序、当前标签、比例、常用类型；聚焦模式是临时视图，退出恢复原组；窄窗切换对话/工作台不销毁实例。模型中心只有一个管理入口，设置模型动作打开同一页面。

增强替换作为一次可撤销编辑：捕获 sessionId、editRevision、requestId 和模型；成功仅在三者仍匹配时替换，保存原文与选区。不弹预览、不发送、不跑工具；按钮回退与 Ctrl+Z 撤销该次替换。继续编辑后增强按钮复位，撤销先回退后续编辑；取消/切会话使请求失效，即使文字改回相同也拒绝旧结果。UI 缓冲撤销不是历史消息撤回。

## 5. 外部解锁与验收

ACP 为 OpenCode、CodeBuddy CLI、Qoder CLI 分别做版本/握手/发现/认证/取消/结果探针；不支持能力明确拒绝。ASR 检测真实工具链；数据库三方言各验参数、分页、取消、事务和 DDL；浏览器/电脑核目标身份和实际动作，不用回显模拟成功。Windows/Linux/鸿蒙分别记录进程、PTY、凭据存储、图形与打包前提，未具备则 BLOCKED。

接口实施必须覆盖：版本冲突、重复 requestId、跨会话迟到、权限拒绝、取消竞态、持久失败、断连恢复、提供方不支持。第一批原型只验证 UI 行为，真实 provider/核心/双入口/安装态均另验。未知事件迁移、持久屏障与恢复 closers 先评审后落库；不能通过更改旧事件含义修复兼容。


## F02 / F09 执行增量（2026-10-07）

F04 CLI 增量（2026-10-08，待验收）：`sacode goal run <objective>` 显式创建新目标并调用共享 GoalRunner；活动/暂停/受阻目标不可被创建动作覆盖。`sacode goal describe` 仅恢复日志投影，不发模型请求。模型配置读取 SACODE_PROVIDER_BASE_URL/MODEL/KEY，缺配置退 69 且不创建目标。默认有限轮次 8、无进展 3、时长上限 3600 秒；读取日志中的预算历史，逐轮结算。不提供自动授权，写工具须精确一次性工单；Shell/代码执行仍禁止绕过监督门禁。Ctrl+C 绑定共享 TurnToken，网络等待与 stdin 审批等待的取消时效另取证。持久失败保留租约；旧无参数 goal 自测保持兼容，不能算用户任务通过。

具体身份、授权、取消、退出证据、持久与恢复、构建测试判据见 [执行与构建测试增量契约](sacode-execution-contract-2026-10-07.md)。当前以 §12–§17 的工作区实现为准：execution/state version=1、精确一次性准入、持久屏障与恢复，以及固定六动作 ExecutionApi。Host/CLI 已分别从新源码构建并取得真实准入、恢复、停止验证；桌面终端已消费有限 IPC，控制器含真实 Host 验证，但 Electron 页面启动阻塞。providerAvailable=false，真实执行、构建报告与 GoalRunner 产品轮次闭环仍未收口。§6 的 action/* 与 PTY 仍为拟议接口，不能与已接通的 execution/* 混同。旧的拟议事件清单不能代替 version=1 载荷；有界输出回放不能替代 interactive terminal 或 action/run。

F02/F04 精确模型工具审批通知增量（2026-10-08）：保留 approval/asked 的 approvalId、tool、source，新增 sessionId（不可变起轮会话身份）与 argumentsJson（完整 JSON 参数字符串，按 NDJSON 字符串转义，不截断）。消费者核对完整提案后才对同 approvalId 回答 allowed-once/denied；回执不改变核心一次性、参数绑定及取消判据。该通知不替代执行六动作的启动许可，也不自动批准 Shell。新增字段为现有通知的增量，不另立业务权威源。Host 真实文件场景先红复现缺字段，再重建验证；桌面完整提案消费仍待页面验收。

同批补充任务身份：approval/asked 增加 turnRequestId，为本次 task/start 的 NDJSON 信封 ID 文本；桌面固定数字 RPC ID 的文本值来自 HostBridge 发号。taskStart IPC 返回对应 turnRequestId，turnPoll IPC 返回发起该 poll 时绑定的身份及 approvalRequests。消费者同时核对会话、请求身份与本地轮询代际；旧 poll 只取走自己任务的通知，新任务提前到达的通知保留。成功起轮仅清理旧模型通知，不清理其他提供方事件。缺少任务身份不允许降级成“同会话即可批准”。模型审批消费源码与状态测试已实施，真实 Electron IPC 和窗口交互仍待验收。

F02/F04 桥接恢复补充：ChildProcess 事件及迟到写回调仅能更新自己仍为当前连接时的读面。显式 start 拒绝替换活动 Host，丢弃旧连接通知与报文缓冲，拒绝遗留请求；没有 PID 的启动失败允许显式重试。恢复不重放工具或授权，当前进程退出仍立即拒绝请求。Node 状态与真实 Host 异常退出/重启只读证据见 [桥接恢复](../evidence/desktop-host-bridge-recovery-2026-10-08.md)；它不是 GUI 自动重连实现。

当前默认编译快照的接口复验见 [Windows 当前源码统一构建](../evidence/windows-current-source-build-2026-10-08.md)：同核心 Host 目标六场景、CLI 目标八场景、真实 Windows Ctrl+C、Host 执行六动作及 CLI 十项准入/恢复拒绝链已取得实测。模型为本地协议夹具；执行门禁仍关闭，未证明实际命令、构建报告、远端模型或 Electron GUI 可用。旧段落的“待验收”须按对应证据层理解，不能扩大为全部未实现或全部产品已通过。
