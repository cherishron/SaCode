# Configuration reference

Complete reference for all SaCode settings and environment variables.

## Configuration layers

SaCode supports configuration through multiple layers (in order of precedence):

1. **Command-line flags** — Highest priority
2. **Environment variables** — Per-process settings
3. **`.env` file** — Project-level configuration
4. **Default values** — Built-in defaults

## Environment variables

### Server

| Variable | Type   | Default     | Description |
| -------- | ------ | ----------- | ----------- |
| `PORT`   | number | `3000`      | Server port |
| `HOST`   | string | `localhost` | Server host |

### AI Provider

| Variable                   | Type    | Default  | Description                                                      |
| -------------------------- | ------- | -------- | ---------------------------------------------------------------- |
| `AI_PROVIDER`              | string  | `openai` | Provider: `openai`, `anthropic`, `deepseek`, `moonshot`, `zhipu` |
| `AI_MODEL`                 | string  | `gpt-4o` | Model identifier                                                 |
| `AI_TIMEOUT`               | number  | `60000`  | Request timeout (ms)                                             |
| `OPENAI_API_KEY`           | string  | -        | OpenAI API key                                                   |
| `OPENAI_BASE_URL`          | string  | -        | OpenAI base URL (for proxies)                                    |
| `ANTHROPIC_API_KEY`        | string  | -        | Anthropic API key                                                |
| `DEEPSEEK_API_KEY`         | string  | -        | DeepSeek API key                                                 |
| `MOONSHOT_API_KEY`         | string  | -        | Moonshot API key                                                 |
| `ZHIPU_API_KEY`            | string  | -        | Zhipu API key                                                    |
| `MAX_TOOL_LOOP_ITERATIONS` | number  | `10`     | Maximum tool execution loops                                     |
| `ENABLE_AGENTIC_PLANNING`  | boolean | `true`   | Enable automatic planning mode                                   |

### Database

| Variable        | Type   | Default            | Description                             |
| --------------- | ------ | ------------------ | --------------------------------------- |
| `DATABASE_TYPE` | string | `sqlite`           | Database: `sqlite`, `mysql`, `postgres` |
| `DATABASE_PATH` | string | `./data/sacode.db` | SQLite file path                        |

### Cache

| Variable        | Type   | Default  | Description                |
| --------------- | ------ | -------- | -------------------------- |
| `CACHE_BACKEND` | string | `memory` | Backend: `memory`, `redis` |
| `REDIS_URL`     | string | -        | Redis connection URL       |

### Authentication

| Variable             | Type    | Default                 | Description                 |
| -------------------- | ------- | ----------------------- | --------------------------- |
| `AUTH_LOCAL_ENABLED` | boolean | `true`                  | Enable local authentication |
| `JWT_SECRET`         | string  | -                       | JWT signing secret          |
| `SESSION_SECRET`     | string  | -                       | Session signing secret      |
| `ENCRYPTION_KEY`     | string  | -                       | AES-256-GCM encryption key  |
| `FRONTEND_URL`       | string  | `http://localhost:5173` | Frontend URL for CORS       |
| `BASE_URL`           | string  | `http://localhost:3000` | Backend base URL            |

### OAuth — GitHub

| Variable               | Type   | Description                |
| ---------------------- | ------ | -------------------------- |
| `GITHUB_CLIENT_ID`     | string | GitHub OAuth client ID     |
| `GITHUB_CLIENT_SECRET` | string | GitHub OAuth client secret |

### OAuth — Google

| Variable               | Type   | Description                |
| ---------------------- | ------ | -------------------------- |
| `GOOGLE_CLIENT_ID`     | string | Google OAuth client ID     |
| `GOOGLE_CLIENT_SECRET` | string | Google OAuth client secret |

### OAuth — 微信

| Variable            | Type   | Description       |
| ------------------- | ------ | ----------------- |
| `WECHAT_APP_ID`     | string | WeChat App ID     |
| `WECHAT_APP_SECRET` | string | WeChat App secret |

### OAuth — QQ

| Variable     | Type   | Description |
| ------------ | ------ | ----------- |
| `QQ_APP_ID`  | string | QQ App ID   |
| `QQ_APP_KEY` | string | QQ App key  |

### OAuth — 企业微信

| Variable          | Type   | Description                |
| ----------------- | ------ | -------------------------- |
| `WEWORK_CORP_ID`  | string | Enterprise WeChat Corp ID  |
| `WEWORK_AGENT_ID` | string | Enterprise WeChat Agent ID |
| `WEWORK_SECRET`   | string | Enterprise WeChat secret   |

### IM — Telegram

| Variable             | Type   | Description            |
| -------------------- | ------ | ---------------------- |
| `TELEGRAM_BOT_TOKEN` | string | Telegram Bot API token |

### IM — Discord

| Variable            | Type   | Description       |
| ------------------- | ------ | ----------------- |
| `DISCORD_BOT_TOKEN` | string | Discord Bot token |

### IM — 小艺 (Huawei Xiaoyi)

| Variable          | Type   | Description |
| ----------------- | ------ | ----------- |
| `XIAOYI_AK`       | string | Access Key  |
| `XIAOYI_SK`       | string | Secret Key  |
| `XIAOYI_AGENT_ID` | string | Agent ID    |

### IM — 钉钉

| Variable              | Type   | Description         |
| --------------------- | ------ | ------------------- |
| `DINGTALK_APP_KEY`    | string | DingTalk App key    |
| `DINGTALK_APP_SECRET` | string | DingTalk App secret |

### Capabilities — Files

| Variable                 | Type    | Default    | Description                           |
| ------------------------ | ------- | ---------- | ------------------------------------- |
| `CAP_FILES_ENABLED`      | boolean | `true`     | Enable file capabilities              |
| `CAP_FILES_ALLOWED_DIRS` | string  | `.`        | Allowed directories (comma-separated) |
| `CAP_FILES_MAX_SIZE`     | number  | `10485760` | Maximum file size (bytes)             |
| `CAP_FILES_READ_ONLY`    | boolean | `false`    | Read-only mode                        |

### Capabilities — Browser

| Variable               | Type    | Default | Description            |
| ---------------------- | ------- | ------- | ---------------------- |
| `CAP_BROWSER_ENABLED`  | boolean | `true`  | Enable browser control |
| `CAP_BROWSER_HEADLESS` | boolean | `true`  | Headless mode          |

### Capabilities — Shell

| Variable                     | Type    | Default | Description                        |
| ---------------------------- | ------- | ------- | ---------------------------------- |
| `CAP_SHELL_ENABLED`          | boolean | `true`  | Enable shell execution             |
| `CAP_SHELL_ALLOWED_COMMANDS` | string  | -       | Allowed commands (comma-separated) |
| `CAP_SHELL_TIMEOUT`          | number  | `60000` | Command timeout (ms)               |

### Capabilities — Web

| Variable                        | Type    | Default      | Description             |
| ------------------------------- | ------- | ------------ | ----------------------- |
| `CAP_WEB_ENABLED`               | boolean | `true`       | Enable web capabilities |
| `CAP_WEB_SEARCH_ENABLED`        | boolean | `true`       | Enable web search       |
| `CAP_WEB_SEARCH_PROVIDER`       | string  | `duckduckgo` | Search provider         |
| `CAP_WEB_SEARCH_TIMEOUT`        | number  | `10000`      | Search timeout (ms)     |
| `CAP_WEB_FETCH_ENABLED`         | boolean | `true`       | Enable web fetch        |
| `CAP_WEB_FETCH_DEFAULT_TIMEOUT` | number  | `30000`      | Fetch timeout (ms)      |
| `CAP_WEB_HTTP_ENABLED`          | boolean | `true`       | Enable HTTP requests    |
| `CAP_WEB_HTTP_DEFAULT_TIMEOUT`  | number  | `30000`      | HTTP timeout (ms)       |
| `CAP_WEB_HTTP_MAX_REDIRECTS`    | number  | `5`          | Maximum redirects       |

### MCP

| Variable          | Type    | Default      | Description       |
| ----------------- | ------- | ------------ | ----------------- |
| `MCP_ENABLED`     | boolean | `true`       | Enable MCP server |
| `MCP_SERVER_PORT` | number  | `8080`       | MCP server port   |
| `MCP_SERVER_NAME` | string  | `sacode-mcp` | MCP server name   |

### Memory

| Variable                   | Type    | Default  | Description                  |
| -------------------------- | ------- | -------- | ---------------------------- |
| `MEMORY_BACKEND`           | string  | `memory` | Backend: `memory`, `sqlite`  |
| `MEMORY_MAX_MESSAGES`      | number  | `100`    | Maximum messages per session |
| `MEMORY_ENABLE_EMBEDDINGS` | boolean | `false`  | Enable vector embeddings     |

## Next steps

- **[Command reference](/docs/reference/commands/)** — All CLI commands
- **[Environment variables guide](/docs/configuration/environment-variables/)** — Detailed variable documentation
- **[Model configuration](/docs/configuration/model-configuration/)** — Model-specific settings
