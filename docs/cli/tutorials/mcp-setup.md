# Set up an MCP server

Learn how to connect to and use MCP (Model Context Protocol) services with SaCode CLI.

## Overview

SaCode implements the complete Model Context Protocol (MCP) with both server and client capabilities. MCP allows standardized tool discovery and execution across different AI providers.

## MCP architecture

```
┌──────────────┐         ┌──────────────┐         ┌──────────────┐
│  SaCode CLI  │────────▶│  MCP Client  │────────▶│  MCP Server  │
│              │◀────────│              │◀────────│              │
└──────────────┘         └──────────────┘         └──────────────┘
```

## Using MCP tools

MCP tools are automatically discovered and registered with the AI model. When you chat with SaCode, MCP tools appear alongside built-in tools:

Terminal window

```bash
sacode chat -m "使用 MCP 工具读取文件"
```

## MCP Server setup

SaCode can act as an MCP server, exposing its tools to external clients:

```typescript
import { MCPServer } from "@sacode/core";

const mcpServer = new MCPServer({
  name: "sacode-mcp",
  version: "1.0.0",
});

// Register a tool
mcpServer.registerTool(
  {
    name: "read_file",
    description: "Read a file",
    inputSchema: {
      type: "object",
      properties: { path: { type: "string" } },
    },
  },
  async (args) => ({
    content: [{ type: "text", text: "file content" }],
  })
);

await mcpServer.start();
```

## MCP Client connection

Connect to external MCP servers:

```typescript
import { MCPClient } from "@sacode/core";

const mcpClient = new MCPClient();
await mcpClient.connect("http://localhost:8080/mcp");

const result = await mcpClient.callTool("read_file", { path: "./config.json" });
```

## Built-in MCP tools

SaCode exposes these categories of tools via MCP:

| Category    | Tools                                            |
| ----------- | ------------------------------------------------ |
| **File**    | read_file, write_file, edit_file, list_directory |
| **Search**  | grep_tool, web_search                            |
| **Web**     | web_fetch, http_request                          |
| **Shell**   | run_shell_command                                |
| **Browser** | navigate, screenshot, click, extract             |
| **LSP**     | definition, references, completion, diagnostics  |

## Configuration

MCP is enabled by default. Configure via environment variables:

Terminal window

```env
# MCP server settings
MCP_ENABLED=true
MCP_SERVER_PORT=8080
MCP_SERVER_NAME=sacode-mcp
```

## Next steps

- **[Tools reference](/docs/reference/tools/)** — Complete tool documentation
- **[Automate tasks](/docs/cli/tutorials/automation/)** — Schedule recurring tasks
- **[MCP protocol spec](https://modelcontextprotocol.io/)** — Official MCP documentation
