# File management

Learn how to work with local files and directories using SaCode CLI's built-in capabilities.

## Overview

SaCode CLI provides file system capabilities through the `@sacode/capabilities` package. These tools allow the AI model to read, write, search, and manage files within allowed directories.

## Available file tools

| Tool             | Description                                    |
| ---------------- | ---------------------------------------------- |
| `read_file`      | Read file contents                             |
| `write_file`     | Write content to a file                        |
| `edit_file`      | Edit file with line range replacement or regex |
| `delete_file`    | Delete a file or directory                     |
| `list_directory` | List directory contents                        |
| `grep_tool`      | Search file contents with ripgrep              |

## Reading files

The AI model can read files to understand code, configuration, or documentation:

Terminal window

```bash
# Via tool execution (within chat)
sacode chat -m "读取 package.json 的内容"
```

The file tool respects the configured `allowedDirs` and `maxSize` limits:

- **Maximum file size**: 10 MB
- **Allowed directories**: Configured via `CAP_FILES_ALLOWED_DIRS`
- **Read-only mode**: Can be enabled via `CAP_FILES_READ_ONLY=true`

## Writing files

The AI model can create and modify files:

Terminal window

```bash
sacode chat -m "创建一个 hello.py 文件，打印 Hello World"
```

### File editing modes

The `edit_file` tool supports multiple modes:

- **String replacement** — Direct string match and replace
- **Line range** — Replace specific line ranges (e.g., lines 10-20)
- **Regex** — Regular expression replacement

## Searching files

Use `grep_tool` to search across your codebase:

Terminal window

```bash
# Via tool execution
sacode chat -m "搜索所有包含 'auth' 的 TypeScript 文件"
```

The grep tool uses ripgrep for fast searches with support for:

- Regular expressions
- File type filtering
- Context lines
- Include/exclude patterns

## Security considerations

File operations are protected by multiple safety layers:

| Protection              | Description                                    |
| ----------------------- | ---------------------------------------------- |
| **Path traversal**      | Blocks `..` sequences and absolute paths       |
| **Directory scoping**   | Only files within `allowedDirs` are accessible |
| **Size limits**         | Maximum file size prevents memory exhaustion   |
| **Extension whitelist** | Only allowed file types can be created         |
| **Read-only mode**      | Can disable all write operations               |

## Configuration

File capabilities are configured via environment variables:

Terminal window

```env
CAP_FILES_ENABLED=true
CAP_FILES_ALLOWED_DIRS=.
CAP_FILES_MAX_SIZE=10485760
CAP_FILES_READ_ONLY=false
```

## Next steps

- **[Execute shell commands](/docs/cli/tutorials/shell-commands/)** — Run system commands safely
- **[Web search and fetch](/docs/cli/tutorials/web-tools/)** — Search and fetch web content
- **[Tools reference](/docs/reference/tools/)** — Complete tool documentation
