# SaCode - 可部署的 Agent CLI Server

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js Version](https://img.shields.io/badge/node-%3E%3D22.0.0-brightgreen)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-blue)](https://www.typescriptlang.org/)
[![Test Coverage](https://img.shields.io.io/badge/tests-174%20passed-brightgreen)](./vitest.config.ts)

SaCode 的最终产品形态是可部署的 Agent CLI Server：CLI 是主程序、控制面和执行器。核心体验是输入 `sacode` 进入 Agent CLI Shell，在 Shell 内通过 `/models`、`/providers`、`/agents`、`/doctor` 等 slash commands 或自然语言完成配置、诊断和任务执行。后续 Web 管理、微信入口、Webhook/API 会复用同一套命令路由、权限、审计和工具执行边界。

SaCode 基于 Provider 抽象层，支持 OpenAI、Anthropic、DeepSeek、Moonshot、智谱等 AI 服务；长期会通过可配置入口接入微信、Web 管理和其他 IM/Webhook 平台，让用户可以在终端或外部对话窗口中指挥同一个 CLI Agent 工作。

## 产品定位

```text
Agent CLI Shell / Web 管理 / 微信入口 / Webhook API
              ↓
        SaCode CLI Server
              ↓
 Slash Commands + Natural Language Agent
              ↓
 Provider + Models + Agents + Tools + Permissions + Audit
```

- **当前阶段**：优先打磨 `sacode` Agent CLI Shell，确保配置、诊断、聊天、工具、JSON 事件流和安全审批可靠。
- **后续阶段**：通过 `sacode serve` 扩展 HTTP API、Web 管理、微信/Webhook 入口。
- **安全边界**：外部入口必须通过正常服务/API/Webhook/Adapter 接入，不把运行环境当作隧道或中转节点；所有入口共用权限、审批和审计规则。

## 文档

- [AGENTS.md](./AGENTS.md) - 项目上下文与技术文档
- [PRD.md](./docs/PRD.md) - 产品需求文档
- [CONTRIBUTING.md](./docs/CONTRIBUTING.md) - 贡献指南
- [CHANGELOG.md](./docs/CHANGELOG.md) - 变更日志
- [部署指南](./docs/guides/deployment.md) - 生产环境部署
- [前端架构](./docs/architecture/frontend.md) - Web UI 架构文档
- [安全设计](./docs/architecture/security.md) - 安全架构文档

## 特性

- **可部署 CLI Server** - CLI 是主程序和执行器，后续通过 `sacode serve` 暴露 Web/API/微信入口
- **Agent CLI Shell** - 输入 `sacode` 进入交互式 Shell，支持 slash commands 和自然语言任务
- **CLI 主链路** - 支持 `doctor`、`config init`、单次 prompt、TUI、JSON/NDJSON 输出和工具运行
- **可配置模型系统** - 规划支持 Provider -> 接入方式 -> 多模型列表，并可一键测试模型
- **多 Agent 协作** - 规划支持不同 Agent 使用不同模型、权限和工具，并支持子 Agent 调度
- **Provider 抽象层** - 支持 OpenAI、Anthropic、DeepSeek、Moonshot、智谱 5 个 AI 服务
- **Function Calling Loop** - 完整的 Agentic 工具执行循环
- **工具桥接层** - 统一管理内置工具、Capabilities 工具、MCP 工具
- 🧠 **Agent 基础设施** - Registry + Planner + Orchestrator 实现 Agentic 规划
- **外部入口规划** - 微信、Web 管理、Webhook/API 等入口通过配置接入 CLI Server
- 🔗 **跨渠道会话管理** - SessionMapper 实现多平台会话统一映射
- 🧭 **智能路由** - SmartRouter 支持规则引擎、条件匹配、多渠道路由
- ⏱️ **长任务管理** - LongTaskManager 支持后台任务、进度跟踪、中断恢复
- 🔌 **MCP 协议** - 完整的 Model Context Protocol 服务端/客户端实现
- 🗄️ **缓存系统** - CacheManager 支持 Memory/Redis 双后端、LRU 淘汰
- 🎛️ **模型管理** - ModelManager 支持多模型切换、能力匹配、负载均衡
- ⏰ **定时任务系统** - 支持 interval/once/cron 三种定时任务类型
- 🔌 **插件系统** - 可扩展的插件架构，支持生命周期钩子
- **现代化 Web UI** - Vue 3 + TinyVue + Tailwind CSS，后续作为 CLI Server 的管理界面
- **混合认证** - 本地认证 + OAuth (GitHub/Google/微信/QQ/企业微信)
- **自动化能力** - 文件操作、浏览器控制、Shell 命令
- **容器隔离** - Docker 容器运行 Agent，支持沙箱模式
- **统一网关** - Gateway 提供 WebSocket 控制平面

## 项目结构

```
SACODE/
├── packages/
│   ├── core/           # 核心引擎
│   │   ├── provider/   # AI Provider 抽象层 (OpenAI/Anthropic/DeepSeek/Moonshot/智谱)
│   │   ├── client/     # SACODEClient (工具执行循环 + Agent 集成)
│   │   ├── tools/      # 工具桥接层 (内置 + Capabilities + MCP)
│   │   ├── agent/      # Agent 基础设施 (Registry + Planner + Orchestrator)
│   │   ├── session/    # 会话管理 + 跨渠道映射
│   │   ├── router/     # 消息路由 + SmartRouter
│   │   ├── model/      # 模型管理器
│   │   ├── cache/      # 缓存层 (Memory + Redis)
│   │   ├── scheduler/  # 定时任务调度器
│   │   ├── task/       # 长任务管理器
│   │   ├── mcp/        # MCP 协议实现
│   │   ├── streaming/  # 流式输出管理
│   │   └── plugin/     # 插件系统
│   │
│   ├── gateway/        # 统一控制平面
│   ├── container/      # 容器隔离
│   ├── adapters/       # IM 适配器 (10 个平台)
│   ├── database/       # 数据库层 (Prisma)
│   ├── auth/           # 认证模块
│   ├── cli/            # 命令行工具
│   ├── capabilities/   # 自动化能力
│   ├── api/            # REST API + WebSocket
│   └── web/            # Web UI (Vue 3 + TinyVue)
│
├── .SACODE/            # 配置目录
│   ├── commands/       # Slash 命令
│   ├── plugins/        # 插件目录
│   └── skills/         # Skills 目录
│
├── docs/               # 文档
└── javisk/             # PCIV 工作流模板
```

## 快速开始

### 环境要求

- Node.js 22+
- pnpm 9+
- CLI 核心功能只需要可用的 AI Provider API Key
- Web/API/微信入口等服务端能力后续需要数据库与服务配置

### 安装

```bash
# 克隆项目
git clone https://github.com/your-repo/SACODE.git
cd SACODE

# 安装依赖
pnpm install

# 构建 core/cli 主链路
pnpm --filter @sacode/core build
pnpm --filter @sacode/cli build
```

### 配置

优先使用 CLI 初始化最小配置：

```bash
node packages/cli/dist/cli.js config init
node packages/cli/dist/cli.js doctor
```

生成的 `.env` 只包含当前 CLI 所需的 Provider 配置。也可以手动编辑 `.env`：

```env
# ============================================
# AI Provider 配置
# ============================================
# 选择 AI Provider: openai | anthropic | deepseek | moonshot | zhipu
AI_PROVIDER=openai

# OpenAI 配置
OPENAI_API_KEY=sk-your-api-key-here
# OPENAI_BASE_URL=  # 可选，用于代理或自定义端点

# Anthropic 配置 (如果使用 Claude)
# ANTHROPIC_API_KEY=sk-ant-your-api-key-here

# 模型配置
OPENAI_MODEL=gpt-4o

# 其他 Provider 示例
# AI_PROVIDER=deepseek
# DEEPSEEK_API_KEY=sk-your-api-key-here
# DEEPSEEK_MODEL=deepseek-chat
```

### 启动

```bash
# 诊断 CLI 环境
node packages/cli/dist/cli.js doctor

# 单次任务
node packages/cli/dist/cli.js "请总结这个项目"

# 进入 Agent CLI Shell
node packages/cli/dist/cli.js

# 结构化输出
node packages/cli/dist/cli.js --json "Say OK"
node packages/cli/dist/cli.js --stream-json "Read package.json"
```

## 使用

### CLI

```bash
# 进入 Agent CLI Shell（核心交互方式）
SACODE

# Shell 内可用输入方式
/help
/doctor
/models
/providers
/agents
/tools
帮我分析这个项目

# 初始化配置
SACODE config init

# 诊断环境
SACODE doctor
SACODE doctor --json

# 交互式聊天
SACODE chat

# 单次 prompt
SACODE "帮我分析这个项目"
SACODE -p "帮我分析这个项目"

# JSON / NDJSON 输出，供脚本、Web、外部入口复用
SACODE --json "Say OK"
SACODE --stream-json "Read package.json"

# 工具管理
SACODE tool list
SACODE tool run read_file -P path=package.json limit=5

# 查看配置
SACODE config list
```

> 发布前命令名会统一为小写 `sacode`；当前源码中的 bin 仍为 `SACODE`。

### Agent CLI Shell 方向

传统子命令会继续保留给脚本和部署诊断，但 SaCode 的核心交互会逐步收敛到 Agent CLI Shell：

```text
$ sacode

SaCode Agent CLI
Workspace: /path/to/project
Model: deepseek/deepseek-chat
Type /help for commands

> /models
> /model use deepseek/deepseek-coder
> /agent coder
> 帮我修复当前项目的测试失败
```

未来微信、Web 和 Webhook 输入也会复用同一套 slash command router，因此 `/models`、`/agents`、`/doctor` 这类命令在终端和外部入口中应保持一致语义。

### AI Provider

```typescript
import { SACODEClient, createProvider } from "@sacode/core";

// 创建客户端
const client = new SACODEClient({
  provider: {
    type: "openai",
    apiKey: process.env.OPENAI_API_KEY,
    model: "gpt-4o",
  },
});

await client.connect();

// 流式聊天
for await (const msg of client.chat("你好")) {
  console.log(msg);
}
```

### Agentic 聊天

```typescript
// Agentic 聊天（带自动规划）
for await (const msg of client.agenticChat("帮我分析这个项目的代码质量")) {
  if ("type" in msg) {
    console.log(`[${msg.type}]`, msg);
  } else {
    console.log(msg.content || msg.chunk?.text);
  }
}
```

### 工具注册

```typescript
// 注册自定义工具
client.registerTool(
  "get_weather",
  "获取指定城市的天气信息",
  {
    type: "object",
    properties: {
      city: { type: "string", description: "城市名称" },
    },
    required: ["city"],
  },
  async (args) => {
    const weather = await fetchWeather(args.city as string);
    return JSON.stringify(weather);
  }
);
```

### 智能路由

```typescript
import { SmartRouter } from "@sacode/core";

const router = new SmartRouter();

// 添加路由规则
router.addRule({
  id: "vip-priority",
  name: "VIP 优先",
  priority: 100,
  enabled: true,
  conditions: [{ field: "user.tier", operator: "eq", value: "vip" }],
  actions: [{ type: "route", channel: "premium-support" }],
});

// 评估路由
const result = router.evaluate({ user: { tier: "vip" } });
```

### 长任务管理

```typescript
import { LongTaskManager } from "@sacode/core";

const taskManager = new LongTaskManager();

// 注册任务类型
taskManager.registerTaskType("analysis", {
  name: "Data Analysis",
  priority: "high",
  totalSteps: 3,
}, async (task, context) => {
  await context.reportProgress(33, "Step 1/3");
  // ... 执行任务
  return { result: "completed" };
});

// 创建任务
const task = await taskManager.createTask("analysis", { data: "..." });
```

### 缓存管理

```typescript
import { CacheManager } from "@sacode/core";

const cache = new CacheManager({
  backend: "memory",
  defaultTTL: 60000, // 1 分钟
});

// 获取或设置缓存
const value = await cache.getOrSet("user:123", async () => {
  return await fetchUser(123);
});
```

### 定时任务

```typescript
import { TaskScheduler } from "@sacode/core";

const scheduler = new TaskScheduler();

// Cron 任务 - 每天早上 8 点
scheduler.addTask({
  name: "早间提醒",
  type: "cron",
  config: { cronExpression: "0 8 * * *" },
  message: "早上好！",
  channel: "xiaoyi",
  chatId: "user_123",
});

// Interval 任务 - 每 5 分钟
scheduler.addTask({
  name: "定时检查",
  type: "interval",
  config: { interval: 5 * 60 * 1000 },
  message: "检查完成",
  channel: "telegram",
  chatId: "chat_456",
});
```

### MCP 协议

```typescript
import { MCPServer } from "@sacode/core";

const mcpServer = new MCPServer({
  name: "SACODE-mcp",
  version: "1.0.0",
});

// 注册工具
mcpServer.registerTool({
  name: "read_file",
  description: "Read a file",
  inputSchema: { type: "object", properties: { path: { type: "string" } } },
}, async (args) => ({
  content: [{ type: "text", text: "file content" }],
}));
```

### 插件系统

```typescript
import { PluginManager } from "@sacode/core";

const manager = new PluginManager({ pluginsDir: "./.SACODE/plugins" });
await manager.initialize();
await manager.install("my-plugin", "./plugins/my-plugin");
await manager.enable("my-plugin");
```

### Web UI

访问 http://localhost:5173 打开 Web 界面。

### API

| 路由 | 方法 | 功能 |
|------|------|------|
| `/api/auth/login` | POST | 登录 |
| `/api/auth/register` | POST | 注册 |
| `/api/chat/sessions` | GET | 获取会话列表 |
| `/api/chat` | POST | 发送消息 |
| `/api/chat/agentic` | POST | Agentic 模式聊天 |
| `/api/tasks` | GET/POST | 任务列表/创建 |
| `/api/tasks/:id/start` | POST | 启动任务 |
| `/api/routing/rules` | GET/POST | 路由规则管理 |
| `/api/models` | GET | 模型列表 |
| `/api/im` | GET | 获取 IM 连接 |
| `/api/capabilities` | GET | 获取能力列表 |
| `/api/plugins` | GET | 获取插件列表 |

## 支持的 AI Provider

| Provider | 类型 | 模型示例 |
|----------|------|----------|
| OpenAI | `openai` | gpt-4o, gpt-4-turbo, gpt-3.5-turbo |
| Anthropic | `anthropic` | claude-3-5-sonnet, claude-3-opus |
| DeepSeek | `deepseek` | deepseek-chat, deepseek-coder |
| Moonshot | `moonshot` | moonshot-v1-8k, moonshot-v1-32k |
| 智谱 | `zhipu` | glm-4, glm-4-flash |

## 支持的 IM 平台

| 平台 | 适配器 | 技术方案 | getChannels |
|------|--------|----------|-------------|
| 微信 | `WechatAdapter` | WebSocket | ✓ 联系人列表 |
| QQ | `QQAdapter` | OneBot 协议 | ✓ 群列表 |
| Telegram | `TelegramAdapter` | Bot API | ✓ 聊天列表 |
| Discord | `DiscordAdapter` | Gateway + REST | ✓ Guilds + Channels |
| 钉钉 | `DingTalkAdapter` | REST API + AI Card | ✓ 群列表 + 部门 |
| 飞书 | `FeishuAdapter` | Open API | ✓ |
| 小艺 | `XiaoyiAdapter` | AK/SK + WebSocket | ✓ |
| WhatsApp | `WhatsAppAdapter` | baileys 桥接 | ✓ |
| Slack | `SlackAdapter` | Web API + Socket Mode | ✓ |
| Email | `EmailAdapter` | IMAP + SMTP | ✓ 邮箱文件夹 |

## 开发

```bash
pnpm build      # 构建所有包
pnpm test       # 运行测试
pnpm lint       # 代码检查
pnpm typecheck  # 类型检查
pnpm format     # 格式化代码
```

## Docker

```bash
# 构建镜像
pnpm docker:build

# 启动服务
pnpm docker:up

# 开发模式
pnpm docker:dev

# 停止服务
pnpm docker:down
```

## 架构

### 核心模块

| 模块 | 描述 |
|------|------|
| @sacode/core | Provider 抽象层，工具桥接，Agent 基础设施，会话管理，智能路由，长任务，MCP 协议，缓存，模型管理 |
| @sacode/gateway | WebSocket 控制平面 |
| @sacode/container | Docker 容器隔离 |
| @sacode/adapters | IM 平台适配器 (10 个平台) |
| @sacode/database | Prisma ORM，多数据库适配 |
| @sacode/auth | Passport.js 认证，JWT，OAuth |
| @sacode/cli | Commander.js 命令行工具 |
| @sacode/capabilities | 文件/浏览器/Shell 自动化 |
| @sacode/api | Express REST API + WebSocket |
| @sacode/web | Vue 3 + TinyVue + Tailwind CSS |

### 消息流

```
用户输入 (CLI/Web/IM)
       ↓
   SACODEClient
       ↓
   AI Provider (OpenAI/Anthropic/...)
       ↓
    AI 模型响应
       ↓
  ┌────┴────┐
  ↓         ↓
工具调用   直接响应
  ↓
ToolBridge
  ↓
┌────────┴────────┐
↓                 ↓
内置工具      外部工具
(think/plan)  (MCP/Capabilities)
  ↓
继续对话循环
  ↓
   输出到用户
```

### Agentic 流程

```
用户请求
    ↓
复杂度评估
    ↓
┌────┴────┐
↓         ↓
简单     复杂
↓         ↓
直接执行  生成计划
          ↓
      Orchestrator
          ↓
    ┌────┴────┐
    ↓         ↓
  Agent    执行步骤
  分配     (带重试)
    ↓         ↓
    └────┬────┘
         ↓
      结果汇总
         ↓
      输出响应
```

### Gateway 架构

```
客户端 WebSocket
       ↓
  Gateway Server
       ↓
  ┌────┴────┐
  ↓         ↓
Handler   Session
  ↓
Router/Task/MCP/Cache/Model
```

## 测试

项目包含 174 个测试用例：

| 模块 | 测试数量 |
|------|----------|
| SmartRouter | 18 |
| MCP Protocol | 22 |
| Scheduler | 19 |
| ToolBridge | 23 |
| LongTaskManager | 17 |
| GroupQueue | 10 |
| Adapters | 25 |
| Auth | 14 |
| Integration | 14 |
| Core | 8 |
| Capabilities | 4 |

```bash
pnpm test             # 运行所有测试
pnpm test:watch       # 监视模式
pnpm test:coverage    # 测试覆盖率
```

## 贡献

欢迎贡献代码！请阅读 [贡献指南](./CONTRIBUTING.md) 了解详情。

- 提交 Issue 报告 Bug 或建议新功能
- 提交 Pull Request 贡献代码
- 遵循 [Conventional Commits](https://www.conventionalcommits.org/) 规范

## 许可证

[MIT](./LICENSE) © STAND-ALONE

## 作者

**STAND-ALONE**
- Email: 1635936133@qq.com
- GitHub: [@STAND-ALONE](https://github.com/STAND-ALONE)
