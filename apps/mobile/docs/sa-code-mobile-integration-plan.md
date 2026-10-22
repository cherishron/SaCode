# SaApp 接入 SaCode CLI / daemon 方案

> 日期：2026-10-14。状态：只读接口核查完成，待用户确认实施范围。
> 原实施边界（2026-10-14）：SaCode 仓库只读，客户端在原 SaApp 仓修改。2026-10-23 已获准复制至 `sa-code/apps/mobile/`，本文保留旧契约审计结论；同仓治理以根 `AGENTS.md` 为准，源码相对链接已适配，行号仍属历史锚点。
> 本方案依据当前工作区源码，不代表 SaCode 当前二进制、服务部署或真机已验收。

## 1. 结论与实施原则

SaApp 应直接消费 SaCode daemon 的 HTTP JSON-RPC / SSE，而不是执行 PC 上的 CLI 命令，也不是复刻 Host 内部 stdio 协议。CLI 的远程入口用于核实动作顺序，daemon 分派、Host 处理器和实际策略共同决定移动端可用面。

已有客户端协议骨架可复用，但任务参数、审批参数、鉴权、恢复和归属必须修正。第一阶段做安全绑定与只读会话访问；任务执行仅在权限、沙箱、会话归属三个条件都验证通过后开放。不得为完成演示关闭 daemon 鉴权、绕过沙箱、直接编辑身份快照或编造任务成功。

### 1.1 核查基线

- SaCode HEAD：`e9e6298d9e1c4e1162c5973e6aafb962585983ae`。
- SaApp HEAD：`384a914d3da3b09b222146177ce9060f17c31dbd`。
- 两仓都有未提交变更，SaCode 的 Host、代理白名单、身份存储也有变更。因此以下是工作区契约，不是固定提交或发布包保证；实施前重新检查相关源码。
- 本轮未在 SaCode 执行构建、测试、安装、启动服务或生成文件；只读取源码、文档和 Git 状态。
- 前一轮 SaApp Android Debug 构建、共享单元测试强制重跑通过。本轮仅新增方案文档，不把旧结果当未来改动的验收。

### 1.2 依据与权威顺序

实际分派/处理器 > 实际策略配置 > 客户端消费方式 > 带日期的设计文档。契约表的 implementationAnchor 部分行号已漂移，不能只按表里的旧行号推断实现。

关键只读源码：

- [CLI 远程入口](../../../apps/cli/src/remote.cj)：请求顺序与帧验证。
- [daemon 分派与路由](../../../apps/daemon/src/daemon.cj)：归属、幂等、能力、SSE、管理入口。
- [Host 代理](../../../apps/daemon/src/host_proxy.cj)：网络可达方法闭集、内部 ID 重写。
- [Host 处理器](../../../apps/host/src/main.cj)：任务、轮询、取消、消息投影与审批。
- [远程身份引导](../../../apps/daemon/src/remote_access.cj)：登记与令牌报文。
- [请求门禁](../../../apps/daemon/src/remote_gate.cj)、[授权器](../../../core/src/remote_authorization.cj)：资源、权限与执行限制。
- [SSE 帧](../../../apps/daemon/src/sse_frames.cj)、[持久事件分页](../../../apps/daemon/src/event_replay.cj)：游标与补读。
- [能力契约表](../../../docs/plans/remote-capability-contract.json)：权限分类与资源键。

## 2. 已确认的网络契约

### 2.1 连接方式

- daemon 默认 `127.0.0.1:18937`，`--port` 修改端口。
- `SACODE_REMOTE_ACCESS` 启用受保护接入；配置涉及 `SACODE_REMOTE_BIND`、`SACODE_REMOTE_IDENTITY`、`SACODE_REMOTE_POLICY`、`SACODE_REMOTE_TLS_CERT`、`SACODE_REMOTE_TLS_KEY`。
- 非回环受保护监听必须配置 TLS；daemon 本身支持 HTTPS，不要求另造 PC 桥。
- 初期采用系统 CA 可验证的 HTTPS。自签 CA 导入、证书指纹绑定是后续独立能力，禁止 trust-all。
- ADB reverse 仅作开发链路，不代表公网、蜂窝网络或产品鉴权通过。
- 原生客户端不发送浏览器 Origin；服务端出现 Origin 会拒绝。遵守 Host 允许集，不手工伪造 Host 绕过门禁。

出处：[启动配置](../../../apps/daemon/src/remote_access.cj#L346-L397)、[daemon 启动](../../../apps/daemon/src/daemon.cj#L532-L627)。

### 2.2 登记与续期

| 动作 | 请求 | 成功响应 | 客户端处理 |
|---|---|---|---|
| `POST /auth/enroll` | `enrollmentSecret`, `deviceName`, `kind` | `instanceId`, `deviceId`, `credential` | 原子保存设备凭据；一次性秘密不长期保存 |
| `POST /auth/token` | `deviceId`, `credential` | `accessToken`, `expiresInMs`, `tokenType` | 按毫秒相对 TTL 续期；与 IdP OAuth 完全分开 |

登记时 `kind="mobile"`；设备协议名只允许 ASCII 字母、数字、`-`、`_`，最多 64 UTF-8 字节。中文显示名可在客户端另存，不直接送协议名。

一次性登记秘密由目标端现有本地管理入口产生：`<daemon> --manage enroll-ticket <设备快照路径> <principalId>`。此命令只写入部署说明，不能由本次只读核查代执行。登记秘密默认 5 分钟，一次性消费；响应丢失不能假定重发可取回 credential，应提示操作者重新出票。

登记接口返回 400/401/413/429 等真实 HTTP 错误；401 不透露票据不存在、过期或已消费。凭据兑换 401 时停止自动重试并提示重新登记，429 退避。

出处：[报文与响应](../../../apps/daemon/src/remote_access.cj#L258-L342)、[设备名限制](../../../apps/daemon/src/remote_access.cj#L45-L73)、[本机出票](../../../apps/daemon/src/daemon.cj#L483-L537)。

### 2.3 RPC 信封、资源与幂等

```json
{"jsonrpc":"2.0","id":"req-1","method":"session/submit","params":{"workspaceId":"ws-1","sessionId":"s-1","operationId":"op-1","eventType":"user/message","data":"请分析项目"}}
```

- 请求 id 只允许字符串/整数，params 必须对象；拒 batch、无 id 业务通知；请求体上限 1 MiB。
- `/rpc` 业务失败通常仍是 HTTP 200，必须解析 error。
- 校验响应版本、id 与 result/error 互斥，保留 error.data，不用 `code + message` 丢掉结构化失败信息。
- resourceKeys 所要求的 `workspaceId`、`sessionId` 在 params 顶层传入。不能用本地对话 ID 冒充 PC 会话 ID。
- durable 写操作在受保护接入下要求 `operationId`。每个逻辑操作生成一次、重试复用；HTTP 请求 id 每次可以不同。
- 幂等实现读取 params.operationId，不应照搬桌面传输层的 `Idempotency-Key` header 当成替代。
- `-32017`：缺操作号；`-32018`：同键不同内容；`-32019`：结果未知。未知结果只能查状态，不换新 operationId 盲重放副作用。
- 复合发送的 submit、flush、start 分别有操作号；客户端保存已经确认的步骤，重试 start 不再次追加用户消息。

出处：[RPC 门禁/幂等](../../../apps/daemon/src/daemon.cj#L273-L379)、[CLI 响应验证](../../../apps/cli/src/remote.cj#L31-L45)。

### 2.4 MVP 方法与真实字段

所有业务 params 按策略补资源字段；durable 操作补 operationId。下表仅列额外业务字段。

| 方法 | 业务参数/返回 | 接入决策 |
|---|---|---|
| `initialize` | 返回 protocolVersion、capabilities、instanceId、sandboxEnforcement | 连接后首先读取；能力不是用户权限保证 |
| `session/catalog` | 返回 root、entries；每项含 id/title/durable/status/workspaceDirectory/current | 目录来自 daemon；current 固定 false |
| `session/create` | title → `{id,saved}` | 创建不等于 Host 自动选择了它 |
| `session/projection` | 返回 messageRows、messages、todos、events/durable/pending 等 | messageRows 是服务端消息投影；仅尾部最多 64 条 |
| `session/submit` | eventType=`user/message`、data=正文 → events/durable | 写内存态，不能立即标记已持久化 |
| `session/flush` | 无额外字段 | 持久化屏障；失败不冒充提交成功 |
| `task/start` | sessionId；可选 customModelId；不消费 prompt/mode | 返回 started/limit/epoch/provider/goal，不返回 turnId |
| `turn/poll` | 无 turnId 消费 | 返回 frames（JSON 字符串数组）、turn/running/settled；结算时附 text/cancelled/finishReason 等 |
| `turn/cancel` | 无 turnId 消费 | 返回 cancelRequested/wasRunning；不是最终取消结果 |
| `approval/answer` | 数字 approvalId、decision=`allowed-once` 或 `denied` | 普通模型工具审批，不能替换为团队审批 |
| `approval/status` | 数字 approvalId | 返回单个工单 state 与 pending 数量，不是待审批列表 |
| `session/events` | sessionId、afterSeq、limit(1..200)、generation | 返回 generation/nextSeq/hasMore/gap/events |

任务的正确消息来源是先 `session/submit`，再 `task/start`，CLI 已采用此顺序。可在两步间增加成功的 flush 屏障，保证提交后起轮失败仍有已持久用户消息；实际可执行流程仍受下节会话归属门禁约束。

出处：[CLI 发消息](../../../apps/cli/src/remote.cj#L167-L188)、[调用顺序](../../../apps/cli/src/remote.cj#L282-L288)、[投影与提交](../../../apps/host/src/main.cj#L1182-L1324)、[启动回执与取消/轮询](../../../apps/host/src/main.cj#L2012-L2107)、[普通审批](../../../apps/host/src/main.cj#L1506-L1535)。

### 2.5 SSE 与补读

- 完整解析 SSE 的 id/event/data/空行边界、多行 data、CRLF 和 UTF-8 分片，不能逐个 data 行直接当完整事件。
- durable：`id: <sessionId>|<seq>`，data 为 sessionId/seq/eventType/data。
- ephemeral：data 通常是 JSON-RPC 通知 `{jsonrpc,method,params}`，不带可持久游标。
- close：data 为 `{reason}`，应区分到期、撤销、背压等原因。
- `Last-Event-ID` 原样回传服务端游标，不自行制造；本实现只在远程 gate 存在时读取该请求头。
- SSE 建流时补读最多 200 条一次一页，不能只靠它恢复长断线；用 session/events 的 hasMore 分页补齐。
- session/events 仅提供已 flush 前缀，seq 固定十进制字符串。gap 为 generation-mismatch 或 cursor-beyond-horizon 时重新取投影并重建同步基线，不能当空历史。
- 初期正文增量来自 turn/poll 的 frames，SSE 承担通知/审批/连接状态；不宣称所有模型 delta 都通过 SSE 推送。
- 模型审批通知已明确存在：method=`approval/asked`，params 含数字 approvalId、tool、source、sessionId、turnRequestId、argumentsJson。后续查询单个工单状态更新卡片。

出处：[帧与游标](../../../apps/daemon/src/sse_frames.cj#L35-L75)、[路由与续读](../../../apps/daemon/src/daemon.cj#L683-L758)、[分页返回](../../../apps/daemon/src/event_replay.cj#L43-L73)、[模型审批通知](../../../apps/host/src/main.cj#L1875-L1896)。

## 3. 不能由前端单独解决的门禁

### G1：登记成功不等于具有执行/审批权限

DeviceRecord 的 scopes 默认空集；执行需要 execute，审批需要 approval。core 有 grantScope，但本轮在 apps 的生产入口中未找到其调用，仅测试调用；daemon 的本机 manage 入口仅出票、列表、撤销。不能自动给新设备授予权限，也不能改身份 JSON 绕过管理入口。

处理：先交付绑定/读访问；执行、审批显示权限未就绪。要求 SaCode 维护方说明已有受保护授权流程或提供已合法授权的部署环境。此项是接入依赖，不在本仓补后端实现。

证据：[默认空 scope](../../../core/src/remote_identity.cj#L46-L65)、[权限检查](../../../core/src/remote_authorization.cj#L158-L200)、[授予函数](../../../core/src/remote_identity.cj#L291-L305)。

### G2：显式 sessionId 未形成已证实的普通 Host 多会话寻址

HostProxyBridge 维护一个普通 Host 子进程，转发参数时未做 per-session 宿主选择；普通 session/projection、submit、task/start、poll、cancel 使用 Host 的 active shared 状态。仅在 params 填 sessionId 不能证明实际操作的是该会话。

`session/select` 是全局选择且会写选择事实，不应作为手机点击目录项时隐式调用。两个客户端可以互相改变当前 Host 的会话。团队方法又走另一个 TeamHostBridge，审批工单不能假设跨实例共用。

处理：MVP 首先提供 daemon 的 session/events 只读历史。普通 Host 投影/执行只在部署方保证固定会话、独占宿主且核实对应关系后作为受限验收项；禁止宣称多客户端多会话安全。安全按 sessionId 路由需要由 SaCode 维护方确认，不修改该仓。

证据：[单实例代理](../../../apps/daemon/src/host_proxy.cj#L415-L460)、[直接转发](../../../apps/daemon/src/host_proxy.cj#L261-L289)、[投影读取 active shared](../../../apps/host/src/main.cj#L1182-L1196)、[全局选择](../../../apps/host/src/main.cj#L2466-L2488)。

### G3：沙箱限制不能通过批准绕过

initialize 的 sandboxEnforcement.enforcing 与远程执行门禁同源；execute 权限方法在 enforcing=false 时拒绝 sandbox-enforcement-unavailable。能力列表里有 task/start 也不代表可执行。

处理：前端禁用远程执行并展示限制；不切换无认证模式试跑。真实值必须读取部署环境，静态源码不足以断言当前机器可执行。

证据：[沙箱宣告](../../../apps/daemon/src/remote_sandbox.cj#L18-L81)、[执行门禁](../../../apps/daemon/src/remote_gate.cj#L104-L117)。

### G4：团队审批字段与通用元数据存在待核冲突

team/approval/answer 的 Host 处理器要求 params 恰好四项：teamSessionId、memberId、数字 approvalId、decision。daemon 策略又要求 workspaceId/sessionId，durable 请求还要 operationId。不能简单补齐元数据后宣称能通过 Host 的四字段检查。

处理：普通审批与团队审批分开；团队审批移到后续，并交维护方确认兼容方式，不用 boolean approved/note 自造协议。

证据：[四字段处理器](../../../apps/host/src/main.cj#L1041-L1049)、[策略行](../../../docs/plans/remote-capability-contract.json#L115)。

### G5：workspaceId 来源、SSE 会话过滤与实际部署一致性

initialize 不直接交付绑定 workspaceId；catalog 的 root/目录路径不能自动当授权标识。配对时由部署资料提供 workspaceId，并与 SACODE_WORKSPACE_ID 对齐。

SSE 建流只校验身份，当前路由读取总线；客户端自行按 sessionId 过滤只能防错显，不能代替服务端跨会话保密。多主体共享 daemon 必须由维护方核实服务端过滤，未验收前不作为产品支持场景。

此外需核实 daemon 工作目录、Host 会话根与实际服务二进制均匹配源码。团队与普通 Host 不能混认会话真源。

## 4. 当前 SaApp 差距

| 当前实现 | 问题 | 改造 |
|---|---|---|
| [DaemonTransport](../shared/src/commonMain/kotlin/com/sa/demo/agent/rpc/DaemonTransport.kt) | 固定 bearer；startTask 发送 prompt/mode；poll/cancel 使用 turnId | tokenProvider；显式资源上下文；按真实返回 epoch；两步发送 |
| [AgentRpc](../shared/src/commonMain/kotlin/com/sa/demo/agent/rpc/AgentRpc.kt) | 不验证版本/响应 id；不保留 error.data | 严格信封模型与结构化错误；补幂等错误 |
| [AgentSse](../shared/src/commonMain/kotlin/com/sa/demo/agent/rpc/AgentMethods.kt) | 只读 data 行，顶层文本猜测 | 完整帧 parser，解析 notification.params 与 durable/close |
| [平台 SSE](../shared/src/androidMain/kotlin/com/sa/demo/core/platform/Platform.android.kt) | 丢空行；不交付 Content-Type；readTimeout 固定 | 新增 Agent 专用完整帧网络能力，不破坏 Gateway Chat 旧行接口 |
| [AgentRegistry](../shared/src/commonMain/kotlin/com/sa/demo/agent/AgentRegistry.kt) | 本地设备 ID 与 daemon 签发的客户端设备 ID 易混淆；只存 bearer | targetId、instanceId、enrolledDeviceId 分离；credential 独立安全存储 |
| [AgentPage](../shared/src/commonMain/kotlin/com/sa/demo/feature/agent/AgentPage.kt) | 参数输入型协议控制台，SSE 只写日志 | 产品设备页与连接状态；任务/审批交给会话控制器 |
| [ChatPage](../shared/src/commonMain/kotlin/com/sa/demo/feature/chat/ChatPage.kt) | 只调用 Gateway Chat；任务为 CloudSyncApi + Chat 回退 | 明确“云端聊天”和“PC Agent”两种来源；不把 PC 失败变成云端完成 |
| [MainActivity](../androidApp/src/main/java/com/sa/demo/MainActivity.kt#L94-L104) | 切页移除 View 并替换 handler，未显式 detach 旧 delegator | 明确生命周期清理，迟到回调隔离；控制器不跟 Pager 临时实例同寿命 |

现有测试中硬编码旧白名单/参数的断言必须改成最新真实夹具，不能用旧测试全绿证明接口对齐。方案实施期间保留既有未提交改动，不自动覆盖或提交。

## 5. 客户端设计

### 5.1 分层

```text
Kuikly 页面（设备 / 对话 / 审批卡）
    ↓ 意图与只读状态
RemoteSessionController + TargetConnectionManager
    ↓ 类型化方法、状态机、operationId
DaemonRepository + RemoteAuthRepository
    ↓ JSON-RPC / 完整 SSE / TLS / tokenProvider
可替换网络接口 + Android 实现
```

- 会话定位键为 `(账号标识, targetId, instanceId, workspaceId, remoteSessionId)`，本地 Gateway 对话另一个命名空间。
- 连接 epoch 隔离迟到响应；切目标只停止旧订阅，不隐式取消 PC 任务。
- 控制器持有进行中的任务/续期/重连，Pager 只订阅状态；后台无限执行不作首期承诺，Android 后台断连后回前台查事实恢复。
- 业务状态更新回 Kuikly 正确执行线程，实施时查阅官方线程/生命周期文档，不认为 Android 主线程必然等于 Kuikly 执行线程。
- enrollmentSecret、credential、accessToken、Gateway api_key、IdP token 各有独立命名与用途；不混用认证材料。
- 令牌续期 single-flight；只在安全读请求允许的条件下自动补试。写请求按步骤与操作号核实，不因续期无条件重发。
- secrets 不写日志、不在设备详情回显；删除绑定清除相关凭据。账号退出的凭据保留策略首期采用清除该账号的远程凭据并断订阅；必须明确提示重新绑定需求。

### 5.2 界面

- 设备：地址、展示名、协议设备名、workspaceId、一次性登记秘密；状态区分未登记/续期中/可读/权限不足/执行受限/断线/已撤销。
- 对话：顶部明确目标与来源；PC 会话列表来自 daemon，不沿用本地 Conversation 当事实。初期事件历史可展示，复杂正文投影未就绪时不伪造助手消息。
- 执行：`提交中 → 已提交 → 启动中 → 运行中 → 等审批 / 取消请求中 → 结算中 → 已完成 / 已取消 / 失败 / 结果未知`。
- 批准卡：显示目标、会话、工具、参数摘要和工单号；一次批准/拒绝；非 pending 或来源不明不可操作。没有明确工单不显示批准按钮。
- 重连：到期尝试凭据兑换；撤销停止并引导重新登记；网络失败指数退避加抖动；背压先补读再重连。切页不重复建立多条连接。

## 6. 分阶段实施与交付门禁

### P0：协议基础修正（可独立实施）

1. 类型化请求/响应与 error.data；响应 id/版本校验；请求体大小和 URL 真正解析。
2. 严格回环判断，拒绝 localhost 前缀伪装、userinfo、非 HTTP(S) 等地址。
3. 完整 SSE parser、分页模型、通知模型；保留原 Gateway Chat SSE 接口。
4. requestId / operationId 分离、请求上下文、连接 epoch、可替换 transport 测试接口。
5. 更新旧协议说明与错误/白名单测试，不先开放执行按钮。

验收：纯逻辑与 mock 网络测试通过，Android 构建通过；SaCode 无写入。

### P1：绑定与只读闭环（推荐第一批产品交付）

1. 登记、credential 加密保存、短期 token 续期与撤销处理。
2. initialize 解析完整宣告；配对配置 workspaceId。
3. session/catalog 与 session/events 只读访问；分页、代次 gap、断线续读。
4. 设备页状态收敛，资源键命名与账号隔离；订阅/页面生命周期清理。

验收：真实受保护 HTTPS 环境完成“出票 → 手机登记 → 续期 → 列会话 → 读历史 → 断线恢复 → 撤销后拒绝”；scope 不足、沙箱限制如实显示。

### P2：受保护任务闭环（条件满足才实施/开放）

前置：G1 授权流程、G2 正确会话定位、G3 enforcing 必须明确并经过部署验证。

1. 按 submit/flush/start 流程发送；保存分步回执与 operationId。
2. turn/poll 增量与最终结算；cancelRequested 不作终态。
3. 任务完成后重取服务端消息投影；本地只缓存展示，不自己写一份 PC 事实历史。
4. 普通模型审批 SSE 卡片 + approval/status + approval/answer。
5. 断线和未知回执恢复，不自动重做已可能执行的操作。

验收：真实任务正常完成、生成中取消、审批批准/拒绝/过期、断线后最终状态核实；两个会话交叉请求不能写错/停错/批错。

### P3：扩展能力

模型只读列表、Git 状态/差异、队列、目标、附件、团队等按实际能力逐项扩展。团队审批先解决 G4，跨主体共享服务先解决 G5。首期不做完整桌面工作台、不做新云中继、不做任意 RPC 输入框、不默认开放修改模型凭据等管理功能。

## 7. 测试与验收矩阵

| 分类 | 必测反例 |
|---|---|
| RPC | id 错配、版本错误、result/error 同时出现、嵌套 error.data、HTTP 200 业务错、超限、重定向 |
| 登记 | 中文/超长协议名、过期/已消费票据、登记响应丢失、credential 保存失败、错误实例 |
| 续期 | 并发请求只续一次、expiresInMs 单位、撤销不无限重试、401 与 scope 拒绝分开 |
| SSE | UTF-8 分片、多行 data、空行、CRLF、close、ephemeral 无游标、超过 200 条补读、重复事件 |
| 恢复 | generation 变更、cursor gap、切设备迟到帧、切页重复连接、提交成功但启动回执丢失 |
| 执行 | enforcing=false、缺 execute、模型未配、租约被占、poll 结算/flush 错、取消只是请求 |
| 审批 | 数字 ID、错误会话/宿主、已过期/已消费、拒绝回执、团队四字段冲突 |
| 隔离 | 两账号/两设备/两会话分别保存状态；客户端过滤不替代服务端授权；退出后无旧回调更新 |

验证层次分开登记：静态源码契约 → 客户端 mock 测试 → 客户端构建 → 真实 daemon 只读联调 → 真机 HTTPS → 真实执行。mock 全绿不标记真机或 CLI 执行通过。

禁止在 SaCode 工作区做联调副作用。后续真实任务若获授权，使用部署方准备的可运行服务与独立验收工作区（位于 SaCode 源码仓之外），不在该仓启动会写日志/快照的 daemon。

## 8. 用户需确认的下一步

推荐批准 **P0 + P1：协议修正、安全绑定与只读闭环**。P2 不因批准本方案就绕过其后端门禁。

需部署/维护方提供：

1. 可达 HTTPS daemon 地址、证书信任方式、workspaceId、源码/二进制版本。
2. 已有本机受保护设备授权流程（execute/approval），或明确当前只能只读。
3. 普通 Host 的远程 sessionId 寻址与多客户端隔离承诺；不以“有字段”代替行为保证。
4. 实际 sandboxEnforcement；无强制隔离时客户端保持禁用执行。
5. 团队审批元数据兼容与 SSE 服务端会话过滤的确认结果。

本方案没有修改上述后端能力。遇缺口提交契约问题清单给维护方，不擅自改 SaCode。
