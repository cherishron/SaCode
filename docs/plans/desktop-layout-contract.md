# Desktop 布局契约（SaCode）

> 本文件与 `interfaces/desktop/src/ui/styles/layout-contract.css` 同步。
> **改格子 = 改本文件 + layout-contract.css，禁止在组件 CSS 里发明第二套常量。**
> 对齐权威：MonkeyCode `desktop/ui-next/LAYOUT.md`（只抄度量与信息安放，不抄视觉资产）。
> 技术栈：Vue 3 + TypeScript + Vite + TDesign + Tauri 2。
> 日期：2026-09-29

## 0.5 设计系统覆盖声明（ui-design-guide）

本产品使用**既有设计系统**，覆盖 ui-design-guide 默认禁项（按其 brand override 规则）：

| 维度 | 采用 | 覆盖原因 |
| --- | --- | --- |
| 色板 | SaCode 暖中性（`tokens.css`：`#d97757` accent / 暖石墨深色） | 产品品牌与 MonkeyCode 结构对齐，不走「通用 AI 紫渐变」 |
| 字体 | `--font-sans`（Inter + 中文栈）/ JetBrains Mono | 与 TDesign、桌面产品一致；非营销页 |
| 布局 | 工作台网格（任务列 + 分格），非营销不对称排版 | 桌面 IDE 壳以信息密度与契约为准 |
| 图标 | `tdesign-icons-vue-next`（非 emoji） | 与组件库一致 |

美学方向：**Industrial / utilitarian 工作台**（信息密度优先，克制装饰）。

---

## 1. 壳拓扑

```
┌─ 任务列 --w-side ─┬─1px─┬─ 分格 grid ──────────────────┐
│ 品牌行 h-40       │     │ PaneFrame 细头 h-48          │
│ tabs 本地|云端    │     │  body（chat / 装载卡 / 面板）│
│ 项目组 + 列表     │     │                              │
│ ⚙ 设置 沉底 h-40 │     │                              │
└───────────────────┴─────┴──────────────────────────────┘
```

- **无** status-bar、**无** 第三固定列（文件/终端 = 细头动作 + 抽屉）。
- 任务列右缘 8px 透明把手可拖宽，钳制 `--w-side-min`–`--w-side-max`。
- 分格：白底通栏、1px 分隔、焦点 = 标题 `primary` 下划线（不染整头）。

## 2. 度量表

| 令牌 | 值 | 用途 |
| --- | --- | --- |
| `--chrome-h` | 28px | 窗框条（平台相关） |
| `--chrome-row` | 40px | 任务列顶行 / 设置页头 |
| `--pane-head-h` | 48px | 分格细头 |
| `--w-side` | 232px（184–420） | 任务列宽 |
| `--chat-measure` | `min(64rem, max(48rem, 92%))` | 消息流 + composer **共用** |
| `--chat-measure-pane` | `min(64rem, 92%)` | 分格内（无 48rem 地板） |
| `--list-font` / `--list-gap` | 12px / 4px | 列表密度 |
| `--list-indent` | 20px | 每级缩进 |
| `--divider` | 1px | 结构线 |
| `--handle-hit` | 8px | 拖拽把手命中区 |

## 3. 信息安放

| 信息 | 法定位置 | 禁止 |
| --- | --- | --- |
| 视图标题 | 分格细头左侧 | 头部以外再写一份 |
| 视图动作 | 分格细头右侧簇 | 格内再出一套钮 |
| 运行态 | composer 上方状态行 | 细头 |
| 模型/模式 | composer 底部集群左 | 细头 |
| 上下文用量 | composer 底部集群右 | 底栏 |
| 任务状态 | 任务列行尾状态点 | 细头文字 |
| 未读/待处理 | 行首 2px warning 竖条 | 整行填充 |
| 选中 | 仅 `list-row.selected` 淡填充 | 与 attention 抢填充通道 |

## 4. 滚动

- 列/视图级：`overflow-y: auto` + `overflow-x: hidden` + `scrollbar-gutter: stable`（类 `.scroll-y`）。
- 横向滚动只允许：代码块、diff、表格包裹层。

## 5. 组件映射（TDesign）

| 契约角色 | 实现 |
| --- | --- |
| 列表行 | `.list-row` + `t-list` 槽（或自研） |
| 分组头 | `.group-label` |
| Tabs | `t-radio-group` / `t-tabs` pill |
| Chrome 钮 | `.ghost-btn` / `t-button` variant=text |
| 输入 | `t-textarea` / `t-select` / `t-button` |
| 图标 | `tdesign-icons-vue-next`，12 / 13 / 20 |
| **文件面板** | **格内** `.files-scrim` + `.files-side-panel`（absolute 贴右、可拖宽），**禁止**整页 `t-drawer` 作文件区 |
| **终端 / 预览** | 同文件：格内 scrim + 侧板（`TerminalDrawer` / `PreviewDrawer`） |
| 分格操作 | 细头 ⋯ 菜单：向右/向下拆分、独占、更换、重命名；关闭仅多格时渲染 |

> 形态铁律：与 MonkeyCode LAYOUT 不一致的交互形态（整页抽屉、第三列、底栏信息位）不得合入。拿不准先对 LAYOUT.md 再写组件。

## 6. 验收口令

1. 拓扑：左任务列 + 平铺分格；无底栏、无第三固定列。
2. 度量：40/48、列表 12/4、缩进 20、measure 一条。
3. 中线：消息与 composer 同 `--chat-measure`。
4. 列表：选中=填充；未读=竖条；状态=行尾点。
5. 信息安放无违例。
6. 新 UI 必须写进本契约格子。
