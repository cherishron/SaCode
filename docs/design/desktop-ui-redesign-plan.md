# SaCode 桌面端 UI 重设计规划（v0.2）

> **v0.2 变更（落地后回写）**：① 两个 `--text-weak` 色值按 AA 修正（§2 规则 5 补了测量口径）；② 新增 `--td-bg-color-popup` 令牌，深色 `specialcomponent` 回归 `transparent`；③ 中性色改为**各主题显式赋值**，不再共用 `--td-gray-color-1..14` 单条梯度——单条单调梯度无法同时满足规划里「深色 surface 比 raised 更暗」的关系，且共用梯度使两套主题都带蓝味、偏离本表数值；④ 验收项扩到 7 条并接棘轮门禁。

> 关联：桌面端产品就绪度审计报告（E6 品牌统一）、品牌体系完整性审计报告、v1.5 发布 PRD E6、品牌决策 D1/D2（灵枢仅内部代号、主色 #366CFF）。
> 技术栈（沿用现状，不改）：Tauri 2 + Vue 3 + TypeScript + Vite + **TDesign Vue Next** + CSS 变量令牌体系。
> 本规划仅为「规划 + 设计系统 + 原型方案」，落地代码在确认后实施。

---

## 1. 已确认决策（来自本轮提问）

| 项 | 决策 |
|----|------|
| 主题模式 | **跟随系统 + 深色 + 浅色**三态；默认跟随 OS，可手动覆盖并持久化 |
| 视觉方向 | **TDesign 原生，仅换色**；不重写组件，只重做令牌（品牌/中性/语义/层级） |
| 重设计范围 | **令牌 + 设计系统先行**，页面级重做留待令牌稳定后 |
| 交付路径 | 设计令牌 → 组件规范 → **高保真 HTML 原型（浏览器验证）** → 落地到 `tdesign-theme.css` 等 |

**品牌前置结论（来自 D1/D2）**：对外统一 `SaCode`；主色唯一真源 = **`#366CFF`**；废弃 `#2f81f7` 与 `#d97757`。

---

## 2. 设计原则

1. **令牌驱动、零硬编码色**：所有颜色走 CSS 变量；禁止在组件 CSS 写死 hex（当前 `shell.css` 的 `#1b1a18` 暖底、`#2a2a28` 弹层是反模式，必须回收）。
2. **双主题同源**：深色/浅色共享同一套语义令牌名（`--bg-base`/`--text-strong`/…），仅数值不同；组件 CSS 不感知主题。
3. **TDesign 视觉语言保持一致**：沿用 TDesign 的圆角、间距、组件形态，降低回归风险与学习成本。
4. **低调、克制、专业**：契合「低调深色系」偏好；以留白、层次、微动效提升质感，不堆装饰。
5. **可访问性底线**：正文与背景对比度 ≥ WCAG AA（4.5:1），关键操作 ≥ 3:1；聚焦可见（已有 `outline: 2px solid var(--accent)` 规范，保留）。
   **测量口径（v0.2 补）**：一个文字令牌可能落到多种背景，必须枚举其全部目标表面（page / secondarycontainer / container / component / popup）逐个算比值后**取最小值**，不能只核页面底。只核 `--bg-base` 会把不合格值误判为达标——深色 `--text-weak` 原值 `#7a8294` 在 page 上是 4.90（看着达标），但在最亮的 inset 表面上只有 3.48（实际不合格）。深色约束面是最亮表面，浅色约束面是最暗表面。

---

## 3. 色彩系统（核心交付物）

### 3.1 品牌主色 `#366CFF` 梯度（TDesign 风格 1–10）

| Token | 值 | 用途 |
|-------|-----|------|
| `--td-brand-color-1` | `#eaf0ff` | 最浅底（selected 行 / 软填充） |
| `--td-brand-color-2` | `#d6e2ff` | 浅底 |
| `--td-brand-color-3` | `#b8ccff` | 浅底 |
| `--td-brand-color-4` | `#99b5ff` | 浅底 |
| `--td-brand-color-5` | `#7a9eff` | 浅底 |
| `--td-brand-color-6` | `#5b87ff` | hover |
| `--td-brand-color-7` | **`#366CFF`** | **主品牌（按钮/激活/强调）** |
| `--td-brand-color-8` | `#2457f5` | active |
| `--td-brand-color-9` | `#1f49d6` | 深底文字（浅色主题下品牌文字） |
| `--td-brand-color-10` | `#1a3cb0` | 最深 |
| `--td-brand-color-hover` | `#5b87ff` | 悬停 |
| `--td-brand-color-active` | `#2457f5` | 按压 |
| `--td-brand-color-light` | `#eaf0ff` | 软填充（= -1） |
| `--td-brand-color-focus` | `#cfe0ff` | 聚焦环弱填充 |
| `--td-text-color-brand` | 浅色 `#2457f5` / 深色 `#7a9eff` | 品牌文字（随主题覆盖） |

### 3.2 中性梯度 —— 深色主题（替换原 `#1b1a18` 暖底）

| Token | 值 | 用途 |
|-------|-----|------|
| `--td-bg-color-page` (`--bg-base`) | `#0f1115` | 页面底（原暖陶土，废弃） |
| `--td-bg-color-secondarycontainer` (`--bg-surface`) | `#171a21` | 次级容器（侧栏） |
| `--td-bg-color-container` (`--bg-raised`) | `#1e222b` | 卡片/分格 |
| `--td-bg-color-specialcomponent` (`--bg-overlay`) | `transparent` | 内联特殊容器（**v0.2 修正**：不设 `#23272f`，深色下它必须保持透明，否则依赖透明性的 TDesign 组件会糊底） |
| `--td-bg-color-popup` (`--bg-popup`) | `#23272f` | 弹层/菜单（**v0.2 新增令牌**：原规划把弹层色压在 specialcomponent 上，与内联用途冲突；单独设 token 后组件 CSS 不再需要按主题手写分支） |
| `--td-bg-color-component` (`--bg-inset`) | `#2a2f3a` | 输入框/芯片底 |
| `--td-mask-active` (`--bg-scrim`) | `rgba(0,0,0,.70)` | 遮罩 |
| `--td-text-color-primary` (`--text-strong`) | `#eef1f6` | 主文字 |
| `--td-text-color-secondary` (`--text-base`) | `#aab2c0` | 次文字 |
| `--td-text-color-placeholder` (`--text-weak`) | `#929bb0` | 占位/弱（v0.2 由 `#7a8294` 提亮，见 §2 规则 5 测量口径） |
| `--td-component-border` (`--border-weak`) | `#22262f` | 弱分隔 |
| `--td-border-level-1-color` (`--border-base`) | `#2a2f3a` | 强分隔 |

### 3.3 中性梯度 —— 浅色主题

| Token | 值 | 用途 |
|-------|-----|------|
| `--td-bg-color-page` (`--bg-base`) | `#f5f7fb` | 页面底 |
| `--td-bg-color-secondarycontainer` (`--bg-surface`) | `#eef1f6` | 次级容器 |
| `--td-bg-color-container` (`--bg-raised`) | `#ffffff` | 卡片/分格 |
| `--td-bg-color-specialcomponent` (`--bg-overlay`) | `#ffffff` | 内联特殊容器 |
| `--td-bg-color-popup` (`--bg-popup`) | `#ffffff` | 弹层/菜单（v0.2 新增，与深色同源） |
| `--td-bg-color-component` (`--bg-inset`) | `#f0f2f7` | 输入底 |
| `--td-mask-active` (`--bg-scrim`) | `rgba(15,17,21,.45)` | 遮罩 |
| `--td-text-color-primary` (`--text-strong`) | `#1a1f29` | 主文字 |
| `--td-text-color-secondary` (`--text-base`) | `#4a5160` | 次文字 |
| `--td-text-color-placeholder` (`--text-weak`) | `#616b77` | 弱（v0.2 由 `#8a91a0` 加深；该值即 `--td-gray-color-9`，非新造色） |
| `--td-component-border` (`--border-weak`) | `#eceff5` | 弱分隔 |
| `--td-border-level-1-color` (`--border-base`) | `#e2e6ee` | 强分隔 |

### 3.4 语义色（双主题共用，深浅各自微调透明度叠加）

| 语义 | 主值 | 软底 |
|------|------|------|
| success | `#1fa971` | `#d6f4e4` |
| warning | `#e8820c` | `#ffe8d5`（深色下 `#3a2a14`） |
| danger | `#d54941` | `#fbe0e0`（深色下 `#3a1f1d`） |
| info | `#366CFF` | `#eaf0ff` |

> 语义软底在深色主题下改用低透明品牌/红色叠加（如 `color-mix(in srgb, var(--danger) 16%, transparent)`），避免脏色块。

---

## 4. 字体 / 间距 / 圆角 / 层级 / 动效 令牌

- **字体**：沿用 `Inter`（UI）+ `JetBrains Mono`（代码）。`--font-sans` / `--font-mono` 保持不变。
- **字阶**：沿用 `theme.css` 的 `--text-12/13/14-*` 体系；补充 `--text-16/20/24-medium` 用于页头/标题（当前 feature-page 用 `clamp()` 临时值，建议收敛为令牌）。
- **间距**：沿用 `layout-contract.css` 的 `--space-1..8` 与 `--list-*` 密度档（compact/comfortable 已就位）。
- **圆角**：沿用 `6/10/14/18/full`，与 TDesign 一致，不改。
- **层级（shadow）**：沿用 `--td-shadow-1/2`；新增 `--shadow-pop` 用于浮层（弹菜单/文件选择），统一 `0 8px 24px rgba(0,0,0,.45)`（深色）/ `rgba(15,17,21,.12)`（浅色）。
- **动效**：沿用 `--ease-out` / `--dur-fast(120ms)` / `--dur-normal(200ms)`；尊重 `prefers-reduced-motion`（已有规则，保留）。

---

## 5. 主题架构（三态实现）

```
默认值：跟随系统  →  读取 window.matchMedia('(prefers-color-scheme: dark)')
手动覆盖：设置 → 外观 → [跟随系统 | 深色 | 浅色]，写入偏好并持久化
应用方式：
  - <html data-theme="dark|light">  —— 由偏好或系统推导后写入
  - tdesign-theme.css 提供 :root（浅色）与 [data-theme='dark']（深色）两套令牌覆盖
  - 系统变更监听：matchMedia change 事件，仅当偏好=跟随系统时同步
```

- **TDesign 暗色**：Vue Next 暗色需引入 `tdesign-vue-next/esm/style/index-dark.css`（构建期 import），或由 `data-theme` 切换我们自己的令牌覆盖（推荐自管令牌，避免依赖官方暗色表的配色偏差）。
- **落地文件**：
  - `src/ui/styles/tdesign-theme.css`：重写，含 `:root`（浅）+ `[data-theme='dark']`（深）双块，覆盖全部 TDesign 令牌（品牌/中性/语义/层级）。**核心改动点。**
  - `src/ui/logic/theme.ts`（新建）：封装 `getEffectiveTheme()` / `setPreference()` / `initTheme()`（含 `matchMedia` 监听 + 持久化到设置 store）。
  - `src/ui/logic/preferences.ts`：扩展 `appearance` 字段（`system|dark|light`）。
  - `shell.css`：删除 `#1b1a18` / `#2a2a28` 等硬编码，改回 `var(--bg-base)` / `var(--bg-overlay)`。
  - 设置页 `SettingsView.vue`：新增「外观」分类与三态单选。

---

## 6. 组件审计与规范

现状：组件全部基于 TDesign，样式通过 `theme.css` 桥接 + `shell.css` 覆盖。问题集中在**令牌层面**（暖色底、品牌色偏差），组件结构基本合理。

| 类别 | 结论 | 动作 |
|------|------|------|
| 按钮 / 输入 / 开关 / 标签 | TDesign 原生，仅受令牌影响 | 仅换令牌，无需改结构 |
| 任务列 / 分格 / 对话流 / composer | 自研布局，令牌驱动 | 回收硬编码色；保留布局 |
| 弹层/菜单（`plus-menu` 等） | 已写 `var(--bg-overlay)` 但硬编码 `#2a2a28` 兜底 | 删除硬编码兜底，统一令牌 |
| 模式循环（Plan/Build/Yolo） | 异色按钮，语义清晰 | 保留；色值随品牌梯度 |
| 状态点 / 徽标 | 引用 `--td-*` 令牌 | 保留 |
| 空态 / 插画 / 引导卡 | 当前文字为主，缺视觉 | 原型阶段补充轻量图标/插画占位（可选） |

**组件规范文档**输出：按钮态（default/hover/active/disabled/focus）、输入态、列表行密度、卡片间距、焦点环、暗/浅差异表。

---

## 7. 高保真 HTML 原型方案（验证用，单文件可预览）

- **文件**：`docs/design/prototype/desktop-ui-prototype.html`（单文件，内联 CSS 令牌 + 三态切换按钮）。
- **覆盖界面**（用 `#366CFF` 双主题令牌实渲）：
  1. 工作台：任务列 + 分格（对话/终端/文件）+ 标题栏品牌位
  2. 对话流：用户/AI 回合卡 + composer（Plan/Build/Yolo 循环 + 模型选择 + 附件芯片）
  3. 交互卡：待答问题 / 审批卡（底部吸附）
  4. 设置浮层：外观三态单选 + 分类导航 + 内容区
  5. 命令/技能 `+` 菜单、文件选择浮层
- **目标**：在浏览器中切换 跟随系统/深色/浅色，确认配色、对比度、层次、动效达标，再落地代码。

---

## 8. 落地路线图（Tauri2 + Vue3 + TDesign）

| 阶段 | 产物 | 关键文件 | 验收 |
|------|------|----------|------|
| M0 令牌定义 | 本规划 §3–4 令牌值 | — | 双主题对比无硬编码色 |
| M1 主题 CSS | 重写 TDesign 自定义主题（深/浅） | `tdesign-theme.css` | 全站随 `data-theme` 切换 |
| M2 回收硬编码 | 删除 `#1b1a18`/`#2a2a28` 等 | `shell.css` 等 | `grep` 全仓无裸 hex（除令牌定义处） |
| M3 主题逻辑 | 三态切换 + 系统监听 + 持久化 | `theme.ts` / `preferences.ts` / `SettingsView.vue` | 重启后保持；切 OS 自动跟随 |
| M4 HTML 原型 | 单文件原型验证 | `docs/design/prototype/*.html` | 浏览器视觉确认 |
| M5 组件规范 | 组件态规范文档 | `docs/design/component-spec.md` | 评审通过 |
| M6 品牌触点 | 标题栏/About/登录接入 SaCode 品牌（D3 标语、D4 Logo 待定） | `App.vue` / `AboutView.vue` | 双品牌冲突消除（D1） |

> 与 PRD E6「品牌统一」对齐；E6 的 Logo/标语（D3/D4）为前置待决策，影响 M6 但不阻塞 M0–M5。

---

## 9. 待补品牌决策（影响 M6，不阻塞令牌工作）

- **D3 标语**：About/对外文案需统一一句话价值主张。
- **D4 主品牌矢量 Logo + 商标预检**：标题栏/安装包/About 需统一母版。
- 二者确定后回填 M6，与 `#366CFF` 主色一并落地。

---

## 10. 风险与验收标准

- **风险**：TDesign 暗色表与我们自管令牌可能存在少量变量名差异 → M1 需对照 TDesign 令牌清单逐条覆盖，构建后实机比对。
- **风险**：`shell.css` 多处硬编码色回收易漏 → M2 用 `grep -rn "#[0-9a-fA-F]\{6\}" src/ui` 收口。
- **验收**：① 深/浅/跟随系统三态均可用且持久化；② 全仓组件 CSS 无裸 hex（令牌定义除外）；③ 主色唯一为 `#366CFF`，无 `#d97757`/`#2f81f7` 残留；④ 每个文字令牌在其**全部目标表面**上的最小对比度 ≥ AA 4.5:1（按 §2 规则 5 口径逐面计算，不得只核页面底）；⑤ 动效尊重 reduced-motion；⑥ 业务 CSS 不出现 `var(--td-*)` 直取，一律走 `theme.css` 别名；⑦ 组件 CSS 内不出现 `:root[data-theme='…']` 手写主题分支，双主题差异只由令牌承担。

> ②③⑥ 已由 `scripts/audit-design-tokens.sh` 做棘轮门禁（四项存量基线只降不升 + 「被引用的令牌必须有定义」校验），纳入 CI 即可持续防回归。
