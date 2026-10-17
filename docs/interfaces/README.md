# interfaces/ — 接口与契约文档（总览）

> 类别：③ 详细设计文档（接口 / 契约）。上级索引：[docs/README.md](../README.md)｜对接类方案见 [`../integration/README.md`](../integration/README.md)。
> 本页是 SaCode 各入口面接口的**整理索引与速查**：接口行的最终权威是**当前源码**；契约文档登记设计口径与验收要求，使用前核源码与 PRD。
> 接口变更必须与源码同批更新本页与对应契约文件（见 §4 维护规则）。

## 1. 接口面速查（七个面）

| # | 接口面 | 权威源码（唯一真源） | 契约 / 文档 | 实测读数（2026-10-16） | 验证方式 |
|---|---|---|---|---|---|
| 1 | CLI 用户命令 | `apps/cli/src/main.cj` | 历史接入清单 [verb-wiring-checklist](../plans/verb-wiring-checklist-2026-10-04.md)（◐→✔ 状态已过期，勿当现状） | 以 `main --help` 实际输出为准 | `cd apps/cli && cjpm build` 后跑 `--help`；断言式旧自测 ≠ 用户任务验收 |
| 2 | Host JSON-RPC | `apps/host/src/main.cj`（stdout 只走协议帧，诊断走 stderr） | [`host-capabilities.json`](../plans/host-capabilities.json)，写回契约见[异步写回](execution-review-apply-2026-10-17.md)，发现契约见[模型拉取生命周期](model-pull-lifecycle-2026-10-17.md) | 工作区178条（新增发现查询/取消），HEAD冻结171；11项门禁与13条自证通过，计数不等于全部真实验收 | 门禁 `node scripts/check_host_method_surface.cjs`；`initialize` 声明能力；桌面经 NDJSON 调用；daemon 代理名单按契约∩能力推导（见 `apps/daemon/src/host_proxy.cj` 注释） |
| 3 | 桌面 IPC | `apps/desktop/preload.cjs` 的 `contextBridge.exposeInMainWorld` 顶层 key（**唯一权威**） | 通道断言 `apps/desktop/test/bridge.test.mjs`；模型发现见[生命周期契约](model-pull-lifecycle-2026-10-17.md) | 工作区149条：10-18增modelPullDescribe/Cancel；有限集合桥接2/2、集合门禁8/8 | `cd apps/desktop && npm test`；增删通道同步 `preload.cjs` 与 bridge 测试（含两处计数）；审批面只收 `approvalId` |
| 4 | daemon 远程面 | `apps/daemon/src/`（`daemon.cj` / `host_proxy.cj`）+ `apps/cli/src/remote.cj` | [`remote-capability-contract.json`](../plans/remote-capability-contract.json)；[daemon 复核](../plans/sacode-daemon-contract-review-2026-10-08.md)（历史）；[远程/移动设计](../superpowers/specs/2026-10-10-unified-remote-mobile-design.md) | **119** 条方法契约 | 门禁 `node scripts/check_contract_anchor_audit.cjs`；`apps/daemon/test/remote-capability-contract.test.mjs` |
| 5 | JS 扩展宿主 | `extjs/`（NDJSON JSON-RPC 子进程协议） | `extjs/` 源码与测试 | — | `cd extjs && node --test` |
| 6 | ACP 外部 Agent | `core/src/acp_contract.cj` 等 ACP 切片 | 对接状态与方案见 [`../integration/README.md`](../integration/README.md) §1 | — | 复用任务/审批/取消/结算；协议探针不替代真实任务 |
| 7 | LSP 语义 | core LSP 切片；桌面侧 `lsp-ipc.cjs`（工作区态） | [LSP 契约与入口接线](../plans/lsp-l1-entry-wiring-2026-10-07.md) | — | 见原文登记与双入口证据 |

> 读数口径：数量是**源码/清单条目数**，不是"已验收接口数"；每次接口面变更后同批重测更新本表。桌面 IPC 的 2026-10-05 旧口径（33/42 条）已过期，以本节实测与源码为准。

模型发现等待语义（2026-10-18更新）：Host默认20秒网络总预算，桌面30秒等待；适配器发送前持有ID，桥超时只查询原ID一次、不重发。供应商页显示操作结果/资源收束并提供查询和取消，新增两条有限preload动作；ID仅renderer适配器内存，不代表跨应用重启持久恢复。见[契约](model-pull-lifecycle-2026-10-17.md)、[Host记录](../evidence/2026-10-17-model-pull-host-lifecycle.md)、[桌面记录](../evidence/2026-10-18-model-pull-desktop-lifecycle.md)；默认沙箱隔离页面Electron通过不升级为完整应用/安装态通过。

## 2. 契约文档清单（plans/ 契约类）

2026-10-18模型发现[未知核对补记](../evidence/2026-10-18-model-pull-unknown-verification.md)：仅renderer投影增加核对失败说明，不新增IPC/Host动作；原操作结果、资源收束和本次查询是否成功分开。目录刷新不作成功回执，IPC仍149条。

新增私有目录 C ABI：`core/native/windows_workspace.h` 提供 create/revoke/close 三动作，只创建新的受保护目录，拒绝重解析父路径与宽泛应用 SID；revoke 仅删除已空且持续持有句柄的自有目录，非空拒绝。当前只在原生驱动验证，仓颉/Host/CLI 未消费；见 [47 项实测](../evidence/2026-10-17-windows-private-workspace-scope.md)。

内部平台 C ABI（不属于上方公开七个入口面）：`core/native/windows_process.h` v1 定义 Windows 原生所有权进程的 8 个有限函数。create 返回挂起、已核身份且已入 Job 的句柄，resume/read/wait/active/stop/close 管理同一对象；非零 create 结果可能带 cleanup-only 句柄，close 前须终止整树并 join 读者。原生 35 项实测见 [当前记录](../evidence/2026-10-17-windows-owned-process-provider.md)，包内仓颉适配已完成真实 DLL 验证；新增共享 ShellResult 转换覆盖回执、取消、超时和双流排空，见 [当前收束记录](../evidence/2026-10-17-windows-process-collector.md)。新增 ExecutionProcessProvider/ExecutionProcessRequest 由监督层在 beginStart 后消费；显式 Windows 装配已通过审批、执行、停止及持久回放（[13/13](../evidence/2026-10-17-windows-execution-supervisor-integration.md)）。Host/CLI 默认装配与隔离策略仍待完成。

| 文档 | 主题 | 状态 |
|---|---|---|
| [sacode-product-interfaces-2026-10-07.md](../plans/sacode-product-interfaces-2026-10-07.md) | 产品对象 / 状态机 / 固定十值错误原因（requestId、revision、幂等键） | 历史登记（10-13 补正）；实施前核当前协议 |
| [sacode-execution-contract-2026-10-07.md](../plans/sacode-execution-contract-2026-10-07.md) | 执行与构建测试增量契约（含 10-08 执行口径更新） | 契约 |
| [w10-persistence-barrier-recovery-contract-2026-10-06.md](../plans/w10-persistence-barrier-recovery-contract-2026-10-06.md) | 持久化屏障与恢复契约 | 设计稿，待评审 |
| [goal-claim-tool-interface-2026-10-07.md](../plans/goal-claim-tool-interface-2026-10-07.md) | 完成证据声明侧接口变更单（update_goal 分支） | 变更单（历史） |
| [lsp-l1-entry-wiring-2026-10-07.md](../plans/lsp-l1-entry-wiring-2026-10-07.md) | L1 LSP 语义工具契约与入口接线登记 | 登记单 |
| [2026-10-12-knowledge-management-contract.md](../plans/2026-10-12-knowledge-management-contract.md) | F11 知识库管理增量契约（身份 / 状态 / 索引语义） | 设计中（基线 `1bf46d8`） |
| [sacode-daemon-contract-review-2026-10-08.md](../plans/sacode-daemon-contract-review-2026-10-08.md) | daemon 复核与接线门禁（含冻结构建与 HTTP 探针读数） | 复核（历史快照） |
| [2026-10-12-git-write-integration.md](../plans/2026-10-12-git-write-integration.md) | F08 Git 写操作接口（提案 + 绑定提案的一次性工单） | **待用户批准**；当前仅 status/diff 只读 |
| [2026-10-12-remaining-product-pages.md](../plans/2026-10-12-remaining-product-pages.md) | 未完成产品页面接线与接口缺口清单 | 进行中（随闭环目标推进） |

## 3. 机器可读契约与门禁

- [`host-capabilities.json`](../plans/host-capabilities.json)：Host 方法名字符串数组。**2026-10-17 本轮工作区178条、HEAD171条**，当前清单与 `apps/host/src/main.cj` 的 `initialize` 声明对齐。D11初轮171条同步是历史事实，后续接线新增能力不回写为已提交。daemon既有代理契约回归15/15；模型拉取查询/取消目前仅本地Host，不自动开放远程面。
- [`remote-capability-contract.json`](../plans/remote-capability-contract.json)：逐方法对象（`method` / `permission` / `resourceKeys` / `durable` / `idempotent` / `clientConsumers` / `requiredScope` + 实现锚点）。锚点门禁：`node scripts/check_contract_anchor_audit.cjs`。
- 更新规则：**源码 → 契约（JSON）→ 测试 → 本页**同批联动；不允许只改其一。

## 4. 维护规则

1. 新增或修改任何接口面（Host 方法 / IPC 通道 / CLI 命令 / 远程方法 / ACP・LSP 入口）时，同批更新 §1 读数、对应契约文件与测试断言；
2. 本页状态列只用：契约｜设计稿·待评审｜登记单｜变更单｜设计中｜待批准｜历史登记，不写模糊状态；
3. 全局协议口径（固定十值错误原因、requestId / revision / 幂等）以 `sacode-product-interfaces` 为登记入口，变更走增补；
4. 桌面 IPC 的唯一权威永远是 `preload.cjs` 顶层 key，本页数字仅为读数。


2026-10-17 内部可信提供方契约：[完整提案绑定](../evidence/2026-10-17-windows-process-proposal-binding.md)将 WindowsExecutionProcessProvider 构造改为接收完整 proposal，固定 executable/cwd/argv/timeoutMs/outputLimit；不新增公共 RPC，不开放默认门禁。私有非空目录安全回收仍是生产装配阻断。

2026-10-17 后续装配：[仓颉私有 cwd 真实任务](../evidence/2026-10-17-cangjie-private-workspace-task.md)新增 WindowsPrivateWorkspace 生命周期与同一共享审批/执行链的私有文件读写，当前定向 16/16。生产树快照、排除清单、源修订与差异导出/合入仍未完成；D14 和默认执行门禁保持未解除。

2026-10-17 EX-01/D14 后续：[工作区快照与变更导出](../evidence/2026-10-17-windows-workspace-snapshot.md)当前定向 23/23，通过实际私有任务增删改、来源变更拒绝、硬链接/junction/越界拒绝及同日志审批前绑定。摘要的产品审批展示、整树终态约束、F08 合入和默认 Host/CLI 装配仍待完成，D14 不解除；一次 5 秒超时原因未定位。

2026-10-17 EX-01/REVIEW-01：[快照终态导出](../evidence/2026-10-17-workspace-snapshot-settlement.md)已消费共享日志的 exited/退出观察/输出完整及快照绑定事实；真实任务与磁盘重放断言在 23/23 中通过。审批展示、启动复核及 F08/CAS 接线待实施，默认门禁不开放。

2026-10-17 EX-01/REVIEW-01：[快照审批与启动复核](../evidence/2026-10-17-workspace-snapshot-approval.md)新增精确票绑定回执摘要、任务投影及页面范围展示；实际来源更新后拒绝恢复线程。核心集成 24/24，页面状态/渲染 13/13；完整桌面/Host 快照生命周期和 F08/CAS 仍待接线，门禁保持关闭。

2026-10-17 REVIEW-01/产物：[任务差异登记与真实 Host 消费](../evidence/2026-10-17-task-review-persistence-host.md)复用 AttachmentStore 保存前后文件对象，同日志 execution/review 登记身份；核心 24/24、页面 16/16、当前 Host 真实历史投影及页面渲染通过。正文预览、F08/CAS 写回、Host 快照执行生命周期和完整桌面仍待完成，默认门禁关闭。

2026-10-17 F08/REVIEW-01：[任务正文预览](../evidence/2026-10-17-task-review-body-preview.md)新增有限 execution/review-file，Host/CLI/IPC/页面读取登记的前后内容对象；核心24/24、页面19/19、桥接3/3及真实Host/CLI通过。写回审批/CAS与默认Host快照执行未开放。

接口合同：[execution/review-file](execution-review-preview-2026-10-17.md)，F08历史对象有限预览，写回未开放。

2026-10-17 F08写回前置：[单文件条件写](../evidence/2026-10-17-review-file-compare-exchange.md)新增独占句柄核对旧字节的内部创建/替换/删除原语，真实DLL定向28/28。尚非多文件或断电原子合入；审批/持久意图/部分成功与未知结算及产品写回未接，门禁关闭。

2026-10-17 F08：[写回审批与持久意图](../evidence/2026-10-17-review-apply-journal.md)核心复用同一日志/lease/精确一次票/取消令牌，写前屏障与逐文件结算、部分成功及未知不重放，真实DLL定向36/36。公共写回动作、hunk及完整桌面仍未接，不升级产品完成状态。

2026-10-17 F08：[目录身份与固定原生库装配](../evidence/2026-10-17-review-directory-identity.md)完成核心保护，真实DLL定向39/39、零跳过。拒绝同路径目录实体替换；旧记录保留只读。公共异步写回、双入口与桌面操作仍待接通，不升级产品完成状态。

[异步写回接入约定](execution-review-apply-2026-10-17.md)：prepare/apply/describe/stop拟接线边界与验收条件，公开RPC尚未开放。

2026-10-17 F08：[异步写回与停止边界](../evidence/2026-10-17-review-apply-async.md)核心40/40通过；提交中查询/停止及时返回，后续文件不再写入，重复启动拒绝。公共双入口和页面仍待接通，默认门禁关闭。

2026-10-17 F08：[双入口及页面实际写回](../evidence/2026-10-17-review-apply-product-entries.md)有限prepare/apply/describe/stop及页面独立确认已接；核心41/41、页面24/24、桥接4/4、真实组件→IPC→Host及CLI17项通过，合成项目实际增删改。Host176/IPC147；完整Electron/安装态、默认快照执行及在途Host停止仍待验，不解除D14与整体目标。

2026-10-17 EX-01/F08：[原工作区与私有执行目录映射](../evidence/2026-10-17-snapshot-logical-workspace.md)真实定向42/42、页面27/27。会话目录/修订与原文件不变，仅私有副本改变并登记差异；默认Host/CLI生命周期尚未装配，D14及整体目标保持未完成。并发源码边界见证据。

2026-10-17 EX-01：[私有副本有界清理](../evidence/2026-10-17-private-workspace-disposal.md)新增仅消费自有根句柄的内容清理，真实定向45/45。嵌套清理、占用后重试及链接拒绝/外部哨兵保护通过；默认Host/CLI资源生命周期尚未装配，D14与整体目标保持未完成。格式后复编边界见证据。

2026-10-17 EX-01/F08：[自动审查与资源收束](../evidence/2026-10-17-execution-snapshot-settlement.md)共享监督器可信结束阶段47/47，差异持久化后才删除副本/释放profile和库；失败保留真实退出事实，晚期释放可在同进程重试。默认Host/CLI准备所有权尚未接通，D14与整体目标未解除。

2026-10-18 F08/EX-01：[私有执行生命周期与真实双入口](../evidence/2026-10-18-execution-capsule-entries.md)：核心定向50/50、真实状态层→IPC→Host及CLI 13项、桌面定向14/14；同进程准备/独立审批/执行/审查/写回及EOF取消收束已实测。未提交增量；项目与会话数据重合、完整Electron/安装态及隔离专项仍待验，整体功能不升级完成。

2026-10-18 F08/EX-01：[项目与会话数据同目录](../evidence/2026-10-18-colocated-execution-metadata.md)：按真实日志/租约/附件路径排除元数据，保留用户同名文件；新产物同目录与分离布局真实Host/CLI各13项通过。核心52项首轮51通过1清理错误，修正夹具后完整52/52通过、零跳过/错误/失败；不升级整体完成状态。
