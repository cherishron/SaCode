# F08 双入口与页面实际写回（2026-10-17）

基线5c22a3631ec629f0056f377549e6250be5bc082e，含未提交工作区增量。此前只有内部写回能力；本轮接通有限动作及当前页面组件，未把默认执行隔离门禁升级为开放。

## 产品链

ExecutionApi新增execution/review-prepare、review-apply、review-apply-describe、review-apply-stop；专用ExecutionReviewApi逐字段解析，不接收目录/对象根/任意writer。prepare从真实审查清单构造不可变提案；apply只消费该提案精确一次票，已有结果只读回放。读侧返回持久投影，待审批时返回精确approvalArguments；完成后不再返回可消费审批正文。

Host写侧注入与读预览相同的AttachmentStore根attachments/v1，保存ReviewApplyRun句柄；异步开始后仍可查询和停止。活动写回期间阻止切会话和其他副作用；EOF请求停止并等待5秒，未收束则executionSettled=false、保留租约。公共动作仍受既有turnBusy/持久冻结/会话身份限制，不绕过执行服务。

CLI job review-apply只接受sessionId/applyId，先读取并显示完整提案，再y/N确认；本进程生成新精确票，不接收上次进程的票。拒绝时未写文件；完成后的重复请求只回放不再次确认或写入。

差异审查TaskReview接ReviewWriteback：勾选文件→生成提案→显示精确正文→明确确认→同核心写回。页面校验会话、执行修订、目录身份、所选前后对象及回执文件状态；切会话/隐藏/卸载后的迟到审批不继续下一步副作用。请求失联清除待审批假象，保留批次用于刷新；关闭页面不自动停止已开始的服务端写回。旧记录无目录身份只有预览。

## 本轮验收与指纹

1. Host、CLI单成员私有target构建均cjpm build success、各4 warnings。review-api-host-build.log / review-api-cli-build.log。首次单独核心构建也成功；后续Host依赖构建重新纳入最终ExecutionApi路由。最终核对core/src没有晚于该libcore.a的源文件。
2. 本轮Host依赖核心库运行真实DLL定向：TOTAL=41/PASSED=41/SKIPPED=0/ERROR=0/FAILED=0，实际rc=0、未超时，总127.748秒。新增共享API参数拒绝、异步审批/真实新增写入、重复启动无新worker、跨会话停止拒绝。最终verification.json位于target/tmp/windows-adapter-20261017-2c7d53ce4ee54ecb9397013e6c10508e/。
3. 页面纯状态/回归24/24；桥接有限面与新IPC守卫4/4；无失败/跳过。pack-pages及app/preload/IPC语法检查通过。
4. 真实页面组件→实际registerExecutionIpc→新Host，加CLI独立用户命令：17项通过。使用上述原生用例真实执行留下的日志和对象，不制造execution/state；原项目是本轮target/tmp独占合成项目，先验证旧字节。页面明确确认后实际修改src/main.txt；CLI先拒绝（零写），再独立确认实际新增added.txt及删除empty.txt。错误工单/执行票挪用/陈旧修订/多余目录参数拒绝；幂等prepare与完成后重复apply均不重复写；Host正常EOF报告executionSettled=true；CLI可读取Host持久结算。
5. Host方法门禁11/11（当前176、冻结HEAD171）；IPC8/8（147↔147）。前序白名单失败源于新增名未按字典序排列，修正后完整有限面复绿，不删除断言。
6. 产物放置门仍13项中6项失败：既有outputs/、core/core/、三入口build钩子及成员缓存/target、desktop/target。不认领或删除他方文件，本批新增运行输出全部target/tmp，未宣称全仓门禁绿。

真实入口驱动：apps/desktop/test-support/verify-review-apply-entries.mjs。该脚本拒绝复用已改变的合成源文件，不重置文件来凑通过；再次运行须使用新一轮真实原生夹具。

日志统一前缀target/tmp/windows-adapter-20261017-1f3b/：review-api-native-test.log、review-api-ui-v2.log、review-api-bridge.log、review-api-host-gate.log、review-api-ipc-gate.log、review-api-pages-v2.log、review-api-real-ui-entries.log。首次入口驱动误以为HostBridge.start返回initialize结果，在任何写入前失败；已保留review-api-real-entries.log。修正为显式initialize后，纯双入口16项通过（review-api-real-entries-v2.log），再以新真实夹具增加页面驱动17项通过；不同范围不混算。

最终真实组件/双入口报告：target/tmp/review-apply-entry-A6Kuvi/verification.json。
Host SHA256：778d10b46f2f1a173627ff16f9ed4e68cf36d1b262804d5a6e35fe3747e0ff0a。
CLI SHA256：cc2c79b9bf6acee5ee652aa4b57c5b097b769cb0c7a0b2c281772a07860f14e5。
核心库SHA256：2E4BCE3739431889E97D9EA49CD2E7644DE98D621B0DB8087EB608C1069D4E9D。
运行库为本机非官方修正仓颉1.1.3，SHA256：8B1D0783E10EC18191AF900AC3DA632006037D0A61E0518C4AB005C3F5F8C9C2。

私有载荷通过pack-host显式加入.deps/native/win32-x64及修正SDK/stdx运行库，再以export-windows-artifact字节导出到D:/Temp/SaCode-review-apply-{host,cli}-20261017-v1（不安装、不改ACL或用户配置）；对应.manifest.json留存字节证明。

## 尚未收口

本轮是真实组件运行但不是完整Electron窗口、默认dist或安装态。核心确定性夹具证明提交中停止及时返回；真实Host本轮只验短任务完成及终态stop，不将其冒充Host在途停止/异常EOF长写实测。历史批次重开导航、自动轮询、hunk选择、默认Host私有快照执行生命周期与正式载荷装配仍需完成。单文件条件写不是多文件或断电原子事务。Linux/macOS写回未实现，缺DLL明确失败。F08仍部分完成，D14及整体目标未解除；未提交/推送/安装/发布，未发送模型或收费请求。
