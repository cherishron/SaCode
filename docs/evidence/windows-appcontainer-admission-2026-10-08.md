# Windows AppContainer 准入探针：未通过

HEAD `ccf3bff7609d6761d14f7b712676791342e15137`，本批文件未提交，路径责任已登记 W00。这里只进行私有夹具隔离探针；没有修改真实工作区 ACL、安装目录、机器网络例外或 Host/CLI 执行门禁。

## 实现范围

windows_job.cs 增加可选 SECURITY_CAPABILITIES 属性，保持创建时 Job 绑定、挂起、继承句柄白名单。只有传入该属性时才要求 OpenProcessToken/GetTokenInformation 确认 TokenIsAppContainer=1；失败清理自建挂起进程，不能以普通进程回退。默认无属性的监督路径保持不变。

windows_appcontainer.cs 定义零网络 capabilities 的临时 SID 与限于显式私有夹具目录的权限授予/撤销；拒绝区外路径和重解析点，遍历不跟随重解析目录。默认 CreateAppContainerProfile，显式 --ephemeral 探针改用 DeriveAppContainerSidFromAppContainerName，不在失败后自动降级。它尚未作为产品沙箱消费。

验收设计覆盖 read-only、workspace-write 的工作区读取/写入、区外私有文件拒绝、真实子进程继承限制及本机 TCP 拒绝。网络必须是权限错误且监听端没有连接，不能把超时/端口错误冒充隔离成功。

## 本轮真实结果

`node apps/desktop/test-support/windows-sandbox-verify.mjs` rc=1，目录 `apps/desktop/.tmp-test/windows-sandbox-TSA708`。C# 编译 rc=0；CreateAppContainerProfile 返回 UnauthorizedAccessException，点名用户注册表 AppContainer/Mappings。未启动目标程序，未进入 ACL 授予。

`node apps/desktop/test-support/windows-sandbox-verify.mjs --ephemeral` 最终 rc=1，目录 `apps/desktop/.tmp-test/windows-sandbox-9sU2Cf`。C# 编译 rc=0，SID 派生及 ACL 授予已执行；随后 WindowsJob 构造的 executable-or-cwd-missing 检查失败，目标程序未启动；同一 .NET Framework 探针撤销 ACL 时 GetSecurityInfo 抛 UnauthorizedAccessException。不能据此断言文件不存在或 AppContainer 隔离成功，也未确认故障的环境根因。

最终 manifest.json 保存提供方、探针、verifier 与编译产物哈希；read-only/run.log/exit 保存主要失败及撤销失败，results.json 明确 passed=false。没有任何隔离场景通过，不用空结果或编译成功替代权限验收。

外部验收进程只撤销本轮明确目录中的新增 AppContainer SID ACE，最终 cleanup.log 为 tool/read-only 的 ACL_CLEANED，cleanup-exit.txt=0。早期 KE1emT、mIalS8、vzUEnK、xonxR0 四个私有目录中的新增 SID 也已逐目录撤销并确认无残留显式 ACE；没有覆盖父目录权限。查询无存活 sandbox-probe.exe。

## 回归及解锁条件

修改可选进程属性后，原 Windows Job 五场景回归 rc=0，证据 `apps/desktop/.tmp-test/windows-job-II6kWk`，外层 `target/windows-job-appcontainer-regression.log` 与退出文件。这仅证明无 AppContainer 属性的已有路径未回归。

当前状态：真实 OS 隔离待解锁，产品 providerReady 保持 false。需要先定位同一探针在新增 SID 后的目录/ACL可访问性，或在具备配置权限的环境完成相同真实探针；随后两种策略、区外读写、子进程和网络全部取到机械拒绝证据，才允许公共入口使用该后端。不能改原有机器权限或把普通 Job 当沙箱绕过此门禁。其余产品目标（桌面、恢复、最终产物）继续独立推进，本条不代表整体目标无路可走。

接口依据：[Microsoft Launch an AppContainer](https://learn.microsoft.com/en-us/windows/win32/secauthz/implementing-an-appcontainer)、[DeriveAppContainerSidFromAppContainerName](https://learn.microsoft.com/en-us/windows/win32/api/userenv/nf-userenv-deriveappcontainersidfromappcontainername)、[AppContainer isolation](https://learn.microsoft.com/en-us/windows/win32/secauthz/appcontainer-isolation)。文档支持接口设计，不证明本机探针通过。

## 后续诊断：明确错误码，仍未通过

最终 ACL 诊断目录 `apps/desktop/.tmp-test/windows-sandbox-maGKpj`，rc=1；before 的 GetFileAttributesW 成功（file=32/error=0），工具目录授予 ACL 后 file=0xffffffff/error=5。调用方用户 SID 相同、ImpersonationLevel=None、IsTokenRestricted=False；因此没有依据把问题归为调用方换身份或 restricted token。同一进程撤销时 GetSecurityInfo 仍拒绝，外部私有范围清理 rc=0。

新 token-only 诊断不授予目录 ACL，仅尝试系统目录 cmd.exe 的挂起创建，使用 SECURITY_CAPABILITIES 与原 Job/继承句柄属性。`node apps/desktop/test-support/windows-sandbox-verify.mjs --ephemeral --token-only` 最终 rc=1，目录 `apps/desktop/.tmp-test/windows-sandbox-7QMCzh`；CreateProcessW 明确返回 create-bound-process:win32=5，未恢复执行。WindowsJob.Require 现在保留 NativeErrorCode，而不是只打印通用 .NET HRESULT。

这证明启动失败不只发生在目录授权步骤，仍不足以定位是临时 SID、属性组合还是本机策略。不能宣布 Windows 不支持 AppContainer，也不能据 node/control 的成功升级隔离支持；没有关闭 OS 限制或给普通进程降级放行。两轮 cleanup-exit=0，无产品入口修改。

保留 Win32 错误码的最后源码重新运行已有机械回归：Job 5 场景 rc=0（windows-job-bnMNZr），broker 8 场景 rc=0（windows-broker-TVgZry），各目录 manifest/results 为原件。只证明非隔离分支未回归，不替代 AppContainer 验收。

## 最小安全属性对照：未通过

私有目录 `target/appcontainer-create-96ddcdd1ac6d4227b19e6e71e5186724`。同一 cmd.exe、同一调用方、始终 CREATE_SUSPENDED，不使用自定义 Job、不设置继承管道、不授予目录 ACL。control.log：created=true / win32=0 / isAppContainer=0 / resumed=false，control.exit=0；appcontainer.log：created=false / win32=5 / isAppContainer=-1 / resumed=false，appcontainer.exit=1。自建挂起进程通过自持句柄终止，没有恢复执行。

这把失败定位到加入 SECURITY_CAPABILITIES 的创建阶段，排除了本探针中自定义 Job、管道和目录授权作为必要触发条件；仍不能分辨临时 SID 与本机策略，也不能断言 AppContainer 平台不支持。探针外层命令退出 0 不覆盖两个子场景的真实退出；隔离准入继续未通过，公共入口门禁不变。
# 最新复核：隔离提供方通过，产品装配仍待完成

2026-10-08 复核时 HEAD `511c422421a3e5429fc3e24acfb0145fef01c43b`；在途来源以每轮 manifest.json 的 SHA-256 为准，不把 HEAD 当作包含全部实现。以下取代此前“本机 AppContainer 无法创建”的当前状态，旧日志保留。

普通 Temp 目录内构建原生探针，避免仓库 Low 完整性标签传播到探针可执行文件。`node apps/desktop/test-support/windows-sandbox-verify.mjs` 实际退出 0，最终原件：`C:/Users/jingg/AppData/Local/Temp/SaCode-sandbox-verification/windows-sandbox-j2jGu1/`。包含 build.log/build-exit.txt、manifest.json、逐策略 run.log/run-exit.txt、results.json、cleanup.log/cleanup-exit.txt。

两种策略均通过：区内读取成功；read-only 区内写入 EPERM，workspace-write 区内写入成功；区外读取/写入 EPERM，区外 canary 未变且未生成新文件；真实子进程退出 0 并输出 DESCENDANT_DENIED:EPERM。创建后先读取 IsAppContainer，再恢复执行，未将普通 Job 当作隔离进程。

每种策略先由普通进程真实连接本轮监听端口，记录 controlConnected=true、controlConnections=1；隔离进程 ETIMEDOUT、服务端新连接数 0。Windows 网络隔离可能丢弃连接而非返回权限 errno，因此要求可达对照、严格期限及服务端零连接同时成立，不以无监听服务导致的超时代替隔离。未新增 loopback 豁免或网络 capability。

Node 探针的管道捕获型 spawnSync 卡在子进程调用，不是进程启动失败；继承 Job 管道后子进程返回。探针用 `-e` 执行固定夹具，避免 Node 主模块解析遍历区外祖先路径；这是测试夹具装载方式，不能宣称任意脚本入口在 AppContainer 内兼容。

私有变异副本 `C:/Users/jingg/AppData/Local/Temp/sacode-sandbox-mutant-2mufutz6/` 仅把 read-only 私有目录授权故意改为 Modify。变异轮真实退出 1，独占受害断言 insideWrite.allowed（true != false）命中，原件 `.../SaCode-sandbox-verification/windows-sandbox-M3UkDz/`。共享源码没有施加变异。正常源码再次完整通过（最终 j2jGu1）。全部夹具 ACL 清理实际退出 0，仅修改本轮私有目录，不修改真实工作区或父目录。

`--token-only` 最新实际退出 0，原件 `.../SaCode-sandbox-verification/windows-sandbox-TrfdA8/`。该探针只核验挂起进程 token 后终止，不恢复、不跑 cmd 字符串；不扩大为文件或网络验收。

仍未完成：产品 broker 尚未消费 sandbox policy；共享 ExecutionSupervisor 默认门禁仍关闭。公共提案需要明确并绑定工具可读目录、工作区作用域及可写策略，AppContainer 创建/授权失败必须拒绝启动，不允许回退到普通 Job。普通 Job 的监督测试与本探针两边分别通过，不能代替“同一个产品任务同时授权、隔离、持久化、取消和恢复”验收。
