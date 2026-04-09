# Agent Skills

Use specialized agents for specific tasks in SaCode CLI.

## Overview

Agent skills are domain-specific capabilities that extend SaCode's functionality. They are discovered through registries (ClawHub and SkillHub) and installed into the `.sacode/skills/` directory.

## How skills work

```
Search Registry → Install → Load → Execute
```

1. **Search** — Query ClawHub or SkillHub for available skills
2. **Install** — Download and verify the skill package
3. **Load** — Skills are loaded from `.sacode/skills/` at startup
4. **Execute** — The AI model uses skills when relevant to the conversation

## Available skills

| Skill          | Description                        |
| -------------- | ---------------------------------- |
| `setup`        | Project initialization skill       |
| `add-telegram` | Add Telegram adapter configuration |
| `add-wechat`   | Add WeChat adapter configuration   |
| `customize`    | Custom configuration templates     |

## Managing skills

See the [skills tutorial](/docs/cli/tutorials/skills-getting-started/) for detailed usage.

## Next steps

- **[Skills tutorial](/docs/cli/tutorials/skills-getting-started/)** — Detailed skills guide
- **[Subagents](/docs/features/subagents/)** — Using specialized agents
- **[Plugin management](/docs/cli/cli-reference.md#plugin-management)** — CLI plugin commands
