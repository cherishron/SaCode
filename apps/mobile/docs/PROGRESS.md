# SaApp 进度（当前实际状态）

> 更新：2026-10-23 · 归属：`sa-code/apps/mobile/`，旧 `sa-app` 保留，统一由 SaCode Git 管理。
> 本文件记录手机局部状态；产品完成与当前交付的唯一台账是 [SaCode PRD 跟进台账](../../../docs/product/PRD-tracking.md)，文档权威顺序见 [根文档索引](../../../docs/README.md)。
> 下方带日期与“本次”的旧读数保留为迁入前历史，不算迁入后复验；当前接入限制优先看[实施记录](sa-code-integration-progress.md)与[10 月 22 日复评](sa-code-upgrade-assessment-2026-10-22.md)。
> 与 [`README.md`](../README.md)（是什么 / 怎么用）分工：本文件只回答**已经做到哪、验证到什么程度**。

## 一句话状态

**手机工作树源码已安全复制至 `apps/mobile/`，本轮仅源码与路径/规范适配，未运行 Gradle、安装、真机或真实 daemon 验收，不能称已交付。**

当前受保护远程客户端保持三 RPC 只读面：`initialize`、`session/catalog`、`session/events`。旧表中的执行/审批描述为历史快照，不代表现已开放。原签名库、本机配置、含口令的原 Gradle 文件及构建/会话输出均排除；既有 `kotlin/`、`kotlin-test/` 9 文件保留。后续同源构建、真机 HTTPS、账号/设备/会话归属、安全与恢复分别取证。

以下原记录为迁入前历史：shared Android 单元测试曾通过；旧 APK 构建曾受跨盘 DEX 产物阻塞；后来的 10 月 14 日构建读数见接入实施记录，不能冒充本轮重跑。

## 技术栈与形态

| 项 | 值 |
|---|---|
| 语言 / UI | Kotlin 2.0.21 · Kotlin Multiplatform 2.0.21 · KuiklyUI `2.6.0-2.0.21` |
| DI / 日志 | Koin 3.5.6 · Napier |
| 设计系统 | SaUI 组件库 26 个基础组件 |
| 平台 | **Android**（`androidApp/`）· **鸿蒙 OHOS**（`ohosApp/` + `shared/src/ohosArm64Main/`） |
| OAuth 客户端 | `client_id = saapp` · redirect `saapp://oauth/callback` |
| 默认环境 | Dev：issuer `http://127.0.0.1:8080` · gateway `http://127.0.0.1:8090` |
| scope | `openid profile email phone` |

## 已落地代码

### saai 接入（M1 / M2 / M2.5）

| 模块 | 文件 | 状态 |
|---|---|---|
| 环境配置 | `shared/.../env/SaaiEnv.kt` | 已落地（`authorizeUrl`/`tokenUrl`/`exchangeUrl`/`modelsUrl` 由配置推导，`@Volatile current`） |
| 认证 | `auth/AuthRepository.kt` · `OAuthBridge.kt` · `Pkce.kt` · `TokenModels.kt` | 已落地（授权码 + PKCE + 深链回调 + exchange + 刷新模型列表） |
| 安全存储 | `storage/SecureStore.kt` + `AndroidSecureStore.kt` + `SecureStore.ohos.kt` | 已落地（双平台 actual 实现） |
| 对话 | `chat/ChatRepository.kt` · `ChatModels.kt` | 已落地（M2 Gateway Chat） |
| 对话 UI | `feature/chat/ChatPage.kt` | 已落地 |
| 登录 UI | `feature/login/LoginPage.kt` | 已落地 |
| Agent 协议层 | `agent/rpc/AgentRpc.kt` · `AgentMethods.kt` · `DaemonTransport.kt` | 已落地（JSON-RPC 2.0 帧编解码 + `POST /rpc` + `GET /sse`；默认端口 18937；方法名与错误码逐条对齐 `sa-code/apps/daemon/src/`；33 个单测） |
| Agent 链路管理 | `agent/AgentLink.kt` · `agent/AgentRegistry.kt` | 已落地（探测 = `initialize` 并返回能力清单；多目标注册表；非回环只接受 HTTPS；云中继未实现，明确拒绝） |
| 设备页 | `feature/agent/AgentPage.kt` · `feature/agent/BindAgentPage.kt` | 已落地（能力驱动：`task/start`、`turn/poll`、`turn/cancel`、`team/approval/answer` 按协商结果启用；SSE 事件流可订阅/断开） |
| 账号中心 | `feature/account/AccountApi.kt` · `AccountPage.kt` | 已落地（资料/第三方绑定/设备/安全四区块；`logout` 与 `logout-all` 分语义；字段对齐 `sa-idp/backend/src/identity/`） |
| 底部导航 | `feature/home/HomeTabs.kt` | 已落地（对话/设备/我的三页签，路由切换） |
| 云端历史 | `history/CloudSyncApi.kt` · `history/HistoryModels.kt` | 已落地 |
| 平台基建 | `core/di/AppModule.kt` · `core/platform/{Http,Crypto,PlatformOps,NapierInitializer}.kt` | 已落地 |

### 框架与组件库

- `framework/`：Kuikly 适配器 7 个（ColorParser / Exception / Font / Image / Log / Router / Thread）
- `shared/.../saui/`：26 个 SaUI 基础组件（Token 5 · Base 1 · Foundation 3 · Form 5 · Data 4 · Feedback 10 · Navigation 3）+ 3 个聊天业务组件（`chat/`）
- `SaUICatalogPage`：组件库 Demo 页面，**保留**

## 验证状态

| 项 | 状态 |
|---|---|
| 单元测试存在 | ✅ `shared/src/commonTest/.../auth/AuthUrlTest.kt` · `chat/ChatSseParseTest.kt` |
| 本次是否运行 | `gradlew.bat :shared:testDebugUnitTest --offline` 通过；`gradlew.bat :androidApp:assembleDebug --offline --no-build-cache --rerun-tasks` 失败：DEX 增量产物混用旧 `E:` 和当前 `D:` 路径 |
| 真机验收 | ❌ 未完成（M1 登录、M2 Chat、M2.5 Agent 桥均待真机） |
| 本地构建命令（供复核） | `$env:JAVA_HOME=...`; `.\gradlew.bat :shared:testDebugUnitTest`；`.\gradlew.bat :androidApp:assembleDebug` |

**复核建议**：在确认可清理本机生成的 `build/` 中旧 DEX 中间产物后重建 APK，再用真机验收；本次未删除现有构建文件。

## 遗留与阻塞

| 优先级 | 项 |
|---|---|
| 高 | M1 真机验收：sa-idp（`:8080`）+ gateway-rs（`:8090`）就绪 → 登录 → 深链回 App → token + exchange → 模型列表刷新 |
| 高 | M2 Gateway Chat 真机验收（含 SSE 流式解析） |
| 高 | M2.5 真机联调：USB ADB reverse 本机 daemon + HTTPS 局域网代理，验证任务创建/查询和 token 拒绝；尚未执行真实手机网络测试 |
| 高 | 云端签名中继：sa-aiapigateway 和 sa-code 均无设备配对、中继、签名校验协议；客户端明确返回 `relay_unavailable`，仍需另行实现服务端/PC 常驻桥 |
| 中 | 鸿蒙 OHOS 侧真机验证（`ohosApp` 与 `ohosArm64Main` 已就位，未见验证记录） |
| 中 | 短信登录真机（依赖 sa-idp 短信通道，当前仅开发码 `123456`） |
| 中 | `docs/index.md` 仍是 SaUI Demo 索引（最后更新 2026-07-10），未覆盖 saai 接入模块 —— 已在本轮补链 |
| 低 | `SaUICatalogPage` 组件库 Demo 与产品页面并存，后续需决定是否移出主入口 |

## 已知文档偏差（本轮已修正）

- 根 `README.md` 成员表曾把 SaApp 标为「📋 规划 / 待建」，与本目录已迁入且代码落地的实际不符 —— 已在根 README 修正。
- 本仓 `README.md` 的「项目结构」块未列出 `auth/`、`chat/`、`agent/`、`history/`、`storage/`、`env/`、`feature/` —— 已在本轮补齐。

## 相关文档

- 本仓：[README.md](../README.md) · [AGENTS.md](../AGENTS.md) · [docs/index.md](./index.md) · [docs/structure-summary.md](./structure-summary.md)
- 设计：[saui/overview.md](./saui/overview.md) · [saui/components.md](./saui/components.md) · [kuikly-dsl-gotchas.md](./kuikly-dsl-gotchas.md) · [ohos-known-differences.md](./ohos-known-differences.md)
- 同仓：[PRD](../../../docs/product/PRD.md) · [PRD 台账](../../../docs/product/PRD-tracking.md) · [对接索引](../../../docs/integration/README.md)
- 原产品线参考（未导入）：`../../docs/STATUS.md`、`../../docs/clients/design-sa-app.md`、`../../docs/clients/prd-sa-app.md`、`../../docs/clients/design-sa-app-agent-bridge.md`。

## 维护约定

行为或状态变化时同步手机局部记录、`README.md`、根 PRD 台账与分类索引；以根 `AGENTS.md` 的真实任务、安全与交付要求为准，不另立手机“完成”口径。

