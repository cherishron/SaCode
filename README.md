# SaCode - 多端 AI 助手框架

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Bun](https://img.shields.io/badge/Bun-1.3%2B-orange)](https://bun.sh/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-blue)](https://www.typescriptlang.org/)
[![npm](https://img.shields.io/npm/v/@cherishron/sacode-cli.svg)](https://www.npmjs.com/package/@cherishron/sacode-cli)

基于 Provider 抽象层的多平台 AI 助手框架，支持 OpenAI、Anthropic、DeepSeek、Moonshot、智谱等 AI 服务，以及微信、QQ、Telegram、Discord、钉钉、飞书、小艺、WhatsApp、Slack、Email 等 10 个 IM 平台。

## 文档

- [AGENTS.md](./AGENTS.md) - 项目上下文与技术文档
- [PRD.md](./docs/PRD.md) - 产品需求文档
- [CONTRIBUTING.md](./docs/CONTRIBUTING.md) - 贡献指南
- [CHANGELOG.md](./docs/CHANGELOG.md) - 变更日志
- [部署指南](./docs/guides/deployment.md) - 生产环境部署
- [前端架构](./docs/architecture/frontend.md) - Web UI 架构文档
- [安全设计](./docs/architecture/security.md) - 安全架构文档

## 特性

- 🤖 **Provider 抽象层** - 支持 OpenAI、Anthropic、DeepSeek、Moonshot、智谱 5 个 AI 服务
- 🔄 **Function Calling Loop** - 完整的 Agentic 工具执行循环
- 🛠️ **工具桥接层** - 统一管理内置工具、Capabilities 工具、MCP 工具
- 🧠 **Agent 基础设施** - Registry + Planner + Orchestrator 实现 Agentic 规划
- 💬 **多端 IM 支持** - 微信、QQ、Telegram、Discord、钉钉、飞书、小艺、WhatsApp、Slack、Email
- 🔗 **跨渠道会话管理** - SessionMapper 实现多平台会话统一映射
- 🧭 **智能路由** - SmartRouter 支持规则引擎、条件匹配、多渠道路由
- ⏱️ **长任务管理** - LongTaskManager 支持后台任务、进度跟踪、中断恢复
- 🔌 **MCP 协议** - 完整的 Model Context Protocol 服务端/客户端实现
- 🗄️ **缓存系统** - CacheManager 支持 Memory/Redis 双后端、LRU 淘汰
- 🎛️ **模型管理** - ModelManager 支持多模型切换、能力匹配、负载均衡
- ⏰ **定时任务系统** - 支持 interval/once/cron 三种定时任务类型
- 🔌 **插件系统** - 可扩展的插件架构，支持生命周期钩子
- 🌐 **现代化 Web UI** - Vue 3 + TinyVue + Tailwind CSS
- 🔐 **混合认证** - 本地认证 + OAuth (GitHub/Google/微信/QQ/企业微信)
- 🛠️ **自动化能力** - 文件操作、浏览器控制、Shell 命令
- 🐳 **容器隔离** - Docker 容器运行 Agent，支持沙箱模式
- 🚪 **统一网关** - Gateway 提供 WebSocket 控制平面
- ⚡ **Bun 运行时** - 使用 Bun 作为主要运行时，Bun.serve() 作为 HTTP 服务
- 🔥 **Hono 框架** - API 层使用 Hono 替代 Express，轻量高性能
- 🎭 **Playwright** - 浏览器自动化使用 Playwright 替代 Puppeteer

## 项目结构

```
SaCode/
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
│   ├── cli/            # 命令行工具 (@cherishron/sacode-cli)
│   ├── capabilities/   # 自动化能力
│   ├── api/            # REST API + WebSocket (Hono + Bun.serve())
│   └── web/            # Web UI (Vue 3 + TinyVue)
│
├── .sacode/            # 配置目录
│   ├── commands/       # Slash 命令
│   ├── plugins/        # 插件目录
│   └── skills/         # Skills 目录
│
├── docs/               # 文档
└── docker/             # Docker 配置
```

## 快速开始

### 方式一：全局安装 CLI（推荐）

```bash
npm install -g @cherishron/sacode-cli

sacode chat              # 交互式聊天
sacode chat -m "你好"    # 发送单条消息
sacode /init             # 初始化项目配置
```

### 方式二：从源码构建

#### 环境要求

- Bun 1.3+（推荐）或 Node.js 22+
- pnpm 9+
- 数据库 (SQLite/MySQL/PostgreSQL)

#### 安装

```bash
git clone https://github.com/STAND-ALONE/SaCode.git
cd SaCode

bun install              # 或 pnpm install

# 初始化数据库
bun -C packages/database prisma generate
bun -C packages/database prisma db push

# 复制环境变量
cp .env.example .env
```

### 配置

编辑 `.env` 文件：

```env
# ============================================
# AI Provider 配置
# ============================================
AI_PROVIDER=openai

# OpenAI 配置
OPENAI_API_KEY=sk-your-api-key-here
AI_MODEL=gpt-4o
AI_TIMEOUT=60000

# 工具循环配置
MAX_TOOL_LOOP_ITERATIONS=10
ENABLE_AGENTIC_PLANNING=true

# ============================================
# 数据库配置
# ============================================
DATABASE_TYPE=sqlite
DATABASE_PATH=./data/sacode.db

# ============================================
# 缓存配置 (可选)
# ============================================
CACHE_BACKEND=memory

# ============================================
# IM 平台配置
# ============================================
TELEGRAM_BOT_TOKEN=your_bot_token
XIAOYI_AK=your_access_key
XIAOYI_SK=your_secret_key
DISCORD_BOT_TOKEN=your_bot_token
```

### 启动

```bash
bun dev                  # 开发所有包

# 或分别启动各服务
bun api                  # API 服务 (Hono + Bun.serve())
bun web                  # Web UI
bun cli                  # 命令行工具
```

## 使用

### CLI

```bash
sacode chat              # 交互式聊天
sacode chat -m "你好"    # 发送单条消息
sacode /init             # 初始化项目 AGENTS.md
sacode /session          # 查看会话信息
sacode /providers        # 查看可用 AI Provider
sacode config list       # 查看配置
sacode im list           # 管理 IM 连接
sacode im connect telegram
```

### AI Provider

```typescript
import { SACODEClient, createProvider } from "@sacode/core";

const client = new SACODEClient({
  provider: {
    type: "openai",
    apiKey: process.env.OPENAI_API_KEY,
    model: "gpt-4o",
  },
});

await client.connect();

for await (const msg of client.chat("你好")) {
  console.log(msg);
}
```

### Agentic 聊天

```typescript
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

router.addRule({
  id: "vip-priority",
  name: "VIP 优先",
  priority: 100,
  enabled: true,
  conditions: [{ field: "user.tier", operator: "eq", value: "vip" }],
  actions: [{ type: "route", channel: "premium-support" }],
});

const result = router.evaluate({ user: { tier: "vip" } });
```

### MCP 协议

```typescript
import { MCPServer } from "@sacode/core";

const mcpServer = new MCPServer({
  name: "sacode-mcp",
  version: "1.0.0",
});

mcpServer.registerTool({
  name: "read_file",
  description: "Read a file",
  inputSchema: { type: "object", properties: { path: { type: "string" } } },
}, async (args) => ({
  content: [{ type: "text", text: "file content" }],
}));
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
bun install              # 安装依赖
bun run build            # 构建所有包
bun test                 # 运行测试
bun run lint             # 代码检查
bun run typecheck        # 类型检查
bun run format           # 格式化代码
```

## Docker

```bash
bun run docker:build     # 构建镜像
bun run docker:up        # 启动服务
bun run docker:dev       # 开发模式
bun run docker:down      # 停止服务
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
| @cherishron/sacode-cli | CLI 工具（npm 全局安装包） |
| @sacode/capabilities | 文件/浏览器/Shell 自动化 |
| @sacode/api | Hono REST API + WebSocket (Bun.serve()) |
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

## 测试

```bash
bun test                 # 运行所有测试
bun test --watch         # 监视模式
bun test --coverage      # 测试覆盖率
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
