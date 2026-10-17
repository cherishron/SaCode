# plans/ — 设计 · 详细设计 · 计划 · 治理（索引）

> 类别：②设计文档 ③详细设计文档 ④实施计划 ⑤测试 ⑥工程治理 的混合区。
> 上级索引：[docs/README.md](../README.md)｜带规格的实施计划在 [`../superpowers/`](../superpowers/README.md)｜专项总览：[接口与契约](../interfaces/README.md)、[对接方案](../integration/README.md)
> **本目录是"可能过期"区**：所有条目描述当时设计或计划，使用前核当前源码与 PRD 口径。

## A. 概要 / 总体设计（体系级）

| 文件 | 一句话 | 状态 |
|---|---|---|
| [`plan-deepseek-harness-replication.md`](plan-deepseek-harness-replication.md) | DSH 全系统复刻总体方案（v0.2） | **已历史化**（2026-10-13）：仅追溯用，不作当前定位 |
| [`dsh-capability-matrix.md`](dsh-capability-matrix.md) | 63 子系统能力矩阵 + 阶段状态回填 | **冻结快照**，≠ 现完成率 |
| [`plan-qwen-batch-replication.md`](plan-qwen-batch-replication.md) | Qwen Code Batch API 复刻草案（v0.1） | 未实现 |

## B. 功能与界面设计（方案级）

| 文件 | 一句话 | 状态 |
|---|---|---|
| [`sacode-workbench-visual-direction-2026-10-07.md`](sacode-workbench-visual-direction-2026-10-07.md) | 工作台视觉修订 | **已并入** [`../product/desktop-design-standard.md`](../product/desktop-design-standard.md)（2026-10-16；本文件降为指针） |
| [`sacode-extension-market-2026-10-11.md`](sacode-extension-market-2026-10-11.md) | 扩展市场方案 | 方案 |
| [`sacode-local-agent-presets-2026-10-11.md`](sacode-local-agent-presets-2026-10-11.md) | 本地 Agent 预设与自定义模式方案 | 方案 |
| [`sacode-self-performance-monitoring-2026-10-11.md`](sacode-self-performance-monitoring-2026-10-11.md) | 自身性能监控方案 | 方案 |
| [`appcontainer-sandbox-cffi-design.md`](appcontainer-sandbox-cffi-design.md) | 仓颉 CFFI 版 AppContainer 隔离接入方案 | 设计 |

## C. 详细设计（接口 / 契约 / 模块级）

> 接口面速查（各入口真源、实测读数与机器可读契约）见 [`../interfaces/README.md`](../interfaces/README.md)。

| 文件 | 一句话 | 状态 |
|---|---|---|
| [`sacode-product-interfaces-2026-10-07.md`](sacode-product-interfaces-2026-10-07.md) | 自主产品接口与状态设计（对象/状态机/固定十值错误原因） | 历史登记（10-13 补正），实施前核当前协议 |
| [`sacode-execution-contract-2026-10-07.md`](sacode-execution-contract-2026-10-07.md) | 执行与构建测试增量契约（含 10-08 执行口径更新） | 契约 |
| [`w10-persistence-barrier-recovery-contract-2026-10-06.md`](w10-persistence-barrier-recovery-contract-2026-10-06.md) | 持久化屏障与恢复契约 | 设计稿，待评审 |
| [`goal-claim-tool-interface-2026-10-07.md`](goal-claim-tool-interface-2026-10-07.md) | 完成证据声明侧接口变更单（update_goal 分支） | 变更单 |
| [`lsp-l1-entry-wiring-2026-10-07.md`](lsp-l1-entry-wiring-2026-10-07.md) | L1 LSP 语义工具契约与入口接线登记 | 登记单 |
| [`sacode-daemon-contract-review-2026-10-08.md`](sacode-daemon-contract-review-2026-10-08.md) | 本地守护进程复核与接线门禁 | 复核 |
| [`2026-10-12-knowledge-management-contract.md`](2026-10-12-knowledge-management-contract.md) | F11 知识库管理增量契约 | 设计中（基线 `1bf46d8`） |
| [`host-capabilities.json`](host-capabilities.json) | 宿主能力契约（机器可读） | 数据契约 |
| [`remote-capability-contract.json`](remote-capability-contract.json) | 远程能力契约（机器可读） | 数据契约 |

## D. 实施计划与接入清单

> 对接类方案（ACP / 远程 / 页面 / Git / 知识库 / 自动化）的状态汇总见 [`../integration/README.md`](../integration/README.md)。

| 文件 | 一句话 |
|---|---|
| [`2026-10-11-desktop-business-integration.md`](2026-10-11-desktop-business-integration.md) | 桌面前后端业务接通计划 |
| [`2026-10-12-git-write-integration.md`](2026-10-12-git-write-integration.md) | Git 写操作完整接入方案（待用户批准） |
| [`2026-10-12-remaining-product-pages.md`](2026-10-12-remaining-product-pages.md) | 未完成产品页面接线清单 |
| [`automation-product-wiring-2026-10-15.md`](automation-product-wiring-2026-10-15.md) | F13 自动化接线实施边界 |
| [`codebuddy-acp-entry-2026-10-14.md`](codebuddy-acp-entry-2026-10-14.md) | CodeBuddy CLI ACP 产品接线 |
| [`opencode-acp-diagnostics-repair-2026-10-14.md`](opencode-acp-diagnostics-repair-2026-10-14.md) | OpenCode ACP：用户控制、诊断与后台修复 |
| [`product-closure-goal-2026-10-15.md`](product-closure-goal-2026-10-15.md) | 主页面·工作台资源·真实开发任务闭环目标 |
| [`sacode-sidebar-session-brief-2026-10-08.md`](sacode-sidebar-session-brief-2026-10-08.md) | 侧边会话历史开发简报 |
| [`verb-wiring-checklist-2026-10-04.md`](verb-wiring-checklist-2026-10-04.md) | 51 行 ◐ verb 接入清单 |

## E. 测试与验收

| 文件 | 一句话 | 状态 |
|---|---|---|
| [`test-layout-2026-10-15.md`](test-layout-2026-10-15.md) | 测试目录整理台账（按模块/功能分类） | 进行中 |
| [`dsh-frontend-acceptance.md`](dsh-frontend-acceptance.md) | 冻结 DSH 前端与交互验收清单 | 历史快照 |

## F. 审计与预检

| 文件 | 一句话 |
|---|---|
| [`sacode-2026-10-11-preflight-source-audit.md`](sacode-2026-10-11-preflight-source-audit.md) | 三份 2026-10-11 设计方案的实施前源码审计 |

## G. 工程治理

| 文件 | 一句话 | 状态 |
|---|---|---|
| [`w00-path-ownership-and-isolation-2026-10-06.md`](w00-path-ownership-and-isolation-2026-10-06.md) | 路径所有权表与隔离工作安排（门禁解析的真源） | 契约 |
| [`windows-dependency-and-compatibility-2026-10-16.md`](windows-dependency-and-compatibility-2026-10-16.md) | Windows 依赖与兼容性评估：构建/桌面/CLI 三层安装清单、11 项特有问题、普通用户可行性与降级策略 | 2026-10-16 评估 |
| [`artifact-layout-and-retention-2026-10-16.md`](artifact-layout-and-retention-2026-10-16.md) | 产物统一与保留策略 | **已执行**（target/tmp 单根、守卫上线；遗留：安装包重打、守卫接线） |
| [`sacode-product-traceability-2026-10-07.md`](sacode-product-traceability-2026-10-07.md) | 需求追踪与第一批责任表 | 历史追踪（以 PRD F01–F21 为准） |

## 详细设计覆盖速览（粗清点，随文档增长更新）

| 主题 | 现有详细设计 / 契约 | 状态 |
|---|---|---|
| 全局对象与状态（会话/草稿/队列/目标/计划） | `sacode-product-interfaces` | 历史登记，实施前核当前协议 |
| 执行引擎（F02/F09） | `sacode-execution-contract` | 契约 + 10-08 口径 |
| 持久化屏障与恢复 | `w10-…-contract` | 设计稿待评审 |
| 目标完成证据（F04） | `goal-claim-tool-interface` | 变更单 |
| LSP（F21） | `lsp-l1-entry-wiring` | 登记 |
| daemon / 远程接入 | `sacode-daemon-contract-review` + `../superpowers/specs/2026-10-10-unified-remote-mobile-design.md` | 设计 |
| 知识库（F11） | `2026-10-12-knowledge-management-contract` | 设计中 |
| 执行隔离（安全） | `appcontainer-sandbox-cffi-design` | 方案 |
| 模型中心（F07） | `../superpowers/specs/2026-10-05-model-center-design.md` | 规格 |
| 压缩 / 审批 / 斜杠 / Hooks | `../superpowers/specs/2026-10-09-*-design.md` | 规格（待实施） |
| Git 写操作 | `2026-10-12-git-write-integration` | 待批准 |
| 能力契约（机器可读） | `host-capabilities.json`、`remote-capability-contract.json` | 数据契约 |

> 缺口登记规则：新发现"某主题无专文"时，先在此表标「缺（待补）」，补文后改为实际文件。

## 落点与登记规则

1. 新增设计/契约/计划落本目录（或 `superpowers/`：规格+计划成对）；
2. 状态标注四选一：**方案｜设计（待评审）｜已评审（待实施）｜已执行/历史**；
3. 涉及 PRD 需求 ID 的，文档头必须写明 Fxx 关联与基线；
4. 完成后同批在本索引与 [`../README.md`](../README.md) 维护记录登记。
