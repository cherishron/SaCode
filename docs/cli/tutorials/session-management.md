# Manage sessions and history

Learn how to manage, resume, and list conversation sessions using SaCode CLI.

## Overview

SaCode CLI provides session management through the `session` command and the underlying `SessionManager` in `@sacode/core`. Sessions persist conversation history across restarts.

## Listing sessions

Terminal window

```bash
# List all sessions
sacode session list

# Filter by platform
sacode session list -c telegram

# Filter by chat ID
sacode session list --chat-id "chat_123"
```

## Viewing session details

Terminal window

```bash
sacode session info <sessionId>
```

This displays the session's message history, platform, channel, and metadata.

## Resuming a session

Terminal window

```bash
sacode chat -s <sessionId>
```

The AI will load the conversation history and continue from where you left off.

## Clearing sessions

Terminal window

```bash
# Clear a specific session
sacode session clear <sessionId>

# Clear all sessions
sacode session clear

# Clear sessions for a specific platform
sacode session clear -c telegram
```

## Cross-platform session mapping

SaCode's `SessionMapper` unifies sessions across different IM platforms:

```
telegram:chat_123  ──┐
wechat:user_456    ──┼──▶ unified-session-abc
discord:guild_789  ──┘
```

This means a user interacting via Telegram and WeChat can share the same conversation context.

## Session storage

Sessions are stored in the database (SQLite/MySQL/PostgreSQL) via Prisma ORM:

| Model         | Description                                         |
| ------------- | --------------------------------------------------- |
| `ChatSession` | Session metadata (platform, channel, model)         |
| `ChatMessage` | Individual messages with role, content, token count |

## Session lifecycle

```
Create → Add Messages → Query AI → Persist → Resume/Clear
```

- Sessions are created automatically on first message
- Messages are appended after each AI response
- Sessions persist across server restarts
- Expired sessions can be cleared manually

## Next steps

- **[Manage context and memory](/docs/cli/tutorials/memory-management/)** — Manage conversation memory
- **[Session management API](/docs/api/chat.md)** — REST API for sessions
- **[Database schema](/docs/database/schema.md)** — Data model details
