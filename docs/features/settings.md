# Settings

Full configuration reference for SaCode CLI.

## Overview

SaCode CLI settings can be configured through multiple layers: environment variables, `.env` files, and CLI flags. This document covers all configurable settings.

## Settings hierarchy

Settings are applied in the following order (highest priority first):

1. **CLI flags** — Passed directly to commands
2. **Environment variables** — Set in shell or `.env` file
3. **Default values** — Built-in defaults

## Core settings

### AI Provider settings

| Setting              | Environment Variable       | Default  | Description                                                        |
| -------------------- | -------------------------- | -------- | ------------------------------------------------------------------ |
| **Provider**         | `AI_PROVIDER`              | `openai` | AI backend: `openai`, `anthropic`, `deepseek`, `moonshot`, `zhipu` |
| **Model**            | `AI_MODEL`                 | `gpt-4o` | Model identifier                                                   |
| **Timeout**          | `AI_TIMEOUT`               | `60000`  | Request timeout (ms)                                               |
| **Tool loop limit**  | `MAX_TOOL_LOOP_ITERATIONS` | `10`     | Maximum tool execution iterations                                  |
| **Agentic planning** | `ENABLE_AGENTIC_PLANNING`  | `true`   | Enable automatic planning mode                                     |

### Server settings

| Setting  | Environment Variable | Default     | Description         |
| -------- | -------------------- | ----------- | ------------------- |
| **Port** | `PORT`               | `3000`      | Server port         |
| **Host** | `HOST`               | `localhost` | Server bind address |

### Database settings

| Setting  | Environment Variable | Default            | Description                             |
| -------- | -------------------- | ------------------ | --------------------------------------- |
| **Type** | `DATABASE_TYPE`      | `sqlite`           | Database: `sqlite`, `mysql`, `postgres` |
| **Path** | `DATABASE_PATH`      | `./data/sacode.db` | SQLite file path                        |

### Cache settings

| Setting       | Environment Variable | Default  | Description              |
| ------------- | -------------------- | -------- | ------------------------ |
| **Backend**   | `CACHE_BACKEND`      | `memory` | Cache: `memory`, `redis` |
| **Redis URL** | `REDIS_URL`          | -        | Redis connection string  |

### Capability settings

| Setting             | Environment Variable     | Default    | Description                |
| ------------------- | ------------------------ | ---------- | -------------------------- |
| **Files enabled**   | `CAP_FILES_ENABLED`      | `true`     | Enable file operations     |
| **Allowed dirs**    | `CAP_FILES_ALLOWED_DIRS` | `.`        | Allowed directories        |
| **Max file size**   | `CAP_FILES_MAX_SIZE`     | `10485760` | Max file size (bytes)      |
| **Read only**       | `CAP_FILES_READ_ONLY`    | `false`    | Read-only file mode        |
| **Browser enabled** | `CAP_BROWSER_ENABLED`    | `true`     | Enable browser control     |
| **Headless**        | `CAP_BROWSER_HEADLESS`   | `true`     | Headless browser mode      |
| **Shell enabled**   | `CAP_SHELL_ENABLED`      | `true`     | Enable shell execution     |
| **Shell timeout**   | `CAP_SHELL_TIMEOUT`      | `60000`    | Shell command timeout (ms) |
| **Web enabled**     | `CAP_WEB_ENABLED`        | `true`     | Enable web capabilities    |

## Managing settings via CLI

Terminal window

```bash
# List all settings
sacode config list

# Get a specific setting
sacode config get AI_PROVIDER

# Set a setting
sacode config set AI_MODEL claude-3-5-sonnet
```

## Settings files

### .env file

The `.env` file in the project root contains all environment variables:

Terminal window

```env
AI_PROVIDER=openai
OPENAI_API_KEY=sk-your-key
AI_MODEL=gpt-4o
AI_TIMEOUT=60000
PORT=3000
DATABASE_TYPE=sqlite
```

### .env.example

A template `.env.example` file is provided with all available settings documented.

## Next steps

- **[Configuration reference](/docs/reference/configuration/)** — Complete environment variable reference
- **[CLI cheatsheet](/docs/cli/cli-reference/)** — Quick command reference
- **[Model configuration](/docs/features/model-selection/)** — Model-specific settings
