# 项目与会话数据同目录的执行边界（2026-10-18）

基线5c22a3631ec629f0056f377549e6250be5bc082e；未提交工作区增量，接续execution-capsule-entries证据。当前仍不是完整产品或安装态验收。

## 修正

WindowsExecutionCapsule根据实际持有的SessionLog.path、WriteLease.leasePath和AttachmentStore.dir向快照传递可信排除路径，RPC不能自报排除清单。WindowsWorkspaceSnapshot把这些路径转换成根内相对路径并绑定到清单摘要；根外路径不影响项目清单，覆盖源根的存储路径被拒绝。尚未创建的存储子目录从现存祖先解析。

排除只针对本实例的具体元数据路径及其子项，不按session.log或attachments名称忽略用户文件。元数据祖先目录仍遍历、复制用户条目，但不以仅服务于元数据的空目录出现/消失判定源变化。修改用户同名文件仍导致新鲜度拒绝。任务在副本内伪造受保护路径时，差异导出报workspace-snapshot-protected-output，不能写回会话数据。

## 验证与失败记录

core构建最终colocated-core-build-v3.log成功；Host和CLI分别colocated-host-build.log、colocated-cli-build.log成功，24/4/4 warnings。日志前缀target/tmp/windows-adapter-20261017-1f3b/。此前一次符文字面量转义错误导致格式化/构建失败，修正后重新格式化并构建，失败日志保留。

真实驱动：node apps/desktop/test-support/verify-execution-capsule-entries.mjs D:/Temp/SaCode-capsule-host-20261018-colocated/bin/sacode-host.exe D:/Temp/SaCode-capsule-cli-20261018-colocated/bin/sacode-host.exe --colocated，rc=0，13项。去掉--colocated复验分离布局，rc=0，13项。分别包含独立审批、成功/拒绝/exit7、未启动/运行中EOF取消、恢复不重放和独立差异写回。不是完整Vue渲染或Electron界面验收。

报告：target/tmp/capsule-entries-kzfenr/verification.json（同目录）、target/tmp/capsule-entries-r3aKoL/verification.json（分离）。对应日志colocated-real-entries.log、colocated-separated-regression.log。

Host SHA256 93fa88b7954d9ca7c3f0e26d94eabf3cf0b6367d11c3695d770c6f1fe584eaf3；CLI SHA256 be5fdb6eee3fb445dc51392e4ca74258eff69004667fc350b76893678b6bbd81。仍使用本机非官方修正SDK 1.1.3与stdx1.1.3.1；原生库只从当前载荷相邻目录加载。未安装、未改ACL或用户配置、未发送模型任务。

核心52项首轮TOTAL52/PASSED51/ERROR1/FAILED0/SKIPPED0、rc=1、非超时。新同目录完整执行用例通过；另一新用例到清理时，固定清理白名单没有SESSION.LOG及user/session.log，私有目录撤销失败，并被profile-in-use最终异常覆盖。补充清理夹具的这两个固定文件与user空目录，保留根路径/reparse/硬链接守卫，不改生产清理。

首轮报告target/tmp/windows-adapter-20261018-ed91019cda4443d5a2399e8e1edc8859/verification.json，完整失败日志同目录run.clean.log及run.err。该轮夹具目录D:/Temp/SaCode-Windows-Adapter-Verification/windows-adapter-20261018-ed91019cda4443d5a2399e8e1edc8859/sacode-workspace-cj-10292-12保留作为失败现场；不宣称失败轮资源已完整释放，不据名字清理其他会话profile。

最终完整重跑TOTAL52/PASSED52/SKIPPED0/ERROR0/FAILED0，rc=0、未超时。报告target/tmp/windows-adapter-20261018-7e21f2bf93da4e0e9e3f930c81123632/verification.json，日志colocated-native-test-v2.log。未过滤旧用例，完整保留首轮失败。核心库SHA256 2A3730896F426E30AAB49C0BB67E45C795729BB4D86A192C09B8C11D14139EC3。

产物放置守卫本轮13项通过、fail=0；该守卫也含其他会话的工作区更新，本线不认领他方修复。

## 剩余

默认安装包载荷、完整Electron、真实构建工具链隔离、跨进程资源接管及崩溃窗口、后处理独立状态尚未完成；受控样本成功不能代替全面平台或隔离保证。普通构建测试及后续Git独立授权链继续实施。公共文件仍有并发改动，提交候选需逐行隔离并独立构建，未提交推送。
