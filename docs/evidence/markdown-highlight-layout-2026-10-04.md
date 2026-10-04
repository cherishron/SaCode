# Markdown 高亮与表格布局增量（2026-10-04）

## 上游依据

冻结版本 `639ed015397290b3745d163aafe02ffee4aa3f84` 的 [highlight.ts](https://github.com/deepseek-ai/deepseek-harness/blob/639ed015397290b3745d163aafe02ffee4aa3f84/packages/client/ui-primitives/src/markdown/highlight.ts) 采用 Shiki 核心、JavaScript 正则引擎、CSS 变量主题及有限语言映射，未知语言回退纯文本。依赖版本依据 [ui-primitives/package.json](https://github.com/deepseek-ai/deepseek-harness/blob/639ed015397290b3745d163aafe02ffee4aa3f84/packages/client/ui-primitives/package.json) 固定为 4.3.1，配色依据 [shiki.css](https://github.com/deepseek-ai/deepseek-harness/blob/639ed015397290b3745d163aafe02ffee4aa3f84/packages/client/ui-theme/src/styles/shiki.css)。

布局依据 [CodeBlock.module.css](https://github.com/deepseek-ai/deepseek-harness/blob/639ed015397290b3745d163aafe02ffee4aa3f84/packages/client/ui-primitives/src/markdown/CodeBlock.module.css) 和 [MarkdownText.module.css](https://github.com/deepseek-ai/deepseek-harness/blob/639ed015397290b3745d163aafe02ffee4aa3f84/packages/client/ui-primitives/src/markdown/MarkdownText.module.css)：代码块 16px 内边距；表格包裹在独立滚动区域内，少于四列或引用内表格填充内容列，宽表自然宽度；单元格 10/16px 内边距及下分隔线。

## 本批实现与差异

- 将冻结映射的 108 个别名、60 种语法折叠到既有 TinyRobot 经典脚本。保留当前 Vue runtime/h()，无 React、WASM 或运行时 import；语法模块在构建期全部包含，运行时按请求注册，不使用上游动态 ESM 懒加载。折叠文件本次 3917779 字节，体积与加载调度差异保留，不据此声明性能等价。
- 高亮结果转换为文本 span 和 CSS 变量样式，不采用 innerHTML；原始代码、Unicode 与换行逐字符保留，未知/空语言以及 constructor、__proto__ 等提示保持纯文本。仅有界缓存派生 token，不持有会话事实。流式与投影正文仍共用同一组件和颜色轴。
- 代码内边距 16px、R16，横向滚动条与表格共用 5px。表格增加滚动包装、对齐属性、窄表填充与宽表自然宽度，键盘焦点可滚动；各块仍使用现有共享正文左轴与 16px 块间距。
- 使用 esbuild 输出依赖检查真实动态/外部模块，避免把 TextMate 的 `import(?=...)` 规则字符串误判为模块表达式。真实构建反例覆盖动态导入、外部静态模块与 new Function，仍拒绝运行时求值及缺失依赖证据；原有 Vue 单实例自检保留。
- 原 SaCode 名称、图标和中文不变；保留 DSH MIT 授权，并随渲染资产加入 Shiki MIT 授权。

代码块仍未具备上游完整工具栏、复制/换行与行号控制，也未实现流式按行增量 token 重用、视口高亮调度或 Markdown 全部语义；现阶段重用相同源码的有界结果缓存，不冒称上游增量算法。附件、上下文节点、数学及完整格式兼容继续保留在目标范围内。

## 验证边界

隔离源码 `dualtest/markdown-highlight/source` 从 `8e1592f` 导出，仅加入本批前端/构建脚本和 Shiki 开发依赖；独立安装依赖并生成 vendor，未使用共享 node_modules，也未纳入工作区未提交的 Next SDK/provider/SSE 改动。核心、Host 未改，沿用以前已验的自包含 Host/DLL，结果不扩称最新核心集成或安装包通过。

本批构建实测使用 Node 22；Shiki 4.3.1 声明 Node >=20，所以前端 vendor 构建环境须满足该条件。Shiki 仅为构建开发依赖，桌面产物不增加运行时 npm 依赖；这不改变独立 CLI 的运行条件。

布局中的长代码与十列表格属于临时几何样本，不作为模型生成事实落盘。早一轮截图没有让宽表进入可视区域，最终测试已显式滚动到宽表并检查可见性；最终样式还统一横向滚动条并检查焦点前后高度，不能用早一轮结果代替最终复验。

## 宽表高度问题及回归

`layout-smoke-verified.log` 的八个宽表场景均因 `stableHeight` 失败：焦点前高度 94.3333px，焦点后 106px。此前仅重置 `scrollbar-width` 无效，因为 `.conversation-scroll` 的非 auto `scrollbar-color` 被后代继承，浏览器忽略了 WebKit 5px 滚动条设置。[MDN scrollbar-color](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/scrollbar-color) 明确说明这一覆盖与继承关系。

最终在代码块和表格上同时重置 `scrollbar-width:auto`、`scrollbar-color:auto`，保留冻结上游的宽表空闲 5px 底部留位、悬停或键盘焦点时显示滚动条的行为。`layout-smoke-scrollcolor.log` 已退出 0；随后补充实际 `offsetHeight-clientHeight` 为 5px 的断言，并在滚动与焦点变化后等待两个绘制帧再截图，最终证据以 `*-paint.log` 和结构报告为准。旧失败日志保留，不将其改写成通过。

## 最终隔离验收结果

- Node：`dualtest/markdown-highlight/desktop-tests.log`，95/95 通过，包括 108 别名原文保留、危险内容只生成文本、表格对齐，以及真实构建的模块加载反证。
- Electron UI：`dualtest/markdown-highlight/ui-smoke-paint.log`，191 项通过，退出 0。
- Electron 布局：`dualtest/markdown-highlight/layout-smoke-paint.log`，168 组、1536 项断言、0 失败，退出 0；亮暗两主题覆盖 860×600、880×640、1100×720、1440×900。
- 结构报告：`dualtest/markdown-highlight/source/apps/desktop/dist/layout/layout-report.json`；八个宽表场景实际滚动条占高均为 5px，焦点前 94.3333px、后 94px，差值约 0.3333px，满足小于 1px 的像素舍入容差。源码、十列结构、页面边界、焦点滚动和表格可视范围检查均通过。
- 人工检查最终 `sacode-wide-table-light-860x600.png`、`sacode-wide-table-dark-860x600.png`：实际宽表、键盘焦点框和滚动条已进入截图，正文及窄表的左轴一致，亮暗高亮颜色正常。与隔离副本逐文件哈希核对，本批 11 个源码/许可证文件全部一致；包元数据仅提交隔离副本中 Shiki 的依赖变化，保留工作区其他接入改动。

本结果证明本批高亮与表格基础布局增量，不代表完整桌面页面、代码块所有交互、最新核心集成、npm 安装或 Electron 安装卸载通过。完整 UI 对齐目标继续保留。
