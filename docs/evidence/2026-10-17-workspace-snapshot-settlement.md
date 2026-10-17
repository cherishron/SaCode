# 快照导出的执行终态绑定（2026-10-17）

基线提交 5c22a3631ec629f0056f377549e6250be5bc082e，本轮仍为未提交工作区。上轮快照基础证据见 2026-10-17-windows-workspace-snapshot.md，不覆盖原记录。

## 实施

新增核心可信入口 WindowsWorkspaceSnapshot.settledChanges，读取同一 SessionLog 的权威 ExecutionService 状态；要求当前修订及提案匹配、会话/任务/请求匹配、phase=exited、exitObserved=true、outputComplete=true。随后核对该执行唯一快照回执的版本、manifestDigest、proposalDigest、源/执行目录和 workspaceRevision，再执行来源新鲜度检查及只读增删改导出。不把退出码非零的现场差异丢弃，也不将差异视作成功或自动合入。

未持久快照绑定、未结算/未知执行、陈旧调用及绑定冲突明确拒绝。低层 changedFiles 仍为包内辅助，公共 Host/CLI 没有开放该接口。终态语义继承共享监督器：根进程退出但后代未收束时应结算 unknown，不能拿该入口补造退出事实。

## 实际验证

本机修正运行库的仓颉 1.1.3：core cjpm build --target-dir target/tmp/appcontainer-core-rebuild-20261017-6b281f0a/build，rc=0、24 warnings。日志 target/tmp/windows-adapter-20261017-1f3b/snapshot-build-v6.log。

脚本 scripts/verify-windows-process-adapter.ps1 使用本轮 core release：实际退出 0，最终 Summary TOTAL=23、PASSED=23、SKIPPED=0、ERROR=0、FAILED=0。日志 target/tmp/windows-adapter-20261017-1f3b/snapshot-verify-v6.log。

正向实际任务验证三条文件差异，当前日志与从磁盘重新加载的日志均能读取；只读导出不追加事件。待审批与已准入旧状态导出拒绝。测试总数保持 23，增加的是既有真实任务场景内的断言，不虚增独立用例数。

```json
{
  "version": 1,
  "passed": true,
  "timedOut": false,
  "exitCode": 0,
  "expectedTests": 23,
  "neutral": "D:\\Temp\\SaCode-Windows-Adapter-Verification\\windows-adapter-20261017-1c268dd4e32a444db2db65c8a82c6b58",
  "coreLibrarySha256": "7208F541EA27E789C6CF7CECFDE952238BB918D09CE10282C24A49FB62F230E2",
  "adapterSourceSha256": "B12F33D6078828D55633E7379F9780C24D6588B19942D6DB540E325FE2044E74",
  "processProviderSourceSha256": "D108BF90B9C3490E6EB2429DE834B4699D95B5AE87A180B8CEABC160C419DDEB",
  "supervisorSourceSha256": "C28957629867E04B54158F54ED9EE5703996E9E19EA45F51EB4F56FBACC93EFF",
  "workspaceAdapterSourceSha256": "536D8CAA761ABAC0B0819442C3DC5CD76719A91F1E36C6C5871F8519F0F5136A",
  "workspaceSnapshotSourceSha256": "44E01C6141C02FE833D72429D7C29EF8A5ABC4FA443EC20015E8447EFAE866E8",
  "nativeTreeSourceSha256": "B2BF10C20770FB5B04FD136843B938A5E51C487C8B9F6028E75BB6713F644027",
  "nativeTreeHeaderSha256": "C3248F2A04D72397EAA0E412E9924BAF966CDC020222C504121DEDCFAF7D8839",
  "snapshotLinkFixtureSha256": "7AA4F1E38476417EE7B04309FABC2CF3CE6AC22E70ACFE79872C8A2F06CC1193",
  "fixtureCleanupScriptSha256": "41FFADF144EDCC2F42ABBFBB7CD301FB75E2813AC568BDD6B1DD5396BC5D04FF",
  "testSourceSha256": "1703F668969E6A1599CF7ED24A828B5E6E939C018796B1302578CD5548269166",
  "nativeDllSha256": "F980741699F9677F91892B498D154F50F1967453AAA92E13B5CAAEB81D94DD27",
  "runtimeSha256": "8B1D0783E10EC18191AF900AC3DA632006037D0A61E0518C4AB005C3F5F8C9C2"
}
```

## 下一步与限制

产品审批必须展示原目录、私有执行目录、排除范围和快照摘要，并将其绑定到一次性审批。还需任务启动前复核、任务差异登记/F08 审查及 CAS 写回；默认执行门禁保持关闭。此结果不代表三个主页面、七类资源或完整产品目标完成。上轮一次 5 秒超时的原因仍未定位，不能因本轮通过将其删除。
