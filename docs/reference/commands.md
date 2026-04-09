# Command reference

Complete reference for all SaCode CLI commands and slash commands.

## CLI commands

### Global options

| Flag                  | Type    | Description                     |
| --------------------- | ------- | ------------------------------- |
| `-d, --debug`         | boolean | Enable debug mode               |
| `-c, --config <path>` | string  | Specify configuration file path |
| `--help`              | boolean | Show help information           |
| `--version`           | boolean | Show version number             |

### chat

Interactive chat mode with the AI assistant.

| Option                      | Type   | Description                             |
| --------------------------- | ------ | --------------------------------------- |
| `-m, --message <message>`   | string | Send a single message (non-interactive) |
| `-s, --session <sessionId>` | string | Resume a specific session               |

### config

Configuration management.

| Subcommand                 | Description                        |
| -------------------------- | ---------------------------------- |
| `config list`              | List all configuration values      |
| `config get <key>`         | Get a specific configuration value |
| `config set <key> <value>` | Set a configuration value          |

### start

Start SaCode services.

| Option              | Type    | Description           | Default     |
| ------------------- | ------- | --------------------- | ----------- |
| `-p, --port <port>` | number  | Service port          | `3000`      |
| `-h, --host <host>` | string  | Service host          | `localhost` |
| `--api`             | boolean | Start API server only | `false`     |
| `--web`             | boolean | Start Web UI only     | `false`     |

### status

System status and diagnostics.

| Subcommand        | Description                 |
| ----------------- | --------------------------- |
| `status show`     | Show system status          |
| `status diagnose` | Show diagnostic information |
| `status health`   | Check service health        |

### session

Session management.

| Subcommand                                     | Description          |
| ---------------------------------------------- | -------------------- |
| `session list [-c <channel>] [--chat-id <id>]` | List sessions        |
| `session info <sessionId>`                     | Show session details |
| `session clear [sessionId] [-c <channel>]`     | Clear session(s)     |

### model

Model management.

| Subcommand                            | Description                |
| ------------------------------------- | -------------------------- |
| `model list`                          | List all available models  |
| `model current`                       | Show current model         |
| `model set <modelId>`                 | Set default model          |
| `model configure <modelId> [options]` | Configure model parameters |

Model configuration options:

| Option                      | Type   | Description                |
| --------------------------- | ------ | -------------------------- |
| `-t, --temperature <value>` | number | Temperature (0.0 - 2.0)    |
| `-m, --max-tokens <value>`  | number | Maximum tokens             |
| `-p, --top-p <value>`       | number | Top-p sampling (0.0 - 1.0) |

### cron

Cron job management.

| Subcommand             | Description                |
| ---------------------- | -------------------------- |
| `cron list [-a]`       | List cron jobs             |
| `cron add [options]`   | Add a new cron job         |
| `cron remove <jobId>`  | Delete a cron job          |
| `cron enable <jobId>`  | Enable a cron job          |
| `cron disable <jobId>` | Disable a cron job         |
| `cron run <jobId>`     | Run a cron job immediately |

Cron add options:

| Option                    | Type    | Description                          | Default    |
| ------------------------- | ------- | ------------------------------------ | ---------- |
| `-n, --name <name>`       | string  | Job name                             | Required   |
| `-m, --message <message>` | string  | Message content                      | Required   |
| `-t, --type <type>`       | string  | Job type: `interval`, `cron`, `once` | `interval` |
| `-e, --every <seconds>`   | string  | Interval in seconds                  | -          |
| `-c, --cron <expression>` | string  | Cron expression                      | -          |
| `-a, --at <datetime>`     | string  | Execution time (once type)           | -          |
| `--channel <channel>`     | string  | Target platform                      | `telegram` |
| `--to <chatId>`           | string  | Target chat ID                       | -          |
| `-d, --disable`           | boolean | Create in disabled state             | `false`    |

### im

IM platform management.

| Subcommand                            | Description                |
| ------------------------------------- | -------------------------- |
| `im list`                             | List all IM connections    |
| `im connect <platform> [-c <config>]` | Connect to a platform      |
| `im disconnect <platform>`            | Disconnect from a platform |

### plugin

Plugin management.

| Subcommand              | Description      |
| ----------------------- | ---------------- |
| `plugin list`           | List all plugins |
| `plugin install <path>` | Install a plugin |
| `plugin enable <name>`  | Enable a plugin  |
| `plugin disable <name>` | Disable a plugin |

### tool

Tool management.

| Subcommand                          | Description                |
| ----------------------------------- | -------------------------- |
| `tool list`                         | List all available tools   |
| `tool run <name> [-p key=value...]` | Run a tool with parameters |

### skills

Skill management (ClawHub/SkillHub registries).

| Subcommand                                                         | Description           |
| ------------------------------------------------------------------ | --------------------- |
| `skills search [query] [-t <tags>] [-l <limit>] [-r <registry>]`   | Search skills         |
| `skills install <slug> [-v <version>] [-f] [-r <registry>]`        | Install a skill       |
| `skills update [slug] [-v <version>] [-r <registry>]`              | Update skills         |
| `skills list`                                                      | List installed skills |
| `skills uninstall <slug>`                                          | Uninstall a skill     |
| `skills login [-t <token>] [-r <registry>]`                        | Login to registry     |
| `skills publish <path> [-s <slug>] [-v <version>] [-r <registry>]` | Publish a skill       |

Skills options:

| Option                      | Type    | Description                            | Default   |
| --------------------------- | ------- | -------------------------------------- | --------- |
| `-t, --tags <tags>`         | string  | Filter by tags (comma-separated)       | -         |
| `-l, --limit <number>`      | number  | Result count limit                     | `20`      |
| `-r, --registry <registry>` | string  | Registry source: `clawhub`, `skillhub` | `clawhub` |
| `-v, --version <version>`   | string  | Specify version                        | -         |
| `-f, --force`               | boolean | Force overwrite                        | `false`   |

### workspace

Workspace management.

| Subcommand                  | Description          |
| --------------------------- | -------------------- |
| `workspace init [template]` | Initialize workspace |
| `workspace show`            | Show workspace info  |
| `workspace templates`       | List all templates   |
| `workspace edit <filename>` | Edit workspace file  |

## Exit codes

| Code | Description                  |
| ---- | ---------------------------- |
| `0`  | Success                      |
| `1`  | General error                |
| `2`  | Invalid command or arguments |
| `3`  | Configuration error          |
| `4`  | Connection error             |

## Next steps

- **[Configuration reference](/docs/reference/configuration/)** — All settings and environment variables
- **[Tools reference](/docs/reference/tools/)** — Tool definitions and usage
- **[CLI cheatsheet](/docs/cli/cli-reference/)** — Quick reference card
