# SaCode 品牌令牌规范（Brand Token Spec）v0.1

> 状态：基于已决策项（D1/D2/D3/D4）落地的品牌单一真源。
> 适用范围：桌面端（Tauri+Vue3+TDesign）、CLI/TUI、文档站、安装包、About 页。
> 关联：`docs/design/desktop-ui-redesign-plan.md`、`docs/decisions/待决策事项清单.md`。

## 1. 决策依据

| 项 | 决策 | 含义 |
|----|------|------|
| D1 灵枢定位 | 仅内部架构代号 | UI/文档不向终端用户暴露「灵枢」，改用中性词（角色编排 / 冲突干预 / 任务摘要） |
| D2 主色 | `#366CFF` | 唯一品牌色，废弃 `#2f81f7` 与 `#d97757` |
| D3 标语 | 以 `SaCode` 为核心词 | 标语在现有叙事上精炼；示例：「SaCode · Claude Code 的体验，国内模型原生适配，企业级可审计」 |
| D4 矢量母版 | 生成 SVG 母版 + 商标预检 | 母版见 `assets/sacode-mark.svg`、`assets/sacode-logo.svg`、`assets/sacode-logo-dark.svg` |

## 2. 色彩令牌

### 2.1 品牌主色（Blue 366CFF）
```
--brand-50:  #EAF0FF
--brand-100: #D2DEFF
--brand-200: #A9BEFF
--brand-300: #7E9BFF
--brand-400: #5B86FF
--brand-500: #366CFF   /* 主色 · 唯一真源 */
--brand-600: #2A57E0
--brand-700: #2045B8
--brand-800: #183693
--brand-900: #10246B
```
渐变（Logo / 关键 CTA）：`linear-gradient(135deg, #366CFF, #5B86FF)`。

### 2.2 语义色（沿用 TDesign 语义，主色统一为 brand）
```
--success: #16A34A
--warning: #D97706
--danger:  #DC2626
--info:    #366CFF   /* 信息色复用主色 */
```

### 2.3 中性色（暗色主题，替换原暖色 #1b1a18）
```
--bg-base:     #0F1115   /* 应用底背景，替代 #1b1a18 */
--bg-surface:  #161A22   /* 卡片/面板 */
--bg-elevated: #1C212B   /* 浮层/弹窗 */
--border:      #232A36
--border-strong:#2E3744
--text-primary:   #E6E9EF
--text-secondary: #9AA4B2
--text-tertiary:  #6B7480
```

### 2.4 中性色（浅色主题，供 D12 浅色主题与文档站）
```
--bg-base:     #FFFFFF
--bg-surface:  #F5F7FA
--bg-elevated: #FFFFFF
--border:      #E3E8EF
--border-strong:#D0D7E2
--text-primary:   #0F1115
--text-secondary: #4A5568
--text-tertiary:  #8A94A6
```

## 3. 字体

- 西文：`Inter`, `'Segoe UI'`, `system-ui`, `sans-serif`
- 中文：`'PingFang SC'`, `'Microsoft YaHei'`, `'Noto Sans SC'`, `sans-serif`
- 字重：Regular 400 / Medium 500 / Semibold 600 / Bold 700
- 字号阶梯（桌面 UI）：
  - Display 28/36 · H1 22/30 · H2 18/26 · H3 16/24 · Body 14/22 · Caption 12/18

## 4. 间距 / 圆角 / 阴影

- 间距基准 `4px`：xs2 / sm4 / md8 / lg12 / xl16 / 2xl24 / 3xl32
- 圆角：`--radius-sm:8` / `--radius-md:12` / `--radius-lg:16` / `--radius-pill:999`
- 阴影（暗色下克制）：
  - `--shadow-1: 0 1px 2px rgba(0,0,0,.40)`
  - `--shadow-2: 0 4px 12px rgba(0,0,0,.45)`
  - `--shadow-3: 0 8px 24px rgba(0,0,0,.50)`

## 5. Logo 使用规范

| 文件 | 用途 |
|------|------|
| `assets/sacode-mark.svg` | 图标/应用图标/启动图（方角圆底，主色 + 白色 S 字标） |
| `assets/sacode-logo.svg` | 浅色背景：文档页眉、About、安装包（深字） |
| `assets/sacode-logo-dark.svg` | 暗色背景：桌面端顶栏、启动闪屏（亮字） |

规则：
- 标志安全留白 ≥ 图标高度的 1/2。
- 主色仅用 `#366CFF` 及其梯度，禁止陶土 `#d97757` 与旧蓝 `#2f81f7`。
- 字标禁止拉伸/改字距动画；最终交付建议将 `<text>` 转曲为路径（当前母版为可编辑占位）。

## 6. 商标预检结论（D4）

检索（2026-10-01）：
- `@cherishron/sacode`（npm）—— **本项目自有发布包**，已注册。
- `sacode.dev` —— 波斯尼亚软件公司「SaCode」（Scala/Java 外包），同名但不同法域/业务，存在潜在商标冲突点。
- `SuaCode.ai` / `sayacode`（PyPI）—— 异名，无直接冲突。

结论：「SaCode」作软件产品名**当前可用**，但与 `sacode.dev` 并存，建议正式 Ga 前委托商标代理做中/美/欧盟分类 9/42  clearance，并优先以 `@cherishron` 作用户空间区分。
