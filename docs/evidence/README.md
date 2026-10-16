# evidence/ — 历史证据（冻结区 · 索引）

> 类别：⑦历史证据。**本目录是冻结区：只增不改**——新结果用新记录，不覆盖旧失败、不把旧通过升级成当前通过。
> 上级索引：[docs/README.md](../README.md)｜验收观察在 [`../qa/`](../qa/)

## 0. 规则

1. **命名**：旧式 `<主题>-<日期>.md`；新式 `2026-10-XX-<主题>.md`。日期 = 取证日，不是文件创建日；
2. **更新**：发现结论过期时，**新建**补记文件或在同主题新文件里引用旧文件；原文不动（本目录被大量文档交叉引用，改写会伪造历史）；
3. **结论去向**：需要长期引用的结论写进 `../product/`、`../plans/` 或 `../qa/`；本目录保留原始读数与过程；
4. 当前状态**永远不看本目录单独判定**——核 PRD 与该主题最新文件，必要时看 `docs/README.md` 登记的当前口径。

## 1. 按主题检索（检索关键词 → 代表文件）

| 主题 | 检索关键词 / 前缀 | 代表性文件（完整清单按目录） | 时间跨度 |
|---|---|---|---|
| Windows 原生所有权进程 | `windows-owned-process-provider` | [2026-10-17-windows-owned-process-provider](2026-10-17-windows-owned-process-provider.md)：AppContainer/管道/Job 原生薄层 35 项实测；仓颉适配与产品装配未完成 | 10-17 |
| AppContainer 当前身份验证 | `appcontainer-minimal-environment` | [2026-10-17-appcontainer-minimal-environment](2026-10-17-appcontainer-minimal-environment.md)：原生 error 203 环境对照，仓颉真实身份 5/5；产品执行后端仍未开放 | 10-17 |
| 桌面壳 · Electron · 打包分发 | `desktop-*`、`sacode-desktop-*`、`npm-publish*`、`package-*`、`renderer-decoupling*`、`latest-desktop-package*` | desktop-electron-blocker、official-desktop-baseline、2026-10-11-package-and-packed-verification-batchE | 10-03～10-15 |
| 界面 · 交互 · 布局 | `composer-*`、`queue-*`、`todo-*`、`*-layout*`、`*appearance*`、`model-select`、`models-page`、`client-slots*`、`role-label*`、`about-version*`、`default-permission*`、`autolaunch*` | sacode-desktop-layout、code-toolbar-layout、context-meter、2026-10-12-*（goal-bar/permission-menu/settings-workbench）、2026-10-17-role-label-removal（组标签移除＋中性壳冒烟配方）、2026-10-17-about-version-panel（关于页版本读数）、2026-10-17-default-permission-and-autolaunch（新会话默认权限＋开机自启） | 10-03～10-17 |
| 执行引擎 · Windows 隔离 · 安全 | `execution-*`、`windows-*`、`appcontainer-*`、`real-fs-ops*`、`h70-*` | execution-supervisor-real-process、windows-native-job-supervision、2026-10-16-gate-triad-repair、2026-10-16-windows-startup-three-issues-diagnosis（三问题排查：0x80000003/DLL/NSIS）、2026-10-17-cli-launch-0xc0000135-stdx-dll-missing（CLI 启动 0xC0000135 = stdx DLL 路径缺失；夹具孤儿化根因 + AGENTS.md 运行期 DLL 路径约定固化）、2026-10-17-cjpm-build-cj-stage-post-build-hook（cjpm build.cj stagePostBuild hook 全流程打通；解决 issue #725；干净目录验证 90+ 个 DLL 全复制成功；仓内落地受阻根因＝仓库根 ACL 被 Codex 沙箱化） | 10-06～10-17 |
| 目标系统（F04） | `goal-*`、`2026-10-15-p1-cancel-budget-fix` | goal-checkpoint-freeze、goal-claim-tool、goal-product-async-entry | 10-05～10-15 |
| 模型中心 · 提供方 | `model-*`、`handoff-model-provider*`、`*-submit-boundary*`、`*-acp-provider*` | model-center-b0/b3/b4/b5、model-tool-runtime、2026-10-13-model-edit-submit-boundary、[2026-10-17-model-center-call-log](2026-10-17-model-center-call-log.md)（模型调用日志：全局聚合回放各会话 requestTraceProjection，tab 落在供应商之后） | 10-04～10-17 |
| 插件与扩展 | `plugin-*`、`local-plugins-scope*`、`2026-10-1?-plugin-*` | plugin-manager-contract、plugin-lifetime-architecture、2026-10-11-plugin-gap-disposition-batchF | 10-04～10-12 |
| ACP · LSP · 委派 | `acp-*`、`lsp-l1-*`、`codebuddy-acp*` | acp-frame-probe-all-products、lsp-l1-reclose、2026-10-15-codebuddy-acp-stage2 | 10-07～10-15 |
| 远程 · daemon · 平台构建 | `2026-10-10-*`、`*-linux-*`、`*-core-*`、`session-persistence-*` | 2026-10-10-remote-product-acceptance、2026-10-10-protocol-schema-freeze、2026-10-13-linux-executable-build-followup | 10-10～10-16 |
| 上游对比 · 冻结基线 | `dsh-upstream-*`、`upstream-*`、`frontend-*-comparison*`、`p0-*` | dsh-upstream-freeze、upstream-ledger-2026-10-04.json、p0-interface-freeze | 10-02～10-07 |
| 审查 · 验收 · 复盘 | `*review*`、`*recheck*`、`verification-*`、`r0-*`、`qwen-*` | r0-review-closeout、sacode-phase123-stable-snapshot、2026-10-13-full-wiring-audit、2026-10-11-prd-p1-gap-recheck | 10-03～10-16 |
| 会话 · 工作区 · 引用 · 其他 | `session-*`、`attachment-*`、`request-trace*`、`w30-*`、`https-sse-*` | session-worktree、attachment-durable-seam、request-trace-core | 10-03～10-13 |
| 数据文件（8 个 · 非 md） | `.json` / `.txt` | 2026-10-13-full-wiring-audit-hashes.json、client-slots-artifacts-2026-10-05.json、dsh-upstream-delta-commits/-files.json、upstream-ledger-2026-10-04.json、ledger.json、lsp-l1-baseline-hashes.txt、lsp-l1-workspace-hashes.txt | 10-04～10-13 |

> 建议检索顺序：先按上表定位主题与时段，再看该时段内最新文件；目录本身按文件名排序即近似时间线。

## 2. 遗留说明

- [`MEMORY.md`](MEMORY.md) 为早期遗留的单行索引文件（仅 1 条记录），**保留不删**；完整导航以本 README 为准。
- 本目录文件数量会持续增长（约 177 篇 md + 8 个数据文件，截至 2026-10-16）；增量文档按 §0 命名规则直接落此，并在上方主题表补充新关键词（若属于全新主题）。
