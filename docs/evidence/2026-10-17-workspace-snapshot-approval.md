# 快照审批与启动前复核（2026-10-17）

基线提交 5c22a3631ec629f0056f377549e6250be5bc082e，本轮未提交增量，修改前 execution_service.cj、execution_api.cj、execution-task.ts/state.ts 与原 execution-task.test.mjs 无工作区差异。归属登记在 W00；本轮新增 snapshot-approval-ui.test.mjs。

## 实施

ExecutionService.workspaceSnapshot 从同一会话日志读取绑定回执，核对执行/提案摘要、会话、任务、请求、执行目录及工作区修订，冲突拒绝。存在快照时 approvalArguments 在原提案字节后附加整份回执 SHA256；无快照时保留原审批字节。authorize 消费精确票后，在日志锁内再检查审批内容未变，避免消费与状态更新之间插入新的快照绑定。

ExecutionApi 的任务投影增加 workspaceSnapshot 字符串（无快照为空）。执行页面以此显示原工作区、私有执行目录、摘要、条目/字节数与实际排除路径，并声明写回仍需独立差异审查授权。响应绑定错误或后续替换已绑定快照时页面拒绝，不用原始回执 HTML。

WindowsExecutionProcessProvider 增加可信 beforeResume 回调；它在创建回执后、恢复挂起线程之前执行。快照任务装配在此重新校验来源，变化则停止并清理进程，不能执行命令。默认 Host/CLI 仍未装配此提供方，不修改门禁。

## 验证

- core cjpm build，使用本机修正的仓颉 1.1.3：rc=0，24 warnings；target/tmp/windows-adapter-20261017-1f3b/snapshot-build-v8.log。
- scripts/verify-windows-process-adapter.ps1 使用本轮 release：实际退出 0，最后 Summary TOTAL=24/PASSED=24/SKIPPED=0/ERROR=0/FAILED=0；snapshot-verify-v8.log。
- 实际快照任务证明：增加快照前取得的票在增加快照后被拒绝，仍停留 awaiting-approval；新票可执行；ExecutionApi 投影的快照与审批字节一致。源文件在审批后变化的独立用例证明私有 result.txt 未创建、用户新内容保留。
- 页面命令 node --test --test-name-pattern '^(?!真实 Host)' apps/desktop/test/execution-task.test.mjs apps/desktop/test/snapshot-approval-ui.test.mjs apps/desktop/test/git-action-ui.test.mjs：13/13，rc=0；snapshot-ui-v8.log。这里是页面状态/渲染树消费测试，显式排除真实 Host 用例，不能代替桌面端到端验收。
- git diff --check 通过。

以上日志均在 target/tmp/windows-adapter-20261017-1f3b/；指纹如下。

```json
{
  "version": 1,
  "passed": true,
  "timedOut": false,
  "exitCode": 0,
  "expectedTests": 24,
  "neutral": "D:\\Temp\\SaCode-Windows-Adapter-Verification\\windows-adapter-20261017-a67899dd5afa44b69e267e9a91555f0b",
  "coreLibrarySha256": "D32E21CEB0D7F098EEBBE87C95C5C0503D133A90A2E5DA15D60A08A4B2B1261F",
  "adapterSourceSha256": "374F80944A9CCE82F98E10AF0C65D571F29FEBD99449242A546297169BF45CC8",
  "processProviderSourceSha256": "D108BF90B9C3490E6EB2429DE834B4699D95B5AE87A180B8CEABC160C419DDEB",
  "executionServiceSourceSha256": "A44D874F4AC476A3923BF2298763F72F6F8FE91F2B04F49706BBDED5B5B7D4F7",
  "executionApiSourceSha256": "327910522B8AEEAFA437BCB571D870F19BE1B0C2508B71DBDDF3E9D32350AB50",
  "supervisorSourceSha256": "C28957629867E04B54158F54ED9EE5703996E9E19EA45F51EB4F56FBACC93EFF",
  "workspaceAdapterSourceSha256": "536D8CAA761ABAC0B0819442C3DC5CD76719A91F1E36C6C5871F8519F0F5136A",
  "workspaceSnapshotSourceSha256": "44E01C6141C02FE833D72429D7C29EF8A5ABC4FA443EC20015E8447EFAE866E8",
  "nativeTreeSourceSha256": "B2BF10C20770FB5B04FD136843B938A5E51C487C8B9F6028E75BB6713F644027",
  "nativeTreeHeaderSha256": "C3248F2A04D72397EAA0E412E9924BAF966CDC020222C504121DEDCFAF7D8839",
  "snapshotLinkFixtureSha256": "7AA4F1E38476417EE7B04309FABC2CF3CE6AC22E70ACFE79872C8A2F06CC1193",
  "fixtureCleanupScriptSha256": "41FFADF144EDCC2F42ABBFBB7CD301FB75E2813AC568BDD6B1DD5396BC5D04FF",
  "testSourceSha256": "31F93DBC2056B18C2856A32FDB4CD51D58A9A35AC653BDB029AB1532B1C2E5C9",
  "nativeDllSha256": "F980741699F9677F91892B498D154F50F1967453AAA92E13B5CAAEB81D94DD27",
  "runtimeSha256": "8B1D0783E10EC18191AF900AC3DA632006037D0A61E0518C4AB005C3F5F8C9C2"
}
```

## 仍未完成

Host 的真实快照创建/生命周期装配、完整桌面真实 Host 请求、审批弹层最终视觉验收、F08 清单登记与 CAS 写回、网络与逃逸验证、安装态仍未完成。回调校验不是对所有并发文件变化的永久锁定保证；后续差异审查和写回仍必须重新核实源修订。上轮一次输出收集 5 秒超时原因尚未定位。整个产品目标与 D14 保持未完成。
