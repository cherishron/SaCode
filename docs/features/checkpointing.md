# Checkpointing

Session state management in SaCode CLI.

## Overview

Checkpointing allows SaCode to save and restore conversation state, enabling seamless session resumption across server restarts and crashes.

## How checkpointing works

```
Active Session ──▶ Periodic Save ──▶ Database Storage
                                              │
                                    Crash/Restart
                                              │
                                    Load Checkpoint ──▶ Restore Session
```

## Checkpoint components

| Component           | Description                   |
| ------------------- | ----------------------------- |
| **Session state**   | Current conversation context  |
| **Message history** | Full message log with roles   |
| **Tool state**      | In-progress tool executions   |
| **Memory state**    | Vector embeddings and context |

## Automatic checkpointing

Sessions are automatically saved:

- After each AI response
- Before server shutdown
- At configurable intervals

## Manual checkpoint management

### List sessions

Terminal window

```bash
sacode session list
```

### Resume a session

Terminal window

```bash
sacode chat -s session-abc-123
```

### Clear a session

Terminal window

```bash
sacode session clear session-abc-123
```

## Database storage

Checkpoints are stored in the database via Prisma ORM:

| Model            | Description                    |
| ---------------- | ------------------------------ |
| `ChatSession`    | Session metadata and state     |
| `ChatMessage`    | Individual messages            |
| `SessionMapping` | Cross-platform session mapping |

## Configuration

Terminal window

```env
# Session storage
DATABASE_TYPE=sqlite
DATABASE_PATH=./data/sacode.db

# Memory settings
MEMORY_MAX_MESSAGES=100
```

## Next steps

- **[Session management](/docs/cli/tutorials/session-management/)** — Manage conversations
- **[Database schema](/docs/database/schema.md)** — Data model details
- **[Settings](/docs/features/settings/)** — All configurable settings
