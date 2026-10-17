# 持久任务准入与恢复专项验收

2026-10-08，Windows / 仓颉 1.1.3 / stdx 1.1.3.1。产品仓库 `D:/Project/sa/saai/sa-code`，分支 `refactor/dsh-learning`。基线 SHA `35a69ca9e0f8b7b6ac51271ec76eff3515eaa820`，验证当前未提交工作区源码，其他在途改动保留。本批从 10-07 持续到 10-08，时间点不沿用旧产物。

## 完成范围

新增 `execution_service.cj`、`durable_checkpoint.cj`、`execution_service_test.cj`；扩展 `SessionLog.durableCheckpoint`、`WriteLease.protects`、`ApprovalDesk.consumeExactForCall`。不替换旧 flush、不提供另一份任务数据库、不新增桌面 IPC 或 Host/CLI 执行动作。

共享核心现已具备持久请求去重与冲突检查、跨重启不复用的日志执行 ID、工作区权威修订校验、精确一次性授权、一次性启动许可、任务修订绑定的停止/结算、授权不恢复及未结算执行 unknown 恢复。状态回放校验格式版本、初始身份、修订连续性、提案不可变性和合法状态转移。声明 GoalClaim 与本批结果保持独立。

Windows 检查点提供方实际启动固定系统 PowerShell，以 FileStream 同一句柄核对磁盘长度和前缀 SHA256，仅追加新字节并调用 Flush(true)，成功后才推进已刷计数。没有把 SessionLog.append 当成落盘，也没有通过调用旧整写 flush 冒充屏障。依据：[微软 FileStream.Flush(Boolean)](https://learn.microsoft.com/en-us/dotnet/api/system.io.filestream.flush?view=net-10.0)。提供方写入后核心进程重新读取并验证连续前缀与新实例重放。

## 最终验证

| 层 | 实测 |
|---|---|
| 全部当前生产 core 源码与 8 个指定测试文件的隔离副本编译 | `cjpm test --no-run -i`，rc=0 |
| 指定核心回归 | TOTAL 71；PASSED 70；SKIPPED 1；FAILED 0；ERROR 0；rc=0 |
| 新增准入与恢复测试 | 7/7 通过，未跳过 |
| 上一批 GoalClaim 测试 | 6/6 在本批源码上再次通过 |
| 生产及原样测试源码 SHA256 核对 | 129 个文件一致；临时副本仅额外提取既有 appendSse 辅助函数 |
| 责任门禁 | 12/12 通过，102 行登记 |
| 定向 diff 检查 | `git diff --check`，rc=0 |

7 条新测试：

- `executionDurableCheckpointPreservesPrefixAndRejectsWrongLease`：中文、空格、单引号目录的真实追加刷新、前缀保留、未持有或不对应日志的租约拒绝、新日志实例重放。
- `executionAdmissionIsIdempotentAndNotReplayedAfterRestart`：请求去重、请求冲突、恢复不带授权、重新批准、启动不重放、旧 starting 变 unknown、恢复幂等、跨会话拒绝及新 ID 不复用。
- `executionStopUsesRevisionAndDoesNotCancelOtherTask`：两个独立任务的令牌、陈旧修订停止拒绝、停止只作用于目标任务、取消后的零退出码不成功、终态不可重新启动。
- `executionCheckpointFailureAndBadTailNeverAdmit`：注入屏障失败不发布许可、不推进已刷计数、冻结读取；真实坏尾不由准入自动覆盖。
- `executionRejectsLegacyApprovalAndConcurrentDuplicateStart`：旧工具名审批不放行、两个线程竞争启动恰有一个成功、重放 starting 不能伪装进程已启动。
- `executionReplayRejectsChangedProposalAndUnknownVersion`：不可变提案被篡改或版本未知时拒绝回放。
- `executionWorkspaceSwitchAfterApprovalRejectsStart`：审批后切换目录拒绝旧提案启动。

跳过项仍是已有 `realModelExecutesRegisteredTodo`，缺少 STEPFUN_API_KEY；不将其计为真实模型测试通过。没有全 core 测试 Summary，不宣称全量回归。

## 复跑与本机证据

隔离目录：`apps/desktop/.tmp-test/execution-admission-source`。复制全部非 `_test.cj` 生产文件，加 `goal_claim_test.cj`、`goal_test.cj`、`goal_evidence_test.cj`、`goal_runner_test.cj`、`goal_scheduler_test.cj`、`model_tool_runtime_test.cj`、`model_agent_test.cj`、`execution_service_test.cj` 及原 `core/cjpm.toml`。既有模型测试依赖的 appendSse 从 sse_test.cj 原样提取，未改生产行为。

```powershell
cd D:/Project/sa/saai/sa-code/apps/desktop/.tmp-test/execution-admission-source
cjpm test --no-run -i
$env:Path = 'C:/Users/jingg/stdx-work/stdx-1.1.3.1/windows_x86_64_cjnative/dynamic/stdx;' + $env:Path
$env:TEMP = 'D:/Project/sa/saai/sa-code/apps/desktop/.tmp-test/goal-claim-temp'
$env:TMP = $env:TEMP
cd target/release/unittest_bin
./core.exe --no-color --parallel=1 --no-progress
```

日志、真实退出码和源码清单位于忽略的 `apps/desktop/.tmp-test/`：`execution-admission-build.log/.exit.txt`、`execution-admission-test.log/.exit.txt`、`execution-admission-source-manifest.json`。最后增量编译有 42 条测试编译警告，编译 rc=0；没有隐藏警告作为无警告发布证明。

测试可执行文件 SHA256：`f89af97c38fff556387e5dc50348b02939da66df6620040e65f0089bcec61c6c`。

## 仍待接线及解锁

这是共享核心准入与恢复交付，不是已经可执行的产品任务入口。beginStart 返回许可，未启动用户命令；started 的进程创建身份和 finish 的退出事实由后续真实监督提供方负责采集。Host/CLI 未接线，UI 不开放新执行按钮。

每次检查点最多追加 4096 字节，提案正文最多 1024 字节；容量超限、前缀不一致、半尾帧、缺 Windows 提供方或平台不支持一律失败，不偷偷分段或回退整写。失败保留租约与内存态，必须重新读盘、明确恢复，不自动重试副作用。

新实例恢复和跨进程文件可见性已取证；没有杀 Host 进程后完成真实任务重连的证据，也没有真人断电/介质掉电证据。PID 创建身份核验、完整进程树监督、真正隔离、完整输出/报告、会话全局持久迁移及所有旧 flush 的追加化仍待独立实现或验收。停止尚未绑定监督的 starting 返回 stop-unconfirmed，不能将其宣称为已停止。

未提交、推送、重打 Host、安装或发布。
