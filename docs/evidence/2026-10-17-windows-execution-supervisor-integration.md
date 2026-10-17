# Windows 原生进程接入共享执行监督层（2026-10-17）

## 本轮结果

新增 ExecutionProcessProvider/ExecutionProcessRequest，ExecutionSupervisor 在同一个 ExecutionService.beginStart 持久屏障之后调用提供方；默认继续使用既有 ShellExecutor，providerReady 默认关闭。包内 WindowsExecutionProcessProvider 每个提案装配一次，只接受预先绑定的可执行路径/工作目录，不创建第二套任务、审批或日志。真实测试使用私有日志、一次性工单、只读 System32 下的 cmd 内建命令，没有修改用户工作区或模型请求。

Windows 提供方创建挂起 AppContainer/Job 后交给共享结果转换，保留创建/恢复回执、取消和双流事实。未确认清理的句柄仍由提供方持有，不能卸载 DLL 或删除 profile。共享监督层新增提供方抛错后的未知结算；已创建但未恢复不伪造 running 或尚未创建事实。根进程退出但后代终止未确认时 exitObserved=false，使共享服务保留 unknown。

## 实测

最终生产 core 构建 rc=0（24 条既有 warning）；三个改动生产文件均 cjfmt。实际 DLL 定向集成最终 TOTAL 13 / PASSED 13 / SKIPPED 0 / ERROR 0 / FAILED 0，进程退出 0。

原九条保留，新增四条：

1. 真实提案→精确一次性审批→持久启动屏障→AppContainer 执行→双流→退出码 7→同日志持久回放，重复启动及回放终态重启拒绝。
2. 真实异步任务达到 running 后由 ExecutionService.stop 取消；整树退出、双流 EOF、processSucceeded=false。
3. 参数编码保留空参数、空格、引号与结尾反斜杠，拒绝 NUL。
4. 提供方抛错产生 unknown/provider-start-failed；默认门禁拒绝时 admitted 不被消费（该条为合成故障注入）。

命令与最终日志：

```powershell
& scripts/verify-windows-process-adapter.ps1 -CoreRelease 'D:\Project\sa\saai\sa-code\target\tmp\appcontainer-core-rebuild-20261017-6b281f0a\build\release' -DestinationRoot 'D:\Temp\SaCode-Windows-Adapter-Verification'
```

运行目录 `target/tmp/windows-adapter-20261017-dc8f09ee42934702b442bf2ea2465972/`：compile.log/compile.exit、run.out/run.err/run.exit、run.clean.log、verification.json。生产构建 `target/tmp/windows-adapter-20261017-1f3b/supervisor-build-final.log`；最终汇总 supervisor-verify-final.log。输入指纹：

```json
{
  "version": 1,
  "passed": true,
  "timedOut": false,
  "exitCode": 0,
  "expectedTests": 13,
  "neutral": "D:\\Temp\\SaCode-Windows-Adapter-Verification\\windows-adapter-20261017-dc8f09ee42934702b442bf2ea2465972",
  "coreLibrarySha256": "3EBA2F6C6B2FAF08E59AAAE4FB6D09DE7A15CFFCB278DB8CA7934371E9D43BFD",
  "adapterSourceSha256": "9A42BBB25EA6CF863C403985ED9F4107975172F71F21226A4A755E604909D02F",
  "processProviderSourceSha256": "D108BF90B9C3490E6EB2429DE834B4699D95B5AE87A180B8CEABC160C419DDEB",
  "supervisorSourceSha256": "C28957629867E04B54158F54ED9EE5703996E9E19EA45F51EB4F56FBACC93EFF",
  "testSourceSha256": "A08956D27BF406F62B4C68C90FCC109FD3D24BDB9BFF1A4465D04D5D234AE0C2",
  "nativeDllSha256": "529291953ED81F0EF2A8A00CA36D8A72DBFF91AA7E8633C991C2C680FDC7BBCE",
  "runtimeSha256": "8B1D0783E10EC18191AF900AC3DA632006037D0A61E0518C4AB005C3F5F8C9C2"
}
```

源码 HEAD 观察值 21e35299fd0a115c6b94000aa0da9e737e9dcd0a，含并发未提交改动，不能当独立提交验收。本轮结束时未见 cjpm/cjc/adapter-test 进程。

## 保留的失败与修正

首轮 11 PASS/1 ERROR/1 FAILED：cmd 被错误套用 CRT 逐参数编码，脚本实际退出 1；回放夹具漏 load。第二轮 12 PASS/1 ERROR：分页夹具传 50，真实契约最大为 16。修正传输并按现有契约显式 load、cursor=-1/limit=16 后通过，没有放宽断言。[Microsoft cmd 契约](https://learn.microsoft.com/en-us/windows-server/administration/windows-commands/cmd)明确 /s /c 删除正文外侧引号，故 cmd 单独限定 /d /s /c 四参数形态，其他程序仍使用逐参数编码。

## 未完成

这证明显式装配的共享核心任务链，不是产品默认执行闭环。Host/CLI 尚未装配 Windows 提供方；私有工作区 ACL、工具依赖可读范围、网络/逃逸反向验证、启动中停止竞态、监督丢失恢复、实时输出持久化与打包安装仍需完成。D14 仍未解除，未改平台就绪门禁。

产物位置守卫仍 rc=1 / 13 checks / fail=5，原文 supervisor-artifact-guard.log；未删除或移动已有冲突目录。指定代码文件 git diff --check 通过。未提交、推送、安装、重置配置或调整 ACL。
