# 仓颉私有目录共享任务验证（2026-10-17）

## 本轮实现

新增包内 WindowsPrivateWorkspace，有限调用既有 native create/revoke/close；创建及存活期间持有 DLL/profile 引用，防止卸载库或删除仍被引用的 profile。创建失败释放借用引用；原生非空错误对象保留在实例供清理；requireReady 拒绝失败/已关闭实例。非空 close 失败不丢所有权，独立清理后可重试，成功 close 幂等。

WindowsProcessLibrary 新增 retain 配合现有 release，其他进程契约不变。新增独立夹具清理脚本，仅在显式 SACODE_WINDOWS_SCOPE_PARENT 下匹配生成名称，删除 input.txt/result.txt 两个固定普通单链接文件；拒绝重解析或意外对象，不递归、不修改 ACL，不对产品/模型暴露。

## 验证与证据

修复后的本机仓颉 1.1.3（运行库指纹见下）；生产 core 私有构建 rc=0，24 条既有 warning，新增/改动生产文件 cjfmt 后构建。定向真实 DLL 集成 **TOTAL 16 / PASSED 16 / SKIPPED 0 / ERROR 0 / FAILED 0，进程退出 0**，不是全量 cjpm test、Host/CLI 默认装配或安装态验收。

原 13 条保持；新增三条：

1. 私有可写 cwd 在共享 ExecutionService 提案中明确披露，经精确审批、beginStart、WindowsExecutionProcessProvider、AppContainer 真执行，写入 input.txt/result.txt；原始合成文件未变。非空撤销拒绝且 requireReady 仍可读，独立清理进程退出 0 后再次关闭并确认目录不存在。DLL/profile 提前 close 均拒绝。
2. 同一共享链在私有 read-only cwd 执行覆盖命令，真实返回非零、双流与退出事实完整，预置文件字节不变；独立清理与关闭通过。
3. 非法相对父路径创建失败后，DLL/profile finally close 均成功，无借用引用遗留。

合成文件的预置复制只在测试代码中；没有把 File.readFrom/文件复制夹具当成生产快照。当前没有完整目录枚举、受保护子树排除、源文件锁定或差异自动应用实现。

命令：

```powershell
& scripts/verify-windows-process-adapter.ps1 -CoreRelease 'D:\Project\sa\saai\sa-code\target\tmp\appcontainer-core-rebuild-20261017-6b281f0a\build\release' -DestinationRoot 'D:\Temp\SaCode-Windows-Adapter-Verification'
```

最终运行目录 `target/tmp/windows-adapter-20261017-8fe467450f0140d9b2f4b06644286bf6/`：compile.log/compile.exit、run.out/run.err/run.exit、run.clean.log、verification.json。生产构建日志 target/tmp/windows-adapter-20261017-1f3b/private-workspace-build.log；汇总 private-workspace-verify.log。源及运行库绑定：

```json
{
  "version": 1,
  "passed": true,
  "timedOut": false,
  "exitCode": 0,
  "expectedTests": 16,
  "neutral": "D:\\Temp\\SaCode-Windows-Adapter-Verification\\windows-adapter-20261017-8fe467450f0140d9b2f4b06644286bf6",
  "coreLibrarySha256": "9B6327EC0C39BB0E144B15B4E0A1EF57DAE83BFFE69744770A3F1562974DF53F",
  "adapterSourceSha256": "B12F33D6078828D55633E7379F9780C24D6588B19942D6DB540E325FE2044E74",
  "processProviderSourceSha256": "D108BF90B9C3490E6EB2429DE834B4699D95B5AE87A180B8CEABC160C419DDEB",
  "supervisorSourceSha256": "C28957629867E04B54158F54ED9EE5703996E9E19EA45F51EB4F56FBACC93EFF",
  "workspaceAdapterSourceSha256": "536D8CAA761ABAC0B0819442C3DC5CD76719A91F1E36C6C5871F8519F0F5136A",
  "fixtureCleanupScriptSha256": "DC095244CA31596722E11BD831F104CCFF6280EBB17B194C49E9EDD2649BC062",
  "testSourceSha256": "6000CCC027286E4DF412CADFB602ADDC46BDB91CE06BC0857E9BD67E9AC35F13",
  "nativeDllSha256": "9F38630DF6F0678207E709539BBD93F130F2E291DE2E5F574EC6DFB7B4985FB7",
  "runtimeSha256": "8B1D0783E10EC18191AF900AC3DA632006037D0A61E0518C4AB005C3F5F8C9C2"
}
```

HEAD 观察值 21e35299fd0a115c6b94000aa0da9e737e9dcd0a，含并发未提交改动，不是该提交独立复现。结束时未见 cjpm/cjc/adapter-test 运行进程。Medium 内容导出保留原清单；未安装或修改系统环境/用户配置/SDK。

## 尚未完成

生产工作区快照、.git/target/node_modules 等排除、重解析/硬链接防护与源修订清单、变更导出/F08 审查/CAS 合入、网络/逃逸反向测试及 Host/CLI 默认装配继续待做。尤其不能把原工作区 cwd 静默换成私有副本。D14 仍未解除，也不能据本轮进程退出 0 宣称构建测试报告通过。

产物守卫仍 rc=1 / 13 checks / fail=5（private-workspace-artifact-guard.log），未触碰既有冲突目录。指定文件 git diff --check、清理脚本 node --check 通过。未提交、推送或发布。
