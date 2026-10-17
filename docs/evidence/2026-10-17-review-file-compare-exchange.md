# F08 单文件条件写原语（2026-10-17）

基线 5c22a3631ec629f0056f377549e6250be5bc082e，未提交增量。上一轮已完成真实双入口正文预览，本轮继续写回前置。

## 实施边界

windows_tree 新增有限 compare_exchange ABI：只接已固定根中的相对路径和创建/替换/删除三种动作。替换和删除以独占同一文件句柄读取、逐字节比较全部期望旧内容，然后才改变文件；新建使用 CREATE_NEW，拒绝覆盖。拒绝重解析、多硬链接、设备名/路径穿越以及只读树。保留既有8MiB单文件上限。

返回系统错误码和 may_have_changed。第一次可能改变文件的操作前置该标志；错误且标志为真必须结算未知，不能自动重放。成功替换刷新文件缓冲，创建/删除区分空文件与不存在。仓颉 WindowsWorkspaceTree.compareExchange 通过同一库生命周期和对象锁调用，并区分 None 与空字节。

这是单文件受句柄保护的条件写，不是多文件事务或断电原子替换。写入/截断/刷新/关闭过程中仍可能失败；本轮没有验证物理磁盘故障或断电。因此不会开放公共写回，也不能按原子合入验收。后续必须先持久化意图及前后对象，再调用并如实结算可能的部分成功/未知；恢复不重放。

## 实测

- node scripts/build-windows-process.mjs：rc=0，clang -Wall -Wextra -Werror，日志 review-cas-native-build.log。
- 本机修正仓颉1.1.3核心构建：rc=0 / 24 warnings，review-cas-core-build.log。
- 当前源码/真实DLL定向最后Summary：TOTAL=28/PASSED=28/SKIPPED=0/ERROR=0/FAILED=0，实际退出0，review-cas-test-v2.log。
- 新增四组：替换/旧内容冲突及真实独占写句柄占用；空文件的新建/重复新建/删除/重复删除；只读根/穿越/ADS/设备名拒绝；硬链接及junction拒绝。每组拒绝后回读原内容保持不变，所有私有目录仍经既有独立清理后确认消失。
- 首轮测试链接失败：core$test直接引用导入的foreign符号出现 core:CreateFileW / core:CloseHandle 未解析，不是SDK启动崩溃。按cangjie-coding的foreign/CFunc文档核对后，测试改用系统模块中的具名CFunc，使用同一生产声明的Win32签名；二轮通过。日志 review-cas-test.log保留。

日志前缀 target/tmp/windows-adapter-20261017-1f3b/；当前没有本轮在途测试。未修改真实项目文件或其ACL，测试只写独占合成目录；未提交/推送。

```json
{
  "version": 1,
  "passed": true,
  "timedOut": false,
  "exitCode": 0,
  "expectedTests": 28,
  "neutral": "D:\\Temp\\SaCode-Windows-Adapter-Verification\\windows-adapter-20261017-e8a8f88b30be4fbfa9ad6dc87ffd4e29",
  "coreLibrarySha256": "BA459501D0A5F8C519B619E977EDFD7356AB1E5A8806324B957F153EA65C1EC3",
  "adapterSourceSha256": "374F80944A9CCE82F98E10AF0C65D571F29FEBD99449242A546297169BF45CC8",
  "processProviderSourceSha256": "D108BF90B9C3490E6EB2429DE834B4699D95B5AE87A180B8CEABC160C419DDEB",
  "executionServiceSourceSha256": "CD57596ECE2C97AA381AD20187422669CA9CB8E0FB50530AD14A025C01245648",
  "executionApiSourceSha256": "C8A5B249156D1A70ED83725401FC85121ABD7797959EB17C771E4D18C677070C",
  "supervisorSourceSha256": "C28957629867E04B54158F54ED9EE5703996E9E19EA45F51EB4F56FBACC93EFF",
  "workspaceAdapterSourceSha256": "536D8CAA761ABAC0B0819442C3DC5CD76719A91F1E36C6C5871F8519F0F5136A",
  "workspaceSnapshotSourceSha256": "4CD9B8CF070E4BE57E60139D58F4FD6DEF9F400B8CB58263CA04C9A3DFC75E29",
  "nativeTreeSourceSha256": "29BDC228E07ED56845C80502F1E20B4FC1C2110AB6E58CBB1230BA79BC4D4311",
  "nativeTreeHeaderSha256": "02858C23FF4F182DA7F8A4F6FCFD4FD6A757E3EB195BE9D64EB56BD684ED8F37",
  "snapshotLinkFixtureSha256": "7AA4F1E38476417EE7B04309FABC2CF3CE6AC22E70ACFE79872C8A2F06CC1193",
  "fixtureCleanupScriptSha256": "41FFADF144EDCC2F42ABBFBB7CD301FB75E2813AC568BDD6B1DD5396BC5D04FF",
  "testSourceSha256": "F2E10076C7793462DAF2CA50CF9082C9AA1E6FB4B81F58BB45E4ED669788C54D",
  "nativeDllSha256": "233976B195D655A21EF0FC1C61CDB8A07994C3E819220740DE10CFDBAD37194D",
  "runtimeSha256": "8B1D0783E10EC18191AF900AC3DA632006037D0A61E0518C4AB005C3F5F8C9C2"
}
```

## 下一步

在同一会话/共享执行与审批链中登记不可变写回提案、选中文件及前后摘要；消费精确一次性票前后核对源工作区身份与修订。副作用前持久化意图，逐文件记录已应用/拒绝/未知，并定义取消、部分成功和中断恢复。完成该层及实际Host/CLI/页面验收前，不新增可用写回按钮，也不解除默认执行门禁或D14。
