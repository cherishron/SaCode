# 仓颉 Windows 所有权进程适配（2026-10-17）

## 结果与边界

`core/src/windows_process_adapter.cj` 已在本机修复后的仓颉 1.1.3 编译通过，并通过实际 C DLL 的五组集成：**TOTAL 5 / PASSED 5 / SKIPPED 0 / ERROR 0 / FAILED 0，退出码 0**。不是全量 cjpm test，也不是 Host/CLI 产品执行已开放。

源码中没有全局 DLL 加载或默认执行器装配。调用者必须提供绝对 DLL 路径，组件校验 ABI v1 并限定 DLL 目录/System32 依赖查找。尚未验证打包路径和载荷加载；不得把测试用环境变量作为产品 DLL 选择入口。

## 本轮实现

- `WindowsOwnedProfile` 持有本次唯一 profile/SID，使用引用计数阻止子进程句柄仍存活时删除 profile。
- `WindowsProcessLibrary` 持有 8 个有限原生函数，版本或符号不符时拒绝；进程存活时拒绝卸载 DLL。创建失败释放已取得的 profile/库引用；非空错误句柄仅供清理，禁止恢复。
- `WindowsNativeProcess` 管理同一原生对象；恢复线程经已有 `TurnToken.runStartIfNotCancelled` 启动屏障，取消先发生时停止挂起进程，不运行命令。
- `WindowsProcessPipe` 实现 `InputStream.read`，将原生错误/EOF 转换为已有 `readShellBounded` 可消费的输入；超限后继续排空。读取调用仍在途时 close 拒绝释放句柄。
- poll 单次最长 50ms，避免长时间占有进程锁而阻塞停止；退出、Job 活跃数、停止、关闭使用同一原生进程对象。

这些类型均为包内接口，没有模型、Host RPC 或 IPC 入口。没有绕过 ExecutionService；也尚未与其装配。

## 实际场景

测试源 `core/test-support/windows_process_adapter_test.cj`：

1. 真正创建挂起进程，profile/库提前关闭被拒；恢复后 stdout/stderr 正文与 EOF、真实退出码核对。
2. 已取消的 TurnToken 不恢复线程；退出码 143，无命令输出，两路 EOF。
3. 输出超过捕获上限仍持续排空，不因管道反压卡死；截断标志、正文长度和完整 EOF 核对。
4. 运行后由另一仓颉任务取消并停止，两个读取任务解阻、退出和 Job 收束可确认。
5. 不存在的程序返回失败，两种引用都释放，库与 profile 均能正常关闭。

固定系统 cmd 夹具，没有工作区文件授权、网络请求或真实用户任务。失败清理保持显式错误，不将未确认终止写为成功。仓颉语言/FFI/InputStream/Path 契约按 cangjie-coding 查询并经本机 1.1.3 编译，不使用 Windows 不支持的 exclusiveScope。

## 命令和原始证据

core 编译退出码 0、24 warnings，日志 `target/tmp/windows-adapter-20261017-1f3b/build.log`，使用私有 `appcontainer-core-rebuild-20261017-6b281f0a/build` 目标。

可复用验证入口（参数必须指向本轮 core 静态库）：

```powershell
scripts/verify-windows-process-adapter.ps1 `
  -CoreRelease 'D:\Project\sa\saai\sa-code\target\tmp\appcontainer-core-rebuild-20261017-6b281f0a\build\release' `
  -DestinationRoot 'D:\Temp\SaCode-Windows-Adapter-Verification'
```

脚本定向编译实际测试文件，复用已有字节导出流程，不改 ACL/完整性标签；只读取最后一个剥码 Summary，并要求五计数为 5/5/0/0/0 和真实退出码 0。未设置验证依赖时失败，不空跑。运行原件保留在 `target/tmp/windows-adapter-20261017-6dba2f95bca145d783e9607abbfd53c8/`：`compile.log/compile.exit`、`export.log`、`run.out/run.err/run.exit`、`run.clean.log`、`verification.json`。

验收记录时 HEAD 为 `21e35299fd0a115c6b94000aa0da9e737e9dcd0a`；共享工作区有并发未提交实现，且期间 HEAD 已变化，不把该提交当完整源码快照。实际链接库及相关源码由以下指纹绑定：

| 对象 | SHA256 |
|---|---|
| 实际 core 静态库 | `055D1057AAAA2FC46862276A9493923A51AD2EA0F0D6B0F063F9CAA701A8962F` |
| 适配源码 | `28BC13002271A4E49DF0E441749F4C972A985FF1FE35D9D4CBE602B18695FDF6` |
| 实际测试源码 | `B1D138D87835890CB38C9B6334B15D1BF97E5FB6F46CDE2E0B56FCB2A3F92330` |
| C DLL | `529291953ED81F0EF2A8A00CA36D8A72DBFF91AA7E8633C991C2C680FDC7BBCE` |
| 修正后的仓颉运行库 | `8B1D0783E10EC18191AF900AC3DA632006037D0A61E0518C4AB005C3F5F8C9C2` |

## 未完成

公共 ShellExecutor/ExecutionSupervisor 装配、持久启动/结算事实、profile 异常恢复、完整竞态、ACL 及撤销、网络/文件/逃逸反向验证、Host/CLI 打包与实际用户路径均待完成。默认 Windows 执行门禁未修改。原生组件证据见 [35 项实测](2026-10-17-windows-owned-process-provider.md)。
