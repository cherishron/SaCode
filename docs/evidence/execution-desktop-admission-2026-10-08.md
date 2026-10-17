# 持久任务桌面准入与恢复验证（2026-10-08）

## 基线与实际改动

产品仓库 `D:/Project/sa/saai/sa-code`，分支 `refactor/dsh-learning`，HEAD `35a69ca9e0f8b7b6ac51271ec76eff3515eaa820`；均为未提交工作区实现，没有提交、推送、安装、发布。

共享 Workspace 增加 revision 读面；ExecutionService 使用同一读面校验；Host workspace/get 返回 sessionId 与 revision。终端正式页面挂载持久任务视图，使用六个有限 IPC。提案绑定原始参数、工作区修订与请求身份，同一提案重试使用同一身份。审批逐字绑定原始提案，停止发送执行身份及预期修订。

页面切换、关闭仅废弃客户端回执，不发送 stop，不自动启动或恢复授权。双流输出验证分页顺序与大小，损坏页不部分提交；跨页 UTF-8 连续解码，采集结束、EOF、截断分别显示，空页不伪造 EOF。监督与隔离门禁继续关闭，不能从该页面执行命令。当前仅支持显式输入执行身份读取，尚未完成标签布局中的任务引用持久化。

## 验证

| 层 | 结果 | 日志 |
|---|---|---|
| 私有核心副本构建与测试 | rc=0；119 总数 / 118 通过 / 1 缺真实模型密钥跳过 / 0 ERROR / 0 FAILED；这是选定测试集，不是全量 | `.tmp-test/execution-desktop-core-build.log`、`execution-desktop-core-tests.log` |
| 新 Host 私有目标构建 | rc=0，未覆盖共享 dist/host | `.tmp-test/execution-desktop-host-build.log` |
| 桌面控制器实际源码测试 | 9/9，rc=0；8 条竞态/格式夹具加 1 条真实 Host | `.tmp-test/execution-task-current.log` |
| 六动作真实 Host 验证 | rc=0；精确审批、去重、恢复重新审批、旧修订拒绝；PATH 仅 System32；未执行命令 | `.tmp-test/execution-host-current.log`、`execution-host-0uW4tU/results.json` |
| 页面 bundle 构建 | pack-pages rc=0，含 CSP 静态检查 | `.tmp-test/execution-pages-build.log` |
| 独立真实 Electron 组件页面 | 阻塞：进程在页面脚本前退出，实际 ExitCode=-2147483645（0x80000003），无 checks.json，不能判通过 | `.tmp-test/execution-page-stdout.log`、`execution-page-stderr.log` |

日志根为 `apps/desktop/`，表中 `.tmp-test` 位于该目录。新 Host 自包含产物为 `.tmp-test/execution-desktop-packed/bin/sacode-host.exe`，从本轮新构建 exe 与 stdx/仓颉运行时/Git DLL 打包。未使用旧共享 Host 验证六动作。

源码工作区 14 文件清单：`apps/desktop/.tmp-test/execution-desktop-source-manifest.json`。Host SHA256：`56E1709E8AAFA1978C0CF74351FDEAEF27852449C1AD9D8A2C65EC03693A44A9`；选定核心测试二进制 SHA256：`A82085707E9CC1446FCD555E4F40546B6DF2E61C5B0DCEAE9528686A8151A1AA`。清单是本轮登记态，不能代表所有并发文件在构建期间冻结。

## 页面阻塞与解锁条件

页面脚本复用正式 Vue 组件、preload 和有限 IPC，连接新 Host；这是独立组件夹具，不是完整产品窗口验收。已修正 runtime Vue 资源名与审批 IPC 抽取边界。开发 Electron 与另一份本地 Electron 运行时在私有 D 盘 TMP 下均于脚本运行前退出，原因尚未确认；不改系统 ACL，不降低沙箱设置，不用截图或 Node 结果冒充页面通过。

主责 G/W60：先诊断 Electron 运行时启动，再取得真实页面提案/审批/取消及亮暗截图和检查记录。启动恢复后还需完整正式窗口会话切换、断连、关闭标签验证。普通执行隔离、进程身份、子进程监督、CLI 同场景及 GoalRunner 真实轮次接线仍未全部收口。
