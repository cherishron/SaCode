# update_goal 声明闭环验收（2026-10-07）

记录时间：2026-10-07 23:45 +08:00。仓库 `D:/Project/sa/saai/sa-code`，分支 `refactor/dsh-learning`，基线提交 `35a69ca9e0f8b7b6ac51271ec76eff3515eaa820`。本批为未提交工作区实现，不是固定提交态验收。其他在途桌面、Host、审批及 Shell 改动保留，不包含在本功能完成声明中。

## 变更单核对与实现

- `ApprovalOutcome` 实际字段为 `allowed/why`；既有 `GoalRunner.run` 要求调用方传 `claim` 闭包。修订事实已补入变更单 §7。
- `ToolRuntime` 执行器表新增 `update_goal`，经既有 guard，严格校验 JSON 对象、两个必填字符串、非空 ID、枚举和额外字段。模型注册表提供无独立审批的 schema。
- 目标不存在或非 active 结构化拒绝；`completed` 写 `goal/claim`，不直接完成状态；没有开放轮次返回 `goal-no-open-round`。成功返回 `ok`，运行时结果日志为 `ok-goal-completed:<id>` 或 `ok-goal-update:<id>`。
- `GoalClaim.record` 验证目标 ID、active、当前修订、开放轮次，载荷记录目标 ID、修订、轮次及声明状态。同轮 `in_progress` 撤回完成声明。读取仅匹配同修订、同轮次；损坏行不作为证据。
- 声明 log-only，既有 `SessionLog.flush` 保持持久化边界；不增加平行状态源。开轮提示包含调用方式。
- `GoalRunner` 使用同轮 `GoalEvidence` 与 `GoalClaim` 合取；既有可信闭包注入接口保留。`update_goal` 不计入成功工作工具数，不能自己生成机械证据。Driver 原有 active/CAS、取消及轮次边界继续生效。

## 测试结果

Windows、仓颉 1.1.3、stdx 1.1.3.1，私有 TEMP/TMP 为 `apps/desktop/.tmp-test/goal-claim-temp`。

| 检查 | 结果 |
|---|---|
| 全部当前生产 core 源码 + 指定测试的隔离副本构建 | `cjpm test --no-run -i`，rc=0 |
| 指定目标与模型运行时回归 | TOTAL 64，PASSED 63，SKIPPED 1，FAILED 0，ERROR 0，rc=0 |
| 新增 claim 测试 | 6/6 通过，未跳过 |
| 源码与副本 SHA256 逐文件核对 | 126 个文件一致：119 个生产文件、7 个原样测试文件 |
| 路径归属门禁及自证 | 12/12 检查通过；12/12 反证被捕获 |
| 定向 `git diff --check` | rc=0 |

7 个测试文件：`goal_claim_test.cj`、`goal_test.cj`、`goal_evidence_test.cj`、`goal_runner_test.cj`、`goal_scheduler_test.cj`、`model_tool_runtime_test.cj`、`model_agent_test.cj`。隔离副本另外原样提取 `sse_test.cj` 的 `appendSse` 三行辅助函数，供既有模型运行时测试使用；没有替换生产行为。跳过项为已有 `realModelExecutesRegisteredTodo`，由 `STEPFUN_API_KEY` 缺失门控；不记为真实服务验证。

新增 6 条覆盖参数与状态错误、guard 拒绝、修订与轮次隔离、同轮撤回、flush/load 回放、转录隔离、双证据自动完成、声明独立不能完成、上一轮声明不能借用，以及取消优先。已有证据单独成立不能完成目标的反证也通过。

## 复跑与产物

从工作区复制全部非 `_test.cj` 生产文件及上述 7 个原样测试文件，连同 `core/cjpm.toml` 放入 `apps/desktop/.tmp-test/goal-claim-source`；添加从原文件提取的 `appendSse` 辅助函数。再执行：

```powershell
cd D:/Project/sa/saai/sa-code/apps/desktop/.tmp-test/goal-claim-source
cjpm test --no-run -i
$env:Path = 'C:/Users/jingg/stdx-work/stdx-1.1.3.1/windows_x86_64_cjnative/dynamic/stdx;' + $env:Path
$env:TEMP = 'D:/Project/sa/saai/sa-code/apps/desktop/.tmp-test/goal-claim-temp'
$env:TMP = $env:TEMP
cd target/release/unittest_bin
./core.exe --no-color --parallel=1 --no-progress
```

开发机记录在 `apps/desktop/.tmp-test/` 下：`goal-claim-focused-build.log`、`goal-claim-focused-build.exit.txt`、`goal-claim-focused-test.log`、`goal-claim-focused-test.exit.txt`、`goal-claim-source-manifest.json`。这些是忽略的本地记录，不声称已提交日志。

专项测试二进制 SHA256：`19cd00b57095050343c4e04d99a1ec983b8c2c43252566e62f680c5480fe0794`。

全 core 测试构建曾因缺少新增文件导入失败，已修复；后续全量测试编译在生成单体测试程序时被主动停止，改为上述专项副本。全 core 回归没有取得 Summary，不能宣称全量通过。

## 完成边界

共享核心模型工具循环 → 声明日志 → 双证据调度 → 目标 complete 已实测。当前 Host/CLI 产品入口没有调用 `GoalRunner`，本批未改公共入口；桌面、真实远端模型、安装包及发布状态不升级。未提交、推送或更新开发 Host 二进制。
