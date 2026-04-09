# Headless mode

Programmatic and scripting interface for SaCode CLI.

## Overview

Headless mode allows you to use SaCode CLI non-interactively, making it suitable for scripting, CI/CD pipelines, and automation workflows. Instead of entering an interactive chat session, you send a single message and receive the response.

## Basic usage

Terminal window

```bash
# Send a single message and exit
sacode chat -m "What is the capital of France?"

# Resume a specific session
sacode chat -m "Continue from last message" -s session-abc-123
```

## Scripting examples

### Simple Q&A

Terminal window

```bash
#!/bin/bash
response=$(sacode chat -m "Explain TypeScript generics in one sentence")
echo "$response"
```

### Code review in CI

Terminal window

```bash
#!/bin/bash
# Review the latest git diff
diff=$(git diff HEAD~1)
sacode chat -m "Review this code diff and provide feedback: $diff"
```

### Batch processing

Terminal window

```bash
#!/bin/bash
# Process multiple files
for file in *.ts; do
  sacode chat -m "Summarize this file: $(cat $file)"
done
```

## Output handling

Headless mode outputs the AI response to stdout, making it pipeable:

Terminal window

```bash
# Pipe to a file
sacode chat -m "Generate a project summary" > summary.md

# Pipe to another command
sacode chat -m "List all TypeScript files" | grep ".ts"
```

## Session management in headless mode

Each headless invocation creates or resumes a session:

Terminal window

```bash
# Create a new session (auto-assigned)
sacode chat -m "Start a new conversation"

# Resume a specific session
sacode chat -m "What were we discussing?" -s session-abc-123
```

## Limitations

| Aspect                  | Interactive mode | Headless mode         |
| ----------------------- | ---------------- | --------------------- |
| Multi-turn conversation | ✅ Yes           | ⚠️ Via session resume |
| Tool execution          | ✅ Full          | ✅ Full               |
| Streaming output        | ✅ Yes           | ⚠️ Buffered           |
| User confirmation       | ✅ Interactive   | ❌ Auto-approved      |
| File attachments        | ✅ Yes           | ❌ Not supported      |

## Use cases

| Use case                     | Example                            |
| ---------------------------- | ---------------------------------- |
| **CI/CD code review**        | Automated PR review in pipeline    |
| **Documentation generation** | Batch generate docs from code      |
| **Data analysis**            | Process CSV/JSON files via scripts |
| **Translation**              | Batch translate content            |
| **Summarization**            | Summarize multiple documents       |

## Configuration

Headless mode inherits all environment configuration:

Terminal window

```env
# Same AI Provider config applies
AI_PROVIDER=openai
AI_MODEL=gpt-4o

# Tool loop limit applies to headless too
MAX_TOOL_LOOP_ITERATIONS=10
```

## Next steps

- **[CLI cheatsheet](/docs/cli/cli-reference/)** — All CLI commands
- **[Automate tasks](/docs/cli/tutorials/automation/)** — Schedule recurring tasks
- **[Execute shell commands](/docs/cli/tutorials/shell-commands/)** — Shell integration
