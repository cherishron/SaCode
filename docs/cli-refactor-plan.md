# SaCode CLI 重构计划

> 基于 Bun 运行时 + Gemini CLI UI 模式，同步 Claude Code 核心能力

---

## 1. 重构目标与愿景

### 1.1 最终形态

| 维度 | 当前状态 | 目标状态 |
|------|----------|----------|
| **运行时** | Node.js 22+ | **Bun** |
| **UI 体验** | 基础输入框 | **Gemini CLI 模式**（命令补全、Vim 模式） |
| **查询引擎** | 简单流式 | **Claude Code QueryEngine**（AsyncGenerator） |
| **记忆系统** | 单层记忆 | **双层记忆**（全局 + 项目） |
| **并行代理** | 框架存在 | **Coordinator 模式** |

### 1.2 技术选型决策

| 维度 | 选择 | 决策理由 |
|------|------|----------|
| **运行时** | Bun | 启动快 3-5 倍，内置 TS/测试/打包，减少依赖 |
| **UI 底座** | Gemini CLI | 命令补全完整，Vim 模式成熟，交互体验好 |
| **查询引擎** | Claude Code | AsyncGenerator 模式，流式优先，状态机清晰 |
| **记忆系统** | Claude Code | 双文件模式，LLM 检索，自动累积 |
| **并行代理** | Claude Code | Coordinator 模式，任务分解，结果合成 |

### 1.3 核心功能优先级

| 优先级 | 功能 | 来源 | 说明 |
|:------:|------|------|------|
| **P0** | 命令补全系统 | Gemini CLI | Tab + ↑↓ 选择，模糊搜索 |
| **P0** | 思考过程可视化 | 自研 | 工具调用详情展示 |
| **P1** | Vim 模式 | Claude Code | Insert/Normal 模式，基础命令 |
| **P1** | QueryEngine | Claude Code | AsyncGenerator 流式模式 |
| **P2** | 记忆系统 | Claude Code | 双文件模式 + LLM 检索 |
| **P2** | 上下文压缩 | Claude Code | 四级压缩策略 |
| **P2** | 并行代理 | Claude Code | Coordinator 模式 |

---

## 2. 架构设计

### 2.1 整体架构图

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        SaCode CLI (Bun Runtime)                         │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ┌───────────────────────────────────────────────────────────────────┐  │
│  │                        UI Layer (Ink/React)                       │  │
│  │                                                                   │  │
│  │  ┌──────────┐  ┌────────────────┐  ┌──────────────────────────┐  │  │
│  │  │  Header  │  │  MessageList   │  │      InputPrompt         │  │  │
│  │  │          │  │                │  │  ┌────────────────────┐  │  │  │
│  │  │  Logo    │  │  MessageItem   │  │  │ TextInput          │  │  │  │
│  │  │  Status  │  │  ToolCallDisp. │  │  │ Suggestions        │  │  │  │
│  │  │  Model   │  │  MarkdownDisp. │  │  │ VimModeIndicator   │  │  │  │
│  │  │          │  │                │  │  └────────────────────┘  │  │  │
│  │  └──────────┘  └────────────────┘  └──────────────────────────┘  │  │
│  │                                                                   │  │
│  └───────────────────────────────────────────────────────────────────┘  │
│                                                                         │
│  ┌───────────────────────────────────────────────────────────────────┐  │
│  │                      Command Layer                                │  │
│  │                                                                   │  │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────────┐   │  │
│  │  │  Command    │  │  SlashCmd   │  │    CommandContext       │   │  │
│  │  │  Registry   │  │  Parser     │  │                         │   │  │
│  │  │             │  │             │  │  - messages             │   │  │
│  │  │  - builtin  │  │  - /cmd     │  │  - client               │   │  │
│  │  │  - plugins  │  │  - args     │  │  - session              │   │  │
│  │  │  - skills   │  │  - flags    │  │  - preferences          │   │  │
│  │  └─────────────┘  └─────────────┘  └─────────────────────────┘   │  │
│  │                                                                   │  │
│  └───────────────────────────────────────────────────────────────────┘  │
│                                                                         │
│  ┌───────────────────────────────────────────────────────────────────┐  │
│  │                       Core Layer                                  │  │
│  │                                                                   │  │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────────┐   │  │
│  │  │ QueryEngine │  │  Session    │  │    ToolExecutor         │   │  │
│  │  │             │  │  Manager    │  │                         │   │  │
│  │  │  - query()  │  │             │  │  - runTools()           │   │  │
│  │  │  - stream() │  │  - state    │  │  - parallel/serial      │   │  │
│  │  │  - compact()│  │  - history  │  │  - permissions          │   │  │
│  │  └─────────────┘  └─────────────┘  └─────────────────────────┘   │  │
│  │                                                                   │  │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────────┐   │  │
│  │  │  Memory     │  │ Coordinator │  │    SaCodeClient         │   │  │
│  │  │  Manager    │  │             │  │                         │   │  │
│  │  │             │  │  - agents   │  │  - Provider SDK         │   │  │
│  │  │  - recall() │  │  - delegate │  │  - MCP Client           │   │  │
│  │  │  - remember│  │  - synthesis│  │  - Streaming            │   │  │
│  │  └─────────────┘  └─────────────┘  └─────────────────────────┘   │  │
│  │                                                                   │  │
│  └───────────────────────────────────────────────────────────────────┘  │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### 2.2 模块划分

```
packages/cli/src/
├── cli.ts                    # Bun 入口
│
├── ui/                       # UI 层
│   ├── App.tsx              # 主应用容器
│   ├── Header.tsx           # 头部组件
│   ├── InputPrompt.tsx      # 输入系统（核心重构）
│   ├── StatusBar.tsx        # 状态栏
│   │
│   ├── components/          # 子组件
│   │   ├── Suggestions.tsx  # 命令建议列表
│   │   ├── ToolCallDisplay.tsx # 工具调用展示
│   │   ├── MessageItem.tsx  # 消息项
│   │   ├── MarkdownDisplay.tsx # Markdown 渲染
│   │   └── CodeHighlight.tsx # 代码高亮
│   │
│   ├── hooks/               # 自定义 Hooks
│   │   ├── useVimMode.ts    # Vim 模式
│   │   ├── useCommandPalette.ts # 命令面板
│   │   ├── useHistory.ts    # 历史记录
│   │   └── useSuggestions.ts # 建议列表
│   │
│   └── theme/               # 主题系统（已完成）
│       ├── semantic-tokens.ts
│       ├── theme-manager.ts
│       └── themes/
│
├── commands/                 # 命令层
│   ├── index.ts             # 命令注册表
│   ├── types.ts             # 命令类型定义
│   ├── builtin.ts           # 内置命令
│   ├── parser.ts            # 命令解析器
│   └── chat.tsx             # Chat 模式入口
│
├── core/                     # 核心层
│   ├── QueryEngine.ts       # 查询引擎
│   ├── query.ts             # 查询循环
│   ├── session.ts           # 会话管理
│   ├── memory.ts            # 记忆系统
│   ├── coordinator.ts       # 并行代理协调器
│   └── compaction.ts        # 上下文压缩
│
├── vim/                      # Vim 模式（参考 Claude Code）
│   ├── state.ts             # 状态机
│   ├── motions.ts           # 移动命令
│   ├── operators.ts         # 操作命令
│   └── types.ts             # 类型定义
│
└── lib/                      # 工具库
    ├── logger.ts            # 日志
    └── config.ts            # 配置
```

### 2.3 数据流设计

```
用户输入
    │
    ▼
┌─────────────────┐
│  InputPrompt    │
│  ┌───────────┐  │
│  │ TextInput │  │
│  └─────┬─────┘  │
│        │        │
│  ┌─────▼─────┐  │
│  │Suggestions│◄─┼── 命令补全（Gemini CLI 模式）
│  └─────┬─────┘  │
└────────┼────────┘
         │
         ▼
┌─────────────────┐
│  CommandParser  │
│  /cmd args...   │
└────────┬────────┘
         │
    ┌────┴────┐
    ▼         ▼
┌───────┐  ┌───────┐
│ Slash │  │ Chat  │
│ Command│  │ Message│
└───┬───┘  └───┬───┘
    │          │
    └────┬─────┘
         ▼
┌─────────────────┐
│  QueryEngine    │◄── Claude Code 模式
│  ┌───────────┐  │
│  │ query()   │  │── AsyncGenerator
│  │ generator │  │
│  └─────┬─────┘  │
│        │        │
│  ┌─────▼─────┐  │
│  │ compact() │  │── 上下文压缩
│  └─────┬─────┘  │
└────────┼────────┘
         │
         ▼
┌─────────────────┐
│  SaCodeClient   │
│  (Stream)       │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  ToolExecutor   │
│  ┌───────────┐  │
│  │ToolCall   │  │
│  │Display    │  │── 思考过程可视化
│  └───────────┘  │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  MessageList    │
│  ┌───────────┐  │
│  │MessageItem│  │
│  │ToolCall   │  │
│  │Markdown   │  │
│  └───────────┘  │
└─────────────────┘
```

### 2.4 组件层次结构

```
App
├── Header
│   ├── ThemedGradient (Logo)
│   └── ModelSelector
├── MessageList
│   ├── Static (已完成的静态消息)
│   │   └── MessageItem
│   │       ├── ToolCallDisplay (思考过程可视化)
│   │       │   ├── StatusIcon
│   │       │   ├── ToolArgs (参数展示)
│   │       │   └── ToolResult (结果折叠)
│   │       └── MarkdownDisplay
│   │           ├── CodeHighlight
│   │           └── Text
│   └── StreamingMessage (流式输出)
│       └── MarkdownDisplay
├── InputPrompt (Gemini CLI 模式)
│   ├── VimModeIndicator
│   ├── TextInput
│   └── Suggestions (命令补全)
│       └── SuggestionItem[]
└── StatusBar
    ├── TokenCounter
    ├── ModelInfo
    └── KeybindingHints
```

---

## 3. 核心模块设计

### 3.1 QueryEngine（查询引擎）

参考 Claude Code `QueryEngine.ts`，采用 AsyncGenerator 模式。

#### 状态机设计

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         QueryEngine State Machine                        │
│                                                                          │
│   Start ──▶ CheckCompaction ──▶ StreamFromAPI ──▶ ToolExecution         │
│                                     │                   │               │
│                                     ▼                   ▼               │
│                               Compacting ◀──────── SynthesizeTools      │
│                                     │                   │               │
│                                     ▼                   ▼               │
│                              SessionMemory ◀──── CheckCompaction         │
│                                     │                                   │
│                                     ▼                                   │
│                                    End                                   │
└─────────────────────────────────────────────────────────────────────────┘

| State | Event | Next State |
|-------|-------|------------|
| `start` | Query submitted | `checking_compaction` |
| `checking_compaction` | Compaction needed | `compacting` |
| `checking_compaction` | Compaction not needed | `streaming` |
| `compacting` | Done | `streaming` |
| `claude_api_error` | `prompt_too_long` | `session_memory_compact` |
| `session_memory_compact` | Done | `streaming` |
| `streaming` | Tool call needed | `executing_tools` |
| `streaming` | No tool call | `end` |
| `executing_tools` | Tools done | `checking_compaction` |
| `executing_tools` | Max loops reached | `end` |
```

#### 核心接口

```typescript
// core/QueryEngine.ts

interface QueryDeps {
  client: SaCodeClient;
  tools: ToolRegistry;
  permissions: PermissionEngine;
  hooks: HookEngine;
  memory: MemoryManager;
}

interface QueryState {
  messages: Message[];
  abortController: AbortController;
  usage: TokenUsage;
}

class QueryEngine {
  private state: QueryState;
  private deps: QueryDeps;

  constructor(deps: QueryDeps) {
    this.deps = deps;
    this.state = this.initState();
  }

  // 核心：AsyncGenerator 流式模式
  async *query(userInput: string): AsyncGenerator<StreamEvent | Message> {
    // 1. 检查压缩
    if (this.needsCompaction()) {
      yield* this.compact();
    }

    // 2. 流式调用 API
    const stream = this.deps.client.stream({
      messages: this.state.messages,
      tools: this.deps.tools.getDefinitions(),
    });

    for await (const event of stream) {
      yield event; // 直接 yield，不阻塞

      if (event.type === 'tool_use') {
        // 3. 执行工具
        const results = yield* this.runTools(event.toolCalls);
        
        // 4. 将结果添加到消息，继续循环
        this.state.messages.push(...results);
        
        // 5. 递归调用（开始新一轮）
        yield* this.query('');
        return;
      }
    }
  }

  // 工具执行
  async *runTools(toolCalls: ToolCall[]): AsyncGenerator<ToolEvent> {
    for (const call of toolCalls) {
      // 权限检查
      const permitted = await this.deps.permissions.check(call);
      if (!permitted) {
        yield { type: 'tool_denied', call };
        continue;
      }

      // 执行钩子
      await this.deps.hooks.run('beforeTool', call);

      // 执行工具
      yield { type: 'tool_start', call };
      const result = await this.deps.tools.execute(call);
      yield { type: 'tool_result', call, result };

      // 执行后钩子
      await this.deps.hooks.run('afterTool', call, result);
    }
  }
}
```

### 3.2 命令补全系统

参考 Gemini CLI `Suggestions.tsx`。

#### 交互设计

```
┌─────────────────────────────────────────────────────────────────────────┐
│  ➜ 输入消息或 / 获取命令列表                                              │
│  /he                                                                     │
│                                                                          │
│  ❯ /help          显示帮助信息                                           │
│    /history       查看对话历史                                           │
│    /heapdump      生成堆转储                                             │
│                                                                          │
│  [Tab] 补全  [↑↓] 选择  [Enter] 执行  [Esc] 取消                         │
└─────────────────────────────────────────────────────────────────────────┘
```

#### 核心组件

```typescript
// ui/components/Suggestions.tsx

interface SuggestionsProps {
  commands: SlashCommand[];
  selectedIndex: number;
  visible: boolean;
  maxVisible?: number;  // 默认 10
}

export const Suggestions: React.FC<SuggestionsProps> = ({
  commands,
  selectedIndex,
  visible,
  maxVisible = 10,
}) => {
  if (!visible || commands.length === 0) return null;

  // 分页显示
  const startIndex = Math.floor(selectedIndex / maxVisible) * maxVisible;
  const visibleCommands = commands.slice(startIndex, startIndex + maxVisible);

  return (
    <Box flexDirection="column" marginTop={1}>
      {visibleCommands.map((cmd, index) => {
        const actualIndex = startIndex + index;
        const isSelected = actualIndex === selectedIndex;
        
        return (
          <Box key={cmd.name}>
            <Text
              color={isSelected ? colors.text.accent : undefined}
              bold={isSelected}
              inverse={isSelected}
            >
              {isSelected ? "❯ " : "  "}/{cmd.name}
            </Text>
            <Text dimColor>
              {"  "}
              {cmd.description.slice(0, 40)}
              {cmd.description.length > 40 ? "..." : ""}
            </Text>
          </Box>
        );
      })}
      
      <Box marginTop={1}>
        <Text dimColor>
          <Text color={colors.text.user}>[Tab]</Text> 补全
          {"  "}
          <Text color={colors.text.user}>[↑↓]</Text> 选择
          {"  "}
          <Text color={colors.text.user}>[Enter]</Text> 执行
          {"  "}
          <Text color={colors.text.user}>[Esc]</Text> 取消
        </Text>
      </Box>
    </Box>
  );
};
```

### 3.3 思考过程可视化

#### 工具调用展示

```
┌─────────────────────────────────────────────────────────────────────────┐
│  ◐ read_file                                                            │
│  ├─ 思考: 用户想要查看配置文件的内容，我需要先读取文件...                  │
│  ├─ 目标: 读取 package.json 文件                                         │
│  └─ 参数: {"path": "./package.json"}                                    │
│     └─ 结果: {"name": "@sacode/cli", ...} (234ms)                       │
└─────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────┐
│  ✓ write_file (156ms)                                                   │
│  └─ 结果: 文件已成功写入                                                 │
└─────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────┐
│  ✗ run_shell (失败)                                                      │
│  └─ 错误: 命令执行超时                                                   │
└─────────────────────────────────────────────────────────────────────────┘
```

#### 核心组件

```typescript
// ui/components/ToolCallDisplay.tsx

interface ToolCallDisplayProps {
  message: Message;
  expanded?: boolean;
}

export const ToolCallDisplay: React.FC<ToolCallDisplayProps> = ({
  message,
  expanded = false,
}) => {
  const colors = getColors();
  const isRunning = message.toolStatus === "running";

  const statusConfig = {
    pending: { icon: "○", color: colors.status.pending },
    running: { icon: "◐", color: colors.status.running },
    success: { icon: "✓", color: colors.status.success },
    error: { icon: "✗", color: colors.status.error },
  };

  const config = statusConfig[message.toolStatus ?? "pending"];

  return (
    <Box
      flexDirection="column"
      marginLeft={2}
      borderStyle="round"
      borderColor={colors.border.default}
      paddingX={1}
    >
      {/* 工具标题 */}
      <Box>
        <Text color={config.color} bold>
          {isRunning ? <Spinner type="dots" /> : config.icon}
        </Text>
        <Text>
          {" "}
          {getToolIcon(message.toolName ?? "")}
          {" "}
          <Text color={colors.text.user} bold>
            {message.toolName}
          </Text>
        </Text>
        {message.toolDuration !== undefined && (
          <Text dimColor> ({message.toolDuration}ms)</Text>
        )}
      </Box>

      {/* 思考内容 */}
      {message.toolArgs?.thought && expanded && (
        <Box>
          <Text dimColor>├─ 思考: </Text>
          <Text dimColor wrap="wrap">
            {message.toolArgs.thought}
          </Text>
        </Box>
      )}

      {/* 工具参数 */}
      {message.toolArgs && expanded && (
        <Box>
          <Text dimColor>├─ 参数: </Text>
          <Text dimColor>
            {JSON.stringify(message.toolArgs, null, 0).slice(0, 100)}
          </Text>
        </Box>
      )}

      {/* 工具结果 */}
      {message.toolResult && expanded && (
        <Box>
          <Text dimColor>└─ 结果: </Text>
          <Text dimColor wrap="wrap">
            {message.toolResult.slice(0, 200)}
            {message.toolResult.length > 200 ? "..." : ""}
          </Text>
        </Box>
      )}
    </Box>
  );
};
```

### 3.4 Vim 模式

参考 Claude Code `vim/` 模块，采用状态机 + 纯函数设计。

#### 状态机设计

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        Vim Mode State Machine                            │
│                                                                          │
│  ┌──────────┐     ┌──────────┐     ┌──────────┐     ┌──────────┐       │
│  │  INSERT  │ ──▶ │  NORMAL  │ ──▶ │  VISUAL  │ ──▶ │ REPLACE  │       │
│  │          │ ◀── │          │ ◀── │          │ ◀── │          │       │
│  └──────────┘     └──────────┘     └──────────┘     └──────────┘       │
│       │                │                │                │             │
│       ▼                ▼                ▼                ▼             │
│  直接输入          命令模式          选择模式          替换模式          │
│  i/a/o...         d/y/c...         v/V/Ctrl-v       R                  │
│                   w/b/e...         移动选择                            │
│                   0/$/gg/G         扩展选择                            │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

#### 核心模块

```typescript
// vim/state.ts

type VimMode = 'insert' | 'normal' | 'visual' | 'replace';

interface VimState {
  mode: VimMode;
  cursor: number;
  selection?: { start: number; end: number };
  register: string;
  pendingOperator?: string;
}

// vim/motions.ts - 纯函数，易于测试
const motions = {
  'w': (text: string, cursor: number) => nextWord(text, cursor),
  'b': (text: string, cursor: number) => prevWord(text, cursor),
  'e': (text: string, cursor: number) => endWord(text, cursor),
  '0': () => 0,
  '$': (text: string) => text.length - 1,
  'gg': () => 0,
  'G': (text: string) => text.length - 1,
};

// vim/operators.ts
const operators = {
  'd': (text: string, range: Range) => deleteRange(text, range),
  'y': (text: string, range: Range, register: string) => ({ register: getRange(text, range) }),
  'c': (text: string, range: Range) => deleteRange(text, range),
};

// vim/types.ts
interface VimCommand {
  type: 'motion' | 'operator' | 'action';
  key: string;
  description: string;
}
```

---

## 4. Claude Code 功能同步规划

### 4.1 记忆系统

参考 Claude Code `memdir/` 模块。

#### 双文件模式

```
~/.sacode/memory/
├── MEMORY.md           ◄── 索引文件（最多 200 行）
│                           每行一个指向记忆文件的指针
├── user_role.md        ◄── 用户类型：角色、偏好
├── feedback_testing.md ◄── 反馈类型：需要重复/避免的行为
├── project_context.md  ◄── 项目类型：持续工作上下文
└── reference_docs.md   ◄── 参考类型：外部系统指针

# MEMORY.md 示例

## 用户上下文
- user_role.md: 用户偏好设置

## 项目上下文
- project_context.md: SaCode CLI 重构

## 反馈
- feedback_testing.md: 测试模式和最佳实践

## 参考
- reference_docs.md: API 文档链接
```

#### 核心操作

```typescript
// core/memory.ts

interface MemoryManager {
  // 检索：使用 LLM 搜索相关记忆
  recall(query: string): Promise<string[]>;
  
  // 记忆：添加新记忆，自动分类
  remember(content: string, type: MemoryType): Promise<void>;
  
  // 遗忘：移除记忆条目
  forget(query: string): Promise<void>;
  
  // 整合：合并相似记忆
  consolidate(): Promise<void>;
}

// 实现
class SaCodeMemoryManager implements MemoryManager {
  private memoryDir: string;
  private indexFile: string;

  async recall(query: string): Promise<string[]> {
    // 1. 读取 MEMORY.md 索引
    const index = await this.readIndex();
    
    // 2. 使用 LLM（Sonnet 级别）搜索相关记忆
    const relevant = await this.llm.search({
      query,
      index,
      topK: 5,
    });
    
    // 3. 读取相关文件内容
    const contents = await Promise.all(
      relevant.map(r => this.readFile(r.file))
    );
    
    return contents;
  }

  async remember(content: string, type: MemoryType): Promise<void> {
    // 1. 生成文件名
    const filename = `${type}_${Date.now()}.md`;
    
    // 2. 写入文件
    await this.writeFile(filename, content);
    
    // 3. 更新索引
    await this.updateIndex(filename, content.slice(0, 80));
  }
}
```

### 4.2 上下文压缩

参考 Claude Code 四级压缩策略。

#### 压缩级别

```
Token 使用量 ──────────────────────────────────────────────────────▶
0%              80%        85%        90%       95%          100%
│               │          │          │          │             │
│  正常运行     │ Micro-   │ Auto-    │ Session  │ 强制       │ 阻塞
│               │ compact  │ compact  │ memory   │ 截断       │
│               │ (清理旧  │ (完整    │ (提取到  │ (删除最    │
│               │ 工具结果)│ 摘要)    │ 记忆)    │ 旧消息)    │
```

#### 核心实现

```typescript
// core/compaction.ts

interface CompactionStrategy {
  name: string;
  trigger: number;  // 触发阈值（百分比）
  execute: () => Promise<void>;
}

const strategies: CompactionStrategy[] = [
  {
    name: 'micro-compact',
    trigger: 0.80,
    execute: async () => {
      // 清理旧工具结果：[Old tool result content cleared]
      // 目标：FileRead, Bash, Grep, Glob, WebSearch, WebFetch
    },
  },
  {
    name: 'auto-compact',
    trigger: 0.85,
    execute: async () => {
      // 1. 执行 pre-compact 钩子
      // 2. 移除旧消息中的图片
      // 3. 发送旧消息给模型摘要
      // 4. 用压缩边界标记替换
      // 5. 重新注入关键上下文
      // 6. 执行 post-compact 钩子
    },
  },
  {
    name: 'session-memory',
    trigger: 0.90,
    execute: async () => {
      // 提取关键信息到持久化会话记忆
      // 保留至少 10K token，最多 40K token
    },
  },
  {
    name: 'truncate',
    trigger: 0.95,
    execute: async () => {
      // 截断最旧的消息组
      // 保留 tool_use/tool_result 配对
    },
  },
];

class CompactionEngine {
  constructor(
    private maxTokens: number,
    private strategies: CompactionStrategy[]
  ) {}

  async checkAndCompact(currentUsage: number): Promise<void> {
    const ratio = currentUsage / this.maxTokens;

    for (const strategy of this.strategies) {
      if (ratio >= strategy.trigger) {
        await strategy.execute();
        break;
      }
    }
  }
}
```

### 4.3 并行代理（Coordinator）

参考 Claude Code `coordinator/` 模块。

#### 架构设计

```
┌─────────────────────────────────────────────────────────────────────────┐
│                      Coordinator Mode                                    │
│                                                                          │
│  用户: "帮我分析这个项目并写一个测试计划"                                 │
│                            │                                             │
│                            ▼                                             │
│  ┌────────────────────────────────────────────────────────────────────┐ │
│  │                        Coordinator                                 │ │
│  │  1. Synthesize: 理解任务，规划子任务                               │ │
│  │  2. Delegate: 分配子任务给代理                                     │ │
│  │  3. Collect: 收集各代理结果                                        │ │
│  │  4. Synthesize: 合成最终答案                                       │ │
│  └────────────────────────────────────────────────────────────────────┘ │
│                            │                                             │
│           ┌────────────────┼────────────────┐                           │
│           ▼                ▼                ▼                           │
│    ┌──────────┐     ┌──────────┐     ┌──────────┐                       │
│    │ Agent 1  │     │ Agent 2  │     │ Agent 3  │                       │
│    │ 分析代码 │     │ 写测试   │     │ 生成文档 │                       │
│    │ 结构     │     │ 用例     │     │          │                       │
│    └──────────┘     └──────────┘     └──────────┘                       │
│           │                │                │                           │
│           └────────────────┼────────────────┘                           │
│                            ▼                                             │
│                    ┌───────────┐                                         │
│                    │ Synthesis │                                         │
│                    └───────────┘                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

#### 核心实现

```typescript
// core/coordinator.ts

interface SubTask {
  id: string;
  description: string;
  agent: AgentType;
  dependencies?: string[];
}

interface CoordinatorResult {
  synthesis: string;
  subResults: Map<string, string>;
}

class Coordinator {
  constructor(
    private client: SaCodeClient,
    private agentRegistry: AgentRegistry
  ) {}

  async execute(task: string): Promise<CoordinatorResult> {
    // 1. Synthesize: 理解任务
    const plan = await this.plan(task);

    // 2. Delegate: 并行执行子任务
    const results = await this.delegate(plan.subTasks);

    // 3. Synthesize: 合成结果
    const synthesis = await this.synthesize(task, results);

    return { synthesis, subResults: results };
  }

  private async plan(task: string): Promise<{ subTasks: SubTask[] }> {
    const response = await this.client.chat({
      messages: [{
        role: 'system',
        content: '你是一个任务分解专家。将用户任务分解为可并行执行的子任务。',
      }, {
        role: 'user',
        content: task,
      }],
      tools: [{
        name: 'create_subtasks',
        description: '创建子任务列表',
        parameters: { ... },
      }],
    });

    return this.parsePlan(response);
  }

  private async delegate(subTasks: SubTask[]): Promise<Map<string, string>> {
    // 构建依赖图
    const graph = this.buildDependencyGraph(subTasks);

    // 按拓扑顺序执行（无依赖的并行执行）
    const results = new Map<string, string>();

    for (const level of graph.levels) {
      const promises = level.map(task =>
        this.agentRegistry.get(task.agent).execute(task.description)
      );

      const levelResults = await Promise.all(promises);
      level.forEach((task, i) => results.set(task.id, levelResults[i]));
    }

    return results;
  }

  private async synthesize(
    task: string,
    results: Map<string, string>
  ): Promise<string> {
    const response = await this.client.chat({
      messages: [{
        role: 'system',
        content: '你是一个结果合成专家。将多个子任务结果合成为完整答案。',
      }, {
        role: 'user',
        content: `原任务: ${task}\n\n子任务结果:\n${this.formatResults(results)}`,
      }],
    });

    return response.content;
  }
}
```

### 4.4 权限系统

参考 Claude Code 权限引擎。

#### 权限级别

```typescript
// core/permissions.ts

type PermissionLevel = 'allow' | 'ask' | 'deny';

interface PermissionRule {
  tool: string | RegExp;
  action: PermissionLevel;
  condition?: (args: any) => boolean;
}

const defaultRules: PermissionRule[] = [
  // 读取操作默认允许
  { tool: 'read_file', action: 'allow' },
  { tool: 'glob', action: 'allow' },
  { tool: 'grep', action: 'allow' },

  // 写入操作需要确认
  { tool: 'write_file', action: 'ask' },
  { tool: 'edit_file', action: 'ask' },
  { tool: 'delete_file', action: 'ask' },

  // 危险操作拒绝
  { tool: 'run_shell', action: 'ask', condition: isDangerous },
  { tool: /^dangerous_/, action: 'deny' },
];

class PermissionEngine {
  constructor(private rules: PermissionRule[]) {}

  async check(toolCall: ToolCall): Promise<boolean> {
    const rule = this.findRule(toolCall.name);

    switch (rule?.action) {
      case 'allow':
        return true;
      case 'deny':
        return false;
      case 'ask':
        return this.askUser(toolCall);
      default:
        return this.askUser(toolCall);
    }
  }

  private async askUser(toolCall: ToolCall): Promise<boolean> {
    // 显示工具调用详情，等待用户确认
    const answer = await this.ui.confirm({
      message: `允许执行 ${toolCall.name}?`,
      details: JSON.stringify(toolCall.args, null, 2),
    });

    return answer;
  }
}
```

---

## 5. 阶段性任务规划

### Phase 0: 基础设施迁移（1-2 天）

#### 任务清单

| # | 任务 | 说明 | 产出 |
|---|------|------|------|
| 0.1 | 安装 Bun 运行时 | Windows 环境安装 | `bun --version` |
| 0.2 | 修改 package.json | 脚本迁移到 Bun | 新的 scripts |
| 0.3 | 验证 workspace 依赖 | 测试 `@sacode/*` 导入 | 兼容性报告 |
| 0.4 | 验证 Ink 组件 | 测试 UI 渲染 | 渲染正常 |
| 0.5 | 更新 CI/CD | GitHub Actions 适配 | 新的 workflow |

#### 验收标准

- [ ] `bun run dev` 正常启动
- [ ] `bun test` 测试通过
- [ ] `bun build` 构建成功

### Phase 1: 架构重构（2-3 天）

#### 任务清单

| # | 任务 | 说明 | 产出 |
|---|------|------|------|
| 1.1 | 创建命令类型系统 | `commands/types.ts` | 类型定义 |
| 1.2 | 创建命令注册表 | `commands/index.ts` | 注册函数 |
| 1.3 | 创建命令解析器 | `commands/parser.ts` | 解析逻辑 |
| 1.4 | 创建 QueryEngine | `core/QueryEngine.ts` | 核心引擎 |
| 1.5 | 重构输入系统 | `ui/InputPrompt.tsx` | 新组件 |

#### 验收标准

- [ ] Slash 命令解析正确
- [ ] QueryEngine 流式输出正常
- [ ] 输入框基本功能正常

### Phase 2: 核心功能实现（3-4 天）

#### 任务清单

| # | 任务 | 说明 | 产出 |
|---|------|------|------|
| 2.1 | 命令补全系统 | `Suggestions.tsx` | 补全组件 |
| 2.2 | 思考过程可视化 | `ToolCallDisplay.tsx` | 工具展示 |
| 2.3 | Vim 模式 | `vim/` 模块 | 状态机 |
| 2.4 | 工具参数传递 | `core/provider/types.ts` | toolArgs |
| 2.5 | 工具调用去重 | `commands/chat.tsx` | 去重逻辑 |

#### 验收标准

- [ ] 输入 `/` 显示命令列表
- [ ] Tab 补全正常工作
- [ ] 工具调用展示思考内容
- [ ] Vim 模式基本命令可用

### Phase 3: Claude Code 功能同步（4-5 天）

#### 任务清单

| # | 任务 | 说明 | 产出 |
|---|------|------|------|
| 3.1 | 记忆系统 | `core/memory.ts` | 双文件模式 |
| 3.2 | 上下文压缩 | `core/compaction.ts` | 四级策略 |
| 3.3 | 并行代理 | `core/coordinator.ts` | Coordinator |
| 3.4 | 权限系统增强 | `core/permissions.ts` | 权限规则 |
| 3.5 | Hook 系统 | `core/hooks.ts` | 生命周期钩子 |

#### 验收标准

- [ ] 记忆可以 recall/remember
- [ ] 上下文超限时自动压缩
- [ ] 可以并行执行多个代理
- [ ] 敏感操作需要用户确认

### Phase 4: 优化完善（2-3 天）

#### 任务清单

| # | 任务 | 说明 | 产出 |
|---|------|------|------|
| 4.1 | 反向搜索 | `hooks/useReverseSearch.ts` | Ctrl+R |
| 4.2 | 历史记录优化 | `hooks/useHistory.ts` | 持久化 |
| 4.3 | 性能优化 | 虚拟滚动、节流 | 流畅度提升 |
| 4.4 | 文档完善 | 更新 README | 使用指南 |
| 4.5 | 测试补充 | 单元测试、集成测试 | 覆盖率 > 80% |

#### 验收标准

- [ ] Ctrl+R 反向搜索正常
- [ ] 历史记录跨会话保持
- [ ] 长消息渲染流畅
- [ ] 测试覆盖率达标

---

## 6. 文件结构规划

### 6.1 新建文件

```
packages/cli/src/
├── core/
│   ├── QueryEngine.ts       # 查询引擎
│   ├── query.ts             # 查询循环
│   ├── memory.ts            # 记忆系统
│   ├── coordinator.ts       # 并行代理
│   ├── compaction.ts        # 上下文压缩
│   └── permissions.ts       # 权限引擎
│
├── vim/
│   ├── state.ts             # 状态机
│   ├── motions.ts           # 移动命令
│   ├── operators.ts         # 操作命令
│   └── types.ts             # 类型定义
│
├── commands/
│   ├── types.ts             # 命令类型
│   ├── builtin.ts           # 内置命令
│   └── parser.ts            # 命令解析器
│
├── ui/
│   ├── InputPrompt.tsx      # 增强输入框
│   ├── components/
│   │   ├── Suggestions.tsx  # 建议列表
│   │   └── ToolCallDisplay.tsx # 工具展示
│   └── hooks/
│       ├── useVimMode.ts    # Vim 模式
│       ├── useReverseSearch.ts # 反向搜索
│       └── useSuggestions.ts # 建议列表
```

### 6.2 修改文件

```
packages/cli/
├── package.json             # Bun 迁移
└── src/
    ├── cli.ts               # Bun 入口
    ├── ui/
    │   ├── App.tsx          # 使用新组件
    │   └── components/
    │       └── MarkdownDisplay.tsx # 标题修复
    └── commands/
        └── chat.tsx         # 工具去重

packages/core/src/
└── provider/
    └── types.ts             # 添加 toolArgs、toolDuration
```

---

## 7. 风险与依赖

### 7.1 技术风险

| 风险 | 影响 | 概率 | 缓解措施 |
|------|:----:|:----:|----------|
| Bun 兼容性 | 高 | 中 | 先测试核心包导入 |
| Bun Windows 支持 | 中 | 低 | 测试 Windows 特定场景 |
| Ink 版本兼容 | 中 | 低 | 锁定版本，渐进升级 |
| 流式渲染性能 | 中 | 中 | 虚拟滚动、节流更新 |
| 记忆系统复杂度 | 中 | 中 | 分阶段实现 |

### 7.2 依赖关系

```
Phase 0 (Bun 迁移)
    │
    ├──▶ Phase 1 (架构重构)
    │        │
    │        ├──▶ Phase 2 (核心功能)
    │        │        │
    │        │        └──▶ Phase 4 (优化完善)
    │        │
    │        └──▶ Phase 3 (Claude Code 功能)
    │
    └──▶ Phase 4 (优化完善)
```

---

## 8. 参考资源

### 8.1 官方文档

- [Bun Documentation](https://bun.sh/docs)
- [Ink Documentation](https://github.com/vadimdemedes/ink)
- [Gemini CLI GitHub](https://github.com/google-gemini/gemini-cli)
- [Gemini CLI Architecture](https://google-gemini.github.io/gemini-cli/docs/architecture.html)

### 8.2 技术分析

- Claude Code 源码分析（本地：`E:\Project\STAND-ALONE\claude-code\`）
  - `QueryEngine.ts` - 查询引擎设计
  - `vim/` - Vim 模式实现
  - `memdir/` - 记忆系统
  - `coordinator/` - 并行代理
  - `context/` - 上下文管理

### 8.3 设计模式

- AsyncGenerator 流式模式
- 状态机模式（QueryEngine、Vim）
- 依赖注入模式（QueryDeps）
- 发布订阅模式（Hook 系统）

---

*文档版本: 2.0.0*
*创建日期: 2026-04-03*
*更新日期: 2026-04-03*
*作者: SaCode Team*