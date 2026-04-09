# CLI cheatsheet

Quick reference for all SaCode CLI commands and options.

## Global options

| Flag                  | Description                     |
| --------------------- | ------------------------------- |
| `-d, --debug`         | Enable debug mode               |
| `-c, --config <path>` | Specify configuration file path |
| `--help`              | Show help for any command       |
| `--version`           | Show version number             |

## Commands

### Chat

| Command                      | Description                 |
| ---------------------------- | --------------------------- |
| `sacode chat`                | Start interactive chat mode |
| `sacode chat -m "message"`   | Send a single message       |
| `sacode chat -s <sessionId>` | Resume a specific session   |

### Server

| Command                   | Description                    |
| ------------------------- | ------------------------------ |
| `sacode start`            | Start all services (API + Web) |
| `sacode start --api`      | Start API server only          |
| `sacode start --web`      | Start Web UI only              |
| `sacode start -p 8080`    | Start on custom port           |
| `sacode start -h 0.0.0.0` | Bind to all interfaces         |

### Status

| Command                  | Description                 |
| ------------------------ | --------------------------- |
| `sacode status show`     | Show system status          |
| `sacode status diagnose` | Show diagnostic information |
| `sacode status health`   | Check service health        |

### Session management

| Command                           | Description                        |
| --------------------------------- | ---------------------------------- |
| `sacode session list`             | List all sessions                  |
| `sacode session list -c telegram` | List sessions filtered by platform |
| `sacode session info <id>`        | Show session details               |
| `sacode session clear`            | Clear all sessions                 |
| `sacode session clear <id>`       | Clear specific session             |

### Model management

| Command                               | Description                 |
| ------------------------------------- | --------------------------- |
| `sacode model list`                   | List all available models   |
| `sacode model current`                | Show current model          |
| `sacode model set <modelId>`          | Set default model           |
| `sacode model configure <id> -t 0.7`  | Configure model temperature |
| `sacode model configure <id> -m 4096` | Configure max tokens        |
| `sacode model configure <id> -p 0.9`  | Configure top-p             |

### IM platform management

| Command                           | Description                    |
| --------------------------------- | ------------------------------ |
| `sacode im list`                  | List all IM connections        |
| `sacode im connect <platform>`    | Connect to an IM platform      |
| `sacode im disconnect <platform>` | Disconnect from an IM platform |

### Cron job management

| Command                                                            | Description                        |
| ------------------------------------------------------------------ | ---------------------------------- |
| `sacode cron list`                                                 | List all cron jobs                 |
| `sacode cron list -a`                                              | Show all jobs (including disabled) |
| `sacode cron add -n "name" -m "msg" -t interval -e 3600`           | Add interval job                   |
| `sacode cron add -n "name" -m "msg" -t cron -c "0 9 * * *"`        | Add cron job                       |
| `sacode cron add -n "name" -m "msg" -t once -a "2026-04-05T09:00"` | Add one-time job                   |
| `sacode cron enable <jobId>`                                       | Enable a cron job                  |
| `sacode cron disable <jobId>`                                      | Disable a cron job                 |
| `sacode cron remove <jobId>`                                       | Delete a cron job                  |
| `sacode cron run <jobId>`                                          | Run a cron job immediately         |

### Plugin management

| Command                        | Description      |
| ------------------------------ | ---------------- |
| `sacode plugin list`           | List all plugins |
| `sacode plugin install <path>` | Install a plugin |
| `sacode plugin enable <name>`  | Enable a plugin  |
| `sacode plugin disable <name>` | Disable a plugin |

### Tool management

| Command                               | Description                |
| ------------------------------------- | -------------------------- |
| `sacode tool list`                    | List all available tools   |
| `sacode tool run <name> -p key=value` | Run a tool with parameters |

### Skills management

| Command                              | Description           |
| ------------------------------------ | --------------------- |
| `sacode skills search [query]`       | Search for skills     |
| `sacode skills search -t "telegram"` | Search by tags        |
| `sacode skills install <slug>`       | Install a skill       |
| `sacode skills list`                 | List installed skills |
| `sacode skills update`               | Update all skills     |
| `sacode skills update <slug>`        | Update specific skill |
| `sacode skills uninstall <slug>`     | Uninstall a skill     |
| `sacode skills login -t <token>`     | Login to registry     |
| `sacode skills publish <path>`       | Publish a skill       |

### Workspace management

| Command                            | Description              |
| ---------------------------------- | ------------------------ |
| `sacode workspace init`            | Initialize workspace     |
| `sacode workspace init <template>` | Initialize with template |
| `sacode workspace show`            | Show workspace info      |
| `sacode workspace templates`       | List all templates       |
| `sacode workspace edit <file>`     | Edit workspace file      |

### Authentication (CodingPlan)

Manage CodingPlan accounts from multiple Chinese cloud providers.

| Command                                                        | Description                          |
| -------------------------------------------------------------- | ------------------------------------ |
| `sacode auth add`                                              | Add account (interactive mode)       |
| `sacode auth add --provider <name> --key <key>`                | Add account for specific provider    |
| `sacode auth add --provider custom --key <key> --url <url>`    | Add account with custom endpoint     |
| `sacode auth list`                                             | List all accounts (grouped)          |
| `sacode auth switch <account-id>`                              | Switch active account                |
| `sacode auth remove <account-id>`                              | Remove an account                    |
| `sacode auth current`                                          | Show current active account          |
| `sacode auth validate`                                         | Validate current account API key     |
| `sacode auth providers`                                        | List all supported providers         |

Supported providers: `aliyun`, `volcengine`, `baidu`, `tencent`, `zhipu`, `minimax`, `ucloud`, `kimi`, `custom`.

### Code Intelligence (Agentic)

Claude Code-style agentic coding with tool use.

| Command                              | Description                            |
| ------------------------------------ | -------------------------------------- |
| `sacode code`                        | Start interactive agentic session      |
| `sacode code run <prompt>`           | Execute single agentic task            |
| `sacode code run <prompt> -i <n>`    | Set max iterations                     |
| `sacode code explain <file>`         | Explain code in a file                 |
| `sacode code search <query>`         | Search code (`-p` pattern, `-r` regex) |
| `sacode code refactor <file>`        | Get refactoring suggestions            |

Built-in tools: `file_read`, `file_write`, `file_search`, `shell_exec`, `code_search`, `diff_apply`.

### Configuration

| Command                           | Description            |
| --------------------------------- | ---------------------- |
| `sacode config list`              | List all configuration |
| `sacode config get <key>`         | Get a config value     |
| `sacode config set <key> <value>` | Set a config value     |

### Extended Configuration

New configuration keys for agentic and CodingPlan features.

| Key                  | Values                        | Default                              | Description                 |
| -------------------- | ----------------------------- | ------------------------------------ | --------------------------- |
| `agent-mode`         | `auto` / `manual`             | `auto`                               | Tool execution mode         |
| `max-iterations`     | number                        | `25`                                 | Max agentic loop iterations |
| `auto-approve`       | comma-separated tool names    | `file_read,file_search,code_search`  | Auto-approved tools         |
| `codingplan-account` | account ID                    | —                                    | Default CodingPlan account  |
| `ui-style`           | `gemini` / `classic`          | `gemini`                             | Terminal UI style           |

## Common workflows

### Start a chat session

Terminal window

```bash
sacode chat
```

### Start the full server

Terminal window

```bash
sacode start
```

### Check system health

Terminal window

```bash
sacode status health
```

### Connect Telegram bot

Terminal window

```bash
sacode im connect telegram -c '{"botToken": "your-token"}'
```

### Schedule a daily reminder

Terminal window

```bash
sacode cron add -n "Daily Reminder" -m "Time to stand up!" -t cron -c "0 9 * * *" --channel telegram --to "chat_123"
```

### Search and install a skill

Terminal window

```bash
sacode skills search telegram
sacode skills install add-telegram
```

### Add a CodingPlan account

Terminal window

```bash
sacode auth add --provider zhipu --key "your-api-key"
sacode auth list
```

### Start an Agentic coding session

Terminal window

```bash
sacode code
```

### Run a single Agentic task

Terminal window

```bash
sacode code run "Refactor the auth module to use dependency injection" -i 10
```
