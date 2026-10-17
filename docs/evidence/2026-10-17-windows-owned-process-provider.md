# Windows AppContainer 所有权进程薄层（2026-10-17）

## 本轮结果

新增 `core/native/windows_process.h`、`windows_process.c`，仅封装 Windows OS 机制；共享核心仍负责提案、审批、取消令牌、持久化和结算。本轮未修改公共执行器或开放门禁。

`scripts/build-windows-process.mjs --verify` 在本机 clang 22.1.0 / Windows x64 MSVC ABI 下以 `-Wall -Wextra -Werror` 构建 DLL 和实际验证程序，使用静态 C 运行库选项。实际终态：`SACODE_NATIVE_PROCESS_SUMMARY checks=35 failed=0 cleanup=confirmed`，退出码 0；没有跳过或空测试集。

## 实现与内部 ABI v1

唯一声明源为 `core/native/windows_process.h`，8 个有限 C 入口：version、create、resume、read、wait、active、stop、close。它们没有 Host/IPC/模型入口。

- create 只接受绝对程序/目录与显式环境块，不使用 PATH 搜索、不继承整份环境；调用者仍须校验程序身份、授权及环境内容。
- 用明确的三句柄继承名单提供 stdin EOF 和独立 stdout/stderr，Job 与父侧读句柄不继承。
- 固定挂起创建、核对 TokenIsAppContainer 和 SID，在恢复主线程前绑定带 kill-on-close 的 Job；没有普通进程回退。
- resume 与 stop 由同一个原生锁串行化；停止后的挂起进程不能恢复；重复恢复拒绝。
- read 在同一 C 调用帧捕获 Win32 错误，明确区分 broken-pipe EOF 与读失败；不依赖跨仓颉 FFI 的线程局部错误值。
- wait 返回真实根进程退出；active 查询同一 Job 的在途进程，stop 终止该 Job 的后代。
- close 对仍存活的进程树返回 busy，不悄悄释放所有权。调用者必须先收束并 join 读取任务。create 失败且终止无法确认时返回 cleanup-only 句柄，不能恢复，只能继续停止/核对/清理。

没有实现工作区 ACL、网络权限、命令审批或日志状态机；这些不是薄层的业务职责。

## 实际用例

`scripts/verify-windows-process.c` 实际核对：ABI 版本、必需环境、独有 profile、拒绝隐式环境/相对程序路径/非法管道通道；AppContainer 身份与 Job 创建；挂起期间无执行；活动树禁止 close；恢复一次/二次拒绝；退出码、双流小块读取及 EOF；恢复前停止、拒绝再次恢复且无输出；根进程退出但后代仍在 Job，停止后整树收束与管道 EOF；程序不存在时资源释放；profile 删除。

后代夹具仅运行固定系统 cmd 的本地循环，被当前 Job 停止；未读写用户工作区、未发网络请求或恢复历史任务。所有检查均为真实 Windows API，不是 test double。尚未跑同时竞争的取消/恢复、读者并发关闭或父进程崩溃恢复；不能扩张本轮结论。

## 命令、载荷与原件

```powershell
$env:SACODE_NATIVE_VERIFY_DIR='D:\Temp\SaCode-Native-Process'
node scripts/build-windows-process.mjs --verify
```

脚本要求显式中性验证根，复用 `export-windows-artifact.mjs` 按字节导出并对账；不改 ACL、完整性标签或用户配置。默认只构建组件到 `.deps/native/win32-x64/`；未接入通用 build-native、pack-host 或 CLI 打包，不据此声明安装态可用。

最终原件：`target/tmp/windows-process-verify-20261017-lfYzet/` 的 `build-manifest.json`、`stdout.log`、`stderr.log`、`exit.txt`、`verification.json`；中性载荷 `D:/Temp/SaCode-Native-Process/windows-process-verify-20261017-lfYzet/`，相邻导出清单记录内容一致及目标 implicit-medium。较早的同用途验证目录保留。

- HEAD：`7a249a1c2ca03f5d4ad7a7c5e82eb81d60a00238` + 未提交实现。
- C 源码 SHA256：`0394ad38fd36ef2a2efc1eac5e1d5ccfb5d055a20b6f0f90b30141819cdc6a5c`。
- 头文件 SHA256：`23fcbcf4e8a129e4f4a6975cbb3f9efbbc884220bca855eddb4c071ff0904c70`。
- DLL SHA256：`529291953ed81f0ef2a8a00ca36d8a72dbff91aa7e8633c991c2c680fdc7bbce`。
- 验证 EXE SHA256：`53cfe9ce0e41a16b45e48cf5c32ec6fd820a0aa47c96ce8feaac4e2b62bdaa71`。

最终产物守卫为 `GATE: FAIL (13 checks, fail=5)`，原件在上述最终证据目录的 `artifact-gate.log/artifact-gate.exit`：`core/core/` 及 apps/cli、daemon、host、desktop 各自的 target 目录。当前新增源文件和运行输出均在规范目录；其他模块目录归属未核，未迁移或删除。未发现本轮验证进程或循环后代残留，未提交或推送。

## 后续门槛

仓颉适配器必须使用同一受监督句柄并接入现有启动取消屏障、双流限额后排空与结算；补实际并发/父退出用例。之后完成私有 ACL 与撤销、文件/网络/逃逸反向测试，再装配产品并同步构建/载荷/安装验收。现有 `platformExecutionReady` 未更改，仍拒绝 Windows 产品执行。
