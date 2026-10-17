# evidence/ — 历史证据（冻结区 · 索引）

- 2026-10-17 13:52 新复验：[A3 GPU 阻塞脱敏报告](../../target/tmp/codex-outputs-20261017/A3-GPU复验-20261017-1352.html)。三种后端均失败，真实调用日志可见性未验，不升级历史结论。

> 类别：⑦历史证据。**本目录是冻结区：只增不改**——新结果用新记录，不覆盖旧失败、不把旧通过升级成当前通过。
> 上级索引：[docs/README.md](../README.md)｜验收观察在 [`../qa/`](../qa/)

## 0. 规则

1. **命名**：旧式 `<主题>-<日期>.md`；新式 `2026-10-XX-<主题>.md`。日期 = 取证日，不是文件创建日；
2. **更新**：发现结论过期时，**新建**补记文件或在同主题新文件里引用旧文件；原文不动（本目录被大量文档交叉引用，改写会伪造历史）；
3. **结论去向**：需要长期引用的结论写进 `../product/`、`../plans/` 或 `../qa/`；本目录保留原始读数与过程；
4. 当前状态**永远不看本目录单独判定**——核 PRD 与该主题最新文件，必要时看 `docs/README.md` 登记的当前口径。

## 1. 按主题检索（检索关键词 → 代表文件）

- [2026-10-18 R2真实冷启动持久性](2026-10-18-r2-cold-restart-persistence.md)：真实获批edit后Host退出0，再以不同PID同目录只读RPC回放；40事件/8消息、plan模式、工作区及请求追踪一致，文件/单测保持，日志哈希不变、无模型重发。协议层1/1，不冒充GUI或真实LongCat验收。

- [2026-10-18 R2三路径协议验收](2026-10-18-r2-three-path-protocol.md)：用户指定包内Host的mock allowed/denied/cancelled 3/3通过，实际文件修改/不变及自然退出已核；外部Node单测不冒充产品受控测试。当前进程无LongCat密钥，真实阶段未运行，GUI/安装态未验。

- [2026-10-18 结果未知持续展示与核对](2026-10-18-model-pull-unknown-verification.md)：核对失败不抹掉已知收束事实，目录刷新不能替代精确回执；状态/页面18/18、扩大63/63、默认沙箱真实Electron未知路径1/1，未重发；跨重启/安装态仍待验。

- [2026-10-18 桌面模型拉取生命周期](2026-10-18-model-pull-desktop-lifecycle.md)：发送前持有ID、查询/可见取消、页签状态保留；58/58、桥接2/2、默认沙箱Electron/Host集成2/2，IPC149/149。保留仓内Electron启动失败与安装态/跨重启恢复缺口，D22不闭合。

- [2026-10-17 Windows 进程完整提案绑定](2026-10-17-windows-process-proposal-binding.md)：进程字段精确绑定必要切片；默认生命周期因非空私有目录安全回收仍阻断。
- [2026-10-17 模型拉取超时初轮记录](2026-10-17-model-pull-timeout-fix.md)及[复核补记](2026-10-17-model-pull-timeout-followup.md)：**撤回 revision 前进即成功与 D22 闭合结论**；保留 30s 等待，超时如实标未知、不自动重发。定向 28/28、模型中心16/16、真实中性Host集成1/1；页面4组失败与安装态缺口保留，D22部分修复。
- [2026-10-17 Host模型拉取生命周期](2026-10-17-model-pull-host-lifecycle.md)：总预算、取消、操作ID结果查询接入Host，核心16/16、真实Host与兼容集成16/16，Host178条门禁/自证通过；DNS资源退出、桌面查询/取消接线与安装态仍待完成，D22不闭合。

| 主题 | 检索关键词 / 前缀 | 代表性文件（完整清单按目录） | 时间跨度 |
|---|---|---|---|
| 仓颉私有 cwd 真实任务 | `cangjie-private-workspace-task` | [本轮记录](2026-10-17-cangjie-private-workspace-task.md)：共享审批/执行链、两档文件访问、失败引用释放及独立清理，16/16；生产快照/合入未完成 | 10-17 |
| Windows 私有任务目录 | `windows-private-workspace-scope` | [本轮记录](2026-10-17-windows-private-workspace-scope.md)：47 项真实权限/重解析拒绝/独立清理；父 DACL 不变，快照与产品装配未完成 | 10-17 |
| Windows 共享监督装配 | `windows-execution-supervisor-integration` | [本轮记录](2026-10-17-windows-execution-supervisor-integration.md)：真实任务/审批/停止/持久回放，定向 13/13；默认产品门禁未开放 | 10-17 |
| Windows 共享执行结果 | `windows-process-collector` | [当前记录](2026-10-17-windows-process-collector.md)：真实适配与结果转换 9/9；公共执行服务装配未完成 | 10-17 |
| 仓颉 Windows 进程适配 | `windows-cangjie-process-adapter` | [2026-10-17-windows-cangjie-process-adapter](2026-10-17-windows-cangjie-process-adapter.md)：真实 DLL/TurnToken/双流排空/清理五组 5/5；公共执行装配仍待完成 | 10-17 |
| Windows 原生所有权进程 | `windows-owned-process-provider` | [2026-10-17-windows-owned-process-provider](2026-10-17-windows-owned-process-provider.md)：AppContainer/管道/Job 原生薄层 35 项实测；仓颉适配与产品装配未完成 | 10-17 |
| AppContainer 当前身份验证 | `appcontainer-minimal-environment` | [2026-10-17-appcontainer-minimal-environment](2026-10-17-appcontainer-minimal-environment.md)：原生 error 203 环境对照，仓颉真实身份 5/5；产品执行后端仍未开放 | 10-17 |
| 桌面壳 · Electron · 打包分发 | `desktop-*`、`sacode-desktop-*`、`npm-publish*`、`package-*`、`renderer-decoupling*`、`latest-desktop-package*` | desktop-electron-blocker、official-desktop-baseline、2026-10-11-package-and-packed-verification-batchE | 10-03～10-15 |
| 界面 · 交互 · 布局 | `composer-*`、`queue-*`、`todo-*`、`*-layout*`、`*appearance*`、`model-select`、`models-page`、`client-slots*`、`role-label*`、`about-version*`、`default-permission*`、`autolaunch*` | sacode-desktop-layout、code-toolbar-layout、context-meter、2026-10-12-*（goal-bar/permission-menu/settings-workbench）、2026-10-17-role-label-removal（组标签移除＋中性壳冒烟配方）、2026-10-17-about-version-panel（关于页版本读数）、2026-10-17-default-permission-and-autolaunch（新会话默认权限＋开机自启） | 10-03～10-17 |
| 执行引擎 · Windows 隔离 · 安全 | `execution-*`、`windows-*`、`appcontainer-*`、`real-fs-ops*`、`h70-*` | execution-supervisor-real-process、windows-native-job-supervision、2026-10-16-gate-triad-repair、2026-10-16-windows-startup-three-issues-diagnosis（三问题排查：0x80000003/DLL/NSIS）、2026-10-17-cli-launch-0xc0000135-stdx-dll-missing（CLI 启动 0xC0000135 = stdx DLL 路径缺失；夹具孤儿化根因 + AGENTS.md 运行期 DLL 路径约定固化）、2026-10-17-cjpm-build-cj-stage-post-build-hook（cjpm build.cj stagePostBuild hook 全流程打通；解决 issue #725；干净目录验证 90+ 个 DLL 全复制成功；仓内落地受阻根因＝仓库根 ACL 被 Codex 沙箱化） | 10-06～10-17 |
| 目标系统（F04） | `goal-*`、`2026-10-15-p1-cancel-budget-fix` | goal-checkpoint-freeze、goal-claim-tool、goal-product-async-entry | 10-05～10-15 |
| 模型中心 · 提供方 | `model-*`、`handoff-model-provider*`、`*-submit-boundary*`、`*-acp-provider*` | model-center-b0/b3/b4/b5、model-tool-runtime、2026-10-13-model-edit-submit-boundary、[2026-10-17-model-center-call-log](2026-10-17-model-center-call-log.md)（模型调用日志：全局聚合回放各会话 requestTraceProjection，tab 落在供应商之后） | 10-04～10-17 |
| 插件与扩展 | `plugin-*`、`local-plugins-scope*`、`2026-10-1?-plugin-*` | plugin-manager-contract、plugin-lifetime-architecture、2026-10-11-plugin-gap-disposition-batchF | 10-04～10-12 |
| ACP · LSP · 委派 | `acp-*`、`lsp-l1-*`、`codebuddy-acp*` | acp-frame-probe-all-products、lsp-l1-reclose、2026-10-15-codebuddy-acp-stage2 | 10-07～10-15 |
| 远程 · daemon · 平台构建 | `2026-10-10-*`、`*-linux-*`、`*-core-*`、`session-persistence-*` | 2026-10-10-remote-product-acceptance、2026-10-10-protocol-schema-freeze、2026-10-13-linux-executable-build-followup | 10-10～10-16 |
| 上游对比 · 冻结基线 | `dsh-upstream-*`、`upstream-*`、`frontend-*-comparison*`、`p0-*` | dsh-upstream-freeze、upstream-ledger-2026-10-04.json、p0-interface-freeze | 10-02～10-07 |
| 审查 · 验收 · 复盘 | `*review*`、`*recheck*`、`verification-*`、`r0-*`、`qwen-*` | r0-review-closeout、sacode-phase123-stable-snapshot、2026-10-13-full-wiring-audit、2026-10-11-prd-p1-gap-recheck | 10-03～10-16 |
| 会话 · 工作区 · 引用 · 其他 | `session-*`、`attachment-*`、`request-trace*`、`w30-*`、`https-sse-*` | session-worktree、attachment-durable-seam、request-trace-core | 10-03～10-13 |
| 数据文件（8 个 · 非 md） | `.json` / `.txt` | 2026-10-13-full-wiring-audit-hashes.json、client-slots-artifacts-2026-10-05.json、dsh-upstream-delta-commits/-files.json、upstream-ledger-2026-10-04.json、ledger.json、lsp-l1-baseline-hashes.txt、lsp-l1-workspace-hashes.txt | 10-04～10-13 |

> 建议检索顺序：先按上表定位主题与时段，再看该时段内最新文件；目录本身按文件名排序即近似时间线。

## 2. 遗留说明

- [`MEMORY.md`](MEMORY.md) 为早期遗留的单行索引文件（仅 1 条记录），**保留不删**；完整导航以本 README 为准。
- 本目录文件数量会持续增长（约 177 篇 md + 8 个数据文件，截至 2026-10-16）；增量文档按 §0 命名规则直接落此，并在上方主题表补充新关键词（若属于全新主题）。

2026-10-17 提交前独立候选复验：[Windows 执行内部组件](2026-10-17-windows-execution-commit-candidate.md)，冷编译与 35/47/16 项通过；快照未入候选，产物守卫失败保留。

2026-10-17 EX-01/D14 后续：[工作区快照与变更导出](2026-10-17-windows-workspace-snapshot.md)当前定向 23/23，通过实际私有任务增删改、来源变更拒绝、硬链接/junction/越界拒绝及同日志审批前绑定。摘要的产品审批展示、整树终态约束、F08 合入和默认 Host/CLI 装配仍待完成，D14 不解除；一次 5 秒超时原因未定位。

2026-10-17 EX-01/REVIEW-01：[快照终态导出](2026-10-17-workspace-snapshot-settlement.md)已消费共享日志的 exited/退出观察/输出完整及快照绑定事实；真实任务与磁盘重放断言在 23/23 中通过。审批展示、启动复核及 F08/CAS 接线待实施，默认门禁不开放。

2026-10-17 EX-01/REVIEW-01：[快照审批与启动复核](2026-10-17-workspace-snapshot-approval.md)新增精确票绑定回执摘要、任务投影及页面范围展示；实际来源更新后拒绝恢复线程。核心集成 24/24，页面状态/渲染 13/13；完整桌面/Host 快照生命周期和 F08/CAS 仍待接线，门禁保持关闭。

2026-10-17 REVIEW-01/产物：[任务差异登记与真实 Host 消费](2026-10-17-task-review-persistence-host.md)复用 AttachmentStore 保存前后文件对象，同日志 execution/review 登记身份；核心 24/24、页面 16/16、当前 Host 真实历史投影及页面渲染通过。正文预览、F08/CAS 写回、Host 快照执行生命周期和完整桌面仍待完成，默认门禁关闭。

2026-10-17 F08/REVIEW-01：[任务正文预览](2026-10-17-task-review-body-preview.md)新增有限 execution/review-file，Host/CLI/IPC/页面读取登记的前后内容对象；核心24/24、页面19/19、桥接3/3及真实Host/CLI通过。写回审批/CAS与默认Host快照执行未开放。

2026-10-17 F08写回前置：[单文件条件写](2026-10-17-review-file-compare-exchange.md)新增独占句柄核对旧字节的内部创建/替换/删除原语，真实DLL定向28/28。尚非多文件或断电原子合入；审批/持久意图/部分成功与未知结算及产品写回未接，门禁关闭。

2026-10-17 F08：[写回审批与持久意图](2026-10-17-review-apply-journal.md)核心复用同一日志/lease/精确一次票/取消令牌，写前屏障与逐文件结算、部分成功及未知不重放，真实DLL定向36/36。公共写回动作、hunk及完整桌面仍未接，不升级产品完成状态。

2026-10-17 F08：[目录身份与固定原生库装配](2026-10-17-review-directory-identity.md)完成核心保护，真实DLL定向39/39、零跳过。拒绝同路径目录实体替换；旧记录保留只读。公共异步写回、双入口与桌面操作仍待接通，不升级产品完成状态。

2026-10-17 F08：[异步写回与停止边界](2026-10-17-review-apply-async.md)核心40/40通过；提交中查询/停止及时返回，后续文件不再写入，重复启动拒绝。公共双入口和页面仍待接通，默认门禁关闭。

2026-10-17 F08：[双入口及页面实际写回](2026-10-17-review-apply-product-entries.md)有限prepare/apply/describe/stop及页面独立确认已接；核心41/41、页面24/24、桥接4/4、真实组件→IPC→Host及CLI17项通过，合成项目实际增删改。Host176/IPC147；完整Electron/安装态、默认快照执行及在途Host停止仍待验，不解除D14与整体目标。

2026-10-17 EX-01/F08：[原工作区与私有执行目录映射](2026-10-17-snapshot-logical-workspace.md)真实定向42/42、页面27/27。会话目录/修订与原文件不变，仅私有副本改变并登记差异；默认Host/CLI生命周期尚未装配，D14及整体目标保持未完成。并发源码边界见证据。

2026-10-17 EX-01：[私有副本有界清理](2026-10-17-private-workspace-disposal.md)新增仅消费自有根句柄的内容清理，真实定向45/45。嵌套清理、占用后重试及链接拒绝/外部哨兵保护通过；默认Host/CLI资源生命周期尚未装配，D14与整体目标保持未完成。格式后复编边界见证据。

2026-10-17 EX-01/F08：[自动审查与资源收束](2026-10-17-execution-snapshot-settlement.md)共享监督器可信结束阶段47/47，差异持久化后才删除副本/释放profile和库；失败保留真实退出事实，晚期释放可在同进程重试。默认Host/CLI准备所有权尚未接通，D14与整体目标未解除。

2026-10-18 F08/EX-01：[私有执行生命周期与真实双入口](../evidence/2026-10-18-execution-capsule-entries.md)：核心定向50/50、真实状态层→IPC→Host及CLI 13项、桌面定向14/14；同进程准备/独立审批/执行/审查/写回及EOF取消收束已实测。未提交增量；项目与会话数据重合、完整Electron/安装态及隔离专项仍待验，整体功能不升级完成。

2026-10-18 F08/EX-01：[项目与会话数据同目录](../evidence/2026-10-18-colocated-execution-metadata.md)：按真实日志/租约/附件路径排除元数据，保留用户同名文件；新产物同目录与分离布局真实Host/CLI各13项通过。核心52项首轮51通过1清理错误，修正夹具后完整52/52通过、零跳过/错误/失败；不升级整体完成状态。
