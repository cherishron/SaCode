# 执行持久失败共享冻结与异步契约编译

基线 SHA：`511c422421a3e5429fc3e24acfb0145fef01c43b`；下列实现为未提交工作区改动。

执行状态或输出的 checkpoint 失败、写租约失配时，同时冻结共享 SessionLog，禁止其他请求追加半成品状态。修订既有 executionCheckpointFailureAndBadTailNeverAdmit 用例，断言共享冻结以及 user/message 追加被拒。该修订用例尚未执行，需统一最新核心构建验证。

选定 API／监督器／Windows 适配器／隔离策略源码已重新编译，exit=0；测试 TOTAL=5 / PASSED=5 / SKIPPED=0 / ERROR=0 / FAILED=0，exit=0。日志与逐文件哈希：`C:/Users/jingg/AppData/Local/Temp/sacode-execution-contracts-qwb47_uq/async-manifest.json`、`async-build.log`、`async-test.log`。此测试仍链接历史固定 ExecutionService／SessionLog／lease 库，不覆盖本次共享冻结修订，也不覆盖异步启动、停止竞态的运行行为。

下一步：Host 持有 ExecutionRun，限制执行中会话／工作区变更，处理 EOF 停止与未确认结算；随后从稳定快照构建最新核心和双入口。默认公开执行门禁继续关闭。

## 本批文件 SHA256

- `core/src/execution_service.cj`：`658fa79533cd54d867784b79cb71b2f4b3a6d19bc038e6fea8097cb0f73f6443`
- `core/src/execution_service_test.cj`：`824a1c76fcbff46a9c39e3976325122c6be4960c6c5be8905ee40d5f39bc8fcc`
- `core/src/execution_supervisor.cj`：`05412cf71bc5b343d2b5aed8a7b502f84670dbf583408907a856cc2196b85cc6`
- `core/src/execution_api.cj`：`2d16364b0a417631651fb55c8e064cfbe889d629c77c8154c30972eecb729efc`

## Host 活动执行接线增量

Host 保留 ExecutionRun；start 使用异步 dispatch 回调，启动许可及 starting 屏障仍在后台线程之前完成。活动执行或未确认结算时仅允许限定只读方法与精确 execution/stop，拒绝会话切换和其他副作用。持久冻结时，匹配当前会话和执行 ID 的停止请求仍取消活动句柄自身 token，不声称日志成功。EOF 取消并最多等待 5 秒；仅 exitObserved 与 outputComplete 同时成立才结算，未结算保留租约。host/settled 新增 executionSettled 字段。

本增量未编译、未运行，公开入口仍未注入可信隔离提供方，不能宣称真实任务闭环。等待其他核心编译结束后，在本轮冻结副本验证，不使用主树 target。

Host SHA256：`6cf081e0e156827dc92c1358825cbfbdffd8aaee031c3228d79a1b4d3e56a91d`。

## 异步拒绝断言与串行统一构建登记

在 executionApiExactApprovalAndUnavailableStart 中补异步 start 被拒、回调不触发、admitted 保留的断言；supervisorDefaultGateDoesNotConsumeAdmission 增加 startAsync 拒绝断言。选定 API 契约编译第一次因回调捕获可变变量失败，已改 AtomicBool 后重编 exit=0、TOTAL=5 / PASSED=5 / SKIPPED=0 / ERROR=0 / FAILED=0，exit=0。该 5 条仍不覆盖最新完整 ExecutionService；新增 supervisor 断言尚未执行。日志为 async-gate-build-fixed.log／async-gate-test-fixed.log，所在目录同上。Host 回调改为固定 ArrayList 内容更新，不捕获可变局部变量；Host 编译尚待验证。

最新稳定副本：target/unified-current-1dbb246b36e54e31997570f10b3c1f1b，643 个输入。全部按清单哈希写到普通临时目录 `C:\Users\jingg\AppData\Local\Temp\sacode-current-serial-tcmk0vig`，避免继承仓库 Low integrity。serial-build.py 排队等待现有 cjc/cjpm 全部终止后，依次执行 core build、Host build、CLI build 和共享冻结指定测试；每阶段独占 TMP。只有实际退出码和非空最后 Summary 才算测试通过。当前是排队状态，不是构建成功。状态 serial-build-status.json；命令和阶段日志由脚本逐笔登记。

## 构建队列快照更新

确认自有 Python 等待进程 PID 19464 尚无构建子进程后停止，仅替换排队副本输入，未停止其他会话 cjc/cjpm。队列现绑定 target/unified-current-2beda40519e4431ebb30cf71ab29b43a（643 输入），包含实时输出、最新 Host 接线与本批断言；变更记录 C:/Users/jingg/AppData/Local/Temp/sacode-current-serial-tcmk0vig/queue-replacement.json。恢复运行的 serial-build.py 依次 build core/Host/CLI，最后运行非空 *execution* 契约测试集。当前仍等待其他会话测试／构建终止；无完整新版通过读数。

## 完整当前核心首次构建读数

为完成当前交付目标，将等待阶段改为独占冻结目录、独占输出/TMP、单任务串行构建；不停止或写入其他会话任务。实际命令 cjpm build -j 1，cwd=C:\Users\jingg\AppData\Local\Temp\sacode-current-serial-tcmk0vig\core，exit=0，50.54 秒，158 warnings。core-build.log、core-build.exit.txt、core-build-proof.json 为原件；完整核心库 SHA256 `76a059b365cc3f98f5a13f0ad505ccf1a7ba28ee993511afad23e9597a711d2f`。此结果覆盖该冻结副本的完整核心，包括共享冻结／异步监督／实时输出，而不再只链接旧核心库。

Host 构建已启动；本次 cjc 实际命令指向 C:\Users\jingg\AppData\Local\Temp\sacode-current-serial-tcmk0vig\apps\host\src。当前未结算 Host／CLI 构建或执行测试，不能写通过。原生打包脚本为后续增量，尚不在此构建快照内；最终交付必须重新冻结统一输入。

## 新完整核心的执行契约实测（2026-10-08）
库 SHA256：76a059b365cc3f98f5a13f0ad505ccf1a7ba28ee993511afad23e9597a711d2f。从稳定副本取 execution_service/output/api/supervisor/sandbox 五份测试源码，仅将测试命名空间改为 current_execution_tests 并 import core.*，链接本轮新完整核心；未再链接历史核心库。构建 exit=0；TOTAL=22 / PASSED=22 / SKIPPED=0 / ERROR=0 / FAILED=0，测试 exit=0，25.15 秒。运行 PATH 仅 System32 与 PowerShell，运行 TMP 独占。
证据目录：C:\Users\jingg\AppData\Local\Temp\sacode-new-core-tests-108c06c0b14449f1bba5f421745f2fa0（manifest.json、build.log、test.log 与两个 exit 文件）。覆盖共享冻结禁止追加、输出失败取消令牌、在途输出、去重/恢复/审批挪用/工作区变化、真实普通子进程退出/失败/超时/取消。尚不覆盖公开入口 AppContainer 提供方装配。后续新增流式文件摘要不在此库中，须重新冻结重建。
