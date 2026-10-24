# Web 端 · 相关文档索引

> 类别：**⑪ 端文档（归类索引）**｜上级：[clients/README.md](../README.md)｜本端规格：[README.md](README.md)。
> 本端**专属文档已物理归入本端目录**（本页即该目录 `documents.md`）；通用/后端文档仍在其原目录。本页按主题列出引用。
> 注意：`apps/desktop` 的**内置浏览器**（`browser-webcontents-view-wiring`）属桌面端 F14 人工浏览入口，**不是** Web 工作台，见 [desktop/documents.md](../desktop/documents.md)。

## 1. 产品与平台

| 文档 | 内容 |
|---|---|
| [product/PRD.md](../../product/PRD.md) | §移动端与 Web 产品路线（W01–W04）；两端共同红线 |
| [product/platform-and-distribution.md](../../product/platform-and-distribution.md) | §3.2 Web 路线；平台矩阵与分发边界 |
| [product/PRD-tracking.md](../../product/PRD-tracking.md) | 移动端与 Web 路线台账 |

## 2. 方案与设计（架构 + 选型 + 部署+治理）

| 文档 | 内容 |
|---|---|
| [plans/2026-10-23-web-workbench-architecture.md](2026-10-23-web-workbench-architecture.md) | **架构方案**（待评审）：BFF、身份两层、安全边界、首发范围与非目标、复用资产与阻塞点 |
| [plans/2026-10-22-web-deployment-design.md](2026-10-22-web-deployment-design.md) | 初版部署方案（架构修订提案的上游初稿） |
| [plans/2026-10-23-web-technical-selection.md](2026-10-23-web-technical-selection.md) | 技术选型（Vue 3.5 + Vite 8 + Fastify 5 + TypeBox + SSE）与 T1–T6 待确认项 |
| [plans/2026-10-24-web-deployment-topology.md](2026-10-24-web-deployment-topology.md) | 部署拓扑 |
| [plans/web-tech-debt-2026-10-24.md](web-tech-debt-2026-10-24.md) | 工程治理技术负债台账（版本控制/静态检查/CI；P1/P2 未闭合项） |

## 3. 源码与测试（属 `apps/web/`）

| 位置 | 内容 |
|---|---|
| [`apps/web/src/`](../../../apps/web/src/) | 浏览器前端（Vue 3 + TS）：`pages/`、`stores/`、`api/client.ts`、`router.ts` |
| [`apps/web/server/`](../../../apps/web/server/) | Node BFF（Fastify）：`auth/`、`daemon/`、`events/`、`routes/`、`security/` |
| [`apps/web/contracts/web-actions.ts`](../../../apps/web/contracts/web-actions.ts) | 浏览器可调用动作契约 |
| [`apps/web/test/`](../../../apps/web/test/) | unit / integration / e2e（含真实 daemon 只读夹具） |

## 4. 接口与契约

| 文档 | 内容 |
|---|---|
| [interfaces/README.md](../../interfaces/README.md) | 接口面速查；2026-10-24 Web 只读增量（消费登记不替代运行时权限） |
| [plans/remote-capability-contract.json](../../plans/remote-capability-contract.json) | 远程方法契约（当前仅 `initialize`/`session/catalog`/`session/events` 登记 web） |
| [integration/README.md](../../integration/README.md) | 对接状态总览 |

## 5. 证据

| 文档 | 内容 |
|---|---|
| [2026-10-23-web-w01-w02a-poc.md](2026-10-23-web-w01-w02a-poc.md) | W01/W02 PoC：只读握手、真实 daemon 只读接入、SSE 故障修复与背压（§11） |

## 6. 通用（四端共享，不逐端重复）

[apps/daemon/](../../../apps/daemon/)（BFF 后端）、[apps/desktop/remote-transport.mjs](../../../apps/desktop/remote-transport.mjs)（BFF 评估复用的 TLS pin/并发/幂等参考）、[core/](../../../core/)；接口面见 [interfaces/README.md](../../interfaces/README.md)，对接状态见 [integration/README.md](../../integration/README.md)。

## 7. 维护规则

- 端内新增/变更文档时，同批在本页对应主题下补引用；只列链接与一句话说明。
- 方案类文档状态以其原文为准（多为“设计提案/待评审”）；本页不升级 W01–W04 状态，不把 PoC 当部署或安全验收。