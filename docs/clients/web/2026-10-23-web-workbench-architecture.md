# SaCode Web 工作台与部署实施方案

> 日期：2026-10-23。状态：设计提案，待评审；不是 Web 已实现、已部署或安全验收声明。
> 核对基线：HEAD `a0b16c38a1147708f2ef75302695092f3d3ed833` 及编写时工作树。PRD、原 Web 方案、桌面及移动端已有其他会话未提交改动，本轮不覆盖。
> 本轮只新增本文，不创建业务骨架、不安装依赖、不启动服务、不部署、不提交或推送。

## 1. 推荐结论

**独立 Vue 3 + TypeScript Web 前端，同源 Node.js BFF，复用受保护 daemon 的 HTTP JSON-RPC + SSE，再由 daemon 驱动 Host/core。**

- 浏览器是任务工作台；服务端工作区才是实际读写、编译和执行的地方。不是静态聊天网站，也不是把用户浏览器里的电脑文件自动授权给云端。
- 首批面向可信单用户、自托管、固定工作区部署；同一用户多个浏览器/标签页也必须正确隔离和恢复，不等于多租户已经解决。
- BFF（Backend for Frontend，浏览器专用后端）承担浏览器会话、CSRF/Origin 防护、有限动作映射和目标路由，不建立另一套任务、审批、幂等或 Agent 主循环。
- 首版采用 HTTP 请求 + SSE 流；WebSocket 不是必需项。后续真实双向高频能力需要时再评估，不先造一条任意 RPC 管道。
- Vue 3 + TypeScript + Vite 为推荐选型，不是已安装资产；Node 和依赖版本在 W01 固定并按许可证/维护状态核查。

## 2. 与现有初稿和产品路线的关系

上位路线见 `docs/product/PRD.md` 的 W01–W04；初稿为 `docs/clients/web/2026-10-22-web-deployment-design.md`。本文是该初稿的架构修订提案，评审前不自动改写其状态或根台账。

| 初稿表述 | 本方案修订 |
|---|---|
| WS 桥直接转 Host 全量方法 | BFF 只提供有限业务动作，经过现有 daemon 认证/策略/幂等入口；不裸露 Host |
| 一个浏览器连接对应一个 Host | Host 生命周期归服务 supervisor/daemon；连接不是进程、用户或会话安全边界 |
| 断连就停止 Host | 关闭浏览器只结束订阅，不等于取消任务；服务停机单独结算 |
| `session/new`、`turn/start` | 不作为当前契约；核实的是 `session/create`、`task/start` 等实际方法 |
| `turn/poll` 是无 id 通知 | 它是请求/响应，且当前 Host 实现消费共享 turnSink；不能让每个标签页独立抢读 |
| token 放 URL/query 或普通前端存储 | 浏览器只持 HttpOnly 会话 cookie；daemon credential/token 只在 BFF 侧 |
| 复用 HostBridge 就有安全桥、约 200 行、零回归 | HostBridge 可作分帧/超时参考，但不是 Web 安全边界；工作量和回归必须实测 |
| file/CSP/h() 导致桌面不能复用 | 可选择性复用纯逻辑和组件；不重构 Electron 是风险控制取舍，不是浏览器技术不可能 |

Web 不必等待移动 Relay/SSH 交付；两端共享 daemon 安全与任务归属修复，但浏览器认证、网络限制和交付独立验收。

## 3. 已核对的复用资产与阻塞点

| 资产 | 已核对事实 | 决策 |
|---|---|---|
| `apps/daemon/src/daemon.cj` | 有 HTTP RPC、SSE、认证/限额/幂等分派；门禁未启用时存在旧本地路径 | Web 只能接显式启用远程认证与策略的实例，不因 loopback 而绕过 |
| `apps/daemon/src/host_proxy.cj` | 有有限转发方法集；Host 能力和 daemon 可达面并非相同 | BFF动作 ∩ 远程契约 ∩ 实现 ∩ 当前主体授权，缺一拒绝 |
| `docs/plans/remote-capability-contract.json` | 登记方法、资源、scope、durable；当前 clientConsumers 未含 web | 接入前更新消费登记与契约测试，不把已有客户端名单自动当 Web 授权 |
| `apps/desktop/remote-transport.mjs` | Node/undici HTTP+SSE、每目标 CA/pin、请求配对、限额、目标代次 | 优先评估供 BFF 复用；不是浏览器原生模块，也不能不审计直接当完整客户端 |
| `apps/desktop/target-bridge.mjs` | 每目标路由/代次，未知目标拒绝，不回落本机 | 复用原则和定向测试；不依赖全局 default target 决定请求归属 |
| `apps/desktop/host-bridge.cjs` | stdio NDJSON、请求配对、超时和子进程生命周期参考 | 不作为 BFF 首选后端路径，不把原始 Host 任意开放 |
| 桌面 renderer | Vue 3 runtime、消息/队列/会话状态、Markdown/代码高亮资产存在 | 小范围移植纯函数/组件、补 Web 构建；不复制整个 Electron IPC |
| `apps/desktop/renderer/markdown.js` | html:false、不加载外部图片、按 token 构造 Vue 节点 | 保留低信任内容边界，适配浏览器链接/下载策略，不用 innerHTML 代替 |
| `scripts/pack-service.mjs` | 同包 CLI/Host/daemon/extjs/运行库及逐文件摘要 | 扩展 Web 交付资产和可追溯性；现包不含可运行 Web 服务 |
| `apps/web/` | 本轮定向检查未发现现有工程 | 新增工程须后续授权，不把设计当成上线 |

### 任务开放前必须解决

1. **初始化工作区契约**：空 params 的 initialize 与 boundWorkspace 检查可能冲突。按实际契约补反例，决定客户端上下文或 needsWorkspace 判定；不删归属防线。
2. **真实 session→turn→审批绑定**：Host 当前 task/start 有 activeId 路由，turn/poll 从共享 sink 取帧，turn/cancel 操作当前 handle；不能用 session/select 抢全局会话凑隔离。
3. **轮询不等于无副作用读取**：turn/poll 即使登记为 read，也有消费队列效果。不得由页面自动重试/并发消费来假装纯投影接口。
4. **scope 授予与沙箱**：有登记/token 原语不等于已有 execute/approval 的可信授予操作面；沙箱未强制就保持执行拒绝。不能通过 BFF 使用共享管理 token 绕开。
5. **持久恢复证据**：SSE 补读/直播已有服务端策略防线，但需要对候选做多主体运行验收；任务/输出是否足够持久必须验证，不把临时 ring 当恢复真源。

上述问题与移动直连共用后端，但 Web 的验收仍要独立完成。实施时再核当前源码，不以旧审计行号代替现状。

## 4. 首发范围与非目标

### 首发范围

- 登录/退出、当前服务与工作区识别、会话目录、持久历史和任务状态。
- 分阶段开放创建会话、发起实际任务、流式结果、精确审批、取消、差异与测试结果。
- 断线/刷新恢复、明确 unknown/blocked/failed/cancel-requested，不能把“有回复”当代码任务完成。
- 桌面浏览器优先；移动浏览器可访问不等于原生移动端功能已验收。
- 配置与凭据先由服务端可信管理入口提供；Web 首版不暴露模型密钥、SSH、插件安装或任意目标管理。

### 非目标

- 公共多租户 SaaS、任意用户注册、多人同时编辑同一会话、跨用户共享工作区。
- 浏览器任意本地目录/终端/SSH、任意文件上传、任意 URL 代理或直接执行用户给的服务端路径。
- 重写 core/审批体系、改 Electron 入口、让网页直接 spawn Host。
- 首版 PWA 离线任务、后台自动发送/重放、Service Worker 缓存私密会话。
- 在本次设计中决定视觉布局、品牌或组件风格；视觉与交互专项后续另立，不借架构方案擅改界面。

## 5. 推荐架构与部署拓扑

```text
浏览器：独立 Web 前端
   │ 同源 HTTPS（HttpOnly cookie + CSRF）
   ▼
入口反向代理 / Web BFF
   ├─ 静态资源
   ├─ 浏览器会话、有限动作、目标/工作区绑定
   ├─ 有界请求 + SSE 事件适配/读取协调
   └─ 服务端凭据仓 / daemon 客户端
          │ 受保护 HTTP(S) RPC + SSE，设备身份和有限 scope
          ▼
         daemon ── 单一 Host / core ── 服务端工作区与执行沙箱
```

### T1：同机自托管（首选）

Web/BFF/daemon 在用户自己的电脑或服务器，浏览器访问同源 HTTPS 入口。仅暴露 Web 入口；daemon、Host、管理接口不直接公开。BFF→daemon 可在严格同机 loopback 采用已启用认证的 HTTP 例外，必须绑定可信本机边界并验证门禁配置；跨机器、容器网络或 Relay/SSH 通道一律 TLS，不把“私网”当免认证理由。

### T2：服务器工作区

服务安装在哪，默认任务就在哪运行。浏览器上传提示词不等于上传整台本地电脑；工作区由管理员预先创建/绑定。导入仓库、凭据和网络访问若新增，单独审批与评审，不在此方案暗加自动 clone/install。

### T3：云端 Web 控制家中电脑（后续）

云 BFF 无法凭一个私网地址自动访问用户电脑。需要可达的受保护 daemon，或后续 Relay/SSH 服务端通道适配。浏览器不能运行原生 SSH，也不能用 JS 绕过系统 TLS 信任来 pin 自签名证书。

与移动中转的差异：**BFF 能读到用户提示词、输出，并托管 daemon 设备凭据，是可信业务端点；字节 Relay 才是不解密中转。** 云端 BFF 方案不能声称浏览器到家中 daemon 端到端不可见。若要求云服务不能看到内容，须另做浏览器端加密/直连架构评审，不伪装本方案已支持。

## 6. 浏览器身份与 daemon 权限映射

### 6.1 两层身份，不复制业务授权

- 浏览器登录认证“谁能使用这个 Web 入口”；daemon 设备认证“这个服务端主体可对哪个实例/工作区做什么”。这两层必要但不同。
- 首发一个预置 owner。安装时经本机管理流程配置登录材料，拒绝默认密码与匿名公网入口；可选外部 OIDC 接入后续独立验证。
- 本地登录推荐成熟口令哈希库（例如 Argon2id）验证服务端保存的加盐哈希，具体依赖/参数在 W01 依运行环境核定；不自己写密码算法。初始化/重置材料只在受保护本机入口使用，不放 URL 或前端 bundle。
- 采用 OIDC 时由 BFF 保存 token、校验 issuer/audience/state/nonce/PKCE 和固定回调；当前仓库不因此视为已有可用 Web client_id。不要信任未经受信代理验证的任意身份头。

### 6.2 浏览器会话

- 服务端生成高熵、不透明 session ID，浏览器仅保存 `__Host-` 前缀、Secure、HttpOnly、Path=/、无 Domain 的 cookie；SameSite=Strict 为本地登录默认，若外部登录回调需 Lax，定向验证后调整，不默认 None。
- 会话数据只在服务器保存。建议初始策略：30 分钟闲置过期、8 小时绝对过期；作为待 W01 冻结值，活动定义不被 SSE 心跳无限续命。
- 登录轮换 session ID，退出/重置即时撤销、关闭该登录态订阅、清理内存投影。Cookie 不使用普通 JS 存储，不写 localStorage/sessionStorage/IndexedDB。
- 不把 session ID、daemon token、长期共享密钥放 URL、页面源码、分析日志或错误回显。OIDC 标准一次性 code 若有，回调立即消费并重定向到干净地址，代理日志须脱敏。
- 服务重启默认使浏览器会话失效，用户重新登录；后端任务是否仍在运行按 daemon/Host 事实显示，不因登录态丢失伪报取消。

### 6.3 服务端凭据与授权

- 管理员在可信本机配置目标并用现有登记路径预置限定 scope 的 daemon 设备 credential；BFF 从受保护 OS/服务秘密存储读取，短 token 仅在内存缓存。
- 凭据映射至少绑定 owner、targetId、instanceId、workspaceId 和角色修订；浏览器不提交任意 baseUrl、credentialRef、principalId、workspace 路径。
- 同一 owner 的多个登录态可映射一个有限设备主体，但 BFF 必须保留每次浏览器会话/操作的审计关联；不能据此声称多用户隔离。后续多用户至少独立设备主体和资源授权，不共享管理 credential。
- BFF只做现有能力的收窄与映射，不能提升 scope。execute/approval 授予路径未核实则保持关闭，不自行编辑身份文件或用 management token 代办。
- 退出浏览器与撤销 daemon 设备是不同动作；前者不自动中止已获准任务。失窃/停用时由可信管理面撤销后者，并验证在途 SSE 也结束。

## 7. 浏览器安全边界

1. **同源默认**：静态页、API、事件由同一入口提供；默认无跨域 API，不开 `Access-Control-Allow-Origin: *` 配 credentials。反向代理只信任显式配置的代理跳数和 Host。
2. **Origin/CSRF**：所有状态改变动作只接受 JSON POST，要求精确 Origin、会话绑定 CSRF token 和自定义头；拒绝不符合预期的 Fetch Metadata。登录也要防 login CSRF，不能只依赖登录后 token；必要预会话 token 在 W01 定档。
3. **GET 只读**：BFF GET 不触发任务、审批或配置修改。事件流建连先校验登录态和可读资源；不依赖浏览器 CORS 就假定无须鉴权。
4. **Cookie 不替授权**：每个动作/订阅均查会话、目标绑定和作用域，daemon 再执行原有门禁。BFF用受验证映射补充上下文，并拒绝客户端试图覆盖。
5. **XSS**：Markdown禁 raw HTML，代码/工具输出作低信任文本，危险 scheme 拒绝，外部图片不自动加载，链接经显式操作并限制协议，新窗口加 noopener/noreferrer。CSP 是加固不是替代正确渲染。
6. **CSP/缓存**：构建期编译模板，默认 script-src self、connect-src self、object-src none、base-uri none、frame-ancestors none、form-action self；style/worker/font 的最小例外随实际依赖验证。敏感 API/HTML no-store；静态哈希资源可缓存；不缓存任务内容到离线 SW。
7. **文件/下载**：首版仅允许授权工件的 opaque ID，不接任意路径；服务端实际路径归属校验，限制大小/MIME，下载按附件返回并 nosniff。导入/上传独立工作包，不因为页面有按钮就开放。
8. **防 SSRF**：目标只来自管理员受保护配置；无通用 fetch/proxy、无重定向、不接受浏览器传代理地址、MCP URL、SSH 目标或 credentialRef。
9. **受限运营**：登录失败按账号/来源有界限流，不采用易被恶意永久锁死的策略；并发、请求体、响应/流帧、队列、订阅数、超时均有上限。
10. **会话风险说明**：HttpOnly 可防脚本读取 cookie，不能阻止已执行 XSS 借用户会话发动作；精确审批、内容隔离、CSP 和依赖审计都不能省略。

## 8. 有限动作与当前 RPC 的对应

下列为拟定内部动作名，不是已存在 HTTP 路由。Web 不提供 `{method:any,params:any}` 入口；schema、资源和可用阶段逐项登记。路径格式在 W01 冻结。

| Web 动作 | 当前 daemon/Host 依据 | 准入 |
|---|---|---|
| 初始化/目标摘要 | initialize | W02；先解决工作区上下文与身份核验 |
| 会话目录/历史 | session/catalog、session/events | W02 只读首批；分页、generation、游标与授权一致 |
| 工作区/差异只读 | workspace/get、workspace/files、workspace/git-status、workspace/git-diff | W03 单独审核输出字段和路径；不因 read 标签全量放行 |
| 创建会话 | session/create | W03；核回执与资源绑定，durable operationId |
| 发送实际任务 | task/start；session/submit、session/flush 按真实契约分清 | W03；append/flush 不是启动编码任务，先核后端归属与执行条件 |
| 在途读取 | turn/poll 或经验证持久事件/投影 | 只由服务端协调器消费，禁止各标签页竞争读取 |
| 审批显示/回答 | approval/status、approval/ask、approval/answer | W03；工单与主体/实例/工作区/session/turn/动作摘要绑定；team 审批不混用 |
| 请求取消 | turn/cancel | W03；cancelRequested 不是终态，须继续查结算 |
| 结果/执行证据 | session/events、execution/describe、execution/output、ledger/stats 等候选 | 逐个核字段和可达实现，不预先声称都已满足 Web 产品需要 |
| 模型目录 | model/registry/catalog 等候选；若 model/list 仅指定已配置 providerId | 后续受控增量；不接浏览器自选 baseUrl/apiKey/credentialRef |
| 管理/插件/凭据/终端 | 非首发动作 | 默认拒绝；未知动作网络前拒绝，不能用隐藏前端按钮代替限制 |

有效开放面 = Web动作清单 ∩ 当前远程策略 ∩ daemon实际实现 ∩ 主体资源授权 ∩ 执行前置条件。契约可达、capabilities 列出，不等于用户获准。

## 9. 事件、轮询、幂等与多标签页

### 9.1 浏览器传输

- 请求用同源 fetch；事件优先用 fetch 可读流解析 SSE，便于 AbortController、错误状态检查和携带恢复头。若用 EventSource 也只依赖同源 cookie，绝不将 bearer 放 query。
- BFF→daemon 使用服务端 token；浏览器从未接触它。BFF 输出结构化、经过字段/资源过滤的事件，不转发所有 Host 通知。
- 反向代理事件路径关闭响应缓冲，配置心跳/空闲超时与压缩策略；SSE 对 UTF-8 分片、CRLF、多行数据、超大帧均有测试。

### 9.2 读取协调与真源

- 每目标/受限在途轮次有一个服务端消费协调器，合并浏览器订阅；不按浏览器连接各起一个 poll，更不能让 BFF 与桌面/CLI 同时抢同一个全局 turnSink。
- 仅 BFF 内部串行锁不解决其他客户端争抢。任务开放必须先定后端可寻址的 turn 所有权/持久读取方案；若未具备，拒绝并发执行，不能用“首发单用户”掩盖多客户端消费问题。
- SSE 用于实时提示/经授权事件；丢帧、重启或 generation 变化以持久 session/events/投影补齐。临时缓冲区只能加速，不能创造任务终态。
- 若消费帧与持久事件写入之间存在崩溃缺口，W03 先修后端持久化/读取契约，再开放任务。BFF 不自建另一份完成账本冒充核心事实。
- 输出扇出有界；慢客户端可断开并提示补读，不丢审批/终态后假装完整。合并中间显示刷新可行，但不能静默删掉核心事件。

### 9.3 操作 ID 与未知态

- 浏览器为一次显式用户动作生成非秘密 operationId，BFF校验后端到端保留，不能重试时新造 ID。幂等键不是访问凭证。
- daemon幂等仅覆盖契约 durable 操作；不泛称所有 read/execute 都能安全重试。参数不同而同键冲突必须明确拒绝。
- 超时/网断/502/进程异常若不能证明未发送，就是 unknown；不自动重发修改、任务、审批、取消，也不把 unknown 改成 failed/done。
- 刷新恢复可以由 BFF 保存最小操作关联（主体/目标/operationId/摘要/已知请求阶段），但它不是业务完成真源。daemon 若没有可查询操作状态接口，明确待核实，不编造 operation/status endpoint。
- 已知正在运行的任务，关闭标签页/退出登录只断开观察；取消需用户明确请求且后端真实结算。服务策略停止/崩溃另外记录，不能归因成用户取消。

### 9.4 上下文与权限变更

请求和回调绑定登录会话代次、targetId、instanceId、workspaceId、sessionId、connectionEpoch；迟到回包不得污染新视图。持久游标按实例/工作区/session/generation 隔离，不因会话名相同合并。

首批同一会话只允许一个活动写入者；其他标签页可读并看到受限状态。写入租约是产品并发控制，不是用户隔离；租约失效不触发任务重发，审批仍服务端一次性消费。

浏览器登录态/权限失效时关闭相关流；BFF 缓存 token 不得掩盖 daemon 撤销。任务是否因策略继续或停止须以核心约定显示，不能凭 BFF logout 推断。

## 10. 服务生命周期与部署

### 10.1 进程责任

- supervisor 管理 BFF、daemon及其 Host/extjs 生命周期；首发固定部署/工作区，不使用浏览器请求传入 cwd、exe 或任意环境变量。
- 一个连接不 spawn 一个 Host；同一部署复用受控后端，避免全局会话状态分裂。多工作区/多用户隔离以后独立设计。
- 网页断连不停止后端。计划停机先停止接新动作，提示维护，核活动任务、结算与持久化，按已验证 shutdown 路径回收；强制结束如实记 unknown/forced。
- BFF/daemon 必须使用显式的最小环境，不继承无关真实密钥。Host/extjs 必需变量按白名单保留，不用“净化已存在”替代实际测试。

### 10.2 同源可追溯服务包

在现有 pack-service 上新增 Web 专用封装或显式可选打包流程，最终选择 W04 冻结：

- 前端静态资源、BFF入口/生产依赖、明确 Node运行时要求或随包运行时、daemon/Host/extjs/运行库。
- service manifest 扩展版本/roles，登记每个生产文件、字节数与 SHA-256，保留原包校验兼容策略。不得自动扫描并打入用户数据、日志、秘密、node_modules 全树或 workspace。
- Git SHA 单独不足以证明 dirty 工作树来源；发布候选要求干净固定提交或带完整输入源码摘要与dirty标识，真实部署产物逐文件核验。
- 秘密/工作区/运行数据与只读应用包分离；构建期无生产凭据，无外部 CDN 必需资源。
- Linux 服务端与 Windows 自托管分别取证；容器是可选分发，不等于自动具备执行沙箱，更不能用特权容器/宿主挂载绕过。

### 10.3 安全运维

- 外部入口 TLS；代理只暴露明确静态/API/事件路径，不转发任意 daemon /auth 或管理路径。
- liveness 只表示进程存活；readiness核配置/身份/策略/目标/协议。无沙箱时可明确只读就绪，execute 不就绪，不能统一亮绿冒充可执行。
- 诊断不回显token、文件正文、主机私密路径或完整环境；审计记录登录会话关联、主体、目标/资源、操作ID、拒因和已知执行阶段。
- 日志默认不记录提示词、消息正文、审批秘密、cookie/认证头。指标包括有界并发、事件滞后、拒绝/unknown、重连、内存和进程状态，不把健康探针变收费模型调用。
- 升级前检查日志/状态schema和活动任务，不只替换静态页。回退应用不自动回退业务数据；遇不兼容迁移失败关闭并保留恢复证据。
- 服务端部署只由用户另行授权；本方案不创建证书、不改防火墙/ACL、不注册系统服务、不拉云资源。

## 11. 分阶段交付与准入

| 阶段 | 交付物 | 准入/出口 |
|---|---|---|
| W01 契约与安全设计 | 冻结浏览器登录/会话、动作schema、目标/资源映射、初始化、任务归属、生命周期、流和限额；确定依赖 | 反例矩阵评审，未知能力标blocked；不把本设计自动记成W01全部完成 |
| W02-A 只读BFF PoC | 服务端受限凭据、浏览器登录、同源cookie/CSRF、initialize/catalog/events、合成事件流 | 越权/CSRF/错误实例/过期会话/超大体/重定向均拒绝；仅记只读PoC（证据见 [`../evidence/2026-10-23-web-w01-w02a-poc.md`](2026-10-23-web-w01-w02a-poc.md)；真实 daemon 目录/SSE 补读受 P0 闸门未验证） |
| W02-B 恢复与故障PoC | 实例/代次隔离、SSE背压/断连/撤销、请求配对、超时未知分类、进程清理探针 | 真实daemon+Host候选和合成故障对照；不以握手通过宣称可部署 |
| W03-A 最小只读工作台 | 浏览器登录后目标/目录/历史/状态的实际入口 | 页面对真实只读链路可用；不展示伪装可执行按钮；浏览器专项测试独立 |
| W03-B 真实任务闭环 | 会话创建、精确审批、实际执行、差异/测试、取消/恢复 | 后端session/turn绑定、scope授予、沙箱、持久恢复和单消费者问题先闭合；读→批→改→测→结算及拒绝/失败/取消/未知态分别取证 |
| W04 同源交付部署 | 可追溯包、TLS代理配置、秘密管理、服务监督、配额、监控、停机升级回退文档 | 在明确OS/浏览器的固定产物上完成安装/运行/故障/回退；首发可信单用户，不冒充多租户 |
| 后续扩展 | 多目标、Relay/SSH服务端适配、管理功能、协作/多租户 | 各自独立授权、威胁模型与产品验收，不顺带开放 |

W03-B 与移动 M04-B 共用后端问题清单，但 Web 的 cookie/CSRF/多标签页/浏览器渲染不能由移动 PASS 替代。W04 可以早准备打包设计，真实公开部署仍在认证与安全门槛后。

跨端现状、7 条「打通」判据与 P0 闸门（scope 授予、`turn/poll` 排他、S11、CLI 认证、契约 consumer）见 [`2026-10-23-web-technical-selection.md`](2026-10-23-web-technical-selection.md) §13；W03-B 开工前按该节逐项取证，不以本文阶段表推定已完成。

## 12. 测试与拒绝反例

| 场景 | 必须结果 |
|---|---|
| 未登录、过期/撤销cookie、固定会话ID、登录CSRF | 不发daemon业务请求，登录轮换ID，流及时关闭 |
| 外站POST/简单表单/恶意Origin/伪造Host或代理身份头 | BFF拒绝，不靠CORS或SameSite单独兜底 |
| 未知动作、batch、通知、深JSON、大体、资源覆盖 | 网络/解析边界有界拒绝，无任意RPC透传 |
| 错目标/错TLS/错instance/workspace/session/scope | BFF与daemon分别拒绝，低scope不能读敏感SSE |
| 两标签页和桌面同时观察/起轮/审批/取消 | 不抢读丢输出、不跨会话取消、不重复消费审批；未能证明时功能保持关闭 |
| 修改已执行但回执被代理丢弃 | unknown、无自动重发、原operationId保留，恢复按持久事实 |
| SSE半帧/UTF-8分割/重复/缺口/generation变更/慢消费者 | 正确解析/去重/补读或明确不完整；有界内存，不伪造终态 |
| Markdown注入、危险链接、远程图片、工具输出HTML | 不执行脚本、不隐式联网，无凭据泄露 |
| 恶意下载ID/路径穿越/符号链接/任意上游URL | 归属拒绝，不能读工作区外数据或代理内网 |
| 切目标/退出/浏览器刷新/重启BFF/daemon退出 | 不串回调，断连不假取消；重认证后恢复真实状态 |
| 无强制沙箱、模型/依赖不可用 | 显式blocked/failed，无本机降级执行或假成功 |
| 固定包安装、升级中仍有活动任务、回退 | 实际构建来源可追溯，任务结算/未知态诚实，数据不盲回滚 |

验证分层：纯函数/契约单测 → BFF合成服务 → 真实daemon+Host → 真实浏览器 → 获授权的真实模型任务 → 部署/升级回退。浏览器建议 Chromium/Firefox/WebKit 分列，实际支持范围按测试声明；CI/Playwright配置属于后续实施，不在设计中修改现有CI。

所有安全反例只在本机/隔离自有夹具中模拟，不对公网进行压测。真实模型调用、密钥使用、部署和外网连通另行授权；不把源码检查、可编译、静态站能打开当产品闭环。

## 13. 文件责任与下一切片

### 拟建模块（未创建）

```text
apps/web/
  frontend/       Vue/TypeScript工作台与纯状态逻辑
  server/         浏览器会话、有限动作、CSRF、目标/事件适配
  contracts/      Web动作schema与daemon映射（不复制业务授权策略）
  test/           单测、合成后端与浏览器夹具
```

构建/运行路径及包管理结构在 W01 冻结；不先造空模块。若复用桌面纯逻辑，先以测试证明无 window/IPC/Node副作用，按最小范围抽取，不为Web全面重构桌面。`remote-transport.mjs`/`tls-pin.cjs` 等Node资产先核打包和依赖边界，不把跨目录require当稳定公开API。

后续可能涉及 `scripts/pack-service.mjs` 的显式Web封装、包校验器、daemon/Host共享归属修复、远程契约消费登记；共享热点先协调，禁止覆盖当前并发修改。原 Web 初稿和根索引/台账本轮保留不动，评审通过再同批登记替代关系与状态。

### 推荐下一次实施授权

**W01 收口 + W02-A 的安全只读 PoC**：

1. 用结构化登录态和服务端预配置目标，连接合成daemon完成动作校验。
2. 跑cookie/CSRF/Origin/越权/错误实例与秘密脱敏反例。
3. 在授权隔离环境连接真实daemon，只开放initialize/catalog/events。
4. 输出PoC证据和后端阻塞清单，再申请任务链与部署，不先上公网或任意Host桥。

> 2026-10-23：已按本授权执行 W01 收口 + W02-A 安全只读 PoC（落 `apps/web`），并产出证据文档 `../evidence/2026-10-23-web-w01-w02a-poc.md`：BFF 安全面 + 合成 daemon 只读链路 fully tested（49 测试、双端 typecheck、独立运行冒烟 7 项、真实浏览器 Playwright E2E 1 passed）；真实 daemon 链受 P0-3/P0-4/web-consumer 三道闸门约束未验证，未声称各端打通。

### 尚待冻结的选择

- 本地owner登录或已验证的外部OIDC：首版推荐本地预置owner；不是新增账号平台。
- 运行OS：Linux服务器优先候选，Windows自托管并列验证；不从既有Linux构建记录推导Web已通过。
- 首发只绑定一个目标/工作区；多目标不默认切换，目标管理留可信服务端。
- HTTP/SSE为默认；仅在明确新增双向功能和背压需求后评估WS，届时仍校验Origin、cookie会话及逐帧动作。
- 自动跨通道恢复、云端控制家庭电脑、多租户分别是后续工作包，不计入首发完成口径。

本文仅完成方案编写与静态核对，没有构建/运行/真机/浏览器/部署通过证据。
