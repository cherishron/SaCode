# 桌面端「降级」审计（2026-10-24）

用户要求：AI 方案走不通时常倾向「降级而不是解决问题」；若方案走得通就不要降级。本批对 `apps/desktop` 逐面核查，区分**真降级（可修）**、**后端未实现的如实标注（不可靠桌面端「修掉」）**与**合理兜底**，并只对真降级动手。**未提交、未打包、未安装；纯渲染层，IPC 面不变。**

## 一、判定标准

- **真降级**：后端/通道本已具备真实能力（`core`＋`Host`＋桌面通道任一环已走通），桌面端却不接、以桩/假值/默认值/静默吞错代替 → 应修。
- **后端未实现**：整条链（含 `core`/`Host`）确无该能力，桌面端如实标注「未接通/未实现」→ **不是桌面端降级**；在桌面端硬造入口/数据即等于**伪造**，违背「不要降级」原则。
- **合理兜底**：资源清理失败静默、WebView 兼容降级、fail-loud 报错 → 不动。

## 二、核查结论（A 类为真降级候选）

| 编号 | 位置 | 判定 | 依据 |
|---|---|---|---|
| A1 | `renderer/pages/automation-page.ts` | **后端未实现（非降级）** | `apps/host/src/automation_exec_rpc.cj` 的 `install()`（任务定义→执行器装配）**全仓无调用方**；`automation_rpc.cj` 的 list 只读 `AutomationStore`；`automation/tick` 必然返回空。台账 `F13` 明载「执行器未实现（D07，`executorAvailable=false`）」。桌面端「未接通/不能手动触发」为**如实**。 |
| A2 | `renderer/pages/model-center-adapter.ts:163-164` | **后端未实现（非降级）** | `core/src/accel_relay.cj` 的 `PROBE_MINIMAL_MODE` 仅被 `accel_relay_test.cj` 引用，**无产品代码发起探测请求**；relay「本地字节」计费亦未落地。两列恒 `null` 为如实。 |
| A3 | `plugins-ipc.cjs:41,52` | **后端未实现（非降级）** | `docs/evidence/2026-10-11-windows-tls-anchor-audit.md:774`、`2026-10-11-plugin-gap-disposition-batchF.md`：Host `capabilities` 无 `plugin/install/cancel`，`plugin/install/start` 为**假异步**、「没有在途窗口可取消」。硬修=伪造取消。 |
| A4 | `renderer/pages/plugin-manager-adapter.ts:316-319` | **真降级（已修）** | 安装源读取失败被 `catch {}` 静默吞掉、退化成「默认安装源」，不告知、不可重试。 |
| A5 | `renderer/pages/migration.ts:79-83` | **真降级（已修）** | `copyExport` 的 `catch {}` 无任何反馈，与同项目 `tool-card.ts:53-70`/`app.js`「两条路都失败时给可见反馈」不一致。 |

D 类（过时/误导文案）核查：

- `renderer/pages/model-center-adapter.ts:155`「等接口变更单 §6 接线后本列自动点亮」——`ledgerStats` 通道其实已存在（`preload.cjs:231`、Host `main.cj:2643`）→ **已修**（去除暗示整体未接的表述）。
- `renderer/side-panels.js:81,161`「当前轮次使用示例输出，真实模型任务尚未开放」——被 `test-support/ui-smoke.cjs:454` 断言维护，属**产品状态声明**，未取得产品确认前**不改**（改动会一并改冒烟断言，越权）。
- `renderer/pages/terminal-interactive.ts:1-10` 顶部注释「通道未接通/后续接线」——台账同日条目显示终端已接线、`pack-xterm` 已入 `npm run vendor`，注释**可能已过时**；但该文件被另一在飞会话密集改动，本批**不触碰**以免冲突，留待其归属会话清理。
- `apps/host/src/automation_exec_rpc.cj:10` 注释「main.cj 尚未分派」——`main.cj:1337` 已分派，注释**确已过时**；属**共享 Host 资产**（另见 `browser_rpc.cj:10` 同类），按 AGENTS「改共享文件前先协调归属」，本批**不改**，仅登记。

## 三、已修内容与验证读数

1. **A4**（`plugin-manager-adapter.ts`）：`readRegistries` 的 `catch` 改为**明确失败态**——显式填充默认源并置 `notice`「安装源清单读取失败（…）；当前仅显示默认安装源，可返回重试。」仍**不伪造源列表**。
2. **A5**（`migration.ts`）：`copyExport` 改为 `navigator.clipboard` ＋ 临时 `textarea`/`execCommand` 双通道（与 `tool-card.ts` 同构，`finally` 移除节点），全失败时置 `error.value='复制失败，请手动选择导出内容后复制。'`。
3. **D3**（`model-center-adapter.ts:155`）：账本读取失败提示不再暗示后端未接，改为「本次未取到宿主账本统计（ledger/stats）；读取失败或通道暂不可用，重试后本列会自动显示。」

验证（`apps/desktop`，Windows）：

- `node --test test/plugin-manager-adapter.test.mjs test/model-center.test.mjs test/plugin-manager-wiring.test.mjs` → **37 pass / 0 fail / 0 skipped**（含 `migration.ts`、`model-center-adapter.ts` 折叠产物用例）。
- `node --test test/renderer-syntax.test.mjs test/renderer-bundle-guard.test.mjs test/page-sources-parse.test.mjs test/renderer-el-shape.test.mjs test/worktree-render.test.mjs` → **13 pass / 0 fail / 0 skipped**。
- `node scripts/check_ipc_surface_parity.cjs` → **GATE PASS**（preload 212 ↔ main 212，双向差集为空；本批未改 `preload.cjs`/`main.cjs`）。

合计 **50/50 通过，rc=0，无跳过/取消**。

## 四、边界

- 仅改桌面渲染层三处；**未动** core/Host 逻辑、IPC 面、打包与候选快照。
- A1/A2/A3 属后端未实现（分别对应 F13/D07、model-center B2/B4、plugin-gap），**不在桌面端硬修**；其登记见 `docs/product/PRD-tracking.md`。
- 未取得产品确认前不改 `side-panels.js` 的产品状态声明；`terminal-interactive.ts` 注释与 `automation_exec_rpc.cj` 注释的清理归属其现有会话。
- 未提交、推送、安装或发布。