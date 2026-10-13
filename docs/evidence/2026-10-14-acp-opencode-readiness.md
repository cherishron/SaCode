# ACP：OpenCode 装配与就绪检查

基线：`31577ef` 加本批明确路径。Windows，仓颉 1.1.3 / stdx 1.1.3.1；未使用真实模型任务验证。

| 链路 | 当前事实 | 尚缺 |
| --- | --- | --- |
| 核心 | 内置 OpenCode 适配器执行有界 `auth list --format json --standalone`，再做 ACP initialize / session-new 探针；不发送 prompt | 真实账户与任务验收 |
| Host | 创建时由可信路径装配、经注册表和门控构造运行时；页面不能指定命令、环境或认证结论 | 当前实例的认证子命令权限拒绝需解锁；隔离与真实委派验收仍待完成 |
| 配置 | ACP 默认关闭；显式开启、修订校验、持久屏障和恢复；范围明确为当前项目会话 | 用户级设置继承尚未接入产品入口 |
| 桌面 | 开关、探针、提交、审批、取消、关闭与历史；恢复不启动；迟到响应不串会话 | 真实任务的审批、取消与完成展示验收 |
| CLI | 仍只有历史 list / describe | 配置、探针和实时任务操作 |
| 产物 | 私有目录的新版 Host 与 Electron 开发载荷验证 | 统一 CLI、安装包与默认沙箱态验收 |

本地凭据列表非空只代表配置前提，不证明远端凭据有效。协议探针通过也不证明模型任务可完成。页面始终标明真实模型任务未验证；首次装配时复查提供方，后续创建仍受开关及注册代际门控。

## 本轮实测

- 核心最终专项：TOTAL 381 / PASSED 8 / SKIPPED 373 / ERROR 0 / FAILED 0，退出码 0。运行时归属/关闭、配置恢复/CAS/缺租约和坏修订回放拒绝，以及本地凭据列表解析八项运行；不是全量核心通过。
- 页面与 IPC 九项、预加载专项一项通过；页面静态构建通过。
- 新版 Host 生产构建成功；真实 RPC 三项通过，覆盖默认关闭、未装配控制拒绝、跨会话拒绝、配置落盘、CAS、重启及实际 OpenCode 探针。
- **OpenCode 就绪未通过**：Host 子进程的认证命令退出码 1，安全分类为 `opencode-local-auth-exit-1-permission-denied-unconfirmed:no-task`。关闭日志输出未消除此错误；原因不能进一步断言为凭据或日志文件。未回显 stderr 和认证内容，未导出或复制凭据。
- 真实 Electron：持久历史只读、外会话拒绝、界面开关往返、配置读回、提供方状态展示通过，退出码 0；没有新增任务启动事实。使用测试参数 `--no-sandbox`，不代表默认安全启动或安装态通过。
- 修复 ACP 面板在会话目录尚未确认时使用临时会话 ID 发请求，以及通用工具条样式使字段横向挤压的问题。

日志和截图位于已忽略的 `apps/desktop/.tmp-test/`：`approval-binding-candidate/acp-product-final.log`、`page-tree-a6e22601/apps/host/acp-provider-no-log.log`、`page-tree-a6e22601/acp-electron-layout-1791933224637/`。

不得将这些检查登记为 ACP 全部完成、真实 OpenCode 委派通过或全量核心回归通过。
