# H/W70 电脑执行器假成功修复（2026-10-06）

## 范围与结果

承接 `h70-codex-review-2026-10-06.md` 的电脑假成功问题。本批只修失败语义，不实现 Windows 输入注入，不升级 H 整体完成状态。

此前 click 只调用 GetSystemMetrics，type/press_key 只写日志，三者均返回成功。现在五种合法动作（click/type/press_key/drag/scroll）统一返回 `ok=false`、`exitCode=-1`、`failureKind=action-not-supported`、`message=computer-input-injection-unavailable`，保留原 verb/target。未执行动作不写 `computer/exec`。合法请求仍写 `computer-use/action` 尝试审计；该事件不证明应用授权或实际动作执行。

移除假执行分支、未调用的 SendInput 等声明与未经验证的 INPUT 布局常量。GetSystemMetrics 仅保留为独立只读符号探针，其用例不再调用 perform 或断言点击成功。非法动词、空目标与预先取消的失败行为保持。

## 红先与修复后验证

测试先修改、实现后修改；旧实现的新断言真实转红：

- `computerUnavailableActionsNeverReportSuccess`：FAILED，三种动作仍返回成功，且生成 3 条虚假执行回执。
- `computerAuditRecordsAttemptsWithoutExecutionReceipts`：FAILED，仍生成 1 条虚假执行回执。
- 红灯 Summary：TOTAL 834 / PASSED 0 / SKIPPED 832 / ERROR 0 / FAILED 2，rc=1。

修复后增量编译 `cjpm test -i --no-run`，rc=0；只筛选下述六条用例直跑新产物，均 PASSED：

1. computerCffiSymbolsResolve（只读符号探针）
2. computerUnavailableActionsNeverReportSuccess（五种动作、结构化失败、原目标保留、零执行回执）
3. computerRejectsBadVerb
4. computerRejectsEmptyTarget
5. computerCancelledTokenShortCircuits（零尝试审计、零执行回执）
6. computerAuditRecordsAttemptsWithoutExecutionReceipts

绿灯最后 Summary：**TOTAL 834 / PASSED 6 / SKIPPED 828 / ERROR 0 / FAILED 0，rc=0**。SKIPPED 是本次 filter 排除项，不是全量通过。编译有既有 warnings，不称零告警。

## 隔离与可复跑证据

基点 HEAD `2a08056` 的工作区快照，包含当时未提交的 H 电脑/语音文件，不能称纯提交态全量基线。首次红灯编译期间发现另一个会话也写公共 unittest 目录；本次编译已完成 rc=0，随即复制产物至私有目录并取得红灯。之后修复、重编及绿灯全部使用私有源码和产物目录，无公共产物覆盖。

私有目录：`D:/Temp/SaCode-cu-failclosed-20261006-2206/`。保留 `red-build.log`、`red-test.log`、`green-build.log`、`green-test.log`、`source-manifest.json`、`red-binary-sha256.txt`；不提交产物或控制台转储。源码清单 SHA256：`fb09a6abb1a1ff33761dcbecb21e616d6e23c4cd11b6a58ca9f858459a2e509c`。

| 文件/产物 | SHA256 |
| --- | --- |
| cu_exec.cj | ddf708a5bde5ad73f3cbc3303b1b5ebeac4b36448f3c8c16c8c941566e0e8a8d |
| cu_exec_test.cj | f7fe0b76575d9b23e8f5fe44c1c849cabb17525be7843fc956b665c84c4349dc |
| 红灯 core.exe | bbc8262149cf2503e5a8008c0b9a11dce855bf1937f4a53b4908006a8e60a230 |
| 绿灯 core.exe | 8c7626de25d822955f7afe086568a75a4e8e092e165d0e7ea8d8762ba9a65654 |

在上述私有目录执行：

```powershell
cjpm test -i --no-run
$env:Path='C:/Users/jingg/stdx-work/stdx-1.1.3.1/windows_x86_64_cjnative/dynamic/stdx;'+$env:Path
./target/release/unittest_bin/core.exe --no-color --parallel=1 --no-progress '--filter=*computerCffiSymbolsResolve*,*computerUnavailableActionsNeverReportSuccess*,*computerRejectsBadVerb*,*computerRejectsEmptyTarget*,*computerCancelledTokenShortCircuits*,*computerAuditRecordsAttemptsWithoutExecutionReceipts*'
```

本批将原先未追踪的电脑执行器与测试纳入提交，只含该对文件和本证据。不带入语音文件、H 总报告、责任表或控制台日志。真实输入注入、应用身份授权、执行中取消、Host/CLI 接线、模型调用与安装态验收仍待完成；浏览器第八条、真实 Office/ASR 及 H 全量读数缺口不在本批收口范围。
