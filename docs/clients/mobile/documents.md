# 移动端 · 相关文档索引

> 类别：**⑪ 端文档（归类索引）**｜上级：[clients/README.md](../README.md)｜本端规格：[README.md](README.md)。
> 本端**专属文档已物理归入本端目录**（本页即该目录 `documents.md`）；通用/后端文档仍在其原目录。本页按主题列出引用。
> 穷尽清单见 [evidence/README.md](../../evidence/README.md)、[plans/README.md](../../plans/README.md)、[integration/README.md](../../integration/README.md)。

## 1. 产品与平台

| 文档 | 内容 |
|---|---|
| [product/PRD.md](../../product/PRD.md) | §移动端与 Web 产品路线（M01–M05）；§移动端工程归属补记 |
| [product/platform-and-distribution.md](../../product/platform-and-distribution.md) | §1 移动入口纠偏；§3.1 单仓库归并；§3.2 移动端路线 |
| [product/PRD-tracking.md](../../product/PRD-tracking.md) | 移动端与 Web 路线台账 |

## 2. 工程内文档（属 `apps/mobile/`）

| 文档 | 内容 |
|---|---|
| [`apps/mobile/AGENTS.md`](../../../apps/mobile/AGENTS.md) | 移动工程规则：角色、接入开放面、技术栈、构建、Kuikly 流程与解构规约 |
| [`apps/mobile/README.md`](../../../apps/mobile/README.md) | 工程说明 |
| [`docs/sa-code-mobile-integration-plan.md`](../../../apps/mobile/docs/sa-code-mobile-integration-plan.md) | **接入方案**：网络契约、门禁 G1–G5、客户端分层、分阶段实施（P0–P3） |
| [`docs/sa-code-integration-progress.md`](../../../apps/mobile/docs/sa-code-integration-progress.md) | 接入实施记录 |
| [`docs/sa-code-upgrade-assessment-2026-10-22.md`](../../../apps/mobile/docs/sa-code-upgrade-assessment-2026-10-22.md) | 升级复评 |
| [`docs/MVP-GOAL.md`](../../../apps/mobile/docs/MVP-GOAL.md)、[`docs/PROGRESS.md`](../../../apps/mobile/docs/PROGRESS.md) | 目标与进度（局部，不替代根台账） |
| [`docs/ohos-known-differences.md`](../../../apps/mobile/docs/ohos-known-differences.md) | 鸿蒙差异 |
| [`docs/saui/overview.md`](../../../apps/mobile/docs/saui/overview.md)、[`docs/saui/components.md`](../../../apps/mobile/docs/saui/components.md) | SaUI 组件库文档 |
| [`docs/kuikly-dsl-gotchas.md`](../../../apps/mobile/docs/kuikly-dsl-gotchas.md)、[`docs/kuikly-official-api-index.md`](../../../apps/mobile/docs/kuikly-official-api-index.md) | Kuikly DSL 陷阱与 API 索引 |

## 3. 接口与契约

| 文档 | 内容 |
|---|---|
| [interfaces/README.md](../../interfaces/README.md) | 接口面速查（daemon 远程面、HTTP JSON-RPC/SSE） |
| [plans/remote-capability-contract.json](../../plans/remote-capability-contract.json) | 远程方法契约（权限/资源键/幂等/scope） |
| [integration/README.md](../../integration/README.md) | 对接状态总览（远程/移动） |
| [plans/sacode-daemon-contract-review-2026-10-08.md](../../plans/sacode-daemon-contract-review-2026-10-08.md) | daemon 复核与接线门禁 |

## 4. 相关设计稿

[plans/2026-10-23-mobile-pairing-relay-ssh-design.md](2026-10-23-mobile-pairing-relay-ssh-design.md)（配对/Relay/SSH 设计）、[superpowers/specs/2026-10-10-unified-remote-mobile-design.md](2026-10-10-unified-remote-mobile-design.md) + [superpowers/plans/2026-10-10-unified-remote-mobile.md](2026-10-10-unified-remote-mobile.md)（统一远程/移动设计）、[plans/remote-capability-contract.json](../../plans/remote-capability-contract.json)。

## 5. 证据（按主题）

### 5.1 工程归并与入口纠偏
[2026-10-23-mobile-source-import.txt](2026-10-23-mobile-source-import.txt)、[2026-10-23-mobile-sacode-entry-correction.md](2026-10-23-mobile-sacode-entry-correction.md)、[2026-10-23-mobile-demo-removal.md](2026-10-23-mobile-demo-removal.md)。

### 5.2 界面与渲染（M03）
[2026-10-23-kuikly-ai-reference-adoption.txt](2026-10-23-kuikly-ai-reference-adoption.txt)、[2026-10-23-mobile-markdown-streaming-verification.md](2026-10-23-mobile-markdown-streaming-verification.md)。

### 5.3 任务与路由（M04）
[2026-10-23-mobile-m04a-routing-task-init.md](2026-10-23-mobile-m04a-routing-task-init.md)。

### 5.4 远程 / daemon 后端与安全（移动依赖，非本端独有）
[2026-10-10-remote-platform-baseline.md](../../evidence/2026-10-10-remote-platform-baseline.md)、[2026-10-10-management-rpc-surface.md](../../evidence/2026-10-10-management-rpc-surface.md)、[2026-10-10-host-allowlist-dns-rebinding.md](../../evidence/2026-10-10-host-allowlist-dns-rebinding.md)、[2026-10-10-protocol-schema-freeze.md](../../evidence/2026-10-10-protocol-schema-freeze.md)、[2026-10-10-audit-redaction-vs-discard.md](../../evidence/2026-10-10-audit-redaction-vs-discard.md)、[2026-10-10-service-install-verification.md](../../evidence/2026-10-10-service-install-verification.md)、[2026-10-11-windows-tls-anchor-audit.md](../../evidence/2026-10-11-windows-tls-anchor-audit.md)、[2026-10-24-p0-cross-end-gates.md](../../evidence/2026-10-24-p0-cross-end-gates.md)（`--manage grant-scope` scope 授予）。

## 6. 通用（四端共享，不逐端重复）

[core/](../../../core/)（含 `remote_identity`/`remote_authorization`）、[apps/daemon/](../../../apps/daemon/)（HTTP RPC/SSE/认证/幂等）；接口面见 [interfaces/README.md](../../interfaces/README.md)，对接状态见 [integration/README.md](../../integration/README.md)。

## 7. 维护规则

- 端内新增/变更文档时，同批在本页对应主题下补引用；手机局部记录不得替代根台账。
- 状态以各原文档为准；本页不升级 M01–M05 状态。