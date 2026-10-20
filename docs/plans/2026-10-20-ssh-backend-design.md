# F15 SSH 后端接入设计（2026-10-20）

> 状态：纯设计，未实施、未构建、未发起SSH/指纹扫描/认证或远端命令。本任务只读仓库源码与官方协议文档，仅新增本文件；不修改core、Host、前端、共享配置/索引/台账，不涉及其他执行方实现，不提交推送。
>
> 目标：盘点现有SSH切片，设计 `ssh/connect|exec|disconnect|describe` 的有限协议及首次信任、指纹变化、独立动作审批。与F08一致：**提案不执行，独立批准后才准入；Git/远端实体状态仍是各自真源，不把日志登记当实际完成。**

## 1. 当前能力盘点

### 1.1 `core/src/ssh.cj`：目标登记，不是网络连接

| 符号 | 实际参数/返回 | 行为 |
|---|---|---|
| `SshRegistry(log: SessionLog)` | 构造器 | 回放 `ssh/target` 的connect/disconnect日志，重建字符串host状态 |
| `connect(host: String): Unit` | 单个host字符串，无用户/端口/凭据/指纹 | 空host拒绝；幂等登记 `connect::<host>`，内存状态置connected；**不建立TCP/SSH连接、不认证、不核指纹** |
| `disconnect(host: String): Unit` | host | 未知/已断开直接返回；追加 `disconnect::<host>`，状态翻转；**不关闭进程或SSH通道** |
| `status(host: String): String` | connected/disconnected；未知抛 `ssh-unknown-host` | 返回日志投影，重启回放仍可能显示connected；**不能据此认定存在活连接** |

当前identity仅host，同主机不同端口/用户/项目无法精确区分。事件使用 `::` 分隔，对IPv6及其他复杂字段不能按原注释假设直接扩展。`append`不是持久屏障，方法本身不flush。

### 1.2 `core/src/ssh_exec.cj`：非交互单次命令切片

公开签名（当前源码事实）：

```text
sshArgv(host: String, user: String, command: String,
        options: Array<String>, port: Int64,
        connectTimeoutSec: Int64): Array<String>

SshExecutor(registry: SshRegistry, log: SessionLog,
            binary!: String = "ssh", maxOutputBytes!: Int64 = 1048576)

run(host: String, command: String, user!: String = "",
    options!: Array<String> = [], port!: Int64 = -1,
    token!: TurnToken = TurnToken(), timeoutMs!: Int64 = 30000,
    connectTimeoutSec!: Int64 = 10): SshExecResult
```

`!:` 是当前仓颉命名形参声明；不代表拟议RPC字段。

返回 `SshExecResult`：

| 字段 | 类型/当前语义 |
|---|---|
| ok | Bool；当前exitCode==0时true |
| exitCode | Int64，失败占位-1等；不是独立的远端退出证据 |
| stdout/stderr | String，实际读取的文本 |
| timedOut/cancelled | Bool，当前本地执行路径判断 |
| failureKind | `"" / not-registered / bad-args / spawn-failed / transport` |
| message | 原因字符串，如ssh-empty-arg、ssh-timeout、ssh-exit-N |
| elapsedMs | 单调钟计算耗时 |

已有执行过程：检查token及非空参数→`registry.status(host)==connected`→组argv→spawn ssh→读输出/等待→必要时终止本地进程→append `ssh/exec::<host>::<code>`。未注册与已断开的host拒绝发起。

**当前不是长连接客户端**：每次run启动一个ssh进程，没有网络connect/disconnect方法、会话channel表、PTY、SFTP、连接定义管理、已认证实例或部署计划。用户/port/options只参与该次命令；registry“connected”仅是前置登记。

### 1.3 接入前必须明确的源码缺口（本轮只记录，不修）

1. `sshArgv:62–79` 固定 `BatchMode=yes`，却同时设 `StrictHostKeyChecking=no`、`UserKnownHostsFile=/dev/null`，**关闭可信主机校验与持久信任，违背PRD首次信任/变化拒绝要求**。`/dev/null`也不能当跨平台受管信任文件。
2. `options[]` 原样追加；缺少目标/用户名/端口的充分校验，也没有独立副作用批准。不能把它直接透传成公开RPC，避免ProxyCommand、LocalCommand、转发等扩权。
3. `run:137–152` 在主线程先阻塞 `readAllStream(stdout)`，之后才进入deadline/取消轮询。远端长时间不关闭stdout会阻挡预算检查；注释里的“200ms内看见取消”不能据此成立。
4. `maxOutputBytes`虽保存，但当前读取调用未使用；`shlex.cj:79–94` 的 `readAllStream` 逐行无界拼字符串。没有输出截断/EOF完整性字段，不能称输出已受限。
5. 本地ssh被终止，不证明远端子进程终止；之后无界wait/输出线程收束也需要受监督处理。不能把注释“不留孤儿ssh”推广成真实远端进程树停止保证。
6. 非零exit统一归transport，混淆远端业务失败与本地/网络错误；255尤其不能单靠数值无歧义判别。没有远端runId/回执、事实核对或unknown状态。
7. `ssh/exec`只append host+退出码，既不flush也不绑定具体命令、工单、连接实例或远端路径；不足以作持久动作账本。
8. 执行器注释认为“SSH不在本地sandbox模型内，仅目标注册表门控”。这只是历史切片说明，**不是本产品安全决定**：本地ssh进程/密钥/网络与远端动作权限必须分别约束，不能因远端目标已登记就裸跑任意命令。

### 1.4 Host盘点与测试边界

本轮在 `apps/host/**/*.cj` 中检索ssh/Ssh/SSH没有命中，`docs/plans/host-capabilities.json`没有 `ssh/*`；现有 `execution/*` 只是通用执行面，不是SSH目标/指纹/凭据管理。与PRD跟进台账F15“未接通”、D08一致。

`ssh_test.cj` 验证登记/软断开/回放；`ssh_exec_test.cj` 包含argv、未登记拒绝、预取消、缺binary、真实拒绝端口和历史本机sshd认证失败等源码，且旧argv测试期待 `StrictHostKeyChecking=no`。**测试源码存在、注释有历史结果都不证明当前安全SSH连接已通过**；本轮未运行任何测试，不重跑其硬编码本机用户/端口夹具。后续安全改造须同步替换旧不安全断言，使用自有隔离测试主机。

## 2. 架构决策（Proposed，未实施）

### ADR-SSH-01：独立受审动作服务，复用授权机制，不复用文件写回动作

结构：`UI/CLI → Host有限分派 → core SshActionService → 信任/凭据/范围核验 → 受控SshTransportAdapter → OpenSSH/SSH传输 → 真实结果核对`。

与F08相同：

- prepare只产生不可变提案，不建立网络连接或执行命令；审批绑定actionId、proposalDigest及目标快照。
- 用户批准通过已有 `approval/ask/answer` 与 `ApprovalDesk` 精确一次消费；持久准入失败则不发起动作。
- 使用动作域 `ssh/connect`、`ssh/trust-host-key`、`ssh/exec` 等分别绑定票据，Git、计划、文件写回票不可移用。
- `execution/review-apply` 是文件差异写回，不负责远端命令、主机信任或部署；SSH不直接走它。复用其准入/取消/结算原则，不伪造Git或SSH元数据为文件patch。

代价：需新增连接与动作状态模型，不只是Host薄转发。直接把 `SshExecutor.run(host,command,options)` 接到RPC虽然最短，但缺信任与动作身份/持久安全，否决。

### ADR-SSH-02：先以OpenSSH为传输候选，不直接宣布当前驱动可复用上线

现有进程调用和TurnToken可作实现参考；安全argv、并行输出、有界等待、认证/信任与远端状态需补齐后才能接入。core依赖传输adapter接口而不是固定shell程序，保持CLI/Host共享。

OpenSSH CLI可承担执行阶段；“connect”定义为当前adapter持有的**真实、已验主机身份且认证成功的连接实例**，不是Registry布尔。需要无业务命令的认证握手/ready/close接口：支持的OpenSSH控制通道或SSH库adapter在平台探针后选定。**不能单凭spawn `ssh -N`、进程存活、日志一行或TCP connect就报认证成功**。若某平台adapter不能证明ready，connect明确报unsupported/blocked，不偷偷退成登记。

纯OpenSSH单次执行可作为独立能力标注，但不冒充持久连接/PTY。当前Windows/Linux/macOS是否支持所选连接生命周期方式必须分平台冻结；本轮不引libssh2或原生FFI，不决定未经验证的依赖安装。

### ADR-SSH-03：主机信任独立于任务授权、认证凭据

持久信任记录绑定规范化host、端口、服务端公钥类型+公钥/指纹与trustRevision；连接实例额外绑定user、credentialRef、project/task、definitionRevision。指纹是公钥摘要不是秘密，允许展示；密码/私钥/口令不进入提案和审计。

首次信任允许显式TOFU，但必须标明“尚未经独立渠道验证”；扫描得到key不等于可信。支持用户从管理员等独立渠道核对，不默认信任DNS或同名连接配置。再次握手必须证明持有该已批准key；变化一律停止，旧连接票/执行票失效，不能自动删known_hosts/静默更新。

## 3. 四个拟议Host RPC

当前不增加任何接口，以下字段为设计提案。所有写方法精确验证字段，额外 `command/options/binary/configPath/knownHostsPath/privateKeyPath` 等未知字段拒绝；IPC未来由其owner串行接入，本任务不改。

### 3.1 共有身份、提案与生命周期

`sessionId` 必须是当前会话；`workspaceRevision/projectId/taskId`与服务端目标定义一致。`connectionId`是受管实例ID，不是user@host字符串；服务端根据保存定义解析目标，不信任调用者临时换host/user/port。

prepare返回：`{actionId,revision,proposalDigest,approvalBody,phase:"awaiting-approval",target,warnings}`。

apply请求只携 `{sessionId,phase:"apply",actionId,revision,approvalId}`；不重传或替换原动作字段。开始前重核定义修订、trustRevision/指纹、连接generation、credentialRef修订、权限及到期；准入持久化后返回running。重复apply返回原结果或明确拒绝，不二次派发。

动作状态：prepared/awaiting-approval/admitted/running/settling/settled；outcome单列succeeded/failed/denied/cancelled-before-start/unknown。`cancelRequested`、`localProcessSettled`、`remoteExitObserved`、`remoteOutcome`分别表示，不混成一个ok。

### 3.2 `ssh/connect`

| phase | 参数 | 返回/行为 | 审批 |
|---|---|---|---|
| prepare | sessionId,connectionDefinitionId,definitionRevision,requestId | 解析目标和认证引用，生成connect提案；**不联网** | 提案无执行 |
| apply | 共有apply字段 | 在获准目标范围内进行密钥/握手探测；已信任时严格验证并认证；未知key转awaiting-trust，不发送业务命令 | 独立connect票允许该目标连接/探测，**不等于信任key或执行命令** |
| trust | sessionId,actionId,revision,observationId,approvalId | 消费另一个绑定已观测key的信任票；持久保存受管信任记录，再以严格pin握手认证；成功才创建connected实例 | 独立 `ssh/trust-host-key` 票；本阶段不可凭connect票自动信任 |
| cancel | sessionId,actionId,expectedRevision | 取消此握手/认证请求，关闭自有资源；保留可能已保存的信任事实 | 停止不需再次允许执行；仍须会话/实例归属校验 |

等待信任示例（示例值，无真实端点）：

```json
{"jsonrpc":"2.0","id":12,"result":{"actionId":"ssh-act-1","revision":2,"phase":"awaiting-trust","observationId":"key-obs-1","target":{"host":"deploy.example.invalid","port":22,"user":"deploy"},"hostKey":{"algorithm":"ssh-ed25519","fingerprint":"SHA256:<synthetic>"},"trustStatus":"unverified-first-use","connectionId":null}}
```

信任记录保存失败：不认证、不返回connected；拒绝不保存。指纹变化返回 `ssh-host-key-changed`，只给核对入口，不在同一重试中一键覆盖旧pin。显式更换信任需独立信任维护流程，超出这四条初始API的自动处理范围。

成功回执包含 `connectionId,generation,targetIdentity,verifiedFingerprint,trustRevision,authenticatedUser,state:"connected",transportCapabilities`；定义或日志回放中的connected标记不足以产生此回执。

### 3.3 `ssh/exec`

prepare参数：

```json
{"jsonrpc":"2.0","id":20,"method":"ssh/exec","params":{"sessionId":"current","phase":"prepare","connectionId":"ssh-conn-1","connectionGeneration":1,"workspaceRevision":3,"taskId":"task-7","requestId":"req-1","operation":{"kind":"environment.inspect","templateId":"inspect-runtime-v1","arguments":{"runtime":"node"},"remoteRootId":"root-1"},"timeoutMs":30000,"outputLimitBytes":65536}}
```

- `operation.kind/templateId/arguments`为core拥有的有限类型与字段，不是前端任意command字符串。core构造完整执行内容并把内容摘要、目标、远端目录、权限、部署影响交用户审阅。
- `remoteRootId`解析到获准远端根，不接受本地路径冒充远端路径。远端目录/实际版本核验不能由字符串前缀替代；无法证明范围时阻断相应文件操作。
- apply按共有字段消费 `ssh/exec`精确票；部署/安装/服务变更用更具体动作域/影响分类（如 `ssh/deploy`），必须独立批准，不能拿环境检查票继续部署。
- cancel参数为 `{sessionId,phase:"cancel",actionId,expectedRevision}`；只停止该动作的后续准入和本地可控通道；远端是否停止单独回报。为遵守本任务四方法约束，暂由phase区分，后续若拆具名ssh/cancel需接口审定。

describe结果示例：

```json
{"actionId":"ssh-act-2","phase":"settled","outcome":"unknown","cancelRequested":true,"localProcessSettled":true,"localExitCode":255,"remoteExitObserved":false,"remoteExitCode":null,"remoteOutcome":"unknown","stdout":{"text":"<bounded output>","truncated":false,"eofObserved":true},"stderr":{"text":"<redacted diagnostic>","truncated":false,"eofObserved":true},"reason":"ssh-transport-lost"}
```

远端正常非零退出是业务failed，带已观察的真实退出码，不一概叫transport。OpenSSH的255含连接/本地错误，且远端也可能退出255；无结构化证据时不保证仅凭退出码能精细分诊。远端退出0仅证明该命令退出成功；部署还须获准的实际健康/文件核验，不能直接标部署成功。

### 3.4 `ssh/disconnect`

- prepare：`sessionId,connectionId,generation,requestId`，返回受影响action/channel列表与提案。
- apply：共有apply字段。先置closing阻止新准入，取消/收束本实例自有进程和通道，保存真实状态；不删除远端内容、信任记录或其他实例连接。
- 用户明确断开是停止控制，不要求重新等待一张“允许继续执行”的票。可由同一可信UI确认产生精确disconnect控制票，或由有归属的直接停止请求进入共享停止通路；审批缺失不能导致无法停止。自动安全退出可直接走内部stop接缝。
- 返回 `state:"disconnected"` 仅表示本地受管连接关闭；有在途远端任务则另列 `remoteOutcome:"unknown"`。超时无法收束本地资源返disconnect-incomplete，不谎报全清理。

### 3.5 `ssh/describe`

只读请求：`{sessionId,connectionId? ,actionId? ,outputCursor?,limit?}`，两种ID至少给一个，若同时给需属于同一实例。缺少ID不默认列出所有其他会话目标。

返回：脱敏目标定义、connectionState/generation、主机信任状态、实际authenticated/lastVerified时间、能力、动作提案/审批摘要、local/remote结算、输出分页及nextCursor。默认每页≤64KiB且有总保留限额；Secret不进输出；输出不完整要有标记。describe不connect、不重连、不执行远端status命令。

运行恢复核对若需联网或remote命令，另生成受审 `ssh/exec` 查询提案；只读describe不能隐藏网络副作用。重启旧connected只显示`recovered-disconnected`，未结算动作unknown，旧审批不恢复。

### 3.6 错误面与持久语义

建议 -32602用于参数/字段不合法；领域原因闭集（数值码由接口负责人统一分配，不复用历史任意编号）：

`ssh-definition-stale / ssh-session-changed / ssh-target-not-authorized / ssh-host-key-untrusted / ssh-host-key-changed / ssh-auth-failed / ssh-auth-method-unavailable / ssh-credential-unavailable / ssh-connection-stale / ssh-operation-not-supported / not-authorized / persistence-failed / ssh-provider-unavailable / ssh-timeout / ssh-outcome-unknown`。

协议成功只表示请求已被接收，outcome必须再核。副作用前持久失败阻断；副作用后落盘失败保留unknown，不宣称已回滚。多次相同requestId且提案摘要一致返回原action；同requestId不同内容冲突。开始状态需租约和flush屏障，不能只用当前SshRegistry.append。

## 4. 安全边界

### 4.1 首次信任、变化检测与受管known_hosts

1. 用户先审阅连接目标，再授权探测；指纹探测只采集候选公钥，不能从 `ssh-keyscan` 输出直接生成trusted记录。
2. 显示host、port、算法、SHA256指纹、旧/新差异和是否独立验证。拒绝不保存，首次确认与以后更换是不同动作。
3. 使用SaCode受管且有内容版本保护的known_hosts，不修改用户全局 `~/.ssh/known_hosts`，不把known_hosts当秘密凭据。产品位置由数据根服务解析，不能硬编码用户或开放RPC任意文件路径。
4. 真握手启用严格主机校验（OpenSSH候选 `StrictHostKeyChecking=yes` +受管UserKnownHostsFile）；不设no，不把accept-new当自动首次确认，不自动UpdateHostKeys或降级算法绕过变化。全局known_hosts/CA是否参与需要明确策略，不能在用户只批准单pin时偷偷扩为信任全部系统key。
5. 探测与认证之间再次验证已批准key；更换key、端口/目标定义、trustRevision或连接generation后，既有动作提案失效。DNS/IP变化需要重新核范围，不能因显示名未变继承更宽网络授权。

### 4.2 不开放任意shell；本地argv安全不等于远端argv安全

- 不提供 `ssh/exec {command:"...",options:[...]}`、任意shell/解释器、`sh -c`/`powershell -Command`自由文本包装。也不把“以git开头”等简单字符串判断当部署授权策略。
- operation模板由core登记、版本化并绑定摘要；shell路径、env名和值、远端参数按明确的目标平台语义编码，未知远端平台/引用规则不运行。
- OpenSSH命令通道发送命令文本并可能经远端用户shell解释；**本地launch传argv不意味着远端无shell注入**。模板adapter需经过特殊字符/引号/换行参数验证，必要时用固定受控子系统/dispatcher传结构化payload；安装该dispatcher本身仍需独立授权，不自动部署。
- 模板只是准入能力，不是强制远端文件沙箱。没有远端受限账号/forced command/subsystem等实际约束，不能声称能限制远端脚本、symlink或子进程；无法满足范围的动作明确blocked。
- PRD要求的手动PTY交互终端以后走独立终端会话授权，披露自由输入无法逐命令拦截的边界；本次四RPC不偷偷提供交互shell，不删除PTY最终需求。

### 4.3 本地配置、认证与部署

- OpenSSH底层选项由adapter白名单构造；不继承任意用户SSH配置中的ProxyCommand/LocalCommand/Match exec/Include等本地代码能力，不开放代理跳板/端口转发/agent转发/X11/共享他人ControlPath。所选客户端如何禁用未知配置需各平台探针确认，不猜空文件路径。
- 凭据仅credentialRef，私钥/密码/密钥口令不放argv、提案/日志/共享配置或导出。外部ssh-agent、本地helper使用另经授权并绑定身份，禁agent转发；不自动尝试所有本机私钥。
- 当前BatchMode无法处理口令/交互密钥口令，必须报告auth-method-unavailable；未来支持通过受控私密IPC/认证adapter，不用 `sshpass -p` 或把口令放环境凑通过。未实现认证方式保持待验，不声称密钥/口令已全支持。
- 连接票不授权远端写入，检查环境不授权安装/部署；每项部署提案列目标/制品摘要/远端路径/服务/预计副作用与健康检查，失败报告已做动作，不自动全机清理/回滚/重试。
- 非交互命令、文件传输、PTY、端口转发是不同能力：不能拿exec exit0冒充SFTP上传完成，或因SSH信任就自动信任数据库TLS/ACP目标。

### 4.4 取消、输出与恢复

- 从进程启动前计算总deadline；stdout/stderr并行持续采集，保留上限、背压/排空和完整性分列；等待不能先阻塞stdout再检查token。单流建议默认64KiB展示/分页缓存，总量和时限受策略硬上限。
- 只停止本实例拥有的本地ssh/子进程/连接控制通道，不kill所有ssh，不碰其他工具连接。
- 本地通道关闭/ssh退出不是远端停止；远端子进程可能继续运行，未取得真实终止回执→unknown。远端runId/取消协议/受管dispatcher若不支持，能力直接披露“无法确认远端停止”。
- 远端状态未知、传输丢失、进程崩溃后禁止自动重放部署命令；重连先核指纹、连接修订与原执行事实，用户显式决定后生成新提案。
- 不借“能恢复”建立持久后门或自动常驻服务；PRD外的跳板/转发/系统服务部署另获授权。

## 5. 实施依赖与交接（不自动授权实施）

### 5.1 可复用与必须新增

可复用：ApprovalDesk精确票、现有执行开始持久屏障/租约、TurnToken、受控进程生命周期/有界输出模式；不能直接照搬现有sshArgv或阻塞读run作为安全实现。

拟需新增：连接定义/实例服务、受管HostKeyTrustStore、有限操作模板与SshActionService、SshTransportAdapter、执行/停止/unknown回放投影。旧SshRegistry日志仅兼容历史展示，不自动转为活连接或可信记录。

依赖候选：Windows OpenSSH Client、Linux/macOS发行版OpenSSH；缺客户端提前检测，不自动安装。版本、连接ready证据、control通道、密钥/口令认证、known_hosts格式与密钥算法、输出退出语义均逐平台核。若CLI无法提供所需安全生命周期，再审定库/FFI路径，不在此文档暗设libssh2依赖。

### 5.2 按阶段拆分

1. 审定目标/信任/审批/生命周期契约。
2. 独立核心状态/模板/信任存储与纯测试；现有SSH驱动安全改造和受控adapter探针。
3. 自有sshd环境验证首次信任、变更拒绝、认证、无业务connect、命令输出/取消/unknown。
4. Host四方法与CLI有限入口由相应owner获窗口后接入；不抢公共main/approval/agent/IPC。
5. 对接UI、PTY、SFTP与部署需后续各能力任务及真实证据；四RPC不构成整个F15完成。

本任务不修改其他方core/Host/Git/执行/桌面文件，也不指示其实现方式或启动构建。

## 6. 验收矩阵与待确认项

以下均为待执行测试，不是本轮通过结果：

| 对应项 | 场景 | 必须结论 |
|---|---|---|
| SSH01 | 同host不同port/user的定义与多实例、注册回放 | 精确实例隔离，重启记录不假活连接，connect不发业务命令 |
| SSH02 | 首次未知key、拒绝、pin持久失败、探测后key换 | 等待独立信任，拒绝/失败不认证，变化停止 |
| SSH03 | 密钥/口令/加密私钥、缺helper、认证失败 | 支持能力逐项真实认证，无秘密进入argv/日志；未实现明示 |
| SSH04 | 模板参数含引号/空格/换行/选项形状、大输出/非零 | 命令结构不变、真实退出与截断完整性可核 |
| SSH09 | 环境检查票被用于安装/部署、错票/过期票 | 无独立部署票零副作用；健康检查失败不报部署成功 |
| SSH10 | 无stdout且不退出、断网、本地取消、重启 | deadline可见，本地停止与远端结果分列，unknown不重放 |
| SSH11 | 切项目/撤权/换定义/指纹变化后apply、迟到输出 | 拒陈旧票，输出归属原动作，不串新会话 |
| SSH12 | 重复request/apply、准入前后持久失败、断开自有连接 | 不重复派发，不杀无关进程，断连不报远端已停 |

PTY/SFTP的SSH05–SSH08不由这四RPC完成；最终范围仍按PRD保留独立实施和验收，不用命令切片代替。

待确认：

1. 实际连接adapter及三平台ready/close/认证能力；OpenSSH控制复用是否可行，缺平台不猜支持。
2. 首版operation模板清单、远端OS/shell语义、远端范围强制限制与deployment审批粒度。
3. 连接定义/信任/credentialRef的权威存储与数据根、既有记录迁移；不读取真实用户密钥/known_hosts推测。
4. 首次TOFU交互与显式key更换流程、组织CA/known_hosts额外信任是否纳入；默认单pin不自动扩张。
5. 远端执行ID/终止回执的来源；无可靠协议保持unknown，不承诺本地kill等于远端取消。
6. `ssh/disconnect`可信停止通路与其受影响动作确认交互，确保审批机制不能阻塞安全停止。
7. Host四方法字段/错误码与后续PTY/SFTP方法扩充由统一接口owner审定，本轮未增加任何接口。

## 7. 取证与参考

- `core/src/ssh.cj:19–69`：登记/回放接口；`core/src/ssh_exec.cj:26–104,114–204`：结果/argv/run；`core/src/shlex.cj:79–94`：无界阻塞输出读取。行号为只读取证时点。
- `ssh_exec_test.cj:47–63,141–207`：旧不安全argv断言与本机历史夹具；本轮未运行。`ssh_test.cj`：登记/回放测试，不能作网络证据。
- `apps/host/**/*.cj`与`docs/plans/host-capabilities.json`未发现SSH分派；PRD跟进台账F15与D08：未接通。
- PRD `§4.3.1:295–313`、SSH01–SSH12 `543–562`；F08临时设计 `target/tmp/f08-git-backend-design-20261020/DESIGN.md`：独立动作提案、精确票、持久准入、恢复不重放；`docs/interfaces/execution-review-apply-2026-10-17.md`：文件写回边界。
- OpenSSH官方源码/手册经Context7 `/openssh/openssh-portable`核对：[ssh](https://man.openbsd.org/ssh.1)、[ssh_config](https://man.openbsd.org/ssh_config.5)、[ssh-keyscan](https://man.openbsd.org/ssh-keyscan.1)。严格校验+BatchMode会拒未知key；keyscan是公钥采集而非信任证明；exec为命令通道、未提供命令时可能请求shell；-N是不执行远端命令但不自带产品可依赖的认证ready回执。
