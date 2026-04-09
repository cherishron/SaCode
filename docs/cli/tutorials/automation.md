# Automate tasks

Learn how to schedule and manage recurring tasks with SaCode CLI.

## Overview

SaCode CLI provides a comprehensive task scheduling system through the `TaskScheduler` in `@sacode/core` and the `cron` CLI command. Three task types are supported:

| Type         | Description                        | Example                |
| ------------ | ---------------------------------- | ---------------------- |
| **interval** | Repeats at fixed intervals         | Every 5 minutes        |
| **cron**     | Runs on cron schedule              | Every day at 9 AM      |
| **once**     | Runs one time at a specific moment | April 5, 2026 at 10:00 |

## Listing tasks

Terminal window

```bash
# List all active tasks
sacode cron list

# List all tasks (including disabled)
sacode cron list -a
```

## Creating tasks

### Interval tasks

Run a task at regular intervals:

Terminal window

```bash
sacode cron add \
  -n "Health Check" \
  -m "System health check completed" \
  -t interval \
  -e 3600 \
  --channel telegram \
  --to "chat_123"
```

This sends a health check message every 3600 seconds (1 hour).

### Cron tasks

Run a task on a cron schedule:

Terminal window

```bash
sacode cron add \
  -n "Morning Reminder" \
  -m "Good morning! Time to start work." \
  -t cron \
  -c "0 9 * * *" \
  --channel xiaoyi \
  --to "user_456"
```

### One-time tasks

Run a task once at a specific time:

Terminal window

```bash
sacode cron add \
  -n "Meeting Reminder" \
  -m "Meeting starts in 15 minutes" \
  -t once \
  -a "2026-04-05T14:45" \
  --channel wechat \
  --to "user_789"
```

## Managing tasks

Terminal window

```bash
# Enable a task
sacode cron enable <jobId>

# Disable a task
sacode cron disable <jobId>

# Run immediately
sacode cron run <jobId>

# Delete a task
sacode cron remove <jobId>
```

## Programmatic usage

```typescript
import { TaskScheduler } from "@sacode/core";

const scheduler = new TaskScheduler();

// Cron task — every day at 8 AM
scheduler.addTask({
  name: "Morning Report",
  type: "cron",
  config: { cronExpression: "0 8 * * *" },
  message: "Daily report generated",
  channel: "telegram",
  chatId: "chat_123",
});

// Interval task — every 5 minutes
scheduler.addTask({
  name: "Status Check",
  type: "interval",
  config: { interval: 5 * 60 * 1000 },
  message: "System status: OK",
  channel: "xiaoyi",
  chatId: "user_456",
});
```

## Task persistence

Tasks are stored in the database (`CronTask` model) and survive server restarts.

## Next steps

- **[Session management](/docs/cli/tutorials/session-management/)** — Manage conversations
- **[Long task manager](/docs/architecture/modules.md)** — Background task execution
- **[API tasks endpoint](/docs/api/tasks.md)** — REST API for tasks
