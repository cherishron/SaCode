# integration/ — 对接方案文档（总览）

> 类别：④ 实施计划（对接类）。上级索引：[docs/README.md](../README.md)｜接口面速查见 [`../interfaces/README.md`](../interfaces/README.md)。
> 本页汇总"把外部系统、外部 Agent 与远程通道接进共享核心与产品页面"的方案文档、状态边界与验收出口。方案描述当时设计；**完成状态以 PRD、证据与当前源码为准**，没有真实任务证据的条目不标完成。

## 1. 对接面总览

| 对接对象 | 方案文档 | 状态与边界 | 验收出口 |
|---|---|---|---|
| ACP · OpenCode | [opencode-acp-diagnostics-repair-2026-10-14](../plans/opencode-acp-diagnostics-repair-2026-10-14.md) | F10-ACP-01 待验收；02–04 实施中；05–06 未开始。关闭零启动、诊断分列、复用现有任务链 | 真实实例 + Host/CLI/桌面共用任务/审批/取消/结算 |
| ACP · CodeBuddy | [codebuddy-acp-entry-2026-10-14](../plans/codebuddy-acp-entry-2026-10-14.md) | CB01–CB04 有独立构建、IPC/页面测试与假提供方证据；CB05 真实模型任务未授权；默认配置 `session/new` 仍 -32603（根因未确认）；窗口验收未通过 | 见原文「接管更新」节；不以协议初始化代替任务成功 |
| 远程 / 移动端 | [unified-remote-mobile 规格](../superpowers/specs/2026-10-10-unified-remote-mobile-design.md)｜[计划](../superpowers/plans/2026-10-10-unified-remote-mobile.md) | 设计；远程身份、会话归属与部署独立验收 | [remote-capability-contract.json](../plans/remote-capability-contract.json) + [daemon 复核](../plans/sacode-daemon-contract-review-2026-10-08.md) |
| 桌面业务链 | [2026-10-11-desktop-business-integration](../plans/2026-10-11-desktop-business-integration.md) | 大改实施方案；B1 已实施并构建；默认 C 盘存储限制未收口；用户已要求停止反复测试与新增探针 | 真实业务链逐项取证，UI 检查数不代替 |
| 页面接线与闭环 | [product-closure-goal-2026-10-15](../plans/product-closure-goal-2026-10-15.md)、[remaining-product-pages-2026-10-12](../plans/2026-10-12-remaining-product-pages.md) | 目标：知识库/自动化/连接三个主页面 + 七类工作台资源闭环；快照含 4 例 `host-gone` 失败待核 | 文件编辑 → 受控执行 → 差异审查 → 分别授权 Git |
| Windows 执行隔离前置 | [身份](../evidence/2026-10-17-appcontainer-minimal-environment.md)、[原生进程组件](../evidence/2026-10-17-windows-owned-process-provider.md)、[设计](../plans/appcontainer-sandbox-cffi-design.md) | 2026-10-17 身份 5/5、AppContainer/管道/Job 组件 35 项实测；公共执行器尚未消费 | 包内仓颉句柄适配及共享结果转换已实测（[记录](../evidence/2026-10-17-windows-process-collector.md)）；显式共享监督层取消/持久结算已验（[13/13](../evidence/2026-10-17-windows-execution-supervisor-integration.md)）；Host/CLI 默认装配、私有 ACL 撤销、文件/网络/逃逸反向测试及打包；当前门禁关闭 |
| Git 写操作（F08） | [2026-10-12-git-write-integration](../plans/2026-10-12-git-write-integration.md) | **待用户批准**；当前仅 `status`/`diff` 只读链 | 提案 + 绑定不可变提案的一次性工单；禁 `add .`/强推等 |
| 知识库（F11） | [管理契约](../plans/2026-10-12-knowledge-management-contract.md)、[核心/CLI](../evidence/2026-10-17-cli-launch-0xc0000135-stdx-dll-missing.md)、[Host/页面当前复验](../evidence/2026-10-15-knowledge-management-wiring.md) | 2026-10-17 未提交工作区：核心 5/5、CLI 跨轮请求 1/1、Host 自动检索 1/1、管理/显式引用 2/2、Electron 隔离页面 1/1；项目来源失效、作用域、上下文上限与无正文审计已验，页面明确模型发送 | 完整桌面/默认安全启动/安装态、源码符号索引与 KN01–KN08 效果对照待验；不升级为完整 F11 通过 |
| 自动化（F13） | [automation-product-wiring-2026-10-15](../plans/automation-product-wiring-2026-10-15.md) | 实施边界已定：保存不执行；启用/手动触发/取消为显式动作 | 真实定时或手动触发、独立会话任务与审批、取消与去重 |
| 插件与扩展市场 | [sacode-extension-market-2026-10-11](../plans/sacode-extension-market-2026-10-11.md)；[实施前审计](../plans/sacode-2026-10-11-preflight-source-audit.md) | 方案；Skill/MCP 宿主分派缺口见审计（接通线排在市场之前） | 可信目录来源 + 现有 inspect/start/授权链 |
| LSP（F21） | [lsp-l1-entry-wiring-2026-10-07](../plans/lsp-l1-entry-wiring-2026-10-07.md) | 契约与入口接线登记 | 见 [接口总览](../interfaces/README.md) §1 |

## 2. 对接共同红线

1. **复用共享核心**：任务、审批（一次性工单）、取消与结算不建第二套；外部 Agent 的凭据不复制、不改写。
2. **真实任务验收**：协议探针、单测、目录读取结果都不等于对接完成；未授权的模型任务不发送。
3. **归属边界**：并发会话按交付线归属；公共接线只做增量，不覆盖他人差异、不替他人提交。
4. **失败与恢复**：取消、断连、重连、迟到响应、未知副作用按各自文档门槛逐项取证；缺证保持待验收。

## 3. 维护规则

- 新增对接方案落 `plans/`（有规格的成对进 `superpowers/`），同批在本页登记；
- 状态列只用：方案｜设计中｜实施中｜待验收｜已验收（附证据）｜已移交，不写"基本完成"；
- 方案中列出的"完成门槛"证据出具后，回本页更新状态并注明证据出处。


2026-10-17 EX-01/D14 增量：[私有任务目录组件](../evidence/2026-10-17-windows-private-workspace-scope.md)47 项实际文件访问/拒绝/独立清理通过，父 DACL 保持不变；尚未接入仓颉工作区快照、受保护子树排除及差异合入，不能解除 D14 或默认执行门禁。


2026-10-17 后续装配：[仓颉私有 cwd 真实任务](../evidence/2026-10-17-cangjie-private-workspace-task.md)新增 WindowsPrivateWorkspace 生命周期与同一共享审批/执行链的私有文件读写，当前定向 16/16。生产树快照、排除清单、源修订与差异导出/合入仍未完成；D14 和默认执行门禁保持未解除。
