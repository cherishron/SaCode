# interfaces/ — 接口与契约文档（总览）

> 类别：③ 详细设计文档（接口 / 契约）。上级索引：[docs/README.md](../README.md)｜对接类方案见 [`../integration/README.md`](../integration/README.md)。
> 本页是 SaCode 各入口面接口的**整理索引与速查**：接口行的最终权威是**当前源码**；契约文档登记设计口径与验收要求，使用前核源码与 PRD。
> 接口变更必须与源码同批更新本页与对应契约文件（见 §4 维护规则）。

## 1. 接口面速查（七个面）

| # | 接口面 | 权威源码（唯一真源） | 契约 / 文档 | 实测读数（2026-10-16） | 验证方式 |
|---|---|---|---|---|---|
| 1 | CLI 用户命令 | `apps/cli/src/main.cj` | 历史接入清单 [verb-wiring-checklist](../plans/verb-wiring-checklist-2026-10-04.md)（◐→✔ 状态已过期，勿当现状） | 以 `main --help` 实际输出为准 | `cd apps/cli && cjpm build` 后跑 `--help`；断言式旧自测 ≠ 用户任务验收 |
| 2 | Host JSON-RPC | `apps/host/src/main.cj`（stdout 只走协议帧，诊断走 stderr） | [`host-capabilities.json`](../plans/host-capabilities.json)（**已过期**，见 [PRD-tracking](../product/PRD-tracking.md) D11）；执行类细节见 [执行契约](../plans/sacode-execution-contract-2026-10-07.md) | **169** 条声明（2026-10-16 工作区实测：164 字面路由 + 5 目标路由；HEAD 冻结 **158**） | 门禁 `node scripts/check_host_method_surface.cjs`；`initialize` 声明能力；桌面经 NDJSON 调用；daemon 代理名单按契约∩能力推导（见 `apps/daemon/src/host_proxy.cj` 注释） |
| 3 | 桌面 IPC | `apps/desktop/preload.cjs` 的 `contextBridge.exposeInMainWorld` 顶层 key（**唯一权威**） | 通道断言 `apps/desktop/test/bridge.test.mjs`；历史清单见 [model-center-design §9.2](../superpowers/specs/2026-10-05-model-center-design.md) | **142** 条顶层 key（10-17 增 `appVersion` 关于页版本读数、`autoLaunchGet`/`autoLaunchSet` 开机自启；本轮增 `requestTrace` 模型调用日志，全局聚合回放各会话的请求追踪；重数：`grep -cE '^  [A-Za-z0-9_]+:' apps/desktop/preload.cjs`） | `cd apps/desktop && npm test`；增删通道同步 `preload.cjs` 与 bridge 测试（含两处计数）；审批面只收 `approvalId` |
| 4 | daemon 远程面 | `apps/daemon/src/`（`daemon.cj` / `host_proxy.cj`）+ `apps/cli/src/remote.cj` | [`remote-capability-contract.json`](../plans/remote-capability-contract.json)；[daemon 复核](../plans/sacode-daemon-contract-review-2026-10-08.md)（历史）；[远程/移动设计](../superpowers/specs/2026-10-10-unified-remote-mobile-design.md) | **119** 条方法契约 | 门禁 `node scripts/check_contract_anchor_audit.cjs`；`apps/daemon/test/remote-capability-contract.test.mjs` |
| 5 | JS 扩展宿主 | `extjs/`（NDJSON JSON-RPC 子进程协议） | `extjs/` 源码与测试 | — | `cd extjs && node --test` |
| 6 | ACP 外部 Agent | `core/src/acp_contract.cj` 等 ACP 切片 | 对接状态与方案见 [`../integration/README.md`](../integration/README.md) §1 | — | 复用任务/审批/取消/结算；协议探针不替代真实任务 |
| 7 | LSP 语义 | core LSP 切片；桌面侧 `lsp-ipc.cjs`（工作区态） | [LSP 契约与入口接线](../plans/lsp-l1-entry-wiring-2026-10-07.md) | — | 见原文登记与双入口证据 |

> 读数口径：数量是**源码/清单条目数**，不是"已验收接口数"；每次接口面变更后同批重测更新本表。桌面 IPC 的 2026-10-05 旧口径（33/42 条）已过期，以本节实测与源码为准。

## 2. 契约文档清单（plans/ 契约类）

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

- [`host-capabilities.json`](../plans/host-capabilities.json)：Host 方法名字符串数组。**已过期**：文件 120 条 vs 工作区 169 条声明 / HEAD 冻结 158 条（[PRD-tracking](../product/PRD-tracking.md) D11，待同步或改为生成式）。改动 Host 分派后同批更新；daemon 代理与远程测试按其推导/核对。
- [`remote-capability-contract.json`](../plans/remote-capability-contract.json)：逐方法对象（`method` / `permission` / `resourceKeys` / `durable` / `idempotent` / `clientConsumers` / `requiredScope` + 实现锚点）。锚点门禁：`node scripts/check_contract_anchor_audit.cjs`。
- 更新规则：**源码 → 契约（JSON）→ 测试 → 本页**同批联动；不允许只改其一。

## 4. 维护规则

1. 新增或修改任何接口面（Host 方法 / IPC 通道 / CLI 命令 / 远程方法 / ACP・LSP 入口）时，同批更新 §1 读数、对应契约文件与测试断言；
2. 本页状态列只用：契约｜设计稿·待评审｜登记单｜变更单｜设计中｜待批准｜历史登记，不写模糊状态；
3. 全局协议口径（固定十值错误原因、requestId / revision / 幂等）以 `sacode-product-interfaces` 为登记入口，变更走增补；
4. 桌面 IPC 的唯一权威永远是 `preload.cjs` 顶层 key，本页数字仅为读数。


2026-10-17 后续装配：[仓颉私有 cwd 真实任务](../evidence/2026-10-17-cangjie-private-workspace-task.md)新增 WindowsPrivateWorkspace 生命周期与同一共享审批/执行链的私有文件读写，当前定向 16/16。生产树快照、排除清单、源修订与差异导出/合入仍未完成；D14 和默认执行门禁保持未解除。
