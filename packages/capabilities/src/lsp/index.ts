/**
 * LSP 工具模块
 *
 * 提供语言服务器协议（LSP）集成能力
 */

import type { ToolDefinition } from "../types";
import type { LspCapabilityConfig } from "../types";
import { createLspTool } from "./client";

/**
 * 创建 LSP 工具
 */
export function createLspTools(config: LspCapabilityConfig): ToolDefinition[] {
  const tools: ToolDefinition[] = [];

  if (!config.enabled) {
    return tools;
  }

  // lsp_tool
  tools.push(createLspTool(config));

  return tools;
}