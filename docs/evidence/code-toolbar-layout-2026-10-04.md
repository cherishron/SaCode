# 代码卡工具栏与 Markdown 字号增量（2026-10-04）

## 上游依据

冻结快照 `639ed015397290b3745d163aafe02ffee4aa3f84`：

- [CodeToolbar.tsx](https://github.com/deepseek-ai/deepseek-harness/blob/639ed015397290b3745d163aafe02ffee4aa3f84/packages/client/ui-primitives/src/CodeToolbar.tsx)、[CodeCard.module.css](https://github.com/deepseek-ai/deepseek-harness/blob/639ed015397290b3745d163aafe02ffee4aa3f84/packages/client/ui-primitives/src/CodeCard.module.css)：语言与操作按钮同行居中；头部 10/18/8/22px 内边距、12px 分区间距；动作之间 4px，按钮 24px、图标 14px；代码卡正文 6/22/20px 内边距。
- [CodeBlock.tsx](https://github.com/deepseek-ai/deepseek-harness/blob/639ed015397290b3745d163aafe02ffee4aa3f84/packages/client/ui-primitives/src/markdown/CodeBlock.tsx)、[CodeBlock.module.css](https://github.com/deepseek-ai/deepseek-harness/blob/639ed015397290b3745d163aafe02ffee4aa3f84/packages/client/ui-primitives/src/markdown/CodeBlock.module.css)：默认换行、每块独立状态、复制成功反馈持续一秒；头部 sticky，根卡不裁掉其吸顶行为。
- [gradient-shadow-text.css](https://github.com/deepseek-ai/deepseek-harness/blob/639ed015397290b3745d163aafe02ffee4aa3f84/packages/client/ui-theme/src/styles/gradient-shadow-text.css)：标题 21/30、19/28、18/26px，高阶标题使用正文字号；表格使用次级字号与行高；行内代码固定 12/19px，代码块固定 11/19px。
- [clipboard.ts](https://github.com/deepseek-ai/deepseek-harness/blob/639ed015397290b3745d163aafe02ffee4aa3f84/packages/client/ui-primitives/src/clipboard.ts)、[icons/index.tsx](https://github.com/deepseek-ai/deepseek-harness/blob/639ed015397290b3745d163aafe02ffee4aa3f84/packages/client/ui-primitives/src/icons/index.tsx)：Clipboard API 优先，无该 API 时回退复制；沿用其复制、成功和换行图形，保留既有 DSH MIT 授权。

## 本批实现与边界

新增 `renderer/code-block.js`，纯经典脚本 + Vue runtime/h()，不增加 React、模板编译器、运行时模块或新的 IPC。围栏与缩进代码由同一个代码卡组件承接；流式与已保存正文共用它。组件以源码行位置为键，使围栏后续增长保留本地换行选择；这不是流式增量解析或增量 token 算法。

默认换行以显示完整长代码；用户关闭后只在代码正文内横向滚动，工具栏不随横向滚动移位。语言不受支持时显示中文“代码”；动作标签为“自动换行”“取消自动换行”“复制代码”“已复制”。按钮有键盘焦点和 pressed 状态，复制失败显示中文错误。只有剪贴板接口接受写入后才显示成功，重复未完成写入被阻止；组件卸载清理计时器。复制与显示保留解析器提供的原文及换行，不附加工具栏、行号或成功提示。

工具栏采用上游卡片布局和吸顶；代码正文从上一批 16px 普通 pre 内边距调整为卡片的 6/22/20px。标题、代码、表格的字号同时校正，表格次级字号必须在正文节点派生，避免从根节点继承已经求值的固定 13px。正文 10/14/22px 时，表格分别为 9/13/20px，行高分别为 18/22/29px；标题随正文增量，代码保持固定字号。

仍未完成：上游 portal Tooltip（本批使用原生 title 与中文可访问标签）、可选行号、按行增量高亮与视口调度、完整 Markdown 数学/附件/上下文行为。品牌仍为 SaCode，原应用图标不变；不把本批工具栏基础交互视为全部页面对齐或原生插件兼容完成。

## 验证来源与限制

隔离目录 `dualtest/code-toolbar/source` 从 `59bdaa3` 导出，只加入本批前端文件及布局测试，按提交中的锁文件执行 `npm ci --ignore-scripts` 并重新生成 vendor。Host/DLL 沿用上一批已验自包含产物，没有混入其他会话未提交的 provider/核心改动；不声明最新核心、npm 包或 Electron 安装包通过。

Node 回归覆盖成功前不回显、精确复制参数、失败提示、默认/切换换行、源码增长保留选择、卸载清理、无 Clipboard API 时的临时节点清理和焦点恢复。真实 Electron 工具栏测试在临时渲染夹具中拦截 Clipboard API 写入参数，检查中文反馈；不写用户系统剪贴板，也不把这项检查表述为原生系统剪贴板端到端验收。

早一轮 `layout-smoke-final.log` 的字号 10/22 场景因表格字号继承问题失败；失败日志保留。随后 `layout-smoke-verified.log` 的吸顶断言错误地对比滚动容器外缘，漏算内容内边距；单场景诊断 `sticky-diagnostic.json` 显示视口 top=52.6667px、工具栏 top=68.6667px，正好相差紧凑布局的 16px 内边距。最终以修正后的 `*-complete.log` 和结构报告为准：代码卡原始上缘必须已经滚过内容边界，而工具栏停在视口上缘加实际 padding-top 的位置，容差小于 1px。吸顶检查临时增加可滚动尾部空间，随后移除夹具；夹具不写入会话事实。诊断副本只跑一个场景并强制退出 1，最终已恢复完整两主题四尺寸测试，不以诊断结果冒充全量验收。

## 最终结果

- Node：`dualtest/code-toolbar/desktop-tests-final.log`，97/97、退出 0。
- Electron UI：`dualtest/code-toolbar/ui-smoke-complete.log`，191 项、退出 0。
- Electron 布局：`dualtest/code-toolbar/layout-smoke-complete.log`，176 组、1736 项断言、0 失败、退出 0；亮暗主题覆盖 860×600、880×640、1100×720、1440×900。原有表格、设置、预览、会话和输入验收继续通过。
- 结构报告：`dualtest/code-toolbar/source/apps/desktop/dist/layout/layout-report.json`。八个代码工具栏组全部通过；紧凑尺寸吸顶位置相对视口外缘为 16px，常规尺寸为 24px，均等于实际内容内边距；字号 10/14/22 的标题阶梯、表格次级字号和固定代码字号通过；流式与投影组件的换行选择在源码增长后保持。
- 实际截图已复核亮色吸顶 `sacode-code-sticky-light-860x600.png` 与暗色工具栏 `sacode-code-toolbar-dark-860x600.png`：标签、换行/复制图标同行居中，长代码换行留在卡片内，吸顶头部没有随源码滚出视口。六个前端源码/测试文件与隔离副本的逐文件 SHA-256 核对均一致。

本批未生成新安装包，也未触碰其他会话的模型、核心或 npm 发布接入。完整桌面 UI 对齐目标仍在推进。
