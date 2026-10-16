# superpowers/ — 设计规格 · 实施计划 · SDD 台账（索引）

> 类别：②设计文档 ③详细设计（规格级）④实施计划与台账。
> 上级索引：[docs/README.md](../README.md)｜项目级设计/契约在 [`../plans/`](../plans/README.md)
> **工作流**：先写 `specs/`（设计规格）→ 再写 `plans/`（实施计划，勾选框需实测证据才可勾）→ 执行中在 `sdd/` 留台账。
> 状态说明：以下规格与计划**均不代表已交付**；实际进度核 `../evidence/` 近期读数与 PRD 对应 Fxx。

## specs/ — 设计规格（9 篇）

| 文件 | 主题 | 配套计划 |
|---|---|---|
| [`2026-10-03-conversation-surface-tinyrobot-design.md`](specs/2026-10-03-conversation-surface-tinyrobot-design.md) | 对话面 TinyRobot 消息组件接入设计 | plans/2026-10-03-conversation-surface-tinyrobot |
| [`2026-10-03-next-sdk-page-tools-design.md`](specs/2026-10-03-next-sdk-page-tools-design.md) | Next SDK 页面工具接入设计 | plans/2026-10-03-next-sdk-page-tools |
| [`2026-10-05-model-center-design.md`](specs/2026-10-05-model-center-design.md) | 模型中心设计（供应商/自定义/调度恢复/计量/加速/迁移） | plans/2026-10-05-model-center-b1、b2 |
| [`2026-10-05-model-center-catalog-13-providers.md`](specs/2026-10-05-model-center-catalog-13-providers.md) | 13 家内置供应商 CatalogEntry 草案 | plans/2026-10-05-model-center-b1 |
| [`2026-10-08-browser-use-design.md`](specs/2026-10-08-browser-use-design.md) | Browser Use：接管用户已登录浏览器 | plans/2026-10-08-browser-use-core-foundation |
| [`2026-10-09-approval-modes-design.md`](specs/2026-10-09-approval-modes-design.md) | 4 种审批模式（Plan/Build/Auto/Yolo） | plans/2026-10-09-approval-modes |
| [`2026-10-09-hooks-lifecycle-design.md`](specs/2026-10-09-hooks-lifecycle-design.md) | Hooks 生命周期事件系统（25 事件） | plans/2026-10-09-hooks-lifecycle-implementation |
| [`2026-10-09-slash-command-system-design.md`](specs/2026-10-09-slash-command-system-design.md) | 斜杠命令系统（注册/补全/分层执行） | plans/2026-10-09-slash-command-system |
| [`2026-10-10-unified-remote-mobile-design.md`](specs/2026-10-10-unified-remote-mobile-design.md) | 统一远程接入与 Kuikly 移动端设计 | plans/2026-10-10-unified-remote-mobile |

## plans/ — 实施计划（14 篇）

| 文件 | 主题 | 备注 |
|---|---|---|
| [`2026-10-03-conversation-surface-tinyrobot.md`](plans/2026-10-03-conversation-surface-tinyrobot.md) | 对话面升级（TinyRobot 组件） | |
| [`2026-10-03-next-sdk-page-tools.md`](plans/2026-10-03-next-sdk-page-tools.md) | Next SDK 页面工具接入 | |
| [`2026-10-05-model-center-b1-catalog.md`](plans/2026-10-05-model-center-b1-catalog.md) | 模型中心 B1 模型目录 | |
| [`2026-10-05-model-center-b2-scheduling.md`](plans/2026-10-05-model-center-b2-scheduling.md) | 模型中心 B2 调度闭环 | |
| [`2026-10-06-w30-d-host-routing-seam.md`](plans/2026-10-06-w30-d-host-routing-seam.md) | W30 接口变更单：模型中心接入真实请求路径 | 变更单 |
| [`2026-10-08-browser-use-core-foundation.md`](plans/2026-10-08-browser-use-core-foundation.md) | Browser Use 核心基础 | |
| [`2026-10-08-session-worktree.md`](plans/2026-10-08-session-worktree.md) | 会话级 Worktree | |
| [`2026-10-09-approval-modes.md`](plans/2026-10-09-approval-modes.md) | 4 种审批模式 | |
| [`2026-10-09-automation-scheduled-tasks.md`](plans/2026-10-09-automation-scheduled-tasks.md) | 自动化与定时任务（daemon 持久调度） | |
| [`2026-10-09-compaction-pipeline.md`](plans/2026-10-09-compaction-pipeline.md) | Compaction 上下文压缩管线（F06/F09） | |
| [`2026-10-09-goal-execution-improvements.md`](plans/2026-10-09-goal-execution-improvements.md) | 持续目标改进与验收标准（F04） | |
| [`2026-10-09-hooks-lifecycle-implementation.md`](plans/2026-10-09-hooks-lifecycle-implementation.md) | Hooks 生命周期事件系统 | 见 sdd 台账 |
| [`2026-10-09-slash-command-system.md`](plans/2026-10-09-slash-command-system.md) | 斜杠命令系统 | 见 sdd 台账 |
| [`2026-10-10-unified-remote-mobile.md`](plans/2026-10-10-unified-remote-mobile.md) | 统一远程接入与移动工作台 | 同包交付 CLI/Host/daemon |

## sdd/ — 规格驱动开发台账（2 组 · 9 文件）

| 目录 | 内容 | 说明 |
|---|---|---|
| [`sdd/2026-10-09-hooks-lifecycle/`](sdd/2026-10-09-hooks-lifecycle/progress.md) | `progress.md` 任务台账 | 各任务完成状态以台账内记录为准（含被阻塞项与原因） |
| [`sdd/2026-10-09-slash-command-system/`](sdd/2026-10-09-slash-command-system/) | task-2～6 的 brief/report | 逐任务简报与报告 |

## 规则

1. 勾选框**仅在获得实测证据后**勾选（本工作流红线）；未验证的完成宣称不写入计划文档；
2. 规格变更：新建规格文件或在本文件维护记录中标注"已被 <新文件> 取代"，不改历史结论；
3. 新规格/计划完成后，同批登记本索引。
