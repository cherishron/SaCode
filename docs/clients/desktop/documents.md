# 桌面端 · 相关文档索引

> 类别：**⑪ 端文档（归类索引）**｜上级：[clients/README.md](../README.md)｜本端规格：[README.md](README.md)。
> 本端**专属文档已物理归入本端目录**（本页即该目录 `documents.md`）；通用/后端文档仍在其原目录。本页按主题列出引用。
> 穷尽清单以各类目录索引为准：[evidence/README.md](../../evidence/README.md)、[plans/README.md](../../plans/README.md)、[interfaces/README.md](../../interfaces/README.md)、[integration/README.md](../../integration/README.md)。

## 1. 产品与平台

| 文档 | 内容 |
|---|---|
| [product/PRD.md](../../product/PRD.md) | F01–F21 需求；桌面为主承载端；近期交付闭环口径 |
| [product/platform-and-distribution.md](../../product/platform-and-distribution.md) | 平台矩阵、桌面/服务包分发、并发边界 |
| [product/desktop-design-standard.md](desktop-design-standard.md) | 产品级桌面布局与品牌数值标准（冻结上游口径） |
| [product/PRD-tracking.md](../../product/PRD-tracking.md) | F01–F21 跟进台账与当前交付卡 |
| [plans/product-closure-goal-2026-10-15.md](../../plans/product-closure-goal-2026-10-15.md) | 交付主线 §0（真实闭环顺序） |

## 2. 设计规范与设计稿

| 文档 | 内容 |
|---|---|
| [`renderer/DESIGN.md`](../../../apps/desktop/renderer/DESIGN.md) | 桌面渲染层设计原则 + 令牌映射（权威在端内） |
| [plans/sacode-workbench-visual-direction-2026-10-07.md](../../plans/sacode-workbench-visual-direction-2026-10-07.md) | 工作台视觉方向（已并入 desktop-design-standard） |
| [plans/sacode-sidebar-session-brief-2026-10-08.md](../../plans/sacode-sidebar-session-brief-2026-10-08.md) | 侧栏会话摘要设计 |
| [superpowers/specs/2026-10-03-conversation-surface-tinyrobot-design.md](../../superpowers/specs/2026-10-03-conversation-surface-tinyrobot-design.md) | 对话面（TinyRobot Bubble 族）设计 |
| [superpowers/specs/2026-10-05-model-center-design.md](2026-10-05-model-center-design.md) | 模型中心设计 |
| [superpowers/specs/2026-10-09-approval-modes-design.md](../../superpowers/specs/2026-10-09-approval-modes-design.md) | 审批模式设计 |
| [superpowers/specs/2026-10-09-slash-command-system-design.md](../../superpowers/specs/2026-10-09-slash-command-system-design.md) | 斜杠命令系统设计 |
| [superpowers/specs/2026-10-08-browser-use-design.md](../../superpowers/specs/2026-10-08-browser-use-design.md) | 浏览器使用设计（F14） |
| [superpowers/specs/2026-10-03-next-sdk-page-tools-design.md](../../superpowers/specs/2026-10-03-next-sdk-page-tools-design.md) | 页面工具设计 |
| [plans/2026-10-12-remaining-product-pages.md](../../plans/2026-10-12-remaining-product-pages.md) | 未完成产品页面接线与接口缺口清单 |

功能域设计（桌面为其入口，后端共享 core）：[终端交互](../../plans/2026-10-20-terminal-interactive-design.md)、[终端前端](2026-10-20-terminal-frontend-design.md)、[数据库面板](../../plans/2026-10-20-database-panel-design.md)、[Git 后端](../../plans/2026-10-20-git-backend-design.md)、[安全扫描](../../plans/2026-10-20-security-scan-design.md)、[SSH 后端](../../plans/2026-10-20-ssh-backend-design.md)、[语音增强](2026-10-20-voice-enhancement-design.md)、[浏览器与电脑操控](../../plans/2026-10-20-browser-control-design.md)、[上下文压缩](../../plans/2026-10-20-context-compression-design.md)、[数据导入](../../plans/2026-10-20-data-import-design-opencode.md)、[知识库索引](../../plans/2026-10-20-knowledge-index-design.md)、[Hooks/自动化](../../plans/2026-10-20-hooks-automation-design.md)。

## 3. 接口与契约

| 文档 | 内容 |
|---|---|
| [interfaces/README.md](../../interfaces/README.md) | 七个接口面速查；桌面 IPC 权威＝`preload.cjs` 顶层 key |
| [interfaces/session-interactions-2026-10-19.md](../../interfaces/session-interactions-2026-10-19.md) | 会话交互契约（rename/archive/问答/工具关联卡） |
| [interfaces/model-pull-lifecycle-2026-10-17.md](../../interfaces/model-pull-lifecycle-2026-10-17.md) | 模型拉取生命周期（等待/查询/取消） |
| [interfaces/execution-review-apply-2026-10-17.md](../../interfaces/execution-review-apply-2026-10-17.md)、[execution-review-preview-2026-10-17.md](../../interfaces/execution-review-preview-2026-10-17.md) | 执行/审查写回与预览契约 |
| [plans/host-capabilities.json](../../plans/host-capabilities.json) | Host 方法名清单（机器可读） |
| [plans/sacode-product-interfaces-2026-10-07.md](../../plans/sacode-product-interfaces-2026-10-07.md) | 产品对象/状态机/固定错误原因 |
| [plans/2026-10-12-git-write-integration.md](../../plans/2026-10-12-git-write-integration.md) | Git 写操作接口（待批准） |
| [plans/2026-10-12-knowledge-management-contract.md](../../plans/2026-10-12-knowledge-management-contract.md) | 知识库管理增量契约 |
| [plans/sacode-execution-contract-2026-10-07.md](../../plans/sacode-execution-contract-2026-10-07.md) | 执行/构建测试增量契约 |

## 4. 工程与治理

| 文档 | 内容 |
|---|---|
| [plans/artifact-layout-and-retention-2026-10-16.md](../../plans/artifact-layout-and-retention-2026-10-16.md) | 产物布局与保留（`dist/`、`target/tmp/`） |
| [plans/windows-dependency-and-compatibility-2026-10-16.md](../../plans/windows-dependency-and-compatibility-2026-10-16.md) | Windows 依赖清单与普通用户降级策略 |
| [build-platforms.md](../../build-platforms.md) | 多平台构建与打包步骤 |

## 5. 证据（按主题）

> 以下为与桌面端直接相关的取证读数；权威穷尽清单见 [evidence/README.md](../../evidence/README.md)。

### 5.1 渲染层 / 视觉 / 组件
[sacode-desktop-layout-2026-10-03.md](sacode-desktop-layout-2026-10-03.md)、[dsh-ui-style-audit-2026-10-03.md](../../evidence/dsh-ui-style-audit-2026-10-03.md)、[settings-shell-layout-2026-10-04.md](../../evidence/settings-shell-layout-2026-10-04.md)、[tooltip-layout-2026-10-04.md](../../evidence/tooltip-layout-2026-10-04.md)、[markdown-highlight-layout-2026-10-04.md](../../evidence/markdown-highlight-layout-2026-10-04.md)、[code-toolbar-layout-2026-10-04.md](../../evidence/code-toolbar-layout-2026-10-04.md)、[composer-attachments-2026-10-04.md](composer-attachments-2026-10-04.md)、[composer-controls-layout-2026-10-04.md](composer-controls-layout-2026-10-04.md)、[composer-keymap-2026-10-04.md](composer-keymap-2026-10-04.md)、[queue-dock-2026-10-04.md](queue-dock-2026-10-04.md)、[todo-panel-2026-10-04.md](todo-panel-2026-10-04.md)、[global-appearance-store-2026-10-04.md](../../evidence/global-appearance-store-2026-10-04.md)、[persisted-image-2026-10-05.md](../../evidence/persisted-image-2026-10-05.md)、[2026-10-11-renderer-decoupling-and-full-regression-batchCD.md](2026-10-11-renderer-decoupling-and-full-regression-batchCD.md)、[2026-10-12-goal-bar-visual-alignment.md](../../evidence/2026-10-12-goal-bar-visual-alignment.md)、[2026-10-12-permission-menu-frontend-repair.md](2026-10-12-permission-menu-frontend-repair.md)、[2026-10-19-c4-acceptance-bugfix.md](../../evidence/2026-10-19-c4-acceptance-bugfix.md)、[2026-10-24-desktop-renderer-design.md](2026-10-24-desktop-renderer-design.md)、[2026-10-24-desktop-renderer-ui-token-unification.md](2026-10-24-desktop-renderer-ui-token-unification.md)、[2026-10-24-desktop-degradation-audit.md](2026-10-24-desktop-degradation-audit.md)、[2026-10-24-provider-editor-dialog.md](2026-10-24-provider-editor-dialog.md)、[2026-10-24-composer-empty-stats.txt](2026-10-24-composer-empty-stats.txt)。

### 5.2 供应商 / 模型中心
[handoff-model-provider-2026-10-04.md](../../evidence/handoff-model-provider-2026-10-04.md)、[model-select-2026-10-04.md](../../evidence/model-select-2026-10-04.md)、[models-page-2026-10-04.md](../../evidence/models-page-2026-10-04.md)、[model-center-b0-2026-10-05.md](model-center-b0-2026-10-05.md)、[model-center-b3-ledger-2026-10-05.md](model-center-b3-ledger-2026-10-05.md)、[model-center-b4-accel-2026-10-05.md](model-center-b4-accel-2026-10-05.md)、[model-center-b5-migration-2026-10-05.md](model-center-b5-migration-2026-10-05.md)、[model-center-replacement-2026-10-06.md](model-center-replacement-2026-10-06.md)、[model-image-capability-2026-10-05.md](../../evidence/model-image-capability-2026-10-05.md)、[2026-10-13-provider-submit-boundary.md](../../evidence/2026-10-13-provider-submit-boundary.md)、[2026-10-13-model-edit-submit-boundary.md](../../evidence/2026-10-13-model-edit-submit-boundary.md)、[2026-10-17-model-center-call-log.md](2026-10-17-model-center-call-log.md)、[2026-10-17-model-pull-host-lifecycle.md](../../evidence/2026-10-17-model-pull-host-lifecycle.md)、[2026-10-17-model-pull-timeout-fix.md](../../evidence/2026-10-17-model-pull-timeout-fix.md)、[2026-10-17-model-pull-timeout-followup.md](../../evidence/2026-10-17-model-pull-timeout-followup.md)、[2026-10-18-model-pull-desktop-lifecycle.md](2026-10-18-model-pull-desktop-lifecycle.md)、[2026-10-18-model-pull-unknown-verification.md](../../evidence/2026-10-18-model-pull-unknown-verification.md)、[2026-10-24-context-meter-capacity-wiring.md](../../evidence/2026-10-24-context-meter-capacity-wiring.md)。

### 5.3 审批 / 权限 / 子代理
[desktop-model-approval-consumption-2026-10-08.md](desktop-model-approval-consumption-2026-10-08.md)、[2026-10-17-default-permission-and-autolaunch.md](../../evidence/2026-10-17-default-permission-and-autolaunch.md)、[2026-10-15-p1-cancel-budget-fix.md](../../evidence/2026-10-15-p1-cancel-budget-fix.md)、[subagent-settings-2026-10-04.md](../../evidence/subagent-settings-2026-10-04.md)、[2026-10-19-first-batch-interactions.md](../../evidence/2026-10-19-first-batch-interactions.md)、[2026-10-24-p0-cross-end-gates.md](../../evidence/2026-10-24-p0-cross-end-gates.md)。

### 5.4 执行 / 审查 / 私有工作区（共享链；桌面为其入口之一）
[2026-10-17-task-review-persistence-host.md](../../evidence/2026-10-17-task-review-persistence-host.md)、[2026-10-17-task-review-body-preview.md](../../evidence/2026-10-17-task-review-body-preview.md)、[2026-10-17-review-apply-product-entries.md](../../evidence/2026-10-17-review-apply-product-entries.md)、[2026-10-17-review-apply-async.md](../../evidence/2026-10-17-review-apply-async.md)、[2026-10-17-review-apply-journal.md](../../evidence/2026-10-17-review-apply-journal.md)、[2026-10-17-review-directory-identity.md](../../evidence/2026-10-17-review-directory-identity.md)、[2026-10-17-review-file-compare-exchange.md](../../evidence/2026-10-17-review-file-compare-exchange.md)、[2026-10-17-workspace-snapshot-approval.md](../../evidence/2026-10-17-workspace-snapshot-approval.md)、[2026-10-17-workspace-snapshot-settlement.md](../../evidence/2026-10-17-workspace-snapshot-settlement.md)、[2026-10-17-windows-workspace-snapshot.md](../../evidence/2026-10-17-windows-workspace-snapshot.md)、[2026-10-18-execution-capsule-entries.md](../../evidence/2026-10-18-execution-capsule-entries.md)、[2026-10-18-colocated-execution-metadata.md](../../evidence/2026-10-18-colocated-execution-metadata.md)、[2026-10-14-execution-history-wiring.md](../../evidence/2026-10-14-execution-history-wiring.md)。

### 5.5 页面域（终端/数据库/Git/知识/导入/自动化/SSH/浏览器/语音）
[2026-10-15-knowledge-management-wiring.md](../../evidence/2026-10-15-knowledge-management-wiring.md)、[2026-10-12-product-management-pages.md](../../evidence/2026-10-12-product-management-pages.md)、[2026-10-12-settings-workbench-page-review.md](../../evidence/2026-10-12-settings-workbench-page-review.md)、[2026-10-15-build-test-page-and-cjpm-retry.md](../../evidence/2026-10-15-build-test-page-and-cjpm-retry.md)、[2026-10-21-d23-reasoning-content.md](../../evidence/2026-10-21-d23-reasoning-content.md)、[2026-10-24-browser-webcontents-view-wiring.md](../../evidence/2026-10-24-browser-webcontents-view-wiring.md)、[2026-10-24-voice-input-wiring.md](2026-10-24-voice-input-wiring.md)、[2026-10-24-terminal-interactive-wiring.md](../../evidence/2026-10-24-terminal-interactive-wiring.md)、[automation-product-wiring-2026-10-15.md](../../plans/automation-product-wiring-2026-10-15.md)、[2026-10-24-automation-trigger-admission-core.md](../../evidence/2026-10-24-automation-trigger-admission-core.md)。

### 5.6 启动 / 打包 / 环境
[2026-10-16-windows-startup-three-issues-diagnosis.md](../../evidence/2026-10-16-windows-startup-three-issues-diagnosis.md)、[2026-10-18-r2-cold-restart-persistence.md](../../evidence/2026-10-18-r2-cold-restart-persistence.md)、[2026-10-18-r2-three-path-protocol.md](../../evidence/2026-10-18-r2-three-path-protocol.md)、[2026-10-19-electron-test-env-gate.md](2026-10-19-electron-test-env-gate.md)、[2026-10-24-extension-host-env-root-cause.md](../../evidence/2026-10-24-extension-host-env-root-cause.md)、[2026-10-23-linux-desktop-package.md](2026-10-23-linux-desktop-package.md)、[2026-10-23-ui-smoke-triage.md](2026-10-23-ui-smoke-triage.md)、[latest-desktop-package-2026-10-06.md](latest-desktop-package-2026-10-06.md)、[official-desktop-baseline-2026-10-04.md](official-desktop-baseline-2026-10-04.md)。

### 5.7 真实闭环
[2026-10-23-longcat-gui-key-entry.md](2026-10-23-longcat-gui-key-entry.md)、[2026-10-23-longcat-real-task-loop.md](../../evidence/2026-10-23-longcat-real-task-loop.md)、[2026-10-19-c4-delivery.md](../../evidence/2026-10-19-c4-delivery.md)、[2026-10-18-r4-runtime-and-stream-repair.md](../../evidence/2026-10-18-r4-runtime-and-stream-repair.md)。

### 5.8 历史（早期前端/桌面，2026-10-03～10-08）
[desktop-structure-2026-10-04.md](desktop-structure-2026-10-04.md)、[desktop-stdio-2026-10-04.md](desktop-stdio-2026-10-04.md)、[desktop-backend-wiring-2026-10-04.md](desktop-backend-wiring-2026-10-04.md)、[desktop-rebuild-queue-2026-10-05.md](desktop-rebuild-queue-2026-10-05.md)、[desktop-electron-blocker.md](desktop-electron-blocker.md)、[desktop-host-bridge-recovery-2026-10-08.md](desktop-host-bridge-recovery-2026-10-08.md)、[desktop-model-approval-consumption-2026-10-08.md](desktop-model-approval-consumption-2026-10-08.md)、[frontend-gap-audit-2026-10-05.md](frontend-gap-audit-2026-10-05.md)、[frontend-official-comparison-2026-10-05.md](frontend-official-comparison-2026-10-05.md)、[frontend-live-comparison-2026-10-06.md](frontend-live-comparison-2026-10-06.md)、[sacode-desktop-release-2026-10-04.md](sacode-desktop-release-2026-10-04.md)、[sacode-prototype-ui-qa-2026-10-07.md](../../evidence/sacode-prototype-ui-qa-2026-10-07.md)、[sacode-workbench-resources-2026-10-07.md](../../evidence/sacode-workbench-resources-2026-10-07.md)。

## 6. 通用（四端共享，不逐端重复）

[core/](../../../core/)（会话/执行/授权/取消/结算真源）、[apps/host/](../../../apps/host/)（协议宿主）、[apps/daemon/](../../../apps/daemon/)（服务端）、[extjs/](../../../extjs/)（JS 扩展宿主）；接口面见 [interfaces/README.md](../../interfaces/README.md)，对接状态见 [integration/README.md](../../integration/README.md)；构建/平台证据（windows/core/sandbox 类）见 [evidence/README.md](../../evidence/README.md) 与 [plans/README.md](../../plans/README.md)。

## 7. 维护规则

- 端内新增/变更文档时，同批在本页对应主题下补引用；本页只列链接与一句话说明，不复制正文。
- 状态以各原文档为准，本页不升级任何完成度。