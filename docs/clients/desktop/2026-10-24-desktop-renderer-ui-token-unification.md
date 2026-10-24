# 2026-10-24 桌面渲染层视觉一致性修复（令牌真源 / 暗色 / 对比度 / 尺度）

任务模式：**实现修改 + 源码级验证**。依据是本轮针对 `apps/desktop/renderer/` 的只读 UI 审查结论（H1、H2、M1–M5、L1–L3），按建议顺序逐项修复。**不是** GUI 视觉验收，也不是候选重打或安装态验证。

## 1. 修复清单

### H1 三层全局令牌合并为单一真源

- 原状：`styles.css`、`frame.css`、`product-design.css` 各自声明整组主题色板，后加载者覆盖前者；实际运行外观由 `product-design.css` 最后的 `:root` 决定，修一处颜色要在三处同步。
- 修复：`apps/desktop/renderer/styles.css:2` 起声明唯一真源，把**运行时最终生效**的暖中性色板（原 `product-design.css` 的 `:root` 与 `@media` 暗色块）并入 `:root` 与暗色块；`frame.css:1` 删除整组色板声明、只留 `--chat-width`；`product-design.css` 删除 `:root`/暗色块与 `.settings-dialog` 的令牌覆盖，只做组件层覆盖。
- 外观保持：
  - `--new-session-fill` 暗色 `rgb(67,69,74)` 来自原 `frame.css` 暗色块（原 `product-design.css` 只覆盖了亮色的 `transparent`），已按原有效值保留。
  - `--settings-nav-active` 暗色 `rgb(67 69 74)`、`--settings-card-border` 暗色 `rgb(255 255 255 / 20%)` 来自原 `frame.css:145` 的 `.settings-dialog` 暗色覆盖，已提升为根级暗色值，避免活动标签与卡片描边变淡。
  - 自查更正：合并时一度把暗色 `--brand-surface` 改成浅色，而 `assets/sacode-logo.png` 是米白图形，会让 Logo 落到近白底上；已删除该覆盖，暗色沿用根级深色徽标底。
- 令牌可用性：`--settings-module` / `--settings-nav-active` / `--settings-card-border` 原只在 `.settings-dialog` 作用域给出，`models-page.css` / `plugins-page.css` 在设置弹窗外引用时会落到未定义；现改为根级语义别名（亮色等于 `--surface-3` / `--border`），与设置弹窗内取值一致。

### H2 LSP 面板暗色适配

`apps/desktop/renderer/lsp-results.css:103` 起：错误条底色/描边改为 `color-mix(in srgb, var(--danger) …)` 从语义令牌派生，正文改正文色、仅标题用 `--danger`；预览/非语义徽标 `#fff` 文字改 `--accent-text`，10px 字号改 `--fs-xs`，10px 圆角改 `--radius-s`，`var(--font-mono, monospace)` 改 `--font-code`。原 `#fef0f0` / `#f5c2c2` 固定亮色在暗色下不成立。

### M1/M2 未定义令牌与对比度

- 未定义令牌：审查中列出的 `--settings-*` 三枚已随 H1 根级化；剩余 3 枚未定义变量均为 JS 运行时注入（`app.js:1777/1781` 的 `--conversation-width`、`--caption-left`，`conversation-scroll.js:35` 的 `--composer-height`，后者带 CSS 回退），不是缺陷。
- 对比度：亮色 `--text-muted` `#757970` → `#676b63`、`--accent` `#386bd2` → `#2f5fc4`，语义状态色按最终表面重算。全部文字/非文字组合过 WCAG AA（正文 ≥ 4.5:1，非文字 ≥ 3:1）。

### M4 圆角回归冻结标准

`border-radius` 原始像素值收敛为：`--radius-xs/s/m/l/xl/panel` 令牌、`50%`（圆形控件）、`999px`（pill）、`0`，以及 1/2/3px 微圆角（进度条、发丝细节）与多值写法中的 `0`。`frame.css` 的 `border-top-left-radius:16px` 改 `var(--radius-l)`；`16px`/`18px`/`10px`/`7px`/`6px`/`5px` 等一次性圆角全部归入冻结档位。

### M3 统一焦点环

`apps/desktop/renderer/styles.css:98` 的全局焦点规则补入 `select`，仍为 `2px solid var(--accent)` / `outline-offset:3px`；会裁剪的滚动容器保留负偏移例外（`styles.css:179/211`）。组件内重复声明的焦点环（如 `.tool-toggle`、`.composer-primary`）保持不变，只统一同语义的取值。

### M5 字号收敛

新增 `--fs-xs`(11) / `--fs-ui`(14) / `--fs-title`(18) / `--fs-heading`(20) / `--fs-display`(24) / `--fs-hero`(28)，与既有 `--fs-s`(12) / `--fs-m`(13) / `--fs-l`(15) / `--fs-content`(14) 组成完整字阶。原始字号从 24 种降到 3 种，且仅剩装饰性取值：`composer-attachments.css` 的 8px 角标、22px / 64px 图标字形。管理页/页面标题按统一阶梯：页面主标题 `--fs-heading`、区块标题 `--fs-title`，并删除 `@media(max-width:800px)` 里把主标题改回 19px 的覆盖。

### L1–L3 状态色、阴影、间距

- 状态色：散落的 `#fef0f0`、`#fff`、`#d93025` 类硬编码改为 `--danger` / `--warn` / `--ok` / `--accent-text`，或由语义色 `color-mix` 派生表面。
- 阴影：`0 3px 12px #00000004`、`0 8px 30px #0002`、`0 20px 70px #0003` 等改为 `--elevation-soft` / `--elevation-panel` / `--elevation-prominent`。
- 间距：`padding`/`margin`/`gap` 归入 `--space-1..6`；保留 6px 作为图标–文字的半档（标准内已存在），结构性偏移（如 `-42px` 标题栏补偿、`36px` 控件高度）不强行令牌化。

## 2. 实跑读数

采集于 2026-10-24，Windows 本机，工作区未提交。脚本与日志在 `target/tmp/ui-audit-20261024/`（一次性产物，不入库）。

| 检查 | 命令 | 读数 |
|---|---|---|
| 令牌真源 | `node target/tmp/ui-audit-20261024/layers.mjs` | `styles.css` 定义 94 枚；`product-design.css` 定义 0；**下游重定义核心令牌 0** |
| 对比度 | `node target/tmp/ui-audit-20261024/contrast2.mjs` | 18 组全部 PASS，**failures: 0**；亮色最小 4.64（muted）、暗色最小 4.89（danger） |
| CSS 解析 | `node target/tmp/ui-audit-20261024/css-parse.mjs` | 21 文件、5794 声明、**errors 0**（postcss） |
| 结构自检 | `node target/tmp/ui-audit-20261024/css-sanity.mjs` | 21 文件、括号平衡、`undefined` 令牌 **problems 0** |
| 渲染层门禁 | `node --test test/renderer-syntax test/renderer-bundle-guard test/page-sources-parse test/renderer-el-shape` | **6/6**、fail 0、rc=0（`test-renderer-final.log`） |
| 受影响组件 | `node --test model-pages-render knowledge-page knowledge-electron plugin-gap-contract composer-stats context-meter-view tool-card` | **31 项 / 26 过 / 5 跳过 / 0 败**、rc=0（当时 5 项 skip 为 `env-blocked-electron`；2026-10-24 补跑见下行） |
| 受影响组件（中立目录补跑） | 同命令去掉 `model-pages-render`，`ELECTRON_OVERRIDE_DIST_PATH` 指向 `D:/tmp/...` 中立二进制 | **27 项 / 26 过 / 1 跳过 / 0 败**、rc=0。原 5 项跳过里 4 项是 `model-pages-render`、1 项是 `knowledge-electron` 的「须显式提供 `SACODE_HOST`」——后者属宿主门控，不是 Electron 环境受限。日志 `target/tmp/electron-neutral-20261024/ui-token-suites.log` |
| 字形/圆角/间距分布 | `node target/tmp/ui-audit-20261024/scan-css.mjs` | 字号 16 种（原始 3 种）、圆角 17 种（原始仅微圆角/圆心/pill/0）、非 4px 间距 109 处（6px 半档、结构性偏移） |

同批修复过程中曾出现一处自作缺陷：机械令牌化脚本对无连字符属性插值出 `gapundefined:` / `paddingundefined:`，波及 17 文件 118 处声明，在 `git diff` 抽检时发现并由 `fix-space-suffix.mjs` 全部修复；`css-sanity.mjs` 现对 `undefined` 令牌与括号平衡做常驻断言。

## 3. 未验边界

- **未做 GUI 视觉验收**：亮/暗、窄/宽、长文本、动效与焦点观感须由用户在桌面环境实机走查；自动测试不替代观感。本批当时的 5 项跳过中，4 项（`model-pages-render`）可用仓外中立目录 + `ELECTRON_OVERRIDE_DIST_PATH` 真实执行（该次补跑已在本批之后完成，仅作方法验证，不回溯改判本批读数），1 项（`knowledge-electron`）是缺 `SACODE_HOST` 的宿主门控。**更正**：仓库内直接跑会 `0x80000003`，原因是工作区完整性标签继承（D10），不是“本机不能跑 Electron”；把运行物放到 `D:/tmp` 等无标签目录即可。
- 未重打 dist / 宿主 / 安装包，现有候选与安装态**不包含**本批 CSS 改动。
- 未改任何 JS 逻辑、IPC 面、Host/core 源码；`session/append → task/start → turn/poll` 与审批/取消/结算语义未触碰。
- 未提交、未推送、未安装、未发布；未发起收费模型请求。
- `highlight.css` 的 Shiki 语法配色与 `--shiki-*` 变量按原调色表保留，不在本批统一范围内。
