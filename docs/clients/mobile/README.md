# 移动端（KMP / KuiklyUI 手机工作台）

> 类别：**⑪ 端文档**｜上级索引：[clients/README.md](../README.md)｜四端总览见 [README §2 差异矩阵](../README.md#2-跨端差异对比矩阵)。
> 源码：[`apps/mobile/`](../../../apps/mobile/)（KMP / KuiklyUI 工程，2026-10-23 从 `sa-app` 复制导入，与 SaCode 同仓管理）。
> 工程规约：[`apps/mobile/AGENTS.md`](../../../apps/mobile/AGENTS.md)；接入方案：[`docs/sa-code-mobile-integration-plan.md`](../../../apps/mobile/docs/sa-code-mobile-integration-plan.md)、[`sa-code-integration-progress.md`](../../../apps/mobile/docs/sa-code-integration-progress.md)。
> 状态口径：源码已归并、Android Debug 构建有局部读数；**真实 daemon 接入、真机任务与鸿蒙构建均待验**。

## 1. 用途

SaCode 的**移动工作台**：把桌面/服务端的 AI 编程任务能力延伸到手机。

- **正式入口**：**电脑出票 → 手机设备配对**（`RemoteDevicesPage` + 独立本机设备档案 + daemon 配对）；**不要求** saai 账号 / sa-idp / gateway-rs / 手机号。
- **不依赖登录的独立档案**：本机档案只用于本地数据/凭据命名空间，**不替代** daemon 认证与授权。
- **角色**：手机是**远程客户端**，通过 daemon → Host/core 消费共享业务语义，不复制后端 Agent 主循环或授权机制。
- **参考不等于兼容**：参考 [Kuikly AIChat 文档](https://kuikly.tds.qq.com/AI/chat-markdown.html) 及其移动端 AI 构建案例；KuiklyChatUI / KuiklyMarkdown 属于 UI 与渲染能力，不替代 daemon RPC、SSE、TLS 或审批协议。

## 2. 需求

### 2.1 产品路线（M01–M05，见 [PRD §移动端与 Web 产品路线](../../product/PRD.md)）

| 阶段 | 范围与交付目标 | 门槛 / 当前状态 |
|---|---|---|
| M01 工程归并 | 手机工程纳入同仓，保留既有 JVM 协议测试 | 已有源码归并 + Android Debug 构建记录；不代表真机任务完成 |
| M02 界面与 demo 收敛 | 围绕连接目标/会话/消息/审批/任务状态/设置重组页面；组件 Demo 退出正式导航 | 已删组件 Demo；正式入口纠偏为 `RemoteDevicesPage`，旧 Login/Chat/Account/Agent/BindAgent 不注册正式路由；3 项路由回归、171 项 shared 单测、Debug 构建、Honor 保留数据安装成功；检查时锁屏，首屏 GUI 待验；鸿蒙仅入口源码调整、未构建 |
| M03 会话渲染 | 按兼容版本接入 KuiklyMarkdown；对齐深浅色/字号/代码块/表格/流式增量 | 仅有常规 Markdown 工作区接入与构建记录；流式入口、主题、真机效果及 ChatUI 待验 |
| M04 真实远程任务 | 打通既有 daemon 直连：身份、TLS、目标/会话归属、消息事件、审批、取消、重连 | M04-A 已修路由/任务语义/`initialize` workspaceId，续修任务提示与列表响应式（165 单测 + Debug APK）；完成门槛仍为真机“选目标→会话恢复/新建→发起→流式→精确审批→实际修改/测试→结算”，另验拒绝/断连未知/取消/跨目标隔离 |
| M05 扩展连接与平台 | 直连闭环后评估 Relay/扫码、SSH 隧道、按来源隔离缓存；Android 与鸿蒙分别验收 | 后续规划；协议与威胁模型先评审 |

### 2.2 受保护接入的开放面

当前受保护移动接入**只开放** `initialize`、`session/catalog`、`session/events` 三个只读方法（[apps/mobile/AGENTS.md](../../../apps/mobile/AGENTS.md) §单仓库规则）。执行、审批、多主体 SSE 隔离**须独立验证**；导入源码不构成开放授权。不得照抄 Host 方法名假定 daemon 已开放。

### 2.3 平台

- Android 为首验平台；任务名 **`:androidApp:assembleDebug`**（不是 `:app:assembleDebug`）。
- 鸿蒙壳（`ohosApp/`，独立配置）**独立验收**：Android 编译成功**不能**推定鸿蒙通过。
- 手机本机 SDK 配置、凭据、签名库、缓存及产物**不入库**；`local.properties` 各人配置为 `sdk.dir=<本机路径>`。

## 3. 设计

### 3.1 技术栈

| 类别 | 技术 | 版本 |
|---|---|---|
| 语言/框架 | Kotlin KMP | 2.0.21 |
| UI | Kuikly（腾讯） | 2.6.0-2.0.21 |
| 设计系统 | SaUI（基于 Kuikly 原生组件自建） | — |
| DI | Koin | 3.5.6 |
| 构建 | Gradle / AGP / JDK | 8.9 / 8.5.0 / 17 |

> Kuikly KMP 制品须保持 `{KuiklyVersion}-{KotlinVersion}` 一致（`core` / `core-render-android` / `core-ksp` 均 `2.6.0-2.0.21`）；Kuikly ≥2.5.0 使用腾讯镜像（已配于 `settings.gradle.kts`）。默认 `settings.gradle.kts` 只含 Android 三模块，OHOS 用独立配置。

### 3.2 工程结构

```text
apps/mobile/
├── framework/     # Kuikly 适配器框架（KuiklyFramework + 7 个 adapter）
├── shared/        # KMP 共享模块（commonMain）
│   ├── saui/      # SaUI 组件库（26 基础 + 3 业务：ChatMessageBubble/StreamingInputBar/MdParser）
│   ├── core/      # 核心平台代码（expect/actual）
│   ├── feature/   # 业务页面（login/chat/agent 等）
│   └── App.kt     # 应用入口
├── androidApp/    # Android 应用入口（AndroidApplication / MainActivity）
├── ohosApp/       # 鸿蒙壳（独立配置，独立验收）
├── kotlin/、kotlin-test/   # JVM 远程协议客户端 + 测试（原位保留，非 Android 应用）
└── docs/          # 手机工程文档中心
```

### 3.3 客户端分层（见 [接入方案 §5.1](../../../apps/mobile/docs/sa-code-mobile-integration-plan.md)）

```text
Kuikly 页面（设备 / 对话 / 审批卡）
    ↓ 意图与只读状态
RemoteSessionController + TargetConnectionManager
    ↓ 类型化方法、状态机、operationId
DaemonRepository + RemoteAuthRepository
    ↓ JSON-RPC / 完整 SSE / TLS / tokenProvider
可替换网络接口 + Android 实现
```

- **会话定位键**：`(账号标识, targetId, instanceId, workspaceId, remoteSessionId)`；本地 Gateway 对话另用一个命名空间。
- **连接 epoch** 隔离迟到响应；**切目标只停止旧订阅，不隐式取消 PC 任务**。
- 控制器持有进行中的任务/续期/重连，Pager 只订阅状态；后台断连后回前台**查事实恢复**，不作后台无限执行承诺。
- 业务状态更新回 Kuikly 正确执行线程（不假定 Android 主线程 == Kuikly 执行线程）。
- 令牌续期 **single-flight**；只在安全读请求允许时自动补试，写请求按步骤与 operationId 核实，不因续期无条件重发。
- `enrollmentSecret`、`credential`、`accessToken`、Gateway api_key、IdP token **各有独立命名与用途**，不混用；secrets 不写日志、不在设备详情回显。

### 3.4 网络契约（摘要，全文见 [接入方案 §2](../../../apps/mobile/docs/sa-code-mobile-integration-plan.md)）

- **连接**：daemon 默认 `127.0.0.1:18937`（`--port` 改端口）；`SACODE_REMOTE_ACCESS` 启用受保护接入；非回环受保护监听**必须**配置 TLS；初期采用系统 CA 可验证的 HTTPS，**禁 trust-all**。原生客户端不发浏览器 Origin，遵守 Host 允许集。
- **登记/续期**：
  - `POST /auth/enroll` `{enrollmentSecret, deviceName, kind}` → `{instanceId, deviceId, credential}`（`kind="mobile"`；协议设备名仅 ASCII 字母数字/`-`/`_`，≤64 字节；中文显示名另存不送协议）。
  - `POST /auth/token` `{deviceId, credential}` → `{accessToken, expiresInMs, tokenType}`（按毫秒相对 TTL 续期；与 IdP OAuth 完全分开）。
  - 一次性登记秘密由目标端本机管理入口 `--manage enroll-ticket <设备快照路径> <principalId>` 产生；默认 5 分钟、一次性消费。
- **RPC 信封**：`{"jsonrpc":"2.0","id":"req-1","method":"…","params":{…}}`；id 只允许字符串/整数，params 必须对象，拒 batch，请求体上限 1 MiB；业务失败通常仍 HTTP 200，须解析 error；`resourceKeys` 的 `workspaceId`/`sessionId` 在 params **顶层**传入；durable 写要求 `operationId`；幂等错误 `-32017`（缺操作号）/`-32018`（同键不同内容）/`-32019`（结果未知，只查状态不换号盲重放）。
- **SSE 与补读**：完整解析 id/event/data/空行边界、多行 data、CRLF 与 UTF-8 分片；durable `id: <sessionId>|<seq>`；ephemeral 为 JSON-RPC 通知（无可持久游标）；close `{reason}` 区分到期/撤销/背压；`Last-Event-ID` 原样回传；`session/events` 仅提供已 flush 前缀，`hasMore` 分页补齐，`gap`（generation-mismatch / cursor-beyond-horizon）时**重取投影重建同步基线**。

### 3.5 SaUI 组件库

- 原则：Kuikly **原生可用的直接用**（Switch/AlertDialog/Slider/TextArea/DatePicker/Tabs/ActionSheet 等 15+）；只封装**有实质注入**的（须注入 SaUI Token）；统一 `object + fun build(): ViewBuilder` 模式（调用点 `.invoke(this)`）。
- 令牌：`SaUITokens.Colors/Typography/Spacing/Radius/Shadow`（如 `BrandPrimary = "#0052D9"`）。
- 代码解构规约（对应 `saui/` 既有实现）：逻辑抽成**纯函数**便于单测；`ViewBuilder` 不能当扩展接收者（容器用 `ColumnView` 等视图类型）；组件内不放状态、状态提升到调用方；平台能力先看 `expect/actual`；回调可选（不传不绑手势）；状态标记用显式字段（如 `retryable: Boolean`）。

## 4. 边界

### 4.1 产品/能力边界

1. **不复制后端**：`core/` 是共享任务/授权/取消/恢复/结算真源；KMP `shared/` 是客户端共享层，只消费 daemon 已声明且合法授权的能力。
2. **登录不是前提**：不以前置 saai 账号 / sa-idp / gateway-rs 登录为依赖；独立本机档案只隔离 registry/vault，不授予远端权限。
3. **只读优先**：当前受保护接入仅 `initialize`/`session/catalog`/`session/events`；执行/审批条件未满足前**禁用远程执行**并展示限制，不切换无认证模式试跑。

### 4.2 后端门禁（不能由前端单独解决，见 [接入方案 §3 G1–G5](../../../apps/mobile/docs/sa-code-mobile-integration-plan.md)）

| 门禁 | 事实 | 处理 |
|---|---|---|
| G1 登记≠执行/审批权限 | DeviceRecord 的 scopes **默认空集**；执行需 `execute`、审批需 `approval`；生产入口未找到 `grantScope` 调用 | 先交付绑定/读访问；执行/审批显示“权限未就绪”；要求维护方提供合法授权流程，不擅自改身份 JSON |
| G2 显式 sessionId 未证实多会话寻址 | HostProxyBridge 单个普通 Host 子进程，转发未做 per-session 选择；`session/select` 是全局写 | MVP 先给 daemon `session/events` 只读历史；**不宣称多客户端多会话安全** |
| G3 沙箱限制不能绕过 | `initialize.sandboxEnforcement.enforcing` 与远程执行门禁同源；`enforcing=false` 时拒绝执行 | 前端禁用远程执行并如实展示；不静态断言当前机器可执行 |
| G4 团队审批字段冲突 | 团队审批要求恰好四字段（`teamSessionId`/`memberId`/`approvalId`/`decision`），与通用元数据要求不一致 | 普通审批与团队审批**分开**；团队审批移到后续、交维护方确认 |
| G5 workspaceId 来源与 SSE 会话过滤 | `initialize` 不直接交付绑定 workspaceId；SSE 建流当前只校验身份，客户端自行按 sessionId 过滤**不能代替**服务端跨会话保密 | 配对时由部署资料提供 workspaceId 并与 `SACODE_WORKSPACE_ID` 对齐；多主体共享 daemon 须维护方核实服务端过滤 |

### 4.3 其它红线

- 不把 `com.sa.demo` 包名作为整树删除依据；共用 SaUI、网络层及测试保留。
- 一次性日志/快照/验证报告统一放 `target/tmp/<用途>-<日期>/`；Gradle `build/`、`.gradle/` 为忽略输出，**禁写 `dist/`**。
- 单测、可编译、可安装、真实手机任务与发布**分列登记**；旧 PASS 不算迁入后通过。
- 不把 Android 构建当鸿蒙通过；不复制后端主循环；不先造云中继。

## 5. 分步细节

### 步骤 1：电脑出票（目标端）

- 由部署方在可运行 daemon 的目标端执行 `<daemon> --manage enroll-ticket <设备快照路径> <principalId>`，产生**一次性**登记秘密（默认 5 分钟）。此命令只写部署说明，**不能由只读核查代执行**。

### 步骤 2：手机登记与安全存储

1. 客户端 `POST /auth/enroll`（`kind="mobile"`）→ 原子保存 `credential`（记 `targetId`/`instanceId`/`enrolledDeviceId` 分离），一次性秘密不长期保存。
2. `POST /auth/token` 续期 → 按 `expiresInMs` 相对 TTL 续期。
3. **失败处理**：401 **不透露**票据不存在/过期/已消费；兑换 401 时停止自动重试并提示重新登记；429 退避。
4. **成功判据**：收到 `instanceId`/`deviceId`/`credential`；响应丢失**不假定**可重发取回 credential（提示重新出票）。

### 步骤 3：连接与能力宣告

1. 连接后首先 `initialize` → 读 `protocolVersion`/`capabilities`/`instanceId`/`sandboxEnforcement`。
2. 能力列表里有 `task/start` **不代表**可执行（受 G1/G3 约束）。
3. 配对时置 `workspaceId`（来自部署资料，与 `SACODE_WORKSPACE_ID` 对齐）。

### 步骤 4：只读闭环（P1，推荐第一批交付）

1. `session/catalog` → `root`/`entries`（每项含 `id`/`title`/`durable`/`status`/`workspaceDirectory`/`current`，`current` 固定 `false`）。
2. `session/events {sessionId, afterSeq, limit(1..200), generation}` → 分页读历史；`gap` 时重取投影重建基线。
3. SSE 建流校验登录态/可读资源，`Last-Event-ID` 原样回传，超 200 条用分页补齐。
4. **验收**：真实受保护 HTTPS 环境完成“出票 → 手机登记 → 续期 → 列会话 → 读历史 → 断线恢复 → 撤销后拒绝”；scope 不足、沙箱限制**如实显示**。

### 步骤 5：任务闭环（P2，条件满足才开放）

前置：G1 授权流程、G2 正确会话定位、G3 `enforcing` 经部署验证。

1. 按 **submit → flush → start** 发送：`session/submit {eventType:"user/message", data}` → `session/flush`（持久屏障）→ `task/start {sessionId}`（返回 `started`/`limit`/`epoch`/`provider`/`goal`，**不返回 turnId**）。每步保存分步回执与 `operationId`，重试 start 不再次追加用户消息。
2. `turn/poll`（无 turnId 消费）取 `frames` 增量与最终结算（附 `text`/`cancelled`/`finishReason`）。
3. `turn/cancel` 返回 `cancelRequested`/`wasRunning`（**非终态**）。
4. 审批：SSE `approval/asked`（数字 `approvalId`、tool、source、sessionId、`turnRequestId`、`argumentsJson`）→ 卡片 → `approval/status {approvalId}` → `approval/answer {approvalId, decision ∈ {allowed-once, denied}}`。
5. 任务完成后**重取服务端消息投影**；本地只缓存展示，**不自己写一份 PC 事实历史**。
6. **验收**：真实任务完成、生成中取消、审批批准/拒绝/过期、断线后最终状态核实；两会话交叉请求**不能写错/停错/批错**。

### 步骤 6：撤销与退出

- 到期尝试凭据兑换；撤销停止并引导重新登记；网络失败指数退避加抖动；背压先补读再重连；切页不重复建多条连接。
- **退出浏览器/登出与撤销 daemon 设备是不同动作**；退出不自动中止已获准任务，撤销由可信管理面执行并验证在途 SSE 结束。

### 验证命令

```bash
# 在 apps/mobile/ 工程根执行；离线验证前必须已有 wrapper 与依赖缓存
./gradlew :shared:compileDebugKotlinAndroid --offline
./gradlew :shared:testDebugUnitTest --offline
./gradlew :androidApp:assembleDebug --offline
```

验证层次**分开登记**：静态源码契约 → 客户端 mock 测试 → 客户端构建 → 真实 daemon 只读联调 → 真机 HTTPS → 真实执行。mock 全绿不标记真机或 CLI 执行通过；不在 SaCode 源码仓启动会写日志/快照的 daemon 做联调副作用。

## 6. 与其它端的差异

| 对比点 | 移动端 | 参照端 |
|---|---|---|
| 身份 | 本机设备档案 + daemon 设备 credential（两层：浏览器/设备主体与 daemon 授权） | 桌面/CLI 为本机用户 |
| 后端连接 | 只经 daemon（HTTP JSON-RPC + SSE），无本地 Host | 桌面主进程 spawn 宿主；CLI 直连 core/Host |
| 交互/渲染 | Kotlin/KMP + KuiklyUI DSL；SaUI 令牌 | 桌面 Vue runtime + CSP；CLI 终端字格；Web 浏览器 |
| 开放面 | 受保护只读：`initialize`/`session/catalog`/`session/events` | 桌面/CLI 能力面更全 |
| 平台验收 | Android 与鸿蒙分别验收，Android 通过**不**推鸿蒙 | Java/鸿蒙 CLI 与 Android 应用壳是不同角色 |

结论：移动端是**远程只读优先**的端，安全与归属门禁（G1–G5）比交互更重要；它与 Web 端共享同一 daemon 后端与安全修复，但客户端认证/网络限制/交付**独立验收**。