# F02/F04 精确文件审批与目标完成增量

## 范围与基线

本批在 `refactor/dsh-learning` 上工作，不创建分支、不暂存或提交。HEAD 在并发成员提交中由 `cec503b` 推进至 `a7e1470`；冻结记录见本轮私有 manifest，不能把测试运行后的 HEAD 当作旧产物的构建 SHA。

沿用此前已验收核心及双入口产物：CLI `target/cli-fast-cancel-5737d91b852d4537957ae7e0ab102fea/sacode.exe`，SHA256 `afed7c1798220ff94283c3aff9152c11e824f3dc16fce283176324de2b701f54`；核心 `target/sse-cancel-fix-574890a535ae429289de0fb1dbbd70d0/core-lib/libcore.a`，SHA256 `b77ab8e6f73340bb333d947f697f1356ffebbefbdffe5067f71af615074a59ec`。当前并发 SSE 计费、Batch CLI 和团队模块增量没有包含在这些已验收产物中，最终统一交付仍需重新构建。

本机 HTTP 服务使用真实 SSE/工具协议，工具调用真实执行并落盘；模型响应由明确的协议夹具提供，不是远端真模型验收。所有写入只在私有测试目录。PATH 只含 System32，程序依靠同目录运行库，不依赖 SDK 路径。

## CLI：八个场景通过

命令：指定上述 SACODE_CLI 后使用 `C:/Users/jingg/.codearts/runtimes/node/node.exe apps/desktop/test-support/goal-cli-verify.mjs`。最新运行真实退出 0，输出 GOAL_CLI_PASS，原件 `apps/desktop/.tmp-test/goal-cli-proof-ePQDkl`；此前仅文件结果断言的增量运行在 `goal-cli-proof-2eBUEd`，最终采用补齐修订/轮次日志断言后的 ePQDkl。

场景为 complete、approved-write、budget、claim-only、denied-write、freeze、missing-provider、invalid-budget，8 项均 passed。保留既有预算、只有声明无证据、拒绝写入、持久失败冻结/租约保留、缺提供方及非法预算判据。

approved-write 等待 CLI 实际输出完整审批提案与“允许一次”提示，再核对工具名及 JSON 参数；仅该明确提案回复 y。文件 `approved-result.txt` 内容逐字等于 `明确审批后的真实文件结果\n`（末尾实际换行），程序退出 0，describe 投影为 complete。日志恰有一次 approval/asked、一次 1:allowed-once；claim 为 goal-1/revision=1/round=1/status=completed，机械 evidence 为 revision=1/round=1。describe 不产生第二次模型请求。

这证明已验收 CLI 目标链可因真实、精确审批的文件结果加同轮声明自动完成，不仅是 todo 夹具通过。不证明 Shell、AppContainer、完整桌面或最新全部源码已通过。

## Host：红灯与通知修复

对旧固定 Host `11c62f75954f326a3e4b9ed2230fa9e99a038928ffcc2df69621b562f1d8a637` 运行新增 approved-write 场景，真实退出 1；`apps/desktop/.tmp-test/goal-host-proof-zofDlV` 保存 RPC/请求记录。断言在 approval/asked 缺少 sessionId 时失败，未回答 allowed-once；清理取消任务后 Host 退出。

原通知只含 approvalId/tool/source，不足以向用户展示完整动作参数。apps/host/src/main.cj 本批仅冻结 modelSessionId=activeId 并向通知增加 sessionId 与完整转义 argumentsJson；参数绑定、一次性消费、取消及状态仍由既有核心审批制度负责。变更前文件 `target/host-file-approval-594f084e72e543b3b95d8292be52b7f7/main.before.cj` 与行级差异隔离本批，不覆盖其他共享修改。契约已登记新版接口文档和 W00。

第一次全目录 Host 增量构建退出 1，build.log 记录并发新增 team_runtime.cj 引用旧核心未提供的 TeamMemberRunner 等类型；这是新 Host 全部源与旧核心库不匹配，不是通过。随后隔离原已验收三个 Host 源文件和本批审批通知增量，以固定核心库进行独立构建；其 manifest-increment.json 精确列出源、库及 cjc 命令。最终统一构建必须另外包含团队、Batch、SSE 等最新核心与双入口源，不能用这次隔离构建代替。

Host 增量编译已真实退出 0，build-increment-exit.json 记录 2026-10-08T10:11:44.868Z，固定产物 `bin-increment/sacode-host.exe` SHA256 `8088faaa9ba555ad0fa908ce76ccf1c7f2fe1377528f697309b86659356793a7`。未重启编译或把观察超时当作退出。

新 Host 六场景 complete、approved-write、budget、claim-only、freeze、cancel 全部通过，命令日志 host-test.log、真实退出 host-test-exit.txt=0，原件 `apps/desktop/.tmp-test/goal-host-proof-OnfzKc`；取消到终态 2112ms，小于 5 秒。持久失败保留租约的 stderr 是预期冻结场景，不是被忽略的错误。

补充保存每个场景的完整 RPC 和审批通知后，从私有冻结 host-fixture 复跑 approved-write，真实退出 0，原件 `apps/desktop/.tmp-test/goal-host-proof-5lRgMf`；approval-proposal.json 包含 current 会话、write、完整 path/content 参数；rpc.json 记录唯一 approval/answer accepted=true。真实文件内容相同，goal/claim 与 goal/evidence 都是修订 1、轮次 1，goal 为 complete；重新启动后 describe 不发新模型请求。

`python target/host-file-approval-594f084e72e543b3b95d8292be52b7f7/compare-file-proof.py` 真实退出 0：比较两入口文件字节、日志中的 claim/evidence、目标状态、Host 提案及唯一批准回执，dual-file-results.json 为 passed=true。两入口文件 SHA256 同为 `8ec3d0b8ff8ba2735b9d2a550a73305e449cf99327b8fdf221046213c2f21e4f`。

正式 Electron 页面仍被原生窗口站拒绝访问阻塞，执行门禁保持关闭；本文件不升级 F02/F04 为完整通过。期间当前源码推进至 bf68db6，旧已验收 150 源比较出现 agent/model_tool_runtime/SSE/Host/CLI 五处漂移；它们及新增模块必须在最终统一构建重新验证，不拿本次固定产物冒充全部最新源码。

## 桌面消费端后续增量

本报告初次核查时，turnPoll 未消费模型审批通知，手动审批路径可能二次调用工具。后续已新增独立模型审批消费层，绑定会话和 task/start 信封身份、展示完整 argumentsJson，只回答原票，不重复 callTool；切换、停止和迟到回执按身份与代际保护。状态及实际 renderer 分支 14 项通过，最新任务身份 Host 集成仍在验证，见 [桌面模型审批消费证据](desktop-model-approval-consumption-2026-10-08.md)。这些增量仍不能替代保持 sandbox 的真实 Electron 页面与最终统一产物验收。
