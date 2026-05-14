# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2026-03-20

### Breaking Changes

- **Provider Abstraction Layer**: Replaced iFlow SDK with mainstream AI Provider abstraction
  - Removed `IFLOW_ACP_URL` environment variable
  - Added `AI_PROVIDER`, `AI_MODEL`, provider-specific API keys
  - Migrated from ACP protocol to standard REST API + Function Calling

### Added

#### Provider Abstraction Layer (@sacode/core/provider)

- `Provider` interface - Unified AI provider abstraction
- `OpenAIProvider` - OpenAI GPT models support (gpt-4o, gpt-4-turbo, gpt-3.5-turbo)
- `AnthropicProvider` - Anthropic Claude models support (claude-3-5-sonnet, claude-3-opus)
- `DeepSeekProvider` - DeepSeek models support (deepseek-chat, deepseek-coder)
- `MoonshotProvider` - Moonshot Kimi models support (moonshot-v1-8k, moonshot-v1-32k)
- `ZhipuProvider` - Zhipu GLM models support (glm-4, glm-4-flash)
- `ProviderFactory` - Factory pattern for provider creation
- Streaming response support for all providers
- Error handling with retry mechanism

#### ToolBridge (@sacode/core/tools)

- `ToolBridge` - Unified tool management layer
- `ToolRegistry` - Centralized tool registration with Zod schema support
- Built-in tools:
  - `think` - Internal reasoning tool
  - `plan` - Task planning tool
- MCP tool adapter (`MCPToolAdapter`)
- Capabilities tool adapter (`CapabilitiesToolAdapter`)
- Zod to JSON Schema conversion for tool parameters
- Tool execution with timeout and error handling

#### Agent Infrastructure (@sacode/core/agent)

- `AgentRegistry` - Agent management with 4 default agents:
  - `general` - General-purpose assistant
  - `code` - Code generation and review
  - `research` - Research and analysis
  - `execution` - Task execution
- `Planner` - Complexity assessment and execution plan generation
  - Simple/Medium/Complex task classification
  - Step-by-step plan generation
- `Orchestrator` - Plan execution with:
  - Dependency resolution
  - Agent assignment based on capabilities
  - Retry mechanism with exponential backoff
  - Progress tracking
- `SACODEClient.agenticChat()` - Automatic planning mode

#### Function Calling Loop

- Complete agentic tool execution loop in SACODEClient
- Tools continue executing until AI indicates completion
- Maximum iteration limit (configurable, default 10)
- Progress events for tool execution tracking

### Changed

- **SACODEClient** refactored:
  - Removed iFlow SDK dependency
  - Added Provider-based initialization
  - Added `registerTool()` method for tool registration
  - Added `agenticChat()` for automatic planning mode
  - Added `enableAgenticPlanning` configuration option
- **Environment variables** reorganized:
  - `AI_PROVIDER` - Provider selection (openai/anthropic/deepseek/moonshot/zhipu)
  - `AI_MODEL` - Model selection
  - `AI_TIMEOUT` - Request timeout
  - Provider-specific API keys (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, etc.)
  - `MAX_TOOL_LOOP_ITERATIONS` - Tool loop limit
  - `ENABLE_AGENTIC_PLANNING` - Enable/disable agentic mode

### Fixed

- TypeScript `exactOptionalPropertyTypes` compatibility issues
- Zod internal type access issues in tool schema conversion
- Duplicate identifier errors in module exports

### Tests

- Added 23 new tests for ToolBridge
- Total test count increased from 151 to 174

## [1.1.0] - 2026-03-24

### Security

- **JWT Authentication Fix** - Critical security vulnerability resolved
  - Fixed token verification bypass in API routes where `verifyToken: (token) => ({ userId: token })` allowed any token to access the system
  - Created unified authentication middleware (`@sacode/api/src/middleware/auth.ts`) using `LocalAuthService` with proper JWT verification
  - Updated 11 API route files to use the secure shared middleware

- **OAuth State Persistence** - Production-ready OAuth flow
  - Added `OAuthState` Prisma model for database-backed state storage
  - Replaced in-memory `Map` storage with database persistence
  - Supports multi-instance deployment and server restarts
  - Auto-cleanup of expired states (5-minute TTL)

- **Sensitive Data Encryption** - AES-256-GCM encryption for secrets
  - Created `@sacode/api/src/utils/encryption.ts` with proper cryptographic implementation
  - Replaced insecure Base64 encoding with AES-256-GCM authenticated encryption
  - Uses scrypt for key derivation with random IV per encryption
  - Backward compatible with legacy Base64 format (auto-migration)
  - Environment variable `ENCRYPTION_KEY` required in production

- **Environment Variable Validation**
  - Added startup validation for required secrets in production
  - `JWT_SECRET`, `SESSION_SECRET`, `ENCRYPTION_KEY` must be set in production
  - Development mode shows warnings for missing secrets

### Changed

- **Unified Authentication Architecture**
  - Consolidated authentication logic into shared middleware
  - Removed duplicate auth implementations across route files
  - Reduced code duplication by ~150 lines

- **PRD Documentation Update**
  - Updated test count: 151 → 358
  - Updated data models: 9 → 16
  - Updated Web UI pages: 7 → 10
  - Updated document date to 2026-03-24

### Added

- `OAuthState` Prisma model for OAuth state persistence
- `@sacode/api/src/middleware/auth.ts` - Shared authentication middleware
- `@sacode/api/src/utils/encryption.ts` - AES-256-GCM encryption utilities
- `ENCRYPTION_KEY` environment variable in `.env.example`

### Files Modified

| File | Change |
|------|--------|
| `packages/database/prisma/schema.prisma` | Added OAuthState model |
| `packages/api/src/middleware/auth.ts` | New unified auth middleware |
| `packages/api/src/utils/encryption.ts` | New encryption module |
| `packages/api/src/server.ts` | Added environment validation |
| `packages/api/src/routes/auth.ts` | Refactored to use LocalAuthService, database OAuth state |
| `packages/api/src/routes/chat.ts` | Use shared auth middleware |
| `packages/api/src/routes/capabilities.ts` | Use shared auth middleware |
| `packages/api/src/routes/im.ts` | Use shared auth middleware |
| `packages/api/src/routes/im-chat.ts` | Use shared auth middleware |
| `packages/api/src/routes/models.ts` | Use shared auth middleware |
| `packages/api/src/routes/notifications.ts` | Use shared auth middleware |
| `packages/api/src/routes/memory.ts` | Use shared auth middleware |
| `packages/api/src/routes/plugins.ts` | Use shared auth middleware |
| `packages/api/src/routes/tasks.ts` | Use shared auth middleware |
| `packages/api/src/routes/media.ts` | Use shared auth middleware |
| `packages/api/src/routes/routing.ts` | Use shared auth middleware |
| `packages/api/src/routes/settings.ts` | Use AES-256-GCM encryption |
| `.env.example` | Added ENCRYPTION_KEY and security notes |
| `docs/PRD.md` | Updated statistics and date |

### Tests

- All 358 tests passing
- No new tests added (security fixes verified by existing auth tests)

## [Unreleased]

### Added

- **@sacode/types** - Shared types package for cross-package type definitions
  - Multimedia message types (ImageContent, AudioContent, VideoContent, etc.)
  - IM adapter types (Platform, IMConfig, IMMessage, IMAdapter, etc.)
  - Type guards for content validation
- Docker containerization support with multi-stage builds
- GitHub Actions CI/CD workflows (lint, test, build, release)
- E2E test configuration with Vitest
- Enhanced test coverage with integration tests
- CONTRIBUTING.md contribution guide

### Changed

- **Project Structure Refactoring**:
  - Created `@sacode/types` shared package to eliminate duplicate type definitions
  - Merged `javisk/` directory into `.SACODE/` for unified PCIV workflow configuration
  - Refactored `@sacode/container` package with modular architecture:
    - `types.ts` - Container type definitions with Zod schemas
    - `errors.ts` - Container-specific error classes
    - `docker-runner.ts` - Docker/Podman runtime abstraction
    - `container-instance.ts` - Container instance wrapper
    - `manager.ts` - Container manager with lifecycle control
  - Cleaned up redundant files: dev.log, dev-error.log, vue-login-page.jpg, docs/AGENTS.md
- Enhanced DingTalk adapter with AI Card streaming support
- Enhanced Xiaoyi adapter with streaming and multimedia support
- Enhanced WhatsApp adapter with WebSocket and multimedia support
- Improved IMAdapterManager with register/unregister/has methods
- Updated test infrastructure with coverage thresholds

## [0.1.0] - 2026-03-14

### Added

#### Core Module (@sacode/core)

- `SACODEClient` - iFlow SDK client wrapper with ACP protocol support
- `SessionManager` - Session lifecycle management
- `SessionMapper` - Cross-platform session mapping with persistence
- `MessageRouter` - Message routing with pattern matching
- `SmartRouter` - Rule-based intelligent routing
- `TaskScheduler` - Scheduled task system (interval/once/cron)
- `GroupQueue` - Group-based task queue with concurrency control
- `PluginManager` - Plugin lifecycle management
- `SkillLoader` / `SkillRegistry` / `SkillInstaller` - Skills ecosystem
- `MemoryManager` / `EnhancedMemoryManager` - Conversation memory management
- `MCPServer` / `MCPClient` - Model Context Protocol implementation
- `SecurityManager` - Session security and permissions
- `WorkspaceManager` - Workspace and context management
- `LongTaskManager` - Long-running task management
- `StreamingManager` - Streaming response management
- `ModelManager` - Multi-model support with auto-switching

#### Adapters (@sacode/adapters)

- `WechatAdapter` - WeChat adapter (WebSocket)
- `QQAdapter` - QQ adapter (OneBot protocol)
- `TelegramAdapter` - Telegram Bot API adapter
- `DiscordAdapter` - Discord Gateway adapter
- `DingTalkAdapter` - DingTalk REST API adapter with AI Card streaming
- `FeishuAdapter` - Feishu Open API adapter
- `XiaoyiAdapter` - Huawei Xiaoyi adapter with streaming support
- `WhatsAppAdapter` - WhatsApp adapter (baileys bridge)
- `SlackAdapter` - Slack Web API adapter
- `EmailAdapter` - Email adapter (IMAP + SMTP)

#### Authentication (@sacode/auth)

- `LocalAuthService` - Local authentication with bcrypt + JWT
- OAuth providers:
  - `GitHubOAuthService`
  - `GoogleOAuthService`
  - `WeChatOAuthService`
  - `QQOAuthService`
  - `WeWorkOAuthService`
- Authentication middleware for Express

#### Database (@sacode/database)

- Prisma ORM integration
- Multi-database support (SQLite/MySQL/PostgreSQL)
- Data models:
  - User, Session, ChatSession, ChatMessage
  - IMConnection, Plugin, SystemConfig
  - CronTask, SessionMapping

#### API (@sacode/api)

- REST API endpoints:
  - Authentication (`/api/auth/*`)
  - Chat (`/api/chat/*`)
  - IM management (`/api/im/*`)
  - Capabilities (`/api/capabilities`)
  - Plugins (`/api/plugins`)
- WebSocket support for real-time communication

#### Web UI (@sacode/web)

- Vue 3 + Vite + TinyVue frontend
- Pages:
  - Login (with OAuth support)
  - Dashboard
  - Chat
  - IM Management
  - Settings
- Dark mode support
- Responsive design

#### CLI (@sacode/cli)

- Commander.js based CLI tool
- Commands:
  - `chat` - Interactive chat mode
  - `config` - Configuration management
  - `im` - IM platform management
  - `start` - Start services
  - `plugin` - Plugin management
  - `tool` - Tool execution

#### Capabilities (@sacode/capabilities)

- File operations (read/write/list/search)
- Browser automation (Puppeteer)
- Shell command execution
- Tool registry with validation

#### Skills System

- Skill discovery and installation
- ClawHub / SkillHub registry adapters
- Security measures:
  - Path traversal protection
  - URL injection protection
  - File size/count limits
  - Extension whitelist
  - Checksum verification

### Security

- Input validation and sanitization
- Path traversal protection in skill installer
- URL injection protection in registry
- File size and count limits
- Extension whitelist for skills
- LRU cache with size limits
- Retry mechanism with exponential backoff

### Documentation

- AGENTS.md - Project context and technical documentation
- PRD.md - Product requirements document
- Architecture documentation (frontend, security)
- Guides (dark mode, skills system)

## [0.0.1] - 2026-03-01

### Added

- Initial project setup
- Monorepo structure with pnpm workspaces
- TypeScript configuration with strict mode
- ESLint and Prettier configuration
- Vitest testing framework
- Basic project scaffolding

---

## Version History

| Version | Date | Description |
|---------|------|-------------|
| 1.0.0 | 2026-03-20 | Provider abstraction, ToolBridge, Agent infrastructure |
| 0.1.0 | 2026-03-14 | First alpha release |
| 0.0.1 | 2026-03-01 | Project initialization |

---

## Upgrade Guide

### From 0.1.0 to 1.0.0

This is a major release with breaking changes. Migration from iFlow SDK to Provider abstraction is required.

**Environment Variables Migration:**

```bash
# OLD (iFlow SDK)
IFLOW_ACP_URL=ws://localhost:8090/acp
IFLOW_AUTO_START=true

# NEW (Provider Abstraction)
AI_PROVIDER=openai
OPENAI_API_KEY=sk-your-api-key
AI_MODEL=gpt-4o
AI_TIMEOUT=60000
MAX_TOOL_LOOP_ITERATIONS=10
ENABLE_AGENTIC_PLANNING=true
```

**Code Migration:**

```typescript
// OLD
const client = new SACODEClient({
  acpUrl: "ws://localhost:8090/acp",
  autoStart: true,
});

// NEW
const client = new SACODEClient({
  provider: {
    type: "openai",
    apiKey: process.env.OPENAI_API_KEY,
    model: "gpt-4o",
  },
});
await client.connect();
```

**New Features Available:**

- Agentic chat with automatic planning: `client.agenticChat()`
- Custom tool registration: `client.registerTool()`
- Multi-provider support (OpenAI, Anthropic, DeepSeek, Moonshot, Zhipu)

### From 0.0.1 to 0.1.0

This is the first feature release with significant additions. A clean install is recommended.

```bash
# Update dependencies
pnpm install

# Regenerate Prisma client
pnpm -C packages/database prisma generate

# Run migrations
pnpm -C packages/database prisma migrate dev

# Update environment variables
cp .env.example .env
# Edit .env with your configuration
```

---

[Unreleased]: https://github.com/STAND-ALONE/SACODE/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/STAND-ALONE/SACODE/releases/tag/v1.0.0
[0.1.0]: https://github.com/STAND-ALONE/SACODE/releases/tag/v0.1.0
[0.0.1]: https://github.com/STAND-ALONE/SACODE/releases/tag/v0.0.1
