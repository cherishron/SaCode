# CLI 端 · 相关文档索引

> 类别：**⑪ 端文档（归类索引）**｜上级：[clients/README.md](../README.md)｜本端规格：[README.md](README.md)。
> 本端**专属文档已物理归入本端目录**（本页即该目录 `documents.md`）；通用/后端文档仍在其原目录。本页按主题列出引用。
> 穷尽清单见 [evidence/README.md](../../evidence/README.md)、[plans/README.md](../../plans/README.md)。

## 1. 产品与分发

| 文档 | 内容 |
|---|---|
| [product/PRD.md](../../product/PRD.md) | §1 用户表（CLI 开发者）；近期交付顺序 |
| [product/platform-and-distribution.md](../../product/platform-and-distribution.md) | §5.1 CLI 安装（npm 薄启动包 / release 压缩包）；§2 平台矩阵（含鸿蒙 CLI） |
| [build-platforms.md](../../build-platforms.md) | 多平台构建步骤 |
| [product/PRD-tracking.md](../../product/PRD-tracking.md) | 跟进台账 |

## 2. 本端设计规范与源码

| 文档 | 内容 |
|---|---|
| [`tui/DESIGN.md`](../../../apps/cli/tui/DESIGN.md) | TUI 设计规范（终端适配原则、布局层级、紧凑窗口、业务边界） |
| [`tui/README.md`](../../../apps/cli/tui/README.md) | TUI 说明 |
| [apps/cli/](../../../apps/cli/) | 仓颉 CLI 动词源码（`src/main.cj` 等） |
| [npm/sacode-cli](../../../npm/sacode-cli) | npm 主包（`bin/cli.js`、`bin/daemon.js` 入库源码） |
| `scripts/pack-cli.mjs`、`scripts/pack-tui.mjs` | CLI / TUI 打包脚本 |

## 3. 接口与契约

| 文档 | 内容 |
|---|---|
| [interfaces/README.md](../../interfaces/README.md) | 接口面速查（CLI 用户命令面、Host stdio、远程面） |
| [integration/README.md](../../integration/README.md) | 对接状态总览 |
| [plans/verb-wiring-checklist-2026-10-04.md](../../plans/verb-wiring-checklist-2026-10-04.md) | CLI 命令接入清单（状态已过期，勿当现状） |
| [plans/remote-capability-contract.json](../../plans/remote-capability-contract.json) | 远程方法契约（CLI `--remote` 消费） |
| [plans/2026-10-12-knowledge-management-contract.md](../../plans/2026-10-12-knowledge-management-contract.md) | 知识库管理契约 |
| [plans/sacode-product-interfaces-2026-10-07.md](../../plans/sacode-product-interfaces-2026-10-07.md) | 固定错误原因（含租约/幂等） |

## 4. 相关设计稿

[superpowers/specs/2026-10-09-slash-command-system-design.md](../../superpowers/specs/2026-10-09-slash-command-system-design.md)（斜杠命令，桌面/CLI 共享）、[superpowers/specs/2026-10-10-unified-remote-mobile-design.md](../mobile/2026-10-10-unified-remote-mobile-design.md)（统一远程，CLI 远程入口参照）、功能域设计（CLI 消费同一后端）：[知识库索引](../../plans/2026-10-20-knowledge-index-design.md)、[数据导入](../../plans/2026-10-20-data-import-design-opencode.md)、[Hooks/自动化](../../plans/2026-10-20-hooks-automation-design.md)、[技能清单](../../plans/skill-integration-design-2026-10-20.md)、[MCP 接入](../../plans/mcp-integration-design-2026-10-20.md)。

## 5. 证据（按主题）

### 5.1 CLI 命令面 / 构建 / 启动
[2026-10-23-cli-review-and-fixes.md](2026-10-23-cli-review-and-fixes.md)、[2026-10-17-cli-launch-0xc0000135-stdx-dll-missing.md](2026-10-17-cli-launch-0xc0000135-stdx-dll-missing.md)、[2026-10-17-cjpm-build-cj-stage-post-build-hook.md](../../evidence/2026-10-17-cjpm-build-cj-stage-post-build-hook.md)、[2026-10-22-linux-build-hook-and-single-host-daemon.md](../../evidence/2026-10-22-linux-build-hook-and-single-host-daemon.md)、[2026-10-15-startup-method-review.md](../../evidence/2026-10-15-startup-method-review.md)、[2026-10-13-full-wiring-audit.md](../../evidence/2026-10-13-full-wiring-audit.md)、[2026-10-11-execution-batch-code-review.md](../../evidence/2026-10-11-execution-batch-code-review.md)。

### 5.2 TUI（Node/Ink）
[2026-10-23-cli-tui-ink.md](2026-10-23-cli-tui-ink.md)、[2026-10-24-cli-tui-skeleton.md](2026-10-24-cli-tui-skeleton.md)、[2026-10-24-cli-tui-source-comparison.md](2026-10-24-cli-tui-source-comparison.md)、[2026-10-24-cli-tui-gemini-alignment.md](2026-10-24-cli-tui-gemini-alignment.md)、[2026-10-24-cli-tui-design.md](2026-10-24-cli-tui-design.md)、[2026-10-24-cli-tui-interaction.md](2026-10-24-cli-tui-interaction.md)、[2026-10-24-cli-tui-polish.md](2026-10-24-cli-tui-polish.md)、[2026-10-24-cli-tui-session-management.md](2026-10-24-cli-tui-session-management.md)、[2026-10-24-cli-tui-configuration-refinement.md](2026-10-24-cli-tui-configuration-refinement.md)、[2026-10-24-cli-tui-capability-views.md](2026-10-24-cli-tui-capability-views.md)、[2026-10-24-cli-tui-workspace-views.md](2026-10-24-cli-tui-workspace-views.md)、[2026-10-24-cli-tui-text-references.md](2026-10-24-cli-tui-text-references.md)、[2026-10-24-host-skill-workspace-cache-fix.md](../../evidence/2026-10-24-host-skill-workspace-cache-fix.md)。

### 5.3 远程 / 双入口 / 团队 / 目标 / 批处理（CLI 动词相关）
[2026-10-10-remote-batch-progress.md](../../evidence/2026-10-10-remote-batch-progress.md)、[2026-10-10-remote-method-anchor-audit.md](../../evidence/2026-10-10-remote-method-anchor-audit.md)、[2026-10-10-remote-method-prd-crosswalk.md](../../evidence/2026-10-10-remote-method-prd-crosswalk.md)、[2026-10-10-remote-platform-baseline.md](../../evidence/2026-10-10-remote-platform-baseline.md)、[2026-10-10-remote-product-acceptance.md](../../evidence/2026-10-10-remote-product-acceptance.md)、[dual-entry-repro-manifest-2026-10-04.md](../../evidence/dual-entry-repro-manifest-2026-10-04.md)、[execution-dual-entry-recheck-2026-10-08.md](../../evidence/execution-dual-entry-recheck-2026-10-08.md)、[session-worktree-2026-10-09.md](../../evidence/session-worktree-2026-10-09.md)、[goal-claim-tool-2026-10-07.md](../../evidence/goal-claim-tool-2026-10-07.md)、[goal-file-approval-dual-entry-2026-10-08.md](../../evidence/goal-file-approval-dual-entry-2026-10-08.md)、[goal-product-async-entry-2026-10-08.md](../../evidence/goal-product-async-entry-2026-10-08.md)。

### 5.4 知识 / 技能 / MCP / 导入 / 自动化（CLI 消费面）
[2026-10-15-knowledge-management-wiring.md](../../evidence/2026-10-15-knowledge-management-wiring.md)、[2026-10-24-host-skill-workspace-cache-fix.md](../../evidence/2026-10-24-host-skill-workspace-cache-fix.md)、[2026-10-24-automation-trigger-admission-core.md](../../evidence/2026-10-24-automation-trigger-admission-core.md)。

## 6. 通用（四端共享，不逐端重复）

[core/](../../../core/)（租约/会话/执行/授权真源）、[apps/host/](../../../apps/host/)（CLI 与 TUI 的协议宿主）；接口面见 [interfaces/README.md](../../interfaces/README.md)，对接状态见 [integration/README.md](../../integration/README.md)。

## 7. 维护规则

- 端内新增/变更文档时，同批在本页对应主题下补引用；只列链接与一句话说明。
- `main --help` 实际输出与 `all` 自测读数以原证据为准；本页不升级完成度。