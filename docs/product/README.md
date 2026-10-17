# product/ — 产品文档（索引）

> 类别：① 产品文档。本级文档定义**做什么、给谁做、验收口径**，是需求与范围的第一权威。
> 上级索引：[docs/README.md](../README.md)

## 文档清单

| 文档 | 角色 | 状态与说明 |
|---|---|---|
| [`PRD.md`](PRD.md) | 现行产品需求：F01–F21 能力域、授权与真实任务验收要求 | 活跃。含 2026-10-09 进度对账节（三档口径：已实现/真实入口已接通/仍未验证或缺失）；带日期的进度表是历史快照，不是实时真源 |
| [`PRD-tracking.md`](PRD-tracking.md) | F01–F21 **全程跟进台账**：逐域完成/未完成、缺陷登记（P1/P2/已闭合）、平台快照与关键分母读数 | 2026-10-16 建立；同日刷新：D10 根因已定位（Low 标签继承链）、新增 D18（NSIS）/D19（旧 DLL 载荷）。只登记现状与证据，不改需求、不计算完成率；**完成功能或闭合缺陷必须同批更新**（AGENTS.md「文档同步规则」） |
| [`platform-and-distribution.md`](platform-and-distribution.md) | 平台支持矩阵、npm/GitHub 分发、安装渠道与证据边界 | 2026-10-13 用户决策；**支持目标与已验证状态分开登记**；不等于全平台已发布 |
| [`desktop-design-standard.md`](desktop-design-standard.md) | 桌面布局与品牌规范（兼②设计文档） | 2026-10-03 起草，引用旧基线；使用时结合 PRD 复核，进度以 PRD 为准 |

## 使用规则

1. **需求变更只进 PRD 或本目录专项文**，不改 evidence/ 与 plans/ 里的历史记录；
2. 任何"已完成/已支持"的宣称必须绑定：提交、入口、平台、实际证据四要素（见 PRD 顶部口径）；
3. 平台/分发口径变更时，同步更新 `platform-and-distribution.md`，并在 [docs/README.md](../README.md) 维护记录追加一行；
4. **完成功能或闭合缺陷时，同批更新 [`PRD-tracking.md`](PRD-tracking.md) 对应 Fxx 行**：改状态、补事实、列缺口；缺陷闭合保留历史行并附证据（详见 AGENTS.md「文档同步规则」）。

## 相关

- 设计与契约：[`../plans/README.md`](../plans/README.md)、[`../superpowers/README.md`](../superpowers/README.md)
- 验收与证据：[`../qa/README.md`](../qa/README.md)、[`../evidence/README.md`](../evidence/README.md)

2026-10-17：PRD-tracking 更新 EX-01/D14 的内部组件进度；[提交候选验证](../evidence/2026-10-17-windows-execution-commit-candidate.md)通过不解除产品默认执行门禁。

2026-10-17 EX-01/D14 后续：[工作区快照与变更导出](../evidence/2026-10-17-windows-workspace-snapshot.md)当前定向 23/23，通过实际私有任务增删改、来源变更拒绝、硬链接/junction/越界拒绝及同日志审批前绑定。摘要的产品审批展示、整树终态约束、F08 合入和默认 Host/CLI 装配仍待完成，D14 不解除；一次 5 秒超时原因未定位。

2026-10-17 EX-01/REVIEW-01：[快照终态导出](../evidence/2026-10-17-workspace-snapshot-settlement.md)已消费共享日志的 exited/退出观察/输出完整及快照绑定事实；真实任务与磁盘重放断言在 23/23 中通过。审批展示、启动复核及 F08/CAS 接线待实施，默认门禁不开放。

2026-10-17 EX-01/REVIEW-01：[快照审批与启动复核](../evidence/2026-10-17-workspace-snapshot-approval.md)新增精确票绑定回执摘要、任务投影及页面范围展示；实际来源更新后拒绝恢复线程。核心集成 24/24，页面状态/渲染 13/13；完整桌面/Host 快照生命周期和 F08/CAS 仍待接线，门禁保持关闭。

2026-10-17 REVIEW-01/产物：[任务差异登记与真实 Host 消费](../evidence/2026-10-17-task-review-persistence-host.md)复用 AttachmentStore 保存前后文件对象，同日志 execution/review 登记身份；核心 24/24、页面 16/16、当前 Host 真实历史投影及页面渲染通过。正文预览、F08/CAS 写回、Host 快照执行生命周期和完整桌面仍待完成，默认门禁关闭。

2026-10-17 F08/REVIEW-01：[任务正文预览](../evidence/2026-10-17-task-review-body-preview.md)新增有限 execution/review-file，Host/CLI/IPC/页面读取登记的前后内容对象；核心24/24、页面19/19、桥接3/3及真实Host/CLI通过。写回审批/CAS与默认Host快照执行未开放。

2026-10-17 F08写回前置：[单文件条件写](../evidence/2026-10-17-review-file-compare-exchange.md)新增独占句柄核对旧字节的内部创建/替换/删除原语，真实DLL定向28/28。尚非多文件或断电原子合入；审批/持久意图/部分成功与未知结算及产品写回未接，门禁关闭。

2026-10-17 F08：[写回审批与持久意图](../evidence/2026-10-17-review-apply-journal.md)核心复用同一日志/lease/精确一次票/取消令牌，写前屏障与逐文件结算、部分成功及未知不重放，真实DLL定向36/36。公共写回动作、hunk及完整桌面仍未接，不升级产品完成状态。

2026-10-17 F08：[目录身份与固定原生库装配](../evidence/2026-10-17-review-directory-identity.md)完成核心保护，真实DLL定向39/39、零跳过。拒绝同路径目录实体替换；旧记录保留只读。公共异步写回、双入口与桌面操作仍待接通，不升级产品完成状态。

2026-10-17 F08：[异步写回与停止边界](../evidence/2026-10-17-review-apply-async.md)核心40/40通过；提交中查询/停止及时返回，后续文件不再写入，重复启动拒绝。公共双入口和页面仍待接通，默认门禁关闭。

2026-10-17 F08：[双入口及页面实际写回](../evidence/2026-10-17-review-apply-product-entries.md)有限prepare/apply/describe/stop及页面独立确认已接；核心41/41、页面24/24、桥接4/4、真实组件→IPC→Host及CLI17项通过，合成项目实际增删改。Host176/IPC147；完整Electron/安装态、默认快照执行及在途Host停止仍待验，不解除D14与整体目标。

2026-10-17 EX-01/F08：[原工作区与私有执行目录映射](../evidence/2026-10-17-snapshot-logical-workspace.md)真实定向42/42、页面27/27。会话目录/修订与原文件不变，仅私有副本改变并登记差异；默认Host/CLI生命周期尚未装配，D14及整体目标保持未完成。并发源码边界见证据。

2026-10-17 EX-01：[私有副本有界清理](../evidence/2026-10-17-private-workspace-disposal.md)新增仅消费自有根句柄的内容清理，真实定向45/45。嵌套清理、占用后重试及链接拒绝/外部哨兵保护通过；默认Host/CLI资源生命周期尚未装配，D14与整体目标保持未完成。格式后复编边界见证据。

2026-10-17 EX-01/F08：[自动审查与资源收束](../evidence/2026-10-17-execution-snapshot-settlement.md)共享监督器可信结束阶段47/47，差异持久化后才删除副本/释放profile和库；失败保留真实退出事实，晚期释放可在同进程重试。默认Host/CLI准备所有权尚未接通，D14与整体目标未解除。

2026-10-18 F08/EX-01：[私有执行生命周期与真实双入口](../evidence/2026-10-18-execution-capsule-entries.md)：核心定向50/50、真实状态层→IPC→Host及CLI 13项、桌面定向14/14；同进程准备/独立审批/执行/审查/写回及EOF取消收束已实测。未提交增量；项目与会话数据重合、完整Electron/安装态及隔离专项仍待验，整体功能不升级完成。

2026-10-18 F08/EX-01：[项目与会话数据同目录](../evidence/2026-10-18-colocated-execution-metadata.md)：按真实日志/租约/附件路径排除元数据，保留用户同名文件；新产物同目录与分离布局真实Host/CLI各13项通过。核心52项首轮51通过1清理错误，修正夹具后完整52/52通过、零跳过/错误/失败；不升级整体完成状态。
