# qa/ — 测试与验收（索引）

> 类别：⑤测试文档（含**冻结的验收快照**与**可复用校验工具**两类，注意区分）。
> 上级索引：[docs/README.md](../README.md)｜测试规则本体在 [`../testing.md`](../testing.md)

## 1. 冻结的验收观察（4 篇 · 勿改）

| 文件 | 内容 |
|---|---|
| [`inline-editor-batch-recheck-2026-10-06.md`](inline-editor-batch-recheck-2026-10-06.md) | 内联编辑器批复验 |
| [`step1-integration-acceptance-observations-2026-10-06.md`](step1-integration-acceptance-observations-2026-10-06.md) | 步骤 1 集成验收观察 |
| [`upstream-delta-recheck-and-u03-baseline-2026-10-06.md`](upstream-delta-recheck-and-u03-baseline-2026-10-06.md) | 上游差异复检与 U03 基线 |
| [`w10-contract-independent-review-2026-10-06.md`](w10-contract-independent-review-2026-10-06.md) | W10 契约独立复核 |

规则：带日期快照，**只增不改**；新结论用新文件或明确补记，不覆盖旧读数。

## 2. 可复用校验工具（源码 · 随代码演进）

| 工具 | 用途 | 用法与约定 |
|---|---|---|
| [`check-inflight-ownership.cjs`](check-inflight-ownership.cjs) | "当前改动集成验收"门禁：在飞/暂存路径 ↔ 归属表 ↔ 临时输出 | `node docs/qa/check-inflight-ownership.cjs [repoRoot] [--selftest]`；判据行 `GATE:`；rc 0=PASS／1=FAIL／2=取不到输入／3=自检壳错误 |
| [`check-matrix-evidence.cjs`](check-matrix-evidence.cjs) | 只读审计：能力矩阵中 ✔/◐ 行的备注是否落到可复跑证据 | `node docs/qa/check-matrix-evidence.cjs [repoRoot] [--selftest] [docPath]`；`GATE:` 同上 |
| [`acp-normal-context-check.cjs`](acp-normal-context-check.cjs) | 固定候选的手工验收客户端（复用真实 HostBridge；不提供任务/修复/登录/安装入口） | 手工运行 |
| [`wiring-inventory.mjs`](wiring-inventory.mjs) | 只读接线库存清单 | 文本引用仅为定位线索，**不能作运行闭环通过判据** |

> 工具放在 `docs/qa/` 而非 `scripts/`：路径所有权表（`plans/w00-…` §1）将 `scripts/` 整目录划给固定责任人，避免双主。

## 3. 关联规则

- 测试源码分类、夹具、临时产物（`target/tmp/`）规则：见 [`../testing.md`](../testing.md)；
- 测试目录迁移进度：见 [`../plans/test-layout-2026-10-15.md`](../plans/test-layout-2026-10-15.md)；
- 运行级取证读数：见 [`../evidence/`](../evidence/)（冻结区）；
- 新增验收观察：命名 `<主题>-<日期>.md` 放本目录，并在本索引登记。
