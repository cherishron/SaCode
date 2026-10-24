# SaCode 桌面渲染层设计规范（DESIGN.md）

> 上游设计原则提炼 + 本仓令牌映射。**仅适用 `apps/desktop/renderer/`**。

## 0. 来源、权威顺序与边界

- 上游来源：[VoltAgent/awesome-design-md](https://github.com/VoltAgent/awesome-design-md) 的 `design-md/linear.app/DESIGN.md` 与 `design-md/vercel/DESIGN.md`（Google Stitch「DESIGN.md」格式）。
- 读取方式与限制：本机直连 `raw.githubusercontent.com` / jsDelivr 被 robots/连接阻挡，改经搜索引擎快照读取上游 `main` 分支正文，**未锁定 commit**。本地同源先例 [`apps/cli/tui/DESIGN.md`](../../cli/tui/DESIGN.md) 已固定上游 commit `3b605329240ce735b510037cca322f1831fdd7f8`；如需与本文件严格同源，请以该固定版本复核。
- 上游文件是对**网站**的设计分析，不是 Linear/Vercel 的官方产品规范，也不构成本仓契约。**只采纳原则**，不复制品牌、商标、专有字体、网页布局或像素数值。
- 权威顺序（冲突时由高到低）：当前源码与 [`PRD`](../../../docs/product/PRD.md) / [`desktop-design-standard.md`](../../../docs/product/desktop-design-standard.md)（产品级布局与品牌数值标准，冻结上游口径）> **本文件**（渲染层设计原则与令牌映射，供改动、评审与 agent 参照）。本文件只写"原则 + 令牌落点"，不重抄数值规则表。
- 适用面：仅 `apps/desktop/renderer/`。不覆盖 CLI TUI、移动端、Host、core。

## 1. 设计原则 → 本仓令牌落点

| # | 原则（提炼自上游） | 本仓落点 |
|---|---|---|
| 1 | 单一真源、深浅两套（Linear 用单一色系 + 四级阶梯；Vercel 用中性色阶） | `renderer/styles.css` `:root` 是**唯一**色板与尺度来源；暗色由 `@media (prefers-color-scheme: dark)` 覆写同一组令牌。`frame.css` / `product-design.css` 及页面级 CSS **只做组件覆盖，不重定义主题令牌**。组件里**不落硬编码颜色/字号/圆角** |
| 2 | 层级靠「表面阶梯 + 发丝描边」，不靠重阴影（Linear 四级 surface + hairline；Vercel 的 shadow-as-border） | `--surface` / `--surface-2` / `--surface-3` / `--surface-bubble` / `--panel-surface` + `--border`（0.5px/1px 描边）+ `--elevation-stroke` / `--elevation-soft` / `--elevation-panel` / `--elevation-prominent` 投影栈 |
| 3 | 单一彩色强调只用于主 CTA / 焦点 / 链接，禁第二个强调色与装饰性用色（Linear lavender 用得很省） | `--accent` / `--accent-text` 只给主按钮、焦点环、链接；语义色 `--ok` / `--warn` / `--danger` 只表状态，不作装饰 |
| 4 | 4px 基数与克制尺度（Linear 4/8/12/16/24/32/48/96） | `--space-1`..`--space-6` = 4/8/12/16/24/32；业务组件不另立一套间距。**6px** 是保留的图标–文字半档；标题栏补偿等结构性偏移（如 `-42px`）与控件高度不走间距令牌 |
| 5 | 内容列限宽居中（Linear 约 1280px 内容宽；Vercel 约 1200px） | `frame.css` `.conversation-center` 上的 `--chat-width`；`.stream` 与同层内容（如结构化提问卡）用 `width:100%; max-width:var(--chat-width); margin-inline:auto` |
| 6 | 字阶少而稳、正文字重轻、标题负字距（Linear Display 600 / body 400 单一 voice） | 字阶：`--fs-xs`(11) / `--fs-s`(12) / `--fs-m`(13) / `--fs-ui`(14) / `--fs-l`(15) / `--fs-content`(14) / `--fs-title`(18) / `--fs-heading`(20) / `--fs-display`(24) / `--fs-hero`(28)；行高 `--line-content` / `--line-user`；字体栈 `--font-ui` / `--font-code`（代码不裸 `monospace`，避免中文回退宋体） |
| 7 | 形状分档、状态变化不改几何（Vercel radius 尺度） | `--radius-xs` / `--radius-s` / `--radius-m` / `--radius-l` / `--radius-xl` / `--radius-panel`；控件共享高度 `--control-height` |
| 8 | 深度克制：阴影只留给输入 / 浮层 / 弹窗（Linear 无渐变无 spotlight；Vercel 栈式阴影替代边框） | `--elevation-soft`（输入）/ `--elevation-panel`（浮层）/ `--elevation-prominent`（弹窗）；普通平面只用 0.5px 描边 |
| 9 | 动效只表状态、可关闭（上游均无氛围动画） | 仅状态型动画，如 `.msg-waiting-dots` 的 `@keyframes msg-waiting-pulse`；`@media (prefers-reduced-motion: reduce)` 下静止 |
| 10 | 焦点与可访问性显式（Vercel 2px focus outline；Linear 焦点环用强调色） | `button,a,input,textarea,select,[tabindex]:focus-visible { outline:2px solid var(--accent); outline-offset:3px; }`（会裁剪的滚动容器用负偏移）；控件 hover / focus-visible / disabled 态齐备 |

## 2. 组件基线（近批落地，作为范例）

- **消息列**：气泡列表 `gap` 用间距令牌（默认收在 `--space-3`）；正文折叠是行级括住（`max-height` + `overflow` + `::after` 渐变遮罩，遮罩底色 `--tr-bubble-box-bg`），**不用硬截断**；折叠/复制是 24×24 **SVG 图标按钮**（`.btn-fold` / `.btn-copy`，`currentColor`），不用文字按钮。
- **工具卡**（`.tool-node`）：展开控件是 16×16 SVG chevron 图标按钮（`.tool-toggle`），卡片 `width:100%` 撑满气泡、展开区随之拉满。
- **结构化提问卡**（`.user-question-card`）：与消息列同宽居中（`max-width:var(--chat-width); margin-inline:auto`）；已答/已取消/未知/跨会话或本地已提交后**自动收起**为「表头 + 选择摘要 + 查看详情」，展开只读。
- **等待占位**（`.msg-waiting`）：发送后助手正文未到达时，三点跳动 + 「正在等待模型响应…」，`role="status"` / `aria-live="polite"`。
- **新增/编辑表单**（范例：供应商页 `.ps-editor-dialog`、自定义模型页 `.cm-editor-dialog`）：放进共享 `SaCodeDialog`（`renderer/dialog.js`），不在列表后展开内联区块，列表因此不位移；宽表单以页面类加宽（`min(760px, calc(100vw - 48px))`）、`.dialog-body` 去 `gap`、操作条在底部 sticky 并用 `-1 * var(--space-5)` 抵消体边距；校验/保存错误显示在弹窗内，关闭与 Escape 在保存中保持禁用。
- **滚动条**：`.conversation-scroll` 等用 `scrollbar-width:thin`，thumb 以 `color-mix(in srgb, var(--border) …)` 做细窄半透明。

## 3. Do's and Don'ts

**Do**

- 只用 `--*` 令牌；新增语义先加令牌，再在组件引用。
- 用「表面阶梯 + 发丝描边」表达层级；`--accent` 只给主 CTA、焦点环与链接。
- 图标控件用 `currentColor` + 尺寸令牌；控件态（hover / focus-visible / disabled）齐备。
- 内容列限宽居中；窄容器下折叠/展开区拉满可用宽度。
- 动效克制，并能被 `prefers-reduced-motion` 关闭。
- 状态色表面用 `color-mix(in srgb, var(--danger|--warn|--ok) N%, var(--surface-*))` 从语义令牌派生，深浅两套自动成立；正文保持 `--text`，只有标题/图标用状态色。
- 遮罩与提示文字用 `--mask-bg` / `--tooltip-text`，不在组件里写 `rgba(0,0,0,…)` 或 `#fff`。

**Don't**

- 不在组件里硬编码颜色 / 字号 / 圆角（深浅两套必漏其一）。
- 不引入第二个彩色强调色；不把强调色当背景或卡片填充。
- 不加氛围渐变、spotlight 卡片、装饰性动画。
- 不用重阴影承担平面层级。
- 不把「折叠 / 展开」做成文字按钮。
- 不为迁就某个上游品牌而改本仓既有形状令牌。既有例外以源码为准：`composer-primary` 是 34px 圆形发送键、`.tr-bubble__box` 用 `--radius-xl`、输入主容器用 `--radius-panel`——**不照搬上游「禁 pill 圆角」之类禁令**。

**已登记的原始值例外**（改到这些位置时不强行令牌化）：

- 6px：图标–文字半档间距（见原则 4）。
- `composer-attachments.css` 的 8px 角标字号、22px / 64px 装饰性图标字形。
- `1/2/3px` 微圆角（进度条、发丝细节）与 `50%` / `999px` / `0`。
- `highlight.css` 的 `--shiki-*` 语法调色表：来自冻结上游的代码高亮配色，独立于产品色板。

## 4. 不可越过的边界

- 只改渲染，不改 `session/append → task/start → turn/poll`、审批工单、取消与结算语义。
- IPC 面是 `preload.cjs` 顶层 key 的**有限集**，不提供「发任意方法」通道；增删通道须同步 `test/bridge.test.mjs`。
- 渲染层运行时无模块加载器、无模板编译器、无 TypeScript、无 ESM；第三方组件只在构建期折叠成经典脚本（CSP `script-src 'self'`，`file://`）。不引外部字体 / CDN / 远程资源。
- 不复制上游品牌、商标、专有字体或网页布局；引用上游只给链接。
- 单测或页面通过只是局部证据，不等于 GUI 验收，也不等于版本交付。

## 5. 验证口径

- 渲染层改动跑 `node --test`：`test/renderer-syntax.test.mjs`、`test/renderer-bundle-guard.test.mjs`、`test/page-sources-parse.test.mjs`、`test/renderer-el-shape.test.mjs`，以及受影响组件测试（如 `test/tool-card.test.mjs`、`test/session/user-question-card.test.mjs`、`test/msg-waiting.test.mjs`、`test/msgfold.test.mjs`、`test/msg-copy.test.mjs`、`test/model-pages-render.test.mjs`）。
- CSS 令牌改动须同时核亮 / 暗两套与 `prefers-reduced-motion`，并做三项机械核对：
  1. **单一真源**：主题令牌只允许在 `styles.css` 定义，其他 CSS 不得重定义；
  2. **可解析**：全部渲染层 CSS 过 postcss 解析、括号平衡、无 `undefined` 令牌；
  3. **对比度**：按相对亮度计算，正文 ≥ 4.5:1、非文字 ≥ 3:1，取该色可能落到的所有表面中的最小值，亮暗分别记录。
- 改动后重跑受影响的既有测试；跳过项必须写明环境原因（本机 Electron 为 `0x80000003`），不把跳过记为通过。
- GUI 观感（间距、对齐、动效）须由用户在桌面环境实机验收；本工具环境 Electron 受限，自动测试不替代观感。

## 6. 上游来源

- [VoltAgent/awesome-design-md](https://github.com/VoltAgent/awesome-design-md)（MIT；集合文本，声明不主张各站点视觉标识所有权）
- [linear.app DESIGN.md](https://github.com/VoltAgent/awesome-design-md/blob/main/design-md/linear.app/DESIGN.md)
- [vercel DESIGN.md](https://github.com/VoltAgent/awesome-design-md/blob/main/design-md/vercel/DESIGN.md)
- 本地同源先例：[apps/cli/tui/DESIGN.md](../../cli/tui/DESIGN.md)