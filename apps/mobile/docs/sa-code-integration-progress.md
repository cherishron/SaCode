# SaCode 移动接入实施记录

> 2026-10-23 同仓迁入：客户端工作树复制至 `apps/mobile/`，旧源和 Git 保留不动；只做源码、路径和规范适配，没有重跑下方测试、构建、真实 daemon 或真机验收。产品状态以 [根 PRD 台账](../../../docs/product/PRD-tracking.md) 为准。原“SaCode 只读”仅描述 10 月 14 日后端实施边界，不阻止此次获准的同仓源码归并。

> 2026-10-22 只读复评：见 [SaCode 更新兼容性评估](<sa-code-upgrade-assessment-2026-10-22.md>)。下列测试读数是 10 月 14 日历史证据，不代表新版联调完成。之后用户授权过原地构建并已生成后端产物，因此下文“未构建后端”仅对应原 P0/P1 实施阶段；本次复评未再次构建或启动后端。

> 2026-10-14。P0 + P1 前端接入已完成客户端实现与验证；真实 daemon 联调仍缺部署环境。
> SaCode 源码仓严格只读；未启动、构建或修改后端。既有 SaApp 未提交改动保留。

## 已落地（P0 + P1）

### P0：协议基础修正

- 严格 JSON-RPC 响应校验：版本、请求 ID、result/error 互斥、结构化 error.data 保留。
- 服务根地址验证：禁止路径、userinfo、伪回环域名和非 HTTP(S)；远程必须 HTTPS。
- 完整 SSE 帧纯解析器：空行边界、CRLF、多行 data、帧大小限制、瞬时帧不制造游标。
- 可注入阻塞网络接口；只读能力初始化、目录和持久事件分页模型。
- requestId / operationId 分离、RemoteRequestContext 资源上下文、RemoteConnectionEpoch 目标换代隔离。
- 旧 DaemonTransport.call() 仅允许三个只读方法；task/start、turn/poll、approval/answer 不发往网络。

### P1：绑定与只读闭环

- 独立远程设备登记与令牌兑换；完整登记回执单条加密 KV 保存，写后确认。
- 令牌内存缓存、毫秒 TTL、保守提前续期、锁合并并发续期；401 凭据失效后停止反复兑换。
- 能力宣告：instanceId、protocolVersion、capabilities、sandboxEnforcing、sandboxLimitations。
- 会话目录读取（session/catalog），连接前校验远程实例 ID 与登记回执一致。
- 持久事件分页恢复（session/events）：代次 gap 重建基线、游标推进验证、重复事件合并、最多缓存 2000 条。
- SSE 订阅、取消、抖动退避重连、持久游标 Last-Event-ID 回传、自动分页补读；撤销停止重连，瞬时通知只触发补读。
- 设备页（RemoteDevicesPage）：登记、选择已保存设备、连接、目录读取、会话轮换、历史补读、订阅/停止、本地解绑（二次确认）。
- Agent 专用 HTTP：禁止任何重定向、请求/响应体限制 1 MiB、独立超时。
- 只读请求认证失效仅刷新一次重试；scope 拒绝不触发刷新。
- 前后台恢复（pageDidAppear/pageDidDisappear）：后台停止订阅，回前台恢复并补读。
- 登录会话代次（LocalSessionEpoch）：退出登录后清库，在途登记不会重新写回凭据。
- 页面生命周期隔离：页销毁/账号改变/目标换代丢弃旧回调；切页显式 detach 旧 delegator。

## 验证证据

执行 `gradlew.bat clean :androidApp:assembleDebug :shared:testDebugUnitTest --offline` 全量通过。

**148 个单元测试，0 失败**，包含：
- RPC 信封校验、错误互斥、响应 ID 匹配、结构化 error.data（18 例）
- 回环地址伪装拒绝、SSE 完整帧解析、多行 data、空行边界（5 例）
- 设备登记秘密不落库、账号隔离、12 并发请求单次令牌兑换、TTL 毫秒、无效凭据停止重试、安全写失败（4 例）
- 事件 gap 重建、游标推进、重复合并、目标换代隔离（4 例）
- SSE 重连、撤销停止、游标回传、瞬时通知不推进游标（2 例）
- 只读门禁：task/approval 在获取令牌前被拒绝（2 例）
- 认证恢复：令牌失效仅刷新一次、scope 拒绝不刷新、重复认证有界（2 例）
- 退出登录阻断在途凭据写入（1 例）
- 本机 HTTP 真实连接：禁止重定向不携带秘密、响应超 1 MiB 拒绝、SSE 保留空行与中文（3 例）
- 旧桥接回归（33 例）、聊天页回归（24 例）等。

这仅是客户端测试与构建证据，未访问真实 daemon，不代表注册授权、沙箱、会话归属或手机网络验收通过。

## 验证边界

| 层次 | 状态 |
|---|---|
| 静态源码契约 | ✅ 逐条核对 sa-code 工作区源码 |
| 客户端纯逻辑测试 | ✅ 148 例全绿 |
| 客户端 Android 构建 | ✅ Debug APK 成功（clean 后全量） |
| 本机真实 HTTP 行为 | ✅ JVM HttpServer 反例通过 |
| 真实 daemon 只读联调 | ❌ 缺 HTTPS 地址/workspaceId/一次性票据 |
| 真机网络 | ❌ 未联调 |
| 真实执行/审批 | ❌ 不开放（权限/会话归属/沙箱未验证） |

## 外部依赖

无真实 HTTPS 地址、workspaceId、一次性票据与合法部署授权，当前只运行 mock 契约验证；不绕过认证或沙箱，也不在 SaCode 工作区生成联调产物。P2 任务执行须等部署方确认 G1（授权流程）、G2（会话定位）、G3（沙箱强制）后再开放。
