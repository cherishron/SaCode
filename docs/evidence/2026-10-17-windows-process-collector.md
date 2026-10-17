# Windows 进程共享结果转换（2026-10-17）

## 实现与边界

包内 `collectWindowsProcess` 消费同一 AppContainer/Job 句柄，返回已有 ShellResult，不创建另一套队列或授权。创建事实回执先于恢复线程；失败即停止挂起进程并传播原异常。恢复沿用 TurnToken；超时停止整个 Job，根退出后仍检查后代，双流继续排空并分别记录截断。调用方始终保留句柄，关闭仍受在途读取与存活树约束，无法确认时不伪报完整。

尚未接入公共 ShellExecutor/ExecutionSupervisor；工作区 ACL、网络与逃逸反向验证、输出实时持久化、默认载荷加载和安装态均待做。D14 保持未解除，产品门禁未开放。本次没有提交、推送、安装或更改用户配置。

## 验证

- 修复后的本机仓颉 1.1.3，生产 core 私有增量构建 rc=0，24 条既有 warning。`cjfmt -f core/src/windows_process_adapter.cj` 后再次构建与运行。
- 定向真实 DLL 集成最后 Summary：TOTAL 9 / PASSED 9 / SKIPPED 0 / ERROR 0 / FAILED 0，进程退出 0。不是全量 cjpm test。
- 原五条保留；新增四条：创建/启动回调顺序与限额后排空；启动前取消不调用 started；真实超时停止及 EOF；创建回执失败不恢复线程。
- 首轮新增测试因回调捕获可变局部量编译失败，改 AtomicBool 后通过；未降低断言。之后补根退出/后代存活短等待，再格式化重编及复验，最终结果如下。

命令（仓库根；仅测试脚本设置进程环境）：

```powershell
& scripts/verify-windows-process-adapter.ps1 -CoreRelease 'D:\Project\sa\saai\sa-code\target\tmp\appcontainer-core-rebuild-20261017-6b281f0a\build\release' -DestinationRoot 'D:\Temp\SaCode-Windows-Adapter-Verification'
```

原始最终运行：`target/tmp/windows-adapter-20261017-15b977d71f584830902b15b4b28d6490/` 的 compile.log、compile.exit、run.out、run.err、run.exit、run.clean.log、verification.json；生产构建 `target/tmp/windows-adapter-20261017-1f3b/collector-build-final.log`。Medium 字节导出只复用既有 export-windows-artifact，不修改 ACL。

```json
{
  "version": 1,
  "passed": true,
  "timedOut": false,
  "exitCode": 0,
  "expectedTests": 9,
  "neutral": "D:\\Temp\\SaCode-Windows-Adapter-Verification\\windows-adapter-20261017-15b977d71f584830902b15b4b28d6490",
  "coreLibrarySha256": "A0D167F8C6B12D1684F0D01FE27A021E830BCE262F412C4DD7B6B9839E7C4FDF",
  "adapterSourceSha256": "828923D1023254E1AF4FD232BC10ED34BB1939C823A932C8DDC74AC200B074B5",
  "testSourceSha256": "A11EDA5BCDD21A1B5A207B1F9F8808492F984D8D2428BB01BD85E9B35EDB7606",
  "nativeDllSha256": "529291953ED81F0EF2A8A00CA36D8A72DBFF91AA7E8633C991C2C680FDC7BBCE",
  "runtimeSha256": "8B1D0783E10EC18191AF900AC3DA632006037D0A61E0518C4AB005C3F5F8C9C2"
}
```

源码 HEAD 观察值 `21e35299fd0a115c6b94000aa0da9e737e9dcd0a`，含并发未提交改动，不是该提交独立构建。仅以以上输入指纹绑定本轮验收。

## 未通过的独立门禁

产物位置守卫 rc=1，13 checks/fail=5。core/core 与四个 apps 模块的 target 仍在；CLI/daemon 同时出现他方 build-script-cache，三个 build.cj 未登记允许集。未删除、移动或代改他方文件。完整原文 `target/tmp/windows-adapter-20261017-1f3b/collector-artifact-guard.log`。本批指定文件 git diff --check 通过。
