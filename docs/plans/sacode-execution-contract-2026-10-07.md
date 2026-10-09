# SaCode 执行与构建测试增量契约

2026-10-08 当前口径：execution 六动作及 CLI job 有限接口已实现并在同一新核心库的 Host/CLI 上复验，见 windows-unified-core-dual-entry-2026-10-08.md。下方初始拟议段为历史设计，不能据此否认已实现接口；真实 OS 隔离与公共启动门禁仍未放行，监督/输出/结算按后文实现增量及对应证据判定。

2026-10-07，F02 / F09，关联 F08、F13、F17。基线 `35a69ca9e0f8b7b6ac51271ec76eff3515eaa820`，本批未提交工作区态。

本文件明确接线前的业务边界；表中拟议 RPC、CLI 和新日志事件尚未实现，不应加入 initialize 或开放可执行按钮。继续使用共享仓颉核心、SessionLog、现有 NDJSON/JSON-RPC、有限 IPC 及客户端槽位，不建立另一份任务数据库。

## 1. 已核接口与差距

| 层 | 已存在事实 | 增量与边界 |
|---|---|---|
| ShellExecutor | 真实进程、argv、cwd、退出码、两路输出，已有模式名称检查 | 本批修正 stdout 阻塞绕过超时，补取消信号及输出限额；策略名称校验不是操作系统隔离 |
| Agent.shellStep | 执行器表支持 bash/pwsh，审批后运行 | Host 工具注册仍只有 read/write；不直接注册 shell 绕过本契约 |
| TerminalBuffer | terminal/chunk 的 jobId::text 落盘记录 | 不能推出命令、退出码、时间或完整作业状态；保持旧格式读取，不改含义 |
| JobStore | 实例内编号与状态 | 不是恢复真源；重启后 bash-1 可重复，不能当持久执行身份 |
| 桌面终端 | 已落盘输出回放 | 无交互 PTY、实时输入或独立任务停止；恢复页面不执行副作用 |
| 审批 | 工具名和一次性工单，现有核心管线 | 需要不可变执行提案绑定，不能把 read/write 的票或同名工具票用于另一条命令 |
| CLI | 当前工具与断言入口 | 新的 job/action 产品动作须共用核心，不能把自测当用户入口 |

## 2. 权威身份与提案

共享 ExecutionService 负责以下不可变提案；Host/CLI 负责解析与平台适配，页面只显示和提交动作。

- sessionId、taskId、requestId、executionId：明确区分四种身份。executionId 由核心分配，跨重启不复用；UI 的标签 ID、PID 和 JobStore 的局部编号均不能替代它。
- workspaceRevision、规范化 cwd、executable、argv、timeoutMs、输出上限、沙箱需求：批准前固定。cwd 由该会话权威工作区解析；改变任一参数必须产生新提案和新批准，不继承旧授权。
- proposalDigest、approvalId、grantScope、grantRevision：批准必须绑定该提案及会话。配置、凭据和授权引用分别解析；普通事件、页面 owner 和错误不回显秘密环境值。
- requestId 在同会话重试同摘要只返回原提案；同 ID 不同摘要拒绝 request-conflict。未知执行结果不自动重跑。
- 参数形式默认 executable + argv。用户选择 shell 时显示实际 shell、完整命令和 cwd，明确该命令会经过 Shell 解释。不得以 action 名称隐藏可执行内容。

现有审批尚未绑定这些字段，因此本批执行器探针不能作为产品授权完成证据。

## 3. 状态及完成判据

提案状态：proposed → awaiting-approval → admitted → starting → running。拒绝或启动前取消进入 rejected / cancelled-before-start；不存在进程。

运行状态：running → stopping → exited，或异常进入 unknown。exited 后不可回到 running；再次运行需新 executionId。退出事实独立保存 exitCode、exitObserved、timedOut、cancelObserved、terminationScope、treeTerminationConfirmed。

输出状态独立保存 stdout/stderr 的序号、字节数、截断、编码及 EOF。exitCode=0 不等于输出完整，也不等于测试通过。超时/取消不得冒充自然完成；未观察到退出，不用 -1 代替实际退出码。页面区分“进程退出”“输出不完整”“测试结论未知”。

完整任务成功需要：真实退出码为 0、未因取消/超时退出、必要完成证据持久化并核验、输出/报告满足该动作验收。保留输出达到限额但已完整排空时，可以显示退出事实；不能从截断文本解析完整测试分母。

## 4. 取消、停止与连接生命周期

- 关闭标签只撤销订阅和界面；不取消任务，不释放执行授权给其他任务。
- 用户停止绑定 executionId + 预期状态修订；核心请求该任务的子 TurnToken 取消，迟到信号不能取消后来任务或其他会话。
- 取消、自然退出竞态按核心首先确认的事实结算：接受停止请求不等于进程已终止。返回 stopping 后持续查询，直到确认退出或 unknown。
- 单根进程 terminate 不能凭名称宣称整树终止。提供方必须报告验证范围、失败和不支持；脱离子树、孙进程及其他平台各做实际探针。
- 断开 UI 连接不自动杀任务；Host 生命周期关闭的监督行为由提供方明示。重连只订阅，不重放命令或授权。
- 超时使用单调时钟，自启动计算；stdout/stderr 均在独立读取任务中。输出限额后继续排空，管道等待也有边界；捕获未结束返回 output-incomplete，不伪造完整正文。

本批 ShellExecutor 新增内部 cancelled 回调，可由核心服务绑定 TurnToken.cancelled；它不是渲染层传入的可执行函数。现有 Agent/Host 未接此取消信号，不能宣称输入区停止已覆盖 Shell。

## 5. 持久与恢复

以下拟议事实须经 W10 契约评审：execution/proposed、approval-bound、admitted、started、output、stop-requested、exited、settled。保留旧 terminal/chunk；新增事实不用覆盖旧日志解释。

| 屏障 | 必须成立的事实 | 失败处理 |
|---|---|---|
| 启动前 | 提案、授权、身份和 admitted 通过写租约与持久屏障 | 写入或屏障失败不启动；SessionLog.flush 仅已有可见性判据，不冒充已完成的真正持久屏障 |
| 启动后 | 进程身份、提供方、PID 与创建身份、监督范围可核查 | 无法落库时停止可核查的自身进程并登记故障，不能返回正常 running |
| 结算前 | 退出、取消原因、输出 EOF/截断及证据持久化 | 结算失败保留 unknown / unsettled，不成功回执后再补日志 |
| 恢复时 | executionId 与原进程创建身份一致，授权恢复策略允许观察 | PID 被复用或身份无法验证不接管；旧 running 不能靠回放直接变 completed |

恢复 awaiting-approval 不自动授予权限；恢复 admitted 不自动启动；恢复 running 查询提供方，无法恢复退出事实则 unknown。恢复布局只打开资源。副作用任务不得因空日志、断连或缺结果自动再执行。

## 6. 拟议共享动作与双入口

每条 RPC 与对应有限 IPC 的字段分别校验，不提供通用 method/argv 转发。CLI JSON 模式共用同一核心对象，缺授权明确返回 not-authorized，不交互授予权限。

| 拟议 RPC / CLI | 输入 | 输出及错误 | 授权与持久 |
|---|---|---|---|
| execution/propose / job propose | 会话/任务/请求身份、工作区修订、完整提案 | executionId、摘要、需批准范围；bad-arguments/workspace-changed/request-conflict | 尚不执行；提案屏障 |
| execution/authorize / job authorize | executionId、摘要、approvalId、预期修订 | granted/rejected；approval-mismatch/expired/not-authorized | 一次性精确授权，持久绑定 |
| execution/start / job start | executionId、预期修订 | starting/running；provider-unavailable/persistence-failed/not-authorized | 原子消费准入，禁止重复执行 |
| execution/describe / job status | 会话、executionId | 状态修订、退出/输出/证据事实；unknown-execution/session-mismatch | 只读范围核验，不推测成功 |
| execution/output / job output | 身份、游标、页限 | 两流独立序号、截断、EOF、下一游标；bad-cursor/identity-changed | 有界只读，迟到结果不串会话 |
| execution/stop / job stop | 身份、预期修订、取消原因 | stopping/已结算事实；revision-conflict/stop-unconfirmed | 停止自身任务，持久请求和结算 |
| action/propose / action propose | build/test 类型、选定工程、配置修订 | 实际 executable/argv/cwd、报告路径提案 | 与普通执行同一授权链 |
| action/describe / action status | executionId、报告身份 | 退出事实、真实报告、分母或 unknown | 只读报告；不从按钮文字推出通过 |

interactive terminal/create/input/resize 需真实 PTY 提供方探针后再实施；不能把普通 stdout 回放扩充成伪 PTY。

## 7. 构建测试判据

检测工程与生成提案分开：读取 Cargo/cjpm/package/pytest/go 的配置仅用于建议，未识别时由用户明确选择。脚本、工作目录、环境和生成物范围均在批准页显示；npm script 可调用其他命令，不能作为只读操作免批准。

真实退出码、stdout/stderr、结构化测试报告和产物分别取证。报告记录来源路径与哈希、生成时间、源码 SHA/工作区态、测试集合和分母。无报告返回“退出码已知，测试数量未知”；空集合不算通过。解析错误、旧报告、输出截断或模型自行宣称通过均不得升级状态。修复、暂存、提交、推送继续分别授权。

## 8. 主责、探针与解锁

以下表是最初实施批的历史分解；当前执行准入、输出及双入口状态以 §12–§17 的增量和对应证据为准，未完成项仍保留，不以历史“设计中”覆盖已取证实现。

| 工作项 | 主责 / 依赖 | 状态与验收 |
|---|---|---|
| 输出读取与超时基础 | E / W40 | 本批实施并实测；12 项真实进程探针，不等于完整核心回归 |
| 当前 Windows 父子终止 | A、E / 平台提供方 | 本批直接子进程探针通过；不扩展为脱离子树/其他平台保证 |
| Windows Shell 正文传递 | E / Windows PowerShell 提供方 | cmd /c、powershell -Command 标准形式引用专项 13/13；真实审批管线 4/4，范围与依赖见 §11 |
| 提案授权绑定、状态与双入口 | E、A / 既有审批 | 原始工具参数绑定已实施并专项验收；完整执行身份、持久提案、CLI 接线仍设计中 |
| 新事实与持久屏障、恢复 | B、E / W10 | 待契约收口；启动/结算落盘失败、崩溃重启、PID 复用反证 |
| 真正隔离与树监督 | A、E / Windows/Linux/鸿蒙探针 | 阻塞产品执行入口；原因是当前模式检查不能证明隔离，影响所有可执行动作；提供方声明与越界/脱离子树反证通过才解锁 |
| 终端与构建测试页面 | G / 已批准共享接口 | 输出回放已接；执行入口待上述门槛，需正式 Host 和 CLI 分别验收 |

当前探针命令：`node apps/desktop/test-support/shell-execution-verify.mjs`。直接编译实际 shlex.cj、sandbox.cj 与无副作用取证程序；只验证 Windows，私有目录保存源码/二进制哈希、命令、日志、退出码。探针不变更系统权限，只清理自己创建的进程。


## 9. 工具结果兼容与 cmd 边界

现有 shellStep 已同步拒绝 output-incomplete 和捕获错误，避免新增结构化结果被旧调用方当成成功空输出；截断以显式标记进入旧终端缓冲。非零退出、超时、取消不再标记 verified 或返回成功工具结果。此调整没有为 Host 注册 shell，没有增加日志事件类型。

集成探针 `node apps/desktop/test-support/shell-pipeline-verify.mjs` 使用刚构建的 core 静态库、真实 ApprovalDesk 工单和 ToolRuntime。编译前需要按本文件的 Host 私有目标路径重建；不能沿用旧库证明新源码。

第十一批已复现 std.process.launch 到 cmd 包装时，含引号命令被误转义。当时独立脚本夹具只使用无空格路径验证工具结算。第十三批已补 Windows 现有 cmd /c 与 powershell -Command 的正文传递修正，范围与提供方依赖见 §11；授权身份、沙箱和持久契约仍是执行入口门槛。

## 10. 原始工具参数绑定增量

共享 ApprovalDesk 新增 askForCall(tool, arguments, ttl) 与 consumeForCall(id, tool, arguments)。工单保存不可变原始参数，按工具名与原始字符串一起核对；JSON 重编码也不能复用原票。匹配和一次性消费在同一把锁内完成，参数挪用不消耗原票；旧 consume(id, tool) 无法消费带参数的票。已批准但尚未消费的票也按同一期限失效。

现有 approval/ask 在 params 中接受可选字符串 args（字节上限 262144）；传非字符串返回 -32602 bad-approval-arguments，不生成工单。缺省仍兼容旧工具名票，不能把这条旧通路声明为完整精确提案。桌面 approvalAsk(name, args) 同步字段校验并传递；文件保存用同一份 path/content 序列化结果发号与执行。模型工具回调绑定实际 call.args，ToolRuntime 在派发前拒绝 approval-arguments-mismatch。

这次不改变 approval/asked 的旧持久载荷，也不把参数原文写进该事件，避免擅自升级 W10 格式或记录工具敏感参数。新 Desk 不恢复已批准工单。上述绑定仅证明当前进程内工具参数未替换；尚未覆盖执行 ID、任务 ID、环境、工作区版本、CLI 和跨重启审计摘要。启动/结算持久屏障、沙箱提供方和 cmd 引用门槛继续有效。

专项复跑：先构建 apps/host 的私有目标 apps/desktop/.tmp-test/exact-approval-host，再执行 node apps/desktop/test-support/exact-approval-verify.mjs（默认读取该目标的 core 静态库）。12 项覆盖正向、挪用、期限、拒绝、JSON 重编码、新实例恢复、兼容、并发和真实工具派发前拒绝，不等于全核心单测。

## 11. Windows Shell 正文传递增量

仅 Windows 编译目标的既有 cmd（单个 /c 参数）和 Windows PowerShell（单个 -Command 参数）启用修正。平台按编译目标判定，不依赖可缺省的 OS 环境变量。其他平台保留原路径，尚未追加平台支持声明。

PowerShell 正文按官方 EncodedCommand 约定以 UTF-16LE（含补充字符代理对）和 Base64 传入，禁用用户 profile 与交互提示，不更改用户脚本引号。cmd 路径增加 Windows PowerShell 传输进程，以 .NET ProcessStartInfo.Arguments 原始字符串启动真正的 cmd /d /s /c，并显式返回 cmd 的退出码。原命令只作为 PowerShell 单引号字符串数据，单引号成对转义，变量展开与 Shell 运算符仍由 cmd 处理。/d 禁用注册表 AutoRun，避免额外启动动作。

cmd 子进程关闭 stdin，两路 BaseStream.CopyToAsync 并行转发原始输出字节；外层实际 ShellExecutor 继续控制有界捕获、超时和取消。它仍是非交互执行，不提供 PTY。PowerShell 缺失或启动失败不会回退旧转义通路，更不会返回模拟成功。完整准入提案需显示真实 shell、传输提供方及固定启动选项，不能仅审批工具显示名。

命令不截断：cmd 正文按 UTF-8 字节保守限制 7500，最终编码参数限制 28000；超限返回 shell-command-too-large。空字符拒绝；已识别 Windows shell 的未验证参数形式返回 unsupported-shell-arguments。调用方不能通过追加参数绕回已知错误的旧转义。首次校验期限和启动前取消仍不启动进程。

13 项真实引用探针覆盖空格/单引号路径、中文及 emoji、cmd 原生 argv 的嵌入双引号、PowerShell 脚本正文引号、变量展开、复合命令、真实退出码、打开管道后的超时与取消、超长/空字符/未知参数拒绝。PowerShell 调原生程序的引号处理沿用该提供方自身行为，本批不宣称已解决 Windows PowerShell 的原生参数解析限制；输出仍遵循 UTF-8 契约，其他编码不冒充完整输出。

复跑 node apps/desktop/test-support/shell-quoting-verify.mjs；私有目录记录 PowerShell/.NET/Windows 版本、提供方 EXE 哈希、实际源码与探针哈希、命令、日志和退出码。实际 core 静态库的 shell-pipeline 探针现改为含空格和单引号的私有目录，并用精确参数工单执行引用命令。上述证据不替代持久任务、恢复监督、完整进程树、沙箱或 CLI 入口验收。

依据：[PowerShell EncodedCommand](https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.core/about/about_powershell_exe)、[cmd /s 与 /c](https://learn.microsoft.com/en-us/windows-server/administration/windows-commands/cmd)、[ProcessStartInfo](https://learn.microsoft.com/en-us/dotnet/api/System.Diagnostics.ProcessStartInfo)。实现结论以上述真实进程探针为准。


## 12. 持久任务准入与恢复实施（2026-10-08）

用户明确要求继续实施。共享 `ExecutionService` 与 `SessionLog.durableCheckpoint` 已落在工作区并通过专项。本节最初尚无 RPC/CLI；后续实际接线与验收以 §16–§17 为准，不能继续用历史缺口描述当前源码。

- `execution/state` 是 version=1 的 log-only 事实，字段含 sessionId/taskId/requestId/executionId、不可变提案、修订、阶段、结果。提案当前固定六字段：workspaceRevision、cwd、executable、argv、timeoutMs、outputLimit；正文最多 1024 字节。新 ID 按事件序号分配，同会话同 requestId/同原始提案重试只返回已有任务，不重复启动；提案或 taskId 不同则 request-conflict。
- workspaceRevision 当前定义为该会话 workspace/directory 的事件计数；cwd 必须规范化后等于当前权威工作区根目录且目录可用。提案、授权及启动许可分别核对，审批后切换工作区不能使用旧许可。子目录执行尚未开放。
- 严格一次性审批消费新增 consumeExactForCall；旧工具名工单不得用于准入。绑定 sessionId、executionId、SHA256 摘要及原始提案；新方法不改变旧 consume/consumeForCall 的兼容语义。
- 授权持久化 admitted 后才生成当前进程内许可；beginStart 的 starting 落盘后才返回一次性启动许可。starting 不是运行事实，也不会启动命令。started 需要本实例发出的许可；取消与结算按任务修订 CAS。拒绝恢复实例凭旧 starting/running 写出启动或成功结论。
- 恢复 admitted 转 awaiting-approval；starting/running/stopping 转 unknown，原因 process-unverified。不会按 PID 接管、重放授权或命令；活实例不能对仍由它监督的任务执行恢复。停止 starting 尚未接监督提供方时返回 stop-unconfirmed，不假报进程已被停止。
- 新 durableCheckpoint 不覆盖已提交前缀：验证对应租约、完整磁盘尾、连续相同前缀，再由同一 Windows FileStream 句柄核对长度/SHA256、追加、Flush(true)。每批追加最多 4096 字节；失败不推进 flushedCount，服务冻结读写，拒绝把未持久状态当作已确认。必须重新读取日志并明确恢复，不自动补跑。旧 flush 保持兼容，不宣称所有会话写入已升级。
- Windows 提供方固定为 SystemRoot/System32/WindowsPowerShell/v1.0/powershell.exe，禁用 profile/交互；不使用 PATH 上的同名程序，不执行提案内容。缺少提供方、未知平台、锁冲突、坏尾、前缀差异或容量超限均拒绝，不回退整写。此为当前平台提供方，后续可换原生句柄实现；不把进程边界/Flush 调用通过记成断电验证。
- finish 只保存退出观察、真实 exitCode、超时、取消与输出完整性；processSucceeded 不代表测试通过。未由本实例监督的执行不能结算；停止后即使退出码为 0 也不成功。

证据见 `docs/evidence/execution-admission-recovery-2026-10-08.md`。Host/CLI 接线、真实执行提供方、真正沙箱、完整输出/产物/测试报告、完整进程树监督及整体 W10 迁移仍待实施或独立验收。

Windows 刷新依据：[FileStream.Flush(Boolean)](https://learn.microsoft.com/en-us/dotnet/api/system.io.filestream.flush?view=net-10.0)。

## 13. 启动窗口监督接口增量（2026-10-08）

共享服务新增 beginStart 的可选 token：监督者必须在取得启动许可时绑定自身任务令牌。绑定令牌的 starting 可以接收 stop，持久记录 stopping 后发取消；持久失败也向已绑定令牌发送取消，不谎报终止。旧无令牌路径保持 stop-unconfirmed。

绑定路径使用 startedSupervised 记录观察到的进程身份，禁止通过旧 started 替换绑定令牌。若停止先到，进程观察事实仍留在 stopping，不能回到 running；监督者使用最新修订提交观察事实，旧修订仍拒绝。尚未记录启动观察时不能 finish，避免仅凭停止令牌伪造退出。

startFailed 仅限持有本实例启动许可的监督者，将启动失败记录为 unknown 并取消自身令牌；不生成假的 exitCode。恢复实例无许可不能调用。上述接口仍不启动进程，也不是沙箱或进程树监督实现。后续真实监督提供方必须消费这些接口并验证取消、退出和输出事实。

## 14. 真实进程监督适配增量（2026-10-08）

ExecutionSupervisor 已消费准入许可与监督令牌，调用真实 ShellExecutor，记录本实例持有的子进程 PID、观察到的启动和退出，并按输出完整性、取消及超时结算。启动失败与未观察到退出分别记 unknown，不将 -1 当作真实退出码。ShellResult 新增 exitObserved，ShellExecutor 增加启动回调与可配置的每路输出限额，达到限额继续排空。停止与结算修订冲突按最新状态再次结算，保留 stopping 的失败裁决。

providerReady 默认 false；测试注入 true 只用于监督探针，不是沙箱能力证明，Host/CLI 不得据此开放执行入口。当前身份仅在持有 SubProcess 对象的本实例内有效，不包含操作系统创建时间，不支持跨重启 PID 接管。stdout/stderr 目前通过返回值供观察，持久有界输出 RPC、结构化报告和完整树监督仍未接入。Windows 实测不升级 Linux/鸿蒙支持声明。

## 15. 持久输出与分页增量（2026-10-08）

ExecutionService.captureOutput 将输出逐块写入同一日志的 execution/output version=1，每块原始字节最多 512，base64 编码；字段为 sessionId、executionId、channel、streamSequence、byteCount、data、endOfCapture、eof、truncated。stdout/stderr 各自严格连续计数，累计保留字节分别受提案 outputLimit 限制。结束记录不含正文；endOfCapture 与真实 EOF 区分，未完整排空不会标记 EOF。禁止结束后追加、跨执行身份、未知版本、坏序号、坏编码或超出限制。

每块经对应租约与 durableCheckpoint 成功后才可作为持久事实；失败冻结服务并取消本任务令牌，拒绝输出读取和成功结算。ExecutionService.output 使用日志事件序号作为游标，初始 -1，页限 1–16；返回执行/会话身份、当前状态修订与阶段、records、nextCursor、hasMore。records 带各自 cursor，正文按原始字节拼接后解码，不能假定页边界即字符边界。无更多页不等于 EOF，应检查结束记录。

监督者当前在进程捕获返回后分块持久化两流，再结算；这是持久回放，不是实时流式终端。已存在输出记录时，finish 必须确认两流结束记录；outputComplete=true 还必须两路均观察到 EOF。结算记录补充实际保留字节数与截断标记；输出截断不得推导完整测试报告或分母。旧无输出记录的调用保留兼容，不能据其 outputComplete 推定已具备新输出链。

核心分页和真实进程输出落盘已实现；execution/output RPC、CLI job output 与桌面控制器后来已接线，见 §16–§17。实际执行门禁尚未开放，整体产品完成状态不升级。第 14 节的“仅返回值”是该轮历史边界，本节为后续实现增量。

## 16. 有限双入口动作接线（2026-10-08）

ExecutionApi 为 Host 和 CLI 共用的固定六动作解析器。所有请求必须带 sessionId；propose 收 taskId、requestId、原始 proposal 字符串；authorize 收 executionId、revision、proposalDigest、approvalId；start/stop 收 executionId、revision；describe 收 executionId；output 收 executionId、cursor、limit。拒绝未知字段与类型，不提供任意 method 转发。提案回应附带精确 approvalArguments，供 approval/ask 绑定 execution/start；摘要不匹配不得消费该票。

状态回应含 executionId/sessionId/taskId/requestId、原始提案、SHA256 摘要、修订、阶段和事实。providerAvailable 当前固定 false；start 经过默认关闭的 ExecutionSupervisor 门禁，返回 execution-provider-unverified，不消费启动许可。Host 已增加分派、声明及会话实例隔离；恢复失败的服务保留冻结实例。LSP 契约符号阻塞已解锁；新 Host 实际构建与六动作验证见 §17，不能扩大为真实执行或全产品通过。

CLI 新增 sacode job <propose|authorize|start|describe|output|stop> <JSON参数>，读取当前目录 SessionCatalog。authorize 的 CLI 输入只含 sessionId/executionId/revision/proposalDigest；展示原提案并要求 stdin 明确 y，应答后在本进程生成精确一次性工单。无应答或 n 不授权，不接受别的进程工单号。每次新写实例先恢复，旧 admitted 重置 awaiting-approval；一次 CLI authorize 的准入不转移给下一进程。start 尚未放行，未来实际执行必须在同一受监督进程内取得新批准，不能恢复旧许可。

桌面 main/preload 增加 executionPropose/Authorize/Start/Describe/Output/Stop 六个固定通道。主进程限制完整字段、整数范围、摘要形状、提案 UTF-8 字节上限及页限，读取与停止可在模型轮次在途期间请求。终端已挂载持久任务面板，控制器取得真实 Host 证据；Electron 页面、完整正式窗口与实际执行仍未验收，不标业务完成。

CLI 已在 D 盘私有目录、仅 System32 PATH 的环境验证十个真实场景；核心与桥接专项另文。C 盘系统 Temp 目录的租约创建仍失败，诊断探针发现直接创建也被拒绝；相对目录/标准化推测已撤回，未改变租约原子暂存算法或目录权限。此环境问题尚待解锁，不扩大为所有 C 盘目录或全 Windows 不支持的结论。

## 17. 当前双入口与桌面消费取证（2026-10-08）

Host 与 CLI 均按当前工作区源码重建至私有 target，DLL 同目录打包，不覆盖共享产物；HEAD 仍为 35a69ca9e0f8b7b6ac51271ec76eff3515eaa820。六动作 Host 验证通过；CLI 十场景在仅 System32 PATH 下通过。两入口均拒绝未验证的执行提供方，恢复不继承授权，不生成 owned-subprocess 事实。CLI 是跨进程命令，因此批准只属于该次进程，不能用下一次 job start 自动续用。

workspace/get 同源返回 sessionId、directory、revision；revision 来自 Workspace.revision 的 workspace/directory 计数。桌面完整提案、审批绑定、状态、输出与取消已实现，关闭/切换废弃客户端回执且不发送 stop。损坏输出页原子拒绝，UTF-8 跨页拼接；空页不当作 EOF。当前显式输入执行身份恢复，标签任务引用持久化尚未接入。

证据见 `docs/evidence/execution-desktop-admission-2026-10-08.md` 与 `execution-dual-entry-recheck-2026-10-08.md`。桌面控制器 9/9（含 1 真实 Host），选定核心 118 通过/1 跳过；这些不能代替全量核心或 Electron 页面。Electron 在进入页面脚本前退出 0x80000003，原因待核，主责 G/W60；解锁后须取得正式页面、亮暗主题及会话/断连/关闭竞态证据。构建测试页面、真实报告、隔离/子树监督和 GoalRunner 实际轮次接线继续待实施，不因上述专项通过升级为完成。

## 18. 目标轮次产品持久提供方（2026-10-08）

GoalRunner.start 为显式启动的异步入口，严格使用日志内同修订同轮次 GoalClaim；恢复不自动调用。GoalCheckpoint 使用完整行分批检查点，每批 4096 字节、总待提交 1 MiB；单行超容量明确拒绝。失败冻结实例的写入与投影并保留租约，不用旧 flush 修复。目标完成 CAS 与检查点同锁，防止并发读看到未提交完成。旧单批检查点及同步 Driver 测试接缝保留，不升级整体会话迁移状态。

专项 125 总数/124 通过/1 跳过，证据 `docs/evidence/goal-checkpoint-freeze-2026-10-08.md`。期间仓库 HEAD 被其他写者推进至 78f79e0，本会话没有提交；实现由工作区源码哈希绑定。新产品入口尚未接 Host/CLI；预算、真实模型请求、冻结后的协议错误与恢复分别继续实施。

### 18.1 逐轮结算与预算完成闸

GoalRunner.start 增加 settleRound(TurnResult) 回调：每轮模型循环返回后、该轮检查点与完成判断之前调用一次。双入口接线必须把实际用量记账放在这里，最终 poll/退出只重建账态，不能把聚合 TurnResult 再结算一次。budgetExceeded 在开轮前及本轮结算后复核；预算已耗尽时即使同轮 evidence 与 claim 同时成立，也写 goal-budget 阻塞而非完成。结算期间取消保持目标 active，不完成、不启动下一轮。

结算器可能已经追加账本事件再抛错，因此回调或聚合失败立即冻结 SessionLog、取消本轮、返回 goal-round-settlement-failed；禁止随后用旧 flush 把半笔结算发布为成功。聚合用量拒绝非法数字与 Int64 溢出。这个接缝默认不做记账，只供产品入口注入唯一结算器；不能据此声明 Host/CLI 已接线。用量缺失的真实 provider 判据仍须随入口单独验收，现有模型循环聚合的零值不作为缺失用量证据。

### 18.2 Host 显式目标任务入口（实施中）

task/start 在当前目标为 active 时创建 HostGoalRun；turn/start 诊断入口及无 active 目标的普通任务保留原有单轮路径。启动回执新增 goal 布尔值。恢复、goal/describe、session/projection 不创建运行态。目标任务每轮由 GoalRunner 独自摘一条 next-turn 消息，Host 不提前重复消费；首次和后续 Provider 工厂均从准入提示持久化后的日志装配请求，每次创建独立 Provider。

当前保底限额为 8 个已准入轮次、3600 秒累计轮次时长、连续 3 轮无进展；额度从日志重建，重启不重置。此为有限运行策略，不是工时承诺；设置界面的限额配置尚未接入。超时数值是轮次边界判据，不能代替模型连接/工具本身的超时或进程监督。

GoalUsageMeter 在核心内同锁重建与结算各轮用量，预算读取包含运行中收紧的 usage/budget。Host turn/poll 和退出不重复 settleTurn 聚合用量；运行中 usage/status 从日志更新读面。所有目标准入、轮次、完成、最终 poll 与退出使用 GoalCheckpoint；失败冻结 SessionLog 并保留租约。冻结 poll 返回 -32026/session-durable-frozen，包含底层 finishReason 与 leaseRetained；其他读写拒绝同一冻结实例，initialize 和取消仍可响应。协议分派的异常边界兜住在途冻结竞态，不能让未持久投影崩溃主进程。

源码已接线，真实 Host 验收仍待本轮新产物验证；CLI、完整桌面页面、真实远端模型、任意工具的统一持久执行与沙箱监督门禁仍未完成。仅这一有限循环不证明整个主 Agent 闭环。
# Windows 原生提供方增量（2026-10-08，产品接线待验收）

ExecutionSupervisor 增加可选 WindowsJobExecutor 注入，默认仍 None，providerReady 仍 false。Host/CLI 当前默认构造不自动选择原生提供方，不以构造成功作为沙箱证明。既有 ShellExecutor 路径保留，避免覆盖其他平台及既有测试接缝。

Windows 有限监督协议使用独立 broker；首帧 version=1、executionId、executable、argv、cwd、timeoutMs、outputLimit，后续只有相同 executionId 的 resume/stop。suspended 返回自持句柄的 PID/创建 FILETIME；核心在 startedSupervised 完成持久化后才恢复进程。已停止的启动保持 stopping，不能因为回调返回而恢复。断连、观察失败与进程身份记录失败清理自建 broker/Job，无法核查的业务状态保持 unknown；持久化冻结优先，不能补造退出。

WindowsJobFacts 保留原始双流字节，仅在 Job 清空、根退出及双 EOF 后返回。共享监督按每块 ≤512 字节写 execution/output 并分别记录 EOF/截断，再 finish；这是完成后的持久回放，尚非实时输出订阅。兼容 ShellResult 的字符串面可隐藏 UTF-8 截断尾片，但 execution/output 不删除该字节。停止和自然退出的修订冲突仍按当前状态结算，保持停止裁决。

私有 -O1 Host/core 重建 rc=0，共享核心真实监督五场景 rc=0，结果登记 windows-native-job-supervision-2026-10-08.md，逐场景原件 apps/desktop/.tmp-test/windows-supervisor-iIZqRx；不扩大为默认构建或全量核心。真实 OS 隔离、公共执行入口、Host 中断恢复、正式桌面、统一安装包仍待验收。


2026-10-08 在途模型请求取消增量：每请求 Client 绑定 TurnToken，取消主动关闭连接；SSE 解析/计费线程单独结算，父令牌联动、detached 独立，正常超时不降低。本机真实 HTTP 五场景、CLI Ctrl+C 589ms、Host 取消 1958ms，证据 sse-cancel-latency-2026-10-08.md；不代表 Shell 隔离或桌面通过。
## Windows 隔离接缝增量（2026-10-08）

WindowsJobExecutor 增加可信装配参数 sandboxRoot/toolDirectory/sandboxMode，三者必须同时有效，模式闭集 read-only/workspace-write。该配置目前只用于验证，不作为 RPC 首帧允许的字段；默认空配置的普通 Job 不获得产品放行资格。

配置隔离时，suspended 必须确认 sandboxed=true，核心才记录启动身份及发送 resume。result 必须同时 sandboxed=true、sandboxCleanupConfirmed=true，并满足既有根退出、整树清空、双 EOF、字节序列与限额契约。broker 只有在 Job 句柄与临时 AppContainer 授权释放成功后返回 result。错误先向自持 broker 发送 stop，限时等待清理；无法确认则强制结束自持实例，并保持业务 unknown/冻结，不补造清理事实。

公共审批提案尚未包含隔离资源作用域，ExecutionApi 默认门禁仍关闭。接线必须显式设计并绑定可读工具资源与工作区写策略，不能仅凭本机探针 PASS 将所有任意程序标记为 providerAvailable。完整证据见 windows-isolated-broker-adapter-2026-10-08.md。
## 公开提案的隔离授权增量

新提案保留六个原执行字段，新增 sandbox 对象：version=1、mode（read-only/workspace-write）、network=none、toolDirectory（规范目录）、executableSha256（真实程序 SHA-256）。权限范围与程序身份进入原始提案/精确审批，不由恢复读面推断。未知字段或扩权值拒绝，程序内容变更要求新提案与审批；旧六字段提案不自动升级为具有沙箱授权。

公开 API 的 supervisor 由入口可信装配；RPC 不接收 providerReady。公开可用判据同时要求已验证提供方、配置/提案作用域和程序摘要一致，启动前原生 broker 再核验并持有禁止替换的程序读句柄。默认门禁仍关闭。CLI start 要在本进程重新批准并立即消费新许可；Host start 必须异步监督，停止/读输出保持 NDJSON 可响应。当前状态与专项范围见 execution-sandbox-proposal-2026-10-08.md。


## 当前异步监督与输出实现校正（2026-10-08）

工作区实现已增加 ExecutionRun／ExecutionApi 异步启动：许可消费和 starting 持久屏障同步完成，后台执行；Host 登记句柄、限定活动中方法和 EOF 停止等待，只有 exitObserved 与 outputComplete 均为真才标记 executionSettled 并释放租约。Host 接线未编译验收，可信公开提供方仍未装配，门禁关闭。

WindowsJobExecutor 已将校验后的每个原始输出块和各通道闭合标记交给 onOutput；监督器即时 captureOutput，取消结果后的重复写入。前文“完成后的持久回放”现只描述旧实现；当前逐帧实现仍是轮询 output 页面，未升级 SSE 订阅或交互 PTY。适配器真实 2 场景通过，但最新核心／Host 联合验证尚未完成，证据 execution-live-output-2026-10-08.md 与 execution-shared-freeze-2026-10-08.md。

2026-10-08 执行文件摘要契约补充：准入仍绑定 SHA256 且启动前复核；文件摘要必须有界读取，不准将工具二进制整体读入再复制补位。大型 Node 实测暴露 OOM；新增 sha256FileHex 固定 64KiB 读取缓冲并复用原 SHA256 压缩轮。文件读取失败继续拒绝准入。最终 native broker 在打开运行文件后仍独立复核摘要，不能凭前端摘要放行。
