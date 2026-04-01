# Module Design

> SaClaw - Module Overview and Dependencies

---

## 1. Monorepo Structure

```
SaClaw/
├── packages/
│   ├── types/         # Shared Types
│   ├── core/          # Core Engine
│   ├── gateway/       # WebSocket Gateway
│   ├── container/     # Docker Container
│   ├── database/      # Prisma ORM
│   ├── auth/          # Authentication
│   ├── cli/           # CLI Tool
│   ├── capabilities/  # Automation
│   ├── api/           # REST API
│   ├── web/           # Web UI
│   └── adapters/      # IM Adapters
```

---

## 2. Module Overview

### 2.1 @saclaw/types

**Purpose**: Shared type definitions for cross-package usage

**Key Exports**:

| Export | Description |
|--------|-------------|
| `MessageContentType` | Message content type enum |
| `ImageContent` | Image content type |
| `AudioContent` | Audio content type |
| `VideoContent` | Video content type |
| `FileContent` | File content type |
| `LocationContent` | Location content type |
| `StickerContent` | Sticker content type |
| `TextContent` | Text content type |
| `MessageContent` | Union type for all content |
| `Platform` | IM platform enum |
| `IMConfig` | IM configuration |
| `IMMessage` | IM message type |
| `IMAdapter` | IM adapter interface |
| Type guards | `isTextContent`, `isImageContent`, etc. |

**Dependencies**: None (internal)

---

### 2.2 @saclaw/core

**Purpose**: Core engine with provider abstraction, session management, routing

**Key Exports**:

| Export | Description |
|--------|-------------|
| `SaClawClient` | Main client class |
| `createProvider` | Provider factory |
| `SessionManager` | Session management |
| `SmartRouter` | Rule-based routing |
| `LongTaskManager` | Task execution |
| `CacheManager` | Caching layer |
| `MCPServer/Client` | MCP protocol |

**Dependencies**: `@saclaw/types`, `@saclaw/container`

---

### 2.3 @saclaw/gateway

**Purpose**: WebSocket control plane for real-time communication

**Key Exports**:

| Export | Description |
|--------|-------------|
| `GatewayServer` | WebSocket server |
| `GatewaySession` | Session handler |
| `ProtocolHandler` | Message protocol |

**Dependencies**: `@saclaw/core`, `@saclaw/auth`, `@saclaw/database`

---

### 2.4 @saclaw/database

**Purpose**: Database abstraction with Prisma ORM

**Key Exports**:

| Export | Description |
|--------|-------------|
| `createDatabase` | Database initialization |
| `getPrismaClient` | Prisma client accessor |

**Models**: User, Session, ChatSession, ChatMessage, IMConnection, Plugin, SystemConfig, CronTask, SessionMapping

**Dependencies**: None (internal)

---

### 2.5 @saclaw/auth

**Purpose**: Authentication system (Local + OAuth)

**Key Exports**:

| Export | Description |
|--------|-------------|
| `LocalAuthService` | Local auth service |
| `GitHubOAuthService` | GitHub OAuth |
| `GoogleOAuthService` | Google OAuth |
| `WeChatOAuthService` | WeChat OAuth |
| `QQOAuthService` | QQ OAuth |
| `WeWorkOAuthService` | WeCom OAuth |
| `createAuthMiddleware` | Auth middleware factory |

**Dependencies**: `@saclaw/database`

---

### 2.6 @saclaw/capabilities

**Purpose**: Automation capabilities (files, browser, shell)

**Key Exports**:

| Export | Description |
|--------|-------------|
| `CapabilitiesManager` | Capability manager |
| `ToolRegistry` | Tool registry |
| `FileTools` | File operations |
| `BrowserTools` | Browser automation |
| `ShellTools` | Command execution |

**Dependencies**: None (internal)

---

### 2.7 @saclaw/adapters

**Purpose**: IM platform adapters (10 platforms)

**Key Exports**:

| Export | Description |
|--------|-------------|
| `createAdapter` | Adapter factory |
| `IMAdapterManager` | Adapter manager |
| `WechatAdapter` | WeChat adapter |
| `QQAdapter` | QQ adapter |
| `TelegramAdapter` | Telegram adapter |
| `DiscordAdapter` | Discord adapter |
| `DingTalkAdapter` | DingTalk adapter |
| `FeishuAdapter` | Feishu adapter |
| `XiaoyiAdapter` | Xiaoyi adapter |
| `WhatsAppAdapter` | WhatsApp adapter |
| `SlackAdapter` | Slack adapter |
| `EmailAdapter` | Email adapter |

**Dependencies**: `@saclaw/types`

---

### 2.8 @saclaw/api

**Purpose**: REST API + WebSocket server

**Routes**:

| Route | Description |
|-------|-------------|
| `/api/auth/*` | Authentication endpoints |
| `/api/chat/*` | Chat endpoints |
| `/api/im/*` | IM management |
| `/api/tasks/*` | Task management |
| `/api/routing/*` | Routing rules |
| `/api/plugins/*` | Plugin management |
| `/ws` | WebSocket |

**Dependencies**: `@saclaw/core`, `@saclaw/auth`, `@saclaw/database`, `@saclaw/adapters`, `@saclaw/capabilities`

---

### 2.9 @saclaw/web

**Purpose**: Web UI (Vue 3 + TinyVue)

**Pages**:

| Page | Route | Description |
|------|-------|-------------|
| Login | `/login` | Authentication |
| Dashboard | `/dashboard` | Overview |
| Chat | `/dashboard/chat` | AI Chat |
| IM | `/dashboard/im` | IM Management |
| Settings | `/dashboard/settings` | Settings |

**Dependencies**: `@saclaw/api`, `@saclaw/auth`, `@saclaw/core`

---

### 2.10 @saclaw/cli

**Purpose**: Command-line tool

**Commands**:

| Command | Description |
|---------|-------------|
| `saclaw chat` | Interactive chat |
| `saclaw start` | Start server |
| `saclaw im` | IM management |
| `saclaw config` | Configuration |
| `saclaw plugin` | Plugin management |

**Dependencies**: `@saclaw/core`

---

### 2.11 @saclaw/container

**Purpose**: Docker container management for agent isolation

**Key Exports**:

| Export | Description |
|--------|-------------|
| `ContainerManager` | Container lifecycle |
| `Container` | Container instance |
| `DockerRunner` | Docker runtime |
| `SandboxConfig` | Sandbox configuration |

**Dependencies**: None (internal)

---

## 3. Dependency Graph

```
@saclaw/types ──────────────────────────────────────────────┐
     │                                                       │
     ├──▶ @saclaw/core                                       │
     │                                                       │
     └──▶ @saclaw/adapters                                   │
                                                             │
@saclaw/container ───────────────────────────────────────────┤
     │                                                       │
     └──▶ @saclaw/core                                       │
                                                             │
@saclaw/database ────────────────────────────────────────────┤
     │                                                       │
@saclaw/auth ◀───────────────────────────────────────────────┤
     │                                                       │
@saclaw/capabilities ─────────────────────────────────────────┤
     │                                                       │
@saclaw/gateway ◀─────────────────────────────────────────────┤
     │         (depends on auth, core, database)              │
     │                                                       │
@saclaw/api ◀─────────────────────────────────────────────────┘
     │
     ├──▶ @saclaw/adapters
     ├──▶ @saclaw/auth
     ├──▶ @saclaw/core
     ├──▶ @saclaw/database
     └──▶ @saclaw/capabilities

@saclaw/web
     │
     ├──▶ @saclaw/api
     ├──▶ @saclaw/auth
     └──▶ @saclaw/core

@saclaw/cli
     │
     └──▶ @saclaw/core
```

---

## 4. Package Versions

| Package | Version | Description |
|---------|---------|-------------|
| @saclaw/types | 0.1.0 | Shared types |
| @saclaw/core | 0.2.0 | Provider abstraction layer |
| @saclaw/gateway | 0.1.0 | WebSocket gateway |
| @saclaw/container | 0.1.0 | Docker container |
| @saclaw/database | 0.1.0 | Prisma ORM |
| @saclaw/auth | 0.1.0 | Authentication |
| @saclaw/capabilities | 0.1.0 | Automation |
| @saclaw/adapters | 0.1.0 | IM adapters |
| @saclaw/api | 0.1.0 | REST API |
| @saclaw/web | 0.1.0 | Web UI |
| @saclaw/cli | 0.1.0 | CLI tool |

---

*Document Version: 1.1.0*
*Last Updated: 2026-03-23*
