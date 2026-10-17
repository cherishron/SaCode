# 关于页版本读数接入（2026-10-17）

**结论**：用户指认设置 → 关于页只写「当前版本信息暂不可用，更新检查尚未开放。」——版本号等信息应当展示。已新增一条只读通道 `sacode:appVersion`（只取壳层事实），关于页照实列出**应用版本 / 平台与运行形态 / Electron · Chromium · Node**；更新检查确实未开放，界面仍如实写「更新检查尚未开放」，不给假按钮、不提示未核实的更新。

## 1. 变更

| 文件 | 改动 |
|---|---|
| `apps/desktop/main.cjs` | 新增 `ipcMain.handle("sacode:appVersion")`：返回 `app.getVersion()`、`process.versions.electron/chrome/node`、`platform`、`arch`、`app.isPackaged`（不碰宿主、不需要起轮） |
| `apps/desktop/preload.cjs` | 新增顶层 key `appVersion`（只读、无参数） |
| `apps/desktop/renderer/settings-state.js` | 新增 `checkedVersion`（形状校验）+ `refreshAboutVersion`（失败回落到 null）；关于页渲染版本行：有读数 → 版本行 + 运行时行；无读数 → 「版本信息正在读取…」，两种情况都保留「更新检查尚未开放」 |
| `apps/desktop/renderer/app.js` | 新增 `aboutVersion` ref（与其他 ref 一样在装配方创建、随 deps 传入），启动时 `void refreshAboutVersion()` |
| `apps/desktop/test/bridge.test.mjs` | 通道白名单加入 `appVersion`，两处计数 138 → 139 |
| `apps/desktop/test/settings-state.test.mjs` | 新增 2 条：关于页照实列版本并禁「暂不可用」；无读数只写「正在读取」且不伪造数字 |
| `apps/desktop/test-support/ui-smoke.cjs` | `PRELOAD_API` 登记 `appVersion`；补齐此前滞后未登记的 22 个已存在通道；新增关于页版本读数断言 |
| 文档 | `docs/interfaces/README.md`（IPC 顶层 key 138→139）、`docs/product/PRD-tracking.md`（F20/D16/分母行同步） |

## 2. 读数

- **`node --test test/bridge.test.mjs`（preload/主进程面）**：`预加载` 相关 5 条 **5/5 通过**（白名单整串比对 + 主进程 handler 集合一一对应）。
- **IPC 面门禁**：`node scripts/check_ipc_surface_parity.cjs` → **GATE: PASS（8 checks, fail=0）**，分母 `preload 139 ↔ main 139，双向差集为空`。
- **`node --test test/settings-state.test.mjs`：12/12 通过**（含本轮新增 2 条关于页断言）。
- 一次性对照脚本 `target/tmp/about-version-20261017/preload-diff.cjs` 实测：preload 实际 139 键 ≈ bridge 白名单 139 键，差集双向为空；ui-smoke 原清单滞后 22 键（已补齐）。

## 3. 过程中的两点记录

1. **ref 由装配方持有**：初版把 `aboutVersion = ref(null)` 写在 `settings-state.js` 装配内部，导致 `settings-state.test.mjs` 8 条当场红（`ref is not a function`——该测试 `deps` 不提供 `ref`）。改为与 `profile`/`generalPrefs` 同一套做法（app.js 创建、deps 传入）后 12/12 全绿。这条已写入项目长期记忆。
2. **UI 冒烟本轮未能跑到关于页**：同步到中性壳后 `--ui-smoke` 在开头即失败（`Vue 挂载后气泡组数=0`、`插件管理页未就绪`），而同一配方下 01:00 状态的基线副本仍为 293 OK/5 FAIL——说明环境稳定、失败来自**工作区并发未提交改动的当前状态**（插件页区域），与本改动无关。关于页断言改由 Node 层 `settings-state.test.mjs` 钉住；ui-smoke 里新增的断言待工作区状态恢复后再验。

## 4. 边界

- 版本信息只含壳层事实；宿主/核心版本、构建号、更新通道均未纳入（没有对应真实数据源，不编造）。
- 生效路径：改动在仓库源码（未提交）；用户当前运行实例（`D:\tmp\SaCode-latest`，10-16 构建）不含此改动，需下一轮构建/中性导出后可见。
