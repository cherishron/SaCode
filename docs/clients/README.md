# clients/ — 产品四端文档（总览）

> 类别：**⑪ 端文档**（前端四端总览与逐端规格）。上级索引：[docs/README.md](../README.md)。
> 本页是 SaCode 四个**用户可交互前端（端）**的整理索引与差异速查：桌面端、CLI 端、移动端、Web 端。
> 每端的最终权威是**当前源码**；本文登记用途、需求、设计、边界与分步细节，使用前核源码与 [PRD](../product/PRD.md)。

## 0. 口径：「四端」指什么

SaCode 是**仓颉共享业务核心** + 多个入口面的产品。仓库里的角色分两类，不要混为一谈：

- **共享与后端角色（不是「端」）**：`core/`（仓颉静态库，会话/执行/授权/取消/结算真源）、`apps/host/`（仓颉 NDJSON/JSON-RPC 协议宿主，由前端 spawn）、`apps/daemon/`（仓颉服务端，远程身份/会话归属独立验收）、`extjs/`（Node JS 扩展宿主）。
- **四个「端」（用户可交互前端）**：本文档主体。

| 端 | 源码位置 | 交互形态 | 目标平台 | 主要协议/入口 | 逐端文档 |
|---|---|---|---|---|---|
| 桌面端 | `apps/desktop/`（+ `apps/host/` 装配） | Electron 图形工作台 | Windows / Linux / macOS | Electron IPC（`preload.cjs` 顶层 key）+ Host stdio | [desktop/README.md](desktop/README.md) |
| CLI 端 | `apps/cli/`（+ `apps/cli/tui/` + `npm/sacode-cli`） | 终端；含 Node/Ink TUI | Windows / Linux / macOS；鸿蒙 CLI 保留 | 仓颉 CLI 动词 + Host stdio；TUI 消费 Host JSON-RPC | [cli/README.md](cli/README.md) |
| 移动端 | `apps/mobile/` | Android / 鸿蒙 手机应用 | Android 为首验；鸿蒙壳独立验收 | daemon HTTP JSON-RPC + SSE | [mobile/README.md](mobile/README.md) |
| Web 端 | `apps/web/` | 浏览器工作台 | 桌面浏览器优先；自托管服务 | 同源 HTTPS BFF + daemon JSON-RPC/SSE | [web/README.md](web/README.md) |

> 桌面端与 CLI 端共同构成历史所称的“双入口”；「双入口」只指两种用户交互形态，不代表系统只有两个可执行模块（见 [platform-and-distribution.md §1](../product/platform-and-distribution.md)）。

## 1. 共享契约：四端差异的**不变项**

四端都不复制 Agent 主循环或授权机制，而是适配同一份 `core`。以下语义在四端一致，是差异对比的基线：

1. **会话日志是唯一真源**：消息与 UI 都是投影；`append` 只在实例内可见，`flush` 才跨进程持久。
2. **授权/取消/结算共用同一链**：模型工具调用经 `approval/ask` → 工单（`approvalId`）→ `approval/answer`，且受 guard/取消令牌约束；审批凭据只能是工单号。
3. **写操作幂等**：持久写要求 `operationId`；结果未知（`-32019`）只查状态、不换新号盲重放副作用。
4. **断连不假报**：断连不等于取消，也不等于成功；恢复以真实回执与回读为准。
5. **隔离与凭据红线**：不绕过 OS 隔离与审批；真实密钥/Token/密码/私钥/Cookie 不入库、不写日志、不进前端包与 URL。

接口面的权威清单见 [interfaces/README.md](../interfaces/README.md)（七个面 + 契约 JSON），对接状态见 [integration/README.md](../integration/README.md)。

## 2. 跨端差异对比矩阵

同一能力在四端的**实现形态与验收边界不同**，不能相互推定。以下为可查阅的对照（空项表示该端未涉及或待验；状态随源码更新）。

| 维度 | 桌面端 | CLI 端 | 移动端 | Web 端 |
|---|---|---|---|---|
| 进程与宿主 | 主进程 `spawn` 宿主 exe；渲染进程受 CSP 约束 | 进程内跑仓颉 CLI；TUI 亦 spawn/连 Host | 通过 daemon → Host/core（无本地 Host） | BFF `spawn`/连 daemon → Host/core |
| UI 技术 | 纯 JS + Vue **runtime** + `h()`；无模块加载器/模板编译器/TS/ESM | 终端字格渲染（Ink）；无 GUI 框架 | Kotlin/KMP + KuiklyUI（DSL）；SaUI 组件库 | Vue 3 + TypeScript + Vite（浏览器 ESM 正常，capable 构建期编译模板） |
| 与后端连接 | Electron IPC → `host-bridge.cjs`（stdio NDJSON） | 仓颉 CLI 直连 Host；TUI 经 Host JSON-RPC | daemon HTTP JSON-RPC + SSE（非回环必须 TLS） | 同源 HTTPS BFF → daemon（HttpOnly cookie + CSRF） |
| 身份与授权 | 本机用户；审批用 `approvalId` 工单 | 本机用户；同左 | 本机设备档案 + daemon 设备 credential（`kind="mobile"`）+ 有限 scope | 浏览器登录身份 + 服务端 daemon 设备 credential（两层身份） |
| 数据与恢复 | 会话日志目录；关闭重开回放 | 同左；TUI 亦按 Host 回执/回读 | 服务端投影为准，本地只缓存展示；代次 gap 重建基线 | 服务端持久历史 + SSE 补读；断连/刷新恢复 |
| 构建与分发 | electron-builder（各平台同源 Host/运行库/DLL） | `cjpm build` + npm 薄启动包 / release 压缩包 | Gradle `:androidApp:assembleDebug`；鸿蒙壳独立 | Vite 构建 + Node BFF 服务包（同源可追溯） |
| 设计规范 | [`renderer/DESIGN.md`](../../apps/desktop/renderer/DESIGN.md) + [`desktop-design-standard.md`](desktop/desktop-design-standard.md) | [`tui/DESIGN.md`](../../apps/cli/tui/DESIGN.md) | SaUI 令牌（`SaUITokens`）；Kuikly 原生 | 视觉专项后续另立（架构方案不擅改界面） |
| 能力开放度 | 完整工作台（21 域推进中） | 命令面 + TUI 消费既有 Host 方法 | 只读已开放：`initialize`/`session/catalog`/`session/events` | 首发只读：`initialize`/`session/catalog`/`session/events` |

## 3. 共同红线（四端一致，不可绕过）

- 不绕过核心审批或 OS 隔离；宿主进程隔离 ≠ 用户隔离。
- 断连不假报取消/成功，缓存不代替会话真源。
- 未验证平台/能力明确标注“待验”，不以“可编译/有源码/有页面”宣称为可用。
- 凭据明文进入普通日志、前端包、URL 或模型可见提示的数量必须为 0。

## 4. 逐端文档索引

| 文档 | 覆盖内容 | 对应需求 |
|---|---|---|
| [desktop/README.md](desktop/README.md) | 桌面端：用途 / 需求 / 设计 / 边界 / 分步细节 / 与其它端差异 | F01–F21 主交付端；[PRD §近期交付顺序](../product/PRD.md) |
| [cli/README.md](cli/README.md) | CLI 端：仓颉命令面 + Node/Ink TUI + npm 分发 | [PRD §1 用户表：CLI 开发者](../product/PRD.md) |
| [mobile/README.md](mobile/README.md) | 移动端：KMP/KuiklyUI 工程、配对、远程只读→任务闭环 | [PRD §移动端与 Web 产品路线：M01–M05](../product/PRD.md) |
| [web/README.md](web/README.md) | Web 端：独立前端 + BFF、身份/Origin、首发范围 | [PRD §移动端与 Web 产品路线：W01–W04](../product/PRD.md) |

### 4.1 逐端「相关文档索引」与端目录

> 各端**专属文档已物理归入 `clients/<端>/`**；下表索引页即该目录下的 `documents.md`（端规格为该目录 `README.md`）。通用/后端文档仍留在原目录。移动已于同批重写全库引用并通过断链校验。

| 端目录 | 规格主页 | 归类索引 | 归类内容 |
|---|---|---|---|
| `clients/desktop/` | [README.md](desktop/README.md) | [documents.md](desktop/documents.md) | 桌面端相关文档（渲染/供应商/审批/执行审查/页面域/启动打包/真实闭环/历史） |
| `clients/cli/` | [README.md](cli/README.md) | [documents.md](cli/documents.md) | CLI 端相关文档（命令面与构建 / TUI / 远程、双入口、团队、目标、批处理 / 知识技能等） |
| `clients/mobile/` | [README.md](mobile/README.md) | [documents.md](mobile/documents.md) | 移动端相关文档（产品路线 / 工程内文档 / 接口契约 / 设计稿 / 证据 / 远程后端） |
| `clients/web/` | [README.md](web/README.md) | [documents.md](web/documents.md) | Web 端相关文档（架构选型部署 / 源码测试 / 接口契约 / 证据） |

## 5. 维护规则

1. 任一端的用途/需求/设计/边界发生变化时，**同批更新本页对照矩阵与该端文档**，并同步 [docs/README.md](../README.md) 与 [interfaces/README.md](../interfaces/README.md)/[integration/README.md](../integration/README.md) 的相关读数。
2. 本页状态只用可核口径：**已实现 / 真实入口已接通 / 待验 / 规划**，不写模糊词；不把单测、页面接线、协议 smoke 通过升级为版本交付。
3. 端内细节以源码为准；本文档不复制源码，只给定位与锚点。