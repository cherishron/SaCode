# F17 三层安全扫描 — 实现设计（2026-10-20）

本目录是 **纯设计**，不是产品代码，也不是对本仓发起扫描的执行授权。

| 文件 | 内容 |
| --- | --- |
| [DESIGN.md](./DESIGN.md) | 三层架构、契约、core 模型、与审阅写回关系、依赖、前端面板、待确认项 |

**现状摘要（设计前提，非本轮实现）：**

- 产品面：`workbench-tabs.ts` 中 `scan` 仍为 `available:false`；Host 无 `scan/*`。
- 已有：`apps/desktop/scan-adapters/` 纯数据归一 / 增量范围 / 修复前置 / 交接新鲜度（不执行扫描器、不写盘）。
- 写回真源：`execution/review-prepare` → 审批 → `execution/review-apply`（路径 digest CAS，并发拒绝覆盖）。
- PRD：F17 / SC01–SC08；接口计划：`scan/run|status|fix`，修复须走写授权。

**本设计不做：** 改 core/Host/桌面源码、提交、推送、安装外部扫描器、对本仓实扫。
