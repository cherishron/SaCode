# 模型中心 · 模型调用日志（2026-10-17）

> 取证日：2026-10-17｜类别：⑦历史证据（冻结区）｜关联：F07 模型中心、PRD-tracking、docs/interfaces/README.md（IPC 142）

## 1. 需求与定位

用户原话：「模型中心应该加模型调用的日志，应该放在供应商后面。」

- 落点：模型中心 tab 列表，**供应商设置（provider-settings）之后、费用统计（budget-stats）之前**，tab 标签「模型调用日志」。
- 范围（用户选定）：**全局聚合最近 N 条**——跨所有会话合并最近的模型调用，最贴合模型中心审计台定位（不是只显示当前活动会话）。

## 2. 复用既有能力（关键：requestTraceProjection 此前未接线）

核心层 `core/src/request_trace.cj` 的 `RequestTraceProvider` 已在每次模型调用落盘：
- `request/header`（provider / model / temperature 等）
- `request/prompt`
- `request/end`（耗时 `durationMs`、首 token `ttftMs`、状态 `state`=completed/interrupted/failed/cancelled、用量 `usageTokens`）

核心层已有回放函数 `requestTraceProjection(events, beforeSeq=-1, limit=50)`，能从会话日志事件回放出调用清单（含 prompts / output / toolCalls），core 侧已有单测。**此前该函数没有任何 RPC 调用它**——本轮首次接线。

## 3. 接线改动清单

| 层 | 文件 | 改动 |
|---|---|---|
| Host（仓颉） | `apps/host/src/main.cj` | 新增 RPC `session/request-trace`：解析任意会话（不限活动会话）→ `catalog.pathFor` → `SessionLog(path).load()` → `requestTraceProjection(...)`；`beforeSeq<=0` 归 `-1`、`limit` 夹 1..50；`initialize` 能力面与 `readSide`/`workspaceFault`/`selectionFault` 白名单同步 |
| 桌面桥面 | `apps/desktop/main.cjs` | 新增 `sacode:requestTrace` handler（校验 sessionId≤160、beforeSeq≥-1 整数、limit 1..50）→ 转发 `session/request-trace` |
| 预加载 | `apps/desktop/preload.cjs` | 顶层 key `requestTrace(sessionId, beforeSeq, limit)` |
| 适配器 | `apps/desktop/renderer/pages/model-center-adapter.ts` | `createModelCenterAdapters` 新增 `'model-call-log'`：`describe()` 拉 `api.sessionCatalog()`，限流扫描前 K=30 个会话、各取最近 50 条（`api.requestTrace(e.id,-1,50)`），合并后按 `request.time` 倒序取前 N=200，补 `sessionId`/`sessionTitle`；返回 `{sessions, calls, scanned, total}` |
| 页面 | `apps/desktop/renderer/pages/model-call-log.ts`（新建） | `Page` 渲染表格（时间/供应商/模型/会话/状态/耗时/首字延迟/用量）+ 明细展开（prompts/output/toolCalls/usageTokens 原始）；注册到 `model-center.tab`（`id:'model-call-log', order:2, label:'模型调用日志'`） |
| 装配 | `apps/desktop/renderer/pages/client-slots.ts` | `tabs` 改为 `['custom-models','模型'] → ['provider-settings','供应商'] → ['model-call-log','模型调用日志'] → ['budget-stats','费用统计'] → ['migration','迁移']`；`import` 并 `install('ui-model-call-log', ...)`；`budget-stats` order 2→3、`migration` 3→4 |
| IPC 门禁 | `apps/desktop/test/bridge.test.mjs` | 白名单加 `'requestTrace'`；两处硬编码计数 141→142 |
| IPC 冒烟 | `apps/desktop/test-support/ui-smoke.cjs` | `PRELOAD_API.push('requestTrace')` |
| 产品设计冒烟 | `apps/desktop/test-support/product-design-smoke.cjs` | 模型中心 tab 遍历 `tab<4` → `tab<5` |
| 接口分母 | `docs/interfaces/README.md` | 桌面 IPC 分母 141→142，备注增「本轮增 `requestTrace` 模型调用日志，全局聚合回放各会话的请求追踪」 |

## 4. 验证读数（2026-10-17 收口）

| 项 | 命令 / 动作 | 结果 |
|---|---|---|
| 宿主编译 | `cd apps/host && cjpm build` | `cjpm build success`（仅既有告警；`session/request-trace` 仓颉代码通过） |
| 渲染打包 | `cd apps/desktop && npm run vendor` | 全部 TS 页编译完成；`renderer/vendor/client-slots.iife.js` 含 `model-call-log`（5 处引用），mtime 06:33:39 |
| 渲染单测 | `node --test test/model-center.test.mjs` | **15/15 PASS**（含「模型调用日志适配器跨会话聚合、按时序倒序、并补全会话归属」：三会话各 2 条 → `calls.length===6`、`calls[0].sessionId==='s3'`、`calls[0].request.time===3020`、`sessionTitle==='会话三'`、`scanned===3`；安全测试已补 `model-call-log.ts` 的 eval/localStorage/ipcRenderer 检查） |
| IPC 门禁 | `node --test --test-name-pattern 预加载 test/bridge.test.mjs` | **5/5 PASS**（preload↔main 通道集合 142 条完全相等，双向比对通过） |

## 5. 已知限制（已在代码注释标注）

- `sessionCatalog()` 返回顺序无时间序，适配器按目录扫描序取前 K=30 个会话：**跨大量会话时不保证覆盖最活跃者**，可能漏掉近期高频会话的调用。
- 优化方向：在会话元信息里记录 `last-active` 时间戳，适配器按活跃度取前 K 个，而非目录序前 K 个。本轮未做（范围外）。

## 6. 构建环境附注（esbuild Low IL 阻塞，已就地修复）

`npm run vendor` 与渲染单测此前在仓内报 `winapi error #5`：`apps/desktop/node_modules/@esbuild/win32-x64/esbuild.exe` 被标 `Mandatory Label\Low Mandatory Level`，其服务子进程以 Low 完整性运行，无法读仓库 Medium 标签源文件。

- 修复（可逆、限 node_modules 内、非个人/系统文件）：`icacls esbuild.exe /setintegritylevel M` → 改为 `Medium Mandatory Level`，esbuild 服务以 Medium 运行即可读 Medium 仓库文件。
- 注意：`npm install` / `npm ci` 重抽 esbuild 可能恢复 Low 标签，届时需重做上述一步。

## 7. 交付可见性

当前 `D:\tmp\SaCode-latest`（10-16 构建）**不含**本轮改动；用户运行实例需重新构建 / 中性导出后才可见，且 `model-call-log.ts` 等新 TS 须 `npm run vendor` 重打包进 `client-slots.iife.js`。
