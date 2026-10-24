# Web 端（浏览器工作台 + BFF）

> 类别：**⑪ 端文档**｜上级索引：[clients/README.md](../README.md)｜四端总览见 [README §2 差异矩阵](../README.md#2-跨端差异对比矩阵)。
> 源码：[`apps/web/`](../../../apps/web/)（独立前端 + Node BFF）。架构方案见 [2026-10-23-web-workbench-architecture.md](2026-10-23-web-workbench-architecture.md)、[2026-10-22-web-deployment-design.md](2026-10-22-web-deployment-design.md)、技术选型见 [2026-10-23-web-technical-selection.md](2026-10-23-web-technical-selection.md)；工程治理见 [web-tech-debt-2026-10-24.md](web-tech-debt-2026-10-24.md)。
> 状态口径：工程脚手架与只读 PoC 已有读数；**任务执行/审批未开放，部署未实现，真实业务直播与非同源候选均待验**。

## 1. 用途

面向开发者的**浏览器工作台**，把 AI 编程任务能力通过浏览器交付。

- **定位**：浏览器是任务工作台；**服务端工作区才是实际读写、编译和执行的地方**。不是静态聊天网站，也不是把用户浏览器里的电脑文件自动授权给云端。
- **推荐架构**：独立 **Vue 3 + TypeScript** Web 前端 + **同源 Node.js BFF**（Backend for Frontend），复用受保护 daemon 的 HTTP JSON-RPC + SSE，再由 daemon 驱动 Host/core。
- **首批面向**：可信**单用户、自托管、固定工作区**部署；同一用户多浏览器/多标签页也必须正确隔离和恢复，**不等于多租户已解决**。

## 2. 需求

### 2.1 产品路线（W01–W04，见 [PRD §移动端与 Web 产品路线](../../product/PRD.md)）

| 阶段 | 范围与交付目标 | 门槛 / 当前状态 |
|---|---|---|
| W01 契约与安全设计 | 确定浏览器可调用的有限方法、身份、作用域、工作区绑定、进程/连接生命周期 | 有专项设计；**未实施**；必须核源码与远程契约，**不把 Host 全能力列表自动开放** |
| W02 桥接 PoC | 有界转发请求/响应/通知，处理超时/背压/断连/清理 | 仅记 PoC；握手/`initialize` 成功**不等于**可部署或产品可用；修改类请求结果未知不自动重发 |
| W03 最小 Web 工作台 | 会话与消息、流式/轮询投影、审批、取消、任务状态、差异及恢复 | 以实际 Host/daemon 契约映射，不把 `turn/poll` 响应误作无 id 通知；真实任务各环节分别取证 |
| W04 部署与交付 | 同源可追溯服务包、TLS/WSS、认证与会话/工作区隔离、资源限额、健康检查、升级回退 | **未实现/未部署**；首批限可信单用户，多租户须独立安全验收 |

### 2.2 首发范围与非目标（见 [架构方案 §4](2026-10-23-web-workbench-architecture.md)）

**首发范围**：登录/退出、当前服务与工作区识别、会话目录、持久历史和任务状态；再分阶段开放创建会话、发起实际任务、流式结果、精确审批、取消、差异与测试结果；断线/刷新恢复并明确 `unknown`/`blocked`/`failed`/`cancel-requested`；桌面浏览器优先；配置与凭据先由服务端可信管理入口提供。

**非目标**：公共多租户 SaaS、任意用户注册、多人同时编辑同一会话、跨用户共享工作区；浏览器任意本地目录/终端/SSH、任意文件上传、任意 URL 代理；重写 core/审批体系、改 Electron 入口、让网页直接 spawn Host；首版 PWA 离线任务/后台自动重放/Service Worker 缓存私密会话；在架构方案中决定视觉布局/品牌/组件风格。

### 2.3 技术选型（见 [技术选型](2026-10-23-web-technical-selection.md)）

Vue 3.5 + Vite 8 + Fastify 5 + TypeBox + 不透明服务端会话 + SSE；复用桌面 `RemoteTransport` 的 TLS pin/并发/幂等能力；TypeScript 5.9、vue-router 4/Pinia 3、Caddy 反代、Playwright E2E。版本为**只读候选值**，未安装、未建工程、未部署的实际动作以源码为准。

## 3. 设计

### 3.1 架构与部署拓扑

```text
浏览器：独立 Web 前端（Vue 3 + TS + Vite）
   │ 同源 HTTPS（HttpOnly cookie + CSRF）
   ▼
入口反向代理 / Web BFF（Fastify）
   ├─ 静态资源
   ├─ 浏览器会话、有限动作、目标/工作区绑定
   ├─ 有界请求 + SSE 事件适配/读取协调
   └─ 服务端凭据仓 / daemon 客户端
          │ 受保护 HTTP(S) RPC + SSE，设备身份和有限 scope
          ▼
         daemon ── 单一 Host / core ── 服务端工作区与执行沙箱
```

- **T1 同机自托管（首选）**：Web/BFF/daemon 在用户自己的电脑或服务器，浏览器访问同源 HTTPS；仅暴露 Web 入口，daemon/Host/管理接口不直接公开。BFF→daemon 可严格同机 loopback 采用已启用认证的 HTTP 例外，跨机器/容器/Relay/SSH 一律 TLS，**不把“私网”当免认证理由**。
- **T2 服务器工作区**：服务安装在哪，默认任务就在哪运行；浏览器上传提示词≠上传整台本地电脑；工作区由管理员预先创建/绑定。
- **T3 云端 Web 控制家中电脑（后续）**：需可达的受保护 daemon 或 Relay/SSH 通道；浏览器不能跑原生 SSH、不能用 JS 绕过系统 TLS 信任 pin 自签证书。**BFF 能读到提示词/输出并托管 daemon 凭据，是可信业务端点**（字节 Relay 才是不解密中转）。

### 3.2 源码结构

```text
apps/web/
├── src/                     # 浏览器前端（Vue 3 + TS）
│   ├── pages/               # LoginPage / WorkbenchPage / NotFoundPage
│   ├── stores/              # auth / sessions（Pinia）
│   ├── api/client.ts        # 同源 API 客户端
│   └── router.ts、App.vue、main.ts
├── server/                  # Node BFF（Fastify）
│   ├── auth/                # session / password / csrf
│   ├── daemon/              # gateway / mapper / policy / transport / real-transport
│   ├── events/              # broker / connection（SSE）
│   ├── routes/              # auth / cookies / events / guards / health / sessions / targets
│   └── security/            # limits / origin
├── contracts/web-actions.ts # 浏览器可调用动作契约
└── test/                    # unit / integration / e2e（Playwright）
```

### 3.3 身份与权限（两层，不复制业务授权）

- **浏览器登录**认证“谁能使用这个 Web 入口”；**daemon 设备认证**“这个服务端主体可对哪个实例/工作区做什么”。两层必要但**不同**。
- 首发一个预置 owner；安装时经本机管理流程配置登录材料，**拒绝默认密码与匿名公网入口**；本地登录推荐成熟口令哈希库（如 Argon2id），**不自己写密码算法**。
- **浏览器会话**：服务端生成高熵、不透明 session ID；浏览器仅存 `__Host-` 前缀、Secure、HttpOnly、Path=/、无 Domain 的 cookie；SameSite=Strict 为本地登录默认。建议初始策略 30 分钟闲置过期、8 小时绝对过期（待 W01 冻结，SSE 心跳不无限续命）。登录轮换 session ID；退出/重置即时撤销并清理内存投影。**不写 localStorage/sessionStorage/IndexedDB**。
- **服务端凭据**：管理员在可信本机配置目标并用现有登记路径预置限定 scope 的 daemon 设备 credential；BFF 从受保护 OS/服务秘密存储读取，短 token 仅内存缓存。凭据映射至少绑定 `owner`/`targetId`/`instanceId`/`workspaceId` 和角色修订；浏览器**不提交**任意 `baseUrl`/`credentialRef`/`principalId`/workspace 路径。BFF **只做现有能力的收窄与映射，不能提升 scope**。

### 3.4 浏览器安全边界（见 [架构方案 §7](2026-10-23-web-workbench-architecture.md)）

1. **同源默认**：静态页/API/事件同入口；默认无跨域 API，不开 `Access-Control-Allow-Origin: *` 配 credentials。
2. **Origin/CSRF**：所有状态改变动作只接受 JSON POST，要求精确 Origin、会话绑定 CSRF token 与自定义头；拒绝不符合预期的 Fetch Metadata；登录也防 login CSRF。
3. **GET 只读**：BFF GET 不触发任务/审批/配置修改。
4. **Cookie 不替授权**：每个动作/订阅均查会话、目标绑定与作用域，daemon 再执行原有门禁。
5. **XSS**：Markdown 禁 raw HTML，代码/工具输出作低信任文本，危险 scheme 拒绝，外部图片不自动加载，新窗口加 `noopener`/`noreferrer`。
6. **CSP/缓存**：默认 `script-src self`、`connect-src self`、`object-src none`、`frame-ancestors none`、`form-action self`；敏感 API/HTML `no-store`；不缓存任务内容到离线 SW。
7. **文件/下载**：首版仅允许授权工件的 opaque ID，不接任意路径；服务端校验归属，限制大小/MIME，下载按附件返回并 `nosniff`。

### 3.5 已核对的复用资产与阻塞点（见 [架构方案 §3](2026-10-23-web-workbench-architecture.md)）

- 可复用：`apps/desktop/remote-transport.mjs`（HTTP+SSE、每目标 CA/pin、请求配对、限额、目标代次）、`target-bridge.mjs`（每目标路由/代次，未知目标拒绝）、`host-bridge.cjs`（stdio NDJSON 分帧/超时参考）、桌面 renderer 的纯函数/组件（Markdown 的 `html:false`/不加载外部图片低信任边界）、`scripts/pack-service.mjs`（同包可追溯性）。
- 任务开放前**必须解决**：① 初始化工作区契约（空 params `initialize` 与 `boundWorkspace` 冲突）② 真实 session→turn→审批绑定（不能用 `session/select` 抢全局会话凑隔离）③ 轮询不等于无副作用读取（`turn/poll` 有消费队列效果）④ scope 授予与沙箱（有 token 原语≠有可信授予操作面）⑤ 持久恢复证据（多主体运行验收）。

## 4. 边界

1. **不裸露 Host/任意 RPC**：BFF 只提供有限业务动作，经 daemon 认证/策略/幂等入口；接入面为 `BFF 动作 ∩ 远程契约 ∩ 实现 ∩ 当前主体授权`，缺一拒绝。凭据不放 URL、日志、前端包或普通浏览器持久存储。
2. **不重写后端**：不建立另一套任务/审批/幂等/Agent 主循环；不重写 core、不改 Electron 入口、不让网页直接 spawn Host。
3. **连接不是安全边界**：Host 生命周期归服务 supervisor/daemon；关闭浏览器只结束订阅，**不等于取消任务**；服务停机单独结算。
4. **不假报**：`turn/poll` 是请求/响应且消费共享 `turnSink`，不能每标签页独立抢读；断开/未知不假报取消/成功。
5. **未验证即待验**：部署、真实业务直播、任务审批、同源候选均未闭合；PoC/握手成功不代表可部署或产品可用；多租户须独立安全验收。

## 5. 分步细节

### 步骤 1：登录（浏览器会话建立）

1. 访问同源 HTTPS 入口 → BFF 静态资源；未登录跳 `LoginPage`。
2. 提交登录材料（JSON POST，精确 Origin + 预会话 CSRF）→ 服务端用加盐哈希校验（Argon2id 类）→ 生成不透明 session ID，下发 `__Host-` Secure/HttpOnly cookie。
3. **成功判据**：登录轮换 session ID；退出/重置即时撤销、关闭该登录态订阅、清理内存投影；服务重启默认使会话失效，用户重新登录。

### 步骤 2：识别当前服务与工作区

1. BFF 从服务端凭据仓读 daemon 设备 credential（受限 scope），绑定 `owner`/`targetId`/`instanceId`/`workspaceId`。
2. 浏览器 `initialize` 只读 → 读 `protocolVersion`/`capabilities`/`instanceId`/`sandboxEnforcement`。
3. **成功判据**：显示真实目标/工作区；浏览器不能提交任意目标/路径覆盖映射。

### 步骤 3：只读闭环（当前已登记面）

1. `session/catalog` → 会话目录。
2. `session/events {sessionId, afterSeq, limit(1..200), generation}` → 分页读持久历史；`gap` 时重取投影重建基线。
3. SSE（`routes/events.ts` + `events/broker.ts`/`connection.ts`）建连先校验登录态与可读资源；`Last-Event-ID` 原样回传。
4. **成功判据**：断线/刷新后恢复；背压 30 秒断开、drain 后补读。当前 remote 契约只登记 web 消费 `initialize`/`session/catalog`/`session/events` 三条 read（契约 16/16）；**消费登记不替代运行时权限**。见 [Web PoC 证据](2026-10-23-web-w01-w02a-poc.md)、[interfaces/README §1](../../interfaces/README.md)。

### 步骤 4：创建会话、发起任务（分期开放，前置门禁未清）

1. `session/create` → 再 `session/submit {eventType:"user/message", data}` → `session/flush` → `task/start`（参考 CLI 顺序；`turnId` 语义按实际契约）。
2. `turn/poll` 增量/结算；**不能**由页面自动重试或并发消费来假装纯投影接口。
3. **成功判据**：以实际 Host/daemon 契约映射；当前输入框 `disabled` 标“待接入”，真实白名单仅三个 read 方法（[web-tech-debt §3](web-tech-debt-2026-10-24.md)）。

### 步骤 5：审批与取消

1. 审批通知 `approval/asked` → 卡片（显示目标/会话/工具/参数摘要/工单号）→ `approval/answer {approvalId, decision ∈ {allowed-once, denied}}`。
2. 取消 `turn/cancel` 返回 `cancelRequested`/`wasRunning`（**非终态**），最终态由重取投影确认。
3. **成功判据**：精确消费工单；非 pending/来源不明不可操作；未知结果不自动重发。

### 步骤 6：断线/刷新恢复

- 关闭浏览器只结束订阅，任务按 daemon/Host 事实继续；重连先按 `session/events` 补读（超 200 条分页），`generation` 变更时重建同步基线。**不缓存任务内容到离线 SW**。

### 验证口径

- 单元/集成：`npm test`；浏览器 E2E：`npm run test:e2e`（配 `PW_CHROMIUM_EXE`）。
- 真实链路：`test/integration/real-daemon.spec.ts` + `test/helpers/real-daemon-readonly-fixture.mjs`（默认跳过，须受控真实 daemon）。
- 读数为局部证据（如 [web-tech-debt §2.2](web-tech-debt-2026-10-24.md)：typecheck 0、lint/format rc=0、123 通过 + 1 门控跳过、构建 rc=0、E2E 13/13）；**不升级为部署/安全验收**。

## 6. 与其它端的差异

| 对比点 | Web 端 | 参照端 |
|---|---|---|
| 前端技术 | Vue 3 + TS + Vite（浏览器 ESM 正常，构建期编译模板） | 桌面同技术但受 CSP/无 ESM 约束；CLI 终端；移动 Kotlin |
| 后端路径 | 同源 BFF → daemon → Host/core | 桌面主进程 → 本地宿主；CLI 直连 core/Host；移动 → daemon |
| 身份 | 浏览器登录身份 + 服务端 daemon 设备 credential（两层） | 桌面/CLI 本机用户；移动设备档案 + daemon credential |
| 安全面 | Origin/CSRF/HttpOnly cookie/CSP/同源；BFF 不裸露 Host | 桌面靠 Electron IPC 有限集 + 沙箱；CLI 靠本机用户 |
| 开放度 | 首发只读三方法；任务/审批未开放 | 桌面/CLI 能力面更全 |
| 交付 | 同源可追溯服务包（W04 未实现） | 桌面 electron-builder；CLI npm；移动 APK |

结论：Web 端是**安全设计优先**的端，与移动端共享 daemon 后端与部分安全修复，但浏览器认证、网络限制与交付**独立验收**；它与移动端都不复制后端，只做受限映射。