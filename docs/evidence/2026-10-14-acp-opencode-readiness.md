# ACP：OpenCode 装配与就绪检查

## 历史诊断与“保留现状”真实接线

基线 `e9e6298` 加本批明确路径。新增共享核心 AcpDiagnosticJournal，将诊断白名单报告、会话、诊断编号、工作区/ACP 设置事件修订和 pending/kept 决定写入原 SessionLog。Host 增加 describe/keep 两个有限 RPC，CLI 增加 diagnostics/keep，IPC 与页面接同一核心。历史诊断单独回看，不能恢复 providerReady 或执行许可。重复同一决定不重复落库；旧编号、跨会话、陈旧修订或失效作用域拒绝。

真实 Host 首轮 11 条中 7 pass / 1 fail / 3 skip：切工作区释放租约后，取消回调错误尝试保存，被通用错误覆盖。修复为取消/作用域变化后不争写权、不落库，原回执以 diagnosticSaved=false 明示；正常持久失败仍报错，不假报已保存。修复后真实 Host/CLI/OpenCode 13/13，rc=0；最新取消/恢复专项 5/5，rc=0。真实 OpenCode 仍为 Low 环境日志拒绝，不是模型任务成功。

最终核心专项 `acp-journal-verified.log`：TOTAL399/PASSED102/SKIPPED297/ERROR0/FAILED0，rc=0，仅102条运行。定向测试含真实日志恢复、重复决定、无写者、跨会话、旧诊断、设置变化和取消不写。一次测试调度发生私有 target 重叠，已核父子 PID，仅停止自己的重复轮；重叠读数不作最终验收，最后串行复跑使用上述 verified 原件。Host/CLI 1.1.3 release 构建成功。页面/IPC 17/17，有限 preload 契约专项6/6。真实 Electron 主窗口完成保留决定并由真实 IPC 回读确认，`--no-sandbox` 仅用于该测试，不代表默认沙箱或安装态验收。

原件位于 `apps/desktop/.tmp-test/page-tree-a6e22601/`：acp-journal-host-v2.log、acp-journal-cli-v2.log、acp-journal-real-entry-v2.log、acp-journal-race-final.log、acp-journal-ui-final.log、acp-journal-frontend.log；截图 acp-journal-electron-60b09b75-84b6-4fed-9c53-a769c77bb838/acp-readiness.png。核心 verified 日志在邻级 approval-binding-candidate。

边界：诊断事件修订不是配置文件修订；尚不能批准配置修复。有效配置/插件模型解析、文件修订 CAS、后台任务修复、复验通知及真实模型任务仍未完成。用户已选择普通用户环境复验“稍后验证”，本批不重复催验、不以此阻塞其余工作。

## 最新修正：验收目录的完整性标签（2026-10-14）

当前 HEAD `1148e2c` 加本批完整性观测代码。原生启动失败的环境原因已定位：`.tmp-test` 及其中生成的 exe 继承 Low Mandatory Label；独立仓颉 SDK 最小程序（不导入 std.process/std.fs）读取自身 RID=4096，父子探针均为 4096。OpenCode 日志文件没有显式完整性标签，按 Windows 规则为 Medium。普通 Node 可执行文件启动的同一 OpenCode 完成 initialize/session-new，原生 Low 上下文则返回日志 EPERM。不能再归因于仓颉启动 API 主动降权，也不能解释为缺少认证。

新增只读令牌观测 `processIntegrity`，进入核心 → Host/CLI → 页面；未知值保留未知，不改 ACL/标签、不提权、不绕行替代执行器。依据：[Windows Mandatory Integrity Control](https://learn.microsoft.com/en-us/windows/win32/secauthz/mandatory-integrity-control)。本次没有发送模型 prompt，没有修改 OpenCode 配置或认证数据库。

验证：仓颉 1.1.3 Host/CLI release 构建成功；私有 ACP 核心集 TOTAL 396 / PASSED 99 / SKIPPED 297 / ERROR 0 / FAILED 0，rc=0（非全核心回归）；原生入口与验收客户端 14/14；最终诊断与页面单测 14/14。私有候选的 210 份生产仓颉源码与 HEAD 加本批修改一致。日志在 `apps/desktop/.tmp-test/page-tree-a6e22601/acp-integrity-*-final.log` 与 `approval-binding-candidate/acp-integrity-core-final.log`。

普通用户目录的实际协议复验尚待执行，提供只发初始化和建会话的固定候选验收客户端；不能因当前受控夹具通过就宣称实际 OpenCode 模型可调用。插件有效配置、后台修复、CAS/审批/取消/结算与通知仍未收口。

## 口径纠正：不再用认证列表做准入（2026-10-14）

以下历史读数保留为当时实现的记录，不代表当前准入契约。此前要求 `auth list` 非空是实现错误，已移除；不要求在 SaCode 配置 OpenCode 密钥，也不要求为无认证端点登录。当前直接执行 ACP initialize / session-new，沿用提供方默认配置，不发送 prompt、不选择模型、不自动登录。

- 对外状态字段由 `localCredentialPrecondition` 改为 `protocolReady`；后者只描述协议，不代表远端模型可用。
- ACP 关闭时 Host、CLI、页面均拒绝探测；开关失败不会自动改回关闭。在途任务不因关闭开关被杀，页面提供等待及明确取消操作。
- 只有实际 RPC 返回 ACP v1 `-32000` 才展示认证要求；超时、程序退出等保持未确认，不猜测为凭据问题。
- 配置来源、主模型、免费属性、插件覆盖和端点可达性还未完成诊断；后台修复及通知链尚未交付，不能将本批修正称为全部需求完成。
- 依据：[OpenCode ACP](https://opencode.ai/docs/acp/)、[ACP v1 认证](https://agentclientprotocol.com/protocol/v1/authentication)、[ACP v1 错误码 schema](https://github.com/agentclientprotocol/agent-client-protocol/blob/main/schema/v1/schema.json)。


基线：`31577ef` 加本批明确路径。Windows，仓颉 1.1.3 / stdx 1.1.3.1；未使用真实模型任务验证。

| 链路 | 当前事实 | 尚缺 |
| --- | --- | --- |
| 核心 | 内置 OpenCode 适配器执行有界 `auth list --format json --standalone`，再做 ACP initialize / session-new 探针；不发送 prompt | 真实账户与任务验收 |
| Host | 创建时由可信路径装配、经注册表和门控构造运行时；页面不能指定命令、环境或认证结论 | 当前实例的认证子命令权限拒绝需解锁；隔离与真实委派验收仍待完成 |
| 配置 | ACP 默认关闭；显式开启、修订校验、持久屏障和恢复；范围明确为当前项目会话 | 用户级设置继承尚未接入产品入口 |
| 桌面 | 开关、探针、提交、审批、取消、关闭与历史；恢复不启动；迟到响应不串会话 | 真实任务的审批、取消与完成展示验收 |
| CLI | 历史 list / describe、settings、enable/disable 修订更新、probe；与 Host 复用配置及就绪判据 | 实时任务操作与人工审批循环 |
| 产物 | 私有目录的新版 Host 与 Electron 开发载荷验证 | 统一 CLI、安装包与默认沙箱态验收 |

本地凭据列表非空只代表配置前提，不证明远端凭据有效。协议探针通过也不证明模型任务可完成。页面始终标明真实模型任务未验证；首次装配时复查提供方，后续创建仍受开关及注册代际门控。

## 结构化协议观测与原生启动差异（基线 1a92aa0）

新增白名单观测：每次探测随机诊断编号、请求工作目录、可信启动程序、initialize 返回的 Agent 名称/版本，以及 session/new 的模型选择值和当前模式。缺失或畸形可选字段保持未知，不阻断已验证的基础协议。只解释 ACP v1 `configOptions` 的单一 model/select 项，不猜测保留 `_meta` 的语义，不读取 authMethods 或认证数据库，也不将模式名当主 Agent。价格、插件动态覆盖、配置来源、系统身份及网络可达性仍明确未确认。

模型名称含 free 不会自动成为免费证明。结构化内容不作写授权；诊断编号目前仅标识本次观测，尚未持久绑定修复任务或文件修订。页面同时明确真实委派可能发送数据与产生费用，未知配置项不成为全局阻断。

- 仓颉 1.1.3：私有核心包 TOTAL 394 / PASSED 97 / SKIPPED 297 / ERROR 0 / FAILED 0（ACP 专项），rc=0；不代表全量核心。新增白名单、畸形/歧义字段、未知价格与封闭错误分类验证。
- Host、CLI release 构建 rc=0；真实入口 12/12。受控协议进程实际返回版本与模型，Host 观测 JSON 读回；CLI 与 Host 诊断编号各自唯一、其余同作用域观测一致。核心与前端均不保留任意原始配置。
- 页面与 IPC 17/17。未知价格/插件覆盖不拦已接通协议的显式委派；非法诊断不渲染原始敏感字段。
- Electron rc=0，`ACP_HISTORY_MAIN_SMOKE PASS`。通过真实 main/preload/Host 验证结构化字段及诊断编号，并复核截图的长路径换行。仍带 `--no-sandbox`，不是安装态验收。

### 原生问题的实测定位

同一可信 OpenCode 程序经 Node 直接启动，在仓库工作目录完成 initialize 与 session/new，没有发送 prompt，stderr 为零。最小 SDK-only 仓颉进程则收到日志文件 EPERM。参数数组、已比对的公开用户/配置根路径一致，用户 SID 相同；whoami 分组观测显示 Node 直接子进程为中完整性 `S-1-16-8192`，仓颉启动子进程为低完整性 `S-1-16-4096`。

这证明不能将该失败归为“必须登录”。尚未确定完整性级别差异来自父进程上下文、运行时、启动实现或本机策略；没有证明 SDK 主动降权。后续须先测父进程令牌与受支持的进程契约，再决定修复；本轮没有改 ACL、提升完整性级别、替换模型、复制凭据或发模型任务。原生产品链仍报告连接未确认，不能拿 Node 的协议成功替代 SaCode 原生验收。

原始证据均在忽略目录：`approval-binding-candidate/acp-observation-core-final.log`；`page-tree-a6e22601/acp-observation-{host,cli}-final.log`、`acp-observation-real-entry-final.log`、`opencode-direct-protocol-diagnostic.json`、`acp-observation-electron-fcc3d098-b62a-4228-9a85-6296a67b7162/`；SDK-only 探针 `sdk-opencode-ce989b0b-13db-4ef0-a3c3-ae165ed691dd/{sdk-transport-diagnostic.log,argv-trace-result.json}`。

## 异步协议诊断与退出收束（基线 e85e624）

当前 Host 将只读协议探测放入单飞 worker；主循环继续接收其他 RPC。取消只传 TurnToken，ReplyTable 的等待检查令牌，进程启动和回收仍由原探测线程独占。关闭开关、工作区切换和 Host EOF 都取消诊断。EOF 等待 worker 与实际进程收束；无法确认时不开放第二次诊断，`host/settled.executionSettled` 不报 true。桥接退出窗口覆盖收束时间，并清理已完成的超时定时器。

- **红先复现**：e85e624 Host 的挂起协议夹具使后续 `initialize` 超时，专项 0/1、rc=1；日志 `page-tree-a6e22601/acp-probe-red.log`。
- **核心**：私有测试包 TOTAL 391 / PASSED 94 / SKIPPED 297 / ERROR 0 / FAILED 0（ACP 筛选）；ReplyTable 筛选 PASSED 4 / SKIPPED 387 / ERROR 0 / FAILED 0。包括取消前零启动、挂起握手取消及取消不串其他回包；不是全量 core 通过。
- **真实入口**：Windows release Host / CLI 构建 rc=0；实际请求 12/12、rc=0。四条受控真实子进程测试覆盖非阻塞、重复探测拒绝、关闭取消、EOF、工作区切换以及重新开启后再次探测。明确观察夹具 PID 不再存活；本轮没有证明外部 Agent 任意孙进程树的收束，不能扩大为全部进程树验收。
- **页面及桥**：21/21、rc=0。增加主进程生命周期定时器回收验证，保留迟到/旧连接隔离断言。
- **Electron**：`ACP_HISTORY_MAIN_SMOKE PASS`，rc=0。探测同时通过真实 preload 查询 goal 与 team；本轮日志无这两类超时。仍使用 `--no-sandbox` 测试参数，不代表默认安全启动或安装包验收。
- **实际 OpenCode**：`protocol-initialize-unconfirmed:no-task`，配置、模型调用仍未实测通过。没有自动登录、替换模型或发送 prompt。页面明确真实委派的数据发送及价格未知边界。

日志：`approval-binding-candidate/acp-async-core-test.log`、`acp-async-reply-test.log`；`page-tree-a6e22601/acp-async-host-final-build.log`、`acp-async-cli-build.log`、`acp-async-real-entry-final.log`、`acp-async-electron-e628c06d-35d2-414f-b4ef-a5e3407edb29/`。均在忽略目录 `apps/desktop/.tmp-test/`。

此批是只读诊断生命周期修复，不是后台配置修复任务。有效版本/模型/插件、诊断编号及修复绑定、审批/CAS、后台通知仍按开发计划继续。

## 准入纠正专项实测

- 仓颉 1.1.3：私有核心测试集 TOTAL 385 / PASSED 12 / SKIPPED 373 / ERROR 0 / FAILED 0，rc=0（提供方筛选，不是全量核心）。覆盖真实子进程协议、空认证前提默认配置、实际认证错误及畸形握手。
- 新版 Host / CLI release 生产构建 rc=0；去 SDK 搜索路径后真实入口 8/8，rc=0。关闭状态拒绝探测，实际 OpenCode 探测不生成模型任务。
- 页面与 IPC 14/14，rc=0：关闭零调用、探测失败保留开关、实际认证错误、在途任务关闭后等待/明确取消、有限超时窗口。
- Electron ACP 窄范围冒烟 rc=0，`ACP_HISTORY_MAIN_SMOKE PASS`，包含真实 main/preload/Host、开启/关闭/重新开启、自动发现及协议探测。测试参数包含 `--no-sandbox`，不代表安装或默认安全启动验收。
- **实际 OpenCode 尚未连通**：新版 CLI/Host 返回 `protocol-probe-unconfirmed`，不是认证失败，也未验证模型。未更换其配置或模型。
- **新发现的产品缺口**：Host 当前同步执行探针，约 12 秒期间其他 goal/team 查询可超时，Electron 日志记录了该现象。请求窗口修复避免 ACP 提前报超时，但并未解决诊断占用 Host 主循环；异步监督及退出收束须继续实现，不能宣称后台诊断完成。

日志：`apps/desktop/.tmp-test/approval-binding-candidate/opencode-default-config-final.log`；`page-tree-a6e22601/acp-no-auth-host-build.log`、`acp-no-auth-cli-final.log`、`acp-default-real-entry-v3.log`、`acp-default-electron-a23b2993-a4b4-4c05-a02c-388ab1b51084/`。本批首次误取旧 debug 二进制的入口失败轮不作新版读数；最终使用本次 release 文件重跑。

## 本轮实测

- 核心最终专项：TOTAL 381 / PASSED 8 / SKIPPED 373 / ERROR 0 / FAILED 0，退出码 0。运行时归属/关闭、配置恢复/CAS/缺租约和坏修订回放拒绝，以及本地凭据列表解析八项运行；不是全量核心通过。
- 页面与 IPC 九项、预加载专项一项通过；页面静态构建通过。
- 新版 Host 生产构建成功；真实 RPC 三项通过，覆盖默认关闭、未装配控制拒绝、跨会话拒绝、配置落盘、CAS、重启及实际 OpenCode 探针。
- **OpenCode 就绪未通过**：Host 子进程的认证命令退出码 1，安全分类为 `opencode-local-auth-exit-1-permission-denied-unconfirmed:no-task`。关闭日志输出未消除此错误；原因不能进一步断言为凭据或日志文件。未回显 stderr 和认证内容，未导出或复制凭据。
- 真实 Electron：持久历史只读、外会话拒绝、界面开关往返、配置读回、提供方状态展示通过，退出码 0；没有新增任务启动事实。使用测试参数 `--no-sandbox`，不代表默认安全启动或安装态通过。
- 修复 ACP 面板在会话目录尚未确认时使用临时会话 ID 发请求，以及通用工具条样式使字段横向挤压的问题。

日志和截图位于已忽略的 `apps/desktop/.tmp-test/`：`approval-binding-candidate/acp-product-final.log`、`page-tree-a6e22601/apps/host/acp-provider-no-log.log`、`page-tree-a6e22601/acp-electron-layout-1791933224637/`。

不得将这些检查登记为 ACP 全部完成、真实 OpenCode 委派通过或全量核心回归通过。

## CLI 与自动发现补记（基线 60cf16a）

- 新增 `sacode acp settings`、`enable <预期修订>`、`disable <预期修订>`、`probe`。配置仍明确落在当前目录的 `session.log`；尚未实现跨会话目录自动定位。开启不发送任务；探针未就绪返回 2，错误或冲突返回 1，未知动作返回 64。
- Host 与 CLI 共用二进制位置解析和就绪 JSON 构造。Windows 自动发现只扫描 PATH 中的绝对目录；支持原生 `.exe` 和经清单及固定目标核对的 `@opencode/cli` npm shim，不执行 shim、shell、where 或版本查询，不搜索隐式当前目录。其他布局或平台仍可显式配置可信路径，不宣称自动兼容。
- 本机 PATH 实际只有 npm shim，新增自动发现修复了此前必须手工覆盖路径的问题。发现专项两项通过；日志中另有一项既有凭据解析测试及一项私有诊断，不把它们混成四项新增产品测试。
- 去掉 SDK 变量和 SDK/stdx 搜索路径后，真实 CLI 与 Host 的配置、CAS、写租约、只读探针、默认 npm 自动发现及旧持久历史共五项通过。没有运行模型任务。
- 权限拒绝已定位到 OpenCode 子进程打开 `<用户目录>/.local/share/opencode/log/opencode.log`，**原因仍未解锁**。Node 同命令正常返回空列表；最小仅含 `std.process` 的仓颉程序也复现拒绝，继承/显式环境和路径分隔形式均未消除差异。不能据此断言文件锁、ACL 或安全软件是唯一原因。未手动删除或迁移日志、未关闭其他实例、未复制凭据。
- 页面现在区分“日志文件打开被拒绝”与“本地凭据列表为空”，两者均不允许提交；这不是认证成功或真实委派成功。

新增日志：`approval-binding-candidate/opencode-discovery-and-diagnostic.log`、`opencode-version-final.log`；生产构建日志 `page-tree-a6e22601/apps/{cli/acp-cli-final-build.log,host/acp-shared-final-host-build.log}`，均在已忽略的临时目录中。

最终复验补记：`opencode-discovery-final.log` TOTAL 384 / PASSED 3 / SKIPPED 381 / ERROR 0 / FAILED 0，退出码 0（仅三项发现/解析专项）；真实 CLI/Host 五项、页面与 IPC 十项通过；默认自动发现的 Electron 测试退出码 0，证据目录 `page-tree-a6e22601/acp-cli-discovery-final-1791935760608/`。OpenCode 实际状态仍为 `probe-failed-unknown`，子日志打开被拒绝。
