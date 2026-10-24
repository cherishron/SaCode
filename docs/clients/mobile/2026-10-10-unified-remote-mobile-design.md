# SaCode 统一远程接入与 Kuikly 移动端设计规格

- 日期：2026-10-10。
- 状态：产品边界已确认；本文件是待实施设计，不代表 Linux、认证或移动端已经交付。
- 配套计划：`../plans/2026-10-10-unified-remote-mobile.md`。
- 依据：本轮用户裁决、现行 `docs/product/PRD.md`、daemon/Host/平台源码直读，以及用户提供的客户端审查意见。
- 授权范围：编写规格与计划；不修改实现、不安装依赖、不提交、推送或部署。

## 1. 产品边界与不变量

1. 同包部署：CLI、Host、daemon、扩展运行依赖由 SaCode 安装包交付；远程接入是 daemon 内置可启停扩展，不增加独立桥服务、独立部署或必需云中转。
2. 桌面和 Kuikly 移动端都是客户端。桌面同时可以作为本地目标，但必须显式开启远程接入。
3. 客户端可添加、测试、重命名、切换和删除服务器及内网电脑目标；两者使用相同认证、授权和加密标准。
4. 一个 target 对应一个服务实例。该实例的项目与会话由同一个运行协调器管理；普通请求、团队请求、桌面和手机不能各自启动互不共享的业务实例。
5. 会话选择是客户端视图状态；操作明确绑定 workspaceId/sessionId，不依赖宿主全局 currentSession 的先选后执行竞态。
6. 切换目标不迁移会话、不停止旧任务、不自动降级到本机，不跨目标重发失败操作。
7. 会话日志是业务事实真源；客户端缓存、SSE 和审计日志不能成为第二套会话真源。
8. 身份校验及权限判定由目标端执行。客户端的批准请求不是最终授权，不能自报身份、角色或 allowed-once 凭据。
9. Linux 服务器为必需交付项；当前未支持，移植与实机验收是部署硬门槛，不用 Windows PASS 推定 Linux PASS。
10. 手机是完整移动工作台，不是只读遥控器；保持功能范围，按屏幕适配交互。

## 2. 当前证据与限制

以下为 2026-10-10 工作区静态观察；存在大量其他会话未提交改动，路径以符号锚点为准，实施前重查 HEAD 与工作区。

| 面 | 观察 | 设计后果 |
| --- | --- | --- |
| daemon 协议 | `apps/daemon/src/daemon.cj` 的 dispatchRpc 提供 initialize、session/catalog、团队和白名单 Host 转发；main 注册 /health、/rpc、/sse | 复用 JSON-RPC，不新增 REST 业务门面 |
| 监听及请求大小 | main 绑定 127.0.0.1；readBody 已限制 1048576 字节；HTTP 路由未做认证 | 保留大小上限，补 TLS、逐请求认证、方法与授权过滤，而非重写已有上限 |
| 宿主实例 | 全局 teamHost 与 hostProxy 是不同桥对象；session/catalog 从 daemon 当前目录读 | 有会话基础，不代表唯一实例归属已验收；须统一目录与执行协调器 |
| 白名单/超时 | `host_proxy.cj` 的 hostMethods 有会话、工作树、turn/cancel；HostProxy 默认等待 30 秒，且拒绝未配置宿主 | 保留明确错误与有界等待，补审批/队列等能力，不能无限制透传 |
| SSE | `eventbus.cj` 的 EventBus 每订阅队列 1024，溢出关闭；publish 向全部订阅扇出，没有身份过滤与持久游标 | 复用背压机制，新增授权过滤及日志补读 |
| Windows 依赖 | README 环境要求为 Windows x64；core 的 procwin/sigwin 绑定 kernel32；各 cjpm.toml 只有 Windows stdx target | Linux 不是安装即用；需要平台隔离与 POSIX 提供者 |
| 持久屏障 | 工作区未跟踪 `core/src/durable_checkpoint.cj` 的非 Windows appendDurablePrefix 恒 false | 实施前确认归属；Linux 屏障必须真实实现，不能只编译通过 |
| 沙箱 | `core/src/sandbox.cj` 的 SandboxRuntime.confine 校验模式后原样返回 argv；矩阵 sandbox 行明确缺 OS 后端 | 模式字符串不是隔离。远程代码执行必须通过 OS enforcement 验收 |
| 打包 | pack-cli.mjs 固定 windows_x86_64_cjnative、exe、DLL；缺 Linux 同包 CLI/Host/daemon 交付链 | 增加 Linux 平台包及同包服务清单 |
| 桌面 | host-bridge.cjs 启动本地 stdio Host；本轮未找到远程连接适配 | 增加统一目标适配，开放接入时桌面须复用本地 daemon 实例 |
| 手机 | 本仓未找到 Kotlin/Kuikly 工程、AgentLink.kt 或 validatedBase | 用户提供的 /task、/queue/status 与 daemon 错位是外部证据，未独立读原文件；不能虚构其路径 |
| Kuikly | 已载入 NetworkModule 参考：httpRequest 可设置 headers/timeout，未提供 SSE 增量接口与证书绑定证据 | JSON-RPC 优先 NetworkModule；流/安全能力以原生适配验收，不承诺普通回调可读 SSE |

## 3. 架构与部署

```text
桌面连接管理 ─┐
Kuikly 手机 ──┼─ HTTPS JSON-RPC + SSE ─ daemon 远程接入扩展
远程 CLI ─────┘                         │ 请求级身份/授权/审计
                                       └ 统一运行协调器 → Host/core
                                                            └ 受控工具子进程
```

服务端只有一个对用户可见的 daemon 服务生命周期。内部 Host/工具子进程继续保留，不等于新增部署单元。daemon 不接收任意 shell 字符串作为管理操作；任务执行必须经过核心工具流水线。

默认只允许本机访问；开启外部接入必须同时配置 TLS、身份存储及部署策略，缺一启动失败。禁止通过直接绑定 0.0.0.0 将当前裸 /rpc 暴露出去。可绑定指定网卡；不自动修改防火墙或公网路由。

服务器通过 CLI 完成实例初始化、证书配置、客户端登记与撤销，再启动随包 daemon。桌面设置提供接入开关、地址、证书身份、已登记设备、连接数和审计入口；开启/关闭与目标切换分别处理。关闭接入拒绝新请求并结束远程订阅，不冒充运行任务已取消。

### 3.1 防御纵深取舍

同包部署不要求单进程，但本规格采用 daemon 内置网络接入，确实少于独立低权限网络代理的一层进程边界。TLS、请求鉴权不能消除 daemon 被攻破的风险。

补偿基线：非 root/非管理员运行；daemon 管理代码不执行用户命令；工具执行位于独立受控子进程；方法闭集；业务授权在核心执行前再次检查；有限资源与审计。OS 沙箱不能撤销网络进程已经获得的权限，不宣称零风险。若不能满足此基线，外部接入不得作为安全可执行产品发布；不以部署一个额外桥服务绕过本轮已确认边界。

## 4. 身份、认证与授权

### 4.1 身份模型

- instanceId：初始化生成并持久保存；重启不变。更换服务端身份/证书必须显式重新信任。
- principalId：本实例内的授权主体，不是 SaCode 云账号。
- deviceId：每个客户端登记独立设备，关联主体、授权范围和撤销版本。
- 客户端仅保存 credentialRef；秘密存在平台安全存储，禁止 localStorage、普通 JSON、二维码截图或日志长期保存。

### 4.2 推荐认证契约

采用 TLS + 设备独立高熵凭据换取短期 opaque access token。凭据由 OS CSPRNG 生成至少 256 bit，服务端仅保存验证摘要。access token 最长 15 分钟，长连接到期关闭并续接；设备凭据轮换与撤销独立。所有网络，包括内网，都禁止明文 bearer。

首次登记由目标端本地管理入口创建一次性至少 128 bit 登记秘密，5 分钟失效、一次消费；扫码承载实例地址、实例身份和登记秘密，手动输入同样高熵，不使用六位码作为唯一强认证。设备提交登记后由本地管理员确认；无界面服务器使用 CLI 确认。每次兑换原子消费，不能并发复用。

网络最小身份引导端点限定为 POST /auth/enroll 与 POST /auth/token；它们只处理认证、不执行业务，有大小、速率、超时及审计限制。设备列表、确认、撤销只能通过本机受保护管理入口或具有显式管理权限的认证 RPC。/rpc、/sse 每次建立/请求都认证；initialize 不例外。健康探针仅本机匿名读取最小存活信息，远程要求认证且不泄露目录/能力/设备。

TLS 公网使用受信任证书；内网允许通过扫码外带证书指纹绑定服务端，需原生 TLS 适配，不允许 trust-all。证书更新不自动覆盖旧绑定。认证请求不跟随跨主机重定向；凭据不放 query。

### 4.3 请求级权限与审批

以服务端主体与设备授权计算 permitted workspace/session/actions。每个方法登记只读/写入/执行/审批/管理类别，默认拒绝未知方法、未知资源及不完整授权配置。

审批应答提交 approvalId、expectedRevision、用户意图 allow/deny；服务端检查应答者权限、会话归属、过期和单次消费后产生执行凭据。工具执行侧重新核对策略，不能从客户端 params 读取 principalId/role 来授权。

撤销先更新服务端版本，再关闭匹配设备的全部 SSE；授权过滤在订阅建立、每次交付和副作用执行前检查。已运行操作按策略标为撤销后在途并请求取消；不谎称能够撤回已经完成的外部副作用。

## 5. 统一协议与会话归属

选择 JSON-RPC 2.0：POST /rpc + GET /sse。不增加 /task、/task/:id/status 或 /queue/status REST 业务门面。已有客户端若采用 REST，改适配器；不存在的旧接口不做兼容映射。

initialize 返回 protocolVersion、instanceId、platform、serverVersion、可授权 capabilities、sandboxEnforcement。能力必须与实际分派、核心实现及权限相交；缺能力显示明确限制。

业务请求例（是拟新增显式归属契约，不代表当前 Host 已接受这些字段）：

```json
{"jsonrpc":"2.0","id":"request-17","method":"session/submit","params":{"workspaceId":"workspace-1","sessionId":"session-1","operationId":"operation-17","expectedRevision":"8","text":"检查构建失败"}}
```

核心/Host 方法登记完成前，协议 0.1 与新显式归属协议 0.2 不混用；版本不匹配明确拒绝，不猜字段。客户端选择会话不发送全局 session/select 修改其他客户端上下文；仅其视图改变。

所有写操作使用 operationId；服务端按 instanceId/principalId/workspaceId/sessionId/method/operationId 建幂等账，同键同规范化内容返回原回执，同键不同内容拒绝。任务接收回执与最终完成分离；超时返回结果未知及查询标识，不当作业务失败，不自动再次执行。副作用与幂等账不能仅靠内存锁；无法保证原子提交的外部效果只能标 unknown，通过状态核实，不许承诺 exactly-once。

方法覆盖包含会话、消息/队列、Agent/团队、目标/计划/待办、审批/问题、取消、文件/差异/Git、执行输出、模型/用量、扩展/连接/设置等现行 PRD 能力。每项映射现有 Host 方法或定义新的明确契约；不能发明名字并塞进 capabilities 假装实现。服务管理权限不默认给普通移动设备。

## 6. SSE、恢复与目标切换

持久事件使用实例、会话、generation、十进制 seq 游标；瞬时文本/运行提示明确标 ephemeral。SSE 帧携带事件类别、资源归属、游标或瞬时标记。持久事件授权后才发送。

新增拟定 session/events 方法，接受 sessionId、afterSeq、limit（1..200）；返回 durable 事件、generation、nextSeq、hasMore。首次订阅顺序：建立授权订阅并缓冲→读取持久高水位→补读至高水位→丢弃缓冲重复→消费后续事件。generation 不匹配或游标超出范围返回显式 gap，客户端重取快照并补读；不能无声漏掉补读与订阅之间的事件。

每连接保留 1024 帧上限，并增加 4 MiB 字节上限；超过任一限额关闭并给出可恢复原因。持久记录不会因为 SSE 丢失从日志消失。断网不自动取消 Agent；移动后台恢复重新认证、查询真实任务状态、补日志，流式 UI 无法恢复的瞬时片段用持久最终结果替代。

客户端状态键为 instanceId/workspaceId/sessionId；每次切换递增 connectionEpoch，响应和事件必须同时匹配目标及 epoch 才能更新当前页面。旧目标未完成操作仍记录在其独立状态，任务通知必须带目标标签。

## 7. 请求安全、审计与 Linux 沙箱

- /rpc 仅 POST，/sse 与 /health 仅 GET；业务请求 Content-Type 必须为 application/json。
- 保留请求体 1 MiB 上限；认证体 16 KiB；拒绝 JSON-RPC batch 与无 id 的业务通知；结构深度上限 32。
- 请求头/体接收超时 10 秒；业务回执默认 30 秒，不等于任务必须 30 秒结束；超时不释放执行中的取消标识。
- 每设备最多 8 个并发 RPC、2 条 SSE；实例最多 64 条 SSE；认证每来源每分钟 10 次、每登记票据最多 5 次失败尝试，超限拒绝。来源地址不信任任意 X-Forwarded-For。
- 外部 CORS 默认不开放；Host/Origin 检查、HTTPS 与凭据校验防止浏览器跨站及 DNS rebinding；非浏览器客户端没有 Origin 不能作为放行理由。
- 审计保存时间、主体、设备、实例、资源、方法、operationId、结果类别与审批引用；不保存 token、登记秘密、任意请求正文或模型密钥。读面同样受权限限制。

Linux 的 OS 沙箱由核心可替换平台提供者实现，不依赖额外运维服务。seccomp 仅限制 syscall，不能单独证明路径/网络隔离；需组合 mount/user/pid/network namespace、只读根、允许工作区挂载、资源限制及进程树管理。内核或部署禁用所需能力时返回 SANDBOX_UNAVAILABLE，不裸跑。允许外网工具必须按服务端授权的网络策略执行，不通过默认开放网络冒充隔离。

Windows Job Object 只能证明进程/资源管理，不能单独证明文件与网络隔离。两平台各自报告实际 enforcement 与限制；字符串模式、测试 fake provider、管理员批准都不替代真实 OS 执行隔离。

## 8. 完整客户端能力

桌面：连接入口区分“本机工作区”与“远程目标”；持久显示目标/工作区/会话。启用本机接入时本地视图与手机接同一 daemon，不启动第二个写入者。

Kuikly：目标管理、会话列表/创建/选择、消息与队列、目标/计划/待办、审批与问题、任务/团队状态、取消、文件和差异审查、Git 操作、执行输出、模型/用量及设置管理均纳入需求追踪。高风险操作保留服务端授权及明确确认。展示限制不等于删功能。

NetworkModule 优先承担带 Authorization 的 JSON-RPC；实施前验证真实 JSON 请求字节、HTTP 错误与 JSON-RPC error 分离。SSE、取消、TLS 指纹和安全存储通过平台原生 Module 补齐缺口，仍由同一 Kuikly 应用直接连接 daemon，无云中转。Android/iOS/鸿蒙分别取证，未构建的平台记 BLOCKED，不把共享 Kotlin 编译当真机通过。

本仓缺移动工程。计划首先定位用户已有 AgentLink 工程；若它在其他工作区，须获得准确路径后再修改，不新建重复应用。若确无工程，建立 `apps/mobile/`；不凭猜测路径修改外部文件。

## 9. 实施依赖与交付门禁

顺序：现状/协议资产定档 → Linux 平台基础与 Kuikly 传输验证并行 → OS 沙箱与同包交付 → 身份/TLS → 统一实例/授权/完整方法 → SSE/幂等 → 桌面与手机完整客户端 → 双平台多客户端验收。

| 门槛 | 必须满足 | 当前判定 |
| --- | --- | --- |
| Linux 构建 | 固定提交 core 单测、CLI/Host/daemon ELF 构建 | BLOCKED：Windows 依赖、stdx target、无 Linux 实跑 |
| 安全执行 | OS 文件/网络/进程/资源边界反向测试，能力不足拒绝 | BLOCKED：当前 confine 原样返回 argv |
| 同包交付 | 无 SDK、无仓库、无全局 Host 的 Linux/Windows 包能运行 CLI+daemon | BLOCKED：Linux 和 daemon 打包缺口 |
| 强认证 | TLS 信任、请求级验证、撤销/过期/重放/并发登记反证 | BLOCKED：现有路由未接入 |
| 单实例 | 桌面/手机/CLI及团队共享同一运行协调器，选择不串会话 | BLOCKED：当前有基础但未验证 |
| 移动协议 | JSON-RPC、SSE、取消、证书、安全存储各平台实测 | BLOCKED：本仓无移动工程，外部 AgentLink 未直读 |
| 产品验收 | 完整需求追踪、真实任务/审批/取消/恢复/切换与越权拒绝 | BLOCKED：本轮未运行 |

## 10. 验收要求

1. Linux 固定提交完整构建与单测，报告 TOTAL/PASSED/FAILED/SKIPPED/ERROR 及 rc；零 Summary、零测试、跳过关键用例不能 PASS。
2. SIGINT/SIGTERM 实际投递、取消、flush、重启回放；持久屏障失败不能推进 durable；双进程写锁与判活权限不明拒接管。
3. 沙箱工具尝试读凭据目录、写工作区外、访问未授权网络、创建无限子进程、超资源、在取消后残留进程；均被 OS 拒绝或回收。禁用后端后操作拒绝且不产生副作用。
4. 两设备登录、过期凭据拒绝、撤销设备已有 SSE 停止；改坏请求认证/授权检查后指定越权测试必须失败。
5. 同实例桌面与手机看同一 seq/任务；两会话并发选择提交不串；团队与普通请求同目录/身份/会话归属。
6. 审批过期、重复、跨会话、无权限应答全部拒绝；真实批准仅执行一次；取消走目标端且不影响另一目标。
7. RPC 超时、重复 operationId、服务重启与外部副作用 unknown 可查询；不能因重连重复执行。
8. SSE UTF-8/半帧、补读竞态、权限变化、溢出、generation gap、断网和移动休眠恢复，持久事件无丢失。
9. 手机切换服务器与电脑，同名 sessionId 不碰撞；迟到回复不覆盖当前页面；目标标识持续可见，断开/关闭接入不停止旧任务。
10. Linux/Windows 干净发布包检查共享库与来源，实际安装启动；无需独立 PC 桥部署。桌面和移动必须运行界面验收，不能仅靠 mock 全绿。

## 11. 非目标

不建设必需云账号/中转、不做会话迁移、不建设任意方法透传、不兼容旧 REST 门面、不把 OS 沙箱表述为防御全部 daemon 漏洞。本轮仅规划，不声称当前源码已满足以上契约。
