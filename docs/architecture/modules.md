# Module Design

> SACODE - Module Overview and Dependencies

---

## 1. Monorepo Structure

```
SACODE/
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

### 2.1 @SACODE/types

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

### 2.2 @SACODE/core

**Purpose**: Core engine with provider abstraction, session management, routing

**Key Exports**:

| Export | Description |
|--------|-------------|
| `SACODEClient` | Main client class |
| `createProvider` | Provider factory |
| `SessionManager` | Session management |
| `SmartRouter` | Rule-based routing |
| `LongTaskManager` | Task execution |
| `CacheManager` | Caching layer |
| `MCPServer/Client` | MCP protocol |

**Dependencies**: `@SACODE/types`, `@SACODE/container`

---

### 2.3 @SACODE/gateway

**Purpose**: WebSocket control plane for real-time communication

**Key Exports**:

| Export | Description |
|--------|-------------|
| `GatewayServer` | WebSocket server |
| `GatewaySession` | Session handler |
| `ProtocolHandler` | Message protocol |

**Dependencies**: `@SACODE/core`, `@SACODE/auth`, `@SACODE/database`

---

### 2.4 @SACODE/database

**Purpose**: Database abstraction with Prisma ORM

**Key Exports**:

| Export | Description |
|--------|-------------|
| `createDatabase` | Database initialization |
| `getPrismaClient` | Prisma client accessor |

**Models**: User, Session, ChatSession, ChatMessage, IMConnection, Plugin, SystemConfig, CronTask, SessionMapping

**Dependencies**: None (internal)

---

### 2.5 @SACODE/auth

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

**Dependencies**: `@SACODE/database`

---

### 2.6 @SACODE/capabilities

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

### 2.7 @SACODE/adapters

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

**Dependencies**: `@SACODE/types`

---

### 2.8 @SACODE/api

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

**Dependencies**: `@SACODE/core`, `@SACODE/auth`, `@SACODE/database`, `@SACODE/adapters`, `@SACODE/capabilities`

---

### 2.9 @SACODE/web

**Purpose**: Web UI (Vue 3 + TinyVue)

**Pages**:

| Page | Route | Description |
|------|-------|-------------|
| Login | `/login` | Authentication |
| Dashboard | `/dashboard` | Overview |
| Chat | `/dashboard/chat` | AI Chat |
| IM | `/dashboard/im` | IM Management |
| Settings | `/dashboard/settings` | Settings |

**Dependencies**: `@SACODE/api`, `@SACODE/auth`, `@SACODE/core`

---

### 2.10 @SACODE/cli

**Purpose**: Command-line tool

**Commands**:

| Command | Description |
|---------|-------------|
| `SACODE chat` | Interactive chat |
| `SACODE start` | Start server |
| `SACODE im` | IM management |
| `SACODE config` | Configuration |
| `SACODE plugin` | Plugin management |

**Dependencies**: `@SACODE/core`

---

### 2.11 @SACODE/container

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
@SACODE/types ──────────────────────────────────────────────┐
     │                                                       │
     ├──▶ @SACODE/core                                       │
     │                                                       │
     └──▶ @SACODE/adapters                                   │
                                                             │
@SACODE/container ───────────────────────────────────────────┤
     │                                                       │
     └──▶ @SACODE/core                                       │
                                                             │
@SACODE/database ────────────────────────────────────────────┤
     │                                                       │
@SACODE/auth ◀───────────────────────────────────────────────┤
     │                                                       │
@SACODE/capabilities ─────────────────────────────────────────┤
     │                                                       │
@SACODE/gateway ◀─────────────────────────────────────────────┤
     │         (depends on auth, core, database)              │
     │                                                       │
@SACODE/api ◀─────────────────────────────────────────────────┘
     │
     ├──▶ @SACODE/adapters
     ├──▶ @SACODE/auth
     ├──▶ @SACODE/core
     ├──▶ @SACODE/database
     └──▶ @SACODE/capabilities

@SACODE/web
     │
     ├──▶ @SACODE/api
     ├──▶ @SACODE/auth
     └──▶ @SACODE/core

@SACODE/cli
     │
     └──▶ @SACODE/core
```

---

## 4. Package Versions

| Package | Version | Description |
|---------|---------|-------------|
| @SACODE/types | 0.1.0 | Shared types |
| @SACODE/core | 0.2.0 | Provider abstraction layer |
| @SACODE/gateway | 0.1.0 | WebSocket gateway |
| @SACODE/container | 0.1.0 | Docker container |
| @SACODE/database | 0.1.0 | Prisma ORM |
| @SACODE/auth | 0.1.0 | Authentication |
| @SACODE/capabilities | 0.1.0 | Automation |
| @SACODE/adapters | 0.1.0 | IM adapters |
| @SACODE/api | 0.1.0 | REST API |
| @SACODE/web | 0.1.0 | Web UI |
| @SACODE/cli | 0.1.0 | CLI tool |

---

*Document Version: 1.1.0*
*Last Updated: 2026-03-23*
