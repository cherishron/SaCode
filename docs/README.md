# SaCode 文档导航与治理（2026-10-13 口径更新）

> 本索引维护当前产品与平台文档的阅读顺序，后文数量是 2026-10-09 整理快照，不是当前文件总数。
> 整理原则：**需求以现行 PRD 为准，平台与分发以专项要求为准，状态绑定提交、入口、平台和实际证据**。

---

## 0. 治理原则（先读，再翻任何文档）

1. **需求权威**：[`product/PRD.md`](product/PRD.md) 定义 F01–F21 和授权/任务验收；[`product/platform-and-distribution.md`](product/platform-and-distribution.md) 细化平台、安装渠道与 GitHub 构建。旧 DSH 复刻范围、模块数量不覆盖现行定位，不计算整体完成率。
2. **证据保全**：[`evidence/`](evidence/) 与 [`qa/`](qa/) 是带日期与基线的取证。新结果用新记录或明确的后续补记，不覆盖旧失败、不把旧通过升级成当前通过。PRD 的 2026-10-09 表也是历史快照，不称为实时进度真源。
3. **设计区**：[`plans/`](plans/) 与 [`superpowers/`](superpowers/) 中的草案和阶段“未实现”标签描述当时设计，需核当前源码，不能直接当作今天不存在的证明。下文分类数量与清单为旧导航，不宣称已穷举。
4. **状态粒度**：分别登记源码/入口接线、固定提交构建、默认启动、真实任务、安装态和发布，按平台/架构记录。无法确认的进度写待核；工作区新增或删除不自动属于提交基线。

### 最新已登记的平台读数与当前主线

- 用户提供 Linux `2c56c76`：core、CLI、daemon 构建通过，CLI 约 14 MB；Host 未编，桌面/服务真实任务与安装尚未验收。依赖设置见 [`build-linux.md`](build-linux.md)。
- Windows 当前版入口、ACP/LSP 与安装后任务由 codex 交付线收口；历史 P0 或测试数不代替其验收。
- Windows/Linux/macOS 的 CLI/服务/Electron 桌面为目标；鸿蒙 CLI 保留，后续独立 ArkTS/ArkUI 前端。macOS/鸿蒙无设备不撤销目标，运行状态仍待验。
- 旧导航将 `cmds.cj` 语法错误写成当前阻断，并宣称此前 `scripts/setup-stdx.mjs` 已解耦，属于过期结论：`2c56c76` 当时没有该脚本且 Windows 仍是本机绝对路径。2026-10-14 本批才新增 provisioning 与相对路径；不能把当前修复反写成旧时已完成。

---

## 1. 当前产品状态（活跃文档）

| 文档 | 角色 | 备注 |
|---|---|---|
| [`product/PRD.md`](product/PRD.md) | 现行产品需求与验收 | v1.2 平台决策；旧进度表按日期保留，不是实时状态 |
| [`product/platform-and-distribution.md`](product/platform-and-distribution.md) | 平台支持、npm 分发、GitHub 构建与证据边界 | 2026-10-13 用户决策；支持目标与已验证状态分开 |
| [`build-linux.md`](build-linux.md) | Linux 依赖与构建读数 | 补 `2c56c76` 三成员构建通过，桌面与真实任务待验 |
| [`build-platforms.md`](build-platforms.md) | 本批平台代码、npm/桌面/CI 与 OHOS 交叉入口 | 2026-10-14；本机 Windows 回归与目标环境复验分开 |
| [`testing.md`](testing.md) | 测试源码、功能分类、夹具与临时产物的现行规则 | 测试资产可入库；迁移进度见 [`整理台账`](plans/test-layout-2026-10-15.md)，不等于全部迁移完成 |
| [`product/desktop-design-standard.md`](product/desktop-design-standard.md) | 桌面布局与品牌规范 | 设计标准，引用旧基线（2026-10-03），需结合 PRD 复核 |

## 2. 设计 / 契约 / 实施计划（可能过期，以 PRD 复核）

### 2.1 `plans/`（15 篇，已补进度对账横幅）
- `dsh-capability-matrix.md` — 63 子系统能力矩阵（**冻结快照，≠现完成率**，见顶部横幅）
- `sacode-execution-contract-2026-10-07.md` — 执行与构建测试增量契约
- `sacode-product-interfaces-2026-10-07.md` — 自主产品接口与状态设计
- `sacode-product-traceability-2026-10-07.md` — 需求追踪与第一批责任表（F01–F20）
- `goal-claim-tool-interface-2026-10-07.md` — 完成证据声明侧接口变更单
- `sacode-daemon-contract-review-2026-10-08.md` — 本地守护进程简报复核与接线门禁
- `sacode-sidebar-session-brief-2026-10-08.md` — 侧边会话历史开发简报
- `dsh-frontend-acceptance.md` — 冻结 DSH 前端与交互验收清单
- `sacode-workbench-visual-direction-2026-10-07.md` — 工作台视觉修订
- `lsp-l1-entry-wiring-2026-10-07.md` — L1 LSP 语义工具契约与入口接线登记
- `verb-wiring-checklist-2026-10-04.md` — 51 行 ◐ verb 接入清单
- `w00-path-ownership-and-isolation-2026-10-06.md` — 路径所有权表与隔离
- `w10-persistence-barrier-recovery-contract-2026-10-06.md` — 持久化屏障与恢复契约
- `plan-deepseek-harness-replication.md` — DeepSeek Harness 全系统复刻总体方案（v0.2 草案）
- `plan-qwen-batch-replication.md` — Qwen Code Batch API 复刻方案（v0.1 草案）

### 2.2 `superpowers/`（22 篇，均为设计/计划，标注「未实现/待实现」）
- **plans（13）**：approval-modes、automation-scheduled-tasks、compaction-pipeline、goal-execution-improvements、hooks-lifecycle-implementation、slash-command-system（均 2026-10-09）；browser-use-core-foundation、session-worktree（2026-10-08）；conversation-surface-tinyrobot、next-sdk-page-tools（2026-10-03）；model-center-b1-catalog、model-center-b2-scheduling（2026-10-05）；w30-d-host-routing-seam（2026-10-06）
- **specs（8）**：approval-modes-design、hooks-lifecycle-design、slash-command-system-design（2026-10-09）；browser-use-design（2026-10-08）；conversation-surface-tinyrobot-design、next-sdk-page-tools-design（2026-10-03）；model-center-catalog-13-providers、model-center-design（2026-10-05）
- **sdd（1）**：`sdd/2026-10-09-hooks-lifecycle/progress.md` — Hooks 生命周期 SDD 台账（任务 1/4/5/6/7/8/9/10 已完成；任务 2/3 受 cmds.cj 语法错误阻塞，见 §0.4）

## 3. 历史证据（冻结，勿改）

`evidence/` 130 篇按主题分组（完整文件见目录，文件名含日期戳）：

- **桌面 / Electron（12）**：desktop-backend-wiring、desktop-electron-blocker、desktop-host-bridge-recovery、desktop-model-approval-consumption、desktop-rebuild-queue、desktop-stdio、desktop-structure、official-desktop-baseline、sacode-desktop-layout、sacode-desktop-release、latest-desktop-package、npm-publish-and-nsis-resync-standalone
- **执行引擎 / Windows 隔离（19）**：execution-*（admission-recovery / desktop-admission / dual-entry-recheck / live-output / output-persistence / sandbox-proposal / shared-freeze / start-window / supervisor-real-process）与 windows-*（appcontainer-admission / async-execution-admission / closure-baseline / current-source-build / desktop-runtime-recheck / execution-native-payload / isolated-broker-adapter / low-integrity-delivery-fix / native-job-supervision / unified-core-dual-entry）
- **目标系统（8）**：goal-checkpoint-freeze、goal-claim-tool、goal-control、goal-file-approval-dual-entry、goal-product-async-entry、goal-revision-boundary、goal-scheduler-core、goal-upstream-contract
- **模型中心（10）**：model-center-b0/b3-ledger/b4-accel/b5-migration/replacement、model-image-capability、model-select、model-tool-runtime、models-page、handoff-model-provider
- **插件 / 设置（14）**：plugin-configuration、-everything-a12-audit、-inventory-lifecycle、-lifetime-architecture、-manager、-manager-backend-gap、-manager-contract、plugins-page、general-settings-busy-send、global-appearance-store、subagent-settings、settings-shell-layout、prompt-enhance（-closeout）、local-plugins-scope
- **ACP / 协议探针（3）**：acp-frame-probe-all-products、acp-frame-probe-opencode、acp-handoff-recheck
- **上游对比（8）**：dsh-upstream-delta-analysis、-fix-inline-editor、-freeze；frontend-gap-audit、-live-comparison、-official-comparison；dsh-ui-style-audit；sacode-naming-regression
- **审查 / 验收（14）**：h70-codex-review、-computer-failclosed、-external-drivers；lsp-l1-codex-review、-focused-recheck、-reclose；r0-review-closeout；review-fixes；verification-run、-runbook；sacode-phase1-3-independent-review、-phase123-stable-snapshot；qwen-code-review-gap、-hooks-vs-sacode-hooks
- **其余杂项（42）**：attachment-durable-seam、backend-gap-audit、-plugin-contract、build-and-real-model、client-slots、code-toolbar-layout、composer-attachments/-controls-layout/-keymap、context-meter、core-repair-and-enhance-deadline、current-state、dual-entry-repro-manifest、filesystem-review-fixes、history-attachment、https-sse-spike、main-tree-repair、markdown-highlight-layout、package-payload-audit、persisted-image、p0-dsh-baseline、-interface-freeze、-ownership-gate、-status、real-fs-ops-unified-pipeline、real-model-tool-loop、request-trace-core、sacode-prototype-ui-qa、sacode-workbench-resources、session-worktree、sse-cancel-latency、todo-backend、-panel、tooltip-layout、upstream-module-reads、queue-dock、-inbox-steer、-reference-scroll、w30-host-routing

## 4. 历史验收（冻结，勿改）

`qa/` 4 篇：inline-editor-batch-recheck-2026-10-06、step1-integration-acceptance-observations-2026-10-06、upstream-delta-recheck-and-u03-baseline-2026-10-06、w10-contract-independent-review-2026-10-06。

---

## 5. 本次整理改动清单（2026-10-09）
- 新建本索引 `docs/README.md`。
- `product/PRD.md`：补 2026-10-09 进度对账节、F01–F21、基线 `1b73608`、F02/F10/F13 状态修正（前轮已完成）。
- `plans/dsh-capability-matrix.md`：顶部加「冻结快照 ≠ 现完成率」横幅（前轮已完成）。
- `plans/` 其余 14 篇 + `product/desktop-design-standard.md`：补「进度对账（2026-10-09）」横幅，指向 PRD。
- `superpowers/` 22 篇：补「状态：设计/计划，未实现」标签，指向 PRD P1/P2。
- `superpowers/sdd/2026-10-09-hooks-lifecycle/progress.md`：补阻断说明（stdx 已解耦；cmds.cj 语法错误仍阻塞）。
- `evidence/`、`qa/`：保持冻结，仅在本索引统一归档，不改动内容。
