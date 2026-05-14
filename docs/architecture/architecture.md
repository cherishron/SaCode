# System Architecture Overview

> SACODE - Multi-platform AI Assistant Framework

---

## 1. Architecture Overview

### 1.1 Layered Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    Interface Layer                               │
│    ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐      │
│    │   CLI    │  │  Web UI  │  │    IM    │  │   API    │      │
│    │(Commander)│  │ (Vue 3)  │  │(Adapters)│  │ (Express)│      │
│    └────┬─────┘  └────┬─────┘  └────┬─────┘  └────┬─────┘      │
└─────────┼─────────────┼─────────────┼─────────────┼─────────────┘
          │             │             │             │
          └─────────────┴─────────────┴─────────────┘
                              │
┌─────────────────────────────┴───────────────────────────────────┐
│                      Core Layer                                  │
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
│                    Capability Layer                              │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐        │
│  │  Files   │  │ Browser  │  │  Shell   │  │  Custom  │        │
│  │ System   │  │(Puppeteer)│  │ Commands │  │ Plugins │        │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘        │
└──────────────────────────────────────────────────────────────────┘
                              │
┌─────────────────────────────┴───────────────────────────────────┐
│                    Storage Layer                                 │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐        │
│  │ Database │  │  Cache   │  │  Config  │  │   Logs   │        │
│  │ (Prisma) │  │(Mem/Redis)│  │  (JSON)  │  │  (File)  │        │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘        │
└──────────────────────────────────────────────────────────────────┘
                              │
┌─────────────────────────────┴───────────────────────────────────┐
│                    External Services                             │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐        │
│  │  OpenAI  │  │Anthropic │  │ DeepSeek │  │  Other   │        │
│  │   API    │  │   API    │  │   API    │  │Providers │        │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘        │
└──────────────────────────────────────────────────────────────────┘
```

### 1.2 Component Responsibilities

| Layer | Components | Responsibility |
|-------|------------|----------------|
| Interface | CLI, Web, IM, API | User interaction, protocol handling |
| Core | Provider, Session, Router, Task | Business logic, orchestration |
| Capability | Files, Browser, Shell | Automation, external actions |
| Storage | Database, Cache, Config | Data persistence, caching |

---

## 2. Provider Architecture

### 2.1 Provider Abstraction Layer

```
┌─────────────────────────────────────────────────────────────────┐
│                    AIProvider Interface                          │
├─────────────────────────────────────────────────────────────────┤
│  + type: ProviderType                                            │
│  + model: string                                                 │
│  + isInitialized: boolean                                        │
│  + initialize(): Promise<void>                                   │
│  + chat(options): AsyncGenerator<StreamChunk>                   │
│  + executeToolCall(toolCall): Promise<ToolCallResult>           │
│  + registerTool(tool, handler): void                            │
│  + destroy(): Promise<void>                                      │
└─────────────────────────────────────────────────────────────────┘
                              △
                              │
        ┌─────────────────────┼─────────────────────┐
        │                     │                     │
┌───────┴───────┐    ┌────────┴────────┐   ┌──────┴──────┐
│ OpenAIProvider│    │AnthropicProvider│   │   Custom    │
│               │    │                 │   │  Providers  │
│ - OpenAI SDK  │    │ - Anthropic SDK │   │             │
│ - Streaming   │    │ - Streaming     │   │             │
│ - Tool Calls  │    │ - Tool Use      │   │             │
└───────────────┘    └─────────────────┘   └─────────────┘
```

### 2.2 Supported Providers

| Provider | Type | Default Model | Features |
|----------|------|---------------|----------|
| OpenAI | `openai` | gpt-4o | Streaming, Tools, Vision |
| Anthropic | `anthropic` | claude-3-5-sonnet-latest | Streaming, Tool Use, Vision |
| DeepSeek | `deepseek` | deepseek-chat | Streaming, Tools |
| Moonshot | `moonshot` | moonshot-v1-8k | Streaming, Tools |
| Zhipu | `zhipu` | glm-4-plus | Streaming, Tools |

### 2.3 Factory Pattern

```typescript
// Factory creation
const provider = createProvider({
  type: "openai",
  apiKey: process.env.OPENAI_API_KEY,
  model: "gpt-4o",
});

// From environment
const provider = createProviderFromEnv();

// Custom registration
registerProvider("custom", (config) => new CustomProvider(config));
```

---

## 3. Session Architecture

### 3.1 Session Management

```
┌─────────────────────────────────────────────────────────────────┐
│                    Session Manager                               │
├─────────────────────────────────────────────────────────────────┤
│  Sessions Map                                                    │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ sessionId → { userId, channelId, messages[], metadata } │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                  │
│  + createSession(userId, channelId): Session                   │
│  + getSession(sessionId): Session | null                       │
│  + addMessage(sessionId, message): void                        │
│  + getHistory(sessionId): Message[]                            │
│  + deleteSession(sessionId): void                              │
└─────────────────────────────────────────────────────────────────┘
```

### 3.2 Cross-Channel Mapping

```
┌─────────────────────────────────────────────────────────────────┐
│                    Session Mapper                                │
├─────────────────────────────────────────────────────────────────┤
│  Platform → Session Mapping                                      │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ "telegram:chat_123" → "session_abc"                      │   │
│  │ "discord:channel_456" → "session_abc"                    │   │
│  │ "wechat:user_789" → "session_xyz"                        │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                  │
│  + createMapping(platform, chatId): sessionId                  │
│  + getMapping(platform, chatId): sessionId | null              │
│  + removeMapping(platform, chatId): void                       │
└─────────────────────────────────────────────────────────────────┘
```

---

## 4. IM Adapter Architecture

### 4.1 Adapter Pattern

```
┌─────────────────────────────────────────────────────────────────┐
│                    IMAdapter Interface                           │
├─────────────────────────────────────────────────────────────────┤
│  + name: string                                                  │
│  + connect(): Promise<void>                                     │
│  + disconnect(): Promise<void>                                  │
│  + onMessage(handler): void                                     │
│  + send(message): Promise<string | undefined>                   │
│  + getChannels(): Promise<Channel[]>                            │
└─────────────────────────────────────────────────────────────────┘
                              △
                              │
┌─────────────────────────────┼─────────────────────────────────┐
│                             │                                  │
│  ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐       │
│  │WeChat│ │  QQ  │ │Telegr│ │Discrd│ │DingTk│ │Feishu│       │
│  └──────┘ └──────┘ └──────┘ └──────┘ └──────┘ └──────┘       │
│  ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐                          │
│  │Xiaoyi│ │WhtsAp│ │Slack │ │Email │                          │
│  └──────┘ └──────┘ └──────┘ └──────┘                          │
└─────────────────────────────────────────────────────────────────┘
```

### 4.2 Message Flow

```
IM Platform          Adapter              Core               AI Provider
    │                  │                   │                     │
    │  Webhook/WS      │                   │                     │
    │─────────────────>│                   │                     │
    │                  │  Normalized Msg   │                     │
    │                  │──────────────────>│                     │
    │                  │                   │  Chat Request       │
    │                  │                   │────────────────────>│
    │                  │                   │  Stream Chunks      │
    │                  │                   │<────────────────────│
    │                  │  Response         │                     │
    │                  │<──────────────────│                     │
    │  Send Message    │                   │                     │
    │<─────────────────│                   │                     │
```

---

## 5. Authentication Architecture

### 5.1 Authentication Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                    Authentication System                         │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  Local Auth                    OAuth                            │
│  ┌─────────────┐              ┌─────────────┐                   │
│  │ Username    │              │ GitHub      │                   │
│  │ Password    │              │ Google      │                   │
│  │ bcrypt      │              │ WeChat      │                   │
│  │ JWT         │              │ QQ          │                   │
│  └─────────────┘              │ WeCom       │                   │
│                               └─────────────┘                   │
│         │                            │                          │
│         └────────────┬───────────────┘                          │
│                      │                                          │
│               ┌──────┴──────┐                                   │
│               │   Session   │                                   │
│               │   Manager   │                                   │
│               └──────┬──────┘                                   │
│                      │                                          │
│               ┌──────┴──────┐                                   │
│               │  Passport.js │                                  │
│               │  Middleware  │                                  │
│               └─────────────┘                                   │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### 5.2 OAuth Providers

| Provider | Environment Variables | Scopes |
|----------|----------------------|--------|
| GitHub | `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` | `user:email` |
| Google | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | `openid email profile` |
| WeChat | `WECHAT_APP_ID`, `WECHAT_APP_SECRET` | `snsapi_login` |
| QQ | `QQ_APP_ID`, `QQ_APP_KEY` | `get_user_info` |
| WeCom | `WEWORK_CORP_ID`, `WEWORK_AGENT_ID`, `WEWORK_SECRET` | `snsapi_base` |

---

## 6. Data Architecture

### 6.1 Database Schema

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│     User     │     │   Session    │     │ ChatSession  │
├──────────────┤     ├──────────────┤     ├──────────────┤
│ id           │────<│ userId       │     │ id           │
│ username     │     │ token        │     │ userId       │
│ email        │     │ expiresAt    │     │ title        │
│ password     │     └──────────────┘     │ messages     │
│ oauthProvider│                           └──────────────┘
│ oauthId      │                           ┌──────────────┐
│ avatar       │                           │ IMConnection │
└──────────────┘                           ├──────────────┤
                                           │ id           │
                                           │ platform     │
                                           │ config       │
                                           │ status       │
                                           └──────────────┘
```

### 6.2 Cache Strategy

| Data Type | Cache Backend | TTL |
|-----------|---------------|-----|
| User Session | Memory/Redis | 7 days |
| Provider Config | Memory | 1 hour |
| IM Connection | Memory | 5 minutes |
| Route Rules | Memory | 10 minutes |

---

## 7. Deployment Architecture

### 7.1 Docker Deployment

```yaml
services:
  sacode-api:
    image: sacode-api:latest
    ports:
      - "3000:3000"
    environment:
      - DATABASE_URL=file:/data/sacode.db
    volumes:
      - ./data:/data

  sacode-web:
    image: sacode-web:latest
    ports:
      - "80:80"
    depends_on:
      - sacode-api

  redis:
    image: redis:alpine
    ports:
      - "6379:6379"
```

### 7.2 Scalability

```
                    ┌─────────────┐
                    │   Nginx     │
                    │  (Reverse   │
                    │   Proxy)    │
                    └──────┬──────┘
                           │
           ┌───────────────┼───────────────┐
           │               │               │
    ┌──────┴──────┐ ┌──────┴──────┐ ┌──────┴──────┐
    │  API Node 1 │ │  API Node 2 │ │  API Node 3 │
    └──────┬──────┘ └──────┬──────┘ └──────┬──────┘
           │               │               │
           └───────────────┼───────────────┘
                           │
                    ┌──────┴──────┐
                    │   Redis     │
                    │   Cluster   │
                    └──────┬──────┘
                           │
                    ┌──────┴──────┐
                    │  Database   │
                    │  (PostgreSQL)│
                    └─────────────┘
```

---

*Document Version: 1.0.0*
*Last Updated: 2026-03-19*
