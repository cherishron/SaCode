# 任务正文预览双入口验证（2026-10-17）

基线 5c22a3631ec629f0056f377549e6250be5bc082e，含本轮未提交增量。上一轮完成持久任务清单；本轮继续接正文读取，不开放原项目写回。

## 接线与判据

新增 execution/review-file，沿用 ExecutionApi/ExecutionService 的执行身份与日志权威，输入只允许 sessionId、executionId、revision、path、side。路径必须命中该任务已登记清单，side 仅 before/after；客户端不能传 attachmentId 或磁盘路径作为授权。对象复用 AttachmentStore 权威读，每次复核摘要；没有的一侧返回 exists=false，空文件为 exists=true/0字节。

Host 只读路由与能力表、CLI job review-file、桌面 executionReviewFile 有限 IPC/preload 同批接线。返回最多 65536 字节，完整字节数/截断事实/对象摘要单列。页面检查会话、执行、修订、路径、侧别、摘要、字节长度；UTF8 截断不显示半个字符，二进制明确提示；完整文本复用 draftDiff 显示有限行差异，截断不计算伪完整差异。标签卸载/会话改变/任务重新读取后丢弃迟到结果。

## 实测

- core/Host/CLI 均用本机修正仓颉1.1.3重新构建，退出0；警告分别24/4/4。日志 review-preview-{core,host,cli}-build.log。
- 真实进程定向最后 Summary TOTAL=24/PASSED=24/SKIPPED=0/ERROR=0/FAILED=0，实际退出0；review-preview-native.log。修改文件为70000字节，返回65536并标truncated；前侧完整，陈旧修订、未登记路径与非法side均拒绝。
- 页面状态/渲染/字节边界/IPC守卫19/19，rc=0：review-preview-ui-final.log。空文件、中文、二进制、截断、错误身份及字节长度、额外对象身份等有断言。
- preload/完整IPC集合/固定动作3/3：review-preview-bridge-v2.log。首次白名单因新key排序错误1红，按字典序修正后3绿；没有删白名单断言。
- 本轮Host真实stdio读前后对象，与原真实任务的持久对象逐字节比较；未登记路径、旧修订、非法side及故意损坏的私有对象副本拒绝。组件通过实际 registerExecutionIpc handler 调到真实Host，逐文件点击正文预览，真实退出0：review-preview-real-ipc.log。损坏仅施加到独占夹具副本，并在finally还原。
- 同一任务副本执行真实CLI job describe / job review-file：6侧读取与1拒绝检查通过，实际退出0：review-preview-real-cli.log。
- 页面打包成功；Host门禁11项和13变异自检通过，IPC门禁8项通过。Host当前能力172/IPC143；HEAD实际171，冻结分母由历史169修正为171，仍核对全量集合与HEAD不减能力；新接口提交后须同步更新冻结分母。机器能力表仅在他方已同步的171项中追加本轮读动词。
- 指定改动git diff --check通过。产物守卫仍13项/6失败，既有outputs/core/core及各模块落点未删除、不纳入本轮完成声明。

所有上述日志前缀 target/tmp/windows-adapter-20261017-1f3b/。Host记录来自真实任务日志，不伪造execution/state；Host与CLI验证目录 target/tmp/task-review-host-xs6LO0/。该验证是历史任务正文回放，不代表Host默认快照执行已开放或完整Electron验收。

## 指纹

```json
{
  "native": {
    "version": 1,
    "passed": true,
    "timedOut": false,
    "exitCode": 0,
    "expectedTests": 24,
    "neutral": "D:\\Temp\\SaCode-Windows-Adapter-Verification\\windows-adapter-20261017-5b8b4470fd574517b9ec0152bacd28b2",
    "coreLibrarySha256": "8B286111F2D102D4B539684BE7125F9621097997AD3240971F2ECE83F525D76D",
    "adapterSourceSha256": "374F80944A9CCE82F98E10AF0C65D571F29FEBD99449242A546297169BF45CC8",
    "processProviderSourceSha256": "D108BF90B9C3490E6EB2429DE834B4699D95B5AE87A180B8CEABC160C419DDEB",
    "executionServiceSourceSha256": "CD57596ECE2C97AA381AD20187422669CA9CB8E0FB50530AD14A025C01245648",
    "executionApiSourceSha256": "C8A5B249156D1A70ED83725401FC85121ABD7797959EB17C771E4D18C677070C",
    "supervisorSourceSha256": "C28957629867E04B54158F54ED9EE5703996E9E19EA45F51EB4F56FBACC93EFF",
    "workspaceAdapterSourceSha256": "536D8CAA761ABAC0B0819442C3DC5CD76719A91F1E36C6C5871F8519F0F5136A",
    "workspaceSnapshotSourceSha256": "1A990380D5B0043742A5D90F20CE5706465D5393455561FECCA5CB1F4C719345",
    "nativeTreeSourceSha256": "B2BF10C20770FB5B04FD136843B938A5E51C487C8B9F6028E75BB6713F644027",
    "nativeTreeHeaderSha256": "C3248F2A04D72397EAA0E412E9924BAF966CDC020222C504121DEDCFAF7D8839",
    "snapshotLinkFixtureSha256": "7AA4F1E38476417EE7B04309FABC2CF3CE6AC22E70ACFE79872C8A2F06CC1193",
    "fixtureCleanupScriptSha256": "41FFADF144EDCC2F42ABBFBB7CD301FB75E2813AC568BDD6B1DD5396BC5D04FF",
    "testSourceSha256": "8028C1D8A52EEF36B56C0E7B4F41AA59ECD57C58EA5D316E70896CC54D0C769F",
    "nativeDllSha256": "F980741699F9677F91892B498D154F50F1967453AAA92E13B5CAAEB81D94DD27",
    "runtimeSha256": "8B1D0783E10EC18191AF900AC3DA632006037D0A61E0518C4AB005C3F5F8C9C2"
  },
  "host": {
    "passed": true,
    "executionId": "execution-2",
    "files": 3,
    "sourceLogSha256": "e4bbce05dcf2cb1970e7a17ea80f2ed3a5bf9c0d3157007359256b4151ca6958",
    "hostSha256": "aac8e60de5a2327db2d0dfcbe2adabaf636d0c5cfe64b3e89012b054310cf00b",
    "reviewSha256": "bae19ea7389944cdeda5776aaee591f33bb6131b162d45c088c7924443654546",
    "rendered": true,
    "previewed": true
  },
  "cli": {
    "passed": true,
    "checks": 7,
    "executionId": "execution-2",
    "cliSha256": "1036b4199d4cfae2b045e29836bd8571bcd06aeff1241104639d789375c20a27"
  },
  "reviewSourceSha256": "3b7ab5f69ab54610df00efd7ea654253dd52748ed6f2dfbd2d42d73eb6b60e22"
}
```

## 未完成

仍需接独立写回提案/审批、CAS保护用户后来修改、文件与hunk选择及实际原子应用；当前按钮只读预览，没有写盘入口。Host快照执行生命周期、网络/逃逸验证、默认安全桌面/安装态及其他平台仍待完成，D14及整个产品目标保持未完成。历史5秒输出超时未定位，本轮不宣称根治。未提交或推送。
