# 2026-10-24 TUI 能力浏览与真实技能发现阻塞

## 当前结论

本批接通只读能力入口和会话草稿隔离，**没有完成MCP/技能全功能，也没有闭合真实Host项目技能发现**。73条默认回归为72通过/0失败/1显式技能验收跳过；同批单独启用技能验收后 **0通过/1失败**。两个读数并列保留，不能只报默认回归成功。

用户继续补齐TUI授权内，只改Node TUI/测试/文档，没有改仓颉、桌面、用户配置/密钥，没有构建新Host、安装依赖、外部服务连接、收费模型请求、Git提交/推送/发布。桌面候选及主阻塞不变。

## 可用入口及严格边界

- `/skills` → `skill/list` 返回摘要数组；选中 → `skill/get {name}`，核同名和正文类型、以Markdown浏览。只浏览，不安装/执行、不自动注入消息或模型上下文。**当前真实发现失败，实际技能正文链未验通过。**
- `/mcp` → `mcp/list {sessionId}`；选中 → `mcp/status {sessionId,name}`，显示当前宿主进程connected布尔。注册不等于连接，更不等于服务/工具可用。核源码 `mcp/tools` 会触发服务请求且checkpoint，所以本批不调用它；不connect、不call、不改注册表。
- `/permissions` → `approval/get-mode`，只认ok与已知plan/build/auto/yolo字符串，未知拒绝，不推断OS隔离已启用。`/plan` → `plan/get-mode` 只认ok与active布尔。不提供set-mode或计划批准按钮。
- 所有新入口先核initialize已声明能力；缺声明或畸形回执明确错误，不伪造空目录。带执行型参数拒绝，任务在途不读取这些目录/模式。
- `/skills`/`/mcp`只读查询可Esc关闭，epoch拦迟到响应。关闭并非服务取消；请求仍有界等待，结束前其他写动作保持忙。
- 会话切换清空草稿/撤销/输入历史/搜索/文件菜单；同会话只读目录不再丢输入历史。模型选择继续本进程偏好，非逐会话持久化。

源契约核对 `apps/host/src/{skill_rpc,mcp_rpc,approval_mode_rpc,plan_mode_rpc}.cj` 与 main分派，未编辑 `.cj`；Context7本轮无可用端点，不宣称使用。

## 真实技能发现失败（未闭合）

开发态Host入口 `apps/desktop/dist/host/bin/sacode-host.exe`，之前批次SHA256 `052917f95f2d6f966aa94a941b988d07f1081d50c1c0b8d44dc008297f4fb4ea`。在本轮私有target/tmp项目放入：

1. `.sa-code/skills/tui-browser-probe/SKILL.md`，frontmatter含合法kebab名称/非空description，正文是合成标记；
2. 同层平铺 `tui-flat-probe.md` 合成候选。

明确 `workspace/set-directory` 后读取 `skill/list`，两类均未发现：`count=0,flat=false`，失败断言“必须发现项目合成技能”保留。之前未显式绑定目录的首次探针同样空；不能据此确定目录绑定、FileInfo路径、构建版本或权限哪一项是根因。PE字符串只证实二进制含相关路径/标记，不能证明当前源码同源或功能通过。

本批不把TUI改成本地递归扫盘、不修改共享core/Host或重建抢占其他线。发现回归显式保留在 `test/real-host.test.mjs`，门禁 `SACODE_TUI_SKILL_ACCEPTANCE=1`，按test-name-pattern可单独运行。默认跳过是隔离已知未通过的扩展验收，**不是移除失败或证明已修**；界面空态也登记此限制。

## 验证读数

- Windows / Node v22.23.2，指定开发Host的 `npm test`：**73 tests / 72 pass / 0 fail / 1 skip**（约12.91秒）。相对上批63新增10条，包括能力适配/缺声明/畸形响应、技能/MCP菜单、只读参数/在途阻断、会话状态隔离、真实模式读取，以及独立技能发现用例。
- 独立技能验收：**1 test / 0 pass / 1 fail / 0 skip**，rc=1，count=0/flat=false；原始失败日志保留，skill/get未能进入真实验收。
- 新增真实模式/MCP用例：空mcp/list、approval/get-mode、plan/get-mode返回结构有效；前后projection事件数相同。没有已注册外部服务/已连接MCP实测，不把空态推导完整MCP支持。
- 构建/自足/随包许可：`node scripts/pack-tui.mjs` rc=0；dist与主包bundle均 **529,688 B**，SHA256 `bfb74c6b0513b0cbde10f5fe15cf30bd97085318d6271ba4714f3a7e45e2661b`。
- 36个TUI `.mjs` 语法检查通过；无lint/typecheck脚本，不冒充。伪TTY `/help`→Ctrl+D rc=0，npm pack dry-run rc=0，保留既有许可文件。
- `test/support/capability-frames.mjs` 取12帧80×24/48×18技能/MCP/模式合成菜单及详情，帧高守卫通过；是假数据无外部请求，不当真实技能发现证据。
- 日志 `target/tmp/tui-capability-views-20261024-cb8a0dfb/{tests.log,skill-acceptance.log,frames.json,smoke.log,npm-pack.json}`。测试后仅修空态文案并构建，不改变已记录失败条件。

## 下一步/未验

技能发现由Host/core线核同源版本与读取链；真实项目技能发现/正文、外部MCP连接/调用、权限/计划变更都仍待验和接线。完整附件、真实终端、真实模型任务与新包安装未完成。本轮只称“只读入口接线，技能真实链受阻”，不升级F域完成。
