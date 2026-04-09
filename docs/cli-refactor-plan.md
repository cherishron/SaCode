# SaCode CLI 重构计划 v3.0

> **Gemini CLI UI 布局 + Claude Code 功能实现** 深度融合方案

---

## 1. 重构战略

### 1.1 核心原则

| 维度         | 来源        | 说明                                         |
| ------------ | ----------- | -------------------------------------------- |
| **UI 布局**  | Gemini CLI  | 组件层次、交互模式、视觉风格 1:1 还原        |
| **功能实现** | Claude Code | QueryEngine、工具系统、记忆系统、Coordinator |
| **运行时**   | Bun         | 启动快 3-5 倍，内置 TS 编译                  |
| **IM 扩展**  | SaCode 自研 | 多平台 IM 接入（微信、QQ、Telegram 等）      |

### 1.2 架构融合策略

```
┌─────────────────────────────────────────────────────────────────────┐
│                    SaCode CLI (Bun Runtime)                         │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │              UI Layer (Gemini CLI 1:1 布局)                    │  │
│  │                                                               │  │
│  │  ┌──────────┐  ┌──────────────────┐  ┌────────────────────┐  │  │
│  │  │  Header  │  │   MessageList    │  │    InputPrompt     │  │  │
│  │  │  (Logo)  │  │   (Virtual)      │  │  ┌──────────────┐  │  │  │
│  │  │  Status  │  │                  │  │  │  TextInput   │  │  │  │
│  │  │  Model   │  │  • MessageRow    │  │  │  Suggestions │  │  │  │
│  │  │  Cost    │  │  • ToolUseLoader │  │  │  VimMode     │  │  │  │
│  │  │          │  │  • Markdown      │  │  └──────────────┘  │  │  │
│  │  └──────────┘  └──────────────────┘  └────────────────────┘  │  │
│  │                                                               │  │
│  │  ┌─────────────────────────────────────────────────────────┐  │  │
│  │  │              StatusBar (底部状态栏)                       │  │  │
│  │  │  Token Count | Model Info | Keybinding Hints | Vim Mode │  │  │
│  │  └─────────────────────────────────────────────────────────┘  │  │
│  └───────────────────────────────────────────────────────────────┘  │
│                                                                     │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │           Core Layer (Claude Code 功能实现)                     │  │
│  │                                                               │  │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐   │  │
│  │  │ QueryEngine │  │  Tool System│  │   Permission Engine │   │  │
│  │  │ (AsyncGen)  │  │  (40+ tools)│  │   (ask/allow/deny)  │   │  │
│  │  └─────────────┘  └─────────────┘  └─────────────────────┘   │  │
│  │                                                               │  │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐   │  │
│  │  │  MemDir     │  │ Coordinator │  │   Context/Compaction│   │  │
│  │  │ (双文件记忆) │  │ (并行代理)   │  │   (四级压缩)        │   │  │
│  │  └─────────────┘  └─────────────┘  └─────────────────────┘   │  │
│  │                                                               │  │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐   │  │
│  │  │  Vim Mode   │  │  Skills     │  │   IM Adapter Bridge │   │  │
│  │  │ (状态机)    │  │  (ClawHub)  │  │   (10 平台)         │   │  │
│  │  └─────────────┘  └─────────────┘  └─────────────────────┘   │  │
│  └───────────────────────────────────────────────────────────────┘  │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### 1.3 为什么是 Gemini CLI UI + Claude Code 功能

| 对比维度       | Gemini CLI       | Claude Code              | SaCode 选择               |
| -------------- | ---------------- | ------------------------ | ------------------------- |
| **命令补全**   | ✅ 完整 Tab + ↑↓ | ⚠️ 基础补全              | **Gemini CLI**            |
| **Vim 模式**   | ✅ 成熟实现      | ✅ 完整实现              | **Claude Code**（更完整） |
| **工具可视化** | ✅ 思考过程展示  | ✅ ToolUseLoader         | **Claude Code**（更详细） |
| **查询引擎**   | ⚠️ 简单流式      | ✅ AsyncGenerator 状态机 | **Claude Code**           |
| **记忆系统**   | ⚠️ 基础          | ✅ MemDir 双文件         | **Claude Code**           |
| **上下文压缩** | ⚠️ 基础          | ✅ 四级压缩策略          | **Claude Code**           |
| **并行代理**   | ⚠️ 基础          | ✅ Coordinator 模式      | **Claude Code**           |
| **工具数量**   | ~15 个           | ~40 个                   | **Claude Code**           |
| **Slash 命令** | ~10 个           | ~50 个                   | **Claude Code**           |
| **UI 美观度**  | ✅ 精美          | ⚠️ 实用为主              | **Gemini CLI**            |

---

## 2. Gemini CLI UI 布局规范（1:1 还原）

### 2.1 组件层次结构

```
App (FpsMetricsProvider + StatsProvider + AppStateProvider)
├── Header
│   ├── LogoV2 (品牌标识)
│   ├── ModelPicker (模型选择器)
│   ├── StatusLine (状态行)
│   └── MemoryUsageIndicator (内存使用指示器)
│
├── Messages (VirtualMessageList)
│   ├── MessageRow (消息行)
│   │   ├── Message (用户/助手消息)
│   │   │   ├── Markdown (渲染)
│   │   │   └── MessageActions (操作按钮)
│   │   │
│   │   └── ToolUseLoader (工具调用加载器)
│   │       ├── Tool status icon (◐/✓/✗)
│   │       ├── Tool name + duration
│   │       ├── Tool args (折叠)
│   │       └── Tool result (折叠)
│   │
│   ├── CompactSummary (压缩摘要)
│   ├── TeleportProgress (代理进度)
│   └── CostThresholdDialog (成本阈值对话框)
│
├── InputPrompt (核心交互区)
│   ├── TextInput / VimTextInput
│   │   ├── BaseTextInput
│   │   └── PromptInput (Gemini CLI 风格)
│   │
│   ├── Suggestions (命令补全)
│   │   ├── Slash command list
│   │   ├── File path completions
│   │   └── Context suggestions
│   │
│   ├── VimModeIndicator (Vim 模式指示)
│   └── KeybindingHints (快捷键提示)
│
├── StatusBar (底部状态栏)
│   ├── TokenCounter (Token 计数)
│   ├── ModelInfo (当前模型)
│   ├── CostTracker (成本追踪)
│   └── VimModeIndicator (Vim 模式)
│
└── Overlays (覆盖层)
    ├── GlobalSearchDialog (全局搜索)
    ├── HistorySearchDialog (历史搜索 Ctrl+R)
    ├── Settings (设置面板)
    └── ThemePicker (主题选择)
```

### 2.2 交互模式规范

#### 命令补全（Gemini CLI 风格）

```
➜ 输入消息或 / 获取命令列表
/he

❯ /help          显示帮助信息
   /history      查看对话历史
   /heapdump     生成堆转储

[Tab] 补全  [↑↓] 选择  [Enter] 执行  [Esc] 取消
```

#### 工具调用可视化（Claude Code 风格）

```
◐ read_file
├─ 思考: 用户想要查看配置文件的内容
├─ 目标: 读取 package.json 文件
└─ 参数: {"path": "./package.json"}
   └─ 结果: {"name": "@sacode/cli", ...} (234ms)

✓ write_file (156ms)
└─ 结果: 文件已成功写入
```

#### Vim 模式状态机

```
INSERT ──Esc──▶ NORMAL ──v──▶ VISUAL ──Esc──▶ NORMAL
  ▲              │
  └──i/a/o───────┘
```

---

## 3. Claude Code 功能实现映射

### 3.1 QueryEngine（查询引擎）

**来源**: `E:\Project\STAND-ALONE\claude-code\src\QueryEngine.ts` (~1295 行)

#### 状态机设计

```
Start ──▶ CheckCompaction ──▶ StreamFromAPI ──▶ ToolExecution
                                  │                   │
                                  ▼                   ▼
                            Compacting ◀──────── SynthesizeTools
                                  │                   │
                                  ▼                   ▼
                             SessionMemory ◀──── CheckCompaction
                                  │
                                  ▼
                                 End
```

#### 核心接口

```typescript
interface QueryDeps {
  client: SaCodeClient;
  tools: ToolRegistry;
  permissions: PermissionEngine;
  hooks: HookEngine;
  memory: MemoryManager;
}

class QueryEngine {
  // 核心：AsyncGenerator 流式模式
  async *query(userInput: string): AsyncGenerator<StreamEvent | Message> {
    // 1. 检查压缩
    // 2. 流式调用 API
    // 3. 工具执行
    // 4. 递归循环
  }
}
```

### 3.2 工具系统（40+ 工具）

**来源**: `E:\Project\STAND-ALONE\claude-code\src\tools/`

| 工具类别   | Claude Code 工具                          | SaCode 映射                                 | 优先级 |
| ---------- | ----------------------------------------- | ------------------------------------------- | ------ |
| **文件**   | FileRead, FileWrite, FileEdit, Glob, Grep | read_file, write_file, edit_file, grep_tool | P0     |
| **Shell**  | Bash                                      | run_shell_command                           | P0     |
| **Web**    | WebFetch, WebSearch                       | web_fetch, web_search                       | P1     |
| **Agent**  | Agent, TeamCreate                         | agent_tool, team_create_tool                | P1     |
| **Task**   | TaskCreate, TaskUpdate, CronCreate        | task_create_tool, cron_create_tool          | P1     |
| **Git**    | EnterWorktree, ExitWorktree               | enter_worktree_tool, exit_worktree_tool     | P2     |
| **LSP**    | LSP                                       | lsp_tool                                    | P2     |
| **MCP**    | MCP                                       | MCP 协议支持                                | P1     |
| **Memory** | Memory management                         | 记忆系统工具                                | P2     |
| **Plan**   | EnterPlanMode, ExitPlanMode               | 计划模式切换                                | P1     |

### 3.3 Slash 命令系统（50+ 命令）

**来源**: `E:\Project\STAND-ALONE\claude-code\src\commands/`

| 命令类别   | Claude Code 命令        | SaCode 映射       | 优先级 |
| ---------- | ----------------------- | ----------------- | ------ |
| **Git**    | /commit, /review, /diff | git 集成命令      | P1     |
| **上下文** | /compact, /context      | 上下文管理        | P1     |
| **配置**   | /config, /theme, /vim   | 已有 config 命令  | P0     |
| **记忆**   | /memory                 | 记忆管理          | P2     |
| **技能**   | /skills                 | 已有 skills 命令  | P0     |
| **任务**   | /tasks                  | 已有 cron 命令    | P0     |
| **MCP**    | /mcp                    | MCP 管理          | P1     |
| **诊断**   | /doctor                 | status diagnose   | P0     |
| **认证**   | /login, /logout         | 认证管理          | P1     |
| **会话**   | /resume, /share, /cost  | session/cost 管理 | P1     |

### 3.4 记忆系统（MemDir）

**来源**: `E:\Project\STAND-ALONE\claude-code\src\memdir/`

#### 双文件模式

```
~/.sacode/memory/
├── MEMORY.md           ◄── 索引文件（最多 200 行）
├── user_role.md        ◄── 用户偏好
├── feedback_testing.md ◄── 反馈记录
├── project_context.md  ◄── 项目上下文
└── reference_docs.md   ◄── 参考指针
```

### 3.5 上下文压缩（四级策略）

```
Token 使用量 ──────────────────────────────────────────────────────▶
0%              80%        85%        90%       95%          100%
│               │          │          │          │             │
│  正常运行     │ Micro-   │ Auto-    │ Session  │ 强制       │ 阻塞
│               │ compact  │ compact  │ memory   │ 截断       │
│               │ (清理旧  │ (完整    │ (提取到  │ (删除最    │
│               │ 工具结果)│ 摘要)    │ 记忆)    │ 旧消息)    │
```

### 3.6 Coordinator 并行代理

```
用户请求
    │
    ▼
┌─────────────────────────┐
│      Coordinator         │
│  1. Synthesize: 理解任务  │
│  2. Delegate: 分配子任务  │
│  3. Collect: 收集结果     │
│  4. Synthesize: 合成答案  │
└────────┬────────────────┘
         │
    ┌────┼────┐
    ▼    ▼    ▼
 Agent1 Agent2 Agent3
 分析   测试   文档
```

---

## 4. 分阶段实施计划

### Phase 0: Bun 运行时迁移（1-2 天）

| #   | 任务                | 产出            | 验收             |
| --- | ------------------- | --------------- | ---------------- |
| 0.1 | 安装 Bun 运行时     | `bun --version` | ✅ 正常          |
| 0.2 | 修改 package.json   | Bun scripts     | ✅ `bun run dev` |
| 0.3 | 验证 workspace 依赖 | 兼容性报告      | ✅ 导入正常      |
| 0.4 | 验证 Ink 组件       | 渲染测试        | ✅ 渲染正常      |
| 0.5 | 更新 CI/CD          | GitHub Actions  | ✅ 构建通过      |

### Phase 1: Gemini CLI UI 布局实现（3-4 天）

| #   | 任务                      | 来源        | 产出                   | 验收                     |
| --- | ------------------------- | ----------- | ---------------------- | ------------------------ |
| 1.1 | Header 组件               | Gemini CLI  | Header.tsx             | ✅ Logo + Model + Status |
| 1.2 | VirtualMessageList        | Gemini CLI  | VirtualMessageList.tsx | ✅ 虚拟滚动              |
| 1.3 | MessageRow + Message      | Gemini CLI  | MessageRow.tsx         | ✅ 消息渲染              |
| 1.4 | ToolUseLoader             | Claude Code | ToolUseLoader.tsx      | ✅ 工具调用展示          |
| 1.5 | InputPrompt + Suggestions | Gemini CLI  | InputPrompt.tsx        | ✅ 命令补全              |
| 1.6 | StatusBar                 | Gemini CLI  | StatusBar.tsx          | ✅ Token + Model + Cost  |
| 1.7 | VimTextInput              | Claude Code | VimTextInput.tsx       | ✅ Vim 模式输入          |
| 1.8 | 主题系统                  | Gemini CLI  | theme/                 | ✅ 多主题切换            |

### Phase 2: Claude Code 核心功能移植（5-7 天）

| #   | 任务           | 来源        | 产出             | 验收              |
| --- | -------------- | ----------- | ---------------- | ----------------- |
| 2.1 | QueryEngine    | Claude Code | QueryEngine.ts   | ✅ AsyncGenerator |
| 2.2 | 工具系统适配   | Claude Code | tools/ (40+)     | ✅ 工具注册/执行  |
| 2.3 | 权限引擎       | Claude Code | PermissionEngine | ✅ ask/allow/deny |
| 2.4 | Hook 系统      | Claude Code | hooks/           | ✅ 生命周期钩子   |
| 2.5 | 上下文收集     | Claude Code | context/         | ✅ 系统上下文     |
| 2.6 | Vim 模式       | Claude Code | vim/             | ✅ Insert/Normal  |
| 2.7 | Slash 命令扩展 | Claude Code | commands/ (50+)  | ✅ 命令解析       |

### Phase 3: 高级功能实现（4-5 天）

| #   | 任务            | 来源        | 产出         | 验收               |
| --- | --------------- | ----------- | ------------ | ------------------ |
| 3.1 | MemDir 记忆系统 | Claude Code | memdir/      | ✅ recall/remember |
| 3.2 | 上下文压缩      | Claude Code | compaction/  | ✅ 四级压缩        |
| 3.3 | Coordinator     | Claude Code | coordinator/ | ✅ 并行代理        |
| 3.4 | 成本追踪        | Claude Code | cost-tracker | ✅ Token 成本      |
| 3.5 | 插件系统        | Claude Code | plugins/     | ✅ 插件加载        |
| 3.6 | Skills 系统增强 | Claude Code | skills/      | ✅ 技能执行        |

### Phase 4: IM 平台扩展（后续迭代）

| #   | 任务         | 说明          | 产出               |
| --- | ------------ | ------------- | ------------------ |
| 4.1 | QQ 接入适配  | OneBot 协议   | QQAdapter 增强     |
| 4.2 | 微信接入适配 | WebSocket     | WechatAdapter 增强 |
| 4.3 | IM 消息桥接  | CLI ↔ IM      | 消息路由           |
| 4.4 | 跨平台会话   | SessionMapper | 统一会话           |

---

## 5. 文件结构规划

### 5.1 新文件清单

```
packages/cli/src/
├── cli.ts                          # Bun 入口
│
├── ui/                             # UI 层（Gemini CLI 1:1 布局）
│   ├── App.tsx                     # 顶层容器（AppState + Stats + FPS）
│   ├── FullscreenLayout.tsx        # 全屏布局
│   │
│   ├── header/                     # 头部
│   │   ├── Header.tsx              # Header 容器
│   │   ├── LogoV2.tsx              # 品牌标识
│   │   ├── ModelPicker.tsx         # 模型选择器
│   │   ├── StatusLine.tsx          # 状态行
│   │   └── MemoryUsageIndicator.tsx # 内存使用
│   │
│   ├── messages/                   # 消息列表
│   │   ├── VirtualMessageList.tsx  # 虚拟滚动消息列表
│   │   ├── MessageRow.tsx          # 消息行
│   │   ├── Message.tsx             # 消息内容
│   │   ├── Markdown.tsx            # Markdown 渲染
│   │   ├── ToolUseLoader.tsx       # 工具调用加载器
│   │   ├── CompactSummary.tsx      # 压缩摘要
│   │   └── TeleportProgress.tsx    # 代理进度
│   │
│   ├── input/                      # 输入系统
│   │   ├── InputPrompt.tsx         # 输入容器
│   │   ├── TextInput.tsx           # 文本输入
│   │   ├── VimTextInput.tsx        # Vim 模式输入
│   │   ├── Suggestions.tsx         # 命令补全（Gemini CLI 风格）
│   │   └── KeybindingHints.tsx     # 快捷键提示
│   │
│   ├── status/                     # 状态栏
│   │   ├── StatusBar.tsx           # 底部状态栏
│   │   ├── TokenCounter.tsx        # Token 计数
│   │   └── CostTracker.tsx         # 成本追踪
│   │
│   ├── dialogs/                    # 对话框
│   │   ├── GlobalSearchDialog.tsx  # 全局搜索
│   │   ├── HistorySearchDialog.tsx # 历史搜索
│   │   └── ThemePicker.tsx         # 主题选择
│   │
│   ├── design-system/              # 设计系统
│   │   ├── colors.ts               # 颜色系统
│   │   ├── spacing.ts              # 间距系统
│   │   └── typography.ts           # 字体系统
│   │
│   └── hooks/                      # 自定义 Hooks
│       ├── useCanUseTool.ts        # 工具权限检查
│       ├── useCommandPalette.ts    # 命令面板
│       ├── useVimMode.ts           # Vim 模式
│       └── useSuggestions.ts       # 建议列表
│
├── core/                           # 核心层（Claude Code 功能）
│   ├── QueryEngine.ts              # 查询引擎（AsyncGenerator）
│   ├── query.ts                    # 查询循环
│   ├── query/                      # 查询管道
│   │   ├── buildMessages.ts        # 消息构建
│   │   ├── processToolCalls.ts     # 工具调用处理
│   │   └── handleResponse.ts       # 响应处理
│   │
│   ├── tools/                      # 工具系统（40+ 工具）
│   │   ├── BashTool.ts             # Shell 命令
│   │   ├── FileReadTool.ts         # 文件读取
│   │   ├── FileWriteTool.ts        # 文件写入
│   │   ├── FileEditTool.ts         # 文件编辑
│   │   ├── GlobTool.ts             # 文件搜索
│   │   ├── GrepTool.ts             # 内容搜索
│   │   ├── WebFetchTool.ts         # 网页获取
│   │   ├── WebSearchTool.ts        # 网页搜索
│   │   ├── AgentTool.ts            # 子代理
│   │   ├── MCPTool.ts              # MCP 工具
│   │   ├── LSPTool.ts              # LSP 工具
│   │   └── ...                     # 更多工具
│   │
│   ├── commands/                   # Slash 命令（50+ 命令）
│   │   ├── commit.ts               # Git 提交
│   │   ├── review.ts               # 代码审查
│   │   ├── compact.ts              # 上下文压缩
│   │   ├── mcp.ts                  # MCP 管理
│   │   ├── config.ts               # 配置管理
│   │   ├── doctor.ts               # 诊断
│   │   ├── memory.ts               # 记忆管理
│   │   ├── skills.ts               # 技能管理
│   │   ├── tasks.ts                # 任务管理
│   │   └── vim.ts                  # Vim 模式切换
│   │
│   ├── memdir/                     # 记忆系统
│   │   ├── memdir.ts               # 记忆目录
│   │   ├── paths.ts                # 路径配置
│   │   └── extractMemories.ts      # 记忆提取
│   │
│   ├── coordinator/                # 并行代理
│   │   ├── coordinator.ts          # 协调器
│   │   └── agentPool.ts            # 代理池
│   │
│   ├── context/                    # 上下文系统
│   │   ├── context.ts              # 上下文收集
│   │   └── compaction.ts           # 上下文压缩
│   │
│   ├── permissions/                # 权限系统
│   │   ├── PermissionEngine.ts     # 权限引擎
│   │   └── toolPermission/         # 工具权限
│   │
│   └── cost-tracker.ts             # 成本追踪
│
├── vim/                            # Vim 模式
│   ├── state.ts                    # 状态机
│   ├── motions.ts                  # 移动命令
│   ├── operators.ts                # 操作命令
│   └── types.ts                    # 类型定义
│
├── services/                       # 服务层
│   ├── api/                        # API 客户端
│   ├── mcp/                        # MCP 服务
│   ├── lsp/                        # LSP 服务
│   └── analytics/                  # 分析服务
│
├── state/                          # 状态管理
│   ├── AppState.ts                 # 应用状态
│   └── onChangeAppState.ts         # 状态变更
│
├── context/                        # React Context
│   ├── fpsMetrics.ts               # FPS 指标
│   └── stats.ts                    # 统计
│
├── keybindings/                    # 快捷键
│   └── keybindings.ts              # 快捷键配置
│
├── hooks/                          # 通用 Hooks
│   └── ...
│
├── utils/                          # 工具函数
│   ├── config.ts                   # 配置
│   ├── model.ts                    # 模型
│   ├── messages.ts                 # 消息
│   └── Shell.ts                    # Shell 工具
│
├── types/                          # 类型定义
│   └── ...
│
├── outputStyles/                   # 输出样式
│   └── ...
│
└── lib/                            # 通用库
    ├── logger.ts                   # 日志
    └── config.ts                   # 配置
```

### 5.2 修改文件清单

| 文件                                  | 修改内容                    |
| ------------------------------------- | --------------------------- |
| `packages/cli/package.json`           | Bun 运行时迁移              |
| `packages/cli/src/cli.ts`             | 新入口，使用 React/Ink      |
| `packages/cli/src/commands/index.ts`  | 扩展命令注册                |
| `packages/core/src/provider/types.ts` | 添加 toolArgs、toolDuration |

---

## 6. 技术选型总结

| 层级           | 技术                | 来源        | 理由                 |
| -------------- | ------------------- | ----------- | -------------------- |
| **运行时**     | Bun                 | -           | 启动快、内置 TS      |
| **UI 框架**    | React + Ink         | Gemini CLI  | 终端 UI 标准方案     |
| **UI 布局**    | Gemini CLI 组件层次 | Gemini CLI  | 1:1 还原视觉体验     |
| **查询引擎**   | AsyncGenerator      | Claude Code | 流式优先、状态机清晰 |
| **工具系统**   | 40+ 工具模块        | Claude Code | 完整工具生态         |
| **记忆系统**   | MemDir 双文件       | Claude Code | LLM 检索、自动累积   |
| **上下文压缩** | 四级策略            | Claude Code | 智能压缩、不丢上下文 |
| **并行代理**   | Coordinator         | Claude Code | 任务分解、结果合成   |
| **权限系统**   | ask/allow/deny      | Claude Code | 细粒度权限控制       |
| **IM 桥接**    | SaCode 自研         | SaCode      | 10 平台 IM 接入      |

---

## 7. 风险与缓解

| 风险                     | 影响 | 概率 | 缓解措施                   |
| ------------------------ | :--: | :--: | -------------------------- |
| Claude Code 源码法律风险 |  高  |  中  | 仅参考架构思路，不复制代码 |
| Bun Windows 兼容性       |  中  |  低  | 测试 Windows 特定场景      |
| Ink 版本兼容             |  中  |  低  | 锁定版本，渐进升级         |
| 流式渲染性能             |  中  |  中  | 虚拟滚动、节流更新         |
| 记忆系统复杂度           |  中  |  中  | 分阶段实现                 |

---

## 8. 参考资源

### 8.1 Gemini CLI

- [Gemini CLI GitHub](https://github.com/google-gemini/gemini-cli)
- [Gemini CLI Docs](https://geminicli.com/docs/)
- [Gemini CLI Architecture](https://google-gemini.github.io/gemini-cli/docs/architecture.html)

### 8.2 Claude Code

- Claude Code 源码: `E:\Project\STAND-ALONE\claude-code\src/`
  - `QueryEngine.ts` — 查询引擎 (~1295 行)
  - `Tool.ts` — 工具类型定义 (~29K 行)
  - `commands.ts` — 命令注册 (~25K 行)
  - `components/` — 144 个 React 组件
  - `tools/` — 40+ 工具实现
  - `commands/` — 50+ Slash 命令
  - `memdir/` — 记忆系统
  - `coordinator/` — 并行代理
  - `vim/` — Vim 模式
  - `context/` — 上下文管理

### 8.3 设计模式

- AsyncGenerator 流式模式
- 状态机模式（QueryEngine、Vim）
- 依赖注入模式（QueryDeps）
- 发布订阅模式（Hook 系统）
- 虚拟滚动（VirtualMessageList）

---

_文档版本: 3.0.0_
_创建日期: 2026-04-04_
_更新日期: 2026-04-04_
_策略: Gemini CLI UI 布局 + Claude Code 功能实现_
_作者: SaCode Team_
