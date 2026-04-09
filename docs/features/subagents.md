# Subagents

Using specialized agents for specific tasks in SaCode.

## Overview

SaCode's Agent infrastructure provides a registry of specialized agents through the `AgentRegistry` in `@sacode/core`. Each agent has specific capabilities and is assigned tasks based on complexity and domain.

## Default agents

| Agent       | Description                | Capabilities                                |
| ----------- | -------------------------- | ------------------------------------------- |
| `general`   | General-purpose assistant  | Conversation, Q&A, basic tasks              |
| `code`      | Code generation and review | Code writing, refactoring, review           |
| `research`  | Research and analysis      | Web search, data analysis, summarization    |
| `execution` | Task execution             | File operations, shell commands, automation |

## Agent assignment

The `Planner` component assesses task complexity and assigns the appropriate agent:

```
Simple task     → general agent
Code task       → code agent
Research task   → research agent
Complex task    → orchestrator (multiple agents)
```

## Using agents via CLI

Terminal window

```bash
# The AI automatically selects the right agent
sacode chat -m "帮我写一个 Python 脚本"

# Agentic mode with automatic planning
sacode chat -m "分析这个项目的代码质量" --agentic
```

## Programmatic usage

```typescript
import { AgentRegistry, Planner, Orchestrator } from "@sacode/core";

const registry = new AgentRegistry();
const planner = new Planner(registry);
const orchestrator = new Orchestrator(registry, planner);

// Execute with automatic agent selection
const result = await orchestrator.execute("Analyze this codebase");
```

## Next steps

- **[Agent Skills](/docs/features/skills/)** — Extend with skills
- **[Model routing](/docs/features/model-routing/)** — Smart message routing
- **[Automate tasks](/docs/cli/tutorials/automation/)** — Schedule recurring tasks
