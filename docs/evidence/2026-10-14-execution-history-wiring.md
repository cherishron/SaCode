# 持久执行任务历史接线

基线：9d45748；仓库 D:/Project/sa/saai/sa-code，refactor/dsh-learning。本批补执行服务已有 `list()` 的公开读面，不新增执行器、修复Agent、任务队列或后台副作用。不修改用户 OpenCode 配置，不发送模型任务。

## 完成的调用链

ExecutionService日志投影 → ExecutionApi execution/list → Host同名分派、CLI job list → 有限预加载 executionList → 终端任务记录。摘要不含提案正文、审批参数或输出；选择记录仍走既有 describe/output。当前会话以外身份被拒；重放坏状态不伪造空列表；读取不拿写租约、不恢复审批、不启动命令。

新模块 execution-history-ipc.cjs 已进入显式打包清单。共享 main/preload/Host/CLI/package/bridge/ui-smoke 使用 HEAD 加本批最小改动构造候选，排除其他会话的未提交拆分和最近工作区动作；原工作区修改保留。私有候选IPC124，工作区126，不混分母。

## 验证

- 仓颉1.1.3核心执行专项：TOTAL408/PASSED15/SKIPPED393/ERROR0/FAILED0，rc=0；新增历史用例覆盖空列表、分页、取消后重放、无写租约读取、跨会话/越界/多字段拒绝及不含审批正文。不是全量core通过。
- 最新Host/CLI release构建均rc=0。真实双入口1/1：Host保存并取消提案，CLI重启后读取相同列表；读取前后session.log逐字一致，未执行虚构程序。
- 页面历史控制器/IPC/既有执行回归13/13；非法页整页拒绝、跨会话和卸载后的迟到回执不更新，读取失败保留旧记录；rc=0。包含既有Host提案/审批/门禁/取消场景，不含真实命令执行。
- 固定候选有限动作及注册集合2/2；打包相对依赖和删项反证3/3，rc=0。曾漏改第二处固定计数，门禁124≠123转红，补齐明确白名单计数后通过；没有删除集合断言。
- Electron真实主窗口通过：从任务记录点击已取消任务并看到原提案，列表可见；读取前后execution事件不变。初轮夹具在Host启动前调用导致host-unavailable，补显式启动后通过。使用--no-sandbox测试参数，不代表默认沙箱或安装包通过。

日志在忽略目录 apps/desktop/.tmp-test/：approval-binding-candidate/execution-history-core.log、execution-history-regression.log；page-tree-a6e22601/execution-history-{host-build,cli-build,entry,page-regression,bridge,packaging}.log。主窗口原件在 page-tree-a6e22601/execution-history-electron-c91bba2b15a544b0a82dc043d44eecbd/session/execution-history-smoke.json 与 execution-history.png，截图已人工查看。

## 未完成

本批不是OpenCode修复闭环：配置来源/文件修订/范围确认尚未绑定，配置补丁执行、CAS、复验与通知仍待实施。现有进程提案也不能自动变成配置修复。LSP真实语言插件、知识和自动化管理、完整开发流程及统一安装态验收仍按全功能审计保留缺口。
