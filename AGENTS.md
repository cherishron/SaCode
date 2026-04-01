# SaCode 项目上下文

> 多端 AI 助手框架 - 基于 iFlow SDK 的 TypeScript Monorepo 项目

---

## 项目概览

**SaCode** 是一个基于 Provider 抽象层的多平台 AI 助手框架，支持微信、QQ、Telegram、Discord、钉钉、飞书、小艺、WhatsApp、Slack、Email 等 IM 平台。

### 核心特性

| 特性 | 说明 |
|------|------|
| **Provider 抽象层** | 支持 OpenAI、Anthropic、DeepSeek、Moonshot、智谱 5 个 AI 后端 |
| **多端 IM 支持** | 10 个平台：微信、QQ、Telegram、Discord、钉钉、飞书、小艺、WhatsApp、Slack、Email |
| **跨渠道会话管理** | SessionMapper 实现多平台会话统一映射 |
| **智能路由** | SmartRouter 支持规则引擎、条件匹配、多渠道路由 |
| **长任务管理** | LongTaskManager 支持后台任务、进度跟踪、中断恢复 |
| **MCP 协议** | 完整的 Model Context Protocol 服务端/客户端实现 |
| **模型管理** | ModelManager 支持多模型切换、能力匹配、负载均衡 |
| **缓存系统** | CacheManager 支持 Memory/Redis 双后端、LRU 淘汰、TTL 过期 |
| **定时任务系统** | 支持 interval/once/cron 三种定时任务类型 |
| **插件系统** | 可扩展的插件架构，支持生命周期钩子 |
| **流式输出** | StreamingManager 支持多渠道流式消息推送 |
| **容器隔离** | Docker 容器运行 Agent，支持沙箱模式 |
| **统一网关** | Gateway 提供 WebSocket 控制平面 |
| **现代化 Web UI** | Vue 3 + TinyVue + Tailwind CSS |
| **混合认证** | 本地认证 + OAuth (GitHub/Google/微信/QQ/企业微信) |
| **自动化能力** | 文件操作、浏览器控制、Shell 命令 |

---

## 技术栈

| 层级 | 技术 | 版本 |
|------|------|------|
| 运行时 | Node.js | 22+ |
| 语言 | TypeScript | 5.7+ (严格模式) |
| AI 核心 | Provider 抽象层 | - |
| Web 框架 | Vue 3 + Vite | 6.x |
| UI 组件 | TinyVue | 3.20+ |
| 样式 | Tailwind CSS | 3.4+ |
| 认证 | Passport.js | 0.7.x |
| ORM | Prisma | 6.x |
| 数据库 | SQLite/MySQL/PostgreSQL | 可切换 |
| 缓存 | Memory / Redis (ioredis) | 可选 |
| 浏览器控制 | Puppeteer | latest |
| 包管理 | pnpm | 9.x |
| 构建 | tsup | 8.x |
| 测试 | Vitest | 2.x |

---

## 项目结构

```
SaCode/
├── packages/
│   ├── core/           # 核心引擎
│   │   ├── client/     # iFlow SDK 客户端封装
│   │   ├── session/    # 会话管理 + 跨渠道映射
│   │   ├── router/     # 消息路由 + SmartRouter
│   │   ├── model/      # 模型管理器
│   │   ├── cache/      # 缓存层 (Memory + Redis)
│   │   ├── scheduler/  # 定时任务调度器
│   │   ├── task/       # 长任务管理器
│   │   ├── mcp/        # MCP 协议实现
│   │   ├── streaming/  # 流式输出管理
│   │   ├── plugin/     # 插件系统
│   │   ├── skills/     # Skills 加载器
│   │   ├── memory/     # 内存管理 + 向量嵌入
│   │   ├── security/   # 安全管理
│   │   ├── workspace/  # 工作区管理
│   │   ├── queue/      # 消息队列
│   │   └── types/      # 类型定义
│   │
│   ├── gateway/        # 统一控制平面
│   │   ├── protocol/   # Gateway 协议
│   │   ├── handlers/   # 消息处理器
│   │   └── session/    # Gateway 会话
│   │
│   ├── container/      # 容器隔离
│   │   └── Docker 容器运行 Agent
│   │
│   ├── adapters/       # IM 适配器 (10 个平台)
│   │   ├── wechat.ts   # 微信 (WebSocket)
│   │   ├── qq.ts       # QQ (OneBot 协议)
│   │   ├── telegram.ts # Telegram Bot API
│   │   ├── discord.ts  # Discord Gateway
│   │   ├── dingtalk.ts # 钉钉 (REST API + AI Card 流式)
│   │   ├── feishu.ts   # 飞书 (Open API)
│   │   ├── xiaoyi.ts   # 华为小艺 (AK/SK + WebSocket)
│   │   ├── whatsapp.ts # WhatsApp (baileys 桥接)
│   │   ├── slack.ts    # Slack Web API
│   │   └── email.ts    # Email (IMAP + SMTP)
│   │
│   ├── database/       # 数据库层 - Prisma ORM
│   │   └── prisma/
│   │       └── schema.prisma  # 数据模型定义
│   │
│   ├── auth/           # 认证模块
│   │   ├── local/      # 本地认证 (bcrypt + JWT)
│   │   ├── oauth/      # OAuth 提供商
│   │   │   ├── github.ts   # GitHub OAuth
│   │   │   ├── google.ts   # Google OAuth
│   │   │   ├── wechat.ts   # 微信 OAuth
│   │   │   ├── qq.ts       # QQ OAuth
│   │   │   └── wework.ts   # 企业微信 OAuth
│   │   └── middleware/ # 认证中间件
│   │
│   ├── cli/            # 命令行工具 - Commander.js
│   ├── capabilities/   # 自动化能力 - 文件/浏览器/Shell
│   ├── api/            # REST API + WebSocket - Express
│   │   └── routes/     # API 路由
│   │       ├── auth.ts     # 认证端点 + OAuth
│   │       ├── chat.ts     # 聊天端点
│   │       ├── im.ts       # IM 管理
│   │       ├── im-chat.ts  # IM 聊天端点
│   │       ├── tasks.ts    # 长任务 API
│   │       ├── routing.ts  # 智能路由 API
│   │       ├── memory.ts   # 内存管理 API
│   │       ├── models.ts   # 模型管理 API
│   │       ├── media.ts    # 媒体处理 API
│   │       ├── capabilities.ts  # 能力端点
│   │       └── plugins.ts  # 插件端点
│   │
│   └── web/            # Web UI - Vue 3 + TinyVue
│       └── src/
│           ├── views/          # 页面
│           │   ├── Chat.vue        # 聊天界面 (流式)
│           │   ├── IM.vue          # IM 平台管理
│           │   ├── Login.vue       # 登录页面 (支持 OAuth)
│           │   ├── Settings.vue    # 设置页面
│           │   ├── Dashboard.vue   # 仪表盘
│           │   └── AuthCallback.vue # OAuth 回调处理
│           ├── components/     # 组件
│           │   └── MessageRenderer.vue  # Markdown 渲染
│           └── lib/            # 工具库
│               ├── api.ts          # API 客户端
│               └── websocket.ts    # WebSocket 客户端
│
├── .sacode/            # SaCode 配置
│   ├── commands/       # Slash 命令
│   ├── plugins/        # 插件目录
│   │   └── xiaoyi/     # 华为小艺插件示例
│   └── skills/         # Skills 目录
│       ├── setup/      # 项目初始化技能
│       ├── add-telegram/   # 添加 Telegram 适配器
│       ├── add-wechat/     # 添加微信适配器
│       └── customize/      # 自定义配置
│
├── docs/               # 文档
│   ├── PRD.md          # 产品需求文档
│   ├── test-cases.md   # 测试用例文档
│   ├── architecture/   # 架构文档
│   ├── api/            # API 文档
│   ├── database/       # 数据库文档
│   └── guides/         # 指南文档
│
├── javisk/             # PCIV 工作流模板
├── package.json        # 根配置
├── pnpm-workspace.yaml # 工作区配置
├── tsconfig.base.json  # 共享 TS 配置
└── vitest.config.ts    # 测试配置
```

---

## 包详情

### @sacode/core

**核心引擎** - Provider SDK 封装、会话管理、路由、任务、MCP 协议、缓存

```typescript
import {
  SaCodeClient,
  SessionManager,
  SessionMapper,
  MessageRouter,
  SmartRouter,
  LongTaskManager,
  TaskScheduler,
  PluginManager,
  StreamingManager,
  MCPServer,
  MCPClient,
  MemoryManager,
  SecurityManager,
  WorkspaceManager,
  ModelManager,
  CacheManager,
  GroupQueue,
} from "@sacode/core";

// 创建客户端
const client = new SaCodeClient({
  providerType: "openai",
  apiKey: process.env.OPENAI_API_KEY,
  baseUrl: process.env.OPENAI_BASE_URL,
  autoStart: true,
  timeout: 60000,
});

// 跨渠道会话映射
const mapper = new SessionMapper();
const sessionId = mapper.createMapping("telegram", "chat_123");

// 智能路由
const router = new SmartRouter();
router.addRule({
  id: "rule-1",
  name: "VIP 优先",
  priority: 100,
  enabled: true,
  conditions: [{ field: "user.tier", operator: "eq", value: "vip" }],
  actions: [{ type: "route", channel: "premium-support" }],
});

// 长任务管理
const taskManager = new LongTaskManager();
taskManager.registerTaskType("analysis", {
  name: "Data Analysis",
  priority: "high",
  totalSteps: 3,
  tags: ["data", "analysis"],
}, async (task, context) => {
  await context.reportProgress(33, "Step 1/3");
  // ... 执行任务
  return { result: "completed" };
});

// 模型管理
const modelManager = new ModelManager({
  models: [
    { id: "gpt-4", provider: "openai", capabilities: ["chat", "code"] },
    { id: "claude-3", provider: "anthropic", capabilities: ["chat", "analysis"] },
  ],
  strategy: "capability-match",
});

// 缓存管理
const cache = new CacheManager({
  backend: "memory",
  defaultTTL: 60000, // 1 分钟
});
const value = await cache.getOrSet("user:123", async () => fetchUser(123));

// MCP Server
const mcpServer = new MCPServer({
  name: "sacode-mcp",
  version: "1.0.0",
});
mcpServer.registerTool({
  name: "read_file",
  description: "Read a file",
  inputSchema: { type: "object", properties: { path: { type: "string" } } },
}, async (args) => ({ content: [{ type: "text", text: "file content" }] }));

// 流式输出
const streaming = new StreamingManager();
streaming.registerSender("telegram", async (chunk) => {
  // 发送到 Telegram
});

// 定时任务
const scheduler = new TaskScheduler();
scheduler.addTask({
  name: "早间提醒",
  type: "cron",
  config: { cronExpression: "0 9 * * *" },
  message: "早上好！",
  channel: "xiaoyi",
  chatId: "user_123",
});
```

**导出内容：**

| 模块 | 说明 |
|------|------|
| `SaCodeClient` | Provider 客户端封装 |
| `SessionManager` | 会话管理器 |
| `SessionMapper` | 跨渠道会话映射 |
| `MessageRouter` | 消息路由器 |
| `SmartRouter` | 智能路由引擎 |
| `LongTaskManager` | 长任务管理器 |
| `TaskScheduler` | 定时任务调度器 |
| `PluginManager` | 插件管理器 |
| `StreamingManager` | 流式输出管理器 |
| `MCPServer` | MCP 服务端 |
| `MCPClient` | MCP 客户端 |
| `MemoryManager` | 内存管理器 |
| `SecurityManager` | 安全管理器 |
| `WorkspaceManager` | 工作区管理器 |
| `ModelManager` | 模型管理器 |
| `CacheManager` | 缓存管理器 |
| `GroupQueue` | 群组消息队列 |

---

### @sacode/gateway

**统一控制平面** - WebSocket 网关，提供统一的连接管理

```typescript
import { GatewayServer } from "@sacode/gateway";

const gateway = new GatewayServer({
  port: 8080,
  auth: {
    enabled: true,
    validateToken: async (token) => {
      // 验证 token
      return { userId: "user-1" };
    },
  },
});

gateway.start();
```

---

### @sacode/container

**容器隔离** - Docker 容器运行 Agent，支持沙箱模式

```typescript
import { ContainerManager } from "@sacode/container";

const container = new ContainerManager({
  image: "sacode-agent:latest",
  sandbox: true,
  resourceLimits: {
    cpu: "1.0",
    memory: "512m",
  },
});

await container.start();
```

---

### @sacode/adapters

**IM 适配器** - 10 个平台支持，完整的连接/发送/频道获取能力

```typescript
import {
  createAdapter,
  IMAdapterManager,
  WechatAdapter,
  QQAdapter,
  TelegramAdapter,
  DiscordAdapter,
  DingTalkAdapter,
  FeishuAdapter,
  XiaoyiAdapter,
  WhatsAppAdapter,
  SlackAdapter,
  EmailAdapter,
} from "@sacode/adapters";

// 使用工厂创建适配器
const adapter = createAdapter({
  platform: "telegram",
  config: { botToken: "YOUR_TOKEN" },
});

// 连接并获取频道列表
await adapter.connect();
const channels = await adapter.getChannels();

// 或使用管理器
const manager = new IMAdapterManager();
await manager.connect("telegram", { botToken: "YOUR_TOKEN" });
```

**支持的平台：**

| 平台 | 适配器 | 技术方案 | getChannels |
|------|--------|----------|-------------|
| 微信 | `WechatAdapter` | WebSocket | ✓ 联系人列表 |
| QQ | `QQAdapter` | OneBot 协议 | ✓ 群列表 |
| Telegram | `TelegramAdapter` | Bot API | ✓ 聊天列表 |
| Discord | `DiscordAdapter` | Gateway + REST | ✓ Guilds + Channels |
| 钉钉 | `DingTalkAdapter` | REST API | ✓ 群列表 + 部门 |
| 飞书 | `FeishuAdapter` | Open API | ✓ |
| 小艺 | `XiaoyiAdapter` | AK/SK + WebSocket | ✓ |
| WhatsApp | `WhatsAppAdapter` | baileys 桥接 | ✓ |
| Slack | `SlackAdapter` | Web API | ✓ |
| Email | `EmailAdapter` | IMAP + SMTP | ✓ 邮箱文件夹 |

**钉钉适配器 - AI Card 流式输出：**

```typescript
const dingtalk = new DingTalkAdapter({
  appKey: "YOUR_APP_KEY",
  appSecret: "YOUR_APP_SECRET",
  robotCode: "YOUR_ROBOT_CODE",
  cardTemplateId: "YOUR_TEMPLATE_ID",
  streamingEnabled: true,
});

// 流式发送
const messageId = await dingtalk.sendInitial(chatId, "正在思考...");
await dingtalk.editMessage(chatId, messageId, "这是更新后的内容...");
```

---

### @saclaw/auth

**认证模块** - 混合认证系统

```typescript
import {
  LocalAuthService,
  createAuthMiddleware,
  GitHubOAuthService,
  GoogleOAuthService,
  WeChatOAuthService,
  QQOAuthService,
  WeWorkOAuthService,
  type UserWithPassword,
} from "@saclaw/auth";

// 本地认证服务
const authService = new LocalAuthService({
  config: { jwt: { secret: "secret", expiresIn: "7d" }, ... },
  getUserWithPassword: async (usernameOrEmail) => {
    // 返回包含密码的用户信息
    return await db.user.findFirst({
      where: { OR: [{ username: usernameOrEmail }, { email: usernameOrEmail }] },
    });
  },
  createUser: async (input) => { /* ... */ },
  createSession: async (userId, token, expiresAt) => { /* ... */ },
});

// 登录验证
const result = await authService.login("username", "password");
if (result.success) {
  console.log(result.token, result.user);
}

// 认证中间件
const authMiddleware = createAuthMiddleware({
  getTokenFromHeader: (req) => req.headers.authorization?.replace("Bearer ", ""),
  verifyToken: (token) => authService.verifyToken(token),
  getUserById: async (id) => { /* ... */ },
});
```

**OAuth 提供商：**

| 提供商 | 服务类 | 配置项 |
|--------|--------|--------|
| GitHub | `GitHubOAuthService` | `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` |
| Google | `GoogleOAuthService` | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` |
| 微信 | `WeChatOAuthService` | `WECHAT_APP_ID`, `WECHAT_APP_SECRET` |
| QQ | `QQOAuthService` | `QQ_APP_ID`, `QQ_APP_KEY` |
| 企业微信 | `WeWorkOAuthService` | `WEWORK_CORP_ID`, `WEWORK_AGENT_ID`, `WEWORK_SECRET` |

---

### @sacode/database

**数据库层** - Prisma ORM + 多数据库适配

```typescript
import { createDatabase, getPrismaClient } from "@sacode/database";

// 初始化数据库
await createDatabase({
  type: "sqlite", // sqlite | mysql | postgres
  path: "./data/sacode.db",
});

// 使用 Prisma Client
const prisma = getPrismaClient();
const users = await prisma.user.findMany();
```

**数据模型：**

| 模型 | 说明 |
|------|------|
| `User` | 用户表 (支持本地 + OAuth) |
| `Session` | 登录会话 |
| `ChatSession` | 聊天会话 |
| `ChatMessage` | 聊天消息 |
| `IMConnection` | IM 连接配置 |
| `Plugin` | 插件 |
| `SystemConfig` | 系统配置 |
| `CronTask` | 定时任务 |
| `SessionMapping` | 跨渠道会话映射 |

---

### @sacode/api

**API 服务** - REST API + WebSocket

**API 端点：**

| 路由 | 方法 | 功能 |
|------|------|------|
| `/api/auth/register` | POST | 用户注册 |
| `/api/auth/login` | POST | 用户登录 |
| `/api/auth/logout` | POST | 登出 |
| `/api/auth/me` | GET | 获取当前用户 |
| `/api/auth/oauth/:provider` | GET | OAuth 跳转 |
| `/api/auth/oauth/:provider/callback` | GET | OAuth 回调 |
| `/api/chat` | POST | 发送消息 |
| `/api/chat/sessions` | GET | 会话列表 |
| `/api/chat/sessions/:id` | GET/PATCH/DELETE | 会话 CRUD |
| `/api/tasks` | GET/POST | 任务列表/创建 |
| `/api/tasks/:id/start` | POST | 启动任务 |
| `/api/tasks/:id/pause` | POST | 暂停任务 |
| `/api/tasks/:id/cancel` | POST | 取消任务 |
| `/api/routing/rules` | GET/POST | 路由规则管理 |
| `/api/routing/evaluate` | POST | 评估路由 |
| `/api/models` | GET | 模型列表 |
| `/api/memory` | GET/POST | 内存管理 |
| `/api/media` | POST | 媒体处理 |
| `/api/im` | GET | IM 连接列表 |
| `/api/im/:id/connect` | POST | 连接 IM 平台 |
| `/api/im/:id/disconnect` | POST | 断开连接 |
| `/api/capabilities` | GET | 能力列表 |
| `/api/plugins` | GET | 插件列表 |
| `/ws` | WebSocket | 实时通信 |

---

### @sacode/web

**Web UI** - Vue 3 + TinyVue + Tailwind CSS

**页面结构：**

| 路由 | 页面 | 功能 |
|------|------|------|
| `/login` | Login.vue | 登录页面 + OAuth 按钮 |
| `/auth/callback` | AuthCallback.vue | OAuth 回调处理 |
| `/dashboard` | Dashboard.vue | 仪表盘 |
| `/dashboard/chat` | Chat.vue | 聊天界面 (流式支持) |
| `/dashboard/im` | IM.vue | IM 平台管理 |
| `/dashboard/settings` | Settings.vue | 设置页面 |

**组件：**

| 组件 | 说明 |
|------|------|
| `MessageRenderer.vue` | Markdown 渲染，支持代码高亮 |
| `DashboardLayout.vue` | 仪表盘布局 |

**工具库：**

| 模块 | 说明 |
|------|------|
| `api.ts` | REST API 客户端封装 |
| `websocket.ts` | WebSocket 客户端，支持流式聊天、重连、心跳 |

---

## 常用命令

### 开发

```bash
pnpm install          # 安装依赖
pnpm dev              # 开发所有包
pnpm build            # 构建所有包
pnpm test             # 运行测试
pnpm lint             # 代码检查
pnpm typecheck        # 类型检查
pnpm format           # 格式化代码
```

### 启动服务

```bash
pnpm api              # 启动 API 服务
pnpm web              # 启动 Web UI
pnpm cli              # 启动 CLI
```

### 数据库

```bash
pnpm -C packages/database prisma generate  # 生成 Prisma Client
pnpm -C packages/database prisma db push   # 推送数据库结构
pnpm -C packages/database prisma migrate dev  # 创建迁移
```

### Docker

```bash
pnpm docker:build     # 构建 Docker 镜像
pnpm docker:up        # 启动 Docker Compose
pnpm docker:down      # 停止 Docker Compose
pnpm docker:dev       # 开发模式 Docker
```

---

## 环境变量

```env
# Server
PORT=3000
HOST=localhost

# Provider
PROVIDER_TYPE=openai
OPENAI_API_KEY=
OPENAI_BASE_URL=
ANTHROPIC_API_KEY=
DEEPSEEK_API_KEY=
MOONSHOT_API_KEY=
ZHIPU_API_KEY=

# Database
DATABASE_TYPE=sqlite
DATABASE_PATH=./data/sacode.db

# Auth - Local
AUTH_LOCAL_ENABLED=true
JWT_SECRET=your-jwt-secret

# OAuth - GitHub
GITHUB_CLIENT_ID=
GITHUB_CLIENT_SECRET=

# OAuth - Google
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=

# OAuth - 微信
WECHAT_APP_ID=
WECHAT_APP_SECRET=

# OAuth - QQ
QQ_APP_ID=
QQ_APP_KEY=

# OAuth - 企业微信
WEWORK_CORP_ID=
WEWORK_AGENT_ID=
WEWORK_SECRET=

# IM - Telegram
TELEGRAM_BOT_TOKEN=

# IM - Discord
DISCORD_BOT_TOKEN=

# IM - Xiaoyi (华为小艺)
XIAOYI_AK=
XIAOYI_SK=
XIAOYI_AGENT_ID=

# IM - 钉钉
DINGTALK_APP_KEY=
DINGTALK_APP_SECRET=

# Session
SESSION_SECRET=your-session-secret

# Capabilities
CAP_FILES_ENABLED=true
CAP_BROWSER_ENABLED=true
CAP_BROWSER_HEADLESS=true
CAP_SHELL_ENABLED=true

# Frontend
FRONTEND_URL=http://localhost:5173
BASE_URL=http://localhost:3000
```

---

## 开发规范

### TypeScript 配置

项目使用严格模式 (`tsconfig.base.json`)：

- `strict: true`
- `noUnusedLocals: true`
- `noUnusedParameters: true`
- `noFallthroughCasesInSwitch: true`
- `noUncheckedIndexedAccess: true`
- `exactOptionalPropertyTypes: true`
- `noImplicitReturns: true`
- `noImplicitOverride: true`

### 命名约定

| 类型 | 约定 | 示例 |
|------|------|------|
| 文件/目录 | kebab-case | `session-mapper.ts` |
| 组件 | PascalCase | `ChatPanel.vue` |
| 变量/函数 | camelCase | `getSessionId` |
| 常量 | UPPER_SNAKE_CASE | `DEFAULT_TIMEOUT` |
| 接口/类型 | PascalCase | `SessionMappingEntry` |

### 包依赖关系

```
@sacode/types       (无内部依赖 - 共享类型定义)
    ↓
@sacode/container  (无内部依赖)
    ↓
@sacode/core       (依赖 types, container)
    ↓
@sacode/database   (无内部依赖)
    ↓
@sacode/auth       (依赖 database)
    ↓
@sacode/capabilities (无内部依赖)
    ↓
@sacode/adapters   (依赖 types)
    ↓
@sacode/gateway    (依赖 auth, core, database)
    ↓
@sacode/api        (依赖 adapters, auth, core, database, capabilities)
    ↓
@sacode/web        (依赖 api, auth, core)
@sacode/cli        (依赖 core)
```

---

## 架构图

### 消息流

```
IM 平台 → Adapter → SessionMapper → SaCodeClient → Provider → AI 模型
                              ↓
                         SmartRouter
                              ↓
                    LongTaskManager (可选)
                              ↓
                    StreamingManager
                              ↓
                        PluginSystem (可选)
                              ↓
                      Capabilities (可选)
                              ↓
                         输出到用户
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
Router/Task/MCP
```

### 认证流程

```
用户 → Login.vue → /api/auth/login → LocalAuthService.login
                                              ↓
                                    bcrypt 验证密码
                                              ↓
                                    JWT Token 生成
                                              ↓
                                    返回 token + user

OAuth 流程:
用户 → OAuth 按钮 → /api/auth/oauth/:provider → 重定向到 OAuth 提供商
                                                          ↓
                                                    用户授权
                                                          ↓
                                    /api/auth/oauth/:provider/callback
                                              ↓
                                    创建/查找用户 → 生成 Token
                                              ↓
                                    重定向到 /auth/callback?token=xxx
```

---

## 测试

**测试文件：**

| 文件 | 说明 |
|------|------|
| `packages/core/src/__tests__/index.test.ts` | 核心模块测试 |
| `packages/core/src/__tests__/integration.test.ts` | 集成测试 |
| `packages/core/src/router/__tests__/smart-router.test.ts` | 智能路由测试 |
| `packages/core/src/task/__tests__/long-task.test.ts` | 长任务测试 |
| `packages/core/src/mcp/__tests__/protocol.test.ts` | MCP 协议测试 |
| `packages/core/src/scheduler/__tests__/scheduler.test.ts` | 定时任务测试 |
| `packages/core/src/queue/__tests__/group-queue.test.ts` | 队列测试 |
| `packages/auth/src/__tests__/local.test.ts` | 本地认证测试 |
| `packages/adapters/src/__tests__/index.test.ts` | 适配器测试 |
| `packages/capabilities/src/__tests__/index.test.ts` | 能力测试 |

```bash
pnpm test             # 运行所有测试
pnpm test:watch       # 监视模式
pnpm test:coverage    # 测试覆盖率
```

**测试统计：**

| 模块 | 测试用例数 |
|------|-----------|
| SmartRouter | 18 |
| MCP Protocol | 22 |
| Scheduler | 19 |
| LongTaskManager | 17 |
| GroupQueue | 10 |
| Adapters | 25 |
| Auth | 14 |
| Integration | 14 |
| Core | 8 |
| Capabilities | 4 |
| **总计** | **151** |

---

## 许可证

MulanPSL-2.0

---

## 作者

**STAND-ALONE**
- Email: 1635936133@qq.com
- GitHub: [@STAND-ALONE](https://github.com/STAND-ALONE)

---

*最后更新: 2026-04-01*