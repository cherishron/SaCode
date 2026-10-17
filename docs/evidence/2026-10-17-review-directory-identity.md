# F08 写回目录身份保护（2026-10-17）

基线 5c22a3631ec629f0056f377549e6250be5bc082e，以下为未提交工作区增量，不是安装态或完整产品验收。

## 行为

路径、修订与旧文件字节以外，快照及审查清单现在登记源目录身份：固定根句柄取得卷序列号与128位文件ID。摘要和不可变写回提案包含该身份；审批后目录被同路径的新实体替换，即使文件内容相同也拒绝写入。实际条件写再次在持有根句柄时核对身份，避免仅做提前路径检查。

新增包内 review_platform.cj，以 GetModuleFileNameW(NULL) 取得实际可执行文件位置，只加载同目录 sacode-windows-process.dll；不使用命令行、工作目录、PATH或环境变量决定原生库来源。缺库或不支持的平台明确失败。旧无身份记录仍可只读预览，不允许据其创建写回提案。

Windows API依据：[GetModuleFileNameW](https://learn.microsoft.com/en-us/windows/win32/api/libloaderapi/nf-libloaderapi-getmodulefilenamew)、[FILE_ID_INFO](https://learn.microsoft.com/en-us/windows/win32/api/winbase/ns-winbase-file_id_info)。本机运行结果仍为实际判据。

## 验证

真实原生DLL与本机修正仓颉1.1.3：最终 TOTAL=39、PASSED=39、SKIPPED=0、ERROR=0、FAILED=0，实际退出码0；不是空测试集。原生构建与核心构建均rc=0。核心库之后无更新的core/src仓颉源文件（本次核对时点）。

命令：scripts/verify-windows-process-adapter.ps1 -CoreRelease target/tmp/appcontainer-core-rebuild-20261017-6b281f0a/build/release -DestinationRoot D:/Temp/SaCode-Windows-Adapter-Verification。

证据：target/tmp/windows-adapter-20261017-1f3b/review-identity-test-v2.log；完整源/库指纹与最终判决：target/tmp/windows-adapter-20261017-91dd475326f4480aadd5a12986f7c889/verification.json。

新增自身用例检查同路径目录替换拒绝、实际模块定位及中文/代理对转换。并发会话另加的提案字段防篡改用例亦在本轮运行，保留其归属，不据此认领实现。原36项加该并发1项及本批2项，分母39。

首轮120秒护栏超时，无Summary，不计通过：review-identity-test.log及d7e6bd0d5b6441e48796cb6005fd1021运行目录保留。旧36项实耗约115秒；扩容后脚本总护栏180秒，单项30秒和真实任务自身超时不变。超时仅终止脚本拥有的runner进程树；读取日志允许共享读取，避免文件占用异常遮蔽缺失Summary。

核心库SHA256：70D8EAA2EA210A305A049FC80627E022F1EDBB3FC751258FFCC495274A94BF09。
原生DLL SHA256：46FCDBD88070DF23ADA9C541AA22792E7D2D1B95AC84DF0637EB90D10C0CB064。
运行库SHA256：8B1D0783E10EC18191AF900AC3DA632006037D0A61E0518C4AB005C3F5F8C9C2；属于本机非官方修正版本。

## 剩余产品缺口

公共prepare/apply/describe/stop、双入口精确审批及页面选择仍未接；必须采用异步写回以保留状态查询与停止响应，不将同步阻塞RPC伪装成可取消任务。旧Host/CLI正文预览证据不代表本批新代码已进入产物。默认执行门禁保持关闭；hunk选择、多文件事务、断电与安装态未验，F08及整体目标仍未完成。
