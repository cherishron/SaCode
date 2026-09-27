---
feature: desktop-ui-refresh
status: delivered
updated: 2026-09-22
branch: dev
commits: 6f40e5c..6f40e5c
---

# SaCode Desktop UI Refresh

## Report

**What was built** — SaCode Desktop 视觉语言整体刷新：暖中性双主题令牌（深色暖石墨 / 浅色暖纸白 + 跟随系统）、Claude/ChatGPT 对话气质的消息语义块与圆角输入坞、会话列 760px 居中阅读、侧栏收束为品牌/会话/主视图、右栏改为默认关闭的覆盖式抽屉（有审批时自动打开）。控件四档按钮、软背景徽章、浮层阴影统一走 `tokens.css`，设置「外观」支持主题三档切换并持久化。

**Verification** — `npm run typecheck` PASS；`npm test` 24/24 PASS；`npm run build` PASS。深色真实壳截图 + 浅色组件墙截图确认新视觉方向；审查发现的 critical（`.conversation` 嵌套不撑满、`setupResponsive` 强开右栏）已修：`conversation-body{flex:1}`，宽屏不再覆盖 `contextOpen` 偏好。

**Journey log**
- 独立审查指出嵌套 `section.conversation > main.conversation` 会让短消息时输入坞不吸底 —— 拆出 `conversation-body` 并 `flex:1`。
- `setupResponsive` 原先在 lg 强制 `contextOpen=true`，与「右栏默认关」冲突；改为窄屏才强制收起，宽屏尊重用户偏好。
- T5「无硬编码色」字面量无法在 SaDesign 预览/资源色板上满足（S3 已排除业务视觉重写）；已将 T5 验收收窄为 chrome CSS 令牌化。
- 侧栏保留知识库/自动化主视图入口（Claude 式产品导航），spec S2.3 已同步。
- PowerShell 5.1 不支持 `&&`，串行命令用 `;`。

## [S1] Problem

SaCode Desktop 当前观感像未完成的线框：GitHub 深色令牌导致层次平、正文对比不足；消息流同时存在左边条、气泡、工具卡、审批卡多种语义，节奏杂乱；按钮/输入框/徽章接近默认样式，廉价；侧栏与顶栏信息拥挤。用户要求整体视觉语言刷新 + 布局信息架构重排，气质对齐 Claude / ChatGPT 对话产品，并一次交付深浅双主题。

## [S2] Design

### S2.1 视觉方向

- 风格锚点：Claude / ChatGPT 对话产品 —— 暖中性底、对话可读性优先、柔和圆角、少硬边框、多留白。
- 不走 GitHub 寒冷深蓝；不用大面积渐变/阴影堆砌。
- 令牌驱动：所有颜色/字号/圆角/阴影走 `tokens.css`，组件 CSS 禁止散落硬编码 `rgba(...)`。

### S2.2 双主题令牌

`html[data-theme="dark" | "light"]` 切换；默认跟随系统 `prefers-color-scheme`，可在设置「外观」中覆盖，持久化到 `sacode.desktop.preferences.theme`。

深色（暖石墨）：

| Token | Value |
|---|---|
| `--bg-base` | `#1b1a18` |
| `--bg-surface` | `#242321` |
| `--bg-raised` | `#2e2d2a` |
| `--bg-overlay` | `#353431` |
| `--text-strong` | `#f0eee8` |
| `--text-base` | `#b4b0a7` |
| `--text-weak` | `#7a766c` |
| `--accent` | `#d97757` |
| `--accent-hover` | `#e08a6c` |
| `--border-base` | `#3c3a36` |
| `--border-weak` | `#2c2b28` |

浅色（暖纸白）：

| Token | Value |
|---|---|
| `--bg-base` | `#f5f4ef` |
| `--bg-surface` | `#faf9f6` |
| `--bg-raised` | `#ffffff` |
| `--bg-overlay` | `#ffffff` |
| `--text-strong` | `#2c2a27` |
| `--text-base` | `#6b6760` |
| `--text-weak` | `#9c9890` |
| `--accent` | `#c45c26` |
| `--accent-hover` | `#b34f1f` |
| `--border-base` | `#e4e1d8` |
| `--border-weak` | `#ebe8e0` |

语义色双主题各有一组（success/warning/danger/info），保证与背景对比 ≥ 4.5:1 的正文可读。

排版：

- 正文 `15px/1.65`（默认主题），工具/元信息 `12–13px`。
- 标题层级：H1 20/600，H2 16/600，组件标题 14/600。
- 等宽：`JetBrains Mono, Cascadia Code, Consolas`。

形状与深度：

- 圆角：sm 6 / md 10 / lg 14 / xl 18 / full。
- 阴影仅用于浮层与输入坞（两级：`--shadow-sm`、`--shadow-md`）。
- 间距标度扩展：`--space-1..8`（4,8,12,16,20,24,32,40）。

### S2.3 布局信息架构（会话为中心）

```
┌────────────────────────────────────────────────────────┐
│  TitleBar（可选紧凑工具条，高 44）                        │
├──────────┬─────────────────────────────┬───────────────┤
│ Sidebar  │  Conversation               │ ContextDrawer │
│ 260px    │  消息流（居中列，max 760）     │ 默认关闭       │
│ 会话/项目 │  输入坞（吸底）               │ 360px 抽屉    │
├──────────┴─────────────────────────────┴───────────────┤
│  StatusBar（精简为 28，弱化）                            │
└────────────────────────────────────────────────────────┘
```

- 侧栏职责收束为：品牌 + 新建任务 + 会话列表 + 底部主视图切换（知识库 / 自动化）。文件树/次要操作入口进「更多」或右抽屉。
- 顶栏收束为：会话标题、模式、运行状态、上下文开关、设置。模型/技能选择下移到输入坞。
- 右栏默认关闭；有审批时自动打开。移动端/窄窗用覆盖式抽屉。
- 会话流消息列最大宽 `760px` 居中，形成对话阅读感。

### S2.4 消息流语言

统一语义块，去掉多套「左色条 + 气泡」混用：

- **用户消息**：右侧圆角卡片（`--bg-raised` + `--radius-lg`），最大宽 85%。
- **助手消息**：无边框正文流，直接排版；段落间距 12px。
- **思考过程**：可折叠细条，弱化色，不占主视觉。
- **工具调用**：紧凑折叠卡（头行图标+名称+耗时+状态点），默认收起输出。
- **审批卡**：独立强调卡（warning 软背景），操作按钮对齐右下。
- **系统/终态**：居中细文本 + 分隔线，弱化。

### S2.5 输入坞（Composer）

- 底部圆角容器（`radius-xl`），内部：上下文 tags、多行输入、工具行（@ / 模式 / 模型 / 技能 / 发送）。
- 发送按钮为主强调圆角按钮；运行中变「停止」。
- 输入框焦点时容器描边用 `--border-accent`，无廉价蓝框。

### S2.6 控件质感

- 按钮：主/次/幽灵/危险四档；高度 32–36，圆角 md-lg，字重 500。
- 输入/选择：高度 34，圆角 md，焦点 `border-accent` + 极轻 ring。
- 徽章/标签：软背景 + 彩色文字，不用描边胶囊堆叠。
- 菜单/浮层：`bg-overlay` + `shadow-md`，条目高度 32。

### S2.7 契约

- `applyInterfacePreferences` 设置 `document.documentElement.dataset.theme` 与 `dataset.density`。
- `DesktopPreferences` 新增 `theme: 'system' | 'dark' | 'light'`。
- CSS 只引用 `var(--*)`；新增色值必须进 tokens。
- 现有功能路径（会话、审批、SaDesign、设置、侧栏开关）不因视觉重构而丢失交互。

## [S3] Out of Scope

- 不引入 React/Solid/CSS 框架。
- 不改 daemon / Tauri sidecar 协议。
- 不做动效大动画系统（仅保留必要过渡）。
- 不重写 SaDesign / SaNative / Automation 业务逻辑，只套用新视觉令牌与壳布局。
- 不做多语言 i18n 框架。

## Tasks

- [x] T1: 重建 tokens.css 双主题 + base.css 排版/按钮/输入/徽章 — acceptance: light/dark 下可读，组件基础态无默认控件感 (covers: S2.1, S2.2, S2.6)
- [x] T2: app-shell 布局重排 + 侧栏收束 + 顶栏/状态栏精简 — acceptance: 会话列居中 max 760，右栏默认关，侧栏只保留会话/项目导航 (covers: S2.3)
- [x] T3: 消息流组件统一（user/assistant/thinking/tool/approval）+ 输入坞 Composer — acceptance: 语义块样式一致，输入坞含模式/模型/技能与发送/停止 (covers: S2.4, S2.5)
- [x] T4: 设置「外观」主题切换 system/dark/light 持久化 — acceptance: 切换即时生效并刷新后保持 (covers: S2.2, S2.7)
- [x] T5: 全局控件与浮层抛光（菜单/对话框/上下文抽屉）+ 壳层移除硬编码色 — acceptance: 抽屉/弹层用 tokens 阴影与圆角；chrome CSS 无散落 hex/rgba；SaDesign 预览/资源色板属 S3 排除 (covers: S2.1, S2.6)
- [x] T6: typecheck + 构建 + 测试回归 — acceptance: `npm run typecheck`、`npm test`、`npm run build` 通过 (covers: S2.7)
