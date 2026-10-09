# 自主产品需求追踪与第一批责任表

基线：2026-10-07，固定提交 `35a69ca9e0f8b7b6ac51271ec76eff3515eaa820`。本文为源码静态核查，不包含本轮业务测试通过声明。F01–F20 是能力域，不能换算完成率。

主责是工作包责任，尚未指派具体个人；由后续实施者认领，不冒认并发会话身份。本批文档与独立 prototype 由当前任务负责；公共入口不改。

| ID | 用户动作 | 核心候选（core/src） | Host 契约/接线 | 桌面消费端与已有测试候选 | 裁决与具体下一步 | 主责/依赖 | 验收出口/状态 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| F01 | 项目与会话 | catalog.cj session.cj workspace.cj | session/catalog session/create session/select workspace/get | renderer/app.js 会话/工作区消费；catalog.test.mjs session-management.test.mjs workspace.test.mjs | 扩展现有切片，沿用前先复验：项目树、归档、按会话草稿与身份隔离 | 核心会话 + 桌面导航；依赖共享身份、权限、取消与持久化 | PRD F01 三类验收 + 对应双入口/产物；待验收，未核部分保持待核 |
| F02 | Agent 执行 | model_agent.cj agent.cj request_trace.cj；execution_service.cj execution_api.cj execution_supervisor.cj windows_job_executor.cj | task/start turn/cancel turn/poll；execution 六动作 / CLI job 六动作 | renderer/app.js 对话/轨迹；终端 execution-task；execution-task.test.mjs 9/9 含真实 Host；execution-dual-entry-recheck-2026-10-08.md；windows-native-job-supervision-2026-10-08.md | 扩展；准入/恢复已取真实双入口证据；Windows 原生监督5、协议8、共享监督5场景已通过，产品执行门禁仍关闭；下一步 OS 隔离、公共入口真实执行/恢复及桌面验收 | E/W40 监督、A/W90 双入口、F/W50 轮次、G/W60 页面；依赖共享身份、审批与持久化 | 实施中；私有 -O1 Host/core 重建 rc=0，非默认构建或全量核心证明；真实模型任务、停止/恢复、同修订同轮 evidence+claim 及产物验收继续独立取证；Electron 页面启动阻塞见桌面准入证据 |
| F03 | 队列 | inbox.cj attach.cj | queue/describe queue/enqueue queue/update | renderer/pages/queue-dock.ts + renderer/app.js 队列消费；message-queue.test.mjs queue-reference.test.mjs queue-attachment.test.mjs | 扩展现有切片，沿用前先复验：排序、编辑独占、全状态投影和提交幂等 | 核心队列 + 输入区；依赖共享身份、权限、取消与持久化 | PRD F03 三类验收 + 对应双入口/产物；待验收，未核部分保持待核 |
| F04 | 目标 | goal_runner.cj goal_control.cj goal_claim.cj goal_evidence.cj goal_checkpoint.cj | Host task/start 接 HostGoalRun；CLI goal run/describe 真实入口，保留旧无参数自测 | goal-bar.ts + renderer/app.js；goal-host-verify.mjs、goal-cli-verify.mjs；windows-unified-core-dual-entry-2026-10-08.md；sse-cancel-latency-2026-10-08.md | 扩展；同核心库新 Host 五场景、新 CLI 七场景及 Ctrl+C 取消 rc=0；持久失败保留租约，恢复不续跑。在途取消已主动关连接；下一步模型中心路由、默认构建及真实桌面验收 | F/W50 核心、A/W90 双入口、G/W60 页面；依赖身份、审批、模型路由、持久屏障 | 实施中；150 个验收源码哈希与当前一致，私有 -O1 构建；本轮 CLI 取消 589ms、Host 取消到终态 1958ms，均无强制清理；外层构建超时后接管原 cjc，实测编译退出 0，非 cjpm rc=0。本地 HTTP/SSE 夹具不等于远端模型、桌面或安装态；全量核心与默认构建未收口 |
| F05 | 快捷引用 | cmds.cj skill.cj xref.cj attach.cj | attachment/upload；其他入口待设计 | renderer/pages/composer-attachments.ts；命令搜索完整消费待核；attachment-upload.test.mjs | 扩展现有切片，沿用前先复验：＋/@/斜杠统一搜索、版本引用、init 合并 | 输入区 + 核心引用；依赖共享身份、权限、取消与持久化 | PRD F05 三类验收 + 对应双入口/产物；待验收，未核部分保持待核 |
| F06 | 压缩与用量 | compact.cj meter.cj ledger.cj | usage/status ledger/stats | renderer/pages/context-meter.ts、budget-stats.ts；实际上下文待核；usage.test.mjs model-context.test.mjs | 扩展现有切片，沿用前先复验：真实上下文投影、摘要生成、原子切换与预留 | 模型上下文；依赖共享身份、权限、取消与持久化 | PRD F06 三类验收 + 对应双入口/产物；待验收，未核部分保持待核 |
| F07 | 模型中心 | provider_registry.cj custom_model_registry.cj credential.cj model_router.cj | model/registry/describe custom/describe model/pull credential/set | renderer/pages/model-center-adapter.ts + model-select.ts；model-center.test.mjs custom-models-ipc.test.mjs host-routing-ledger.test.mjs | 扩展现有切片，沿用前先复验：统一选择、端点能力、轮内固定模型和密钥保护 | 模型核心 + 模型中心；依赖共享身份、权限、取消与持久化 | PRD F07 三类验收 + 对应双入口/产物；待验收，未核部分保持待核 |
| F08 | 编辑与 Git | fs_tools.cj resource.cj | workspace/files；Git 用户接口未核 | renderer/app.js 工作区文件；完整编辑/Git 消费待核；workspace.test.mjs | 扩展现有切片，沿用前先复验：编辑缓冲、并发版本、真实差异/暂存/提交/推送 | 文件/Git + 工作台；依赖共享身份、权限、取消与持久化 | PRD F08 三类验收 + 对应双入口/产物；待验收，未核部分保持待核 |
| F09 | 终端验证 | term.cj jobs.cj shl.cj procwin.cj；execution_output.cj execution_supervisor.cj | execution/output、describe、stop / CLI job 对应动作；PTY 待实施 | terminal-output.ts + execution-task；输出有界回放与跨页 UTF-8 控制器专项已取证；execution-desktop-admission-2026-10-08.md | 扩展；下一步真实执行输出与进程事实、构建测试报告；普通回放不升级 PTY，空页不等于 EOF，exit 0 不等于测试通过 | E/W40 执行监督、A/W90 接线、G/W60 终端与构建测试；依赖隔离探针与审批 | 实施中；两流/限额/退出与报告独立验收，正式页面/断连/关闭/会话切换仍待验；PTY 单独探针 |
| F10 | ACP 委派 | ccf3bff 已提交 acp_contract/process/delegation/approval_bridge/gate/settings/weight/env；8 实现+8 测试，69 条测试声明 | Host/CLI/preload 未见直接 ACP 接线，其他适配待核 | subagent-settings.ts 设置候选，委派消费待核；三产品 initialize 帧报告，acp-handoff-recheck-2026-10-08.md | 扩展；先 2.4/2.5 持久事实与投影，再闭合委派归属审批/elicitation、内容路由和入口；编译与超时为交接读数，测试声明不记通过 | ACP 实施线、A/W90 双入口；依赖共享身份、权限、取消与持久化 | 实施中；真实委派正向、拒绝、取消、恢复和双入口/产物未收口；initialize 不替代端到端 |
| F11 | 知识记忆 | inv.cj xref.cj | 知识检索/管理产品入口未核 | 知识/记忆消费未核；未核 | 新增或待核，不能以检索未命中断言不存在：知识/个人库/记忆权威源、索引、速记与批注 | 知识与记忆；依赖共享身份、权限、取消与持久化 | PRD F11 三类验收 + 对应双入口/产物；待验收，未核部分保持待核 |
| F12 | 扩展 | plugin_manifest.cj plugin_store.cj plugin_lifecycle.cj plugin_surface.cj | plugin/describe plugin/set-enabled plugin/uninstall extension/host/load | renderer/pages/plugin-manager.ts、plugin-manager-adapter.ts；plugin-inventory-lifecycle.test.mjs plugin-manager-wiring.test.mjs | 扩展现有切片，沿用前先复验：本地安装更新、贡献装配、真实激活回滚、资源清理 | 插件核心 + 扩展管理；依赖共享身份、权限、取消与持久化 | PRD F12 三类验收 + 对应双入口/产物；待验收，未核部分保持待核 |
| F13 | 自动化 Hooks | schedule.cj webhook.cj workflow.cj | 产品自动化入口待核 | 自动化/Hooks 消费未核；核心 schedule/workflow 测试候选 | 扩展现有切片，沿用前先复验：真实触发、去重、错过策略、Hooks 声明与运行分列 | 编排与自动化；依赖共享身份、权限、取消与持久化 | PRD F13 三类验收 + 对应双入口/产物；待验收，未核部分保持待核 |
| F14 | 浏览器电脑 | bu_exec.cj cu_exec.cj web_exec.cj | 产品 provider 装配未核 | 浏览器/电脑消费未核；核心 bu_exec/cu_exec/web_exec 测试候选 | 扩展现有切片，沿用前先复验：真实驱动可用性、目标授权、桌面租约与紧急停止 | 外部驱动 + 权限；依赖共享身份、权限、取消与持久化 | PRD F14 三类验收 + 对应双入口/产物；待验收，未核部分保持待核 |
| F15 | SSH 部署 | ssh_exec.cj ssh.cj | 产品 SSH 接线未核 | SSH/部署消费未核；核心 ssh_exec 测试候选 | 扩展现有切片，沿用前先复验：主机指纹、远程状态未知、独立部署授权 | 远程连接；依赖共享身份、权限、取消与持久化 | PRD F15 三类验收 + 对应双入口/产物；待验收，未核部分保持待核 |
| F16 | 数据库 | 暂无已核结构化数据库驱动 | 新增 database/* 契约 | 数据库消费未核；未核 | 新增或待核，不能以检索未命中断言不存在：MySQL/PostgreSQL/达梦驱动、只读/事务/写授权 | 数据库连接；依赖共享身份、权限、取消与持久化 | PRD F16 三类验收 + 对应双入口/产物；待验收，未核部分保持待核 |
| F17 | 安全扫描 | 暂无已核三层扫描实现 | 新增 scan/* 契约 | 三层扫描消费未核；未核 | 新增或待核，不能以检索未命中断言不存在：静态/增量/跨函数分别定义和验收、版本保护修复 | 安全扫描；依赖共享身份、权限、取消与持久化 | PRD F17 三类验收 + 对应双入口/产物；待验收，未核部分保持待核 |
| F18 | 语音增强 | prompt_enhance.cj enhance_charge.cj voice_exec.cj | prompt/enhance prompt/poll prompt/cancel | renderer/app.js 增强消费；语音待核；prompt-enhance.test.mjs real-provider-enhance.test.mjs | 扩展现有切片，沿用前先复验：增强撤销栈和竞态复验；ASR 真实工具链 | 输入区 + 模型/语音；依赖共享身份、权限、取消与持久化 | PRD F18 三类验收 + 对应双入口/产物；待验收，未核部分保持待核 |
| F19 | 数据导入 | migration_pack.cj | custom/import/new custom/import/into（仅模型配置） | renderer/pages/migration.ts 仅模型迁移，产品导入待核；模型迁移相关测试待核 | 扩展现有切片，沿用前先复验：来源适配、预览去重、单向追加、敏感字段剔除 | 数据迁移；依赖共享身份、权限、取消与持久化 | PRD F19 三类验收 + 对应双入口/产物；待验收，未核部分保持待核 |
| F20 | 设置交付 | settings.cj global_appearance.cj secret_bundle.cj | global/settings/get global/appearance/get | renderer/pages/general-settings.ts + renderer/app.js 设置消费；general-settings.test.mjs host-startup-recovery.test.mjs packaging-contract.test.mjs | 扩展现有切片，沿用前先复验：全部消费端、代理运行值、三平台无 SDK/升级卸载 | 应用设置 + 发布验证；依赖共享身份、权限、取消与持久化 | PRD F20 三类验收 + 对应双入口/产物；待验收，未核部分保持待核 |

## 当前证据限制

- Host 方法名由 main.cj 声明与分支定位；声明不证明真实任务可用，后续逐分支核验输入/输出。
- CLI main.cj 默认 all，当前多为断言式自测；上述 Host 方法没有自动等价为 CLI 用户命令。产品 CLI 的新增动作见接口设计。
- compact.cj 的 CompactionLedger 仅记录事件，不是摘要服务。tabs.cj 的 TabTypeRegistry 仅元信息，不是完整标签实例生命周期。
- 已有测试名是定位入口，不是本轮 PASS。核心测试候选须在实施时逐名确认。
- 历史安装包证据见 ../evidence/latest-desktop-package-2026-10-06.md，只证明该文固定源码的启动/Host 请求；不证明新版 PRD 全部接入。新 PRD 产物证据全部未执行。

## 第一批任务与硬出口

| 工作项 | 责任 | 输入/依赖 | 输出与验收 | 状态 |
| --- | --- | --- | --- | --- |
| P1 追踪登记 | 当前任务 | 固定 SHA、PRD | 20 域无遗漏；每域核心/入口/测试/缺口/主责齐全；静态引用核对 | 已登记，业务未验收 |
| P2 接口设计 | 当前任务 | P1、既有协议/槽位 | 状态、数据源、增量 RPC/CLI、错误、授权、恢复和用例 | 设计交付，待实施 |
| P3 原型 | 当前任务 | P2、Vue runtime/OpenTiny | 独立交互、真实渲染、亮暗/窄窗/键盘/竞态，截图与日志 | 原型 602 checks 通过（2026-10-07 第二轮补齐待办、会话树置顶/重命名/归档、附件与 @ 引用、执行详情分离后复跑）；业务未验收 |
| P4 主闭环 | 当前任务负责共享核心与双入口接线；并发公共路径修改前登记 | P2/P3 出口 | F02–F09/F18 真实模型与工具、安装态 | 实施中：GoalClaim、执行准入与恢复已有工作区实现；真实监督、ExecutionService 双入口与安装态尚未收口 |
| P5 集成 | 各 provider 实施者待认领 | 公共权限与生命周期 | F10–F19 真实服务、取消、恢复 | 未开始本批实施 |
| P6 交付 | 平台/发布实施者待认领 | 全域业务验收 | 双入口/三平台产物与干净环境 | 未开始本批实施 |

## 基线在途清单（第一轮快照）

以下是取证瞬间 git status，不识别作者、不纳入固定提交证据。PRD 是本次需求文档，公共桌面源码与其他记录保持原状。

```text
M apps/desktop/frame-smoke.cjs
 M apps/desktop/main.cjs
 M apps/desktop/renderer/app.js
 M apps/desktop/renderer/frame.css
 M apps/desktop/renderer/styles.css
 M docs/plans/w00-path-ownership-and-isolation-2026-10-06.md
 M docs/product/PRD.md
?? .tmp-capture.ps1
?? .tmp-capture2.ps1
?? .tmp-dsh-asar/
?? .tmp-frame-smoke/
?? .tmp-launch-dsh.ps1
?? .tmp-restore-capture.ps1
?? .tmp-screenshot.png
?? .tmp-screenshot.ps1
?? 1716
?? 2208
?? 2572
?? 3728
?? apps/desktop/test/composer-custom-model.test.mjs
?? core-test.txt
?? core-test2.txt
?? core-test3.txt
?? core-test4.txt
?? core-test5.txt
?? core-test6.txt
?? core-test7.txt
?? core-test8.txt
?? core/cb2.txt
?? core/ct.txt
?? docs/evidence/h70-external-drivers-2026-10-06.md
?? docs/evidence/p0-dsh-baseline-2026-10-07.md
?? dsh-screenshot.png
?? sacode-screenshot.png
?? screen-dsh.png
```

## 第二轮复核登记（2026-10-07 23:4x）

2026-10-08 F20/阶段 6 当前构建登记见 [Windows 当前源码统一构建](../evidence/windows-current-source-build-2026-10-08.md)：667 项快照输入保留逐字哈希，默认核心/Host 与同核心 CLI 均真实编译退出 0；新 Host 目标 6/6、CLI 目标 8/8、真实 Main 处理器审批 3/3 通过（模型为本地协议夹具）。冻结前端五步构建及五项依赖/CSP 检查通过。NSIS 安装候选已构建退出 0，asar 暂存载荷 26 项哈希及 91 个 Host 文件核对通过；未安装、未发布。后续同字节普通目录导出已解除仓库 Low 标签导致的 premain 崩溃，真实 Electron＋Host 协议冒烟退出 0，详见低完整性交付修复。完整页面套件仍红，OS 隔离门禁与安装升级/数据保留仍未收口，F20 不升级为通过。

2026-10-08 最新 F02/F04 增量见 [真实文件精确审批与目标完成](../evidence/goal-file-approval-dual-entry-2026-10-08.md)：固定 CLI 八场景、新 Host 增量六场景通过，包含真实文件落盘、完整提案允许一次、同修订同轮 evidence+claim 与恢复不执行；Host 通知缺字段先红后绿，两入口文件哈希一致，Host 取消 2112ms。后续 [桌面审批消费](../evidence/desktop-model-approval-consumption-2026-10-08.md) 状态及真实 renderer 分支 14 项通过，带任务身份 Host 的允许/拒绝/取消与重启不执行三场景通过，实际 Main taskStart/turnPoll 分派在 Node VM 中验证。Electron 原生窗口站拒绝访问已定位，真实 GUI、OS 隔离和统一最新源码产物仍待验收；F02/F04/F09 不升级为通过。

第二轮独立复核在**同一固定提交 `35a69ca`**、同一分支上执行，未提交、未推送。工作量仍属工作区，不代表已入库或安装包。

- **阶段 1**：F01–F20 二十行齐全（核心候选、Host/CLI 入口、桌面消费与测试候选、裁决与下一步、主责/依赖、验收出口），未核项保持「待核」。新增未核线索：`core/src/goal_claim.cj`、`core/src/goal_evidence.cj`（F04）、`core/src/git_workbench.cj`（F08）、`core/src/terminal_view.cj`（F09）已出现在工作区，F04/F08/F09 行需按这些新文件复验后再更新候选。
- **阶段 2**：接口文档 20 行齐全，含权威源、状态机、失败原因、授权、持久化、首要用例与外部解锁条件；执行契约（F02/F09）另文。未在本轮改动。
- **阶段 3**：原型复跑 `PROTOTYPE_PASS 602 checks / 0 failed`、`ELECTRON_RC=0`（构建 `PROTOTYPE_BUILD_PASS`，rc=0）。本轮补齐此前遗漏的「待办」独立对象、会话树置顶/重命名/归档与恢复、执行详情与计划分离，并为附件引用、`@` 引用补独立断言；亮/暗/窄窗截图与 `checks.json` 已按新界面重生成。
- **在途增量**（第一轮快照之后新增，未提交）：`apps/desktop/prototype/` 全目录、`docs/plans/sacode-*.md` 与 `docs/evidence/sacode-*.md`、`core/src/git_workbench.cj`、`core/src/goal_claim.cj`、`core/src/goal_claim_test.cj`、`core/src/terminal_view.cj`、`core/test-support/`、`apps/desktop/renderer/pages/{file-editor,file-preview,git-workbench,workspace-search,workbench-tabs,terminal-output,composer-menu,account-menu,permission-menu}*.ts`、`apps/desktop/renderer/product-design.css` 及其测试与 `test-support/*verify.mjs`。
- **未纳入本轮**：核心/Host/CLI 的真实业务验收、阶段 4–6 的双入口与三平台交付。这些改动集中落在 `core/src/agent.cj`、`core/src/approval.cj`、`core/src/goal_runner.cj`、`core/src/model_agent.cj`、`core/src/model_tool_runtime.cj`、`core/src/shlex.cj` 与 `apps/host/src/main.cj`，本轮**未编译、未运行其测试**，不得据本轮原型通过推定其可用。
2026-10-08 F02/F09 最新 Windows 提供方状态：真实 AppContainer 两策略已通过，隔离与监督在同一个 broker 任务中取得 10 场景证据；当前仓颉 WindowsJobExecutor 直接编译及三场景通过，隔离确认字段变异独占命中，详见 [隔离 broker 与适配器](../evidence/windows-isolated-broker-adapter-2026-10-08.md)。旧表中“下一步 OS 隔离”更新为“下一步公开提案绑定隔离资源、产品提供方装配与双入口实测”。此前 Electron premain 启动阻塞已解除；完整页面套件仍有独立红项。公共 providerAvailable 仍 false，不能将以上提供方证据升级为 F02/F09 产品通过。


### F02/F09 当前完整核心构建证据（2026-10-08）

2beda405 冻结源码完整 core 默认构建 exit=0（cjpm build -j 1、158 warnings），涵盖 ExecutionRun、共享持久失败冻结及实时输出；Host/CLI 构建、最新核心测试及真实入口验收仍在执行中，不升级 F02/F09 为通过。源码／产物哈希和原件见 execution-shared-freeze-2026-10-08.md。此前各私有旧核心链接证据仍保留原边界。

2026-10-08 F02/F09 执行契约追加：链接新完整核心的 22 条指定测试全通过，证据 docs/evidence/execution-shared-freeze-2026-10-08.md。真实隔离异步探针暴露大型工具整文件摘要内存不足，正改有界读取；公开提供方尚未装配，不升级完成状态。
