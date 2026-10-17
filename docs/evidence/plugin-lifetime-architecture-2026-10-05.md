# 插件生命期修复与架构验收纠偏（2026-10-05）

## 用户架构要求

“一切皆插件”已作为 [PRD §5 与 A12](../product/PRD.md) 的强制验收条件，覆盖模型、工具、业务服务、前端贡献及预设装配；不是只提供工具市场。依据冻结 DSH README、总体方案 L0–L3 与 Loader 契约。`core`、`extensions` 原 ✔ 仅有共享核心/自定义回调的局部证据，不能支持完整 Cordis 架构通过；本轮改为 ◐，矩阵当前表体为 ✔10/◐53/☐0，63 个模块。

## 本轮代码修复

只修改 `extjs/host.cjs` 与新增 `extjs/test/lifetime.test.mjs`，保留 NDJSON 方法和既有插件导出格式。

- 同步或异步 setup 失败撤销已登记监听和名称占位；初始化成功之前工具不可列出或调用。
- 异步初始化遇到卸载/宿主退出，禁止迟到发布工具；旧 setup 句柄无法再次登记监听。
- handler 在 finally 保护的 Promise 链内调用，同步异常也释放调用账目。
- 调用记录按内部 id 保存扩展归属、AbortController、工作 Promise 和结算状态；无外部 callId 的调用同样可被所属扩展卸载或宿主关闭通知。
- 卸载与退出先拒绝等待者再发 abort，协作工具的迟到返回不能冒充成功；只停止被卸载扩展所属调用。
- 取消后立即复用 callId，旧调用 finally 不删除新调用句柄；关闭清理工具目录并拒绝再加载。

仅回收本宿主登记的工具/监听与等待者，通知协作取消并记录收束诊断。`dispose` 的布尔结果不是“不协作代码已经物理停止”的证明。完整 effect/作用域/依赖装配及外部资源回收仍需按上游补齐；不宣称此自定义 CJS 宿主已具备 Cordis 原生兼容。

## 验证证据

- 红先：从当时已提交 HEAD 提取旧 `extjs/host.cjs`，配新八条测试，在 `D:\Temp\SaCode-plugin-lifetime-red-20261005` 运行。**8 tests / 0 pass / 8 fail / rc=1**；日志 `red.log`。旧实现还暴露同步异常账目泄漏与 callId 复用的测试后未处理拒绝，不掩盖这些红灯。
- 绿后：源码目录 `extjs` 中 `node --test`，**24 tests / 24 pass / 0 fail / 0 skip / rc=0**；日志 `D:\Temp\SaCode-local-plugin-lifetime-final-20261005.log`。含既有实际 stdio 子进程测试与八条新增生命期回归。
- 跨进程回归：将新 host.cjs 放入已保留的 `D:\Temp\SaCode-goal-upstream-20261005\extjs`，执行该目录先前已编译的隔离 core.exe（核心基点 d8018dd 加此前 goal 契约修复，不代表当前工作区全部核心源码）。**TOTAL 497 / PASSED 496 / SKIPPED 1 / ERROR 0 / FAILED 0 / rc=0**；日志 `core-ext-lifetime-regression.log`，包含真实 Node 管道调用回归。既有真实模型凭据门控跳过；本轮未调用模型。
- 语法、本地文档链接与 git diff 空白检查通过。本轮未重编 Electron/安装包，未执行安装器，也未验证完整插件包管理或前端插件贡献。

下一接入前提是上游 Loader/Scope/Service/effect 的仓颉共享装配契约与真实 profile 包管理；不能再把工具回调数量当作整体插件架构完成度。
