# Installation

Install SaCode CLI on your system.

## System requirements

| Requirement | Version                 | Notes           |
| ----------- | ----------------------- | --------------- |
| **Node.js** | 22+                     | LTS recommended |
| **pnpm**    | 9+                      | Package manager |
| **Git**     | 2.40+                   | Version control |
| **OS**      | Windows / macOS / Linux | All supported   |

## Install from source

### Step 1: Clone the repository

Terminal window

```bash
git clone https://github.com/STAND-ALONE/SaCode.git
cd SaCode
```

### Step 2: Install dependencies

Terminal window

```bash
pnpm install
```

This installs all workspace packages and their dependencies.

### Step 3: Initialize the database

Terminal window

```bash
# Generate Prisma Client
pnpm -C packages/database prisma generate

# Push the schema to the database
pnpm -C packages/database prisma db push
```

For production deployments, use migrations instead:

Terminal window

```bash
pnpm -C packages/database prisma migrate dev
```

### Step 4: Configure environment variables

Terminal window

```bash
cp .env.example .env
```

Edit `.env` with your configuration. At minimum, set your AI Provider:

Terminal window

```env
AI_PROVIDER=openai
OPENAI_API_KEY=sk-your-api-key-here
AI_MODEL=gpt-4o
```

## Verify installation

Run the CLI to verify everything is working:

Terminal window

```bash
pnpm cli
```

You should see the help output:

```
🦞 SACODE - 多端 AI 助手框架

常用命令:
  SACODE chat              启动交互式聊天
  SACODE start             启动服务
  SACODE status show       查看系统状态
  SACODE session list      列出所有会话
  SACODE cron list         列出定时任务
  SACODE model list        列出可用模型
  SACODE im list           列出 IM 连接
  SACODE workspace init    初始化工作空间
  SACODE skills search     搜索技能
  SACODE config list       查看配置

使用 --help 查看更多命令
```

## Run tests

Ensure everything is working correctly:

Terminal window

```bash
pnpm test
```

All tests should pass (174+ test cases).

## Development mode

Start all packages in development mode:

Terminal window

```bash
pnpm dev
```

Or start individual packages:

Terminal window

```bash
# API server only
pnpm -C packages/api dev

# Web UI only
pnpm -C packages/web dev

# CLI only
pnpm cli chat
```

## Build for production

Terminal window

```bash
pnpm build
```

This compiles all TypeScript to JavaScript in each package's `dist/` directory.

## Docker installation

Alternatively, use Docker for a containerized setup:

Terminal window

```bash
# Build the image
pnpm docker:build

# Start all services
pnpm docker:up

# View logs
docker compose -f docker/docker-compose.yml logs -f
```

See the [deployment guide](/docs/guides/deployment.md) for production deployment details.

## Platform-specific notes

### Windows

- Ensure Node.js 22+ is installed from [nodejs.org](https://nodejs.org/)
- Use PowerShell or Windows Terminal for best experience
- Bun runtime is supported: `bun run --hot src/cli.ts`

### macOS

- Use Homebrew to install Node.js: `brew install node`
- Install pnpm: `brew install pnpm`

### Linux

- Use your distribution's package manager or [nvm](https://github.com/nvm-sh/nvm) for Node.js
- Install pnpm: `npm install -g pnpm`

## Next steps

- **[Quickstart](/docs/get-started/)** — Your first session with SaCode CLI
- **[Authentication](/docs/get-started/authentication/)** — Setup authentication providers
- **[CLI cheatsheet](/docs/cli/cli-reference/)** — Quick reference for all commands
