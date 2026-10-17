# Windows 私有工作区有界内容清理（2026-10-17）

基线5c22a3631ec629f0056f377549e6250be5bc082e，未提交增量。此前私有工作区只支持已空目录撤销，真实任务结束后仍依赖测试清理脚本；本批补齐核心可信生命周期可调用的清理原语，尚未接默认Host生命周期。

## 契约

新增sacode_windows_workspace_dispose_contents，只接受workspace_create返回的对象句柄，不接受路径或外部根。通过持续固定的根句柄取实际路径，在本对象下有界遍历（8192项、深度32）；逐项打开不跟随重解析的句柄，拒绝别名、重解析、多硬链接和文件占用。子目录固定后递归，删除操作作用于该句柄，不改ACL、文件属性或外部目标。异常可以已有部分删除，错误不得改写为清理完成。边界规模上限当前为源码契约，未做8192/32极限压力验收。

WindowsPrivateWorkspace.disposeContents提供串行包内适配。调用方必须先确认整个进程树停止、导出审查对象并释放树读句柄；本API本身不授权或监督进程。清理仅移除内容；根仍保留，随后既有close/revoke才删除空根并释放profile引用。来源工作区不进入该API。失败时保留所有权，供明确处理后重试，不自动强删可疑对象。

Windows依据：[GetFinalPathNameByHandleW](https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-getfinalpathnamebyhandlew)、[重解析点文件操作](https://learn.microsoft.com/en-us/windows/win32/fileio/reparse-points-and-file-operations)。实际本机行为以下述测试为准。

## 实测

- 原生DLL clang -Wall/-Wextra/-Werror构建rc=0，workspace-disposal-native-build.log。
- 修正仓颉1.1.3核心构建成功，24 warnings，workspace-disposal-core-build.log。
- 真实DLL/仓颉完整定向TOTAL=45/PASSED=45/SKIPPED=0/ERROR=0/FAILED=0、实际退出0、未超时，总154.529秒；保持180秒整轮和30秒单项护栏，不减少原有用例。
- 新增三项：中文嵌套文件与空文件清理、根保持且空内容重试幂等；真实占用句柄导致拒绝，原内容BUSY保留，释放后成功重试；真实junction和硬链接分别被拒绝，脚本核对私有根之外的DO_NOT_REMOVE哨兵字节不变，最后仅由自有固定夹具撤销链接及哨兵。
- 外部哨兵及私有根均由本轮测试唯一创建，不以用户目录作为清理目标。既有夹具最终确认根删除和profile释放；没有清理其他会话进程或profile。
- stderr两条execution-provider-failed来自既有负向监督测试，最终无ERROR/FAILED；不拿stderr空与否代替Summary。

命令：scripts/verify-windows-process-adapter.ps1 -CoreRelease target/tmp/appcontainer-core-rebuild-20261017-6b281f0a/build/release -DestinationRoot D:/Temp/SaCode-Windows-Adapter-Verification。

最终报告：target/tmp/windows-adapter-20261017-ac2742a8b309455aa6af1774e7a0a179/verification.json。原生日志/核心日志前缀target/tmp/windows-adapter-20261017-1f3b/；运行日志workspace-disposal-native-test.log。

原生DLL SHA256：AB5AC065C9AE2BB7516867A046E77A7E7A36D3DB11BE234A07B496ECA4969C2E。
受测核心库SHA256：4CFA3B73180B4892DB7C978E7E5F704E5F87E17C696589CF7F8334F3608A63FE。
受测workspace_adapter源码SHA256：FD4D889E9E977B043E4DBC343E495C0A79C6BE258CD2EE07623A43A1A5E90A7D。
运行库仍为本机非官方修正1.1.3，SHA256：8B1D0783E10EC18191AF900AC3DA632006037D0A61E0518C4AB005C3F5F8C9C2。

测试完成后仅用cjfmt -f格式化本批生产适配文件，rc=0。新增函数去除空白后逐字相同（workspace-disposal-format-verification.json），其余文件原样；格式后源码C45B15BFAC5216DC10AFC8F01BB0D27B0334CEA35BD70C9F0A9A9AA5F0901CF3。随后核心再次构建成功、24 warnings（workspace-disposal-formatted-build.log）。45项报告明确绑定格式前库，不将格式后重编译产物伪称又运行过一轮45项。

## 仍需产品装配

默认Host/CLI仍需统一持有profile、库、私有目录和快照，在真实结束后先保存审查对象，再释放树句柄、清理内容、撤销目录与profile。CLI跨进程不得继承许可或重建旧快照；未知进程/未导出的结果不能自动清理重放。此批未开放新的RPC/IPC，也未把默认执行门禁或D14解除，不能据此宣布完整任务链、安装态或其他平台完成。未提交/推送/安装/发布。
