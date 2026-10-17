# F08 写回审批与持久意图（2026-10-17）

基线 5c22a3631ec629f0056f377549e6250be5bc082e，含本轮未提交增量。上一轮单文件条件写为进展，本轮将其接入原执行的共享日志/审批/取消机制，不创建任务队列或另一份事实存储。

## 实现

新增包内 ExecutionReviewApply：propose 从 ExecutionService.review 选择最多128个已登记文件，绑定原执行及修订、审查清单摘要、当前源工作区目录/修订、请求身份与前后内容对象，形成有界不可变提案（<=262144字节）。同请求相同提案幂等，不同选择拒绝；先持久化提案再返回。

apply 使用同一 ApprovalDesk 的精确 allowed-once，工具名 execution/review-apply，与 execution/start 的票不可互用。消费后再次核对任务/清单/源工作区，持久化批次开始事实；每文件先读取并核对已保存前后对象，再持久化意图，之后才在 TurnToken 单文件提交边界调用条件写原语。结果分别登记 applied/conflict/unknown/cancelled 和原生错误码；遇拒绝/未知就停止余下文件，保留部分成功事实，不悄悄回滚可能已有用户后续修改的文件。

同一 ExecutionService 中的短期令牌表只区分当前进程仍在执行；事实仍来自 SessionLog。重新加载后，已有意图而未有持久结果的操作显示 unknown。重复apply只返回既有事实，不消费新的执行许可或重复文件副作用。读取投影忽略未落盘事件（seq>=durableCount）。取消只在单文件提交边界生效，不伪称可抢占已在途的文件系统调用。

所有状态变更复用原 WriteLease 与 ExecutionService.checkpoint，失败使服务进入 persistenceFailed。对象字节仍在既有 AttachmentStore，审批及日志不含文件正文。

## 验证结果

- 核心使用本机修正仓颉1.1.3构建：rc=0 / 24 warnings；review-apply-core-build.log。
- 最终真实DLL定向：TOTAL=36/PASSED=36/SKIPPED=0/ERROR=0/FAILED=0，实际退出0；review-apply-test-v4.log。
- 八项新增场景均基于真实私有进程任务产生的三条差异：精确票/落盘意图先于实际写入/三文件应用/幂等；后来用户编辑冲突不覆盖；模拟可能已改变错误及实际日志意图边界恢复不重放；预取消零写入；意图落盘失败零写入；先应用后冲突逐项报告；审批后切工作区拒绝；实际文件写入后结果屏障失败，恢复unknown且不覆盖用户再编辑。
- 其中“可能改变错误”使用注入故障结果；“写入后落盘失败”则真的通过NTFS条件写改变合成源文件，再注入checkpoint失败。二者不混作物理磁盘断电实测。
- 一次测试编译因可变闭包捕获失败，改为AtomicInt64统计，不改业务断言；review-apply-test.log与-v2.log保留。
- 36项首轮触及旧60秒脚本总上限，没有Summary，不计通过；review-apply-test-v3.log及14c5e499运行目录保留。实际测试程序 --help 确认runner参数后，单独部分冲突用例约6.4秒通过（TOTAL=36、PASSED=1、SKIPPED=35，只有定位意义）。整套护栏改为120秒（分两次<=60秒等待）并指定单项30秒及无进度输出；各真实任务自身5000ms超时未改变。最终36项全运行且无跳过。
- 超时轮可确认属于本轮的PID26896已退出；精确核对其 profile sacode.owned.26896.29.133545296 的目录、注册Moniker与无重解析后，仅调用DeleteAppContainerProfile删除此自有测试profile，HRESULT=0，目录消失。未终止或清理其他会话进程/profile。台账 review-apply-timeout-profile-cleanup.json。

日志前缀 target/tmp/windows-adapter-20261017-1f3b/。最终运行目录 target/tmp/windows-adapter-20261017-4b025cebf7674d68b0af855b05f56b07/。本轮对源文件的修改仅发生在独占合成项目，未改产品真实源码作为运行副作用。

```json
{
  "version": 1,
  "passed": true,
  "timedOut": false,
  "exitCode": 0,
  "expectedTests": 36,
  "runtimeLimitMs": 120000,
  "neutral": "D:\\Temp\\SaCode-Windows-Adapter-Verification\\windows-adapter-20261017-4b025cebf7674d68b0af855b05f56b07",
  "coreLibrarySha256": "E68A4FE693D1A595FCF318852CB4BC67A3EADAD5CF816289AFBD1B2F92169246",
  "adapterSourceSha256": "C0B2078F34F2EE8FEA2A61499AE65ED522802ED1CA38604C74E8BAB16BA914C5",
  "processProviderSourceSha256": "D108BF90B9C3490E6EB2429DE834B4699D95B5AE87A180B8CEABC160C419DDEB",
  "executionServiceSourceSha256": "E78202227E57F8666316C1EF61634A927131E70E71F9DBA0D4AD9B1AF8331E55",
  "reviewApplySourceSha256": "B413C424DA4BE431FD57CC9415AEA27E9FD8177002820B9F262549F915F74E0B",
  "executionApiSourceSha256": "C8A5B249156D1A70ED83725401FC85121ABD7797959EB17C771E4D18C677070C",
  "supervisorSourceSha256": "C28957629867E04B54158F54ED9EE5703996E9E19EA45F51EB4F56FBACC93EFF",
  "workspaceAdapterSourceSha256": "536D8CAA761ABAC0B0819442C3DC5CD76719A91F1E36C6C5871F8519F0F5136A",
  "workspaceSnapshotSourceSha256": "4CD9B8CF070E4BE57E60139D58F4FD6DEF9F400B8CB58263CA04C9A3DFC75E29",
  "nativeTreeSourceSha256": "29BDC228E07ED56845C80502F1E20B4FC1C2110AB6E58CBB1230BA79BC4D4311",
  "nativeTreeHeaderSha256": "02858C23FF4F182DA7F8A4F6FCFD4FD6A757E3EB195BE9D64EB56BD684ED8F37",
  "snapshotLinkFixtureSha256": "7AA4F1E38476417EE7B04309FABC2CF3CE6AC22E70ACFE79872C8A2F06CC1193",
  "fixtureCleanupScriptSha256": "41FFADF144EDCC2F42ABBFBB7CD301FB75E2813AC568BDD6B1DD5396BC5D04FF",
  "testSourceSha256": "91602F700EB29498B8C1B84D378FED1D649126CD6C6A2FCE3C79FFE8835BF380",
  "nativeDllSha256": "233976B195D655A21EF0FC1C61CDB8A07994C3E819220740DE10CFDBAD37194D",
  "runtimeSha256": "8B1D0783E10EC18191AF900AC3DA632006037D0A61E0518C4AB005C3F5F8C9C2"
}
```

## 尚未完成

当前仅核心可信装配，未新增公共写回RPC/CLI动作或页面按钮，不能宣称产品写回闭环。下一步为有限prepare/approve/apply/describe/cancel双入口与页面消费，明确部分成功和未知的交互；hunk选择、独立回退、断电原子性及物理故障、完整Electron与安装态仍未验。单文件条件写不升级为多文件事务，源工作区目录与父ACL保持原样，D14及整体目标继续未完成。未提交/推送。
