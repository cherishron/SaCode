# SaCode Web 部署方案设计

> 日期：2026-10-22｜状态：**设计（待评审）**｜类别：②功能与界面设计 + ⑩对接方案
> 上级索引：[plans/README.md](../../plans/README.md) §B｜对接总览：[../integration/README.md](../../integration/README.md) §1｜接口速查：[../interfaces/README.md](../../interfaces/README.md) §1
> 关联：PRD 平台与分发 [`product/platform-and-distribution.md`](../../product/platform-and-distribution.md)；Host 协议面见 [`host-capabilities.json`](../../plans/host-capabilities.json) 与 `apps/desktop/host-bridge.cjs`
>
> 本文档是纯调研设计，未改任何产品代码、未构建、未提交。所有"已实现/可复用"判断以当前源码为准。

## 0. 一句话结论

**当前只有 CLI 和 Electron 桌面两个真实入口，没有 Web 部署。** 推荐走**方案 B：在 `pack-service` 无头服务之上加一个 WebSocket 桥，再配一个独立 Web 前端**，复用 Host 现成的 NDJSON JSON-RPC 协议，不改动桌面 renderer、不动 Host 源码。目标是把"Web 部署有了"从缺口变成一条独立、低回归风险的落地路径。

## 1. 背景与目标

### 1.1 起因

用户问"现在我们是不是有了 cli、desktop，如果是 web 的部署的话有了吗"。核查仓库后确认：

| 形态 | 是否已有 | 入口 | 说明 |
| --- | --- | --- | --- |
| CLI | 有 | `apps/cli`（仓颉可执行）+ `npm/sacode-cli` 薄启动包 + 平台包 | 无头命令行入口，npm 分发二进制来源 |
| Desktop | 有 | `apps/desktop`（Electron + Vue3 runtime，TinyVue/TinyRobot） | GUI 入口，spawn 仓颉 Host 子进程，经有限 IPC 通信 |
| Host / daemon | 有（服务侧组件） | `apps/host`、`apps/daemon` 各自 `cjpm build` 出 `main.exe` | JSON-RPC 宿主 + 后台常驻服务 |
| Mobile | 工程源码存在，运行待验 | 2026-10-23 从外部 `sa-app` 导入 `apps/mobile/` 的 KMP / KuiklyUI 工程 | 更正：原 `kotlin/`、`kotlin-test/` 仅为 Kotlin/JVM 协议客户端及测试，不是 Android 应用；实际手机工程含 Android 应用与鸿蒙壳，非 Web |
| **Web 部署** | **没有** | 无 `apps/web`、无浏览器/静态站点构建目标 | 见 §3 |

### 1.2 目标

1. 让 SaCode 能以**浏览器为前端**运行：用户打开一个 URL，即可用会话/审批/流式/工具等核心能力，不依赖本地安装 Electron。
2. **复用共享核心**：任务、审批（一次性工单）、取消、结算、会话日志不建第二套，与桌面/CLI 同源。
3. **不破坏已能跑的桌面**：Web 是另一条独立链路，对现有 Electron 桌面零回归。
4. **不暴露 Host 给公网**：经鉴权桥接，会话隔离，凭据不落地前端。

### 1.3 非目标

- 不在本方案内实现"桌面和 Web 100% 同一套 UI 源码"（见 §4 方案 A 的 transport 抽象变体，留作后续升级）。
- 不替代桌面，桌面仍是本地全功能入口；Web 优先服务"无 Electron 环境 / 远程协作 / 多人共享会话"场景。
- 不改 Host 协议本身（NDJSON JSON-RPC 保持不变），只换"Host 被谁驱动"的壳。

## 2. 现状盘点

### 2.1 Host 协议（关键复用点）

- **传输**：一行一报文的 NDJSON，JSON-RPC 2.0。Host 是 stdin/stdout 进程，stdout 只走协议帧，诊断走 stderr（见 [`interfaces/README.md`](../../interfaces/README.md) §1 第 2 面）。
- **帧格式**：请求 `{jsonrpc:"2.0",id,method,params}`；响应 `{jsonrpc:"2.0",id,result|error}`；无 `id` 的为通知（notifications）。
- **优雅退出**：关闭 stdin 触发 Host 的 EOF 结算路径（未 flush 的写入在此落盘并归还租约），超时才强杀。
- **能力声明**：`initialize` 方法返回能力字符串数组，方法面以 [`host-capabilities.json`](../../plans/host-capabilities.json) 为机器可读契约（2026-10-17 工作区 178 条 / HEAD 171 条，计数随接线更新）。
- **超时语义**：常规投影/起轮默认 5 秒；慢调用（worktree/enter、PR 抓取）由调用方给有界值（最长 30 秒）。

### 2.2 HostBridge（最佳参考实现）

`apps/desktop/host-bridge.cjs` 已经是**一份完整的 NDJSON JSON-RPC 客户端**，Electron 主进程与纯 Node 测试共用同一份实现。关键能力：

- `start(cwd)`：spawn Host 子进程，stdin/stdout/stderr pipe。
- `#onData`：按 `\n` 分帧、`JSON.parse`、按 `id` 配对请求/分发通知。
- `request(method, params, timeoutMs)`：自增 id、写 stdin、超时 reject、失败回 `Error("code message")` 且保留 `error.data`。
- `stop()`：关 stdin 等退出，超时强杀并如实报告。
- `#fail`：Host 退出时所有在途请求立刻失败（不让调用方等超时）。

**结论**：WebSocket 桥本质上是把"stdin/stdout 管道"换成"WS 连接"，配对/超时/通知分发逻辑可几乎照搬 HostBridge。

### 2.3 桌面 renderer 的 Electron 专用约束（为什么不能直接搬浏览器）

- 按 `file://` 加载，受 CSP `script-src 'self'`（**禁 `unsafe-eval`**）约束。
- 用 Vue **runtime** 构建 + `h()` 写视图，运行时不能引入模板编译器、模块加载器或 ES module（`file://` 下被 CORS 拦）。
- 第三方组件库（TinyVue/TinyRobot）在**构建期**由 `scripts/pack-tinyvue.mjs` / `pack-tinyrobot.mjs` 折叠成单个经典脚本，并把 `vue` 别名到已 vendor 的那份 runtime。
- IPC 面是按动作命名、逐字段校验的**有限集合**（`preload.cjs` 的 `contextBridge.exposeInMainWorld` 顶层 key 为唯一权威），不提供"发任意方法"通道。

这三件套（file:// + CSP + 构建期折叠）专为 Electron 设计，硬改成浏览器要先推翻它们 + 重构整个 IPC 边界，风险高、收益低。

### 2.4 pack-service（无头服务底座，已就绪）

[`scripts/pack-service.mjs`](../../../scripts/pack-service.mjs) 已能把 CLI+Host+daemon+extjs+运行期 DLL 打包成一份自包含"同包服务交付"，带可核验清单（`bin/service-manifest.json`，含 gitSha + 逐文件 sha256）。它是一份**无头服务端 bundle**，没有 Web 前端，但已是 Web 部署的后端底座。

### 2.5 接口面现状（对接依据）

| # | 接口面 | 权威源 | 读数（以最新源码为准） |
| --- | --- | --- | --- |
| 2 | Host JSON-RPC | `apps/host/src/main.cj` | 工作区 178 条（2026-10-17）；方法面见 `host-capabilities.json` |
| 3 | 桌面 IPC | `apps/desktop/preload.cjs` 顶层 key | 工作区 149→192（随接线更新） |
| 4 | daemon 远程面 | `apps/daemon/src/` | 119 条方法契约（`remote-capability-contract.json`） |

> Web 前端不直接复用桌面 IPC 通道名，而是直接调 Host 的 JSON-RPC 方法（见 §6 映射表），减少一层转发。

## 3. 方案对比与推荐

### 3.1 方案 A：改造桌面 renderer 跑浏览器

把 `apps/desktop/renderer/` 改成可在浏览器跑的 Web 构建。

- **做法**：解耦 Electron IPC → 改 HTTP/WebSocket；重做 CSP/Vue 打包方式（去掉 file://、去掉构建期折叠、改用正常 Vite SPA）。
- **优点**：最大化复用现有 Vue UI 代码，长期双端 UI 一致。
- **缺点**：要先推翻三件套约束、重构 `preload.cjs` + 一堆 `*-ipc.cjs` 的有限 IPC 面；桌面回归风险高；前端技术栈被 Electron 历史绑死。

### 3.2 方案 B：WS 桥 + 独立 Web 前端（**推荐**）

在 `pack-service` 无头服务之上，加一个轻量 WebSocket 桥进程（复用 HostBridge 逻辑），再写一个独立 Web 前端连 WS、直调 Host JSON-RPC。

- **做法**：见 §5 架构与 §7 改造点。
- **优点**：Host 源码一行不动、桌面零回归、前端技术栈自由、安全边界清晰。
- **缺点**：前端 UI 要重写（但可按需移植桌面 Vue 组件）。

### 3.3 对比

| 维度 | 方案 A | 方案 B（推荐） |
| --- | --- | --- |
| 后端复用 | 复用 Host，但要暴露给浏览器 | Host 不动，`pack-service` 当底座 |
| 对现桌面风险 | 高（推翻 file:///CSP/折叠三件套 + 重构 IPC 面） | 零回归（独立链路） |
| 前端技术栈 | 被 Electron 约束 | 自由（Vite + Vue/React） |
| 工作量 | 中-大 | 小-中（桥 ~200 行 + 新前端壳） |
| 拿到"Web 部署有了"速度 | 慢 | 快 |
| 双端 UI 一致性 | 高 | 低（需后续移植） |

### 3.4 推荐

**默认走 B**：最快拿到 Web 部署、零桌面回归风险。等未来要"双端 UI 100% 同源"再升级到 A 的 transport 抽象变体（把现有 IPC 抽成 `transport` 接口，Electron 用 IPC 实现、Web 用 WS 实现，UI 代码共用）——那是 §9 升级路径，不在本方案范围。

## 4. 推荐方案 B 架构

### 4.1 拓扑

```
 浏览器 (Vite SPA)                       无头服务节点 (pack-service 产物)
 ┌─────────────────┐                     ┌─────────────────────────────────┐
 │ Web 前端        │  WebSocket (鉴权)   │ WS 桥 (Node, 复用 HostBridge)    │
 │ Vue/React SPA   │ ←─────────────────→ │   ↓ stdin/stdout NDJSON          │
 │ 会话/审批/流式  │                     │ Host (sacode-host.exe)           │
 │ 工具/工作台     │                     │   ↑ 子进程驱动                   │
 └─────────────────┘                     │ extjs (扩展宿主, NDJSON)          │
                                         │ daemon (常驻, 按需)              │
                                         └─────────────────────────────────┘
```

### 4.2 组件清单

| 组件 | 形态 | 复用 / 新增 |
| --- | --- | --- |
| Web 前端 | Vite SPA（Vue3 或 React，CSP 无 unsafe-eval 仍可满足） | **新增** `apps/web/` |
| WS 桥 | Node 进程，暴露 WebSocket，内部 spawn Host、转发 NDJSON | **新增**，逻辑照搬 `host-bridge.cjs` |
| 无头服务 | `pack-service` 产物 + WS 桥 + 鉴权 | 复用 `pack-service.mjs`，扩展打包 |
| Host | 仓颉 Host（不动源码） | 复用 |
| extjs | 扩展宿主子进程 | 复用 |
| daemon | 常驻服务（多用户/远程场景启用） | 复用，按需 |

## 5. 改造点（逐项）

### 5.1 后端：WS 桥进程

- **新增** `apps/web/server/ws-host-bridge.cjs`（或 `.mjs`）。
- **核心**：复用 `apps/desktop/host-bridge.cjs` 的 `HostBridge` 类（分帧、配对、超时、通知分发、EOF 退出）。把它从"Electron 主进程内 spawn"改成"WS 服务端，每个鉴权过的连接绑定一个 Host 进程"。
- **生命周期**：连接建立 → spawn Host（或从连接池取）→ 连接断开/超时 → 优雅 stop Host（关 stdin 等退出，超时强杀，复用现有 `stop()` 语义）。
- **不做**：不改 Host 源码、不改 Host 协议、不引入"Host 监听端口"模式（保持 stdin/stdout，桥负责双向搬运）。

### 5.2 后端：无头服务扩展

- 基于 `pack-service.mjs`，**新增** `scripts/pack-web-service.mjs`（或在 pack-service 加 `--with-web-bridge` 开关）：在原 CLI+Host+daemon+extjs+DLL 之上，加入 WS 桥入口、静态前端产物、鉴权配置。
- 清单 `bin/service-manifest.json` 扩展 `roles`，登记 `webBridge` 与 `webFrontend`。

### 5.3 鉴权与会话隔离

- **连接级鉴权**：WS 握手带 token（Bearer / query `?token=` 或首帧 `auth`）。token 来源由部署方决定（环境变量 / 配置文件 / 外部 IdP），不在本方案硬编码。
- **会话归属**：复用 Host 既有会话归属语义（`sessionId` 绑定连接）。一个连接对应一个 Host 进程 / 一个会话，桥不混用。
- **凭据不落地前端**：模型 key、MCP 凭据等只在 Host 侧（复用 core `scrubEnvironment` 既有净化，KEY/PASSWORD/SECRET/TOKEN/SACODE_* 擦除），前端只拿会话结果。
- **超时与回收**：连接空闲超时 → 优雅 stop Host（落盘未 flush 写入、归还租约），复用 EOF 结算路径。

### 5.4 前端：Web SPA

- **新增** `apps/web/`，Vite + Vue3（或 React）。
- **首批核心链路**（见 §6 映射表）：会话新建/列表/恢复、turn/start + turn/poll 流式、approval/ask + approval/answer、工具结果展示。
- **CSP**：`script-src 'self'`（可不含 unsafe-eval），`connect-src wss://...`。
- **不依赖** Electron 的 `contextBridge` / `file://` / 构建期折叠；用正常 ESM + Vite 打包。
- **UI 复用**：按需把桌面 `renderer/pages/` 下的 Vue 组件移植（TinyVue/TinyRobot 若用，需在 Web 端用正常 ESM 引入，不用桌面那套折叠脚本）。

### 5.5 前端与 Host 方法面对接

- Web 前端**直接调 Host JSON-RPC 方法**（经 WS 桥透传），不复用桌面 IPC 通道名，少一层转发。
- 方法名以 [`host-capabilities.json`](../../plans/host-capabilities.json) 和 [`interfaces/README.md`](../../interfaces/README.md) §1 为准。首批对接见 §6 映射表。
- **鉴权策略**：桥不替 Host 做审批决策，审批仍走 Host 既有 `approval/ask → answer` 一次性工单；前端只展示与回传用户决策。

### 5.6 流式 / 审批 / 取消的 Web 语义

- **流式**：`turn/poll` 的 NDJSON 通知（无 `id` 帧）经 WS 桥实时推给前端，前端按 `chunkKind` 渲染（复用桌面 `renderer/msgfold.js` 的信封兼容逻辑：`{result,text}` 与直接结果对象都收，`externalContent` 低信任提示独立展示）。
- **审批**：`approval/ask` 通知 → 前端弹审批工单 → 用户决策经 `approval/answer` 回传，桥透传给 Host。一次性消费语义不变。
- **取消**：前端发 `turn/cancel`（或等价方法），桥透传；Host 的 `TurnToken` 协作式取消不改动（SSE 5s 中断语义见 core `sse.cj`，Web 不特殊处理）。
- **断连恢复**：WS 断连后重连，前端按 `sessionId` 调 `session/load` 恢复（复用 Host 持久化屏障与投影，会话日志是唯一真源）。断连期间的 Host 进程按 §5.3 空闲超时回收，不保证长任务在断连后继续（属 §9 升级项）。

## 6. 接口对接（方法面映射表）

> 方法名以当前 `host-capabilities.json` 与 `apps/host/src/main.cj` 为准；下表是首批对接，不是完整方法面。完整方法面见 [`interfaces/README.md`](../../interfaces/README.md) §1 第 2 面。

| 能力 | Host JSON-RPC 方法（经 WS 桥透传） | 前端动作 | 备注 |
| --- | --- | --- | --- |
| 能力声明 | `initialize` | 连接后首调，拿能力清单 | 桥可在握手后自动调一次 |
| 会话 | `session/new` `session/load` `session/list` `session/rename` `session/archive` `session/clear` | 侧栏会话列表、恢复、重命名 | 方法面见 session-interactions 契约 |
| 轮次 | `turn/start` `turn/poll` | 发消息、流式渲染、活动 pill | `turn/poll` 回执带 `elapsedMs/ttftMs/tokensPerSecond`（2026-10-21 已补） |
| 取消 | `turn/cancel`（或等价） | 取消按钮 | 复用 `TurnToken` 协作式取消 |
| 审批 | `approval/ask`（通知）`approval/answer` | 审批工单弹窗、回传决策 | 一次性工单，桥不替 Host 决策 |
| 模型 | `model/pull-describe` `model/pull-cancel` 等 | 模型发现页 | 生命周期见 model-pull 契约 |
| 技能 | `skill/list` `skill/get` | 技能卡片 | 2026-10-21 已加（SK-C） |
| Web 工具 | `web/fetch` `web/search` | 工具卡内联结果 | 2026-10-21 WebRpc 已出帧接缝 |
| MCP | `mcp/connect` `mcp/tools` 等 | MCP 服务器管理 | env 净化、重连策略已就绪 |
| 写回 | `execution/review-apply` 系列 | 受控文件写回 | 公开 RPC 开放边界待定，首批可不接 |

**桌面 IPC 对照**：桌面经 `preload.cjs` → `main.cjs` 的 `withHost` → `bridge.request()` 转发；Web 前端经 WS 桥直发 Host 方法，少一层 IPC 转发，但方法语义一致。

## 7. 工作量估算

> 粗估，不含跨平台/真实供应商验收。单位为人天，按一名熟悉项目的开发者。

| 阶段 | 工作内容 | 估算 | 产出 |
| --- | --- | --- | --- |
| S1 | WS 桥 PoC：复用 HostBridge，spawn Host，单连接 NDJSON ↔ WS 双向透传，最小鉴权 | 1-2 | 桥进程 + 一个 WS 客户端能 `initialize`+`session/new` 成功 |
| S2 | 无头服务扩展：`pack-web-service` 打包 WS 桥 + 静态前端 + 鉴权配置 | 1-2 | 可部署的服务包 |
| S3 | Web 前端骨架：Vite + Vue/React，会话列表 + 发消息 + 流式渲染 + 审批工单 | 5-8 | 可用的最小 Web UI |
| S4 | 流式/取消/恢复完整链路：断连重连、`session/load` 恢复、取消按钮 | 2-3 | 闭环可用 |
| S5 | UI 移植：按需搬桌面 Vue 组件（消息折叠、工具卡、模型页等） | 3-5 | 与桌面体验对齐 |
| S6 | 鉴权与多用户：token 管理、会话隔离、daemon 接入（多用户场景） | 3-5 | 可上生产 |
| S7 | 验收：真实任务、断连恢复、取消、审批、安全边界 | 2-3 | 验收证据 |

**合计约 17-28 人天**到"可上生产的 Web 部署"。S1-S2 即可证明"Web 部署有了"（约 2-4 人天），S3 后用户体验对齐桌面。

## 8. 验收出口

- **S1 出口**：浏览器 JS 控制台经 WS 调 `initialize` + `session/new` 成功，能发一条消息收到流式回复。
- **S3 出口**：会话列表 + 发消息 + 流式 + 审批工单完整用户旅程跑通（合成模型）。
- **最终出口**：真实模型供应商任务（读文件→审批→修改→测试→结算）、断连恢复、取消、拒绝、失败与隔离分别取证；不把 WS 握手成功当任务验收。
- **不替代**：桌面/CLI 真实任务与安装态验收仍各自独立，Web 验收不升级桌面完成状态。

## 9. 风险与边界

| 风险 | 说明 | 缓解 |
| --- | --- | --- |
| Host 进程生命周期 | 一连接一进程在多用户下资源重；进程回收/池化需设计 | 首批单用户；多用户走 daemon 或连接池，列入 S6 |
| 断连长任务 | WS 断连后 Host 是否继续跑取决于桥策略 | 首批：断连即优雅 stop（落盘）；继续跑列升级项 |
| 鉴权泄露 | token 经 query 暴露在日志 | 用首帧 `auth` + WSS，禁 query token；token 轮换 |
| 公网暴露 Host | Host 方法面大，裸暴露危险 | 桥做方法白名单（首批只放 §6 表内方法），非全方法透传 |
| 与桌面方法面漂移 | Host 接线新增方法，Web 映射表过期 | 桥白名单与 `host-capabilities.json` 同批更新，加门禁 |
| 升级到双端同源 UI | 方案 B 前端是重写，与桌面 UI 会漂移 | 列入 §3.4 升级路径：未来抽 transport 接口双端共用 |

## 10. 落点与登记

- 本文档：`docs/clients/web/2026-10-22-web-deployment-design.md`。
- 同批登记：[`plans/README.md`](../../plans/README.md) §B 表 + 详细设计覆盖速览表；[`integration/README.md`](../../integration/README.md) §1 对接面总览表；[`../README.md`](../../README.md) §4 维护记录。
- 后续若实施，按阶段在 [`product/PRD-tracking.md`](../../product/PRD-tracking.md) 登记 Fxx 关联与缺陷，验收证据落 `evidence/`。
- 状态标注：**设计（待评审）**——评审通过后改"已评审（待实施）"，实施后改"已执行/历史"。

## 11. 与现有治理的边界

- 不改 Host / core / 桌面源码；不动 `preload.cjs` / `*-ipc.cjs` / `host-bridge.cjs`（桥是新文件，复用其逻辑但不改原文件）。
- 不引入 `--no-sandbox`；不降低沙箱/ACL/完整性级别；Windows AppContainer 与 LPAC token 修复（D14/CB-3）独立推进，Web 部署不依赖其完成，但真实写回链路开放前须 D14 就绪。
- 不把 WS 握手成功、桥编译通过、最小 SPA 跑起来当产品验收；按 §8 出口逐项取证。
- 不覆盖其他会话工作；不擅自提交或 push；快照须哈希文件内容。
