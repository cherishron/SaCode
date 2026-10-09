# Windows 桌面运行时复验：页面仍未进入

固定 HEAD ccf3bff7609d6761d14f7b712676791342e15137。取证快照 `target/desktop-execution-620ede660e124e63903ec6f92f000179/apps/desktop` 复制本轮 main/preload/bridge、正式 renderer 及 execution-page-smoke；真实 Host 使用刚重建的私有 -O1 main.exe，其同目录复制已验 DLL，没有使用共享旧 Host。没有改产品入口或依赖版本。

初次直接 PowerShell 调 GUI exe 未等待实际退出，退出文件为空，不算 rc=0；该轮既无页面检查也无有效结果。随后改用 Node spawnSync 明确等待并记录真实退出：electron-v2-result.json 的 status=2147483651，即 0x80000003；electron-v2.log 为空、proof/checks.json 不存在。未进入 Vue 页面，不是空测试通过。

仅 --disable-gpu 的诊断（不关闭 sandbox）仍为 2147483651，electron-software-gpu-result.json/log 保留。因此这个单项 GPU 关闭探针没有解锁，不足以排除所有图形/运行时问题。

同一 Electron.exe 的 ELECTRON_RUN_AS_NODE=1 只读版本控制 rc=0，electron-node-control.json 返回 Electron 33.4.11 / Node 20.18.3 / Chrome 130.0.6723.191。这只能证明二进制的 Node 模式能启动，不代表桌面、IPC、渲染或 Host 请求已经验收。没有设置 --no-sandbox，也未运行真实模型或执行命令。

当前仍需诊断 GUI 初始化，并在可进入页面的运行环境取得真实 Host 的审批/输出/停止和亮暗截图；之后才是完整窗口的会话切换、断连及关闭标签。源快照保留供复跑，历史控制器和核心通过不能替代此项。查询本轮取证路径没有存活 Electron。真实隔离的独立阻塞见 windows-appcontainer-admission-2026-10-08.md。

快照 manifest.json 绑定 112 个桌面文件、Electron 二进制和新 Host；Host SHA256 为 0693abeb6cd5b31a5e67a752808d45b3cc640cd2efa924f5360388888cafc394。复跑必须使用该快照，不拿随后发生变化的 renderer 代替本轮失败现场。

## 最小 Electron 引导对照

普通 Shell 启动对照：`target/electron-shell-874e6351b9f64d06a7d1966ad2a3b37c/result.json` 使用 [ShellExecuteEx 的进程句柄与完成观测约定](https://learn.microsoft.com/en-us/windows/win32/api/shellapi/ns-shellapi-shellexecuteinfow)，open 动作、SW_HIDE、不提权、不关闭 sandbox、不改 ACL。Shell 接受启动，得到本夹具 PID 25156 的真实进程句柄，观察终态 2147483651；main/ready trace 仍不存在，句柄已关闭且未强制清理。该次是桌面失败控制，不以 Python 包装器退出 0 当作 Electron 成功，也未用其他会话的窗口替代。单纯改用 Shell 启动未解除此阻塞。

私有目录 `target/electron-bootstrap-dd81e43683c94ca4ad1c51e0db3060ae`。相同 Electron.exe，两个独立应用：ready-only 只等待 app.ready 后退出；window 创建 sandbox=true、contextIsolation=true、nodeIntegration=false 的隐藏窗口。两者均返回 2147483651（0x80000003），main.cjs 首行写出的 trace.log 均不存在；没有加载产品 main、Vue 页面、Host 或模型。开启 --enable-logging=file / --v=1 也没有生成 chromium.log。

结果证明本次最小应用同样无法进入 main，不支持把现象归因到 SaCode 页面或 Host 请求。尚未确定运行时初始化失败的根因；该引导失败不能按两个通过场景计数，没有关闭 sandbox。results.json 记录 Electron.exe 哈希及两个真实退出；外层 probe.cjs 退出 0 仅表示收集结束，不代表 GUI 验收通过。

## 原生故障定位与窗口站调用实测

本轮复核 HEAD 为 `cec503bbeddc7afbcecb185f70f4c0f1297df13a`，分支仍 `refactor/dsh-learning`；相对上一轮 `ccf3bff` 的两笔提交为 Browser Use 规格文档。暂存区为空，未提交及未跟踪文件不认领。完整当前文件哈希、W00 责任表哈希及已验收源码比较保存于 `target/electron-debug-670b17374c9c4e9cb5b93720b87546e1/current-manifest.json`。此处不将 HEAD 的文档变动等同于新产物已验收。

完整性控制 `target/electron-integrity-41467c42f0354279a078c1fb8405a98a/integrity.json`：本机缓存 Electron 33.4.11 zip 与当前 dist 的 73 个文件哈希一致，未独立核实缓存 zip 的官方校验和。版本控制 `target/electron-runtime-control-5ca55b0d291749cc9128c888146f09c0` 私有解包 33.4.11 和 44.0.0，最小应用均退出 2147483651，未进入 main；这不是升级依赖的兼容性验收，两套探针均未关闭 sandbox。

原生诊断目录 `target/electron-debug-670b17374c9c4e9cb5b93720b87546e1`：PE CodeView 指向 GUID `62B1119A08EFD1994C4C44205044422E`、age 1 的 electron.exe.pdb。经官方符号服务按需读取字节区间并校验 PDB GUID/age，`symbolized.json` 定位故障 RVA `0x1d63c58` 到 `sandbox::policy::Sandbox::Initialize` +120；没有下载整个 3.4GB PDB，也没有引入产品运行依赖。`events-registers.json` 和再次运行的 `events-teb.json` 在第二次机会异常读到 RAX=12；异常最终退出 2147483651，main trace 不存在。

对照 Electron 对应的 [Chromium 130 sandbox 初始化实现](https://raw.githubusercontent.com/chromium/chromium/130.0.6723.191/sandbox/policy/sandbox.cc)及[错误枚举](https://raw.githubusercontent.com/chromium/chromium/130.0.6723.191/sandbox/win/src/sandbox_types.h)，此值为 `SBOX_ERROR_CANNOT_CREATE_WINSTATION`，初始化在创建备用窗口站失败后进入 CHECK。此判断同时使用匹配符号、异常现场寄存器及机器指令分支，不仅凭进程退出码推断。

进一步使用仅观察的硬件执行断点，在自建最小 Electron 的 `CreateWindowStationW` 入口及调用返回处取证，不改进程代码或 API 返回值。`api-calls.json` / `api-calls-descriptor.json` 两次实测均为：匿名窗口站（name=null），首次权限 `0x80000008`、降级重试权限 `0xa`，两次返回句柄 0，调用返回处线程 TEB LastError 均为 5（拒绝访问）。最终正常传播原异常退出，未当作通过场景。调用次序与 [Chromium CreateAltWindowStation](https://raw.githubusercontent.com/chromium/chromium/130.0.6723.191/sandbox/win/src/window.cc)一致。

独立 `winstation-probe.py` 从当前窗口站只读复制 DACL，创建并关闭匿名窗口站：上述两种权限均成功且 CloseWindowStation 成功。具名私有窗口站控制返回 5，但 [Windows 文档](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-createwindowstationw)限制具名创建为管理员，因此该控制不是故障证据。没有修改现有窗口站 DACL、切换窗口站或泄漏自建句柄。

`descriptor-comparison.json` 与 `api-calls-descriptor.json` 显示独立探针的窗口站 DACL 和 Electron 实际传入 DACL 的 SHA256 同为 `74baf9875d5ff6c248125ca763e2510312dcbdde5852e6b11b13477750171392`。Electron 调用线程 OpenThreadToken 返回 1008（无线程令牌）。父子进程取到的有限令牌字段相同：IsTokenRestricted=false、TokenHasRestrictions=1、AppContainer=0、ElevationType=3、Elevated=0、restricted SID count=0、privileges count=5、groups count=14；这些字段相同不代表完整令牌或 Job 策略相同。`token-access.json` 的父进程令牌访问探针均成功，撤回此前缺少令牌访问权限的猜测，不以此排除执行环境限制。

本轮结论：已将桌面启动阻塞缩小为 Electron 在实际调用位置创建匿名备用窗口站时被 Windows 拒绝；独立成功控制阻止把原因概括为本机普遍不能创建窗口站。尚未证明拒绝来自何种令牌、Job 或系统策略，不能擅自修改系统权限或关闭安全机制。解锁条件为在保持 sandbox 的运行环境中使最小应用进入 main/ready，再对稳定桌面快照执行真实 Host 请求、审批、停止、切换和断连验收。执行 AppContainer 准入的另一阻塞仍独立登记，不因本轮诊断而开放 providerReady。

后续限定控制：`api-calls-live-token.json` / `live-token-comparison.json` 在 API 调用时再次查询子进程令牌，所采认证会话标识与权限 LUID/attributes 均与父进程相同；不把有限字段比较扩大为完整策略等价。`probe-explicit-desktop.py` 仅显式传递当前 WinSta0\\Default，不改权限或关闭 sandbox；`events-explicit-desktop.json` 仍记录 RAX=12、退出 2147483651、main trace 不存在，因此“默认继承桌面名称”不能作为本轮解锁方案。所有自建调试子进程均已终态。
