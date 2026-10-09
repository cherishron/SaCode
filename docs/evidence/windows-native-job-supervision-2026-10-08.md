# Windows 原生 Job 监督实现与实测

基线提交 ccf3bff7609d6761d14f7b712676791342e15137，新增文件尚未提交；源码与二进制哈希见 `apps/desktop/.tmp-test/windows-job-HR6sLh/manifest.json`。主责与新增路径已登记 W00。本批没有修改在途 shlex/sandbox 或公共 Host/CLI 入口。

## 实现

`core/native/windows_job.cs` 是机械生命周期提供方：CreateProcessW 使用 PROC_THREAD_ATTRIBUTE_JOB_LIST，在创建时绑定匿名 Job；Job 配置 KILL_ON_JOB_CLOSE，不设置 breakaway。初始 CREATE_SUSPENDED，只有调用 Resume 才运行；PID 与 GetProcessTimes 创建 FILETIME 从自持句柄获取，不能按 PID 接管旧进程。Stop 调 TerminateJobObject，Wait 核真实根进程退出码；ActiveProcesses 查询 Job 中仍在运行的进程数。构造后身份核验失败时清理自持进程句柄，Dispose 关闭 Job，异常退出时由系统关闭句柄清理树。

业务规则仍由仓颉负责。本文件没有授权、审批、SessionLog、自动恢复或文件/网络隔离；现有 ExecutionSupervisor 尚未消费该提供方。构建用 Windows .NET Framework C# 编译器，不引入 npm 运行依赖；正式产物的 .NET 可用性及打包仍待验收。

## 当前机器实测

Windows build 26300，x64；`node apps/desktop/test-support/windows-job-verify.mjs`。v2 原件 `target/windows-job-v2.log`、`.exit.txt`，rc=0；私有目录 `apps/desktop/.tmp-test/windows-job-HR6sLh/` 保留编译命令输入与构建日志、源码哈希和三场景 results.json。

1. stop-before-start：创建即 Job 成员 active=1，200ms 内未执行夹具；恢复前停止，exitCode=143、active=0，无夹具文件。
2. stop：恢复后夹具创建分离子进程；Stop 后根退出 143、Job active=0，两者均不再存活。
3. broker-crash：强制终止本测试自行创建的监督进程；系统 kill-on-close 后根及分离子进程均不再存活。此场景不会产生正常业务结算，核心恢复必须仍保留未知事实。

监督提供方编译产物 SHA256：`eebd052dc09235ec1a3cb136a7fe19d99437b883040280dd6caa7d20da792edd`。本轮结束查询 job-probe.exe 无存活实例。初版两场景 rc=0，v2 加恢复前停止及构造失败清理；使用 v2 哈希作为本批结果。

## 继续实施的契约

- 仓颉侧先持久化一次性准入，再调用原生创建；持久化句柄对应的 PID/FILETIME 与启动修订之后才 Resume。途中 stop 必须消耗同一取消令牌并终止挂起 Job，不能恢复已取消启动。
- 停止和自然退出须核根退出及 Job active=0；无法确认返回 stop-unconfirmed/unknown，不能据关闭句柄动作宣称已经结算。
- 原生提供方已补双流管道与句柄继承白名单（见后续实测）；仓颉消费端及业务输出持久化仍待接线，不以提供方探针替代产品双流输出验收。
- 真实隔离需独立 Windows 后端；read-only/workspace-write 不能继续仅做字符串校验，必须以工作区内外读写、网络与子进程逃逸探针验证。Job 不是文件/网络沙箱，providerReady 保持 false。
- 监督进程死亡可证明清理，但 SessionLog 没有终态仍须恢复 unknown，不能继承授权或按 PID 重新认领。后续要从真实 Host 中断恢复链路取证。

API 依据：[Microsoft Job Objects](https://learn.microsoft.com/en-us/windows/win32/procthread/job-objects)、[UpdateProcThreadAttribute 的 JOB_LIST 与 SECURITY_CAPABILITIES](https://learn.microsoft.com/en-us/windows/win32/api/processthreadsapi/nf-processthreadsapi-updateprocthreadattribute)。官方接口描述不替代本机探针，也不扩大为 Linux/鸿蒙支持。

## 双流管道增量与五场景复验

执行命令仍为 `node apps/desktop/test-support/windows-job-verify.mjs`，本轮 rc=0；完整日志 `target/windows-job-dual-output.log`、退出原件 `target/windows-job-dual-output.exit.txt`。私有产物与逐场景事实位于 `apps/desktop/.tmp-test/windows-job-ddtJjU/` 的 manifest.json、build.log、build-exit.txt 和 results.json，五场景均通过。历史三场景与哈希不覆盖此次增量；最新源码、监督二进制和 verifier 哈希以本目录 manifest 为准。

提供方创建两条独立匿名管道：父端读取句柄清除继承标志，子端写句柄与 NUL 输入通过 HANDLE_LIST 显式传递；Job 句柄不在继承白名单。CreateProcess 仍原子绑定 Job 并挂起。创建成功即关闭父进程持有的子端写句柄，否则父端自身会阻止 EOF。提供方只暴露原始字节流；输出限制与业务持久化由仓颉调用方决定。

探针在 Resume 前启动两条并发排空线程，每条仅保留前 1,024 字节，继续读取全部余量，并分别记录总字节数、截断与 EOF：

1. 恢复前停止：没有执行夹具，退出 143、Job active=0，两条管道结束。
2. 正常停止：根与分离子进程均被回收，退出 143、active=0，两条 EOF。
3. 监督进程异常终止：自建根与分离后代均被 Job 清理；没有伪造正常业务结算。
4. 大输出自然退出：stdout、stderr 各 300,004 字节，分别保留 1,024 字节、truncated=true、eof=true；保留真实非零退出码 23，active=0。
5. 后代持有管道：根退出码 17、active=1，两个排空线程均未结束；显式停止 Job 后后代消失、active=0、双 EOF。最终根退出码仍为 17，停止后代不能覆盖已有根退出事实。

此轮只证明机械监督与输出行为。HANDLE_LIST 对额外可继承句柄的负向探针尚待补齐；原生提供方尚未由 ExecutionSupervisor 消费，真实隔离、Host 中断恢复和桌面验收仍未完成，providerReady 保持 false。

## 有限监督协议与仓颉消费端

新增 `core/native/windows_job_broker.cs`。版本 1 的首帧仅接受 executionId/executable/argv/cwd/timeoutMs/outputLimit，后续仅接受同 executionId 的 resume/stop；拒绝未知字段、错误身份、非法限额、重复恢复。创建后返回 suspended（PID、创建 FILETIME、Job 成员数），显式恢复后返回 resumed。双流每块最多 512 原始字节、base64 传输，各自连续序号，达到限额仍排空；output-end 分开报告保留量、总量、EOF、截断。只有观察根退出、Job active=0、双 EOF 才发送 result；调用方断连或协议错误清理自建树并非零退出，不能生成成功结果。根退出但后代持有管道继续监督到超时，停止 Job 后保留已有根退出码。

`node apps/desktop/test-support/windows-job-broker-verify.mjs`：8 场景全绿，rc=0，目录 `apps/desktop/.tmp-test/windows-broker-bEuha2/`（manifest/build/results）。覆盖大双流、挂起态停止、运行中停止、后代持有管道超时、错误身份、调用方 EOF、未知字段、零输出限额。构建用 `/r:System.Web.Extensions.dll`；这个 Windows 系统程序集与 .NET Framework 的正式安装可用性仍需打包验收。

新增 `core/src/windows_job_executor.cj`：有限协议消费端，按执行身份、帧版本、输出序号/限额与终态事实验证；保留原始字节，不把截断的 UTF-8 尾片冒充完整字符串。收到 suspended 后先调用 onSuspended；调用方在该回调内完成持久启动事实写入。回调成功并复核取消后才发送 resume；失败终止自持 broker，取消发送 stop。回执异常、观察超时或非零 broker 退出抛错，不合成退出事实，不按 PID 接管。

独立仓颉编译 `cjc -O0 core/src/windows_job_executor.cj core/test-support/windows-job-adapter-probe.cj --import-path <stdx目录> -L <stdx目录> --library stdx.encoding.json --library stdx.encoding.base64 -o <私有目录>/probe.exe` rc=0。最终原件 `target/windows-adapter-ffdb4bfa5a6f46f4a8536457b126f864/`：build-v9.log/exit、manifest.json、positive-v9 / checkpoint-failure-v9 / cancel-before-resume-v9 的日志与退出文件，各 rc=0。DLL 从此前固定 Host 私有打包目录复制到探针同目录；运行 PATH 仅 System32。正向真实输出/退出通过，持久化回调失败与回调期间取消均未创建目标夹具的 ran 文件。早期命令选项、错误 Node 路径和编译失败日志保留，均不计通过；失败回调曾触发 Future 诊断噪声，最终消费端捕获并回传明确失败，不遗留错误线程。

本轮查询无存活 sacode-job-broker.exe；没有暂存或提交。适配器还没有注入共享 ExecutionSupervisor，尚未把原始输出写入业务日志，未证明真实沙箱和完整 Host/CLI/桌面产品执行链。providerReady 仍关闭。

## 共享监督与持久事实接线实测

本次扩展 ExecutionSupervisor 的可选 windowsExecutor 参数，None 保留旧执行器路径；默认 ready=false 不变，Host/CLI 公共入口不自动选择此提供方。Windows 分支消费同一 beginStart 许可和 TurnToken，onSuspended 调 startedSupervised 完成持久身份后才恢复；原始输出逐块写 execution/output，分别记录双 EOF/截断，再 finish。异常取消令牌并按观察是否已落库报告 startFailed/supervisionLost；被冻结服务不能补写 unknown，保持持久失败。恢复不按 PID 接管。

固定私有源码副本 `target/closure-b1a9811e86224a90a7fdc1ae2904db71`（HEAD ccf3bff）仅更新 windows_job_executor.cj 与 execution_supervisor.cj，私有 Host `cjpm build` rc=0，原件 windows-supervisor-build-v2.log/exit.txt。保留首次错误的 cjpm --path 调用日志，不计成功。该副本仍使用此前登记的 -O1 配置，不能替代默认优化配置、CLI 或全量核心验收；原 host-packed/bin 仍是此前已冻结的旧二进制，本次探针仅复用其中 DLL，不把旧 Host 当新产物。

可复跑命令：`node apps/desktop/test-support/windows-supervisor-verify.mjs <私有Host target/release/core> <已验broker.exe> <已验DLL目录>`。最终目录 `apps/desktop/.tmp-test/windows-supervisor-iIZqRx`，完整外层日志 `target/windows-supervisor-verify.log`、退出原件 `.exit.txt`（rc=0）；manifest 绑定 core 静态库、broker、探针、当前监督源码及编译命令，results.json 五场景均通过。运行 PATH 仅 System32，DLL 在探针同目录；所有场景使用实际 WriteLease、精确工单、ExecutionService 和 durableCheckpoint，没有用 true 回调替代落盘。

1. output：真实根退出 23、双 EOF/整树结束后 exited；每路原始保留 1,025 字节和截断标记落入日志，旧 ShellResult 文本只显示 1,024 个完整 UTF-8 字节；同一准入不可重放，重新加载日志能读取 exited。
2. gate：即使注入 WindowsJobExecutor，默认门禁仍拒绝且保持 admitted，不启动夹具。
3. missing：不存在的可执行程序未启动，状态 unknown，不合成退出码。
4. startup-fail：身份事件检查点故意失败，服务冻结；夹具 ran 文件未产生，不因已有进程句柄恢复执行。失败目录的租约保留，不能作为正常释放成功。
5. stop：身份为 windows-job 的 PID/FILETIME；等夹具 ran 文件证明已实际恢复后再停止，整树及 EOF 确认后 exited，cancelObserved 成立、processSucceeded=false；准入不可重复，退出事实能从盘上重放。

这是共享核心真实监督/持久输出证据，仍未开放 Host/CLI 执行，未完成真正 OS 沙箱、Host 异常中断恢复、完整桌面或安装态。普通输出回放尚非实时订阅/交互 PTY。下一步以真实隔离探针作为准入前提，再完成公共双入口接线与恢复取证。
