# 私有执行生命周期与真实双入口（2026-10-18）

基线 5c22a3631ec629f0056f377549e6250be5bc082e；本批为未提交工作区增量，不代表安装态或全部产品完成。

## 实现及核对更正

新增 ExecutionWorkspaceCapsule / WindowsExecutionCapsule，统一持有准备、探针、快照、审批后启动、结束审查及资源释放。核心只接受可信装配参数，RPC不能指定原生库或私有根。库从实际可执行文件相邻目录加载；一个服务最多持有一个活跃胶囊。原工作区保持逻辑cwd，实际命令运行于私有副本。启动前复核快照和源目录修订，恢复不重建副本、不继承授权、不重放执行。

Host的execution/propose接入准备工厂；EOF取消并等待执行/写回，未确认清理时保留租约并报告未结算。核对发现：此前文档中的review EOF描述早于真实接线，早期补丁锚点未匹配；本批已在实际teamSchedulerToken.cancel之前插入停止与等待。旧文档不能代替本批源代码和实测。

CLI新增job run：同进程准备、展示精确快照提案、y/N独立确认、执行、保存审查及释放资源。普通job propose保持元数据动作。job run返回真实失败码，本批修复了此前总返回0的问题。

## 实际验证

- 核心定向最终TOTAL=50/PASSED=50/SKIPPED=0/ERROR=0/FAILED=0，rc=0，157.996秒。报告：target/tmp/windows-adapter-20261017-da13f1004dc34adcafd869982cd8aec7/verification.json。包括完整执行、未启动收束/重启拒绝、私有根重叠拒绝三个新用例。
- 核心、Host、CLI构建成功；最终CLI日志target/tmp/windows-adapter-20261017-1f3b/capsule-cli-build-v2.log。CLI v2重新打包并中性导出，不使用旧CLI的退出码证据。
- node apps/desktop/test-support/verify-execution-capsule-entries.mjs D:/Temp/SaCode-capsule-host-20261017-v1/bin/sacode-host.exe D:/Temp/SaCode-capsule-cli-20261018-v2/bin/sacode-host.exe：rc=0，13项通过。真实页面状态层→有限IPC→Host准备/授权/执行/审查/独立写回；未启动EOF、运行中EOF取消、恢复不重放、CLI拒绝/成功/exit7均验证。原工作区在写回确认前保持ORIGINAL；最终无本轮私有任务目录。
- 证据target/tmp/capsule-entries-Q7Vsri/verification.json；日志target/tmp/windows-adapter-20261017-1f3b/capsule-real-entries-v3.log。
- 六个桌面定向文件review-writeback、task-review、task-review-preview、snapshot-approval-ui、snapshot-mapping、review-apply-ipc：14/14，零失败/跳过，rc=0。日志同前缀capsule-ui-final.log。
- 初次入口探针遇到进程exited但worker尚未结束的明确execution-in-flight-or-unsettled拒绝；驱动仅对此未派发拒绝作有界重查，不重试超时/未知结果。原失败日志保留。

Host SHA256 f93c06b7eeaf0b56825b0a421763964555024147fb707678c44c7900de733c54；CLI SHA256 dba2aca681af1ea7db1d3530a69ba24422ad9e26725372b15d8782da151a71d6。修正SDK运行库SHA256 8B1D0783E10EC18191AF900AC3DA632006037D0A61E0518C4AB005C3F5F8C9C2，为本机非官方修正，不能称官方发行修复。

## 剩余与交付边界

本轮合成项目与会话数据目录分离；两者重合时快照可能包含自身日志并触发新鲜度拒绝，尚未完成自然项目目录布局收口。不能以本轮成功覆盖该缺口。

固定cmd exit0探针证明该候选的实际AppContainer/Job启动、退出与输出收束，不等于穷尽ACL、绝对路径逃逸、网络和真实构建工具链的隔离验证。私有候选显式包含DLL，不代表正式安装包已具备并验收。exited是进程事实，页面尚缺独立后处理状态。跨进程资源接管、创建profile崩溃窗口、全量Electron/安装态、其他平台、真实构建测试报告及Git链仍待完成。

未提交、推送、安装、发布；并发模型中心、构建钩子和其他公共文件改动未纳入本批验收。目标保持实施中。
