# SaCode Web 技术选型（W01-T）

> 日期：2026-10-23。状态：选型提案，待确认；不是已安装、已实现或已验收声明。
> 基线：HEAD `a0b16c38a1147708f2ef75302695092f3d3ed833`，工作树含其他会话未提交改动。
> 关联：[Web 工作台架构与实施方案](2026-10-23-web-workbench-architecture.md)、[Web 部署方案初稿](2026-10-22-web-deployment-design.md)。
> 本轮只新增文档；未创建 `apps/web` 工程、未安装依赖、未启动服务、未改业务代码、未提交或推送。
> 版本号来自 2026-10-23 `npm view` 的只读查询，是候选锁定值，不是已安装事实；W01 安装后以 `package-lock.json` 为准。

## 1. 结论

| 层次 | 选择 | 候选版本 | 一句话理由 |
|---|---|---|---|
| 浏览器运行时 | Vue 3 + TypeScript | `vue@3.5.44`、`typescript@5.9.3` | 与桌面同代，可移植纯逻辑；SFC + 正常 ESM，不受 Electron `file://` 约束 |
| 前端构建 | Vite | `vite@8.3.5`、`@vitejs/plugin-vue@6.0.10` | 静态 SPA 足够，构建快，与 Vitest 同生态 |
| 路由 | vue-router | `vue-router@4.6.4` | 成熟主版本；首版不需要 file-based routing 的新特性 |
| 状态 | Pinia | `pinia@3.0.4` | 会话/事件/审批状态集中，Devtools 可观察；避免自造全局单例 |
| 基础组件 | TinyVue 按需引入 | `@opentiny/vue@3.32.0` | 与桌面同版本线；只取表单/按钮/弹层，不整体搬运 |
| 消息与 Markdown | 自研消息面 + `markdown-it` + `shiki` | `markdown-it@15.0.3`、`shiki@4.5.0` | 复用桌面低信任渲染规则；升级到修复 S05 的主版本 |
| BFF 运行时 | Node.js 22 LTS | `>=22.12 <23`（本机 22.23.2） | 满足 Vite 8 / undici 8；与仓库现有 Node 测试一致 |
| BFF 框架 | Fastify | `fastify@5.12.7` | 原生 JSON Schema 校验、pino、SSE raw、`inject()` 测试 |
| 校验与类型 | TypeBox + 官方 type provider | `@sinclair/typebox@0.34.52`、`@fastify/type-provider-typebox@6.3.0` | 一份 Schema 同时做运行时校验与 TS 类型，避免双份漂移 |
| 口令哈希 | Argon2id | `@node-rs/argon2@2.2.2` | 预编译、无 node-gyp；参数按 OWASP 基线实测后冻结 |
| 上游客户端 | 复用桌面 `RemoteTransport` | 源码复用 + 新增 `.d.ts` | 已有 TLS pin/CA、并发上限、超时、epoch、SSE、幂等键 |
| HTTP 客户端依赖 | undici | `undici@8.12.3` | `RemoteTransport` 需要可注入 Agent；先验证兼容，失败回退 6.29.0 |
| 日志 | pino | `pino@10.4.0` | Fastify 内置，结构化 + redact |
| 单元/集成测试 | Vitest + Vue Test Utils | `vitest@4.1.12`、`@vue/test-utils@2.5.1` | 与 Vite 同配置；`jsdom@30.1.3` 提供 DOM |
| 端到端 | Playwright | `playwright@1.64.1` | 真实浏览器验证 cookie/CSRF/SSE；W02-A 起至少一条 |
| 反向代理 | Caddy 2 | 部署时固定 | 自动 HTTPS、SSE 反代简单；已有 Nginx 的环境按 Nginx 配置 |

**一句话：Vue 3 + Vite 8 + Fastify 5 + TypeBox + 不透明服务端会话 + SSE，复用 daemon 与 `RemoteTransport`，不新造任务/审批/幂等真源。**

## 2. 选型判据

按优先级排序，后项不得推翻前项：

1. **不扩大信任边界**：浏览器只持 HttpOnly cookie；daemon 凭据只在 BFF；不提供通用 RPC/代理/任意 URL。
2. **不复制业务真源**：会话日志、审批、取消、幂等、任务终态仍归 core/Host/daemon；BFF 只做收窄映射。
3. **可验证**：每个选择都能用现有测试风格（`node --test` 或 Vitest）与真实 daemon 做反例验证。
4. **可部署**：单机自托管优先，不因首版引入 Redis、消息队列、Kubernetes 或第二套服务端运行时。
5. **可维护**：与桌面 Vue 资产同代；依赖有明确许可证与维护状态；首版不追最新大版本。
6. **可回退**：关键依赖（undici、TinyVue、markdown-it）保留降级路径并写进 W01 验证清单。

## 3. 前端选型

### 3.1 框架与构建

- **Vue 3.5 + `<script setup>` + TypeScript**：桌面 renderer 已是 Vue 3 runtime；消息投影、队列状态、Markdown 规则等纯逻辑可小范围移植。Web 端用 SFC 与正常 ESM，不复制 Electron 的 `h()` 运行时约束。
- **Vite 8**：只做静态构建，产物交给 Fastify `@fastify/static` 同源提供。不使用 SSR/SSG，不引入 Next/Nuxt。
- **TypeScript 5.9.3**：首版锁定成熟主线。TypeScript 7（原生编译器）不在首个 PoC 引入，避免 `vue-tsc`、ESLint 类型规则与编辑器插件适配风险；W03 再单独评估。
- **严格模式**：`strict`、`noUncheckedIndexedAccess`、`exactOptionalPropertyTypes` 开启；前端与 BFF 各自 `tsconfig`，共享类型放 `src/shared/`，禁止 BFF 代码被打进浏览器 bundle。

### 3.2 路由与状态

- **vue-router 4.6**：使用 `createWebHistory`；同源部署下由 Fastify fallback 到 `index.html`。不使用 hash 路由，避免把会话 ID 放进 URL 片段。
- **Pinia 3.0**：按域拆 `auth`、`targets`、`sessions`、`events`、`approvals` 五个 store；禁止把 daemon token、cookie 值或 CSRF token 放进 store 的持久化插件。
- **不引入 Pinia 持久化插件**：刷新后通过 `GET /api/auth/session` 重新取会话与 CSRF token；会话真源在服务端。

### 3.3 组件与样式

- **TinyVue 按需引入**：只使用 Button、Input、Select、Tabs、Modal、Tooltip、Loading 等基础控件；通过 `unplugin-vue-components` 或显式 import 控制包体。首版不引入 TinyRobot：桌面那套 Bubble 组件依赖构建期折叠与特定 Vue 实例，Web 端直接搬会引入两套响应式系统。
- **消息面自研**：消息列表、工具调用折叠、审批卡片用 Vue 组件重写，复用桌面的纯函数（消息行投影、折叠阈值、状态文案）而不是复制 DOM 结构。
- **样式**：原生 CSS + CSS 变量 token，复用桌面 `renderer/styles` 的颜色/间距/字体变量；不引入 Tailwind/UnoCSS。理由：与桌面视觉一致、无额外构建链、首版界面规模可控。若后续建立独立设计系统，再评估 Tailwind 4。
- **图标与字体**：复用 `apps/desktop/renderer/assets` 中已入库的图标；字体使用系统字体栈，不加载外部 CDN，避免 CSP 与隐私问题。

### 3.4 Markdown 与代码高亮

- **markdown-it 15.0.3**：`html:false`、`linkify:false`、`breaks:false`；禁用外部图片自动加载；危险 scheme（`javascript:`、`data:`、`file:`）在渲染前拒绝。S05 的 200KB 病理输入基准必须在 W01 复跑，确认 15.x 已修复；未复测前不关闭安全审查中的 S05。
- **shiki 4.5**：只在消息含代码块时懒加载语言包；限制首版语言集（ts/js/json/shell/python/cangjie/rust/go/java），不做全语言打包。Web 端直接 ESM 引入，不使用桌面的构建期折叠脚本。
- **不使用 `v-html` 渲染模型输出**；Markdown 解析结果按 token 构造 Vue 节点，与桌面 `markdown.js` 的边界一致。

### 3.5 前端目录（拟建）

```text
apps/web/
  index.html
  package.json
  package-lock.json
  tsconfig.json
  tsconfig.client.json
  tsconfig.server.json
  vite.config.ts
  src/
    main.ts
    App.vue
    router.ts
    api/            # 只调用 BFF 固定动作，不含 daemon 方法名
    stores/
    components/
    pages/
    shared/         # 前后端共享的纯类型与常量（不含 Node API）
    styles/
  server/           # Fastify BFF，见 §4.5
  test/
    unit/
    integration/
    e2e/
  deploy/
    Caddyfile.example
    sacode-web.service.example
```

## 4. BFF 选型

### 4.1 运行时与框架

- **Node.js 22 LTS**：`package.json` 写 `"engines": { "node": ">=22.12 <23" }`，并提交 `.node-version`（`22.23.2`）。不依赖 Electron 内置 Node。
- **Fastify 5.12**：注册 `@fastify/static`（静态资源）、`@fastify/cookie`（会话 cookie）、`@fastify/helmet`（CSP/安全头）、`@fastify/rate-limit`（登录与动作限流）。
- **SSE 用 `reply.raw`**：设置 `Content-Type: text/event-stream`、`Cache-Control: no-store`、`X-Accel-Buffering: no`，手动 `write` 帧；不引入 WebSocket 库。
- **优雅停机**：`SIGTERM`/`SIGINT` 时停止接受新请求、关闭浏览器 SSE、等待在途 RPC 有界超时、关闭上游 `RemoteTransport`；不把“进程退出”当作任务取消。

### 4.2 校验与类型

- **TypeBox**：每个对外动作定义 `Type.Object`，Fastify 路由用 `schema.body/querystring/params/response`；TS 类型用 `Static<typeof Schema>`。
- **拒绝额外字段**：所有对象 schema 设 `additionalProperties: false`；未知动作在路由层 404，不进入 daemon。
- **响应白名单**：不对上游结果做 `...spread` 全量透传；逐字段挑选并做长度/数量上限。上游新增字段不会自动出现在浏览器。

### 4.3 浏览器会话与 CSRF

- **会话存储**：进程内 `Map<sessionId, SessionRecord>`，TTL 30 分钟闲置 / 8 小时绝对过期；活动定义排除 SSE 心跳。BFF 重启即失效，用户重新登录；这是明确策略，不是缺陷。
- **session ID**：32 字节随机，base64url；只在服务端保存映射，cookie 只存不透明 ID。
- **Cookie**：
  - 生产 HTTPS：`__Host-sacode_session`，`Secure`、`HttpOnly`、`SameSite=Strict`、`Path=/`、无 `Domain`。
  - 本地开发：`sacode_dev_session`，仅 `127.0.0.1`，不设 `Secure`；不得在非回环地址使用该名称。
- **CSRF**：登录成功后在会话记录里生成 32 字节 token，登录响应体返回；前端只存内存，写请求带 `X-CSRF-Token`。服务端做定长比较。
- **Origin 与 Fetch Metadata**：写请求要求 `Origin` 精确等于配置的 `SACODE_WEB_ORIGIN`；`Sec-Fetch-Site` 只接受 `same-origin`/`none`；缺失 Origin 的非浏览器客户端也拒绝。
- **登录限流**：按“账号 + 来源 IP”滑动窗口，5 次/15 分钟；成功后清零；不采用永久锁定，避免恶意锁死。
- **口令**：Argon2id，初始参数 `memoryCost=19456 KiB`、`timeCost=2`、`parallelism=1`；W01 在本机与目标部署机各测一次，单次验证目标 100–300ms，超出则调整并记录。口令哈希文件权限非 Windows 0600、Windows 仅当前用户；BFF 启动时检查，不自动改 ACL。

### 4.4 限额、日志与错误

- **请求体**：BFF 全局 256 KiB；登录 8 KiB；事件分页 16 KiB。
- **响应**：普通 JSON 1 MiB；SSE 单帧 256 KiB；会话事件单页最多 500 条。
- **上游并发**：沿用 `RemoteTransport` 的每 target 8 RPC / 2 SSE；BFF 对同一 target 只建一条上游 SSE，向浏览器 fan-out。
- **浏览器订阅**：每会话最多 2 条 SSE；慢客户端 30 秒写不出去即断开并提示用游标补读，不阻塞其他订阅者。
- **日志**：pino，`redact` 覆盖 `req.headers.authorization`、`req.headers.cookie`、`res.headers["set-cookie"]`、`x-csrf-token`、`password`、`token`、`credential`；不记录提示词正文、工具输出正文和会话事件正文。
- **错误**：对外只回稳定错误码（`unauthorized`、`forbidden-origin`、`csrf-invalid`、`target-unavailable`、`upstream-timeout`、`rate-limited`），不回显上游原始错误、路径、凭据引用或堆栈。

### 4.5 BFF 目录（拟建）

```text
apps/web/server/
  index.ts          # Fastify 装配、优雅停机
  config.ts         # 环境变量、targets 文件、权限检查
  auth/
    session.ts      # 内存会话、TTL、轮换
    password.ts     # Argon2id 校验
    csrf.ts
  routes/
    auth.ts
    targets.ts
    sessions.ts
    events.ts
  daemon/
    transport.ts    # RemoteTransport 适配与 .d.ts
    policy.ts       # 动作白名单、资源绑定
    mapper.ts       # 上游结果 -> 浏览器字段
  events/
    broker.ts       # 单上游订阅、fan-out、环形缓冲
  security/
    origin.ts
    limits.ts
    redact.ts
```

## 5. 与 daemon / 桌面的复用边界

| 资产 | 用法 | 禁止 |
|---|---|---|
| `apps/desktop/remote-transport.mjs` | BFF 直接相对导入；新增 `remote-transport.d.ts` 描述 `sendRequest`/`subscribeNotifications`/`getLastEventId`/`bumpEpoch`/`close` | 不复制实现；不改成第二套行为；不在浏览器打包 |
| `apps/desktop/tls-pin.cjs` | 由 `RemoteTransport` 内部使用；BFF 只传 `caCertificates`/`instanceFingerprint` | 不关闭证书校验；不允许 `rejectUnauthorized:false` |
| `apps/desktop/host-bridge.cjs` | 只作为分帧/超时参考 | BFF 不 spawn Host，不开放 NDJSON |
| 桌面 renderer 纯逻辑 | 消息行投影、折叠阈值、状态文案按需移植为 TS | 不复制 Electron IPC、`h()` 视图和构建期折叠 |
| `docs/plans/remote-capability-contract.json` | Web 动作准入的上游依据之一 | 不把 `clientConsumers` 现有名单当 Web 授权；W01 增加 `web` 消费登记并跑契约测试 |

**上游方法白名单**：BFF 只允许调用 W02-A 实际需要的只读方法（`initialize`、`session/catalog`、`session/events` 等，以当前源码为准），不提供 `{ method, params }` 透传。W03 才逐项增加 `session/create`、`task/start`、`approval/*`、`turn/cancel`，每项都要有独立授权、资源绑定和反例测试。

**版本兼容验证**：`RemoteTransport` 当前在桌面 `undici@6.29.0` 上工作；BFF 显式依赖 `undici@8.12.3`。W01 必须重跑桌面对应的传输测试（TLS pin、重定向拒绝、并发上限、SSE 补读、幂等键）。若 undici 8 行为不兼容，回退 `6.29.0` 并在选型文档登记风险，不静默改传输逻辑。

## 6. 数据与事件

- **浏览器不直连 daemon**：不暴露 daemon 地址、token、target 凭据；浏览器只认 BFF 的 `/api/*`。
- **事件链路**：BFF 每 target 一条上游 SSE → 解析为内部事件 → 按授权过滤 → fan-out 给浏览器订阅者；环形缓冲只做加速，持久补读仍走 `session/events`。
- **游标**：对外使用 BFF 生成的不透明游标（含 target、session、上游 event id、generation），浏览器不能伪造跨会话游标；游标过期返回 `cursor-expired`，前端重新拉取目录与历史。
- **多标签页**：同一浏览器会话的多个标签页共享 BFF 的上游订阅与读取协调；不按标签页各建一条上游 SSE，不各自消费 `turn/poll`。
- **`turn/poll` 禁用**：W02-A 不调用；W03 在“后端可寻址 turn 所有权/持久读取”解决前保持关闭。BFF 不自建完成账本。
- **断线语义**：关闭页面只结束订阅，不取消任务；`cancelRequested` 不是终态；未知态显示 `unknown`，不自动重发写操作。

## 7. 测试选型

| 层 | 工具 | 首版要求 |
|---|---|---|
| 前端单元 | Vitest + Vue Test Utils + jsdom | store、Markdown 危险 scheme、消息折叠、API 错误映射 |
| BFF 单元 | Vitest | 会话 TTL、CSRF、Origin、限流、字段白名单、游标编解码 |
| BFF 集成 | Vitest + `fastify.inject()` | 未登录/错误 Origin/缺 CSRF/超大请求/未知动作全部拒绝 |
| 真实 daemon | Vitest 或 `node:test` + 现有 spawn 夹具 | 登录 → targets → sessions → events 只读链；断线补读 |
| 浏览器 E2E | Playwright | 登录、刷新恢复、SSE 断线重连、慢客户端提示；W02-A 至少一条（2026-10-23：登录→刷新恢复 E2E 已跑通 1 passed；SSE 断线重连/慢客户端提示待 W02-B） |
| 安全反例 | 上述组合 | 越权 target、跨会话游标、token 泄露、SSE 绕过、并发重复 operationId（W03） |

- 不引入 Jest（与 Vite/ESM 配置重复）、不引入 Cypress（Playwright 已覆盖）。
- BFF 集成测试不 mock `RemoteTransport` 的全部行为：至少一条用真实 daemon 回环，其余用显式 fake 验证错误分支。
- 测试不得读取真实用户凭据；使用隔离目录、合成口令与回环假服务。

## 8. 构建与部署

### 8.1 开发

- `npm run dev`：Vite dev server（默认 5173）+ BFF（默认 18787），Vite `server.proxy` 把 `/api` 转到 BFF，保持同源。
- `npm run build`：`vite build` 输出 `dist/client`；`tsc -p tsconfig.json` 输出 `dist/server`。
- `npm start`：`node dist/server/server/index.js`（`tsc` 以 `rootDir: "."` 镜像目录结构，产物落 `dist/server/server/`），Fastify 同时提供 `dist/client` 与 `/api`。
- 不使用 `ts-node`/`tsx` 作为生产运行时；生产只跑编译后的 JS。

### 8.2 生产拓扑

```text
浏览器 --HTTPS--> Caddy --127.0.0.1:18787--> BFF --HTTP(S)--> daemon
                                             └-- 静态 dist/client
```

- BFF 默认只监听 `127.0.0.1`；`SACODE_WEB_BIND` 若设为非回环地址，启动直接拒绝（首版不提供无 TLS 的公网监听）。
- Caddy 负责 TLS、HSTS、请求体上限与超时；SSE 路径关闭缓冲。
- 服务管理：Linux 提供 `sacode-web.service` 示例（`Restart=on-failure`、独立用户、`NoNewPrivileges=true`、只读系统目录）；Windows 在 W04 提供服务工作包说明，首版可用计划任务前台运行。
- 不引入 Docker 作为首版唯一交付方式；容器化在 W04 单独评估。

### 8.3 配置项

| 变量 | 默认 | 说明 |
|---|---|---|
| `SACODE_WEB_BIND` | `127.0.0.1` | 非回环值启动拒绝 |
| `SACODE_WEB_PORT` | `18787` | BFF 端口 |
| `SACODE_WEB_ORIGIN` | 无（必填） | 精确 Origin，如 `https://sacode.example.com` |
| `SACODE_WEB_TARGETS_FILE` | 无（必填） | 目标与凭据引用配置，权限 0600 |
| `SACODE_WEB_AUTH_FILE` | 无（必填） | 口令哈希与账号配置，权限 0600 |
| `SACODE_WEB_SESSION_IDLE_MS` | `1800000` | 30 分钟闲置 |
| `SACODE_WEB_SESSION_ABSOLUTE_MS` | `28800000` | 8 小时绝对 |
| `SACODE_WEB_LOG_LEVEL` | `info` | pino 级别 |

- `targets` 文件只存 target ID、daemon base URL、CA/pin、credential 引用；真实凭据从环境或受保护文件读取，不写进仓库、不返回浏览器。
- 配置缺失或权限不符时启动失败并输出稳定错误码，不降级为无认证运行。

## 9. 版本与许可证

| 依赖 | 候选版本 | 许可证 | 备注 |
|---|---|---|---|
| Node.js | 22.23.2（engines `>=22.12 <23`） | MIT | 运行时 |
| vue | 3.5.44 | MIT | 与桌面 3.5.43 同 minor |
| vite | 8.3.5 | MIT | 要求 Node `^20.19 || >=22.12` |
| @vitejs/plugin-vue | 6.0.10 | MIT | |
| typescript | 5.9.3 | Apache-2.0 | 不用 7.0.2 作为首版 |
| vue-tsc | 3.3.13 | MIT | 类型检查 |
| vue-router | 4.6.4 | MIT | 不用 5.4.0 作为首版 |
| pinia | 3.0.4 | MIT | 不用 4.1.0 作为首版 |
| @opentiny/vue | 3.32.0 | MIT | 按需引入 |
| markdown-it | 15.0.3 | MIT | 需复跑 S05 基准 |
| shiki | 4.5.0 | MIT | 按需语言包 |
| fastify | 5.12.7 | MIT | |
| @fastify/static | 10.1.7 | MIT | |
| @fastify/cookie | 11.1.3 | MIT | |
| @fastify/helmet | 13.2.0 | MIT | |
| @fastify/rate-limit | 11.2.1 | MIT | |
| @sinclair/typebox | 0.34.52 | MIT | |
| @fastify/type-provider-typebox | 6.3.0 | MIT | |
| @node-rs/argon2 | 2.2.2 | MIT | 预编译；无预编译平台回退 `hash-wasm` |
| undici | 8.12.3 | MIT | 兼容失败回退 6.29.0 |
| pino | 10.4.0 | MIT | Fastify 内置 |
| vitest | 4.1.12 | MIT | 支持 Vite 8 |
| @vue/test-utils | 2.5.1 | MIT | |
| jsdom | 30.1.3 | MIT | |
| playwright | 1.64.1 | Apache-2.0 | 仅测试依赖 |

- 生产依赖与开发依赖分开；Playwright、Vitest、jsdom 不进生产包。
- W01 用 `npm ls --omit=dev` 与许可证扫描核对传递依赖；发现 GPL/AGPL 运行时依赖即停止并替换。
- 所有依赖写精确版本（`.npmrc` 设 `save-exact=true`），提交 `package-lock.json`；不使用 `^` 漂移。
- 安全审查已登记 `electron@33.4.11` 与 `markdown-it@14.3.2`；Web 端不引入 Electron，markdown-it 升到 15.x 后仍需复测 S05，不能只凭版本号关闭。

## 10. 明确不选

| 方案 | 不选原因 |
|---|---|
| WebSocket 直通 Host / 通用 JSON-RPC 透传 | 旧初稿的风险面：任意方法暴露、进程与会话边界错误；BFF 只提供有限动作 |
| 浏览器直连 daemon | 需要把 daemon token 放进浏览器；CORS、自签证书 pin、SSE 认证都更复杂，且无法隐藏内部地址 |
| Next.js / Nuxt SSR | 首版是登录后工作台，无 SEO/SSR 需求；引入第二套服务端模型、构建链与攻击面 |
| React | 与桌面 Vue 资产复用低；团队与现有组件一致性差 |
| Tailwind / UnoCSS | 与桌面 CSS 变量体系冲突；首版界面规模不足以抵消新构建链 |
| TinyRobot 整体搬运 | 桌面依赖构建期折叠与特定 Vue 实例；Web 直接引入易出现双 Vue 响应式 |
| JWT 无状态会话 | 无法即时撤销、登录轮换与闲置过期；需额外黑名单，复杂度更高 |
| localStorage / sessionStorage 存 token | XSS 可直接读取；只使用 HttpOnly cookie |
| Redis / 外部会话存储 | 单实例自托管不需要；增加部署依赖与凭据面。多实例明确不在首版范围 |
| Jest / Cypress | 与 Vite/ESM 或现有 Playwright 选型重复 |
| TypeScript 7 / Vite 之外的实验性构建器 | 首版优先工具链稳定与可复现；新主版本留待 W03 评估 |

## 11. 待确认决策

| 编号 | 决策 | 推荐 | 备选 | 影响 |
|---|---|---|---|---|
| T1 | 基础组件库 | TinyVue 3.32 按需 + 自研消息面 | 纯自研；TinyRobot | 影响首版 UI 速度与包体；不影响安全边界 |
| T2 | TypeScript 版本 | 5.9.3 | 7.0.2 | 影响 `vue-tsc`/ESLint/编辑器兼容 |
| T3 | E2E 时机 | W02-A 起至少一条 Playwright | 推迟到 W03 | 影响 cookie/CSRF/SSE 的真实浏览器证据 |
| T4 | 反向代理 | Caddy 2 | Nginx；仅 Node TLS | 影响部署文档与 TLS 责任 |
| T5 | `RemoteTransport` 复用 | 直接相对导入 + `.d.ts` | 抽 `packages/remote-client` 共享包 | 抽包更干净，但要改桌面构建与测试，首版风险更高 |
| T6 | 登录方式 | 本地口令（Argon2id） | 预留 OIDC | OIDC 需要额外 client 注册、回调与 token 校验 |

未确认前，W01 只做不依赖这些分歧的骨架（目录、tsconfig、配置加载、测试框架），不先写 UI 组件或认证实现。

## 12. W01 落地清单（选型确认后）

> 前置：§13 的跨端判据与 P0 阻塞。P0-1～P0-5 未闭合前，W01/W02-A 只做只读面，不开放任务、审批与任意文件路径。

1. 建 `apps/web` 工程：`package.json`、`package-lock.json`、`tsconfig.*`、`vite.config.ts`、`.npmrc`。
2. 锁定依赖并跑 `npm ls --omit=dev`、许可证扫描、`npm audit --package-lock-only`（只读元数据，不自动 fix）。
3. BFF 骨架：Fastify 装配、配置加载与权限检查、`/api/healthz`、优雅停机。
4. 认证最小面：登录/退出/会话查询、Argon2id 校验、内存会话、CSRF、Origin/Fetch Metadata 校验、登录限流。
5. 只读动作：targets、sessions、session detail、events；TypeBox schema + 响应白名单。
6. 上游适配：`RemoteTransport` 相对导入 + `.d.ts`；单 target 单订阅；undici 8 兼容测试。
7. 事件 broker：环形缓冲、游标、fan-out、慢客户端断开、补读。
8. 测试：单元 + `inject()` 集成 + 一条真实 daemon 只读链 + 一条 Playwright 登录/刷新。
9. **不做**：`task/start`、`approval/answer`、`model/list`、任意文件路径、通用 RPC、插件/终端/凭据管理。

### W02-A 验收出口

- 未登录 401；错误 Origin 403；缺 CSRF 403；cookie 属性符合 §4.3。
- 登录后能看到真实 daemon 的会话目录与持久历史；刷新后仍可恢复（cookie 未过期时）。
- SSE 断线后按游标补读；慢客户端被断开且不影响其他订阅者。
- BFF 重启后旧 cookie 失效，需重新登录；已运行任务不被误报取消。
- 浏览器、日志、错误响应中不出现 daemon token、target 凭据、真实路径或提示词正文。

> **证据（2026-10-23）**：W01/W02-A PoC 已落地 `apps/web`。BFF 安全面与**合成 daemon** 只读链路 fully tested——49 单元/集成测试全过、双端 typecheck 0 error、独立运行冒烟 7 项全过、真实浏览器 Playwright E2E 1 passed（登录→进入工作台→刷新恢复登录态）。上述出口中「未登录 401 / 错误 Origin 403 / 缺 CSRF 403 / cookie 属性 / 字段白名单 / 跨会话游标拒绝」均已用例覆盖。
> 但「登录后能看到**真实 daemon** 的会话目录与持久历史」与「SSE 断线按游标补读」两项依赖真实 daemon 链，受 P0-3（S11 资源身份未修）/ P0-4（SSE 授权未复测）/ web consumer 未在 `remote-capability-contract.json` 登记三道闸门约束，**未验证**；`real-daemon.spec.ts` 默认 skip。故 W02-A 出口中真实 daemon 相关项**未闭合**，不声称「各端打通」。完整读数见 [`../evidence/2026-10-23-web-w01-w02a-poc.md`](2026-10-23-web-w01-w02a-poc.md)。

## 13. 跨端契约与验收矩阵（W01 前置约束）

> 2026-10-23 追加。用户确认「各端都可以打通」是 Web 工作的前提。本节只记录源码核对结果与验收口径，**不改** `remote-capability-contract.json`、**不改**现有测试、**不改** daemon/CLI/移动端源码。

### 13.1 「打通」的判定标准

不是「每个端都能连上一个 daemon」，而是以下 7 条同时成立：

1. **同一身份链**：`/auth/enroll` → `/auth/token` → 每请求 `Authorization: Bearer`。匿名或旁路只允许显式配置的本机未启用接入模式，且不能作为远程验收。
2. **同一传输**：`POST /rpc` JSON-RPC 2.0 + `GET /sse`；TLS 证书链校验或显式 CA/pin，不允许 trust-all。
3. **同一方法真源**：`docs/plans/remote-capability-contract.json` 登记与 `initialize` 宣告一致；客户端不得另存一份「我认为能调」的清单。
4. **同一资源身份**：`workspaceId`/`sessionId` 必须指向实际存在的活动资源；不存在的 ID 不能退化成「当前会话」。
5. **同一事件恢复**：SSE `Last-Event-ID` + `session/events` 游标补读；重连不丢、不重、不跨会话。
6. **同一取消与终态**：`turn/cancel` 只表达请求；终态由 `turn/poll` 结算；任一端取消，其他端看到同一终态。
7. **同一幂等**：写操作带 `operationId`；同一键重试只产生一次副作用，in-flight 期间不重复执行。

A/B 两端对同一 daemon、同一 workspace/session 的固定验收动作：

```text
登录 → 目录 → 历史 → A 发起任务 → B 看到流式 → B 审批
→ A 看到结果 → 任一方取消 → 双方同一终态
→ 双方断线重连 → 同一 operationId 重试只生效一次
```

在上述动作有真实 daemon 证据前，只能写「可连接/可只读」，不能写「各端打通」。

### 13.2 各端当前真实链路

| 端 | 认证 | 传输/TLS | 客户端实际能发的方法 | 事件恢复 | 现有证据 | 主要阻断 |
|---|---|---|---|---|---|---|
| 桌面 | `RemoteTransport` 每请求 Bearer，token 由 `tokenProvider` 注入（`apps/desktop/remote-transport.mjs:105-141`） | HTTPS；CA/pin；并发上限 | 本地 target 走 Host 全量（受 Host 权限策略）；远程 target 受 daemon gate | SSE + `getLastEventId()` 带 `Last-Event-ID`（`remote-transport.mjs:189-206`） | 合成 Node HTTP 集成测试（`apps/desktop/test/remote-transport-*.test.mjs`）；真实 daemon 端到端未登记 | scope 授予面、`turn/poll` 排他、S11 |
| CLI | **无**。固定 `http://127.0.0.1:<port>`，不带 `Authorization`（`apps/cli/src/remote.cj:321-334`） | **无 TLS**；SSE 同样无认证（`remote.cj:413-428`） | `rpc` 是通用透传；闭集动词登记 8 条契约方法 | **无** `Last-Event-ID` 补读，SSE 只打印 | `apps/cli/test/remote.test.mjs` 对合成 HTTP 服务器 | 不能接保护态 daemon；接入后 `task/start` 还会被 scope 拒 |
| 移动 | `/auth/enroll`、`/auth/token`、Bearer（App 侧 `RemoteAuthRepository.kt`；旧 JVM 客户端 `CredentialStore.kt` 同流程） | HTTPS + TLS pin（`SecureTransport.kt`） | 客户端只允许 `initialize`、`session/catalog`、`session/events` 三条只读（`DaemonTransport.kt:66`） | SSE `Authorization` + `Last-Event-ID`（`RemoteEventSubscription.kt:27-52`） | `apps/daemon/test/remote-mobile-client.test.mjs` 真实 daemon + JVM 客户端；App 侧未设备级验收 | 无任务/审批；契约登记 84 条与客户端 3 条不一致 |
| Web | 未建。计划 BFF 持 daemon 凭据，浏览器只拿 HttpOnly cookie | 计划复用 `RemoteTransport` | 0 条 | 计划 BFF 单上游订阅 + fan-out | 无 | 工程未建；W01/W02-A 受 P0-3、P0-4 影响 |

**契约字段的实际效力**：

- `clientConsumers` 只被契约测试校验枚举（`apps/daemon/test/remote-capability-contract.test.mjs:12` 仅允许 `desktop/mobile/cli`），daemon 装载契约时不读取它（`apps/daemon/src/remote_access.cj:440-477` 只读 method/permission/resourceKeys/durable）。
- `initialize` 宣告的是 daemon 自有 3 条 `INIT_CAPS` + 宿主代理白名单 + 团队能力（`apps/daemon/src/daemon.cj:403-418`），不等于某个客户端的实际 allowlist。
- 因此「契约里有」≠「该端能调」，消费者名单不能作为准入或封闭证据；Web 加入前必须先明确该字段语义。

### 13.3 能力矩阵

图例：✅ 有源码且有合成/真实 daemon 证据；◐ 部分或仅源码；❌ 当前不可用；— 不适用。括号内是实际证据级别，不把「源码存在」当「已验证」。

| 能力 | 桌面 | CLI | 移动 | Web |
|---|---|---|---|---|
| 设备登记/换 token | ◐ token 由 target 配置注入，仓库内无 enroll 流程 | ❌ 无 | ✅ 真实 daemon 测试 | 计划由 BFF 持有；未建 |
| `initialize`/目标发现 | ✅ | ✅ | ✅ | 计划 W01 |
| 会话目录 | ✅ | ✅ | ✅ | 计划 W02-A |
| 历史投影/分页 | ✅ | ◐ 仅 SSE 直播，无补读 | ✅ | 计划 W02-A |
| 发起任务 | ❌ 保护态 daemon 被 scope 拒；本机 target ✅ | ❌ 无 Bearer + scope | ❌ 客户端不发 | 计划 W03，先修 P0 |
| 审批 | ❌ 同上 | ❌ 无通道 | ❌ | 计划 W03 |
| 取消 | ◐ `turn/cancel` 本身只需 write，但需先能发起任务 | ◐ 同上，且无 Bearer | ❌ 未实现 | 计划 W03 |
| 断线恢复 | ✅ | ❌ | ✅ | 计划 W02-A |
| 幂等重试 | ✅ `operationId` | ◐ 可透传，但未跑保护态 | ✅ | 计划 W03 |
| 多客户端同会话 | ❌ | ❌ | ❌ | — 未建 |

### 13.4 先行修复项（按阻塞顺序）

> 安全审查证据基于旧 HEAD `1eb66e9`；当前 HEAD 为 `a0b16c3`，其中 S08/S09 已出现修复代码。下列每项标明「审计事实」「当前源码」「是否闭合」，未复测的一律不标已修。

#### P0-1 scope 授予面缺失（阻断所有任务/审批）

- **事实**：`DeviceAuthzView` 的 scope 来自 `AuthenticationContext.scopes`（`core/src/remote_authorization.cj:71-90`）；`RemoteIdentityStore.grantScope` 存在（`core/src/remote_identity.cj:294`），但**生产代码无调用**，只有 `*_test.cj`；`apps/daemon/src/remote_management.cj:9-16` 明确写「不建 scope 的来源」。
- **影响**：`execute/approval/management` 方法对所有远程设备恒拒 `scope-required`。桌面远程 target、CLI `task/start`、移动未来任务面、Web W03 全部无法开始。
- **验收**：本机受保护管理入口（或一次性授权流程）能显式授予/撤销 scope；授予后 `task/start`、`approval/answer` 在真实 daemon 通过；撤销后立即拒绝；审计记录 deviceId、scope、操作者，不记录凭据。
- **2026-10-24 状态**：**授予面已闭合（daemon 级 31/31）**——`--manage grant-scope` 闭集授予（`execute`/`approval`/`management`，撤销仍走 `revoke-device` 设备级）、`list-devices` 五列 scopes、运行中 daemon 经 `refreshFromDisk` 吸收、management scope 真实管理动作通过。剩余缺口：`execute` scope 端到端 `task/start` 仍被沙箱门禁拒绝（`remote-execution-gate.test.mjs` 钉住），W03 开放前需该链路真实证据。见[证据](../../evidence/2026-10-24-p0-cross-end-gates.md)。

#### P0-2 `turn/poll` 多客户端消费冲突

- **事实**：Host 的 `turnSink.take(64)` 是排他取帧；结算后清 `turnHandle`（`apps/host/src/main.cj:2905-2960`）。
- **影响**：桌面 + Web/移动同开同一会话会互相偷帧；后到者可能永远看不到终态。BFF 无法用「每浏览器一条 SSE」绕过。
- **方向**：daemon 侧按客户端游标/租约提供幂等读取，或明确单写者 + 只读广播；解决前 Web 不开放任务。
- **验收**：两端同时订阅，同一 turn 的帧集合一致、终态一致；重复 poll 不改变结果；一端取消后两端同一终态。
- **2026-10-24 状态**：**Host 级已闭合**——core `TurnFrameJournal`（page 不消费、take 兼容旧消费、cap 4096 满时计 gap）、`turn/poll` 游标双路径 + `nextCursor`/`turnId`/`gap`/`reset`；验收用例「双客户端同轮重复读帧集合逐字一致、重复读不消费、取消后两端同终态」通过。剩余缺口：daemon SSE 多设备扇出链路复测依赖 P0-4（openssl 环境阻断）。

#### P0-3 资源身份绑定（S11）

- **事实**：`RemoteRequestGate.check` 未注入设备 workspace/session 允许集；`boundWorkspace` 为空则跳过绑定（`apps/daemon/src/remote_gate.cj:121-137`）；`session/projection` 不接请求 body（`apps/host/src/main.cj:1894-1907`）。证据：`target/tmp/security-audit-full-20261022/resource-binding-6BTttF/summary.json`。
- **影响**：填任意 workspace/session 仍返回当前活动会话；Web「按会话读历史」不可信。
- **验收**：不存在的资源返回稳定拒绝；A 设备不能读 B 设备的会话；Host 消费被授权的 session 而不是全局活动选择。
- **2026-10-24 状态**：**按用户确认的收窄范围闭合（桌面级 3/3）**——`session/projection` 按 `sessionId` 精确读（未知 `-32602`、应答带 `sessionId`、非活动会话不带活动会话正文）；活动会话类方法带错配 `sessionId` 在处理器前 `-32001 session-mismatch` 拒绝且零副作用；远程客户端提交前须显式 `session/select`（幂等测试已适配）。**每设备会话白名单按 2026-10-23 用户裁定不做**，daemon gate 的 per-device 允许集仍留待 W03 前评估，不宣称跨设备会话隔离。

#### P0-4 SSE 授权与资源过滤（S09，修复待复测）

- **审计事实**：旧 HEAD `1eb66e9` 动态复现 `/sse` 补读绕过 `session/events` 授权；`EventBus.publish` 向全部订阅队列扇出。证据：`target/tmp/security-audit-full-20261022/sse-policy-7kjrxn/summary.json`。
- **当前 HEAD `a0b16c3`**：gate 在位时走 `SseResume.buildAuthorized`（`apps/daemon/src/sse_frames.cj:113-120`），直播帧按 `streamAllowsLive` 过滤（`apps/daemon/src/remote_gate.cj:183`；`apps/daemon/src/daemon.cj:748-772`）。源码层面已加入授权与过滤。
- **未闭合原因**：旧的动态负例未在当前 HEAD 复跑；`EventBus` 的设备级隔离与慢消费者行为仍需按 `apps/daemon/src/eventbus.cj:97-130` 复核。不能凭源码存在关闭。
- **影响（若回归）**：补读绕过方法策略；Web BFF 若共用上游 SSE，会把未授权会话帧扇给浏览器。
- **验收**：重跑「策略只登记 initialize + 合成会话游标」负例，`/sse` 不得交付该会话正文；直播逐条过滤；Web BFF 单上游订阅下同样成立。

#### P0-5 幂等 in-flight 原子领取（S08，修复待复测）

- **审计事实**：旧 HEAD 先 consult 后执行，并发同键执行两次；证据：`target/tmp/security-audit-full-20261022/idempotency-A6Zp4e/summary.json`。
- **当前 HEAD `a0b16c3`**：改为执行前 `idempotencyLedger.claim(...)`，`LEDGER_KIND_REPLAY` 直接回执、冲突拒绝、异常保留 unknown 占位（`apps/daemon/src/daemon.cj:363-389`）。源码层面已有原子领取。
- **未闭合原因**：未在当前 HEAD 复跑并发同键负例与异常退出后的 unknown 行为；账本上限与淘汰策略也需复核。
- **影响（若回归）**：多端重试或双击可重复持久写入。
- **验收**：同键并发只有一个执行，另一个等待或返回处理中；异常退出后是「未知」而不是可直接重执行；W03 前必须复测。

#### P0-6 CLI 认证与 TLS

- **事实**：固定 `http://127.0.0.1`、无 `Authorization`（`apps/cli/src/remote.cj:321-334`）；SSE 同样（`remote.cj:413-428`）；`rpc` 是通用透传。
- **影响**：CLI 只能对「未启用 remote access」的本机 daemon 工作；一旦 daemon 启用 gate 就 401；也无法接 HTTPS 远程。
- **方向**：增加 enroll/token + TLS CA/pin，或明确 CLI 仅限本机并在启用 gate 时 fail-fast，而不是运行期 401。
- **验收**：CLI 对保护态回环 daemon 完成 enroll → token → 目录 → 历史；错误 pin 被拒；不新增任意方法通道。

#### P0-7 契约 consumer 与运行时一致

- **事实**：契约测试的 `validConsumers` 只有 `desktop/mobile/cli`（`apps/daemon/test/remote-capability-contract.test.mjs:12`）；daemon 装载不读 `clientConsumers`；移动端契约 84 条、客户端实际 3 条。
- **影响**：不能拿契约 consumer 名单当准入/封闭证据；Web 加入前必须先明确字段语义。
- **方向**：要么把 `clientConsumers` 降为文档字段并在测试中注释清楚，要么在 daemon 装载时按 device kind 生成允许集（后者是行为变更，需独立授权与测试）。W01 至少不得宣称「契约已授权 Web」。
- **验收**：新增 `web` 只进入只读方法；契约测试对 web 的 execute/approval/management 负例；`initialize` 宣告与客户端 allowlist 一致。

### 13.5 Web 分阶段与跨端闸门

| 阶段 | 允许范围 | 跨端闸门 |
|---|---|---|
| W01 | 工程骨架、BFF 认证、targets/sessions/events 只读 | 不依赖 P0-1；P0-3 未修、P0-4 未复测前只允许单用户、单 workspace，不宣称多会话隔离 |
| W02-A | 真实 daemon 只读链、Playwright、断线补读 | 出口增加「与桌面/移动读同一会话，seq 边界一致」 |
| W03 | 任务、审批、取消 | P0-1～P0-5 全部有真实 daemon 证据；否则不开放 |
| W04 | 部署、多用户/多工作区 | P0-6、P0-7 + 设备级/平台验收 |

### 13.6 契约登记变更（W01 同批执行，本节未执行）

1. `validConsumers` 增加 `web`（改测试属于契约变更，需与 W01 同批授权）。
2. 只给 W01/W02-A 实际需要的只读方法加 `web`：`initialize`、`session/catalog`、`session/events`。`session/select`、`session/projection`、`workspace/*` 在 P0-3 修复前不加（它们仍依赖全局活动会话或弱资源绑定）；`turn/poll` 在 P0-2 解决前不加。
3. 新增负例：`web` 不得出现在任何 `execute/approval/management` 方法，不得出现在 `auth/devices`、`auth/revoke`、`daemon/shutdown`、`model/*`、`credential/*`。
4. 新增跨端契约测试：每个 consumer 的客户端 allowlist ⊆ `initialize` 宣告 ∩ 契约登记；桌面/移动/CLI/Web 各一条。

### 13.7 当前结论

- **「各端打通」当前不成立**：桌面与移动能认证读目录/历史；CLI 只能无认证本机；Web 未建；多客户端同会话的 Host 级排他已解，但任务与审批对所有保护态远程端仍被 `execute` scope 的沙箱门禁挡在端到端之外。
- **2026-10-24 已闭合（按用户确认的收窄范围）**：P0-1 授予面（daemon 级 31/31；`execute` 端到端仍待沙箱链路）、P0-2 `turn/poll` 游标重放（Host 级双客户端同终态用例通过）、P0-3 精确投影 + 错配拒绝（桌面级 3/3；每设备会话白名单按 2026-10-23 裁定不做）。见[证据](../../evidence/2026-10-24-p0-cross-end-gates.md)。
- **仍确认未修**：P0-6（CLI 无认证/TLS）、P0-7（consumer 不参与运行时授权）。
- **已有修复代码但未复测**：P0-4（S09）、P0-5（S08）。在复跑对应负例前按未闭合处理（复测受本机缺 openssl 阻断）。
- core `cjpm test` 因 HEAD 同名 `@Test` 无法编译（P0 文件零 error、库编译成功），P0 单测未执行；`extension/host/spawn` 为预先存在的 Cangjie `launch` 工具链问题（旧二进制同样失败），均与 P0 无关。
- W01 仍按只读推进；W03 前必须闭合 P0-1 `execute` 端到端并复测 P0-4/P0-5。
- 本节不改契约 JSON、不改测试、不改产品源码；上述 P0 的修复需另行授权。
