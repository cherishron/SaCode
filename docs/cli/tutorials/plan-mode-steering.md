# Plan mode

Use a safe, read-only mode for planning complex changes before execution.

## Overview

Plan mode allows the AI model to analyze code, understand architecture, and generate implementation plans without making any changes. This is useful for:

- Reviewing complex refactoring approaches
- Understanding unfamiliar codebases
- Generating implementation plans before committing to changes
- Evaluating multiple approaches to a problem

## Using plan mode

Within an interactive chat session, ask the AI to plan before acting:

Terminal window

```bash
sacode chat -m "分析一下这个项目的架构，给出重构建议"
```

The AI will analyze the codebase and provide a detailed plan without modifying any files.

## Plan mode characteristics

| Characteristic       | Description                               |
| -------------------- | ----------------------------------------- |
| **Read-only**        | Only reads files, never writes            |
| **Analysis-focused** | Provides detailed code analysis           |
| **Plan generation**  | Outputs step-by-step implementation plans |
| **No side effects**  | Safe to use on any codebase               |

## When to use plan mode

- **Before major refactoring** — Understand the impact of changes
- **When exploring new codebases** — Get a guided tour of the architecture
- **For complex features** — Break down the implementation into manageable steps
- **Code review** — Get an AI perspective on code quality and patterns

## Example workflow

```
1. Enter plan mode
   "帮我规划如何给这个项目添加 WebSocket 实时通知"

2. Review the generated plan
   - Architecture analysis
   - File changes needed
   - Implementation steps
   - Risk assessment

3. Execute the plan
   "按照这个计划开始实施"
```

## Next steps

- **[File management](/docs/cli/tutorials/file-management/)** — Work with local files after planning
- **[Execute shell commands](/docs/cli/tutorials/shell-commands/)** — Run commands to implement plans
- **[Model selection](/docs/features/model-selection/)** — Choose the best model for planning tasks
