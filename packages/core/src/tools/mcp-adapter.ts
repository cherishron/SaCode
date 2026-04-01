/**
 * MCP 客户端适配器
 *
 * 将 MCPClient 包装为 ToolBridge 可用的接口
 */

import type { MCPClient } from "../mcp";
import type { MCPClientLike } from "../tools/types";

/**
 * 创建 MCP 客户端适配器
 *
 * 将 MCPClient 包装为 ToolBridge 可用的 MCPClientLike 接口
 */
export function createMCPClientAdapter(client: MCPClient): MCPClientLike {
  return {
    async listTools() {
      const tools = await client.listTools();
      return tools.map((tool) => {
        const result: { name: string; description?: string; inputSchema: Record<string, unknown> } = {
          name: tool.name,
          inputSchema: tool.inputSchema as Record<string, unknown>,
        };
        if (tool.description) {
          result.description = tool.description;
        }
        return result;
      });
    },

    async callTool(name: string, args: Record<string, unknown>) {
      const result = await client.callTool(name, args);

      // 提取文本内容
      const textContent = result.content
        .filter((c) => c.type === "text")
        .map((c) => (c as { text: string }).text)
        .join("\n");

      return {
        content: textContent || JSON.stringify(result.content),
      };
    },
  };
}

/**
 * 批量创建 MCP 客户端适配器
 */
export function createMCPClientAdapters(
  clients: Map<string, MCPClient>
): Map<string, MCPClientLike> {
  const adapters = new Map<string, MCPClientLike>();

  for (const [name, client] of clients) {
    adapters.set(name, createMCPClientAdapter(client));
  }

  return adapters;
}
