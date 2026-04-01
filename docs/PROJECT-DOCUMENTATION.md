# SaCode 项目完整文档

> 版本：1.0.0  
> 日期：2026-04-01  
> 许可证：MulanPSL-2.0  
> 作者：STAND-ALONE

---

## 目录

1. [项目概述](#一项目概述)
2. [设计构思](#二设计构思)
3. [技术架构](#三技术架构)
4. [核心模块设计](#四核心模块设计)
5. [数据库设计](#五数据库设计)
6. [API 设计](#六 api 设计)
7. [安全设计](#七安全设计)
8. [部署方案](#八部署方案)
9. [开发指南](#九开发指南)
10. [项目统计](#十项目统计)

---

## 一、项目概述

### 1.1 产品定位

**SaCode** 是一个基于 Provider 抽象层的多端 AI 助手框架，提供：
- 多 AI 后端支持（OpenAI、Anthropic、DeepSeek、Moonshot、智谱）
- 多渠道 IM 集成（微信、QQ、Telegram、Discord 等 10 个平台）
- 企业级功能（认证、缓存、长任务管理、智能路由）
- 现代化 Web UI（Vue 3 + TinyVue）
- 完整的 API 和 CLI 工具

### 1.2 核心价值

| 价值 | 说明 |
|------|------|
| **统一接口** | 一次开发，多端部署 |
| **灵活扩展** | Provider 抽象层支持任意 AI 后端 |
| **企业就绪** | 认证、缓存、任务管理、审计日志 |
| **开源免费** | MulanPSL-2.0 许可证，无厂商锁定 |

### 1.3 目标用户

- **个人开发者**：本地 AI 助手，支持代码编写、问题解答
- **企业用户**：多渠道客服机器人，统一管理客户对话
- **团队协作**：IM 集成的 AI 工具，提升工作效率

### 1.4 技术栈

| 层级 | 技术 | 版本 |
|------|------|------|
| 运行时 | Node.js | 22+ |
| 语言 | TypeScript | 5.7+ (严格模式) |
| 包管理 | pnpm | 9.15.0 |
| Web 框架 | Vue 3 | 3.5+ |
| UI 组件 | TinyVue | 3.20+ |
| API 框架 | Express | 5.0+ |
| ORM | Prisma | 6.x |
| 数据库 | SQLite/MySQL/PostgreSQL | - |
| 缓存 | Memory/Redis | - |
| 测试 | Vitest | 2.x |

---

## 二、设计构思

### 2.1 设计原则

1. **抽象优先**：通过 Provider 抽象层隔离 AI 后端差异
2. **模块化**：每个包职责单一，可独立使用和替换
3. **类型安全**：TypeScript 严格模式，完整的类型定义
4. **可扩展**：插件系统、Skills 系统、MCP 协议
5. **测试驱动**：174+ 单元测试，保证代码质量

### 2.2 架构演进

```
V1.0 (初始版本)
├── 基础 Provider 抽象
├── 简单会话管理
└── 单渠道支持

V2.0 (当前版本)
├── 5 个 AI Provider
├── 10 个 IM 适配器
├── 企业级功能（认证、缓存、任务）
├── Web UI + CLI
└── MCP 协议支持

未来规划
├── 更多 AI Provider
├── 可视化流程编排
├── 多 Agent 协作
└── 云端部署支持
```

### 2.3 关键决策

| 决策 | 选择 | 理由 |
|------|------|------|
| 语言 | TypeScript | 类型安全、生态完善 |
| 包管理 | pnpm | 快速、节省磁盘空间 |
| 数据库 | SQLite (默认) | 零配置、易部署 |
| ORM | Prisma | 类型安全、迁移工具完善 |
| Web 框架 | Vue 3 | 学习曲线平缓、生态丰富 |
| API 框架 | Express | 成熟稳定、中间件丰富 |

---

## 三、技术架构

### 3.1 分层架构

```
┌─────────────────────────────────────────────────────────────────┐
│                      交互层 (Interface Layer)                    │
│    ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐      │
│    │   CLI    │  │  Web UI  │  │    IM    │  │   API    │      │
│    │(Commander)│  │ (Vue 3)  │  │(Adapters)│  │ (Express)│      │
│    └────┬─────┘  └────┬─────┘  └────┬─────┘  └────┬─────┘      │
└─────────┼─────────────┼─────────────┼─────────────┼─────────────┘
          │             │             │             │
          └─────────────┴─────────────┴─────────────┘
                              │
┌─────────────────────────────┴───────────────────────────────────┐
│                      核心层 (Core Layer)                         │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐              │
│  │  Provider   │  │   Session   │  │    Router   │              │
│  │  Abstraction│  │   Manager   │  │   (Smart)   │              │
│  └─────────────┘  └─────────────┘  └─────────────┘              │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐              │
│  │ TaskManager │  │   Plugin    │  │   Streaming │              │
│  │   (Long)    │  │   Manager   │  │   Manager   │              │
│  └─────────────┘  └─────────────┘  └─────────────┘              │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐              │
│  │     MCP     │  │   Cache     │  │   Model     │              │
│  │  Protocol   │  │   Manager   │  │   Manager   │              │
│  └─────────────┘  └─────────────┘  └─────────────┘              │
└──────────────────────────────────────────────────────────────────┘
                              │
┌─────────────────────────────┴───────────────────────────────────┐
│                    能力层 (Capability Layer)                     │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐        │
│  │  Files   │  │ Browser  │  │  Shell   │  │  Custom  │        │
│  │ System   │  │(Puppeteer)│  │ Commands │  │ Plugins │        │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘        │
└──────────────────────────────────────────────────────────────────┘
                              │
┌─────────────────────────────┴───────────────────────────────────┐
│                      存储层 (Storage Layer)                      │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐        │
│  │ Database │  │  Cache   │  │  Config  │  │   Logs   │        │
│  │ (Prisma) │  │(Mem/Redis)│  │  (JSON)  │  │  (File)  │        │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘        │
└──────────────────────────────────────────────────────────────────┘
```

### 3.2 包结构

```
SaCode/
├── packages/
│   ├── core/              # 核心引擎
│   │   ├── provider/      # AI Provider 抽象层
│   │   ├── client/        # SaCodeClient 封装
│   │   ├── tools/         # 工具桥接层
│   │   ├── agent/         # Agent 基础设施
│   │   ├── session/       # 会话管理
│   │   ├── router/        # 消息路由
│   │   ├── model/         # 模型管理
│   │   ├── cache/         # 缓存层
│   │   ├── scheduler/     # 定时任务
│   │   ├── task/          # 长任务管理
│   │   ├── mcp/           # MCP 协议
│   │   ├── streaming/     # 流式输出
│   │   ├── plugin/        # 插件系统
│   │   ├── memory/        # 内存管理
│   │   ├── security/      # 安全管理
│   │   ├── workspace/     # 工作区管理
│   │   └── queue/         # 消息队列
│   │
│   ├── adapters/          # IM 适配器 (10 个平台)
│   ├── api/               # REST API + WebSocket
│   ├── auth/              # 认证模块 (本地 + OAuth)
│   ├── capabilities/      # 自动化能力
│   ├── cli/               # 命令行工具
│   ├── container/         # Docker 容器隔离
│   ├── database/          # 数据库层 (Prisma)
│   ├── gateway/           # 统一网关
│   ├── types/             # 共享类型定义
│   ├── web/               # Web UI (Vue 3)
│   ├── integrations/      # GitHub/GitLab 集成
│   ├── marketplace/       # 市场发布工具
│   └── vscode-extension/  # VS Code 扩展
│
├── config/                # 配置文件
├── docker/                # Docker 配置
├── docs/                  # 文档
└── tests/                 # E2E 测试
```

### 3.3 依赖关系

```
@sacode/types (基础类型)
    ↓
@sacode/container (容器隔离)
    ↓
@sacode/core (核心引擎)
    ↓
@sacode/database (数据库)
    ↓
@sacode/auth (认证)
    ↓
@sacode/adapters (IM 适配器)
    ↓
@sacode/api (API 服务)
    ↓
@sacode/web (Web UI)
```

---

## 四、核心模块设计

### 4.1 Provider 抽象层

#### 接口定义

```typescript
interface AIProvider {
  readonly type: ProviderType;
  readonly model: string;
  readonly isInitialized: boolean;
  
  initialize(): Promise<void>;
  chat(options: ChatOptions): AsyncGenerator<StreamChunk>;
  executeToolCall?(toolCall: ToolCall): Promise<ToolCallResult>;
  registerTool(tool: Tool, handler: ToolHandler): void;
  destroy(): Promise<void>;
}
```

#### 支持的 Provider

| Provider | 类型 | 默认模型 | 特性 |
|----------|------|----------|------|
| OpenAI | `openai` | gpt-4o | Streaming, Tools, Vision |
| Anthropic | `anthropic` | claude-3-5-sonnet | Streaming, Tool Use, Vision |
| DeepSeek | `deepseek` | deepseek-chat | Streaming, Tools |
| Moonshot | `moonshot` | moonshot-v1-8k | Streaming, Tools |
| 智谱 | `zhipu` | glm-4-plus | Streaming, Tools |

#### 使用示例

```typescript
import { createProvider } from "@sacode/core";

const provider = createProvider({
  type: "openai",
  apiKey: process.env.OPENAI_API_KEY,
  model: "gpt-4o",
});

await provider.initialize();

for await (const chunk of provider.chat({
  messages: [{ role: "user", content: "Hello" }],
  stream: true,
})) {
  console.log(chunk.text);
}
```

### 4.2 会话管理

#### SessionManager

```typescript
class SessionManager {
  createSession(userId: string, channelId: string): Session;
  getSession(sessionId: string): Session | null;
  addMessage(sessionId: string, message: Message): void;
  getHistory(sessionId: string): Message[];
  deleteSession(sessionId: string): void;
}
```

#### SessionMapper (跨渠道映射)

```typescript
class SessionMapper {
  createMapping(platform: string, channelId: string): string;
  getMapping(sessionId: string): { platform, channelId };
  getSessionId(platform: string, channelId: string): string;
}
```

### 4.3 智能路由 (SmartRouter)

```typescript
class SmartRouter {
  addRule(rule: RoutingRule): void;
  removeRule(ruleId: string): void;
  evaluate(message: Message, context: Context): RoutingAction[];
}

interface RoutingRule {
  id: string;
  name: string;
  priority: number;
  enabled: boolean;
  conditions: Condition[];
  actions: Action[];
}
```

### 4.4 长任务管理 (LongTaskManager)

```typescript
class LongTaskManager {
  registerTaskType(type: string, config: TaskTypeConfig, handler: TaskHandler): void;
  startTask(taskId: string, type: string, input: unknown): Promise<TaskResult>;
  pauseTask(taskId: string): void;
  resumeTask(taskId: string): void;
  cancelTask(taskId: string): void;
  getTaskStatus(taskId: string): TaskStatus;
}
```

### 4.5 缓存系统 (CacheManager)

```typescript
class CacheManager {
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T, ttl?: number): Promise<void>;
  delete(key: string): Promise<void>;
  getOrSet<T>(key: string, factory: () => Promise<T>, ttl?: number): Promise<T>;
  clear(): Promise<void>;
}
```

### 4.6 MCP 协议

```typescript
class MCPServer {
  registerTool(tool: ToolDefinition, handler: ToolHandler): void;
  registerResource(resource: ResourceDefinition, handler: ResourceHandler): void;
  start(): Promise<void>;
  stop(): Promise<void>;
}

class MCPClient {
  connect(serverUrl: string): Promise<void>;
  callTool(name: string, args: unknown): Promise<ToolResult>;
  getResource(uri: string): Promise<Resource>;
  disconnect(): Promise<void>;
}
```

---

## 五、数据库设计

### 5.1 ER 图

```
┌─────────────┐       ┌─────────────┐
│    User     │       │   Session   │
├─────────────┤       ├─────────────┤
│ id          │◄──────│ userId      │
│ username    │       │ token       │
│ password    │       │ expiresAt   │
│ email       │       └─────────────┘
│ oauthProvider│      
│ oauthId     │       ┌─────────────┐
└─────────────┘       │ChatSession  │
       │              ├─────────────┤
       │              │ id          │
       │              │ userId      │
       │              │ channelId   │
       │              │ platform    │
       │              │ modelId     │
       │              │ memory      │
       │              └─────────────┘
       │                     │
       │                     │
       │              ┌─────────────┐
       └─────────────►│ChatMessage  │
                      ├─────────────┤
                      │ id          │
                      │ sessionId   │
                      │ role        │
                      │ content     │
                      │ tokenCount  │
                      └─────────────┘

┌─────────────┐       ┌─────────────┐
│IMConnection │       │   Plugin    │
├─────────────┤       ├─────────────┤
│ id          │       │ id          │
│ platform    │       │ name        │
│ status      │       │ version     │
│ config      │       │ enabled     │
└─────────────┘       │ config      │
                      └─────────────┘
```

### 5.2 核心表结构

#### User (用户表)

| 字段 | 类型 | 说明 |
|------|------|------|
| id | UUID | 主键 |
| username | String | 用户名（本地认证） |
| password | String | 密码哈希（本地认证） |
| email | String | 邮箱 |
| oauthProvider | String | OAuth 提供商 |
| oauthId | String | OAuth 用户 ID |

#### ChatSession (聊天会话表)

| 字段 | 类型 | 说明 |
|------|------|------|
| id | UUID | 主键 |
| userId | UUID | 用户 ID |
| channelId | String | 渠道 ID |
| platform | String | 平台类型 |
| modelId | String | 使用的模型 |
| memory | String | 会话记忆 |
| context | String | 上下文摘要 (JSON) |

#### ChatMessage (聊天消息表)

| 字段 | 类型 | 说明 |
|------|------|------|
| id | UUID | 主键 |
| sessionId | UUID | 会话 ID |
| role | String | 角色 (user/assistant/system/tool) |
| content | String | 消息内容 |
| contentType | String | 内容类型 |
| tokenCount | Int | Token 数量 |

---

## 六、API 设计

### 6.1 REST API

#### 认证端点

| 方法 | 路径 | 功能 |
|------|------|------|
| POST | `/api/auth/register` | 用户注册 |
| POST | `/api/auth/login` | 用户登录 |
| POST | `/api/auth/logout` | 登出 |
| GET | `/api/auth/me` | 获取当前用户 |
| GET | `/api/auth/oauth/:provider` | OAuth 跳转 |
| GET | `/api/auth/oauth/:provider/callback` | OAuth 回调 |

#### 聊天端点

| 方法 | 路径 | 功能 |
|------|------|------|
| POST | `/api/chat` | 发送消息 |
| GET | `/api/chat/sessions` | 会话列表 |
| GET | `/api/chat/sessions/:id` | 获取会话 |
| PATCH | `/api/chat/sessions/:id` | 更新会话 |
| DELETE | `/api/chat/sessions/:id` | 删除会话 |

#### IM 管理端点

| 方法 | 路径 | 功能 |
|------|------|------|
| GET | `/api/im` | IM 连接列表 |
| POST | `/api/im/:id/connect` | 连接 IM |
| POST | `/api/im/:id/disconnect` | 断开 IM |
| GET | `/api/im/:id/channels` | 获取频道 |

#### 任务端点

| 方法 | 路径 | 功能 |
|------|------|------|
| GET | `/api/tasks` | 任务列表 |
| POST | `/api/tasks` | 创建任务 |
| POST | `/api/tasks/:id/start` | 启动任务 |
| POST | `/api/tasks/:id/pause` | 暂停任务 |
| POST | `/api/tasks/:id/cancel` | 取消任务 |

### 6.2 WebSocket API

```typescript
// 连接
const ws = new WebSocket("ws://localhost:3000/ws");

// 认证
ws.send(JSON.stringify({
  type: "auth",
  token: "jwt-token",
}));

// 发送消息
ws.send(JSON.stringify({
  type: "chat",
  sessionId: "session-id",
  content: "Hello",
}));

// 接收流式响应
ws.onmessage = (event) => {
  const chunk = JSON.parse(event.data);
  console.log(chunk.text);
};
```

---

## 七、安全设计

### 7.1 认证安全

- **密码存储**：bcrypt 哈希（cost=10）
- **Token 生成**：JWT（HS256 算法）
- **Token 过期**：7 天（可配置）
- **OAuth 状态**：CSRF 防护

### 7.2 路径遍历防护

```typescript
private validateFilePath(filePath: string, targetDir: string): string {
  const normalizedPath = path.normalize(filePath);
  
  // 禁止绝对路径
  if (path.isAbsolute(normalizedPath)) {
    throw new SecurityError(`Absolute path not allowed: ${filePath}`);
  }
  
  // 检测路径遍历
  if (normalizedPath.startsWith("..") || normalizedPath.includes(path.sep + "..")) {
    throw new SecurityError(`Path traversal detected: ${filePath}`);
  }
  
  return path.resolve(targetDir, normalizedPath);
}
```

### 7.3 URL 注入防护

```typescript
private validateSlug(slug: string): string {
  // 长度限制
  if (slug.length > 128) {
    throw new SecurityError(`Slug too long`);
  }
  
  // 格式验证
  const validPattern = /^[a-zA-Z0-9_/-]+$/;
  if (!validPattern.test(slug)) {
    throw new SecurityError(`Invalid slug format`);
  }
  
  return slug;
}
```

### 7.4 文件大小限制

```typescript
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const MAX_FILE_COUNT = 100;
const MAX_TOTAL_SIZE = 50 * 1024 * 1024; // 50MB

private async validateFileSize(stream: Readable): Promise<void> {
  let size = 0;
  for await (const chunk of stream) {
    size += chunk.length;
    if (size > MAX_FILE_SIZE) {
      throw new SecurityError(`File too large`);
    }
  }
}
```

---

## 八、部署方案

### 8.1 Docker 部署

```bash
# 构建镜像
docker compose -f docker/docker-compose.yml build

# 启动服务
docker compose -f docker/docker-compose.yml up -d

# 查看日志
docker compose -f docker/docker-compose.yml logs -f
```

### 8.2 环境变量

```env
# Server
PORT=3000
HOST=localhost

# Provider
PROVIDER_TYPE=openai
OPENAI_API_KEY=sk-xxx
OPENAI_BASE_URL=https://api.openai.com/v1

# Database
DATABASE_TYPE=sqlite
DATABASE_PATH=./data/sacode.db

# Auth
JWT_SECRET=your-jwt-secret

# OAuth (可选)
GITHUB_CLIENT_ID=xxx
GITHUB_CLIENT_SECRET=xxx

# IM (可选)
TELEGRAM_BOT_TOKEN=xxx
DISCORD_BOT_TOKEN=xxx
```

### 8.3 生产部署

```bash
# 1. 安装依赖
pnpm install --frozen-lockfile

# 2. 构建项目
pnpm build

# 3. 初始化数据库
pnpm -C packages/database prisma db push

# 4. 启动服务
pnpm api
```

---

## 九、开发指南

### 9.1 开发环境

```bash
# 克隆项目
git clone https://github.com/STAND-ALONE/SaCode.git
cd SaCode

# 安装依赖
pnpm install

# 启动开发服务器
pnpm dev

# 运行测试
pnpm test

# 类型检查
pnpm typecheck

# 代码格式化
pnpm format
```

### 9.2 添加新的 Provider

```typescript
// packages/core/src/provider/custom.ts
import { BaseProvider, streamChunkToMessage } from "./base";

export class CustomProvider extends BaseProvider {
  async chat(options: ChatOptions): AsyncGenerator<StreamChunk> {
    // 实现聊天逻辑
    yield { type: "text", text: "Hello from Custom Provider" };
  }
}

// 注册 Provider
registerProvider("custom", (config) => new CustomProvider(config));
```

### 9.3 添加新的 IM 适配器

```typescript
// packages/adapters/src/custom.ts
import { BaseAdapter } from "./base";

export class CustomAdapter extends BaseAdapter {
  async connect(): Promise<void> {
    // 实现连接逻辑
  }
  
  async send(channelId: string, content: string): Promise<void> {
    // 实现发送逻辑
  }
  
  async getChannels(): Promise<Channel[]> {
    // 实现频道获取逻辑
    return [];
  }
}
```

### 9.4 开发插件

```typescript
// 插件入口
export default {
  name: "my-plugin",
  version: "1.0.0",
  
  async onEnable(config) {
    console.log("Plugin enabled");
  },
  
  async onDisable() {
    console.log("Plugin disabled");
  },
  
  commands: [
    {
      name: "hello",
      description: "Say hello",
      handler: async (args) => {
        return "Hello, World!";
      },
    },
  ],
};
```

---

## 十、项目统计

### 10.1 包统计

| 包名 | 版本 | 大小 | 测试数 |
|------|------|------|--------|
| @sacode/core | 0.2.0 | - | 42 |
| @sacode/adapters | 0.1.0 | - | 25 |
| @sacode/api | 0.1.0 | - | 14 |
| @sacode/auth | 0.1.0 | - | 14 |
| @sacode/capabilities | 0.1.0 | - | 4 |
| @sacode/cli | 0.1.0 | - | - |
| @sacode/container | 0.1.0 | - | - |
| @sacode/database | 0.1.0 | - | - |
| @sacode/gateway | 0.1.0 | - | - |
| @sacode/web | 0.1.0 | - | - |

### 10.2 测试统计

| 模块 | 测试用例数 |
|------|-----------|
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
| **总计** | **174** |

### 10.3 支持平台

| 类别 | 数量 |
|------|------|
| AI Provider | 5 |
| IM 平台 | 10 |
| OAuth 提供商 | 5 |
| 数据库类型 | 3 |
| 缓存后端 | 2 |

---

## 附录

### A. 常见问题

**Q: 如何切换 AI Provider？**

A: 修改环境变量 `PROVIDER_TYPE` 和对应的 API Key。

**Q: 支持哪些数据库？**

A: SQLite（默认）、MySQL、PostgreSQL。

**Q: 如何添加自定义工具？**

A: 通过 `registerTool` API 注册工具处理函数。

### B. 参考资源

- [GitHub 仓库](https://github.com/STAND-ALONE/SaCode)
- [PRD 文档](./PRD.md)
- [架构文档](./architecture/architecture.md)
- [API 文档](./api/)
- [部署指南](./guides/deployment.md)

### C. 许可证

MulanPSL-2.0

---

*文档生成日期：2026-04-01*
