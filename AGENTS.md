# SaCode — 全栈 AI 助手开发框架

> 统一 AI 接入 · 多端 IM 覆盖 · Agentic 工具编排 · 现代化技术栈

**SaCode** 是一个企业级 AI 助手开发框架，提供从 CLI 到 Web 再到 IM 的全栈解决方案。

- **统一 AI 接入**：通过 Provider 抽象层无缝对接 OpenAI、Anthropic、DeepSeek、Moonshot、智谱 5 大 AI 服务
- **多端 IM 覆盖**：内置 10 个 IM 平台适配器（微信、QQ、Telegram、Discord、钉钉、飞书、小艺、WhatsApp、Slack、Email）
- **Agentic 工具编排**：Registry + Planner + Orchestrator 三层架构，支持 40+ 内置工具和 MCP 协议扩展
- **现代化技术栈**：Bun 运行时 + TypeScript 严格模式 + Vue 3 + Hono + Prisma ORM

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

## 反模式警告

- **core 依赖 container** — 非典型，因 core 需要 Docker 隔离
- **Provider/Agent 重命名导出** — 避免跨模块类型冲突
- **adapters `as unknown as`** — 工厂函数因各平台 config 类型不同
- **CLI `@ts-expect-error`** — `agent/context.ts:15` 为 token budget 预留
- **Redis `@ts-expect-error`** — `cache/redis.ts:121` 因 ioredis 可选依赖
- **API 使用 Hono** — 替代 Express，更轻量且性能更好

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
