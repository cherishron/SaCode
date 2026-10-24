# 2026-10-24 CLI TUI 输入、翻阅与审批详情

## 范围

用户要求继续完善终端 TUI。本轮限定为已说明的输入编辑、对话翻阅、审批完整参数三项，不扩展供应商/会话管理，不改 Host/core/桌面或 RPC 契约；沿用 Warp＋Ollama 局部设计规范。

## 改动

- `src/editor.mjs`：按 `Intl.Segmenter` 字素处理插入/移动/前后删除，避免拆 emoji 和组合字符；Ctrl+A/E 行首/尾。Ink 5 的公开 useInput 不暴露 Home/End，本轮明确不支持，不绑定内部解析器。
- `src/app.mjs`：输入历史退回恢复原草稿；生成中回车不清空下一条草稿、不自动排队或发模型请求。粘贴换行转空格并提示，控制字节过滤；仍是单行编辑器。
- `src/viewport.mjs`：按 Ink `measureElement` 实际布局高度（含长行折行）翻页，不再只取最后 10 条消息或把流式正文截至 4000 字符；默认从尾部看最新，PageUp/PageDown 翻阅。仅覆盖 Host 本次返回的投影，不宣称服务器完整历史分页。审批参数视图初始从头查看，可翻页。
- `src/components.mjs`：光标两侧分别裁剪以保住光标；审批增加 d 切换完整参数。详情显示宿主原始参数字符串，不 JSON 重排/摘要截断；控制字符以可见转义展示，防 ANSI/OSC 控制终端。详情操作不答票，y/n 仍仅传 approvalId/decision，取消路径不变。
- 没有安装依赖。Context7 本轮查询工具目录无端点，未使用；Ink 5.2.1 的 measureElement/useInput 行为以已安装源码与渲染回归核实。

## 证据

- Windows / Node v22.23.2，工作区未提交。`SACODE_HOST` 显式指开发态 `apps/desktop/dist/host/bin/sacode-host.exe`（此前 SHA256 `052917f9…`），不是同源桌面候选验收。
- `npm test`：**23 tests / 23 pass / 0 fail / 0 skip**，约 4.11 秒；新增 9 条回归覆盖字素编辑、粘贴不发送、草稿恢复、长光标、长历史翻页、完整审批参数翻页/拒绝和控制码可见转义。真实 Host 用例仅引导/追加/投影，不发模型请求；交互分支使用合成客户端，不冒充真实审批任务。
- `node scripts/pack-tui.mjs`：rc=0，自足校验通过；dist/主包目录单文件 **460,413 B**，SHA256 `82152ba46b2ba7787ac06306a72a17fac2056b806241c834de70f44e4f3e6ed0`。
- 新包＋真实开发态 Host 的伪 TTY `/help`→Ctrl+D rc=0；15 个 `.mjs` 的 `node --check` 通过。没有 lint/typecheck 脚本，不将语法检查冒充这两项。
- 原始日志 `target/tmp/tui-interaction-20261024-fcc76a19/{tests.log,smoke.log}`；此前设计包/安装包哈希证据保留，不用于本包安装验收。

## 边界

真实终端键盘/窗口/CJK 字宽、真实模型读取→审批→落盘→差异→重启仍待验；本轮未新包安装、未收费请求、未提交/推送/发布。未增加 Home/End、多行编辑、服务端历史分页、持久草稿、供应商配置或会话切换。桌面候选与主阻塞不变，TUI 仍候选待验。
