# R4 运行时与流式正文修复（第一批进行中）

## 基线与范围

2026-10-18，用户指定的 `D:/Project/sa/saai/sa-code` 已在 `dev`，HEAD 为 `f7cef5f4548c71b32e4ce3398209b0be074af80b`。接管时 `core/src/agent.cj` 有既存差异，Host 的 `test/session/failure-path.test.mjs` 与 `test/support/` 未跟踪；本轮未修改这些文件，未确认其归属，不纳入本轮交付。未提交、安装、推送或发布。

R4 默认入口确实可以经 computer-use 启动，但只呈现空窗口，可访问性树也没有工作台控件。R4 目录包含 `TEMPORARY-NO-SANDBOX.txt` 与传入 `--no-sandbox` 的 CMD；本轮没有使用该入口，没有修改 ACL、防护或系统 PATH。

## 已实施，尚非整批验收

- 修复未导入的 `onBeforeUnmount`、setup 读取 render 局部 `sessionLocked`、菜单 `el()` 参数顺序错误、render 重复解包 ref、模型目录订阅未清理，以及 `/clear` 回调访问 setup 局部变量。
- 菜单按钮改用 `.composer-menu-card`，解除同名 `.composer-card` 对输入容器的样式覆盖。
- 临时助手消息与持久消息使用同一 `BubbleProvider/BubbleList/TextBubble/Markdown.Body` 链；助手长文默认展开，避免收束时切为截断纯文本。保留主动折叠。
- 用量和工具参数增量不再拼入助手 Markdown。成功结算等待投影回执后同步切换来源；失败、取消的半截正文保留。

## 当前自动测试与窗口证据

日志根：`target/tmp/desktop-batch1-20261018-codex/`。

- `regression-final.log`：10 个定向文件，65/65，通过，无跳过或取消。包括菜单、模型目录、消息映射、Markdown、轮询、审批及流式纯派生测试。
- 首轮 `regression.log` 为 64 通过、1 取消：新增夹具对后续普通刷新也返回未决 Promise，导致测试结束时未结算。修正夹具只拦结算刷新后重跑通过；不隐藏首轮日志，不将其归为环境问题。
- `pack-pages.log`：当前页面构建通过；未写入 `dist`。
- shell 启动源码 Electron 失败，PID 34168 退出 `2147483651`（`0x80000003`）；`ui-smoke-run2.log` 无诊断内容。该失败不等于整个机器无法启动 Electron。

窗口诊断根：`C:/Users/jingg/.codex/worktrees/225e/sa-code/target/tmp/desktop-runtime-20261018-codex/`。它是内部诊断副本，复用已有 R4 的 Electron/Host，加载本轮桌面源码；**不是同源交付候选**，不替代后续完整源码构建。

- `runtime-result.json`：完整主进程、生产 preload 与生产页面执行 15 项检查，通过；控制台错误数组为空。主进程核对 `sandbox:true` 且无 `no-sandbox`、`disable-gpu-sandbox` 开关；页面无法访问 `require`。
- 实际 Vue 渲染测量：包含长文、标题与代码块的流式/落盘正文宽度、横坐标及高度差均小于 1px；成功后无重复临时气泡。该项为合成投影，不是实际模型流式任务验收。
- `runtime.png` 为 Electron `capturePage` 的渲染截图。原生 Windows 截图仍显示空白，但可访问性树已有完整控件；两种截图不一致，未将图形链判为全部通过。
- computer-use 原生点击添加菜单、Escape 关闭、通过可访问性编辑控件输入合成文本均有页面状态变化；未发送模型请求。记录为 `native-input-evidence.txt`。
- 已用 Alt+F4 正常关闭诊断窗口，重新枚举确认窗口消失后重启，检查再次通过；这不是崩溃恢复，也没有验证会话重命名/归档持久性。

可复用驱动在 `apps/desktop/test/support/prepare-renderer-runtime.mjs`、`renderer-runtime-main.cjs`、`renderer-runtime-checks.cjs`。准备脚本要求明确已有运行库、Host 和全新 `target/tmp` 输出目录；由默认 EXE 启动，不注入沙箱绕过参数。

## 对历史结论的追加更正

- “render 返回 null 会卸载组件”不是 Vue 的正确生命周期解释，本轮不据此认定目标栏问题已经闭合；持续目标另批核实际状态与驱动机制。
- `extension/list` 返回工具列表，不能称为技能发现/加载完成；菜单卡片不能称为 AI 选择卡片完成。
- 工具卡目前仍以结果正文解析状态，未关联真实调用身份、参数和结果，也会在提前返回时漏掉通用附件渲染；第一批仍须修复。
- 原“218 项失败均属环境”未取得逐项分类证据，当前撤回统一归因；全套分类与同环境基线尚待执行。定向 65/65 不代替全套。

## 剩余验收

第一批仍进行中：真实调用/结果工具折叠与附件、实际 DSH 参考的历史侧栏、可恢复归档/重命名、结构化 AI 单选/多选/确认/自定义输入。尚无同源新候选、真实模型、产品内受控测试执行或完整重启持久性验收，版本仍未交付。没有读取磁盘凭据，真实模型请求本轮未发起。
