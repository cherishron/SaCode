# 2026-10-24 CLI TUI 视觉调整：Warp＋Ollama 终端适配

## 范围与来源

- 用户明确指定终端 TUI，并同意使用 awesome-design-md 的 Warp 分区层级＋Ollama 极简方向。仅调整 `apps/cli/tui/` 展示层、展示测试与文档，不改桌面/Host/core/启动器/模型配置。
- 已完整读取上游固定版本 `3b605329240ce735b510037cca322f1831fdd7f8` 的 [Warp DESIGN.md](https://github.com/VoltAgent/awesome-design-md/blob/3b605329240ce735b510037cca322f1831fdd7f8/design-md/warp/DESIGN.md) 与 [Ollama DESIGN.md](https://github.com/VoltAgent/awesome-design-md/blob/3b605329240ce735b510037cca322f1831fdd7f8/design-md/ollama/DESIGN.md)。getdesign.md 页面抓取传输失败后，改用 GitHub 固定源码，不宣称已从失败页面取到内容。
- 两份文件是网站设计分析，不是两个终端产品的官方规范；只采纳低装饰、单列阅读、留白、细线分区，不照搬品牌与网页字体/背景/像素样式。本地规范见 [`apps/cli/tui/DESIGN.md`](../../../apps/cli/tui/DESIGN.md)。
- Context7 本次工具目录无可用端点，未使用；Ink API 按已安装 `ink@5.2.1` 的 README、`Box.d.ts` 和实跑渲染测试核实，无新增依赖或安装。

## 改动与影响

| 文件 | 变化 | 原因与边界 |
|---|---|---|
| `src/theme.mjs` | 集中语义色、字格间距与紧凑断点 | 正文/背景跟随终端，兼容用户浅深主题；不强制字体或 24-bit 色 |
| `src/components.mjs` | 中性顶部/消息标签；工具状态文字；空会话引导；单线审批/输入；语义色状态栏 | 消除 cyan/magenta 大面积竞争；目录不再重复；摘要明确标注，不冒充完整参数；不改变 y/n 或工单 |
| `src/app.mjs` | 工具活动移到独立区；48 列/短窗口紧凑展示；底部控件禁止收缩 | 对话区独自收缩，避免长历史挤掉审批/输入；仍无历史滚动功能 |
| 帮助文案 | 删除尚未实现的 `/clear` 宣告 | 不新增命令，不让设计改动宣告不存在的功能 |
| `test/components.test.mjs`、`test/app.test.mjs` | 增加 6 条展示/resize 回归 | 核空态、语义、摘要、未知工具状态和长历史下控件可见性；不当真实模型证据 |

消费 Host 方法、审批/取消/结算路径没有修改。测试夹具和合成文字仅用于展示，不冒充实际读取或执行。

## 实跑读数

- 环境：本机 Windows、Node `v22.23.2`，依赖沿用现有锁文件。工作区未提交。
- `apps/cli/tui` 下设 `SACODE_HOST=apps/desktop/dist/host/bin/sacode-host.exe` 后 `npm test`：**14 tests / 14 pass / 0 fail / 0 skip**，约 1.73 s；其中真实 Host 只验证引导/追加/投影，不起真实模型轮次。
- 新增布局回归覆盖 **100×30 与 48×18** resize；10 条长历史下仍可见工单、y/n、输入提示，帧不超过 18 行；紧凑态省略 token 计量，扩大后恢复次要说明。
- `node scripts/pack-tui.mjs` rc=0，自足校验通过；`apps/cli/tui/dist/index.mjs` 与 `npm/sacode-cli/tui/index.mjs` 均为 **454,635 B**，SHA256 `3b0e801ad2d123a822b40dd0475fd40fd7bd31d8e5feced7d3a7dcdc3b695359`。
- 新包＋开发态真实 Host 的伪 TTY `/help`→Ctrl+D 烟测 rc=0；真实 Host SHA256 延续 `052917f95f2d6f966aa94a941b988d07f1081d50c1c0b8d44dc008297f4fb4ea` 的开发态取证，不据此宣称同源完整候选验收。
- 12 个源码/测试/构建 `.mjs` 的 `node --check` 通过。当前子工程没有 lint/typecheck 脚本，未把语法检查等同于 ESLint/TypeScript。
- 日志：`target/tmp/tui-design-20261024-dbf24619/{tests.log,smoke.log}`。展示层合成文本预览已查看，不是截图/用户终端实测。

## 未验边界与交付状态

- 真实 Windows Terminal/PowerShell 的配色、字体宽度、CJK 折行与真实窗口 resize 仍待用户复验；自动布局测试不替代真终端观感。
- 真实模型审批→落盘→差异→重启恢复未验。此版参数仍为摘要，未新增完整参数查看或历史滚动。
- 10-23 tarball 安装与干净重建、同日 UTF-8 修复包均是旧哈希证据，不挪用于本次新包；本次未重新安装或构建平台包。
- 未收费请求、未安装新依赖/全局包、未提交/推送/发布；当前桌面候选和对外入口不变，TUI 仍是待用户验收的独立增量。

复验入口（仓库根、真实终端，不重定向）：`node npm/sacode-cli/bin/cli.js tui`。先看首屏、输入和 `/help`，无需模型请求；真实模型另按授权执行。
