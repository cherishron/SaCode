# AppContainer 最小环境与身份探针复验（2026-10-17）

## 结论与范围

本机 AppContainer 进程创建失败已由实际对照定位并修正：完全空的子环境缺少 Windows 创建 AppContainer 所需的 `LOCALAPPDATA`。保留 `LOCALAPPDATA` 和 `SystemRoot` 两个定位字段后，当前仓颉身份测试 **TOTAL 5 / PASSED 5 / SKIPPED 0 / ERROR 0 / FAILED 0**，实际退出码 0。

这只收口身份探针。`SandboxRuntime` 默认仍拒绝执行；没有工作区 ACL、网络、后代进程隔离或真实执行器绑定证据，不能据此开放执行、构建测试或 Git 写操作。

## 源码与环境

- HEAD：`7a249a1c2ca03f5d4ad7a7c5e82eb81d60a00238`，加未提交工作区实现，不是提交态或安装态验收。
- SDK：本机仓颉 1.1.3，`D:/Program Files/HuaWei/Cangjie`；使用已有修正运行库，不声称官方原版已通过。
- `libcangjie-runtime.dll` SHA256：`8B1D0783E10EC18191AF900AC3DA632006037D0A61E0518C4AB005C3F5F8C9C2`。
- `core/src/appcontainer_win.cj` SHA256：`E017484006999A3444FF544ADE7DEFBF41E3BDC992473660C0B8230648F70B79`。
- `core/src/appcontainer_win_test.cj` SHA256：`0331ABE979E272EB488B5D962C9A74842B244BDB88C322DB7E2FB70A76D1BBE3`。
- 最终实际测试 EXE SHA256：`D14C461097902CE6BD5FCF17946BC28FE2888BB7556097AE3B376F7A6D73BC65`。

仓颉语法和指针契约经本机 `cangjie-coding` 技能的脚本查询；`getVariable(key: String): ?String`、`CPointer.read(idx: Int64)` 及 inout 生命周期均按实际叶子与 1.1.3 编译核对。

## 原生对照与失败保留

为取得同一个原生调用帧里的 `GetLastError`，用本机 clang 22.1.0 和 Windows SDK 编译与产品相同顺序的诊断程序。只创建固定 `cmd.exe` 的挂起进程，检查令牌，终止并等待，不恢复线程、不改 ACL。

| 子环境 | 原生结果 |
|---|---|
| 空 Unicode 环境 | CreateProcessW=false，Win32 error=203；profile 创建/删除成功 |
| 仅 SystemRoot | 同上，error=203 |
| SystemRoot 加 LOCALAPPDATA | 创建成功，TokenIsAppContainer=1，SID 匹配，TerminateProcess 成功，WaitForSingleObject=0，profile 删除成功 |
| SystemRoot 加其余单个安全字段（APPDATA/ComSpec/PATH/SystemDrive/TEMP/TMP/USERPROFILE/windir） | 均仍 error=203 |

原生程序在普通 Medium（RID=8192）中运行。只用仓库 `scripts/export-windows-artifact.mjs` 导出同字节文件，不调整完整性标签或 ACL。全部源码、原始输出和退出码保存在 `target/tmp/appcontainer-native-20261017-e719/`；`run.out` 是空环境失败，`systemroot.out` 是仅根目录失败，`env-3.out`/`env-3.exit` 是两字段成功。中性副本及其摘要清单位于 `D:/Temp/SaCode-AppContainer-Native-20261017-e719/`，保留未删除。

这是本机因果对照，不推断所有 Windows 版本需要的完整环境集合。

## 产品代码修正

1. `acProbeEnvironment` 只接受两个定位字段，按变量名排序构造双 NUL 结尾的 Unicode 环境块；缺值或嵌入 NUL 时拒绝，不复制其他父环境变量或模型凭据。
2. 之前已修正 `SECURITY_CAPABILITIES` 生命周期：Windows 保留的属性值使用持有的裸数组句柄，删除属性列表后才释放，不能保留仅调用期间有效的 inout 指针。
3. 仍创建唯一临时 profile、以零 capability 创建挂起进程，不恢复线程；核对 TokenIsAppContainer 与实际 SID，终止后等待，再删除 profile。

## 仓颉实际验证

在 `core` 用修复后的 1.1.3 执行 `cjpm build --target-dir D:/Project/sa/saai/sa-code/target/tmp/appcontainer-core-rebuild-20261017-6b281f0a/build`：退出码 0，24 warnings。

将实际 `appcontainer_win_test.cj` 用 `cjc --test-only` 链接这份 core 静态库：编译退出码 0；通过既有中性导出脚本运行同摘要测试 EXE，不改 ACL，最终 Summary 为 5/5，退出码 0。测试覆盖：最小环境与 NUL 拒绝、x64 ABI、两次唯一 profile 创建/清理、真实 AppContainer 标志/SID/终止、零 capability 和默认执行门禁仍关闭。

第一份实际结果：`created=true isAppContainer=true sidMatches=true terminated=true profileDeleted=true`；PID 21312，`reason=identity-verified-not-resumed`。运行后未发现该进程或测试父进程的残留子进程。

完整原件在 `target/tmp/appcontainer-env-fix-20261017-a03d/`：`build.log/build.exit`、`compile.log/compile.exit`、`export.log`、`run.out/run.err/run.exit`。中性测试副本为 `D:/Temp/SaCode-AppContainer-EnvFix-20261017-a03d/test.exe`，同目录摘要清单记录源 Low、目标 implicit-medium、内容一致。全量 `cjpm test`、Host/CLI 新产物和安装包未在本次重建验收。

跑后产物守卫仍为 `GATE: FAIL (13 checks, fail=4)`，原件 `artifact-gate.log/artifact-gate.exit`；先前 `core/core/` 与其他模块 target 目录问题未由本批处理，不能宣称全门禁通过。本轮构建、测试及原生诊断进程均已退出。

## 下一门槛

完成私有工作区 ACL 授权与撤销，验证只读/可写、区外拒绝、网络反向对照和后代隔离；然后将 AppContainer 原生创建绑定到实际 ExecutionService 的同一个任务进程及 Job 监督，覆盖取消与恢复。不得使用普通进程替代，不得只凭身份测试开放门禁。

依据：[CreateProcessW](https://learn.microsoft.com/en-us/windows/win32/api/processthreadsapi/nf-processthreadsapi-createprocessw)、[AppContainer 启动](https://learn.microsoft.com/en-us/windows/win32/secauthz/implementing-an-appcontainer)、[属性值生命周期](https://learn.microsoft.com/en-us/windows/win32/api/processthreadsapi/nf-processthreadsapi-updateprocthreadattribute)。
