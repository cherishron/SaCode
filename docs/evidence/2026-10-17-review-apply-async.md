# F08 异步写回与停止边界（2026-10-17）

基线5c22a3631ec629f0056f377549e6250be5bc082e，未提交工作区增量。新增包内ReviewApplyRun及ExecutionReviewApply.start/stop；同步apply保留既有语义，共用同一admit和execute，不另造执行器或任务队列。

start在调用线程先完成精确审批、提案/审查/工作区核对、持久开始事实及活动令牌登记，然后异步逐文件处理。重复start不能产生第二次写入。句柄支持有界等待和完成查询；恢复仍依据日志，已有意图不自动重放。

stop只请求停止，使用包内TurnToken.requestReviewStop原子置位，不等待单文件提交锁；原有cancel()等待临界区的契约不变。已在提交的文件先登记真实结果；下一文件不开始，保留partial-cancelled和not-attempted事实，不伪报全部撤销。

## 实测

- 本机修正仓颉1.1.3核心构建rc=0，24 warnings；review-async-core-build.log。
- 真实DLL/Cangjie定向TOTAL=40/PASSED=40/SKIPPED=0/ERROR=0/FAILED=0，实际rc=0、未超时；总耗时140.516秒。
- 新增reviewApplyAsyncStopRemainsResponsiveDuringFileCommit：真实合成任务差异中以受控闸门暂停第一个文件writer；确认异步句柄未完成、重复start拒绝、stop Future在500ms内返回；放行后真实条件写仅执行一个文件，下一新增文件不存在，最终partial-cancelled，重复apply不增加写入。闸门是确定性竞态夹具，不声称物理磁盘延迟实测。
- 完整原36+并发提案守卫1+目录身份2+本批异步1全部运行，无过滤跳过。
- Host能力门禁11/11、IPC门禁8/8；能力172与IPC143未新增公开写回动作。

命令：scripts/verify-windows-process-adapter.ps1 -CoreRelease target/tmp/appcontainer-core-rebuild-20261017-6b281f0a/build/release -DestinationRoot D:/Temp/SaCode-Windows-Adapter-Verification。

日志：target/tmp/windows-adapter-20261017-1f3b/review-async-test.log。
指纹与最终判决：target/tmp/windows-adapter-20261017-9595b6723df941f5958b3d5dd3fc48f6/verification.json。
核心库SHA256：0ADD4B694F916A8E781DEE3E8BB1C0C4C16FFCE9B578A198A9EA3ED0703B8700。
reviewApply源码SHA256：FB087A135103FDDA445CC053E87C43544B92BC61444947D476293F787BD74EAD。
运行库仍为本机非官方修正1.1.3，SHA256：8B1D0783E10EC18191AF900AC3DA632006037D0A61E0518C4AB005C3F5F8C9C2。

## 产品边界

此批仅核心异步装配。公共prepare/apply/describe/stop、Host退出时句柄收束、CLI确认、页面选择及真实双入口写回验收仍未接通；接入约定见docs/interfaces/execution-review-apply-2026-10-17.md。未改默认执行门禁，不升级F08及整体产品完成状态。未提交、推送、安装或发布。
