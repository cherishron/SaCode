# Windows 私有工作区快照与变更导出（2026-10-17）

## 范围

基线 5c22a3631ec629f0056f377549e6250be5bc082e；以下为未提交增量。只实现核心可信装配的快照与只读变更清单，不开放 Host/CLI 默认门禁，不自动合入原项目。

新增 windows_tree.h/.c 有限 ABI 与 windows_workspace_snapshot.cj：固定目录句柄、拒绝重解析和多硬链接读取；固定排除 .git/target/node_modules（各层不区分大小写）。每文件最多 8 MiB、合计 64 MiB、8192 条目、深度 32，超过即失败，不返回部分成功。保留二进制、中文名称和空文件；复制空目录，但导出暂不表示空目录增删。

快照绑定 sessionId/taskId/requestId/workspaceRevision、源/执行目录与清单摘要。record 只接受同一日志中的待审批提案，在日志互斥范围核对当前修订与提案，再写 execution/workspace-snapshot 并持久屏障；相同事实重复调用不重复写，冲突拒绝。来源变化拒绝导出。changedFiles 产生 added/modified/deleted 及前后摘要/新字节，不落盘源目录。整树结束仍由可信调用方保证，当前未提供公共导出入口。

## 命令与真实结果

使用本机修正后的仓颉 1.1.3 与 stdx 1.1.3.1。core 源码构建日志 target/tmp/windows-adapter-20261017-1f3b/snapshot-build-v3.log：rc=0，24 warnings。

执行 scripts/verify-windows-process-adapter.ps1 -CoreRelease target/tmp/appcontainer-core-rebuild-20261017-6b281f0a/build/release -DestinationRoot D:/Temp/SaCode-Windows-Adapter-Verification。
本轮最终日志 target/tmp/windows-adapter-20261017-1f3b/snapshot-verify-v5.log，真实退出 0；最后 Summary TOTAL=23/PASSED=23/SKIPPED=0/ERROR=0/FAILED=0。

在原 16 项基础新增七项：
- 实际私有任务修改/新增/删除、源文件保持不变，二进制/中文/空目录及四个排除路径；快照日志持久回放、重复记录、陈旧修订及审批后拒绝。
- 源内容更新、目标覆盖写、只读源写入、路径穿越、ADS、设备名及重叠源目标拒绝。
- 受保护输出目录导出拒绝。
- 多硬链接拒绝。
- junction 拒绝且失败捕获不得再次变为有效。
- 深度溢出拒绝。
- 超大文件拒绝而非截断。

## 指纹

```json
{
  "version": 1,
  "passed": true,
  "timedOut": false,
  "exitCode": 0,
  "expectedTests": 23,
  "neutral": "D:\\Temp\\SaCode-Windows-Adapter-Verification\\windows-adapter-20261017-c8c739d6e96b4f2b88db40e7378f7200",
  "coreLibrarySha256": "0F73C74B1608563FB1ACB04BB56EA096945BAFF97C37E5CAF39173818D1A6E11",
  "adapterSourceSha256": "B12F33D6078828D55633E7379F9780C24D6588B19942D6DB540E325FE2044E74",
  "processProviderSourceSha256": "D108BF90B9C3490E6EB2429DE834B4699D95B5AE87A180B8CEABC160C419DDEB",
  "supervisorSourceSha256": "C28957629867E04B54158F54ED9EE5703996E9E19EA45F51EB4F56FBACC93EFF",
  "workspaceAdapterSourceSha256": "536D8CAA761ABAC0B0819442C3DC5CD76719A91F1E36C6C5871F8519F0F5136A",
  "workspaceSnapshotSourceSha256": "D998CD3DC2B5E8DEE65F075B8480FDB8E36BC2759138407C303FDA9054367DF4",
  "nativeTreeSourceSha256": "B2BF10C20770FB5B04FD136843B938A5E51C487C8B9F6028E75BB6713F644027",
  "nativeTreeHeaderSha256": "C3248F2A04D72397EAA0E412E9924BAF966CDC020222C504121DEDCFAF7D8839",
  "snapshotLinkFixtureSha256": "7AA4F1E38476417EE7B04309FABC2CF3CE6AC22E70ACFE79872C8A2F06CC1193",
  "fixtureCleanupScriptSha256": "41FFADF144EDCC2F42ABBFBB7CD301FB75E2813AC568BDD6B1DD5396BC5D04FF",
  "testSourceSha256": "422E0123DDF225994F86939F5B3D1B019BA4AB0C4E440E72CBB6182279AA4E46",
  "nativeDllSha256": "F980741699F9677F91892B498D154F50F1967453AAA92E13B5CAAEB81D94DD27",
  "runtimeSha256": "8B1D0783E10EC18191AF900AC3DA632006037D0A61E0518C4AB005C3F5F8C9C2"
}
```

## 失败与剩余边界

原 cmd 删除夹具曾真实 Access denied，独立 DeleteFileW 与显式 PowerShell 删除成功；原因尚未完全解释。正向快照测试明确指定 PowerShell，不是生产执行器自动换 shell，也未放宽 ACL。
上轮 22 项有一次输出收集用例在 5000ms 超时，exit=143；同源码本轮原样复跑 22/22，再补断言后 23/23。暂按未定位的时序失败保留，不能宣称已根治。历史监督线程异常日志同样保留。

当前测试不证明所有目录替换竞态、网络隔离、逃逸隔离、完整提供方或打包态。快照摘要尚未进入产品审批展示与不可变提案合同，任务结束确认、F08 审查/CAS 合入及默认 Host/CLI 接线继续未完成；不能解除 D14。
