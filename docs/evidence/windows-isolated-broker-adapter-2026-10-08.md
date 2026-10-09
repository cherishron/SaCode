# Windows 隔离 broker 与仓颉适配器实测

## 范围

在 refactor/dsh-learning 当前工作区增量上验证；不提交、不推送、不安装，不修改机器或真实工作区 ACL。核心业务仍由 ExecutionService/ExecutionSupervisor 管理。以下只证明原生 broker 和当前仓颉 WindowsJobExecutor 接缝，不证明完整核心、Host/CLI 或桌面已经采用该提供方。

## 同一 Job 内隔离与监督

命令 `node apps/desktop/test-support/windows-job-broker-verify.mjs --sandbox` 实际退出 0，10 场景原件 `C:/Users/jingg/AppData/Local/Temp/SaCode-broker-verification/windows-broker-6XGwGj/`。

包括双流输出限额后排空、真实非零退出、停止前挂起、运行中停止、超时子进程回收、错误 executionId、owner EOF、未知字段、非法限额，以及只读/工作区写入策略下的区内与区外读写。每个正常结算同时核验 IsAppContainer、PID/FILETIME、整树清空、双 EOF；不拼接两次不同进程运行的结果。

原非隔离机械分支回归 `node apps/desktop/test-support/windows-job-broker-verify.mjs` 实际退出 0，8 场景原件 `.../windows-broker-PDYjO3/`。该分支仍非产品安全准入依据。

broker 的隔离参数由宿主装配时传入，不是首帧请求可自行注入的放行值。工具路径必须在指定工具目录内，临时授权目录必须通过现有 owned-root/reparse 校验。result 延迟到 Job 与 AppContainer.Dispose 成功后发送，附 sandboxed 和 sandboxCleanupConfirmed；清理失败不返回成功 result。

## 当前仓颉源码验证

目录 `C:/Users/jingg/AppData/Local/Temp/sacode-isolated-adapter-pdk7qdzj/`。复制当前 windows_job_executor.cj 与 windows-job-adapter-probe.cj 原始字节，使用 cjc -O0 编译二者，实际 build-exit=0；manifest.json 记录命令、输入 SHA、产物 SHA 和构建时 HEAD。没有链接历史 core 库冒充当前适配器。

output、checkpoint-failure、cancel-before-resume 三场景实际退出均 0：完整双流限额和创建时间身份成立；身份回调抛错不恢复任务；恢复前取消不生成 ran。后两种错误先发送 stop，给自持 broker 清理机会，无法确认时才强制结束，不据此宣称清理成功或业务已退出。

## 隔离确认反证

仅私有 mutation/windows_job_broker.cs 将 suspended.sandboxed 改 false，仍实际创建 AppContainer，不关闭隔离。output 独占受害场景从基线 0 转为 1，错误 windows-job-sandbox-unconfirmed，未生成 ran。仓颉适配器在调用启动事实回调/恢复之前拒绝该字段。

全部私有目录通过 ACL 检查，无显式 S-1-15-2-* 残留授权；没有操作其他会话进程。原件含 mutation/build.log、run.log、run-exit.txt 和源码/产物 manifest。

## 尚未完成的接线

ExecutionApi 当前 providerAvailable=false，默认 ExecutionSupervisor.providerReady=false 保持不变。下一步必须使公开提案绑定隔离读写作用域和工具资源，与现有精确审批、workspaceRevision 和一次性许可共同校验。没有明确资源装配的任意 executable/cwd 不能自动获得隔离权限；不允许以普通 Job 回退成功。当前隔离配置接缝只用于可信装配后的验证，不能把私有夹具成功升级为任意 Shell 或桌面产品支持。

恢复授权、Host 中断、业务日志与输出持久化、双入口及打包仍需同一固定快照验收。本轮不将目标或交付状态升级为通过。
