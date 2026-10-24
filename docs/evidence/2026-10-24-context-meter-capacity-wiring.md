# 2026-10-24 上下文容量/用量读数接线（F06 局部）

## 起因

桌面输入框上方尾部一直显示「上下文容量 待接入」「模型容量与当前用量尚未提供」「暂未获得当前上下文用量；数据可用后会显示占用比例。」，用户指出**这个还没有接入**。本轮把容量与用量两条读数接到真实数据，不做估算、不造假百分比。

## 根因（三处串联）

1. **容量源头断在发现解析**：`core/src/model_catalog.cj` 的 `/models` 解析只取 `id`，响应里的 `context_window` 被丢弃。真实 LongCat `/models` 实测（`target/tmp/ctx-probe-20261024/models.json`，322 B）两者均报 `"context_window":1048576`，`max_output_tokens` 分别 262144 / 131072——数据一直在，只是没读。
2. **注册表没有容量可写**：拉取合并只按 id 落地（`ModelSpec(id, id, "", "", false)`），`catalogJson()` 的 `contextWindow` 恒为 `""`，因此 `tips/get` 的 `window` 恒为 0。
3. **渲染层把用量也一起丢了**：`settings-state.js` 只在读数「完整」时才保留压力，容量未知时连提供方回传的真实 `used` 也清空；`context-meter.ts` 没有读数就整块 null，用户什么都看不到。

## 改动

### core

- `model_catalog.cj`：新增 `CatalogModel{id, contextWindow}` 与 `fetchModels(...)`；容量扫描 `context_window`/`context_length`/`max_context_length`/`context_window_tokens`，接受正整数或 `128k`/`1M` 形态（k=×1000、m=×1,000,000，与 Host 既有 `tipParseCapacity` 口径一致），非法/0/缺失一律空串，上限 1e8。`fetch(...)` 保留原 id 列表语义，网络与解析拆为私有 `fetchBody`。
- `upstream_pull.cj`：`mergePulledModels(existing, models)` 只补**空**容量槽位（人工确认过的值优先），新模型带容量登记为 `provider-listed`。
- `provider_registry.cj`：`ModelSpec.withContextWindow` 仅替换该字段；`applyPulledModelEntries` 以 `sameModelCapacity` 做早退——容量补齐算一次变更，重复拉同一份清单不涨 revision，不制造冲突提示；原 `applyPulledModels` 委托为空容量入口。

### Host

- `model_pull_job.cj`：拉取改走 `fetchModels` → `applyPulledModelEntries`。`tips/get` 无需改动，`tipsWindowTokens()` 读到的 `ModelSpec.contextWindow` 从此有值。

### 渲染层

- `settings-state.js`：`acceptPressure` 只要有 `used >= 0` 就保留真实用量（容量缺失不再连带清空）。
- `context-meter.ts`：新增 `contextReading`，容量与用量**各自独立**呈现——两侧齐全才换算百分比；只有用量显示「~N · 容量未提供」；只有容量显示「容量 N · 用量未提供」；两者全无才不渲染。`contextOccupancy`（完整比例）语义未变。

## 读数（工作区未提交，Windows）

- 红先：链路测试首轮 `expected '1048576' actual ''`；渲染层首次 **19 通过 / 4 失败**。
- 修复后：`context-meter-view` + `settings-state` **23/23**，0 失败/跳过（本轮复跑确认）。
- 链路：`apps/desktop/test/tips-context-reading.test.mjs`（新增）**1/1**——假发现服务报 `context_window:1048576` → 落注册表 `1048576`（无该字段的模型仍为 `''`）→ 拉取前 `tips/get` 为 `{used:-1, window:1048576, reliable:false}` → 结算帧带 `usage.total_tokens:5` → `{used:5, percent:0, reliable:true}` → 新消息后 `used` 回到 `-1` 但容量保留。
- Host 回归（`model-pull-host`、`model-default-host`、`model-removal-host`、`tips-host`、`usage`）**20/20**。
- 私有构建：`cjpm build --target-dir target/tmp/ctx-host-build-20261024` rc=0，`main.exe` 16,097,792 B / SHA-256 `b612347c7cb3fd245326c6fc8eae8a2292a4d2b4ba12da7738b362e06700489a`；运行需前置 stdx/runtime DLL 目录。
- `node scripts/pack-pages.mjs` rc=0，`renderer/vendor/context-meter.iife.js` 11,041 B。

## 边界与未验

- **core 单测未执行**：新增 `model_catalog_test.cj`、`upstream_pull_test.cj` 用例已写入，但 HEAD 既有同名 `@Test delegateToolRegistrationApprovalResultAndCancellation`（`core/src/tool_subagent_test.cj` 与 `core/src/subagent_delegate_test.cj`）导致 `cjpm test` 无法编译，非本批引入、未改他人测试。core 改动经 Host 单成员编译通过间接验证。
- **未重打** `apps/desktop/dist/host`、Electron 候选与安装包；现有安装不含本修复。
- 现有 LongCat 注册表条目容量为空，**需再拉取一次模型目录**才会补齐；补齐前界面只会显示真实用量（「容量未提供」）。
- 未做 GUI 实机复验（按分工由 CodeArts 负责）；未发起收费模型请求（真实容量取自 `/models` 目录，用量模板来自测试夹具与既有真实闭环读数）。
- 未提交、未推送、未安装、未发布；不改变当前桌面候选身份与主阻塞，不升级 F06 全域完成。
