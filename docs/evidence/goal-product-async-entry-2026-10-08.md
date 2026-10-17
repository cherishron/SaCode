# 目标产品异步入口专项（2026-10-08）

## 逐轮结算增量（当前工作区，2026-10-08）

基线 HEAD `78f79e0727d5d6481e61dfbda438fdc5099442e6`。GoalRunner.start 新增 settleRound 回调，每轮结果在检查点及目标完成判断前只调用一次；回调已写账本后抛错或用量聚合非法/溢出时冻结日志、取消任务，拒绝未持久完成投影。GoalDriver 在当轮结算后再次检查预算，超限时即使 evidence 与 claim 成立也记 goal-budget，不完成；结算期间取消保持 active，不续跑。

新增四条均实跑通过：goalRunnerRoundSettlementPrecedesCompletionCheckpoint、goalRunnerRoundBudgetStopsEvenWithSameRoundEvidenceAndClaim、goalRunnerRoundSettlementFailureFreezesBeforeCompletion、goalRunnerCancellationDuringSettlementCannotCompleteOrContinue。其中预算例使用 TokenMeter(budget=5)，模型夹具 usage=7，证实预算拒绝优先于同轮完成。顺序/失败/取消例使用内存 Provider 和旧 flush；不能代替真实模型与实际入口验收。已有 GoalCheckpoint 原生屏障用例也随选定集回归，但没有物理断电证明。

私有源码及 target：`apps/desktop/.tmp-test/goal-round-settlement-20261008/`，本轮唯一 TMP 子目录 `temp-<UUID>`。`cjpm test --no-run` rc=0；直接运行 `core.exe --no-color --parallel=false --timeout-each=30s --no-progress`，最后 Summary **TOTAL 129 / PASS 128 / SKIP 1 / ERROR 0 / FAILED 0，rc=0**。一条缺真实密钥用例跳过，不算通过；此为选定集，不替代交接中的全量 902 读数。日志 `core-build.log`、`core-run.log`，源码哈希 `source-manifest.json`，验收摘要 `result.json`。本轮没有改共享 target、index 或 glob 语义，没有提交。

本增量改变后续入口接线要求：Host/CLI 使用逐轮唯一记账器，最终 poll/退出只重建账态，不能再把聚合结果重复 settleTurn。实际入口调用、新 provider 请求、冻结后的协议错误和恢复验收仍未完成，继续保持实施中。

## 基线及实现

HEAD `35a69ca9e0f8b7b6ac51271ec76eff3515eaa820`，产品仓库 `D:/Project/sa/saai/sa-code`、`refactor/dsh-learning`；未提交工作区增量，未推送、安装或发布。

`GoalRunner.run` 保留兼容 claim 闭包，但增加 requireLoggedClaim，启用后不接受闭包替代日志声明。新增产品 `GoalRunner.start` 异步入口，返回既有 TurnHandle，强制严格模式；同目标修订、同轮次 GoalEvidence 与 GoalClaim 同时满足才可完成。恢复本身不调用此入口，需调用方显式重新启动。

轮次提示/开轮事实落日志后、首次 Provider 工厂调用前执行调用方检查点；工具结算/机械证据后及 Driver 最终目标结算后再检查。失败取消任务并返回 error，不发成功目标投影。跨轮汇总用量、文本、工具结算与成功次数；早期接口拟供入口最终一次结算，当前已改为上节逐轮记账、最终仅投影。不把 claim 算作机械进展。

## 专项证据

私有 `.tmp-test/goal-product-source` 复制当前生产源码与选定测试；没有修改共享 core target。`cjpm test --no-run -i` rc=0；直接二进制 `--no-color --parallel=false --timeout-each=30s --no-progress` rc=0，**TOTAL 122 / PASSED 121 / SKIPPED 1 / ERROR 0 / FAILED 0**。这是选定核心集，不是全量；真实模型密钥缺失跳过不算通过。

新增三条均点名 PASSED：

- goalRunnerProductEntryRequiresLoggedClaim：兼容注入 true 也不能替代日志 claim。
- goalRunnerProductCheckpointFailureDoesNotRequestModel：屏障失败 Provider 工厂调用次数为 0。
- goalRunnerProductAsyncCompletesFromSameRoundClaimAndEvidence：异步同轮工具+声明完成，重载仍为 complete。

首次编译失败是测试把 load 错用为静态方法、私有副本漏辅助函数；修正后才采用上述结果。日志 `apps/desktop/.tmp-test/goal-product-core-build2.log`、`goal-product-core-tests.log`；生产 GoalRunner 与测试文件均和该副本 SHA256 相同。

SHA256：GoalRunner `0E0CCFBA7A84CF44057B48F0E9C6FA2C5FD9C05D107D024B144EFF35C1BBF81D`；测试 `B7F7DE70440DDDE0B051303D903008F5E21881D32C9A87EB15F1D3EDC0384836`；核心测试二进制 `9C47E0EA29A9910054181164F5BA128D41AF52FB7AF46622740B07B85D98139A`。

## 未完成的产品接线

Host/CLI 尚未调用新 start，不能宣称产品自动续轮完成。测试检查点采用旧 flush 验证回放，不证明真实持久屏障。实际接线必须使用受租约保护的持久提供方，处理当前 durableCheckpoint 每批 4096 字节限制。最终完成写入失败时，调用方必须冻结读写、保留租约并禁止从未持久的内存日志投影完成；本回调接口本身不实现全会话冻结。

还需第一轮及后续轮均从准入后的日志构造请求、轮内用量预算与最终计量避免重复、暂停/编辑/清除/取消、进程断开恢复不自动调用、两入口真实 provider 和桌面验收。真实执行隔离门禁仍关闭。主责 F/W50 共享入口、A/W90 双入口、B/W10 持久接线，G/W60 页面。

## Host 目标入口本轮构建未收口

基线 HEAD：78f79e0727d5d6481e61dfbda438fdc5099442e6；本轮修改尚未提交，与并发改动分开登记，不代表提交级验收。

- 私有核心专项：TOTAL 130 / PASSED 129 / SKIPPED 1 / ERROR 0 / FAILED 0，rc=0；不是全量核心读数。
- 桌面 task-start IPC 专项：2/2，rc=0。
- 私有 Host cjpm build 实际 rc=1；日志仅有 144 条警告汇总，没有可定位错误诊断。代码生成阶段持续运算后结束，host.o 为 0 字节。失败原因待核，不推断为死锁或内存不足。
- 因未生成本轮新 Host，真实请求五场景验收未运行；Host 接线仍为实施中，不记通过，也不借用旧二进制。
- 构建根、源码 SHA256 清单和 result.json：apps/desktop/.tmp-test/goal-host-20261008/；核心专项：apps/desktop/.tmp-test/goal-host-core-20261008/。
- 下一步：定位 Host 原生代码生成失败，取得新二进制后运行 goal-host-verify.mjs，验跨轮、预算、声明无证据、冻结、取消及恢复不执行；随后补 CLI 真实入口。
- 未暂存、提交、推送；未修改 glob 争议语义、未停止其他会话进程。

## Host 原生生成探针与构建选项复验

同一份已保留的 host.opt.bc，直接调用原生生成器 llc -O1，实际 rc=0，生成 567395 字节对象文件。此结果仅定位原生生成路径，不是 Host 可执行产物或运行验收。完整 cjpm 构建正在同一源码私有副本中复验：仅该副本 cjpm.toml 增加 compile-option="-O1"，产品配置暂未修改，新的 TMP 独占；实际编译命令已确认含 -O1。源码清单与当前工作区差异为 0。完整构建未终结，不能覆盖上一轮默认构建 rc=1 的事实。

探针元数据：apps/desktop/.tmp-test/goal-host-20261008/native-probe.json；正在运行的完整构建元数据：build-o1-state.json。后续必须取得完整构建实际退出码，再打包并跑 goal-host-verify.mjs；不得将探针对象当作产品验收。

## 新 Host 真实请求初验：构建已通过，取消路径未收口

私有副本 cjpm.toml 的 compile-option="-O1"，完整 cjpm build 实际 rc=0；新 main.exe 10041856 字节，pack-host 172 文件、rc=0。产品仓库 cjpm.toml 未改。不能抹去默认 -O0 路径 rc=1 的既有事实。

实际新 Host + Node HTTP/SSE 服务验证：complete、budget、claim-only、freeze 四场景与各自重启后不执行断言通过，证据 apps/desktop/.tmp-test/goal-host-proof-Z6Q6VA/results.json；整组 rc=1，cancel 的 turn/poll 超时。单独 cancel 复现 rc=0，证据 goal-host-proof-DlgZyb，取消至终态 31694ms、485 次轮询，最大单次 RPC 1651ms。这是部分通过与不稳定取消，不能写五场景全绿；本地协议服务不是远端真模型。

定位到协议入口 isDurableFrozen() 读取也拿日志锁，该锁在持久屏障执行磁盘操作时被工作线程持有。修改 SessionLog 冻结闸为 AtomicBool：发布失败仍在日志锁内，查询失败闸不等该锁，投影/写入/屏障仍执行原冻结检查。新增 goalFrozenStatusDoesNotWaitForTheDurableWriterLock：写线程持锁时，查询线程必须先于解锁返回，之后冻结状态仍可见。当前在私有核心专项重新编译，尚无本轮测试读数。此修复只解除状态查询的锁等待，不承诺网络读取消即时完成或整个轮询绝无其他等待。

冻结状态原子查询专项已取得实际 Summary：TOTAL 131 / PASSED 130 / SKIPPED 1 / ERROR 0 / FAILED 0，rc=0；构建 rc=0。新增 goalFrozenStatusDoesNotWaitForTheDurableWriterLock 通过，约 42ms。私有证据 goal-host-core-20261008/core-freeze-run.log 与 freeze-result.json。这是选定核心套件，不是全量核心或修复后 Host 运行验收；现有 packed Host 仍是修复前源码，不能拿它证明该修复已在产物生效。
