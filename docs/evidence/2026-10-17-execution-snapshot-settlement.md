# 执行后自动保存差异与资源收束（2026-10-17）

基线5c22a3631ec629f0056f377549e6250be5bc082e，未提交增量。接续逻辑目录映射与私有副本清理，本批把真实进程结束、差异保存和资源收束接成共享监督器的可信结束阶段；尚未装入默认Host/CLI的准备工厂。

## 实现

ExecutionSupervisor新增可信onSettled参数（默认空操作，不是RPC字段）。只有确认退出、输出完整且结束事实已持久化之后调用；异步句柄的完成信号在该阶段返回后才置位。回调失败保留真实exited/exitObserved事实，另写execution/settlement-failed并让等待者收到execution-settlement-failed，不能伪报完整成功。失败记录与资源记录沿用同一lease/checkpoint；屏障异常或租约失效按持久化失败处理。

新增包内WindowsSnapshotSettlement：先核对scope目录、profile名称及快照绑定；完成时重查执行修订和提案。先recordReview保存既有AttachmentStore前后对象和同日志审查，再持久化execution/resources-release-begin；之后关闭已收束进程、树句柄、清空/撤销私有目录、释放profile及库，最后持久化execution/resources-released。不删除原工作区，不建立新任务队列。

同进程重复complete不重复写事件。若目录已关闭而库仍被引用，重试识别已完成步骤，不再调用关闭目录的内容清理；释放引用后可完成剩余库关闭与持久结算。恢复不能据此重新创建胶囊、进程或授权；跨进程资源恢复仍待后续所有权装配。

## 验证

- 修正仓颉1.1.3核心构建成功，24 warnings；最终settlement-core-build-v4.log。两份本批生产CJ文件已按技能用cjfmt格式化后再编译/测试。
- 先前结束阶段46/46通过，报告c123b431ae2c4b45b59c3703410c679a；补充绑定及晚期关闭重试后最终TOTAL=47/PASSED=47/SKIPPED=0/ERROR=0/FAILED=0，实际rc=0、未超时，152.540秒。完整保留原有用例，不用过滤结果替代整轮。
- 映射真实cmd任务改私有input.txt，监督器自动保存审查并删除私有目录、释放真实profile与库；源文件ORIGINAL和会话工作区不变。副本删除后，从对象存储读取到MAPPED正文；重复complete事件数不增。误传另一个新建私有scope被拒绝，错误scope独立撤销。
- 真实进程正常退出后注入结束回调失败：等待者报失败，但日志仍保留实际exited及exitObserved=true，重新读取磁盘有一条settlement-failed，不编造审查成功。
- 晚期释放失败用例实际多持有原生树引用，导致目录/profile已释放而库拒绝关闭；原结束事实和审查保留。释放该引用后，同一胶囊明确重试成功，源文件不变。这是本进程恢复，不是重启接管。
- 首次补丁定位因格式化后片段不同，在落写前中止；修正定位后以-v4构建和最终47项为准，不把-v3编译读数混作最终用例验收。

命令：scripts/verify-windows-process-adapter.ps1 -CoreRelease target/tmp/appcontainer-core-rebuild-20261017-6b281f0a/build/release -DestinationRoot D:/Temp/SaCode-Windows-Adapter-Verification。

日志前缀target/tmp/windows-adapter-20261017-1f3b/：settlement-core-build*.log、settlement-format*.log、settlement-native-test.log（46项）、settlement-native-test-v2.log（47项）。最终报告target/tmp/windows-adapter-20261017-2373f3af97904dd0a84b023e0909da2f/verification.json，含库、SDK/DLL及源码指纹。

核心库SHA256：32440F84425A9D41384CF805225DE517F3644F9D5F626D57E46562B4FC16A9E3。
监督器源码SHA256：B8D3BC63BE1FBF4252BC4D9B30DCF3CB6F0AA07106460DF641D7B7C3D48B846A。
结束阶段源码SHA256：A428D37DA29AC54B923B79CC112671B7902D603926EDCD380997F762A299F6B3。
运行库仍为本机非官方修正1.1.3，SHA256：8B1D0783E10EC18191AF900AC3DA632006037D0A61E0518C4AB005C3F5F8C9C2。

## 剩余与并发边界

默认Host/CLI尚需持有胶囊准备/审批/开始/关闭的统一所有权及有界缓存，连接本结束回调；未启动提案退出清理、跨进程事实投影、安装态与默认就绪探针未完成。可信定向用例明确注入已验证原生提供方，不据此开放默认门禁。未验证实际磁盘故障、所有清理步骤的故障组合及其他平台。

47项运行期间其他会话更新model_catalog.cj及其测试，晚于本次核心库；本批监督器/结束阶段/适配器未在库后改变，指纹记录有效，但不能据此宣布当前全仓全部未提交源码通过。未重建Host/CLI/Electron，不沿用前序17项旧二进制证据证明新回调接通。未提交/推送/安装/发布；D14及整体目标仍未完成。
