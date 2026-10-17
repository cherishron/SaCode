# F08 异步写回接入约定（2026-10-17）

本页登记当前工作区写回契约。四个动作已接入ExecutionApi、Host、CLI和有限IPC；当前为未提交实现，不代表安装态或发布。真实运行证据另登记到evidence。

## 有限动作与身份

- execution/review-prepare：sessionId、executionId、revision、requestId、paths。从已有审查对象构造不可变提案，返回applyId与精确审批正文；不执行文件写入。
- execution/review-apply：sessionId、applyId、approvalId。消费本批精确一次票；开始事实持久化成功后再返回。文件处理在受监督异步任务中运行，不能阻塞Host读循环。
- execution/review-apply-describe：sessionId、applyId。只读同一日志中批次及逐文件结果，不以任务句柄存活替代持久结果。
- execution/review-apply-stop：sessionId、applyId。请求停止后续文件；已进入提交的单个文件必须先结算，回执不宣称整个批次已取消。

prepare字段必须恰好5项；apply恰好3项；describe/stop恰好2项。sessionId必须等于当前会话；额外sourceDirectory、对象根、writer等字段拒绝。错误统一经执行错误面返回，核心保留bad-review-apply-arguments、revision-conflict、not-authorized、workspace-changed、persistence-failed等具体原因。

原执行修订、当前源工作区修订、目录身份、审查摘要和所选对象绑定在不可变提案中。请求不得传来源目录、库路径、内容对象根或任意writer。审批仍使用已有approval/ask与answer，执行审批与写回审批不可复用。

## 生命周期

Host必须保留当前写回句柄并在退出时等待明确收束；断连不重复写入。开始前完成去重与持久屏障；重复apply读取既有状态或明确拒绝再次启动。恢复只有事实投影，未结算意图为unknown，不重新执行。

同一ExecutionService的短期令牌只标识当前活动批次；状态真源仍是SessionLog。CLI使用同一核心：准备、显示完整提案、独立确认、应用、读取实际结果。页面关闭只取消订阅；停止为单独动作，迟到结果必须匹配会话和applyId。

## 完成判据

真实Host运行中仍能describe/stop；CLI同场景得到一致逐文件结果；越权、重复点击、工作区变化、源文件并发改动、持久失败与重启unknown均有证据后才能开放页面写回。原生库缺失或目录身份不支持时拒绝写回，不影响只读预览。不得将当前核心测试通过写成上述双入口验收已完成。


## 双入口与页面

CLI命令：job review-prepare、review-apply、review-apply-describe、review-apply-stop。除apply之外与RPC字段一致；CLI apply只收sessionId/applyId，读取持久提案后在当前进程单独询问y/N，再生成精确一次票，拒绝调用方传入旧票。已有结算只回放、不再次询问或写入。

桌面有限通道：executionReviewPrepare、executionReviewApply、executionReviewApplyDescribe、executionReviewApplyStop。页面从任务差异选择文件，先展示精确提案，再由明确按钮确认。审批与模型的自动工具执行分开；请求失联不显示虚假成功，保留批次以查询。旧缺少源目录身份的审查记录只有预览。

Host在途写回保留同一ExecutionService/WriteLease；读状态和停止可进入，其他副作用与切会话受阻。EOF先请求停止、最多等待5秒收束；不能确认时保留租约并报告executionSettled=false，不宣称写入结束。恢复不按PID或旧许可重新执行。

原生库必须是实际exe目录下的sacode-windows-process.dll；当前仅Windows真实验证。测试私有载荷显式包含本轮DLL，不据此宣布默认安装载荷已验收。Linux/macOS返回review-platform-unavailable，旧预览能力保持独立。

## 原工作区与私有执行目录（本轮装配增量）

执行提案cwd可保留原工作区，execution/workspace-snapshot另登记executionDirectory。WindowsSnapshotExecutionProvider仅从持久快照和当前ExecutionService取得物理目录；核对完整提案、sourceIdentity、源/执行目录和快照摘要，必须存在当前启动状态/租约/令牌后才能映射。恢复不构造提供方或重放命令。旧提案cwd已是私有目录的日志继续只读兼容；这不代表默认Host生命周期已接通。

## 可信结束阶段（非RPC回调）

ExecutionSupervisor.onSettled仅供编译期可信装配，在真实退出、完整输出及结束事实持久化后运行。WindowsSnapshotSettlement先登记审查对象，再登记resources-release-begin并释放私有资源，最后resources-released；后处理失败另记settlement-failed，不抹除实际进程退出。详细实测及默认入口未接边界见[结束阶段证据](../evidence/2026-10-17-execution-snapshot-settlement.md)。

## 2026-10-18 默认入口装配增量

Host准备工厂与CLI job run现已接入同进程胶囊所有权；普通CLI propose不分配资源。旧持久快照不据此恢复可执行能力。EOF真实停止链已补入，前文描述仅以本轮代码与[双入口证据](../evidence/2026-10-18-execution-capsule-entries.md)为准。job run成功返回0，实际命令失败返回其正退出码，其余异常返回1。项目/会话目录重合及完整桌面/安装态仍待验。

2026-10-18增量：快照可信装配可排除当前实例实际日志、租约及对象存储相对路径，排除策略绑定manifestDigest。元数据祖先仍遍历用户文件；任务伪造受保护输出时拒绝差异导出。该参数不对RPC/CLI调用者开放，具体边界及实测见[同目录证据](../evidence/2026-10-18-colocated-execution-metadata.md)。
