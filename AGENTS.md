# SaCode — 多端 AI 助手框架

> TypeScript Monorepo · Provider 抽象层 · 10 IM 平台 · Agentic 编排

---

## 包导航

| 包 | 职责 | 详细文档 |
|----|------|----------|
| `packages/core` | 核心引擎：Provider/Agent/Session/Router/Task/MCP/Cache/Tools | [→ AGENTS.md](./packages/core/AGENTS.md) |
| `packages/cli` | 命令行工具：Commander.js + React Ink TUI + Vim 模式 | [→ AGENTS.md](./packages/cli/AGENTS.md) |
| `packages/api` | REST API + WebSocket：14 路由模块 | [→ AGENTS.md](./packages/api/AGENTS.md) |
| `packages/web` | Web UI：Vue 3 + TinyVue + TDesign + Tailwind CSS | [→ AGENTS.md](./packages/web/AGENTS.md) |
| `packages/adapters` | IM 适配器：10 平台统一接口 | [→ AGENTS.md](./packages/adapters/AGENTS.md) |
| `packages/capabilities` | 自动化能力：33 工具（文件/浏览器/Shell/Web/LSP/Git） | [→ AGENTS.md](./packages/capabilities/AGENTS.md) |
| `packages/auth` | 认证模块：本地认证 + OAuth 5 提供商 | [→ AGENTS.md](./packages/auth/AGENTS.md) |
| `packages/database` | 数据库层：Prisma ORM + 多数据库支持 | — |
| `packages/gateway` | 统一控制平面：WebSocket 网关 | — |
| `packages/container` | 容器隔离：Docker Agent 运行时 | — |
| `packages/types` | 共享类型定义（无内部依赖） | — |

---

## 技术栈

| 层级 | 技术 | 版本 |
|------|------|------|
| 运行时 | Bun / Node.js | 1.3.13+ / 22+ |
| 语言 | TypeScript | 5.7+ 严格模式 |
| Web | Vue 3 + Vite | 3.5+ / 6.0+ |
| UI | TinyVue + TDesign | 3.20+ / 1.18+ |
| 样式 | Tailwind CSS | 3.4+ |
| ORM | Prisma | 6.1+ |
| 包管理 | Bun | 1.3.13+ |
| 构建 | tsup | 8.3+ |
| 测试 | Vitest | 2.1+ |
| API 框架 | Hono | 4.7+ |

---

## TypeScript 严格配置

`tsconfig.base.json` 启用全部严格选项：

```jsonc
{
  "strict": true,
  "noUnusedLocals": true,
  "noUnusedParameters": true,
  "noUncheckedIndexedAccess": true,
  "exactOptionalPropertyTypes": true,
  "noImplicitReturns": true,
  "noImplicitOverride": true,
  "verbatimModuleSyntax": true,
  "noFallthroughCasesInSwitch": true
}
```

**禁止**: `as any`, `@ts-ignore`, `@ts-expect-error`（除非有明确注释说明原因）

---

## 代码风格

- **Prettier**: `semi: true`, 双引号, `printWidth: 100`, `trailingComma: "es5"`, `endOfLine: "lf"`
- **ESLint**: TypeScript-eslint 严格类型检查（`strictTypeChecked` + `stylisticTypeChecked`）
- **命名**: 文件 `kebab-case`, 组件 `PascalCase`, 变量 `camelCase`, 常量 `UPPER_SNAKE_CASE`

---

## 项目结构

```
SaCode/
├── packages/
│   ├── core/           # 核心引擎 (24 子模块, 119 源文件)
│   ├── cli/            # 命令行工具 (7 子模块, 100 源文件)
│   ├── web/            # Web UI (Vue 3 + TinyVue + TDesign)
│   ├── capabilities/   # 自动化能力 (Playwright + ripgrep)
│   ├── api/            # REST API + WS (Hono + WebSocket)
│   ├── adapters/       # IM 适配器 (10 平台)
│   ├── auth/           # 认证模块 (Passport.js + OAuth)
│   ├── container/      # 容器隔离 (Docker)
│   ├── database/       # 数据库层 (Prisma + SQLite/MySQL/PostgreSQL)
│   ├── gateway/        # 统一网关 (WebSocket 协议)
│   └── types/          # 共享类型 (无内部依赖)
├── .sacode/            # 配置 (commands/plugins/skills)
├── docs/               # 文档
├── tests/              # E2E 测试
├── scripts/            # 构建/发布脚本
└── docker/             # Docker 配置
```

---

## 依赖链

```
types (基础, 无依赖)
  ↓
container (独立)
  ↓
core ←── types + container
  ↓
database (独立, Prisma)
  ↓
auth ←── database
  ↓
capabilities (独立)
  ↓
adapters ←── core + types
  ↓
gateway ←── auth + core + database
  ↓
api ←── adapters + auth + core + database + capabilities
  ↓
web ←── api + auth + core
cli ←── core (独立)
```

---

## 消息流

```
IM/CLI/Web → Adapter → SessionMapper → SACODEClient → Provider → AI 模型
                                    ↓
                              SmartRouter
                                    ↓
                          ToolBridge (内置 + Capabilities + MCP)
                                    ↓
                          Agent (Registry → Planner → Orchestrator → SisyphusLoop)
                                    ↓
                          StreamingManager → 输出
```

---

## 常用命令

```bash
# 开发与构建
bun install              # 安装依赖
bun dev                  # 开发所有包
bun build                # 构建所有包
bun build:clean          # 清理构建产物
bun build:validate       # 验证构建

# 测试
bun test                 # 运行测试 (Vitest)
bun test:watch           # 监听模式运行测试
bun test:coverage        # 生成测试覆盖率报告
bun test:e2e             # 运行 E2E 测试

# 代码质量
bun lint                 # ESLint 检查
bun format               # Prettier 格式化
bun typecheck            # TypeScript 类型检查

# 服务启动
bun cli                 # 启动 CLI
bun web                 # 启动 Web UI (端口 5173)
bun api                 # 启动 API 服务 (端口 3000)

# 数据库
bun run --filter @sacode/database db:generate    # 生成 Prisma Client
bun run --filter @sacode/database db:push       # 推送 schema 到数据库
bun run --filter @sacode/database db:migrate   # 运行数据库迁移
bun run --filter @sacode/database db:studio    # 打开 Prisma Studio

# 文档
bun docs                # 生成 TypeDoc 文档
bun docs:watch          # 监听模式生成文档
bun docs:serve          # 启动文档服务器

# 发布
bun release             # 交互式版本管理
bun release:minor       # 发布次版本
bun release:major       # 发布主版本

# Docker
bun docker:build        # 构建 Docker 镜像
bun docker:push         # 推送 Docker 镜像
bun docker:all          # 构建并推送所有镜像
bun docker:up           # 启动 Docker Compose
bun docker:down         # 停止 Docker Compose
bun docker:dev          # 启动开发环境 Docker Compose
```

---

## 测试

- **框架**: Vitest (根 `vitest.config.ts`)
- **目录**: `__tests__/` 子目录模式
- **覆盖率阈值**: 行≥50%, 函数≥50%, 分支≥40%, 语句≥50%
- **自定义工具**: `tests/setup.ts` — `MockWebSocket`, `createMockMessage`, `createMockSession`
- **并行**: 线程池 1-4 线程
- **报告格式**: 默认 + JUnit XML
- **输出目录**: `./test-results/junit.xml`

缺失测试的包: `web`, `database`, `gateway`

---

## Docker

- `docker/api.Dockerfile` — 多阶段构建 (API + Web 目标)
- `docker/agent.Dockerfile` — 安全隔离 Agent 容器
- `docker/docker-compose.yml` — 生产部署 (API + Web + Agent + Redis)
- `docker/docker-compose.dev.yml` — 开发环境叠加

---

## CI/CD

- `.github/workflows/ci.yml` — Bun (lint/typecheck/test/build)
- `.github/workflows/release.yml` — 自动 Docker 镜像构建 + 推送
- `scripts/build.js` — 清理/构建/验证
- `scripts/docker-build.js` — 多镜像并行构建
- `scripts/release.js` — 交互式版本管理 + changelog
- **Git Hooks**: Husky + lint-staged（提交前自动 lint 和 format）

---

## 反模式警告

- **core 依赖 container** — 非典型，因 core 需要 Docker 隔离
- **Provider/Agent 重命名导出** — 避免跨模块类型冲突
- **adapters `as unknown as`** — 工厂函数因各平台 config 类型不同
- **CLI `@ts-expect-error`** — `agent/context.ts:15` 为 token budget 预留
- **Redis `@ts-expect-error`** — `cache/redis.ts:121` 因 ioredis 可选依赖
- **API 使用 Hono** — 替代 Express，更轻量且性能更好

---

## 环境变量

关键变量（完整列表见 `.env.example`）：

```env
# 服务器配置
PORT=3000
HOST=localhost
NODE_ENV=development

# 安全密钥 (生产环境必须设置)
JWT_SECRET=
SESSION_SECRET=
ENCRYPTION_KEY=

# AI Provider (推荐)
AI_PROVIDER=openai         # openai|anthropic|deepseek|moonshot|zhipu
OPENAI_API_KEY=
OPENAI_MODEL=gpt-4o

# 数据库
DATABASE_TYPE=sqlite       # sqlite|mysql|postgres
DATABASE_PATH=./data/sacode.db

# Redis 缓存 (可选)
REDIS_ENABLED=false
REDIS_HOST=localhost
REDIS_PORT=6379

# IM 平台
TELEGRAM_BOT_TOKEN=
DISCORD_BOT_TOKEN=
XIAOYI_AK=
XIAOYI_SK=

# OAuth
GITHUB_CLIENT_ID=
GITHUB_CLIENT_SECRET=
WECHAT_APP_ID=
WECHAT_APP_SECRET=
QQ_APP_ID=
QQ_APP_KEY=

# 能力配置
CAP_FILES_ENABLED=true
CAP_BROWSER_ENABLED=true
CAP_SHELL_ENABLED=true

# Web UI
FRONTEND_URL=http://localhost:5173
API_BASE_URL=http://localhost:3000
```

---

## 核心特性

### AI Provider 抽象层
- **支持 5 个主流 AI 提供商**: OpenAI, Anthropic, DeepSeek, Moonshot, 智谱
- **统一接口**: `createProvider()` 工厂函数，自动路由到不同提供商
- **流式输出**: 完整支持 SSE 流式响应
- **模型分类**: 按用途分类路由（聊天、代码、嵌入等）

### 多端 IM 支持
- **10 个平台**: 微信、QQ、Telegram、Discord、钉钉、飞书、小艺、WhatsApp、Slack、Email
- **统一接口**: `IMAdapter` 接口，`createAdapter()` 工厂函数
- **高级功能**: 钉钉 AI Card 流式输出、Telegram Bot API、Discord Gateway

### Agentic 编排
- **专家 Agent 系统**: 7 个专业 Agent（代码、架构、前端、后端等）
- **自主规划**: Ralph 模式自动识别任务类型并规划执行
- **PCIV 流程**: Prime → Clarify → Implement → Validate 四阶段开发流程
- **Ultrawork**: 自动化执行循环，Todo 强制执行

### 自动化能力
- **文件系统**: 读写、编辑、删除、目录遍历
- **浏览器控制**: Playwright 驱动，支持截图、点击、表单填写
- **Shell 命令**: 安全执行，支持白名单
- **Web 搜索**: DuckDuckGo 搜索 + HTTP 客户端
- **代码搜索**: ripgrep 高性能代码搜索
- **LSP 集成**: 7 种操作（定义、引用、补全、诊断等）
- **Git Worktree**: 多分支并行开发支持

### 认证与安全
- **混合认证**: 本地账号 + OAuth 5 提供商（GitHub、Google、微信、QQ、企业微信）
- **JWT + Session**: 双重认证机制
- **权限管理**: 基于角色的访问控制（RBAC）
- **沙盒模式**: Docker 容器隔离，安全执行危险操作

### 数据库支持
- **多数据库**: SQLite（默认）、MySQL、PostgreSQL
- **Prisma ORM**: 类型安全的数据库访问
- **17 个模型**: 用户、会话、消息、任务、插件等
- **迁移管理**: 自动化数据库迁移和版本控制

### 插件系统
- **MCP 协议**: Model Context Protocol 支持
- **Skill Hub**: 技能注册中心（ClawHub + SkillHub）
- **热加载**: 动态加载和卸载插件
- **依赖管理**: 自动解析插件依赖

---

## 开发工作流

1. **克隆项目**
   ```bash
   git clone https://gitcode.com/STAND-ALONE/SaCode.git
   cd SaCode
   ```

2. **安装依赖**
   ```bash
   bun install
   ```

3. **配置环境变量**
   ```bash
   cp .env.example .env
   # 编辑 .env 文件，填入必要的 API 密钥
   ```

4. **初始化数据库**
   ```bash
   bun run --filter @sacode/database db:push
   ```

5. **启动开发服务器**
   ```bash
   # 终端 1: 启动 API
   bun api

   # 终端 2: 启动 Web UI
   bun web

   # 终端 3: 启动 CLI
   bun cli
   ```

6. **运行测试**
   ```bash
   bun test
   ```

---

## 许可证

**MulanPSL-2.0** (木兰宽松许可证 v2)

---

## 作者

**STAND-ALONE**
- Email: 1635936133@qq.com
- GitCode: [@STAND-ALONE](https://gitcode.com/STAND-ALONE)

---

*最后更新：2026-04-29*