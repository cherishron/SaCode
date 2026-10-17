# 任务差异登记与真实 Host 消费（2026-10-17）

## 本轮变化

基线 5c22a3631ec629f0056f377549e6250be5bc082e，以下为未提交工作区。上一轮为进展：快照审批/启动前复核已通过，本轮继续推进 REVIEW-01 与产物身份。

WindowsWorkspaceSnapshot.recordReview 先经 settledChanges 核对共享日志终态和来源，再复用 AttachmentStore.saveFile 保存修改前后对象并通过 read 复核 SHA256；删除保留前对象、新增保留后对象。再次检查来源后，在同一会话日志持久化 execution/review 清单。日志只有文件路径、摘要、对象引用、执行/任务/请求/修订和快照摘要，不含文件正文。对象先落盘、事件后落盘，重复登记相同清单不重复追加；冲突拒绝。失败时可能留下未引用内容对象，不伪称事务性删除。

ExecutionService.review/ExecutionApi.executionDescribe 只读投影持久清单，核对终态、执行修订、提案与快照绑定；不新增万能文件读取。页面新增 TaskReview，通过已有 executionDescribe IPC，按执行身份读取清单，展示文件种类与前后摘要。原编辑器/Git 差异保留，未登记 Git 变化不冒充任务产物。页面校验路径、对象摘要、去重和任务身份；已展示清单不得被迟到响应替换。app.js 只增加 ReviewPage 的有限读回调。

## 验证

1. 当前 core 构建 rc=0 / 24 warnings，日志 snapshot-build-v10.log；当前 Host 构建 rc=0 / 4 warnings，日志 snapshot-review-host-build.log。工具链为本机修正的仓颉 1.1.3，不能称官方原版或安装态通过。
2. 真实进程定向测试最后 Summary TOTAL=24 / PASSED=24 / SKIPPED=0 / ERROR=0 / FAILED=0，rc=0，snapshot-verify-v11.log。实际私有任务产生新增/修改/删除三条；前后对象均可核对摘要，源文件原样、重复清单只有一条，磁盘日志重放与 ExecutionApi 投影一致。测试结束后合法切回原目录，历史清单保留。
3. 页面状态/渲染及原 Git/编辑器回归 16/16，rc=0，task-review-ui-all.log。首次组合页两条旧断言因固定 children 下标偏移失败，已改按实际 props 语义定位；保留原功能断言，并增加损坏对象引用拒绝，不删除断言凑绿。
4. apps/desktop/test-support/verify-task-review-host.mjs 从上述真实任务 runtime-temp 选择唯一含 execution/review 的日志，逐字复制（不构造执行事件），复核文件对象及原项目字节，用当前重编 Host 真实 stdio 请求 execution/describe；3 条清单与持久事实一致，跨会话请求拒绝。TaskReview 渲染树通过真实 Host 回调显示对应路径/来源。实际退出0，task-review-real-host.log。此项是“已执行任务历史 → 新 Host → 页面渲染消费”，不是“Host 启动该任务”或完整 Electron 验收。
5. node scripts/pack-pages.mjs rc=0；指定改动 git diff --check 通过。暂存区为空。

日志前缀 target/tmp/windows-adapter-20261017-1f3b/。

## 指纹

```json
{
  "native": {
    "version": 1,
    "passed": true,
    "timedOut": false,
    "exitCode": 0,
    "expectedTests": 24,
    "neutral": "D:\\Temp\\SaCode-Windows-Adapter-Verification\\windows-adapter-20261017-e957463de8654d4ebb284926ba0fb67a",
    "coreLibrarySha256": "925D5EB059D1CD0836FED3F56563CE7253C8BACBE057D82AAFDD4EC7C92434C5",
    "adapterSourceSha256": "374F80944A9CCE82F98E10AF0C65D571F29FEBD99449242A546297169BF45CC8",
    "processProviderSourceSha256": "D108BF90B9C3490E6EB2429DE834B4699D95B5AE87A180B8CEABC160C419DDEB",
    "executionServiceSourceSha256": "CD57596ECE2C97AA381AD20187422669CA9CB8E0FB50530AD14A025C01245648",
    "executionApiSourceSha256": "1BFFF2ED22652F598E9687B42EFFB4D0830ABDA4C34A86243A094049E4165C97",
    "supervisorSourceSha256": "C28957629867E04B54158F54ED9EE5703996E9E19EA45F51EB4F56FBACC93EFF",
    "workspaceAdapterSourceSha256": "536D8CAA761ABAC0B0819442C3DC5CD76719A91F1E36C6C5871F8519F0F5136A",
    "workspaceSnapshotSourceSha256": "1A990380D5B0043742A5D90F20CE5706465D5393455561FECCA5CB1F4C719345",
    "nativeTreeSourceSha256": "B2BF10C20770FB5B04FD136843B938A5E51C487C8B9F6028E75BB6713F644027",
    "nativeTreeHeaderSha256": "C3248F2A04D72397EAA0E412E9924BAF966CDC020222C504121DEDCFAF7D8839",
    "snapshotLinkFixtureSha256": "7AA4F1E38476417EE7B04309FABC2CF3CE6AC22E70ACFE79872C8A2F06CC1193",
    "fixtureCleanupScriptSha256": "41FFADF144EDCC2F42ABBFBB7CD301FB75E2813AC568BDD6B1DD5396BC5D04FF",
    "testSourceSha256": "89514EDFC4ABAD6B9F31635A773B228BB253FAD941B63762966117DC9B63D791",
    "nativeDllSha256": "F980741699F9677F91892B498D154F50F1967453AAA92E13B5CAAEB81D94DD27",
    "runtimeSha256": "8B1D0783E10EC18191AF900AC3DA632006037D0A61E0518C4AB005C3F5F8C9C2"
  },
  "host": {
    "passed": true,
    "executionId": "execution-2",
    "files": 3,
    "sourceLogSha256": "0c144fbb229dca1973870e381eef65fe3529c47e867d2cc9f4e0cbc12476da16",
    "hostSha256": "ece1a501ed9a8c5c550bfaaf7c479b7d9511d19ce3d3e0d59a93dd6c4eb0d43c",
    "reviewSha256": "079e457eb0d3d5071799ae560374dcc5981b1720e1ffe5e25bb3fdc763834822",
    "rendered": true
  }
}
```

## 待完成

当前页面只有持久文件身份/摘要，正文差异预览、选择文件/hunk、独立写回授权与 CAS 合入尚未接入。Host 默认快照执行生命周期仍未装配，记录登记目前由可信核心集成驱动消费，不能宣称完整产品闭环。真实 Host 本轮投影读取未提供对象正文端点；对象字节校验在真实执行驱动及验证脚本中完成。
完整 Electron 交互、默认沙箱/网络/逃逸、安装态及其他平台待验；D14 不解除。一次历史输出收集超时仍未定位，不因本轮通过抹去。
