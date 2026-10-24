# 2026-10-24 TUI 骨架重写：历史流 + Markdown + 内联工具 + 配置表单

## 授权与范围

用户确认按已批准方案整体替换 TUI 骨架。本轮替换显示骨架与输入互斥，适配 Gemini CLI Apache-2.0 展示代码，不升级 React/Ink/Node 基线，不引入 Gemini core/认证/SDK，不改 Host/core/桌面 RPC 契约。未发起收费请求、未安装全局包、未提交/推送/发布。

## 替换内容

| 旧 | 新 | Gemini CLI 对应 |
|---|---|---|
| 固定顶栏＋撑满屏幕空白视口 | `Static` 历史流（标准模式）或全屏 `Viewport`（`/screen` 切换）；启动头随历史输出，不常驻 | `DefaultAppLayout` + `MainContent` |
| 消息独占标题行＋纯文本 | `> ` 用户前缀、`✦ ` 助手前缀；助手正文走 Markdown 块级渲染 | `UserMessage.tsx` + `GeminiMessage.tsx` + `MarkdownDisplay.tsx` |
| 工具摘要钉在底部 | 工具卡按 seq 排序内联在历史中，显示结果/参数/状态；缺结果不推断成功 | `ToolGroupMessage.tsx` + `ToolMessage.tsx` |
| 对话框与输入框同时堆叠 | 审批/选择/配置/详情互斥替换输入控制区；普通输入仅在空闲时显示 | `Composer.tsx` `return null` 路径 |
| 无配置入口 | `/auth` 安全表单：隐藏 Key、不联网、不测试 Key、确认后三步写，结果未知冻结 | `ApiAuthDialog.tsx` |
| 审批只有 y/n | ↑↓ 选择选项，Enter 确认；答复未确认时不再允许再次放行同票 | `ToolConfirmationMessage.tsx` |
| 假光标按逻辑字符 | `string-width` 按终端字格折行，光标在视觉行内 | `InputPrompt.tsx` text-buffer |

## 合规适配

- `src/markdown.mjs`：块级解析流程修改自 Gemini CLI `MarkdownDisplay.tsx`（固定版 `a3dd9f8c…`）。保留 Google LLC 版权头与 Apache-2.0 许可证声明，修改说明记于 `third-party/README.md`，许可证全文在 `third-party/Apache-2.0.txt`。
- 适配内容：移除 TypeScript、Google settings/context/hooks；行内/代码/表格为本仓安全渲染（`content.mjs`），不执行 HTML/链接/ANSI；表格结束行继续解析；流式未闭合围栏保持可读。代码高亮和完整 CommonMark 一致性尚未实现。
- `string-width@7.2.0`（MIT）已作为直接依赖加入 `package.json`；此前已作为 Ink 的传递依赖在 `node_modules` 中。Rollup 将其内联进单文件产物，运行时零外部依赖不变。

## 验证

- Windows、Node v22.23.2，未提交工作区。`npm test` 指定开发态 Host：**36 tests / 36 pass / 0 fail / 0 skip**，约 6.86 s（含 2 条隔离真实 Host 会话/目录/配置冷重开）。
- 新包 **496,951 B**，SHA256 `a2ee51eb1a70dab580d9bc0db2fb1aefa44e52115834e3b4a7ee984c5060f47a`；dist/主包目录一致。`pack-tui.mjs` 自足校验通过（无裸包导入/动态 import/eval）。
- 26 个 `.mjs` 语法检查通过。伪 TTY `/help`→Ctrl+D rc=0。
- 合成预览帧确认：历史流式输出、Markdown（标题/粗体/代码块/表格）、工具卡内联、无配置时自动弹出 `/auth` 表单。
- Host SHA256 `052917f9…`（开发态，非同源桌面候选验收）。
- 日志 `target/tmp/tui-skeleton-20261024-0d93e10f/{tests.log,smoke.log}`。

## 仍缺

真实终端观感与真实模型任务（审批→落盘→差异→重启）、新包安装态、`@文件`补全、代码语法高亮、完整按键（Home/End/词移动/撤销/反向搜索）、MCP/技能/计划/压缩。不宣称完整对齐 Gemini CLI 或已交付。
