# SaCode Desktop UI Design v1

> 文档状态：待评审
> 版本：v1.0
> 日期：2026-09-22
> 参考：MiMo-Code Desktop（`github.com/XiaomiMiMo/MiMo-Code`）
> 配套 PRD：[Desktop 与多 Agent 客户端 PRD](../product/desktop-multi-agent-prd.md)

## 1. 设计决策摘要

| 维度 | 决策 |
|---|---|
| 布局 | 四段式：Rail(64px) + 侧栏(240px,可折叠) + 会话流 + 右栏上下文面板(360px,可折叠) |
| 视觉 | 克制的深色开发者工具，中性灰阶 + 单一蓝色强调色 |
| 主题 | 仅深色（v1），令牌驱动，预留浅色扩展点 |
| 技术栈 | 保留 Vite + TypeScript，重写 UI 层，不引入 React/Solid |
| 组件 | 语义化 CSS 变量 + Web Components 风格 TS，CSS 与 TS 分离 |

## 2. 信息架构

### 2.1 整体布局

```
┌──────────────────────────────────────────────────────────┐
│ TopBar: 项目名 · 分支 · Agent · 模式 · 运行状态 · 设置      │
├────┬────────────┬────────────────────────┬─────────────────┤
│    │            │                        │                 │
│ R  │  Sidebar   │   Conversation          │   Context       │
│ a  │  项目/会话   │   消息流+工具卡+审批     │   Changes       │
│ i  │  列表       │                        │   Approvals     │
│ l  │            │                        │   Activity       │
│    │  文件树     │                        │   Diff           │
│ 64 │  (折叠)    │                        │   (折叠)         │
│ px │            │                        │   360px          │
│    │  240px     │       flex-1           │                 │
│    │            │                        │                 │
├────┴────────────┴────────────────────────┴─────────────────┤
│ StatusBar: Daemon · 模型 · Token · Git · 耗时               │
└──────────────────────────────────────────────────────────┘
```

### 2.2 各区域职责

#### Rail（64px 固定）

- 项目头像/图标
- 当前项目高亮
- 新建项目（+）
- Agent 切换（SaCode / OpenCode）
- 设置（齿轮）
- 帮助（?）

不放文字标签，纯图标，Tooltip 显示名称。

参考：MiMo `sidebar-shell.tsx:53` 的 `data-component="sidebar-rail"`。

#### Sidebar（240px，可折叠至 0）

默认展开，内容随上下文切换：

**项目模式（无会话时）**：
- 项目名称 + 路径
- Git 分支
- 最近会话列表（时间倒序）
- 新建任务按钮

**会话模式（有活跃会话时）**：
- 当前会话标题
- 会话历史列表
- 文件树（只读浏览，非编辑器）
- 底部：新建任务

折叠动画 200ms ease-out，折叠后 Rail 仍可见。

#### 会话流（flex-1，主区域）

这是用户注意力核心，纵向滚动，内容自底向上增长：

**顶部进度条**：
- 2px 高度，`clip-path` whip 动画
- 任务运行时蓝色，等待审批时琥珀色，结束时淡出
- 参考：MiMo `index.css:27` 的 `session-progress`

**消息流**：
1. 用户消息（右对齐气泡，浅灰背景）
2. AI 正文（左对齐，无气泡，直接 Markdown 渲染）
3. 思考过程（可折叠，缩进，弱化文本色）
4. 工具调用卡（独立块，详见 2.3）
5. 审批卡（独立块，详见 2.3）
6. 终态标识（完成/失败/取消，全宽分隔线）

**底部输入区**：
- 多行文本框
- 模式切换（Plan / Build / Auto）
- 运行按钮（Enter 或 Cmd/Ctrl+Enter）
- 停止按钮（运行中显示，红色）
- 字符计数（接近限制时提示）

#### 右栏 Context（360px，可折叠）

Tab 切换，不并排展示：

| Tab | 内容 |
|---|---|
| Changes | 文件变更列表，点击展开 Diff |
| Approvals | 待审批工具调用，批准/拒绝按钮 |
| Activity | 系统事件日志（daemon 启动/断连/重连/错误） |

默认激活 Changes Tab。

#### TopBar（40px）

```
[项目名] · [分支] │ [Agent ▾] [Mode ▾] │ [● Running] [⚙]
```

#### StatusBar（28px）

```
[Daemon: 127.0.0.1:6274 ●] [Model: glm-4.6] [Token: 12k/128k] [Git: dev●] [⏱ 42s]
```

### 2.3 关键卡片设计

#### 工具调用卡

```
┌─────────────────────────────────────────┐
│ 🔧 shell.exec                    ⏱ 1.2s │
│ ┌─────────────────────────────────────┐ │
│ │ command: cargo test --lib           │ │
│ └─────────────────────────────────────┘ │
│ ✓ completed · exit 0                     │
│ [展开输出 ▾]                              │
└─────────────────────────────────────────┘
```

状态色：
- 运行中：蓝色左边框
- 待审批：琥珀色左边框 + 脉冲动画
- 已批准：绿色左边框
- 已拒绝：红色左边框
- 已完成：无强调色

#### 审批卡

```
┌─────────────────────────────────────────┐
│ ⚠ 审批请求                                │
│                                          │
│ 工具: file.write                         │
│ 风险: 中（写入文件）                       │
│                                          │
│ 目标: src/auth/session.rs                │
│ 变更: +42 -7                             │
│                                          │
│ [查看 Diff] [批准] [拒绝]                 │
└─────────────────────────────────────────┘
```

批准/拒绝后卡片内联变为终态，不消失。

## 3. 设计令牌

### 3.1 色彩

```css
:root {
  /* 背景层级 */
  --bg-base:       #0d1117;  /* 最底层 */
  --bg-surface:    #161b22;  /* 卡片/面板 */
  --bg-raised:     #1c2128;  /* 悬浮/活跃 */
  --bg-overlay:    #21262d;  /* 弹层 */

  /* 文字层级 */
  --text-strong:   #e6edf3;  /* 标题/重要 */
  --text-base:     #7d8590;  /* 正文 */
  --text-weak:     #484f58;  /* 次要/占位 */
  --text-on-accent:#ffffff;  /* 强调色上的文字 */

  /* 强调色 */
  --accent:        #2f81f7;  /* 主蓝 */
  --accent-hover:  #388bfd;
  --accent-weak:   rgba(47, 129, 247, 0.12);

  /* 语义色 */
  --success:       #3fb950;
  --warning:       #d29922;
  --danger:        #f85149;
  --info:          #2f81f7;

  /* 边框 */
  --border-base:   #30363d;
  --border-weak:   #21262d;
  --border-accent: rgba(47, 129, 247, 0.4);
}
```

### 3.2 间距与圆角

```css
:root {
  --space-1:  4px;
  --space-2:  8px;
  --space-3:  12px;
  --space-4:  16px;
  --space-5:  24px;
  --space-6:  32px;

  --radius-sm: 4px;
  --radius-md: 6px;
  --radius-lg: 8px;
  --radius-full: 999px;
}
```

### 3.3 字体

```css
:root {
  --font-sans: -apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans SC", sans-serif;
  --font-mono: "JetBrains Mono", "Cascadia Code", "Consolas", monospace;

  --text-12-regular: 12px/1.4 var(--font-sans);
  --text-13-regular: 13px/1.5 var(--font-sans);
  --text-14-regular: 14px/1.5 var(--font-sans);
  --text-14-medium:  14px/1.5 var(--font-sans);
  --text-16-medium:  16px/1.4 var(--font-sans);
  --text-mono-sm:   12px/1.6 var(--font-mono);
  --text-mono-md:   13px/1.6 var(--font-mono);
}
```

### 3.4 动画

```css
:root {
  --ease-out:    cubic-bezier(0.2, 0.8, 0.2, 1);
  --ease-in-out: cubic-bezier(0.65, 0, 0.35, 1);
  --dur-fast:    120ms;
  --dur-normal:  200ms;
  --dur-slow:    320ms;
}
```

## 4. 启动门控

参考 MiMo `ConnectionGate`（`app.tsx:157`），SaCode 也需要：

### 4.1 启动流程

```
App 启动
  │
  ▼
[Splash] 品牌动画 + sidecar 健康检查
  │
  ├─ 健康 → [Main Interface]
  │
  └─ 不健康 → [Connection Error]
                  │
                  ├─ 显示 Daemon 地址和 PID
                  ├─ 自动重试（每 1s）
                  └─ [重试] [打开诊断]
```

### 4.2 Splash

- 居中品牌 Logo，`opacity:0.5; animate-pulse`
- 全屏 `--bg-base` 背景
- 2s 内完成 sidecar 健康检查

### 4.3 Connection Error

- 居中错误信息
- 显示当前尝试连接的 Daemon 地址
- "正在重试……" 副文本
- 手动重试按钮
- 打开诊断按钮（跳转 `sacode doctor`）

## 5. 组件清单

### 5.1 布局组件

| 组件 | 文件 | 职责 |
|---|---|---|
| `AppShell` | `app-shell.ts` | 顶栏+主区+状态栏的网格容器 |
| `Rail` | `rail.ts` | 64px 图标轨 |
| `Sidebar` | `sidebar.ts` | 240px 可折叠侧栏 |
| `Conversation` | `conversation.ts` | 会话流主区 |
| `ContextPanel` | `context-panel.ts` | 360px 可折叠右栏 |
| `TopBar` | `top-bar.ts` | 顶部信息条 |
| `StatusBar` | `status-bar.ts` | 底部状态条 |

### 5.2 内容组件

| 组件 | 文件 | 职责 |
|---|---|---|
| `MessageBubble` | `message-bubble.ts` | 用户/AI 消息气泡 |
| `ThinkingBlock` | `thinking-block.ts` | 可折叠思考过程 |
| `ToolCard` | `tool-card.ts` | 工具调用卡片 |
| `ApprovalCard` | `approval-card.ts` | 审批请求卡片 |
| `DiffView` | `diff-view.ts` | 简易 Diff 展示 |
| `FileTree` | `file-tree.ts` | 只读文件浏览 |
| `SessionList` | `session-list.ts` | 会话历史列表 |
| `ProgressBar` | `progress-bar.ts` | 顶部 2px 进度条 |
| `InputArea` | `input-area.ts` | 底部输入框+按钮 |
| `Splash` | `splash.ts` | 启动动画 |
| `ConnectionError` | `connection-error.ts` | 连接错误页 |
| `Badge` | `badge.ts` | 状态标签 |
| `IconButton` | `icon-button.ts` | 图标按钮 |
| `Tooltip` | `tooltip.ts` | 悬浮提示 |
| `TabBar` | `tab-bar.ts` | 右栏 Tab 切换 |

### 5.3 文件组织

```
interfaces/desktop/src/
├── main.ts              # 入口，初始化 AppShell
├── app/
│   ├── app-shell.ts     # 布局网格
│   ├── top-bar.ts
│   ├── status-bar.ts
│   ├── rail.ts
│   ├── sidebar.ts
│   ├── conversation.ts
│   ├── context-panel.ts
│   └── splash.ts
├── components/
│   ├── message-bubble.ts
│   ├── thinking-block.ts
│   ├── tool-card.ts
│   ├── approval-card.ts
│   ├── diff-view.ts
│   ├── file-tree.ts
│   ├── session-list.ts
│   ├── progress-bar.ts
│   ├── input-area.ts
│   ├── badge.ts
│   ├── icon-button.ts
│   ├── tooltip.ts
│   └── tab-bar.ts
├── styles/
│   ├── tokens.css       # 设计令牌定义
│   ├── base.css         # reset + 基础元素
│   └── animations.css   # 关键帧动画
├── service.ts           # 现有 daemon 通信层（保留）
└── ipc-transport.ts     # 现有 IPC 传输（保留）
```

每个组件一对文件：`xxx.ts` + `xxx.css`，CSS 用令牌变量，不硬编码颜色。

## 6. 状态映射

### 6.1 任务状态 → UI

| 任务状态 | 会话流 | 右栏 | 进度条 |
|---|---|---|---|
| queued | 灰色"排队中"标签 | Changes 空状态 | 静默 |
| running | AI 正文+工具卡实时增长 | Changes 实时更新 | 蓝色 whip |
| waiting_approval | 审批卡琥珀色脉冲 | Approvals Tab 高亮+计数 | 琥珀色静态 |
| completed | 绿色分隔线+结果摘要 | Changes 显示最终 Diff | 淡出 |
| failed | 红色分隔线+错误摘要 | Activity 显示错误 | 淡出 |
| cancelled | 灰色分隔线+"已取消" | 无变化 | 淡出 |

### 6.2 连接状态 → UI

| 连接状态 | TopBar | StatusBar |
|---|---|---|
| healthy | 无额外标记 | 绿色 ● |
| disconnected | 黄色"重连中" | 黄色 ● |
| reconnected | 无额外标记 | 绿色 ● |
| failed | 红色"连接断开" | 红色 ● |

## 7. 响应式策略

v1 不做完整移动端适配，但处理窗口缩窄：

| 窗口宽度 | 行为 |
|---|---|
| ≥ 1200px | 四段全展开 |
| 900-1199px | 右栏默认折叠，点击展开为浮层 |
| 700-899px | 侧栏默认折叠，右栏折叠 |
| < 700px | 仅会话流，侧栏和右栏均为浮层抽屉 |

用 CSS `container query` 实现，不依赖 JS 断点。

## 8. 与现有代码的关系

### 保留

- `service.ts`：daemon HTTP/SSE 通信层，继续使用
- `ipc-transport.ts`：Tauri IPC 传输，继续使用
- `sidecar.ts`：sidecar 进程管理，继续使用
- `tauri-bridge.ts`：Tauri 桥接，继续使用
- `vite.config.ts`：Vite 构建，继续使用
- `package.json`：依赖不变，不引入新框架

### 重写

- `ui.ts`（249 行）→ 拆分为 `app/` 下 7 个布局组件
- `styles.css`（181 行）→ 拆分为 `styles/tokens.css` + `styles/base.css` + `styles/animations.css` + 各组件 CSS
- `main.ts`（339 行）→ 精简为初始化逻辑，UI 逻辑移入组件

### 新增

- `styles/tokens.css`：设计令牌
- `components/`：14 个内容组件
- `app/splash.ts` + `app/connection-error.ts`：启动门控

## 9. 实施分期

### Phase 1：骨架重构（已完成 ✅）

- 创建令牌文件（tokens.css / base.css / animations.css）
- 拆分 `ui.ts` 为布局组件（app-shell / top-bar / rail / sidebar / conversation / context-panel / status-bar / splash）
- 实现 Rail + Sidebar + Conversation + ContextPanel 四段网格
- 实现 Splash + ConnectionError 启动门控
- 接入现有 service.ts，确保 sidecar 启动后显示主界面
- 删除旧 `styles.css`，`main.ts` 引入新样式链

**验收结果**：tsc + vite build 通过（CSS 15.6KB, JS 33KB）；四段布局启动门控已实现。

### Phase 2：会话流核心（已完成 ✅）

- 实现 MessageBubble（按 kind 分发：user 气泡 / AI 正文 / 工具 / 错误 / 系统 / 审批 / 变更）
- 实现 ThinkingBlock（可折叠思考过程）
- 实现 ToolCard（6 状态：running/pending/approved/denied/completed/failed，参数区 + 可折叠输出 + 耗时）
- 实现 ProgressBar（4 状态：idle/running/approval/done）
- 实现 InputArea（模式切换 plan/build/auto + Backend 选择 + 运行/停止，Enter 快捷键）
- 实现 Badge + IconButton + Tooltip + SessionList + DiffView 基础组件（components/ 目录）
- 修复 sidebar 与 InputArea 的 mode/backend select ID 冲突（保留在 InputArea）
- 修复 `app.mode` 类型误用（RuntimeMode 是 tauri/vite，非执行模式）

**验收结果**：tsc + vite build 通过（CSS 21.6KB, JS 34.9KB）；会话流拆为独立组件。

### Phase 3：审批与变更（已完成 ✅）

- 实现 ApprovalCard（风险级别徽章、参数摘要、批准/拒绝）
- 实现 DiffView（行级 Diff 表格 + unified diff 解析器 parseDiff）
- 右栏三 Tab 完整接入：Changes 用 DiffView（+N/-M 统计 + 可折叠）、Approvals 复用 ApprovalCard、Activity 分级日志
- 会话流移除内联审批区，审批统一由右栏 Approvals Tab 承载
- 侧栏接入 SessionList（从 timeline 按 taskId 分组提取，状态圆点 + 当前会话高亮）

**验收结果**：tsc + vite build 通过（CSS 23KB, JS 37.5KB）。

### Phase 4：联动与收口（已完成 ✅）

- 会话过滤：点击 SessionList 按 taskId 过滤会话流，再次点击/Esc/「显示全部」取消
- 审批自动切 Tab：新审批到达自动切到 Approvals Tab
- 响应式折叠：resize 监听按断点自动收起（<700 全收 / <900 收右栏 / <1200 收右栏 / ≥1200 全展开）
- 键盘快捷键：Ctrl+B 侧栏、Ctrl+J 右栏、Esc 清除过滤
- ConnectionError 诊断跳转（Phase 1 已实现）

**验收结果**：tsc + vite build 通过（CSS 23.7KB, JS 39.2KB）；Vite dev server HTTP 验证页面正常返回。

### Phase 5：ToolCard/ThinkingBlock 接入（已完成 ✅）

- tool 消息从纯文本升级为结构化 ToolCard（解析 "tool → path" 格式）
- assistant 思考内容接入 ThinkingBlock 折叠展示

## 实施记录

- 实际分期与原计划不同：原 Phase 4（FileTree/收口）拆为 Phase 4（联动）+ Phase 5（ToolCard 接入），FileTree 未实现（非目标优先级低，可后续追加）
- 全部 5 个 Phase 累计：3 设计令牌文件 + 11 可复用组件 + 8 布局组件 + 启动门控
- 通信层（service.ts / ipc-transport.ts / sidecar.ts / tauri-bridge.ts）零改动
- 最终构建：CSS 23.7KB / JS 39.2KB（38 模块）

## 10. 非目标

- 不内置代码编辑器（只读 Diff 和文件树）
- 不做完整设计系统（只做 Desktop 所需组件）
- 不做浅色主题（v1 仅深色）
- 不做 i18n（v1 仅中文）
- 不做自动更新
- 不做多窗口
- 不做插件市场
- 不照搬 MiMo 的 Provider/Model 管理对话框（SaCode 用 `sacode account` CLI 管理凭据）
