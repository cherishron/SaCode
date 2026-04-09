# Execute shell commands

Learn how to execute system commands safely using SaCode CLI.

## Overview

SaCode CLI provides shell command execution capabilities through the `@sacode/capabilities` package. The AI model can run shell commands to interact with the system, install packages, run scripts, and more.

## Available shell tool

| Tool                | Description                                        |
| ------------------- | -------------------------------------------------- |
| `run_shell_command` | Execute shell commands with timeout and validation |

## Basic usage

Within an interactive chat session, ask the AI to run commands:

Terminal window

```bash
sacode chat -m "列出当前目录的文件"
```

The AI will use the `run_shell_command` tool to execute `ls` and return the results.

## Security model

Shell commands require **confirmation before execution**. The permission system classifies commands into three levels:

| Level     | Behavior                   | Examples                    |
| --------- | -------------------------- | --------------------------- |
| **Allow** | Executes automatically     | `ls`, `cat`, `pwd`          |
| **Ask**   | Requires user confirmation | `npm install`, `git commit` |
| **Deny**  | Blocked entirely           | `rm -rf /`, `sudo`          |

### Permission rules

Terminal window

```typescript
const defaultRules = [
  // Read operations — allowed
  { tool: "read_file", action: "allow" },
  { tool: "glob", action: "allow" },
  { tool: "grep", action: "allow" },

  // Write operations — require confirmation
  { tool: "write_file", action: "ask" },
  { tool: "edit_file", action: "ask" },
  { tool: "delete_file", action: "ask" },

  // Dangerous operations — denied
  { tool: "run_shell", action: "ask", condition: isDangerous },
];
```

## Allowed commands

You can restrict which commands are available:

Terminal window

```env
CAP_SHELL_ENABLED=true
CAP_SHELL_ALLOWED_COMMANDS=git,npm,pnpm,node
CAP_SHELL_TIMEOUT=60000
```

## Timeout handling

Shell commands have a configurable timeout (default: 60 seconds). If a command exceeds the timeout, it is terminated and an error is returned.

## Best practices

1. **Always review commands** before confirming execution
2. **Use allowed commands list** to restrict dangerous operations
3. **Set appropriate timeouts** to prevent hanging processes
4. **Run in sandbox mode** for untrusted inputs

## Next steps

- **[File management](/docs/cli/tutorials/file-management/)** — Work with local files
- **[Automate tasks](/docs/cli/tutorials/automation/)** — Schedule recurring commands
- **[Sandboxing](/docs/features/sandbox/)** — Isolate tool execution
