# Windows 逻辑工作区与私有执行目录映射（2026-10-17）

基线5c22a3631ec629f0056f377549e6250be5bc082e，未提交工作区增量。本轮修正生产装配前置断点：会话工作区不能为了执行私有副本而先切换目录。

## 实现

新增包内WindowsSnapshotExecutionProvider。执行提案cwd保持用户原工作区；独立execution/workspace-snapshot绑定物理executionDirectory、sourceDirectory/sourceIdentity和摘要。提供方构造时核对持久快照与当前提案/任务/请求；消费请求时再次核对完整命令/参数/时间/输出上限，且必须存在starting/stopping、当前启动事实、有效租约与服务端令牌。物理cwd只从可信snapshot.destination取得，实际进程使用服务端令牌，不接受调用者另造令牌绕过停止。

恢复前仍核对会话工作区目录/修订及源快照新鲜度；不以环境变量或调用参数提供另一份cwd。逻辑目录保持不变，原文件只读；命令的相对路径在私有副本解释，审批仍绑定源目录、物理目录及摘要。旧cwd已经是私有目录的快照继续读取兼容，不伪称其原设计已完成生产装配。

ExecutionService与快照record接受源cwd/旧物理cwd的已绑定形状；前端同批消费逻辑cwd，必须有48位源目录身份，并拒绝审查清单换用别的实体。原生库和profile/工作区所有权依旧由可信装配调用方持有，本类不新建任务队列。

## 验收

真实DLL与仓颉定向：TOTAL=42/PASSED=42/SKIPPED=0/ERROR=0/FAILED=0，实际退出0，未超时。新增snapshotProviderKeepsLogicalWorkspaceAndRunsOnlyInsidePrivateCopy：真实cmd受监督进程只改私有副本input.txt，会话原目录/修订1不变、原文件ORIGINAL不变；从真实结束事实登记一条差异。未审批有效形状请求及直接传物理目录请求均拒绝，随后同一提供方经真实精确审批和启动屏障可正常执行。

前端27/27、零跳过，新增逻辑目录展示、缺身份/错误目录拒绝、旧快照兼容、审查实体失配拒绝；pack-pages通过。

命令：scripts/verify-windows-process-adapter.ps1 -CoreRelease target/tmp/appcontainer-core-rebuild-20261017-6b281f0a/build/release -DestinationRoot D:/Temp/SaCode-Windows-Adapter-Verification。

最终报告：target/tmp/windows-adapter-20261017-a90a8d428e804badb79759f5a6d332aa/verification.json（包含核心库、SDK运行库、DLL、映射/服务/快照及测试源码SHA256）。日志前缀target/tmp/windows-adapter-20261017-1f3b/：snapshot-mapping-native-test.log、snapshot-mapping-ui-full.log、snapshot-mapping-pages.log。

构建失败原件保留：snapshot-mapping-core-build.log首次误用本地提供方不存在的close方法，已改调用实际cleanup；-v2.log捕获并发会话引入的processProvider不可变let后赋值；仅将该局部改var，保留对方完整实现；-v3及最终-v4.log均核心构建成功，24 warnings。未清警告或改测试期待凑绿。

## 并发与边界

另一会话15:03在windows_process_adapter.cj及execution_api.cj加入SACODE_WINDOWS_ENFORCING与环境DLL路径分支，本线不认领或回退。其资源所有权、就绪判据和默认入口集成未由本批证明；不能将其存在等同于本映射已装入Host。

核心库构建于15:07；运行42项前发现request_trace.cj及其测试被其他会话15:51/15:52更新。映射、执行服务、快照和适配器本批相关文件没有在库后更新，指纹登记于最终报告。因此这是所记录核心库的定向证据，不能扩大成当前所有未提交源码全量通过。

尚未接通默认Host/CLI的快照创建、资源所有权/清理及结束后自动审查登记。旧41项阶段的Host/CLI真实17项证据不证明新逻辑cwd已进入那些旧二进制；下一轮需重建。默认执行生命周期、完整Electron与安装态、跨平台仍未完成；D14及整体目标不解除。未提交/推送、未安装、未改用户配置或原项目。
