# 桌面端会话边缘历史导航方案（边缘刻度导航 + 回到最新）

> 文档状态：方案草案，待评审
> 日期：2026-09-27
> 关联：`interfaces/desktop/src/app/conversation.ts`、`interfaces/desktop/src/app/ui.ts`、`interfaces/desktop/src/app/conversation.css`、`interfaces/desktop/src/app/service.ts`
> 说明：纯 Desktop 前端（web 层）改动，不涉及 daemon / client-core / Tauri Rust 侧。本文件为独立方案文档，不是当前活动 plan。

## 1. 背景与需求

长会话中用户向上翻阅历史后，缺少快速定位手段：既无法直观看到"自己在哪一轮"，也无法一键返回最新消息。参照主流对话产品（ChatGPT / Claude）的边缘导航形态，需求为：

1. **会话区边缘历史导航条**：以刻度表示历史对话，点击刻度平滑滚动跳转到对应轮次；
2. **「回到最新」按钮**：离开底部后浮现，点击即滚回最新消息。

### 1.1 已确认的交互决策

| 决策点 | 结论 |
|---|---|
| 导航条位置 | 会话区**右侧边缘**（与滚动条同侧） |
| 刻度粒度 | **每轮对话一个刻度**（以 user 消息为锚点） |
| 回到最新按钮形态 | 胶囊带文字：**「↓ 回到最新」** |
| 贴底自动跟滚 | **是**（顺带修复现状缺陷，见 2.2） |

## 2. 现状分析（关键事实）

### 2.1 渲染机制：全量重建

`ui.ts` 的 `render()` 以 `root.replaceChildren(...)` 整体重建 DOM，任何状态变化（新消息、SSE 推送、轮询）都会触发。含义：

- 导航组件必须**随每次 render 重建**（与消息流同生命周期，无额外复杂度）；
- 刻度点击、按钮显隐、刻度高亮**只做局部 DOM 操作**（classList toggle / scrollTo），绝不触发 rerender，否则滚动位置会被重建打断。

### 2.2 滚动位置保持：仅覆盖第一个分屏，且不跟滚

`ui.ts` 现状（第 412 / 880 行）：

```ts
const scrollTimeline = root.querySelector('#timeline')?.scrollTop ?? 0;  // 只取第一个
...
const timeline = root.querySelector('#timeline');
if (timeline) timeline.scrollTop = scrollTimeline;                       // 只恢复第一个
```

两个缺陷：

1. **分屏滚动丢失**：工作台默认双分屏（最多 3 pane，`ui.ts` `panes: [createPaneState(...), createPaneState(...)]`），第 2/3 屏每次 rerender 后回到顶部；
2. **贴底不跟滚**：用户在底部阅读时，新消息到来只会恢复旧 `scrollTop`，视图被"钉"在旧位置——这也是「回到最新」按钮会频繁误出现的前提性缺陷，必须一并修复。

### 2.3 消息节点无定位标识

`buildMessage()`（`message-bubble.ts`）生成的节点无 id / index，无法作为跳转目标。需在 `conversation.ts` 装配层为每个消息节点补 `data-msg-index`（不改 `message-bubble.ts` 内部）。

### 2.4 数据层

`service.ts` 的 `TimelineItem { kind, text, detail?, taskId? }`：

- timeline 全局上限 400 条（`service.ts:105`），会话内按 `taskId` 过滤后渲染；
- 轮次锚点（user 消息）数量远小于总消息数，通常可控；极端情况需抽样。

### 2.5 布局与样式约束

- `.timeline`（`conversation.css:73`）为 `flex:1; overflow-y:auto`，内容列 `max-width: var(--content-max-width)`（760px）水平居中；
- 绝对定位的导航条 / 按钮需要一个**新的定位上下文**包裹层（`.timeline-region`）；
- `styles/tokens.css` 强制约定：组件 CSS 禁止散落 hex/rgba，全部走 design tokens。

### 2.6 存量问题（不扩散、不修复）

`.timeline` 同时使用 `id="timeline"` 与 class，多分屏下 id 重复。本方案滚动保存/恢复改用 **class + `data-pane`** 定位，保留 id 不动，避免影响存量引用。

### 2.7 测试设施

`package.json`：`"test": "node --import tsx --test test/**/*.test.ts"`（node:test + tsx），现有测试均只测纯函数（无 DOM 依赖），导航的锚点提取逻辑按同样模式组织。

## 3. 交互设计

### 3.1 边缘导航条（Timeline Rail）

- **位置**：会话区右缘细窄垂直刻度列（`position: absolute; right: 6px`），上下留边，不占布局流；
- **刻度**：每轮对话一个刻度（user 消息锚点），6px 圆点，纵向均匀分布；
- **hover**：刻度显示 tooltip（原生 `title` 或现有 `tooltip.ts` 组件）——消息文本摘要（去换行、截断 48 字符）；整列 hover 时透明度增强，默认 ~0.35 不干扰阅读；
- **点击**：平滑滚动（`behavior: 'smooth'`）到该轮首条消息，顶部预留 12px 呼吸间距；
- **高亮**：视口中线所在轮次的刻度为 `active` 态（accent 色 + 放大），随滚动实时同步；
- **显隐条件**：无锚点（空会话 / 无 user 消息）时不挂载。

### 3.2 「回到最新」按钮

- **位置**：`.timeline-region` 右下角、输入坞上方悬浮胶囊按钮；
- **显隐**：`scrollHeight - scrollTop - clientHeight > 96px` 时加 `visible` class（opacity/visibility 过渡），贴底自动隐藏；
- **点击**：平滑滚动到底部。

### 3.3 贴底自动跟滚（顺带修复）

- 距底 < 24px 视为**贴底**；
- render 恢复滚动时：贴底 → `scrollTop = scrollHeight`（新消息自动跟随到底）；未贴底 → 恢复原 `scrollTop`（用户翻历史不被打扰）。

## 4. 技术方案

### 4.1 新组件 `src/components/timeline-rail.ts`

> 注：本组件的参考实现草稿已存在于该路径（方案评审阶段的前期产物，未接线），实施时可直接采用或删除重写；`conversation.ts` 当前为原始版本，无残留依赖。

**纯函数（可单测，无 DOM 依赖）：**

```ts
export interface TimelineAnchor { msgIndex: number; label: string }

export function collectTimelineAnchors(items: TimelineItem[]): TimelineAnchor[]
```

- 锚点提取三级退化：**user 消息** →（无 user 时）**assistant 消息** →（再无）**全部消息**；
- `label`：`text` 压平空白后截断 48 字符，空文本记为 `(空消息)`；
- 抽样：锚点数 > 80 时均匀抽样至 80 个（保首保尾），防刻度过密不可点；
- 常量上限导出：`ANCHOR_LABEL_MAX=48`、`MAX_ANCHORS=80`、`JUMP_VISIBLE_THRESHOLD=96`、`AT_BOTTOM_THRESHOLD=24`。

**DOM 组装（每次 render 随 conversation 重建）：**

```ts
export function buildTimelineNavigation(
  timelineEl: HTMLElement,          // 滚动容器（.timeline）
  anchors: TimelineAnchor[],
): { rail: HTMLElement; jumpButton: HTMLElement; refresh: () => void }
```

行为要点：

- 在 `timelineEl` 上绑定 `scroll` 监听 + **rAF 节流**，合并高频重算；
- `refresh()`：① 按钮显隐（阈值判断）② 刻度高亮（视口中线与各锚点 `offsetTop` 比较，线性扫描一次）；
- 点击刻度：`timelineEl.querySelector('[data-msg-index="N"]')` → `scrollTo({ top: target.offsetTop - 12, behavior: 'smooth' })`；
- 点击按钮：`scrollTo({ top: scrollHeight, behavior: 'smooth' })`；
- 构建完成立即执行一次 `refresh()`（兼容 render 恢复 `scrollTop` 后的初始视觉状态；程序设置 `scrollTop` 亦会触发 scroll 事件，双保险）；
- **全程不触发 rerender**。

### 4.2 `conversation.ts` 改造

- `buildConversation(...)` 末尾追加参数 `paneIndex = 0`（由 `ui.ts` 的 `buildAgentPane` 传入）；
- 消息装配层打标：

```ts
const messageNodes = filtered.map((item, index) => {
  const node = buildMessage(item) as HTMLElement;
  node.dataset.msgIndex = String(index);
  return node;
});
```

- 结构调整（`.timeline` 原有样式不变，仅补 `position: relative` 保证 `offsetTop` 基准正确）：

```
.timeline-region            ← 新增：position:relative; flex:1; min-height:0（定位上下文）
├── .timeline[data-pane=N]  ← 原滚动列（含 data-msg-index 消息节点）
├── .timeline-rail          ← 右缘刻度列（absolute）
└── .timeline-jump-latest   ← 回到最新按钮（absolute 右下）
```

- 空会话 / `collectTimelineAnchors` 返回空数组时不挂载导航。

### 4.3 `conversation.css` 新增样式

| 选择器 | 要点 |
|---|---|
| `.timeline-region` | `position:relative; flex:1; min-height:0; display:flex;`，不改变滚动列居中布局 |
| `.timeline` | 追加 `position:relative` |
| `.timeline-rail` | absolute 右缘 6px、上下 `--space-6`；`flex-direction:column; justify-content:space-between`；默认 `opacity:.35`，`:hover` 到 1（`--dur-fast` 过渡） |
| `.timeline-rail-tick` | 6px 圆点按钮、`--bg-overlay` 底色、`--radius-full`；`active` 态 `--accent` + 放大 1.6x；hover `--accent-hover` |
| `.timeline-jump-latest` | absolute 右下；胶囊（`--bg-raised` + `--border-weak` + `--shadow-sm` + `--radius-full`）；默认 `opacity:0; visibility:hidden`，`.visible` 显现（`--dur-normal`） |
| 响应式 | `<900px` 导航条收窄（4px 刻度、右移贴边），避免遮挡内容 |

### 4.4 `ui.ts` 滚动机制改造

替换现有"只处理第一个 `#timeline`"的逻辑（412 / 880 行）：

```ts
// 保存（render 前）：遍历所有 .timeline，按 data-pane 记录
const scrollStates = new Map<string, { top: number; atBottom: boolean }>();
root.querySelectorAll<HTMLElement>('.timeline').forEach((el) => {
  const pane = el.dataset.pane ?? '0';
  const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
  scrollStates.set(pane, { top: el.scrollTop, atBottom: distance < 24 });
});

// 恢复（replaceChildren 后）：
root.querySelectorAll<HTMLElement>('.timeline').forEach((el) => {
  const state = scrollStates.get(el.dataset.pane ?? '0');
  if (!state) return;
  el.scrollTop = state.atBottom ? el.scrollHeight : state.top;  // 贴底跟滚
});
```

同时 `buildAgentPane` 中 `buildConversation(...)` 调用传入 `index` 作为 `paneIndex`。

## 5. 实施步骤

| 阶段 | 文件 | 动作 | 内容 |
|---|---|---|---|
| 1 | `src/components/timeline-rail.ts` | 新增（草稿已在，评审后采用/重写） | 锚点纯函数 + 导航组件 |
| 2 | `src/app/conversation.ts` | 修改 | `.timeline-region` 包裹、消息打标、接入导航、`paneIndex` 参数 |
| 3 | `src/app/conversation.css` | 修改 | rail / 按钮 / region 样式（全 tokens，零散落色值） |
| 4 | `src/app/ui.ts` | 修改 | 全 pane 滚动保存恢复 + 贴底跟滚；传 `paneIndex` |
| 5 | `test/timeline-rail.test.ts` | 新增 | 纯函数单测 |

阶段 2–4 为一个原子提交单元（互相依赖，拆开无法通过 typecheck）；阶段 5 可独立追加。

## 6. 测试与验收

### 6.1 单测（`node:test` 模式，对齐现有测试风格）

- user 消息按序生成锚点（`msgIndex` 指向正确索引）；
- 无 user 时退化为 assistant 锚点；无 assistant 时退化为全部消息；
- label 截断：> 48 字符带 `…`，空白压平，空文本 `(空消息)`；
- 抽样：> 80 个锚点时输出恰 80 个且首尾保留；
- 空输入返回空数组。

### 6.2 验证命令（`interfaces/desktop/` 下）

```
npm run typecheck
npm test
npm run dev     # 手动验证
```

### 6.3 手动验收清单

1. 长会话（多轮）：右缘出现刻度列，轮次数与提问数一致；
2. hover 刻度显示摘要；点击后平滑滚到对应轮次且顶部留有间距；
3. 向上翻阅后输入坞上方浮现「↓ 回到最新」，点击滚回底部；贴底时按钮隐藏；
4. 滚动时视口所在轮次刻度高亮实时移动；
5. 贴底时来新消息自动跟滚到底；翻历史时来新消息**不打扰**当前位置；
6. 双分屏：两屏各自滚动位置独立保持，各自导航独立工作；
7. 切换会话（taskId 过滤）后导航锚点随之更新；
8. 空会话无导航条；窄屏（<900px）导航不遮挡内容。

## 7. 风险与对策

| 风险 | 对策 |
|---|---|
| 消息高频推送时全量重建打断 smooth 滚动动画 | 可接受（动画瞬时到位）；实测抖动明显则降级 `behavior:'auto'` |
| 400 条消息 + 80 锚点的 `offsetTop` 线性查询 | refresh 仅在 scroll rAF 内执行，量级可忽略；如仍卡顿可缓存锚点 offset（每 render 重建时失效） |
| 多分屏 `#timeline` id 重复（存量） | 本方案改用 class + `data-pane` 定位，不扩散、不顺手重构 |
| 锚点过密不可点 | > 80 均匀抽样（保首保尾） |
| 全量重建下 scroll 监听器泄漏 | 监听器绑定在 `.timeline` 节点自身，节点随 replaceChildren 移除即被 GC，无全局注册 |

## 8. 改动文件清单

| 文件 | 动作 |
|---|---|
| `interfaces/desktop/src/components/timeline-rail.ts` | 新增（草稿已存在，未接线） |
| `interfaces/desktop/src/app/conversation.ts` | 修改 |
| `interfaces/desktop/src/app/conversation.css` | 修改 |
| `interfaces/desktop/src/app/ui.ts` | 修改 |
| `interfaces/desktop/test/timeline-rail.test.ts` | 新增 |
