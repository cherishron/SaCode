/**
 * 工具执行器 — 分级权限管理
 */
import type { Tool, ToolResult } from "./types.js";

export class ToolExecutor {
  private tools: Map<string, Tool> = new Map();
  private autoApprove: Set<string>;

  constructor(
    tools: Tool[],
    autoApproveList: string[] = [],
  ) {
    for (const tool of tools) {
      this.tools.set(tool.name, tool);
    }
    this.autoApprove = new Set(autoApproveList);
  }

  /**
   * 获取所有工具的 schema 定义（用于发送给 AI）
   */
  getToolSchemas(): Array<{
    name: string;
    description: string;
    inputSchema: Record<string, unknown>;
  }> {
    return Array.from(this.tools.values()).map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
    }));
  }

  /**
   * 执行工具
   */
  async execute(
    _toolCallId: string,
    toolName: string,
    args: Record<string, unknown>,
    onApproval?: (toolName: string, args: Record<string, unknown>) => Promise<boolean>,
  ): Promise<ToolResult> {
    const tool = this.tools.get(toolName);
    if (!tool) {
      return {
        success: false,
        output: "",
        error: `Unknown tool: ${toolName}`,
      };
    }

    // 权限检查
    if (tool.requiresApproval && !this.autoApprove.has(toolName)) {
      if (onApproval) {
        const approved = await onApproval(toolName, args);
        if (!approved) {
          return {
            success: false,
            output: "",
            error: "Tool execution denied by user",
          };
        }
      }
    }

    // 执行工具
    const startTime = Date.now();
    try {
      const result = await tool.execute(args);
      return {
        ...result,
        metadata: {
          ...result.metadata,
          duration: Date.now() - startTime,
        },
      };
    } catch (err) {
      return {
        success: false,
        output: "",
        error: err instanceof Error ? err.message : String(err),
        metadata: { duration: Date.now() - startTime },
      };
    }
  }

  /**
   * 检查工具是否需要审批
   */
  needsApproval(toolName: string): boolean {
    const tool = this.tools.get(toolName);
    if (!tool) return true;
    return tool.requiresApproval && !this.autoApprove.has(toolName);
  }

  listTools(): string[] {
    return Array.from(this.tools.keys());
  }
}
